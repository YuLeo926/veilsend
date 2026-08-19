# ShareGate visual safety expansion design

## Status

Approved in chat on 2026-08-19 as the first of two consecutive subprojects. This specification covers face detection, one-dimensional barcode detection, and direct screenshot paste. Lightweight PDF is deliberately a separate architectural subproject because rendering, page review, flattening, and PDF verification form a distinct trust boundary.

## Goal

Extend the existing JPEG and PNG workflow so a Windows user can paste or choose an image, review five local checks, irreversibly cover selected visual risks, and verify the saved copy:

1. sensitive visible text;
2. faces;
3. QR codes;
4. one-dimensional barcodes;
5. hidden metadata.

The work must preserve ShareGate's differentiator: the interface proposes changes, but the trusted desktop process owns source bytes, recomputes detector results before export, rereads the actual saved file, and never reports `Verified` after a partial check.

## Scope

This slice adds:

- on-device face location through Windows' built-in `Windows.Media.FaceAnalysis.FaceDetector`;
- local one-dimensional barcode detection through a narrowly configured pure-Rust decoder;
- a **Paste screenshot** action and `Ctrl+V` image intake;
- shared visual review, redaction, exception, and saved-file verification semantics for OCR, faces, QR codes, and barcodes;
- synthetic fixtures and a packaged Windows acceptance flow.

It does not add identity recognition, face embeddings, emotion or demographic inference, camera capture, live screen monitoring, signatures, video, PDF, Office files, two-dimensional symbols other than the existing QR path, or automatic clipboard clearing.

## Chosen approach

### Face detection

Use Windows' built-in `FaceDetector` adapter beside the existing Windows OCR adapter. The API is available from Windows 10, reports whether the detector is supported on the current device, accepts a `SoftwareBitmap`, and returns face rectangles. ShareGate will query supported bitmap formats at runtime and convert the decoded image in memory when required.

This is preferred over bundling an ONNX model because it introduces no model download, no third-party model license, no GPU requirement, and no new network surface. It also keeps the executable small. The adapter detects only the presence and location of a face. It must not create an embedding, infer an identity, or expose biometric attributes.

Microsoft API reference: <https://learn.microsoft.com/en-us/uwp/api/windows.media.faceanalysis.facedetector>

### One-dimensional barcodes

Use `rxing` 0.9.2 with default features disabled and only decoder, one-dimensional, and multiple-barcode support enabled. This release supports Code 39, Code 93, Code 128, Codabar, EAN-8, EAN-13, ITF, UPC-A, UPC-E, RSS-14, RSS Expanded, and Telepen. ShareGate will explicitly restrict `POSSIBLE_FORMATS` to those formats so QR, Data Matrix, Aztec, MaxiCode, and PDF417 do not duplicate or silently expand the product scope.

The detector will enable hard-search and inverted-image hints. Multiple results are deduplicated by format and geometry rather than payload. Returned result points are converted into a conservative axis-aligned rectangle. Because one-dimensional readers often report points along the centre line instead of all four corners, ShareGate expands the minor axis in proportion to the major span and adds a fixed minimum safety margin. Over-redaction is preferable to leaving readable bars.

`rxing` is a Rust port of ZXing and its multi-reader recursively scans the regions around located codes. Relevant references:

- <https://docs.rs/rxing/latest/rxing/enum.BarcodeFormat.html>
- <https://docs.rs/rxing/latest/rxing/multi/>

### Screenshot paste

Read bitmap content through `Windows.ApplicationModel.DataTransfer.Clipboard.GetContent` and `DataPackageView.GetBitmapAsync`. Clipboard access is initiated only by a focused user action: the button or `Ctrl+V` while the image add screen is active. ShareGate does not poll or monitor the clipboard.

The bitmap stream is copied into a desktop-owned in-memory session and is never written to a temporary source file. The frontend receives a bounded, normalized preview for rendering, but never receives the original encoded clipboard stream as trusted input or as an export source. Export always uses the desktop-owned bytes. Clipboard references:

- <https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.datatransfer.clipboard.getcontent>
- <https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.datatransfer.datapackageview.getbitmapasync>

## Source-session model

The current path-only image session becomes a desktop-owned source session:

```text
ImageSourceSession
  id: opaque random identifier
  source:
    File { canonical_path, source_fingerprint }
    Clipboard { encoded_bytes, source_fingerprint }
  safe display name
  dimensions and format
  latest detector summaries
```

The desktop keeps exactly one active source session in process memory. Selecting or pasting a new image replaces and drops the prior session; starting over removes it; application exit drops any remaining clipboard bytes. The store enforces the existing 25 MiB encoded-image limit and decoded-pixel limit.

For a file source, export rereads the canonical path and compares its fingerprint with the reviewed source. For a clipboard source, export rereads the immutable session bytes and compares them with the session fingerprint. Frontend requests contain a session ID and user decisions only; they never contain source bytes or trusted rectangles.

The native process recomputes all detector geometry immediately before applying decisions. A missing, expired, or mismatched session stops export.

## Serialized inspection model

Add two detector summaries:

```text
ImageFaceInspection
  availability: available | needsReview
  findings: FaceFinding[]
  message

FaceFinding
  id: opaque geometry-derived ID
  severity: high
  summary: "Face"
  rectangle

ImageBarcodeInspection
  availability: available | needsReview
  findings: BarcodeFinding[]
  message

BarcodeFinding
  id: opaque digest-and-geometry ID
  format: coarse supported format name
  severity: high
  summary: format plus encoded character count when known
  rectangle
```

No face crop, biometric template, barcode payload, checksum digit, prefix, suffix, or partial preview may be serialized, logged, included in filenames, or placed in error text. Barcode payloads stay inside the Rust core only long enough to deduplicate and verify results.

All OCR, face, QR, and barcode findings are converted by the desktop adapter into existing generic redaction targets. The core pixel rewriter remains unaware of detector implementation details.

## Detection semantics

### Faces

- Every returned face rectangle becomes one high-severity finding selected for redaction by default.
- Rectangles are padded proportionally and clamped to image bounds.
- An unsupported API, unsupported pixel format, failed conversion, failed detector call, or invalid rectangle yields `needsReview`, never an empty successful scan.
- A successful call returning no faces is a complete pass for this detector, not proof that no human is visible.
- Windows FaceDetector does not provide an application-facing confidence score used by this design; the interface must not invent one.

### Barcodes

- Every successfully decoded supported one-dimensional symbol becomes one high-severity finding selected by default.
- Format and encoded length may cross the boundary; payload content may not.
- A clean not-found result is a complete pass.
- A checksum or format failure that indicates a possible symbol but supplies no safe geometry makes the barcode inspection incomplete and therefore `needsReview`.
- Extremely small, degenerate, or out-of-bounds result geometry is omitted and makes the inspection incomplete.
- The detector does not claim to locate undecodable bar patterns. This limitation is shown in the safety note.

## Review experience

The image add screen gains two equivalent intake choices:

- **Choose image**;
- **Paste screenshot** with a visible `Ctrl+V` hint.

Keyboard paste is active only when image mode is selected and no text-editable control owns the event. Text paste in the text workflow remains unchanged.

The review screen shows five local-check status rows: visible text, faces, QR codes, barcodes, and metadata. Face and barcode findings use distinct overlay treatments and icons but share the numbered review list. Every new finding starts in **Redact** state. The user may choose **Keep**, which becomes an explicit exception.

The interface identifies clipboard input as `Pasted screenshot` and never fabricates a disk path. Save still requires an explicit destination chosen by the user.

## Redaction and export

Immediately before export, the desktop:

1. resolves the source session and verifies its fingerprint;
2. reruns OCR, face, QR, barcode, and metadata inspection on the trusted bytes;
3. resolves each opaque decision against the backend-stored reviewed finding, then pairs it with a recomputed finding of the same detector type by unambiguous geometric overlap;
4. rejects missing or ambiguous decisions;
5. pads and combines selected rectangles;
6. fills them with opaque pixels through the existing core redactor;
7. encodes a separate metadata-free PNG;
8. rereads the saved PNG and repeats every enabled detector.

Blur and pixelation are not offered as safety redaction modes. Faces and codes receive the same irreversible opaque-pixel guarantee as sensitive OCR text and QR codes.

## Saved-file verification

`Verified` requires all of the following:

- metadata inspection completed and found no supported privacy metadata;
- Windows OCR completed and found no enabled sensitive-text rule match;
- face inspection completed and found no unexpected face;
- QR inspection completed and found no unexpected QR-like code;
- barcode inspection completed and found no unexpected supported one-dimensional code;
- no user exception remains.

`Cleaned with exceptions` requires every detector to complete and every remaining finding to overlap an explicitly kept finding of the same detector type. The receipt lists exception counts by type and never calls the result clean.

`Needs review` covers detector unavailability, incomplete barcode decoding, unexpected remaining findings, stale source, expired session, failed save or reread, metadata residue, or invalid output geometry.

The second pass is run against bytes read from the actual save destination. It does not trust the in-memory encoded buffer alone.

## Error handling and resource limits

- Empty clipboard or clipboard content without a bitmap produces a concise non-destructive message and leaves the current session unchanged.
- Clipboard access denied because the window is not focused asks the user to focus ShareGate and paste again.
- Oversized encoded or decoded input uses the same structured limit errors as file input.
- The detector pipeline is fail-visible per component: one failed detector does not erase successful findings from other detectors, but it prevents `Verified`.
- Result payloads and logs contain detector names and safe error classes only, never source content.
- No detector may initiate network access or download a model at runtime.

## Component boundaries

- `src-tauri/windows_faces.rs` owns WinRT bitmap conversion and face rectangles.
- `src-tauri/windows_clipboard.rs` owns focused bitmap intake and returns encoded bytes to the session layer.
- `crates/sharegate-core/src/barcode.rs` owns supported-format configuration, decoding, geometry, safe summaries, and barcode tests.
- `crates/sharegate-core/src/model.rs` owns serialized face/barcode models and generic detector identifiers.
- `src-tauri/src/lib.rs` owns bounded source sessions, source freshness, detector coordination, decisions, saving, and post-save verification.
- `src/components/ImageWorkflow.tsx` renders intake, status, overlays, decisions, and receipts without receiving raw detector content.

If the image workflow grows materially during implementation, detector status and finding-card rendering should be extracted into focused components. Unrelated visual redesign is outside scope.

## Testing

### Core barcode tests

- generate Code 39, Code 128, EAN-8, EAN-13, ITF, UPC-A, and UPC-E fixtures from reserved synthetic values;
- detect horizontal, rotated, inverted, and multiple symbols;
- restrict results to the approved one-dimensional format set;
- prove serialized summaries do not contain payload substrings;
- reject degenerate geometry and mark partial decoder failures as incomplete;
- prove opaque redaction makes selected symbols undecodable.

### Desktop tests

- face-adapter success, unavailable, invalid-geometry, and failure mapping;
- clipboard bitmap import, empty clipboard, focus denial, size limits, and missing or replaced sessions;
- file-source freshness and clipboard-source immutability;
- combined OCR/face/QR/barcode decisions and type-safe exception matching;
- saved-file status for complete, exception, and incomplete verification.

### Interface tests

- button and keyboard paste routing without intercepting text fields;
- five detector status rows;
- default-redact decisions and distinct face/barcode overlays;
- no payload content rendered;
- separate result counts and fail-visible receipt states.

### Packaged acceptance

Use only generated barcodes and a synthetic, non-identifying face fixture. The release executable must:

1. import the fixture from the clipboard without creating a temporary source file;
2. locate at least one face and multiple supported barcodes;
3. show no barcode payload;
4. save a separate PNG with opaque covered regions;
5. reread it and report zero unexpected OCR, face, QR, barcode, and metadata findings;
6. leave the source fixture unchanged.

## Security and dependency checks

- Pin `rxing` 0.9.2 and enable only necessary features.
- Run `cargo audit`, `npm audit`, full tests, formatting, and clippy before release.
- Confirm the Windows face and clipboard APIs introduce no runtime download.
- Keep all fixtures synthetic and all encoded examples reserved for testing.
- Preserve ShareGate's MIT license and do not add a model or library with non-commercial, copyleft, or ambiguous redistribution terms.

## Completion criteria

- A file or pasted bitmap follows the same trusted review and verification pipeline.
- Face and supported one-dimensional barcode findings are local, reviewable, default-redacted, and absent from a verified saved copy.
- Raw face crops and barcode payloads never cross the core boundary.
- Clipboard image bytes never become a temporary source file.
- Any incomplete detector prevents `Verified` without discarding successful findings.
- Existing text, OCR, QR, orientation, and metadata-only behavior remains covered and passing.
- A fresh packaged executable passes the synthetic desktop acceptance flow.

## Deferred PDF subproject

The next specification will define a local page renderer, bounded multi-page session model, per-page review, image-only PDF reconstruction, removal of metadata/text layers/annotations/attachments/scripts, and post-export structural plus detector verification. PDF implementation does not start until this image-safety slice has a stable shared detector contract.
