use std::collections::HashSet;

use rxing::{BarcodeFormat, DecodeHints, Exceptions, RXingResult};

use crate::{
    BarcodeFinding, BarcodeKind, BarcodeScanReport, ImageRect, Severity, ShareGateError,
    fingerprint, inspect_image,
};

const MAX_DECODED_PIXELS: u64 = 40_000_000;
const MIN_RESULT_SPAN: f32 = 8.0;
const MIN_MINOR_HALF_SPAN: f32 = 18.0;
const MINOR_AXIS_RATIO: f32 = 0.35;
const OUTER_PADDING: f32 = 8.0;

pub fn inspect_barcodes(
    input: &[u8],
    max_bytes: usize,
) -> Result<BarcodeScanReport, ShareGateError> {
    let inspection = inspect_image(input, max_bytes)?;
    let width = inspection.width.ok_or_else(|| {
        ShareGateError::InvalidImage("The image width could not be read.".to_owned())
    })?;
    let height = inspection.height.ok_or_else(|| {
        ShareGateError::InvalidImage("The image height could not be read.".to_owned())
    })?;
    if u64::from(width) * u64::from(height) > MAX_DECODED_PIXELS {
        return Err(ShareGateError::InvalidImage(format!(
            "The image expands beyond ShareGate's {MAX_DECODED_PIXELS}-pixel barcode limit."
        )));
    }

    let grayscale = image::load_from_memory(input)
        .map_err(|error| ShareGateError::InvalidImage(error.to_string()))?
        .to_luma8();
    let grayscale = grayscale.into_raw();
    let mut hints = DecodeHints {
        PossibleFormats: Some(supported_formats()),
        TryHarder: Some(true),
        AlsoInverted: Some(true),
        ..DecodeHints::default()
    };

    let primary = rxing::helpers::detect_multiple_in_luma_with_hints(
        grayscale.clone(),
        width,
        height,
        &mut hints,
    );

    // rxing's multi-symbol recursion can stop after finding a normal-polarity code,
    // so scan an explicitly inverted pixel buffer as well. Public results are
    // deduplicated below without ever exposing either payload.
    let inverted = grayscale
        .into_iter()
        .map(|value| 255_u8.saturating_sub(value))
        .collect();
    hints.AlsoInverted = Some(false);
    let inverse =
        rxing::helpers::detect_multiple_in_luma_with_hints(inverted, width, height, &mut hints);

    let mut decoded = Vec::new();
    let mut warnings = Vec::new();
    let mut possible_undecoded = 0;
    absorb_decode_result(
        primary,
        &mut decoded,
        &mut warnings,
        &mut possible_undecoded,
    );
    absorb_decode_result(
        inverse,
        &mut decoded,
        &mut warnings,
        &mut possible_undecoded,
    );

    Ok(build_report(
        decoded,
        width,
        height,
        warnings,
        possible_undecoded,
    ))
}

fn absorb_decode_result(
    result: Result<Vec<RXingResult>, Exceptions>,
    decoded: &mut Vec<RXingResult>,
    warnings: &mut Vec<String>,
    possible_undecoded: &mut usize,
) {
    match result {
        Ok(mut results) => decoded.append(&mut results),
        Err(Exceptions::NotFoundException(_)) => {}
        Err(
            Exceptions::ChecksumException(_)
            | Exceptions::FormatException(_)
            | Exceptions::ReaderDecodeException(),
        ) => {
            *possible_undecoded += 1;
            warnings.push(
                "A possible one-dimensional barcode could not be decoded completely. Review the image before sharing."
                    .to_owned(),
            );
        }
        Err(_) => warnings.push(
            "The one-dimensional barcode check could not finish. Review the image before sharing."
                .to_owned(),
        ),
    }
}

fn supported_formats() -> HashSet<BarcodeFormat> {
    [
        BarcodeFormat::CODE_39,
        BarcodeFormat::CODE_93,
        BarcodeFormat::CODE_128,
        BarcodeFormat::CODABAR,
        BarcodeFormat::EAN_8,
        BarcodeFormat::EAN_13,
        BarcodeFormat::ITF,
        BarcodeFormat::UPC_A,
        BarcodeFormat::UPC_E,
        BarcodeFormat::RSS_14,
        BarcodeFormat::RSS_EXPANDED,
        BarcodeFormat::TELEPEN,
    ]
    .into_iter()
    .collect()
}

fn build_report(
    results: Vec<RXingResult>,
    width: u32,
    height: u32,
    mut warnings: Vec<String>,
    possible_undecoded: usize,
) -> BarcodeScanReport {
    let symbols_detected = results.len().saturating_add(possible_undecoded);
    let mut findings = Vec::new();
    let mut seen = HashSet::new();

    for result in results {
        let Some(kind) = map_kind(*result.getBarcodeFormat()) else {
            continue;
        };
        let Some(rectangle) = conservative_rectangle(result.getPoints(), width, height) else {
            warnings.push(
                "A decoded barcode had unsafe or incomplete geometry and was omitted. Review the image before sharing."
                    .to_owned(),
            );
            continue;
        };
        let payload = result.getText();
        let encoded_length = payload.chars().count();
        let internal_key = fingerprint(
            format!(
                "{kind:?}\0{payload}\0{}:{}:{}:{}",
                rectangle.x, rectangle.y, rectangle.width, rectangle.height
            )
            .as_bytes(),
        );
        if !seen.insert(internal_key.clone()) {
            continue;
        }
        let label = kind.label().to_owned();
        findings.push(BarcodeFinding {
            id: format!("barcode-{}", &internal_key[..16]),
            kind,
            label: label.clone(),
            explanation: format!(
                "{label} can contain identifiers, account references, or access data. ShareGate keeps its encoded content hidden."
            ),
            severity: Severity::High,
            masked_value: format!(
                "{label} · {encoded_length} encoded {}",
                if encoded_length == 1 {
                    "character"
                } else {
                    "characters"
                }
            ),
            encoded_length,
            rectangle,
        });
    }

    BarcodeScanReport {
        decoded_symbols: findings.len(),
        findings,
        symbols_detected,
        warnings,
    }
}

fn map_kind(format: BarcodeFormat) -> Option<BarcodeKind> {
    match format {
        BarcodeFormat::CODE_39 => Some(BarcodeKind::Code39),
        BarcodeFormat::CODE_93 => Some(BarcodeKind::Code93),
        BarcodeFormat::CODE_128 => Some(BarcodeKind::Code128),
        BarcodeFormat::CODABAR => Some(BarcodeKind::Codabar),
        BarcodeFormat::EAN_8 => Some(BarcodeKind::Ean8),
        BarcodeFormat::EAN_13 => Some(BarcodeKind::Ean13),
        BarcodeFormat::ITF => Some(BarcodeKind::Itf),
        BarcodeFormat::UPC_A => Some(BarcodeKind::UpcA),
        BarcodeFormat::UPC_E => Some(BarcodeKind::UpcE),
        BarcodeFormat::RSS_14 => Some(BarcodeKind::Rss14),
        BarcodeFormat::RSS_EXPANDED => Some(BarcodeKind::RssExpanded),
        BarcodeFormat::TELEPEN => Some(BarcodeKind::Telepen),
        _ => None,
    }
}

fn conservative_rectangle(
    points: &[rxing::Point],
    image_width: u32,
    image_height: u32,
) -> Option<ImageRect> {
    let points = points
        .iter()
        .filter(|point| point.x.is_finite() && point.y.is_finite())
        .collect::<Vec<_>>();
    if points.len() < 2 || image_width == 0 || image_height == 0 {
        return None;
    }

    let min_x = points
        .iter()
        .map(|point| point.x)
        .fold(f32::INFINITY, f32::min);
    let max_x = points
        .iter()
        .map(|point| point.x)
        .fold(f32::NEG_INFINITY, f32::max);
    let min_y = points
        .iter()
        .map(|point| point.y)
        .fold(f32::INFINITY, f32::min);
    let max_y = points
        .iter()
        .map(|point| point.y)
        .fold(f32::NEG_INFINITY, f32::max);
    let horizontal_span = max_x - min_x;
    let vertical_span = max_y - min_y;
    let major_span = horizontal_span.max(vertical_span);
    if major_span < MIN_RESULT_SPAN {
        return None;
    }

    let minor_half_span = (major_span * MINOR_AXIS_RATIO).max(MIN_MINOR_HALF_SPAN);
    let (left, top, right, bottom) = if horizontal_span >= vertical_span {
        let center_y = (min_y + max_y) / 2.0;
        (
            min_x - OUTER_PADDING,
            center_y - minor_half_span - OUTER_PADDING,
            max_x + OUTER_PADDING,
            center_y + minor_half_span + OUTER_PADDING,
        )
    } else {
        let center_x = (min_x + max_x) / 2.0;
        (
            center_x - minor_half_span - OUTER_PADDING,
            min_y - OUTER_PADDING,
            center_x + minor_half_span + OUTER_PADDING,
            max_y + OUTER_PADDING,
        )
    };

    let x = left.floor().max(0.0).min(image_width as f32) as u32;
    let y = top.floor().max(0.0).min(image_height as f32) as u32;
    let right = right.ceil().max(0.0).min(image_width as f32) as u32;
    let bottom = bottom.ceil().max(0.0).min(image_height as f32) as u32;
    (right > x && bottom > y).then_some(ImageRect {
        x,
        y,
        width: right - x,
        height: bottom - y,
    })
}

impl BarcodeKind {
    const fn label(self) -> &'static str {
        match self {
            Self::Code39 => "Code 39",
            Self::Code93 => "Code 93",
            Self::Code128 => "Code 128",
            Self::Codabar => "Codabar",
            Self::Ean8 => "EAN-8",
            Self::Ean13 => "EAN-13",
            Self::Itf => "ITF",
            Self::UpcA => "UPC-A",
            Self::UpcE => "UPC-E",
            Self::Rss14 => "RSS-14",
            Self::RssExpanded => "RSS Expanded",
            Self::Telepen => "Telepen",
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::{DynamicImage, GenericImage, GrayImage, ImageFormat, Luma};
    use rxing::{BarcodeFormat, MultiFormatWriter, Writer};

    use crate::{
        BarcodeKind, DEFAULT_MAX_IMAGE_BYTES, ImageRect, ImageRedactionTarget, fingerprint,
        inspect_barcodes, redact_image,
    };

    fn code_128_image(payload: &str, width: i32, height: i32) -> GrayImage {
        let matrix = MultiFormatWriter
            .encode(payload, &BarcodeFormat::CODE_128, width, height)
            .unwrap();
        GrayImage::from_fn(matrix.width(), matrix.height(), |x, y| {
            if matrix.get(x, y) {
                Luma([0])
            } else {
                Luma([255])
            }
        })
    }

    fn encode_png(pixels: GrayImage) -> Vec<u8> {
        let mut output = Cursor::new(Vec::new());
        DynamicImage::ImageLuma8(pixels)
            .write_to(&mut output, ImageFormat::Png)
            .unwrap();
        output.into_inner()
    }

    fn code_128_fixture(payload: &str) -> Vec<u8> {
        encode_png(code_128_image(payload, 480, 160))
    }

    fn assert_bounded(rectangle: ImageRect, width: u32, height: u32) {
        assert!(rectangle.width > 0);
        assert!(rectangle.height > 0);
        assert!(rectangle.x.saturating_add(rectangle.width) <= width);
        assert!(rectangle.y.saturating_add(rectangle.height) <= height);
    }

    #[test]
    fn classifies_code_128_without_serializing_payload() {
        const PAYLOAD: &str = "SGTEST-ACCOUNT-001";
        let fixture = code_128_fixture(PAYLOAD);
        let report = inspect_barcodes(&fixture, DEFAULT_MAX_IMAGE_BYTES).unwrap();

        assert_eq!(report.findings[0].kind, BarcodeKind::Code128);
        assert_eq!(report.findings[0].encoded_length, PAYLOAD.chars().count());
        assert!(!serde_json::to_string(&report).unwrap().contains(PAYLOAD));
        assert_bounded(report.findings[0].rectangle, 480, 160);
        assert!(report.findings[0].rectangle.height >= 80);
    }

    #[test]
    fn detects_rotated_and_inverted_code_128_with_bounded_geometry() {
        let source = code_128_image("SGTEST-ROTATED-002", 480, 160);
        let rotated = image::imageops::rotate90(&source);
        let rotated_report =
            inspect_barcodes(&encode_png(rotated), DEFAULT_MAX_IMAGE_BYTES).unwrap();

        assert_eq!(rotated_report.findings.len(), 1);
        assert_bounded(rotated_report.findings[0].rectangle, 160, 480);
        assert!(rotated_report.findings[0].rectangle.width >= 80);

        let mut inverted = source;
        image::imageops::invert(&mut inverted);
        let inverted_report =
            inspect_barcodes(&encode_png(inverted), DEFAULT_MAX_IMAGE_BYTES).unwrap();
        assert_eq!(inverted_report.findings.len(), 1);
        assert_bounded(inverted_report.findings[0].rectangle, 480, 160);
    }

    #[test]
    fn finds_two_symbols_once_without_exposing_either_payload() {
        const FIRST: &str = "SGTEST-TOP-003";
        const SECOND: &str = "SGTEST-BOTTOM-004";
        let mut canvas = GrayImage::from_pixel(600, 520, Luma([255]));
        canvas
            .copy_from(&code_128_image(FIRST, 480, 140), 60, 20)
            .unwrap();
        canvas
            .copy_from(&code_128_image(SECOND, 480, 140), 60, 360)
            .unwrap();

        let report = inspect_barcodes(&encode_png(canvas), DEFAULT_MAX_IMAGE_BYTES).unwrap();
        let serialized = serde_json::to_string(&report).unwrap();

        assert_eq!(report.findings.len(), 2);
        assert_eq!(report.decoded_symbols, 2);
        assert!(report.warnings.is_empty());
        assert!(!serialized.contains(FIRST));
        assert!(!serialized.contains(SECOND));
        assert!(
            report
                .findings
                .iter()
                .all(|finding| finding.rectangle.height >= 80)
        );
    }

    #[test]
    fn opaque_redaction_makes_selected_barcode_undecodable() {
        let fixture = code_128_fixture("SGTEST-REDACT-005");
        let report = inspect_barcodes(&fixture, DEFAULT_MAX_IMAGE_BYTES).unwrap();
        let targets = report
            .findings
            .iter()
            .map(|finding| ImageRedactionTarget {
                id: finding.id.clone(),
                rectangles: vec![finding.rectangle],
            })
            .collect::<Vec<_>>();
        let redacted = redact_image(
            &fixture,
            DEFAULT_MAX_IMAGE_BYTES,
            &fingerprint(&fixture),
            &targets,
            &[],
        )
        .unwrap();
        let verification =
            inspect_barcodes(&redacted.cleaned_bytes, DEFAULT_MAX_IMAGE_BYTES).unwrap();

        assert!(verification.findings.is_empty());
        assert!(verification.warnings.is_empty());
    }

    #[test]
    fn synthetic_acceptance_fixture_has_three_symbols_without_exposing_payloads() {
        const PAYLOADS: [&str; 3] = ["SGTEST-000001", "5901234123457", "036000291452"];
        let fixture = include_bytes!("../../../fixtures/barcode-sensitive-sample.png");
        let report = inspect_barcodes(fixture, DEFAULT_MAX_IMAGE_BYTES).unwrap();
        let serialized = serde_json::to_string(&report).unwrap();

        assert_eq!(report.findings.len(), 3);
        assert_eq!(report.decoded_symbols, 3);
        assert!(report.warnings.is_empty());
        assert!(PAYLOADS.iter().all(|payload| !serialized.contains(payload)));
    }
}
