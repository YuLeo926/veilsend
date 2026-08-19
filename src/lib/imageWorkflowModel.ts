import type {
  CleanedImageFile,
  ImageRect,
  ImageRedactionDecision,
  ImageSession,
} from "./types";

export type VisualFindingView = {
  id: string;
  type: "text" | "face" | "qr" | "barcode";
  rectangles: ImageRect[];
};

export function buildVisualFindings(session: ImageSession): VisualFindingView[] {
  return [
    ...(session.ocr.report?.findings ?? []).map((finding) => ({
      id: finding.id,
      type: "text" as const,
      rectangles: finding.rectangles,
    })),
    ...session.faces.findings.map((finding) => ({
      id: finding.id,
      type: "face" as const,
      rectangles: [finding.rectangle],
    })),
    ...(session.qr.report?.findings ?? []).map((finding) => ({
      id: finding.id,
      type: "qr" as const,
      rectangles: [finding.rectangle],
    })),
    ...(session.barcodes.report?.findings ?? []).map((finding) => ({
      id: finding.id,
      type: "barcode" as const,
      rectangles: [finding.rectangle],
    })),
  ];
}

export function buildDefaultDecisions(
  session: ImageSession,
): Record<string, ImageRedactionDecision> {
  return Object.fromEntries(
    buildVisualFindings(session).map((finding) => [finding.id, {
      id: finding.id,
      enabled: true,
    }]),
  );
}

export function isImagePasteShortcut(
  eventTarget: EventTarget | null,
  stage: "add" | "review" | "result",
): boolean {
  if (stage !== "add") return false;
  const target = eventTarget as {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
  } | null;
  const tagName = target?.tagName?.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || target?.isContentEditable) {
    return false;
  }
  return !target?.closest?.("input, textarea, [contenteditable='true'], [contenteditable='']");
}

export function remainingRiskCount(result: CleanedImageFile): number {
  const verification = result.verification;
  return verification.metadataRemaining
    + verification.visualFindingsRemaining
    + verification.facesRemaining
    + verification.qrCodesRemaining
    + verification.barcodesRemaining;
}
