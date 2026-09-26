# Changelog

## 0.2.0-beta.1 — experimental Beta

Unsigned Windows experimental pre-release with limited development-host smoke testing, not clean-Windows acceptance. See the [actual validation scope](docs/releases/v0.2.0-beta.1-experimental.md) and the explicitly approved experimental path in [the release runbook](docs/release.md).

### Added

- Build provenance via a pinned release workflow, CycloneDX SBOM, SHA-256 manifest, and GitHub attestation for the draft assets.
- A trust center with build identity, local/offline boundary, and explicit detector coverage and limitations.
- Safe diagnostics and saved-output receipts that report completed checks, incomplete checks, and user **Keep** exceptions without source content.
- Native single-file drag-and-drop intake for supported files, alongside existing paste and file-picker flows.
- PDF page navigation, zoom and fit controls, and manual-cover review on a flattened PDF workflow.
- Separate cleaned outputs with post-save verification for supported text, image, and PDF workflows.

### Known limitations

- Clean-system compatibility, portable runtime, uninstall preservation, disconnected-network operation, and the complete manual acceptance matrix remain unverified for this release.
- The beta is unsigned; Microsoft SmartScreen may warn. A warning is not proof of authenticity. Check the published SHA-256 and GitHub provenance before running a release asset.
- Windows 10/11 x64 only. The current-user installer may need a network connection to bootstrap Microsoft's WebView2 runtime if it is missing; processing works offline after installation.
- No Office files, batch processing, auto-updater, or encrypted PDF support.
- Detectors can produce false negatives, including OCR misses, obscured faces, unsupported or unreadable codes, and sensitive context outside supported rules. A `Verified` receipt is not a universal safety guarantee.
- Flattened PDFs lose searchable/selectable text and interactive or structural features, including forms, links, signatures, attachments, bookmarks, and accessibility tags.
