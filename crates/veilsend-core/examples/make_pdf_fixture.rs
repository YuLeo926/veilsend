use std::{io::Write, path::PathBuf};

use flate2::{Compression, write::ZlibEncoder};
use image::{DynamicImage, Rgb, RgbImage, imageops};
use pdf_writer::{
    Content, Finish, Name, Pdf, Rect, Ref, Str, TextStr,
    types::{ActionType, AnnotationFlags, AnnotationType, FieldType, TextRenderingMode},
};

const ATTACHMENT: &[u8] =
    b"SG_PDF_ATTACHMENT_MARKER\nSynthetic attachment for VeilSend PDF acceptance.\n";

fn main() {
    let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("fixtures");
    let output = fixtures.join("pdf-sensitive-sample.pdf");
    let attachment = fixtures.join("pdf-sensitive-attachment.txt");

    let page_one_source = image::open(fixtures.join("ocr-sensitive-sample.png"))
        .expect("the tracked OCR acceptance fixture should exist")
        .to_rgb8();
    let page_one = imageops::crop_imm(&page_one_source, 0, 20, 800, 500).to_image();
    let page_two = build_visual_page(&fixtures);
    let pdf = build_fixture(&page_one, &page_two);
    std::fs::write(&attachment, ATTACHMENT).expect("fixture attachment should be written");
    std::fs::write(&output, pdf).expect("PDF fixture should be written");
    println!("Wrote {}", output.display());
    println!("Wrote {}", attachment.display());
}

fn build_visual_page(fixtures: &std::path::Path) -> RgbImage {
    let visual = image::open(fixtures.join("visual-sensitive-sample.png"))
        .expect("run make_visual_fixture before the PDF fixture")
        .to_rgb8();
    let qr = image::open(fixtures.join("qr-sensitive-sample.png"))
        .expect("run make_qr_fixture before the PDF fixture")
        .to_rgb8();
    let visual = DynamicImage::ImageRgb8(visual)
        .resize_exact(1_200, 800, imageops::FilterType::Nearest)
        .to_rgb8();
    let qr = DynamicImage::ImageRgb8(qr)
        .resize_exact(430, 430, imageops::FilterType::Nearest)
        .to_rgb8();
    let mut page = RgbImage::from_pixel(1_800, 1_200, Rgb([247, 245, 239]));
    imageops::overlay(&mut page, &visual, 45, 190);
    imageops::overlay(&mut page, &qr, 1_325, 370);
    page
}

fn build_fixture(page_one: &RgbImage, page_two: &RgbImage) -> Vec<u8> {
    const CATALOG: Ref = Ref::new(1);
    const PAGES: Ref = Ref::new(2);
    const FONT: Ref = Ref::new(3);
    const INFO: Ref = Ref::new(4);
    const METADATA: Ref = Ref::new(5);
    const PAGE_ONE: Ref = Ref::new(10);
    const PAGE_ONE_CONTENT: Ref = Ref::new(11);
    const PAGE_ONE_IMAGE: Ref = Ref::new(12);
    const PAGE_TWO: Ref = Ref::new(20);
    const PAGE_TWO_IMAGE: Ref = Ref::new(21);
    const PAGE_TWO_CONTENT: Ref = Ref::new(22);
    const PAGE_THREE: Ref = Ref::new(30);
    const PAGE_THREE_CONTENT: Ref = Ref::new(31);
    const LINK_ANNOTATION: Ref = Ref::new(32);
    const SCRIPT_ANNOTATION: Ref = Ref::new(33);
    const FORM_FIELD: Ref = Ref::new(34);
    const EMBEDDED_FILE: Ref = Ref::new(40);
    const FILE_SPEC: Ref = Ref::new(41);
    const FONT_NAME: Name<'static> = Name(b"F1");
    let mut pdf = Pdf::new();
    {
        let mut catalog = pdf.catalog(CATALOG);
        catalog.pages(PAGES).metadata(METADATA);
        catalog.form().fields([FORM_FIELD]);
        catalog
            .names()
            .embedded_files()
            .names()
            .insert(Str(b"pdf-sensitive-attachment.txt"), FILE_SPEC);
    }
    pdf.pages(PAGES)
        .kids([PAGE_ONE, PAGE_TWO, PAGE_THREE])
        .count(3);
    pdf.type1_font(FONT).base_font(Name(b"Helvetica"));
    pdf.document_info(INFO)
        .title(TextStr("VeilSend synthetic PDF acceptance"))
        .author(TextStr("SG_PDF_METADATA_MARKER"))
        .subject(TextStr("Reserved example data only"))
        .keywords(TextStr("synthetic, redaction, local"))
        .producer(TextStr("VeilSend deterministic fixture generator"));
    let metadata = br#"<?xpacket begin=''?>
<x:xmpmeta xmlns:x='adobe:ns:meta/'>
<rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>
<rdf:Description xmlns:sg='https://example.com/veilsend/' sg:marker='SG_PDF_METADATA_MARKER'/>
</rdf:RDF></x:xmpmeta><?xpacket end='w'?>"#;
    pdf.metadata(METADATA, metadata);

    write_text_page(
        &mut pdf,
        PAGE_ONE,
        PAGE_ONE_IMAGE,
        PAGE_ONE_CONTENT,
        FONT,
        FONT_NAME,
        page_one,
    );
    write_image_page(
        &mut pdf,
        PAGE_TWO,
        PAGE_TWO_IMAGE,
        PAGE_TWO_CONTENT,
        page_two,
    );
    write_active_page(
        &mut pdf,
        PAGE_THREE,
        PAGE_THREE_CONTENT,
        FONT,
        FONT_NAME,
        [LINK_ANNOTATION, SCRIPT_ANNOTATION, FORM_FIELD],
    );

    let mut link = pdf.annotation(LINK_ANNOTATION);
    link.subtype(AnnotationType::Link)
        .rect(Rect::new(54.0, 54.0, 250.0, 82.0))
        .contents(TextStr("SG_PDF_ANNOTATION_MARKER"))
        .action()
        .action_type(ActionType::Uri)
        .uri(Str(b"https://example.com/veilsend-fixture"));
    link.finish();

    let mut script = pdf.annotation(SCRIPT_ANNOTATION);
    script
        .subtype(AnnotationType::Link)
        .rect(Rect::new(270.0, 54.0, 460.0, 82.0))
        .contents(TextStr("Synthetic JavaScript action"))
        .action()
        .action_type(ActionType::JavaScript)
        .js_string(TextStr("/* SG_PDF_JAVASCRIPT_MARKER */ void(0);"));
    script.finish();

    let mut field = pdf.form_field(FORM_FIELD);
    field
        .partial_name(TextStr("synthetic-field"))
        .field_type(FieldType::Text)
        .text_value(TextStr("SG_PDF_FORM_MARKER"));
    field
        .into_annotation()
        .rect(Rect::new(480.0, 54.0, 660.0, 82.0))
        .flags(AnnotationFlags::PRINT);

    pdf.embedded_file(EMBEDDED_FILE, ATTACHMENT)
        .subtype(Name(b"text#2Fplain"))
        .params()
        .size(i32::try_from(ATTACHMENT.len()).unwrap());
    pdf.file_spec(FILE_SPEC)
        .path(Str(b"pdf-sensitive-attachment.txt"))
        .unic_file(TextStr("pdf-sensitive-attachment.txt"))
        .description(TextStr("Synthetic VeilSend acceptance attachment"))
        .embedded_file_with_unicode(EMBEDDED_FILE);

    let output = pdf.finish();
    assert!(
        output
            .windows(20)
            .any(|window| window == b"SG_PDF_SOURCE_MARKER")
    );
    assert!(output.windows(9).any(|window| window == b"/AcroForm"));
    assert!(output.windows(14).any(|window| window == b"/EmbeddedFiles"));
    output
}

fn write_text_page(
    pdf: &mut Pdf,
    page_id: Ref,
    image_id: Ref,
    content_id: Ref,
    font_id: Ref,
    font_name: Name,
    pixels: &RgbImage,
) {
    let mut page = pdf.page(page_id);
    page.media_box(Rect::new(0.0, 0.0, 612.0, 792.0))
        .parent(Ref::new(2))
        .contents(content_id);
    page.resources().fonts().pair(font_name, font_id);
    page.resources().x_objects().pair(Name(b"Im0"), image_id);
    page.finish();

    write_rgb_image(pdf, image_id, pixels);

    let lines: &[(&[u8], f32, f32)] = &[
        (b"Review every proposed cover before saving.", 360.0, 18.0),
        (b"SG_PDF_SOURCE_MARKER_2026", 310.0, 18.0),
    ];
    let mut content = Content::new();
    content.save_state();
    content.transform([576.0, 0.0, 0.0, 360.0, 18.0, 414.0]);
    content.x_object(Name(b"Im0"));
    content.restore_state();
    for (line, y, size) in lines {
        content.begin_text();
        content.set_font(font_name, *size);
        content.next_line(62.0, *y);
        content.show(Str(line));
        content.end_text();
    }
    pdf.stream(content_id, &content.finish());
}

fn write_image_page(
    pdf: &mut Pdf,
    page_id: Ref,
    image_id: Ref,
    content_id: Ref,
    pixels: &RgbImage,
) {
    let mut page = pdf.page(page_id);
    page.media_box(Rect::new(0.0, 0.0, 792.0, 612.0))
        .parent(Ref::new(2))
        .contents(content_id);
    page.resources().x_objects().pair(Name(b"Im0"), image_id);
    page.finish();

    write_rgb_image(pdf, image_id, pixels);

    let mut content = Content::new();
    content.save_state();
    content.transform([792.0, 0.0, 0.0, 612.0, 0.0, 0.0]);
    content.x_object(Name(b"Im0"));
    content.restore_state();
    pdf.stream(content_id, &content.finish());
}

fn write_rgb_image(pdf: &mut Pdf, image_id: Ref, pixels: &RgbImage) {
    let compressed = compress(pixels.as_raw());
    let mut image = pdf.image_xobject(image_id, &compressed);
    image.filter(pdf_writer::Filter::FlateDecode);
    image.width(i32::try_from(pixels.width()).unwrap());
    image.height(i32::try_from(pixels.height()).unwrap());
    image.color_space().device_rgb();
    image.bits_per_component(8);
    image.finish();
}

fn write_active_page(
    pdf: &mut Pdf,
    page_id: Ref,
    content_id: Ref,
    font_id: Ref,
    font_name: Name,
    annotations: [Ref; 3],
) {
    let mut page = pdf.page(page_id);
    page.media_box(Rect::new(0.0, 0.0, 720.0, 540.0))
        .parent(Ref::new(2))
        .contents(content_id)
        .annotations(annotations);
    page.resources().fonts().pair(font_name, font_id);
    page.finish();

    let mut content = Content::new();
    content.set_fill_rgb(0.93, 0.91, 0.86);
    content.rect(0.0, 0.0, 720.0, 540.0).fill_nonzero();
    content.set_fill_rgb(0.91, 0.36, 0.18);
    content.rect(238.0, 185.0, 244.0, 150.0).fill_nonzero();
    content.set_fill_rgb(0.10, 0.09, 0.08);
    for offset in [0.0, 34.0, 68.0, 102.0] {
        content
            .rect(258.0, 207.0 + offset, 204.0, 16.0)
            .fill_nonzero();
    }
    content.begin_text();
    content.set_font(font_name, 12.0);
    content.set_text_rendering_mode(TextRenderingMode::Invisible);
    content.next_line(72.0, 450.0);
    content.show(Str(
        b"invisible-secret@example.test SG_PDF_INVISIBLE_MARKER",
    ));
    content.end_text();
    pdf.stream(content_id, &content.finish());
}

fn compress(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes).unwrap();
    encoder.finish().unwrap()
}
