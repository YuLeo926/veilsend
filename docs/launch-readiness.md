# First-user launch preparation

This is a preparation record, not approval to sell or an acceptance pass. The current public binary remains the unchanged, unsigned `v0.2.0-beta.1` experimental release. See [observed tests and outstanding checks](releases/v0.2.0-beta.1-experimental.md).

## This slice

- Separate English product page and install/first-run/uninstall guide in `site/`.
- Fixed, interactive synthetic illustration clearly distinguished from a live scanner, screenshot or recording.
- Chinese [getting-started guide](getting-started.zh-CN.md) and a read-only installation locator.
- Public trial-feedback form with privacy warnings, observed workflow/frequency/alternative/outcome questions, and optional non-binding purchase interest.
- No telemetry, upload endpoint, mailing-list collection, payment integration, license gate, or new desktop feature. After explicit publication approval, a scoped GitHub Pages workflow was added for the public website only.
- No changes to the app's version, released binaries, original tag or release acceptance record.

The landing page uses a restrained editorial layout: document-like typography, dark green ink and a high-contrast redaction example. Its privacy boundary is enforced by static/link/interaction tests. It uses locally available fonts, no analytics, and no remote embeds. Hosting providers can still process access logs. GitHub handles data users intentionally submit there under its own policies.

## Preview and build

```powershell
npm run dev:site
npm run test:site
npm run build:site
npm run preview:site
```

Run only one site server at a time; development and production preview both reserve `127.0.0.1:1421`. The site has its own build config and `site-dist/` output; it does not replace the desktop app's `dist/`. Relative asset links support hosting under a subdirectory. No new package dependencies were added.

Only `site-dist/` is a public deployment artifact. Do not serve the repository root, `tmp/`, source fixtures outside the chosen public site, or local test outputs. Publish the trial-feedback template to the default branch before deploying the site; local tests cannot prove the remote template exists. Review public URLs and the feedback entry after deployment. Feedback submission requires the visitor's own GitHub account; do not submit a dummy issue to test it. Do not add a fake domain or checkout button.

## Approved website publication — 2026-09-28

The owner explicitly approved publishing the website and feedback form to the existing repository and enabling public GitHub Pages. This does not approve Product Hunt/AppSumo submission, payments, recruitment or messaging users. GitHub Pages was configured with HTTPS at <https://yuleo926.github.io/veilsend/>; deployment and public verification follow the merged workflow, not this configuration response alone.

The `product-site` workflow accepts only `master`, tests and builds the site, uploads only `site-dist/`, and scopes Pages/OIDC write permissions to its deployment job. Actions are pinned to verified commit IDs. Website changes deploy automatically after merging to `master`; they do not rebuild or replace the published Windows release. The trial feedback form creates public GitHub issues and requires an account.

Before publication, 45 release/website contract tests and 117 frontend tests passed; desktop frontend and site builds succeeded and the license bundle was current. The final site has 10 dedicated tests. Production-output verification caught an original-image link that Vite did not rewrite; screenshots were moved to the public assets directory, and every built local link, image, stylesheet, script and fragment is now checked by `build:site`. The mobile gallery was visually inspected at 390px without horizontal overflow.

## Local preparation checks — 2026-09-28

- `npm run test:site`: 8 passed. Relative links/fragments, fixed-example interaction, public privacy warnings, free/beta limitations, and absence of site-owned upload/storage/tracking hooks were checked.
- `npm run test:release`: 43 passed (includes those 8 site tests). These are automated contracts, not 43 real-device acceptance passes.
- `npm test`: 117 frontend tests passed; `npm run build` and `npm run build:site` succeeded; `npm run check:licenses` reported the existing license bundle current.
- The trial-feedback YAML parsed successfully in the formatter check. Its live GitHub form has not been published or tested.
- Production site preview inspected at 1440 × 1000, 390 × 844 and 320 × 740. Home and guide fit the 320px viewport with 200% root text after fixing navigation/grid/table overflow. Desktop screenshot, mobile screenshot and large-text guide screenshot are local, ignored QA artifacts under `output/playwright/`.
- The desktop example was exercised by click and Tab/Enter. The main beta button reached the guide's download section. The browser reported no console errors at the end of the check.
- This browser environment injected Kaspersky-domain requests. Site source contains no such resource, and no security software was disabled. The browser session therefore does **not** establish a zero-external-request environment or offline desktop behavior.
- `scripts/find-installation.ps1` ran successfully and found the current user's registered beta without executing its uninstall command. Local paths were not saved in this document. This does not test installer/uninstaller behavior or prove the registered executable is present.

No clean Windows installation, uninstall, network disconnection, real desktop recording, user recruitment, public deployment, Product Hunt/AppSumo submission or payment was performed in this slice. Existing untracked release downloads were preserved.

## Minimal real-device pilot

Update on 2026-09-28: the [supplemental portable text trial](releases/2026-09-28-portable-text-smoke.md) passed on the existing development host. Three real native-window screenshots were added to the site, explicitly distinguished from the fixed illustration, a continuous video and saved-output verification. The installed copy was not reinstalled or uninstalled. Windows Sandbox and the usual Hyper-V/VirtualBox/VMware management entry points were not found in the targeted read-only checks; no system feature was enabled and this is not proof that no VM exists anywhere on the machine.

Use 10–20 consenting target users as an initial research goal, not a promised audience or industry benchmark. Prioritize people who send support logs, bug-report screenshots or client documents repeatedly. Do not scrape contacts or message anyone without authorization.

For each test device, use fake content only. Do not copy user files, account names, local paths or raw diagnostics into the research record. Store only the app version/build, Windows version/architecture, result states and the participant's voluntarily supplied non-identifying workflow feedback.

| Check | Observe | Current evidence |
| --- | --- | --- |
| Clean Windows installation | Current-user install without developer tools; WebView2 presence/missing-runtime path; Start menu launch | Not verified |
| Text trial | Built-in sample → review → clean → save → inspect saved output | Development-host smoke test only |
| Image / PDF trial | Synthetic fixtures, selected covers, saved-output checks, originals unchanged | Development-host smoke test only |
| Offline runtime | After installation, disconnect networking with device owner's consent; perform text/image/PDF flows | Not verified |
| Uninstall | Close app, uninstall from Settings; program/shortcuts removed; separately saved outputs and sources unchanged | Not verified |
| Portable | Extract official ZIP and run separately; confirm runtime requirements and no source residue | Development-host text trial passed; image/PDF, clean-PC and complete residue checks still unverified |

Do not run the installer or uninstaller on the user's daily system merely to tick these boxes. Prefer a clean disposable Windows VM or volunteer test computer. Missing infrastructure is an outstanding check, not a pass. This pilot does not replace the stricter [release acceptance runbook](release.md).

## A 45–60 second real recording — ready to capture, not yet recorded

Record the installed desktop app, not the website illustration or browser preview. Use only the built-in synthetic text sample. Close private windows and notifications; crop out usernames, file-picker paths and unrelated desktop areas. Use a neutral staging folder. Do not record real clipboard content, keys or customer data.

| Time | Screen action | On-screen caption / narration |
| --- | --- | --- |
| 0–8 s | Text mode, choose **Try safe sample** | “Before you send a support log, check what is inside.” |
| 8–20 s | **Scan locally**, review masked findings | “Review likely sensitive details on your computer.” |
| 20–32 s | **Clean & verify**, show cleaned text | “Replace selected details. Keep the original.” |
| 32–45 s | **Save clean copy**, show the saved-output receipt with paths cropped | “Save a separate copy and check the saved result.” |
| 45–55 s | Manual review, finish on app or title card | “Free Windows experimental beta. Detectors can miss details—inspect before sharing.” |

Record actual timing. Edit pauses transparently; do not fabricate a completed scan, hard-code a success receipt or describe the web illustration as a real demonstration. Review every frame and audio before sharing. No recording or upload is claimed by this document.

## Product Hunt draft copy

Name: **VeilSend**

Tagline: **Check logs, screenshots and PDFs before sharing**

Description:

> VeilSend is a free, open-source Windows desktop beta for reviewing sensitive details before a support handoff or client update. Process content locally, review proposed redactions, save a separate copy, and check the saved output. Start with synthetic data: this unsigned experimental build has incomplete compatibility testing, and its checks are not a safety guarantee.

Maker comment draft:

> I built VeilSend for the moment before sending a log, screenshot or PDF to someone else. The aim is a short inspect → clean → check workflow, not another cloud upload. This is an early Windows beta; I would especially like to hear from people who do support handoffs or client updates regularly. Try the built-in fake sample and tell me where the workflow helps or gets in the way. Please do not post private files or real secrets. PDFs are exported as image-only copies, and every result still needs human review.

These are drafts, not submitted listings. Do not buy or incentivize votes. Publish only after the real-device pilot, live guide/feedback links and actual recording are reviewed. Never market this as signed, stable, certified, or guaranteed safe.

## Learning before payment

Record behavior before opinions: Could they finish? Would they repeat the task? What alternative did they use? Did they observe a measurable saving? What single missing capability blocked a second use? The public form is optional and requires GitHub; it is not a private survey or lead list. If that friction deters users, design a privacy-reviewed alternative before collecting contact details.

The first decision is whether to build one paid improvement, not a large Pro edition. Batch processing and reusable rules/presets are candidates, **not promised or shipped features**. A $29 one-time purchase including one year of updates is an internal price hypothesis, not an advertised offer or commitment. Do not withdraw the current free release, change its license, charge users, or promise lifetime maintenance without a separate decision.

Five genuine paid orders can be an initial learning milestone once an actual paid offering exists; it is not a conversion forecast. Expressed interest, downloads and votes are not purchases. If testers rarely repeat the task or free alternatives suffice, improve or narrow the workflow before expanding features. AppSumo remains deferred until stability, a support plan, paid value and viable deal economics are established.
