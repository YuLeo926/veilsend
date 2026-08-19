const MAX_CLIPBOARD_IMAGE_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug)]
pub enum ClipboardAdapterError {
    Unavailable(String),
    InvalidContent(String),
}

impl ClipboardAdapterError {
    pub fn into_message(self) -> String {
        match self {
            Self::Unavailable(message) | Self::InvalidContent(message) => message,
        }
    }
}

#[cfg(target_os = "windows")]
pub fn read_png() -> Result<Vec<u8>, ClipboardAdapterError> {
    use windows::{
        ApplicationModel::DataTransfer::{Clipboard, StandardDataFormats},
        Graphics::Imaging::{BitmapDecoder, BitmapEncoder},
        Storage::Streams::{DataReader, InMemoryRandomAccessStream},
    };

    let unavailable = || {
        ClipboardAdapterError::Unavailable(
            "ShareGate could not read the clipboard. Keep the app focused and try pasting again."
                .to_owned(),
        )
    };
    let invalid = || {
        ClipboardAdapterError::InvalidContent(
            "The clipboard bitmap could not be decoded safely. Copy the screenshot again and retry."
                .to_owned(),
        )
    };

    let content = Clipboard::GetContent().map_err(|_| unavailable())?;
    let bitmap_format = StandardDataFormats::Bitmap().map_err(|_| unavailable())?;
    if !content
        .Contains(&bitmap_format)
        .map_err(|_| unavailable())?
    {
        return Err(ClipboardAdapterError::InvalidContent(
            "The clipboard does not currently contain a screenshot or bitmap.".to_owned(),
        ));
    }

    let reference = content
        .GetBitmapAsync()
        .map_err(|_| invalid())?
        .join()
        .map_err(|_| invalid())?;
    let input = reference
        .OpenReadAsync()
        .map_err(|_| invalid())?
        .join()
        .map_err(|_| invalid())?;
    validate_stream_size(input.Size().map_err(|_| invalid())?)?;

    let decoder = BitmapDecoder::CreateAsync(&input)
        .map_err(|_| invalid())?
        .join()
        .map_err(|_| invalid())?;
    let width = decoder.PixelWidth().map_err(|_| invalid())?;
    let height = decoder.PixelHeight().map_err(|_| invalid())?;
    if u64::from(width).saturating_mul(u64::from(height)) > 40_000_000 {
        return Err(ClipboardAdapterError::InvalidContent(
            "The pasted screenshot expands beyond ShareGate's 40-million-pixel safety limit."
                .to_owned(),
        ));
    }
    let bitmap = decoder
        .GetSoftwareBitmapAsync()
        .map_err(|_| invalid())?
        .join()
        .map_err(|_| invalid())?;

    let output = InMemoryRandomAccessStream::new().map_err(|_| invalid())?;
    let encoder = BitmapEncoder::CreateAsync(
        BitmapEncoder::PngEncoderId().map_err(|_| invalid())?,
        &output,
    )
    .map_err(|_| invalid())?
    .join()
    .map_err(|_| invalid())?;
    encoder.SetSoftwareBitmap(&bitmap).map_err(|_| invalid())?;
    encoder
        .FlushAsync()
        .map_err(|_| invalid())?
        .join()
        .map_err(|_| invalid())?;

    let output_size = output.Size().map_err(|_| invalid())?;
    validate_stream_size(output_size)?;
    let input_stream = output.GetInputStreamAt(0).map_err(|_| invalid())?;
    let reader = DataReader::CreateDataReader(&input_stream).map_err(|_| invalid())?;
    let expected = output_size as u32;
    let loaded = reader
        .LoadAsync(expected)
        .map_err(|_| invalid())?
        .join()
        .map_err(|_| invalid())?;
    if loaded != expected {
        return Err(invalid());
    }
    let mut bytes = vec![0; expected as usize];
    reader.ReadBytes(&mut bytes).map_err(|_| invalid())?;
    validate_png(&bytes)?;
    Ok(bytes)
}

#[cfg(not(target_os = "windows"))]
pub fn read_png() -> Result<Vec<u8>, ClipboardAdapterError> {
    Err(ClipboardAdapterError::Unavailable(
        "Direct screenshot paste is currently available on Windows.".to_owned(),
    ))
}

fn validate_stream_size(size: u64) -> Result<(), ClipboardAdapterError> {
    if size == 0 {
        return Err(ClipboardAdapterError::InvalidContent(
            "The clipboard bitmap was empty.".to_owned(),
        ));
    }
    if size > MAX_CLIPBOARD_IMAGE_BYTES as u64 {
        return Err(ClipboardAdapterError::InvalidContent(format!(
            "The pasted screenshot is larger than ShareGate's {} MB local safety limit.",
            MAX_CLIPBOARD_IMAGE_BYTES / 1024 / 1024
        )));
    }
    Ok(())
}

fn validate_png(bytes: &[u8]) -> Result<(), ClipboardAdapterError> {
    const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    validate_stream_size(bytes.len() as u64)?;
    if !bytes.starts_with(PNG_SIGNATURE) {
        return Err(ClipboardAdapterError::InvalidContent(
            "The clipboard bitmap could not be normalized as a PNG.".to_owned(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_stream_size_without_reading_clipboard_state() {
        assert!(validate_stream_size(1).is_ok());
        assert!(validate_stream_size(0).is_err());
        assert!(validate_stream_size(MAX_CLIPBOARD_IMAGE_BYTES as u64 + 1).is_err());
    }

    #[test]
    fn requires_a_normalized_png_signature() {
        assert!(validate_png(b"\x89PNG\r\n\x1a\nbody").is_ok());
        assert!(validate_png(b"BMnot-a-png").is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "requires a bitmap already present in the interactive Windows clipboard"]
    fn reads_the_existing_clipboard_without_mutating_it() {
        let png = read_png().expect("place a bitmap in the clipboard before running this test");
        validate_png(&png).unwrap();
    }
}
