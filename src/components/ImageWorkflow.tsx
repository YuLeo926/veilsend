import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Barcode,
  Camera,
  Check,
  CheckCircle2,
  Clock3,
  ClipboardPaste,
  FileQuestion,
  Fingerprint,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  MessageSquareText,
  QrCode,
  RefreshCcw,
  ScanFace,
  ScanLine,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import {
  cleanImageFile,
  clearImageSession,
  isDesktop,
  pasteImage,
  pickImage,
} from "../lib/bridge";
import {
  buildDefaultDecisions,
  buildVisualFindings,
  isImagePasteShortcut,
  remainingRiskCount,
} from "../lib/imageWorkflowModel";
import { deriveImageDiagnostics, type DiagnosticErrorCode, type WorkflowDiagnostics } from "../lib/diagnostics";
import type {
  Category,
  CleanedImageFile,
  ImageMetadataCategory,
  ImageSession,
  ImageRedactionDecision,
  Severity,
} from "../lib/types";
import { InputModeTabs, type InputMode } from "./InputModeTabs";

type Stage = "add" | "review" | "result";

const severityLabel: Record<Severity, string> = {
  low: "Notice",
  medium: "Review",
  high: "High risk",
  critical: "Critical",
};

const categoryMeta: Record<ImageMetadataCategory, { label: string; icon: typeof Camera }> = {
  location: { label: "Location", icon: MapPin },
  device: { label: "Source device", icon: Camera },
  identity: { label: "Identity", icon: UserRound },
  time: { label: "Time", icon: Clock3 },
  description: { label: "Hidden text", icon: MessageSquareText },
  other: { label: "Other metadata", icon: FileQuestion },
};

const visibleCategoryLabel: Record<Category, string> = {
  credential: "Visible credential",
  personal: "Visible personal data",
  network: "Visible network detail",
  localContext: "Visible local context",
  custom: "Visible custom term",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readableError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    if ("message" in error) return String(error.message);
    const values = Object.values(error);
    if (values.length) return String(values.at(-1));
  }
  return "VeilSend could not process that image. The original was not changed.";
}

export function ImageWorkflow({
  stage,
  onStageChange,
  onSwitchMode,
  onError,
  onDiagnosticsChange,
}: {
  stage: Stage;
  onStageChange: (stage: Stage) => void;
  onSwitchMode: (mode: Exclude<InputMode, "image">) => void;
  onError: (message: string, code?: DiagnosticErrorCode) => void;
  onDiagnosticsChange: (next: WorkflowDiagnostics) => void;
}) {
  const [session, setSession] = useState<ImageSession | null>(null);
  const [result, setResult] = useState<CleanedImageFile | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ImageRedactionDecision>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    onDiagnosticsChange(deriveImageDiagnostics({
      stage,
      inputBytes: stage === "add" ? null : session?.inspection.bytes ?? null,
      metadataInspected: session !== null,
      textAvailability: session?.ocr.availability ?? null,
      faceAvailability: session?.faces.availability ?? null,
      qrAvailability: session?.qr.availability ?? null,
      barcodeAvailability: session?.barcodes.availability ?? null,
      resultChecks: result ? {
        text: result.verification.ocrChecked,
        face: result.verification.faceChecked,
        qr: result.verification.qrChecked,
        barcode: result.verification.barcodeChecked,
      } : null,
    }));
  }, [onDiagnosticsChange, result, session, stage]);

  const textFindings = session?.ocr.report?.findings ?? [];
  const faceFindings = session?.faces.findings ?? [];
  const qrFindings = session?.qr.report?.findings ?? [];
  const barcodeFindings = session?.barcodes.report?.findings ?? [];
  const visualFindings = useMemo(
    () => session ? buildVisualFindings(session) : [],
    [session],
  );
  const findingNumber = useMemo(
    () => new Map(visualFindings.map((finding, index) => [finding.id, index + 1])),
    [visualFindings],
  );
  const selectedVisualCount = useMemo(
    () => visualFindings.filter((finding) => decisions[finding.id]?.enabled !== false).length,
    [decisions, visualFindings],
  );

  useEffect(() => {
    if (!isDesktop()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !busy
        && (event.ctrlKey || event.metaKey)
        && event.key.toLowerCase() === "v"
        && isImagePasteShortcut(event.target, stage)
      ) {
        event.preventDefault();
        void pasteScreenshot();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, stage]);

  function acceptSession(nextSession: ImageSession) {
    setSession(nextSession);
    setDecisions(buildDefaultDecisions(nextSession));
    setResult(null);
    onStageChange("review");
  }

  async function clearCurrentSession() {
    if (!session) return;
    await clearImageSession();
    setSession(null);
    setDecisions({});
  }

  async function chooseImage() {
    setBusy(true);
    onError("");
    try {
      await clearCurrentSession();
      const nextSession = await pickImage();
      if (!nextSession) return;
      acceptSession(nextSession);
    } catch (error) {
      onError(readableError(error), "inputRejected");
    } finally {
      setBusy(false);
    }
  }

  async function pasteScreenshot() {
    setBusy(true);
    onError("");
    try {
      await clearCurrentSession();
      acceptSession(await pasteImage());
    } catch (error) {
      onError(readableError(error), "inputRejected");
    } finally {
      setBusy(false);
    }
  }

  async function createCleanCopy() {
    if (!session) return;
    setBusy(true);
    onError("");
    try {
      const nextResult = await cleanImageFile(
        session.sessionId,
        Object.values(decisions),
      );
      if (!nextResult) return;
      setResult(nextResult);
      onStageChange("result");
    } catch (error) {
      onError(readableError(error), "workflowFailed");
    } finally {
      setBusy(false);
    }
  }

  async function startAgain() {
    let clearError = "";
    try {
      await clearCurrentSession();
    } catch (error) {
      clearError = readableError(error);
    } finally {
      setResult(null);
      onError(clearError, clearError ? "workflowFailed" : "none");
      onStageChange("add");
    }
  }

  async function switchInputMode(mode: Exclude<InputMode, "image">) {
    try {
      await clearCurrentSession();
      onError("");
    } catch (error) {
      onError(readableError(error), "workflowFailed");
    } finally {
      onSwitchMode(mode);
    }
  }

  if (stage === "add") {
    return (
      <section className="stage-view add-stage image-add-stage">
        <InputModeTabs active="image" onChange={(mode) => mode !== "image" && void switchInputMode(mode)} />
        <div className="eyebrow"><Fingerprint size={15} /> Five local image checks</div>
        <h1>Find what the image<br />should not reveal.</h1>
        <p className="lead">Choose a JPEG or PNG, or paste a screenshot. VeilSend checks visible text, faces, QR codes, one-dimensional barcodes, and hidden metadata—all locally.</p>

        <div className="image-picker-card">
          <div className="image-picker-visual" aria-hidden="true">
            <div className="photo-sheet photo-sheet-back" />
            <div className="photo-sheet">
              <ImageIcon size={44} />
              <span>TEXT</span><span>FACE</span><span>CODE</span>
            </div>
            <div className="metadata-sweep"><ShieldCheck size={28} /></div>
          </div>
          <div className="image-picker-copy">
            <span className="local-label"><LockKeyhole size={14} /> Opened and scanned locally</span>
            <h2>Inspect one image</h2>
            <p>JPEG or PNG, up to 25 MB. The original and clipboard stay untouched. Reviewable regions are rewritten into a separate PNG; raw code payloads and face crops are never shown.</p>
            <div className="image-intake-actions">
              <button
                className="primary-button image-choose-button"
                type="button"
                disabled={busy || !isDesktop()}
                onClick={() => void chooseImage()}
              >
                {busy ? <LoaderCircle className="spin" size={18} /> : <FolderOpen size={18} />}
                Choose image
              </button>
              <button
                className="secondary-button paste-screenshot-button"
                type="button"
                disabled={busy || !isDesktop()}
                onClick={() => void pasteScreenshot()}
              >
                <ClipboardPaste size={18} />
                Paste screenshot <kbd>Ctrl V</kbd>
              </button>
            </div>
            {!isDesktop() && <div className="desktop-only-note">Image checks and cleaning run in the Windows desktop app. The browser preview keeps this control disabled.</div>}
          </div>
        </div>

        <div className="trust-row">
          <span><LockKeyhole size={15} /> No upload</span>
          <span><ScanFace size={15} /> Faces located, never identified</span>
          <span><Barcode size={15} /> Code payloads stay hidden</span>
          <span><RefreshCcw size={15} /> Saved copy rechecked</span>
        </div>
      </section>
    );
  }

  if (stage === "review" && session) {
    const { inspection, ocr, faces, qr, barcodes } = session;
    const totalFindings = inspection.findings.length + visualFindings.length;
    const imageWidth = inspection.width ?? 1;
    const imageHeight = inspection.height ?? 1;

    return (
      <section className="stage-view review-stage image-review-stage">
        <button className="back-button" type="button" onClick={() => void startAgain()}><ArrowLeft size={16} /> Choose a different image</button>
        <div className="review-heading">
          <div>
            <div className="eyebrow"><ScanLine size={15} /> Image safety review</div>
            <h1>{totalFindings ? `${totalFindings} risk${totalFindings === 1 ? "" : "s"} found.` : "No supported risks found."}</h1>
            <p>{totalFindings ? "Text, face, QR, and barcode regions start selected for opaque pixel redaction. Hidden metadata is always removed from the separate copy." : "VeilSend can still make a separate copy and repeat all five checks before reporting a result."}</p>
          </div>
          <div className="scan-receipt">
            <span>IMAGE RECEIPT</span>
            <strong>{inspection.format.toUpperCase()}</strong>
            <small>{inspection.width} × {inspection.height} · {formatBytes(inspection.bytes)}</small>
          </div>
        </div>

        {inspection.warnings.map((warning) => (
          <div className="orientation-warning" key={warning}>
            <AlertTriangle size={19} />
            <div><strong>Display orientation must be normalized first</strong><span>{warning}</span></div>
          </div>
        ))}

        <div className="detector-status-grid">
          <div className={`ocr-status ${ocr.availability}`}>
            {ocr.availability === "available" ? <ScanLine size={19} /> : <AlertTriangle size={19} />}
            <div>
              <strong>{ocr.availability === "available" ? "Visible text checked" : "Text needs review"}</strong>
              <span>{ocr.message}</span>
              {ocr.report && <small>{ocr.report.language ?? "System language"} · Confidence not supplied</small>}
            </div>
          </div>
          <div className={`ocr-status face-status ${faces.availability}`}>
            {faces.availability === "available" ? <ScanFace size={19} /> : <AlertTriangle size={19} />}
            <div>
              <strong>{faces.availability === "available" ? "Faces checked" : "Faces need review"}</strong>
              <span>{faces.message}</span>
              <small>Location only—no identity, age, or personal attributes inferred.</small>
            </div>
          </div>
          <div className={`ocr-status qr-status ${qr.availability}`}>
            {qr.availability === "available" ? <QrCode size={19} /> : <AlertTriangle size={19} />}
            <div>
              <strong>{qr.availability === "available" ? "QR codes checked" : "QR codes need review"}</strong>
              <span>{qr.message}</span>
              <small>Decoded payloads stay inside the local Rust core.</small>
            </div>
          </div>
          <div className={`ocr-status barcode-status ${barcodes.availability}`}>
            {barcodes.availability === "available" ? <Barcode size={19} /> : <AlertTriangle size={19} />}
            <div>
              <strong>{barcodes.availability === "available" ? "Barcodes checked" : "Barcodes need review"}</strong>
              <span>{barcodes.message}</span>
              <small>Only format and encoded character count are shown.</small>
            </div>
          </div>
          <div className="ocr-status metadata-status available">
            <Fingerprint size={19} />
            <div>
              <strong>Hidden metadata checked</strong>
              <span>{inspection.findings.length ? `${inspection.findings.length} removable metadata risk(s) found.` : "No removable location, device, identity, time, or description metadata found."}</span>
              <small>Metadata is always removed from the separate copy.</small>
            </div>
          </div>
        </div>

        <div className="image-review-layout">
          <aside className="image-preview-card">
            <div className="image-preview-frame">
              <div className="image-overlay-wrap">
                <img src={session.previewDataUrl} alt="Selected image preview" />
                <div className="redaction-overlay" aria-hidden="true">
                  {visualFindings.flatMap((finding, findingIndex) => finding.rectangles.map((rect, rectIndex) => (
                    <span
                      className={`redaction-region ${finding.type}-region ${decisions[finding.id]?.enabled === false ? "excluded" : "selected"}`}
                      key={`${finding.id}-${rectIndex}`}
                      style={{
                        left: `${(rect.x / imageWidth) * 100}%`,
                        top: `${(rect.y / imageHeight) * 100}%`,
                        width: `${(rect.width / imageWidth) * 100}%`,
                        height: `${(rect.height / imageHeight) * 100}%`,
                      }}
                    >
                      <b>{findingIndex + 1}</b>
                    </span>
                  )))}
                </div>
              </div>
            </div>
            <div className="image-preview-meta">
              <strong>{session.filename}</strong>
              <span>{session.sourceKind === "clipboard" ? "Pasted screenshot" : "Selected file"} · {inspection.format.toUpperCase()} · {inspection.width} × {inspection.height}</span>
            </div>
            <div className="pixel-promise">
              <Check size={14} />
              {visualFindings.length ? "Selected regions will receive opaque coverage in a new PNG" : "No visual rewrite selected; metadata cleaning preserves pixels"}
            </div>
          </aside>

          <div className="image-findings-column">
            {!!textFindings.length && <div className="image-finding-section"><span>Visible text</span><b>{textFindings.length}</b></div>}
            {textFindings.map((finding) => {
              const selected = decisions[finding.id]?.enabled !== false;
              return (
                <article className={`metadata-card visual-finding severity-${finding.severity} ${selected ? "selected" : "excluded"}`} key={finding.id}>
                  <span className="metadata-icon"><ScanLine size={18} /></span>
                  <div>
                    <div className="metadata-heading">
                      <strong>{findingNumber.get(finding.id)}. {finding.label}</strong>
                      <span className={`severity-pill ${finding.severity}`}>{severityLabel[finding.severity]}</span>
                    </div>
                    <small>{visibleCategoryLabel[finding.category]} · {finding.rectangles.length} region{finding.rectangles.length === 1 ? "" : "s"}</small>
                    <p>{finding.explanation}</p>
                    <code>{finding.maskedValue}</code>
                    <span className="confidence-note">Confidence: not provided by Windows OCR</span>
                  </div>
                  <button
                    className={`visual-decision ${selected ? "selected" : ""}`}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setDecisions((current) => ({
                      ...current,
                      [finding.id]: { id: finding.id, enabled: !selected },
                    }))}
                  >
                    {selected && <Check size={12} />}
                    {selected ? "Redact" : "Keep"}
                  </button>
                </article>
              );
            })}

            {!!faceFindings.length && <div className="image-finding-section face-section"><span>Faces</span><b>{faceFindings.length}</b></div>}
            {faceFindings.map((finding) => {
              const selected = decisions[finding.id]?.enabled !== false;
              return (
                <article className={`metadata-card visual-finding face-finding severity-${finding.severity} ${selected ? "selected" : "excluded"}`} key={finding.id}>
                  <span className="metadata-icon"><ScanFace size={18} /></span>
                  <div>
                    <div className="metadata-heading">
                      <strong>{findingNumber.get(finding.id)}. {finding.label}</strong>
                      <span className={`severity-pill ${finding.severity}`}>{severityLabel[finding.severity]}</span>
                    </div>
                    <small>Visible identity cue · location only</small>
                    <p>{finding.explanation}</p>
                    <code>Face region · crop not stored</code>
                    <span className="confidence-note">No identity, age, emotion, or personal attributes inferred</span>
                  </div>
                  <button
                    className={`visual-decision ${selected ? "selected" : ""}`}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setDecisions((current) => ({
                      ...current,
                      [finding.id]: { id: finding.id, enabled: !selected },
                    }))}
                  >
                    {selected && <Check size={12} />}
                    {selected ? "Redact" : "Keep"}
                  </button>
                </article>
              );
            })}

            {!!qrFindings.length && <div className="image-finding-section qr-section"><span>QR codes</span><b>{qrFindings.length}</b></div>}
            {qrFindings.map((finding) => {
              const selected = decisions[finding.id]?.enabled !== false;
              return (
                <article className={`metadata-card visual-finding qr-finding severity-${finding.severity} ${selected ? "selected" : "excluded"}`} key={finding.id}>
                  <span className="metadata-icon"><QrCode size={18} /></span>
                  <div>
                    <div className="metadata-heading">
                      <strong>{findingNumber.get(finding.id)}. {finding.label}</strong>
                      <span className={`severity-pill ${finding.severity}`}>{severityLabel[finding.severity]}</span>
                    </div>
                    <small>Machine-readable region · payload hidden</small>
                    <p>{finding.explanation}</p>
                    <code>{finding.maskedValue}</code>
                    <span className="confidence-note">Content never leaves the local Rust scanner</span>
                  </div>
                  <button
                    className={`visual-decision ${selected ? "selected" : ""}`}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setDecisions((current) => ({
                      ...current,
                      [finding.id]: { id: finding.id, enabled: !selected },
                    }))}
                  >
                    {selected && <Check size={12} />}
                    {selected ? "Redact" : "Keep"}
                  </button>
                </article>
              );
            })}

            {!!barcodeFindings.length && <div className="image-finding-section barcode-section"><span>One-dimensional barcodes</span><b>{barcodeFindings.length}</b></div>}
            {barcodeFindings.map((finding) => {
              const selected = decisions[finding.id]?.enabled !== false;
              return (
                <article className={`metadata-card visual-finding barcode-finding severity-${finding.severity} ${selected ? "selected" : "excluded"}`} key={finding.id}>
                  <span className="metadata-icon"><Barcode size={18} /></span>
                  <div>
                    <div className="metadata-heading">
                      <strong>{findingNumber.get(finding.id)}. {finding.label}</strong>
                      <span className={`severity-pill ${finding.severity}`}>{severityLabel[finding.severity]}</span>
                    </div>
                    <small>Machine-readable region · payload hidden</small>
                    <p>{finding.explanation}</p>
                    <code>{finding.maskedValue}</code>
                    <span className="confidence-note">No checksum digit, prefix, suffix, or partial payload is shown</span>
                  </div>
                  <button
                    className={`visual-decision ${selected ? "selected" : ""}`}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setDecisions((current) => ({
                      ...current,
                      [finding.id]: { id: finding.id, enabled: !selected },
                    }))}
                  >
                    {selected && <Check size={12} />}
                    {selected ? "Redact" : "Keep"}
                  </button>
                </article>
              );
            })}

            {!!inspection.findings.length && <div className="image-finding-section metadata-section"><span>Hidden metadata</span><b>{inspection.findings.length}</b></div>}
            {inspection.findings.map((finding) => {
              const meta = categoryMeta[finding.category];
              const Icon = meta.icon;
              return (
                <article className={`metadata-card severity-${finding.severity}`} key={finding.id}>
                  <span className="metadata-icon"><Icon size={18} /></span>
                  <div>
                    <div className="metadata-heading">
                      <strong>{finding.label}</strong>
                      <span className={`severity-pill ${finding.severity}`}>{severityLabel[finding.severity]}</span>
                    </div>
                    <small>{meta.label}</small>
                    <p>{finding.explanation}</p>
                    <code>{finding.maskedValue}</code>
                  </div>
                  <span className="remove-tag"><Check size={12} /> Remove</span>
                </article>
              );
            })}

            {!totalFindings && (
              <div className="empty-findings compact">
                <ShieldCheck size={28} />
                <strong>No supported risks detected</strong>
                <p>The saved copy will still be checked again. Text, face, QR, barcode, and metadata detectors can miss unusual content, so read the image once before sharing.</p>
              </div>
            )}

            <div className="image-clean-bar">
              <div><strong>{inspection.findings.length + selectedVisualCount}</strong><span>risk{inspection.findings.length + selectedVisualCount === 1 ? "" : "s"} selected for removal</span></div>
              <button
                className="primary-button"
                type="button"
                disabled={busy || !inspection.canCleanLosslessly}
                onClick={() => void createCleanCopy()}
              >
                {busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}
                {visualFindings.length ? "Redact, save & verify" : "Clean, save & verify"}
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (stage === "result" && result) {
    const passed = result.verification.status === "verified";
    const exceptions = result.verification.status === "cleanedWithExceptions";
    return (
      <section className="stage-view result-stage image-result-stage">
        <div className={`result-hero status-${result.verification.status}`}>
          <div className="result-seal">{passed ? <CheckCircle2 size={42} /> : <AlertTriangle size={42} />}</div>
          <div>
            <div className="eyebrow">Image verification complete</div>
            <h1>{passed ? "Clean image verified." : exceptions ? "Saved with exceptions." : "The image needs review."}</h1>
            <p>{result.verification.message}</p>
          </div>
          <div className="verification-ticket">
            <span>VEILSEND CHECK</span>
            <strong>{passed ? "PASSED" : "REVIEW"}</strong>
            <small>{remainingRiskCount(result)} supported risks remain</small>
          </div>
        </div>

        <div className="cleaned-image-card">
          <div className="cleaned-image-preview"><img src={result.previewDataUrl} alt="Cleaned image preview" /></div>
          <div className="cleaned-image-details">
            <div className="file-identity">
              <span><ImageIcon size={18} /></span>
              <div><strong>{result.filename}</strong><small>Separate clean copy · {formatBytes(result.cleanedSize)}</small></div>
            </div>
            <div className="verification-facts">
              <div><CheckCircle2 size={18} /><span><strong>{result.redactedTextFindings}</strong> visible-text risks redacted</span></div>
              <div><CheckCircle2 size={18} /><span><strong>{result.redactedFaceFindings}</strong> face regions redacted</span></div>
              <div><CheckCircle2 size={18} /><span><strong>{result.redactedQrFindings}</strong> QR risks redacted</span></div>
              <div><CheckCircle2 size={18} /><span><strong>{result.redactedBarcodeFindings}</strong> barcode risks redacted</span></div>
              <div><CheckCircle2 size={18} /><span><strong>{result.removedMetadataFindings}</strong> metadata risks removed</span></div>
              <div className={result.verification.ocrChecked ? "" : "fact-review"}>
                {result.verification.ocrChecked ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                <span><strong>{result.verification.ocrChecked ? "Complete" : "Review"}</strong> saved-file OCR check</span>
              </div>
              <div className={result.verification.qrChecked ? "" : "fact-review"}>
                {result.verification.qrChecked ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                <span><strong>{result.verification.qrChecked ? "Complete" : "Review"}</strong> saved-file QR check</span>
              </div>
              <div className={result.verification.faceChecked ? "" : "fact-review"}>
                {result.verification.faceChecked ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                <span><strong>{result.verification.faceChecked ? "Complete" : "Review"}</strong> saved-file face check</span>
              </div>
              <div className={result.verification.barcodeChecked ? "" : "fact-review"}>
                {result.verification.barcodeChecked ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                <span><strong>{result.verification.barcodeChecked ? "Complete" : "Review"}</strong> saved-file barcode check</span>
              </div>
              <div className={remainingRiskCount(result) ? "fact-review remaining-risk-fact" : "remaining-risk-fact"}>
                {remainingRiskCount(result) ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                <span><strong>{remainingRiskCount(result)}</strong> remain · metadata {result.verification.metadataRemaining}, text {result.verification.visualFindingsRemaining}, faces {result.verification.facesRemaining}, QR {result.verification.qrCodesRemaining}, barcodes {result.verification.barcodesRemaining}</span>
              </div>
              <div><CheckCircle2 size={18} /><span><strong>{result.redactedFindings ? "Rewritten" : result.verification.pixelsUnchanged ? "Exact" : "Changed"}</strong> output pixels</span></div>
            </div>
            {result.exceptions > 0 && <div className="exception-result"><AlertTriangle size={14} /> {result.exceptions} visual finding{result.exceptions === 1 ? " was" : "s were"} deliberately kept.</div>}
            <div className="saved-path"><Check size={14} /> Saved to {result.savedPath}</div>
          </div>
        </div>

        <div className="result-footer">
          <button className="text-button" type="button" onClick={() => void startAgain()}><RefreshCcw size={15} /> Check another image</button>
          <p><AlertTriangle size={14} /> Text, face, QR, barcode, and metadata checks reduce accidental exposure; they cannot prove an image is safe.</p>
        </div>
      </section>
    );
  }

  return null;
}
