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

export type ImageFormat = "jpeg" | "png";
export type ImageMetadataCategory = "location" | "device" | "identity" | "time" | "description" | "other";

export interface ImageMetadataFinding {
  id: string;
  label: string;
  explanation: string;
  category: ImageMetadataCategory;
  severity: Severity;
  maskedValue: string;
}

export interface ImageInspection {
  format: ImageFormat;
  bytes: number;
  width: number | null;
  height: number | null;
  findings: ImageMetadataFinding[];
  canCleanLosslessly: boolean;
  warnings: string[];
  pixelFingerprint: string;
}

export interface ImageSession {
  sourcePath: string;
  filename: string;
  previewDataUrl: string;
  inspection: ImageInspection;
}

export interface CleanedImageFile {
  savedPath: string;
  filename: string;
  previewDataUrl: string;
  originalBytes: number;
  cleanedSize: number;
  removedFindings: number;
  verification: {
    verified: boolean;
    remainingFindings: number;
    pixelsUnchanged: boolean;
    message: string;
  };
}
