// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfWorkflow } from "./PdfWorkflow";
import { TrustCenter } from "./TrustCenter";
import { emptyWorkflowDiagnostics } from "../lib/diagnostics";
import type { PdfPagePreview, PdfSession } from "../lib/types";

const native = vi.hoisted(() => ({ pickPdf: vi.fn(), clearPdfSession: vi.fn(), getPdfPagePreview: vi.fn(), cleanPdfFile: vi.fn() }));
vi.mock("../hooks/useDesktopFileDrop", () => ({ useDesktopFileDrop: vi.fn() }));
vi.mock("../lib/bridge", async (original) => ({ ...await original<typeof import("../lib/bridge")>(), ...native, isDesktop: () => true }));
const pdf: PdfSession = {
  sessionId: "pdf-zoom", filename: "synthetic.pdf", bytes: 1024, pageCount: 3, warnings: [],
  pages: [0, 1, 2].map((pageIndex) => ({
    pageIndex, widthPoints: 500, heightPoints: 750, widthPixels: 1000, heightPixels: 1500,
    thumbnailDataUrl: `data:image/png;base64,thumb${pageIndex}`,
    ocr: { availability: "available", report: { findings: [], wordsDetected: 0, language: null, confidence: "notProvided", warnings: [] }, message: "checked" },
    faces: { availability: "available", findings: [{ id: `face-${pageIndex}`, label: "Face", explanation: "Face", severity: "high", rectangle: { x: 100, y: 300, width: 200, height: 300 } }], message: "checked" },
    qr: { availability: "available", report: { findings: [], gridsDetected: 0, decodedGrids: 0, warnings: [] }, message: "checked" },
    barcodes: { availability: "available", report: { findings: [], symbolsDetected: 0, decodedSymbols: 0, warnings: [] }, message: "checked" },
  })),
};
const preview = (pageIndex: number): PdfPagePreview => ({ pageIndex, width: 1000, height: 1500, previewDataUrl: `data:image/png;base64,page${pageIndex}` });
let root: Root;
let container: HTMLDivElement;
let setStage: (stage: "add" | "review" | "result") => void;
let resizeCanvas: (width: number, height: number) => void;
const onError = vi.fn();
const onDiagnosticsChange = vi.fn();
function Harness() {
  const [stage, updateStage] = useState<"add" | "review" | "result">("add");
  const [trustOpen, setTrustOpen] = useState(false);
  setStage = updateStage;
  return <>
    <button onClick={() => setTrustOpen(true)}>Open trust center</button>
    <PdfWorkflow stage={stage} onStageChange={updateStage} onSwitchMode={vi.fn()} onError={onError} onDiagnosticsChange={onDiagnosticsChange} />
    <TrustCenter open={trustOpen} onClose={() => setTrustOpen(false)} runtimeInfo={null} runtimeState="failed" workflowDiagnostics={emptyWorkflowDiagnostics("pdf")} />
  </>;
}
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function wrap() { return container.querySelector<HTMLDivElement>(".pdf-page-wrap")!; }
async function click(label: string) { await act(async () => button(label).click()); }
async function key(key: string, target: EventTarget = document.body, modifiers: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
async function openPdf() {
  await act(async () => root.render(<Harness />));
  await click("Choose PDF");
  await act(async () => resizeCanvas(600, 600));
}
async function pointer(type: string, x: number, y: number) {
  const layer = container.querySelector<HTMLDivElement>(".pdf-draw-layer")!;
  const width = Number.parseFloat(wrap().style.width);
  vi.spyOn(layer, "getBoundingClientRect").mockReturnValue({ left: 10, top: 20, width, height: width * 1.5 } as DOMRect);
  await act(async () => {
    layer.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: 10 + x * width, clientY: 20 + y * width * 1.5 }));
  });
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  native.pickPdf.mockResolvedValue(pdf);
  native.clearPdfSession.mockResolvedValue(undefined);
  native.getPdfPagePreview.mockImplementation((_: string, page: number) => Promise.resolve(preview(page)));
  native.cleanPdfFile.mockResolvedValue(null);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resizeCanvas = (width, height) => callback([{ contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    observe() {}
    disconnect() {}
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("PDF review navigation", () => {
  it("renders bounded, accessible zoom controls, fits both axes, and resets new sessions", async () => {
    await openPdf();
    expect(button("Fit width").getAttribute("aria-pressed")).toBe("true");
    expect(wrap().style.width).toBe("600px");
    await click("Fit page");
    expect(wrap().style.width).toBe("400px");
    await act(async () => resizeCanvas(200, 600));
    expect(wrap().style.width).toBe("200px");
    await click("Zoom in");
    expect(wrap().style.width).toBe("1250px");
    for (let i = 0; i < 8; i++) await click("Zoom in");
    expect(button("Zoom in").disabled).toBe(true);
    expect(wrap().style.width).toBe("2000px");
    for (let i = 0; i < 8; i++) await click("Zoom out");
    expect(button("Zoom out").disabled).toBe(true);
    expect(wrap().style.width).toBe("500px");
    await click("Choose a different PDF");
    expect(container.querySelector(".pdf-zoom-toolbar")).toBeNull();
    native.pickPdf.mockResolvedValueOnce({ ...pdf, sessionId: "pdf-new" });
    await click("Choose PDF");
    expect(native.getPdfPagePreview).toHaveBeenLastCalledWith("pdf-new", 0);
    expect(button("Fit width").getAttribute("aria-pressed")).toBe("true");
  });

  it("navigates and clamps pages from non-editable focus without intercepting browser keys", async () => {
    await openPdf();
    expect((await key("PageDown", button("Fit width"))).defaultPrevented).toBe(true);
    expect(native.getPdfPagePreview).toHaveBeenLastCalledWith(pdf.sessionId, 1);
    await key("PageDown"); await key("PageDown");
    expect(native.getPdfPagePreview).toHaveBeenLastCalledWith(pdf.sessionId, 2);
    await key("PageUp"); await key("PageUp"); await key("PageUp");
    expect(native.getPdfPagePreview).toHaveBeenLastCalledWith(pdf.sessionId, 0);
    for (const modifier of ["ctrlKey", "metaKey", "altKey"]) {
      expect((await key("+", document.body, { [modifier]: true })).defaultPrevented).toBe(false);
    }
    for (const tag of ["input", "textarea", "select"]) {
      const target = document.createElement(tag); container.append(target); target.focus();
      expect((await key("PageDown", target)).defaultPrevented).toBe(false);
      expect((await key("+", target)).defaultPrevented).toBe(false);
      target.remove();
    }
    const editable = document.createElement("div"); editable.contentEditable = "true"; editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<span>Editable child</span>"; container.append(editable);
    expect((await key("+", editable.firstChild!)).defaultPrevented).toBe(false);
    expect(button("Fit width").getAttribute("aria-pressed")).toBe("true");
    await key("="); expect(wrap().style.width).toBe("1250px");
    await key("-"); expect(wrap().style.width).toBe("1000px");
  });

  it("leaves TrustCenter focus and shortcuts alone, including Escape on an active PDF draft", async () => {
    await openPdf(); await click("Add manual cover");
    await pointer("pointerdown", 0.1, 0.2); await pointer("pointermove", 0.3, 0.4);
    await click("Open trust center");
    const dialogButton = container.querySelector<HTMLButtonElement>('[role="dialog"] button')!;
    dialogButton.focus();
    await key("+", dialogButton); await key("PageDown", dialogButton);
    expect(document.activeElement).toBe(dialogButton);
    expect(button("Fit width").getAttribute("aria-pressed")).toBe("true");
    expect(native.getPdfPagePreview).toHaveBeenCalledTimes(1);
    await key("Escape", dialogButton);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector(".draft")).not.toBeNull();
    await key("Escape"); expect(container.querySelector(".draft")).toBeNull();
  });

  it("preserves committed normalized export geometry through 50%, 200%, and fit modes; Escape cancels only the draft", async () => {
    await openPdf(); await click("Add manual cover");
    await pointer("pointerdown", 0.1, 0.2); await pointer("pointerup", 0.3, 0.4);
    const region = () => container.querySelector<HTMLElement>(".pdf-manual-region:not(.draft)")!;
    const originalStyle = region().getAttribute("style");
    const autoStyle = container.querySelector(".redaction-region")!.getAttribute("style");
    expect(originalStyle).toContain("left: 10%");
    for (const mode of ["50", "200", "Fit page", "Fit width"]) {
      if (mode === "50") { for (let i = 0; i < 3; i++) await click("Zoom out"); }
      else if (mode === "200") { for (let i = 0; i < 6; i++) await click("Zoom in"); }
      else await click(mode);
      expect(container.querySelector("output")?.textContent).toBe(mode === "50" || mode === "200" ? `${mode}%` : mode);
      expect(region().getAttribute("style")).toBe(originalStyle);
      expect(container.querySelector(".redaction-region")!.getAttribute("style")).toBe(autoStyle);
      expect(wrap().querySelector("img")?.parentElement).toBe(wrap());
      expect(wrap().querySelector(".pdf-draw-layer")?.parentElement).toBe(wrap());
      await click("Flatten, save & verify");
    }
    const firstRequest = native.cleanPdfFile.mock.calls[0];
    expect(firstRequest[0]).toBe(pdf.sessionId);
    expect(firstRequest[2]).toHaveLength(1);
    expect(firstRequest[2][0]).toMatchObject({ pageIndex: 0, rectangle: { x: 0.1, y: 0.2, width: 0.19999999999999998, height: 0.2 } });
    for (const call of native.cleanPdfFile.mock.calls) expect(call).toEqual(firstRequest);
    await click("Add manual cover");
    await pointer("pointerdown", 0.5, 0.6); await pointer("pointermove", 0.7, 0.8);
    expect(container.querySelector(".draft")).not.toBeNull();
    await key("Escape"); await pointer("pointerup", 0.7, 0.8);
    expect(container.querySelector(".draft")).toBeNull();
    expect(region().getAttribute("style")).toBe(originalStyle);
    await click("Flatten, save & verify"); expect(native.cleanPdfFile.mock.calls.at(-1)).toEqual(firstRequest);
  });

  it.each(["50%", "200%", "Fit page", "Fit width"])("normalizes new pointer drawings at %s", async (mode) => {
    await openPdf();
    if (mode === "50%") { await click("Zoom out"); await click("Zoom out"); }
    else if (mode === "200%") { for (let i = 0; i < 4; i++) await click("Zoom in"); }
    else await click(mode);
    expect(container.querySelector("output")?.textContent).toBe(mode);
    await click("Add manual cover");
    await pointer("pointerdown", 0.1, 0.2); await pointer("pointerup", 0.3, 0.4);
    await click("Flatten, save & verify");
    expect(native.cleanPdfFile.mock.calls[0][2][0]).toMatchObject({ pageIndex: 0, rectangle: { x: 0.1, y: 0.2, width: 0.19999999999999998, height: 0.2 } });
  });

  it("ignores shortcuts while busy, add, or result and cancels draft on page navigation", async () => {
    await openPdf(); await click("Add manual cover");
    await pointer("pointerdown", 0.1, 0.2);
    await key("PageDown"); expect(container.querySelector(".draft")).toBeNull();
    const pending = deferred<null>(); native.cleanPdfFile.mockReturnValueOnce(pending.promise);
    await click("Flatten, save & verify");
    expect(button("Zoom in").disabled).toBe(true);
    expect((await key("+")).defaultPrevented).toBe(false);
    expect((await key("PageDown")).defaultPrevented).toBe(false);
    await act(async () => pending.resolve(null));
    for (const stage of ["add", "result"] as const) {
      await act(async () => setStage(stage));
      expect((await key("+")).defaultPrevented).toBe(false);
      expect(container.querySelector(".pdf-zoom-toolbar")).toBeNull();
    }
  });

  it("keeps the latest page preview when keyboard navigation resolves out of order", async () => {
    await openPdf();
    const first = deferred<PdfPagePreview>(); const second = deferred<PdfPagePreview>();
    native.getPdfPagePreview.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await key("PageDown"); await key("PageDown");
    await act(async () => second.resolve(preview(2)));
    await act(async () => first.resolve(preview(1)));
    expect(wrap().querySelector("img")!.getAttribute("src")).toBe(preview(2).previewDataUrl);
  });
});
