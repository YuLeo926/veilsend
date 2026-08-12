# ShareGate Milestone A Implementation Plan

## Goal

Deliver a locally runnable ShareGate desktop foundation that scans pasted text or UTF-8 text files, lets users review and choose findings, creates a separate sanitized value, and verifies the result.

## Implementation slices

1. **Repository foundation**
   - Create the Cargo workspace, standalone `sharegate-core` crate, Vite/React frontend, and Tauri 2 host.
   - Add formatting, linting, build, and test scripts.

2. **Domain model and scanner**
   - Define serializable scan options, reports, findings, categories, and severity.
   - Implement deterministic rules for credentials, personal data, private networks, local paths, and custom terms.
   - Resolve duplicate/overlapping matches before returning a report.

3. **Sanitize and verify**
   - Fingerprint scanned input to reject stale changes.
   - Apply selected replacements safely from the end of the text.
   - Rescan output and derive verified, needs-review, or exception status.

4. **Desktop command boundary**
   - Expose scan and sanitize commands from the Rust core through Tauri.
   - Keep file selection and saving explicit and local.
   - Return stable structured errors.

5. **Review-focused interface**
   - Build Add, Review, and Verified states.
   - Support paste, drag/drop, file selection, masked finding cards, per-finding inclusion, clean/copy/download, and restart.
   - Use a restrained “inspection desk” visual direction: warm paper, dark ink, safety-orange accents, and precise typographic hierarchy.

6. **Verification and handoff**
   - Add synthetic rule, sanitizer, and verification tests.
   - Run Rust tests, frontend tests, type checking, production build, and Tauri compile checks.
   - Document setup, privacy guarantees, limitations, and next steps.

## Key files

```text
Cargo.toml
package.json
crates/sharegate-core/src/{lib,model,rules,sanitize}.rs
src/{App,main,styles}.tsx
src/lib/{bridge,browserScanner,types}.ts
src-tauri/src/{lib,main}.rs
src-tauri/{Cargo.toml,tauri.conf.json,capabilities/default.json}
fixtures/synthetic-support-log.txt
README.md
```

## Completion checks

- `cargo test --workspace`
- `npm test`
- `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- Manual browser smoke test with the synthetic fixture
