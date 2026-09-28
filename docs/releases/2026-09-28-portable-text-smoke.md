# Supplemental portable text smoke test — 2026-09-28

This supplements, and does not rewrite, the [2026-09-26 experimental validation record](v0.2.0-beta.1-experimental.md). It is not clean-Windows acceptance, a stable-release approval, or a security certification.

## Artifact and environment

- Existing downloaded public asset: `VeilSend_0.2.0-beta.1_x64-portable-UNSIGNED.zip`.
- ZIP SHA-256 rechecked before extraction: `4cbba756ddfe01d998af585bdbbc942dec930343f118c67392c418e3e29314c0`, matching the previously verified published asset.
- The four expected root members were checked before extracting to a fresh, task-owned directory. No installer was run.
- Extracted `VeilSend.exe` SHA-256: `cbf5e495fb4d29c7d433b56dbb971ebc5ed378d59594c97ae18da1655d808cc4`.
- App displayed `0.2.0-beta.1` and `beta · bbaa1c7488cf`; original source commit remains `bbaa1c7488cff90338e73380161ffaa4875b9880`.
- Host: existing Windows 11 x64 development machine, reported kernel version `10.0.26200`. Existing runtime and developer dependencies were not removed. Network remained connected.

## Observed workflow

1. Launched the extracted portable executable without running the installer. The native desktop app opened.
2. Chose **Try safe sample**. It loaded the built-in synthetic support log plus its custom sensitive term.
3. **Scan locally** reported six findings: one email, two credential findings, one local path, one private IP and one custom term. Nine rules ran. This is not a timing benchmark.
4. Kept all six proposed cleanups selected. **Clean & verify** reported zero remaining enabled-rule matches and displayed the separate cleaned preview.
5. **Save clean copy** wrote a new 273-byte text file outside the portable directory, without replacing an existing file. The app showed a saved confirmation and the private-receipt controls; output SHA-256 sharing remained unchecked. No clipboard copy was requested.
6. Independently reread the saved text. All seven predefined source markers were absent: the sample email, fake assigned secret, fake database password, database private IP, fake local username, callback private IP and custom term. This is a bounded fixture check, not an exhaustive detector audit.
7. Closed the test window and confirmed no window remained for that specific executable. All four portable files still matched their ZIP entries byte-for-byte by SHA-256; no extra file was present in the portable directory. This does not inspect all OS-managed caches or app-data locations.

Only built-in fake data was processed. No original disk file was opened in this text trial, so no disk-source-preservation claim is inferred from it.

## Real-screen assets

`site/public/screenshots/text-sample.jpg`, `text-review.jpg` and `text-clean.jpg` are unedited native-window captures from the workflow above, each 1707 × 1019 pixels. They were visually reviewed and contain synthetic data only. They are screenshots, **not a continuous recording**. The cleaned screenshot is before saving and must not be labeled as a saved-output receipt.

An initial capture before foreground activation showed another window despite reporting the VeilSend accessibility tree. That capture was not saved or used as an asset. The target was activated, recaptured, and visually confirmed before each retained image. Save dialogs and the post-save local path were excluded from public assets. Raw trial outputs stay in the ignored local `output/` directory.

## Still unverified

- Clean Windows installation, missing-WebView2 bootstrap, Start menu launch and uninstall preservation.
- Portable image/PDF, drag/drop, clipboard, diagnostic and complete acceptance-matrix behavior.
- Disconnected-network operation and complete application-exit residue checks.
- Continuous real-desktop demo video and user trials on other computers.

No system security setting was changed, no network was disabled, no installer/uninstaller was run, and no public launch or paid offer was created by this test.
