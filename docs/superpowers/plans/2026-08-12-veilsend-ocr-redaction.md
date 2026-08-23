# VeilSend OCR and Visual Redaction Implementation Plan

## Goal

Deliver the next approved image-safety slice: local OCR, per-finding review, irreversible pixel redaction, and post-export verification without changing or uploading the original image.

## Implementation slices

1. **Platform-neutral redaction core**
   - Define OCR words, rectangles, mapped visual findings, decisions, and verification models.
   - Reuse the text scanner to map sensitive matches back to word rectangles.
   - Decode JPEG/PNG, expand and clamp selected rectangles, fill pixels, and encode a metadata-free PNG.

2. **Windows OCR adapter**
   - Decode the selected image into a `SoftwareBitmap` with Windows imaging APIs.
   - Run the current user's installed Windows OCR recognizer and collect word rectangles.
   - Return an explicit unavailable/review state on unsupported systems or inconclusive rotation.

3. **Desktop orchestration**
   - Add OCR findings and source fingerprint data to an image session without exposing the complete OCR transcript.
   - Accept explicit visual decisions, reject stale sources, save only a separate PNG, and reread it.
   - Run metadata inspection and OCR again before deriving the final verification state.

4. **Image review interface**
   - Overlay numbered regions on the preview and show masked visual-finding cards beside metadata findings.
   - Provide default-on per-finding redaction switches and explain the missing OCR confidence score.
   - Adapt review and receipt language for metadata-only, verified-redacted, exception, and needs-review results.

5. **Verification and packaging**
   - Add deterministic Rust tests and frontend interaction tests.
   - Run workspace tests, frontend tests, production build, Rust checks, and dependency audit.
   - Build the Windows executable and complete a real desktop acceptance pass with a synthetic text image.

## Completion checks

- `cargo test --workspace`
- `npm test`
- `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo audit`
- Packaged Windows desktop acceptance with saved-file OCR and metadata verification

