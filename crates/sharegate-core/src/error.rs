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
}
