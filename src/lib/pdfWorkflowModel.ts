import type {
  CleanedPdfFile,
  ImageRect,
  ImageRedactionDecision,
  PdfPageSummary,
  PdfSession,
  Severity,
} from "./types";

export type PdfFindingKind = "text" | "face" | "qr" | "barcode";

export type PdfVisualFinding = {
  id: string;
  pageIndex: number;
  kind: PdfFindingKind;
  label: string;
  explanation: string;
  maskedValue: string;
  severity: Severity;
  rectangles: ImageRect[];
};

export function buildPdfPageFindings(page: PdfPageSummary): PdfVisualFinding[] {
  return [
    ...(page.ocr.report?.findings ?? []).map((finding) => ({
      id: finding.id,
      pageIndex: page.pageIndex,
      kind: "text" as const,
      label: finding.label,
      explanation: finding.explanation,
      maskedValue: finding.maskedValue,
      severity: finding.severity,
      rectangles: finding.rectangles,
    })),
    ...page.faces.findings.map((finding) => ({
      id: finding.id,
      pageIndex: page.pageIndex,
      kind: "face" as const,
      label: finding.label,
      explanation: finding.explanation,
      maskedValue: "Face region · crop not stored",
      severity: finding.severity,
      rectangles: [finding.rectangle],
    })),
    ...(page.qr.report?.findings ?? []).map((finding) => ({
      id: finding.id,
      pageIndex: page.pageIndex,
      kind: "qr" as const,
      label: finding.label,
      explanation: finding.explanation,
      maskedValue: finding.maskedValue,
      severity: finding.severity,
      rectangles: [finding.rectangle],
    })),
    ...(page.barcodes.report?.findings ?? []).map((finding) => ({
      id: finding.id,
      pageIndex: page.pageIndex,
      kind: "barcode" as const,
      label: finding.label,
      explanation: finding.explanation,
      maskedValue: finding.maskedValue,
      severity: finding.severity,
      rectangles: [finding.rectangle],
    })),
  ];
}

export function buildPdfFindings(session: PdfSession): PdfVisualFinding[] {
  return session.pages.flatMap(buildPdfPageFindings);
}

export function buildPdfDefaultDecisions(
  session: PdfSession,
): Record<string, ImageRedactionDecision> {
  return Object.fromEntries(
    buildPdfFindings(session).map((finding) => [finding.id, {
      id: finding.id,
      enabled: true,
    }]),
  );
}

export function pageChecksComplete(page: PdfPageSummary): boolean {
  return page.ocr.availability === "available"
    && page.ocr.report !== null
    && page.faces.availability === "available"
    && page.qr.availability === "available"
    && page.qr.report !== null
    && page.barcodes.availability === "available"
    && page.barcodes.report !== null;
}

export function remainingPdfRiskCount(result: CleanedPdfFile): number {
  return result.verification.visualFindingsRemaining
    + result.verification.facesRemaining
    + result.verification.qrCodesRemaining
    + result.verification.barcodesRemaining;
}
