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
    )) as { permissions: Array<string | { identifier: string; allow?: Array<{ url: string }> }> };
    const openerPermissions = capability.permissions.filter((permission) =>
      (typeof permission === "string" ? permission : permission.identifier).startsWith("opener:"),
    );

    expect(openerPermissions).toEqual([
      {
        identifier: "opener:allow-open-url",
        allow: [
          { url: "https://github.com/YuLeo926/veilsend" },
          { url: "https://github.com/YuLeo926/veilsend/releases" },
          { url: "https://github.com/YuLeo926/veilsend/security" },
        ],
      },
    ]);
    const allowedUrls = openerPermissions.flatMap((permission) => typeof permission === "string" ? [] : permission.allow?.map(({ url }) => url) ?? []);
    expect(allowedUrls).toHaveLength(3);
    expect(allowedUrls).not.toContainEqual(expect.stringMatching(/[?*]/));
  });
});
