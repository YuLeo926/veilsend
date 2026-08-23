use image::GenericImageView;

use crate::{ImageRect, QrFinding, QrKind, QrScanReport, Severity, VeilSendError, inspect_image};

const MAX_DECODED_PIXELS: u64 = 40_000_000;
const QR_MIN_MARGIN: u32 = 8;

pub fn inspect_qr_codes(input: &[u8], max_bytes: usize) -> Result<QrScanReport, VeilSendError> {
    let inspection = inspect_image(input, max_bytes)?;
    let width = inspection.width.ok_or_else(|| {
        VeilSendError::InvalidImage("The image width could not be read.".to_owned())
    })?;
    let height = inspection.height.ok_or_else(|| {
        VeilSendError::InvalidImage("The image height could not be read.".to_owned())
    })?;
    if u64::from(width) * u64::from(height) > MAX_DECODED_PIXELS {
        return Err(VeilSendError::InvalidImage(format!(
            "The image expands beyond VeilSend's {MAX_DECODED_PIXELS}-pixel QR inspection limit."
        )));
    }

    let decoded = image::load_from_memory(input)
        .map_err(|error| VeilSendError::InvalidImage(error.to_string()))?;
    if decoded.dimensions() != (width, height) {
        return Err(VeilSendError::InvalidImage(
            "The decoded image dimensions do not match its container.".to_owned(),
        ));
    }

    let grayscale = decoded.to_luma8();
    let mut decoder = quircs::Quirc::default();
    let codes = decoder.identify(width as usize, height as usize, grayscale.as_raw());
    let mut grids_detected = 0;
    let mut findings = Vec::new();
    let mut decoded_grids = 0;
    let mut warnings = Vec::new();

    for (index, code) in codes.enumerate() {
        grids_detected += 1;
        let code = match code {
            Ok(code) => code,
            Err(_) => {
                warnings.push(format!(
                    "QR-like region {} could not be extracted safely.",
                    index + 1
                ));
                continue;
            }
        };
        let Some(rectangle) = rectangle_from_bounds(&code.corners, width, height) else {
            warnings.push(format!(
                "QR-like grid {} had invalid image geometry and could not be reviewed safely.",
                index + 1
            ));
            continue;
        };

        let decoded_payload = code.decode().ok().map(|data| data.payload);
        if decoded_payload.is_some() {
            decoded_grids += 1;
        }
        findings.push(qr_finding(index, rectangle, decoded_payload.as_deref()));
    }

    Ok(QrScanReport {
        findings,
        grids_detected,
        decoded_grids,
        warnings,
    })
}

fn rectangle_from_bounds(
    bounds: &[quircs::Point; 4],
    width: u32,
    height: u32,
) -> Option<ImageRect> {
    if width == 0 || height == 0 {
        return None;
    }

    let min_x = bounds.iter().map(|point| point.x).min()?;
    let max_x = bounds.iter().map(|point| point.x).max()?;
    let min_y = bounds.iter().map(|point| point.y).min()?;
    let max_y = bounds.iter().map(|point| point.y).max()?;
    if max_x <= min_x || max_y <= min_y {
        return None;
    }

    let left = min_x.max(0) as u32;
    let top = min_y.max(0) as u32;
    let right = (i64::from(max_x) + 1).clamp(0, i64::from(width)) as u32;
    let bottom = (i64::from(max_y) + 1).clamp(0, i64::from(height)) as u32;
    if right <= left || bottom <= top {
        return None;
    }

    let detected_width = right - left;
    let detected_height = bottom - top;
    let margin = QR_MIN_MARGIN.max(detected_width.min(detected_height) / 20);
    let x = left.saturating_sub(margin);
    let y = top.saturating_sub(margin);
    let padded_right = right.saturating_add(margin).min(width);
    let padded_bottom = bottom.saturating_add(margin).min(height);

    Some(ImageRect {
        x,
        y,
        width: padded_right - x,
        height: padded_bottom - y,
    })
}

fn qr_finding(index: usize, rectangle: ImageRect, payload: Option<&[u8]>) -> QrFinding {
    let identity = payload.map_or_else(
        || {
            format!(
                "{}:{}:{}:{}",
                rectangle.x, rectangle.y, rectangle.width, rectangle.height
            )
        },
        crate::fingerprint,
    );
    let opaque_id = &crate::fingerprint(identity.as_bytes())[..8];
    let (kind, label, explanation, severity, masked_value) = match payload {
        Some(payload) => {
            let (kind, label, explanation, severity) = classify_payload(payload);
            (
                kind,
                label,
                explanation,
                severity,
                format!("{label} · {} encoded bytes", payload.len()),
            )
        }
        None => (
            QrKind::Undecodable,
            "Unreadable QR-like code",
            "A QR grid was located but its contents could not be decoded. Treat the whole region as sensitive unless you can verify it separately.",
            Severity::High,
            "Unreadable QR-like code · payload hidden".to_owned(),
        ),
    };

    QrFinding {
        id: format!("qr-{index}-{opaque_id}"),
        kind,
        label: label.to_owned(),
        explanation: explanation.to_owned(),
        severity,
        masked_value,
        rectangle,
    }
}

fn classify_payload(payload: &[u8]) -> (QrKind, &'static str, &'static str, Severity) {
    let normalized = String::from_utf8_lossy(payload)
        .trim_start()
        .to_ascii_uppercase();
    if normalized.starts_with("WIFI:") {
        (
            QrKind::WifiCredential,
            "Wi-Fi credential",
            "This QR code can contain a network name, password, and connection settings.",
            Severity::Critical,
        )
    } else if normalized.starts_with("HTTP://") || normalized.starts_with("HTTPS://") {
        (
            QrKind::WebLink,
            "Web link",
            "Encoded links can contain private destinations, sign-in tokens, or tracking identifiers.",
            Severity::High,
        )
    } else if normalized.starts_with("BEGIN:VCARD") || normalized.starts_with("MECARD:") {
        (
            QrKind::ContactCard,
            "Contact card",
            "This QR code can contain names, phone numbers, email addresses, and organization details.",
            Severity::High,
        )
    } else if ["MAILTO:", "TEL:", "SMS:", "SMSTO:"]
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
    {
        (
            QrKind::CommunicationLink,
            "Communication link",
            "This QR code can expose an email address, phone number, recipient, or prepared message.",
            Severity::Medium,
        )
    } else {
        (
            QrKind::EncodedContent,
            "Encoded content",
            "The QR code contains data that recipients can read even when it is not visible as text.",
            Severity::Medium,
        )
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::{DynamicImage, GenericImage, GrayImage, ImageFormat, Luma, imageops};
    use qrcode::{QrCode, types::Color};

    use super::*;
    use crate::{DEFAULT_MAX_IMAGE_BYTES, ImageRedactionTarget, fingerprint, redact_image};

    fn render_qr(payload: &str) -> GrayImage {
        let code = QrCode::new(payload.as_bytes()).unwrap();
        let module_count = code.width() as u32;
        let quiet_zone = 4;
        let scale = 7;
        let size = (module_count + quiet_zone * 2) * scale;
        let mut image = GrayImage::from_pixel(size, size, Luma([255]));
        for y in 0..module_count {
            for x in 0..module_count {
                if code[(x as usize, y as usize)] == Color::Dark {
                    for pixel_y in 0..scale {
                        for pixel_x in 0..scale {
                            image.put_pixel(
                                (x + quiet_zone) * scale + pixel_x,
                                (y + quiet_zone) * scale + pixel_y,
                                Luma([0]),
                            );
                        }
                    }
                }
            }
        }
        image
    }

    fn encode_png(image: GrayImage) -> Vec<u8> {
        let mut output = Cursor::new(Vec::new());
        DynamicImage::ImageLuma8(image)
            .write_to(&mut output, ImageFormat::Png)
            .unwrap();
        output.into_inner()
    }

    #[test]
    fn classifies_sensitive_qr_payload_types() {
        assert_eq!(
            classify_payload(b"WIFI:T:WPA;S:Example;P:fake;;").0,
            QrKind::WifiCredential
        );
        assert_eq!(
            classify_payload(b"https://example.com/sign-in?token=fake").0,
            QrKind::WebLink
        );
        assert_eq!(
            classify_payload(b"BEGIN:VCARD\nFN:Example\nEND:VCARD").0,
            QrKind::ContactCard
        );
        assert_eq!(
            classify_payload(b"mailto:person@example.com").0,
            QrKind::CommunicationLink
        );
        assert_eq!(
            classify_payload(b"ordinary encoded note").0,
            QrKind::EncodedContent
        );
    }

    #[test]
    fn detects_rotated_qr_without_exposing_its_payload() {
        let payload = "https://example.com/private?token=FAKE-QR-TOKEN";
        let source = encode_png(imageops::rotate90(&render_qr(payload)));
        let report = inspect_qr_codes(&source, DEFAULT_MAX_IMAGE_BYTES).unwrap();

        assert_eq!(report.grids_detected, 1);
        assert_eq!(report.decoded_grids, 1);
        assert_eq!(report.findings[0].kind, QrKind::WebLink);
        assert!(!serde_json::to_string(&report).unwrap().contains(payload));
        assert!(!report.findings[0].masked_value.contains("example.com"));
        assert!(report.findings[0].rectangle.width > 0);
    }

    #[test]
    fn detects_multiple_qr_codes_in_one_image() {
        let first = render_qr("https://example.com/first");
        let second = render_qr("WIFI:T:WPA;S:Example;P:fake-password;;");
        let mut canvas = GrayImage::from_pixel(
            first.width() + second.width() + 80,
            first.height().max(second.height()) + 40,
            Luma([255]),
        );
        canvas.copy_from(&first, 20, 20).unwrap();
        canvas.copy_from(&second, first.width() + 60, 20).unwrap();

        let report = inspect_qr_codes(&encode_png(canvas), DEFAULT_MAX_IMAGE_BYTES).unwrap();

        assert_eq!(report.grids_detected, 2);
        assert_eq!(report.decoded_grids, 2);
        assert_eq!(report.findings.len(), 2);
    }

    #[test]
    fn represents_decode_failure_as_a_high_severity_finding() {
        let finding = qr_finding(
            0,
            ImageRect {
                x: 5,
                y: 6,
                width: 70,
                height: 70,
            },
            None,
        );

        assert_eq!(finding.kind, QrKind::Undecodable);
        assert_eq!(finding.severity, Severity::High);
        assert!(!finding.masked_value.is_empty());
    }

    #[test]
    fn redaction_makes_the_saved_pixels_undecodable() {
        let source = encode_png(render_qr("WIFI:T:WPA;S:Example;P:fake-password;;"));
        let before = inspect_qr_codes(&source, DEFAULT_MAX_IMAGE_BYTES).unwrap();
        let finding = &before.findings[0];
        let target = ImageRedactionTarget {
            id: finding.id.clone(),
            rectangles: vec![finding.rectangle],
        };

        let redacted = redact_image(
            &source,
            DEFAULT_MAX_IMAGE_BYTES,
            &fingerprint(&source),
            &[target],
            &[],
        )
        .unwrap();
        let after = inspect_qr_codes(&redacted.cleaned_bytes, DEFAULT_MAX_IMAGE_BYTES).unwrap();

        assert_eq!(before.grids_detected, 1);
        assert_eq!(redacted.redacted_findings, 1);
        assert_eq!(after.grids_detected, 0);
    }
}
