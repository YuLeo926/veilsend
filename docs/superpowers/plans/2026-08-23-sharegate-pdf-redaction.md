# ShareGate Flattened PDF Redaction Implementation Plan

**Goal:** Add a Windows desktop PDF workflow that renders every page locally, reuses ShareGate's four visual detectors, supports automatic and manual opaque redaction, rebuilds an image-only PDF, and verifies the actual saved file.

**Architecture:** Keep page-image reconstruction and coordinate validation in the reusable Rust core. Put `Windows.Data.Pdf` rendering, the in-memory source session, and multi-page orchestration in focused Tauri modules. Reuse the existing one-page visual detector bundle, expose only safe page summaries to React, and treat the saved byte fingerprint plus a full saved-page rerender as the final trust boundary.

**Tech stack:** Rust 2024, Tauri 2, Windows Runtime `Windows.Data.Pdf`, `pdf-writer` 0.15.0, `flate2` 1.1.9, React 19, TypeScript 5.9, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-23-sharegate-pdf-redaction-design.md`

## Global constraints

- Input is a local, unencrypted `.pdf`, at most 50 MiB and 50 pages.
- Page rendering is 144 DPI, at most 40 million pixels per page and 120 million pixels per document.
- Full-resolution pages are processed sequentially; no source PDF or page image becomes a temporary source file.
- Automatic detector payloads remain private exactly as in the image workflow.
- Automatic findings default to opaque redaction; explicit **Keep** decisions become exceptions.
- Manual regions use normalized coordinates, are backend-validated, and always use opaque coverage.
- Output is a separate image-only `.redacted.pdf`, at most 300 MiB, with no original PDF objects.
- A page render failure stops export. A detector failure may allow a safety copy but prevents `Verified`.
- The saved destination is reread, fingerprinted, rendered, and rescanned before a receipt is issued.
- No runtime network access, external process, printer driver, browser renderer, model download, GPL/AGPL dependency, or source overwrite is permitted.

---

## Task 1: Pure-Rust page reconstruction and manual-region model

**Files:**

- Modify: `crates/sharegate-core/Cargo.toml`
- Create: `crates/sharegate-core/src/pdf.rs`
- Modify: `crates/sharegate-core/src/model.rs`
- Modify: `crates/sharegate-core/src/lib.rs`
- Modify: `Cargo.lock`

**Interfaces:**

- `PdfPageRaster { width_pixels, height_pixels, width_points, height_points, rgb_bytes }`
- `NormalizedRect { x, y, width, height }`
- `PdfManualRegion { id, page_index, rectangle }`
- `normalized_rect_to_pixels(rect, width, height) -> Result<ImageRect, ShareGateError>`
- `build_flattened_pdf(pages, limits) -> Result<Vec<u8>, ShareGateError>`

- [x] Add exact `pdf-writer = "=0.15.0"` and `flate2 = "=1.1.9"` dependencies.
- [x] Write failing tests for NaN, infinity, empty, tiny, out-of-range, overflow, and edge-clamped normalized rectangles.
- [x] Implement checked normalized-coordinate conversion without trusting frontend pixel geometry.
- [x] Write a failing two-page writer test covering portrait and landscape sizes, one image XObject per page, deterministic object ordering, and absence of forbidden catalog keys and source marker strings.
- [x] Implement a minimal PDF 1.7 catalog, pages tree, page/image/content triples, lossless RGB Flate streams, physical page boxes, and checked object IDs.
- [x] Add tests for output/page/pixel limits, exact redaction ink in embedded RGB streams after decompression, and no Info/XMP/actions/forms/annotations/names/attachments/outlines/structure entries.
- [x] Run `cargo test -p sharegate-core pdf` and `cargo clippy -p sharegate-core --all-targets -- -D warnings`.
- [x] Commit: `feat: add flattened PDF reconstruction core`.

---

## Task 2: Windows PDF renderer and in-memory session

**Files:**

- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/windows_pdf.rs`
- Create: `src-tauri/src/pdf_sessions.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**

- `windows_pdf::open(bytes) -> PdfDocumentHandle`
- `windows_pdf::describe(handle) -> Vec<PdfPageDescriptor>`
- `windows_pdf::render_page(handle, page_index, dpi, limit) -> RenderedPdfPage`
- `PdfSessionStore(Mutex<Option<StoredPdfSession>>)`
- `pick_pdf(state) -> PdfSession`
- `get_pdf_page_preview(session_id, page_index, state) -> PdfPagePreview`
- `clear_pdf_session(state)`

- [x] Enable the Windows `Data_Pdf` namespace and retain existing imaging/stream features.
- [x] Write failing pure tests for file size, extension, page count, aggregate-pixel arithmetic, safe filename, source freshness, replacement, and clearing.
- [x] Implement a 50 MiB read-only source loader that stores source bytes, canonical path, SHA-256, and one opaque UUID in memory.
- [x] Implement explicit Windows apartment initialization, in-memory random-access streams, unencrypted document loading, safe wrong-password mapping, page-size conversion, and serialized page rendering.
- [x] Reject empty/malformed/encrypted/over-limit input and any page that cannot be described or rendered.
- [x] Reuse `inspect_visual()` sequentially for each page, retain 320-pixel thumbnails and safe findings, and discard full-resolution pixels after each page.
- [x] Implement one selected-page preview cache capped at 1,600 pixels; preview requests never return source bytes.
- [x] Add a non-Windows adapter that compiles and returns an explicit unavailable state.
- [x] Run `cargo test -p sharegate pdf_sessions::tests`, `cargo check --workspace`, and an ignored Windows renderer fixture test.
- [x] Commit: `feat: add Windows in-memory PDF inspection sessions`.

---

## Task 3: Trusted multi-page export and saved-file verification

**Files:**

- Create: `src-tauri/src/pdf_pipeline.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/bridge.ts`

**Interfaces:**

- `PdfRedactionDecision { id, enabled }`
- `PdfCleanRequest { session_id, decisions, manual_regions }`
- `clean_pdf_file(...) -> CleanedPdfFile | null`
- `PdfVerification { status, saved_bytes_match, page_count_match, pages_rendered, checks by detector, remaining risks, message }`

- [x] Write failing tests for exact automatic decisions, per-page detector typing, geometric rematching, stale/ambiguous/missing decisions, invalid manual regions, and exception accounting.
- [x] Implement pre-export source-path fingerprint checking and full rerender from immutable session bytes.
- [x] Rerun all detectors and match recomputed findings to backend-reviewed findings by page, detector type, opaque identity, and unambiguous overlap.
- [x] Convert selected automatic and manual regions into page-pixel targets, paint with existing opaque ink, verify painted pixels, flatten to RGB, and hand pages to the core writer.
- [x] Enforce 1,000 document/manual-region limits, aggregate pixels, checked object IDs, and 300 MiB output size before showing a save dialog.
- [x] Reject a destination equal to the canonical source path; use `<stem>.redacted.pdf` as the default.
- [x] Reread the actual destination, require its SHA-256 to equal the generated buffer, reload it through Windows PDF, compare page count and sizes, rerender every page, and rerun every detector.
- [x] Implement `Verified`, `CleanedWithExceptions`, and `NeedsReview` semantics without treating a partial detector pass as clean.
- [x] Add receipt counts for pages, automatic findings by type, manual regions, exceptions, detector completion, remaining findings, and saved-byte equality.
- [x] Run `cargo test --workspace` and `cargo clippy --workspace --all-targets -- -D warnings`.
- [x] Commit: `feat: verify flattened PDF safety copies`.

---

## Task 4: PDF review interface and manual coverage

**Files:**

- Modify: `src/components/InputModeTabs.tsx`
- Create: `src/components/PdfWorkflow.tsx`
- Create: `src/lib/pdfWorkflowModel.ts`
- Create: `src/lib/pdfWorkflowModel.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/bridge.ts`
- Modify: `src/styles.css`

**Interfaces:**

- `InputMode = "text" | "image" | "pdf"`
- Pure helpers for page/finding ordering, default decisions, normalized rectangle creation, dragging/resizing bounds, receipt totals, and stage transitions.

- [x] Write failing Vitest cases for the third mode, stable per-page finding order, default redaction, manual create/resize/delete/undo, normalized bounds, detector-incomplete state, and receipt totals.
- [x] Add the **PDFs** tab and desktop-only add screen with unencrypted, 50 MiB, 50-page, and image-only warnings.
- [x] Implement scan progress, a page thumbnail rail, selected-page preview, per-page status/counts, and safe finding cards without payload content.
- [x] Implement pointer-based manual rectangle drawing, selection, resize handles, delete, undo, and clear; persist only normalized geometry.
- [x] Reuse automatic overlay treatments for text, face, QR, and barcode findings; default each to **Redact** and preserve explicit **Keep** exceptions.
- [x] Add document-level summary and a non-technical receipt for bytes, pages rebuilt, redaction counts, manual areas, exceptions, saved-byte match, page rendering, detector checks, and remaining findings.
- [x] Preserve keyboard accessibility, focus visibility, small-screen layout, and reduced-motion behavior.
- [x] Run `npm test` and `npm run build`.
- [x] Commit: `feat: add multi-page PDF safety review UI`.

---

## Task 5: Synthetic fixture, documentation, packaged acceptance, and release

**Files:**

- Create: `fixtures/pdf-sensitive-sample.pdf`
- Create: `fixtures/pdf-sensitive-attachment.txt`
- Create: `crates/sharegate-core/examples/make_pdf_fixture.rs` or a documented development-only fixture script
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/development.md`
- Modify: `src/App.tsx`

- [x] Generate a deterministic three-page PDF using reserved example values: visible and invisible text, the existing synthetic face, QR and barcode assets, a manual-only marker, metadata, link, form, JavaScript action, annotation, and embedded synthetic text.
- [x] Record fixture provenance, generation command, expected SHA-256, page sizes, and expected detector counts.
- [x] Render every source page to `tmp/pdfs/` and visually inspect page order, orientation, legibility, and detector targets.
- [x] Add automated assertions that output bytes lack the source marker, invisible secret, metadata, script, form, annotation, and attachment, and contain only controlled page-image structure.
- [x] Update public scope, privacy model, limits, lost searchable/accessibility behavior, manual redaction, password rejection, and verification semantics.
- [x] Run `cargo fmt --all -- --check`, workspace clippy/tests, explicit Windows OCR/face/PDF ignored tests, frontend tests/build, `npm audit --audit-level=moderate`, and `cargo audit`.
- [x] Build `npm run tauri build -- --no-bundle` and exercise the packaged app with the synthetic PDF.
- [x] Save a separate PDF under `output/pdf/`, render its pages under `tmp/pdfs/`, visually verify every selected/manual area, and confirm all saved-file checks complete with zero unexpected findings.
- [x] Confirm source hash unchanged, output has no original active/hidden objects, and no temporary source PDF/page image was created; remove intermediate `tmp/pdfs/` files.
- [x] Commit: `feat: add local flattened PDF safety workflow`.

---

## Plan self-review

- Every requirement in the approved design maps to one task: reconstruction, Windows rendering, source ownership, detector reuse, manual regions, review UI, saved-file verification, fixture, documentation, and packaged acceptance.
- Full-resolution page pixels are sequential and backend-owned; thumbnails and one selected preview are the only page images retained for the interface.
- Renderer failure and detector failure have different fail-closed behavior and cannot silently produce `Verified`.
- The source path, source bytes, raw OCR, code payloads, face crops, and trusted automatic geometry never cross the frontend boundary.
- Exact saved-byte equality connects the controlled writer to the actual destination; saved-page rendering and rescanning provide the independent visual second pass.
- Passwords, original PDF structure editing, external commands, cross-platform rendering, searchable output, Office files, and batch processing remain out of scope.
