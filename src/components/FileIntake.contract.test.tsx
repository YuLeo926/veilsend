// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageWorkflow } from "./ImageWorkflow";
import { PdfWorkflow } from "./PdfWorkflow";
import type { ImageSession, PdfSession } from "../lib/types";

const native = vi.hoisted(() => ({ desktop: true, listen: vi.fn(), pickImage: vi.fn(), pasteImage: vi.fn(), openDroppedImage: vi.fn(), clearImageSession: vi.fn(), pickPdf: vi.fn(), openDroppedPdf: vi.fn(), clearPdfSession: vi.fn(), getPdfPagePreview: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: native.listen }) }));
vi.mock("../lib/bridge", async (original) => ({ ...await original<typeof import("../lib/bridge")>(), ...native, isDesktop: () => native.desktop }));

const image: ImageSession = {
  sessionId: "image-1", sourceKind: "file", filename: "synthetic.png", previewDataUrl: "data:image/png;base64,preview",
  inspection: { format: "png", bytes: 1024, width: 10, height: 10, findings: [], canCleanLosslessly: true, warnings: [], pixelFingerprint: "ignored" },
  ocr: { availability: "available", report: { findings: [], wordsDetected: 0, language: null, confidence: "notProvided", warnings: [] }, message: "checked" },
  faces: { availability: "available", findings: [], message: "checked" },
  qr: { availability: "available", report: { findings: [], gridsDetected: 0, decodedGrids: 0, warnings: [] }, message: "checked" },
  barcodes: { availability: "available", report: { findings: [], symbolsDetected: 0, decodedSymbols: 0, warnings: [] }, message: "checked" },
};
const pdf: PdfSession = { sessionId: "pdf-1", filename: "synthetic.pdf", bytes: 1024, pageCount: 1, warnings: [], pages: [{ pageIndex: 0, widthPoints: 100, heightPoints: 100, widthPixels: 200, heightPixels: 200, thumbnailDataUrl: image.previewDataUrl, ocr: image.ocr, faces: image.faces, qr: image.qr, barcodes: image.barcodes }] };
type Kind = "image" | "pdf";
type Stage = "add" | "review" | "result";
type Payload = { type: "enter" | "drop"; paths: string[] } | { type: "over" | "leave" };
let listener: (event: { payload: Payload }) => void;
let root: Root;
let container: HTMLDivElement;
let setStage: (stage: Stage) => void;
const onError = vi.fn();
const onDiagnosticsChange = vi.fn();
const onSwitchMode = vi.fn();
function Harness({ kind }: { kind: Kind }) {
  const [stage, updateStage] = useState<Stage>("add");
  setStage = updateStage;
  const Workflow = kind === "image" ? ImageWorkflow : PdfWorkflow;
  return <Workflow stage={stage} onStageChange={updateStage} onSwitchMode={onSwitchMode} onError={onError} onDiagnosticsChange={onDiagnosticsChange} />;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function button(label: string) {
  const found = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim().startsWith(label));
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function drop(path: string) { listener({ payload: { type: "drop", paths: [path] } }); }
async function render(kind: Kind) { await act(async () => { root.render(<Harness kind={kind} />); }); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  native.desktop = true;
  for (const value of Object.values(native)) if (typeof value === "function") value.mockReset();
  native.listen.mockImplementation((next) => { listener = next; return Promise.resolve(vi.fn()); });
  native.clearImageSession.mockResolvedValue(undefined);
  native.clearPdfSession.mockResolvedValue(undefined);
  native.getPdfPagePreview.mockResolvedValue({ pageIndex: 0, width: 200, height: 200, previewDataUrl: image.previewDataUrl });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe.each(["image", "pdf"] as const)("%s native intake", (kind) => {
  const label = kind === "image" ? "Choose image" : "Choose PDF";
  const file = kind === "image" ? image : pdf;
  const loader = kind === "image" ? native.openDroppedImage : native.openDroppedPdf;
  const picker = kind === "image" ? native.pickImage : native.pickPdf;
  const clear = kind === "image" ? native.clearImageSession : native.clearPdfSession;
  const path = `C:\\private\\synthetic.${kind === "image" ? "png" : "pdf"}`;

  it("hovers without opening and accepts a matching drop through review", async () => {
    loader.mockResolvedValue(file);
    await render(kind);
    expect(native.listen).toHaveBeenCalledTimes(1);
    await act(async () => listener({ payload: { type: "enter", paths: [path] } }));
    expect(container.querySelector(".native-drop-zone")?.classList.contains("drop-active")).toBe(true);
    expect(loader).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("private");
    await act(async () => drop(path));
    expect(loader).toHaveBeenCalledExactlyOnceWith(path);
    if (kind === "image") expect(container.textContent).toContain(file.filename);
    else expect(native.getPdfPagePreview).toHaveBeenLastCalledWith(file.sessionId, 0);
    expect(container.querySelector(".review-stage")).not.toBeNull();
    await act(async () => drop(path));
    expect(loader).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();
  });

  it("rejects wrong kinds and multiple files without opening or clearing", async () => {
    await render(kind);
    await act(async () => {
      drop(kind === "image" ? "C:\\private\\wrong.pdf" : "C:\\private\\wrong.png");
      listener({ payload: { type: "drop", paths: [path, path] } });
    });
    expect(loader).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
    expect(JSON.stringify(onError.mock.calls)).not.toContain("private");
  });

  it("blocks repeated drop and mixed picker/paste calls before React rerenders", async () => {
    const pending = deferred<typeof file>(); loader.mockReturnValue(pending.promise);
    await render(kind);
    await act(async () => { drop(path); drop(path); button(label).click(); if (kind === "image") button("Paste screenshot").click(); });
    expect(loader).toHaveBeenCalledTimes(1); expect(picker).not.toHaveBeenCalled(); expect(native.pasteImage).not.toHaveBeenCalled();
    expect(container.querySelector(".native-drop-zone")?.getAttribute("aria-busy")).toBe("true");
    await act(async () => pending.resolve(file));
    expect(container.querySelector(".review-stage")).not.toBeNull();
  });

  it("blocks a native drop while the picker is pending, including the same event turn", async () => {
    const pending = deferred<typeof file | null>(); picker.mockReturnValue(pending.promise);
    await render(kind);
    await act(async () => { button(label).click(); drop(path); });
    expect(loader).not.toHaveBeenCalled(); expect(picker).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(null));
    expect(button(label).disabled).toBe(false);
  });

  it("preserves an existing session when the picker is canceled", async () => {
    picker.mockResolvedValueOnce(file).mockResolvedValueOnce(null);
    await render(kind);
    await act(async () => button(label).click());
    // A retained session must not be destroyed merely by opening the dialog.
    await act(async () => setStage("add"));
    await act(async () => button(label).click());
    expect(clear).not.toHaveBeenCalled();
    await act(async () => setStage("review"));
    expect(container.querySelector(".review-stage")).not.toBeNull();
    if (kind === "image") expect(container.textContent).toContain(file.filename);
    else expect(native.getPdfPagePreview).toHaveBeenLastCalledWith(file.sessionId, 0);
  });

  it("empties stale UI after backend failure and never echoes the dropped path", async () => {
    picker.mockResolvedValue(file); loader.mockRejectedValue(new Error(`${path}: invalid data`));
    await render(kind); await act(async () => button(label).click()); await act(async () => setStage("add"));
    await act(async () => drop(path));
    expect(container.querySelector(".add-stage")).not.toBeNull();
    expect(JSON.stringify(onError.mock.calls)).not.toContain("private");
    await act(async () => setStage("review"));
    expect(container.querySelector(".review-stage")).toBeNull();
    expect(container.textContent).not.toContain(file.filename);
    expect(clear).not.toHaveBeenCalled();
  });

  it("does not register or acquire in browser preview", async () => {
    native.desktop = false; await render(kind);
    expect(native.listen).not.toHaveBeenCalled(); expect(button(label).disabled).toBe(true);
    await act(async () => button(label).click()); expect(picker).not.toHaveBeenCalled();
  });

  it("waits for old cleanup, blocks mixed intake, and never clears the new session", async () => {
    const cleanup = deferred<void>(); clear.mockReturnValueOnce(cleanup.promise);
    picker.mockResolvedValueOnce(file);
    const nextFile = { ...file, sessionId: `${kind}-2`, filename: `next.${kind === "image" ? "png" : "pdf"}` };
    loader.mockResolvedValueOnce(nextFile);
    await render(kind); await act(async () => button(label).click());
    await act(async () => button(kind === "image" ? "Choose a different image" : "Choose a different PDF").click());
    await act(async () => { drop(path); button(label).click(); button("Text & logs").click(); });
    expect(loader).not.toHaveBeenCalled(); expect(picker).toHaveBeenCalledTimes(1); expect(onSwitchMode).not.toHaveBeenCalled();
    expect(button(label).disabled).toBe(true);
    await act(async () => cleanup.resolve());
    await act(async () => drop(path));
    expect(clear).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".review-stage")).not.toBeNull();
    if (kind === "image") expect(container.textContent).toContain(nextFile.filename);
    else expect(native.getPdfPagePreview).toHaveBeenLastCalledWith(nextFile.sessionId, 0);
  });
});

it("image paste shares the synchronous intake gate and acceptance path", async () => {
  const pending = deferred<ImageSession>(); native.pasteImage.mockReturnValue(pending.promise);
  await render("image");
  await act(async () => { button("Paste screenshot").click(); drop("another.png"); button("Choose image").click(); window.dispatchEvent(new KeyboardEvent("keydown", { key: "v", ctrlKey: true })); });
  expect(native.pasteImage).toHaveBeenCalledTimes(1); expect(native.openDroppedImage).not.toHaveBeenCalled(); expect(native.pickImage).not.toHaveBeenCalled();
  await act(async () => pending.resolve({ ...image, sourceKind: "clipboard" }));
  expect(container.querySelector(".review-stage")).not.toBeNull();
});
