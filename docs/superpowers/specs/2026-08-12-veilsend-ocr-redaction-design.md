# VeilSend local OCR and visual redaction design

## Objective

Extend the image workflow from hidden-metadata cleaning to sensitive text that is visibly rendered in image pixels. VeilSend detects supported text locally, lets the user review every proposed redaction, writes irreversible pixel blocks to a separate PNG, and verifies the saved output with a second OCR and metadata pass.

## User flow

1. Choose one JPEG or PNG through the existing native picker.
2. VeilSend inspects hidden metadata and runs Windows' installed OCR engine locally.
3. Review masked sensitive findings and their highlighted image regions.
4. Keep or exclude each proposed visual redaction. Metadata removal remains mandatory.
5. Choose **Redact, save & verify** and save a separate PNG copy.
6. See a verification receipt covering saved-file metadata, repeated OCR, and user exceptions.

## Detection and review model

- OCR is performed with `Windows.Media.Ocr` and the languages installed for the current Windows user. No image or recognized text is sent to a service.
- The OCR adapter returns words, text ranges, language, and pixel rectangles to the desktop host. The frontend only receives masked rule findings and rectangles; it does not receive a full recognized-text transcript.
- Existing deterministic VeilSend text rules are reused for credentials, email addresses, phone numbers, private network addresses, local paths, and optional custom terms.
- A rule match is mapped to every OCR word whose text range overlaps it. Adjacent rectangles are kept so a multi-word secret is fully covered.
- Windows OCR does not expose a confidence score. The UI must explicitly show **Confidence score unavailable from Windows OCR** and must not synthesize a numeric score.
- OCR absence, unsupported dimensions, a non-zero detected text angle, or an OCR failure is a review condition, never a verified-clean condition.

## Redaction contract

- Every detected visual finding is selected by default. The user can explicitly keep a finding, which is recorded as an exception.
- Selected rectangles are expanded by a small safety margin, clamped to image bounds, and filled with opaque near-black pixels.
- A visual-redaction copy is always encoded as PNG. This avoids lossy JPEG artifacts around the covered area and guarantees that the selected regions are replaced in the exported pixels.
- Decoding and re-encoding deliberately strips container metadata. The saved copy is reread before success is reported.
- The source is read-only, fingerprinted at review time, and rejected if it changed before export. The original path is never an allowed output path.
- Metadata-only images continue to use the existing lossless JPEG/PNG path so encoded pixels and ICC colour profiles remain intact.

## Verification states

- **Verified**: the saved file has no supported metadata findings, the second OCR succeeds, and the sanitized output has no supported text-rule findings.
- **Cleaned with exceptions**: the user kept one or more detected visual findings. The receipt names the exception count and does not claim the file is fully clean.
- **Needs review**: OCR is unavailable or fails, text remains after redaction, the saved file cannot be reread, metadata remains, or another safety check is inconclusive.

## Boundaries

- The first slice supports Windows 10 and later, JPEG/PNG input up to 25 MiB, installed Windows OCR languages, and VeilSend's existing deterministic text rules.
- It does not detect faces, signatures by shape, handwritten text beyond what Windows OCR recognizes, arbitrary visual identifiers, barcodes, or QR codes.
- QR detection is a separate follow-up slice because it has different decoding, review, and verification semantics.
- A clean OCR pass is evidence for the supported detector, not proof that an image contains no sensitive visual information. The receipt and interface must preserve that distinction.

## Acceptance evidence

- Sixteen core tests cover OCR-range mapping, split-punctuation reconstruction, rectangle merging/clamping, selective redaction, PNG export, stale input rejection, and no metadata in the re-encoded image.
- An ignored Windows adapter acceptance test uses the installed OCR language pack and requires email, private-IP, and assigned-secret findings from the synthetic rendered fixture.
- The packaged Windows app was exercised end to end with that fixture. It found three visible-text risks, mapped the split private IP across seven OCR regions, redacted every selected region, saved a separate PNG, reread it, reran OCR, and reported zero supported findings remaining.
