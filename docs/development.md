# ShareGate development notes

## Verification baseline

Run these checks before committing changes:

```bash
cargo fmt --all -- --check
cargo clippy -p sharegate-core -- -D warnings
cargo test -p sharegate-core
npm audit
npm test
npm run build
cargo check -p sharegate
```

The last check compiles the Windows desktop shell and therefore requires local endpoint security to allow Cargo-generated build scripts. Do not disable endpoint security automatically. If an organization blocks `target/**/build-script-build.exe`, ask its administrator to approve the Rust/Tauri build workflow or build in an approved development environment.

## Browser preview

`npm run dev` provides a preview of the interface and uses the TypeScript base-rule adapter. It is useful for interface work but is not the production security boundary. The packaged Tauri application invokes `sharegate-core` in Rust.

## Synthetic data only

Use `fixtures/synthetic-support-log.txt` or create obviously fake values under reserved example domains. Never use a real incident log or credential to test ShareGate.

