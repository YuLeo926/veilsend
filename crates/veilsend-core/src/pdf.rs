use crate::{ImageRect, NormalizedRect, VeilSendError};
use flate2::{Compression, read::ZlibDecoder, write::ZlibEncoder};
use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref};
use std::io::{Read, Write};

pub const DEFAULT_MAX_PDF_PAGES: usize = 50;
pub const DEFAULT_MAX_PDF_SOURCE_BYTES: usize = 50 * 1024 * 1024;
pub const DEFAULT_MAX_PDF_PAGE_PIXELS: u64 = 40_000_000;
pub const DEFAULT_MAX_PDF_TOTAL_PIXELS: u64 = 120_000_000;
pub const DEFAULT_MAX_PDF_OUTPUT_BYTES: usize = 300 * 1024 * 1024;
pub const DEFAULT_PDF_RENDER_DPI: u32 = 144;
const PDF_WRITER_FINALIZATION_BUDGET: usize = 64 * 1024;
const PDF_WRITER_PAGE_OVERHEAD_BUDGET: usize = 2 * 1024;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PdfBuildLimits {
    pub max_pages: usize,
    pub max_page_pixels: u64,
    pub max_total_pixels: u64,
    pub max_output_bytes: usize,
}

impl Default for PdfBuildLimits {
    fn default() -> Self {
        Self {
            max_pages: DEFAULT_MAX_PDF_PAGES,
            max_page_pixels: DEFAULT_MAX_PDF_PAGE_PIXELS,
            max_total_pixels: DEFAULT_MAX_PDF_TOTAL_PIXELS,
            max_output_bytes: DEFAULT_MAX_PDF_OUTPUT_BYTES,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PdfPageRaster {
    pub width_pixels: u32,
    pub height_pixels: u32,
    pub width_points: f32,
    pub height_points: f32,
    pub rgb_bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PdfPageImage {
    pub width_pixels: u32,
    pub height_pixels: u32,
    pub width_points: f32,
    pub height_points: f32,
    pub compressed_rgb_bytes: Vec<u8>,
}

pub struct PdfImageDocumentBuilder {
    pdf: Pdf,
    limits: PdfBuildLimits,
    expected_pages: usize,
    written_pages: usize,
    total_pixels: u64,
}

impl PdfImageDocumentBuilder {
    pub fn new(expected_pages: usize, limits: PdfBuildLimits) -> Result<Self, VeilSendError> {
        if expected_pages == 0 {
            return Err(invalid_pdf("A safety copy needs at least one page."));
        }
        if expected_pages > limits.max_pages {
            return Err(invalid_pdf(
                "The PDF has more pages than the local safety limit.",
            ));
        }

        let catalog_id = Ref::new(1);
        let page_tree_id = Ref::new(2);
        let page_ids = (0..expected_pages)
            .map(|index| page_refs(index).0)
            .collect::<Vec<_>>();
        let mut pdf = Pdf::new();
        pdf.catalog(catalog_id).pages(page_tree_id);
        pdf.pages(page_tree_id)
            .kids(page_ids.iter().copied())
            .count(
                i32::try_from(expected_pages)
                    .map_err(|_| invalid_pdf("The PDF page count exceeds the writer limit."))?,
            );

        Ok(Self {
            pdf,
            limits,
            expected_pages,
            written_pages: 0,
            total_pixels: 0,
        })
    }

    pub fn push_page(&mut self, page: &PdfPageImage) -> Result<(), VeilSendError> {
        if self.written_pages >= self.expected_pages {
            return Err(invalid_pdf(
                "The flattened PDF received more pages than expected.",
            ));
        }
        validate_image(page, self.limits, &mut self.total_pixels)?;
        let projected = self
            .pdf
            .len()
            .saturating_add(page.compressed_rgb_bytes.len())
            .saturating_add(PDF_WRITER_PAGE_OVERHEAD_BUDGET)
            .saturating_add(PDF_WRITER_FINALIZATION_BUDGET);
        if projected > self.limits.max_output_bytes {
            return Err(invalid_pdf(
                "The flattened PDF exceeds the saved-file limit.",
            ));
        }
        write_page(&mut self.pdf, self.written_pages, page)?;
        self.written_pages += 1;
        if self.pdf.len() > self.limits.max_output_bytes {
            return Err(invalid_pdf(
                "The flattened PDF exceeds the saved-file limit.",
            ));
        }
        Ok(())
    }

    pub fn finish(self) -> Result<Vec<u8>, VeilSendError> {
        if self.written_pages != self.expected_pages {
            return Err(invalid_pdf(
                "The flattened PDF did not receive every expected page.",
            ));
        }
        let output = self.pdf.finish();
        if output.len() > self.limits.max_output_bytes {
            return Err(invalid_pdf(
                "The flattened PDF exceeds the saved-file limit.",
            ));
        }
        Ok(output)
    }
}

pub fn normalized_rect_to_pixels(
    rect: NormalizedRect,
    width: u32,
    height: u32,
) -> Result<ImageRect, VeilSendError> {
    const EDGE_EPSILON: f64 = 1e-9;
    const MIN_NORMALIZED_DIMENSION: f64 = 0.001;

    if width == 0 || height == 0 {
        return Err(invalid_pdf("A PDF page has zero pixel dimensions."));
    }
    if ![rect.x, rect.y, rect.width, rect.height]
        .into_iter()
        .all(f64::is_finite)
    {
        return Err(invalid_pdf("A manual cover region is not finite."));
    }
    if rect.width < MIN_NORMALIZED_DIMENSION || rect.height < MIN_NORMALIZED_DIMENSION {
        return Err(invalid_pdf("A manual cover region is too small."));
    }
    if rect.x < -EDGE_EPSILON || rect.y < -EDGE_EPSILON {
        return Err(invalid_pdf(
            "A manual cover region begins outside its page.",
        ));
    }
    let right = rect.x + rect.width;
    let bottom = rect.y + rect.height;
    if !right.is_finite() || !bottom.is_finite() {
        return Err(invalid_pdf("A manual cover region overflows its page."));
    }
    if right > 1.0 + EDGE_EPSILON || bottom > 1.0 + EDGE_EPSILON {
        return Err(invalid_pdf(
            "A manual cover region extends outside its page.",
        ));
    }

    let x = snapped_floor(rect.x.max(0.0) * f64::from(width));
    let y = snapped_floor(rect.y.max(0.0) * f64::from(height));
    let right = snapped_ceil(right.min(1.0) * f64::from(width));
    let bottom = snapped_ceil(bottom.min(1.0) * f64::from(height));
    let x = x.clamp(0.0, f64::from(width)) as u32;
    let y = y.clamp(0.0, f64::from(height)) as u32;
    let right = right.clamp(0.0, f64::from(width)) as u32;
    let bottom = bottom.clamp(0.0, f64::from(height)) as u32;

    if right <= x || bottom <= y {
        return Err(invalid_pdf("A manual cover region has no page pixels."));
    }

    Ok(ImageRect {
        x,
        y,
        width: right - x,
        height: bottom - y,
    })
}

pub fn build_flattened_pdf(
    pages: &[PdfPageRaster],
    limits: PdfBuildLimits,
) -> Result<Vec<u8>, VeilSendError> {
    let mut builder = PdfImageDocumentBuilder::new(pages.len(), limits)?;
    for page in pages {
        let compressed = compress_pdf_page_with_limits(page, limits)?;
        builder.push_page(&compressed)?;
    }
    builder.finish()
}

pub fn compress_pdf_page(page: &PdfPageRaster) -> Result<PdfPageImage, VeilSendError> {
    compress_pdf_page_with_limits(page, PdfBuildLimits::default())
}

fn compress_pdf_page_with_limits(
    page: &PdfPageRaster,
    limits: PdfBuildLimits,
) -> Result<PdfPageImage, VeilSendError> {
    let mut total_pixels = 0;
    validate_raster(page, limits, &mut total_pixels)?;
    Ok(PdfPageImage {
        width_pixels: page.width_pixels,
        height_pixels: page.height_pixels,
        width_points: page.width_points,
        height_points: page.height_points,
        compressed_rgb_bytes: compress_rgb(&page.rgb_bytes)?,
    })
}

pub fn build_flattened_pdf_from_images(
    pages: &[PdfPageImage],
    limits: PdfBuildLimits,
) -> Result<Vec<u8>, VeilSendError> {
    let mut builder = PdfImageDocumentBuilder::new(pages.len(), limits)?;
    for page in pages {
        builder.push_page(page)?;
    }
    builder.finish()
}

fn snapped_floor(value: f64) -> f64 {
    let rounded = value.round();
    if (value - rounded).abs() < 1e-9 {
        rounded
    } else {
        value.floor()
    }
}

fn snapped_ceil(value: f64) -> f64 {
    let rounded = value.round();
    if (value - rounded).abs() < 1e-9 {
        rounded
    } else {
        value.ceil()
    }
}

fn validate_raster(
    page: &PdfPageRaster,
    limits: PdfBuildLimits,
    total_pixels: &mut u64,
) -> Result<(), VeilSendError> {
    let pixels = validate_dimensions(
        page.width_pixels,
        page.height_pixels,
        page.width_points,
        page.height_points,
        limits,
        total_pixels,
    )?;
    let expected = pixels
        .checked_mul(3)
        .and_then(|value| usize::try_from(value).ok())
        .ok_or_else(|| invalid_pdf("A PDF page buffer length overflowed."))?;
    if page.rgb_bytes.len() != expected {
        return Err(invalid_pdf("A PDF page RGB buffer has an invalid length."));
    }
    Ok(())
}

fn validate_image(
    page: &PdfPageImage,
    limits: PdfBuildLimits,
    total_pixels: &mut u64,
) -> Result<(), VeilSendError> {
    let pixels = validate_dimensions(
        page.width_pixels,
        page.height_pixels,
        page.width_points,
        page.height_points,
        limits,
        total_pixels,
    )?;
    let expected = pixels
        .checked_mul(3)
        .ok_or_else(|| invalid_pdf("A PDF page buffer length overflowed."))?;
    let mut decoder = ZlibDecoder::new(page.compressed_rgb_bytes.as_slice());
    let decoded = std::io::copy(
        &mut decoder.by_ref().take(expected + 1),
        &mut std::io::sink(),
    )
    .map_err(|_| invalid_pdf("A compressed PDF page is invalid."))?;
    if decoded != expected {
        return Err(invalid_pdf(
            "A compressed PDF page RGB buffer has an invalid length.",
        ));
    }
    Ok(())
}

fn validate_dimensions(
    width_pixels: u32,
    height_pixels: u32,
    width_points: f32,
    height_points: f32,
    limits: PdfBuildLimits,
    total_pixels: &mut u64,
) -> Result<u64, VeilSendError> {
    if width_pixels == 0 || height_pixels == 0 {
        return Err(invalid_pdf("A PDF page has zero pixel dimensions."));
    }
    if !width_points.is_finite()
        || !height_points.is_finite()
        || width_points <= 0.0
        || height_points <= 0.0
    {
        return Err(invalid_pdf("A PDF page has invalid physical dimensions."));
    }
    let pixels = u64::from(width_pixels)
        .checked_mul(u64::from(height_pixels))
        .ok_or_else(|| invalid_pdf("A PDF page pixel count overflowed."))?;
    if pixels > limits.max_page_pixels {
        return Err(invalid_pdf("A PDF page exceeds the decoded-pixel limit."));
    }
    *total_pixels = total_pixels
        .checked_add(pixels)
        .ok_or_else(|| invalid_pdf("The PDF pixel count overflowed."))?;
    if *total_pixels > limits.max_total_pixels {
        return Err(invalid_pdf("The PDF exceeds the aggregate pixel limit."));
    }
    i32::try_from(width_pixels)
        .and_then(|_| i32::try_from(height_pixels))
        .map_err(|_| invalid_pdf("A PDF page dimension exceeds the writer limit."))?;
    Ok(pixels)
}

fn page_refs(index: usize) -> (Ref, Ref, Ref) {
    let base =
        i32::try_from(index).expect("page count is bounded before object allocation") * 3 + 3;
    (Ref::new(base), Ref::new(base + 1), Ref::new(base + 2))
}

fn write_page(pdf: &mut Pdf, index: usize, page: &PdfPageImage) -> Result<(), VeilSendError> {
    const IMAGE_NAME: Name<'static> = Name(b"Im0");
    let (page_id, image_id, content_id) = page_refs(index);
    let media_box = Rect::new(0.0, 0.0, page.width_points, page.height_points);

    let mut page_writer = pdf.page(page_id);
    page_writer.parent(Ref::new(2));
    page_writer.media_box(media_box);
    page_writer.contents(content_id);
    page_writer
        .resources()
        .x_objects()
        .pair(IMAGE_NAME, image_id);
    page_writer.finish();

    let mut image = pdf.image_xobject(image_id, &page.compressed_rgb_bytes);
    image.filter(Filter::FlateDecode);
    image.width(
        i32::try_from(page.width_pixels)
            .map_err(|_| invalid_pdf("A PDF page width exceeds the writer limit."))?,
    );
    image.height(
        i32::try_from(page.height_pixels)
            .map_err(|_| invalid_pdf("A PDF page height exceeds the writer limit."))?,
    );
    image.color_space().device_rgb();
    image.bits_per_component(8);
    image.finish();

    let mut content = Content::new();
    content.save_state();
    content.transform([page.width_points, 0.0, 0.0, page.height_points, 0.0, 0.0]);
    content.x_object(IMAGE_NAME);
    content.restore_state();
    pdf.stream(content_id, &content.finish());
    Ok(())
}

fn compress_rgb(bytes: &[u8]) -> Result<Vec<u8>, VeilSendError> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(bytes)
        .map_err(|_| invalid_pdf("A PDF page could not be compressed."))?;
    encoder
        .finish()
        .map_err(|_| invalid_pdf("A PDF page could not finish compression."))
}

fn invalid_pdf(message: &str) -> VeilSendError {
    VeilSendError::InvalidPdf(message.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::read::ZlibDecoder;
    use std::io::Read;

    fn page(width: u32, height: u32, width_points: f32, height_points: f32) -> PdfPageRaster {
        let len = usize::try_from(u64::from(width) * u64::from(height) * 3).unwrap();
        PdfPageRaster {
            width_pixels: width,
            height_pixels: height,
            width_points,
            height_points,
            rgb_bytes: vec![245; len],
        }
    }

    #[test]
    fn converts_normalized_regions_outward_to_bounded_pixels() {
        let pixels = normalized_rect_to_pixels(
            NormalizedRect {
                x: 0.10,
                y: 0.20,
                width: 0.30,
                height: 0.25,
            },
            100,
            200,
        )
        .unwrap();

        assert_eq!(
            pixels,
            ImageRect {
                x: 10,
                y: 40,
                width: 30,
                height: 50,
            }
        );
    }

    #[test]
    fn rejects_non_finite_empty_tiny_and_out_of_range_regions() {
        let invalid = [
            NormalizedRect {
                x: f64::NAN,
                y: 0.0,
                width: 0.2,
                height: 0.2,
            },
            NormalizedRect {
                x: 0.1,
                y: 0.1,
                width: 0.0,
                height: 0.2,
            },
            NormalizedRect {
                x: 0.1,
                y: 0.1,
                width: 0.000_01,
                height: 0.2,
            },
            NormalizedRect {
                x: 0.9,
                y: 0.1,
                width: 0.2,
                height: 0.2,
            },
        ];

        for rect in invalid {
            assert!(normalized_rect_to_pixels(rect, 1_000, 1_000).is_err());
        }
    }

    #[test]
    fn builds_deterministic_image_only_pages_without_source_markers() {
        let pages = [page(2, 3, 72.0, 108.0), page(4, 2, 144.0, 72.0)];
        let first = build_flattened_pdf(&pages, PdfBuildLimits::default()).unwrap();
        let second = build_flattened_pdf(&pages, PdfBuildLimits::default()).unwrap();

        assert_eq!(first, second);
        assert!(first.starts_with(b"%PDF-1.7"));
        assert_eq!(count_bytes(&first, b"/Subtype /Image"), 2);
        assert_eq!(count_bytes(&first, b"/Type /Page\n"), 2);
        for forbidden in [
            b"/Metadata".as_slice(),
            b"/OpenAction",
            b"/AcroForm",
            b"/Annots",
            b"/EmbeddedFile",
            b"SG_FAKE_SOURCE_SECRET",
        ] {
            assert!(!contains_bytes(&first, forbidden));
        }
    }

    #[test]
    fn rejects_invalid_page_buffers_and_document_limits() {
        let mut invalid = page(2, 2, 72.0, 72.0);
        invalid.rgb_bytes.pop();
        assert!(build_flattened_pdf(&[invalid], PdfBuildLimits::default()).is_err());

        let tiny_limits = PdfBuildLimits {
            max_pages: 1,
            max_page_pixels: 2,
            max_total_pixels: 2,
            max_output_bytes: 10,
        };
        assert!(build_flattened_pdf(&[page(2, 2, 72.0, 72.0)], tiny_limits).is_err());
    }

    #[test]
    fn lossless_compression_preserves_opaque_redaction_pixels() {
        let rgb = [27, 25, 22, 27, 25, 22, 245, 245, 245];
        let encoded = compress_rgb(&rgb).unwrap();
        let mut decoded = Vec::new();
        ZlibDecoder::new(encoded.as_slice())
            .read_to_end(&mut decoded)
            .unwrap();
        assert_eq!(decoded, rgb);
    }

    #[test]
    fn incremental_builder_requires_exactly_the_declared_pages() {
        let raster = page(2, 3, 72.0, 108.0);
        let compressed = compress_pdf_page(&raster).unwrap();

        let mut missing = PdfImageDocumentBuilder::new(2, PdfBuildLimits::default()).unwrap();
        missing.push_page(&compressed).unwrap();
        assert!(missing.finish().is_err());

        let mut extra = PdfImageDocumentBuilder::new(1, PdfBuildLimits::default()).unwrap();
        extra.push_page(&compressed).unwrap();
        assert!(extra.push_page(&compressed).is_err());
        assert!(extra.finish().is_ok());
    }

    fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
        haystack
            .windows(needle.len())
            .any(|window| window == needle)
    }

    fn count_bytes(haystack: &[u8], needle: &[u8]) -> usize {
        haystack
            .windows(needle.len())
            .filter(|window| *window == needle)
            .count()
    }
}
