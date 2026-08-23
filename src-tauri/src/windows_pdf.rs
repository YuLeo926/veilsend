use sharegate_core::{
    DEFAULT_MAX_IMAGE_BYTES, DEFAULT_MAX_PDF_PAGE_PIXELS, DEFAULT_MAX_PDF_PAGES,
    DEFAULT_MAX_PDF_TOTAL_PIXELS,
};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PdfPageDescriptor {
    pub page_index: usize,
    pub width_points: f32,
    pub height_points: f32,
    pub width_pixels: u32,
    pub height_pixels: u32,
}

#[derive(Debug)]
pub struct RenderedPdfPage {
    pub descriptor: PdfPageDescriptor,
    pub png_bytes: Vec<u8>,
}

#[derive(Debug)]
pub enum PdfAdapterError {
    Unavailable(String),
    Invalid(String),
}

impl PdfAdapterError {
    pub fn into_message(self) -> String {
        match self {
            Self::Unavailable(message) | Self::Invalid(message) => message,
        }
    }
}

#[cfg(target_os = "windows")]
pub fn visit_pages(
    input: &[u8],
    dpi: u32,
    mut visitor: impl FnMut(RenderedPdfPage) -> Result<(), PdfAdapterError>,
) -> Result<Vec<PdfPageDescriptor>, PdfAdapterError> {
    let _apartment = initialize_apartment()?;
    let (_stream, document) = load_document(input)?;
    let descriptors = describe_pages(&document, dpi)?;
    for descriptor in &descriptors {
        visitor(render(&document, *descriptor)?)?;
    }
    Ok(descriptors)
}

#[cfg(target_os = "windows")]
pub fn render_page(
    input: &[u8],
    page_index: usize,
    dpi: u32,
) -> Result<RenderedPdfPage, PdfAdapterError> {
    let _apartment = initialize_apartment()?;
    let (_stream, document) = load_document(input)?;
    let descriptors = describe_pages(&document, dpi)?;
    let descriptor = descriptors.get(page_index).copied().ok_or_else(|| {
        PdfAdapterError::Invalid("The requested PDF page no longer exists.".to_owned())
    })?;
    render(&document, descriptor)
}

#[cfg(not(target_os = "windows"))]
pub fn visit_pages(
    _input: &[u8],
    _dpi: u32,
    _visitor: impl FnMut(RenderedPdfPage) -> Result<(), PdfAdapterError>,
) -> Result<Vec<PdfPageDescriptor>, PdfAdapterError> {
    Err(PdfAdapterError::Unavailable(
        "Local PDF page rendering is currently available on Windows.".to_owned(),
    ))
}

#[cfg(not(target_os = "windows"))]
pub fn render_page(
    _input: &[u8],
    _page_index: usize,
    _dpi: u32,
) -> Result<RenderedPdfPage, PdfAdapterError> {
    Err(PdfAdapterError::Unavailable(
        "Local PDF page rendering is currently available on Windows.".to_owned(),
    ))
}

#[cfg(target_os = "windows")]
struct ApartmentGuard {
    initialized_here: bool,
}

#[cfg(target_os = "windows")]
impl Drop for ApartmentGuard {
    fn drop(&mut self) {
        if self.initialized_here {
            unsafe { windows::Win32::System::WinRT::RoUninitialize() };
        }
    }
}

#[cfg(target_os = "windows")]
fn initialize_apartment() -> Result<ApartmentGuard, PdfAdapterError> {
    use windows::{Win32::System::WinRT, core::HRESULT};

    const RPC_E_CHANGED_MODE: HRESULT = HRESULT(0x80010106_u32 as i32);
    match unsafe { WinRT::RoInitialize(WinRT::RO_INIT_MULTITHREADED) } {
        Ok(()) => Ok(ApartmentGuard {
            initialized_here: true,
        }),
        Err(error) if error.code() == RPC_E_CHANGED_MODE => Ok(ApartmentGuard {
            initialized_here: false,
        }),
        Err(_) => Err(PdfAdapterError::Unavailable(
            "Windows could not initialize the local PDF renderer.".to_owned(),
        )),
    }
}

#[cfg(target_os = "windows")]
fn load_document(
    input: &[u8],
) -> Result<
    (
        windows::Storage::Streams::InMemoryRandomAccessStream,
        windows::Data::Pdf::PdfDocument,
    ),
    PdfAdapterError,
> {
    use windows::{
        Data::Pdf::PdfDocument,
        Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
        core::HRESULT,
    };

    const ERROR_WRONG_PASSWORD: HRESULT = HRESULT(0x8007052B_u32 as i32);
    let invalid = || {
        PdfAdapterError::Invalid(
            "The selected PDF could not be opened safely. It may be malformed or unsupported."
                .to_owned(),
        )
    };
    let stream = InMemoryRandomAccessStream::new().map_err(|_| invalid())?;
    let writer = DataWriter::CreateDataWriter(&stream).map_err(|_| invalid())?;
    writer.WriteBytes(input).map_err(|_| invalid())?;
    writer
        .StoreAsync()
        .map_err(|_| invalid())?
        .join()
        .map_err(|_| invalid())?;
    writer.DetachStream().map_err(|_| invalid())?;
    stream.Seek(0).map_err(|_| invalid())?;
    let operation = PdfDocument::LoadFromStreamAsync(&stream).map_err(|_| invalid())?;
    let document = operation.join().map_err(|error| {
        if error.code() == ERROR_WRONG_PASSWORD {
            PdfAdapterError::Invalid(
                "Password-protected PDFs are not supported. ShareGate did not read or store a password."
                    .to_owned(),
            )
        } else {
            invalid()
        }
    })?;
    if document.IsPasswordProtected().map_err(|_| invalid())? {
        return Err(PdfAdapterError::Invalid(
            "Password-protected PDFs are not supported. ShareGate did not read or store a password."
                .to_owned(),
        ));
    }
    Ok((stream, document))
}

#[cfg(target_os = "windows")]
fn describe_pages(
    document: &windows::Data::Pdf::PdfDocument,
    dpi: u32,
) -> Result<Vec<PdfPageDescriptor>, PdfAdapterError> {
    if dpi == 0 {
        return Err(PdfAdapterError::Invalid(
            "The PDF render density is invalid.".to_owned(),
        ));
    }
    let invalid =
        || PdfAdapterError::Invalid("A PDF page has invalid or unsupported dimensions.".to_owned());
    let page_count =
        usize::try_from(document.PageCount().map_err(|_| invalid())?).map_err(|_| invalid())?;
    if page_count == 0 {
        return Err(PdfAdapterError::Invalid(
            "The selected PDF contains no pages.".to_owned(),
        ));
    }
    if page_count > DEFAULT_MAX_PDF_PAGES {
        return Err(PdfAdapterError::Invalid(format!(
            "The selected PDF has more than ShareGate's {DEFAULT_MAX_PDF_PAGES}-page local limit."
        )));
    }

    let mut descriptors = Vec::with_capacity(page_count);
    let mut total_pixels = 0_u64;
    for page_index in 0..page_count {
        let page = document
            .GetPage(u32::try_from(page_index).map_err(|_| invalid())?)
            .map_err(|_| invalid())?;
        let size = page.Size().map_err(|_| invalid())?;
        page.Close().map_err(|_| invalid())?;
        let width_dips = f64::from(size.Width);
        let height_dips = f64::from(size.Height);
        if !width_dips.is_finite()
            || !height_dips.is_finite()
            || width_dips <= 0.0
            || height_dips <= 0.0
        {
            return Err(invalid());
        }
        let width_pixels = checked_ceil_dimension(width_dips * f64::from(dpi) / 96.0)?;
        let height_pixels = checked_ceil_dimension(height_dips * f64::from(dpi) / 96.0)?;
        let pixels = u64::from(width_pixels)
            .checked_mul(u64::from(height_pixels))
            .ok_or_else(invalid)?;
        if pixels > DEFAULT_MAX_PDF_PAGE_PIXELS {
            return Err(PdfAdapterError::Invalid(format!(
                "PDF page {} exceeds ShareGate's 40-million-pixel render limit.",
                page_index + 1
            )));
        }
        total_pixels = total_pixels.checked_add(pixels).ok_or_else(invalid)?;
        if total_pixels > DEFAULT_MAX_PDF_TOTAL_PIXELS {
            return Err(PdfAdapterError::Invalid(
                "The PDF exceeds ShareGate's aggregate rendered-pixel limit.".to_owned(),
            ));
        }
        descriptors.push(PdfPageDescriptor {
            page_index,
            width_points: (width_dips * 72.0 / 96.0) as f32,
            height_points: (height_dips * 72.0 / 96.0) as f32,
            width_pixels,
            height_pixels,
        });
    }
    Ok(descriptors)
}

#[cfg(target_os = "windows")]
fn checked_ceil_dimension(value: f64) -> Result<u32, PdfAdapterError> {
    if !value.is_finite() || value < 1.0 || value > f64::from(u32::MAX) {
        return Err(PdfAdapterError::Invalid(
            "A PDF page render dimension is outside the supported range.".to_owned(),
        ));
    }
    Ok(value.ceil() as u32)
}

#[cfg(target_os = "windows")]
fn render(
    document: &windows::Data::Pdf::PdfDocument,
    descriptor: PdfPageDescriptor,
) -> Result<RenderedPdfPage, PdfAdapterError> {
    use windows::{
        Data::Pdf::PdfPageRenderOptions,
        Graphics::Imaging::BitmapEncoder,
        Storage::Streams::{DataReader, InMemoryRandomAccessStream},
    };

    let system_dpi = unsafe { windows::Win32::UI::HiDpi::GetDpiForSystem() }.max(96);
    let render_width_dips =
        u32::try_from((u64::from(descriptor.width_pixels) * 96).div_ceil(u64::from(system_dpi)))
            .map_err(|_| render_invalid(descriptor, "render width"))?;
    let render_height_dips =
        u32::try_from((u64::from(descriptor.height_pixels) * 96).div_ceil(u64::from(system_dpi)))
            .map_err(|_| render_invalid(descriptor, "render height"))?;

    let page = document
        .GetPage(
            u32::try_from(descriptor.page_index)
                .map_err(|_| render_invalid(descriptor, "page selection"))?,
        )
        .map_err(|_| render_invalid(descriptor, "page opening"))?;
    let output = InMemoryRandomAccessStream::new()
        .map_err(|_| render_invalid(descriptor, "output allocation"))?;
    let options =
        PdfPageRenderOptions::new().map_err(|_| render_invalid(descriptor, "render options"))?;
    options
        .SetDestinationWidth(render_width_dips)
        .map_err(|_| render_invalid(descriptor, "render width"))?;
    options
        .SetDestinationHeight(render_height_dips)
        .map_err(|_| render_invalid(descriptor, "render height"))?;
    options
        .SetIsIgnoringHighContrast(true)
        .map_err(|_| render_invalid(descriptor, "display isolation"))?;
    options
        .SetBitmapEncoderId(
            BitmapEncoder::PngEncoderId().map_err(|_| render_invalid(descriptor, "PNG encoder"))?,
        )
        .map_err(|_| render_invalid(descriptor, "PNG output"))?;
    page.RenderWithOptionsToStreamAsync(&output, &options)
        .map_err(|_| render_invalid(descriptor, "render start"))?
        .join()
        .map_err(|_| render_invalid(descriptor, "render completion"))?;
    page.Close()
        .map_err(|_| render_invalid(descriptor, "page release"))?;

    let size = output
        .Size()
        .map_err(|_| render_invalid(descriptor, "output sizing"))?;
    if size == 0 || size > DEFAULT_MAX_IMAGE_BYTES as u64 {
        return Err(PdfAdapterError::Invalid(format!(
            "PDF page {} expands beyond ShareGate's 25 MB rendered-page limit.",
            descriptor.page_index + 1
        )));
    }
    let expected = u32::try_from(size).map_err(|_| render_invalid(descriptor, "output sizing"))?;
    let input_stream = output
        .GetInputStreamAt(0)
        .map_err(|_| render_invalid(descriptor, "output opening"))?;
    let reader = DataReader::CreateDataReader(&input_stream)
        .map_err(|_| render_invalid(descriptor, "output reader"))?;
    let loaded = reader
        .LoadAsync(expected)
        .map_err(|_| render_invalid(descriptor, "output load start"))?
        .join()
        .map_err(|_| render_invalid(descriptor, "output load completion"))?;
    if loaded != expected {
        return Err(render_invalid(descriptor, "output length"));
    }
    let mut png_bytes = vec![0; expected as usize];
    reader
        .ReadBytes(&mut png_bytes)
        .map_err(|_| render_invalid(descriptor, "output reading"))?;
    if !png_bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(render_invalid(descriptor, "PNG signature"));
    }
    let image = image::load_from_memory(&png_bytes)
        .map_err(|_| render_invalid(descriptor, "PNG decoding"))?;
    if image.width() != descriptor.width_pixels || image.height() != descriptor.height_pixels {
        use std::io::Cursor;

        let normalized = image.resize_exact(
            descriptor.width_pixels,
            descriptor.height_pixels,
            image::imageops::FilterType::Lanczos3,
        );
        let mut output = Cursor::new(Vec::new());
        normalized
            .write_to(&mut output, image::ImageFormat::Png)
            .map_err(|_| render_invalid(descriptor, "dimension normalization"))?;
        png_bytes = output.into_inner();
    }
    if png_bytes.len() > DEFAULT_MAX_IMAGE_BYTES {
        return Err(PdfAdapterError::Invalid(format!(
            "PDF page {} expands beyond ShareGate's 25 MB normalized-page limit.",
            descriptor.page_index + 1
        )));
    }
    Ok(RenderedPdfPage {
        descriptor,
        png_bytes,
    })
}

#[cfg(target_os = "windows")]
fn render_invalid(descriptor: PdfPageDescriptor, stage: &str) -> PdfAdapterError {
    PdfAdapterError::Invalid(format!(
        "PDF page {} could not complete local {stage}.",
        descriptor.page_index + 1
    ))
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;
    use sharegate_core::{PdfBuildLimits, PdfPageRaster, build_flattened_pdf};

    #[test]
    fn renders_a_synthetic_image_only_pdf_from_memory() {
        let source = build_flattened_pdf(
            &[PdfPageRaster {
                width_pixels: 20,
                height_pixels: 30,
                width_points: 72.0,
                height_points: 108.0,
                rgb_bytes: vec![240; 20 * 30 * 3],
            }],
            PdfBuildLimits::default(),
        )
        .unwrap();
        let mut rendered = Vec::new();
        let descriptors = visit_pages(&source, 144, |page| {
            rendered.push(page);
            Ok(())
        })
        .unwrap();

        assert_eq!(descriptors.len(), 1);
        assert_eq!(descriptors[0].width_pixels, 144);
        assert_eq!(descriptors[0].height_pixels, 216);
        assert_eq!(rendered.len(), 1);
        assert!(rendered[0].png_bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
    }
}
