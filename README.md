# VeilSend

**Scan anything before it leaves your computer.**

VeilSend is a local-first outbound safety gate for text, logs, configuration files, screenshots, images, and PDFs. It detects likely credentials and personal context, finds faces, QR codes, one-dimensional barcodes, and hidden image metadata, irreversibly covers selected visual risks, produces a separate clean copy, and verifies the actual saved output before it is shared.

> VeilSend reduces accidental disclosure. It does not guarantee that content is safe and is not a compliance product.

## Current milestone

Milestone D includes the complete text and image workflows plus a Windows-only flattened PDF safety path:

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
- rerun Windows OCR and the VeilSend rules against the saved file before reporting success;
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
- reread the actual saved output and rerun metadata, text, face, QR, and barcode checks before reporting a result;
- choose an unencrypted local PDF up to 50 MiB and 50 pages without entering or storing a password;
- render every page in memory at a fixed 144 DPI with Windows' local PDF renderer and process full-resolution pages sequentially;
- review page thumbnails, automatic text/face/QR/barcode findings, and one selected-page preview without writing source page images to temporary files;
- add, resize, delete, undo, or clear backend-validated manual cover regions;
- rebuild a separate `.redacted.pdf` from lossless RGB page pixels, with exactly one controlled image per page and no copied source PDF object graph;
- omit original text layers, metadata, links, JavaScript, forms, annotations, attachments, signatures, history, and other active or hidden objects by reconstruction;
- reread the actual saved PDF, require byte-for-byte equality with the generated buffer, render every page again, compare page count and sizes, verify opaque covers, and rerun all four visual detectors;
- report `Verified` only when all saved-page checks complete with no exceptions or unexpected findings.

Flattened PDFs are intentionally not searchable, selectable, editable, tagged for accessibility, or capable of preserving forms, signatures, bookmarks, links, attachments, or annotations. Office files and encrypted PDFs remain out of scope.

## Architecture

```text
React + TypeScript review interface
              |
       Tauri command boundary
              |
 Windows PDF/OCR/face/clipboard adapters + veilsend-core (Rust)
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

## Download the Windows beta

Official binaries are published only through the project's GitHub Releases. VeilSend 0.2.0-beta.1 is an **unsigned pre-release**: SmartScreen may warn before its first run. Download either `VeilSend_0.2.0-beta.1_x64-setup-UNSIGNED.exe` for the current-user installer or `VeilSend_0.2.0-beta.1_x64-portable-UNSIGNED.zip` for the portable app, together with `SHA256SUMS.txt` from the same Release.

Verify the downloaded filename and SHA-256 before running it:

```powershell
Get-FileHash -Algorithm SHA256 .\VeilSend_0.2.0-beta.1_x64-setup-UNSIGNED.exe
Get-Content .\SHA256SUMS.txt
```

The displayed hash must exactly match the entry in `SHA256SUMS.txt`. The installer is current-user only and may use Microsoft's WebView2 bootstrapper if that Windows runtime is unavailable. After installation, scanning, redaction, verification, and saving work offline; VeilSend has no updater, analytics, crash uploads, or background service. Read [the beta release notes](RELEASE_NOTES.md) before installing.

Use **Try safe sample** in text mode. Image mode opens local JPEG and PNG files through the native file picker or accepts a bitmap from the focused Windows clipboard. PDF mode opens `fixtures/pdf-sensitive-sample.pdf` for the bounded three-page acceptance flow. All repository fixtures are synthetic.

## Verify the project

```bash
cargo test --locked --workspace
npm audit --audit-level=moderate
npm run check:licenses
npm test
npm run build
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo check --locked -p veilsend
cargo audit
```

Build the offline executable through Tauri so the frontend is embedded rather than pointing at the development server:

```bash
npm run tauri -- build --no-bundle -- --locked
```

The locked Cargo commands fail rather than updating dependency resolution. The separator before `--locked` passes it to Tauri's Cargo runner; keep `--no-bundle` before that separator because it is a Tauri option.

## Privacy model

- No analytics, crash uploads, accounts, remote fonts, or cloud APIs.
- Source content and raw findings are not written to application logs.
- Source files are opened read-only by the interface and never overwritten.
- Clipboard access occurs only after **Paste screenshot** or a qualifying `Ctrl+V`; VeilSend does not poll, monitor, clear, or write clipboard history.
- Pasted source bytes remain in one desktop-owned in-memory session and are dropped when replaced, cleared, or the app exits. No temporary source image is created.
- Saving is explicit and defaults to a `.cleaned` or `.redacted` filename. PDF output is verified in a same-folder temporary file and published without replacing the source or any existing destination.
- Text input is limited to 10 MiB; image input to 25 MiB; PDF input to 50 MiB and 50 pages. PDF rendering is limited to 40 million pixels per page and 120 million per document; output is limited to 300 MiB.
- Metadata-only image cleaning preserves the encoded pixel stream and ICC colour profiles; verification compares a SHA-256 fingerprint of the encoded pixel data before and after cleaning.
- Visual redaction rewrites selected pixels and always exports PNG. It strips container metadata and reruns Windows OCR, face, deterministic text, QR, and barcode checks on the saved file.
- The complete OCR transcript is not sent to the interface. Only masked rule findings, categories, and the image rectangles needed for review cross the desktop command boundary.
- Decoded QR payload bytes stay inside the Rust core. The interface receives only a coarse type, byte count, severity, opaque ID, and review rectangle.
- Face detection returns location only. It creates no crop or embedding and performs no identity, emotion, age, gender, or other attribute inference.
- Decoded one-dimensional barcode payloads stay inside the Rust core. The interface receives only the supported format, encoded length, opaque ID, and review rectangle.
- PDF source bytes, canonical source path, full-resolution pages, and trusted detector geometry remain desktop-owned. Only thumbnails, one bounded preview, masked findings, and opaque IDs cross the interface boundary.
- PDF export rerenders the immutable reviewed bytes, geometrically rematches automatic findings page by page, validates up to 100 manual regions per page and 1,000 per document, and paints every selected region with opaque pixels.
- The controlled PDF writer creates a new catalog and page tree containing one lossless RGB image per page. It does not migrate source objects, metadata, text, actions, forms, annotations, names, attachments, outlines, or structure tags.
- The saved PDF must match the generated SHA-256 and bytes exactly, retain the reviewed page count and physical sizes, rerender completely, preserve every opaque cover, and complete all supported detector checks before it can be `Verified`.
- Supported detectors can miss obscured faces, unusual layouts, unreadable bars, unsupported symbols, or visible content OCR does not recognize. An unavailable or incomplete detector yields `Needs review`, never `Verified`.
- `Verified` covers the supported local detector and reconstruction checks; it is not proof that an image or PDF contains no sensitive information.

The browser preview itself is delivered by a local Vite server during development. The packaged application is the intended offline distribution.

## Documentation

- [Product and engineering design](docs/superpowers/specs/2026-08-12-veilsend-v0.1-design.md)
- [Image metadata design](docs/superpowers/specs/2026-08-12-veilsend-image-metadata-design.md)
- [Local OCR and visual redaction design](docs/superpowers/specs/2026-08-12-veilsend-ocr-redaction-design.md)
- [Local QR redaction design](docs/superpowers/specs/2026-08-12-veilsend-qr-redaction-design.md)
- [Face, barcode, and screenshot safety design](docs/superpowers/specs/2026-08-19-veilsend-visual-safety-expansion-design.md)
- [Flattened PDF safety design](docs/superpowers/specs/2026-08-23-veilsend-pdf-redaction-design.md)
- [Milestone A implementation plan](docs/superpowers/plans/2026-08-12-veilsend-milestone-a.md)
- [OCR and visual redaction implementation plan](docs/superpowers/plans/2026-08-12-veilsend-ocr-redaction.md)
- [QR redaction implementation plan](docs/superpowers/plans/2026-08-12-veilsend-qr-redaction.md)
- [Face, barcode, and screenshot implementation plan](docs/superpowers/plans/2026-08-19-veilsend-visual-safety-expansion.md)
- [Flattened PDF implementation plan](docs/superpowers/plans/2026-08-23-veilsend-pdf-redaction.md)
- [Security policy and threat model](SECURITY.md)
- [Development and verification notes](docs/development.md)

## License

[MIT](LICENSE)
