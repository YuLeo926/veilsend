import type {
  Category,
  Finding,
  FindingDecision,
  SanitizeRequest,
  SanitizeResult,
  ScanOptions,
  ScanReport,
  Severity,
} from "./types";

type BrowserRule = {
  id: string;
  label: string;
  explanation: string;
  category: Category;
  severity: Severity;
  expression: RegExp;
  replacement: string;
  capture?: number;
};

const rules: BrowserRule[] = [
  {
    id: "credential.provider-token",
    label: "Provider credential",
    explanation: "Looks like a service API key or access token.",
    category: "credential",
    severity: "critical",
    expression: /\b(?:sk-(?:proj-)?[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/gi,
    replacement: "[REDACTED_SECRET]",
  },
  {
    id: "credential.assigned-secret",
    label: "Assigned secret",
    explanation: "A password, token, or secret appears to be assigned here.",
    category: "credential",
    severity: "high",
    expression: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd|pwd)\s*[:=]\s*["']?([^\s"',;]{6,})/gim,
    capture: 1,
    replacement: "[REDACTED_SECRET]",
  },
  {
    id: "credential.connection-string",
    label: "Connection string",
    explanation: "Database URLs often contain reusable credentials and internal hostnames.",
    category: "credential",
    severity: "critical",
    expression: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s]+/gi,
    replacement: "[REDACTED_CONNECTION]",
  },
  {
    id: "personal.email",
    label: "Email address",
    explanation: "An email address can identify a person or internal organization.",
    category: "personal",
    severity: "medium",
    expression: /\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\b/gi,
    replacement: "[REDACTED_EMAIL]",
  },
  {
    id: "personal.phone",
    label: "Phone number candidate",
    explanation: "This number has the shape of a phone number; confirm it before sharing.",
    category: "personal",
    severity: "medium",
    expression: /\+?[0-9][0-9 ()-]{7,}[0-9]/g,
    replacement: "[REDACTED_PHONE]",
  },
  {
    id: "local.windows-path",
    label: "Local Windows path",
    explanation: "Local paths can expose usernames, project names, and machine layout.",
    category: "localContext",
    severity: "low",
    expression: /\b[A-Z]:\\(?:[^\\\r\n:*?"<>|]+\\)*[^\\\r\n:*?"<>|\s]*/gi,
    replacement: "[REDACTED_LOCAL_PATH]",
  },
  {
    id: "local.posix-home",
    label: "Local home path",
    explanation: "Home-directory paths commonly expose the local account name.",
    category: "localContext",
    severity: "low",
    expression: /\/(?:Users|home)\/[A-Za-z0-9._-]+(?:\/[^\s:'"]+)*/g,
    replacement: "[REDACTED_LOCAL_PATH]",
  },
];

const severityRank: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  if (globalThis.crypto?.subtle) {
    const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let fallback = 2166136261;
  for (const byte of bytes) fallback = Math.imul(fallback ^ byte, 16777619);
  return `browser-${(fallback >>> 0).toString(16).padStart(8, "0")}`;
}

function mask(value: string): string {
  const chars = Array.from(value);
  if (chars.length <= 4) return "•".repeat(chars.length);
  return `${chars.slice(0, 2).join("")}${"•".repeat(Math.min(chars.length - 4, 12))}${chars.slice(-2).join("")}`;
}

function maskedContext(text: string, start: number, end: number): string {
  return `${text.slice(Math.max(0, start - 28), start)}${mask(text.slice(start, end))}${text.slice(end, end + 28)}`
    .replaceAll("\n", " ↵ ")
    .replaceAll("\r", "");
}

function customRules(terms: string[]): BrowserRule[] {
  return terms
    .map((term) => term.trim())
    .filter(Boolean)
    .map((term) => ({
      id: "custom.sensitive-term",
      label: "Custom sensitive term",
      explanation: "This matches a sensitive term supplied for the current scan.",
      category: "custom" as const,
      severity: "high" as const,
      expression: new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
      replacement: "[REDACTED_CUSTOM]",
    }));
}

export async function scanInBrowser(text: string, options: ScanOptions): Promise<ScanReport> {
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > options.maxBytes) throw new Error(`The content is larger than the ${options.maxBytes} byte local safety limit.`);
  const started = performance.now();
  const matches: Array<Omit<Finding, "id" | "maskedValue" | "context" | "matchFingerprint"> & { raw: string }> = [];

  for (const rule of [...rules, ...customRules(options.customTerms)]) {
    rule.expression.lastIndex = 0;
    for (const match of text.matchAll(rule.expression)) {
      const raw = rule.capture ? match[rule.capture] : match[0];
      if (!raw) continue;
      if (raw.startsWith("[REDACTED_")) continue;
      if (rule.id === "personal.phone") {
        const digitCount = Array.from(raw).filter((character) => /[0-9]/.test(character)).length;
        if (digitCount < 10 || digitCount > 15 || /^\d{4}-\d{2}-\d{2}/.test(raw)) continue;
      }
      const fullStart = match.index ?? 0;
      const relativeStart = rule.capture ? match[0].indexOf(raw) : 0;
      const start = fullStart + relativeStart;
      matches.push({
        ruleId: rule.id,
        label: rule.label,
        explanation: rule.explanation,
        category: rule.category,
        severity: rule.severity,
        start,
        end: start + raw.length,
        replacement: rule.replacement,
        raw,
      });
    }
  }

  const ipv4 = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g;
  for (const match of text.matchAll(ipv4)) {
    const octets = match[0].split(".").map(Number);
    const isPrivate = octets.every((part) => part <= 255) && (
      octets[0] === 10 || octets[0] === 127 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
    if (isPrivate) {
      matches.push({
        ruleId: "network.private-ipv4",
        label: "Private IP address",
        explanation: "Private network addresses can reveal internal infrastructure.",
        category: "network",
        severity: "medium",
        start: match.index,
        end: match.index + match[0].length,
        replacement: "[REDACTED_PRIVATE_IP]",
        raw: match[0],
      });
    }
  }

  matches.sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const selected = matches.filter((candidate, index, all) => !all.slice(0, index).some((item) => candidate.start < item.end && item.start < candidate.end));
  selected.sort((a, b) => a.start - b.start);

  const findings: Finding[] = await Promise.all(selected.map(async (item, index) => ({
    id: `finding-${index}-${(await digest(item.raw)).slice(0, 8)}`,
    ruleId: item.ruleId,
    label: item.label,
    explanation: item.explanation,
    category: item.category,
    severity: item.severity,
    start: item.start,
    end: item.end,
    maskedValue: mask(item.raw),
    context: maskedContext(text, item.start, item.end),
    replacement: item.replacement,
    matchFingerprint: await digest(item.raw),
  })));

  return {
    contentFingerprint: await digest(text),
    findings,
    stats: { bytes, rulesRun: rules.length + 1 + options.customTerms.length, durationMs: Math.round(performance.now() - started) },
    warnings: ["Browser preview uses the same base rules; the desktop app runs the Rust engine."],
  };
}

export async function sanitizeInBrowser(request: SanitizeRequest): Promise<SanitizeResult> {
  if ((await digest(request.originalText)) !== request.contentFingerprint) throw new Error("The source changed after it was scanned. Scan it again before cleaning.");
  const byId = new Map<string, FindingDecision>(request.decisions.map((decision) => [decision.id, decision]));
  let exceptions = 0;
  const edits = request.findings.flatMap((finding) => {
    const decision = byId.get(finding.id);
    if (!decision?.enabled) {
      exceptions += 1;
      return [];
    }
    return [{ start: finding.start, end: finding.end, replacement: decision.replacement }];
  }).sort((a, b) => b.start - a.start);
  let cleanedText = request.originalText;
  for (const edit of edits) cleanedText = `${cleanedText.slice(0, edit.start)}${edit.replacement}${cleanedText.slice(edit.end)}`;
  const report = await scanInBrowser(cleanedText, request.options);
  const status = exceptions > 0 && report.findings.length <= exceptions
    ? "cleanedWithExceptions"
    : report.findings.length
      ? "needsReview"
      : "verified";
  const message = status === "verified"
    ? "No enabled VeilSend rule found sensitive content in the cleaned copy."
    : status === "cleanedWithExceptions"
      ? `Cleaning finished with ${exceptions} user-approved exception(s).`
      : `${report.findings.length} finding(s) remain after cleaning. Review the output before sharing.`;
  return { cleanedText, verification: { status, remainingFindings: report.findings, exceptions, message } };
}
