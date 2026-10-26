import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * The built M5 panel.
 *
 * The panel is a separate bundle from the legacy front end, because it lives in a
 * different document: the Studio's own page, served by the Gateway, with the panel
 * injected into it. The file names are fixed (`vite.m5.config.ts` pins them), so the Host
 * can find them without reading a manifest that a stale build could leave behind.
 *
 * A missing bundle is not an error here: the Gateway says so in the page, and the
 * Headless E2E records the panel as missing rather than pretending it was there.
 */
export interface PanelAssets {
  readonly script: string;
  readonly styles: string;
}

export async function readPanelAssets(root: string): Promise<PanelAssets | undefined> {
  const script = await readFile(resolve(root, "dist/m5/narralens-panel.js"), "utf8").catch(() => undefined);
  if (script === undefined) return undefined;
  const styles = await readFile(resolve(root, "dist/m5/narralens-panel.css"), "utf8").catch(() => "");
  return { script, styles };
}
