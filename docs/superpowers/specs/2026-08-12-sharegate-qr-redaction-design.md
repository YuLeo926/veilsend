# ShareGate QR Redaction Design

## Status

Approved for implementation on 2026-08-12. QR detection was already part of the approved ShareGate image milestone, and the user explicitly asked the project to continue autonomously with this as the next slice.

## Goal

Add a complete offline QR-code safety path to the existing JPEG/PNG workflow:

1. detect QR-like grids in the selected image;
2. classify decoded content without exposing the payload to the interface;
3. show every detected grid as a reviewable image region, selected by default;
4. irreversibly cover selected regions in the exported PNG;
5. detect QR grids again in the saved file before reporting verification.

This slice reduces accidental sharing of login links, Wi-Fi credentials, contact details, internal links, and other data encoded as QR codes. It does not claim to identify every machine-readable mark.

## Scope

The slice supports QR Code Model 2 grids found in the same JPEG and PNG inputs already supported by the image workflow. It handles multiple and rotated codes when the detector can locate them.

It does not add one-dimensional barcodes, Data Matrix, Aztec, PDF417, camera capture, batch processing, or QR generation. Those formats require separate detector and verification semantics.

## Chosen approach

Use the pure-Rust `rqrr` detector in `sharegate-core`. Its grid-first API returns four image-space bounds before decoding, which is important for fail-visible behavior: a located grid that cannot be decoded is still a reviewable, redactable finding.

Alternatives considered:

- `quircs` is also local and mature, but its iterator combines extraction more tightly with the code result and is less direct for preserving every undecodable candidate as a redaction target.
- A Windows or external scanner would duplicate platform adapters, weaken the cross-platform core boundary, and provide no safety benefit for this slice.

The QR detector receives only an in-memory grayscale image. It performs no network access and writes no temporary image or payload file.

## Privacy model

Decoded payload bytes stay inside the Rust core and are used only for classification, stable matching, and verification. They are never serialized across the Tauri boundary and never logged.

The interface receives:

- a stable opaque finding ID;
- a coarse kind such as web link, Wi-Fi credential, contact card, communication link, encoded text, or undecodable QR-like code;
- severity and a plain-language explanation;
- a non-reversible summary containing only the kind and byte length when known;
- an axis-aligned rectangle enclosing the detected grid.

The interface does not receive a host name, user name, SSID, phone number, email address, query string, fragment, token, or partial payload preview. Stable IDs are derived from geometry and an internal digest; only a short opaque identifier crosses the interface boundary.

## Detection and classification

The core decodes the source image with the existing pixel and byte limits, converts it to grayscale, and asks `rqrr` to locate grids. Each returned grid becomes exactly one finding even if decoding fails.

Successful payloads are classified in this order:

1. `WIFI:` payloads are Wi-Fi credentials and critical severity.
2. `http:` or `https:` payloads are web links and high severity.
3. vCard or MeCard payloads are contact cards and high severity.
4. `mailto:`, `tel:`, `sms:`, or `smsto:` payloads are communication links and medium severity.
5. all other decoded payloads are encoded content and medium severity.
6. located grids that fail decoding are undecodable QR-like codes and high severity.

Classification is deliberately coarse. ShareGate does not open URLs, parse credentials into individual fields, or execute URI handlers.

The four grid corners are clamped to the decoded image bounds and converted to one enclosing rectangle. A safety margin proportional to the shorter side, with a fixed minimum, is included before redaction. The existing redactor applies its own small final padding and clips the region to the image.

## Review experience

The current image review receives a second local inspection alongside OCR. QR regions share the numbered image overlay but have a distinct square pattern and icon. Each QR finding has a Redact/Keep decision and is selected by default.

Metadata findings remain mandatory removals. OCR and QR decisions are combined into one generic image-redaction target list only inside the desktop adapter. The user can deliberately keep a QR finding; the receipt then reports `Cleaned with exceptions`, never `Verified`.

The add screen and result receipt explicitly name three checks: visible text, QR codes, and metadata. Decoder limitations remain visible in the safety note.

## Cleaning

Before writing output, the desktop adapter rereads and fingerprints the source. A changed source is rejected. It reruns OCR and QR detection on the current bytes so stale coordinates cannot be applied.

Selected OCR word rectangles and selected QR rectangles are converted into generic redaction targets. The core fills their pixels with the existing opaque ink, normalizes display orientation when necessary, and writes a metadata-free PNG. Overlapping rectangles are safe and may be painted more than once. The source file is never overwritten.

If no OCR or QR region is selected, the existing lossless metadata-only path remains in use.

## Verification semantics

After saving, the desktop adapter reads the actual saved bytes and reruns:

- metadata inspection;
- Windows OCR plus deterministic text rules;
- QR grid detection and decoding.

The result is `Verified` only when all enabled checks complete, no supported metadata finding remains, no OCR-derived sensitive finding remains, no QR-like grid remains, and there are no user exceptions.

The result is `Cleaned with exceptions` when the user deliberately kept one or more visual findings and all checks completed. The receipt states how many findings were kept and does not claim the image is clean.

The result is `Needs review` when a detector is unavailable or fails, metadata remains, or any unexpected supported visual finding remains. A grid that is found but cannot be decoded still counts as a finding both before and after export.

## Error handling

- Unsupported or oversized images continue to use the current structured image errors.
- Image decode failure stops QR inspection and makes the workflow fail visibly.
- A single grid decode error produces an undecodable finding instead of aborting all QR inspection.
- Invalid or out-of-bounds grid geometry is clipped; an empty rectangle is omitted with a warning and prevents a verified result.
- QR inspection never includes payload data in an error message.

## Core boundaries

- `qr.rs` owns image-to-grid detection, payload classification, masked summaries, and QR-specific tests.
- `visual.rs` keeps OCR mapping and pixel rewriting, but accepts generic image-redaction targets rather than OCR-specific findings.
- `model.rs` defines serialized QR inspection types and generic redaction decisions/targets.
- the Tauri adapter owns source freshness, Windows OCR coordination, save dialogs, and combined verification status.
- React renders serialized findings and decisions; it never parses a QR payload.

## Testing and acceptance

Core tests cover:

- successful link, Wi-Fi, contact, communication, and plain-text classification;
- an opaque summary that does not contain payload substrings;
- multiple and rotated QR geometry where supported by the detector;
- undecodable grid handling without payload leakage;
- generic redaction of QR regions and explicit exceptions;
- post-redaction detection returning no QR grids.

Desktop and interface tests cover combined OCR/QR decisions, receipt counts, exception status, and fail-visible verification.

The acceptance fixture uses only reserved example data. The packaged Windows executable must detect its QR code, create a separate PNG, visibly cover the region, report zero QR grids after saving, and pass the existing OCR and metadata checks.

## Completion criteria

- QR detection, review, redaction, and saved-file verification work without network access.
- No decoded payload is exposed through serialized desktop command results, UI state, logs, filenames, or errors.
- Undecodable detected grids are redactable and cannot silently produce a verified result.
- Existing text, OCR, orientation, and lossless metadata-only paths remain covered and passing.
- The release executable is rebuilt and accepted against a synthetic QR image.
