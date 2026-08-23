use veilsend_core::{ImageRect, OcrWord};

#[derive(Debug)]
pub struct RecognizedImage {
    pub words: Vec<OcrWord>,
    pub language: Option<String>,
}

#[derive(Debug)]
pub enum OcrAdapterError {
    Unavailable(String),
    NeedsReview(String),
}

#[cfg(target_os = "windows")]
pub fn recognize(input: &[u8]) -> Result<RecognizedImage, OcrAdapterError> {
    use windows::{
        Graphics::Imaging::BitmapDecoder,
        Media::Ocr::OcrEngine,
        Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
    };

    let operation = || -> windows::core::Result<RecognizedImage> {
        let stream = InMemoryRandomAccessStream::new()?;
        let writer = DataWriter::CreateDataWriter(&stream)?;
        writer.WriteBytes(input)?;
        writer.StoreAsync()?.join()?;
        writer.DetachStream()?;
        stream.Seek(0)?;

        let decoder = BitmapDecoder::CreateAsync(&stream)?.join()?;
        let max_dimension = OcrEngine::MaxImageDimension()?;
        let width = decoder.PixelWidth()?;
        let height = decoder.PixelHeight()?;
        if width > max_dimension || height > max_dimension {
            return Err(windows::core::Error::new(
                windows::core::HRESULT(0x80070057u32 as i32),
                format!(
                    "This image is {width} x {height} pixels, beyond Windows OCR's {max_dimension}-pixel dimension limit."
                ),
            ));
        }

        let bitmap = decoder.GetSoftwareBitmapAsync()?.join()?;
        let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;
        let language = engine
            .RecognizerLanguage()
            .ok()
            .and_then(|language| language.LanguageTag().ok())
            .map(|tag| tag.to_string_lossy());
        let result = engine.RecognizeAsync(&bitmap)?.join()?;

        if let Ok(angle) = result.TextAngle().and_then(|value| value.Value())
            && angle.abs() > 0.1
        {
            return Err(windows::core::Error::new(
                windows::core::HRESULT(0x80070057u32 as i32),
                format!(
                    "Windows OCR detected text rotated by {angle:.1} degrees. Rotate the image upright before redaction so every region stays aligned."
                ),
            ));
        }

        let lines = result.Lines()?;
        let mut words = Vec::new();
        for line_index in 0..lines.Size()? {
            let line = lines.GetAt(line_index)?;
            let line_words = line.Words()?;
            for word_index in 0..line_words.Size()? {
                let word = line_words.GetAt(word_index)?;
                let text = word.Text()?.to_string_lossy();
                let rect = image_rect(word.BoundingRect()?);
                if !text.trim().is_empty() && rect.width > 0 && rect.height > 0 {
                    words.push(OcrWord {
                        text,
                        rect,
                        line_index: line_index as usize,
                    });
                }
            }
        }

        Ok(RecognizedImage { words, language })
    };

    operation().map_err(|error| {
        let message = error.message();
        if message.contains("rotated by") || message.contains("dimension limit") {
            OcrAdapterError::NeedsReview(message)
        } else {
            OcrAdapterError::Unavailable(format!(
                "Windows OCR is unavailable for this image: {message}"
            ))
        }
    })
}

#[cfg(target_os = "windows")]
fn image_rect(rect: windows::Foundation::Rect) -> ImageRect {
    let x = rect.X.max(0.0).floor() as u32;
    let y = rect.Y.max(0.0).floor() as u32;
    let right = (rect.X + rect.Width).max(0.0).ceil() as u32;
    let bottom = (rect.Y + rect.Height).max(0.0).ceil() as u32;
    ImageRect {
        x,
        y,
        width: right.saturating_sub(x),
        height: bottom.saturating_sub(y),
    }
}

#[cfg(not(target_os = "windows"))]
pub fn recognize(_input: &[u8]) -> Result<RecognizedImage, OcrAdapterError> {
    Err(OcrAdapterError::Unavailable(
        "Local visible-text detection is currently available on Windows. Metadata inspection still works on this platform."
            .to_owned(),
    ))
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires the Windows OCR language pack installed on the test machine"]
    fn recognizes_the_synthetic_acceptance_fixture() {
        let result = recognize(include_bytes!("../../fixtures/ocr-sensitive-sample.png"))
            .expect("Windows OCR should be available for the acceptance fixture");
        let report = veilsend_core::map_ocr_findings(
            &result.words,
            result.language,
            veilsend_core::ScanOptions::default(),
        )
        .unwrap();
        let rule_ids = report
            .findings
            .iter()
            .map(|finding| finding.rule_id.as_str())
            .collect::<Vec<_>>();
        assert!(rule_ids.contains(&"personal.email"));
        assert!(rule_ids.contains(&"network.private-ipv4"));
        assert!(rule_ids.contains(&"credential.assigned-secret"));
    }
}
