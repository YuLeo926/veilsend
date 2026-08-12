# ShareGate Security Policy

ShareGate handles content that may contain credentials and personal information. Security and privacy defects are treated as high priority.

## Reporting a vulnerability

Until a private reporting address is published, do not open a public issue containing real secrets, personal data, or private files. Open an issue containing only a high-level description and synthetic reproduction steps, and request a private contact channel.

Never attach real logs, tokens, screenshots, configuration, or customer data to a report.

## Supported code

The current `main` branch is a pre-release foundation. There are no supported public releases yet.

## Threat model for v0.1

ShareGate aims to reduce accidental disclosure while a user prepares local text for sharing. It protects against common, recognizable secret and PII patterns appearing in pasted text or supported UTF-8 files.

It does not protect against:

- secrets that do not match an enabled detector;
- malicious files or compromised operating systems;
- screen capture, clipboard monitoring, or another process reading memory;
- deliberate disclosure by the local user;
- compliance, legal, or regulatory requirements.

The application must never describe an output as universally safe. `Verified` means only that the completed post-clean scan found no matches from the enabled ShareGate rules.

## Development rules

- Use synthetic fixtures and reserved example domains only.
- Never commit real tokens, private logs, user paths, or customer information.
- Do not log source content, raw findings, or replacement values.
- Do not add analytics or network services without an explicit privacy review and product decision.
- Treat a partial or failed detector run as `Needs review`, never `Verified`.

