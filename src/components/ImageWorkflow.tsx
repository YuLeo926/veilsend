import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  Clock3,
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
  ScanLine,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { cleanImageFile, isDesktop, pickImage } from "../lib/bridge";
import type {
  Category,
  CleanedImageFile,
  ImageMetadataCategory,
  ImageSession,
  ImageRedactionDecision,
  Severity,
} from "../lib/types";
import { InputModeTabs } from "./InputModeTabs";

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
  return "ShareGate could not process that image. The original was not changed.";
}

export function ImageWorkflow({
  stage,
  onStageChange,
  onSwitchToText,
  onError,
}: {
  stage: Stage;
  onStageChange: (stage: Stage) => void;
  onSwitchToText: () => void;
  onError: (message: string) => void;
}) {
  const [session, setSession] = useState<ImageSession | null>(null);
  const [result, setResult] = useState<CleanedImageFile | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ImageRedactionDecision>>({});
  const [busy, setBusy] = useState(false);

  const textFindings = session?.ocr.report?.findings ?? [];
  const qrFindings = session?.qr.report?.findings ?? [];
  const visualFindings = useMemo(
    () => [
      ...textFindings.map((finding) => ({ id: finding.id, rectangles: finding.rectangles, type: "text" as const })),
      ...qrFindings.map((finding) => ({ id: finding.id, rectangles: [finding.rectangle], type: "qr" as const })),
    ],
    [qrFindings, textFindings],
  );
  const selectedVisualCount = useMemo(
    () => visualFindings.filter((finding) => decisions[finding.id]?.enabled !== false).length,
    [decisions, visualFindings],
  );

  async function chooseImage() {
    setBusy(true);
    onError("");
    try {
      const nextSession = await pickImage();
      if (!nextSession) return;
      setSession(nextSession);
      setDecisions(Object.fromEntries(
        [
          ...(nextSession.ocr.report?.findings ?? []),
          ...(nextSession.qr.report?.findings ?? []),
        ].map((finding) => [finding.id, {
          id: finding.id,
          enabled: true,
        }]),
      ));
      setResult(null);
      onStageChange("review");
    } catch (error) {
      onError(readableError(error));
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
        session.sourcePath,
        session.sourceFingerprint,
        Object.values(decisions),
      );
      if (!nextResult) return;
      setResult(nextResult);
      onStageChange("result");
    } catch (error) {
      onError(readableError(error));
    } finally {
      setBusy(false);
    }
  }

  function startAgain() {
    setSession(null);
    setResult(null);
    setDecisions({});
    onError("");
    onStageChange("add");
  }

  if (stage === "add") {
    return (
      <section className="stage-view add-stage image-add-stage">
        <InputModeTabs active="image" onChange={(mode) => mode === "text" && onSwitchToText()} />
        <div className="eyebrow"><Fingerprint size={15} /> Visible text + QR + hidden metadata</div>
        <h1>Find what the image<br />should not reveal.</h1>
        <p className="lead">Choose a JPEG or PNG. ShareGate checks visible credentials, QR codes, location, device identity, time, and hidden image metadata—all locally.</p>

        <div className="image-picker-card">
          <div className="image-picker-visual" aria-hidden="true">
            <div className="photo-sheet photo-sheet-back" />
            <div className="photo-sheet">
              <ImageIcon size={44} />
              <span>OCR</span><span>QR</span><span>EXIF</span>
            </div>
            <div className="metadata-sweep"><ShieldCheck size={28} /></div>
          </div>
          <div className="image-picker-copy">
            <span className="local-label"><LockKeyhole size={14} /> Opened and scanned locally</span>
            <h2>Inspect one image</h2>
            <p>JPEG or PNG, up to 25 MB. The original is never overwritten. Visible redactions are exported as a new PNG; metadata-only cleaning preserves the encoded pixel stream.</p>
            <button
              className="primary-button image-choose-button"
              type="button"
              disabled={busy || !isDesktop()}
              onClick={() => void chooseImage()}
            >
              {busy ? <LoaderCircle className="spin" size={18} /> : <FolderOpen size={18} />}
              Choose image
            </button>
            {!isDesktop() && <div className="desktop-only-note">Image checks and cleaning run in the Windows desktop app. The browser preview keeps this control disabled.</div>}
          </div>
        </div>

        <div className="trust-row">
          <span><LockKeyhole size={15} /> No upload</span>
          <span><ScanLine size={15} /> Windows OCR on-device</span>
          <span><QrCode size={15} /> QR decoded locally</span>
          <span><RefreshCcw size={15} /> Saved copy rechecked</span>
        </div>
      </section>
    );
  }

  if (stage === "review" && session) {
    const { inspection, ocr, qr } = session;
    const totalFindings = inspection.findings.length + visualFindings.length;
    const imageWidth = inspection.width ?? 1;
    const imageHeight = inspection.height ?? 1;

    return (
      <section className="stage-view review-stage image-review-stage">
        <button className="back-button" type="button" onClick={() => onStageChange("add")}><ArrowLeft size={16} /> Choose a different image</button>
        <div className="review-heading">
          <div>
            <div className="eyebrow"><ScanLine size={15} /> Image safety review</div>
            <h1>{totalFindings ? `${totalFindings} risk${totalFindings === 1 ? "" : "s"} found.` : "No supported risks found."}</h1>
            <p>{totalFindings ? "Visible-text and QR regions are selected for irreversible pixel redaction. Hidden metadata is always removed from the separate copy." : "ShareGate can still make a separate copy and repeat all three checks before reporting a result."}</p>
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

        <div className={`ocr-status ${ocr.availability}`}>
          {ocr.availability === "available" ? <ScanLine size={19} /> : <AlertTriangle size={19} />}
          <div>
            <strong>{ocr.availability === "available" ? "Local visible-text check complete" : "Visible text needs manual review"}</strong>
            <span>{ocr.message}</span>
            {ocr.report && <small>{ocr.report.language ?? "System language"} · Confidence score unavailable from Windows OCR</small>}
          </div>
        </div>

        <div className={`ocr-status qr-status ${qr.availability}`}>
          {qr.availability === "available" ? <QrCode size={19} /> : <AlertTriangle size={19} />}
          <div>
            <strong>{qr.availability === "available" ? "Local QR check complete" : "QR codes need manual review"}</strong>
            <span>{qr.message}</span>
            <small>Decoded payloads stay inside the Rust core and are never shown in the interface.</small>
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
                      className={`redaction-region ${finding.type === "qr" ? "qr-region" : ""} ${decisions[finding.id]?.enabled === false ? "excluded" : "selected"}`}
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
              <span>{inspection.format.toUpperCase()} · {inspection.width} × {inspection.height}</span>
            </div>
            <div className="pixel-promise">
              <Check size={14} />
              {visualFindings.length ? "Selected regions will be rewritten in a new PNG" : "Encoded pixels remain byte-for-byte unchanged"}
            </div>
          </aside>

          <div className="image-findings-column">
            {!!textFindings.length && <div className="image-finding-section"><span>Visible text</span><b>{textFindings.length}</b></div>}
            {textFindings.map((finding, index) => {
              const selected = decisions[finding.id]?.enabled !== false;
              return (
                <article className={`metadata-card visual-finding severity-${finding.severity} ${selected ? "selected" : "excluded"}`} key={finding.id}>
                  <span className="metadata-icon"><ScanLine size={18} /></span>
                  <div>
                    <div className="metadata-heading">
                      <strong>{index + 1}. {finding.label}</strong>
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

            {!!qrFindings.length && <div className="image-finding-section qr-section"><span>QR codes</span><b>{qrFindings.length}</b></div>}
            {qrFindings.map((finding, index) => {
              const selected = decisions[finding.id]?.enabled !== false;
              return (
                <article className={`metadata-card visual-finding qr-finding severity-${finding.severity} ${selected ? "selected" : "excluded"}`} key={finding.id}>
                  <span className="metadata-icon"><QrCode size={18} /></span>
                  <div>
                    <div className="metadata-heading">
                      <strong>{textFindings.length + index + 1}. {finding.label}</strong>
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
                <p>The saved copy will still be checked again. OCR, QR, and metadata coverage is limited, so read the image once before sharing.</p>
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
            <span>SHAREGATE CHECK</span>
            <strong>{passed ? "PASSED" : "REVIEW"}</strong>
            <small>{result.verification.metadataRemaining + result.verification.visualFindingsRemaining + result.verification.qrCodesRemaining} supported risks remain</small>
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
              <div><CheckCircle2 size={18} /><span><strong>{result.redactedQrFindings}</strong> QR risks redacted</span></div>
              <div><CheckCircle2 size={18} /><span><strong>{result.removedMetadataFindings}</strong> metadata risks removed</span></div>
              <div className={result.verification.ocrChecked ? "" : "fact-review"}>
                {result.verification.ocrChecked ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                <span><strong>{result.verification.ocrChecked ? "Complete" : "Review"}</strong> saved-file OCR check</span>
              </div>
              <div className={result.verification.qrChecked ? "" : "fact-review"}>
                {result.verification.qrChecked ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                <span><strong>{result.verification.qrChecked ? "Complete" : "Review"}</strong> saved-file QR check</span>
              </div>
              <div><CheckCircle2 size={18} /><span><strong>{result.redactedFindings ? "Rewritten" : result.verification.pixelsUnchanged ? "Exact" : "Changed"}</strong> output pixels</span></div>
            </div>
            {result.exceptions > 0 && <div className="exception-result"><AlertTriangle size={14} /> {result.exceptions} visual finding{result.exceptions === 1 ? " was" : "s were"} deliberately kept.</div>}
            <div className="saved-path"><Check size={14} /> Saved to {result.savedPath}</div>
          </div>
        </div>

        <div className="result-footer">
          <button className="text-button" type="button" onClick={startAgain}><RefreshCcw size={15} /> Check another image</button>
          <p><AlertTriangle size={14} /> OCR, QR, and metadata checks reduce accidental exposure; they cannot prove an image contains no sensitive information.</p>
        </div>
      </section>
    );
  }

  return null;
}
