// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { ImageSession, PdfSession, RuntimeInfo, SanitizeRequest, SanitizeResult, ScanReport } from "./lib/types";

const bridge = vi.hoisted(() => ({
  getRuntimeInfo: vi.fn(), scanText: vi.fn(), sanitizeText: vi.fn(), saveCleanedText: vi.fn(),
  pickImage: vi.fn(), clearImageSession: vi.fn(),
  pickPdf: vi.fn(), openDroppedPdf: vi.fn(), clearPdfSession: vi.fn(), getPdfPagePreview: vi.fn(),
}));
const nativeDrop = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: nativeDrop.listen }) }));
let dropListener: (event: { payload: { type: "drop"; paths: string[] } }) => void;

vi.mock("./lib/bridge", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lib/bridge")>(),
  ...bridge,
  isDesktop: () => true,
}));

const runtime: RuntimeInfo = {
  appVersion: "0.2.0-beta.1", channel: "development", commit: "unverified", verifiedBuild: false,
  target: "windows-x86_64", osVersion: "unknown", license: "MIT",
  detectors: { text: "available", metadata: "available", face: "available", qr: "available", barcode: "available", pdf: "available" },
};
const scanReport: ScanReport = {
  contentFingerprint: "synthetic-fingerprint", stats: { bytes: 13, rulesRun: 1, durationMs: 1 }, warnings: [],
  findings: [{
    id: "finding-1", ruleId: "synthetic-rule", label: "Synthetic credential", explanation: "Synthetic finding",
    category: "credential", severity: "high", start: 0, end: 13, maskedValue: "[hidden]", context: "[hidden]",
    replacement: "[REDACTED]", matchFingerprint: "synthetic-match",
  }],
};
const cleanResult: SanitizeResult = {
  cleanedText: "[REDACTED]",
  verification: { status: "verified", remainingFindings: [], exceptions: 0, message: "Verified" },
};
const oldSession: ImageSession = {
  sessionId: "old-session", sourceKind: "file", filename: "old.png", previewDataUrl: "data:image/png;base64,preview",
  inspection: { format: "png", bytes: 1024, width: 10, height: 10, findings: [], canCleanLosslessly: true, warnings: [], pixelFingerprint: "ignored" },
  ocr: { availability: "available", report: { findings: [], wordsDetected: 0, language: null, confidence: "notProvided", warnings: [] }, message: "checked" },
  faces: { availability: "available", findings: [], message: "checked" },
  qr: { availability: "available", report: { findings: [], gridsDetected: 0, decodedGrids: 0, warnings: [] }, message: "checked" },
  barcodes: { availability: "available", report: { findings: [], symbolsDetected: 0, decodedSymbols: 0, warnings: [] }, message: "checked" },
};
const newSession: ImageSession = { ...oldSession, sessionId: "new-session", filename: "new.png" };
const oldPdf: PdfSession = { sessionId: "old-pdf", filename: "synthetic.pdf", bytes: 1024, pageCount: 1, warnings: [], pages: [{ pageIndex: 0, widthPoints: 100, heightPoints: 100, widthPixels: 200, heightPixels: 200, thumbnailDataUrl: oldSession.previewDataUrl, ocr: oldSession.ocr, faces: oldSession.faces, qr: oldSession.qr, barcodes: oldSession.barcodes }] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}

let container: HTMLDivElement;
let root: Root;
let writeText: ReturnType<typeof vi.fn>;

function button(label: string): HTMLButtonElement {
  const target = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim().startsWith(label));
  if (!target) throw new Error(`Missing button: ${label}`);
  return target;
}

function brand(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('button[aria-label="Start a new VeilSend scan"]')!;
}

function source(): HTMLTextAreaElement {
  return container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Content to scan"]')!;
}

async function setText(value: string) {
  const field = source();
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, value);
  await act(async () => { field.dispatchEvent(new Event("input", { bubbles: true })); });
}

function offerFile(file: File, via: "chooser" | "drop") {
  if (via === "chooser") {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    container.querySelector(".input-card")!.dispatchEvent(event);
  }
}

async function renderApp() {
  await act(async () => { root.render(<App />); });
}

async function openOldImage() {
  bridge.pickImage.mockResolvedValueOnce(oldSession);
  await renderApp();
  await act(async () => { button("Images").click(); });
  await act(async () => { button("Choose image").click(); });
  expect(container.textContent).toContain("old.png");
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.values(bridge).forEach((mock) => mock.mockReset());
  bridge.getRuntimeInfo.mockResolvedValue(runtime);
  bridge.clearImageSession.mockResolvedValue(undefined);
  bridge.clearPdfSession.mockResolvedValue(undefined);
  bridge.getPdfPagePreview.mockResolvedValue({ pageIndex: 0, width: 200, height: 200, previewDataUrl: oldSession.previewDataUrl });
  nativeDrop.listen.mockImplementation((listener) => { dropListener = listener; return Promise.resolve(vi.fn()); });
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.stubGlobal("scrollTo", vi.fn());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

describe("App text operation boundaries", () => {
  it.each(["chooser", "drop"] as const)("rejects %s replacement during a scan and unlocks when that scan finishes", async (via) => {
    const pending = deferred<ScanReport>();
    bridge.scanText.mockReturnValueOnce(pending.promise).mockResolvedValue(scanReport);
    await renderApp();
    await setText("synthetic key");
    const replacement = new File(["new text"], "replacement.txt", { type: "text/plain" });
    const readFile = vi.fn().mockResolvedValue("new text");
    Object.defineProperty(replacement, "text", { value: readFile });

    // Offer a replacement before React has committed disabled controls too.
    await act(async () => { button("Scan locally").click(); offerFile(replacement, via); });
    expect.soft(readFile).not.toHaveBeenCalled();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const openPicker = vi.spyOn(input, "click");
    expect.soft(button("Choose file").disabled).toBe(true);
    expect.soft(input.disabled).toBe(true);
    expect.soft(source().disabled).toBe(true);
    expect.soft(container.querySelector(".input-card")?.getAttribute("aria-disabled")).toBe("true");
    await act(async () => { button("Choose file").click(); offerFile(replacement, via); });
    expect.soft(openPicker).not.toHaveBeenCalled();
    expect.soft(readFile).not.toHaveBeenCalled();
    expect.soft(source().value).toBe("synthetic key");

    await act(async () => { pending.resolve(scanReport); });
    expect(container.textContent).toContain("Review before cleaning");
    expect(button("Clean & verify").disabled).toBe(false);
    await act(async () => { button("Back to source").click(); });
    expect(button("Choose file").disabled).toBe(false);
    expect(source().disabled).toBe(false);
    await act(async () => { offerFile(replacement, via); });
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(source().value).toBe("new text");
    await act(async () => { button("Scan locally").click(); });
    expect(bridge.scanText).toHaveBeenLastCalledWith("new text", expect.any(Object));
    expect(button("Clean & verify").disabled).toBe(false);
  });

  it("freezes pending sanitize decisions and binds the saved receipt count to its request", async () => {
    const pending = deferred<SanitizeResult>();
    bridge.scanText.mockResolvedValue(scanReport);
    bridge.sanitizeText.mockReturnValueOnce(pending.promise);
    bridge.saveCleanedText.mockResolvedValue({
      savedPath: "C:\\synthetic\\cleaned.txt", filename: "cleaned.txt", cleanedSize: 10, savedFingerprint: "a".repeat(64),
    });
    await renderApp();
    await setText("synthetic key");
    await act(async () => { button("Scan locally").click(); });
    const decision = container.querySelector<HTMLButtonElement>(".finding-check")!;
    const replacement = container.querySelector<HTMLInputElement>(".replacement-field input")!;
    await act(async () => { button("Clean & verify").click(); decision.click(); });
    expect.soft(decision.disabled).toBe(true);
    expect.soft(replacement.disabled).toBe(true);
    expect.soft(button("Back to source").disabled).toBe(true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(replacement, "changed after submit");
      replacement.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect.soft(decision.getAttribute("aria-pressed")).toBe("true");
    const submitted = bridge.sanitizeText.mock.calls[0][0] as SanitizeRequest;
    expect(submitted.decisions).toEqual([{ id: "finding-1", enabled: true, replacement: "[REDACTED]" }]);

    await act(async () => { pending.resolve(cleanResult); });
    await act(async () => { button("Save clean copy").click(); });
    await act(async () => { button("Copy verification receipt").click(); });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("findings_redacted=1\n"));
    expect(writeText.mock.calls[0][0]).not.toContain("output_sha256=");
    expect(bridge.saveCleanedText).toHaveBeenCalledWith("pasted-text.cleaned.txt", "[REDACTED]");
  });
});

describe("App global PDF navigation", () => {
  it.each(["picker", "drop"] as const)("blocks brand reset during pending PDF %s before a render", async (route) => {
    const pending = deferred<PdfSession>();
    (route === "picker" ? bridge.pickPdf : bridge.openDroppedPdf).mockReturnValueOnce(pending.promise);
    await renderApp(); await act(async () => button("PDF").click());
    await act(async () => {
      if (route === "picker") button("Choose PDF").click();
      else dropListener({ payload: { type: "drop", paths: ["synthetic.pdf"] } });
      brand().click();
    });
    expect(container.querySelector(".pdf-add-stage")).not.toBeNull();
    expect(brand().disabled).toBe(true);
    await act(async () => pending.resolve(oldPdf));
    expect(container.querySelector(".pdf-review-stage")).not.toBeNull();
  });

  it("serializes PDF restart/global brand cleanup before the next native session", async () => {
    const cleanup = deferred<void>();
    let backend: PdfSession | null = oldPdf;
    bridge.pickPdf.mockResolvedValueOnce(oldPdf);
    bridge.clearPdfSession.mockImplementationOnce(async () => { await cleanup.promise; backend = null; });
    await renderApp(); await act(async () => button("PDF").click()); await act(async () => button("Choose PDF").click());
    await act(async () => { button("Choose a different PDF").click(); brand().click(); });
    expect(container.querySelector(".pdf-add-stage")).not.toBeNull();
    expect(brand().disabled).toBe(true);
    expect(bridge.clearPdfSession).toHaveBeenCalledTimes(1);
    await act(async () => cleanup.resolve());
    await act(async () => brand().click());
    expect(container.textContent).toContain("Catch what should not");
    const next = { ...oldPdf, sessionId: "new-pdf" };
    bridge.openDroppedPdf.mockImplementationOnce(async () => { backend = next; return next; });
    await act(async () => button("PDF").click());
    await act(async () => dropListener({ payload: { type: "drop", paths: ["new.pdf"] } }));
    expect(backend).toBe(next);
    expect(bridge.clearPdfSession).toHaveBeenCalledTimes(1);
    expect(bridge.getPdfPagePreview).toHaveBeenLastCalledWith("new-pdf", 0);
  });

  it("runs PDF review brand reset through cleanup and stays locked on cleanup failure", async () => {
    const cleanup = deferred<void>(); bridge.pickPdf.mockResolvedValueOnce(oldPdf); bridge.clearPdfSession.mockReturnValueOnce(cleanup.promise);
    await renderApp(); await act(async () => button("PDF").click()); await act(async () => button("Choose PDF").click());
    await act(async () => { brand().click(); brand().click(); });
    expect(bridge.clearPdfSession).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".pdf-review-stage")).not.toBeNull();
    await act(async () => cleanup.reject(new Error("C:\\private\\cleanup")));
    expect(brand().disabled).toBe(true);
    expect(container.textContent).toContain("Could not clear the previous PDF session");
    expect(container.textContent).not.toContain("private");
  });
});

describe("App global image navigation", () => {
  it("clears the active image through the same gate before a brand reset can enter a new session", async () => {
    const pendingCleanup = deferred<void>();
    let backendSession: ImageSession | null = oldSession;
    bridge.clearImageSession.mockImplementationOnce(async () => { await pendingCleanup.promise; backendSession = null; });
    await openOldImage();
    const reset = brand();
    await act(async () => { reset.click(); reset.click(); });
    expect(bridge.clearImageSession).toHaveBeenCalledTimes(1);
    expect(brand().disabled).toBe(true);
    expect(container.textContent).toContain("old.png");
    expect(backendSession).toBe(oldSession);

    await act(async () => { pendingCleanup.resolve(); });
    expect(container.textContent).toContain("Catch what should not");
    expect(brand().disabled).toBe(false);
    expect(backendSession).toBeNull();
    await act(async () => { button("Images").click(); });
    bridge.pickImage.mockImplementationOnce(async () => { backendSession = newSession; return newSession; });
    await act(async () => { button("Choose image").click(); });
    expect(container.textContent).toContain("new.png");
    expect(backendSession).toBe(newSession);
    expect(bridge.clearImageSession).toHaveBeenCalledTimes(1);
  });

  it("does not let the brand button bypass an already pending image restart cleanup", async () => {
    const pendingCleanup = deferred<void>();
    let backendSession: ImageSession | null = oldSession;
    bridge.clearImageSession.mockImplementationOnce(async () => { await pendingCleanup.promise; backendSession = null; });
    await openOldImage();
    bridge.pickImage.mockImplementationOnce(async () => { backendSession = newSession; return newSession; });
    // The brand click also runs before the first disabled-state render.
    await act(async () => { button("Choose a different image").click(); brand().click(); });
    await act(async () => { button("Images").click(); });
    await act(async () => { button("Choose image").click(); });
    expect.soft(bridge.pickImage).toHaveBeenCalledTimes(1);
    expect.soft(brand().disabled).toBe(true);
    expect.soft(bridge.clearImageSession).toHaveBeenCalledTimes(1);
    expect.soft(backendSession).toBe(oldSession);

    await act(async () => { pendingCleanup.resolve(); });
    expect(container.textContent).not.toContain("new.png");
    expect(brand().disabled).toBe(false);
    await act(async () => { brand().click(); });
    await act(async () => { button("Images").click(); });
    await act(async () => { button("Choose image").click(); });
    expect(container.textContent).toContain("new.png");
    expect(backendSession).toBe(newSession);
  });

  it("keeps the brand and navigation blocked after image cleanup fails", async () => {
    const pendingCleanup = deferred<void>();
    bridge.clearImageSession.mockReturnValueOnce(pendingCleanup.promise);
    await openOldImage();
    await act(async () => { brand().click(); });
    expect(bridge.clearImageSession).toHaveBeenCalledTimes(1);
    await act(async () => { pendingCleanup.reject(new Error("synthetic private cleanup failure")); });
    expect(brand().disabled).toBe(true);
    expect(container.textContent).toContain("Could not clear the previous image session.");
    expect(container.textContent).not.toContain("synthetic private cleanup failure");
    await act(async () => { brand().click(); button("Choose a different image").click(); });
    expect(container.textContent).toContain("old.png");
    expect(bridge.clearImageSession).toHaveBeenCalledTimes(1);
  });

  it("cannot unmount a pending image picker through a reentrant brand click", async () => {
    const pendingPick = deferred<ImageSession | null>();
    bridge.pickImage.mockReturnValueOnce(pendingPick.promise);
    await renderApp();
    await act(async () => { button("Images").click(); });
    await act(async () => { button("Choose image").click(); brand().click(); });
    expect(brand().disabled).toBe(true);
    expect(container.textContent).toContain("Inspect one image");
    await act(async () => { pendingPick.resolve(newSession); });
    expect(container.textContent).toContain("new.png");
    expect(brand().disabled).toBe(false);
  });
});
