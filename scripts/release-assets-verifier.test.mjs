import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { releaseAssetNames } from "./release-contract.mjs";

const root = resolve(import.meta.dirname, "..");

test("download verifier pins the producer asset names and provenance identity", () => {
  const script = readFileSync(resolve(root, "scripts/verify-release-assets.ps1"), "utf8");
  for (const name of Object.values(releaseAssetNames("0.2.0-beta.1"))) {
    assert.ok(script.includes(`'${name}'`), `missing exact producer name: ${name}`);
  }
  assert.ok(script.includes('--signer-workflow "$Repository/.github/workflows/release.yml"'));
  assert.ok(script.includes('--cert-identity "https://github.com/$Repository/.github/workflows/release.yml@refs/tags/v0.2.0-beta.1"'));
  assert.ok(script.includes("--source-ref refs/tags/v0.2.0-beta.1"));
  assert.ok(script.includes("--predicate-type https://slsa.dev/provenance/v1"));
  assert.ok(script.includes("--deny-self-hosted-runners"));
  assert.doesNotMatch(script, /Start-Process|Expand-Archive/);
});

test("Windows downloaded-asset fixtures (rebuildable unsigned PE, no execution)", {
  skip: process.platform !== "win32" ? "Requires Windows Authenticode; run the Windows fixture gate before acceptance" : false,
  timeout: 180_000,
}, () => {
  const result = spawnSync("pwsh", ["-NoProfile", "-File", "scripts/verify-release-assets.test.ps1"], {
    cwd: root, encoding: "utf8", timeout: 175_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /48 asset verifier fixture tests passed/);
});
