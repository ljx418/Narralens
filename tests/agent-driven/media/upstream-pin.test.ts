import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { renderWorkerPath, RENDER_PIN, verifyRenderPin } from "../../../src/host/render/upstream-pin.js";
import { removeDirectory, temporaryDirectory } from "./support.js";

/**
 * The render pin.
 *
 * Module checks for the supply chain the render depends on: the worker on disk is the
 * worker the pin names, the pin covers every module of the render's import graph, and
 * anything that is not the pinned checkout is refused.
 *
 * The real upstream verification against the pinned checkout is environment dependent
 * and is reported as such: it is skipped when the checkout is not on this machine and
 * it is the real T20 acceptance that proves the render itself, which is `NOT_RUN`.
 */

const REAL_UPSTREAM = "/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) await removeDirectory(dirs.pop()!);
});

async function directory(label: string): Promise<string> {
  const path = await temporaryDirectory(label);
  dirs.push(path);
  return path;
}

describe("the render pin", () => {
  it("names the worker that is on disk", async () => {
    const bytes = await readFile(renderWorkerPath());
    const actual = createHash("sha256").update(bytes).digest("hex");
    expect(actual).toBe(RENDER_PIN.worker_sha256);
  });

  it("covers every module of the render's import graph", () => {
    for (const module of [
      "packages/openfilm/src/render.mjs",
      "packages/openfilm/src/host.mjs",
      "packages/openfilm/src/shared.mjs",
      "packages/openfilm/src/film-doc.mjs",
      "packages/openfilm/src/timeline.mjs",
      "packages/openfilm/src/seekable.mjs",
      "packages/openfilm/src/overrides.mjs",
      "packages/openfilm/src/media-links.mjs",
    ]) {
      expect(RENDER_PIN.loaded_module_sha256[module]).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it("refuses a checkout that is not there", async () => {
    const root = await directory("pin-absent");
    const verdict = await verifyRenderPin(root);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("not usable");
  });

  it("refuses a tree that is not the pinned checkout", async () => {
    const root = await directory("pin-synthetic");
    const verdict = await verifyRenderPin(root);
    expect(verdict.ok).toBe(false);
    expect(verdict.expected_sha).toBe(RENDER_PIN.upstream_sha);
  });

  it.skipIf(!existsSync(REAL_UPSTREAM))("verifies the pinned checkout when it is on this machine", async () => {
    const verdict = await verifyRenderPin(REAL_UPSTREAM);
    expect(verdict.ok).toBe(true);
    expect(verdict.observed_sha).toBe(RENDER_PIN.upstream_sha);
    expect(verdict.missing).toHaveLength(0);
    expect(verdict.mismatched).toHaveLength(0);
  });
});
