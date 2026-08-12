use std::{env, fs, io::Cursor, path::PathBuf};

use image::{DynamicImage, ImageFormat, Rgb, RgbImage};
use img_parts::{
    Bytes,
    png::{Png, PngChunk},
};

fn main() {
    let output = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .expect("provide an output PNG path");
    let image = RgbImage::from_fn(960, 640, |x, y| {
        let red = 43 + ((x * 90 / 960) as u8);
        let green = 54 + ((y * 72 / 640) as u8);
        let blue = 72 + (((x + y) * 68 / 1600) as u8);
        Rgb([red, green, blue])
    });
    let mut encoded = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(image)
        .write_to(&mut encoded, ImageFormat::Png)
        .expect("encode PNG");

    let mut png = Png::from_bytes(encoded.into_inner().into()).expect("parse PNG");
    let before_end = png.chunks().len() - 1;
    png.chunks_mut().insert(
        before_end,
        PngChunk::new(*b"tEXt", Bytes::from_static(b"Author\0Synthetic QA Person")),
    );
    png.chunks_mut().insert(
        before_end + 1,
        PngChunk::new(
            *b"tIME",
            Bytes::from_static(&[0x07, 0xea, 8, 12, 21, 15, 0]),
        ),
    );
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).expect("create output directory");
    }
    png.encoder()
        .write_to(fs::File::create(output).expect("create fixture"))
        .expect("write fixture");
}
