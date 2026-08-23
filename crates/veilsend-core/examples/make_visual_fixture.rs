use std::{io::Cursor, path::PathBuf};

use image::{DynamicImage, ImageFormat, imageops};

fn main() {
    let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("fixtures");
    let portrait_path = fixtures.join("synthetic-face-source.png");
    let barcode_path = fixtures.join("barcode-sensitive-sample.png");
    let output_path = fixtures.join("visual-sensitive-sample.png");

    let mut portrait = image::open(&portrait_path)
        .expect("run from the repository containing the generated synthetic portrait")
        .into_rgba8();
    let barcode = image::open(&barcode_path)
        .expect("run make_barcode_fixture before this example")
        .into_rgba8();
    assert!(
        portrait.width() >= barcode.width() * 2 && portrait.height() >= barcode.height(),
        "the synthetic portrait must leave enough room for the barcode panel"
    );

    let x = i64::from(portrait.width() - barcode.width());
    let y = i64::from((portrait.height() - barcode.height()) / 2);
    imageops::overlay(&mut portrait, &barcode, x, y);

    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(portrait)
        .write_to(&mut encoded, ImageFormat::Png)
        .expect("fixture should encode as PNG");
    std::fs::write(&output_path, encoded.into_inner()).expect("fixture should be written");
    println!("Wrote {}", output_path.display());
}
