import { describe, expect, it } from "vitest";
import {
  buildDefaultDecisions,
  buildVisualFindings,
  isImagePasteShortcut,
  remainingRiskCount,
} from "./imageWorkflowModel";
import type { CleanedImageFile, ImageSession } from "./types";

const rect = { x: 10, y: 20, width: 30, height: 40 };

function session(): ImageSession {
  return {
    sessionId: "session-test",
    sourceKind: "clipboard",
    filename: "clipboard-screenshot.png",
    previewDataUrl: "data:image/png;base64,",
    inspection: {
      format: "png",
      bytes: 100,
      width: 300,
      height: 200,
      findings: [],
      canCleanLosslessly: true,
      warnings: [],
      pixelFingerprint: "pixels",
    },
    ocr: {
      availability: "available",
      message: "complete",
      report: {
        findings: [{
          id: "text-1",
          ruleId: "personal.email",
          label: "Email",
          explanation: "Visible email",
          category: "personal",
          severity: "high",
          maskedValue: "hidden",
          rectangles: [rect],
          confidence: "notProvided",
        }],
        wordsDetected: 1,
        language: "en-US",
        confidence: "notProvided",
        warnings: [],
      },
    },
    faces: {
      availability: "available",
      message: "complete",
      findings: [{ id: "face-1", label: "Face", explanation: "Visible face", severity: "high", rectangle: rect }],
    },
    qr: {
      availability: "available",
      message: "complete",
      report: {
        findings: [{ id: "qr-1", kind: "encodedContent", label: "QR", explanation: "QR", severity: "high", maskedValue: "hidden", rectangle: rect }],
        gridsDetected: 1,
        decodedGrids: 1,
        warnings: [],
      },
    },
    barcodes: {
      availability: "available",
      message: "complete",
      report: {
        findings: [{ id: "barcode-1", kind: "code128", label: "Code 128", explanation: "Barcode", severity: "high", maskedValue: "18 encoded characters", encodedLength: 18, rectangle: rect }],
        symbolsDetected: 1,
        decodedSymbols: 1,
        warnings: [],
      },
    },
  };
}

describe("image workflow model", () => {
  it("orders every detector type and selects every finding by default", () => {
    const findings = buildVisualFindings(session());
    expect(findings.map((finding) => finding.type)).toEqual(["text", "face", "qr", "barcode"]);
    expect(Object.values(buildDefaultDecisions(session()))).toEqual(
      findings.map((finding) => ({ id: finding.id, enabled: true })),
    );
  });

  it("does not route paste shortcuts from editable controls or outside add stage", () => {
    const target = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable }) as unknown as EventTarget;
    expect(isImagePasteShortcut(target("DIV"), "add")).toBe(true);
    expect(isImagePasteShortcut(target("INPUT"), "add")).toBe(false);
    expect(isImagePasteShortcut(target("TEXTAREA"), "add")).toBe(false);
    expect(isImagePasteShortcut(target("DIV", true), "add")).toBe(false);
    expect(isImagePasteShortcut(target("DIV"), "review")).toBe(false);
  });

  it("counts every supported remaining risk in the receipt", () => {
    const result = {
      verification: {
        metadataRemaining: 1,
        visualFindingsRemaining: 2,
        facesRemaining: 3,
        qrCodesRemaining: 4,
        barcodesRemaining: 5,
      },
    } as CleanedImageFile;
    expect(remainingRiskCount(result)).toBe(15);
  });
});
