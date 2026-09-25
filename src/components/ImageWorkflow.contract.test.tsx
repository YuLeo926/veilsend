// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageWorkflow } from "./ImageWorkflow";
import type { CleanedImageFile, ImageSession } from "../lib/types";
import { InputModeTabs, type InputMode } from "./InputModeTabs";

const cleanImageFile = vi.hoisted(() => vi.fn());
const clearImageSession = vi.hoisted(() => vi.fn());
const pickImage = vi.hoisted(() => vi.fn());
const modeCallbacks = vi.hoisted(() => ({ current: null as ((mode: InputMode) => void) | null }));

vi.mock("./InputModeTabs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./InputModeTabs")>();
  return {
    ...actual,
    InputModeTabs: (props: Parameters<typeof actual.InputModeTabs>[0]) => {
      modeCallbacks.current = props.onChange;
      return <actual.InputModeTabs {...props} />;
    },
  };
});

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

function Harness({ onError, onInputModeChange = vi.fn() }: { onError: (message: string) => void; onInputModeChange?: (mode: InputMode) => void }) {
  const [stage, setStage] = useState<Stage>("add");
  const [mode, setMode] = useState<InputMode>("image");
  const switchMode = (next: InputMode) => { onInputModeChange(next); setMode(next); setStage("add"); };
  return mode === "image"
    ? <ImageWorkflow stage={stage} onStageChange={setStage} onSwitchMode={switchMode} onError={onError} onDiagnosticsChange={vi.fn()} />
    : <InputModeTabs active={mode} onChange={switchMode} />;
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
  it("serializes restart and mode changes, including stale and reentrant callbacks", async () => {
    const oldCleanup = deferred<void>();
    const onInputModeChange = vi.fn();
    let backendSession: ImageSession | null = session;
    clearImageSession.mockImplementationOnce(async () => { await oldCleanup.promise; backendSession = null; });
    pickImage.mockResolvedValueOnce(session);
    await act(async () => { root.render(<Harness onError={vi.fn()} onInputModeChange={onInputModeChange} />); });
    const staleModeChange = modeCallbacks.current!;
    await act(async () => { button("Choose image").click(); });
    await act(async () => {
      const restart = button("Choose a different image");
      restart.click();
      restart.click();
      staleModeChange("text");
    });

    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>(".mode-tabs button"));
    expect(tabs).toHaveLength(3);
    expect(tabs.every((tab) => tab.disabled)).toBe(true);
    await act(async () => {
      tabs.forEach((tab) => tab.click());
      modeCallbacks.current!("pdf");
      staleModeChange("text");
    });
    expect(onInputModeChange).not.toHaveBeenCalled();
    expect(clearImageSession).toHaveBeenCalledTimes(1);

    await act(async () => { oldCleanup.resolve(); });
    expect(tabs.every((tab) => !tab.disabled)).toBe(true);
    await act(async () => {
      const switchMode = modeCallbacks.current!;
      button("Text & logs").click();
      switchMode("pdf");
    });
    expect(clearImageSession).toHaveBeenCalledTimes(1);
    expect(onInputModeChange.mock.calls).toEqual([["text"]]);

    await act(async () => { button("Images").click(); });
    const newSession = { ...session, sessionId: "session-2", filename: "new.png" };
    pickImage.mockImplementationOnce(async () => { backendSession = newSession; return newSession; });
    await act(async () => { button("Choose image").click(); });
    expect(container.textContent).toContain("new.png");
    expect(backendSession).toBe(newSession);
    expect(clearImageSession).toHaveBeenCalledTimes(1);
  });

  it("blocks mode changes while a picker is busy even before a render", async () => {
    const pendingPick = deferred<ImageSession | null>();
    const onInputModeChange = vi.fn();
    pickImage.mockReturnValueOnce(pendingPick.promise);
    await act(async () => { root.render(<Harness onError={vi.fn()} onInputModeChange={onInputModeChange} />); });
    const switchMode = modeCallbacks.current!;
    await act(async () => { button("Choose image").click(); switchMode("text"); });
    expect(button("Text & logs").disabled).toBe(true);
    expect(onInputModeChange).not.toHaveBeenCalled();
    expect(clearImageSession).not.toHaveBeenCalled();
    await act(async () => { pendingPick.resolve(null); });
    expect(button("Text & logs").disabled).toBe(false);
  });

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
    const switchMode = modeCallbacks.current!;
    expect(button("Text & logs").disabled).toBe(true);
    expect(button("Images").disabled).toBe(true);
    expect(button("PDF").disabled).toBe(true);
    await act(async () => { button("Text & logs").click(); switchMode("pdf"); });
    expect(container.textContent).toContain("Inspect one image");
    expect(clearImageSession).toHaveBeenCalledTimes(1);
  });
});
