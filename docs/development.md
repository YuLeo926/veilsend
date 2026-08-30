# VeilSend development notes

## Verification baseline

Run these checks before committing changes:

```bash
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
npm audit --audit-level=moderate
npm run check:licenses
npm test
npm run build
cargo check --locked -p veilsend
cargo audit
```

For the final offline executable, use `npm run tauri -- build --no-bundle -- --locked`. A plain `cargo build --release` does not run the frontend build or enable Tauri's embedded custom protocol and may leave the executable pointing at the development server. The separator before `--locked` passes that flag to Tauri's Cargo runner; `npm run tauri build -- --locked` is not equivalent and this Tauri CLI rejects it as an unknown top-level option.

The last check compiles the Windows desktop shell and therefore requires local endpoint security to allow Cargo-generated build scripts. Do not disable endpoint security automatically. If an organization blocks `target/**/build-script-build.exe`, ask its administrator to approve the Rust/Tauri build workflow or build in an approved development environment.

`cargo audit` currently exits successfully with no vulnerability advisories. It also reports maintenance warnings for GTK3-era crates retained in Tauri's cross-platform dependency graph; the Windows target does not compile or link those Linux GTK dependencies. Re-evaluate the warnings before shipping a Linux build.

## Hosted quality gate

Pull requests and pushes to `master` run the read-only `quality / windows` workflow on `windows-2025`. The workflow uses the committed npm and Cargo lockfiles and runs this sequence:

```bash
npm ci
npm run test:release
npm run check:licenses
npm test
npm run build
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
cargo test --locked --workspace --all-features
npm audit --audit-level=high
cargo install cargo-audit --version 0.22.2 --locked
cargo audit
```

All dependency-resolving Cargo commands use the committed lockfile and fail instead of updating dependency resolution. `npm run check:licenses` is reproducible from the committed lockfiles; on a first or clean environment Cargo may fetch the locked crate sources before `cargo metadata --locked` can compare the generated production license bundle. `cargo fmt` does not resolve dependencies, so `--locked` does not apply to it.

The hosted job produces no artifacts, releases, attestations, or write permissions. Detector-dependent ignored tests for Windows OCR, face detection, and PDF acceptance remain part of controlled Windows acceptance rather than an ordinary hosted quality pass.

## Draft beta release workflow

Pushing the exact `v0.2.0-beta.1` tag starts the release-only `release / windows-beta` workflow. The workflow rejects every other `v*` tag through the repository release contract, repeats all hosted quality gates, builds the current-user NSIS installer and portable executable once, and stages the exact asset names exported by `scripts/release-contract.mjs`.

The job generates a CycloneDX JSON SBOM and `SHA256SUMS.txt`, verifies the complete four-file asset set and every checksum, uploads the `veilsend-v0.2.0-beta.1-release-assets` review artifact, and creates GitHub build-provenance attestations. It then creates a **draft pre-release** using `RELEASE_NOTES.md`; it never publishes the Release. If that tag already has a Release, including a draft, the job stops. A maintainer must inspect and explicitly delete a failed draft before retrying, so a rerun cannot silently replace assets.

Release permissions (`contents: write`, `id-token: write`, and `attestations: write`) exist only in this tag-triggered workflow. Pull requests and ordinary branch pushes cannot invoke it and remain covered by the read-only hosted quality job. All third-party Actions are pinned to full commit SHAs.

To validate the release asset contract locally without pushing a tag or creating a GitHub Release, run:

```powershell
npm run test:release
npm run check:licenses
npm run tauri -- build -- --locked
pwsh -NoProfile -File scripts/stage-release.ps1 -Version 0.2.0-beta.1 -ArtifactsDirectory artifacts
```

After generating `artifacts/veilsend-0.2.0-beta.1-sbom.cdx.json` with the pinned workflow action, the workflow hashes the installer, portable ZIP, and SBOM in filename order. The resulting `SHA256SUMS.txt` uses lowercase SHA-256 followed by two spaces and the asset filename, and the next step recalculates every digest before attestation and draft creation. Local validation must not push a tag, invoke the remote workflow, or call `gh release create`.

## Browser preview

`npm run dev` provides a preview of the interface and uses the TypeScript base-rule adapter. It is useful for interface work but is not the production security boundary. The packaged Tauri application invokes `veilsend-core` in Rust.

Image inspection and cleaning are desktop-only because they use native file pickers and the Rust container engine. JPEG and PNG cleanup rewrites metadata containers without decoding pixels. The engine verifies an encoded-pixel fingerprint after cleanup and refuses images whose EXIF orientation cannot be removed without changing display semantics.

Visible-text inspection is currently Windows-only. The desktop adapter uses the current user's installed `Windows.Media.Ocr` recognizer, keeps the full OCR transcript inside the Rust process, and passes masked findings plus pixel rectangles to the review interface. Visual-redaction outputs are re-encoded as PNG and checked again with Windows OCR after the saved file is reread.

QR inspection is implemented in the cross-platform Rust core with `quircs`. Decoded payload bytes never cross the desktop command boundary. Extracted regions remain reviewable even when payload decoding fails, and the saved PNG must contain zero supported QR-like codes before it can be verified without exceptions.

Face inspection uses `Windows.Media.FaceAnalysis.FaceDetector`. It returns padded rectangles only and does not create crops, embeddings, identity matches, or personal-attribute inferences. Unsupported Windows devices and failed calls are incomplete checks and therefore prevent `Verified`.

One-dimensional barcode inspection uses pinned `rxing` 0.9.2 with default features disabled. The allowlist is Code 39, Code 93, Code 128, Codabar, EAN-8, EAN-13, ITF, UPC-A, UPC-E, RSS-14, RSS Expanded, and Telepen. Payload bytes remain inside the Rust core; an incomplete decode or unsafe geometry prevents `Verified`. The decoder can miss damaged, low-resolution, curved, extremely dense, or otherwise undecodable patterns.

Screenshot intake reads a bitmap from the focused Windows clipboard only after **Paste screenshot** or an eligible `Ctrl+V`. It keeps the normalized encoded image in the active desktop process session, never in a temporary source file. Replacing or clearing the session drops the bytes. VeilSend neither monitors nor clears clipboard history.

`Clipboard.GetContent` and `GetBitmapAsync` must begin on Tauri's Windows main thread so the focused desktop window supplies the required clipboard context. The returned async bitmap operation is then completed and normalized on a worker thread; do not block the UI thread while opening or encoding the bitmap. The packaged clipboard acceptance flow is the regression check for this boundary.

All five saved-image checks are independent: supported metadata, sensitive recognized text, faces, QR codes, and one-dimensional barcodes. A failed or unavailable component remains visible and changes the receipt to `Needs review`; successful components are not discarded. A user-selected **Keep** may become `Cleaned with exceptions` only when the saved finding unambiguously matches the reviewed finding of the same detector type.

## Flattened PDF workflow

PDF support is Windows-only and is a separate renderer-and-reconstruction trust boundary. `Windows.Data.Pdf` loads an unencrypted document from desktop-owned memory, reports physical page sizes, and renders sequentially at 144 DPI. The active session retains immutable source bytes, a canonical source path, a SHA-256 fingerprint, safe detector snapshots, 320-pixel thumbnails, and no full-resolution page cache. One selected-page preview is capped at 1,600 pixels.

Input is limited to 50 MiB and 50 pages, with 40 million pixels per page and 120 million per document. A document may contain at most 100 manual regions per page and 1,000 total. Output is limited to 300 MiB. Password entry, encrypted output, Office files, batch processing, page reordering, and preservation of selectable text or interactive PDF features are not supported.

Export rereads the source path and requires its fingerprint to match the reviewed session. It rerenders immutable source bytes, reruns all four visual detectors, scopes identities by page, geometrically rematches every automatic finding, requires an exact **Redact** or **Keep** decision set, validates normalized manual regions in Rust, and verifies selected pixels are opaque. Full-resolution RGB is Flate-compressed one page at a time before the final document is assembled.

The writer creates a new PDF 1.7 catalog and page tree with exactly one lossless RGB image XObject and one short content stream per page. It writes no Info dictionary, XMP, original text, action, form, annotation, names tree, attachment, outline, signature, structure tree, or source object. The result intentionally loses text selection, search, tagged accessibility, forms, signatures, links, bookmarks, annotations, and attachments.

VeilSend writes the generated bytes to a same-folder temporary PDF, compares that file byte-for-byte with the generated buffer, releases the in-memory output, then reloads the staged file through Windows PDF. It compares page count and physical sizes, rerenders every page, verifies the opaque regions, and reruns text, face, QR, and barcode checks. Only after that succeeds is the same verified file atomically published without replacing an existing destination; the final path is reread incrementally and must retain the staged size and SHA-256. Any incomplete detector or unexpected remaining finding yields `Needs review`; complete checks plus an explicit **Keep** yield `Cleaned with exceptions`.

## Synthetic data only

Use `fixtures/synthetic-support-log.txt` or create obviously fake values under reserved example domains. Never use a real incident log or credential to test VeilSend.

The `make_metadata_fixture` Rust example generates a synthetic PNG with an author text chunk and modification timestamp for desktop acceptance checks:

```bash
cargo run -p veilsend-core --example make_metadata_fixture -- output/veilsend-metadata-demo.png
```

`fixtures/ocr-sensitive-sample.png` contains only reserved example data. The ignored Windows adapter test exercises the installed OCR language pack and expects email, private-IP, and assigned-secret detections:

```bash
cargo test -p veilsend windows_ocr::tests::recognizes_the_synthetic_acceptance_fixture -- --ignored
```

`fixtures/qr-sensitive-sample.png` contains a synthetic link under the reserved `example.com` domain. Regenerate it and run the QR core acceptance tests with:

```bash
cargo run -p veilsend-core --example make_qr_fixture
cargo test -p veilsend-core qr::tests
```

`fixtures/barcode-sensitive-sample.png` contains three reserved synthetic values: `SGTEST-000001`, the test EAN-13 value `5901234123457`, and the test UPC-A value `036000291452`. Regeneration is deterministic:

```bash
cargo run -p veilsend-core --example make_barcode_fixture
cargo test -p veilsend-core barcode::tests
```

`fixtures/synthetic-face-source.png` is a clearly synthetic 3D clay mannequin generated on 2026-08-19 with OpenAI's built-in image generation tool. It represents no real person and contains no private data. Its SHA-256 is `c243801fda58b63cc987ba19ab9c51a67fe452b4eab6804ef28cd0d1442f6abe`. The generation prompt requested one fictional, front-facing, non-photorealistic terracotta mannequin on a plain warm background, with no text, numbers, logos, watermark, jewelry, patterned clothing, real-person photography, or celebrity resemblance.

The deterministic compositor places the barcode fixture beside that portrait:

```bash
cargo run -p veilsend-core --example make_barcode_fixture
cargo run -p veilsend-core --example make_visual_fixture
cargo test -p veilsend windows_faces::tests::recognizes_the_synthetic_acceptance_fixture -- --ignored
```

The resulting `fixtures/visual-sensitive-sample.png` is the packaged clipboard acceptance fixture. Copy it to the Windows clipboard, open image mode, press `Ctrl+V`, confirm one face and three barcode findings without payload content, redact all, save a separate PNG, and require all five saved-file checks to complete with zero unexpected findings. Confirm the fixture hash is unchanged and that no temporary source image was created.

`fixtures/pdf-sensitive-sample.pdf` is the deterministic three-page PDF acceptance fixture. Page 1 is portrait letter size (`612 × 792 pt`) and reuses the stable OCR acceptance raster for three reserved visible rule findings, plus an original visible text-layer marker. Page 2 is landscape letter size (`792 × 612 pt`) and contains one synthetic face, one synthetic QR code, and three synthetic one-dimensional barcodes. Page 3 is `720 × 540 pt` and contains a manual-only orange/black marker plus invisible text, document metadata, a link, a JavaScript action, a form field, an annotation, and `fixtures/pdf-sensitive-attachment.txt` as an embedded file.

The expected Windows detector counts are three text findings on page 1, one face, one QR, and three barcodes on page 2, and zero automatic findings on page 3. The acceptance flow adds one manual cover to page 3, selects all eight automatic findings, rebuilds three image-only pages, and requires a `Verified` saved-file receipt with no unexpected remaining findings.

Regenerate the source fixture deterministically:

```bash
cargo run -p veilsend-core --example make_qr_fixture
cargo run -p veilsend-core --example make_barcode_fixture
cargo run -p veilsend-core --example make_visual_fixture
cargo run -p veilsend-core --example make_pdf_fixture
```

Expected SHA-256 values:

- `fixtures/pdf-sensitive-sample.pdf`: `fff96e09d22791ac0c4f56f8925409891b90b8d41540db6f85b2e3c461a7ee1e`
- `fixtures/pdf-sensitive-attachment.txt`: `c7f94c54296fdc83d2d595189356d2079e5911fca6738ad2f1b1b87a0df98cc3`

Run the complete object-removal, page-rendering, redaction, and saved-page verification test:

```bash
cargo test -p veilsend pdf_pipeline::tests::fixture_reconstruction_omits_hidden_and_active_source_objects -- --nocapture
```

For manual packaged acceptance, choose the fixture in PDF mode, confirm the expected counts, add a cover around the page 3 marker, keep no automatic finding, save a separate `.redacted.pdf`, and require all pages and detectors to pass. Render source and final pages only under `tmp/pdfs/`, remove those temporary renders after inspection, and keep the final PDF under `output/pdf/`. Confirm the source hash remains unchanged and the output bytes contain none of `SG_PDF_SOURCE_MARKER`, `SG_PDF_INVISIBLE_MARKER`, `SG_PDF_METADATA_MARKER`, `SG_PDF_JAVASCRIPT_MARKER`, `SG_PDF_FORM_MARKER`, `SG_PDF_ATTACHMENT_MARKER`, or `SG_PDF_ANNOTATION_MARKER`.
