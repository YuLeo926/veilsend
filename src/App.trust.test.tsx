// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { RuntimeInfo } from "./lib/types";

const getRuntimeInfo = vi.hoisted(() => vi.fn());

vi.mock("./lib/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/bridge")>();
  return { ...actual, getRuntimeInfo, isDesktop: () => true };
});

const unverifiedRuntime: RuntimeInfo = {
  appVersion: "0.2.0-beta.1", channel: "development", commit: "unverified", verifiedBuild: false,
  target: "windows-x86_64", osVersion: "unknown", license: "MIT",
  detectors: { text: "available", metadata: "available", face: "available", qr: "available", barcode: "available", pdf: "available" },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
});
