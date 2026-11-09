import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import { openFilmAvailability } from "../../adapters/openfilm/openfilm-upstream.js";
import pin from "./openfilm-render-pin.json" with { type: "json" };

/**
 * The render pin.
 *
 * A render executes bytes from a third-party checkout. The checkout being *at* the
 * pinned commit is not enough — a checkout can sit at the right commit with local
 * modifications, and a modified `render.mjs` would produce a different film under the
 * same digest. So the pin is checked in three independent ways before anything is
 * loaded:
 *
 * 1. MAIN's own upstream lock: the checkout is at the pinned commit, has no tracked
 *    modifications, and every file the lock names matches its digest.
 * 2. This module's extra digests: the four modules MAIN's lock does not cover
 *    (`render.mjs`, `timeline.mjs`, `seekable.mjs`, `overrides.mjs`) and the film
 *    document module.
 * 3. The worker's own digest: the file that does the loading is pinned too, so the
 *    thing that checks the pin cannot be swapped for one that does not.
 *
 * A checkout that fails any of these is refused. There is no fallback to another
 * revision, to a bundled copy, or to a plain ffmpeg concatenation: a delivery that was
 * produced by something other than the pinned renderer is not the delivery that was
 * asked for.
 */

const WORKER_URL = new URL("./openfilm-render-worker.mjs", import.meta.url);

/** The pinned facts, as they are recorded. */
export const RENDER_PIN = Object.freeze({
  upstream_repository: pin.upstream_repository,
  upstream_sha: pin.upstream_sha,
  render_module: pin.render_module,
  film_doc_module: pin.film_doc_module,
  worker_path: pin.worker_path,
  worker_sha256: pin.worker_sha256,
  loaded_module_sha256: Object.freeze({ ...pin.loaded_module_sha256 }),
});

/** The absolute path of the worker this module spawns. */
export function renderWorkerPath(): string {
  return fileURLToPath(WORKER_URL);
}

/** The result of checking the pin. */
export interface RenderPinVerdict {
  readonly ok: boolean;
  readonly reason: string;
  /** Every fact that was checked, whether it passed or not. */
  readonly checked: readonly string[];
  readonly missing: readonly string[];
  readonly mismatched: readonly string[];
  readonly upstream_root: string;
  readonly observed_sha: string | null;
  readonly expected_sha: string;
  readonly worker_sha256: string;
}

async function sha256File(path: string): Promise<string | null> {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Check the whole pin.
 *
 * The upstream's own availability check runs first and is reused rather than repeated:
 * it already proves the commit and the clean tree, and it proves the digests of the
 * studio modules MAIN's lock names.
 */
export async function verifyRenderPin(upstreamRoot: string): Promise<RenderPinVerdict> {
  const checked: string[] = [];
  const missing: string[] = [];
  const mismatched: string[] = [];

  const availability = await openFilmAvailability(upstreamRoot);
  checked.push(...availability.checked);
  if (!availability.available) {
    return {
      ok: false,
      reason: `the pinned OpenFilm checkout is not usable: ${availability.reason}`,
      checked,
      missing,
      mismatched,
      upstream_root: availability.vendor_root,
      observed_sha: availability.observed_sha,
      expected_sha: RENDER_PIN.upstream_sha,
      worker_sha256: RENDER_PIN.worker_sha256,
    };
  }
  if (availability.observed_sha !== RENDER_PIN.upstream_sha) {
    return {
      ok: false,
      reason: `the OpenFilm checkout is at ${String(availability.observed_sha)}, not at the pinned ${RENDER_PIN.upstream_sha}`,
      checked,
      missing,
      mismatched,
      upstream_root: availability.vendor_root,
      observed_sha: availability.observed_sha,
      expected_sha: RENDER_PIN.upstream_sha,
      worker_sha256: RENDER_PIN.worker_sha256,
    };
  }
  checked.push("upstream_sha");

  for (const [relative, expected] of Object.entries(RENDER_PIN.loaded_module_sha256)) {
    checked.push(relative);
    const path = resolve(availability.vendor_root, relative);
    // The pin's own keys are relative paths; a key that escaped the root would make the
    // digest check read something outside the checkout, so the containment is checked
    // before the file is opened.
    if (path !== availability.vendor_root && !path.startsWith(`${availability.vendor_root}${sep}`)) {
      mismatched.push(relative);
      continue;
    }
    const actual = await sha256File(path);
    if (actual === null) missing.push(relative);
    else if (actual !== expected) mismatched.push(relative);
  }

  const workerActual = await sha256File(renderWorkerPath());
  checked.push(RENDER_PIN.worker_path);
  if (workerActual === null) missing.push(RENDER_PIN.worker_path);
  else if (workerActual !== RENDER_PIN.worker_sha256) mismatched.push(RENDER_PIN.worker_path);

  if (missing.length > 0 || mismatched.length > 0) {
    const parts = [
      ...missing.map((relative) => `missing ${relative}`),
      ...mismatched.map((relative) => `digest mismatch ${relative}`),
    ];
    return {
      ok: false,
      reason: `the pinned render inputs are not intact: ${parts.join("; ")}`,
      checked,
      missing,
      mismatched,
      upstream_root: availability.vendor_root,
      observed_sha: availability.observed_sha,
      expected_sha: RENDER_PIN.upstream_sha,
      worker_sha256: RENDER_PIN.worker_sha256,
    };
  }

  return {
    ok: true,
    reason: "the pinned upstream, its render modules and the worker all match their digests",
    checked,
    missing,
    mismatched,
    upstream_root: availability.vendor_root,
    observed_sha: availability.observed_sha,
    expected_sha: RENDER_PIN.upstream_sha,
    worker_sha256: RENDER_PIN.worker_sha256,
  };
}
