use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "code", content = "message", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ShareGateError {
    #[error("The content is larger than the {0} byte local safety limit.")]
    ContentTooLarge(usize),
    #[error("The source changed after it was scanned. Scan it again before cleaning.")]
    StaleContent,
    #[error("Finding {0} no longer matches the scanned content.")]
    StaleFinding(String),
    #[error("Selected findings overlap and cannot be cleaned safely.")]
    OverlappingFindings,
    #[error("A replacement contains an unsupported control character.")]
    InvalidReplacement,
    #[error("This image format is not supported yet. Choose a JPEG or PNG image.")]
    UnsupportedImage,
    #[error("The image could not be read safely: {0}")]
    InvalidImage(String),
    #[error(
        "This image relies on EXIF orientation {0}. Normalize its orientation before removing metadata so the clean copy does not appear rotated or mirrored."
    )]
    OrientationNeedsNormalization(u32),
    #[error("The PDF could not be processed safely: {0}")]
    InvalidPdf(String),
}
