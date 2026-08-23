# ShareGate Security Policy

ShareGate handles content that may contain credentials and personal information. Security and privacy defects are treated as high priority.

## Reporting a vulnerability

Until a private reporting address is published, do not open a public issue containing real secrets, personal data, or private files. Open an issue containing only a high-level description and synthetic reproduction steps, and request a private contact channel.

Never attach real logs, tokens, screenshots, configuration, or customer data to a report.

## Supported code

The current `main` branch is a pre-release foundation. There are no supported public releases yet.

## Threat model for v0.1

ShareGate aims to reduce accidental disclosure while a user prepares local text, screenshots, images, or PDFs for sharing. It protects against common, recognizable secret and PII patterns in supported text, applies those rules to locally recognized visual text, locates faces, QR codes, and supported one-dimensional barcodes, irreversibly covers user-selected regions, removes supported privacy metadata from JPEG and PNG copies, and rebuilds PDF pages as controlled lossless images.

It does not protect against:

- secrets that do not match an enabled detector;
- visible text that Windows OCR misreads or does not recognize;
- faces the Windows detector misses, identity conveyed outside the detected rectangle, signatures by shape, handwriting beyond installed OCR capability, undecodable bar patterns, unsupported barcode formats, codes the current detectors cannot locate, or other visual identifiers;
- metadata formats or non-standard blocks that cannot be parsed by the current image engine;
- encrypted, malformed, over-limit, or unsupported PDF features; content outside the rendered page; and information conveyed visually in a way the user and supported detectors both miss;
- preserving PDF text selection, search, tagged accessibility, editable forms, signatures, bookmarks, links, attachments, annotations, layers, multimedia, or document history—the flattened output intentionally removes these capabilities;
- malicious files or compromised operating systems;
- screen capture, clipboard monitoring by another process, or another process reading memory;
- deliberate disclosure by the local user;
- compliance, legal, or regulatory requirements.

The application must never describe an output as universally safe. For text, `Verified` means the completed post-clean scan found no matches from enabled ShareGate rules. For metadata-only images, it means supported privacy metadata was absent and the encoded pixel stream matched the source fingerprint. For visually redacted images, it means the saved PNG had no supported metadata findings and completed second passes found no unexpected sensitive text, face, QR, or supported one-dimensional barcode. For PDFs, it means the actual saved bytes matched the controlled image-only reconstruction, every page retained its reviewed size, every selected cover remained opaque after rerendering, and all supported saved-page detectors completed with no exceptions or unexpected findings. Windows OCR and the selected face path do not provide an application-facing confidence score, so the interface must never invent one.

## Development rules

- Use synthetic fixtures and reserved example domains only.
- Never commit real tokens, private logs, user paths, or customer information.
- Do not log source content, raw findings, or replacement values.
- Do not add analytics or network services without an explicit privacy review and product decision.
- Treat a partial or failed detector run as `Needs review`, never `Verified`.
- Preserve the source file and fail closed when image orientation or metadata cannot be interpreted safely.
- Keep complete OCR text inside the Rust desktop process; return only masked findings and required review rectangles to the interface.
- Keep decoded QR payload bytes inside the Rust core; return only coarse classification, byte count, and required review geometry to the interface.
- Keep face processing location-only; do not serialize a face crop, biometric embedding, identity, or inferred personal attribute.
- Keep decoded barcode payloads inside the Rust core; return only the supported format, encoded length, opaque ID, and required review geometry.
- Access the Windows clipboard only after a focused user action. Do not poll, monitor, clear, or write clipboard history, and do not persist pasted source bytes to a temporary file.
- Recompute OCR findings from the unchanged source at export time instead of trusting finding geometry returned by the interface.
- Recompute QR findings from the unchanged source at export time and fail visibly if extraction is incomplete.
- Recompute face and barcode findings from the unchanged source at export time and require an explicit decision for every reviewed visual finding.
- Reread the actual saved destination and require metadata, OCR, face, QR, and barcode checks to complete before reporting `Verified`.
- Accept only local, unencrypted PDFs within the documented byte, page, and pixel limits. Do not request, retain, or infer passwords.
- Keep PDF source bytes and full-resolution rendered pages inside the desktop process. Do not create temporary source PDFs or page images, and process full-resolution pages sequentially.
- Scope automatic finding identities by page, require an exact decision set, rerender immutable reviewed bytes at export, and geometrically rematch findings instead of trusting frontend geometry.
- Validate normalized manual PDF regions again in Rust, enforce per-page and per-document limits, and verify every selected region was painted with opaque pixels.
- Reconstruct PDF output from a new minimal catalog, page tree, lossless RGB image, and content stream per page. Never copy source text streams, metadata, actions, forms, annotations, names, attachments, outlines, signatures, or structure entries.
- Never overwrite the PDF source. Reread the destination, require exact generated-byte equality, reload it through the independent Windows renderer, compare page count and physical sizes, verify opaque covers, and rerun every visual detector.
