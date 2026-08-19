import { invoke } from "@tauri-apps/api/core";
import { sanitizeInBrowser, scanInBrowser } from "./browserScanner";
import type {
  CleanedImageFile,
  ImageSession,
  ImageRedactionDecision,
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
    throw new Error("Image metadata cleaning is available in the ShareGate desktop app.");
  }
  return invoke<ImageSession | null>("pick_image");
}

export async function pasteImage(): Promise<ImageSession> {
  if (!isDesktop()) {
    throw new Error("Screenshot paste is available in the ShareGate desktop app.");
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
    throw new Error("Image metadata cleaning is available in the ShareGate desktop app.");
  }
  return invoke<CleanedImageFile | null>("clean_image_file", {
    sessionId,
    decisions,
  });
}
