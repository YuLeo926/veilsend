use std::{
    io::Read,
    path::{Path, PathBuf},
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Serialize;
use sharegate_core::{
    DEFAULT_MAX_IMAGE_BYTES, ImageFormat, ImageInspection, ImageOcrInspection, ImageTextDecision,
    OcrAvailability, SanitizeRequest, SanitizeResult, ScanOptions, ScanReport, ShareGateError,
    VerificationStatus, fingerprint, inspect_image, map_ocr_findings, redact_image, sanitize,
    sanitize_image, scan,
};

mod windows_ocr;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageSession {
    source_path: String,
    source_fingerprint: String,
    filename: String,
    preview_data_url: String,
    inspection: ImageInspection,
    ocr: ImageOcrInspection,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CleanedImageVerification {
    status: VerificationStatus,
    metadata_remaining: usize,
    visual_findings_remaining: usize,
    ocr_checked: bool,
    pixels_unchanged: bool,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CleanedImageFile {
    saved_path: String,
    filename: String,
    preview_data_url: String,
    original_bytes: usize,
    cleaned_size: usize,
    removed_metadata_findings: usize,
    redacted_findings: usize,
    redacted_regions: usize,
    exceptions: usize,
    verification: CleanedImageVerification,
}

const MAX_SAVED_IMAGE_BYTES: usize = 100 * 1024 * 1024;

#[tauri::command]
fn scan_text(text: String, options: ScanOptions) -> Result<ScanReport, ShareGateError> {
    scan(&text, options)
}

#[tauri::command]
fn sanitize_text(request: SanitizeRequest) -> Result<SanitizeResult, ShareGateError> {
    sanitize(request)
}

#[tauri::command]
async fn save_cleaned_text(
    default_name: String,
    content: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = rfd::FileDialog::new()
            .set_file_name(&default_name)
            .save_file();
        let Some(path) = path else {
            return Ok(None);
        };
        std::fs::write(&path, content)
            .map_err(|error| format!("Could not save the clean copy: {error}"))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| format!("The save dialog could not be opened: {error}"))?
}

#[tauri::command]
async fn pick_image() -> Result<Option<ImageSession>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = rfd::FileDialog::new()
            .add_filter("JPEG and PNG images", &["jpg", "jpeg", "png"])
            .pick_file();
        let Some(path) = path else {
            return Ok(None);
        };
        load_image_session(&path).map(Some)
    })
    .await
    .map_err(|error| format!("The image picker could not be opened: {error}"))?
}

#[tauri::command]
async fn clean_image_file(
    source_path: String,
    source_fingerprint: String,
    decisions: Vec<ImageTextDecision>,
) -> Result<Option<CleanedImageFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = PathBuf::from(source_path);
        let input = read_image(&source)?;
        if fingerprint(&input) != source_fingerprint {
            return Err(ShareGateError::StaleContent.to_string());
        }
        let source_inspection =
            inspect_image(&input, DEFAULT_MAX_IMAGE_BYTES).map_err(format_core_error)?;
        let ocr_before = inspect_visible_text(&input);
        let visual_findings = ocr_before
            .report
            .as_ref()
            .map(|report| report.findings.as_slice())
            .unwrap_or_default();
        let has_visual_review = !visual_findings.is_empty();

        let (
            cleaned_bytes,
            original_bytes,
            redacted_findings,
            redacted_regions,
            exceptions,
            pixels_unchanged,
        ) = if has_visual_review {
            let result = redact_image(
                &input,
                DEFAULT_MAX_IMAGE_BYTES,
                &source_fingerprint,
                visual_findings,
                &decisions,
            )
            .map_err(format_core_error)?;
            (
                result.cleaned_bytes,
                result.original_bytes,
                result.redacted_findings,
                result.redacted_regions,
                result.exceptions,
                false,
            )
        } else {
            let result =
                sanitize_image(&input, DEFAULT_MAX_IMAGE_BYTES).map_err(format_core_error)?;
            if !result.verification.verified {
                return Err(result.verification.message);
            }
            (
                result.cleaned_bytes,
                result.original_bytes,
                0,
                0,
                0,
                result.verification.pixels_unchanged,
            )
        };
        if cleaned_bytes.len() > MAX_SAVED_IMAGE_BYTES {
            return Err(format!(
                "The clean PNG expands beyond ShareGate's {} MB saved-image limit.",
                MAX_SAVED_IMAGE_BYTES / 1024 / 1024
            ));
        }

        let original_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image.png");
        let (default_name, extension) = if has_visual_review {
            (redacted_image_name(original_name), "png")
        } else {
            let extension = match source_inspection.format {
                ImageFormat::Jpeg => "jpg",
                ImageFormat::Png => "png",
            };
            (cleaned_image_name(original_name), extension)
        };
        let output = rfd::FileDialog::new()
            .add_filter("ShareGate clean image", &[extension])
            .set_file_name(&default_name)
            .save_file();
        let Some(output) = output else {
            return Ok(None);
        };
        if same_path(&source, &output) {
            return Err("ShareGate never overwrites the original image. Choose a different filename for the clean copy.".to_owned());
        }

        std::fs::write(&output, &cleaned_bytes)
            .map_err(|error| format!("Could not save the clean image copy: {error}"))?;
        let saved_bytes = read_image_with_limit(&output, MAX_SAVED_IMAGE_BYTES)?;
        if saved_bytes != cleaned_bytes {
            return Err("The saved image bytes do not match the verified local output.".to_owned());
        }
        let saved_inspection = inspect_image(&saved_bytes, MAX_SAVED_IMAGE_BYTES)
            .map_err(format_core_error)?;
        let metadata_remaining = saved_inspection.findings.len();
        let removed_metadata_findings = source_inspection
            .findings
            .len()
            .saturating_sub(metadata_remaining);
        let ocr_after = inspect_visible_text(&saved_bytes);
        let (ocr_checked, visual_findings_remaining) = match &ocr_after.report {
            Some(report) if ocr_after.availability == OcrAvailability::Available => {
                (true, report.findings.len())
            }
            _ => (false, 0),
        };

        let status = if metadata_remaining > 0 || !ocr_checked {
            VerificationStatus::NeedsReview
        } else if exceptions > 0 {
            VerificationStatus::CleanedWithExceptions
        } else if visual_findings_remaining > 0 {
            VerificationStatus::NeedsReview
        } else {
            VerificationStatus::Verified
        };
        let message = match status {
            VerificationStatus::Verified if redacted_findings > 0 => format!(
                "Redacted {redacted_findings} visible-text risk(s), removed privacy metadata, and rechecked the saved PNG with Windows OCR."
            ),
            VerificationStatus::Verified => {
                "Privacy metadata removed; the saved copy passed a second metadata and Windows OCR check."
                    .to_owned()
            }
            VerificationStatus::CleanedWithExceptions => format!(
                "Saved with {exceptions} visible-text exception(s). The receipt does not claim this copy is fully clean."
            ),
            VerificationStatus::NeedsReview if metadata_remaining > 0 => {
                "The saved copy still contains removable privacy metadata.".to_owned()
            }
            VerificationStatus::NeedsReview if !ocr_checked => ocr_after.message.clone(),
            VerificationStatus::NeedsReview => format!(
                "Windows OCR still found {visual_findings_remaining} supported sensitive-text risk(s) in the saved copy."
            ),
        };

        let filename = output
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&default_name)
            .to_owned();
        Ok(Some(CleanedImageFile {
            saved_path: output.to_string_lossy().into_owned(),
            filename,
            preview_data_url: data_url(extension, &saved_bytes),
            original_bytes,
            cleaned_size: saved_bytes.len(),
            removed_metadata_findings,
            redacted_findings,
            redacted_regions,
            exceptions,
            verification: CleanedImageVerification {
                status,
                metadata_remaining,
                visual_findings_remaining,
                ocr_checked,
                pixels_unchanged,
                message,
            },
        }))
    })
    .await
    .map_err(|error| format!("The image cleaner could not be started: {error}"))?
}

fn load_image_session(path: &Path) -> Result<ImageSession, String> {
    let bytes = read_image(path)?;
    let inspection = inspect_image(&bytes, DEFAULT_MAX_IMAGE_BYTES).map_err(format_core_error)?;
    let ocr = inspect_visible_text(&bytes);
    let extension = match inspection.format {
        ImageFormat::Jpeg => "jpg",
        ImageFormat::Png => "png",
    };
    Ok(ImageSession {
        source_path: path.to_string_lossy().into_owned(),
        source_fingerprint: fingerprint(&bytes),
        filename: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image")
            .to_owned(),
        preview_data_url: data_url(extension, &bytes),
        inspection,
        ocr,
    })
}

fn read_image(path: &Path) -> Result<Vec<u8>, String> {
    read_image_with_limit(path, DEFAULT_MAX_IMAGE_BYTES)
}

fn read_image_with_limit(path: &Path, max_bytes: usize) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path)
        .map_err(|error| format!("Could not read the selected image: {error}"))?;
    let mut bytes = Vec::new();
    file.take(max_bytes as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read the selected image: {error}"))?;
    if bytes.len() > max_bytes {
        return Err(format!(
            "This image is larger than ShareGate's {} MB local safety limit.",
            max_bytes / 1024 / 1024
        ));
    }
    Ok(bytes)
}

fn inspect_visible_text(bytes: &[u8]) -> ImageOcrInspection {
    match windows_ocr::recognize(bytes) {
        Ok(recognized) => match map_ocr_findings(
            &recognized.words,
            recognized.language,
            ScanOptions::default(),
        ) {
            Ok(report) => ImageOcrInspection {
                availability: OcrAvailability::Available,
                message: if report.findings.is_empty() {
                    format!(
                        "Windows OCR checked {} visible word(s) and found no supported sensitive-text matches.",
                        report.words_detected
                    )
                } else {
                    format!(
                        "Windows OCR found {} supported sensitive-text risk(s) for review.",
                        report.findings.len()
                    )
                },
                report: Some(report),
            },
            Err(error) => ImageOcrInspection {
                availability: OcrAvailability::NeedsReview,
                report: None,
                message: format!(
                    "Visible text needs review because the local rules could not run: {error}"
                ),
            },
        },
        Err(windows_ocr::OcrAdapterError::Unavailable(message)) => ImageOcrInspection {
            availability: OcrAvailability::Unavailable,
            report: None,
            message,
        },
        Err(windows_ocr::OcrAdapterError::NeedsReview(message)) => ImageOcrInspection {
            availability: OcrAvailability::NeedsReview,
            report: None,
            message,
        },
    }
}

fn data_url(extension: &str, bytes: &[u8]) -> String {
    let mime = if extension == "png" {
        "image/png"
    } else {
        "image/jpeg"
    };
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}

fn cleaned_image_name(filename: &str) -> String {
    match filename.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => format!("{stem}.cleaned.{extension}"),
        _ => format!("{filename}.cleaned.png"),
    }
}

fn redacted_image_name(filename: &str) -> String {
    match filename.rsplit_once('.') {
        Some((stem, _)) if !stem.is_empty() => format!("{stem}.redacted.png"),
        _ => format!("{filename}.redacted.png"),
    }
}

fn same_path(source: &Path, output: &Path) -> bool {
    let source = source
        .canonicalize()
        .unwrap_or_else(|_| source.to_path_buf());
    let output = output.canonicalize().unwrap_or_else(|_| {
        output
            .parent()
            .and_then(|parent| parent.canonicalize().ok())
            .and_then(|parent| output.file_name().map(|name| parent.join(name)))
            .unwrap_or_else(|| output.to_path_buf())
    });
    source
        .to_string_lossy()
        .eq_ignore_ascii_case(&output.to_string_lossy())
}

fn format_core_error(error: ShareGateError) -> String {
    error.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_text,
            sanitize_text,
            save_cleaned_text,
            pick_image,
            clean_image_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running ShareGate");
}
