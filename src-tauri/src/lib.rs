use std::{
    io::{Cursor, Read},
    path::Path,
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Serialize;
use sharegate_core::{
    DEFAULT_MAX_IMAGE_BYTES, ImageBarcodeInspection, ImageFaceInspection, ImageFormat,
    ImageInspection, ImageOcrInspection, ImageQrInspection, ImageRedactionDecision,
    ImageRedactionTarget, SanitizeRequest, SanitizeResult, ScanOptions, ScanReport, ShareGateError,
    VerificationStatus, fingerprint, inspect_image, redact_image, sanitize, sanitize_image, scan,
};

mod image_pipeline;
mod image_sessions;
mod windows_clipboard;
mod windows_faces;
mod windows_ocr;

use image_pipeline::{
    DetectorKind, ReviewedVisualFinding, ReviewedVisualSnapshot, classify_saved_output,
    inspect_visual, resolve_decisions,
};
use image_sessions::{ImageSessionStore, ImageSessionSummary, ImageSourceKind};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageSession {
    session_id: String,
    source_kind: ImageSourceKind,
    filename: String,
    preview_data_url: String,
    inspection: ImageInspection,
    ocr: ImageOcrInspection,
    faces: ImageFaceInspection,
    qr: ImageQrInspection,
    barcodes: ImageBarcodeInspection,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CleanedImageVerification {
    status: VerificationStatus,
    metadata_remaining: usize,
    visual_findings_remaining: usize,
    ocr_checked: bool,
    qr_codes_remaining: usize,
    qr_checked: bool,
    faces_remaining: usize,
    face_checked: bool,
    barcodes_remaining: usize,
    barcode_checked: bool,
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
    redacted_text_findings: usize,
    redacted_qr_findings: usize,
    redacted_face_findings: usize,
    redacted_barcode_findings: usize,
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
async fn pick_image(
    state: tauri::State<'_, ImageSessionStore>,
) -> Result<Option<ImageSession>, String> {
    let path = tauri::async_runtime::spawn_blocking(move || {
        let path = rfd::FileDialog::new()
            .add_filter("JPEG and PNG images", &["jpg", "jpeg", "png"])
            .pick_file();
        Ok::<_, String>(path)
    })
    .await
    .map_err(|error| format!("The image picker could not be opened: {error}"))??;
    let Some(path) = path else {
        return Ok(None);
    };
    let summary = state.replace_file(&path)?;
    let resolved = state.resolve(&summary.id)?;
    let (session, reviewed) = build_image_session(summary, &resolved.bytes)?;
    state.set_reviewed(&session.session_id, reviewed)?;
    Ok(Some(session))
}

#[tauri::command]
async fn paste_image(
    app: tauri::AppHandle,
    state: tauri::State<'_, ImageSessionStore>,
) -> Result<ImageSession, String> {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let result = windows_clipboard::begin_read().map_err(|error| error.into_message());
        let _ = sender.send(result);
    })
    .map_err(|error| format!("The clipboard check could not be started: {error}"))?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let operation = receiver
            .recv()
            .map_err(|_| "The clipboard check ended before returning an image.".to_owned())??;
        windows_clipboard::complete_read(operation).map_err(|error| error.into_message())
    })
    .await
    .map_err(|error| format!("The clipboard check could not finish: {error}"))??;
    let summary = state.replace_clipboard(bytes)?;
    let resolved = state.resolve(&summary.id)?;
    let (session, reviewed) = build_image_session(summary, &resolved.bytes)?;
    state.set_reviewed(&session.session_id, reviewed)?;
    Ok(session)
}

#[tauri::command]
fn clear_image_session(state: tauri::State<'_, ImageSessionStore>) -> Result<(), String> {
    state.clear()
}

#[tauri::command]
async fn clean_image_file(
    session_id: String,
    decisions: Vec<ImageRedactionDecision>,
    state: tauri::State<'_, ImageSessionStore>,
) -> Result<Option<CleanedImageFile>, String> {
    let resolved = state.resolve(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let reviewed = resolved.reviewed.ok_or_else(|| {
            "This image session has no completed review. Choose or paste the image again."
                .to_owned()
        })?;
        let input = resolved.bytes;
        let source_fingerprint = resolved.fingerprint;
        let source_inspection =
            inspect_image(&input, DEFAULT_MAX_IMAGE_BYTES).map_err(format_core_error)?;
        let current = inspect_visual(&input);
        if current.checks() != reviewed.checks {
            return Err(
                "The available local image checks changed after review. Review the image again before saving."
                    .to_owned(),
            );
        }
        let resolved_visual =
            resolve_decisions(&reviewed.findings, &current.reviewed, &decisions)?;
        let targets = resolved_visual
            .iter()
            .map(|finding| ImageRedactionTarget {
                id: finding.reviewed_id.clone(),
                rectangles: finding.rectangles.clone(),
            })
            .collect::<Vec<_>>();
        let has_visual_review = !targets.is_empty();
        let selected_text_findings = resolved_visual
            .iter()
            .filter(|finding| finding.enabled && finding.kind == DetectorKind::Text)
            .count();
        let selected_face_findings = resolved_visual
            .iter()
            .filter(|finding| finding.enabled && finding.kind == DetectorKind::Face)
            .count();
        let selected_qr_findings = resolved_visual
            .iter()
            .filter(|finding| finding.enabled && finding.kind == DetectorKind::Qr)
            .count();
        let selected_barcode_findings = resolved_visual
            .iter()
            .filter(|finding| finding.enabled && finding.kind == DetectorKind::Barcode)
            .count();
        let kept = resolved_visual
            .iter()
            .filter(|finding| !finding.enabled)
            .map(|finding| ReviewedVisualFinding {
                id: finding.reviewed_id.clone(),
                kind: finding.kind,
                rectangles: finding.rectangles.clone(),
            })
            .collect::<Vec<_>>();

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
                &targets,
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

        let original_name = resolved.filename.as_str();
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
        if resolved
            .original_path
            .as_deref()
            .is_some_and(|source| same_path(source, &output))
        {
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
        let after = inspect_visual(&saved_bytes);
        let checks = after.checks();
        let count_remaining = |kind| {
            after
                .reviewed
                .iter()
                .filter(|finding| finding.kind == kind)
                .count()
        };
        let visual_findings_remaining = count_remaining(DetectorKind::Text);
        let faces_remaining = count_remaining(DetectorKind::Face);
        let qr_codes_remaining = count_remaining(DetectorKind::Qr);
        let barcodes_remaining = count_remaining(DetectorKind::Barcode);
        let status = classify_saved_output(
            metadata_remaining,
            checks,
            &after.reviewed,
            &kept,
            exceptions,
        );
        let message = match status {
            VerificationStatus::Verified if redacted_findings > 0 => format!(
                "Redacted {selected_text_findings} visible-text, {selected_face_findings} face, {selected_qr_findings} QR, and {selected_barcode_findings} barcode risk(s). The actual saved PNG passed metadata, text, face, QR, and barcode checks."
            ),
            VerificationStatus::Verified => {
                "Privacy metadata was removed. The actual saved copy passed metadata, text, face, QR, and barcode checks; detectors can still miss unusual content."
                    .to_owned()
            }
            VerificationStatus::CleanedWithExceptions => format!(
                "Saved with {exceptions} explicit visual exception(s). The actual saved file was rechecked, but this receipt does not claim those kept regions are safe."
            ),
            VerificationStatus::NeedsReview if metadata_remaining > 0 => {
                "The saved copy still contains removable privacy metadata.".to_owned()
            }
            VerificationStatus::NeedsReview if !checks.all_complete() => {
                let mut incomplete = Vec::new();
                if !checks.text {
                    incomplete.push("visible text");
                }
                if !checks.face {
                    incomplete.push("faces");
                }
                if !checks.qr {
                    incomplete.push("QR codes");
                }
                if !checks.barcode {
                    incomplete.push("one-dimensional barcodes");
                }
                format!(
                    "The saved file needs review because these local checks did not complete: {}.",
                    incomplete.join(", ")
                )
            }
            VerificationStatus::NeedsReview => format!(
                "The saved copy contains unexpected remaining findings: {visual_findings_remaining} text, {faces_remaining} face, {qr_codes_remaining} QR, and {barcodes_remaining} barcode risk(s)."
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
            redacted_text_findings: selected_text_findings,
            redacted_qr_findings: selected_qr_findings,
            redacted_face_findings: selected_face_findings,
            redacted_barcode_findings: selected_barcode_findings,
            redacted_regions,
            exceptions,
            verification: CleanedImageVerification {
                status,
                metadata_remaining,
                visual_findings_remaining,
                ocr_checked: checks.text,
                qr_codes_remaining,
                qr_checked: checks.qr,
                faces_remaining,
                face_checked: checks.face,
                barcodes_remaining,
                barcode_checked: checks.barcode,
                pixels_unchanged,
                message,
            },
        }))
    })
    .await
    .map_err(|error| format!("The image cleaner could not be started: {error}"))?
}

fn build_image_session(
    summary: ImageSessionSummary,
    bytes: &[u8],
) -> Result<(ImageSession, ReviewedVisualSnapshot), String> {
    if fingerprint(bytes) != summary.fingerprint {
        return Err("The source image changed while its review session was opening.".to_owned());
    }
    let inspection = inspect_image(bytes, DEFAULT_MAX_IMAGE_BYTES).map_err(format_core_error)?;
    let visual = inspect_visual(bytes);
    let reviewed = visual.snapshot();
    Ok((
        ImageSession {
            session_id: summary.id,
            source_kind: summary.source_kind,
            filename: summary.filename,
            preview_data_url: normalized_preview_data_url(bytes)?,
            inspection,
            ocr: visual.ocr,
            faces: visual.faces,
            qr: visual.qr,
            barcodes: visual.barcodes,
        },
        reviewed,
    ))
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

fn data_url(extension: &str, bytes: &[u8]) -> String {
    let mime = if extension == "png" {
        "image/png"
    } else {
        "image/jpeg"
    };
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}

fn normalized_preview_data_url(bytes: &[u8]) -> Result<String, String> {
    const MAX_PREVIEW_DIMENSION: u32 = 2_400;
    let decoded = image::load_from_memory(bytes)
        .map_err(|_| "The selected image could not be prepared for local review.".to_owned())?;
    let preview = decoded.thumbnail(MAX_PREVIEW_DIMENSION, MAX_PREVIEW_DIMENSION);
    let mut output = Cursor::new(Vec::new());
    preview
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|_| "The selected image preview could not be prepared safely.".to_owned())?;
    Ok(data_url("png", &output.into_inner()))
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
        .manage(ImageSessionStore::default())
        .invoke_handler(tauri::generate_handler![
            scan_text,
            sanitize_text,
            save_cleaned_text,
            pick_image,
            paste_image,
            clear_image_session,
            clean_image_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running ShareGate");
}
