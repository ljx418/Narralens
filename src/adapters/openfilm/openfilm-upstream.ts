import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HttpError } from "../../host/api-error.js";
import { OPENFILM_UPSTREAM_SHA } from "../../host/engine/engine-binding-store.js";

/**
 * The OpenFilm upstream seam.
 *
 * `readProjectFilm`, `editProjectFilm` and `revOf` are the only functions M2.1 uses, and
 * they are exactly the ones M1B already exercised against the pinned upstream
 * `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`. Nothing here forwards an arbitrary command,
 * path or URL to the upstream.
 *
 * The module is loaded with a guarded dynamic `import()` after the checkout's HEAD is
 * verified to equal the pinned full SHA, so a drifted or absent checkout fails closed
 * instead of silently binding a different engine. No production file statically imports
 * `vendor/` or `spikes/`.
 */

export const OPENFILM_PIN = Object.freeze({
  repository: "https://github.com/openfilm/openfilm.git",
  full_sha: OPENFILM_UPSTREAM_SHA,
  package: "openfilm@0.1.7",
  license: "MIT",
  module_path: "packages/openfilm/studio/server/film.mjs",
});

export interface OpenFilmFilmRead {
  readonly text: string;
  readonly rev: string;
  readonly value: unknown;
  readonly doc: unknown;
  readonly problems: string[];
}

export interface OpenFilmFilmEdit {
  readonly text: string;
  readonly rev: string;
  readonly value: unknown;
  readonly doc: unknown;
  readonly rebased: boolean;
}

export type OpenFilmPropValue = number | string | boolean | readonly number[] | Record<string, unknown> | null;

export type OpenFilmOp =
  | { op: "set"; clip: string; field: string; value?: unknown }
  | { op: "move"; clip: string; at: number; track?: number; newTrack?: number }
  | { op: "remove"; clip: string }
  | { op: "split"; clip: string; at: number; time: [number, number]; restTime: [number, number]; restId?: string }
  | { op: "split"; clip: string; left: Record<string, OpenFilmPropValue>; right: Record<string, OpenFilmPropValue>; rightId?: string }
  | { op: "props"; edits: ReadonlyArray<{ clip: string; prop: string; value: OpenFilmPropValue }> }
  | { op: "stage"; w: number; h: number }
  | { op: "fields"; clip: string; fields: Record<string, unknown> }
  | { op: "track"; track: number; field: "locked" | "hidden" | "muted"; value: boolean }
  | { op: "reorder"; from: number; to: number }
  | { op: "insert"; clip?: Partial<{ src: string; id: string; [field: string]: unknown }> & { src: string };
      from?: string; at?: number; after?: string; track?: number | { insert: number };
      newTrack?: number; link?: string | null };

export interface OpenFilmUpstream {
  revOf(text: string): string;
  readProjectFilm(root: string): Promise<OpenFilmFilmRead>;
  editProjectFilm(root: string, base: string | null, ops: readonly OpenFilmOp[]): Promise<OpenFilmFilmEdit>;
}

export interface OpenFilmAvailability {
  readonly available: boolean;
  readonly vendor_root: string;
  readonly observed_sha: string | null;
  readonly expected_sha: string;
  readonly reason: string;
}

const SHA_PATTERN = /^[a-f0-9]{40}$/u;

/** Read the checkout's HEAD without executing anything from it. */
async function readCheckoutSha(vendorRoot: string): Promise<string | null> {
  const { readFile } = await import("node:fs/promises");
  const head = resolve(vendorRoot, ".git/HEAD");
  try {
    const text = (await readFile(head, "utf8")).trim();
    const direct = /^([a-f0-9]{40})$/u.exec(text);
    if (direct) return direct[1]!;
    const ref = /^ref:\s*(.+)$/u.exec(text);
    if (!ref) return null;
    const refFile = resolve(vendorRoot, ".git", ref[1]!.trim());
    const sha = (await readFile(refFile, "utf8")).trim();
    return SHA_PATTERN.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

export async function openFilmAvailability(vendorRoot: string): Promise<OpenFilmAvailability> {
  let root: string;
  try { root = await realpath(vendorRoot); }
  catch {
    return { available: false, vendor_root: vendorRoot, observed_sha: null, expected_sha: OPENFILM_PIN.full_sha,
      reason: "pinned OpenFilm checkout is absent" };
  }
  const observed = await readCheckoutSha(root);
  if (observed === null) {
    return { available: false, vendor_root: root, observed_sha: null, expected_sha: OPENFILM_PIN.full_sha,
      reason: "pinned OpenFilm checkout has no readable git HEAD" };
  }
  if (observed !== OPENFILM_PIN.full_sha) {
    return { available: false, vendor_root: root, observed_sha: observed, expected_sha: OPENFILM_PIN.full_sha,
      reason: "pinned OpenFilm checkout is not at the pinned full SHA" };
  }
  return { available: true, vendor_root: root, observed_sha: observed, expected_sha: OPENFILM_PIN.full_sha, reason: "ok" };
}

/**
 * Load the pinned upstream seam. Throws `ENGINE_UNAVAILABLE` when the checkout is absent
 * or not at the pinned SHA; never falls back to another revision or to a bundled copy.
 */
export async function createPinnedOpenFilmUpstream(vendorRoot: string): Promise<OpenFilmUpstream> {
  const availability = await openFilmAvailability(vendorRoot);
  if (!availability.available) {
    throw new HttpError(503, "ENGINE_UNAVAILABLE", `OpenFilm upstream unavailable: ${availability.reason}`,
      { expected_sha: OPENFILM_PIN.full_sha, observed_sha: availability.observed_sha });
  }
  const moduleUrl = pathToFileURL(resolve(availability.vendor_root, OPENFILM_PIN.module_path)).href;
  let loaded: Record<string, unknown>;
  try { loaded = await import(/* @vite-ignore */ moduleUrl) as Record<string, unknown>; }
  catch { throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm upstream seam could not be loaded"); }
  for (const name of ["revOf", "readProjectFilm", "editProjectFilm"]) {
    if (typeof loaded[name] !== "function") {
      throw new HttpError(503, "ENGINE_UNAVAILABLE", `OpenFilm upstream seam is missing export ${name}`);
    }
  }
  return {
    revOf: (text: string) => String((loaded.revOf as (value: string) => string)(text)),
    readProjectFilm: async (root: string) => await (loaded.readProjectFilm as (value: string) => Promise<OpenFilmFilmRead>)(root),
    editProjectFilm: async (root: string, base: string | null, ops: readonly OpenFilmOp[]) =>
      await (loaded.editProjectFilm as (value: string, base: string | null, ops: readonly OpenFilmOp[]) => Promise<OpenFilmFilmEdit>)(root, base, ops),
  };
}

/**
 * The revision the upstream derives from a film.html text: the first 16 hex of its SHA-256.
 * Reimplemented here (one line, documented) so a strict base check does not require loading
 * the upstream at all.
 */
export function upstreamRevOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
