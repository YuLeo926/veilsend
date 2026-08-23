# ShareGate PDF redaction design

## Status

Approved in chat on 2026-08-23 as the next architectural stage after the local image-safety workflow. The approved first release accepts local, unencrypted PDF files and creates a flattened, image-only safety copy. Searchable text, editable objects, accessibility structure, and original PDF objects are deliberately not preserved.

## Goal

Add a complete offline PDF safety path that lets a Windows user:

1. choose a local PDF without modifying it;
2. render and inspect every page with ShareGate's existing visible-text, face, QR, and one-dimensional barcode detectors;
3. review automatic findings and add manual opaque cover regions;
4. rebuild every page into a new image-only PDF;
5. reread and re-render the actual saved file before reporting a result.

The primary security property is removal by reconstruction. ShareGate does not place annotations or black vector rectangles over the original content stream. The new file contains newly rendered page pixels and a minimal page tree, so original text layers, attachments, scripts, forms, annotations, signatures, document history, and metadata are not copied.

## Scope

The first PDF release supports:

- local `.pdf` files that do not require a password;
- up to 50 MiB of source bytes and 50 pages;
- portrait, landscape, mixed-size, and rotated pages;
- bounded 144 DPI page rendering;
- per-page OCR, face, QR, and supported one-dimensional barcode inspection;
- automatic findings selected for redaction by default;
- explicit **Keep** exceptions;
- user-drawn manual opaque cover regions;
- a separate `.redacted.pdf` output;
- post-save byte, page, render, detector, and redaction verification.

It does not support password entry, encrypted output, preserving selectable text, tagged-PDF accessibility, editable forms, digital signatures, attachments, bookmarks, annotations, layers, video, audio, 3D content, PDF portfolios, batch processing, page reordering, page deletion, or Office files. Source JavaScript, actions, links, forms, attachments, signatures, and metadata are removed by omission rather than interpreted or migrated.

## Chosen approach

### Rendering

Use the operating system's `Windows.Data.Pdf.PdfDocument` and `PdfPage.RenderToStreamAsync` APIs to load source bytes from an in-memory random-access stream and render one page at a time. This matches the existing Windows-native OCR and face adapters, adds no runtime download, and avoids shipping a second native PDF engine.

The Windows adapter serializes document access and page rendering. It initializes the required Windows apartment explicitly and does not assume that PDF document or page objects are thread-safe. A page-rendering failure stops the document workflow because ShareGate cannot reconstruct every page.

References:

- <https://learn.microsoft.com/en-us/uwp/api/windows.data.pdf.pdfdocument.loadfromstreamasync>
- <https://learn.microsoft.com/en-us/uwp/api/windows.data.pdf.pdfpage.rendertostreamasync>

### Reconstruction

Use `pdf-writer` 0.15 in `sharegate-core` to construct a new PDF from scratch. Each output page contains exactly one lossless RGB image XObject and one short content stream that paints the image into the page media box. The catalog contains only the new pages tree. The writer does not add an Info dictionary, XMP metadata, outlines, names, actions, forms, annotations, optional-content groups, structure trees, embedded files, or source object references.

Rendered RGBA pages are flattened against white, converted to RGB, compressed with Flate, and embedded losslessly. Opaque redaction pixels therefore remain exact in the embedded image rather than being softened by lossy JPEG compression. Original page physical dimensions and final visible orientation are preserved within a small floating-point tolerance; source rotation is normalized into the new page pixels.

References:

- <https://docs.rs/pdf-writer/latest/pdf_writer/>
- <https://docs.rs/pdf-writer/latest/pdf_writer/writers/struct.ImageXObject.html>

### Alternatives rejected

- Bundled PDFium would improve future cross-platform options, but it requires distributing and updating a separate C++ binary. Its Rust wrapper also states that PDFium must not be assumed thread-safe. That complexity is not justified while ShareGate's OCR and face checks are Windows-specific.
- Editing the original PDF object graph and placing black annotations or rectangles over content can leave underlying text, incremental revisions, attachments, scripts, and other hidden data recoverable. It conflicts with the approved flattening guarantee.
- An external Poppler, Ghostscript, browser, or printer command would add installation, process, quoting, licensing, and version-management boundaries. The packaged application must remain self-contained and offline.

## Trust boundary and session model

Add one desktop-owned PDF session:

```text
PdfSourceSession
  id: opaque random identifier
  canonical source path
  source bytes and SHA-256 fingerprint
  safe display filename
  page count and physical page sizes
  bounded page thumbnails and selected-page preview cache
  per-page detector summaries
  detector completion state
```

The source file is opened read-only, bounded before allocation, and copied into process memory. No source PDF or source page image is written to a temporary file. Selecting a replacement, starting over, explicitly clearing the PDF workflow, or exiting the application drops the session.

The desktop scans pages sequentially. Full-resolution decoded pixels exist only for the current page and are dropped after detection; the session keeps a 320-pixel thumbnail for each page, at most one 1,600-pixel selected-page preview, and safe detector summaries for review. A detailed preview request returns only the requested page and replaces the prior detailed preview. The frontend never receives source PDF bytes, complete OCR transcripts, decoded QR payloads, decoded barcode payloads, face crops, or trusted export rectangles.

At export, the desktop rereads the canonical source path and requires its fingerprint to match the reviewed session. It then renders the immutable session bytes again. The frontend sends only the session ID, opaque automatic-finding decisions, and validated normalized manual rectangles.

## Resource limits

- Maximum source size: 50 MiB.
- Maximum pages: 50.
- Render density: 144 DPI, or two pixels per PDF point after unit conversion.
- Maximum decoded pixels per page: 40 million.
- Maximum aggregate rendered pixels across the document: 120 million.
- Maximum thumbnail dimension: 320 pixels on the longer side.
- Maximum selected-page preview dimension: 1,600 pixels on the longer side.
- Maximum manual regions: 100 per page and 1,000 per document.
- Maximum generated and reread output size: 300 MiB.

Width, height, pixel multiplication, buffer length, object count, and page count calculations use checked arithmetic. A limit violation stops inspection or export without writing a partial destination. The scan processes one full-resolution page at a time so normal documents do not retain all decoded pages simultaneously.

## Serialized model

```text
PdfSession
  sessionId
  filename
  bytes
  pageCount
  pages: PdfPageSummary[]
  aggregate detector counts
  warnings

PdfPageSummary
  pageIndex
  widthPoints
  heightPoints
  thumbnailDataUrl
  visual inspection bundle

PdfPagePreview
  pageIndex
  width
  height
  previewDataUrl

PdfManualRegion
  id
  pageIndex
  normalized x, y, width, height

PdfRedactionDecision
  id
  enabled

CleanedPdfFile
  savedPath
  filename
  originalBytes
  cleanedSize
  pagesRebuilt
  automaticFindingsRedacted by type
  manualRegionsApplied
  exceptions
  verification receipt
```

Automatic finding IDs include detector type, page index, safe geometry, and an internal digest. Payload content is never part of a serialized ID. Manual rectangles use normalized top-left coordinates so preview scaling cannot change their meaning. The backend rejects non-finite, empty, tiny, oversized, out-of-range, or unknown-page rectangles and clamps only sub-pixel rounding at page edges.

## Inspection and review flow

The interface gains a third **PDFs** mode. Browser preview identifies it as desktop-only. The add screen states the 50 MiB and 50-page limits, the unencrypted-only rule, and that output becomes image-only.

After file selection, the interface shows deterministic progress such as `Scanning page 7 of 24`. The review screen contains:

- a page rail with page number, thumbnail, detector completion state, and risk count;
- one selected-page preview with automatic overlays and manual-region drawing;
- detector status rows for visible text, faces, QR codes, and barcodes;
- a finding list filtered to the selected page, with **Redact** selected by default and explicit **Keep**;
- manual-region add, resize, delete, undo, and clear controls;
- a document summary of selected redactions, manual regions, exceptions, and incomplete checks.

Manual cover regions are intentionally included because supported detectors can miss handwriting, signatures, diagrams, unusual text, unsupported symbols, or visual context. Manual regions are always redactions; deleting a region is the way to remove it. Blur and pixelation are not offered.

The interface never claims that flattening preserves accessibility, searchable text, signatures, interactive behavior, or archival conformance. It explicitly calls the result a visual safety copy.

## Export flow

Immediately before export, the desktop:

1. resolves the active session and verifies source-path freshness;
2. rerenders every source page at the approved density;
3. reruns all four detectors and resolves each reviewed automatic decision by detector type, page, opaque ID, and unambiguous geometric overlap;
4. rejects missing, duplicate, stale, or ambiguous decisions;
5. validates manual regions and maps them to full-resolution page pixels;
6. pads and paints selected automatic regions and manual regions with the existing opaque ShareGate ink;
7. verifies every painted rectangle in the in-memory raster before encoding;
8. flattens the page to RGB, compresses it losslessly, and adds it to a new image-only PDF;
9. enforces aggregate pixel, object, and output-byte limits;
10. asks the user for a separate `.redacted.pdf` destination and writes the generated bytes;
11. rereads the actual destination and performs saved-file verification.

No original PDF object, stream, metadata value, identifier, page label, file path, or content string is copied into the output. The default filename is `<source-stem>.redacted.pdf`. The source is never overwritten; choosing its path as the destination is rejected even if the native dialog permits it.

## Saved-file verification

The generated buffer receives a SHA-256 fingerprint before writing. Verification rereads the actual destination with the 300 MiB limit and requires the saved fingerprint to equal the generated fingerprint. Because the output writer only creates a fixed object graph, exact-byte equality proves that the saved file is the controlled reconstruction rather than a modified or source-derived document.

The verifier then uses `Windows.Data.Pdf` to load the saved bytes and requires:

- no password or encryption prompt;
- exactly the expected page count;
- page sizes and orientations within the documented tolerance;
- successful rendering of every page at the verification density;
- successful OCR, face, QR, and barcode checks on every rendered page;
- zero unexpected supported findings;
- every selected automatic and manual region covered in the generated lossless page image;
- no incomplete detector state.

`Verified` requires all checks to complete with zero exceptions. `Cleaned with exceptions` requires complete checks and allows only findings matched to explicit **Keep** decisions. `Needs review` covers a stale source, failed page, detector unavailability, incomplete detection, output mismatch, unexpected saved-file finding, invalid manual geometry, failed write or reread, or any page/property mismatch.

The receipt reports pages rebuilt, redactions by detector type, manual regions, exceptions, saved-byte match, page render completion, and remaining supported findings. It never describes the PDF as universally safe.

## Error handling

- A PDF that requests a password is rejected with a message that password-protected documents are not supported; ShareGate does not ask for, cache, or log a password.
- A malformed, unsupported, empty, oversized, or over-page-limit file leaves the current session unchanged.
- A page load, render, or decode failure stops review and export because ShareGate cannot reconstruct the whole document.
- A detector failure preserves findings from completed detectors and may still allow a visual safety copy, but it prevents `Verified`.
- Detector failures remain visible per page and per detector; successful checks are not erased.
- Export does not proceed with an expired session, changed source, unresolved decision, or invalid region.
- Errors include safe page numbers, detector names, and error classes only. They do not include source text, payload content, PDF object contents, or raw Windows error strings that may contain paths.
- No page renderer, detector, or writer may make a network request or download a component at runtime.

## Component boundaries

- `src-tauri/src/windows_pdf.rs` owns WinRT in-memory loading, page dimensions, bounded page rendering, and safe Windows error mapping.
- `src-tauri/src/pdf_sessions.rs` owns the single active source session, source bytes, fingerprint, preview cache, and page summaries.
- `src-tauri/src/pdf_pipeline.rs` coordinates sequential inspection, decision resolution, export, save, and post-save verification.
- `crates/sharegate-core/src/pdf.rs` owns normalized PDF/page models, manual-region validation, lossless page-image reconstruction, fixed object IDs, limits, and output-writer tests.
- Existing `image_pipeline.rs` remains the single coordinator for OCR, face, QR, and barcode inspection of one rendered page.
- `src/components/PdfWorkflow.tsx` owns PDF intake, progress, page navigation, overlays, decisions, manual drawing, and the receipt.
- `src/lib/pdfWorkflowModel.ts` owns pure interface state transitions and coordinate conversion tests.
- `src/lib/bridge.ts` exposes typed commands without source bytes or raw findings.

PDF orchestration must not be added to the already broad `src-tauri/src/lib.rs` beyond command registration and shared application state. Image behavior is reused through focused functions rather than copied into the PDF module.

## Testing

### Core tests

- reject invalid page dimensions, excessive counts, overflows, and invalid manual rectangles;
- convert normalized manual regions to exact bounded pixel rectangles;
- build portrait, landscape, mixed-size, and rotated image-only pages;
- prove each page contains one image XObject and no copied text, metadata, action, form, annotation, names, attachment, signature, outline, or structure entry;
- prove source marker strings and synthetic secrets are absent from output bytes;
- prove lossless page pixels and opaque redaction ink survive PDF embedding;
- enforce deterministic object ordering and all output limits.

### Desktop tests

- load a valid unencrypted in-memory PDF and reject password-protected input without accepting a password;
- scan every page sequentially and map page-specific detector states;
- preserve only safe summaries across the command boundary;
- reject stale files, replaced sessions, stale decisions, and ambiguous geometry;
- rerender from trusted session bytes at export rather than using preview pixels;
- verify saved-byte equality, page count, dimensions, render completion, detector completion, exceptions, and unexpected findings;
- leave no source-page temporary file.

Windows OCR, face, and packaged render tests may be marked ignored for ordinary cross-platform test runs, but they must be run explicitly before accepting the Windows release executable.

### Interface tests

- third-mode routing and desktop-only browser message;
- progress across multiple pages;
- page selection and per-page risk counts;
- automatic decisions default to **Redact**;
- add, resize, undo, and delete manual regions with normalized coordinates;
- no OCR transcript, QR payload, barcode payload, face crop, or source bytes rendered;
- complete, exception, and needs-review receipts.

### Synthetic acceptance fixture

Create a deterministic, fully synthetic multi-page PDF containing reserved example values and no real personal data:

1. a portrait page with visible sensitive-looking text and an invisible duplicate text layer;
2. a landscape page with the existing synthetic face, QR, and one-dimensional barcode assets;
3. a mixed-size page with a manual-only visual marker, metadata, link, form, JavaScript action, annotation, and embedded synthetic text file.

The fixture generator may use development-only PDF tooling, but production parsing and output must remain Rust plus Windows APIs. The fixture and expected hashes are documented. PDF pages are rendered to PNG and visually inspected after meaningful fixture or writer changes, following the repository PDF workflow.

The packaged Windows acceptance must choose the fixture, inspect all pages, add a manual region, keep no automatic finding, save a separate PDF, reread it, and show:

- all pages rebuilt;
- zero unexpected supported visual findings;
- all manual regions applied;
- complete page and detector checks;
- exact saved-byte match;
- no original secret marker, metadata, form, script, annotation, attachment, or invisible text in the output;
- an unchanged source hash and no temporary source PDF or page image.

## Security and dependency checks

- Pin an audited `pdf-writer` 0.15 release and enable only required features.
- Use Flate compression through an audited Rust dependency already compatible with the workspace toolchain.
- Do not introduce GPL, AGPL, non-commercial, model, printer-driver, browser, or externally downloaded runtime dependencies.
- Fuzz or property-test normalized rectangle validation, checked sizing, page object IDs, and writer limits where practical.
- Run formatting, clippy, Rust tests, frontend tests, frontend build, `cargo audit`, `npm audit`, and a fresh Tauri release build.
- Keep every PDF fixture synthetic and every domain or credential-like value reserved for testing.

## Completion criteria

- A supported local PDF follows a complete inspect, review, redact, reconstruct, save, reread, and re-render flow without network access.
- The output is a separate image-only PDF and contains no copied original object or searchable text layer.
- Automatic findings are local, safe-summary-only, reviewable, and selected by default.
- Users can add bounded manual opaque cover regions for unsupported or missed visual content.
- Source bytes and page rasters never become temporary source files.
- The actual saved file passes byte, page, render, detector, and redaction checks before `Verified` is shown.
- Any incomplete check, stale state, invalid geometry, or unexpected finding prevents `Verified`.
- Existing text and image workflows remain unchanged and fully tested.

## Deferred work

Future specifications may add password-protected input, a bundled cross-platform renderer, selectable-page export, page deletion/reordering, batch processing, searchable rebuilt text, accessible tagged output, Office files, or a CLI. None of these may weaken the first release's flattening and saved-file verification guarantees.
