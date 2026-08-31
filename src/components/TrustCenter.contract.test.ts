import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./TrustCenter.tsx", import.meta.url)), "utf8");

describe("TrustCenter interaction contract", () => {
  it("keeps the dialog keyboard-contained and user-triggered", () => {
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain('event.key !== "Tab"');
    expect(source).toContain("openProjectLink(kind)");
    expect(source).not.toContain("openProjectLink(\"");
  });
});
