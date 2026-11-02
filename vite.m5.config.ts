import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The M5 panel's own build (Wave 3 `01` §2, `04` §1).
 *
 * The panel is a separate bundle from the legacy front end because it lives in a
 * different document: the pinned OpenFilm Studio's own page, served by the Gateway, with
 * the panel injected into it. The output names are fixed, so the Host can serve the panel
 * at a known path without reading a manifest a stale build could have left behind.
 *
 * No new dependency: the panel is built with the React and the plugin the repository
 * already pins.
 */
export default defineConfig({
  plugins: [react()],
  // A library build does not define `process.env.NODE_ENV`, and React's bundle reads it
  // at module scope — so without this the panel throws `process is not defined` before it
  // ever mounts, and the page silently loses the panel.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist/m5",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: "src/app/m5/panel.tsx",
      formats: ["es"],
      fileName: () => "narralens-panel.js",
      name: "NarralensPanel",
    },
    rollupOptions: {
      output: { assetFileNames: "narralens-panel[extname]" },
    },
  },
});
