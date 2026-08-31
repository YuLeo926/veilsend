use veilsend_core::{
    FaceAvailability, FaceFinding, ImageFaceInspection, ImageRect, Severity, fingerprint,
};

const FACE_PADDING_RATIO: f64 = 0.12;
const MIN_FACE_PADDING: f64 = 2.0;

#[derive(Debug)]
pub enum FaceAdapterError {
    Unavailable(String),
    NeedsReview(String),
}

#[cfg(target_os = "windows")]
pub fn is_available() -> bool {
    use windows::Media::FaceAnalysis::FaceDetector;

    FaceDetector::IsSupported().unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
pub const fn is_available() -> bool {
    false
}

#[cfg(target_os = "windows")]
pub fn detect(input: &[u8]) -> Result<Vec<ImageRect>, FaceAdapterError> {
    use windows::{
        Graphics::Imaging::{BitmapDecoder, BitmapPixelFormat, SoftwareBitmap},
        Media::FaceAnalysis::FaceDetector,
        Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
    };

    if input.is_empty() {
        return Err(FaceAdapterError::NeedsReview(
            "The image was empty, so the local face check could not run.".to_owned(),
        ));
    }
    match FaceDetector::IsSupported() {
        Ok(true) => {}
        Ok(false) => {
            return Err(FaceAdapterError::Unavailable(
                "Local face detection is not supported by this Windows device.".to_owned(),
            ));
        }
        Err(_) => {
            return Err(FaceAdapterError::Unavailable(
                "Windows could not start local face detection on this device.".to_owned(),
            ));
        }
    }

    let operation = || -> windows::core::Result<Vec<ImageRect>> {
        let stream = InMemoryRandomAccessStream::new()?;
        let writer = DataWriter::CreateDataWriter(&stream)?;
        writer.WriteBytes(input)?;
        writer.StoreAsync()?.join()?;
        writer.DetachStream()?;
        stream.Seek(0)?;

        let decoder = BitmapDecoder::CreateAsync(&stream)?.join()?;
        let image_width = decoder.PixelWidth()?;
        let image_height = decoder.PixelHeight()?;
        let bitmap = decoder.GetSoftwareBitmapAsync()?.join()?;
        let source_format = bitmap.BitmapPixelFormat()?;
        let target_format = if FaceDetector::IsBitmapPixelFormatSupported(source_format)? {
            source_format
        } else if FaceDetector::IsBitmapPixelFormatSupported(BitmapPixelFormat::Gray8)? {
            BitmapPixelFormat::Gray8
        } else if FaceDetector::IsBitmapPixelFormatSupported(BitmapPixelFormat::Bgra8)? {
            BitmapPixelFormat::Bgra8
        } else {
            return Err(windows::core::Error::new(
                windows::core::HRESULT(0x80004005u32 as i32),
                "Windows face detection reported no usable pixel format.",
            ));
        };
        let prepared = if target_format == source_format {
            bitmap
        } else {
            SoftwareBitmap::Convert(&bitmap, target_format)?
        };

        let detector = FaceDetector::CreateAsync()?.join()?;
        let faces = detector.DetectFacesAsync(&prepared)?.join()?;
        let mut rectangles = Vec::new();
        for index in 0..faces.Size()? {
            let bounds = faces.GetAt(index)?.FaceBox()?;
            let rectangle = face_rect_from_bounds(
                bounds.X,
                bounds.Y,
                bounds.Width,
                bounds.Height,
                image_width,
                image_height,
            )
            .ok_or_else(|| {
                windows::core::Error::new(
                    windows::core::HRESULT(0x80070057u32 as i32),
                    "Windows returned an invalid face region.",
                )
            })?;
            if !rectangles.contains(&rectangle) {
                rectangles.push(rectangle);
            }
        }
        Ok(rectangles)
    };

    operation().map_err(|_| {
        FaceAdapterError::NeedsReview(
            "The local face check could not finish for this image. Review it before sharing."
                .to_owned(),
        )
    })
}

#[cfg(not(target_os = "windows"))]
pub fn detect(_input: &[u8]) -> Result<Vec<ImageRect>, FaceAdapterError> {
    Err(FaceAdapterError::Unavailable(
        "Local face detection is currently available on Windows.".to_owned(),
    ))
}

pub fn inspect(input: &[u8]) -> ImageFaceInspection {
    inspection_from_detection(detect(input))
}

fn inspection_from_detection(
    result: Result<Vec<ImageRect>, FaceAdapterError>,
) -> ImageFaceInspection {
    match result {
        Ok(rectangles) => {
            let findings = rectangles
                .into_iter()
                .map(|rectangle| {
                    let region_key = format!(
                        "{}:{}:{}:{}",
                        rectangle.x, rectangle.y, rectangle.width, rectangle.height
                    );
                    FaceFinding {
                        id: format!("face-{}", &fingerprint(region_key.as_bytes())[..16]),
                        label: "Face".to_owned(),
                        explanation: "A visible face can identify a person. VeilSend detects only its location and does not infer identity or personal attributes."
                            .to_owned(),
                        severity: Severity::High,
                        rectangle,
                    }
                })
                .collect::<Vec<_>>();
            let message = if findings.is_empty() {
                "The local face check completed and found no face regions. Detection can still miss obscured or unusual faces."
                    .to_owned()
            } else {
                format!(
                    "The local face check found {} possible face {}. Identity and personal attributes were not inferred.",
                    findings.len(),
                    if findings.len() == 1 {
                        "region"
                    } else {
                        "regions"
                    }
                )
            };
            ImageFaceInspection {
                availability: FaceAvailability::Available,
                findings,
                message,
            }
        }
        Err(FaceAdapterError::Unavailable(message)) => ImageFaceInspection {
            availability: FaceAvailability::Unavailable,
            findings: Vec::new(),
            message,
        },
        Err(FaceAdapterError::NeedsReview(message)) => ImageFaceInspection {
            availability: FaceAvailability::NeedsReview,
            findings: Vec::new(),
            message,
        },
    }
}

fn face_rect_from_bounds(
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    image_width: u32,
    image_height: u32,
) -> Option<ImageRect> {
    if width == 0 || height == 0 {
        return None;
    }
    let horizontal_padding = (f64::from(width) * FACE_PADDING_RATIO).max(MIN_FACE_PADDING);
    let vertical_padding = (f64::from(height) * FACE_PADDING_RATIO).max(MIN_FACE_PADDING);
    clamp_outward(
        f64::from(x) - horizontal_padding,
        f64::from(y) - vertical_padding,
        f64::from(x.saturating_add(width)) + horizontal_padding,
        f64::from(y.saturating_add(height)) + vertical_padding,
        image_width,
        image_height,
    )
}

fn clamp_outward(
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
    image_width: u32,
    image_height: u32,
) -> Option<ImageRect> {
    if !left.is_finite()
        || !top.is_finite()
        || !right.is_finite()
        || !bottom.is_finite()
        || image_width == 0
        || image_height == 0
        || right <= left
        || bottom <= top
    {
        return None;
    }

    let x = left.floor().max(0.0).min(f64::from(image_width)) as u32;
    let y = top.floor().max(0.0).min(f64::from(image_height)) as u32;
    let right = right.ceil().max(0.0).min(f64::from(image_width)) as u32;
    let bottom = bottom.ceil().max(0.0).min(f64::from(image_height)) as u32;
    (right > x && bottom > y).then_some(ImageRect {
        x,
        y,
        width: right - x,
        height: bottom - y,
    })
}

#[cfg(test)]
mod tests {
    use veilsend_core::{FaceAvailability, ImageRect};

    use super::*;

    #[test]
    fn clamps_fractional_and_negative_edges_outward() {
        assert_eq!(
            clamp_outward(-1.25, 3.4, 20.2, 10.5, 18, 20),
            Some(ImageRect {
                x: 0,
                y: 3,
                width: 18,
                height: 8,
            })
        );
    }

    #[test]
    fn maps_unsupported_and_invalid_geometry_fail_visibly() {
        let unavailable = inspection_from_detection(Err(FaceAdapterError::Unavailable(
            "Local face detection is unavailable.".to_owned(),
        )));
        assert_eq!(unavailable.availability, FaceAvailability::Unavailable);

        let invalid = inspection_from_detection(Err(FaceAdapterError::NeedsReview(
            "A face region was invalid.".to_owned(),
        )));
        assert_eq!(invalid.availability, FaceAvailability::NeedsReview);
    }

    #[test]
    fn successful_regions_become_high_severity_location_only_findings() {
        let inspection = inspection_from_detection(Ok(vec![ImageRect {
            x: 10,
            y: 20,
            width: 80,
            height: 90,
        }]));

        assert_eq!(inspection.availability, FaceAvailability::Available);
        assert_eq!(inspection.findings.len(), 1);
        assert_eq!(
            inspection.findings[0].severity,
            veilsend_core::Severity::High
        );
        assert_eq!(inspection.findings[0].label, "Face");
        assert!(!serde_json::to_string(&inspection).unwrap().contains("crop"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "requires Windows local face detection support on the test machine"]
    fn recognizes_the_synthetic_acceptance_fixture() {
        let rectangles = detect(include_bytes!("../../fixtures/visual-sensitive-sample.png"))
            .expect("Windows face detection should be available for the acceptance fixture");

        assert_eq!(rectangles.len(), 1);
        assert!(rectangles[0].width > 100);
        assert!(rectangles[0].height > 100);
    }
}
