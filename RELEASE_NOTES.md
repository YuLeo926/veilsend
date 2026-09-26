VeilSend 0.2.0-beta.1 is an unsigned pre-release.

This Windows x64 beta is distributed through the project's GitHub Releases as a current-user NSIS installer and a portable ZIP. It is not Authenticode signed. Microsoft SmartScreen may warn before the first run; that warning is expected for this beta and does not establish that a download is authentic.

## Verify before running

Download the matching `SHA256SUMS.txt` from the same GitHub Release and compare it with the asset you downloaded:

```powershell
Get-FileHash -Algorithm SHA256 .\VeilSend_0.2.0-beta.1_x64-setup-UNSIGNED.exe
Get-Content .\SHA256SUMS.txt
```

Only use an asset whose SHA-256 exactly matches the published entry. Do not rely on a filename, a reposted binary, or a SmartScreen prompt as proof of origin.

## Installation and offline boundary

The installer runs for the current Windows user and does not require administrator rights. It may use Microsoft's WebView2 bootstrapper during installation when the runtime is absent. Once installation is complete, scanning, redaction, verification, and saving work offline. VeilSend does not include an updater, analytics, crash uploads, or a background network service.

The portable ZIP contains `VeilSend.exe`, this notice, the project license, and third-party license information. Extract it to a directory you control and launch `VeilSend.exe`.

## Beta limitations

This is a pre-release. Keep original files, review every suggested cleanup, and treat a `Verified` result as coverage of VeilSend's supported local checks rather than a guarantee that content is safe. Report security issues through the repository security policy; do not upload real sensitive files as issue attachments.
