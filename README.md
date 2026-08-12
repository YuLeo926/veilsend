# ShareGate

**Scan anything before it leaves your computer.**

ShareGate is a local-first outbound safety gate for text, logs, configuration files, and—next—screenshots. It detects likely credentials, personal information, private network details, local paths, and user-defined sensitive terms; lets the user review each match; produces a separate clean copy; and scans that output again.

> ShareGate reduces accidental disclosure. It does not guarantee that content is safe and is not a compliance product.

## Current milestone

Milestone A implements the complete text workflow:

- paste text or open/drop UTF-8 `.txt`, `.log`, `.json`, and `.env` files;
- scan with deterministic local rules;
- mask detected values by default and show safe surrounding context;
- include or exclude each proposed cleanup;
- customize replacement labels;
- generate a separate clean copy;
- rescan it and report `Verified`, `Needs review`, or user exceptions;
- copy or save the result without modifying the source.

Image OCR, visual redaction, QR detection, and EXIF/GPS removal belong to the next milestone. Complex PDF and Office formats are intentionally outside v0.1.

## Architecture

```text
React + TypeScript review interface
              │
       Tauri command boundary
              │
       sharegate-core (Rust)
        scan → clean → verify
```

The Rust engine is a standalone crate so a later CLI can reuse the same rules. Browser development uses a TypeScript preview adapter; packaged desktop scans use the Rust engine.

## Run locally

Requirements:

- Node.js 22+
- Rust 1.85+
- platform requirements for [Tauri 2](https://v2.tauri.app/start/prerequisites/)

```bash
npm install
npm run dev
```

For the desktop app:

```bash
npm run tauri dev
```

Use **Try safe sample** in the opening screen. All values in the sample and `fixtures/` are synthetic.

## Verify the project

```bash
cargo test --workspace
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Privacy model

- No analytics, crash uploads, accounts, remote fonts, or cloud APIs.
- Source content and raw findings are not written to application logs.
- Source files are opened read-only by the interface and never overwritten.
- Saving is explicit and defaults to a `.cleaned` filename.
- The Milestone A input limit is 10 MiB.

The browser preview itself is delivered by a local Vite server during development. The packaged application is the intended offline distribution.

## Documentation

- [Product and engineering design](docs/superpowers/specs/2026-08-12-sharegate-v0.1-design.md)
- [Milestone A implementation plan](docs/superpowers/plans/2026-08-12-sharegate-milestone-a.md)
- [Security policy and threat model](SECURITY.md)
- [Development and verification notes](docs/development.md)

## License

[MIT](LICENSE)
