// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyFileDrop, dropPrompt } from "./fileDrop";
import { useDesktopFileDrop } from "../hooks/useDesktopFileDrop";

type DropPayload =
  | { type: "enter"; paths: string[] }
  | { type: "over" }
  | { type: "leave" }
  | { type: "drop"; paths: string[] };
type Listener = (event: { payload: DropPayload }) => void;

const native = vi.hoisted(() => ({ listen: vi.fn(), desktop: true }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: native.listen }) }));
vi.mock("./bridge", () => ({ isDesktop: () => native.desktop }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type HookProps = Parameters<typeof useDesktopFileDrop>[0];
function Harness(props: HookProps) {
  useDesktopFileDrop(props);
  return null;
}

let container: HTMLDivElement;
let root: Root;
let listeners: Listener[];
let stops: ReturnType<typeof vi.fn>[];

function props(overrides: Partial<HookProps> = {}): HookProps {
  return {
    enabled: true, kind: "image", busy: false,
    onDrop: vi.fn(), onActive: vi.fn(), onError: vi.fn(),
    ...overrides,
  };
}

async function render(next: HookProps) {
  await act(async () => { root.render(createElement(Harness, next)); });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  native.desktop = true;
  listeners = [];
  stops = [];
  native.listen.mockReset().mockImplementation((listener: Listener) => {
    listeners.push(listener);
    const stop = vi.fn();
    stops.push(stop);
    return Promise.resolve(stop);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe("single file drop", () => {
  it("accepts exactly one matching path case-insensitively", () => {
    expect(classifyFileDrop(["C:\\synthetic\\photo.PNG"], "image", false)).toEqual({ ok: true, path: "C:\\synthetic\\photo.PNG" });
    expect(classifyFileDrop(["C:\\synthetic\\document.PDF"], "pdf", false).ok).toBe(true);
    expect(classifyFileDrop(["photo.JpEg"], "image", false).ok).toBe(true);
  });

  it("rejects busy, empty, multiple, and mismatched drops without revealing paths", () => {
    expect(classifyFileDrop(["a.png"], "image", true)).toEqual({ ok: false, message: "Wait for the current operation to finish." });
    expect(classifyFileDrop([], "image", false)).toEqual({ ok: false, message: "Drop exactly one supported file." });
    expect(classifyFileDrop(["a.png", "b.png"], "image", false)).toEqual({ ok: false, message: "Drop exactly one supported file." });
    expect(classifyFileDrop(["C:\\private\\a.pdf"], "image", false)).toEqual({ ok: false, message: "Drop one JPEG or PNG image." });
    expect(classifyFileDrop(["C:\\private\\a.png"], "pdf", false)).toEqual({ ok: false, message: "Drop one PDF document." });
  });

  it("provides prompts for both kinds and busy states", () => {
    expect(dropPrompt("image", false)).toBe("Choose, paste, or drop one JPEG/PNG");
    expect(dropPrompt("pdf", false)).toBe("Choose or drop one PDF");
    expect(dropPrompt("image", true)).toBe("Wait for the current image operation");
    expect(dropPrompt("pdf", true)).toBe("Wait for the current PDF operation");
  });
});

describe("desktop drop listener", () => {
  it("uses one listener and current props; only a valid drop calls the loader", async () => {
    const first = props();
    await render(first);
    expect(native.listen).toHaveBeenCalledTimes(1);
    const latest = props({ busy: true, kind: "pdf" });
    await render(latest);
    expect(native.listen).toHaveBeenCalledTimes(1);
    await act(async () => {
      listeners[0]({ payload: { type: "enter", paths: ["C:\\private\\file.pdf"] } });
      listeners[0]({ payload: { type: "over" } });
      listeners[0]({ payload: { type: "leave" } });
      listeners[0]({ payload: { type: "drop", paths: ["C:\\private\\file.pdf"] } });
    });
    expect(latest.onActive).toHaveBeenLastCalledWith(false);
    expect(latest.onDrop).not.toHaveBeenCalled();
    expect(latest.onError).toHaveBeenCalledWith("Wait for the current operation to finish.");
    expect(first.onError).not.toHaveBeenCalled();

    const ready = props({ kind: "pdf" });
    await render(ready);
    await act(async () => {
      listeners[0]({ payload: { type: "enter", paths: ["C:\\private\\file.PDF"] } });
      listeners[0]({ payload: { type: "over" } });
      listeners[0]({ payload: { type: "leave" } });
    });
    expect(ready.onDrop).not.toHaveBeenCalled();
    expect(ready.onError).not.toHaveBeenCalled();
    await act(async () => {
      listeners[0]({ payload: { type: "drop", paths: ["C:\\private\\file.PNG"] } });
      listeners[0]({ payload: { type: "drop", paths: ["C:\\private\\file.PDF"] } });
    });
    expect(ready.onError).toHaveBeenCalledWith("Drop one PDF document.");
    expect(ready.onDrop).toHaveBeenCalledExactlyOnceWith("C:\\private\\file.PDF");
    expect(native.listen).toHaveBeenCalledTimes(1);
    await render(props({ enabled: false, onDrop: ready.onDrop }));
    await act(async () => { listeners[0]({ payload: { type: "drop", paths: ["disabled.pdf"] } }); });
    expect(ready.onDrop).toHaveBeenCalledTimes(1);
    expect(stops[0]).toHaveBeenCalledTimes(1);
  });

  it("disposes a pending registration before starting a replacement listener", async () => {
    const pending = deferred<() => void>();
    const stop = vi.fn();
    native.listen.mockImplementationOnce((listener: Listener) => { listeners.push(listener); return pending.promise; });
    await render(props());
    await render(props({ enabled: false }));
    await render(props());
    expect(native.listen).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(stop); });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(native.listen).toHaveBeenCalledTimes(2);
    const current = props({ onDrop: vi.fn() });
    await render(current);
    await act(async () => {
      listeners[0]({ payload: { type: "drop", paths: ["old.png"] } });
      listeners[1]({ payload: { type: "drop", paths: ["new.png"] } });
    });
    expect(current.onDrop).toHaveBeenCalledExactlyOnceWith("new.png");
  });

  it("unlistens after unmount even when registration resolves late", async () => {
    const pending = deferred<() => void>();
    const stop = vi.fn();
    native.listen.mockReturnValueOnce(pending.promise);
    await render(props());
    await act(async () => { root.unmount(); });
    await act(async () => { pending.resolve(stop); });
    expect(stop).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });

  it("ignores a captured listener callback after unmount", async () => {
    const onDrop = vi.fn();
    const onError = vi.fn();
    await render(props({ onDrop, onError }));
    await act(async () => { root.unmount(); });
    await act(async () => { listeners[0]({ payload: { type: "drop", paths: ["C:\\private\\old.png"] } }); });
    expect(onDrop).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(stops[0]).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });

  it("reports registration and loader failures with fixed path-free text", async () => {
    const onError = vi.fn();
    native.listen.mockRejectedValueOnce(new Error("C:\\private\\registration"));
    await render(props({ onError }));
    expect(onError).toHaveBeenCalledWith("Could not enable file dropping.");
    expect(JSON.stringify(onError.mock.calls)).not.toContain("private");
    await render(props({ enabled: false }));
    const onDrop = vi.fn().mockRejectedValue(new Error("C:\\private\\loader"));
    await render(props({ onDrop, onError }));
    await act(async () => { listeners[0]({ payload: { type: "drop", paths: ["C:\\private\\file.png"] } }); });
    expect(onError).toHaveBeenCalledWith("Could not open dropped file.");
    expect(JSON.stringify(onError.mock.calls)).not.toContain("private");
  });

  it("does not register in browser mode or while disabled", async () => {
    await render(props({ enabled: false }));
    native.desktop = false;
    await render(props({ enabled: true }));
    expect(native.listen).not.toHaveBeenCalled();
  });
});
