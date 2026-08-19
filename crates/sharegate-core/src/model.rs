use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScanOptions {
    #[serde(default = "default_max_bytes")]
    pub max_bytes: usize,
    #[serde(default)]
    pub custom_terms: Vec<String>,
}

const fn default_max_bytes() -> usize {
    10 * 1024 * 1024
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            max_bytes: default_max_bytes(),
            custom_terms: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

impl Severity {
    pub(crate) const fn rank(self) -> u8 {
        match self {
            Self::Low => 1,
            Self::Medium => 2,
            Self::High => 3,
            Self::Critical => 4,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    Credential,
    Personal,
    Network,
    LocalContext,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: String,
    pub rule_id: String,
    pub label: String,
    pub explanation: String,
    pub category: Category,
    pub severity: Severity,
    pub start: usize,
    pub end: usize,
    pub masked_value: String,
    pub context: String,
    pub replacement: String,
    pub match_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScanStats {
    pub bytes: usize,
    pub rules_run: usize,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub content_fingerprint: String,
    pub findings: Vec<Finding>,
    pub stats: ScanStats,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FindingDecision {
    pub id: String,
    pub enabled: bool,
    pub replacement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SanitizeRequest {
    pub original_text: String,
    pub content_fingerprint: String,
    pub findings: Vec<Finding>,
    pub decisions: Vec<FindingDecision>,
    #[serde(default)]
    pub options: ScanOptions,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum VerificationStatus {
    Verified,
    NeedsReview,
    CleanedWithExceptions,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VerificationReport {
    pub status: VerificationStatus,
    pub remaining_findings: Vec<Finding>,
    pub exceptions: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SanitizeResult {
    pub cleaned_text: String,
    pub verification: VerificationReport,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ImageFormat {
    Jpeg,
    Png,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ImageMetadataCategory {
    Location,
    Device,
    Identity,
    Time,
    Description,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageMetadataFinding {
    pub id: String,
    pub label: String,
    pub explanation: String,
    pub category: ImageMetadataCategory,
    pub severity: Severity,
    pub masked_value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageInspection {
    pub format: ImageFormat,
    pub bytes: usize,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub findings: Vec<ImageMetadataFinding>,
    pub can_clean_losslessly: bool,
    pub warnings: Vec<String>,
    pub pixel_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageVerification {
    pub verified: bool,
    pub remaining_findings: usize,
    pub pixels_unchanged: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageSanitizeResult {
    #[serde(skip_serializing, skip_deserializing)]
    pub cleaned_bytes: Vec<u8>,
    pub original_bytes: usize,
    pub cleaned_size: usize,
    pub removed_findings: usize,
    pub verification: ImageVerification,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OcrWord {
    pub text: String,
    pub rect: ImageRect,
    pub line_index: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OcrConfidence {
    NotProvided,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageTextFinding {
    pub id: String,
    pub rule_id: String,
    pub label: String,
    pub explanation: String,
    pub category: Category,
    pub severity: Severity,
    pub masked_value: String,
    pub rectangles: Vec<ImageRect>,
    pub confidence: OcrConfidence,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OcrScanReport {
    pub findings: Vec<ImageTextFinding>,
    pub words_detected: usize,
    pub language: Option<String>,
    pub confidence: OcrConfidence,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OcrAvailability {
    Available,
    Unavailable,
    NeedsReview,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageOcrInspection {
    pub availability: OcrAvailability,
    pub report: Option<OcrScanReport>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageRedactionDecision {
    pub id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageRedactionTarget {
    pub id: String,
    pub rectangles: Vec<ImageRect>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QrKind {
    WebLink,
    WifiCredential,
    ContactCard,
    CommunicationLink,
    EncodedContent,
    Undecodable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QrFinding {
    pub id: String,
    pub kind: QrKind,
    pub label: String,
    pub explanation: String,
    pub severity: Severity,
    pub masked_value: String,
    pub rectangle: ImageRect,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QrScanReport {
    pub findings: Vec<QrFinding>,
    pub grids_detected: usize,
    pub decoded_grids: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QrAvailability {
    Available,
    NeedsReview,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageQrInspection {
    pub availability: QrAvailability,
    pub report: Option<QrScanReport>,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum BarcodeKind {
    Code39,
    Code93,
    Code128,
    Codabar,
    Ean8,
    Ean13,
    Itf,
    UpcA,
    UpcE,
    Rss14,
    RssExpanded,
    Telepen,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BarcodeFinding {
    pub id: String,
    pub kind: BarcodeKind,
    pub label: String,
    pub explanation: String,
    pub severity: Severity,
    pub masked_value: String,
    pub encoded_length: usize,
    pub rectangle: ImageRect,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BarcodeScanReport {
    pub findings: Vec<BarcodeFinding>,
    pub symbols_detected: usize,
    pub decoded_symbols: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BarcodeAvailability {
    Available,
    NeedsReview,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageBarcodeInspection {
    pub availability: BarcodeAvailability,
    pub report: Option<BarcodeScanReport>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FaceFinding {
    pub id: String,
    pub label: String,
    pub explanation: String,
    pub severity: Severity,
    pub rectangle: ImageRect,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FaceAvailability {
    Available,
    Unavailable,
    NeedsReview,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageFaceInspection {
    pub availability: FaceAvailability,
    pub findings: Vec<FaceFinding>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageRedactionResult {
    #[serde(skip_serializing, skip_deserializing)]
    pub cleaned_bytes: Vec<u8>,
    pub original_bytes: usize,
    pub cleaned_size: usize,
    pub redacted_findings: usize,
    pub redacted_regions: usize,
    pub exceptions: usize,
}
