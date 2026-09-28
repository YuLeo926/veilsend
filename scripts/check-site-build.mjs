import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// Check the deployment artifact, not just source paths. Vite does not rewrite
// ordinary anchor hrefs the same way it rewrites image src attributes.
const root = fileURLToPath(new URL("../site-dist/", import.meta.url));
for (const page of ["index.html", "guide.html"]) {
  const dom = new JSDOM(readFileSync(resolve(root, page), "utf8"));
  try {
    for (const el of dom.window.document.querySelectorAll(
      "a[href], link[href], script[src], img[src]",
    )) {
      const value = el.getAttribute("href") ?? el.getAttribute("src");
      if (value.startsWith("https://")) continue;
      assert.ok(
        !value.startsWith("/") && !value.includes(":"),
        `subdirectory-unsafe URL: ${value}`,
      );
      const [path, fragment] = value.split("#");
      const target = path
        ? resolve(dirname(resolve(root, page)), path)
        : resolve(root, page);
      assert.ok(
        target.startsWith(resolve(root) + sep),
        `outside site: ${value}`,
      );
      assert.ok(existsSync(target), `${page}: missing built resource ${value}`);
      if (fragment) {
        const other = new JSDOM(readFileSync(target, "utf8"));
        try {
          assert.ok(
            other.window.document.getElementById(fragment),
            `missing fragment: ${value}`,
          );
        } finally {
          other.window.close();
        }
      }
    }
  } finally {
    dom.window.close();
  }
}
console.log(
  "Built site links, assets and fragments resolve under a repository subdirectory.",
);
