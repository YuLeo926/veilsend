import type {
  CleanedPdfFile,
  ImageRect,
  ImageRedactionDecision,
  NormalizedRect,
  PdfPageSummary,
  PdfSession,
  Severity,
} from "./types";

export type PdfFindingKind = "text" | "face" | "qr" | "barcode";
export type PdfZoom = "fitWidth" | "fitPage" | 50 | 75 | 100 | 125 | 150 | 175 | 200;

const zooms = [50, 75, 100, 125, 150, 175, 200] as const;

export function stepPdfZoom(current: PdfZoom, direction: -1 | 1): PdfZoom {
  const value = typeof current === "number" ? current : 100;
  const index = zooms.indexOf(value);
  return zooms[Math.min(zooms.length - 1, Math.max(0, index + direction))];
}

export function clampPdfPage(current: number, pageCount: number, delta: -1 | 1): number {
  return Math.min(Math.max(pageCount - 1, 0), Math.max(0, current + delta));
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const candidate = target as { tagName?: unknown; isContentEditable?: unknown; closest?: Element["closest"] } | null;
  return Boolean(candidate && (candidate.isContentEditable === true
    || candidate.closest?.('[contenteditable]:not([contenteditable="false"])')
    || (typeof candidate.tagName === "string" && /^(INPUT|TEXTAREA|SELECT)$/.test(candidate.tagName))));
}

export function pdfShortcutAction(
  event: { key: string; target: EventTarget | null; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
  stage: "add" | "review" | "result",
  busy: boolean,
) {
  if (stage !== "review" || busy || event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) return null;
  if (event.key === "PageDown") return "nextPage" as const;
  if (event.key === "PageUp") return "previousPage" as const;
  if (event.key === "+" || event.key === "=") return "zoomIn" as const;
  if (event.key === "-") return "zoomOut" as const;
  if (event.key === "Escape") return "cancelDraft" as const;
  return null;
}

export function imageRectPercentStyle(rect: ImageRect, pageWidth: number, pageHeight: number): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  if (!Number.isFinite(pageWidth) || pageWidth <= 0 || !Number.isFinite(pageHeight) || pageHeight <= 0) {
    throw new Error("PDF page dimensions must be positive finite numbers");
  }
  return {
    left: `${(rect.x / pageWidth) * 100}%`,
    top: `${(rect.y / pageHeight) * 100}%`,
    width: `${(rect.width / pageWidth) * 100}%`,
    height: `${(rect.height / pageHeight) * 100}%`,
  };
}

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

export function normalizedRectangleFromPoints(
  originX: number,
  originY: number,
  x: number,
  y: number,
): NormalizedRect {
  return {
    x: Math.min(originX, x),
    y: Math.min(originY, y),
    width: Math.abs(x - originX),
    height: Math.abs(y - originY),
  };
}

export function resizeNormalizedRectangle(
  initial: NormalizedRect,
  startX: number,
  startY: number,
  x: number,
  y: number,
  minimumSize = 0.003,
): NormalizedRect {
  return {
    ...initial,
    width: Math.min(
      1 - initial.x,
      Math.max(minimumSize, initial.width + x - startX),
    ),
    height: Math.min(
      1 - initial.y,
      Math.max(minimumSize, initial.height + y - startY),
    ),
  };
}

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
