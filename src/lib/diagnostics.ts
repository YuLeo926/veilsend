import type { RuntimeInfo } from "./types";

export type DiagnosticDetectorKey = "text" | "metadata" | "face" | "qr" | "barcode" | "pdf";
export type DiagnosticDetectorState = "available" | "complete" | "unavailable" | "failed" | "notRun" | "notApplicable";
export type DiagnosticErrorCode = "none" | "inputRejected" | "detectorIncomplete" | "saveFailed" | "verificationFailed" | "workflowFailed";
export type DiagnosticInputKind = "text" | "image" | "pdf";
export type DiagnosticWorkflowState = "add" | "review" | "result";
export type InputSizeBucket = "none" | "under 1 MiB" | "1-10 MiB" | "10-50 MiB" | "over limit";

export interface WorkflowDiagnostics {
  inputKind: DiagnosticInputKind;
  workflowState: DiagnosticWorkflowState;
  inputSizeBucket: InputSizeBucket;
  pageCount: number | null;
  lastErrorCode: DiagnosticErrorCode;
  detectors: Record<DiagnosticDetectorKey, DiagnosticDetectorState>;
}

type DetectorAvailability = "available" | "unavailable" | "needsReview";
type ImageDiagnosticFacts = {
  stage: DiagnosticWorkflowState;
  inputBytes: number | null;
  metadataInspected: boolean;
  textAvailability: DetectorAvailability | null;
  faceAvailability: DetectorAvailability | null;
  qrAvailability: DetectorAvailability | null;
  barcodeAvailability: DetectorAvailability | null;
  resultChecks: { text: boolean; face: boolean; qr: boolean; barcode: boolean } | null;
};
type PdfPageDiagnosticFacts = {
  textAvailability: DetectorAvailability;
  faceAvailability: DetectorAvailability;
  qrAvailability: DetectorAvailability;
  barcodeAvailability: DetectorAvailability;
};
type PdfDiagnosticFacts = {
  stage: DiagnosticWorkflowState;
  inputBytes: number | null;
  pageCount: number | null;
  pages: readonly PdfPageDiagnosticFacts[];
  resultChecks: {
    savedBytesMatch: boolean;
    pageCountMatch: boolean;
    pagesRendered: number;
    pagesRebuilt: number;
    text: boolean;
    face: boolean;
    qr: boolean;
    barcode: boolean;
  } | null;
};

const mib = 1024 * 1024;
const detectorKeys: readonly DiagnosticDetectorKey[] = ["text", "metadata", "face", "qr", "barcode", "pdf"];

function validDetectorState(value: unknown): DiagnosticDetectorState {
  if (value === "available" || value === "complete" || value === "unavailable" || value === "failed" || value === "notRun" || value === "notApplicable") return value;
  return "failed";
}

function validInputKind(value: unknown): DiagnosticInputKind {
  return value === "text" || value === "image" || value === "pdf" ? value : "text";
}

function validWorkflowState(value: unknown): DiagnosticWorkflowState {
  return value === "add" || value === "review" || value === "result" ? value : "add";
}

function validBucket(value: unknown): InputSizeBucket {
  if (value === "none" || value === "under 1 MiB" || value === "1-10 MiB" || value === "10-50 MiB" || value === "over limit") return value;
  return "none";
}

function validErrorCode(value: unknown): DiagnosticErrorCode {
  if (value === "none" || value === "inputRejected" || value === "detectorIncomplete" || value === "saveFailed" || value === "verificationFailed" || value === "workflowFailed") return value;
  return "workflowFailed";
}

function validPageCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 50 ? value : null;
}

function hasValidPdfInputBytes(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 50 * mib;
}

export function bucketInputBytes(bytes: number | null): InputSizeBucket {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "none";
  if (bytes < mib) return "under 1 MiB";
  if (bytes < 10 * mib) return "1-10 MiB";
  if (bytes <= 50 * mib) return "10-50 MiB";
  return "over limit";
}

export function diagnosticDetectorState(
  scanState: DiagnosticDetectorState,
  savedCheckComplete: boolean | null,
): DiagnosticDetectorState {
  const safeState = validDetectorState(scanState);
  if (safeState !== "complete") return safeState;
  return savedCheckComplete === false ? "failed" : "complete";
}

export function emptyWorkflowDiagnostics(inputKind: DiagnosticInputKind): WorkflowDiagnostics {
  return {
    inputKind,
    workflowState: "add",
    inputSizeBucket: "none",
    pageCount: null,
    lastErrorCode: "none",
    detectors: { text: "notRun", metadata: "notRun", face: "notRun", qr: "notRun", barcode: "notRun", pdf: "notRun" },
  };
}

function detectorStateFromAvailability(availability: DetectorAvailability | null): DiagnosticDetectorState {
  if (availability === "available") return "complete";
  if (availability === "unavailable") return "unavailable";
  if (availability === "needsReview") return "failed";
  return "notRun";
}

function aggregateDetectorState(
  pages: readonly PdfPageDiagnosticFacts[],
  key: "textAvailability" | "faceAvailability" | "qrAvailability" | "barcodeAvailability",
): DiagnosticDetectorState {
  if (!pages.length) return "failed";
  let state: DiagnosticDetectorState = "complete";
  for (const page of pages) {
    const next = detectorStateFromAvailability(page[key]);
    if (next === "failed") return "failed";
    if (next === "unavailable") state = "unavailable";
    if (next === "notRun" && state === "complete") state = "notRun";
  }
  return state;
}

export function deriveTextDiagnostics(
  stage: DiagnosticWorkflowState,
  inputBytes: number | null,
  scanCompleted: boolean,
  cleanCompleted: boolean,
): WorkflowDiagnostics {
  if (stage === "add") return { ...emptyWorkflowDiagnostics("text"), inputSizeBucket: bucketInputBytes(inputBytes) };
  const checked = stage === "review" ? scanCompleted : cleanCompleted;
  return {
    inputKind: "text", workflowState: stage, inputSizeBucket: bucketInputBytes(inputBytes), pageCount: null, lastErrorCode: "none",
    detectors: {
      text: checked ? "complete" : "failed", metadata: "notApplicable", face: "notApplicable",
      qr: "notApplicable", barcode: "notApplicable", pdf: "notApplicable",
    },
  };
}

export function deriveImageDiagnostics(facts: ImageDiagnosticFacts): WorkflowDiagnostics {
  if (facts.stage === "add") return { ...emptyWorkflowDiagnostics("image"), inputSizeBucket: bucketInputBytes(facts.inputBytes) };
  const text = diagnosticDetectorState(detectorStateFromAvailability(facts.textAvailability), facts.resultChecks?.text ?? null);
  const face = diagnosticDetectorState(detectorStateFromAvailability(facts.faceAvailability), facts.resultChecks?.face ?? null);
  const qr = diagnosticDetectorState(detectorStateFromAvailability(facts.qrAvailability), facts.resultChecks?.qr ?? null);
  const barcode = diagnosticDetectorState(detectorStateFromAvailability(facts.barcodeAvailability), facts.resultChecks?.barcode ?? null);
  return {
    inputKind: "image", workflowState: facts.stage, inputSizeBucket: bucketInputBytes(facts.inputBytes), pageCount: null, lastErrorCode: "none",
    detectors: { text, metadata: facts.metadataInspected ? "complete" : "failed", face, qr, barcode, pdf: "notApplicable" },
  };
}

export function derivePdfDiagnostics(facts: PdfDiagnosticFacts): WorkflowDiagnostics {
  if (facts.stage === "add") return { ...emptyWorkflowDiagnostics("pdf"), inputSizeBucket: bucketInputBytes(facts.inputBytes) };
  const pageCount = validPageCount(facts.pageCount);
  const hasPdfSessionEvidence = hasValidPdfInputBytes(facts.inputBytes) && pageCount !== null && facts.pages.length === pageCount;
  const textScan = hasPdfSessionEvidence ? aggregateDetectorState(facts.pages, "textAvailability") : "failed";
  const faceScan = hasPdfSessionEvidence ? aggregateDetectorState(facts.pages, "faceAvailability") : "failed";
  const qrScan = hasPdfSessionEvidence ? aggregateDetectorState(facts.pages, "qrAvailability") : "failed";
  const barcodeScan = hasPdfSessionEvidence ? aggregateDetectorState(facts.pages, "barcodeAvailability") : "failed";
  const checks = facts.resultChecks;
  const pdfCheck = checks === null ? null
    : checks.savedBytesMatch === true
      && checks.pageCountMatch === true
      && checks.pagesRendered === pageCount
      && checks.pagesRebuilt === pageCount;
  return {
    inputKind: "pdf", workflowState: facts.stage, inputSizeBucket: bucketInputBytes(facts.inputBytes), pageCount, lastErrorCode: "none",
    detectors: {
      text: diagnosticDetectorState(textScan, checks?.text ?? null), metadata: "notApplicable",
      face: diagnosticDetectorState(faceScan, checks?.face ?? null), qr: diagnosticDetectorState(qrScan, checks?.qr ?? null),
      barcode: diagnosticDetectorState(barcodeScan, checks?.barcode ?? null), pdf: hasPdfSessionEvidence && (facts.stage !== "result" || checks !== null)
        ? diagnosticDetectorState("complete", pdfCheck)
        : "failed",
    },
  };
}

export function formatDiagnostics(runtime: RuntimeInfo, workflow: WorkflowDiagnostics): string {
  // Each allowed field is deliberately read one-by-one. Do not serialize or enumerate either input.
  const runtimeText = runtime.detectors.text;
  const runtimeMetadata = runtime.detectors.metadata;
  const runtimeFace = runtime.detectors.face;
  const runtimeQr = runtime.detectors.qr;
  const runtimeBarcode = runtime.detectors.barcode;
  const runtimePdf = runtime.detectors.pdf;
  const workflowText = workflow.detectors.text;
  const workflowMetadata = workflow.detectors.metadata;
  const workflowFace = workflow.detectors.face;
  const workflowQr = workflow.detectors.qr;
  const workflowBarcode = workflow.detectors.barcode;
  const workflowPdf = workflow.detectors.pdf;
  return [
    "VeilSend privacy-safe diagnostics",
    `app_version=${runtime.appVersion}`,
    `channel=${runtime.channel}`,
    `commit=${runtime.commit}`,
    `verified_build=${runtime.verifiedBuild === true}`,
    `target=${runtime.target}`,
    `os_version=${runtime.osVersion}`,
    `runtime_detector_text=${runtimeText === "available" ? "available" : "unavailable"}`,
    `runtime_detector_metadata=${runtimeMetadata === "available" ? "available" : "unavailable"}`,
    `runtime_detector_face=${runtimeFace === "available" ? "available" : "unavailable"}`,
    `runtime_detector_qr=${runtimeQr === "available" ? "available" : "unavailable"}`,
    `runtime_detector_barcode=${runtimeBarcode === "available" ? "available" : "unavailable"}`,
    `runtime_detector_pdf=${runtimePdf === "available" ? "available" : "unavailable"}`,
    `input_kind=${validInputKind(workflow.inputKind)}`,
    `workflow_state=${validWorkflowState(workflow.workflowState)}`,
    `input_size=${validBucket(workflow.inputSizeBucket)}`,
    `pages=${validPageCount(workflow.pageCount) ?? "not-applicable"}`,
    `last_error=${validErrorCode(workflow.lastErrorCode)}`,
    `detector_text=${validDetectorState(workflowText)}`,
    `detector_metadata=${validDetectorState(workflowMetadata)}`,
    `detector_face=${validDetectorState(workflowFace)}`,
    `detector_qr=${validDetectorState(workflowQr)}`,
    `detector_barcode=${validDetectorState(workflowBarcode)}`,
    `detector_pdf=${validDetectorState(workflowPdf)}`,
  ].join("\n");
}

export const diagnosticDetectorKeys = detectorKeys;
