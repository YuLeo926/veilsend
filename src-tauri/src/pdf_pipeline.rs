use std::{
    collections::{HashMap, HashSet},
    io::Read,
    path::Path,
};

use serde::Serialize;
use sharegate_core::{
    DEFAULT_MAX_IMAGE_BYTES, DEFAULT_MAX_PDF_OUTPUT_BYTES, DEFAULT_PDF_RENDER_DPI, ImageRect,
    ImageRedactionDecision, ImageRedactionTarget, PdfBuildLimits, PdfManualRegion, PdfPageImage,
    PdfPageRaster, VerificationStatus, build_flattened_pdf_from_images, compress_pdf_page,
    fingerprint, normalized_rect_to_pixels, redact_image,
};

use crate::{
    format_core_error,
    image_pipeline::{
        DetectorChecks, DetectorKind, ReviewedVisualFinding, inspect_visual,
        remaining_are_exceptions, resolve_decisions,
    },
    pdf_sessions::{ResolvedPdfSession, scope_pdf_visual},
    same_path,
    windows_pdf::{self, PdfAdapterError, PdfPageDescriptor},
};

const MAX_MANUAL_REGIONS_PER_PAGE: usize = 100;
const MAX_MANUAL_REGIONS_PER_DOCUMENT: usize = 1_000;
const REDACTION_INK: [u8; 3] = [27, 25, 22];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanedPdfVerification {
    pub status: VerificationStatus,
    pub saved_bytes_match: bool,
    pub page_count_match: bool,
    pub pages_rendered: usize,
    pub visual_findings_remaining: usize,
    pub ocr_checked: bool,
    pub faces_remaining: usize,
    pub face_checked: bool,
    pub qr_codes_remaining: usize,
    pub qr_checked: bool,
    pub barcodes_remaining: usize,
    pub barcode_checked: bool,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanedPdfFile {
    pub saved_path: String,
    pub filename: String,
    pub original_bytes: usize,
    pub cleaned_size: usize,
    pub pages_rebuilt: usize,
    pub redacted_findings: usize,
    pub redacted_text_findings: usize,
    pub redacted_face_findings: usize,
    pub redacted_qr_findings: usize,
    pub redacted_barcode_findings: usize,
    pub manual_regions: usize,
    pub redacted_regions: usize,
    pub exceptions: usize,
    pub verification: CleanedPdfVerification,
}

struct PreparedPdfSafetyCopy {
    bytes: Vec<u8>,
    expected_pages: Vec<PdfPageDescriptor>,
    kept_by_page: Vec<Vec<ReviewedVisualFinding>>,
    selected_rectangles_by_page: Vec<Vec<ImageRect>>,
    source_checks: DetectorChecks,
    redacted_findings: usize,
    redacted_by_kind: FindingCounts,
    manual_regions: usize,
    redacted_regions: usize,
    exceptions: usize,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct FindingCounts {
    text: usize,
    face: usize,
    qr: usize,
    barcode: usize,
}

impl FindingCounts {
    fn add(&mut self, kind: DetectorKind) {
        match kind {
            DetectorKind::Text => self.text += 1,
            DetectorKind::Face => self.face += 1,
            DetectorKind::Qr => self.qr += 1,
            DetectorKind::Barcode => self.barcode += 1,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct AggregateChecks {
    text: bool,
    face: bool,
    qr: bool,
    barcode: bool,
}

impl Default for AggregateChecks {
    fn default() -> Self {
        Self {
            text: true,
            face: true,
            qr: true,
            barcode: true,
        }
    }
}

impl AggregateChecks {
    fn include(&mut self, checks: DetectorChecks) {
        self.text &= checks.text;
        self.face &= checks.face;
        self.qr &= checks.qr;
        self.barcode &= checks.barcode;
    }

    const fn finish(self) -> DetectorChecks {
        DetectorChecks {
            text: self.text,
            face: self.face,
            qr: self.qr,
            barcode: self.barcode,
        }
    }
}

pub fn clean_pdf_file(
    resolved: ResolvedPdfSession,
    decisions: Vec<ImageRedactionDecision>,
    manual_regions: Vec<PdfManualRegion>,
) -> Result<Option<CleanedPdfFile>, String> {
    let prepared = build_safety_copy(&resolved, &decisions, &manual_regions)?;
    let default_name = redacted_pdf_name(&resolved.filename);
    let output = rfd::FileDialog::new()
        .add_filter("ShareGate flattened PDF", &["pdf"])
        .set_file_name(&default_name)
        .save_file();
    let Some(output) = output else {
        return Ok(None);
    };
    if !output
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
    {
        return Err("Save the flattened safety copy with a .pdf extension.".to_owned());
    }
    if same_path(&resolved.canonical_path, &output) {
        return Err(
            "ShareGate never overwrites the original PDF. Choose a different filename for the safety copy."
                .to_owned(),
        );
    }

    std::fs::write(&output, &prepared.bytes)
        .map_err(|error| format!("Could not save the flattened PDF safety copy: {error}"))?;
    let saved_bytes = read_pdf_with_limit(&output)?;
    if fingerprint(&saved_bytes) != fingerprint(&prepared.bytes) || saved_bytes != prepared.bytes {
        return Err("The saved PDF bytes do not match the locally rebuilt safety copy.".to_owned());
    }
    let verification = verify_saved_copy(&saved_bytes, &prepared)?;
    let filename = output
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&default_name)
        .to_owned();

    Ok(Some(CleanedPdfFile {
        saved_path: output.to_string_lossy().into_owned(),
        filename,
        original_bytes: resolved.source_bytes.len(),
        cleaned_size: saved_bytes.len(),
        pages_rebuilt: prepared.expected_pages.len(),
        redacted_findings: prepared.redacted_findings,
        redacted_text_findings: prepared.redacted_by_kind.text,
        redacted_face_findings: prepared.redacted_by_kind.face,
        redacted_qr_findings: prepared.redacted_by_kind.qr,
        redacted_barcode_findings: prepared.redacted_by_kind.barcode,
        manual_regions: prepared.manual_regions,
        redacted_regions: prepared.redacted_regions,
        exceptions: prepared.exceptions,
        verification,
    }))
}

fn build_safety_copy(
    resolved: &ResolvedPdfSession,
    decisions: &[ImageRedactionDecision],
    manual_regions: &[PdfManualRegion],
) -> Result<PreparedPdfSafetyCopy, String> {
    if fingerprint(&resolved.source_bytes) != resolved.fingerprint {
        return Err(
            "The PDF source in memory changed after review. Choose the document again.".to_owned(),
        );
    }
    let decisions_by_id = validate_decisions(resolved, decisions)?;
    let manual_by_page = validate_manual_regions(resolved, manual_regions)?;
    let mut compressed_pages: Vec<PdfPageImage> = Vec::with_capacity(resolved.pages.len());
    let mut expected_pages = Vec::with_capacity(resolved.pages.len());
    let mut kept_by_page = Vec::with_capacity(resolved.pages.len());
    let mut selected_rectangles_by_page = Vec::with_capacity(resolved.pages.len());
    let mut source_checks = AggregateChecks::default();
    let mut redacted_by_kind = FindingCounts::default();
    let mut redacted_findings = 0;
    let mut redacted_regions = 0;
    let mut exceptions = 0;

    let descriptors = windows_pdf::visit_pages(
        &resolved.source_bytes,
        DEFAULT_PDF_RENDER_DPI,
        |rendered| {
            let page_index = rendered.descriptor.page_index;
            let reviewed_page = resolved.pages.get(page_index).ok_or_else(|| {
                PdfAdapterError::Invalid(
                    "The PDF page order changed after review. Choose the document again."
                        .to_owned(),
                )
            })?;
            if !descriptors_match(reviewed_page.descriptor, rendered.descriptor) {
                return Err(PdfAdapterError::Invalid(
                    "A PDF page size changed after review. Choose the document again.".to_owned(),
                ));
            }

            let mut current = inspect_visual(&rendered.png_bytes);
            scope_pdf_visual(page_index, &mut current);
            if current.checks() != reviewed_page.reviewed.checks {
                return Err(PdfAdapterError::Invalid(
                    "The available local PDF checks changed after review. Review the document again before saving."
                        .to_owned(),
                ));
            }
            source_checks.include(current.checks());
            let page_decisions = reviewed_page
                .reviewed
                .findings
                .iter()
                .map(|finding| ImageRedactionDecision {
                    id: finding.id.clone(),
                    enabled: decisions_by_id[&finding.id],
                })
                .collect::<Vec<_>>();
            let resolved_visual = resolve_decisions(
                &reviewed_page.reviewed.findings,
                &current.reviewed,
                &page_decisions,
            )
            .map_err(PdfAdapterError::Invalid)?;

            let mut targets = resolved_visual
                .iter()
                .map(|finding| ImageRedactionTarget {
                    id: finding.reviewed_id.clone(),
                    rectangles: finding.rectangles.clone(),
                })
                .collect::<Vec<_>>();
            let mut redaction_decisions = page_decisions;
            for region in &manual_by_page[page_index] {
                let rectangle = normalized_rect_to_pixels(
                    region.rectangle,
                    rendered.descriptor.width_pixels,
                    rendered.descriptor.height_pixels,
                )
                .map_err(|error| PdfAdapterError::Invalid(error.to_string()))?;
                let id = format!("pdf-manual-{page_index}:{}", region.id);
                targets.push(ImageRedactionTarget {
                    id: id.clone(),
                    rectangles: vec![rectangle],
                });
                redaction_decisions.push(ImageRedactionDecision { id, enabled: true });
            }

            let selected_rectangles = targets
                .iter()
                .zip(&redaction_decisions)
                .filter(|(_, decision)| decision.enabled)
                .flat_map(|(target, _)| target.rectangles.iter().copied())
                .collect::<Vec<_>>();
            let rendered_fingerprint = fingerprint(&rendered.png_bytes);
            let cleaned = redact_image(
                &rendered.png_bytes,
                DEFAULT_MAX_IMAGE_BYTES,
                &rendered_fingerprint,
                &targets,
                &redaction_decisions,
            )
            .map_err(|error| PdfAdapterError::Invalid(error.to_string()))?;
            let rgb = decode_and_verify_opaque(&cleaned.cleaned_bytes, &selected_rectangles)
                .map_err(PdfAdapterError::Invalid)?;
            let raster = PdfPageRaster {
                width_pixels: rendered.descriptor.width_pixels,
                height_pixels: rendered.descriptor.height_pixels,
                width_points: rendered.descriptor.width_points,
                height_points: rendered.descriptor.height_points,
                rgb_bytes: rgb,
            };
            compressed_pages.push(
                compress_pdf_page(&raster)
                    .map_err(|error| PdfAdapterError::Invalid(error.to_string()))?,
            );
            expected_pages.push(rendered.descriptor);
            kept_by_page.push(
                resolved_visual
                    .iter()
                    .filter(|finding| !finding.enabled)
                    .map(|finding| ReviewedVisualFinding {
                        id: finding.reviewed_id.clone(),
                        kind: finding.kind,
                        rectangles: finding.rectangles.clone(),
                    })
                    .collect(),
            );
            selected_rectangles_by_page.push(selected_rectangles);
            for finding in resolved_visual.iter().filter(|finding| finding.enabled) {
                redacted_by_kind.add(finding.kind);
                redacted_findings += 1;
            }
            redacted_regions += cleaned.redacted_regions;
            exceptions += resolved_visual
                .iter()
                .filter(|finding| !finding.enabled)
                .count();
            Ok(())
        },
    )
    .map_err(PdfAdapterError::into_message)?;

    if descriptors.len() != resolved.pages.len()
        || compressed_pages.len() != resolved.pages.len()
        || expected_pages.len() != resolved.pages.len()
    {
        return Err("ShareGate could not safely rebuild every reviewed PDF page.".to_owned());
    }
    let bytes = build_flattened_pdf_from_images(&compressed_pages, PdfBuildLimits::default())
        .map_err(format_core_error)?;
    verify_flattened_structure(&bytes, expected_pages.len())?;

    Ok(PreparedPdfSafetyCopy {
        bytes,
        expected_pages,
        kept_by_page,
        selected_rectangles_by_page,
        source_checks: source_checks.finish(),
        redacted_findings,
        redacted_by_kind,
        manual_regions: manual_regions.len(),
        redacted_regions,
        exceptions,
    })
}

fn verify_saved_copy(
    saved_bytes: &[u8],
    prepared: &PreparedPdfSafetyCopy,
) -> Result<CleanedPdfVerification, String> {
    verify_flattened_structure(saved_bytes, prepared.expected_pages.len())?;
    let mut checks = AggregateChecks::default();
    let mut remaining = FindingCounts::default();
    let mut all_remaining_are_exceptions = true;
    let mut pages_rendered = 0;
    let descriptors = windows_pdf::visit_pages(saved_bytes, DEFAULT_PDF_RENDER_DPI, |rendered| {
        let page_index = rendered.descriptor.page_index;
        let expected = prepared.expected_pages.get(page_index).ok_or_else(|| {
            PdfAdapterError::Invalid("The saved PDF contains an unexpected extra page.".to_owned())
        })?;
        if !descriptors_match(*expected, rendered.descriptor) {
            return Err(PdfAdapterError::Invalid(
                "A saved PDF page does not match its rebuilt dimensions.".to_owned(),
            ));
        }
        decode_and_verify_opaque(
            &rendered.png_bytes,
            &prepared.selected_rectangles_by_page[page_index],
        )
        .map_err(PdfAdapterError::Invalid)?;
        let mut visual = inspect_visual(&rendered.png_bytes);
        scope_pdf_visual(page_index, &mut visual);
        checks.include(visual.checks());
        for finding in &visual.reviewed {
            remaining.add(finding.kind);
        }
        all_remaining_are_exceptions &=
            remaining_are_exceptions(&visual.reviewed, &prepared.kept_by_page[page_index]);
        pages_rendered += 1;
        Ok(())
    })
    .map_err(PdfAdapterError::into_message)?;
    let page_count_match = descriptors.len() == prepared.expected_pages.len()
        && pages_rendered == prepared.expected_pages.len();
    if !page_count_match {
        return Err("The saved PDF page count does not match the reviewed document.".to_owned());
    }

    let checks = checks.finish();
    let status = if !prepared.source_checks.all_complete()
        || !checks.all_complete()
        || !all_remaining_are_exceptions
    {
        VerificationStatus::NeedsReview
    } else if prepared.exceptions > 0 {
        VerificationStatus::CleanedWithExceptions
    } else {
        VerificationStatus::Verified
    };
    let message = match status {
        VerificationStatus::Verified => format!(
            "Rebuilt all {pages_rendered} page(s) as flattened images. The actual saved PDF matched the local output and passed text, face, QR, and barcode checks."
        ),
        VerificationStatus::CleanedWithExceptions => format!(
            "Rebuilt and rechecked all {pages_rendered} page(s) with {} explicit Keep exception(s). Those kept regions are not claimed safe.",
            prepared.exceptions
        ),
        VerificationStatus::NeedsReview if !prepared.source_checks.all_complete() => {
            "The flattened copy was saved, but one or more source-page detectors did not complete, so ShareGate cannot mark it Verified."
                .to_owned()
        }
        VerificationStatus::NeedsReview if !checks.all_complete() => {
            "The flattened copy was saved, but one or more checks on the actual saved PDF did not complete."
                .to_owned()
        }
        VerificationStatus::NeedsReview => format!(
            "The actual saved PDF contains unexpected remaining findings: {} text, {} face, {} QR, and {} barcode risk(s).",
            remaining.text, remaining.face, remaining.qr, remaining.barcode
        ),
    };

    Ok(CleanedPdfVerification {
        status,
        saved_bytes_match: true,
        page_count_match,
        pages_rendered,
        visual_findings_remaining: remaining.text,
        ocr_checked: checks.text,
        faces_remaining: remaining.face,
        face_checked: checks.face,
        qr_codes_remaining: remaining.qr,
        qr_checked: checks.qr,
        barcodes_remaining: remaining.barcode,
        barcode_checked: checks.barcode,
        message,
    })
}

fn validate_decisions(
    resolved: &ResolvedPdfSession,
    decisions: &[ImageRedactionDecision],
) -> Result<HashMap<String, bool>, String> {
    let reviewed_ids = resolved
        .pages
        .iter()
        .flat_map(|page| {
            page.reviewed
                .findings
                .iter()
                .map(|finding| finding.id.as_str())
        })
        .collect::<HashSet<_>>();
    let mut decisions_by_id = HashMap::new();
    for decision in decisions {
        if decisions_by_id
            .insert(decision.id.clone(), decision.enabled)
            .is_some()
        {
            return Err("A PDF finding had more than one decision.".to_owned());
        }
    }
    if reviewed_ids.len() != decisions_by_id.len()
        || reviewed_ids
            .iter()
            .any(|id| !decisions_by_id.contains_key(*id))
    {
        return Err(
            "Every PDF finding needs an explicit Redact or Keep decision before saving.".to_owned(),
        );
    }
    Ok(decisions_by_id)
}

fn validate_manual_regions<'a>(
    resolved: &ResolvedPdfSession,
    manual_regions: &'a [PdfManualRegion],
) -> Result<Vec<Vec<&'a PdfManualRegion>>, String> {
    if manual_regions.len() > MAX_MANUAL_REGIONS_PER_DOCUMENT {
        return Err(format!(
            "A PDF can contain at most {MAX_MANUAL_REGIONS_PER_DOCUMENT} manual cover regions."
        ));
    }
    let mut by_page = vec![Vec::new(); resolved.pages.len()];
    let mut ids = HashSet::new();
    for region in manual_regions {
        if region.id.trim().is_empty() || !ids.insert(region.id.as_str()) {
            return Err("Every manual PDF cover region needs a unique identifier.".to_owned());
        }
        let page = by_page.get_mut(region.page_index).ok_or_else(|| {
            "A manual cover region refers to a page that does not exist.".to_owned()
        })?;
        if page.len() >= MAX_MANUAL_REGIONS_PER_PAGE {
            return Err(format!(
                "A PDF page can contain at most {MAX_MANUAL_REGIONS_PER_PAGE} manual cover regions."
            ));
        }
        let descriptor = resolved.pages[region.page_index].descriptor;
        normalized_rect_to_pixels(
            region.rectangle,
            descriptor.width_pixels,
            descriptor.height_pixels,
        )
        .map_err(format_core_error)?;
        page.push(region);
    }
    Ok(by_page)
}

fn decode_and_verify_opaque(bytes: &[u8], rectangles: &[ImageRect]) -> Result<Vec<u8>, String> {
    let decoded = image::load_from_memory(bytes)
        .map_err(|_| "A redacted PDF page could not be decoded for verification.".to_owned())?;
    let rgb = decoded.to_rgb8();
    let width = rgb.width();
    let height = rgb.height();
    for rect in rectangles {
        let right = rect.x.saturating_add(rect.width).min(width);
        let bottom = rect.y.saturating_add(rect.height).min(height);
        if right <= rect.x || bottom <= rect.y {
            return Err("A selected PDF cover region has no page pixels.".to_owned());
        }
        for y in rect.y..bottom {
            for x in rect.x..right {
                if rgb.get_pixel(x, y).0 != REDACTION_INK {
                    return Err("A selected PDF cover region was not painted opaquely.".to_owned());
                }
            }
        }
    }
    Ok(rgb.into_raw())
}

fn descriptors_match(expected: PdfPageDescriptor, actual: PdfPageDescriptor) -> bool {
    expected.page_index == actual.page_index
        && expected.width_pixels == actual.width_pixels
        && expected.height_pixels == actual.height_pixels
        && (expected.width_points - actual.width_points).abs() <= 0.05
        && (expected.height_points - actual.height_points).abs() <= 0.05
}

fn verify_flattened_structure(bytes: &[u8], pages: usize) -> Result<(), String> {
    let count = |needle: &[u8]| {
        bytes
            .windows(needle.len())
            .filter(|window| *window == needle)
            .count()
    };
    if !bytes.starts_with(b"%PDF-1.7")
        || count(b"/Subtype /Image") != pages
        || count(b"/Type /Page\n") != pages
        || [
            b"/Metadata".as_slice(),
            b"/OpenAction",
            b"/AcroForm",
            b"/Annots",
            b"/EmbeddedFile",
        ]
        .iter()
        .any(|token| bytes.windows(token.len()).any(|window| window == *token))
    {
        return Err(
            "The rebuilt PDF did not satisfy ShareGate's flattened image-only structure."
                .to_owned(),
        );
    }
    Ok(())
}

fn read_pdf_with_limit(path: &Path) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path)
        .map_err(|error| format!("Could not read the saved PDF: {error}"))?;
    let mut bytes = Vec::new();
    file.take(DEFAULT_MAX_PDF_OUTPUT_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read the saved PDF: {error}"))?;
    if bytes.len() > DEFAULT_MAX_PDF_OUTPUT_BYTES {
        return Err(format!(
            "The saved PDF exceeds ShareGate's {} MB safety-copy limit.",
            DEFAULT_MAX_PDF_OUTPUT_BYTES / 1024 / 1024
        ));
    }
    Ok(bytes)
}

fn redacted_pdf_name(filename: &str) -> String {
    match filename.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() && extension.eq_ignore_ascii_case("pdf") => {
            format!("{stem}.redacted.pdf")
        }
        _ => format!("{filename}.redacted.pdf"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sharegate_core::{NormalizedRect, PdfManualRegion, PdfPageRaster, build_flattened_pdf};
    use std::path::PathBuf;
    use std::sync::Arc;
    use uuid::Uuid;

    #[test]
    fn names_flattened_copies_without_reusing_the_source_name() {
        assert_eq!(redacted_pdf_name("report.pdf"), "report.redacted.pdf");
        assert_eq!(redacted_pdf_name("REPORT.PDF"), "REPORT.redacted.pdf");
        assert_eq!(redacted_pdf_name("report"), "report.redacted.pdf");
    }

    #[test]
    fn verifies_opaque_selected_pixels() {
        let image = image::RgbImage::from_pixel(4, 4, image::Rgb(REDACTION_INK));
        let mut bytes = std::io::Cursor::new(Vec::new());
        image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        let rect = ImageRect {
            x: 1,
            y: 1,
            width: 2,
            height: 2,
        };
        assert_eq!(
            decode_and_verify_opaque(&bytes.into_inner(), &[rect])
                .unwrap()
                .len(),
            4 * 4 * 3
        );
    }

    #[test]
    fn rejects_a_non_opaque_selected_pixel() {
        let image = image::RgbImage::from_pixel(2, 2, image::Rgb([255, 255, 255]));
        let mut bytes = std::io::Cursor::new(Vec::new());
        image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        let rect = ImageRect {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
        };
        assert!(decode_and_verify_opaque(&bytes.into_inner(), &[rect]).is_err());
    }

    #[test]
    fn rejects_non_flattened_pdf_objects() {
        assert!(verify_flattened_structure(b"%PDF-1.7 /Type /Page\n", 1).is_err());
        assert!(
            verify_flattened_structure(b"%PDF-1.7 /Type /Page\n /Subtype /Image /AcroForm", 1)
                .is_err()
        );
    }

    #[test]
    fn manual_region_shape_is_serializable_for_the_command_boundary() {
        let region = PdfManualRegion {
            id: "manual-1".to_owned(),
            page_index: 2,
            rectangle: NormalizedRect {
                x: 0.1,
                y: 0.2,
                width: 0.3,
                height: 0.4,
            },
        };
        let json = serde_json::to_value(region).unwrap();
        assert_eq!(json["pageIndex"], 2);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn rebuilds_and_rechecks_a_real_in_memory_windows_pdf_page() {
        struct TempPdf(PathBuf);
        impl Drop for TempPdf {
            fn drop(&mut self) {
                let _ = std::fs::remove_file(&self.0);
            }
        }

        let source = build_flattened_pdf(
            &[PdfPageRaster {
                width_pixels: 40,
                height_pixels: 60,
                width_points: 72.0,
                height_points: 108.0,
                rgb_bytes: vec![245; 40 * 60 * 3],
            }],
            PdfBuildLimits::default(),
        )
        .unwrap();
        let temp = TempPdf(
            std::env::temp_dir().join(format!("sharegate-pipeline-{}.pdf", Uuid::new_v4())),
        );
        std::fs::write(&temp.0, &source).unwrap();
        let prepared = crate::pdf_sessions::prepare_pdf_file(&temp.0).unwrap();
        let decisions = prepared
            .pages
            .iter()
            .flat_map(|page| &page.reviewed.findings)
            .map(|finding| ImageRedactionDecision {
                id: finding.id.clone(),
                enabled: true,
            })
            .collect::<Vec<_>>();
        let resolved = ResolvedPdfSession {
            canonical_path: prepared.canonical_path,
            source_bytes: Arc::new(prepared.source_bytes),
            fingerprint: prepared.fingerprint,
            filename: prepared.filename,
            pages: Arc::new(prepared.pages),
        };
        let manual = [PdfManualRegion {
            id: "manual-1".to_owned(),
            page_index: 0,
            rectangle: NormalizedRect {
                x: 0.25,
                y: 0.25,
                width: 0.5,
                height: 0.5,
            },
        }];

        let rebuilt = build_safety_copy(&resolved, &decisions, &manual).unwrap();
        assert_eq!(rebuilt.expected_pages.len(), 1);
        assert_eq!(rebuilt.manual_regions, 1);
        assert!(rebuilt.bytes.starts_with(b"%PDF-1.7"));
        let verification = verify_saved_copy(&rebuilt.bytes, &rebuilt).unwrap();
        assert!(verification.saved_bytes_match);
        assert!(verification.page_count_match);
        assert_eq!(verification.pages_rendered, 1);

        let rendered = windows_pdf::render_page(&rebuilt.bytes, 0, DEFAULT_PDF_RENDER_DPI).unwrap();
        let pixels = image::load_from_memory(&rendered.png_bytes)
            .unwrap()
            .to_rgb8();
        assert_eq!(pixels.get_pixel(72, 108).0, REDACTION_INK);
    }
}
