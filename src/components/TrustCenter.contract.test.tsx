// @vitest-environment jsdom
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrustCenter } from "./TrustCenter";
import type { RuntimeInfo } from "../lib/types";

const openProjectLink = vi.hoisted(() => vi.fn());

vi.mock("../lib/projectLinks", () => ({ openProjectLink }));

const runtimeInfo: RuntimeInfo = {
  appVersion: "0.2.0-beta.1",
  channel: "beta",
  commit: "0123456789ab",
  verifiedBuild: true,
  target: "windows-x86_64",
  osVersion: "10.0.26100.0",
  license: "MIT",
  detectors: { text: "available", metadata: "available", face: "available", qr: "available", barcode: "available", pdf: "available" },
};

let container: HTMLDivElement;
let root: Root;

function getButton(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim().startsWith(label));
  if (!button) throw new Error(`Missing button: ${label}`);
  return button as HTMLButtonElement;
}

async function click(element: HTMLElement) {
  await act(async () => { element.click(); });
}

async function render(element: React.ReactNode) {
  await act(async () => { root.render(element); });
}

async function settleFocus() {
  await act(async () => { vi.runAllTimers(); });
}

function DialogHarness({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen(true)}>Open trust center</button>
      <TrustCenter
        open={open}
        busy={busy}
        runtimeInfo={runtimeInfo}
        runtimeState="loaded"
        onClose={() => {
          setOpen(false);
          window.requestAnimationFrame(() => trigger.current?.focus());
        }}
      />
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0));
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  openProjectLink.mockReset();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("TrustCenter interaction contract", () => {
  it("focuses close, contains Tab navigation, closes with Escape, and returns focus to its trigger", async () => {
    await render(<DialogHarness />);
    const trigger = getButton("Open trust center");
    await click(trigger);
    await settleFocus();

    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close trust center"]')!;
    const first = close;
    const last = getButton("Security reporting");
    expect(document.activeElement).toBe(close);

    last.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    first.focus();
    const reverseTab = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(reverseTab);
    expect(reverseTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);

    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => { document.dispatchEvent(escape); });
    await settleFocus();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes only for a backdrop self-click and keeps all dismissals disabled while busy", async () => {
    await render(<DialogHarness />);
    await click(getButton("Open trust center"));
    await settleFocus();
    const backdrop = container.querySelector<HTMLElement>(".trust-backdrop")!;
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;

    await act(async () => { dialog.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => { backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    const onClose = vi.fn();
    await render(<TrustCenter open busy runtimeInfo={runtimeInfo} runtimeState="loaded" onClose={onClose} />);
    await settleFocus();
    const busyBackdrop = container.querySelector<HTMLElement>(".trust-backdrop")!;
    const busyClose = container.querySelector<HTMLButtonElement>('button[aria-label="Close trust center"]')!;
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => { busyBackdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    await click(busyClose);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens project pages only from clicks, exposes a generic failure, and removes its listener on unmount", async () => {
    const onClose = vi.fn();
    await render(<TrustCenter open runtimeInfo={runtimeInfo} runtimeState="loaded" onClose={onClose} />);
    await settleFocus();
    expect(openProjectLink).not.toHaveBeenCalled();

    await click(getButton("Releases"));
    await click(getButton("Source code"));
    await click(getButton("Security reporting"));
    expect(openProjectLink).toHaveBeenNthCalledWith(1, "releases");
    expect(openProjectLink).toHaveBeenNthCalledWith(2, "source");
    expect(openProjectLink).toHaveBeenNthCalledWith(3, "security");

    openProjectLink.mockRejectedValueOnce(new Error("private internal error"));
    await click(getButton("Releases"));
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("Could not open that link. Check your system browser and try again.");
    expect(container.textContent).not.toContain("private internal error");

    await render(<TrustCenter open={false} runtimeInfo={runtimeInfo} runtimeState="loaded" onClose={onClose} />);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { root.unmount(); });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
