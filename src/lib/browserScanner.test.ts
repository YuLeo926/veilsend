import { describe, expect, it } from "vitest";
import { sanitizeInBrowser, scanInBrowser } from "./browserScanner";
import type { ScanOptions } from "./types";

const options: ScanOptions = { maxBytes: 10 * 1024 * 1024, customTerms: ["Project Firefly"] };

describe("browser preview scanner", () => {
  it("finds supported categories in synthetic text", async () => {
    const report = await scanInBrowser(
      "email=alex@example.com\napi_key=sg_FAKE_KEY_1234567890\nhost=192.168.1.20\nProject Firefly",
      options,
    );
    expect(report.findings.map((finding) => finding.category)).toEqual(expect.arrayContaining(["credential", "personal", "network", "custom"]));
    expect(report.findings.every((finding) => !finding.maskedValue.includes("example.com"))).toBe(true);
  });

  it("does not mistake an ISO timestamp for a phone number", async () => {
    const report = await scanInBrowser("[2026-08-12 09:41:22] service started", options);
    expect(report.findings.some((finding) => finding.ruleId === "personal.phone")).toBe(false);
  });

  it("cleans every selected finding and verifies the output", async () => {
    const originalText = "email=alex@example.com password=totally-fake-password";
    const report = await scanInBrowser(originalText, options);
    const result = await sanitizeInBrowser({
      originalText,
      contentFingerprint: report.contentFingerprint,
      findings: report.findings,
      decisions: report.findings.map((finding) => ({ id: finding.id, enabled: true, replacement: finding.replacement })),
      options,
    });
    expect(result.cleanedText).not.toContain("alex@example.com");
    expect(result.cleanedText).not.toContain("totally-fake-password");
    expect(result.verification.status).toBe("verified");
  });

  it("keeps excluded matches visible to verification", async () => {
    const originalText = "email=alex@example.com";
    const report = await scanInBrowser(originalText, options);
    const result = await sanitizeInBrowser({
      originalText,
      contentFingerprint: report.contentFingerprint,
      findings: report.findings,
      decisions: report.findings.map((finding) => ({ id: finding.id, enabled: false, replacement: finding.replacement })),
      options,
    });
    expect(result.verification.status).toBe("cleanedWithExceptions");
    expect(result.verification.exceptions).toBe(1);
  });
});
