import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function readReleaseIdentity(rootDir) {
  const packageVersion = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")).version;
  const cargo = readFileSync(join(rootDir, "src-tauri", "Cargo.toml"), "utf8");
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const tauriVersion = JSON.parse(readFileSync(join(rootDir, "src-tauri", "tauri.conf.json"), "utf8")).version;
  return { packageVersion, cargoVersion, tauriVersion };
}

export function assertReleaseIdentity(rootDir, tag) {
  const identity = readReleaseIdentity(rootDir);
  const versions = Object.values(identity);
  if (versions.some((value) => value !== versions[0])) {
    throw new Error(`Version mismatch: ${JSON.stringify(identity)}`);
  }
  const version = versions[0];
  if (version !== "0.2.0-beta.1") throw new Error(`v0.2 workflow only permits 0.2.0-beta.1, got ${version}`);
  if (tag && tag !== `v${version}`) throw new Error(`Tag ${tag} does not match v${version}`);
  return version;
}

export function releaseAssetNames(version) {
  return {
    installer: `VeilSend_${version}_x64-setup-UNSIGNED.exe`,
    portable: `VeilSend_${version}_x64-portable-UNSIGNED.zip`,
    sbom: `veilsend-${version}-sbom.cdx.json`,
    checksums: "SHA256SUMS.txt",
  };
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = resolve(dirname(modulePath), "..");
  process.stdout.write(`${assertReleaseIdentity(root, process.argv[2])}\n`);
}
