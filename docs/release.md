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
