import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./site", import.meta.url)),
  base: "./",
  server: { host: "127.0.0.1", port: 1421, strictPort: true },
  build: {
    outDir: "../site-dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: fileURLToPath(new URL("./site/index.html", import.meta.url)),
        guide: fileURLToPath(new URL("./site/guide.html", import.meta.url)),
      },
    },
  },
});
