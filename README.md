# ShareGate

**Scan anything before it leaves your computer.**

ShareGate is a local-first outbound safety gate for text, logs, configuration files, and images. It detects likely credentials and personal context in text, finds privacy metadata hidden in JPEG and PNG files, produces a separate clean copy, and verifies that output before it is shared.

> ShareGate reduces accidental disclosure. It does not guarantee that content is safe and is not a compliance product.

## Current milestone

Milestone B includes the complete text workflow plus lossless image metadata cleaning:

- paste text or open/drop UTF-8 `.txt`, `.log`, `.json`, and `.env` files;
- scan with deterministic local rules;
- mask detected values by default and show safe surrounding context;
- include or exclude each proposed cleanup;
- customize replacement labels;
- generate a separate clean copy;
- rescan it and report `Verified`, `Needs review`, or user exceptions;
- copy or save the result without modifying the source.
- inspect JPEG and PNG metadata for location, device, identity, timestamps, descriptions, XMP, IPTC, and comments;
- remove supported privacy metadata without decoding or recompressing image pixels;
- preserve ICC colour profiles;
- save to a separate `.cleaned` image and verify both metadata removal and an unchanged pixel stream;
- block lossless cleaning when EXIF orientation is non-normal or cannot be safely parsed.

OCR, visual redaction, face detection, and QR detection belong to a later milestone. Complex PDF and Office formats are intentionally outside v0.1.

## Architecture

```text
React + TypeScript review interface
              │
       Tauri command boundary
              │
       sharegate-core (Rust)
     inspect → clean → verify
```

The Rust engine is a standalone crate so a later CLI can reuse the same rules. Browser development uses a TypeScript preview adapter; packaged desktop scans use the Rust engine.

## Run locally

Requirements:

- Node.js 22+
- Rust 1.85+
- platform requirements for [Tauri 2](https://v2.tauri.app/start/prerequisites/)

```bash
npm install
npm run dev
```

For the desktop app:

```bash
npm run tauri dev
```

Use **Try safe sample** in text mode. Image mode opens local JPEG and PNG files through the native file picker. All repository fixtures are synthetic.

## Verify the project

```bash
cargo test --workspace
npm test
npm run build
cargo clippy --workspace --all-targets -- -D warnings
cargo check -p sharegate
```

## Privacy model

- No analytics, crash uploads, accounts, remote fonts, or cloud APIs.
- Source content and raw findings are not written to application logs.
- Source files are opened read-only by the interface and never overwritten.
- Saving is explicit and defaults to a `.cleaned` filename.
- Text input is limited to 10 MiB; image input is limited to 25 MiB.
- Image cleaning preserves the encoded pixel stream and ICC colour profiles; verification compares a SHA-256 fingerprint of the encoded pixel data before and after cleaning.

The browser preview itself is delivered by a local Vite server during development. The packaged application is the intended offline distribution.

## Documentation

- [Product and engineering design](docs/superpowers/specs/2026-08-12-sharegate-v0.1-design.md)
- [Image metadata design](docs/superpowers/specs/2026-08-12-sharegate-image-metadata-design.md)
- [Milestone A implementation plan](docs/superpowers/plans/2026-08-12-sharegate-milestone-a.md)
- [Security policy and threat model](SECURITY.md)
- [Development and verification notes](docs/development.md)

## License

[MIT](LICENSE)
