import { useEffect, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Barcode,
  Check,
  CheckCircle2,
  FileCheck2,
  FileStack,
  FolderOpen,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  MousePointer2,
  QrCode,
  RefreshCcw,
  ScanFace,
  ScanLine,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  cleanPdfFile,
  clearPdfSession,
  getPdfPagePreview,
  isDesktop,
  pickPdf,
} from "../lib/bridge";
import {
  buildPdfDefaultDecisions,
  buildPdfFindings,
  buildPdfPageFindings,
  pageChecksComplete,
  remainingPdfRiskCount,
  type PdfFindingKind,
} from "../lib/pdfWorkflowModel";
import type {
  CleanedPdfFile,
  ImageRedactionDecision,
  NormalizedRect,
  PdfManualRegion,
  PdfPagePreview,
  PdfSession,
  Severity,
} from "../lib/types";
import { InputModeTabs, type InputMode } from "./InputModeTabs";

type Stage = "add" | "review" | "result";
type DrawDraft = { originX: number; originY: number; rectangle: NormalizedRect };

const severityLabel: Record<Severity, string> = {
  low: "Notice",
  medium: "Review",
  high: "High risk",
  critical: "Critical",
};

const findingMeta: Record<PdfFindingKind, { label: string; icon: typeof ScanLine }> = {
  text: { label: "Visible text", icon: ScanLine },
  face: { label: "Face region", icon: ScanFace },
  qr: { label: "QR code", icon: QrCode },
  barcode: { label: "Barcode", icon: Barcode },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readableError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return "ShareGate could not process that PDF. The original was not changed.";
}

function pointInPage(event: ReactPointerEvent<HTMLDivElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
  };
}

function rectangleFrom(originX: number, originY: number, x: number, y: number): NormalizedRect {
  return {
    x: Math.min(originX, x),
    y: Math.min(originY, y),
    width: Math.abs(x - originX),
    height: Math.abs(y - originY),
  };
}

export function PdfWorkflow({
  stage,
  onStageChange,
  onSwitchMode,
  onError,
}: {
  stage: Stage;
  onStageChange: (stage: Stage) => void;
  onSwitchMode: (mode: Exclude<InputMode, "pdf">) => void;
  onError: (message: string) => void;
}) {
  const [session, setSession] = useState<PdfSession | null>(null);
  const [result, setResult] = useState<CleanedPdfFile | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ImageRedactionDecision>>({});
  const [manualRegions, setManualRegions] = useState<PdfManualRegion[]>([]);
  const [selectedPage, setSelectedPage] = useState(0);
  const [preview, setPreview] = useState<PdfPagePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [draft, setDraft] = useState<DrawDraft | null>(null);

  const allFindings = useMemo(() => session ? buildPdfFindings(session) : [], [session]);
  const currentPage = session?.pages[selectedPage] ?? null;
  const pageFindings = useMemo(
    () => currentPage ? buildPdfPageFindings(currentPage) : [],
    [currentPage],
  );
  const currentManual = useMemo(
    () => manualRegions.filter((region) => region.pageIndex === selectedPage),
    [manualRegions, selectedPage],
  );
  const selectedFindings = allFindings.filter(
    (finding) => decisions[finding.id]?.enabled !== false,
  ).length;
  const exceptions = allFindings.length - selectedFindings;

  useEffect(() => {
    if (!session || stage !== "review") return;
    let active = true;
    setPreviewBusy(true);
    setPreview(null);
    void getPdfPagePreview(session.sessionId, selectedPage)
      .then((nextPreview) => {
        if (active) setPreview(nextPreview);
      })
      .catch((error) => {
        if (active) onError(readableError(error));
      })
      .finally(() => {
        if (active) setPreviewBusy(false);
      });
    return () => { active = false; };
  }, [onError, selectedPage, session, stage]);

  async function clearCurrentSession() {
    if (session) await clearPdfSession();
    setSession(null);
    setPreview(null);
    setDecisions({});
    setManualRegions([]);
    setDraft(null);
    setDrawMode(false);
  }

  async function choosePdf() {
    setBusy(true);
    onError("");
    try {
      await clearCurrentSession();
      const nextSession = await pickPdf();
      if (!nextSession) return;
      setSession(nextSession);
      setDecisions(buildPdfDefaultDecisions(nextSession));
      setSelectedPage(0);
      setResult(null);
      onStageChange("review");
    } catch (error) {
      onError(readableError(error));
    } finally {
      setBusy(false);
    }
  }

  async function createSafetyCopy() {
    if (!session) return;
    setBusy(true);
    onError("");
    try {
      const nextResult = await cleanPdfFile(
        session.sessionId,
        Object.values(decisions),
        manualRegions,
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

  async function startAgain() {
    let clearError = "";
    try {
      await clearCurrentSession();
    } catch (error) {
      clearError = readableError(error);
    } finally {
      setResult(null);
      onError(clearError);
      onStageChange("add");
    }
  }

  async function switchInputMode(mode: Exclude<InputMode, "pdf">) {
    try {
      await clearCurrentSession();
      onError("");
    } catch (error) {
      onError(readableError(error));
    } finally {
      onSwitchMode(mode);
    }
  }

  function beginDraw(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drawMode || event.button !== 0) return;
    const point = pointInPage(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft({
      originX: point.x,
      originY: point.y,
      rectangle: { x: point.x, y: point.y, width: 0, height: 0 },
    });
  }

  function updateDraw(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draft || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const point = pointInPage(event);
    setDraft((current) => current ? {
      ...current,
      rectangle: rectangleFrom(current.originX, current.originY, point.x, point.y),
    } : null);
  }

  function finishDraw(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draft) return;
    const point = pointInPage(event);
    const rectangle = rectangleFrom(draft.originX, draft.originY, point.x, point.y);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraft(null);
    if (rectangle.width < 0.003 || rectangle.height < 0.003) return;
    const id = globalThis.crypto?.randomUUID?.()
      ?? `region-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setManualRegions((current) => [...current, { id, pageIndex: selectedPage, rectangle }]);
  }

  if (stage === "add") {
    return (
      <section className="stage-view add-stage pdf-add-stage">
        <InputModeTabs active="pdf" onChange={(mode) => mode !== "pdf" && void switchInputMode(mode)} />
        <div className="eyebrow"><Layers3 size={15} /> Flattened document safety</div>
        <h1>Turn a PDF into<br />pixels you can trust.</h1>
        <p className="lead">Choose a local PDF. ShareGate reviews every page, lets you cover anything the detectors miss, then rebuilds a separate image-only PDF with no searchable or editable text layer.</p>

        <div className="pdf-picker-card">
          <div className="pdf-picker-visual" aria-hidden="true">
            <div className="document-sheet document-sheet-back" />
            <div className="document-sheet">
              <span className="document-lines" />
              <span className="document-redaction one" />
              <span className="document-redaction two" />
              <FileStack size={38} />
            </div>
            <div className="flatten-stamp">PIXELS<br />ONLY</div>
          </div>
          <div className="image-picker-copy">
            <span className="local-label"><LockKeyhole size={14} /> Rendered in memory on this PC</span>
            <h2>Inspect one PDF</h2>
            <p>Unencrypted PDF, up to 50 MB and 50 pages. Pages are rendered locally at a fixed resolution. The original is never overwritten and no page image is written to a temporary file.</p>
            <button
              className="primary-button pdf-choose-button"
              type="button"
              disabled={busy || !isDesktop()}
              onClick={() => void choosePdf()}
            >
              {busy ? <LoaderCircle className="spin" size={18} /> : <FolderOpen size={18} />}
              Choose PDF
            </button>
            {!isDesktop() && <div className="desktop-only-note">PDF rendering and flattening use the Windows desktop engine. The browser preview keeps this control disabled.</div>}
          </div>
        </div>

        <div className="trust-row">
          <span><LockKeyhole size={15} /> No upload</span>
          <span><FileStack size={15} /> Image-only pages</span>
          <span><MousePointer2 size={15} /> Manual cover tool</span>
          <span><RefreshCcw size={15} /> Saved PDF rechecked</span>
        </div>
      </section>
    );
  }

  if (stage === "review" && session && currentPage) {
    const displayedPreview = preview?.pageIndex === selectedPage
      ? preview.previewDataUrl
      : currentPage.thumbnailDataUrl;
    const findingsPerPage = new Map(
      session.pages.map((page) => [page.pageIndex, buildPdfPageFindings(page).length]),
    );
    return (
      <section className="stage-view review-stage pdf-review-stage">
        <button className="back-button" type="button" onClick={() => onStageChange("add")}><ArrowLeft size={16} /> Choose a different PDF</button>
        <div className="review-heading">
          <div>
            <div className="eyebrow"><FileStack size={15} /> PDF page review</div>
            <h1>{allFindings.length ? `${allFindings.length} risk${allFindings.length === 1 ? "" : "s"} across ${session.pageCount} page${session.pageCount === 1 ? "" : "s"}.` : `${session.pageCount} page${session.pageCount === 1 ? "" : "s"} ready for visual review.`}</h1>
            <p>Automatic findings start covered. Check each page, add manual covers where needed, then save a separate flattened PDF.</p>
          </div>
          <div className="scan-receipt">
            <span>PDF RECEIPT</span>
            <strong>{session.pageCount} pages</strong>
            <small>{formatBytes(session.bytes)} · 144 DPI</small>
          </div>
        </div>

        {session.warnings.map((warning) => (
          <div className="orientation-warning" key={warning}>
            <AlertTriangle size={19} />
            <div><strong>One or more local checks need review</strong><span>{warning}</span></div>
          </div>
        ))}

        <div className="pdf-review-workbench">
          <aside className="pdf-page-rail" aria-label="PDF pages">
            <div className="pdf-rail-heading"><span>Pages</span><b>{session.pageCount}</b></div>
            <div className="pdf-thumbnail-list">
              {session.pages.map((page) => {
                const pageManual = manualRegions.filter((region) => region.pageIndex === page.pageIndex).length;
                const pageRisks = findingsPerPage.get(page.pageIndex) ?? 0;
                return (
                  <button
                    className={page.pageIndex === selectedPage ? "selected" : ""}
                    type="button"
                    key={page.pageIndex}
                    onClick={() => { setSelectedPage(page.pageIndex); setDraft(null); }}
                    aria-label={`Open page ${page.pageIndex + 1}`}
                  >
                    <span className="pdf-thumb-paper"><img src={page.thumbnailDataUrl} alt="" /></span>
                    <span className="pdf-thumb-meta"><strong>{page.pageIndex + 1}</strong><small>{pageRisks + pageManual ? `${pageRisks + pageManual} cover${pageRisks + pageManual === 1 ? "" : "s"}` : "Reviewed"}</small></span>
                    {!pageChecksComplete(page) && <AlertTriangle size={13} />}
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="pdf-page-stage">
            <div className="pdf-stage-toolbar">
              <div><strong>Page {selectedPage + 1}</strong><span>{Math.round(currentPage.widthPoints)} × {Math.round(currentPage.heightPoints)} pt</span></div>
              <button
                className={`manual-cover-toggle ${drawMode ? "active" : ""}`}
                type="button"
                aria-pressed={drawMode}
                onClick={() => { setDrawMode((current) => !current); setDraft(null); }}
              >
                <MousePointer2 size={15} /> {drawMode ? "Drawing covers" : "Add manual cover"}
              </button>
            </div>
            <div className={`pdf-canvas ${drawMode ? "drawing" : ""}`}>
              {previewBusy && <div className="pdf-preview-loading"><LoaderCircle className="spin" size={21} /> Rendering page locally…</div>}
              <div className="pdf-page-wrap">
                <img src={displayedPreview} alt={`PDF page ${selectedPage + 1}`} draggable={false} />
                <div
                  className="pdf-draw-layer"
                  onPointerDown={beginDraw}
                  onPointerMove={updateDraw}
                  onPointerUp={finishDraw}
                  onPointerCancel={() => setDraft(null)}
                >
                  {pageFindings.flatMap((finding, findingIndex) => finding.rectangles.map((rect, rectangleIndex) => (
                    <span
                      className={`redaction-region ${finding.kind}-region ${decisions[finding.id]?.enabled === false ? "excluded" : "selected"}`}
                      key={`${finding.id}-${rectangleIndex}`}
                      style={{
                        left: `${(rect.x / currentPage.widthPixels) * 100}%`,
                        top: `${(rect.y / currentPage.heightPixels) * 100}%`,
                        width: `${(rect.width / currentPage.widthPixels) * 100}%`,
                        height: `${(rect.height / currentPage.heightPixels) * 100}%`,
                      }}
                    ><b>{findingIndex + 1}</b></span>
                  )))}
                  {currentManual.map((region, index) => (
                    <span
                      className="pdf-manual-region"
                      key={region.id}
                      style={{
                        left: `${region.rectangle.x * 100}%`,
                        top: `${region.rectangle.y * 100}%`,
                        width: `${region.rectangle.width * 100}%`,
                        height: `${region.rectangle.height * 100}%`,
                      }}
                    ><b>M{index + 1}</b></span>
                  ))}
                  {draft && <span
                    className="pdf-manual-region draft"
                    style={{
                      left: `${draft.rectangle.x * 100}%`,
                      top: `${draft.rectangle.y * 100}%`,
                      width: `${draft.rectangle.width * 100}%`,
                      height: `${draft.rectangle.height * 100}%`,
                    }}
                  />}
                </div>
              </div>
            </div>
            <div className="pdf-page-promise"><Check size={14} /> Every selected area becomes opaque pixels in the rebuilt page.</div>
          </div>

          <aside className="pdf-inspector">
            <div className="pdf-check-strip">
              {([
                ["Text", currentPage.ocr.availability === "available"],
                ["Face", currentPage.faces.availability === "available"],
                ["QR", currentPage.qr.availability === "available"],
                ["Barcode", currentPage.barcodes.availability === "available"],
              ] as const).map(([label, complete]) => (
                <span className={complete ? "complete" : "review"} key={label}>{complete ? <Check size={11} /> : <AlertTriangle size={11} />}{label}</span>
              ))}
            </div>
            <div className="pdf-inspector-heading"><span>Page findings</span><b>{pageFindings.length}</b></div>
            {pageFindings.map((finding, index) => {
              const selected = decisions[finding.id]?.enabled !== false;
              const meta = findingMeta[finding.kind];
              const Icon = meta.icon;
              return (
                <article className={`pdf-finding-card ${finding.kind}-finding ${selected ? "selected" : "excluded"}`} key={finding.id}>
                  <span className="pdf-finding-number">{index + 1}</span>
                  <span className="metadata-icon"><Icon size={16} /></span>
                  <div>
                    <div className="metadata-heading"><strong>{finding.label}</strong><span className={`severity-pill ${finding.severity}`}>{severityLabel[finding.severity]}</span></div>
                    <small>{meta.label} · {finding.rectangles.length} region{finding.rectangles.length === 1 ? "" : "s"}</small>
                    <p>{finding.explanation}</p>
                    <code>{finding.maskedValue}</code>
                  </div>
                  <button
                    className={`visual-decision ${selected ? "selected" : ""}`}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setDecisions((current) => ({
                      ...current,
                      [finding.id]: { id: finding.id, enabled: !selected },
                    }))}
                  >{selected && <Check size={12} />}{selected ? "Cover" : "Keep"}</button>
                </article>
              );
            })}
            {!pageFindings.length && <div className="pdf-empty-page"><ShieldCheck size={22} /><strong>No automatic findings</strong><span>Inspect the page and add a manual cover if needed.</span></div>}

            <div className="pdf-inspector-heading manual"><span>Manual covers</span><b>{currentManual.length}</b></div>
            {currentManual.map((region, index) => (
              <div className="manual-region-row" key={region.id}>
                <span>M{index + 1}</span><div><strong>Opaque cover</strong><small>{Math.round(region.rectangle.width * 100)}% × {Math.round(region.rectangle.height * 100)}% of page</small></div>
                <button type="button" onClick={() => setManualRegions((current) => current.filter((item) => item.id !== region.id))} aria-label={`Delete manual cover ${index + 1}`}><Trash2 size={14} /></button>
              </div>
            ))}
            {!currentManual.length && <p className="manual-cover-hint">Use “Add manual cover,” then drag over anything you do not want visible.</p>}
          </aside>
        </div>

        <div className="pdf-clean-bar">
          <div className="pdf-clean-counts">
            <strong>{selectedFindings + manualRegions.length}</strong><span>covers</span>
            <i />
            <strong>{exceptions}</strong><span>kept</span>
            <i />
            <strong>{session.pageCount}</strong><span>image pages</span>
          </div>
          <div className="pdf-clean-action">
            <small>Original stays untouched · output is not searchable</small>
            <button className="primary-button" type="button" disabled={busy} onClick={() => void createSafetyCopy()}>
              {busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}
              Flatten, save & verify
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (stage === "result" && result) {
    const passed = result.verification.status === "verified";
    const withExceptions = result.verification.status === "cleanedWithExceptions";
    const remaining = remainingPdfRiskCount(result);
    return (
      <section className="stage-view result-stage pdf-result-stage">
        <div className={`result-hero status-${result.verification.status}`}>
          <div className="result-seal">{passed ? <CheckCircle2 size={42} /> : <AlertTriangle size={42} />}</div>
          <div>
            <div className="eyebrow">Saved PDF verification complete</div>
            <h1>{passed ? "Flattened copy verified." : withExceptions ? "Flattened with exceptions." : "The PDF still needs review."}</h1>
            <p>{result.verification.message}</p>
          </div>
          <div className="verification-ticket">
            <span>IMAGE-ONLY PDF</span>
            <strong>{passed ? "PASSED" : "REVIEW"}</strong>
            <small>{result.pagesRebuilt} pages rebuilt</small>
          </div>
        </div>

        <div className="pdf-result-card">
          <div className="pdf-result-file">
            <span><FileCheck2 size={28} /></span>
            <div><strong>{result.filename}</strong><small>{formatBytes(result.cleanedSize)} · separate flattened copy</small></div>
            <em><Check size={13} /> Original unchanged</em>
          </div>
          <div className="pdf-result-grid">
            <div><strong>{result.pagesRebuilt}</strong><span>pages rebuilt as images</span></div>
            <div><strong>{result.redactedFindings}</strong><span>automatic findings covered</span></div>
            <div><strong>{result.manualRegions}</strong><span>manual covers applied</span></div>
            <div className={remaining ? "review" : ""}><strong>{remaining}</strong><span>unexpected risks remaining</span></div>
          </div>
          <div className="pdf-verification-ledger">
            <span className={result.verification.savedBytesMatch ? "checked" : "review"}>{result.verification.savedBytesMatch ? <Check size={13} /> : <AlertTriangle size={13} />} Saved bytes match</span>
            <span className={result.verification.pageCountMatch ? "checked" : "review"}>{result.verification.pageCountMatch ? <Check size={13} /> : <AlertTriangle size={13} />} Page count and sizes match</span>
            <span className={result.verification.ocrChecked && result.verification.faceChecked && result.verification.qrChecked && result.verification.barcodeChecked ? "checked" : "review"}><Check size={13} /> Saved pages re-rendered and checked</span>
          </div>
          {withExceptions && <div className="exception-result"><AlertTriangle size={15} /> {result.exceptions} explicit Keep exception{result.exceptions === 1 ? "" : "s"}; those regions are not claimed safe.</div>}
          <div className="saved-path"><Check size={14} /> Saved to {result.savedPath}</div>
        </div>

        <div className="result-footer">
          <button className="text-button" type="button" onClick={() => void startAgain()}><RefreshCcw size={15} /> Process another PDF</button>
          <p><AlertTriangle size={14} /> Flattening removes editable layers; visual detectors can still miss unusual content.</p>
        </div>
      </section>
    );
  }

  return null;
}
