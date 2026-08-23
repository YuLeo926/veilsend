use bytes::Bytes;
use exif::{Context, In, Reader, Tag};
use img_parts::ImageEXIF;
use img_parts::jpeg::{Jpeg, markers};
use img_parts::png::Png;

use crate::{
    ImageFormat, ImageInspection, ImageMetadataCategory, ImageMetadataFinding, ImageSanitizeResult,
    ImageVerification, Severity, VeilSendError, fingerprint,
};

pub const DEFAULT_MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;

const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
const JPEG_XMP_PREFIX: &[u8] = b"http://ns.adobe.com/xap/1.0/\0";
const JPEG_XMP_EXTENSION_PREFIX: &[u8] = b"http://ns.adobe.com/xmp/extension/\0";

const PNG_IHDR: [u8; 4] = *b"IHDR";
const PNG_IDAT: [u8; 4] = *b"IDAT";
const PNG_FDAT: [u8; 4] = *b"fdAT";
const PNG_EXIF: [u8; 4] = *b"eXIf";
const PNG_TEXT: [u8; 4] = *b"tEXt";
const PNG_ZTXT: [u8; 4] = *b"zTXt";
const PNG_ITXT: [u8; 4] = *b"iTXt";
const PNG_TIME: [u8; 4] = *b"tIME";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OrientationState {
    Safe,
    NeedsNormalization(u32),
    Unknown,
}

pub fn inspect_image(input: &[u8], max_bytes: usize) -> Result<ImageInspection, VeilSendError> {
    if input.len() > max_bytes {
        return Err(VeilSendError::ContentTooLarge(max_bytes));
    }

    if input.starts_with(&[0xff, 0xd8]) {
        inspect_jpeg(input)
    } else if input.starts_with(PNG_SIGNATURE) {
        inspect_png(input)
    } else {
        Err(VeilSendError::UnsupportedImage)
    }
}

pub fn sanitize_image(
    input: &[u8],
    max_bytes: usize,
) -> Result<ImageSanitizeResult, VeilSendError> {
    let before = inspect_image(input, max_bytes)?;
    if !before.can_clean_losslessly {
        if let Some(orientation) = before
            .warnings
            .iter()
            .find_map(|warning| warning.strip_prefix("EXIF orientation "))
            .and_then(|value| value.split_whitespace().next())
            .and_then(|value| value.parse::<u32>().ok())
        {
            return Err(VeilSendError::OrientationNeedsNormalization(orientation));
        }
        return Err(VeilSendError::InvalidImage(
            "EXIF metadata could not be parsed well enough to confirm a safe display orientation."
                .to_owned(),
        ));
    }

    let cleaned_bytes = match before.format {
        ImageFormat::Jpeg => clean_jpeg(input)?,
        ImageFormat::Png => clean_png(input)?,
    };
    let after = inspect_image(&cleaned_bytes, max_bytes)?;
    let pixels_unchanged = before.pixel_fingerprint == after.pixel_fingerprint;
    let remaining_findings = after.findings.len();
    let verified = remaining_findings == 0 && pixels_unchanged;

    Ok(ImageSanitizeResult {
        original_bytes: input.len(),
        cleaned_size: cleaned_bytes.len(),
        removed_findings: before.findings.len().saturating_sub(remaining_findings),
        cleaned_bytes,
        verification: ImageVerification {
            verified,
            remaining_findings,
            pixels_unchanged,
            message: if verified {
                "Privacy metadata removed and pixel data verified unchanged.".to_owned()
            } else if !pixels_unchanged {
                "Verification failed because the image pixel stream changed.".to_owned()
            } else {
                "Some removable metadata remains in the clean copy.".to_owned()
            },
        },
    })
}

fn inspect_jpeg(input: &[u8]) -> Result<ImageInspection, VeilSendError> {
    let jpeg = Jpeg::from_bytes(Bytes::copy_from_slice(input)).map_err(invalid_image)?;
    let (width, height) = jpeg_dimensions(&jpeg)
        .ok_or_else(|| VeilSendError::InvalidImage("JPEG dimensions are missing.".to_owned()))?;
    let pixel_bytes = jpeg
        .segments()
        .iter()
        .find(|segment| segment.marker() == markers::SOS)
        .map(|segment| segment.clone().encoder().bytes())
        .ok_or_else(|| VeilSendError::InvalidImage("JPEG pixel data is missing.".to_owned()))?;

    let mut findings = Vec::new();
    let mut orientation = OrientationState::Safe;
    if let Some(exif) = jpeg.exif() {
        orientation = append_exif_findings(&mut findings, &exif);
    }

    let mut has_xmp = false;
    let mut has_comment = false;
    let mut has_iptc = false;
    let mut has_unknown_app1 = false;
    for segment in jpeg.segments() {
        match segment.marker() {
            markers::COM => has_comment = true,
            markers::APP13 => has_iptc = true,
            markers::APP1
                if segment.contents().starts_with(JPEG_XMP_PREFIX)
                    || segment.contents().starts_with(JPEG_XMP_EXTENSION_PREFIX) =>
            {
                has_xmp = true;
            }
            markers::APP1 if !segment.contents().starts_with(b"Exif\0\0") => {
                has_unknown_app1 = true;
            }
            _ => {}
        }
    }
    if has_xmp {
        findings.push(container_finding(
            "jpeg-xmp",
            "XMP document metadata",
            "XMP can contain creator details, editing history, ratings, labels, and location fields.",
            ImageMetadataCategory::Identity,
            Severity::High,
            "<hidden XMP packet>",
        ));
    }
    if has_iptc {
        findings.push(container_finding(
            "jpeg-iptc",
            "IPTC / Photoshop metadata",
            "Publishing metadata may contain author, agency, caption, copyright, and workflow details.",
            ImageMetadataCategory::Identity,
            Severity::High,
            "<hidden publishing metadata>",
        ));
    }
    if has_comment {
        findings.push(container_finding(
            "jpeg-comment",
            "Embedded JPEG comment",
            "Comments are invisible in the image but can be read by recipients and online services.",
            ImageMetadataCategory::Description,
            Severity::Medium,
            "<hidden comment>",
        ));
    }
    if has_unknown_app1 {
        findings.push(container_finding(
            "jpeg-app1",
            "Additional application metadata",
            "A non-standard metadata block is embedded in this JPEG and will be removed from the clean copy.",
            ImageMetadataCategory::Other,
            Severity::Medium,
            "<hidden application metadata>",
        ));
    }

    let mut warnings = Vec::new();
    let can_clean_losslessly = match orientation {
        OrientationState::NeedsNormalization(value) => {
            warnings.push(format!(
                "EXIF orientation {value} controls how this image is displayed. Normalize it before lossless metadata removal."
            ));
            false
        }
        OrientationState::Unknown => {
            warnings.push("EXIF metadata could not be parsed well enough to confirm the display orientation. Use an image editor to normalize the image before cleaning.".to_owned());
            false
        }
        OrientationState::Safe => true,
    };

    Ok(ImageInspection {
        format: ImageFormat::Jpeg,
        bytes: input.len(),
        width: Some(width),
        height: Some(height),
        findings,
        can_clean_losslessly,
        warnings,
        pixel_fingerprint: fingerprint(&pixel_bytes),
    })
}

fn inspect_png(input: &[u8]) -> Result<ImageInspection, VeilSendError> {
    let png = Png::from_bytes(Bytes::copy_from_slice(input)).map_err(invalid_image)?;
    let (width, height) = png_dimensions(&png)
        .ok_or_else(|| VeilSendError::InvalidImage("PNG dimensions are missing.".to_owned()))?;
    let mut pixel_bytes = Vec::new();
    for chunk in png.chunks() {
        if matches!(chunk.kind(), PNG_IDAT | PNG_FDAT) {
            pixel_bytes.extend_from_slice(chunk.contents());
        }
    }
    if pixel_bytes.is_empty() {
        return Err(VeilSendError::InvalidImage(
            "PNG pixel data is missing.".to_owned(),
        ));
    }

    let mut findings = Vec::new();
    let mut orientation = OrientationState::Safe;
    if let Some(exif) = png.exif() {
        orientation = append_exif_findings(&mut findings, &exif);
    }
    let has_text = png
        .chunks()
        .iter()
        .any(|chunk| matches!(chunk.kind(), PNG_TEXT | PNG_ZTXT | PNG_ITXT));
    let has_time = png.chunks().iter().any(|chunk| chunk.kind() == PNG_TIME);
    if has_text {
        findings.push(container_finding(
            "png-text",
            "PNG text metadata",
            "Text chunks can contain author names, descriptions, software details, prompts, or workflow notes.",
            ImageMetadataCategory::Description,
            Severity::Medium,
            "<hidden text metadata>",
        ));
    }
    if has_time {
        findings.push(container_finding(
            "png-time",
            "Image modification time",
            "The file contains a timestamp that can reveal when the image was last changed.",
            ImageMetadataCategory::Time,
            Severity::Low,
            "<hidden timestamp>",
        ));
    }

    let mut warnings = Vec::new();
    let can_clean_losslessly = match orientation {
        OrientationState::NeedsNormalization(value) => {
            warnings.push(format!(
                "EXIF orientation {value} controls how this image is displayed. Normalize it before lossless metadata removal."
            ));
            false
        }
        OrientationState::Unknown => {
            warnings.push("EXIF metadata could not be parsed well enough to confirm the display orientation. Use an image editor to normalize the image before cleaning.".to_owned());
            false
        }
        OrientationState::Safe => true,
    };

    Ok(ImageInspection {
        format: ImageFormat::Png,
        bytes: input.len(),
        width: Some(width),
        height: Some(height),
        findings,
        can_clean_losslessly,
        warnings,
        pixel_fingerprint: fingerprint(&pixel_bytes),
    })
}

fn clean_jpeg(input: &[u8]) -> Result<Vec<u8>, VeilSendError> {
    let mut jpeg = Jpeg::from_bytes(Bytes::copy_from_slice(input)).map_err(invalid_image)?;
    jpeg.segments_mut().retain(|segment| {
        !matches!(
            segment.marker(),
            markers::APP1 | markers::APP13 | markers::COM
        )
    });
    Ok(jpeg.encoder().bytes().to_vec())
}

fn clean_png(input: &[u8]) -> Result<Vec<u8>, VeilSendError> {
    let mut png = Png::from_bytes(Bytes::copy_from_slice(input)).map_err(invalid_image)?;
    png.chunks_mut().retain(|chunk| {
        !matches!(
            chunk.kind(),
            PNG_EXIF | PNG_TEXT | PNG_ZTXT | PNG_ITXT | PNG_TIME
        )
    });
    Ok(png.encoder().bytes().to_vec())
}

fn append_exif_findings(
    findings: &mut Vec<ImageMetadataFinding>,
    raw_exif: &[u8],
) -> OrientationState {
    let Ok(exif) = Reader::new().read_raw(raw_exif.to_vec()) else {
        findings.push(container_finding(
            "exif-block",
            "EXIF metadata block",
            "The image contains EXIF data that could not be safely summarized. The full block will be removed.",
            ImageMetadataCategory::Other,
            Severity::High,
            "<hidden EXIF data>",
        ));
        return OrientationState::Unknown;
    };

    let orientation = exif
        .get_field(Tag::Orientation, In::PRIMARY)
        .and_then(|field| field.value.get_uint(0));
    let mut location = false;
    let mut device = false;
    let mut identity = false;
    let mut time = false;
    let mut description = false;
    let mut other = false;

    for field in exif.fields() {
        let tag = field.tag;
        if tag.context() == Context::Gps {
            location = true;
        } else if matches!(
            tag,
            Tag::Make
                | Tag::Model
                | Tag::CameraOwnerName
                | Tag::BodySerialNumber
                | Tag::LensMake
                | Tag::LensModel
                | Tag::LensSerialNumber
                | Tag::ImageUniqueID
        ) {
            device = true;
        } else if matches!(tag, Tag::Artist | Tag::Copyright) {
            identity = true;
        } else if matches!(
            tag,
            Tag::DateTime
                | Tag::DateTimeOriginal
                | Tag::DateTimeDigitized
                | Tag::OffsetTime
                | Tag::OffsetTimeOriginal
                | Tag::OffsetTimeDigitized
        ) {
            time = true;
        } else if matches!(tag, Tag::ImageDescription | Tag::UserComment) {
            description = true;
        } else if tag != Tag::Orientation {
            other = true;
        }
    }

    if location {
        findings.push(container_finding(
            "exif-location",
            "Embedded location data",
            "GPS metadata can reveal where the image was captured, including coordinates and altitude.",
            ImageMetadataCategory::Location,
            Severity::Critical,
            "<hidden coordinates>",
        ));
    }
    if device {
        findings.push(container_finding(
            "exif-device",
            "Camera and device identity",
            "Camera model, owner, lens, serial numbers, or unique image identifiers may fingerprint the source device.",
            ImageMetadataCategory::Device,
            Severity::High,
            "<hidden device details>",
        ));
    }
    if identity {
        findings.push(container_finding(
            "exif-identity",
            "Creator and ownership details",
            "Author or copyright fields can disclose a person's or organization's identity.",
            ImageMetadataCategory::Identity,
            Severity::High,
            "<hidden identity details>",
        ));
    }
    if time {
        findings.push(container_finding(
            "exif-time",
            "Capture and edit timestamps",
            "Timestamps and time-zone offsets can reveal when the image was created or edited.",
            ImageMetadataCategory::Time,
            Severity::Medium,
            "<hidden timestamps>",
        ));
    }
    if description {
        findings.push(container_finding(
            "exif-description",
            "Image description or comment",
            "Descriptions and user comments are not visible in the pixels but travel with the image.",
            ImageMetadataCategory::Description,
            Severity::Medium,
            "<hidden description>",
        ));
    }
    if other || findings.is_empty() {
        findings.push(container_finding(
            "exif-other",
            "Additional EXIF metadata",
            "Technical EXIF fields can reveal capture settings, editing software, and other source context.",
            ImageMetadataCategory::Other,
            Severity::Low,
            "<hidden EXIF details>",
        ));
    }

    match orientation {
        Some(value @ 2..=8) => OrientationState::NeedsNormalization(value),
        _ => OrientationState::Safe,
    }
}

fn container_finding(
    id: &str,
    label: &str,
    explanation: &str,
    category: ImageMetadataCategory,
    severity: Severity,
    masked_value: &str,
) -> ImageMetadataFinding {
    ImageMetadataFinding {
        id: id.to_owned(),
        label: label.to_owned(),
        explanation: explanation.to_owned(),
        category,
        severity,
        masked_value: masked_value.to_owned(),
    }
}

fn jpeg_dimensions(jpeg: &Jpeg) -> Option<(u32, u32)> {
    jpeg.segments().iter().find_map(|segment| {
        if !matches!(
            segment.marker(),
            markers::SOF0
                | markers::SOF1
                | markers::SOF2
                | markers::SOF3
                | markers::SOF5
                | markers::SOF6
                | markers::SOF7
                | markers::SOF9
                | markers::SOF10
                | markers::SOF11
                | markers::SOF13
                | markers::SOF14
                | markers::SOF15
        ) {
            return None;
        }
        let contents = segment.contents();
        (contents.len() >= 5).then(|| {
            let height = u16::from_be_bytes([contents[1], contents[2]]) as u32;
            let width = u16::from_be_bytes([contents[3], contents[4]]) as u32;
            (width, height)
        })
    })
}

fn png_dimensions(png: &Png) -> Option<(u32, u32)> {
    let contents = png.chunk_by_type(PNG_IHDR)?.contents();
    (contents.len() >= 8).then(|| {
        let width = u32::from_be_bytes(contents[0..4].try_into().expect("four bytes"));
        let height = u32::from_be_bytes(contents[4..8].try_into().expect("four bytes"));
        (width, height)
    })
}

fn invalid_image(error: img_parts::Error) -> VeilSendError {
    VeilSendError::InvalidImage(error.to_string())
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::{DynamicImage, ImageFormat as EncodedFormat, Rgb, RgbImage};
    use img_parts::jpeg::JpegSegment;
    use img_parts::png::PngChunk;

    use super::*;

    fn encoded_image(format: EncodedFormat) -> Vec<u8> {
        let image = DynamicImage::ImageRgb8(RgbImage::from_pixel(2, 2, Rgb([12, 34, 56])));
        let mut output = Cursor::new(Vec::new());
        image.write_to(&mut output, format).unwrap();
        output.into_inner()
    }

    fn exif_with_orientation(value: u16) -> Bytes {
        let mut bytes = vec![
            b'I', b'I', 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00,
            0x01, 0x00, 0x00, 0x00,
        ];
        bytes.extend_from_slice(&value.to_le_bytes());
        bytes.extend_from_slice(&[0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
        Bytes::from(bytes)
    }

    #[test]
    fn removes_jpeg_exif_and_comments_without_changing_pixels() {
        let mut jpeg = Jpeg::from_bytes(encoded_image(EncodedFormat::Jpeg).into()).unwrap();
        jpeg.set_exif(Some(exif_with_orientation(1)));
        jpeg.segments_mut().insert(
            1,
            JpegSegment::new_with_contents(markers::COM, Bytes::from_static(b"private note")),
        );
        let source = jpeg.encoder().bytes();

        let before = inspect_image(&source, DEFAULT_MAX_IMAGE_BYTES).unwrap();
        assert!(before.findings.len() >= 2);
        let result = sanitize_image(&source, DEFAULT_MAX_IMAGE_BYTES).unwrap();
        assert!(result.verification.verified);
        assert!(result.verification.pixels_unchanged);
        assert!(
            inspect_image(&result.cleaned_bytes, DEFAULT_MAX_IMAGE_BYTES)
                .unwrap()
                .findings
                .is_empty()
        );
    }

    #[test]
    fn removes_png_text_and_time_without_changing_pixels() {
        let mut png = Png::from_bytes(encoded_image(EncodedFormat::Png).into()).unwrap();
        let insertion = png.chunks().len() - 1;
        png.chunks_mut().insert(
            insertion,
            PngChunk::new(PNG_TEXT, Bytes::from_static(b"Author\0Private Person")),
        );
        png.chunks_mut().insert(
            insertion + 1,
            PngChunk::new(PNG_TIME, Bytes::from_static(&[0x07, 0xea, 8, 12, 20, 1, 2])),
        );
        let source = png.encoder().bytes();

        let result = sanitize_image(&source, DEFAULT_MAX_IMAGE_BYTES).unwrap();
        assert!(result.verification.verified);
        assert!(result.verification.pixels_unchanged);
        assert_eq!(result.removed_findings, 2);
    }

    #[test]
    fn blocks_lossless_cleanup_when_orientation_controls_display() {
        let mut jpeg = Jpeg::from_bytes(encoded_image(EncodedFormat::Jpeg).into()).unwrap();
        jpeg.set_exif(Some(exif_with_orientation(6)));
        let source = jpeg.encoder().bytes();

        let inspection = inspect_image(&source, DEFAULT_MAX_IMAGE_BYTES).unwrap();
        assert!(!inspection.can_clean_losslessly);
        assert!(matches!(
            sanitize_image(&source, DEFAULT_MAX_IMAGE_BYTES),
            Err(VeilSendError::OrientationNeedsNormalization(6))
        ));
    }

    #[test]
    fn rejects_unsupported_and_oversized_images() {
        assert!(matches!(
            inspect_image(b"GIF89a", DEFAULT_MAX_IMAGE_BYTES),
            Err(VeilSendError::UnsupportedImage)
        ));
        assert!(matches!(
            inspect_image(&[0xff, 0xd8, 0xff, 0xd9], 2),
            Err(VeilSendError::ContentTooLarge(2))
        ));
    }

    #[test]
    fn blocks_cleanup_when_exif_orientation_cannot_be_parsed() {
        let mut png = Png::from_bytes(encoded_image(EncodedFormat::Png).into()).unwrap();
        png.set_exif(Some(Bytes::from_static(b"not valid TIFF data")));
        let source = png.encoder().bytes();

        let inspection = inspect_image(&source, DEFAULT_MAX_IMAGE_BYTES).unwrap();
        assert!(!inspection.can_clean_losslessly);
        assert!(matches!(
            sanitize_image(&source, DEFAULT_MAX_IMAGE_BYTES),
            Err(VeilSendError::InvalidImage(_))
        ));
    }
}
