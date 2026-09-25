import type {
  CleanedImageFile,
  CleanedPdfFile,
  RuntimeInfo,
  SavedTextFile,
  SanitizeResult,
  VerificationStatus,
} from "./types";

export type ReceiptOutputKind = "text" | "image" | "pdf";
export type ReceiptDetectorKey = "text" | "metadata" | "face" | "qr" | "barcode" | "pdf";
export type ReceiptDetectorState = "complete" | "incomplete" | "notApplicable";

export interface VerificationReceiptData {
  appVersion: string;
  commit: string;
  outputKind: ReceiptOutputKind;
  status: VerificationStatus;
  savedBytes: number;
  pages: number | null;
  findingsRedacted: number;
  exceptions: number;
  remainingFindings: number;
  detectors: Partial<Record<ReceiptDetectorKey, ReceiptDetectorState>>;
  outputFingerprint: string;
}

const detectorKeys: readonly ReceiptDetectorKey[] = ["text", "metadata", "face", "qr", "barcode", "pdf"];

const requiredDetectors: Record<ReceiptOutputKind, readonly ReceiptDetectorKey[]> = {
  text: ["text"],
  image: ["text", "metadata", "face", "qr", "barcode"],
  pdf: ["text", "face", "qr", "barcode", "pdf"],
};

function safeVersion(value: unknown): string {
  return typeof value === "string" && /^(?:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?|unverified)$/.test(value)
    ? value
    : "unverified";
}

function safeCommit(value: unknown): string {
  return typeof value === "string" && /^(?:[0-9a-f]{12}|unverified)$/.test(value)
    ? value
    : "unverified";
}

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safePages(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function safeOutputKind(value: unknown): ReceiptOutputKind {
  return value === "image" || value === "pdf" ? value : "text";
}

function safeDetectorState(value: unknown): ReceiptDetectorState {
  return value === "complete" || value === "notApplicable" ? value : "incomplete";
}

function safeStatus(value: unknown): VerificationStatus {
  if (value === "verified" || value === "cleanedWithExceptions") return value;
  return "needsReview";
}

function normalizedStatus(data: VerificationReceiptData, kind: ReceiptOutputKind): VerificationStatus {
  const candidate = safeStatus(data.status);
  const detectorsComplete = requiredDetectors[kind].every((key) => safeDetectorState(data.detectors[key]) === "complete");
  if (!detectorsComplete || safeCount(data.remainingFindings) > 0) return "needsReview";
  if (safeCount(data.exceptions) > 0) return candidate === "needsReview" ? "needsReview" : "cleanedWithExceptions";
  return candidate;
}

function buildIdentity(runtime: RuntimeInfo | null): Pick<VerificationReceiptData, "appVersion" | "commit"> {
  return {
    appVersion: runtime?.appVersion ?? "unverified",
    commit: runtime?.commit ?? "unverified",
  };
}

function detectorState(runtime: RuntimeInfo | null, key: ReceiptDetectorKey, complete: boolean): ReceiptDetectorState {
  return runtime?.detectors[key] === "available" && complete === true ? "complete" : "incomplete";
}

export function textVerificationReceipt(
  runtime: RuntimeInfo | null,
  saved: SavedTextFile,
  result: SanitizeResult,
  findingsRedacted: number,
): VerificationReceiptData {
  const data: VerificationReceiptData = {
    ...buildIdentity(runtime),
    outputKind: "text",
    status: result.verification.status,
    savedBytes: saved.cleanedSize,
    pages: null,
    findingsRedacted,
    exceptions: result.verification.exceptions,
    remainingFindings: result.verification.remainingFindings.length,
    detectors: { text: detectorState(runtime, "text", true), metadata: "notApplicable", face: "notApplicable", qr: "notApplicable", barcode: "notApplicable", pdf: "notApplicable" },
    outputFingerprint: saved.savedFingerprint,
  };
  return { ...data, status: normalizedStatus(data, "text") };
}

export function imageVerificationReceipt(runtime: RuntimeInfo | null, result: CleanedImageFile): VerificationReceiptData {
  const remainingFindings = result.verification.metadataRemaining
    + result.verification.visualFindingsRemaining
    + result.verification.facesRemaining
    + result.verification.qrCodesRemaining
    + result.verification.barcodesRemaining;
  const data: VerificationReceiptData = {
    ...buildIdentity(runtime),
    outputKind: "image",
    status: result.verification.status,
    savedBytes: result.cleanedSize,
    pages: null,
    findingsRedacted: result.redactedFindings + result.removedMetadataFindings,
    exceptions: result.exceptions,
    remainingFindings,
    detectors: {
      text: detectorState(runtime, "text", result.verification.ocrChecked),
      metadata: detectorState(runtime, "metadata", true),
      face: detectorState(runtime, "face", result.verification.faceChecked),
      qr: detectorState(runtime, "qr", result.verification.qrChecked),
      barcode: detectorState(runtime, "barcode", result.verification.barcodeChecked),
      pdf: "notApplicable",
    },
    outputFingerprint: result.savedFingerprint,
  };
  return { ...data, status: normalizedStatus(data, "image") };
}

export function pdfVerificationReceipt(runtime: RuntimeInfo | null, result: CleanedPdfFile): VerificationReceiptData {
  const remainingFindings = result.verification.visualFindingsRemaining
    + result.verification.facesRemaining
    + result.verification.qrCodesRemaining
    + result.verification.barcodesRemaining;
  const pdfComplete = result.verification.savedBytesMatch
    && result.verification.pageCountMatch
    && result.verification.pagesRendered === result.pagesRebuilt;
  const data: VerificationReceiptData = {
    ...buildIdentity(runtime),
    outputKind: "pdf",
    status: result.verification.status,
    savedBytes: result.cleanedSize,
    pages: result.pagesRebuilt,
    findingsRedacted: result.redactedFindings + result.manualRegions,
    exceptions: result.exceptions,
    remainingFindings,
    detectors: {
      text: detectorState(runtime, "text", result.verification.ocrChecked),
      metadata: "notApplicable",
      face: detectorState(runtime, "face", result.verification.faceChecked),
      qr: detectorState(runtime, "qr", result.verification.qrChecked),
      barcode: detectorState(runtime, "barcode", result.verification.barcodeChecked),
      pdf: detectorState(runtime, "pdf", pdfComplete),
    },
    outputFingerprint: result.savedFingerprint,
  };
  return { ...data, status: normalizedStatus(data, "pdf") };
}

export function formatVerificationReceipt(data: VerificationReceiptData, includeFingerprint = false): string {
  // Enumerate each allowed field explicitly. Never spread or serialize receipt inputs.
  const kind = safeOutputKind(data.outputKind);
  const lines = [
    "VeilSend verification receipt",
    `app_version=${safeVersion(data.appVersion)}`,
    `commit=${safeCommit(data.commit)}`,
    `output_kind=${kind}`,
    `status=${normalizedStatus(data, kind)}`,
    `saved_bytes=${safeCount(data.savedBytes)}`,
    `pages=${safePages(data.pages) ?? "not-applicable"}`,
    `findings_redacted=${safeCount(data.findingsRedacted)}`,
    `exceptions=${safeCount(data.exceptions)}`,
    `remaining_findings=${safeCount(data.remainingFindings)}`,
    ...detectorKeys.map((key) => `detector_${key}=${safeDetectorState(data.detectors[key])}`),
  ];
  if (includeFingerprint && typeof data.outputFingerprint === "string" && /^[0-9a-f]{64}$/i.test(data.outputFingerprint)) {
    lines.push(`output_sha256=${data.outputFingerprint.toLowerCase()}`);
  }
  return lines.join("\n");
}
