# Contributing to VeilSend

Use only synthetic fixtures, fake values, and reserved example domains in tests, issues, commits, and screenshots. Never submit real credentials, customer data, private files, personal paths, or incident logs. Safe diagnostics contain no source content, OCR transcript, decoded QR/barcode payload, or replacement value; maintain that boundary in new code and tests. For a vulnerability, use [the private security route](SECURITY.md), not a public issue.

## Local quality checks

Before a focused commit, run the relevant tests and the full baseline where feasible:

```bash
npm ci
npm run test:release
npm run check:licenses
npm test
npm run build
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
cargo test --locked --workspace --all-features
npm audit --audit-level=high
cargo audit
```

Windows-specific detector acceptance is separate from the ordinary unit suite. Follow [development notes](docs/development.md) for synthetic fixtures and ignored Windows tests. For PDF overlays and zoom, run `node scripts/check-pdf-overlay-layout.mjs` on Windows with installed Edge or pass the absolute Chromium executable path. This browser measurement checks rendered region geometry; it does not replace manual packaged-app acceptance.

Dependency or workflow changes must retain lockfile-based resolution. Pin every third-party GitHub Action to a full commit SHA, not a mutable tag. Keep commits focused, describe the behavior and tests performed, and do not commit generated private output, real support samples, or a release acceptance record before it has been measured on clean Windows.
