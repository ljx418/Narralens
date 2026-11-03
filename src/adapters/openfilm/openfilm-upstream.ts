import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import lock from "../../../contracts/openfilm-upstream-lock.json" with { type: "json" };
import { HttpError } from "../../host/api-error.js";

const run = promisify(execFile);

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
  repository: lock.repository,
  full_sha: lock.full_sha,
  package: lock.package,
  license: lock.license,
  module_path: "packages/openfilm/studio/server/film.mjs",
  /** Every file whose bytes are about to be executed, pinned before any dynamic import. */
  loaded_module_sha256: lock.loaded_module_sha256,
  package_json_sha256: lock.package_json_sha256,
  lockfile_sha256: lock.lockfile_sha256,
  license_sha256: lock.license_sha256,
  package_file: lock.package_file,
  lockfile_file: lock.lockfile_file,
  license_file: lock.license_file,
  seam_exports: lock.seam_exports,
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
  readonly checked: readonly string[];
}

// A reusable verdict is a capability, not merely a structurally compatible object.  The
// WeakSet makes that property enforceable at runtime: only this module can mint a verdict
// after performing the real HEAD/clean-tree/digest checks.  A caller may pass that exact
// object once to avoid a second, racy `git status`, but cannot manufacture an `available:
// true` object and use it to load unverified bytes.
const reusableAvailabilityVerdicts = new WeakSet<OpenFilmAvailability>();

const sha256File = async (path: string): Promise<string> =>
  createHash("sha256").update(await readFile(path)).digest("hex");

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

/**
 * M-04: a pinned commit is a claim about a tree, not about the bytes that will run.
 *
 * A checkout can sit at the right HEAD with locally modified files, and a dynamic import
 * would then execute bytes that no commit ever contained. So availability requires three
 * independent facts: the HEAD is the pinned SHA, the checkout has no tracked modifications,
 * and every file this loader is about to execute hashes to its pinned digest.
 */
export async function openFilmAvailability(vendorRoot: string, gitStatusTimeoutMs = 30_000): Promise<OpenFilmAvailability> {
  const checked: string[] = [];
  let root: string;
  try { root = await realpath(vendorRoot); }
  catch {
    return { available: false, vendor_root: vendorRoot, observed_sha: null, expected_sha: OPENFILM_PIN.full_sha,
      reason: "pinned OpenFilm checkout is absent", checked };
  }
  const observed = await readCheckoutSha(root);
  if (observed === null) {
    return { available: false, vendor_root: root, observed_sha: null, expected_sha: OPENFILM_PIN.full_sha,
      reason: "pinned OpenFilm checkout has no readable git HEAD", checked };
  }
  checked.push("git_head");
  if (observed !== OPENFILM_PIN.full_sha) {
    return { available: false, vendor_root: root, observed_sha: observed, expected_sha: OPENFILM_PIN.full_sha,
      reason: "pinned OpenFilm checkout is not at the pinned full SHA", checked };
  }

  const dirty = await trackedModifications(root, gitStatusTimeoutMs);
  if (dirty === null) {
    return { available: false, vendor_root: root, observed_sha: observed, expected_sha: OPENFILM_PIN.full_sha,
      reason: "cannot verify that the pinned OpenFilm checkout is clean", checked };
  }
  checked.push("git_clean");
  if (dirty.length > 0) {
    return { available: false, vendor_root: root, observed_sha: observed, expected_sha: OPENFILM_PIN.full_sha,
      reason: `pinned OpenFilm checkout has local modifications: ${dirty.slice(0, 5).join(", ")}`, checked };
  }

  const verdict = await verifyPinnedFiles(root);
  checked.push(...verdict.checked);

  const availability: OpenFilmAvailability = {
    available: verdict.ok,
    vendor_root: root,
    observed_sha: observed,
    expected_sha: OPENFILM_PIN.full_sha,
    reason: verdict.reason,
    checked,
  };
  if (availability.available) reusableAvailabilityVerdicts.add(availability);
  return availability;
}

export interface PinnedFileVerdict {
  readonly ok: boolean;
  readonly reason: string;
  readonly checked: readonly string[];
  readonly missing: readonly string[];
  readonly mismatched: readonly string[];
}

/**
 * Hash every file this loader will execute or read, plus package, lock and licence.
 *
 * Split out from the git checks so the digest gate itself is directly testable: a synthetic
 * tree can never satisfy the real pins, which is exactly what proves the gate refuses.
 */
export async function verifyPinnedFiles(root: string): Promise<PinnedFileVerdict> {
  const digests: Array<[string, string]> = [
    [OPENFILM_PIN.package_file, OPENFILM_PIN.package_json_sha256],
    [OPENFILM_PIN.lockfile_file, OPENFILM_PIN.lockfile_sha256],
    [OPENFILM_PIN.license_file, OPENFILM_PIN.license_sha256],
    ...Object.entries(OPENFILM_PIN.loaded_module_sha256),
  ];
  const checked: string[] = [];
  const missing: string[] = [];
  const mismatched: string[] = [];
  // Every pinned file is checked, not just the first failure, so an operator sees the whole
  // picture of what a tampered checkout contains.
  for (const [relative, expected] of digests) {
    checked.push(relative);
    const actual = await sha256File(resolve(root, relative)).catch(() => null);
    if (actual === null) missing.push(relative);
    else if (actual !== expected) mismatched.push(relative);
  }
  if (missing.length > 0 || mismatched.length > 0) {
    const parts = [
      ...missing.map((relative) => `missing ${relative}`),
      ...mismatched.map((relative) => `digest mismatch ${relative}`),
    ];
    return { ok: false, reason: `pinned OpenFilm checkout is not intact: ${parts.join("; ")}`,
      checked, missing, mismatched };
  }
  return { ok: true, reason: "all pinned files match their digests", checked, missing, mismatched };
}

/**
 * Tracked modifications, or `null` when git cannot answer. Fixed argv, never a shell: the
 * caller supplies no command, no flags and no paths of its own.
 */
async function trackedModifications(root: string, timeout: number): Promise<string[] | null> {
  try {
    const { stdout } = await run("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"], { timeout });
    return stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  } catch { return null; }
}

/**
 * Load the pinned upstream seam. Throws `ENGINE_UNAVAILABLE` when the checkout is absent
 * or not at the pinned SHA; never falls back to another revision or to a bundled copy.
 */
export async function createPinnedOpenFilmUpstream(vendorRoot: string,
  verified?: OpenFilmAvailability): Promise<OpenFilmUpstream> {
  const availability = verified ?? await openFilmAvailability(vendorRoot);
  if (!availability.available) {
    throw new HttpError(503, "ENGINE_UNAVAILABLE", `OpenFilm upstream unavailable: ${availability.reason}`,
      { expected_sha: OPENFILM_PIN.full_sha, observed_sha: availability.observed_sha });
  }
  // Composition may pass the verdict it obtained immediately before this call. Re-running
  // `git status` here created a second, independent transient failure window: verification
  // could succeed, then the loader could fail to repeat the same check and leave a migrated
  // project bound to an uninstalled engine. The verdict must be the exact, single-use
  // capability minted by `openFilmAvailability`, for the exact canonical root and pin.
  // Structural lookalikes fail closed even when all of their public fields appear valid.
  let canonicalRoot: string;
  try { canonicalRoot = await realpath(vendorRoot); }
  catch { throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm upstream disappeared after verification"); }
  if (!reusableAvailabilityVerdicts.delete(availability)
    || canonicalRoot !== availability.vendor_root
    || availability.observed_sha !== OPENFILM_PIN.full_sha
    || availability.expected_sha !== OPENFILM_PIN.full_sha
    || !availability.checked.includes("git_clean")) {
    throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm upstream verification verdict is not reusable");
  }
  const moduleUrl = pathToFileURL(resolve(availability.vendor_root, OPENFILM_PIN.module_path)).href;
  let loaded: Record<string, unknown>;
  try { loaded = await import(/* @vite-ignore */ moduleUrl) as Record<string, unknown>; }
  catch { throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm upstream seam could not be loaded"); }
  for (const name of OPENFILM_PIN.seam_exports) {
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
