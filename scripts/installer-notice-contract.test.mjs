import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("verifies the final NSIS installation and cleans only its explicit temporary scope", () => {
  const verifier = resolve(root, "scripts", "verify-installed-notice.ps1");
  assert.equal(existsSync(verifier), true);
  const script = readFileSync(verifier, "utf8");
  assert.match(script, /InstallDirectory/);
  assert.match(script, /Refusing to use an existing install directory/);
  assert.match(script, /Get-FileHash -Algorithm SHA256/);
  assert.match(script, /CryptographicOperations.*FixedTimeEquals/);
  assert.match(script, /\$startProcess.*\/S/);
  assert.match(script, /_\?=/);
  assert.match(script, /THIRD_PARTY_LICENSES\.md/);
  assert.match(script, /Remove-Item -LiteralPath \$directory -Recurse -Force/);

  const workflow = readFileSync(resolve(root, ".github", "workflows", "release.yml"), "utf8");
  const stageAt = workflow.indexOf("Stage unsigned beta assets");
  const verifyAt = workflow.indexOf("Verify installed NSIS notice bundle");
  const sbomAt = workflow.indexOf("Generate CycloneDX SBOM");
  assert.ok(stageAt >= 0 && verifyAt > stageAt && sbomAt > verifyAt);
  assert.match(workflow, /scripts\/verify-installed-notice\.ps1/);
});

test("failure-path verifier cleanup is executable", () => {
  execFileSync("pwsh", ["-NoProfile", "-File", resolve(root, "scripts", "verify-installed-notice.failure.test.ps1")], {
    cwd: root,
    stdio: "pipe",
  });
});
