import { invoke } from "@tauri-apps/api/core";
import { sanitizeInBrowser, scanInBrowser } from "./browserScanner";
import type {
  CleanedImageFile,
  CleanedPdfFile,
  ImageSession,
  ImageRedactionDecision,
  PdfManualRegion,
  PdfPagePreview,
  PdfSession,
  RuntimeInfo,
  SanitizeRequest,
  SanitizeResult,
  ScanOptions,
  ScanReport,
} from "./types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isDesktop = () => Boolean(window.__TAURI_INTERNALS__);

export async function getRuntimeInfo(): Promise<RuntimeInfo> {
  return isDesktop()
    ? invoke<RuntimeInfo>("get_runtime_info")
    : Promise.resolve({
        appVersion: "0.2.0-beta.1",
        channel: "browser-preview",
        commit: "unverified",
        verifiedBuild: false,
        target: "browser",
        osVersion: "browser",
        license: "MIT",
        detectors: {
          text: "available",
          metadata: "unavailable",
          face: "unavailable",
          qr: "unavailable",
          barcode: "unavailable",
          pdf: "unavailable",
        },
      });
}

export async function scanText(text: string, options: ScanOptions): Promise<ScanReport> {
  return isDesktop()
    ? invoke<ScanReport>("scan_text", { text, options })
    : scanInBrowser(text, options);
}

export async function sanitizeText(request: SanitizeRequest): Promise<SanitizeResult> {
  return isDesktop()
    ? invoke<SanitizeResult>("sanitize_text", { request })
    : sanitizeInBrowser(request);
}

export async function saveCleanedText(defaultName: string, content: string): Promise<string | null> {
  if (isDesktop()) return invoke<string | null>("save_cleaned_text", { defaultName, content });
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = defaultName;
  anchor.click();
  URL.revokeObjectURL(url);
  return defaultName;
}

export async function pickImage(): Promise<ImageSession | null> {
  if (!isDesktop()) {
    throw new Error("Image metadata cleaning is available in the VeilSend desktop app.");
  }
  return invoke<ImageSession | null>("pick_image");
}

export async function pasteImage(): Promise<ImageSession> {
  if (!isDesktop()) {
    throw new Error("Screenshot paste is available in the VeilSend desktop app.");
  }
  return invoke<ImageSession>("paste_image");
}

export async function clearImageSession(): Promise<void> {
  if (!isDesktop()) return;
  return invoke<void>("clear_image_session");
}

export async function cleanImageFile(
  sessionId: string,
  decisions: ImageRedactionDecision[],
): Promise<CleanedImageFile | null> {
  if (!isDesktop()) {
    throw new Error("Image metadata cleaning is available in the VeilSend desktop app.");
  }
  return invoke<CleanedImageFile | null>("clean_image_file", {
    sessionId,
    decisions,
  });
}

export async function pickPdf(): Promise<PdfSession | null> {
  if (!isDesktop()) {
    throw new Error("PDF safety copies are available in the VeilSend desktop app.");
  }
  return invoke<PdfSession | null>("pick_pdf");
}

export async function getPdfPagePreview(
  sessionId: string,
  pageIndex: number,
): Promise<PdfPagePreview> {
  if (!isDesktop()) {
    throw new Error("PDF page review is available in the VeilSend desktop app.");
  }
  return invoke<PdfPagePreview>("get_pdf_page_preview", { sessionId, pageIndex });
}

export async function clearPdfSession(): Promise<void> {
  if (!isDesktop()) return;
  return invoke<void>("clear_pdf_session");
}

export async function cleanPdfFile(
  sessionId: string,
  decisions: ImageRedactionDecision[],
  manualRegions: PdfManualRegion[],
): Promise<CleanedPdfFile | null> {
  if (!isDesktop()) {
    throw new Error("PDF safety copies are available in the VeilSend desktop app.");
  }
  return invoke<CleanedPdfFile | null>("clean_pdf_file", {
    sessionId,
    decisions,
    manualRegions,
  });
}
