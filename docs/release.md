# VeilSend beta release runbook

This runbook is for the `0.2.0-beta.1` candidate. Documentation and a successful local build do not establish a public release or clean-Windows acceptance. The release workflow must produce a **draft pre-release** first; only an accepted draft may be made public.

## Before tagging

Confirm a clean source tree, the intended commit, and matching `0.2.0-beta.1` versions in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`. `node scripts/release-contract.mjs v0.2.0-beta.1` must pass. Run the hosted-quality-equivalent commands in [development notes](development.md), including `npm run test:release`, and inspect every failure. Use the synthetic Windows detector fixtures and packaged-app flows; a skipped, unavailable, or incomplete detector blocks acceptance rather than becoming a pass. Never use real user material.

The tag-triggered `release / windows-beta` workflow is draft-only. It builds the current-user NSIS setup EXE and portable ZIP once, generates a CycloneDX SBOM and `SHA256SUMS.txt`, creates a GitHub build-provenance attestation, and attaches the four exact assets to a draft. It refuses an existing release; rerunning it must not silently replace assets. The portable ZIP root contains only `VeilSend.exe`, `LICENSE`, `RELEASE_NOTES.md`, and `THIRD_PARTY_LICENSES.md`.

## Verify the draft before installation

Download the draft into a new directory and run the asset verifier against the canonical repository:

```powershell
gh release download v0.2.0-beta.1 --repo YuLeo926/veilsend --dir tmp/release-verify-v0.2.0-beta.1
pwsh -File scripts/verify-release-assets.ps1 -AssetsDirectory tmp/release-verify-v0.2.0-beta.1 -Repository YuLeo926/veilsend
```

The verifier must fail closed on missing or extra assets, malformed or mismatched SHA-256 lines, invalid SBOM format, unexpected ZIP members, a signed-state mismatch, or missing/invalid GitHub attestation. Do not bypass provenance checks for a production release. Verify that the draft's tag resolves to the accepted commit and its assets are the expected `VeilSend_0.2.0-beta.1_x64-setup-UNSIGNED.exe`, `VeilSend_0.2.0-beta.1_x64-portable-UNSIGNED.zip`, `veilsend-0.2.0-beta.1-sbom.cdx.json`, and `SHA256SUMS.txt`.

Use PowerShell 7 on Windows and a GitHub CLI supporting `gh attestation verify` with `--signer-workflow`, `--cert-identity`, `--source-ref`, and `--deny-self-hosted-runners`. The CLI must have access to the draft's attestations. Verification binds every asset (including `SHA256SUMS.txt`) to the requested repository, `.github/workflows/release.yml`, the exact `refs/tags/v0.2.0-beta.1` certificate identity/source ref, SLSA v1 build provenance, and GitHub-hosted runners. Missing credentials, unsupported flags, network failures, or provenance mismatch block verification; an attestation from an unrelated workflow in the same repository is insufficient. Separately confirm the tag's commit against the accepted build before publication.

The download directory must contain only the four exact files, including no hidden extras, directories, or reparse points. The checksum manifest must contain exactly one lowercase 64-digit SHA-256 entry per payload, separated from its exact filename by two spaces; duplicate, unknown, malformed, and missing entries fail. All ZIP entries are inspected **before extraction**: only the four exact root files are accepted, never directory entries, traversal, alternate streams, links, or duplicate names. Both executable signatures must be `NotSigned`, the JSON must identify `CycloneDX`, and the bundled notes must disclose this unsigned pre-release and the SmartScreen warning. This checks the declared SBOM format, not full CycloneDX schema validity or inventory completeness.

The verifier snapshots assets and extracts only inside a fresh `.veilsend-portable-inspection-v0.2.0-beta.1` child of the provided directory; it never changes source downloads or launches either executable. It rejects a pre-existing child and removes only its own validated inspection directory on success or failure. Use a directory you control without concurrent writers. Inspection limits are 256 MiB for each executable, 512 MiB for the ZIP, 64 MiB for SBOM JSON, 4 KiB for checksums, and 8 MiB per portable notice (280 MiB total uncompressed). Exceeding a limit blocks verification and requires review, not silently relaxed checks.

For local regression tests only, PowerShell compiles a minimal unsigned managed PE into an isolated fixture directory. No existing application build is required. Optionally use an existing unsigned VeilSend build for additional real-package-byte coverage:

```powershell
pwsh -NoProfile -File scripts/verify-release-assets.test.ps1
pwsh -NoProfile -File scripts/verify-release-assets.test.ps1 -UnsignedExecutable target/release/veilsend.exe
npm run test:release
```

These fixtures exercise real Authenticode inspection without running binaries; their isolated fake `gh` checks invocation policy and failure propagation, not cryptographic provenance. The release suite runs them on Windows even before the app build and explicitly reports a skip on other platforms; a skip is not Windows verification. The synthetic PE is not a functional VeilSend application. `-SkipAttestation` is a local test option only, rejected when CI is truthy (including `true` or `1`), and reports **PARTIAL LOCAL CHECK ONLY**, never release acceptance. The regression harness scopes/restores its own CI environment for positive local cases and explicitly tests CI bypass rejection; production draft and public-download verification must omit the switch. Any mismatch blocks publication and requires diagnosing the workflow; never replace public beta assets in place.

## Dependency audit warning tracking

The 2026-09-26 `cargo audit --json` retry returned exit 0, zero registry errors, and zero vulnerability entries. Seven maintenance warnings remain, not a warning-free audit: `proc-macro-error` (RUSTSEC-2024-0370) and `glib` (RUSTSEC-2024-0429) are absent from the Windows x64 dependency graph. Five unmaintained Unicode dependencies remain in the Windows build/runtime graph through `urlpattern -> tauri-utils`: `unic-char-property` (RUSTSEC-2025-0081), `unic-char-range` (RUSTSEC-2025-0075), `unic-common` (RUSTSEC-2025-0080), `unic-ucd-ident` (RUSTSEC-2025-0100), and `unic-ucd-version` (RUSTSEC-2025-0098). Track upstream replacements and reassess new advisories before publication; retain the locked graph for this candidate without new audit ignore flags or an unrelated Tauri migration.

## Clean-Windows acceptance

On a clean Windows 10/11 x64 machine or VM, install the setup EXE as the current user without elevation and test the portable ZIP separately. Record OS version and accepted build commit without machine names, paths, source content, copied diagnostics, or screenshots containing private data. Check About identity, the local/offline boundary, safe diagnostics, trust center, receipts, single-file drag-and-drop, and text/image/PDF flows using only fixed synthetic fixtures. Run the PDF page navigation/zoom and overlay layout checks. Disconnect networking after installation and confirm local scanning, redaction, verification, and saving work; if WebView2 is absent, installation itself may use Microsoft's online bootstrapper. Confirm every expected detector completes; a missing OCR language pack, face detector, or PDF renderer blocks release.

Create `docs/releases/v0.2.0-beta.1-acceptance.json` only from actual acceptance results, then validate it with `node scripts/acceptance-contract.mjs docs/releases/v0.2.0-beta.1-acceptance.json`. Do not manufacture a pass or treat local unit tests as clean-Windows evidence.

## Signing and publication

This beta is **not Authenticode signed**. State that plainly in Release notes and asset names. Microsoft SmartScreen may warn; neither accepting nor suppressing that prompt authenticates the download. A matching SHA-256 and valid GitHub provenance are required checks, not a universal safety guarantee. Do not claim a signed, stable, or generally safe release.

Before publication, ensure GitHub private vulnerability reporting is enabled for `YuLeo926/veilsend` and the public security link resolves. Confirm the draft is marked pre-release, all gates and asset verification pass, and the release notes disclose Windows x64, unsigned/SmartScreen, WebView2 installation bootstrap, offline processing after installation, supported workflows, and known limitations. Publish only the already accepted draft:

```powershell
gh release edit v0.2.0-beta.1 --repo YuLeo926/veilsend --draft=false --prerelease --notes-file RELEASE_NOTES.md
```

Download the now-public assets into a fresh directory and rerun `scripts/verify-release-assets.ps1` with `-Repository YuLeo926/veilsend`; verify the public page links and pre-release status. Do not promote it to Latest or imply a stable channel.

If a prepublication check fails, leave the draft private and diagnose the workflow. Withdraw an invalid public release promptly and disclose what changed; never replace or rename public binaries in place. Any binary replacement requires a new version, a new tag, fresh attestations, checksums, acceptance, and a new pre-release.
