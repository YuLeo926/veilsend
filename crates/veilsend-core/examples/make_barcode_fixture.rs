use std::{io::Cursor, path::PathBuf};

use image::{DynamicImage, GenericImage, GrayImage, ImageFormat, Luma};
use rxing::{BarcodeFormat, MultiFormatWriter, Writer};

const CANVAS_WIDTH: u32 = 760;
const CANVAS_HEIGHT: u32 = 720;
const BARCODE_WIDTH: i32 = 640;
const BARCODE_HEIGHT: i32 = 140;

fn main() {
    let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("fixtures");
    let output = fixtures.join("barcode-sensitive-sample.png");
    let mut canvas = GrayImage::from_pixel(CANVAS_WIDTH, CANVAS_HEIGHT, Luma([247]));

    let specimens = [
        (BarcodeFormat::CODE_128, "SGTEST-000001", 40),
        (BarcodeFormat::EAN_13, "5901234123457", 290),
        (BarcodeFormat::UPC_A, "036000291452", 540),
    ];
    for (format, payload, y) in specimens {
        canvas
            .copy_from(&make_barcode(format, payload), 60, y)
            .expect("synthetic barcode should fit the fixture canvas");
    }

    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::ImageLuma8(canvas)
        .write_to(&mut encoded, ImageFormat::Png)
        .expect("fixture should encode as PNG");
    std::fs::write(&output, encoded.into_inner()).expect("fixture should be written");
    println!("Wrote {}", output.display());
}

fn make_barcode(format: BarcodeFormat, payload: &str) -> GrayImage {
    let matrix = MultiFormatWriter
        .encode(payload, &format, BARCODE_WIDTH, BARCODE_HEIGHT)
        .expect("reserved synthetic payload should encode");
    GrayImage::from_fn(matrix.width(), matrix.height(), |x, y| {
        if matrix.get(x, y) {
            Luma([0])
        } else {
            Luma([255])
        }
    })
}
