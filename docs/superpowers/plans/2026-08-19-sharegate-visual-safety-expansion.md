# ShareGate Visual Safety Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local face detection, supported one-dimensional barcode detection, and direct screenshot paste to ShareGate's existing image review and saved-file verification workflow.

**Architecture:** Keep barcode decoding in the reusable Rust core and Windows face/clipboard adapters in the Tauri host. Replace path-bearing frontend requests with one desktop-owned image source session, then coordinate OCR, face, QR, barcode, and metadata inspection through a shared visual bundle before export and against the actual saved bytes afterward.

**Tech Stack:** Rust 2024, Tauri 2, Windows Runtime APIs, `rxing` 0.9.2, React 19, TypeScript 5.9, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-19-sharegate-visual-safety-expansion-design.md`

## Global Constraints

- Windows 10 or later remains the packaged desktop target.
- Input stays limited to JPEG and PNG, at most 25 MiB encoded and within the existing decoded-pixel limit.
- Face detection uses `Windows.Media.FaceAnalysis.FaceDetector`; it creates no embeddings and reports no identity or demographic attribute.
- Barcode support is restricted to Code 39, Code 93, Code 128, Codabar, EAN-8, EAN-13, ITF, UPC-A, UPC-E, RSS-14, RSS Expanded, and Telepen.
- Barcode payloads, face crops, full OCR text, and QR payloads never cross the Tauri boundary or enter logs, filenames, or errors.
- Clipboard intake is user-triggered, keeps exactly one active source session, and writes no temporary source file.
- Visual redaction uses opaque pixels and a separate PNG; blur and pixelation are not safety modes.
- Every enabled detector reruns against the actual saved bytes; incomplete checks prevent `Verified`.
- Dependencies must permit MIT distribution and require no runtime network access or model download.

---

## File Structure

### New files

- `crates/sharegate-core/src/barcode.rs` — one-dimensional barcode decoding, safe geometry, summaries, and core tests.
- `src-tauri/src/windows_faces.rs` — Windows face adapter and safe error classification.
- `src-tauri/src/windows_clipboard.rs` — focused clipboard bitmap intake and PNG normalization.
- `src-tauri/src/image_sessions.rs` — one-session source store for file and clipboard inputs.
- `src-tauri/src/image_pipeline.rs` — combined detector bundles, trusted decision matching, targets, and verification helpers.
- `src/lib/imageWorkflowModel.ts` — pure UI composition and paste-routing helpers.
- `src/lib/imageWorkflowModel.test.ts` — Vitest coverage for the UI model without adding a DOM-test dependency.
- `crates/sharegate-core/examples/make_barcode_fixture.rs` — reproducible synthetic one-dimensional barcode fixture generator.
- `fixtures/barcode-sensitive-sample.png` — generated barcode-only fixture.
- `fixtures/visual-sensitive-sample.png` — synthetic acceptance image containing a non-identifying face and generated barcodes.

### Modified files

- `Cargo.lock` — locked dependency graph.
- `crates/sharegate-core/Cargo.toml` — minimal `rxing` decoder features and test-only encoder features.
- `crates/sharegate-core/src/lib.rs` — barcode module/export.
- `crates/sharegate-core/src/model.rs` — barcode and face serialized models.
- `src-tauri/Cargo.toml` — Windows face/clipboard features and UUID support.
- `src-tauri/src/lib.rs` — commands, managed session store, save dialog, and response assembly.
- `src/lib/types.ts` — session, face, barcode, and receipt types.
- `src/lib/bridge.ts` — session-ID commands for choose, paste, clear, and clean.
- `src/components/ImageWorkflow.tsx` — paste intake, five checks, overlays, findings, and receipt.
- `src/styles.css` — paste controls and face/barcode visual treatments.
- `src/App.tsx` — milestone copy.
- `README.md`, `SECURITY.md`, `docs/development.md` — supported scope, threat model, limitations, and build/acceptance notes.

---

### Task 1: Pure-Rust one-dimensional barcode scanner

**Files:**
- Modify: `crates/sharegate-core/Cargo.toml`
- Modify: `crates/sharegate-core/src/model.rs:273`
- Create: `crates/sharegate-core/src/barcode.rs`
- Modify: `crates/sharegate-core/src/lib.rs:1-20`
- Modify: `Cargo.lock`

**Interfaces:**
- Consumes: encoded JPEG/PNG bytes and `DEFAULT_MAX_IMAGE_BYTES`.
- Produces: `pub fn inspect_barcodes(input: &[u8], max_bytes: usize) -> Result<BarcodeScanReport, ShareGateError>`.
- Produces: `BarcodeKind`, `BarcodeFinding`, `BarcodeScanReport`, `BarcodeAvailability`, and `ImageBarcodeInspection` serialized with camel-case names.

- [ ] **Step 1: Add the minimal dependency contract**

Use an exact release and exclude unrelated 2D readers and image-format decoders:

```toml
rxing = { version = "=0.9.2", default-features = false, features = ["decoders", "encoding_rs", "multi_barcode_readers", "oned"] }

[dev-dependencies]
rxing = { version = "=0.9.2", default-features = false, features = ["encoders", "encoding_rs", "oned"] }
```

- [ ] **Step 2: Define safe serialized barcode types**

Add an enum with exactly the approved formats and a finding that exposes only coarse format, encoded length, opaque ID, severity, explanation, masked summary, and rectangle:

```rust
pub struct BarcodeFinding {
    pub id: String,
    pub kind: BarcodeKind,
    pub label: String,
    pub explanation: String,
    pub severity: Severity,
    pub masked_value: String,
    pub encoded_length: usize,
    pub rectangle: ImageRect,
}
```

- [ ] **Step 3: Write failing privacy and format tests**

Cover a generated Code 128 image and assert that serialization contains the format and byte count but not `SGTEST-ACCOUNT-001`:

```rust
let report = inspect_barcodes(&fixture, DEFAULT_MAX_IMAGE_BYTES).unwrap();
assert_eq!(report.findings[0].kind, BarcodeKind::Code128);
assert!(!serde_json::to_string(&report).unwrap().contains("SGTEST-ACCOUNT-001"));
```

Run: `cargo test -p sharegate-core barcode::tests::classifies_code_128_without_serializing_payload`

Expected: FAIL because `barcode` and `inspect_barcodes` do not exist.

- [ ] **Step 4: Implement minimal restricted decoding**

Decode the existing in-memory grayscale pixels with `POSSIBLE_FORMATS`, `TRY_HARDER`, and `ALSO_INVERTED`; map library formats through an exhaustive allowlist and discard every non-allowlisted result.

- [ ] **Step 5: Add geometry and multiple-symbol tests**

Generate horizontal, 90-degree rotated, inverted, and two-code fixtures. Assert every rectangle is non-empty, bounded by image dimensions, conservatively padded on its minor axis, and deduplicated without using payload as the public key.

Run: `cargo test -p sharegate-core barcode`

Expected: PASS for every barcode-core test.

- [ ] **Step 6: Prove redaction destroys decoding**

Convert detected barcode findings into `ImageRedactionTarget`, call `redact_image`, and assert the selected symbol is absent from a second `inspect_barcodes` call.

Run: `cargo test -p sharegate-core barcode::tests::opaque_redaction_makes_selected_barcode_undecodable`

Expected: PASS.

- [ ] **Step 7: Audit and commit the core slice**

Run: `cargo fmt --all -- --check`

Run: `cargo clippy -p sharegate-core --all-targets -- -D warnings`

Run: `cargo audit`

Expected: formatting and clippy pass; audit introduces no new vulnerability advisory.

Commit: `feat: add local one-dimensional barcode detection`

---

### Task 2: Windows face adapter

**Files:**
- Modify: `src-tauri/Cargo.toml:23-30`
- Create: `src-tauri/src/windows_faces.rs`
- Modify: `crates/sharegate-core/src/model.rs:312-321`
- Modify: `src-tauri/src/lib.rs:16`

**Interfaces:**
- Consumes: encoded JPEG/PNG bytes.
- Produces: `pub fn detect(input: &[u8]) -> Result<Vec<ImageRect>, FaceAdapterError>`.
- Produces: `FaceFinding`, `FaceAvailability`, and `ImageFaceInspection`; each finding contains only an opaque ID, label, explanation, severity, and rectangle.

- [ ] **Step 1: Add required Windows namespaces**

Enable `Media_FaceAnalysis` while preserving the existing OCR and imaging features:

```toml
"Media_FaceAnalysis",
```

- [ ] **Step 2: Write failing rectangle and error-mapping tests**

Extract pure conversion helpers and verify negative/fractional Windows rectangles clamp outward to safe integer pixels. Verify unsupported APIs map to `Unavailable` and invalid geometry maps to `NeedsReview`.

Run: `cargo test -p sharegate windows_faces::tests`

Expected: FAIL because `windows_faces` does not exist.

- [ ] **Step 3: Implement in-memory face detection**

Decode through `BitmapDecoder`, check `FaceDetector::IsSupported`, convert the `SoftwareBitmap` to a runtime-supported pixel format, create the detector, and return only valid face boxes. Do not store crops or return detector internals.

- [ ] **Step 4: Add the non-Windows fail-visible adapter**

Return:

```rust
Err(FaceAdapterError::Unavailable(
    "Local face detection is currently available on Windows.".to_owned(),
))
```

This keeps workspace builds portable while preventing a clean claim on unsupported platforms.

- [ ] **Step 5: Run adapter and workspace checks**

Run: `cargo test -p sharegate windows_faces::tests`

Run: `cargo check --workspace`

Expected: PASS on Windows; non-Windows compilation uses the explicit unavailable adapter.

- [ ] **Step 6: Commit the face adapter**

Commit: `feat: add Windows local face detection`

---

### Task 3: Desktop-owned source session and clipboard bitmap intake

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/image_sessions.rs`
- Create: `src-tauri/src/windows_clipboard.rs`
- Modify: `src-tauri/src/lib.rs:18-28,92-112,318-340,493-504`
- Modify: `src/lib/types.ts:146-154`
- Modify: `src/lib/bridge.ts:44-64`

**Interfaces:**
- Produces: `ImageSessionStore(Mutex<Option<StoredImageSession>>)` managed by Tauri.
- Produces: `ImageSource::File { canonical_path } | ImageSource::Clipboard { encoded_bytes }`.
- Produces commands: `pick_image(state)`, `paste_image(state)`, `clear_image_session(state)`, and `clean_image_file(session_id, decisions, state)`.
- Frontend `ImageSession` contains `sessionId`, `sourceKind`, `filename`, preview, and inspections; it no longer contains `sourcePath` or `sourceFingerprint`.

- [ ] **Step 1: Write failing one-session store tests**

Verify inserting clipboard bytes returns an opaque UUID, replacing it drops the prior bytes, resolving a missing ID fails, and clearing removes the active session:

```rust
let first = store.replace_clipboard(first_png).unwrap();
let second = store.replace_clipboard(second_png).unwrap();
assert!(store.resolve(&first.id).is_err());
assert_eq!(store.resolve(&second.id).unwrap().fingerprint, second.fingerprint);
```

Run: `cargo test -p sharegate image_sessions::tests`

Expected: FAIL because the store does not exist.

- [ ] **Step 2: Implement the source store**

Use `uuid = { version = "1", features = ["v4"] }`. Canonicalize file paths at intake, retain only path plus fingerprint for files, retain encoded bytes for clipboard sources, and expose a resolver that rereads files and verifies the stored fingerprint.

- [ ] **Step 3: Write failing clipboard normalization tests**

Test pure stream-size validation and PNG signature validation without mutating the system clipboard. Add an ignored Windows acceptance test that reads an already-present clipboard bitmap but never writes or clears clipboard history.

Run: `cargo test -p sharegate windows_clipboard::tests`

Expected: FAIL because the clipboard adapter does not exist.

- [ ] **Step 4: Implement focused bitmap intake**

Use `Clipboard::GetContent`, require `StandardDataFormats::Bitmap`, call `GetBitmapAsync`, decode the returned stream, and encode a normalized PNG into an in-memory stream. Enforce 25 MiB before returning bytes. Map empty, non-bitmap, focus-denied, and decoding failures to content-free messages.

- [ ] **Step 5: Replace path-bearing commands**

Register the managed store:

```rust
tauri::Builder::default()
    .manage(ImageSessionStore::default())
```

Change cleaning requests to `{ sessionId, decisions }`; resolve trusted bytes inside Rust. Add `paste_image` and `clear_image_session` to the invoke handler.

- [ ] **Step 6: Update TypeScript contracts and bridge**

Expose:

```ts
export const pasteImage = () => invoke<ImageSession>("paste_image");
export const clearImageSession = () => invoke<void>("clear_image_session");
export const cleanImageFile = (sessionId: string, decisions: ImageRedactionDecision[]) =>
  invoke<CleanedImageFile | null>("clean_image_file", { sessionId, decisions });
```

- [ ] **Step 7: Verify and commit source ownership**

Run: `cargo test --workspace`

Run: `npm run build`

Expected: Rust tests and TypeScript build pass; no frontend cleaning request contains a disk path or fingerprint.

Commit: `feat: add in-memory screenshot intake sessions`

---

### Task 4: Unified visual detector pipeline and post-save verification

**Files:**
- Create: `src-tauri/src/image_pipeline.rs`
- Modify: `src-tauri/src/lib.rs:18-58,108-316,318-440`
- Modify: `src/lib/types.ts:115-178`

**Interfaces:**
- Produces internal `DetectorKind::{Text, Face, Qr, Barcode}`.
- Produces internal `ReviewedVisualFinding { id, kind, rectangles }`.
- Produces `VisualInspectionBundle { ocr, faces, qr, barcodes, reviewed }`.
- Produces pure helpers `resolve_decisions(reviewed, recomputed, decisions)` and `remaining_are_exceptions(remaining, kept)`.
- Expands `CleanedImageVerification` with face/barcode checked flags and remaining counts.

- [ ] **Step 1: Write failing decision-integrity tests**

Cover exact match, stable overlap after a small face-box shift, cross-detector rejection, missing decision rejection, ambiguous overlap rejection, and default-redact behavior only for a reviewed finding whose explicit decision is present.

Run: `cargo test -p sharegate image_pipeline::tests::decision_matching`

Expected: FAIL because `image_pipeline` does not exist.

- [ ] **Step 2: Implement combined inspection**

Run metadata, OCR, faces, QR, and barcode inspection independently. Preserve every successful result, record a safe message for each failed detector, and build generic reviewed findings without raw OCR or code payloads.

- [ ] **Step 3: Integrate trusted pre-export recomputation**

Resolve source bytes from the session, rerun the full bundle, pair current findings with backend-stored reviewed findings by detector type and unambiguous geometric overlap, reject changed detector sets, then build generic redaction targets.

- [ ] **Step 4: Write failing saved-output exception tests**

Verify a deliberately kept face is accepted only as `CleanedWithExceptions`, an unreviewed remaining face is `NeedsReview`, and a barcode cannot satisfy a kept QR exception even when rectangles overlap.

Run: `cargo test -p sharegate image_pipeline::tests::saved_output_exceptions`

Expected: FAIL until type-safe exception matching exists.

- [ ] **Step 5: Extend saved-file verification**

Reread the saved bytes and recompute the bundle. `Verified` requires five complete checks and zero findings. `CleanedWithExceptions` requires all remaining findings to match explicit same-type kept regions. Any partial detector or unexpected result becomes `NeedsReview`.

- [ ] **Step 6: Extend response counts and messages**

Return `redactedFaceFindings`, `redactedBarcodeFindings`, `facesRemaining`, `faceChecked`, `barcodesRemaining`, and `barcodeChecked`. Messages name every detector that was rerun and never claim universal safety.

- [ ] **Step 7: Run regression suite and commit**

Run: `cargo test --workspace`

Run: `cargo clippy --workspace --all-targets -- -D warnings`

Expected: all existing text, metadata, OCR, QR, and new pipeline tests pass.

Commit: `feat: verify faces and barcodes in saved images`

---

### Task 5: Image review interface and paste shortcut

**Files:**
- Create: `src/lib/imageWorkflowModel.ts`
- Create: `src/lib/imageWorkflowModel.test.ts`
- Modify: `src/components/ImageWorkflow.tsx:1-450`
- Modify: `src/styles.css:321-520`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: expanded `ImageSession`, `CleanedImageFile`, `pasteImage`, and `clearImageSession`.
- Produces pure `buildVisualFindings(session)`, `buildDefaultDecisions(session)`, `isImagePasteShortcut(eventTarget, stage)`, and `remainingRiskCount(result)` helpers.

- [ ] **Step 1: Write failing pure UI-model tests**

Assert the model orders text, face, QR, and barcode findings; selects every one by default; rejects paste routing from `input`, `textarea`, and content-editable targets; and includes all four visual remainder counts in the receipt total.

Run: `npm test -- imageWorkflowModel.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the pure UI model**

Represent visual items with:

```ts
type VisualFindingView = {
  id: string;
  type: "text" | "face" | "qr" | "barcode";
  rectangles: ImageRect[];
};
```

Keep detector ordering stable so overlay numbering and review cards agree.

- [ ] **Step 3: Add screenshot paste intake**

Add a **Paste screenshot** button beside **Choose image** and a `useEffect` keydown listener for `Ctrl+V`. Route both through one `acceptSession` helper. Do not intercept editable targets or the text workflow.

- [ ] **Step 4: Render five detector statuses and four visual sections**

Add face and barcode status rows, overlay classes, finding cards, default-redact toggles, safe summaries, and explicit statements that face identity is not inferred and barcode payloads stay hidden.

- [ ] **Step 5: Extend result receipt**

Show redacted face/barcode counts, saved-file face/barcode check completion, all supported remaining risks, and updated limitations. Call `clearImageSession` on **Check another image** and when a newly accepted source replaces the old review.

- [ ] **Step 6: Style without redesigning the product**

Use rounded dashed face boxes and a striped blue-green barcode treatment while preserving existing spacing, type, responsive breakpoints, reduced-motion behavior, and non-technical copy.

- [ ] **Step 7: Verify and commit the interface**

Run: `npm test`

Run: `npm run build`

Expected: all Vitest tests and the production frontend build pass.

Commit: `feat: add face barcode and screenshot review UI`

---

### Task 6: Fixtures, documentation, packaged acceptance, and release build

**Files:**
- Create: `crates/sharegate-core/examples/make_barcode_fixture.rs`
- Create: `fixtures/barcode-sensitive-sample.png`
- Create: `fixtures/visual-sensitive-sample.png`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/development.md`

**Interfaces:**
- Consumes: completed detector and UI pipeline.
- Produces: reproducible barcode fixtures, a synthetic face/barcode acceptance image, current documentation, and `target/release/sharegate.exe`.

- [ ] **Step 1: Add deterministic barcode fixture generation**

Generate reserved fake payloads only, including `SGTEST-000001`, an EAN check-digit-valid test number, and a UPC check-digit-valid test number. Record the exact regeneration command in `docs/development.md`.

Run: `cargo run -p sharegate-core --example make_barcode_fixture`

Expected: `fixtures/barcode-sensitive-sample.png` is regenerated byte-for-byte.

- [ ] **Step 2: Add a synthetic face acceptance image**

Use a clearly synthetic, non-identifying generated portrait and compose it with the deterministic barcode fixture. Document that no real person's image or private data is present. Keep asset provenance in `docs/development.md`.

- [ ] **Step 3: Run automated acceptance**

Run: `cargo fmt --all -- --check`

Run: `cargo clippy --workspace --all-targets -- -D warnings`

Run: `cargo test --workspace`

Run: `cargo test -p sharegate windows_ocr::tests::recognizes_the_synthetic_acceptance_fixture -- --ignored`

Run: `cargo test -p sharegate windows_faces::tests::recognizes_the_synthetic_acceptance_fixture -- --ignored`

Run: `npm test`

Run: `npm run build`

Run: `npm audit --audit-level=moderate`

Run: `cargo audit`

Expected: all tests and builds pass; audits report no newly introduced vulnerability.

- [ ] **Step 4: Build the offline desktop executable**

Run: `npm run tauri build -- --no-bundle`

Expected: `target/release/sharegate.exe` embeds the frontend and does not point at a development server.

- [ ] **Step 5: Exercise the real clipboard flow**

In the packaged application, copy `fixtures/visual-sensitive-sample.png`, press `Ctrl+V`, confirm face and multiple barcode findings appear without raw payloads, keep every finding selected, save a separate PNG, and confirm all five saved-file checks are complete with zero unexpected findings.

- [ ] **Step 6: Independently inspect the saved pixels and filesystem behavior**

Open the saved PNG and confirm opaque coverage over every selected face and barcode. Confirm the original fixture hash is unchanged and no temporary source image was created by the paste path.

- [ ] **Step 7: Update public scope and limitations**

Document face/barcode formats, clipboard behavior, no identity inference, decoder limitations, detector-unavailable semantics, post-save verification, and the deferred PDF slice.

- [ ] **Step 8: Commit and verify a clean tree**

Run: `git diff --check`

Run: `git status --short`

Commit: `feat: add local face barcode and screenshot safety`

Expected: tracked source, fixtures, and docs are committed; generated acceptance outputs remain ignored; the worktree is clean.

---

## Plan Self-Review

- Spec coverage: face detection, barcode allowlist, clipboard privacy, one-session ownership, review UI, opaque redaction, exceptions, post-save checks, fixtures, audits, and packaged acceptance each map to a task above.
- Type consistency: frontend uses `sessionId`; the desktop store owns `sourceFingerprint`; detector names are `Text`, `Face`, `Qr`, and `Barcode`; response fields consistently use face/barcode counts and checked flags.
- Scope: PDF, signatures, video, camera capture, identity recognition, and unrelated UI redesign remain outside this plan.
- Dependency boundary: `rxing` is pinned with minimal features; Windows supplies face and clipboard APIs; no runtime model or cloud service is introduced.
