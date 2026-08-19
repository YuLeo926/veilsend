# ShareGate

**Scan anything before it leaves your computer.**

ShareGate is a local-first outbound safety gate for text, logs, configuration files, screenshots, and images. It detects likely credentials and personal context, finds faces, QR codes, one-dimensional barcodes, and hidden image metadata, irreversibly covers selected visual risks, produces a separate clean copy, and verifies the actual saved output before it is shared.

> ShareGate reduces accidental disclosure. It does not guarantee that content is safe and is not a compliance product.

## Current milestone

Milestone C includes the complete text workflow plus a unified local image-safety review:

- paste text or open/drop UTF-8 `.txt`, `.log`, `.json`, and `.env` files;
- scan with deterministic local rules;
- mask detected values by default and show safe surrounding context;
- include or exclude each proposed cleanup;
- customize replacement labels;
- generate a separate clean copy;
- rescan it and report `Verified`, `Needs review`, or user exceptions;
- copy or save the result without modifying the source;
- choose a JPEG or PNG, paste a screenshot with a button, or press `Ctrl+V` from the image add screen;
- keep pasted source bytes only in the desktop process's active in-memory session;
- scan visible image text locally with the current user's installed Windows OCR language;
- reuse the deterministic text rules and map masked findings back to image regions;
- review each proposed visual redaction, with every finding selected by default;
- state explicitly that Windows OCR does not provide a confidence score;
- cover selected regions with opaque pixels and export a separate metadata-free PNG;
- rerun Windows OCR and the ShareGate rules against the saved file before reporting success;
- detect multiple and rotated QR codes locally and classify them without returning decoded payloads to the interface;
- keep undecodable extracted QR regions visible for review instead of treating them as safe;
- redact selected QR regions with opaque pixels and repeat QR detection on the saved PNG;
- locate faces with Windows' on-device face detector without creating face crops, recognizing identity, or inferring personal attributes;
- detect Code 39, Code 93, Code 128, Codabar, EAN-8, EAN-13, ITF, UPC-A, UPC-E, RSS-14, RSS Expanded, and Telepen barcodes locally without exposing their payloads;
- select every text, face, QR, and barcode finding for irreversible opaque redaction by default;
- allow an explicit **Keep** decision, reported as an exception rather than as clean;
- inspect JPEG and PNG metadata for location, device, identity, timestamps, descriptions, XMP, IPTC, and comments;
- remove supported privacy metadata without decoding or recompressing image pixels when no visual redaction is requested;
- preserve ICC colour profiles;
- save to a separate `.cleaned` image and verify both metadata removal and an unchanged pixel stream;
- block lossless cleaning when EXIF orientation is non-normal or cannot be safely parsed;
- reread the actual saved output and rerun metadata, text, face, QR, and barcode checks before reporting a result.

PDF and Office files are intentionally outside this image slice. PDF safety is being designed as a separate renderer-and-reconstruction trust boundary rather than being folded into the image path.

## Architecture

```text
React + TypeScript review interface
              |
       Tauri command boundary
              |
 Windows OCR/face/clipboard adapters + sharegate-core (Rust)
       inspect -> clean -> verify
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

Use **Try safe sample** in text mode. Image mode opens local JPEG and PNG files through the native file picker or accepts a bitmap from the focused Windows clipboard. All repository fixtures are synthetic.

## Verify the project

```bash
cargo test --workspace
npm audit --audit-level=moderate
npm test
npm run build
cargo clippy --workspace --all-targets -- -D warnings
cargo check -p sharegate
cargo audit
```

Build the offline executable through Tauri so the frontend is embedded rather than pointing at the development server:

```bash
npm run tauri build -- --no-bundle
```

## Privacy model

- No analytics, crash uploads, accounts, remote fonts, or cloud APIs.
- Source content and raw findings are not written to application logs.
- Source files are opened read-only by the interface and never overwritten.
- Clipboard access occurs only after **Paste screenshot** or a qualifying `Ctrl+V`; ShareGate does not poll, monitor, clear, or write clipboard history.
- Pasted source bytes remain in one desktop-owned in-memory session and are dropped when replaced, cleared, or the app exits. No temporary source image is created.
- Saving is explicit and defaults to a `.cleaned` or `.redacted` filename.
- Text input is limited to 10 MiB; image input is limited to 25 MiB.
- Metadata-only image cleaning preserves the encoded pixel stream and ICC colour profiles; verification compares a SHA-256 fingerprint of the encoded pixel data before and after cleaning.
- Visual redaction rewrites selected pixels and always exports PNG. It strips container metadata and reruns Windows OCR, face, deterministic text, QR, and barcode checks on the saved file.
- The complete OCR transcript is not sent to the interface. Only masked rule findings, categories, and the image rectangles needed for review cross the desktop command boundary.
- Decoded QR payload bytes stay inside the Rust core. The interface receives only a coarse type, byte count, severity, opaque ID, and review rectangle.
- Face detection returns location only. It creates no crop or embedding and performs no identity, emotion, age, gender, or other attribute inference.
- Decoded one-dimensional barcode payloads stay inside the Rust core. The interface receives only the supported format, encoded length, opaque ID, and review rectangle.
- Supported detectors can miss obscured faces, unusual layouts, unreadable bars, unsupported symbols, or visible content OCR does not recognize. An unavailable or incomplete detector yields `Needs review`, never `Verified`.
- `Verified` covers the supported local detector and metadata checks; it is not proof that an image contains no sensitive information.

The browser preview itself is delivered by a local Vite server during development. The packaged application is the intended offline distribution.

## Documentation

- [Product and engineering design](docs/superpowers/specs/2026-08-12-sharegate-v0.1-design.md)
- [Image metadata design](docs/superpowers/specs/2026-08-12-sharegate-image-metadata-design.md)
- [Local OCR and visual redaction design](docs/superpowers/specs/2026-08-12-sharegate-ocr-redaction-design.md)
- [Local QR redaction design](docs/superpowers/specs/2026-08-12-sharegate-qr-redaction-design.md)
- [Face, barcode, and screenshot safety design](docs/superpowers/specs/2026-08-19-sharegate-visual-safety-expansion-design.md)
- [Milestone A implementation plan](docs/superpowers/plans/2026-08-12-sharegate-milestone-a.md)
- [OCR and visual redaction implementation plan](docs/superpowers/plans/2026-08-12-sharegate-ocr-redaction.md)
- [QR redaction implementation plan](docs/superpowers/plans/2026-08-12-sharegate-qr-redaction.md)
- [Face, barcode, and screenshot implementation plan](docs/superpowers/plans/2026-08-19-sharegate-visual-safety-expansion.md)
- [Security policy and threat model](SECURITY.md)
- [Development and verification notes](docs/development.md)

## License

[MIT](LICENSE)
