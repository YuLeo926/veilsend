use sharegate_core::{
    SanitizeRequest, SanitizeResult, ScanOptions, ScanReport, ShareGateError, sanitize, scan,
};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_text,
            sanitize_text,
            save_cleaned_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running ShareGate");
}
