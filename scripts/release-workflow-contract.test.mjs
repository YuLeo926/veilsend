import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const workflowPath = resolve(root, ".github", "workflows", "release.yml");
const ciWorkflowPath = resolve(root, ".github", "workflows", "ci.yml");

// Offline allowlist of verified commit objects. Do not substitute tag-object SHAs.
const verifiedActionCommitPins = Object.freeze([
  "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
  "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
  "anchore/sbom-action@e22c389904149dbc22b58101806040fa8d37a610",
  "actions/upload-artifact@330a01c490aca151604b8cf639adc76d48f6c5d4",
  "actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8",
]);

test("limits release writes to version tags and pins every third-party action", () => {
  assert.equal(existsSync(workflowPath), true, "release workflow must exist");
  const workflow = readFileSync(workflowPath, "utf8");

  assert.match(workflow, /push:\s*\r?\n\s+tags: \["v\*"\]/);
  assert.doesNotMatch(workflow, /pull_request(?:_target)?:/);
  assert.doesNotMatch(workflow, /branches:/);
  assert.match(workflow, /permissions:\s*\r?\n\s+contents: write\s*\r?\n\s+id-token: write\s*\r?\n\s+attestations: write/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}[^]*?persist-credentials: false/);
  assert.ok(
    workflow.indexOf("Verify tag, version, and release asset contract") < workflow.indexOf("Install dependencies"),
    "the tag contract must run before repository install scripts",
  );

  const tokenBindings = workflow.match(/GH_TOKEN: \$\{\{ github\.token \}\}/g) ?? [];
  assert.equal(tokenBindings.length, 2, "only the two gh CLI steps may receive GH_TOKEN");

  const actionRefs = [...workflow.matchAll(/^\s+(?:- )?uses: ([^\s]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
  assert.deepEqual(actionRefs, verifiedActionCommitPins);
  assert.doesNotMatch(workflow, /actions\/attest-build-provenance@8beda2b7ed98355c0e97c0a63bec38ae472e66c4/);
});

test("derives exact assets from the release contract and creates only a draft prerelease", () => {
  const workflow = readFileSync(workflowPath, "utf8");

  assert.match(workflow, /releaseAssetNames/);
  assert.match(workflow, /GITHUB_OUTPUT/);
  assert.match(workflow, /steps\.contract\.outputs\.sbom/);
  assert.match(workflow, /node scripts\/release-contract\.mjs \$env:GITHUB_REF_NAME/);
  assert.match(workflow, /Stage unsigned beta assets/);
  assert.match(workflow, /Generate CycloneDX SBOM/);
  assert.match(workflow, /format: cyclonedx-json/);
  const sbomStep = workflow.slice(workflow.indexOf("Generate CycloneDX SBOM"), workflow.indexOf("Generate SHA-256 file"));
  assert.match(sbomStep, /upload-release-assets: false/);
  assert.match(sbomStep, /github-token: ""/);
  assert.match(workflow, /Generate SHA-256 file/);
  assert.match(workflow, /Malformed checksum line/);
  assert.match(workflow, /Checksum mismatch/);
  assert.match(workflow, /Unexpected checksummed asset set/);
  assert.match(workflow, /Release already exists; inspect and explicitly remove a failed draft before retrying\./);
  assert.match(workflow, /name: veilsend-v\$\{\{ steps\.contract\.outputs\.version \}\}-release-assets/);
  assert.match(workflow, /Attest build provenance/);
  assert.match(workflow, /gh release create[\s\S]*--draft[\s\S]*--prerelease[\s\S]*--verify-tag/);
  assert.match(workflow, /--notes-file RELEASE_NOTES\.md/);
});

test("treats only an explicit GitHub API 404 as an absent release", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const guardStart = workflow.indexOf("Refuse an existing release");
  const guardEnd = workflow.indexOf("Install Rust toolchain");
  const guard = workflow.slice(guardStart, guardEnd);

  assert.ok(guardStart >= 0 && guardEnd > guardStart, "release guard must run before toolchain and dependency installation");
  assert.match(guard, /gh api --include/);
  assert.match(guard, /repos\/\$env:GITHUB_REPOSITORY\/releases\/tags\/\$env:GITHUB_REF_NAME/);
  assert.match(guard, /\$apiExitCode = \$LASTEXITCODE/);
  assert.match(guard, /\$apiExitCode -eq 0/);
  assert.match(guard, /\$statusCodes\[-1\] -eq 404/);
  assert.match(guard, /Unable to determine whether release exists/);
  assert.doesNotMatch(guard, /gh release view/);
});

test("enforces committed Cargo locks and the generated license bundle in every trusted gate", () => {
  const ci = readFileSync(ciWorkflowPath, "utf8");
  const release = readFileSync(workflowPath, "utf8");
  const development = readFileSync(resolve(root, "docs", "development.md"), "utf8");
  const readme = readFileSync(resolve(root, "README.md"), "utf8");
  const licenseGenerator = readFileSync(resolve(root, "scripts", "generate-third-party-licenses.mjs"), "utf8");

  for (const [name, workflow] of [["ordinary CI", ci], ["release", release]]) {
    assert.match(workflow, /npm run check:licenses/, `${name} must reject a stale generated license bundle`);
    assert.match(workflow, /cargo clippy --locked --workspace --all-targets --all-features -- -D warnings/);
    assert.match(workflow, /cargo test --locked --workspace --all-features/);
    assert.doesNotMatch(workflow, /cargo (?:clippy|test) --workspace/);
  }

  assert.match(release, /npm run tauri -- build -- --locked/);
  assert.doesNotMatch(release, /run: npm run tauri build\s*(?:\r?\n|$)/);
  assert.match(licenseGenerator, /"metadata", "--locked"/);

  assert.match(development, /npm run check:licenses/);
  assert.match(development, /cargo clippy --locked --workspace/);
  assert.match(development, /cargo test --locked --workspace/);
  assert.match(development, /npm run tauri -- build -- --locked/);

  assert.match(readme, /npm run check:licenses/);
  assert.match(readme, /cargo clippy --locked --workspace --all-targets -- -D warnings/);
  assert.match(readme, /cargo test --locked --workspace/);
  assert.match(readme, /cargo check --locked -p veilsend/);
  assert.match(readme, /npm run tauri -- build --no-bundle -- --locked/);
  assert.doesNotMatch(readme, /cargo (?:clippy|test) --workspace/);
  assert.doesNotMatch(readme, /cargo check -p veilsend/);
  assert.doesNotMatch(readme, /npm run tauri build -- --no-bundle/);
  assert.doesNotMatch(readme, /cargo fmt --locked/);
});

test("removes only the versioned portable staging child after the ZIP closes", () => {
  const stage = readFileSync(resolve(root, "scripts", "stage-release.ps1"), "utf8");
  const compressAt = stage.indexOf("Compress-Archive");
  const cleanupAt = stage.indexOf("Remove-Item -LiteralPath $portableRoot -Recurse -Force", compressAt);

  assert.ok(compressAt >= 0, "portable ZIP must be created");
  assert.ok(cleanupAt > compressAt, "portable staging child must be removed after compression");
  assert.doesNotMatch(stage, /Remove-Item -LiteralPath \$temporaryBase/);
});
