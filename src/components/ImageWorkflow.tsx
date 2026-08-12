import { useState } from "react";
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
  RefreshCcw,
  ScanLine,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { cleanImageFile, isDesktop, pickImage } from "../lib/bridge";
import type {
  CleanedImageFile,
  ImageMetadataCategory,
  ImageSession,
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
  const [busy, setBusy] = useState(false);

  async function chooseImage() {
    setBusy(true);
    onError("");
    try {
      const nextSession = await pickImage();
      if (!nextSession) return;
      setSession(nextSession);
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
      const nextResult = await cleanImageFile(session.sourcePath);
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
    onError("");
    onStageChange("add");
  }

  if (stage === "add") {
    return (
      <section className="stage-view add-stage image-add-stage">
        <InputModeTabs active="image" onChange={(mode) => mode === "text" && onSwitchToText()} />
        <div className="eyebrow"><Fingerprint size={15} /> Image privacy metadata</div>
        <h1>Remove the details<br />pixels do not show.</h1>
        <p className="lead">Choose a JPEG or PNG. ShareGate finds location, device, identity, timestamp, and hidden text metadata before making a separate clean copy.</p>

        <div className="image-picker-card">
          <div className="image-picker-visual" aria-hidden="true">
            <div className="photo-sheet photo-sheet-back" />
            <div className="photo-sheet">
              <ImageIcon size={44} />
              <span>EXIF</span><span>GPS</span><span>XMP</span>
            </div>
            <div className="metadata-sweep"><ShieldCheck size={28} /></div>
          </div>
          <div className="image-picker-copy">
            <span className="local-label"><LockKeyhole size={14} /> Opened locally</span>
            <h2>Inspect one image</h2>
            <p>JPEG or PNG, up to 25 MB. Pixel data and colour profiles stay intact; the original file is never overwritten.</p>
            <button
              className="primary-button image-choose-button"
              type="button"
              disabled={busy || !isDesktop()}
              onClick={() => void chooseImage()}
            >
              {busy ? <LoaderCircle className="spin" size={18} /> : <FolderOpen size={18} />}
              Choose image
            </button>
            {!isDesktop() && <div className="desktop-only-note">Image cleaning runs in the desktop app. The browser preview keeps this control disabled.</div>}
          </div>
        </div>

        <div className="trust-row">
          <span><LockKeyhole size={15} /> No upload</span>
          <span><ImageIcon size={15} /> No pixel recompression</span>
          <span><RefreshCcw size={15} /> Saved copy is verified</span>
        </div>
      </section>
    );
  }

  if (stage === "review" && session) {
    const { inspection } = session;
    return (
      <section className="stage-view review-stage image-review-stage">
        <button className="back-button" type="button" onClick={() => onStageChange("add")}><ArrowLeft size={16} /> Choose a different image</button>
        <div className="review-heading">
          <div>
            <div className="eyebrow"><ScanLine size={15} /> Metadata review</div>
            <h1>{inspection.findings.length ? `${inspection.findings.length} hidden risk${inspection.findings.length === 1 ? "" : "s"} found.` : "No removable metadata found."}</h1>
            <p>{inspection.findings.length ? "These details travel inside the file even though they are not visible in the picture. ShareGate removes every listed block from a separate copy." : "ShareGate can still make a separately verified copy without changing the image pixels."}</p>
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

        <div className="image-review-layout">
          <aside className="image-preview-card">
            <div className="image-preview-frame"><img src={session.previewDataUrl} alt="Selected image preview" /></div>
            <div className="image-preview-meta">
              <strong>{session.filename}</strong>
              <span>{inspection.format.toUpperCase()} · {inspection.width} × {inspection.height}</span>
            </div>
            <div className="pixel-promise"><Check size={14} /> Pixels remain byte-for-byte unchanged</div>
          </aside>

          <div className="image-findings-column">
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
            {!inspection.findings.length && (
              <div className="empty-findings compact">
                <ShieldCheck size={28} />
                <strong>No metadata risks detected</strong>
                <p>This check covers EXIF, XMP, IPTC, comments, PNG text, and PNG timestamps.</p>
              </div>
            )}

            <div className="image-clean-bar">
              <div><strong>{inspection.findings.length}</strong><span>metadata risk{inspection.findings.length === 1 ? "" : "s"} will be removed</span></div>
              <button
                className="primary-button"
                type="button"
                disabled={busy || !inspection.canCleanLosslessly}
                onClick={() => void createCleanCopy()}
              >
                {busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}
                Clean, save & verify
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (stage === "result" && result) {
    return (
      <section className="stage-view result-stage image-result-stage">
        <div className={`result-hero ${result.verification.verified ? "" : "status-needsReview"}`}>
          <div className="result-seal">{result.verification.verified ? <CheckCircle2 size={42} /> : <AlertTriangle size={42} />}</div>
          <div>
            <div className="eyebrow">Image verification complete</div>
            <h1>{result.verification.verified ? "Clean image verified." : "The image needs review."}</h1>
            <p>{result.verification.message}</p>
          </div>
          <div className="verification-ticket">
            <span>SHAREGATE CHECK</span>
            <strong>{result.verification.verified ? "PASSED" : "REVIEW"}</strong>
            <small>{result.verification.remainingFindings} metadata risks remain</small>
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
              <div><CheckCircle2 size={18} /><span><strong>{result.removedFindings}</strong> risks removed</span></div>
              <div><CheckCircle2 size={18} /><span><strong>0</strong> metadata matches</span></div>
              <div><CheckCircle2 size={18} /><span><strong>{result.verification.pixelsUnchanged ? "Exact" : "Changed"}</strong> pixel stream</span></div>
            </div>
            <div className="saved-path"><Check size={14} /> Saved to {result.savedPath}</div>
          </div>
        </div>

        <div className="result-footer">
          <button className="text-button" type="button" onClick={startAgain}><RefreshCcw size={15} /> Check another image</button>
          <p><AlertTriangle size={14} /> Metadata cleaning does not inspect text visible inside the image yet.</p>
        </div>
      </section>
    );
  }

  return null;
}
