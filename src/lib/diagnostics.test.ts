import { describe, expect, it } from "vitest";
import {
  bucketInputBytes,
  deriveImageDiagnostics,
  derivePdfDiagnostics,
  diagnosticDetectorState,
  emptyWorkflowDiagnostics,
  formatDiagnostics,
  type WorkflowDiagnostics,
} from "./diagnostics";

const runtimeFixture = {
  appVersion: "0.2.0-beta.1", channel: "beta", commit: "0123456789ab",
  verifiedBuild: true, target: "windows-x86_64", osVersion: "10.0.26100.0", license: "MIT",
  detectors: { text: "available", metadata: "available", face: "available", qr: "available", barcode: "available", pdf: "available" },
} as const;

describe("privacy-safe diagnostics", () => {
  it("formats only the diagnostic allowlist in a fixed order", () => {
    const workflow: WorkflowDiagnostics = {
      inputKind: "pdf", workflowState: "result", inputSizeBucket: "10-50 MiB", pageCount: 3,
      lastErrorCode: "none",
      detectors: { text: "complete", metadata: "notApplicable", face: "complete", qr: "complete", barcode: "complete", pdf: "complete" },
    };
    const output = formatDiagnostics(runtimeFixture, workflow);
    expect(output).toContain("input_kind=pdf");
    expect(output).toContain("pages=3");
    expect(output).toContain("detector_text=complete\ndetector_metadata=notApplicable\ndetector_face=complete\ndetector_qr=complete\ndetector_barcode=complete\ndetector_pdf=complete");
    expect(output).not.toMatch(/filename|path|content|sha256|ocr_text|rectangle/i);
  });

  it("cannot serialize poisoned top-level, runtime, or detector values", () => {
    const poisonedWorkflow = {
      ...emptyWorkflowDiagnostics("image"),
      sourcePath: "C:\\Users\\Private\\secret.pdf",
      filename: "PRIVATE_FILENAME.pdf",
      sourceContent: "SG_DIAGNOSTIC_SECRET",
      ocrText: "api_key=secret",
      customTerms: ["Project Whisper"],
      previewDataUrl: "data:image/png;base64,PRIVATE_PREVIEW",
      payload: "PRIVATE_CODE_PAYLOAD",
      savedFingerprint: "SECRET_OUTPUT_HASH",
      humanError: "INTERNAL_HUMAN_ERROR",
      detectors: {
        ...emptyWorkflowDiagnostics("image").detectors,
        unexpected: "NESTED_DETECTOR_SECRET",
      },
    } as WorkflowDiagnostics & Record<string, unknown>;
    const poisonedRuntime = {
      ...runtimeFixture,
      buildPath: "C:\\private\\build",
      detectors: { ...runtimeFixture.detectors, extra: "RUNTIME_DETECTOR_SECRET" },
    } as typeof runtimeFixture & Record<string, unknown>;
    const output = formatDiagnostics(poisonedRuntime, poisonedWorkflow);
    for (const sentinel of [
      "C:\\Users\\Private\\secret.pdf", "PRIVATE_FILENAME.pdf", "SG_DIAGNOSTIC_SECRET", "api_key=secret",
      "Project Whisper", "PRIVATE_PREVIEW", "PRIVATE_CODE_PAYLOAD", "SECRET_OUTPUT_HASH", "INTERNAL_HUMAN_ERROR", "NESTED_DETECTOR_SECRET", "C:\\private\\build", "RUNTIME_DETECTOR_SECRET",
    ]) expect(output).not.toContain(sentinel);
  });

  it("buckets only bounded size facts and never upgrades incomplete detector evidence", () => {
    expect(bucketInputBytes(null)).toBe("none");
    expect(bucketInputBytes(0)).toBe("under 1 MiB");
    expect(bucketInputBytes(1024 * 1024)).toBe("1-10 MiB");
    expect(bucketInputBytes(10 * 1024 * 1024)).toBe("10-50 MiB");
    expect(bucketInputBytes(50 * 1024 * 1024 + 1)).toBe("over limit");
    expect(diagnosticDetectorState("unavailable", true)).toBe("unavailable");
    expect(diagnosticDetectorState("failed", true)).toBe("failed");
    expect(diagnosticDetectorState("notRun", true)).toBe("notRun");
    expect(diagnosticDetectorState("notApplicable", true)).toBe("notApplicable");
    expect(diagnosticDetectorState("complete", false)).toBe("failed");
  });

  it("derives image and PDF detector status only from bounded completion facts", () => {
    const image = deriveImageDiagnostics({
      stage: "result", inputBytes: 4 * 1024 * 1024, metadataInspected: true,
      textAvailability: "available", faceAvailability: "unavailable", qrAvailability: "needsReview", barcodeAvailability: "available",
      resultChecks: { text: true, face: true, qr: true, barcode: false },
    });
    expect(image.detectors).toMatchObject({ text: "complete", metadata: "complete", face: "unavailable", qr: "failed", barcode: "failed", pdf: "notApplicable" });

    const pdf = derivePdfDiagnostics({
      stage: "result", inputBytes: 12 * 1024 * 1024, pageCount: 2,
      pages: [
        { textAvailability: "available", faceAvailability: "available", qrAvailability: "available", barcodeAvailability: "available" },
        { textAvailability: "available", faceAvailability: "unavailable", qrAvailability: "available", barcodeAvailability: "available" },
      ],
      resultChecks: { savedBytesMatch: true, pageCountMatch: false, pagesRendered: 2, pagesRebuilt: 2, text: true, face: true, qr: true, barcode: true },
    });
    expect(pdf.pageCount).toBe(2);
    expect(pdf.detectors).toMatchObject({ text: "complete", face: "unavailable", qr: "complete", barcode: "complete", pdf: "failed" });
  });

  it("never marks a PDF complete without a valid non-empty session and page evidence", () => {
    const empty = derivePdfDiagnostics({
      stage: "review", inputBytes: null, pageCount: null, pages: [], resultChecks: null,
    });
    expect(empty.pageCount).toBeNull();
    expect(empty.detectors).toMatchObject({ text: "failed", face: "failed", qr: "failed", barcode: "failed", pdf: "failed" });

    const invalidCount = derivePdfDiagnostics({
      stage: "review", inputBytes: 1024, pageCount: 0, pages: [], resultChecks: null,
    });
    expect(invalidCount.pageCount).toBeNull();
    expect(invalidCount.detectors.pdf).toBe("failed");
  });

  it("requires bounded positive PDF bytes as part of every complete PDF session", () => {
    const pages = [{ textAvailability: "available", faceAvailability: "available", qrAvailability: "available", barcodeAvailability: "available" }] as const;
    for (const [stage, inputBytes, resultChecks] of [
      ["review", null, null],
      ["review", 0, null],
      ["review", -1, null],
      ["review", Number.NaN, null],
      ["review", Number.POSITIVE_INFINITY, null],
      ["review", 50 * 1024 * 1024 + 1, null],
      ["result", null, { savedBytesMatch: true, pageCountMatch: true, pagesRendered: 1, pagesRebuilt: 1, text: true, face: true, qr: true, barcode: true }],
    ] as const) {
      const diagnostics = derivePdfDiagnostics({ stage, inputBytes, pageCount: 1, pages, resultChecks });
      expect(diagnostics.detectors.pdf, `${stage}/${inputBytes}`).toBe("failed");
    }

    const valid = derivePdfDiagnostics({ stage: "review", inputBytes: 50 * 1024 * 1024, pageCount: 1, pages, resultChecks: null });
    expect(valid.detectors.pdf).toBe("complete");
    const validResult = derivePdfDiagnostics({
      stage: "result", inputBytes: 50 * 1024 * 1024, pageCount: 1, pages,
      resultChecks: { savedBytesMatch: true, pageCountMatch: true, pagesRendered: 1, pagesRebuilt: 1, text: true, face: true, qr: true, barcode: true },
    });
    expect(validResult.detectors.pdf).toBe("complete");
    const oversizedResult = derivePdfDiagnostics({
      stage: "result", inputBytes: 50 * 1024 * 1024 + 1, pageCount: 1, pages,
      resultChecks: { savedBytesMatch: true, pageCountMatch: true, pagesRendered: 1, pagesRebuilt: 1, text: true, face: true, qr: true, barcode: true },
    });
    expect(oversizedResult.detectors.pdf).toBe("failed");

    const malformedPages = [{ textAvailability: "available", faceAvailability: "unknown", qrAvailability: "available", barcodeAvailability: "available" }] as unknown as typeof pages;
    expect(derivePdfDiagnostics({ stage: "review", inputBytes: 1, pageCount: 1, pages: malformedPages, resultChecks: null }).detectors.pdf).toBe("failed");
  });

  it("normalizes poisoned closed values and invalid page counts without outputting their values", () => {
    const poisoned = {
      ...emptyWorkflowDiagnostics("text"),
      inputKind: "PRIVATE_INPUT_KIND",
      workflowState: "PRIVATE_STATE",
      inputSizeBucket: "PRIVATE_BUCKET",
      pageCount: Number.NaN,
      lastErrorCode: "PRIVATE_ERROR",
      detectors: { ...emptyWorkflowDiagnostics("text").detectors, text: "PRIVATE_DETECTOR" },
    } as unknown as WorkflowDiagnostics;
    const output = formatDiagnostics(runtimeFixture, poisoned);
    expect(output).toContain("input_kind=text\nworkflow_state=add\ninput_size=none\npages=not-applicable\nlast_error=workflowFailed\ndetector_text=failed");
    for (const invalid of ["PRIVATE_INPUT_KIND", "PRIVATE_STATE", "PRIVATE_BUCKET", "PRIVATE_ERROR", "PRIVATE_DETECTOR", "NaN", "Infinity", "-1", "51"]) {
      expect(output).not.toContain(invalid);
    }
    for (const invalidPage of [Number.POSITIVE_INFINITY, -1, 51]) {
      expect(formatDiagnostics(runtimeFixture, { ...poisoned, pageCount: invalidPage })).toContain("pages=not-applicable");
    }
  });
});
