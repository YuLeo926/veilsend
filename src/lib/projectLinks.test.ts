import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { projectUrl } from "./projectLinks";

describe("project links", () => {
  it("returns only exact VeilSend GitHub destinations", () => {
    expect(projectUrl("source")).toBe("https://github.com/YuLeo926/veilsend");
    expect(projectUrl("releases")).toBe("https://github.com/YuLeo926/veilsend/releases");
    expect(projectUrl("security")).toBe("https://github.com/YuLeo926/veilsend/security");
  });

  it("grants the opener only those three exact destinations", () => {
    const capability = JSON.parse(readFileSync(
      fileURLToPath(new URL("../../src-tauri/capabilities/default.json", import.meta.url)),
      "utf8",
    )) as { permissions: Array<string | { identifier: string; allow: Array<{ url: string }> }> };
    const opener = capability.permissions.find((permission) => typeof permission !== "string" && permission.identifier === "opener:allow-open-url");

    expect(opener).toEqual({
      identifier: "opener:allow-open-url",
      allow: [
        { url: "https://github.com/YuLeo926/veilsend" },
        { url: "https://github.com/YuLeo926/veilsend/releases" },
        { url: "https://github.com/YuLeo926/veilsend/security" },
      ],
    });
    expect(capability.permissions).not.toContain("opener:default");
    expect(JSON.stringify(capability)).not.toMatch(/https?:\/\/\*/);
  });
});
