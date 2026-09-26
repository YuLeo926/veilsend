import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertAcceptanceRecord } from "./acceptance-contract.mjs";

const requiredResults = [
  "assetContract", "installCurrentUser", "launchInstalled", "launchPortable", "offlineRuntime",
  "textWorkflow", "imageWorkflow", "pdfWorkflow", "savedImageDetectors", "savedPdfDetectors",
  "sourceHashesUnchanged", "noSourceDirectoryResidue", "trustCenterIdentity", "diagnosticsPrivacy",
  "dropRejections", "pdfCoordinateInvariance", "uninstallPreservesOutputs",
];

const validRecord = () => ({
  version: "0.2.0-beta.1",
  tag: "v0.2.0-beta.1",
  commit: "a".repeat(40),
  windowsVersion: "10.0.26100.0",
  architecture: "x86_64",
  signed: false,
  containsSensitiveData: false,
  fixtureHashes: {
    syntheticFace: "c243801fda58b63cc987ba19ab9c51a67fe452b4eab6804ef28cd0d1442f6abe",
    pdf: "fff96e09d22791ac0c4f56f8925409891b90b8d41540db6f85b2e3c461a7ee1e",
    pdfAttachment: "ea250860e548c1fa7b6662dab6e47d85037475ce0d7b9847d462e46f2640dbb2",
  },
  results: Object.fromEntries(requiredResults.map((name) => [name, "pass"])),
  completedAt: "2026-08-30T12:00:00.000Z",
});

test("all three checked-out synthetic fixtures match the acceptance contract bytes", () => {
  const fixtures = {
    syntheticFace: "synthetic-face-source.png",
    pdf: "pdf-sensitive-sample.pdf",
    pdfAttachment: "pdf-sensitive-attachment.txt",
  };
  for (const [field, filename] of Object.entries(fixtures)) {
    const path = fileURLToPath(new URL(`../fixtures/${filename}`, import.meta.url));
    const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
    assert.equal(actual, validRecord().fixtureHashes[field], `${filename} differs from the accepted fixture`);
  }
});

test("text attachment checkout explicitly keeps its canonical LF bytes", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const result = spawnSync("git", ["check-attr", "eol", "--", "fixtures/pdf-sensitive-attachment.txt"],
    { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^fixtures\/pdf-sensitive-attachment\.txt: eol: lf\r?\n$/);

  const temp = mkdtempSync(join(tmpdir(), "veilsend-lf-checkout-"));
  try {
    const checkout = spawnSync("git", ["-c", "core.autocrlf=true", "checkout-index",
      `--prefix=${temp}${sep}`, "--", "fixtures/pdf-sensitive-attachment.txt"],
    { cwd: root, encoding: "utf8" });
    assert.equal(checkout.status, 0, checkout.stderr);
    const actual = createHash("sha256")
      .update(readFileSync(join(temp, "fixtures", "pdf-sensitive-attachment.txt"))).digest("hex");
    assert.equal(actual, validRecord().fixtureHashes.pdfAttachment);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("accepts a complete synthetic record with exactly seventeen passes", () => {
  assert.equal(requiredResults.length, 17);
  assert.doesNotThrow(() => assertAcceptanceRecord(validRecord()));
});

test("durable release checklist maps every required acceptance result without claiming passes", () => {
  const runbook = readFileSync(new URL("../docs/release.md", import.meta.url), "utf8");
  const rows = [...runbook.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);
  assert.deepEqual(rows, requiredResults);
  assert.match(runbook, /not recorded passes/);
  assert.match(runbook, /before and after testing/);
  assert.match(runbook, /pre-test inventory/);
  assert.match(runbook, /pre\/post-uninstall hashes/);
  assert.match(runbook, /unsupported\/mismatched or forged extensions/);
});

test("rejects non-records and non-plain nested objects", () => {
  for (const value of [null, [], "record", 1, new Date()]) {
    assert.throws(() => assertAcceptanceRecord(value));
  }
  for (const field of ["fixtureHashes", "results"]) {
    for (const value of [null, [], "object", new Date()]) {
      const record = validRecord();
      record[field] = value;
      assert.throws(() => assertAcceptanceRecord(record), `${field}: ${typeof value}`);
    }
  }
});

test("rejects missing, extra, and hidden own fields at every object level", () => {
  for (const field of Object.keys(validRecord())) {
    const record = validRecord();
    delete record[field];
    assert.throws(() => assertAcceptanceRecord(record), `missing ${field}`);
  }
  const cases = [
    (record) => { record.sourcePath = "C:\\private\\document.pdf"; },
    (record) => { record.fixtureHashes.filename = "private.pdf"; },
    (record) => { record.results.ocrText = "private text"; },
    (record) => { Object.defineProperty(record, "payload", { value: "secret" }); },
    (record) => { record.results[Symbol("secret")] = "pass"; },
  ];
  for (const mutate of cases) {
    const record = validRecord();
    mutate(record);
    assert.throws(() => assertAcceptanceRecord(record));
  }
});

test("rejects wrong beta identity, types, signing, privacy, and commit values", () => {
  const badFields = {
    version: ["0.2.0", 1],
    tag: ["v0.2.0", null],
    architecture: ["arm64", 64],
    signed: [true, "false", 0],
    containsSensitiveData: [true, "false", 0],
    commit: ["A".repeat(40), "a".repeat(39), "g".repeat(40), 0],
  };
  for (const [field, values] of Object.entries(badFields)) {
    for (const value of values) {
      const record = validRecord();
      record[field] = value;
      assert.throws(() => assertAcceptanceRecord(record), `${field}: ${String(value)}`);
    }
  }
});

test("accepts Windows 10/11 four-part kernel versions and canonical UTC dates", () => {
  for (const windowsVersion of ["10.0.19045.5011", "10.0.22000.0", "10.0.26100.0"]) {
    const record = validRecord();
    record.windowsVersion = windowsVersion;
    assert.doesNotThrow(() => assertAcceptanceRecord(record));
  }
  const record = validRecord();
  record.completedAt = "2026-08-30T12:00:00.123Z";
  assert.doesNotThrow(() => assertAcceptanceRecord(record));
});

test("rejects malformed Windows versions and noncanonical or impossible dates", () => {
  for (const value of ["11.0.26100.0", "10.0.9999.0", "10.0.26100", "10.0.026100.0", "10.0.26100.-1", "10.0.26100.0/secret", 10]) {
    const record = validRecord();
    record.windowsVersion = value;
    assert.throws(() => assertAcceptanceRecord(record), `Windows version: ${value}`);
  }
  for (const value of ["2026-02-30T12:00:00.000Z", "2026-08-30", "2026-08-30T12:00:00Z", "2026-08-30T14:00:00.000+02:00", "C:\\private\\file", 1, null]) {
    const record = validRecord();
    record.completedAt = value;
    assert.throws(() => assertAcceptanceRecord(record), `date: ${value}`);
  }
});

test("rejects every altered or incomplete fixed fixture hash", () => {
  for (const field of Object.keys(validRecord().fixtureHashes)) {
    for (const value of ["0".repeat(64), "A".repeat(64), 1]) {
      const record = validRecord();
      record.fixtureHashes[field] = value;
      assert.throws(() => assertAcceptanceRecord(record), `${field}: ${value}`);
    }
    const record = validRecord();
    delete record.fixtureHashes[field];
    assert.throws(() => assertAcceptanceRecord(record), `missing ${field}`);
  }
});

test("rejects each missing or partial acceptance step", () => {
  for (const field of requiredResults) {
    for (const value of [undefined, "needsReview", "skip", true, "Pass"]) {
      const record = validRecord();
      if (value === undefined) delete record.results[field];
      else record.results[field] = value;
      assert.throws(() => assertAcceptanceRecord(record), `${field}: ${value}`);
    }
  }
});

test("validation errors never echo arbitrary path or content", () => {
  const record = validRecord();
  record["C:\\private\\secret.pdf"] = "SG_DIAGNOSTIC_SECRET token=private";
  assert.throws(() => assertAcceptanceRecord(record), (error) =>
    !/private|secret|token=|C:\\/i.test(error.message));
});

test("CLI reads one JSON file and fails closed without echoing its path", () => {
  const temp = mkdtempSync(join(tmpdir(), "veilsend-acceptance-test-"));
  const script = fileURLToPath(new URL("./acceptance-contract.mjs", import.meta.url));
  const file = join(temp, "private-path-acceptance.json");
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  try {
    writeFileSync(file, JSON.stringify(validRecord()));
    assert.equal(run(file).status, 0);
    for (const args of [[], [file, "extra"], [join(temp, "missing-private.json")]]) {
      const result = run(...args);
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stderr, /private-path|missing-private|veilsend-acceptance-test/);
    }
    writeFileSync(file, "{bad private-content");
    const parseFailure = run(file);
    assert.notEqual(parseFailure.status, 0);
    assert.doesNotMatch(parseFailure.stderr, /private-path|private-content/);
    const invalid = validRecord();
    invalid.results.savedPdfDetectors = "needsReview";
    writeFileSync(file, JSON.stringify(invalid));
    assert.notEqual(run(file).status, 0);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("CLI rejects duplicate JSON members before they can hide content or incomplete checks", () => {
  const temp = mkdtempSync(join(tmpdir(), "veilsend-duplicate-test-"));
  const file = join(temp, "private-record.json");
  const script = fileURLToPath(new URL("./acceptance-contract.mjs", import.meta.url));
  const canonical = JSON.stringify(validRecord());
  const cases = [
    canonical.replace('{', '{"results":{"sourcePath":"C:\\\\private\\\\secret.pdf","savedPdfDetectors":"needsReview"},'),
    canonical.replace('{', '{"res\\u0075lts":{"ocrText":"PRIVATE_SENTINEL"},'),
    canonical.replace('"signed":false', '"signed":true,"signed":false'),
    canonical.replace('"savedPdfDetectors":"pass"', '"savedPdfDetectors":"needsReview","savedPdfDetectors":"pass"'),
    canonical.replace('"savedPdfDetectors":"pass"', '"savedPdfDetectors":"needsReview","savedPdfDetector\\u0073":"pass"'),
    canonical.replace('"syntheticFace":', '"syntheticFace":"PRIVATE_SENTINEL","syntheticFace":'),
    canonical.replace('{', '{"results":{"hidden":[{"x":"PRIVATE_SENTINEL","\\u0078":null}]},'),
    canonical.replace('{', '{"results":{"hidden":{"deeper":{"x":1,"x":2}}},'),
  ];
  try {
    for (const raw of cases) {
      // Every attack otherwise becomes an accepted object under lossy JSON.parse.
      assert.doesNotThrow(() => assertAcceptanceRecord(JSON.parse(raw)));
      writeFileSync(file, raw);
      const result = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
      assert.equal(result.status, 1, "raw duplicate members must fail closed");
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "Could not read acceptance JSON\n");
    }
    // Do not rely on an outer duplicate to reject these deeper objects/arrays.
    for (const nested of [
      '{"hidden":{"deeper":{"x":1,"x":2}}}',
      '{"hidden":[{"x":1,"\\u0078":2}]}',
      '{"hidden":{"quote\\\"\\\\{}":1,"quote\\\"\\\\{}":2}}',
    ]) {
      const raw = canonical.replace('"results":', `"extra":${nested},"results":`);
      assert.doesNotThrow(() => JSON.parse(raw), "nested duplicate fixture must otherwise be valid JSON");
      writeFileSync(file, raw);
      const result = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "Could not read acceptance JSON\n", "duplicates must be rejected before object validation");
    }
    // Repeated names in separate objects and punctuation inside values are not duplicates.
    writeFileSync(file, canonical.replace('"results":', '"extra":{"a":{"x":1},"b":{"x":"\\\"{}[]:"}},"results":'));
    const extraFields = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
    assert.equal(extraFields.status, 1);
    assert.equal(extraFields.stderr, "Acceptance record failed validation\n");
    // Ordinary whitespace, reordered keys and unique escaped keys remain valid.
    const formatted = JSON.stringify(Object.fromEntries(Object.entries(validRecord()).reverse()), null, 2)
      .replace('"results"', '"res\\u0075lts"');
    writeFileSync(file, formatted);
    const result = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "Acceptance record valid\n");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
