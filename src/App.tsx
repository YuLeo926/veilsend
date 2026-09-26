import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileSearch,
  FileText,
  Fingerprint,
  KeyRound,
  Laptop,
  LoaderCircle,
  LockKeyhole,
  Network,
  Plus,
  RefreshCcw,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { ImageWorkflow, type ImageWorkflowHandle } from "./components/ImageWorkflow";
import { InputModeTabs, type InputMode } from "./components/InputModeTabs";
import { PdfWorkflow, type PdfWorkflowHandle } from "./components/PdfWorkflow";
import { TrustCenter, type TrustRuntimeState } from "./components/TrustCenter";
import { VerificationReceipt } from "./components/VerificationReceipt";
import { getRuntimeInfo, isDesktop, sanitizeText, saveCleanedText, scanText } from "./lib/bridge";
import {
  deriveTextDiagnostics,
  emptyWorkflowDiagnostics,
  type DiagnosticErrorCode,
  type WorkflowDiagnostics,
} from "./lib/diagnostics";
import { syntheticSample } from "./lib/sample";
import { textVerificationReceipt } from "./lib/verificationReceipt";
import type {
  Category,
  Finding,
  FindingDecision,
  SanitizeResult,
  ScanOptions,
  ScanReport,
  RuntimeInfo,
  SavedTextFile,
  Severity,
} from "./lib/types";

type Stage = "add" | "review" | "result";
type TextCleanResult = SanitizeResult & { findingsRedacted: number };

const MAX_BYTES = 10 * 1024 * 1024;
const acceptedExtensions = ["env", "json", "log", "txt"];

const categoryMeta: Record<Category, { label: string; icon: typeof KeyRound }> = {
  credential: { label: "Credentials", icon: KeyRound },
  personal: { label: "Personal information", icon: UserRound },
  network: { label: "Network details", icon: Network },
  localContext: { label: "Local context", icon: Laptop },
  custom: { label: "Your sensitive terms", icon: Fingerprint },
};

const severityLabel: Record<Severity, string> = {
  low: "Notice",
  medium: "Review",
  high: "High risk",
  critical: "Critical",
};

function cleanedFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0
    ? `${filename.slice(0, dot)}.cleaned${filename.slice(dot)}`
    : `${filename || "veilsend-output"}.cleaned.txt`;
}

function readableError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return "VeilSend could not complete that action. Your original content was not changed.";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function sliceUtf8Range(value: string, byteStart: number, byteEnd: number): string {
  const bytes = new TextEncoder().encode(value);
  return new TextDecoder().decode(bytes.slice(byteStart, byteEnd));
}

function StepRail({ stage }: { stage: Stage }) {
  const current = stage === "add" ? 0 : stage === "review" ? 1 : 3;
  const steps = ["Add", "Review", "Clean", "Verified"];
  return (
    <nav className="step-rail" aria-label="VeilSend progress">
      {steps.map((step, index) => {
        const done = current > index;
        const active = current === index || (stage === "result" && index === 3);
        return (
          <div className={`step ${active ? "active" : ""} ${done ? "done" : ""}`} key={step}>
            <span className="step-marker">{done ? <Check size={13} strokeWidth={3} /> : index + 1}</span>
            <span>{step}</span>
          </div>
        );
      })}
    </nav>
  );
}

function PrivacyNote() {
  return (
    <div className="privacy-note">
      <LockKeyhole size={16} />
      <div>
        <strong>Nothing is uploaded.</strong>
        <span>Scanning and cleaning stay on this device.</span>
      </div>
    </div>
  );
}

function FindingCard({
  finding,
  decision,
  rawValue,
  revealed,
  disabled,
  onReveal,
  onDecision,
}: {
  finding: Finding;
  decision: FindingDecision;
  rawValue: string;
  revealed: boolean;
  disabled: boolean;
  onReveal: () => void;
  onDecision: (next: FindingDecision) => void;
}) {
  const meta = categoryMeta[finding.category];
  const Icon = meta.icon;
  return (
    <article className={`finding-card severity-${finding.severity} ${decision.enabled ? "selected" : "excluded"}`}>
      <div className="finding-topline">
        <button
          className="finding-check"
          type="button"
          disabled={disabled}
          onClick={() => onDecision({ ...decision, enabled: !decision.enabled })}
          aria-label={decision.enabled ? `Exclude ${finding.label}` : `Include ${finding.label}`}
          aria-pressed={decision.enabled}
        >
          {decision.enabled && <Check size={14} strokeWidth={3} />}
        </button>
        <div className="finding-title">
          <span className="finding-icon"><Icon size={17} /></span>
          <div>
            <div className="finding-heading">
              <strong>{finding.label}</strong>
              <span className={`severity-pill ${finding.severity}`}>{severityLabel[finding.severity]}</span>
            </div>
            <span>{meta.label}</span>
          </div>
        </div>
        <button className="reveal-button" type="button" onClick={onReveal}>
          {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
          {revealed ? "Hide" : "Reveal"}
        </button>
      </div>
      <div className="finding-body">
        <code className={revealed ? "raw-value revealed" : "raw-value"}>
          {revealed ? rawValue : finding.maskedValue}
        </code>
        <p>{finding.explanation}</p>
        <div className="context-line" title="Sensitive value stays masked in context">{finding.context}</div>
        <label className="replacement-field">
          <span>Replace with</span>
          <input
            value={decision.replacement}
            disabled={disabled || !decision.enabled}
            onChange={(event) => onDecision({ ...decision, replacement: event.target.value })}
            spellCheck={false}
          />
        </label>
      </div>
      {!decision.enabled && <div className="exception-banner">Kept as an exception — verification will call this out.</div>}
    </article>
  );
}

function App() {
  const [stage, setStage] = useState<Stage>("add");
  const [mode, setMode] = useState<InputMode>("text");
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("pasted-text.txt");
  const [customTerms, setCustomTerms] = useState("");
  const [report, setReport] = useState<ScanReport | null>(null);
  const [decisions, setDecisions] = useState<Record<string, FindingDecision>>({});
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<TextCleanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savedFile, setSavedFile] = useState<SavedTextFile | null>(null);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [runtimeState, setRuntimeState] = useState<TrustRuntimeState>("loading");
  const [trustOpen, setTrustOpen] = useState(false);
  const [activeDiagnostics, setActiveDiagnostics] = useState<WorkflowDiagnostics>(() => emptyWorkflowDiagnostics("text"));
  const [diagnosticError, setDiagnosticError] = useState<DiagnosticErrorCode>("none");
  const fileInput = useRef<HTMLInputElement>(null);
  const trustTrigger = useRef<HTMLButtonElement>(null);
  const textOperationGeneration = useRef(0);
  // Protect operation inputs even before React renders disabled controls.
  const textOperationPending = useRef(false);
  const currentMode = useRef<InputMode>("text");
  const imageWorkflow = useRef<ImageWorkflowHandle>(null);
  const pdfWorkflow = useRef<PdfWorkflowHandle>(null);

  const options: ScanOptions = useMemo(() => ({
    maxBytes: MAX_BYTES,
    customTerms: customTerms.split(/[\n,]/).map((term) => term.trim()).filter(Boolean),
  }), [customTerms]);

  const selectedCount = Object.values(decisions).filter((decision) => decision.enabled).length;
  const exceptionCount = Object.values(decisions).filter((decision) => !decision.enabled).length;
  const groupedFindings = useMemo(() => {
    if (!report) return [];
    const groups = new Map<Category, Finding[]>();
    for (const finding of report.findings) groups.set(finding.category, [...(groups.get(finding.category) ?? []), finding]);
    return Array.from(groups.entries());
  }, [report]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [stage]);

  useEffect(() => {
    let active = true;
    void getRuntimeInfo()
      .then((info) => {
        if (!active) return;
        setRuntimeInfo(info);
        setRuntimeState("loaded");
      })
      .catch(() => {
        if (!active) return;
        setRuntimeInfo(null);
        setRuntimeState("failed");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (mode !== "text") return;
    setActiveDiagnostics(deriveTextDiagnostics(
      stage,
      text ? new TextEncoder().encode(text).byteLength : null,
      report !== null,
      result !== null,
    ));
  }, [mode, report, result, stage, text]);

  const onWorkflowDiagnosticsChange = useCallback((next: WorkflowDiagnostics) => {
    setActiveDiagnostics(next);
  }, []);

  const setWorkflowError = useCallback((message: string, code: DiagnosticErrorCode = "workflowFailed") => {
    setError(message);
    setDiagnosticError(message ? code : "none");
  }, []);

  const workflowDiagnostics = useMemo(() => ({
    inputKind: activeDiagnostics.inputKind,
    workflowState: activeDiagnostics.workflowState,
    inputSizeBucket: activeDiagnostics.inputSizeBucket,
    pageCount: activeDiagnostics.pageCount,
    lastErrorCode: diagnosticError,
    detectors: activeDiagnostics.detectors,
  }), [activeDiagnostics, diagnosticError]);

  function setTextBusy(next: boolean) {
    textOperationPending.current = next;
    setBusy(next);
  }

  function invalidateTextOperations(nextMode: InputMode) {
    textOperationGeneration.current += 1;
    currentMode.current = nextMode;
    setTextBusy(false);
    setSavedFile(null);
  }

  function isCurrentTextOperation(token: number): boolean {
    return currentMode.current === "text" && textOperationGeneration.current === token;
  }

  const buildIdentity = runtimeState === "loading"
    ? "Loading build identity"
    : runtimeInfo?.verifiedBuild
      ? "Trusted release beta"
      : "Unverified build";
  const buildDetail = runtimeInfo ? `${runtimeInfo.channel} · ${runtimeInfo.commit}` : "Local runtime record";
  const BuildIdentityIcon = runtimeState === "loading"
    ? LoaderCircle
    : runtimeInfo?.verifiedBuild
      ? ShieldCheck
      : ShieldAlert;

  async function acceptFile(file: File) {
    if (textOperationPending.current || currentMode.current !== "text") return;
    const token = ++textOperationGeneration.current;
    setWorkflowError("");
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!acceptedExtensions.includes(extension) && !file.name.startsWith(".env")) {
      setWorkflowError("Text mode accepts UTF-8 .txt, .log, .json, and .env files. Use Images for JPEG and PNG metadata.", "inputRejected");
      return;
    }
    if (file.size > MAX_BYTES) {
      setWorkflowError("This file is larger than VeilSend's 10 MB local safety limit.", "inputRejected");
      return;
    }
    try {
      const nextText = await file.text();
      if (!isCurrentTextOperation(token)) return;
      if (nextText.includes("�")) throw new Error("This file does not appear to be valid UTF-8 text.");
      setText(nextText);
      setFilename(file.name);
    } catch (fileError) {
      if (!isCurrentTextOperation(token)) return;
      setWorkflowError(readableError(fileError), "inputRejected");
    }
  }

  async function runScan() {
    if (textOperationPending.current || currentMode.current !== "text") return;
    if (!text.trim()) {
      setWorkflowError("Paste some text or choose a supported file first.", "inputRejected");
      return;
    }
    const token = ++textOperationGeneration.current;
    setSavedFile(null);
    setTextBusy(true);
    setDropActive(false);
    setWorkflowError("");
    try {
      const nextReport = await scanText(text, options);
      if (!isCurrentTextOperation(token)) return;
      setReport(nextReport);
      setDecisions(Object.fromEntries(nextReport.findings.map((finding) => [finding.id, {
        id: finding.id,
        enabled: true,
        replacement: finding.replacement,
      }])));
      setRevealed(new Set());
      setStage("review");
    } catch (scanError) {
      if (!isCurrentTextOperation(token)) return;
      setWorkflowError(readableError(scanError));
    } finally {
      if (isCurrentTextOperation(token)) setTextBusy(false);
    }
  }

  async function runClean() {
    if (!report || textOperationPending.current || currentMode.current !== "text") return;
    const token = ++textOperationGeneration.current;
    const submittedDecisions = Object.values(decisions).map((decision) => ({ ...decision }));
    const findingsRedacted = submittedDecisions.filter((decision) => decision.enabled).length;
    setSavedFile(null);
    setTextBusy(true);
    setWorkflowError("");
    try {
      const nextResult = await sanitizeText({
        originalText: text,
        contentFingerprint: report.contentFingerprint,
        findings: report.findings,
        decisions: submittedDecisions,
        options,
      });
      if (!isCurrentTextOperation(token)) return;
      setResult({ ...nextResult, findingsRedacted });
      setStage("result");
    } catch (cleanError) {
      if (!isCurrentTextOperation(token)) return;
      setWorkflowError(readableError(cleanError));
    } finally {
      if (isCurrentTextOperation(token)) setTextBusy(false);
    }
  }

  function reset() {
    if (currentMode.current === "pdf") {
      void pdfWorkflow.current?.leave(resetToText);
      return;
    }
    if (currentMode.current === "image") {
      void imageWorkflow.current?.leave(resetToText);
      return;
    }
    resetToText();
  }

  function resetToText() {
    invalidateTextOperations("text");
    setStage("add");
    setMode("text");
    setText("");
    setFilename("pasted-text.txt");
    setReport(null);
    setResult(null);
    setDecisions({});
    setRevealed(new Set());
    setWorkflowError("");
    setActiveDiagnostics(emptyWorkflowDiagnostics("text"));
    setCopied(false);
  }

  function switchMode(nextMode: InputMode) {
    if (currentMode.current === "pdf") {
      void pdfWorkflow.current?.leave(() => completeModeSwitch(nextMode));
      return;
    }
    if (currentMode.current === "image") {
      void imageWorkflow.current?.leave(() => completeModeSwitch(nextMode));
      return;
    }
    completeModeSwitch(nextMode);
  }

  function completeModeSwitch(nextMode: InputMode) {
    invalidateTextOperations(nextMode);
    setMode(nextMode);
    setStage("add");
    setWorkflowError("");
    setActiveDiagnostics(emptyWorkflowDiagnostics(nextMode));
  }

  async function copyResult() {
    if (!result) return;
    const token = textOperationGeneration.current;
    await navigator.clipboard.writeText(result.cleanedText);
    if (!isCurrentTextOperation(token)) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function saveResult() {
    if (!result) return;
    const token = ++textOperationGeneration.current;
    try {
      const saved = await saveCleanedText(cleanedFilename(filename), result.cleanedText);
      if (isCurrentTextOperation(token) && saved) setSavedFile(saved);
    } catch (saveError) {
      if (!isCurrentTextOperation(token)) return;
      setWorkflowError(readableError(saveError), "saveFailed");
    }
  }

  return (
    <div className="app-shell">
      <div className="paper-grain" aria-hidden="true" />
      <header className="app-header">
        <button className="brand" type="button" disabled={imageBusy || pdfBusy} onClick={reset} aria-label="Start a new VeilSend scan">
          <span className="brand-mark"><ShieldCheck size={22} strokeWidth={2.3} /></span>
          <span><strong>VeilSend</strong><small>Outbound safety, on-device</small></span>
        </button>
        <div className="header-actions">
          <span className="runtime-badge"><span />{isDesktop() ? "Desktop engine" : "Browser preview"}</span>
          <button
            ref={trustTrigger}
            className={`build-label ${runtimeState === "loading" ? "loading" : runtimeInfo?.verifiedBuild ? "verified" : "unverified"}`}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={trustOpen}
            onClick={() => setTrustOpen(true)}
          >
            <BuildIdentityIcon className={runtimeState === "loading" ? "spin" : undefined} size={15} />
            <span><strong>{buildIdentity}</strong><small>{buildDetail}</small></span>
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <StepRail stage={stage} />
          <PrivacyNote />
          <div className="scope-note">
            <span>{buildIdentity}</span>
            <p>Text, image, and flattened PDF safety with local saved-file verification.</p>
          </div>
        </aside>

        <main className="main-panel">
          {error && (
            <div className="error-banner" role="alert">
              <AlertTriangle size={18} />
              <span>{error}</span>
              <button type="button" onClick={() => setError("")} aria-label="Dismiss error"><X size={16} /></button>
            </div>
          )}

          {mode === "text" && stage === "add" && (
            <section className="stage-view add-stage">
              <InputModeTabs active="text" onChange={switchMode} />
              <div className="eyebrow"><ScanLine size={15} /> Local preflight check</div>
              <h1>Catch what should not<br />leave your computer.</h1>
              <p className="lead">Paste a support log or add a text file. VeilSend flags credentials, personal data, private networks, and local paths before you send it.</p>

              <div
                className={`input-card ${dropActive ? "drop-active" : ""}`}
                aria-disabled={busy}
                aria-busy={busy}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (textOperationPending.current) {
                    event.dataTransfer.dropEffect = "none";
                    return;
                  }
                  setDropActive(true);
                }}
                onDragLeave={() => setDropActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDropActive(false);
                  const file = event.dataTransfer.files[0];
                  if (file) void acceptFile(file);
                }}
              >
                <div className="input-card-header">
                  <div className="file-identity">
                    <span><FileText size={18} /></span>
                    <div><strong>{filename}</strong><small>{text ? `${formatBytes(new TextEncoder().encode(text).byteLength)} ready to scan` : "Paste text below or drop a file here"}</small></div>
                  </div>
                  {text && <button className="quiet-button" type="button" disabled={busy} onClick={() => { if (textOperationPending.current) return; setText(""); setFilename("pasted-text.txt"); setWorkflowError(""); }}><X size={15} /> Clear</button>}
                </div>
                <textarea
                  className="source-input"
                  value={text}
                  disabled={busy}
                  onChange={(event) => { if (textOperationPending.current) return; setText(event.target.value); setFilename("pasted-text.txt"); setWorkflowError(""); }}
                  placeholder={`Paste terminal output, a debug log, JSON, or .env content…\n\nVeilSend will not send it anywhere.`}
                  spellCheck={false}
                  aria-label="Content to scan"
                />
                <div className="input-card-footer">
                  <div className="input-options">
                    <button className="secondary-button" type="button" disabled={busy} onClick={() => { if (!textOperationPending.current) fileInput.current?.click(); }}>
                      <Upload size={16} /> Choose file
                    </button>
                    <input
                      ref={fileInput}
                      className="visually-hidden"
                      type="file"
                      disabled={busy}
                      accept=".txt,.log,.json,.env,text/plain,application/json"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void acceptFile(file);
                        event.target.value = "";
                      }}
                    />
                    <button className="text-button" type="button" disabled={busy} onClick={() => { if (textOperationPending.current) return; setText(syntheticSample); setFilename("synthetic-support-log.txt"); setCustomTerms("Project Firefly"); setWorkflowError(""); }}>
                      <Sparkles size={15} /> Try safe sample
                    </button>
                  </div>
                  <button className="primary-button" type="button" disabled={busy || !text.trim()} onClick={() => void runScan()}>
                    {busy ? <LoaderCircle className="spin" size={18} /> : <FileSearch size={18} />}
                    Scan locally
                    <ChevronRight size={17} />
                  </button>
                </div>
              </div>

              <details className="custom-terms">
                <summary><Plus size={15} /> Add sensitive words for this scan</summary>
                <label>
                  <span>Project names, customer names, or internal codenames — one per line</span>
                  <textarea value={customTerms} disabled={busy} onChange={(event) => { if (!textOperationPending.current) setCustomTerms(event.target.value); }} placeholder="Project Firefly&#10;Example Customer" />
                </label>
              </details>

              <div className="trust-row">
                <span><LockKeyhole size={15} /> No network requests</span>
                <span><FileText size={15} /> Original stays untouched</span>
                <span><RefreshCcw size={15} /> Output is scanned again</span>
              </div>
            </section>
          )}

          {mode === "text" && stage === "review" && report && (
            <section className="stage-view review-stage">
              <button className="back-button" type="button" disabled={busy} onClick={() => { if (!textOperationPending.current) setStage("add"); }}><ArrowLeft size={16} /> Back to source</button>
              <div className="review-heading">
                <div>
                  <div className="eyebrow"><FileSearch size={15} /> Review before cleaning</div>
                  <h1>{report.findings.length ? `${report.findings.length} thing${report.findings.length === 1 ? "" : "s"} may be unsafe to share.` : "No base-rule matches found."}</h1>
                  <p>{report.findings.length ? "Every match is selected for cleanup. Inspect the context, keep intentional exceptions, then make a separate clean copy." : "You can still create and verify a separate copy. VeilSend only checks its enabled rules."}</p>
                </div>
                <div className="scan-receipt">
                  <span>SCAN RECEIPT</span>
                  <strong>{report.stats.rulesRun} rules</strong>
                  <small>{formatBytes(report.stats.bytes)} · {report.stats.durationMs} ms</small>
                </div>
              </div>

              <div className="review-layout">
                <div className="findings-column">
                  {groupedFindings.map(([category, findings]) => (
                    <div className="finding-group" key={category}>
                      <div className="group-heading">
                        <span>{categoryMeta[category].label}</span>
                        <span>{findings.length}</span>
                      </div>
                      {findings.map((finding) => (
                        <FindingCard
                          key={finding.id}
                          finding={finding}
                          decision={decisions[finding.id]}
                          rawValue={isDesktop() ? sliceUtf8Range(text, finding.start, finding.end) : text.slice(finding.start, finding.end)}
                          revealed={revealed.has(finding.id)}
                          disabled={busy}
                          onReveal={() => setRevealed((current) => {
                            const next = new Set(current);
                            if (next.has(finding.id)) next.delete(finding.id); else next.add(finding.id);
                            return next;
                          })}
                          onDecision={(next) => {
                            if (!textOperationPending.current) setDecisions((current) => ({ ...current, [finding.id]: next }));
                          }}
                        />
                      ))}
                    </div>
                  ))}
                  {!report.findings.length && (
                    <div className="empty-findings">
                      <ShieldCheck size={28} />
                      <strong>No matches from the enabled rules</strong>
                      <p>This is not a guarantee that the content contains no sensitive information. Read it once before sharing.</p>
                    </div>
                  )}
                </div>
                <aside className="clean-summary">
                  <div className="summary-stamp"><ScanLine size={23} /><span>Ready<br />to clean</span></div>
                  <h2>Make a safe copy</h2>
                  <dl>
                    <div><dt>Replace</dt><dd>{selectedCount}</dd></div>
                    <div><dt>Exceptions</dt><dd className={exceptionCount ? "warn" : ""}>{exceptionCount}</dd></div>
                    <div><dt>Original</dt><dd>Untouched</dd></div>
                  </dl>
                  <button className="primary-button wide" type="button" disabled={busy} onClick={() => void runClean()}>
                    {busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}
                    Clean & verify
                  </button>
                  <p className="summary-disclaimer">“Verified” means no enabled VeilSend rule matched the output. Always use your judgment.</p>
                </aside>
              </div>
            </section>
          )}

          {mode === "text" && stage === "result" && result && (
            <section className="stage-view result-stage">
              <div className={`result-hero status-${result.verification.status}`}>
                <div className="result-seal">
                  {result.verification.status === "verified" ? <CheckCircle2 size={42} /> : <AlertTriangle size={42} />}
                </div>
                <div>
                  <div className="eyebrow">Verification complete</div>
                  <h1>{result.verification.status === "verified" ? "Clean copy verified." : result.verification.status === "cleanedWithExceptions" ? "Cleaned with exceptions." : "The copy still needs review."}</h1>
                  <p>{result.verification.message}</p>
                </div>
                <div className="verification-ticket">
                  <span>VEILSEND CHECK</span>
                  <strong>{result.verification.status === "verified" ? "PASSED" : "REVIEW"}</strong>
                  <small>{result.verification.remainingFindings.length} remaining matches</small>
                </div>
              </div>

              <div className="output-card">
                <div className="output-header">
                  <div className="file-identity">
                    <span><FileText size={18} /></span>
                    <div><strong>{cleanedFilename(filename)}</strong><small>Separate clean copy · {formatBytes(new TextEncoder().encode(result.cleanedText).byteLength)}</small></div>
                  </div>
                  <span className="original-safe"><Check size={14} /> Original unchanged</span>
                </div>
                <textarea readOnly value={result.cleanedText} spellCheck={false} aria-label="Cleaned output" />
                <div className="output-actions">
                  <button className="secondary-button" type="button" onClick={() => void copyResult()}>
                    {copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Copied" : "Copy cleaned text"}
                  </button>
                  <button className="primary-button" type="button" onClick={() => void saveResult()}><Download size={17} /> Save clean copy</button>
                </div>
                {savedFile && <div className="save-confirmation"><Check size={14} /> Saved to {savedFile.savedPath}</div>}
              </div>

              {savedFile && (
                <VerificationReceipt data={textVerificationReceipt(runtimeInfo, savedFile, result, result.findingsRedacted)} />
              )}

              <div className="result-footer">
                <button className="text-button" type="button" onClick={reset}><RefreshCcw size={15} /> Scan something else</button>
                <p><AlertTriangle size={14} /> VeilSend reduces accidental exposure; it cannot guarantee that content is safe.</p>
              </div>
            </section>
          )}

          {mode === "image" && (
            <ImageWorkflow
              stage={stage}
              onStageChange={setStage}
              onSwitchMode={completeModeSwitch}
              onError={setWorkflowError}
              onDiagnosticsChange={onWorkflowDiagnosticsChange}
              runtimeInfo={runtimeInfo}
              navigationRef={imageWorkflow}
              onBusyChange={setImageBusy}
            />
          )}

          {mode === "pdf" && (
            <PdfWorkflow
              stage={stage}
              onStageChange={setStage}
              onSwitchMode={completeModeSwitch}
              onError={setWorkflowError}
              onDiagnosticsChange={onWorkflowDiagnosticsChange}
              runtimeInfo={runtimeInfo}
              navigationRef={pdfWorkflow}
              onBusyChange={setPdfBusy}
            />
          )}
        </main>
      </div>

      <TrustCenter
        open={trustOpen}
        runtimeInfo={runtimeInfo}
        runtimeState={runtimeState}
        workflowDiagnostics={workflowDiagnostics}
        onClose={() => {
          setTrustOpen(false);
          window.requestAnimationFrame(() => trustTrigger.current?.focus());
        }}
      />

      <footer className="app-footer">
        <span>VeilSend {runtimeInfo?.appVersion ?? "0.2.0-beta.1"} · {buildIdentity}</span>
        <span><span className="offline-dot" /> {runtimeInfo ? buildDetail : "Designed to work offline"}</span>
      </footer>
    </div>
  );
}

export default App;
