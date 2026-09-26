import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    pdfAttachment: "c7f94c54296fdc83d2d595189356d2079e5911fca6738ad2f1b1b87a0df98cc3",
  },
  results: Object.fromEntries(requiredResults.map((name) => [name, "pass"])),
  completedAt: "2026-08-30T12:00:00.000Z",
});

test("accepts a complete synthetic record with exactly seventeen passes", () => {
  assert.equal(requiredResults.length, 17);
  assert.doesNotThrow(() => assertAcceptanceRecord(validRecord()));
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
