// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VerificationReceiptData } from "../lib/verificationReceipt";
import { VerificationReceipt } from "./VerificationReceipt";

const data: VerificationReceiptData = {
  appVersion: "0.2.0-beta.1", commit: "0123456789ab", outputKind: "image", status: "verified",
  savedBytes: 10, pages: null, findingsRedacted: 1, exceptions: 0, remainingFindings: 0,
  detectors: { text: "complete", metadata: "complete", face: "complete", qr: "complete", barcode: "complete", pdf: "notApplicable" },
  outputFingerprint: "a".repeat(64),
};

let container: HTMLDivElement;
let root: Root;
let writeText: ReturnType<typeof vi.fn<(value: string) => Promise<void>>>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();
  vi.stubGlobal("navigator", { clipboard: { writeText } });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

describe("VerificationReceipt", () => {
  it("copies only from the button and keeps SHA-256 private by default", async () => {
    await act(async () => { root.render(<VerificationReceipt data={data} />); });
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(false);
    expect(container.textContent).toMatch(/correlat/i);
    expect(writeText).not.toHaveBeenCalled();

    const copy = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Copy verification receipt"))!;
    await act(async () => { copy.click(); await Promise.resolve(); });
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).not.toContain("output_sha256=");

    await act(async () => { checkbox.click(); });
    expect(checkbox.checked).toBe(true);
    expect(writeText).toHaveBeenCalledOnce();

    const copyWithHash = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Copy verification receipt"))!;
    await act(async () => { copyWithHash.click(); await Promise.resolve(); });
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText.mock.calls[1][0]).toContain(`output_sha256=${data.outputFingerprint}`);
  });

  it("resets fingerprint opt-in when the saved output changes", async () => {
    await act(async () => { root.render(<VerificationReceipt data={data} />); });
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => { checkbox.click(); });
    expect(checkbox.checked).toBe(true);

    const next = { ...data, outputFingerprint: "b".repeat(64) };
    await act(async () => { root.render(<VerificationReceipt data={next} />); });
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);

    const copy = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Copy verification receipt"))!;
    await act(async () => { copy.click(); await Promise.resolve(); });
    expect(writeText.mock.calls.at(-1)?.[0]).not.toContain("output_sha256=");
  });
});
