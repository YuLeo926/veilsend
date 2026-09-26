import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertReleaseIdentity, releaseAssetNames } from "./release-contract.mjs";

function fixture(packageVersion, cargoVersion, tauriVersion) {
  const root = mkdtempSync(join(tmpdir(), "veilsend-release-"));
  mkdirSync(join(root, "src-tauri"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: packageVersion }));
  writeFileSync(join(root, "src-tauri", "Cargo.toml"), `[package]\nname = "veilsend"\nversion = "${cargoVersion}"\n`);
  writeFileSync(join(root, "src-tauri", "tauri.conf.json"), JSON.stringify({ version: tauriVersion }));
  return root;
}

test("accepts the exact beta version and tag", () => {
  assert.equal(assertReleaseIdentity(fixture("0.2.0-beta.1", "0.2.0-beta.1", "0.2.0-beta.1"), "v0.2.0-beta.1"), "0.2.0-beta.1");
});

test("rejects mismatched files, tags, and stable v0.2", () => {
  assert.throws(() => assertReleaseIdentity(fixture("0.2.0-beta.1", "0.2.0", "0.2.0-beta.1")));
  assert.throws(() => assertReleaseIdentity(fixture("0.2.0-beta.1", "0.2.0-beta.1", "0.2.0-beta.1"), "v0.2.0"));
});

test("uses the public asset contract", () => {
  assert.deepEqual(releaseAssetNames("0.2.0-beta.1"), {
    installer: "VeilSend_0.2.0-beta.1_x64-setup-UNSIGNED.exe",
    portable: "VeilSend_0.2.0-beta.1_x64-portable-UNSIGNED.zip",
    sbom: "veilsend-0.2.0-beta.1-sbom.cdx.json",
    checksums: "SHA256SUMS.txt",
  });
});
