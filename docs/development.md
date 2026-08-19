# ShareGate development notes

## Verification baseline

Run these checks before committing changes:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm audit --audit-level=moderate
npm test
npm run build
cargo check -p sharegate
cargo audit
```

For the final offline executable, use `npm run tauri build -- --no-bundle`. A plain `cargo build --release` does not run the frontend build or enable Tauri's embedded custom protocol and may leave the executable pointing at the development server.

The last check compiles the Windows desktop shell and therefore requires local endpoint security to allow Cargo-generated build scripts. Do not disable endpoint security automatically. If an organization blocks `target/**/build-script-build.exe`, ask its administrator to approve the Rust/Tauri build workflow or build in an approved development environment.

`cargo audit` currently exits successfully with no vulnerability advisories. It also reports maintenance warnings for GTK3-era crates retained in Tauri's cross-platform dependency graph; the Windows target does not compile or link those Linux GTK dependencies. Re-evaluate the warnings before shipping a Linux build.

## Browser preview

`npm run dev` provides a preview of the interface and uses the TypeScript base-rule adapter. It is useful for interface work but is not the production security boundary. The packaged Tauri application invokes `sharegate-core` in Rust.

Image inspection and cleaning are desktop-only because they use native file pickers and the Rust container engine. JPEG and PNG cleanup rewrites metadata containers without decoding pixels. The engine verifies an encoded-pixel fingerprint after cleanup and refuses images whose EXIF orientation cannot be removed without changing display semantics.

Visible-text inspection is currently Windows-only. The desktop adapter uses the current user's installed `Windows.Media.Ocr` recognizer, keeps the full OCR transcript inside the Rust process, and passes masked findings plus pixel rectangles to the review interface. Visual-redaction outputs are re-encoded as PNG and checked again with Windows OCR after the saved file is reread.

QR inspection is implemented in the cross-platform Rust core with `quircs`. Decoded payload bytes never cross the desktop command boundary. Extracted regions remain reviewable even when payload decoding fails, and the saved PNG must contain zero supported QR-like codes before it can be verified without exceptions.

Face inspection uses `Windows.Media.FaceAnalysis.FaceDetector`. It returns padded rectangles only and does not create crops, embeddings, identity matches, or personal-attribute inferences. Unsupported Windows devices and failed calls are incomplete checks and therefore prevent `Verified`.

One-dimensional barcode inspection uses pinned `rxing` 0.9.2 with default features disabled. The allowlist is Code 39, Code 93, Code 128, Codabar, EAN-8, EAN-13, ITF, UPC-A, UPC-E, RSS-14, RSS Expanded, and Telepen. Payload bytes remain inside the Rust core; an incomplete decode or unsafe geometry prevents `Verified`. The decoder can miss damaged, low-resolution, curved, extremely dense, or otherwise undecodable patterns.

Screenshot intake reads a bitmap from the focused Windows clipboard only after **Paste screenshot** or an eligible `Ctrl+V`. It keeps the normalized encoded image in the active desktop process session, never in a temporary source file. Replacing or clearing the session drops the bytes. ShareGate neither monitors nor clears clipboard history.

`Clipboard.GetContent` and `GetBitmapAsync` must begin on Tauri's Windows main thread so the focused desktop window supplies the required clipboard context. The returned async bitmap operation is then completed and normalized on a worker thread; do not block the UI thread while opening or encoding the bitmap. The packaged clipboard acceptance flow is the regression check for this boundary.

All five saved-image checks are independent: supported metadata, sensitive recognized text, faces, QR codes, and one-dimensional barcodes. A failed or unavailable component remains visible and changes the receipt to `Needs review`; successful components are not discarded. A user-selected **Keep** may become `Cleaned with exceptions` only when the saved finding unambiguously matches the reviewed finding of the same detector type.

## Synthetic data only

Use `fixtures/synthetic-support-log.txt` or create obviously fake values under reserved example domains. Never use a real incident log or credential to test ShareGate.

The `make_metadata_fixture` Rust example generates a synthetic PNG with an author text chunk and modification timestamp for desktop acceptance checks:

```bash
cargo run -p sharegate-core --example make_metadata_fixture -- output/sharegate-metadata-demo.png
```

`fixtures/ocr-sensitive-sample.png` contains only reserved example data. The ignored Windows adapter test exercises the installed OCR language pack and expects email, private-IP, and assigned-secret detections:

```bash
cargo test -p sharegate windows_ocr::tests::recognizes_the_synthetic_acceptance_fixture -- --ignored
```

`fixtures/qr-sensitive-sample.png` contains a synthetic link under the reserved `example.com` domain. Regenerate it and run the QR core acceptance tests with:

```bash
cargo run -p sharegate-core --example make_qr_fixture
cargo test -p sharegate-core qr::tests
```

`fixtures/barcode-sensitive-sample.png` contains three reserved synthetic values: `SGTEST-000001`, the test EAN-13 value `5901234123457`, and the test UPC-A value `036000291452`. Regeneration is deterministic:

```bash
cargo run -p sharegate-core --example make_barcode_fixture
cargo test -p sharegate-core barcode::tests
```

`fixtures/synthetic-face-source.png` is a clearly synthetic 3D clay mannequin generated on 2026-08-19 with OpenAI's built-in image generation tool. It represents no real person and contains no private data. Its SHA-256 is `c243801fda58b63cc987ba19ab9c51a67fe452b4eab6804ef28cd0d1442f6abe`. The generation prompt requested one fictional, front-facing, non-photorealistic terracotta mannequin on a plain warm background, with no text, numbers, logos, watermark, jewelry, patterned clothing, real-person photography, or celebrity resemblance.

The deterministic compositor places the barcode fixture beside that portrait:

```bash
cargo run -p sharegate-core --example make_barcode_fixture
cargo run -p sharegate-core --example make_visual_fixture
cargo test -p sharegate windows_faces::tests::recognizes_the_synthetic_acceptance_fixture -- --ignored
```

The resulting `fixtures/visual-sensitive-sample.png` is the packaged clipboard acceptance fixture. Copy it to the Windows clipboard, open image mode, press `Ctrl+V`, confirm one face and three barcode findings without payload content, redact all, save a separate PNG, and require all five saved-file checks to complete with zero unexpected findings. Confirm the fixture hash is unchanged and that no temporary source image was created.

PDF support is intentionally deferred to a separate bounded page-rendering and image-only reconstruction pipeline. Do not treat a PDF as an image container or reuse the current single-image session without a dedicated design review.
