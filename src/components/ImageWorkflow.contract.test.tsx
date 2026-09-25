// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageWorkflow } from "./ImageWorkflow";
import type { CleanedImageFile, ImageSession } from "../lib/types";

const cleanImageFile = vi.hoisted(() => vi.fn());
const clearImageSession = vi.hoisted(() => vi.fn());
const pickImage = vi.hoisted(() => vi.fn());

vi.mock("../lib/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/bridge")>();
  return { ...actual, cleanImageFile, clearImageSession, pickImage, isDesktop: () => true };
});

type Stage = "add" | "review" | "result";
let container: HTMLDivElement;
let root: Root;

const session: ImageSession = {
  sessionId: "session-1", sourceKind: "file", filename: "private.png", previewDataUrl: "data:image/png;base64,preview",
  inspection: { format: "png", bytes: 1024, width: 10, height: 10, findings: [], canCleanLosslessly: true, warnings: [], pixelFingerprint: "ignored" },
  ocr: { availability: "available", report: { findings: [], wordsDetected: 0, language: null, confidence: "notProvided", warnings: [] }, message: "checked" },
  faces: { availability: "available", findings: [], message: "checked" },
  qr: { availability: "available", report: { findings: [], gridsDetected: 0, decodedGrids: 0, warnings: [] }, message: "checked" },
  barcodes: { availability: "available", report: { findings: [], symbolsDetected: 0, decodedSymbols: 0, warnings: [] }, message: "checked" },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}

function button(label: string) {
  const target = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim().startsWith(label));
  if (!target) throw new Error(`Missing button: ${label}`);
  return target as HTMLButtonElement;
}

function Harness({ onError }: { onError: (message: string) => void }) {
  const [stage, setStage] = useState<Stage>("add");
  return <ImageWorkflow stage={stage} onStageChange={setStage} onSwitchMode={vi.fn()} onError={onError} onDiagnosticsChange={vi.fn()} />;
}

async function beginPendingClean(onError: (message: string) => void) {
  pickImage.mockResolvedValueOnce(session);
  await act(async () => { root.render(<Harness onError={onError} />); });
  await act(async () => { button("Choose image").click(); await Promise.resolve(); });
  await act(async () => { button("Clean, save & verify").click(); });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  cleanImageFile.mockReset();
  clearImageSession.mockReset();
  clearImageSession.mockResolvedValue(undefined);
  pickImage.mockReset();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe("ImageWorkflow cancellation", () => {
  it("waits for old-session cleanup before unlocking a new picker and ignores an old clean completion", async () => {
    const oldClean = deferred<CleanedImageFile | null>();
    const oldCleanup = deferred<void>();
    const newPick = deferred<ImageSession | null>();
    const onError = vi.fn();
    cleanImageFile.mockReturnValueOnce(oldClean.promise);
    clearImageSession.mockReturnValueOnce(oldCleanup.promise);
    await beginPendingClean(onError);

    await act(async () => { button("Choose a different image").click(); });
    expect(container.textContent).toContain("Inspect one image");
    expect(button("Choose image").disabled).toBe(true);

    oldClean.resolve(null);
    await act(async () => { await Promise.resolve(); });
    expect(button("Choose image").disabled).toBe(true);

    oldCleanup.resolve();
    await act(async () => { await Promise.resolve(); });
    expect(button("Choose image").disabled).toBe(false);
    pickImage.mockReturnValueOnce(newPick.promise);
    await act(async () => { button("Choose image").click(); });
    expect(button("Choose image").disabled).toBe(true);
    newPick.resolve(session);
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("Image safety review");
    expect(container.textContent).toContain("private.png");
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining("old"));
  });

  it("does not surface a cancelled clean rejection or clear a newly accepted session", async () => {
    const oldClean = deferred<CleanedImageFile | null>();
    const oldCleanup = deferred<void>();
    const newPick = deferred<ImageSession | null>();
    const onError = vi.fn();
    cleanImageFile.mockReturnValueOnce(oldClean.promise);
    clearImageSession.mockReturnValueOnce(oldCleanup.promise);
    await beginPendingClean(onError);
    await act(async () => { button("Choose a different image").click(); });
    expect(button("Choose image").disabled).toBe(true);
    oldCleanup.resolve();
    await act(async () => { await Promise.resolve(); });
    pickImage.mockReturnValueOnce(newPick.promise);
    await act(async () => { button("Choose image").click(); });
    newPick.resolve(session);
    await act(async () => { await Promise.resolve(); });

    oldClean.reject(new Error("old clean failure"));
    await act(async () => { await Promise.resolve(); });
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining("old clean failure"));
    expect(container.textContent).toContain("Image safety review");
    expect(container.textContent).toContain("private.png");
  });

  it("keeps image selection blocked with fixed feedback when old-session cleanup fails", async () => {
    const oldClean = deferred<CleanedImageFile | null>();
    const oldCleanup = deferred<void>();
    const onError = vi.fn();
    cleanImageFile.mockReturnValueOnce(oldClean.promise);
    clearImageSession.mockReturnValueOnce(oldCleanup.promise);
    await beginPendingClean(onError);
    await act(async () => { button("Choose a different image").click(); });

    oldCleanup.reject(new Error("C:\\private\\cleanup failure"));
    await act(async () => { await Promise.resolve(); });
    expect(button("Choose image").disabled).toBe(true);
    expect(onError).toHaveBeenCalledWith("Could not clear the previous image session. Restart VeilSend before choosing another image.", "workflowFailed");
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining("private"));
  });
});
