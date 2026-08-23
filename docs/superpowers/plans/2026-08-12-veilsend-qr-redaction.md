# VeilSend QR Redaction Implementation Plan

## Goal

Deliver the approved offline QR safety slice: grid detection, privacy-preserving review, irreversible region redaction, and saved-file QR verification without exposing decoded payloads outside the Rust core.

## Implementation slices

1. **QR detection core**
   - Add `quircs` and define QR kinds, findings, reports, and inspection state.
   - Decode supported images under existing limits, preserve grid bounds even when payload decoding fails, and classify successful payloads internally.
   - Return only opaque IDs, non-reversible summaries, severity, explanations, and clipped rectangles.

2. **Generic visual redaction boundary**
   - Replace OCR-specific redaction inputs with generic visual targets and decisions.
   - Keep OCR mapping independent and convert both OCR and QR findings into targets in the desktop adapter.
   - Preserve stale-source rejection, padding, orientation normalization, metadata-free PNG encoding, and explicit exception counts.

3. **Desktop orchestration and verification**
   - Include QR inspection in image sessions and rerun it immediately before cleaning.
   - Reread saved bytes and combine metadata, OCR, QR, and exception outcomes into one fail-visible status.
   - Add distinct QR counts to the saved-image receipt without serializing payload bytes.

4. **Image review interface**
   - Add QR status, cards, overlay regions, default-on decisions, and plain-language privacy copy.
   - Combine OCR and QR selections in the action bar while keeping result counts distinct.
   - Update verified, exception, and needs-review receipts for all three image checks.

5. **Fixtures, verification, and packaging**
   - Generate a synthetic QR fixture from reserved example data.
   - Test classification, payload non-disclosure, geometry, generic redaction, post-redaction detection, UI state, and regressions.
   - Run formatting, lint, workspace tests, frontend tests/build, audits, release packaging, and real desktop acceptance.

## Completion checks

- `cargo fmt --all -- --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`
- `npm test`
- `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo audit`
- Release Windows build and saved-file QR/OCR/metadata acceptance
