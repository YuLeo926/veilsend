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

export interface ImageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type OcrConfidence = "notProvided";
export type OcrAvailability = "available" | "unavailable" | "needsReview";

export interface ImageTextFinding {
  id: string;
  ruleId: string;
  label: string;
  explanation: string;
  category: Category;
  severity: Severity;
  maskedValue: string;
  rectangles: ImageRect[];
  confidence: OcrConfidence;
}

export interface OcrScanReport {
  findings: ImageTextFinding[];
  wordsDetected: number;
  language: string | null;
  confidence: OcrConfidence;
  warnings: string[];
}

export interface ImageOcrInspection {
  availability: OcrAvailability;
  report: OcrScanReport | null;
  message: string;
}

export interface ImageTextDecision {
  id: string;
  enabled: boolean;
}

export interface ImageSession {
  sourcePath: string;
  sourceFingerprint: string;
  filename: string;
  previewDataUrl: string;
  inspection: ImageInspection;
  ocr: ImageOcrInspection;
}

export interface CleanedImageFile {
  savedPath: string;
  filename: string;
  previewDataUrl: string;
  originalBytes: number;
  cleanedSize: number;
  removedMetadataFindings: number;
  redactedFindings: number;
  redactedRegions: number;
  exceptions: number;
  verification: {
    status: VerificationStatus;
    metadataRemaining: number;
    visualFindingsRemaining: number;
    ocrChecked: boolean;
    pixelsUnchanged: boolean;
    message: string;
  };
}
