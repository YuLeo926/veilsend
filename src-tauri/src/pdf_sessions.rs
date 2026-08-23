use std::{
    io::{Cursor, Read},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Serialize;
use sharegate_core::{
    DEFAULT_MAX_PDF_SOURCE_BYTES, DEFAULT_PDF_RENDER_DPI, ImageBarcodeInspection,
    ImageFaceInspection, ImageOcrInspection, ImageQrInspection, fingerprint,
};
use uuid::Uuid;

use crate::{
    image_pipeline::{ReviewedVisualSnapshot, VisualInspectionBundle, inspect_visual},
    windows_pdf::{self, PdfAdapterError, PdfPageDescriptor},
};

#[derive(Debug, Clone)]
pub struct StoredPdfPage {
    pub descriptor: PdfPageDescriptor,
    pub thumbnail_data_url: String,
    pub ocr: ImageOcrInspection,
    pub faces: ImageFaceInspection,
    pub qr: ImageQrInspection,
    pub barcodes: ImageBarcodeInspection,
    pub reviewed: ReviewedVisualSnapshot,
}

#[derive(Debug)]
pub struct PreparedPdfSession {
    pub canonical_path: PathBuf,
    pub source_bytes: Vec<u8>,
    pub fingerprint: String,
    pub filename: String,
    pub pages: Vec<StoredPdfPage>,
}

#[derive(Debug, Clone)]
struct StoredPdfSession {
    id: String,
    canonical_path: PathBuf,
    source_bytes: Arc<Vec<u8>>,
    fingerprint: String,
    filename: String,
    pages: Arc<Vec<StoredPdfPage>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPageSummary {
    pub page_index: usize,
    pub width_points: f32,
    pub height_points: f32,
    pub width_pixels: u32,
    pub height_pixels: u32,
    pub thumbnail_data_url: String,
    pub ocr: ImageOcrInspection,
    pub faces: ImageFaceInspection,
    pub qr: ImageQrInspection,
    pub barcodes: ImageBarcodeInspection,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfSessionSummary {
    pub session_id: String,
    pub filename: String,
    pub bytes: usize,
    pub page_count: usize,
    pub pages: Vec<PdfPageSummary>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPagePreview {
    pub page_index: usize,
    pub width: u32,
    pub height: u32,
    pub preview_data_url: String,
}

#[derive(Debug, Clone)]
pub struct ResolvedPdfSession {
    pub canonical_path: PathBuf,
    pub source_bytes: Arc<Vec<u8>>,
    pub fingerprint: String,
    pub filename: String,
    pub pages: Arc<Vec<StoredPdfPage>>,
}

#[derive(Default)]
pub struct PdfSessionStore(Mutex<Option<StoredPdfSession>>);

impl PdfSessionStore {
    pub fn replace(&self, prepared: PreparedPdfSession) -> Result<PdfSessionSummary, String> {
        if fingerprint(&prepared.source_bytes) != prepared.fingerprint {
            return Err("The PDF changed while its review session was opening.".to_owned());
        }
        let stored = StoredPdfSession {
            id: Uuid::new_v4().to_string(),
            canonical_path: prepared.canonical_path,
            source_bytes: Arc::new(prepared.source_bytes),
            fingerprint: prepared.fingerprint,
            filename: prepared.filename,
            pages: Arc::new(prepared.pages),
        };
        let summary = summarize(&stored);
        *self
            .0
            .lock()
            .map_err(|_| "The new PDF session could not be stored.".to_owned())? = Some(stored);
        Ok(summary)
    }

    pub fn resolve(&self, id: &str) -> Result<ResolvedPdfSession, String> {
        let stored = self
            .0
            .lock()
            .map_err(|_| "The active PDF session could not be opened.".to_owned())?
            .as_ref()
            .filter(|session| session.id == id)
            .cloned()
            .ok_or_else(|| "This PDF session has expired. Choose the document again.".to_owned())?;
        let current = read_source_file(&stored.canonical_path)?;
        if fingerprint(&current) != stored.fingerprint {
            return Err(
                "The source PDF changed after review. Choose it again before saving.".to_owned(),
            );
        }
        Ok(ResolvedPdfSession {
            canonical_path: stored.canonical_path,
            source_bytes: stored.source_bytes,
            fingerprint: stored.fingerprint,
            filename: stored.filename,
            pages: stored.pages,
        })
    }

    pub fn clear(&self) -> Result<(), String> {
        *self
            .0
            .lock()
            .map_err(|_| "The active PDF session could not be cleared.".to_owned())? = None;
        Ok(())
    }
}

pub fn prepare_pdf_file(path: &Path) -> Result<PreparedPdfSession, String> {
    validate_pdf_extension(path)?;
    let canonical_path = path
        .canonicalize()
        .map_err(|_| "The selected PDF could not be resolved. Choose it again.".to_owned())?;
    let source_bytes = read_source_file(&canonical_path)?;
    let fingerprint = fingerprint(&source_bytes);
    let filename = canonical_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document.pdf")
        .to_owned();
    let mut pages = Vec::new();
    let descriptors = windows_pdf::visit_pages(&source_bytes, DEFAULT_PDF_RENDER_DPI, |rendered| {
        let thumbnail_data_url = thumbnail_data_url(&rendered.png_bytes, 320)
            .map(|value| value.0)
            .map_err(PdfAdapterError::Invalid)?;
        let mut visual = inspect_visual(&rendered.png_bytes);
        scope_pdf_visual(rendered.descriptor.page_index, &mut visual);
        let reviewed = visual.snapshot();
        pages.push(StoredPdfPage {
            descriptor: rendered.descriptor,
            thumbnail_data_url,
            ocr: visual.ocr,
            faces: visual.faces,
            qr: visual.qr,
            barcodes: visual.barcodes,
            reviewed,
        });
        Ok(())
    })
    .map_err(PdfAdapterError::into_message)?;
    if descriptors.len() != pages.len() || pages.is_empty() {
        return Err("ShareGate could not inspect every PDF page.".to_owned());
    }
    Ok(PreparedPdfSession {
        canonical_path,
        source_bytes,
        fingerprint,
        filename,
        pages,
    })
}

pub fn scope_pdf_visual(page_index: usize, visual: &mut VisualInspectionBundle) {
    let scope = |id: &str| format!("pdf-page-{page_index}:{id}");
    if let Some(report) = &mut visual.ocr.report {
        for finding in &mut report.findings {
            finding.id = scope(&finding.id);
        }
    }
    for finding in &mut visual.faces.findings {
        finding.id = scope(&finding.id);
    }
    if let Some(report) = &mut visual.qr.report {
        for finding in &mut report.findings {
            finding.id = scope(&finding.id);
        }
    }
    if let Some(report) = &mut visual.barcodes.report {
        for finding in &mut report.findings {
            finding.id = scope(&finding.id);
        }
    }
    for finding in &mut visual.reviewed {
        finding.id = scope(&finding.id);
    }
}

pub fn prepare_page_preview(
    source_bytes: &[u8],
    page_index: usize,
) -> Result<PdfPagePreview, String> {
    let rendered = windows_pdf::render_page(source_bytes, page_index, DEFAULT_PDF_RENDER_DPI)
        .map_err(PdfAdapterError::into_message)?;
    let (preview_data_url, width, height) = thumbnail_data_url(&rendered.png_bytes, 1_600)?;
    Ok(PdfPagePreview {
        page_index,
        width,
        height,
        preview_data_url,
    })
}

fn validate_pdf_extension(path: &Path) -> Result<(), String> {
    let is_pdf = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"));
    if is_pdf {
        Ok(())
    } else {
        Err("Choose a local PDF file with a .pdf extension.".to_owned())
    }
}

fn validate_pdf_header(bytes: &[u8]) -> Result<(), String> {
    let header = &bytes[..bytes.len().min(1_024)];
    if header.windows(5).any(|window| window == b"%PDF-") {
        Ok(())
    } else {
        Err("The selected file does not contain a supported PDF header.".to_owned())
    }
}

fn read_source_file(path: &Path) -> Result<Vec<u8>, String> {
    validate_pdf_extension(path)?;
    let file = std::fs::File::open(path)
        .map_err(|_| "The selected PDF could not be read. Choose it again.".to_owned())?;
    let mut bytes = Vec::new();
    file.take(DEFAULT_MAX_PDF_SOURCE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "The selected PDF could not be read. Choose it again.".to_owned())?;
    if bytes.len() > DEFAULT_MAX_PDF_SOURCE_BYTES {
        return Err(format!(
            "This PDF is larger than ShareGate's {} MB local safety limit.",
            DEFAULT_MAX_PDF_SOURCE_BYTES / 1024 / 1024
        ));
    }
    validate_pdf_header(&bytes)?;
    Ok(bytes)
}

fn summarize(session: &StoredPdfSession) -> PdfSessionSummary {
    let pages = session
        .pages
        .iter()
        .map(|page| PdfPageSummary {
            page_index: page.descriptor.page_index,
            width_points: page.descriptor.width_points,
            height_points: page.descriptor.height_points,
            width_pixels: page.descriptor.width_pixels,
            height_pixels: page.descriptor.height_pixels,
            thumbnail_data_url: page.thumbnail_data_url.clone(),
            ocr: page.ocr.clone(),
            faces: page.faces.clone(),
            qr: page.qr.clone(),
            barcodes: page.barcodes.clone(),
        })
        .collect::<Vec<_>>();
    let incomplete = session
        .pages
        .iter()
        .filter(|page| !page.reviewed.checks.all_complete())
        .count();
    PdfSessionSummary {
        session_id: session.id.clone(),
        filename: session.filename.clone(),
        bytes: session.source_bytes.len(),
        page_count: pages.len(),
        pages,
        warnings: if incomplete == 0 {
            Vec::new()
        } else {
            vec![format!(
                "{incomplete} PDF page(s) have an incomplete local detector and will require review."
            )]
        },
    }
}

fn thumbnail_data_url(bytes: &[u8], max_dimension: u32) -> Result<(String, u32, u32), String> {
    let decoded = image::load_from_memory(bytes)
        .map_err(|_| "A rendered PDF page could not be prepared for review.".to_owned())?;
    let preview = decoded.thumbnail(max_dimension, max_dimension);
    let width = preview.width();
    let height = preview.height();
    let mut output = Cursor::new(Vec::new());
    preview
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|_| "A rendered PDF page preview could not be encoded safely.".to_owned())?;
    Ok((
        format!(
            "data:image/png;base64,{}",
            STANDARD.encode(output.into_inner())
        ),
        width,
        height,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempPdf(PathBuf);

    impl TempPdf {
        fn new(label: &str, bytes: &[u8]) -> Self {
            let path =
                std::env::temp_dir().join(format!("sharegate-{label}-{}.pdf", Uuid::new_v4()));
            std::fs::write(&path, bytes).unwrap();
            Self(path.canonicalize().unwrap())
        }
    }

    impl Drop for TempPdf {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    #[test]
    fn rejects_non_pdf_names_and_bytes() {
        assert!(validate_pdf_extension(Path::new("report.txt")).is_err());
        assert!(validate_pdf_extension(Path::new("report.PDF")).is_ok());
        assert!(validate_pdf_header(b"not a pdf").is_err());
        assert!(validate_pdf_header(b"%PDF-1.7\n").is_ok());
    }

    #[test]
    fn replacing_and_clearing_sessions_expire_old_ids() {
        let store = PdfSessionStore::default();
        let first_file = TempPdf::new("first", b"%PDF-first");
        let second_file = TempPdf::new("second", b"%PDF-second");
        let first = store.replace(prepared(&first_file)).unwrap();
        let second = store.replace(prepared(&second_file)).unwrap();

        assert!(store.resolve(&first.session_id).is_err());
        assert!(store.resolve(&second.session_id).is_ok());
        store.clear().unwrap();
        assert!(store.resolve(&second.session_id).is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn prepares_a_synthetic_pdf_without_source_page_files() {
        let source = sharegate_core::build_flattened_pdf(
            &[sharegate_core::PdfPageRaster {
                width_pixels: 20,
                height_pixels: 30,
                width_points: 72.0,
                height_points: 108.0,
                rgb_bytes: vec![240; 20 * 30 * 3],
            }],
            sharegate_core::PdfBuildLimits::default(),
        )
        .unwrap();
        let file = TempPdf::new("prepared", &source);
        let prepared = prepare_pdf_file(&file.0).unwrap();

        assert_eq!(prepared.pages.len(), 1);
        assert_eq!(prepared.pages[0].descriptor.width_pixels, 144);
        assert_eq!(prepared.pages[0].descriptor.height_pixels, 216);
        assert!(
            prepared.pages[0]
                .thumbnail_data_url
                .starts_with("data:image/png;base64,")
        );
        assert_eq!(prepared.source_bytes, source);
    }

    fn prepared(file: &TempPdf) -> PreparedPdfSession {
        let bytes = std::fs::read(&file.0).unwrap();
        PreparedPdfSession {
            canonical_path: file.0.clone(),
            source_bytes: bytes.clone(),
            fingerprint: sharegate_core::fingerprint(&bytes),
            filename: file.0.file_name().unwrap().to_string_lossy().into_owned(),
            pages: Vec::new(),
        }
    }
}
