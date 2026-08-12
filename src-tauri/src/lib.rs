use std::{
    io::Read,
    path::{Path, PathBuf},
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Serialize;
use sharegate_core::{
    DEFAULT_MAX_IMAGE_BYTES, ImageFormat, ImageInspection, ImageVerification, SanitizeRequest,
    SanitizeResult, ScanOptions, ScanReport, ShareGateError, inspect_image, sanitize,
    sanitize_image, scan,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageSession {
    source_path: String,
    filename: String,
    preview_data_url: String,
    inspection: ImageInspection,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CleanedImageFile {
    saved_path: String,
    filename: String,
    preview_data_url: String,
    original_bytes: usize,
    cleaned_size: usize,
    removed_findings: usize,
    verification: ImageVerification,
}

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
async fn clean_image_file(source_path: String) -> Result<Option<CleanedImageFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = PathBuf::from(source_path);
        let input = read_image(&source)?;
        let source_inspection =
            inspect_image(&input, DEFAULT_MAX_IMAGE_BYTES).map_err(format_core_error)?;
        let result = sanitize_image(&input, DEFAULT_MAX_IMAGE_BYTES).map_err(format_core_error)?;
        if !result.verification.verified {
            return Err(result.verification.message);
        }

        let original_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image.png");
        let default_name = cleaned_image_name(original_name);
        let extension = match source_inspection.format {
            ImageFormat::Jpeg => "jpg",
            ImageFormat::Png => "png",
        };
        let output = rfd::FileDialog::new()
            .add_filter("Clean image", &[extension])
            .set_file_name(&default_name)
            .save_file();
        let Some(output) = output else {
            return Ok(None);
        };
        if same_path(&source, &output) {
            return Err("ShareGate never overwrites the original image. Choose a different filename for the clean copy.".to_owned());
        }

        std::fs::write(&output, &result.cleaned_bytes)
            .map_err(|error| format!("Could not save the clean image copy: {error}"))?;
        let saved_bytes = read_image(&output)?;
        let saved_inspection = inspect_image(&saved_bytes, DEFAULT_MAX_IMAGE_BYTES)
            .map_err(format_core_error)?;
        if !saved_inspection.findings.is_empty()
            || saved_inspection.pixel_fingerprint != source_inspection.pixel_fingerprint
        {
            return Err("The saved image did not pass ShareGate's metadata and pixel verification.".to_owned());
        }

        let filename = output
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&default_name)
            .to_owned();
        Ok(Some(CleanedImageFile {
            saved_path: output.to_string_lossy().into_owned(),
            filename,
            preview_data_url: data_url(extension, &saved_bytes),
            original_bytes: result.original_bytes,
            cleaned_size: result.cleaned_size,
            removed_findings: result.removed_findings,
            verification: result.verification,
        }))
    })
    .await
    .map_err(|error| format!("The image cleaner could not be started: {error}"))?
}

fn load_image_session(path: &Path) -> Result<ImageSession, String> {
    let bytes = read_image(path)?;
    let inspection = inspect_image(&bytes, DEFAULT_MAX_IMAGE_BYTES).map_err(format_core_error)?;
    let extension = match inspection.format {
        ImageFormat::Jpeg => "jpg",
        ImageFormat::Png => "png",
    };
    Ok(ImageSession {
        source_path: path.to_string_lossy().into_owned(),
        filename: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image")
            .to_owned(),
        preview_data_url: data_url(extension, &bytes),
        inspection,
    })
}

fn read_image(path: &Path) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path)
        .map_err(|error| format!("Could not read the selected image: {error}"))?;
    let mut bytes = Vec::new();
    file.take(DEFAULT_MAX_IMAGE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read the selected image: {error}"))?;
    if bytes.len() > DEFAULT_MAX_IMAGE_BYTES {
        return Err(format!(
            "This image is larger than ShareGate's {} MB local safety limit.",
            DEFAULT_MAX_IMAGE_BYTES / 1024 / 1024
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

fn cleaned_image_name(filename: &str) -> String {
    match filename.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => format!("{stem}.cleaned.{extension}"),
        _ => format!("{filename}.cleaned.png"),
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
