use std::io::Cursor;

use image::{DynamicImage, ImageFormat as EncodedFormat, Rgba};

use crate::{
    ImageRect, ImageRedactionResult, ImageTextDecision, ImageTextFinding, OcrConfidence,
    OcrScanReport, OcrWord, ScanOptions, ShareGateError, fingerprint, inspect_image, scan,
};

const MAX_DECODED_PIXELS: u64 = 40_000_000;
const REDACTION_PADDING: u32 = 4;
const REDACTION_INK: Rgba<u8> = Rgba([27, 25, 22, 255]);

struct PositionedWord<'a> {
    word: &'a OcrWord,
    start: usize,
    end: usize,
}

pub fn map_ocr_findings(
    words: &[OcrWord],
    language: Option<String>,
    options: ScanOptions,
) -> Result<OcrScanReport, ShareGateError> {
    let mut text = String::new();
    let mut positioned = Vec::new();
    let mut previous_line = None;
    let mut previous_was_joiner = false;

    for word in words.iter().filter(|word| !word.text.trim().is_empty()) {
        let token = normalize_ocr_token(word.text.trim());
        let token_is_joiner = is_ocr_joiner(&token);
        if let Some(line) = previous_line {
            if line == word.line_index {
                if !previous_was_joiner && !token_is_joiner {
                    text.push(' ');
                }
            } else {
                text.push('\n');
            }
        }
        let start = text.len();
        text.push_str(&token);
        let end = text.len();
        positioned.push(PositionedWord { word, start, end });
        previous_line = Some(word.line_index);
        previous_was_joiner = token_is_joiner;
    }

    let report = scan(&text, options)?;
    let findings = report
        .findings
        .into_iter()
        .filter_map(|finding| {
            let rectangles = positioned
                .iter()
                .filter(|positioned| {
                    finding.start < positioned.end && positioned.start < finding.end
                })
                .map(|positioned| positioned.word.rect)
                .collect::<Vec<_>>();
            (!rectangles.is_empty()).then_some(ImageTextFinding {
                id: finding.id,
                rule_id: finding.rule_id,
                label: finding.label,
                explanation: finding.explanation,
                category: finding.category,
                severity: finding.severity,
                masked_value: finding.masked_value,
                rectangles,
                confidence: OcrConfidence::NotProvided,
            })
        })
        .collect();

    Ok(OcrScanReport {
        findings,
        words_detected: positioned.len(),
        language,
        confidence: OcrConfidence::NotProvided,
        warnings: vec![
            "Windows OCR does not provide a confidence score. Review every proposed redaction."
                .to_owned(),
        ],
    })
}

fn normalize_ocr_token(token: &str) -> String {
    match token {
        "·" | "•" => ".".to_owned(),
        _ => token.to_owned(),
    }
}

fn is_ocr_joiner(token: &str) -> bool {
    matches!(token, "." | "," | ":" | ";" | "/" | "\\" | "-" | "_" | "@")
}

pub fn redact_image(
    input: &[u8],
    max_bytes: usize,
    expected_file_fingerprint: &str,
    findings: &[ImageTextFinding],
    decisions: &[ImageTextDecision],
) -> Result<ImageRedactionResult, ShareGateError> {
    if fingerprint(input) != expected_file_fingerprint {
        return Err(ShareGateError::StaleContent);
    }

    let inspection = inspect_image(input, max_bytes)?;
    if !inspection.can_clean_losslessly {
        return Err(ShareGateError::InvalidImage(
            "Normalize the image orientation before visual redaction so OCR regions stay aligned."
                .to_owned(),
        ));
    }
    let width = inspection.width.ok_or_else(|| {
        ShareGateError::InvalidImage("The image width could not be read.".to_owned())
    })?;
    let height = inspection.height.ok_or_else(|| {
        ShareGateError::InvalidImage("The image height could not be read.".to_owned())
    })?;
    if u64::from(width) * u64::from(height) > MAX_DECODED_PIXELS {
        return Err(ShareGateError::InvalidImage(format!(
            "The image expands beyond ShareGate's {MAX_DECODED_PIXELS}-pixel visual-redaction limit."
        )));
    }

    let enabled = |finding: &ImageTextFinding| {
        decisions
            .iter()
            .find(|decision| decision.id == finding.id)
            .map(|decision| decision.enabled)
            .unwrap_or(true)
    };
    let selected = findings
        .iter()
        .filter(|finding| enabled(finding))
        .collect::<Vec<_>>();
    let exceptions = findings.len().saturating_sub(selected.len());
    let rectangles = normalize_rectangles(
        selected
            .iter()
            .flat_map(|finding| finding.rectangles.iter().copied()),
        width,
        height,
    );
    if !selected.is_empty() && rectangles.is_empty() {
        return Err(ShareGateError::InvalidImage(
            "The selected OCR findings did not contain valid image regions.".to_owned(),
        ));
    }

    let decoded = image::load_from_memory(input)
        .map_err(|error| ShareGateError::InvalidImage(error.to_string()))?;
    let mut pixels = decoded.to_rgba8();
    for rect in &rectangles {
        let right = rect.x.saturating_add(rect.width).min(width);
        let bottom = rect.y.saturating_add(rect.height).min(height);
        for y in rect.y..bottom {
            for x in rect.x..right {
                pixels.put_pixel(x, y, REDACTION_INK);
            }
        }
    }

    let mut output = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(pixels)
        .write_to(&mut output, EncodedFormat::Png)
        .map_err(|error| ShareGateError::InvalidImage(error.to_string()))?;
    let cleaned_bytes = output.into_inner();
    let cleaned_size = cleaned_bytes.len();

    Ok(ImageRedactionResult {
        cleaned_bytes,
        original_bytes: input.len(),
        cleaned_size,
        redacted_findings: selected.len(),
        redacted_regions: rectangles.len(),
        exceptions,
    })
}

fn normalize_rectangles(
    rectangles: impl Iterator<Item = ImageRect>,
    width: u32,
    height: u32,
) -> Vec<ImageRect> {
    let mut normalized = rectangles
        .filter_map(|rect| expand_and_clamp(rect, width, height))
        .collect::<Vec<_>>();
    normalized.sort_by_key(|rect| (rect.y, rect.x));

    let mut merged: Vec<ImageRect> = Vec::new();
    for rect in normalized {
        if let Some(existing) = merged
            .iter_mut()
            .find(|existing| rectangles_touch(**existing, rect))
        {
            *existing = union(*existing, rect);
        } else {
            merged.push(rect);
        }
    }
    merged
}

fn expand_and_clamp(rect: ImageRect, width: u32, height: u32) -> Option<ImageRect> {
    let x = rect.x.saturating_sub(REDACTION_PADDING).min(width);
    let y = rect.y.saturating_sub(REDACTION_PADDING).min(height);
    let right = rect
        .x
        .saturating_add(rect.width)
        .saturating_add(REDACTION_PADDING)
        .min(width);
    let bottom = rect
        .y
        .saturating_add(rect.height)
        .saturating_add(REDACTION_PADDING)
        .min(height);
    (right > x && bottom > y).then_some(ImageRect {
        x,
        y,
        width: right - x,
        height: bottom - y,
    })
}

fn rectangles_touch(left: ImageRect, right: ImageRect) -> bool {
    let left_right = left.x.saturating_add(left.width);
    let right_right = right.x.saturating_add(right.width);
    let left_bottom = left.y.saturating_add(left.height);
    let right_bottom = right.y.saturating_add(right.height);
    left.x <= right_right.saturating_add(2)
        && right.x <= left_right.saturating_add(2)
        && left.y <= right_bottom.saturating_add(2)
        && right.y <= left_bottom.saturating_add(2)
}

fn union(left: ImageRect, right: ImageRect) -> ImageRect {
    let x = left.x.min(right.x);
    let y = left.y.min(right.y);
    let right_edge = left
        .x
        .saturating_add(left.width)
        .max(right.x.saturating_add(right.width));
    let bottom = left
        .y
        .saturating_add(left.height)
        .max(right.y.saturating_add(right.height));
    ImageRect {
        x,
        y,
        width: right_edge - x,
        height: bottom - y,
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::{DynamicImage, GenericImageView, ImageFormat, Rgb, RgbImage};

    use super::*;
    use crate::{Category, DEFAULT_MAX_IMAGE_BYTES, Severity};

    fn encoded_image() -> Vec<u8> {
        let image = DynamicImage::ImageRgb8(RgbImage::from_pixel(80, 30, Rgb([240, 240, 240])));
        let mut output = Cursor::new(Vec::new());
        image.write_to(&mut output, ImageFormat::Png).unwrap();
        output.into_inner()
    }

    #[test]
    fn maps_scanner_findings_back_to_every_overlapping_word() {
        let words = vec![
            OcrWord {
                text: "email".to_owned(),
                rect: ImageRect {
                    x: 2,
                    y: 2,
                    width: 20,
                    height: 8,
                },
                line_index: 0,
            },
            OcrWord {
                text: "alice@example.com".to_owned(),
                rect: ImageRect {
                    x: 24,
                    y: 2,
                    width: 50,
                    height: 8,
                },
                line_index: 0,
            },
        ];
        let report =
            map_ocr_findings(&words, Some("en-US".to_owned()), ScanOptions::default()).unwrap();

        assert_eq!(report.findings.len(), 1);
        assert_eq!(report.findings[0].rule_id, "personal.email");
        assert_eq!(report.findings[0].rectangles, vec![words[1].rect]);
        assert_eq!(report.confidence, OcrConfidence::NotProvided);
    }

    #[test]
    fn maps_multi_word_custom_term_to_multiple_rectangles() {
        let words = vec![
            OcrWord {
                text: "Project".to_owned(),
                rect: ImageRect {
                    x: 5,
                    y: 5,
                    width: 25,
                    height: 8,
                },
                line_index: 0,
            },
            OcrWord {
                text: "Firefly".to_owned(),
                rect: ImageRect {
                    x: 34,
                    y: 5,
                    width: 28,
                    height: 8,
                },
                line_index: 0,
            },
        ];
        let report = map_ocr_findings(
            &words,
            None,
            ScanOptions {
                custom_terms: vec!["Project Firefly".to_owned()],
                ..ScanOptions::default()
            },
        )
        .unwrap();

        assert_eq!(report.findings.len(), 1);
        assert_eq!(report.findings[0].rectangles.len(), 2);
    }

    #[test]
    fn rejoins_ocr_split_ip_punctuation_and_maps_every_region() {
        let tokens = ["192", "·", "168", "·", "1", "·", "24"];
        let words = tokens
            .into_iter()
            .enumerate()
            .map(|(index, token)| OcrWord {
                text: token.to_owned(),
                rect: ImageRect {
                    x: index as u32 * 12,
                    y: 4,
                    width: 10,
                    height: 8,
                },
                line_index: 0,
            })
            .collect::<Vec<_>>();

        let report = map_ocr_findings(&words, None, ScanOptions::default()).unwrap();

        assert_eq!(report.findings.len(), 1);
        assert_eq!(report.findings[0].rule_id, "network.private-ipv4");
        assert_eq!(report.findings[0].rectangles.len(), 7);
    }

    #[test]
    fn redacts_selected_regions_and_exports_metadata_free_png() {
        let source = encoded_image();
        let finding = ImageTextFinding {
            id: "finding-1".to_owned(),
            rule_id: "personal.email".to_owned(),
            label: "Email address".to_owned(),
            explanation: "Sensitive".to_owned(),
            category: Category::Personal,
            severity: Severity::Medium,
            masked_value: "al************om".to_owned(),
            rectangles: vec![ImageRect {
                x: 10,
                y: 10,
                width: 20,
                height: 6,
            }],
            confidence: OcrConfidence::NotProvided,
        };
        let result = redact_image(
            &source,
            DEFAULT_MAX_IMAGE_BYTES,
            &fingerprint(&source),
            &[finding],
            &[],
        )
        .unwrap();

        assert_eq!(result.redacted_findings, 1);
        assert_eq!(result.exceptions, 0);
        assert!(result.cleaned_bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(
            inspect_image(&result.cleaned_bytes, result.cleaned_bytes.len())
                .unwrap()
                .findings
                .is_empty()
        );
        let decoded = image::load_from_memory(&result.cleaned_bytes).unwrap();
        assert_eq!(decoded.get_pixel(12, 12), REDACTION_INK);
        assert_eq!(decoded.get_pixel(60, 20), Rgba([240, 240, 240, 255]));
    }

    #[test]
    fn respects_exceptions_and_rejects_stale_source() {
        let source = encoded_image();
        let finding = ImageTextFinding {
            id: "finding-1".to_owned(),
            rule_id: "custom.sensitive-term".to_owned(),
            label: "Custom sensitive term".to_owned(),
            explanation: "Sensitive".to_owned(),
            category: Category::Custom,
            severity: Severity::High,
            masked_value: "Fi****ly".to_owned(),
            rectangles: vec![ImageRect {
                x: 10,
                y: 10,
                width: 20,
                height: 6,
            }],
            confidence: OcrConfidence::NotProvided,
        };
        let result = redact_image(
            &source,
            DEFAULT_MAX_IMAGE_BYTES,
            &fingerprint(&source),
            std::slice::from_ref(&finding),
            &[ImageTextDecision {
                id: finding.id.clone(),
                enabled: false,
            }],
        )
        .unwrap();
        assert_eq!(result.redacted_findings, 0);
        assert_eq!(result.exceptions, 1);

        assert!(matches!(
            redact_image(&source, DEFAULT_MAX_IMAGE_BYTES, "stale", &[finding], &[]),
            Err(ShareGateError::StaleContent)
        ));
    }
}
