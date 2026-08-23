use std::{io::Cursor, path::PathBuf};

use image::{DynamicImage, GrayImage, ImageFormat, Luma};
use qrcode::{QrCode, types::Color};

fn main() {
    let payload = "https://example.com/internal/sign-in?token=FAKE-VEILSEND-TOKEN";
    let code = QrCode::new(payload.as_bytes()).expect("synthetic QR payload should fit");
    let module_count = code.width() as u32;
    let quiet_zone = 4;
    let scale = 10;
    let qr_size = (module_count + quiet_zone * 2) * scale;
    let mut image = GrayImage::from_pixel(qr_size + 120, qr_size + 120, Luma([247]));

    for y in 0..module_count {
        for x in 0..module_count {
            if code[(x as usize, y as usize)] == Color::Dark {
                for pixel_y in 0..scale {
                    for pixel_x in 0..scale {
                        image.put_pixel(
                            60 + (x + quiet_zone) * scale + pixel_x,
                            60 + (y + quiet_zone) * scale + pixel_y,
                            Luma([20]),
                        );
                    }
                }
            }
        }
    }

    let mut output = Cursor::new(Vec::new());
    DynamicImage::ImageLuma8(image)
        .write_to(&mut output, ImageFormat::Png)
        .expect("fixture should encode");
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("fixtures")
        .join("qr-sensitive-sample.png");
    std::fs::write(&fixture, output.into_inner()).expect("fixture should be written");
    println!("Wrote {}", fixture.display());
}
