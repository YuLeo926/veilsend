import { describe, expect, it } from "vitest";
import type { CleanedImageFile, CleanedPdfFile, RuntimeInfo, SavedTextFile, SanitizeResult } from "./types";
import {
  formatVerificationReceipt,
  imageVerificationReceipt,
  pdfVerificationReceipt,
  textVerificationReceipt,
  type VerificationReceiptData,
} from "./verificationReceipt";

const runtime: RuntimeInfo = {
  appVersion: "0.2.0-beta.1",
  channel: "beta",
  commit: "0123456789ab",
  verifiedBuild: true,
  target: "windows-x86_64",
  osVersion: "10.0.26100.0",
  license: "MIT",
  detectors: { text: "available", metadata: "available", face: "available", qr: "available", barcode: "available", pdf: "available" },
};

const receiptFixture: VerificationReceiptData = {
  appVersion: runtime.appVersion,
  commit: runtime.commit,
  outputKind: "text",
  status: "verified",
  savedBytes: 42,
  pages: null,
  findingsRedacted: 2,
  exceptions: 0,
  remainingFindings: 0,
  detectors: { text: "complete", metadata: "notApplicable", face: "notApplicable", qr: "notApplicable", barcode: "notApplicable", pdf: "notApplicable" },
  outputFingerprint: "a".repeat(64),
};

describe("verification receipt formatting", () => {
  it("omits the output fingerprint and all undeclared fields by default", () => {
    const poisoned = {
      ...receiptFixture,
      savedPath: "C:\\Users\\Private\\secret.txt",
      filename: "secret.txt",
      sourceContent: "SG_RECEIPT_SECRET",
      error: "api_key=secret",
    } as VerificationReceiptData & Record<string, unknown>;
    const receipt = formatVerificationReceipt(poisoned);
    expect(receipt).toContain("status=verified");
    expect(receipt).toContain("detector_text=complete");
    expect(receipt).not.toContain(receiptFixture.outputFingerprint);
    expect(receipt).not.toMatch(/savedPath|filename|source|secret|api_key/i);
  });

  it("includes exactly one valid final-output fingerprint after opt-in", () => {
    const receipt = formatVerificationReceipt(receiptFixture, true);
    expect(receipt).toContain(`output_sha256=${receiptFixture.outputFingerprint}`);
    expect(receipt.match(/output_sha256=/g)).toHaveLength(1);
  });

  it("never reports verified when a detector is incomplete", () => {
    const receipt = formatVerificationReceipt({
      ...receiptFixture,
      detectors: { ...receiptFixture.detectors, text: "incomplete" },
    });
    expect(receipt).toContain("status=needsReview");
    expect(receipt).not.toContain("status=verified");
  });
});

describe("saved result adapters", () => {
  it("maps the final saved text fingerprint", () => {
    const saved: SavedTextFile = { savedPath: "C:\\private\\safe.txt", filename: "safe.txt", cleanedSize: 9, savedFingerprint: "b".repeat(64) };
    const result: SanitizeResult = { cleanedText: "safe text", verification: { status: "verified", remainingFindings: [], exceptions: 0, message: "ignored" } };
    const receipt = textVerificationReceipt(runtime, saved, result, 3);
    expect(receipt.outputFingerprint).toBe(saved.savedFingerprint);
    expect(receipt).not.toHaveProperty("savedPath");
    expect(receipt).not.toHaveProperty("filename");
  });

  it("directly maps CleanedImageFile.savedFingerprint and downgrades incomplete checks", () => {
    const result: CleanedImageFile = {
      savedPath: "C:\\private\\safe.png", filename: "safe.png", savedFingerprint: "c".repeat(64), previewDataUrl: "data:image/png;base64,private",
      originalBytes: 20, cleanedSize: 10, removedMetadataFindings: 1, redactedFindings: 2, redactedTextFindings: 1,
      redactedQrFindings: 0, redactedFaceFindings: 1, redactedBarcodeFindings: 0, redactedRegions: 2, exceptions: 0,
      verification: { status: "verified", metadataRemaining: 0, visualFindingsRemaining: 0, ocrChecked: true, qrCodesRemaining: 0, qrChecked: true, facesRemaining: 0, faceChecked: false, barcodesRemaining: 0, barcodeChecked: true, pixelsUnchanged: false, message: "ignored" },
    };
    const receipt = imageVerificationReceipt(runtime, result);
    expect(receipt.outputFingerprint).toBe(result.savedFingerprint);
    expect(receipt.detectors.face).toBe("incomplete");
    expect(receipt.status).toBe("needsReview");
    expect(receipt).not.toHaveProperty("savedPath");
    expect(receipt).not.toHaveProperty("previewDataUrl");
  });

  it("does not claim a detector completed when runtime capability is unavailable", () => {
    const saved: SavedTextFile = { savedPath: "ignored", filename: "ignored", cleanedSize: 4, savedFingerprint: "e".repeat(64) };
    const result: SanitizeResult = { cleanedText: "safe", verification: { status: "verified", remainingFindings: [], exceptions: 0, message: "ignored" } };
    const unavailableRuntime = { ...runtime, detectors: { ...runtime.detectors, text: "unavailable" as const } };
    const receipt = textVerificationReceipt(unavailableRuntime, saved, result, 0);
    expect(receipt.detectors.text).toBe("incomplete");
    expect(receipt.status).toBe("needsReview");
  });

  it("directly maps CleanedPdfFile.savedFingerprint and its final-file checks", () => {
    const result: CleanedPdfFile = {
      savedPath: "C:\\private\\safe.pdf", filename: "safe.pdf", savedFingerprint: "d".repeat(64), originalBytes: 30, cleanedSize: 12,
      pagesRebuilt: 2, redactedFindings: 3, redactedTextFindings: 2, redactedFaceFindings: 1, redactedQrFindings: 0,
      redactedBarcodeFindings: 0, manualRegions: 1, redactedRegions: 4, exceptions: 0,
      verification: { status: "verified", savedBytesMatch: true, pageCountMatch: false, pagesRendered: 2, visualFindingsRemaining: 0,
        ocrChecked: true, facesRemaining: 0, faceChecked: true, qrCodesRemaining: 0, qrChecked: true, barcodesRemaining: 0, barcodeChecked: true, message: "ignored" },
    };
    const receipt = pdfVerificationReceipt(runtime, result);
    expect(receipt.outputFingerprint).toBe(result.savedFingerprint);
    expect(receipt.detectors.pdf).toBe("incomplete");
    expect(receipt.status).toBe("needsReview");
    expect(receipt.pages).toBe(2);
    expect(receipt).not.toHaveProperty("savedPath");
    expect(receipt).not.toHaveProperty("filename");
  });
});
