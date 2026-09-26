// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { RuntimeInfo, SavedTextFile, ScanReport } from "./lib/types";

const getRuntimeInfo = vi.hoisted(() => vi.fn());
const scanText = vi.hoisted(() => vi.fn());
const sanitizeText = vi.hoisted(() => vi.fn());
const saveCleanedText = vi.hoisted(() => vi.fn());

vi.mock("./lib/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/bridge")>();
  return { ...actual, getRuntimeInfo, scanText, sanitizeText, saveCleanedText, isDesktop: () => true };
});

const unverifiedRuntime: RuntimeInfo = {
  appVersion: "0.2.0-beta.1", channel: "development", commit: "unverified", verifiedBuild: false,
  target: "windows-x86_64", osVersion: "unknown", license: "MIT",
  detectors: { text: "available", metadata: "available", face: "available", qr: "available", barcode: "available", pdf: "available" },
};

let container: HTMLDivElement;
let root: Root;

const scanReport: ScanReport = {
  contentFingerprint: "test", findings: [], stats: { bytes: 4, rulesRun: 1, durationMs: 1 }, warnings: [],
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

async function setText(value: string) {
  const field = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Content to scan"]')!;
  const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  nativeValueSetter?.call(field, value);
  await act(async () => { field.dispatchEvent(new Event("input", { bubbles: true })); });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("scrollTo", vi.fn());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  getRuntimeInfo.mockReset();
  scanText.mockReset();
  sanitizeText.mockReset();
  saveCleanedText.mockReset();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

describe("runtime identity indicator", () => {
  it("uses neutral loading and an alert icon for an unverified runtime", async () => {
    getRuntimeInfo.mockReturnValueOnce(new Promise(() => {}));
    await act(async () => { root.render(<App />); });
    const loading = container.querySelector<HTMLButtonElement>(".build-label")!;
    expect(loading.textContent).toContain("Loading build identity");
    expect(loading.querySelector(".lucide-loader-circle")).not.toBeNull();

    await act(async () => { root.unmount(); });
    getRuntimeInfo.mockResolvedValueOnce(unverifiedRuntime);
    root = createRoot(container);
    await act(async () => { root.render(<App />); await Promise.resolve(); });
    const unverified = container.querySelector<HTMLButtonElement>(".build-label")!;
    expect(unverified.querySelector(".lucide-shield-alert")).not.toBeNull();
  });

  it("invalidates a suspended text scan after switching to PDF so stale completion cannot create PDF review diagnostics", async () => {
    const pending = deferred<ScanReport>();
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    getRuntimeInfo.mockResolvedValueOnce(unverifiedRuntime);
    scanText.mockReturnValueOnce(pending.promise);
    await act(async () => { root.render(<App />); await Promise.resolve(); });
    await setText("first");
    await act(async () => { button("Scan locally").click(); });
    await act(async () => { button("PDF").click(); });
    pending.resolve(scanReport);
    await act(async () => { await Promise.resolve(); });

    expect(container.textContent).toContain("Inspect one PDF");
    expect(container.textContent).not.toContain("PDF page review");
    await act(async () => { container.querySelector<HTMLButtonElement>(".build-label")?.click(); });
    await act(async () => { button("Copy diagnostics").click(); await Promise.resolve(); });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("input_kind=pdf\nworkflow_state=add\ninput_size=none\npages=not-applicable"));
  });

  it("does not let an old scan completion overwrite a new text operation", async () => {
    const oldOperation = deferred<ScanReport>();
    const nextOperation = deferred<ScanReport>();
    getRuntimeInfo.mockResolvedValueOnce(unverifiedRuntime);
    scanText.mockReturnValueOnce(oldOperation.promise).mockReturnValueOnce(nextOperation.promise);
    await act(async () => { root.render(<App />); await Promise.resolve(); });
    await setText("old");
    await act(async () => { button("Scan locally").click(); });
    await act(async () => { button("PDF").click(); });
    // Leave through the mounted PDF workflow's cleanup gate, not stale text tabs.
    await act(async () => { button("Text & logs").click(); });
    await setText("new");
    await act(async () => { button("Scan locally").click(); });

    oldOperation.resolve(scanReport);
    await act(async () => { await Promise.resolve(); });
    expect(button("Scan locally").disabled).toBe(true);

    expect(container.textContent).toContain("Catch what should not");
    expect(button("Scan locally").disabled).toBe(true);

    nextOperation.resolve(scanReport);
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("No base-rule matches found.");
  });

  it("does not let a rejected old scan introduce an error after a mode change", async () => {
    const pending = deferred<ScanReport>();
    getRuntimeInfo.mockResolvedValueOnce(unverifiedRuntime);
    scanText.mockReturnValueOnce(pending.promise);
    await act(async () => { root.render(<App />); await Promise.resolve(); });
    await setText("old");
    await act(async () => { button("Scan locally").click(); button("PDF").click(); });
    pending.reject(new Error("old private failure"));
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("Inspect one PDF");
    expect(container.textContent).not.toContain("old private failure");
  });

  it.each(["resolve", "reject"] as const)("does not attach an old %s save after a newer saved result", async (oldCompletion) => {
    const pending = deferred<SavedTextFile | null>();
    const newSaved: SavedTextFile = {
      savedPath: "C:\\private\\new.cleaned.txt", filename: "new.cleaned.txt",
      cleanedSize: 9, savedFingerprint: "b".repeat(64),
    };
    getRuntimeInfo.mockResolvedValueOnce(unverifiedRuntime);
    scanText.mockResolvedValue(scanReport);
    sanitizeText.mockResolvedValue({
      cleanedText: "safe text",
      verification: { status: "verified", remainingFindings: [], exceptions: 0, message: "Verified" },
    });
    saveCleanedText.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(newSaved);
    await act(async () => { root.render(<App />); await Promise.resolve(); });
    await setText("first");
    await act(async () => { button("Scan locally").click(); await Promise.resolve(); });
    await act(async () => { button("Clean & verify").click(); await Promise.resolve(); });
    await act(async () => { button("Save clean copy").click(); });
    await act(async () => { button("Scan something else").click(); });
    await act(async () => { button("PDF").click(); });
    await act(async () => { button("Text & logs").click(); });
    await setText("new text");
    await act(async () => { button("Scan locally").click(); await Promise.resolve(); });
    await act(async () => { button("Clean & verify").click(); await Promise.resolve(); });
    await act(async () => { button("Save clean copy").click(); await Promise.resolve(); });
    expect(container.textContent).toContain(newSaved.savedPath);

    if (oldCompletion === "resolve") {
      pending.resolve({
        savedPath: "C:\\private\\old.cleaned.txt", filename: "old.cleaned.txt",
        cleanedSize: 9, savedFingerprint: "a".repeat(64),
      });
    } else {
      pending.reject(new Error("old private save failure"));
    }
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain(newSaved.savedPath);
    expect(container.textContent).not.toContain("old.cleaned.txt");
    expect(container.textContent).not.toContain("old private save failure");
    expect(container.textContent).toContain("Clean copy verified.");
    expect(button("Save clean copy").disabled).toBe(false);
  });
});
