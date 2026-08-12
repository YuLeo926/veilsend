mod error;
mod model;
mod rules;
mod sanitize;

use std::time::Instant;

use sha2::{Digest, Sha256};

pub use error::ShareGateError;
pub use model::*;
pub use sanitize::sanitize;

pub fn scan(text: &str, options: ScanOptions) -> Result<ScanReport, ShareGateError> {
    if text.len() > options.max_bytes {
        return Err(ShareGateError::ContentTooLarge(options.max_bytes));
    }

    let started = Instant::now();
    let candidates = rules::detect(text, &options);
    let findings = candidates
        .into_iter()
        .enumerate()
        .map(|(index, candidate)| {
            let value = &text[candidate.start..candidate.end];
            Finding {
                id: format!("finding-{index}-{}", &fingerprint(value.as_bytes())[..8]),
                rule_id: candidate.rule_id.to_owned(),
                label: candidate.label.to_owned(),
                explanation: candidate.explanation.to_owned(),
                category: candidate.category,
                severity: candidate.severity,
                start: candidate.start,
                end: candidate.end,
                masked_value: mask(value),
                context: masked_context(text, candidate.start, candidate.end),
                replacement: candidate.replacement.to_owned(),
                match_fingerprint: fingerprint(value.as_bytes()),
            }
        })
        .collect();

    Ok(ScanReport {
        content_fingerprint: fingerprint(text.as_bytes()),
        findings,
        stats: ScanStats {
            bytes: text.len(),
            rules_run: rules::rules_run(&options),
            duration_ms: started.elapsed().as_millis(),
        },
        warnings: Vec::new(),
    })
}

pub(crate) fn fingerprint(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn mask(value: &str) -> String {
    let characters: Vec<char> = value.chars().collect();
    match characters.len() {
        0 => String::new(),
        1..=4 => "•".repeat(characters.len()),
        length => format!(
            "{}{}{}",
            characters[..2].iter().collect::<String>(),
            "•".repeat(length.saturating_sub(4).min(12)),
            characters[length - 2..].iter().collect::<String>()
        ),
    }
}

fn masked_context(text: &str, start: usize, end: usize) -> String {
    let before = &text[..start];
    let after = &text[end..];
    let prefix: String = before
        .chars()
        .rev()
        .take(28)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let suffix: String = after.chars().take(28).collect();
    format!("{prefix}{}{suffix}", mask(&text[start..end]))
        .replace('\n', " ↵ ")
        .replace('\r', "")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> ScanOptions {
        ScanOptions {
            max_bytes: 10 * 1024 * 1024,
            custom_terms: vec!["Project Firefly".to_owned()],
        }
    }

    #[test]
    fn scans_supported_sensitive_values_without_returning_raw_preview() {
        let text = "contact=alex@example.com\napi_key=sg_FAKE_KEY_1234567890\nhost=192.168.1.24\nfile=C:\\Users\\alex\\project\\debug.log\nProject Firefly";
        let report = scan(text, options()).unwrap();

        assert!(
            report
                .findings
                .iter()
                .any(|item| item.rule_id == "personal.email")
        );
        assert!(
            report
                .findings
                .iter()
                .any(|item| item.rule_id == "credential.assigned-secret")
        );
        assert!(
            report
                .findings
                .iter()
                .any(|item| item.rule_id == "network.private-ipv4")
        );
        assert!(
            report
                .findings
                .iter()
                .any(|item| item.rule_id == "local.windows-path")
        );
        assert!(
            report
                .findings
                .iter()
                .any(|item| item.rule_id == "custom.sensitive-term")
        );
        assert!(
            report
                .findings
                .iter()
                .all(|item| !item.masked_value.contains("example.com"))
        );
    }

    #[test]
    fn does_not_mark_public_ip_as_private() {
        let report = scan("resolver=8.8.8.8", ScanOptions::default()).unwrap();
        assert!(
            report
                .findings
                .iter()
                .all(|item| item.rule_id != "network.private-ipv4")
        );
    }

    #[test]
    fn does_not_mistake_iso_timestamp_for_phone_number() {
        let report = scan(
            "[2026-08-12 09:41:22] service started",
            ScanOptions::default(),
        )
        .unwrap();
        assert!(
            report
                .findings
                .iter()
                .all(|item| item.rule_id != "personal.phone")
        );
    }

    #[test]
    fn sanitizes_utf8_from_the_end_and_verifies_output() {
        let original = "客户 alice@example.com 的密码 password=not-a-real-secret";
        let report = scan(original, ScanOptions::default()).unwrap();
        let decisions = report
            .findings
            .iter()
            .map(|finding| FindingDecision {
                id: finding.id.clone(),
                enabled: true,
                replacement: finding.replacement.clone(),
            })
            .collect();

        let result = sanitize(SanitizeRequest {
            original_text: original.to_owned(),
            content_fingerprint: report.content_fingerprint,
            findings: report.findings,
            decisions,
            options: ScanOptions::default(),
        })
        .unwrap();

        assert!(!result.cleaned_text.contains("alice@example.com"));
        assert!(!result.cleaned_text.contains("not-a-real-secret"));
        assert_eq!(result.verification.status, VerificationStatus::Verified);
    }

    #[test]
    fn reports_user_exceptions() {
        let original = "email=alice@example.com";
        let report = scan(original, ScanOptions::default()).unwrap();
        let decisions = report
            .findings
            .iter()
            .map(|finding| FindingDecision {
                id: finding.id.clone(),
                enabled: false,
                replacement: finding.replacement.clone(),
            })
            .collect();
        let result = sanitize(SanitizeRequest {
            original_text: original.to_owned(),
            content_fingerprint: report.content_fingerprint,
            findings: report.findings,
            decisions,
            options: ScanOptions::default(),
        })
        .unwrap();

        assert_eq!(
            result.verification.status,
            VerificationStatus::CleanedWithExceptions
        );
        assert_eq!(result.verification.exceptions, 1);
    }

    #[test]
    fn rejects_content_changed_after_scan() {
        let report = scan("alice@example.com", ScanOptions::default()).unwrap();
        let error = sanitize(SanitizeRequest {
            original_text: "changed@example.com".to_owned(),
            content_fingerprint: report.content_fingerprint,
            findings: report.findings,
            decisions: Vec::new(),
            options: ScanOptions::default(),
        })
        .unwrap_err();
        assert!(matches!(error, ShareGateError::StaleContent));
    }
}
