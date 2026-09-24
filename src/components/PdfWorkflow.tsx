import { useEffect, useMemo, useReducer, useRef, useState } from "react";
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
  Undo2,
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
  normalizedRectangleFromPoints,
  pageChecksComplete,
  remainingPdfRiskCount,
  resizeNormalizedRectangle,
  type PdfFindingKind,
} from "../lib/pdfWorkflowModel";
import { derivePdfDiagnostics, type DiagnosticErrorCode, type WorkflowDiagnostics } from "../lib/diagnostics";
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
type ResizeDraft = {
  id: string;
  startX: number;
  startY: number;
  initial: NormalizedRect;
};
type ManualEditState = {
  regions: PdfManualRegion[];
  history: PdfManualRegion[][];
};
type ManualEditAction =
  | { type: "commit"; update: (current: PdfManualRegion[]) => PdfManualRegion[] }
  | { type: "checkpoint" }
  | { type: "resize"; id: string; rectangle: NormalizedRect }
  | { type: "undo" }
  | { type: "reset" };

function manualEditReducer(
  state: ManualEditState,
  action: ManualEditAction,
): ManualEditState {
  switch (action.type) {
    case "commit": {
      const next = action.update(state.regions);
      if (next === state.regions) return state;
      return {
        regions: next,
        history: [...state.history, state.regions].slice(-50),
      };
    }
    case "checkpoint":
      return {
        ...state,
        history: [...state.history, state.regions].slice(-50),
      };
    case "resize":
      return {
        ...state,
        regions: state.regions.map((region) => region.id === action.id
          ? { ...region, rectangle: action.rectangle }
          : region),
      };
    case "undo": {
      const previous = state.history.at(-1);
      return previous
        ? { regions: previous, history: state.history.slice(0, -1) }
        : state;
    }
    case "reset":
      return { regions: [], history: [] };
  }
}

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
  return "VeilSend could not process that PDF. The original was not changed.";
}

function pointInPage(event: ReactPointerEvent<HTMLDivElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return pointInBounds(event.clientX, event.clientY, bounds);
}

function pointInBounds(clientX: number, clientY: number, bounds: DOMRect) {
  return {
    x: Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (clientY - bounds.top) / bounds.height)),
  };
}

export function PdfWorkflow({
  stage,
  onStageChange,
  onSwitchMode,
  onError,
  onDiagnosticsChange,
}: {
  stage: Stage;
  onStageChange: (stage: Stage) => void;
  onSwitchMode: (mode: Exclude<InputMode, "pdf">) => void;
  onError: (message: string, code?: DiagnosticErrorCode) => void;
  onDiagnosticsChange: (next: WorkflowDiagnostics) => void;
}) {
  const [session, setSession] = useState<PdfSession | null>(null);
  const [result, setResult] = useState<CleanedPdfFile | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ImageRedactionDecision>>({});
  const [manualEdits, dispatchManualEdit] = useReducer(manualEditReducer, {
    regions: [],
    history: [],
  });
  const manualRegions = manualEdits.regions;
  const manualHistory = manualEdits.history;
  const [selectedPage, setSelectedPage] = useState(0);
  const [preview, setPreview] = useState<PdfPagePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [draft, setDraft] = useState<DrawDraft | null>(null);
  const [resizeDraft, setResizeDraft] = useState<ResizeDraft | null>(null);
  const operationGeneration = useRef(0);

  useEffect(() => () => { operationGeneration.current += 1; }, []);

  useEffect(() => {
    onDiagnosticsChange(derivePdfDiagnostics({
      stage,
      inputBytes: stage === "add" ? null : session?.bytes ?? null,
      pageCount: stage === "add" ? null : session?.pageCount ?? null,
      pages: session?.pages.map((page) => ({
        textAvailability: page.ocr.availability,
        faceAvailability: page.faces.availability,
        qrAvailability: page.qr.availability,
        barcodeAvailability: page.barcodes.availability,
      })) ?? [],
      resultChecks: result ? {
        savedBytesMatch: result.verification.savedBytesMatch,
        pageCountMatch: result.verification.pageCountMatch,
        pagesRendered: result.verification.pagesRendered,
        pagesRebuilt: result.pagesRebuilt,
        text: result.verification.ocrChecked,
        face: result.verification.faceChecked,
        qr: result.verification.qrChecked,
        barcode: result.verification.barcodeChecked,
      } : null,
    }));
  }, [onDiagnosticsChange, result, session, stage]);

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
        if (active) onError(readableError(error), "workflowFailed");
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
    dispatchManualEdit({ type: "reset" });
    setDraft(null);
    setResizeDraft(null);
    setDrawMode(false);
  }

  async function choosePdf() {
    const token = ++operationGeneration.current;
    setBusy(true);
    onError("");
    try {
      await clearCurrentSession();
      const nextSession = await pickPdf();
      if (operationGeneration.current !== token) return;
      if (!nextSession) return;
      setSession(nextSession);
      setDecisions(buildPdfDefaultDecisions(nextSession));
      setSelectedPage(0);
      setResult(null);
      onStageChange("review");
    } catch (error) {
      if (operationGeneration.current !== token) return;
      onError(readableError(error), "inputRejected");
    } finally {
      if (operationGeneration.current === token) setBusy(false);
    }
  }

  async function createSafetyCopy() {
    if (!session || busy) return;
    const token = ++operationGeneration.current;
    setBusy(true);
    setDraft(null);
    setResizeDraft(null);
    setDrawMode(false);
    onError("");
    try {
      const nextResult = await cleanPdfFile(
        session.sessionId,
        Object.values(decisions),
        manualRegions,
      );
      if (operationGeneration.current !== token) return;
      if (!nextResult) return;
      setResult(nextResult);
      onStageChange("result");
    } catch (error) {
      if (operationGeneration.current !== token) return;
      onError(readableError(error), "workflowFailed");
    } finally {
      if (operationGeneration.current === token) setBusy(false);
    }
  }

  async function startAgain() {
    const token = ++operationGeneration.current;
    let clearError = "";
    try {
      await clearCurrentSession();
    } catch (error) {
      clearError = readableError(error);
    } finally {
      if (operationGeneration.current !== token) return;
      setResult(null);
      onError(clearError, clearError ? "workflowFailed" : "none");
      onStageChange("add");
    }
  }

  async function switchInputMode(mode: Exclude<InputMode, "pdf">) {
    const token = ++operationGeneration.current;
    try {
      await clearCurrentSession();
      onError("");
    } catch (error) {
      if (operationGeneration.current !== token) return;
      onError(readableError(error), "workflowFailed");
    } finally {
      if (operationGeneration.current !== token) return;
      onSwitchMode(mode);
    }
  }

  function beginDraw(event: ReactPointerEvent<HTMLDivElement>) {
    if (busy || !drawMode || event.button !== 0) return;
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
      rectangle: normalizedRectangleFromPoints(
        current.originX,
        current.originY,
        point.x,
        point.y,
      ),
    } : null);
  }

  function finishDraw(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draft) return;
    const point = pointInPage(event);
    const rectangle = normalizedRectangleFromPoints(
      draft.originX,
      draft.originY,
      point.x,
      point.y,
    );
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraft(null);
    if (rectangle.width < 0.003 || rectangle.height < 0.003) return;
    const id = globalThis.crypto?.randomUUID?.()
      ?? `region-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    updateManualRegions((current) => [...current, { id, pageIndex: selectedPage, rectangle }]);
  }

  function updateManualRegions(
    update: (current: PdfManualRegion[]) => PdfManualRegion[],
  ) {
    if (busy) return;
    dispatchManualEdit({ type: "commit", update });
  }

  function undoManualChange() {
    if (busy) return;
    dispatchManualEdit({ type: "undo" });
  }

  function beginResize(
    event: ReactPointerEvent<HTMLButtonElement>,
    region: PdfManualRegion,
  ) {
    if (busy) return;
    event.stopPropagation();
    const layer = event.currentTarget.closest(".pdf-draw-layer");
    if (!(layer instanceof HTMLElement)) return;
    const point = pointInBounds(event.clientX, event.clientY, layer.getBoundingClientRect());
    event.currentTarget.setPointerCapture(event.pointerId);
    dispatchManualEdit({ type: "checkpoint" });
    setResizeDraft({
      id: region.id,
      startX: point.x,
      startY: point.y,
      initial: region.rectangle,
    });
  }

  function updateResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (busy || !resizeDraft || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const layer = event.currentTarget.closest(".pdf-draw-layer");
    if (!(layer instanceof HTMLElement)) return;
    const point = pointInBounds(event.clientX, event.clientY, layer.getBoundingClientRect());
    const rectangle = resizeNormalizedRectangle(
      resizeDraft.initial,
      resizeDraft.startX,
      resizeDraft.startY,
      point.x,
      point.y,
    );
    dispatchManualEdit({ type: "resize", id: resizeDraft.id, rectangle });
  }

  function finishResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizeDraft(null);
  }

  if (stage === "add") {
    return (
      <section className="stage-view add-stage pdf-add-stage">
        <InputModeTabs active="pdf" onChange={(mode) => mode !== "pdf" && void switchInputMode(mode)} />
        <div className="eyebrow"><Layers3 size={15} /> Flattened document safety</div>
        <h1>Turn a PDF into<br />pixels you can trust.</h1>
        <p className="lead">Choose a local PDF. VeilSend reviews every page, lets you cover anything the detectors miss, then rebuilds a separate image-only PDF with no searchable or editable text layer.</p>

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
      <section className={`stage-view review-stage pdf-review-stage ${busy ? "is-busy" : ""}`} aria-busy={busy}>
        <button className="back-button" type="button" disabled={busy} onClick={() => void startAgain()}><ArrowLeft size={16} /> Choose a different PDF</button>
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
                    disabled={busy}
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
                disabled={busy}
                aria-pressed={drawMode}
                onClick={() => { setDrawMode((current) => !current); setDraft(null); }}
              >
                <MousePointer2 size={15} /> {drawMode ? "Drawing covers" : "Add manual cover"}
              </button>
            </div>
            <div className={`pdf-canvas ${drawMode && !busy ? "drawing" : ""}`}>
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
                    >
                      <b>M{index + 1}</b>
                      <button
                        className="pdf-resize-handle"
                        type="button"
                        disabled={busy}
                        aria-label={`Resize manual cover ${index + 1}`}
                        onPointerDown={(event) => beginResize(event, region)}
                        onPointerMove={updateResize}
                        onPointerUp={finishResize}
                        onPointerCancel={finishResize}
                      />
                    </span>
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
                    disabled={busy}
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

            <div className="pdf-inspector-heading manual">
              <span>Manual covers</span>
              <div className="pdf-manual-actions">
                <b>{currentManual.length}</b>
                <button type="button" disabled={busy || !manualHistory.length} onClick={undoManualChange} aria-label="Undo last manual cover change"><Undo2 size={12} /></button>
                <button
                  type="button"
                  disabled={busy || !currentManual.length}
                  onClick={() => updateManualRegions((current) => current.filter((region) => region.pageIndex !== selectedPage))}
                  aria-label="Clear manual covers from this page"
                ><Trash2 size={12} /></button>
              </div>
            </div>
            {currentManual.map((region, index) => (
              <div className="manual-region-row" key={region.id}>
                <span>M{index + 1}</span><div><strong>Opaque cover</strong><small>{Math.round(region.rectangle.width * 100)}% × {Math.round(region.rectangle.height * 100)}% of page</small></div>
                <button type="button" disabled={busy} onClick={() => updateManualRegions((current) => current.filter((item) => item.id !== region.id))} aria-label={`Delete manual cover ${index + 1}`}><Trash2 size={14} /></button>
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
            <div className={remaining ? "review" : ""}><strong>{remaining}</strong><span>findings remaining after save</span></div>
          </div>
          <div className="pdf-verification-ledger">
            <span className={result.verification.savedBytesMatch ? "checked" : "review"}>{result.verification.savedBytesMatch ? <Check size={13} /> : <AlertTriangle size={13} />} Saved bytes match</span>
            <span className={result.verification.pageCountMatch ? "checked" : "review"}>{result.verification.pageCountMatch ? <Check size={13} /> : <AlertTriangle size={13} />} Page count and sizes match</span>
            {result.verification.ocrChecked && result.verification.faceChecked && result.verification.qrChecked && result.verification.barcodeChecked
              ? <span className="checked"><Check size={13} /> Saved pages re-rendered and checked</span>
              : <span className="review"><AlertTriangle size={13} /> One or more saved-page checks incomplete</span>}
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
