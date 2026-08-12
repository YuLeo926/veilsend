import { useEffect, useMemo, useRef, useState } from "react";
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
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { ImageWorkflow } from "./components/ImageWorkflow";
import { InputModeTabs, type InputMode } from "./components/InputModeTabs";
import { isDesktop, sanitizeText, saveCleanedText, scanText } from "./lib/bridge";
import { syntheticSample } from "./lib/sample";
import type {
  Category,
  Finding,
  FindingDecision,
  SanitizeResult,
  ScanOptions,
  ScanReport,
  Severity,
} from "./lib/types";

type Stage = "add" | "review" | "result";

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
    : `${filename || "sharegate-output"}.cleaned.txt`;
}

function readableError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return "ShareGate could not complete that action. Your original content was not changed.";
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
    <nav className="step-rail" aria-label="ShareGate progress">
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
  onReveal,
  onDecision,
}: {
  finding: Finding;
  decision: FindingDecision;
  rawValue: string;
  revealed: boolean;
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
            disabled={!decision.enabled}
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
  const [result, setResult] = useState<SanitizeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savedPath, setSavedPath] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

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

  async function acceptFile(file: File) {
    setError("");
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!acceptedExtensions.includes(extension) && !file.name.startsWith(".env")) {
      setError("Text mode accepts UTF-8 .txt, .log, .json, and .env files. Use Images for JPEG and PNG metadata.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("This file is larger than ShareGate's 10 MB local safety limit.");
      return;
    }
    try {
      const nextText = await file.text();
      if (nextText.includes("�")) throw new Error("This file does not appear to be valid UTF-8 text.");
      setText(nextText);
      setFilename(file.name);
    } catch (fileError) {
      setError(readableError(fileError));
    }
  }

  async function runScan() {
    if (!text.trim()) {
      setError("Paste some text or choose a supported file first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const nextReport = await scanText(text, options);
      setReport(nextReport);
      setDecisions(Object.fromEntries(nextReport.findings.map((finding) => [finding.id, {
        id: finding.id,
        enabled: true,
        replacement: finding.replacement,
      }])));
      setRevealed(new Set());
      setStage("review");
    } catch (scanError) {
      setError(readableError(scanError));
    } finally {
      setBusy(false);
    }
  }

  async function runClean() {
    if (!report) return;
    setBusy(true);
    setError("");
    try {
      const nextResult = await sanitizeText({
        originalText: text,
        contentFingerprint: report.contentFingerprint,
        findings: report.findings,
        decisions: Object.values(decisions),
        options,
      });
      setResult(nextResult);
      setStage("result");
    } catch (cleanError) {
      setError(readableError(cleanError));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStage("add");
    setMode("text");
    setText("");
    setFilename("pasted-text.txt");
    setReport(null);
    setResult(null);
    setDecisions({});
    setRevealed(new Set());
    setError("");
    setCopied(false);
    setSavedPath("");
  }

  function switchMode(nextMode: InputMode) {
    setMode(nextMode);
    setStage("add");
    setError("");
  }

  async function copyResult() {
    if (!result) return;
    await navigator.clipboard.writeText(result.cleanedText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function saveResult() {
    if (!result) return;
    try {
      const path = await saveCleanedText(cleanedFilename(filename), result.cleanedText);
      if (path) setSavedPath(path);
    } catch (saveError) {
      setError(readableError(saveError));
    }
  }

  return (
    <div className="app-shell">
      <div className="paper-grain" aria-hidden="true" />
      <header className="app-header">
        <button className="brand" type="button" onClick={reset} aria-label="Start a new ShareGate scan">
          <span className="brand-mark"><ShieldCheck size={22} strokeWidth={2.3} /></span>
          <span><strong>ShareGate</strong><small>Outbound safety, on-device</small></span>
        </button>
        <div className="header-actions">
          <span className="runtime-badge"><span />{isDesktop() ? "Desktop engine" : "Browser preview"}</span>
          <span className="build-label">Open-source foundation</span>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <StepRail stage={stage} />
          <PrivacyNote />
          <div className="scope-note">
            <span>Milestone B</span>
            <p>Text safety plus lossless JPEG and PNG metadata cleaning.</p>
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
              <p className="lead">Paste a support log or add a text file. ShareGate flags credentials, personal data, private networks, and local paths before you send it.</p>

              <div
                className={`input-card ${dropActive ? "drop-active" : ""}`}
                onDragOver={(event) => { event.preventDefault(); setDropActive(true); }}
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
                  {text && <button className="quiet-button" type="button" onClick={() => { setText(""); setFilename("pasted-text.txt"); }}><X size={15} /> Clear</button>}
                </div>
                <textarea
                  className="source-input"
                  value={text}
                  onChange={(event) => { setText(event.target.value); setFilename("pasted-text.txt"); }}
                  placeholder={`Paste terminal output, a debug log, JSON, or .env content…\n\nShareGate will not send it anywhere.`}
                  spellCheck={false}
                  aria-label="Content to scan"
                />
                <div className="input-card-footer">
                  <div className="input-options">
                    <button className="secondary-button" type="button" onClick={() => fileInput.current?.click()}>
                      <Upload size={16} /> Choose file
                    </button>
                    <input
                      ref={fileInput}
                      className="visually-hidden"
                      type="file"
                      accept=".txt,.log,.json,.env,text/plain,application/json"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void acceptFile(file);
                        event.target.value = "";
                      }}
                    />
                    <button className="text-button" type="button" onClick={() => { setText(syntheticSample); setFilename("synthetic-support-log.txt"); setCustomTerms("Project Firefly"); }}>
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
                  <textarea value={customTerms} onChange={(event) => setCustomTerms(event.target.value)} placeholder="Project Firefly&#10;Example Customer" />
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
              <button className="back-button" type="button" onClick={() => setStage("add")}><ArrowLeft size={16} /> Back to source</button>
              <div className="review-heading">
                <div>
                  <div className="eyebrow"><FileSearch size={15} /> Review before cleaning</div>
                  <h1>{report.findings.length ? `${report.findings.length} thing${report.findings.length === 1 ? "" : "s"} may be unsafe to share.` : "No base-rule matches found."}</h1>
                  <p>{report.findings.length ? "Every match is selected for cleanup. Inspect the context, keep intentional exceptions, then make a separate clean copy." : "You can still create and verify a separate copy. ShareGate only checks its enabled rules."}</p>
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
                          onReveal={() => setRevealed((current) => {
                            const next = new Set(current);
                            if (next.has(finding.id)) next.delete(finding.id); else next.add(finding.id);
                            return next;
                          })}
                          onDecision={(next) => setDecisions((current) => ({ ...current, [finding.id]: next }))}
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
                  <p className="summary-disclaimer">“Verified” means no enabled ShareGate rule matched the output. Always use your judgment.</p>
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
                  <span>SHAREGATE CHECK</span>
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
                {savedPath && <div className="save-confirmation"><Check size={14} /> Saved to {savedPath}</div>}
              </div>

              <div className="result-footer">
                <button className="text-button" type="button" onClick={reset}><RefreshCcw size={15} /> Scan something else</button>
                <p><AlertTriangle size={14} /> ShareGate reduces accidental exposure; it cannot guarantee that content is safe.</p>
              </div>
            </section>
          )}

          {mode === "image" && (
            <ImageWorkflow
              stage={stage}
              onStageChange={setStage}
              onSwitchToText={() => switchMode("text")}
              onError={setError}
            />
          )}
        </main>
      </div>

      <footer className="app-footer">
        <span>ShareGate v0.1 foundation</span>
        <span><span className="offline-dot" /> Designed to work offline</span>
      </footer>
    </div>
  );
}

export default App;
