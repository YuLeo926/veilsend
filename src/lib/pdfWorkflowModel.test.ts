import { describe, expect, it } from "vitest";
import type { PdfSession } from "./types";
import {
  buildPdfDefaultDecisions,
  buildPdfFindings,
  normalizedRectangleFromPoints,
  pageChecksComplete,
  remainingPdfRiskCount,
  resizeNormalizedRectangle,
} from "./pdfWorkflowModel";

const session = {
  sessionId: "pdf-session",
  filename: "review.pdf",
  bytes: 100,
  pageCount: 2,
  warnings: [],
  pages: [
    {
      pageIndex: 0,
      widthPoints: 72,
      heightPoints: 72,
      widthPixels: 144,
      heightPixels: 144,
      thumbnailDataUrl: "data:image/png;base64,",
      ocr: {
        availability: "available",
        message: "checked",
        report: {
          findings: [{
            id: "pdf-page-0:text-1",
            ruleId: "personal.email",
            label: "Email",
            explanation: "Visible email",
            category: "personal",
            severity: "high",
            maskedValue: "al••ce",
            rectangles: [{ x: 1, y: 2, width: 3, height: 4 }],
            confidence: "notProvided",
          }],
          wordsDetected: 1,
          language: "en-US",
          confidence: "notProvided",
          warnings: [],
        },
      },
      faces: { availability: "available", findings: [], message: "checked" },
      qr: { availability: "available", report: { findings: [], gridsDetected: 0, decodedGrids: 0, warnings: [] }, message: "checked" },
      barcodes: { availability: "available", report: { findings: [], symbolsDetected: 0, decodedSymbols: 0, warnings: [] }, message: "checked" },
    },
    {
      pageIndex: 1,
      widthPoints: 72,
      heightPoints: 72,
      widthPixels: 144,
      heightPixels: 144,
      thumbnailDataUrl: "data:image/png;base64,",
      ocr: { availability: "needsReview", report: null, message: "review" },
      faces: { availability: "available", findings: [{ id: "pdf-page-1:face-1", label: "Face", explanation: "Visible face", severity: "high", rectangle: { x: 2, y: 3, width: 4, height: 5 } }], message: "checked" },
      qr: { availability: "available", report: { findings: [], gridsDetected: 0, decodedGrids: 0, warnings: [] }, message: "checked" },
      barcodes: { availability: "available", report: { findings: [], symbolsDetected: 0, decodedSymbols: 0, warnings: [] }, message: "checked" },
    },
  ],
} satisfies PdfSession;

describe("PDF workflow model", () => {
  it("keeps findings from different pages uniquely scoped and selected by default", () => {
    const findings = buildPdfFindings(session);
    const decisions = buildPdfDefaultDecisions(session);
    expect(findings.map((finding) => finding.id)).toEqual([
      "pdf-page-0:text-1",
      "pdf-page-1:face-1",
    ]);
    expect(Object.values(decisions).every((decision) => decision.enabled)).toBe(true);
  });

  it("reports incomplete page checks", () => {
    expect(pageChecksComplete(session.pages[0])).toBe(true);
    expect(pageChecksComplete(session.pages[1])).toBe(false);
  });

  it("counts all remaining saved-PDF visual risks", () => {
    expect(remainingPdfRiskCount({
      verification: {
        visualFindingsRemaining: 1,
        facesRemaining: 2,
        qrCodesRemaining: 3,
        barcodesRemaining: 4,
      },
    } as never)).toBe(10);
  });

  it("normalizes reverse-direction manual cover drawing", () => {
    expect(normalizedRectangleFromPoints(0.8, 0.7, 0.2, 0.1)).toEqual({
      x: 0.2,
      y: 0.1,
      width: 0.6000000000000001,
      height: 0.6,
    });
  });

  it("keeps resized manual covers inside the page and above the minimum", () => {
    const initial = { x: 0.8, y: 0.7, width: 0.1, height: 0.1 };
    expect(resizeNormalizedRectangle(initial, 0.9, 0.8, 1.4, 1.2)).toEqual({
      x: 0.8,
      y: 0.7,
      width: 0.19999999999999996,
      height: 0.30000000000000004,
    });
    expect(resizeNormalizedRectangle(initial, 0.9, 0.8, 0, 0)).toEqual({
      x: 0.8,
      y: 0.7,
      width: 0.003,
      height: 0.003,
    });
  });
});
