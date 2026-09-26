import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertPublicDocs } from "./docs-contract.mjs";

test("public v0.2 documents carry every trust boundary", () => {
  assertPublicDocs(fileURLToPath(new URL("..", import.meta.url)));
});

test("reports every missing allowlisted document", () => {
  const root = mkdtempSync(join(tmpdir(), "veilsend-docs-contract-"));
  try {
    assert.throws(() => assertPublicDocs(root), error =>
      ["README.md", "SECURITY.md", "CHANGELOG.md", "CONTRIBUTING.md", "docs/release.md"]
        .every(path => error.message.includes(`${path}: file missing`)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports missing concepts with their document names", () => {
  const root = mkdtempSync(join(tmpdir(), "veilsend-docs-contract-"));
  try {
    for (const path of ["README.md", "SECURITY.md", "CHANGELOG.md", "CONTRIBUTING.md", "docs/release.md"]) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), "placeholder");
    }
    assert.throws(() => assertPublicDocs(root), error =>
      error.message.includes("README.md: SHA-256") &&
      error.message.includes("SECURITY.md: GitHub private vulnerability reporting") &&
      error.message.includes("docs/release.md: attestation"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
