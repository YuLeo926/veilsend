import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("ships an auditable production license bundle in both Windows channels", () => {
  const config = JSON.parse(readFileSync(resolve(root, "src-tauri", "tauri.conf.json"), "utf8"));
  assert.deepEqual(config.bundle.resources, ["../THIRD_PARTY_LICENSES.md"]);

  const licenses = readFileSync(resolve(root, "THIRD_PARTY_LICENSES.md"), "utf8");
  assert.doesNotMatch(licenses, /respective copyright holders/i);
  assert.match(licenses, /Copyright \(c\) 2016-2023 KAMADA Ken'ichi/);
  assert.match(licenses, /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/);
  assert.match(licenses, /END OF TERMS AND CONDITIONS/);
  assert.match(licenses, /## Cargo production dependency notices/);
  assert.match(licenses, /## npm production dependency notices/);
  assert.doesNotMatch(licenses, /qrcode 0\.14\.1/);
});
