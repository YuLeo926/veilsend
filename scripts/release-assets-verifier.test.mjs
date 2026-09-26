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
  assert.ok(script.includes('--cert-identity "https://github.com/$Repository/.github/workflows/release.yml@refs/tags/v0.2.0-beta.1"'));
  assert.doesNotMatch(script, /--signer-workflow|--signer-repo|--cert-identity-regex/);
  assert.ok(script.includes("--source-ref refs/tags/v0.2.0-beta.1"));
  assert.ok(script.includes("--predicate-type https://slsa.dev/provenance/v1"));
  assert.ok(script.includes("--deny-self-hosted-runners"));
  assert.doesNotMatch(script, /Start-Process|Expand-Archive/);
});

test("source-digest runbook pins the accepted commit and one exact identity selector for all four assets", () => {
  const docs = readFileSync(resolve(root, "docs/release.md"), "utf8");
  const example = docs.split("```powershell").map((block) => block.split("```")[0])
    .find((block) => block.includes("--source-digest $acceptedCommit"));
  assert.ok(example, "missing four-asset source-digest example");
  assert.ok(example.includes("$acceptedCommit = $record.commit"));
  assert.ok(example.includes("if ($acceptedCommit -cne 'bbaa1c7488cff90338e73380161ffaa4875b9880')"));
  for (const name of Object.values(releaseAssetNames("0.2.0-beta.1"))) {
    assert.ok(example.includes(`'${name}'`), `missing digest check asset: ${name}`);
  }
  assert.ok(example.includes("foreach ($asset in $assets)"));
  assert.ok(example.includes("--repo YuLeo926/veilsend"));
  assert.ok(example.includes("--cert-identity 'https://github.com/YuLeo926/veilsend/.github/workflows/release.yml@refs/tags/v0.2.0-beta.1'"));
  assert.ok(example.includes("--source-ref refs/tags/v0.2.0-beta.1"));
  assert.ok(example.includes("--predicate-type https://slsa.dev/provenance/v1"));
  assert.ok(example.includes("--deny-self-hosted-runners"));
  assert.doesNotMatch(example, /--signer-workflow|--signer-repo|--cert-identity-regex/);
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
