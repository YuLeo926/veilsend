use std::collections::HashMap;

use crate::{
    error::ShareGateError,
    fingerprint,
    model::{
        FindingDecision, SanitizeRequest, SanitizeResult, VerificationReport, VerificationStatus,
    },
    scan,
};

pub fn sanitize(request: SanitizeRequest) -> Result<SanitizeResult, ShareGateError> {
    if request.original_text.len() > request.options.max_bytes {
        return Err(ShareGateError::ContentTooLarge(request.options.max_bytes));
    }
    if fingerprint(request.original_text.as_bytes()) != request.content_fingerprint {
        return Err(ShareGateError::StaleContent);
    }

    let decisions: HashMap<&str, &FindingDecision> = request
        .decisions
        .iter()
        .map(|decision| (decision.id.as_str(), decision))
        .collect();
    let mut edits = Vec::new();
    let mut exceptions = 0;

    for finding in &request.findings {
        let Some(decision) = decisions.get(finding.id.as_str()) else {
            exceptions += 1;
            continue;
        };
        if !decision.enabled {
            exceptions += 1;
            continue;
        }
        if decision
            .replacement
            .chars()
            .any(|character| character.is_control() && character != '\n' && character != '\t')
        {
            return Err(ShareGateError::InvalidReplacement);
        }
        let Some(value) = request.original_text.get(finding.start..finding.end) else {
            return Err(ShareGateError::StaleFinding(finding.id.clone()));
        };
        if fingerprint(value.as_bytes()) != finding.match_fingerprint {
            return Err(ShareGateError::StaleFinding(finding.id.clone()));
        }
        edits.push((finding.start, finding.end, decision.replacement.as_str()));
    }

    edits.sort_by_key(|(start, _, _)| *start);
    if edits.windows(2).any(|pair| pair[0].1 > pair[1].0) {
        return Err(ShareGateError::OverlappingFindings);
    }

    let mut cleaned_text = request.original_text;
    for (start, end, replacement) in edits.into_iter().rev() {
        cleaned_text.replace_range(start..end, replacement);
    }

    let report = scan(&cleaned_text, request.options)?;
    let status = if exceptions > 0 && report.findings.len() <= exceptions {
        VerificationStatus::CleanedWithExceptions
    } else if !report.findings.is_empty() {
        VerificationStatus::NeedsReview
    } else {
        VerificationStatus::Verified
    };
    let message = match status {
        VerificationStatus::Verified => {
            "No enabled ShareGate rule found sensitive content in the cleaned copy.".to_owned()
        }
        VerificationStatus::NeedsReview => format!(
            "{} finding(s) remain after cleaning. Review the output before sharing.",
            report.findings.len()
        ),
        VerificationStatus::CleanedWithExceptions => {
            format!("Cleaning finished with {exceptions} user-approved exception(s).")
        }
    };

    Ok(SanitizeResult {
        cleaned_text,
        verification: VerificationReport {
            status,
            remaining_findings: report.findings,
            exceptions,
            message,
        },
    })
}
