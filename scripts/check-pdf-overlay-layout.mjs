// Real browser layout regression; no browser profile or additional dependencies needed.
// Run: node scripts/check-pdf-overlay-layout.mjs [absolute-path-to-Edge-or-Chromium]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const browser = process.argv[2] ?? process.env.PDF_LAYOUT_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
assert.ok(browser && existsSync(browser), "Pass an installed Edge/Chromium executable; no browser is downloaded.");
const root = fileURLToPath(new URL("../", import.meta.url));
const css = readFileSync(join(root, "src/styles.css"), "utf8");
const sizes = [
  ["50%", 500], ["100%", 1000], ["200%", 2000],
  ["fit-width", 600], ["fit-page-height", 400], ["fit-page-width", 200],
];
const variants = ["pdf-manual-region", "pdf-manual-region draft",
  ...["text", "face", "qr", "barcode"].flatMap(kind =>
    ["selected", "excluded"].map(state => `redaction-region ${kind}-region ${state}`)),
];
// Match PdfWorkflow's wrapper/draw-layer/region hierarchy. Only the inline page
// dimensions and percentage rectangle are fixture data; all layout CSS is real.
const cases = sizes.map(([mode, width]) => `<div class="pdf-page-wrap zoom-${mode.startsWith("fit-page") ? "fit-page" : mode === "fit-width" ? "fit-width" : "percent"}" data-mode="${mode}" style="width:${width}px;aspect-ratio:1000 / 1500"><img alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"><div class="pdf-draw-layer">${variants.map(className => `<span class="${className}" style="left:10%;top:20%;width:.5%;height:.5%">${className.endsWith("draft") ? "" : "<b>1</b>"}${className === "pdf-manual-region" ? '<button class="pdf-resize-handle" type="button" aria-label="Resize manual cover 1"></button>' : ""}</span>`).join("")}</div></div>`).join("");
const image = '<div class="image-overlay-wrap" style="width:500px;height:750px"><div class="redaction-overlay"><span class="redaction-region qr-region selected" style="left:10%;top:20%;width:.5%;height:.5%"><b>1</b></span></div></div>';
const script = `
const records = [...document.querySelectorAll('.pdf-page-wrap')].flatMap(wrap => {
  const page = wrap.getBoundingClientRect();
  return [...wrap.querySelector('.pdf-draw-layer').children].map(region => {
    const box = region.getBoundingClientRect(), style = getComputedStyle(region);
    const stroke = getComputedStyle(region, '::after');
    const handle = region.querySelector('button');
    return { mode: wrap.dataset.mode, variant: region.className, pageWidth: page.width, pageHeight: page.height,
      width: box.width, height: box.height, x: box.x - page.x, y: box.y - page.y,
      borderWidth: style.borderTopWidth, minWidth: style.minWidth, minHeight: style.minHeight,
      stroke: { content: stroke.content, width: stroke.borderTopWidth, style: stroke.borderTopStyle, color: stroke.borderTopColor, pointerEvents: stroke.pointerEvents,
        background: stroke.backgroundColor, left: stroke.left, top: stroke.top, boxWidth: stroke.width, boxHeight: stroke.height },
      handle: handle ? { width: handle.getBoundingClientRect().width, height: handle.getBoundingClientRect().height,
        pointerEvents: getComputedStyle(handle).pointerEvents,
        label: handle.getAttribute('aria-label') } : null };
  });
});
const image = document.querySelector('.image-overlay-wrap .redaction-region');
const imageStyle = getComputedStyle(image);
// dump-dom does not activate keyboard focus. Inspect the real focus-visible rule
// without pretending programmatic focus proves a native keyboard interaction.
const focusRule = [...document.styleSheets[0].cssRules].find(rule => rule.selectorText?.split(',').map(selector => selector.trim()).includes('button:focus-visible'));
document.getElementById('result').textContent = JSON.stringify({records, focusOutline: focusRule?.style.outlineStyle, focusWidth: focusRule?.style.outlineWidth, image: {width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height, border: imageStyle.borderTopWidth, style: imageStyle.borderTopStyle}});
`;
const temp = mkdtempSync(join(tmpdir(), "veilsend-pdf-layout-"));
try {
  const fixture = join(temp, "fixture.html");
  writeFileSync(fixture, `<!doctype html><meta charset="utf-8"><style>${css}</style>${cases}${image}<pre id="result"></pre><script>${script}</script>`);
  const run = spawnSync(browser, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-background-networking", `--user-data-dir=${join(temp, "profile")}`,
    "--dump-dom", pathToFileURL(fixture).href], { encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  assert.ifError(run.error);
  assert.equal(run.status, 0, run.stderr);
  const payload = run.stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
  assert.ok(payload, "Browser did not return measurements");
  const result = JSON.parse(payload.replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  for (const [mode] of sizes) {
    const rows = result.records.filter(row => row.mode === mode);
    console.log(`${mode}: ${rows.map(row => `${row.variant}=${row.width}x${row.height}`).join("; ")}`);
  }
  assert.equal(result.records.length, sizes.length * variants.length);
  for (const row of result.records) {
    const context = `${row.mode} ${row.variant}`;
    // Chromium layout quantizes to 1/64 CSS px; never allow the 4/6px border floor.
    for (const [field, expected] of Object.entries({ width: row.pageWidth * .005, height: row.pageHeight * .005, x: row.pageWidth * .1, y: row.pageHeight * .2 })) {
      assert.ok(Math.abs(row[field] - expected) <= 1 / 64, `${context}: ${field} ${row[field]} != ${expected}`);
    }
    assert.equal(row.borderWidth, "0px", `${context}: geometry must have no border floor`);
    assert.equal(row.minWidth, "0px", context);
    assert.equal(row.minHeight, "0px", context);
    assert.equal(row.stroke.content, '\"\"', `${context}: missing decorative stroke`);
    assert.equal(row.stroke.width, row.variant.includes("qr-region") ? "3px" : "2px", context);
    assert.equal(row.stroke.style, /draft|excluded|face-region/.test(row.variant) ? "dashed" : row.variant.includes("qr-region") ? "double" : "solid", context);
    assert.equal(row.stroke.pointerEvents, "none", context);
    assert.equal(row.stroke.background, "rgba(0, 0, 0, 0)", `${context}: decoration must not enlarge the cover fill`);
    const strokeWidth = Number.parseFloat(row.stroke.width);
    assert.equal(Number.parseFloat(row.stroke.left), -strokeWidth, context);
    assert.equal(Number.parseFloat(row.stroke.top), -strokeWidth, context);
    assert.ok(Math.abs(Number.parseFloat(row.stroke.boxWidth) - (row.width + strokeWidth * 2)) <= 1 / 64, context);
    assert.ok(Math.abs(Number.parseFloat(row.stroke.boxHeight) - (row.height + strokeWidth * 2)) <= 1 / 64, context);
    if (row.variant.includes("excluded")) assert.equal(row.stroke.color, "rgb(119, 114, 105)", context);
    if (row.handle) {
      assert.deepEqual(row.handle, { width: 14, height: 14, pointerEvents: "auto", label: "Resize manual cover 1" }, context);
    }
  }
  assert.deepEqual(result.image, { width: 6, height: 6, border: "3px", style: "double" }, "Image overlay styling must remain unchanged");
  assert.equal(result.focusOutline, "solid", "Existing keyboard-focus rule must remain visible");
  assert.equal(result.focusWidth, "3px");
  console.log(`PASS: ${result.records.length} PDF rendered rectangles; strokes, resize handles, focus CSS and unchanged image overlay.`);
} finally {
  // Delete only this run's generated fixture/profile directory, never a user profile.
  assert.equal(resolve(temp, ".."), resolve(tmpdir()));
  assert.ok(temp.startsWith(join(tmpdir(), "veilsend-pdf-layout-")));
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
