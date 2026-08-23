use std::{net::Ipv4Addr, str::FromStr};

use once_cell::sync::Lazy;
use regex::{Regex, RegexBuilder};

use crate::model::{Category, ScanOptions, Severity};

#[derive(Debug, Clone)]
pub(crate) struct Candidate {
    pub rule_id: &'static str,
    pub label: &'static str,
    pub explanation: &'static str,
    pub category: Category,
    pub severity: Severity,
    pub start: usize,
    pub end: usize,
    pub replacement: &'static str,
}

struct RegexRule {
    id: &'static str,
    label: &'static str,
    explanation: &'static str,
    category: Category,
    severity: Severity,
    regex: &'static Lazy<Regex>,
    capture: usize,
    replacement: &'static str,
}

static PROVIDER_TOKEN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(?:sk-(?:proj-)?[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{20,}|AKIA[0-9A-Z]{16})\b")
        .unwrap()
});
static ASSIGNED_SECRET: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?im)\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd|pwd)\s*[:=]\s*[\"']?([^\s\"',;]{6,})"#).unwrap()
});
static CONNECTION_STRING: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis)://[^\s]+").unwrap()
});
static EMAIL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\b").unwrap()
});
static PHONE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\+?[0-9][0-9 ()-]{7,}[0-9]").unwrap());
static ISO_DATE_PREFIX: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\d{4}-\d{2}-\d{2}").unwrap());
static IPV4: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b").unwrap());
static WINDOWS_PATH: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)\b[A-Z]:\\(?:[^\\\r\n:*?\"<>|]+\\)*[^\\\r\n:*?\"<>|\s]*"#).unwrap()
});
static POSIX_HOME: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"/(?:Users|home)/[A-Za-z0-9._-]+(?:/[^\s:'\"]+)*"#).unwrap());

static RULES: Lazy<Vec<RegexRule>> = Lazy::new(|| {
    vec![
        RegexRule {
            id: "credential.provider-token",
            label: "Provider credential",
            explanation: "Looks like a service API key or access token.",
            category: Category::Credential,
            severity: Severity::Critical,
            regex: &PROVIDER_TOKEN,
            capture: 0,
            replacement: "[REDACTED_SECRET]",
        },
        RegexRule {
            id: "credential.assigned-secret",
            label: "Assigned secret",
            explanation: "A password, token, or secret appears to be assigned here.",
            category: Category::Credential,
            severity: Severity::High,
            regex: &ASSIGNED_SECRET,
            capture: 1,
            replacement: "[REDACTED_SECRET]",
        },
        RegexRule {
            id: "credential.connection-string",
            label: "Connection string",
            explanation: "Database URLs often contain reusable credentials and internal hostnames.",
            category: Category::Credential,
            severity: Severity::Critical,
            regex: &CONNECTION_STRING,
            capture: 0,
            replacement: "[REDACTED_CONNECTION]",
        },
        RegexRule {
            id: "personal.email",
            label: "Email address",
            explanation: "An email address can identify a person or internal organization.",
            category: Category::Personal,
            severity: Severity::Medium,
            regex: &EMAIL,
            capture: 0,
            replacement: "[REDACTED_EMAIL]",
        },
        RegexRule {
            id: "personal.phone",
            label: "Phone number candidate",
            explanation: "This number has the shape of a phone number; confirm it before sharing.",
            category: Category::Personal,
            severity: Severity::Medium,
            regex: &PHONE,
            capture: 0,
            replacement: "[REDACTED_PHONE]",
        },
        RegexRule {
            id: "local.windows-path",
            label: "Local Windows path",
            explanation: "Local paths can expose usernames, project names, and machine layout.",
            category: Category::LocalContext,
            severity: Severity::Low,
            regex: &WINDOWS_PATH,
            capture: 0,
            replacement: "[REDACTED_LOCAL_PATH]",
        },
        RegexRule {
            id: "local.posix-home",
            label: "Local home path",
            explanation: "Home-directory paths commonly expose the local account name.",
            category: Category::LocalContext,
            severity: Severity::Low,
            regex: &POSIX_HOME,
            capture: 0,
            replacement: "[REDACTED_LOCAL_PATH]",
        },
    ]
});

pub(crate) fn rules_run(options: &ScanOptions) -> usize {
    RULES.len() + 1 + options.custom_terms.len()
}

pub(crate) fn detect(text: &str, options: &ScanOptions) -> Vec<Candidate> {
    let mut candidates = Vec::new();

    for rule in RULES.iter() {
        for captures in rule.regex.captures_iter(text) {
            if let Some(value) = captures.get(rule.capture) {
                if value.as_str().starts_with("[REDACTED_") {
                    continue;
                }
                if rule.id == "personal.phone" {
                    let raw = value.as_str();
                    let digit_count = raw.chars().filter(char::is_ascii_digit).count();
                    if !(10..=15).contains(&digit_count) || ISO_DATE_PREFIX.is_match(raw) {
                        continue;
                    }
                }
                candidates.push(Candidate {
                    rule_id: rule.id,
                    label: rule.label,
                    explanation: rule.explanation,
                    category: rule.category,
                    severity: rule.severity,
                    start: value.start(),
                    end: value.end(),
                    replacement: rule.replacement,
                });
            }
        }
    }

    for value in IPV4.find_iter(text) {
        if Ipv4Addr::from_str(value.as_str()).is_ok_and(|ip| ip.is_private() || ip.is_loopback()) {
            candidates.push(Candidate {
                rule_id: "network.private-ipv4",
                label: "Private IP address",
                explanation: "Private network addresses can reveal internal infrastructure.",
                category: Category::Network,
                severity: Severity::Medium,
                start: value.start(),
                end: value.end(),
                replacement: "[REDACTED_PRIVATE_IP]",
            });
        }
    }

    for term in options
        .custom_terms
        .iter()
        .map(|term| term.trim())
        .filter(|term| !term.is_empty())
    {
        let Ok(regex) = RegexBuilder::new(&regex::escape(term))
            .case_insensitive(true)
            .build()
        else {
            continue;
        };
        for value in regex.find_iter(text) {
            candidates.push(Candidate {
                rule_id: "custom.sensitive-term",
                label: "Custom sensitive term",
                explanation: "This matches a sensitive term supplied for the current scan.",
                category: Category::Custom,
                severity: Severity::High,
                start: value.start(),
                end: value.end(),
                replacement: "[REDACTED_CUSTOM]",
            });
        }
    }

    candidates.sort_by(|a, b| {
        b.severity
            .rank()
            .cmp(&a.severity.rank())
            .then_with(|| (b.end - b.start).cmp(&(a.end - a.start)))
            .then_with(|| a.start.cmp(&b.start))
    });

    let mut selected: Vec<Candidate> = Vec::new();
    'candidate: for candidate in candidates {
        for existing in &selected {
            if candidate.start < existing.end && existing.start < candidate.end {
                continue 'candidate;
            }
        }
        selected.push(candidate);
    }
    selected.sort_by_key(|candidate| candidate.start);
    selected
}
