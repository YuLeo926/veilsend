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
