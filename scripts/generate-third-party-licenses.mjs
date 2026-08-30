import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "THIRD_PARTY_LICENSES.md");
const noticeName = /^(licen[cs]e|copying|notice)([._-]|$)/i;

function normalized(value) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[ \t]+$/gm, "").trimEnd();
}

function readNoticeFiles(directory) {
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && noticeName.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  return files.map((name) => ({ name, text: normalized(readFileSync(join(directory, name), "utf8")) }));
}

function packageDirectory(pkg) {
  return dirname(pkg.manifest_path);
}

function fallbackTerms(pkg, packages) {
  const candidates = {
    "BSD-3-Clause": "alloc-no-stdlib",
    "MPL-2.0": "cssparser",
    "MIT": "rfd",
    "Apache-2.0": "base64",
  };
  const selected = new Set();
  for (const [identifier, name] of Object.entries(candidates)) {
    if (pkg.license.includes(identifier)) selected.add(name);
  }
  const terms = [];
  for (const name of selected) {
    const source = packages.find((candidate) => candidate.name === name && candidate.source);
    if (!source) throw new Error("Missing local license template source for " + name);
    for (const notice of readNoticeFiles(packageDirectory(source))) {
      if (name === "rfd" && notice.name.toLowerCase().startsWith("license")) {
        const permission = notice.text.indexOf("Permission is hereby granted");
        terms.push({
          name: "MIT terms (local template; this crate archive has no copyright line)",
          text: "MIT License\n\n" + notice.text.slice(permission),
        });
      } else {
        terms.push({
          name: notice.name + " (local template; this crate archive has no root license file)",
          text: notice.text,
        });
      }
    }
  }
  if (terms.length === 0) {
    throw new Error("No local full-license template is configured for " + pkg.name + " (" + pkg.license + ")");
  }
  return terms;
}

function fallbackMetadata(pkg) {
  const lines = [
    "Declared SPDX: " + (pkg.license ?? "NOASSERTION"),
    "Declared authors: " + (pkg.authors.length > 0 ? pkg.authors.join("; ") : "none supplied in the published crate metadata"),
    "The locked crate archive contains no root LICENSE/COPYING/NOTICE file; the full applicable terms below are copied from the stated local template.",
  ];
  return { name: "Cargo.toml metadata for archive without root notice file", text: lines.join("\n") };
}

function productionCargoPackages() {
  const metadata = JSON.parse(execFileSync("cargo", ["metadata", "--locked", "--format-version", "1", "--filter-platform", "x86_64-pc-windows-msvc"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }));
  const rootPackage = metadata.packages.find((pkg) =>
    pkg.manifest_path.replaceAll("/", sep).endsWith(join("src-tauri", "Cargo.toml")),
  );
  if (!rootPackage) throw new Error("Could not locate the src-tauri package in Cargo metadata");

  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const reachable = new Set([rootPackage.id]);
  const pending = [rootPackage.id];
  while (pending.length > 0) {
    const id = pending.shift();
    for (const dependency of nodes.get(id).deps) {
      if (!dependency.dep_kinds.some((kind) => kind.kind === null)) continue;
      if (!reachable.has(dependency.pkg)) {
        reachable.add(dependency.pkg);
        pending.push(dependency.pkg);
      }
    }
  }

  return metadata.packages
    .filter((pkg) => reachable.has(pkg.id) && pkg.source)
    .map((pkg) => {
      const notices = readNoticeFiles(packageDirectory(pkg));
      return {
        ecosystem: "Cargo",
        name: pkg.name,
        version: pkg.version,
        license: pkg.license ?? "NOASSERTION",
        source: pkg.repository ?? pkg.homepage ?? pkg.source,
        notices: notices.length > 0 ? notices : [fallbackMetadata(pkg), ...fallbackTerms(pkg, metadata.packages)],
      };
    });
}

function productionNpmPackages() {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  return Object.entries(lock.packages)
    .filter(([path, pkg]) => path.startsWith("node_modules/") && pkg.dev !== true)
    .map(([path, pkg]) => {
      const directory = join(root, ...path.split("/"));
      if (!existsSync(directory)) throw new Error("npm package is missing from node_modules: " + path);
      const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
      return {
        ecosystem: "npm",
        name: manifest.name,
        version: manifest.version,
        license: manifest.license ?? pkg.license ?? "NOASSERTION",
        source: typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url ?? manifest.homepage ?? "NOASSERTION",
        notices: readNoticeFiles(directory),
      };
    });
}

function renderPackage(pkg) {
  const lines = [
    "### " + pkg.name + " " + pkg.version,
    "",
    "- SPDX: " + pkg.license,
    "- Upstream: " + pkg.source.replace(/^git\+/, ""),
  ];
  for (const notice of pkg.notices) {
    lines.push("", "#### " + notice.name, "", "~~~~text", notice.text, "~~~~");
  }
  return lines.join("\n");
}

function sortPackages(packages) {
  return packages.sort((left, right) =>
    (left.name + "@" + left.version).localeCompare(right.name + "@" + right.version),
  );
}

function render() {
  const cargo = sortPackages(productionCargoPackages());
  const npm = sortPackages(productionNpmPackages());
  return [
    "# Third-party licenses",
    "",
    "This generated notice bundle covers the locked production dependency graph included in VeilSend Windows binaries. It embeds the root LICENSE/COPYING/NOTICE files shipped by each resolved package; package-specific copyright lines and full license text are intentionally preserved verbatim.",
    "",
    "Generation is offline and reproducible from Cargo.lock, package-lock.json, the Cargo registry sources, and node_modules. Cargo traversal follows only normal dependency edges from src-tauri; Cargo development and build dependencies are excluded. npm entries with dev: true in package-lock.json are excluded. Run node scripts/generate-third-party-licenses.mjs --check after dependencies are materialized to verify this committed bundle.",
    "",
    "The CycloneDX SBOM remains the release inventory for component identification, but it does not replace these license and NOTICE texts.",
    "",
    "## Cargo production dependency notices (" + cargo.length + ")",
    "",
    ...cargo.flatMap((pkg) => [renderPackage(pkg), ""]),
    "## npm production dependency notices (" + npm.length + ")",
    "",
    ...npm.flatMap((pkg) => [renderPackage(pkg), ""]),
  ].join("\n").trimEnd();
}

const content = render();
if (process.argv.includes("--check")) {
  if (normalized(readFileSync(output, "utf8")) !== normalized(content)) {
    throw new Error("THIRD_PARTY_LICENSES.md is out of date; run node scripts/generate-third-party-licenses.mjs --write");
  }
  process.stdout.write("THIRD_PARTY_LICENSES.md is current\n");
} else if (process.argv.includes("--write")) {
  writeFileSync(output, content + "\n", "utf8");
  process.stdout.write("Wrote THIRD_PARTY_LICENSES.md\n");
} else {
  throw new Error("Usage: node scripts/generate-third-party-licenses.mjs --write|--check");
}
