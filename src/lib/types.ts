export type Severity = "low" | "medium" | "high" | "critical";
export type Category = "credential" | "personal" | "network" | "localContext" | "custom";
export type VerificationStatus = "verified" | "needsReview" | "cleanedWithExceptions";

export interface ScanOptions {
  maxBytes: number;
  customTerms: string[];
}

export interface Finding {
  id: string;
  ruleId: string;
  label: string;
  explanation: string;
  category: Category;
  severity: Severity;
  start: number;
  end: number;
  maskedValue: string;
  context: string;
  replacement: string;
  matchFingerprint: string;
}

export interface ScanReport {
  contentFingerprint: string;
  findings: Finding[];
  stats: { bytes: number; rulesRun: number; durationMs: number };
  warnings: string[];
}

export interface FindingDecision {
  id: string;
  enabled: boolean;
  replacement: string;
}

export interface SanitizeRequest {
  originalText: string;
  contentFingerprint: string;
  findings: Finding[];
  decisions: FindingDecision[];
  options: ScanOptions;
}

export interface SanitizeResult {
  cleanedText: string;
  verification: {
    status: VerificationStatus;
    remainingFindings: Finding[];
    exceptions: number;
    message: string;
  };
}

