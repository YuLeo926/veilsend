# ShareGate Security Policy

ShareGate handles content that may contain credentials and personal information. Security and privacy defects are treated as high priority.

## Reporting a vulnerability

Until a private reporting address is published, do not open a public issue containing real secrets, personal data, or private files. Open an issue containing only a high-level description and synthetic reproduction steps, and request a private contact channel.

Never attach real logs, tokens, screenshots, configuration, or customer data to a report.

## Supported code

The current `main` branch is a pre-release foundation. There are no supported public releases yet.

## Threat model for v0.1

ShareGate aims to reduce accidental disclosure while a user prepares local text or images for sharing. It protects against common, recognizable secret and PII patterns in supported text, applies those rules to locally recognized image text, irreversibly covers user-selected regions, and removes supported privacy metadata from JPEG and PNG copies.

It does not protect against:

- secrets that do not match an enabled detector;
- visible text that Windows OCR misreads or does not recognize;
- faces, signatures by shape, handwriting beyond installed OCR capability, QR codes, or other visual identifiers;
- metadata formats or non-standard blocks that cannot be parsed by the current image engine;
- malicious files or compromised operating systems;
- screen capture, clipboard monitoring, or another process reading memory;
- deliberate disclosure by the local user;
- compliance, legal, or regulatory requirements.

The application must never describe an output as universally safe. For text, `Verified` means the completed post-clean scan found no matches from enabled ShareGate rules. For metadata-only images, it means supported privacy metadata was absent and the encoded pixel stream matched the source fingerprint. For visually redacted images, it means the saved PNG had no supported metadata findings and a second Windows OCR pass found no enabled ShareGate rule matches. Windows OCR supplies no confidence score, so the interface must never invent one.

## Development rules

- Use synthetic fixtures and reserved example domains only.
- Never commit real tokens, private logs, user paths, or customer information.
- Do not log source content, raw findings, or replacement values.
- Do not add analytics or network services without an explicit privacy review and product decision.
- Treat a partial or failed detector run as `Needs review`, never `Verified`.
- Preserve the source file and fail closed when image orientation or metadata cannot be interpreted safely.
- Keep complete OCR text inside the Rust desktop process; return only masked findings and required review rectangles to the interface.
- Recompute OCR findings from the unchanged source at export time instead of trusting finding geometry returned by the interface.
