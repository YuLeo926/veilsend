# VeilSend image metadata design

## Objective

Add a first image-safety slice that removes hidden privacy metadata from JPEG and PNG files while preserving the visible image and the original file.

## User flow

1. Switch from **Text & logs** to **Images**.
2. Choose one JPEG or PNG through the native file picker.
3. Review grouped metadata risks without exposing their raw values.
4. Choose **Clean, save & verify** and select a separate output path.
5. See a verification receipt covering remaining metadata and pixel-stream integrity.

## Local safety contract

- Files are read locally and are never uploaded.
- Inputs are limited to 25 MiB.
- The source path is opened read-only and is never an allowed output path.
- Cleaning removes supported EXIF, XMP, IPTC/Photoshop, JPEG comments, PNG text, and PNG modification-time data.
- ICC colour profiles and encoded pixel chunks remain intact.
- VeilSend fingerprints the encoded pixel stream before and after cleaning and rereads the saved file before reporting success.
- Images with a non-normal EXIF orientation are refused because dropping that tag can rotate or mirror the displayed image.
- Images with unparseable EXIF are also refused because their orientation cannot be proven safe.

## Boundaries

This slice does not inspect text, faces, QR codes, or other sensitive content visible inside the image pixels. It does not support GIF, WebP, HEIC, AVIF, RAW, PDF, or Office files.

## Acceptance evidence

- Rust unit tests cover JPEG metadata removal, PNG metadata removal, unchanged pixel fingerprints, orientation refusal, unparseable EXIF refusal, size limits, and unsupported formats.
- The packaged Windows app was exercised with a synthetic PNG containing a private author text chunk and modification timestamp.
- The saved clean copy reported two risks removed, zero remaining metadata matches, and an exact pixel stream.
