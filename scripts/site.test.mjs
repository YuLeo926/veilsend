import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";
import { initDemo, steps } from "../site/demo.js";

const root = fileURLToPath(new URL("../site/", import.meta.url));
const pages = ["index.html", "guide.html"];
const read = (name) => readFileSync(resolve(root, name), "utf8");
const domFor = (name) => new JSDOM(read(name));

test("Pages publishes only the built site from master with scoped permissions", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/pages.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /branches: \[master\]/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/master'/);
  assert.match(workflow, /path: site-dist/);
  assert.match(workflow, /needs: build/);
  assert.match(workflow, /npm run test:site/);
  assert.match(workflow, /npm run build:site/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /permissions:\s+pages: write\s+id-token: write/);
  assert.doesNotMatch(
    workflow,
    /contents: write|pull_request_target|secrets\./,
  );
  const actions = [...workflow.matchAll(/uses: (\S+)/g)];
  assert.equal(actions.length, 5);
  for (const [, action] of actions)
    assert.match(action, /^actions\/[\w-]+@[a-f0-9]{40}$/);
});

for (const page of pages) {
  test(`${page}: local links and fragments resolve, external links are explicit project links`, () => {
    const dom = domFor(page);
    try {
      const doc = dom.window.document;
      assert.equal(doc.documentElement.lang, "en");
      assert.equal(doc.querySelectorAll("h1").length, 1);
      assert.ok(
        doc.querySelector('meta[name="description"]').content.length > 50,
      );
      const ids = [...doc.querySelectorAll("[id]")].map((el) => el.id);
      assert.equal(new Set(ids).size, ids.length, "no duplicate IDs");
      for (const el of doc.querySelectorAll(
        "a[href], link[href], script[src], img[src]",
      )) {
        const href = el.getAttribute("href") ?? el.getAttribute("src");
        if (href.startsWith("https://")) {
          const url = new URL(href);
          assert.equal(el.tagName, "A", "no automatic third-party resources");
          assert.equal(url.hostname, "github.com");
          assert.ok(url.pathname.startsWith("/YuLeo926/veilsend"));
          continue;
        }
        assert.ok(
          !href.startsWith("//") && !href.includes(":"),
          `unsafe link ${href}`,
        );
        const [path, fragment] = href.split("#");
        let target = path
          ? resolve(dirname(resolve(root, page)), path)
          : resolve(root, page);
        if (path && (!existsSync(target) || path.startsWith("/"))) {
          target = resolve(root, "public", path.replace(/^\.?\//, ""));
        }
        assert.ok(existsSync(target), `${page}: missing ${href}`);
        if (fragment) {
          const other = new JSDOM(readFileSync(target, "utf8"));
          try {
            assert.ok(
              other.window.document.getElementById(fragment),
              `missing fragment ${href}`,
            );
          } finally {
            other.window.close();
          }
        }
      }
    } finally {
      dom.window.close();
    }
  });

  test(`${page}: no data collection or hidden uploads`, () => {
    const dom = domFor(page);
    try {
      const doc = dom.window.document;
      assert.equal(
        doc.querySelectorAll("form, input, textarea, iframe, video, audio")
          .length,
        0,
      );
      assert.equal(doc.querySelectorAll("script:not([src])").length, 0);
      assert.equal(
        doc.querySelector('meta[name="referrer"]').content,
        "no-referrer",
      );
      assert.match(doc.body.textContent, /public/i);
      assert.match(doc.body.textContent, /synthetic|fake/i);
      assert.match(doc.body.textContent, /unsigned/i);
      assert.match(doc.body.textContent, /experimental/i);
      assert.match(doc.body.textContent, /unverified/i);
    } finally {
      dom.window.close();
    }
  });
}

test("example controls switch fixed steps without pretending to scan or save", () => {
  const dom = domFor("index.html");
  try {
    const doc = dom.window.document;
    assert.equal(
      doc.querySelector(".demo-controls").hidden,
      true,
      "no dead buttons without JS",
    );
    initDemo(doc);
    const buttons = [...doc.querySelectorAll("button[data-step]")];
    assert.equal(buttons.length, 3);
    assert.equal(doc.querySelector(".demo-controls").hidden, false);
    for (const index of [1, 2, 0, 2]) {
      buttons[index].click();
      for (const key of ["kicker", "title", "example", "description"]) {
        assert.equal(
          doc.getElementById(`demo-${key}`).textContent,
          steps[index][key],
        );
      }
      assert.equal(
        buttons.filter((el) => el.getAttribute("aria-pressed") === "true")
          .length,
        1,
      );
      assert.equal(buttons[index].getAttribute("aria-pressed"), "true");
    }
    assert.match(
      doc.getElementById("demo-description").textContent,
      /has not scanned or saved/,
    );
    assert.equal(
      doc.getElementById("demo-content").getAttribute("aria-live"),
      "polite",
    );
    const empty = new JSDOM("<main></main>");
    try {
      initDemo(empty.window.document);
    } finally {
      empty.window.close();
    }
  } finally {
    dom.window.close();
  }
});

test("site scripts and styles contain no network, tracking, storage or remote font hooks", () => {
  assert.doesNotMatch(
    read("demo.js"),
    /fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|document\.cookie|\.innerHTML\s*=/,
  );
  assert.doesNotMatch(read("style.css"), /@import|url\s*\(/);
  assert.match(read("style.css"), /prefers-reduced-motion/);
  assert.match(read("style.css"), /focus-visible/);
});

test("public claims preserve beta, PDF and pricing boundaries", () => {
  const home = domFor("index.html");
  const guide = domFor("guide.html");
  try {
    const copy = home.window.document.body.textContent.replace(/\s+/g, " ");
    assert.match(copy, /image-only PDF/);
    assert.match(copy, /no paid plan or checkout/i);
    assert.match(copy, /not a safety guarantee/i);
    assert.match(copy, /Disconnected operation has not yet been verified/);
    assert.match(copy, /No Office files, batch processing/);
    const instructions = guide.window.document.body.textContent.replace(
      /\s+/g,
      " ",
    );
    assert.match(instructions, /uninstall preservation.*unverified/i);
    assert.match(instructions, /not a universal install path/);
    assert.match(instructions, /Do not disable Windows security/);
    assert.match(instructions, /appwiz\.cpl/);
    assert.match(instructions, /Save clean copy/);
    assert.match(instructions, /outside the app's installation directory/);
  } finally {
    home.window.close();
    guide.window.close();
  }
});

test("trial form asks about observed behavior and warns about public disclosure", () => {
  const form = readFileSync(
    new URL("../.github/ISSUE_TEMPLATE/trial-feedback.yml", import.meta.url),
    "utf8",
  );
  for (const field of [
    "version",
    "workflow",
    "frequency",
    "previous-method",
    "outcome",
    "experience",
    "next-use",
    "privacy-confirmation",
  ]) {
    assert.ok(form.includes(`id: ${field}`), field);
  }
  assert.match(form, /PUBLIC GitHub issue/);
  assert.match(form, /not an order or purchase commitment/);
  assert.match(form, /No paid plan exists/);
  assert.match(form, /security\/advisories\/new/);
});

test("real desktop gallery uses local captured JPEGs with honest workflow captions", () => {
  const dom = domFor("index.html");
  try {
    const gallery = dom.window.document.getElementById("desktop-preview");
    const shots = [...gallery.querySelectorAll("img")];
    assert.equal(shots.length, 3);
    for (const shot of shots) {
      assert.ok(shot.alt.length > 30);
      assert.equal(shot.getAttribute("width"), "1707");
      assert.equal(shot.getAttribute("height"), "1019");
      assert.equal(shot.getAttribute("loading"), "lazy");
      const bytes = readFileSync(
        resolve(root, "public", shot.getAttribute("src").replace(/^\//, "")),
      );
      assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
      assert.ok(
        bytes.length < 150_000,
        "keep the original capture reasonably small",
      );
    }
    const copy = gallery.textContent.replace(/\s+/g, " ");
    assert.match(copy, /screenshots, not a video/);
    assert.match(copy, /cleaned preview, before saving/);
    assert.match(copy, /development computer/);
    assert.match(copy, /not a guarantee/);
  } finally {
    dom.window.close();
  }
});
