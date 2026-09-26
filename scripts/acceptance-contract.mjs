import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const topLevel = [
  "version", "tag", "commit", "windowsVersion", "architecture", "signed",
  "containsSensitiveData", "fixtureHashes", "results", "completedAt",
];

const fixtureHashes = {
  syntheticFace: "c243801fda58b63cc987ba19ab9c51a67fe452b4eab6804ef28cd0d1442f6abe",
  pdf: "fff96e09d22791ac0c4f56f8925409891b90b8d41540db6f85b2e3c461a7ee1e",
  pdfAttachment: "c7f94c54296fdc83d2d595189356d2079e5911fca6738ad2f1b1b87a0df98cc3",
};

const requiredResults = [
  "assetContract", "installCurrentUser", "launchInstalled", "launchPortable", "offlineRuntime",
  "textWorkflow", "imageWorkflow", "pdfWorkflow", "savedImageDetectors", "savedPdfDetectors",
  "sourceHashesUnchanged", "noSourceDirectoryResidue", "trustCenterIdentity", "diagnosticsPrivacy",
  "dropRejections", "pdfCoordinateInvariance", "uninstallPreservesOutputs",
];

function assertExactObject(value, expectedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("Acceptance record object shape is invalid");
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== expectedKeys.length ||
      ownKeys.some((key) => typeof key !== "string" || !expectedKeys.includes(key)) ||
      expectedKeys.some((key) => !Object.hasOwn(value, key)) ||
      ownKeys.some((key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"))) {
    throw new Error("Acceptance record fields differ from the contract");
  }
}

function isWindowsKernelVersion(value) {
  if (typeof value !== "string") return false;
  const parts = /^10\.0\.([1-9][0-9]{4})\.(0|[1-9][0-9]{0,5})$/.exec(value);
  return parts !== null && Number(parts[1]) >= 10240;
}

function isCanonicalTimestamp(value) {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function assertAcceptanceRecord(record) {
  assertExactObject(record, topLevel);
  assertExactObject(record.fixtureHashes, Object.keys(fixtureHashes));
  assertExactObject(record.results, requiredResults);

  if (record.version !== "0.2.0-beta.1" || record.tag !== "v0.2.0-beta.1") {
    throw new Error("Acceptance beta identity is invalid");
  }
  if (typeof record.commit !== "string" || !/^[0-9a-f]{40}$/.test(record.commit) ||
      !isWindowsKernelVersion(record.windowsVersion) || record.architecture !== "x86_64") {
    throw new Error("Acceptance build identity is invalid");
  }
  if (record.signed !== false || record.containsSensitiveData !== false) {
    throw new Error("Acceptance signing or privacy disclosure is invalid");
  }
  if (!isCanonicalTimestamp(record.completedAt)) {
    throw new Error("Acceptance completion time is invalid");
  }
  for (const [name, expected] of Object.entries(fixtureHashes)) {
    if (record.fixtureHashes[name] !== expected) {
      throw new Error("Acceptance fixture identity is invalid");
    }
  }
  for (const name of requiredResults) {
    if (record.results[name] !== "pass") {
      throw new Error("Acceptance step is incomplete");
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) {
    process.stderr.write("Expected exactly one acceptance JSON file\n");
    process.exitCode = 1;
  } else {
    let record;
    try {
      record = JSON.parse(readFileSync(process.argv[2], "utf8"));
    } catch {
      process.stderr.write("Could not read acceptance JSON\n");
      process.exitCode = 1;
    }
    if (process.exitCode !== 1) {
      try {
        assertAcceptanceRecord(record);
        process.stdout.write("Acceptance record valid\n");
      } catch {
        process.stderr.write("Acceptance record failed validation\n");
        process.exitCode = 1;
      }
    }
  }
}
