# ShareGate development notes

## Verification baseline

Run these checks before committing changes:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm audit
npm test
npm run build
cargo check -p sharegate
```

The last check compiles the Windows desktop shell and therefore requires local endpoint security to allow Cargo-generated build scripts. Do not disable endpoint security automatically. If an organization blocks `target/**/build-script-build.exe`, ask its administrator to approve the Rust/Tauri build workflow or build in an approved development environment.

`cargo audit` currently exits successfully with no vulnerability advisories. It also reports maintenance warnings for GTK3-era crates retained in Tauri's cross-platform dependency graph; the Windows target does not compile or link those Linux GTK dependencies. Re-evaluate the warnings before shipping a Linux build.

## Browser preview

`npm run dev` provides a preview of the interface and uses the TypeScript base-rule adapter. It is useful for interface work but is not the production security boundary. The packaged Tauri application invokes `sharegate-core` in Rust.

Image inspection and cleaning are desktop-only because they use native file pickers and the Rust container engine. JPEG and PNG cleanup rewrites metadata containers without decoding pixels. The engine verifies an encoded-pixel fingerprint after cleanup and refuses images whose EXIF orientation cannot be removed without changing display semantics.

Visible-text inspection is currently Windows-only. The desktop adapter uses the current user's installed `Windows.Media.Ocr` recognizer, keeps the full OCR transcript inside the Rust process, and passes masked findings plus pixel rectangles to the review interface. Visual-redaction outputs are re-encoded as PNG and checked again with Windows OCR after the saved file is reread.

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
