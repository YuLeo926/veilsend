use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use veilsend_core::{
    BarcodeAvailability, ImageBarcodeInspection, ImageFaceInspection, ImageOcrInspection,
    ImageQrInspection, ImageRect, ImageRedactionDecision, OcrAvailability, QrAvailability,
    ScanOptions, VerificationStatus, inspect_barcodes, inspect_qr_codes, map_ocr_findings,
};

use crate::{windows_faces, windows_ocr};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DetectorKind {
    Text,
    Face,
    Qr,
    Barcode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewedVisualFinding {
    pub id: String,
    pub kind: DetectorKind,
    pub rectangles: Vec<ImageRect>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DetectorChecks {
    pub text: bool,
    pub face: bool,
    pub qr: bool,
    pub barcode: bool,
}

impl DetectorChecks {
    pub const fn all_complete(self) -> bool {
        self.text && self.face && self.qr && self.barcode
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewedVisualSnapshot {
    pub findings: Vec<ReviewedVisualFinding>,
    pub checks: DetectorChecks,
}

#[derive(Debug)]
pub struct VisualInspectionBundle {
    pub ocr: ImageOcrInspection,
    pub faces: ImageFaceInspection,
    pub qr: ImageQrInspection,
    pub barcodes: ImageBarcodeInspection,
    pub reviewed: Vec<ReviewedVisualFinding>,
}

impl VisualInspectionBundle {
    pub fn checks(&self) -> DetectorChecks {
        DetectorChecks {
            text: self.ocr.availability == OcrAvailability::Available && self.ocr.report.is_some(),
            face: self.faces.availability == veilsend_core::FaceAvailability::Available,
            qr: self.qr.availability == QrAvailability::Available && self.qr.report.is_some(),
            barcode: self.barcodes.availability == BarcodeAvailability::Available
                && self.barcodes.report.is_some(),
        }
    }

    pub fn snapshot(&self) -> ReviewedVisualSnapshot {
        ReviewedVisualSnapshot {
            findings: self.reviewed.clone(),
            checks: self.checks(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedVisualFinding {
    pub reviewed_id: String,
    pub kind: DetectorKind,
    pub rectangles: Vec<ImageRect>,
    pub enabled: bool,
}

pub fn inspect_visual(bytes: &[u8]) -> VisualInspectionBundle {
    let ocr = inspect_visible_text(bytes);
    let faces = windows_faces::inspect(bytes);
    let qr = inspect_qr(bytes);
    let barcodes = inspect_barcode(bytes);
    let reviewed = collect_reviewed(&ocr, &faces, &qr, &barcodes);
    VisualInspectionBundle {
        ocr,
        faces,
        qr,
        barcodes,
        reviewed,
    }
}

pub fn resolve_decisions(
    reviewed: &[ReviewedVisualFinding],
    recomputed: &[ReviewedVisualFinding],
    decisions: &[ImageRedactionDecision],
) -> Result<Vec<ResolvedVisualFinding>, String> {
    if reviewed.len() != recomputed.len() || reviewed.len() != decisions.len() {
        return Err(
            "The visual findings changed after review. Review the current image again before saving."
                .to_owned(),
        );
    }

    let mut decisions_by_id = HashMap::new();
    for decision in decisions {
        if decisions_by_id
            .insert(decision.id.as_str(), decision.enabled)
            .is_some()
        {
            return Err("A visual finding had more than one decision.".to_owned());
        }
    }
    if decisions_by_id.len() != reviewed.len()
        || reviewed
            .iter()
            .any(|finding| !decisions_by_id.contains_key(finding.id.as_str()))
    {
        return Err(
            "Every reviewed visual finding needs an explicit Redact or Keep decision.".to_owned(),
        );
    }

    let mut used = HashSet::new();
    let mut resolved = Vec::with_capacity(reviewed.len());
    for reviewed_finding in reviewed {
        let candidates = recomputed
            .iter()
            .enumerate()
            .filter(|(_, current)| {
                current.kind == reviewed_finding.kind
                    && geometrically_matches(&reviewed_finding.rectangles, &current.rectangles)
            })
            .collect::<Vec<_>>();
        if candidates.len() != 1 || used.contains(&candidates[0].0) {
            return Err(
                "The visual findings moved or became ambiguous. Review the current image again before saving."
                    .to_owned(),
            );
        }
        let (index, current) = candidates[0];
        used.insert(index);
        resolved.push(ResolvedVisualFinding {
            reviewed_id: reviewed_finding.id.clone(),
            kind: reviewed_finding.kind,
            rectangles: current.rectangles.clone(),
            enabled: decisions_by_id[reviewed_finding.id.as_str()],
        });
    }
    if used.len() != recomputed.len() {
        return Err(
            "The visual findings changed after review. Review the current image again before saving."
                .to_owned(),
        );
    }
    Ok(resolved)
}

pub fn remaining_are_exceptions(
    remaining: &[ReviewedVisualFinding],
    kept: &[ReviewedVisualFinding],
) -> bool {
    let mut used = HashSet::new();
    for finding in remaining {
        let candidates = kept
            .iter()
            .enumerate()
            .filter(|(_, exception)| {
                exception.kind == finding.kind
                    && geometrically_matches(&exception.rectangles, &finding.rectangles)
            })
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        if candidates.len() != 1 || !used.insert(candidates[0]) {
            return false;
        }
    }
    true
}

pub fn classify_saved_output(
    metadata_remaining: usize,
    checks: DetectorChecks,
    remaining: &[ReviewedVisualFinding],
    kept: &[ReviewedVisualFinding],
    exceptions: usize,
) -> VerificationStatus {
    if metadata_remaining > 0
        || !checks.all_complete()
        || !remaining_are_exceptions(remaining, kept)
    {
        VerificationStatus::NeedsReview
    } else if exceptions > 0 {
        VerificationStatus::CleanedWithExceptions
    } else {
        VerificationStatus::Verified
    }
}

fn collect_reviewed(
    ocr: &ImageOcrInspection,
    faces: &ImageFaceInspection,
    qr: &ImageQrInspection,
    barcodes: &ImageBarcodeInspection,
) -> Vec<ReviewedVisualFinding> {
    let mut reviewed = Vec::new();
    if let Some(report) = &ocr.report {
        reviewed.extend(report.findings.iter().map(|finding| ReviewedVisualFinding {
            id: finding.id.clone(),
            kind: DetectorKind::Text,
            rectangles: finding.rectangles.clone(),
        }));
    }
    reviewed.extend(faces.findings.iter().map(|finding| ReviewedVisualFinding {
        id: finding.id.clone(),
        kind: DetectorKind::Face,
        rectangles: vec![finding.rectangle],
    }));
    if let Some(report) = &qr.report {
        reviewed.extend(report.findings.iter().map(|finding| ReviewedVisualFinding {
            id: finding.id.clone(),
            kind: DetectorKind::Qr,
            rectangles: vec![finding.rectangle],
        }));
    }
    if let Some(report) = &barcodes.report {
        reviewed.extend(report.findings.iter().map(|finding| ReviewedVisualFinding {
            id: finding.id.clone(),
            kind: DetectorKind::Barcode,
            rectangles: vec![finding.rectangle],
        }));
    }
    reviewed
}

fn inspect_visible_text(bytes: &[u8]) -> ImageOcrInspection {
    match windows_ocr::recognize(bytes) {
        Ok(recognized) => match map_ocr_findings(
            &recognized.words,
            recognized.language,
            ScanOptions::default(),
        ) {
            Ok(report) => ImageOcrInspection {
                availability: OcrAvailability::Available,
                message: if report.findings.is_empty() {
                    format!(
                        "Windows OCR checked {} visible word(s) and found no supported sensitive-text matches.",
                        report.words_detected
                    )
                } else {
                    format!(
                        "Windows OCR found {} supported sensitive-text risk(s) for review.",
                        report.findings.len()
                    )
                },
                report: Some(report),
            },
            Err(_) => ImageOcrInspection {
                availability: OcrAvailability::NeedsReview,
                report: None,
                message:
                    "Visible text needs review because the local matching rules could not finish."
                        .to_owned(),
            },
        },
        Err(windows_ocr::OcrAdapterError::Unavailable(message)) => ImageOcrInspection {
            availability: OcrAvailability::Unavailable,
            report: None,
            message,
        },
        Err(windows_ocr::OcrAdapterError::NeedsReview(message)) => ImageOcrInspection {
            availability: OcrAvailability::NeedsReview,
            report: None,
            message,
        },
    }
}

fn inspect_qr(bytes: &[u8]) -> ImageQrInspection {
    match inspect_qr_codes(bytes, veilsend_core::DEFAULT_MAX_IMAGE_BYTES) {
        Ok(report) => {
            let complete = report.warnings.is_empty()
                && report.findings.len() == report.grids_detected;
            let availability = if complete {
                QrAvailability::Available
            } else {
                QrAvailability::NeedsReview
            };
            let message = if !complete {
                "QR inspection needs review because one or more detected regions could not be mapped safely."
                    .to_owned()
            } else if report.findings.is_empty() {
                "Local QR inspection found no QR-like codes.".to_owned()
            } else {
                format!(
                    "Local QR inspection found {} QR-like code(s) for review; {} decoded successfully.",
                    report.findings.len(), report.decoded_grids
                )
            };
            ImageQrInspection {
                availability,
                report: Some(report),
                message,
            }
        }
        Err(_) => ImageQrInspection {
            availability: QrAvailability::NeedsReview,
            report: None,
            message:
                "QR inspection could not complete locally. Review the image manually before sharing."
                    .to_owned(),
        },
    }
}

fn inspect_barcode(bytes: &[u8]) -> ImageBarcodeInspection {
    match inspect_barcodes(bytes, veilsend_core::DEFAULT_MAX_IMAGE_BYTES) {
        Ok(report) => {
            let complete = report.warnings.is_empty();
            let availability = if complete {
                BarcodeAvailability::Available
            } else {
                BarcodeAvailability::NeedsReview
            };
            let message = if !complete {
                "One-dimensional barcode inspection was incomplete. Review the image before sharing."
                    .to_owned()
            } else if report.findings.is_empty() {
                "Local one-dimensional barcode inspection found no supported symbols.".to_owned()
            } else {
                format!(
                    "Local inspection found {} supported one-dimensional barcode(s). Encoded content stays hidden.",
                    report.findings.len()
                )
            };
            ImageBarcodeInspection {
                availability,
                report: Some(report),
                message,
            }
        }
        Err(_) => ImageBarcodeInspection {
            availability: BarcodeAvailability::NeedsReview,
            report: None,
            message: "One-dimensional barcode inspection could not complete locally. Review the image manually before sharing."
                .to_owned(),
        },
    }
}

fn geometrically_matches(left: &[ImageRect], right: &[ImageRect]) -> bool {
    let (Some(left), Some(right)) = (bounding_rect(left), bounding_rect(right)) else {
        return false;
    };
    let intersection_left = left.x.max(right.x);
    let intersection_top = left.y.max(right.y);
    let intersection_right = left
        .x
        .saturating_add(left.width)
        .min(right.x.saturating_add(right.width));
    let intersection_bottom = left
        .y
        .saturating_add(left.height)
        .min(right.y.saturating_add(right.height));
    if intersection_right <= intersection_left || intersection_bottom <= intersection_top {
        return false;
    }
    let intersection = u64::from(intersection_right - intersection_left)
        * u64::from(intersection_bottom - intersection_top);
    let left_area = u64::from(left.width) * u64::from(left.height);
    let right_area = u64::from(right.width) * u64::from(right.height);
    if left_area == 0 || right_area == 0 {
        return false;
    }
    let coverage = intersection as f64 / left_area.min(right_area) as f64;
    let area_ratio = left_area.min(right_area) as f64 / left_area.max(right_area) as f64;
    coverage >= 0.65 && area_ratio >= 0.5
}

fn bounding_rect(rectangles: &[ImageRect]) -> Option<ImageRect> {
    let first = *rectangles.first()?;
    if first.width == 0 || first.height == 0 {
        return None;
    }
    let mut left = first.x;
    let mut top = first.y;
    let mut right = first.x.saturating_add(first.width);
    let mut bottom = first.y.saturating_add(first.height);
    for rectangle in &rectangles[1..] {
        if rectangle.width == 0 || rectangle.height == 0 {
            return None;
        }
        left = left.min(rectangle.x);
        top = top.min(rectangle.y);
        right = right.max(rectangle.x.saturating_add(rectangle.width));
        bottom = bottom.max(rectangle.y.saturating_add(rectangle.height));
    }
    (right > left && bottom > top).then_some(ImageRect {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn finding(id: &str, kind: DetectorKind, x: u32) -> ReviewedVisualFinding {
        ReviewedVisualFinding {
            id: id.to_owned(),
            kind,
            rectangles: vec![ImageRect {
                x,
                y: 10,
                width: 100,
                height: 100,
            }],
        }
    }

    fn decision(id: &str, enabled: bool) -> ImageRedactionDecision {
        ImageRedactionDecision {
            id: id.to_owned(),
            enabled,
        }
    }

    #[test]
    fn decision_matching() {
        let reviewed = vec![finding("face-1", DetectorKind::Face, 10)];
        let exact = resolve_decisions(&reviewed, &reviewed, &[decision("face-1", true)]).unwrap();
        assert!(exact[0].enabled);

        let shifted = vec![finding("face-current", DetectorKind::Face, 14)];
        assert!(resolve_decisions(&reviewed, &shifted, &[decision("face-1", false)]).is_ok());

        let cross_detector = vec![finding("qr-current", DetectorKind::Qr, 10)];
        assert!(
            resolve_decisions(&reviewed, &cross_detector, &[decision("face-1", true)]).is_err()
        );
        assert!(resolve_decisions(&reviewed, &reviewed, &[]).is_err());

        let reviewed_pair = vec![
            finding("face-1", DetectorKind::Face, 10),
            finding("face-2", DetectorKind::Face, 300),
        ];
        let ambiguous = vec![
            finding("current-1", DetectorKind::Face, 12),
            finding("current-2", DetectorKind::Face, 15),
        ];
        assert!(
            resolve_decisions(
                &reviewed_pair,
                &ambiguous,
                &[decision("face-1", true), decision("face-2", true)]
            )
            .is_err()
        );
    }

    #[test]
    fn saved_output_exceptions() {
        let complete = DetectorChecks {
            text: true,
            face: true,
            qr: true,
            barcode: true,
        };
        assert_eq!(
            classify_saved_output(0, complete, &[], &[], 0),
            VerificationStatus::Verified
        );
        assert_eq!(
            classify_saved_output(
                0,
                DetectorChecks {
                    face: false,
                    ..complete
                },
                &[],
                &[],
                0,
            ),
            VerificationStatus::NeedsReview
        );
        assert_eq!(
            classify_saved_output(1, complete, &[], &[], 0),
            VerificationStatus::NeedsReview
        );
        let kept_face = vec![finding("face-kept", DetectorKind::Face, 10)];
        let remaining_face = vec![finding("face-after", DetectorKind::Face, 14)];
        assert!(remaining_are_exceptions(&remaining_face, &kept_face));
        assert_eq!(
            classify_saved_output(0, complete, &remaining_face, &kept_face, 1),
            VerificationStatus::CleanedWithExceptions
        );

        let unreviewed = vec![finding("face-new", DetectorKind::Face, 300)];
        assert!(!remaining_are_exceptions(&unreviewed, &kept_face));
        assert_eq!(
            classify_saved_output(0, complete, &unreviewed, &kept_face, 1),
            VerificationStatus::NeedsReview
        );

        let overlapping_barcode = vec![finding("barcode-after", DetectorKind::Barcode, 10)];
        let kept_qr = vec![finding("qr-kept", DetectorKind::Qr, 10)];
        assert!(!remaining_are_exceptions(&overlapping_barcode, &kept_qr));
        assert_eq!(
            classify_saved_output(0, complete, &overlapping_barcode, &kept_qr, 1),
            VerificationStatus::NeedsReview
        );
    }
}
