export type Severity = "low" | "medium" | "high" | "critical";
export type Category = "credential" | "personal" | "network" | "localContext" | "custom";
export type VerificationStatus = "verified" | "needsReview" | "cleanedWithExceptions";

export type RuntimeCapability = "available" | "unavailable";

export interface RuntimeInfo {
  appVersion: string;
  channel: string;
  commit: string;
  verifiedBuild: boolean;
  target: string;
  osVersion: string;
  license: "MIT";
  detectors: Record<"text" | "metadata" | "face" | "qr" | "barcode" | "pdf", RuntimeCapability>;
}

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

export interface SavedTextFile {
  savedPath: string;
  filename: string;
  cleanedSize: number;
  savedFingerprint: string;
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

export interface ImageRedactionDecision {
  id: string;
  enabled: boolean;
}

export type QrKind = "webLink" | "wifiCredential" | "contactCard" | "communicationLink" | "encodedContent" | "undecodable";
export type QrAvailability = "available" | "needsReview";

export interface QrFinding {
  id: string;
  kind: QrKind;
  label: string;
  explanation: string;
  severity: Severity;
  maskedValue: string;
  rectangle: ImageRect;
}

export interface QrScanReport {
  findings: QrFinding[];
  gridsDetected: number;
  decodedGrids: number;
  warnings: string[];
}

export interface ImageQrInspection {
  availability: QrAvailability;
  report: QrScanReport | null;
  message: string;
}

export type FaceAvailability = "available" | "unavailable" | "needsReview";

export interface FaceFinding {
  id: string;
  label: string;
  explanation: string;
  severity: Severity;
  rectangle: ImageRect;
}

export interface ImageFaceInspection {
  availability: FaceAvailability;
  findings: FaceFinding[];
  message: string;
}

export type BarcodeKind =
  | "code39"
  | "code93"
  | "code128"
  | "codabar"
  | "ean8"
  | "ean13"
  | "itf"
  | "upcA"
  | "upcE"
  | "rss14"
  | "rssExpanded"
  | "telepen";
export type BarcodeAvailability = "available" | "needsReview";

export interface BarcodeFinding {
  id: string;
  kind: BarcodeKind;
  label: string;
  explanation: string;
  severity: Severity;
  maskedValue: string;
  encodedLength: number;
  rectangle: ImageRect;
}

export interface BarcodeScanReport {
  findings: BarcodeFinding[];
  symbolsDetected: number;
  decodedSymbols: number;
  warnings: string[];
}

export interface ImageBarcodeInspection {
  availability: BarcodeAvailability;
  report: BarcodeScanReport | null;
  message: string;
}

export type ImageSourceKind = "file" | "clipboard";

export interface ImageSession {
  sessionId: string;
  sourceKind: ImageSourceKind;
  filename: string;
  previewDataUrl: string;
  inspection: ImageInspection;
  ocr: ImageOcrInspection;
  faces: ImageFaceInspection;
  qr: ImageQrInspection;
  barcodes: ImageBarcodeInspection;
}

export interface CleanedImageFile {
  savedPath: string;
  filename: string;
  savedFingerprint: string;
  previewDataUrl: string;
  originalBytes: number;
  cleanedSize: number;
  removedMetadataFindings: number;
  redactedFindings: number;
  redactedTextFindings: number;
  redactedQrFindings: number;
  redactedFaceFindings: number;
  redactedBarcodeFindings: number;
  redactedRegions: number;
  exceptions: number;
  verification: {
    status: VerificationStatus;
    metadataRemaining: number;
    visualFindingsRemaining: number;
    ocrChecked: boolean;
    qrCodesRemaining: number;
    qrChecked: boolean;
    facesRemaining: number;
    faceChecked: boolean;
    barcodesRemaining: number;
    barcodeChecked: boolean;
    pixelsUnchanged: boolean;
    message: string;
  };
}

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfManualRegion {
  id: string;
  pageIndex: number;
  rectangle: NormalizedRect;
}

export interface PdfPageSummary {
  pageIndex: number;
  widthPoints: number;
  heightPoints: number;
  widthPixels: number;
  heightPixels: number;
  thumbnailDataUrl: string;
  ocr: ImageOcrInspection;
  faces: ImageFaceInspection;
  qr: ImageQrInspection;
  barcodes: ImageBarcodeInspection;
}

export interface PdfSession {
  sessionId: string;
  filename: string;
  bytes: number;
  pageCount: number;
  pages: PdfPageSummary[];
  warnings: string[];
}

export interface PdfPagePreview {
  pageIndex: number;
  width: number;
  height: number;
  previewDataUrl: string;
}

export interface CleanedPdfFile {
  savedPath: string;
  filename: string;
  savedFingerprint: string;
  originalBytes: number;
  cleanedSize: number;
  pagesRebuilt: number;
  redactedFindings: number;
  redactedTextFindings: number;
  redactedFaceFindings: number;
  redactedQrFindings: number;
  redactedBarcodeFindings: number;
  manualRegions: number;
  redactedRegions: number;
  exceptions: number;
  verification: {
    status: VerificationStatus;
    savedBytesMatch: boolean;
    pageCountMatch: boolean;
    pagesRendered: number;
    visualFindingsRemaining: number;
    ocrChecked: boolean;
    facesRemaining: number;
    faceChecked: boolean;
    qrCodesRemaining: number;
    qrChecked: boolean;
    barcodesRemaining: number;
    barcodeChecked: boolean;
    message: string;
  };
}
