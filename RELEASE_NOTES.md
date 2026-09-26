VeilSend 0.2.0-beta.1 is an unsigned pre-release. This is an **experimental Beta**.

**Not clean-system accepted.** Core text, image, and PDF file-picker workflows were exercised on one Windows 11 development host using the actual CI installer and synthetic fixtures. Cleaned text and saved PNG/PDF verification passed, and source fixture hashes stayed unchanged. This is limited smoke-test evidence, not general Windows 10/11 compatibility certification.

Portable startup/workflows, uninstall preservation, disconnected-network operation, and the full manual acceptance matrix have **not** been verified. Uninstallation is left to the maintainer; it is not recorded as passed. Use synthetic or disposable copies for evaluation, retain originals, and inspect every output. See the [validation scope](https://github.com/YuLeo926/veilsend/blob/master/docs/releases/v0.2.0-beta.1-experimental.md).

The installer, ZIP, checksums, and SBOM remain the original CI artifacts from commit `bbaa1c7488cff90338e73380161ffaa4875b9880`; their SHA-256 and GitHub provenance were verified. The ZIP's bundled notice predates this experimental validation update; this release page provides the current validation scope. No binary or tag was replaced.

This Windows x64 beta is distributed through the project's GitHub Releases as a current-user NSIS installer and a portable ZIP. It is not Authenticode signed. Microsoft SmartScreen may warn before the first run; that warning is expected for this beta and does not establish that a download is authentic.

## Verify before running

Download the matching `SHA256SUMS.txt` from the same GitHub Release and compare it with the asset you downloaded:

```powershell
Get-FileHash -Algorithm SHA256 .\VeilSend_0.2.0-beta.1_x64-setup-UNSIGNED.exe
Get-Content .\SHA256SUMS.txt
```

Only use an asset whose SHA-256 exactly matches the published entry. Do not rely on a filename, a reposted binary, or a SmartScreen prompt as proof of origin.

## Installation and offline boundary

The installer runs for the current Windows user and does not require administrator rights. It may use Microsoft's WebView2 bootstrapper during installation when the runtime is absent. Scanning, redaction, verification, and saving are designed to work offline after installation; a disconnected-network run was not performed for this experimental release. VeilSend does not include an updater, analytics, crash uploads, or a background network service.

The portable ZIP contains `VeilSend.exe`, this notice, the project license, and third-party license information. Extract it to a directory you control and launch `VeilSend.exe`.

## Beta limitations

This is a pre-release. Keep original files, review every suggested cleanup, and treat a `Verified` result as coverage of VeilSend's supported local checks rather than a guarantee that content is safe. Report security issues through the repository security policy; do not upload real sensitive files as issue attachments.
