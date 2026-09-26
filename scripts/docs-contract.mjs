import { readFileSync } from "node:fs";
import { join } from "node:path";

const requirements = {
  "README.md": ["0.2.0-beta.1", "unsigned pre-release", "SHA-256", "works offline after installation", "Windows 10/11 x64"],
  "SECURITY.md": ["GitHub private vulnerability reporting", "Never attach real", "0.2.0-beta.1"],
  "CHANGELOG.md": ["0.2.0-beta.1", "Added", "Known limitations"],
  "CONTRIBUTING.md": ["synthetic", "cargo clippy", "npm test", "no source content"],
  "docs/release.md": ["draft", "pre-release", "SHA256SUMS.txt", "SBOM", "attestation", "SmartScreen"],
};

export function assertPublicDocs(rootDir) {
  const missing = [];
  for (const [relativePath, concepts] of Object.entries(requirements)) {
    let content;
    try {
      content = readFileSync(join(rootDir, relativePath), "utf8").toLowerCase();
    } catch {
      missing.push(`${relativePath}: file missing`);
      continue;
    }
    for (const concept of concepts) {
      if (!content.includes(concept.toLowerCase())) missing.push(`${relativePath}: ${concept}`);
    }
  }
  if (missing.length) throw new Error(`Public documentation contract failed:\n${missing.join("\n")}`);
}
