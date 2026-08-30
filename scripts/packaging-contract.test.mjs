import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("enables only the current-user NSIS beta bundle surface", () => {
  const config = JSON.parse(readFileSync(resolve(root, "src-tauri", "tauri.conf.json"), "utf8"));
  assert.deepEqual(config.bundle, {
    active: true,
    targets: ["nsis"],
    resources: ["../THIRD_PARTY_LICENSES.md"],
    icon: ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.ico"],
    windows: {
      webviewInstallMode: { type: "downloadBootstrapper", silent: true },
      nsis: {
        installMode: "currentUser",
        installerIcon: "icons/icon.ico",
        startMenuFolder: "VeilSend",
        displayLanguageSelector: false,
      },
    },
  });
});

test("documents and stages the unsigned beta assets", () => {
  const stage = resolve(root, "scripts", "stage-release.ps1");
  assert.equal(existsSync(stage), true);
  const stageText = readFileSync(stage, "utf8");
  assert.ok(stageText.includes("Join-Path $workspace 'target\\release'"));
  assert.match(stageText, /Expected exactly one NSIS installer/);
  assert.match(stageText, /VeilSend_\$\{Version\}_x64-setup-UNSIGNED\.exe/);
  assert.match(stageText, /VeilSend_\$\{Version\}_x64-portable-UNSIGNED\.zip/);

  const notes = readFileSync(resolve(root, "RELEASE_NOTES.md"), "utf8");
  assert.match(notes, /^VeilSend 0\.2\.0-beta\.1 is an unsigned pre-release/);
  assert.match(notes, /SmartScreen/i);
  assert.match(notes, /SHA-256/i);
  assert.match(notes, /offline/i);

  const licenses = readFileSync(resolve(root, "THIRD_PARTY_LICENSES.md"), "utf8");
  assert.match(licenses, /CycloneDX SBOM remains the release inventory/i);
  assert.match(licenses, /MIT License/);
  assert.match(licenses, /Apache License/);
  assert.match(licenses, /Copyright \(c\) 2016-2023 KAMADA Ken'ichi\./);
  assert.match(licenses, /ISC License/);
  assert.match(licenses, /Copyright \(c\) for portions of Lucide are held by Cole Bemis 2013-2022 as part\s+of Feather \(MIT\)\. All other copyright \(c\) for Lucide are held by Lucide\s+Contributors 2022\./);

  const readme = readFileSync(resolve(root, "README.md"), "utf8");
  assert.match(readme, /unsigned pre-release/i);
  assert.match(readme, /SHA-256/i);
});
