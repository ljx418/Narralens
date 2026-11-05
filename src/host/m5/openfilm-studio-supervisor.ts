import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readFile, readdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HttpError } from "../api-error.js";
import { OPENFILM_PIN, openFilmAvailability } from "../../adapters/openfilm/openfilm-upstream.js";

/**
 * `OpenFilmStudioSupervisor` (Wave 3 `04` §1).
 *
 * The Studio is a *real* upstream program with a *real* seam, and M5's first obligation is
 * to prove that seam exists before building anything on it. So the Supervisor probes
 * first, and the probe is a real one:
 *
 * - the checkout must be at the pinned full SHA, clean, and every pinned file intact
 *   (the same gate M2.1 already uses for the film seam);
 * - `startStudio` must be a real export of the Studio's server module, and its options
 *   must include the ones M5 depends on;
 * - the `StudioHost` v1 interface must declare `onSelection` and `onCommand`, and the
 *   panel marker the Studio's own layout looks for.
 *
 * A missing or mismatched seam is `503 ENGINE_UNAVAILABLE`, and the legal terminal state
 * of the whole stage is `M5_BLOCKED_ENV`. There is no fallback to a system `latest`, no
 * fallback to a CLI, and no second Studio built from the same sources.
 *
 * The probe never modifies the pinned upstream and never searches for another checkout.
 */
export const STUDIO_SERVER_MODULE = "packages/openfilm/studio/server/server.mjs";
export const STUDIO_HOST_MODULE = "packages/openfilm/studio/ui/src/lib/host.ts";
export const STUDIO_EDITOR_DIR = "packages/openfilm/studio/ui/dist";

/** The options M5 relies on. A Studio that does not accept them is not this seam. */
export const REQUIRED_STUDIO_OPTIONS = [
  "port", "key", "openBrowser", "advertise", "onQuit", "stays", "editorDir", "working",
] as const;

/** The `StudioHost` v1 members M5 implements and reads. */
export const REQUIRED_STUDIO_HOST_MEMBERS = [
  "version", "onSelection", "onCommand", "panel",
] as const;

export interface StudioSeamProbe {
  readonly kind: "narralens.studio_seam_probe@1.0";
  readonly probed_at: string;
  readonly upstream: {
    readonly repository: string;
    readonly full_sha: string;
    readonly package: string;
    readonly license: string;
  };
  readonly checkout: {
    readonly head_sha: string | null;
    readonly clean: boolean;
    readonly checked: readonly string[];
  };
  readonly seams: {
    readonly start_studio: {
      readonly module: string;
      readonly sha256: string | null;
      readonly export_present: boolean;
      readonly option_names: readonly string[];
      readonly missing_options: readonly string[];
      readonly ok: boolean;
    };
    readonly studio_host: {
      readonly module: string;
      readonly sha256: string | null;
      readonly declares_version_1: boolean;
      readonly members: readonly string[];
      readonly missing_members: readonly string[];
      readonly ok: boolean;
    };
  };
  /** Every file the Studio server actually loads, by relative path, with its digest. */
  readonly loaded_closure: Readonly<Record<string, string>>;
  readonly studio_build: {
    readonly editor_dir: string;
    readonly files: Readonly<Record<string, string>>;
  };
  readonly ok: boolean;
  readonly reason: string;
}

export interface OpenFilmStudioSupervisorDeps {
  /** The pinned checkout. Never searched for; never another revision. */
  readonly vendorRoot: string;
  /** The migrated target's directory, so the Studio can open it. */
  readonly targetRootOf: (projectId: string) => Promise<string>;
  /** Called with the started Studio, so the Gateway can be built around it. */
  readonly onStudio: (studio: StartedStudio) => Promise<void> | void;
  /** Where the probe record is written. */
  readonly probePath?: string | undefined;
}

export interface StartedStudio {
  readonly origin: string;
  /** The read-only project pages server selected by the pinned Studio itself. */
  readonly filmOrigin: string;
  readonly port: number;
  readonly key: string;
  readonly close: () => Promise<void>;
}

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

/**
 * The Studio server module's static import closure.
 *
 * The point is that "the pinned upstream" is not one file: the Studio server pulls in
 * dozens of modules, and a checkout that is at the right HEAD with a modified module would
 * execute bytes no commit contained. So the closure is walked and every file's digest is
 * recorded, exactly as M2.1 does for the film seam.
 */
export async function collectModuleClosure(root: string, entry: string,
  seen: Map<string, string> = new Map()): Promise<Map<string, string>> {
  const absolute = resolve(root, entry);
  let source: string;
  try { source = await readFile(absolute, "utf8"); }
  catch { return seen; }
  seen.set(entry, sha256(source));
  const pattern = /(?:from|import)\s*['"](\.[^'"]+)['"]/gu;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1]!;
    const resolved = resolve(absolute, "..", specifier);
    const relative = resolve(resolved).slice(resolve(root).length + 1).replaceAll("\\", "/");
    if (seen.has(relative)) continue;
    await collectModuleClosure(root, relative, seen);
  }
  return seen;
}

/** The digest of every file in a directory, by relative path. */
export async function digestDirectory(root: string, prefix: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (absolute: string, relative: string): Promise<void> => {
    let entries: Dirent[];
    try { entries = await readdir(absolute, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const child = resolve(absolute, entry.name);
      const childRelative = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) { await walk(child, childRelative); continue; }
      try { out[childRelative] = sha256(await readFile(child)); } catch { /* unreadable: not part of the build */ }
    }
  };
  await walk(resolve(root, prefix), prefix);
  return out;
}

export class OpenFilmStudioSupervisor {
  readonly #deps: OpenFilmStudioSupervisorDeps;
  #probe: Promise<StudioSeamProbe> | undefined;
  #studio: Promise<StartedStudio> | undefined;

  constructor(deps: OpenFilmStudioSupervisorDeps) {
    this.#deps = deps;
  }

  /** The probe, run once. The result is memoised because it is a property of the checkout. */
  async probe(): Promise<StudioSeamProbe> {
    this.#probe ??= this.#runProbe();
    return await this.#probe;
  }

  /**
   * Probe again, discarding the memoised answer.
   *
   * The memo is right for a checkout that does not change, and wrong for a *failed*
   * check: a verification that could not complete (a saturated machine, a killed
   * subprocess) says nothing about the checkout, and the only way to learn is to ask
   * again.
   */
  async refresh(): Promise<StudioSeamProbe> {
    this.#probe = undefined;
    return await this.probe();
  }

  /**
   * Make sure the Studio is running and the target is open in it.
   *
   * The returned descriptor is what the workbench projection publishes as its `preview`:
   * the Gateway's own address, never the upstream's and never a filesystem path.
   */
  async ensure(projectId: string, correlationId: string): Promise<{
    kind: "openfilm-studio"; url: string; bridge_version: 1;
  }> {
    const probe = await this.probe();
    if (!probe.ok) {
      throw new HttpError(503, "ENGINE_UNAVAILABLE",
        `OpenFilm Studio is unavailable: ${probe.reason}`,
        { stage: "M5_BLOCKED_ENV" }, correlationId);
    }
    const studio = await this.#start();
    const root = await this.#deps.targetRootOf(projectId);
    const opened = await this.#openInStudio(studio, root, projectId, correlationId);
    return { kind: "openfilm-studio", url: opened, bridge_version: 1 };
  }

  /**
   * Stop the Studio.
   *
   * The Studio is a server of its own, and a Host that closes without stopping it leaves
   * an editor listening on loopback with a launch key nobody is holding. The Host calls
   * this when it closes, and a second call is a no-op.
   */
  async close(): Promise<void> {
    const started = this.#studio;
    this.#studio = undefined;
    if (started === undefined) return;
    const studio = await started.catch(() => undefined);
    await studio?.close();
  }

  async #start(): Promise<StartedStudio> {    this.#studio ??= (async () => {
      const moduleUrl = pathToFileURL(resolve(this.#deps.vendorRoot, STUDIO_SERVER_MODULE)).href;
      let loaded: Record<string, unknown>;
      try { loaded = await import(/* @vite-ignore */ moduleUrl) as Record<string, unknown>; }
      catch { throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm Studio could not be loaded"); }
      const startStudio = loaded.startStudio as ((options: Record<string, unknown>) => Promise<StartedStudio>) | undefined;
      if (typeof startStudio !== "function") {
        throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm Studio does not export startStudio");
      }
      const studio = await startStudio({
        port: 0,
        // The Studio must never open a browser: M5's automation is headless, and a window
        // that steals focus breaks every other rule in the same paragraph.
        openBrowser: () => undefined,
        advertise: false,
        onQuit: () => undefined,
        stays: true,
        editorDir: resolve(this.#deps.vendorRoot, STUDIO_EDITOR_DIR),
        working: () => [],
      });
      await this.#deps.onStudio(studio);
      return studio;
    })();
    return await this.#studio;
  }

  /**
   * Open the migrated target in the Studio and return the Gateway's address for it.
   *
   * The path never leaves the server: it goes straight from the resolver to the Studio's
   * own API, over loopback, with the launch key the Gateway holds. Nothing about the
   * target's location reaches the browser.
   */
  async #openInStudio(studio: StartedStudio, root: string, projectId: string,
    correlationId: string): Promise<string> {
    const response = await fetch(`${studio.origin}/api/projects`, {
      method: "POST",
      headers: { "x-studio-key": studio.key, "content-type": "application/json" },
      body: JSON.stringify({ path: root, create: false }),
    });
    if (!response.ok) {
      throw new HttpError(503, "ENGINE_UNAVAILABLE",
        "OpenFilm Studio could not open the migrated target", { status: response.status }, correlationId);
    }
    const body = await response.json() as { project?: { id?: unknown } };
    const id = body.project?.id;
    if (typeof id !== "string" || id === "") {
      throw new HttpError(503, "ENGINE_UNAVAILABLE",
        "OpenFilm Studio did not name the opened project", undefined, correlationId);
    }
    // The target's Narralens id travels in the query, so the panel knows which project
    // to read. It is the *target* id — the page never guesses it.
    return this.#gatewayUrlFor(id, projectId);
  }

  /** Overridden by the Gateway when it is composed; the Supervisor never builds a URL itself. */
  #gatewayUrlFor(studioProjectId: string, targetProjectId: string): string {
    const path = `/projects/${studioProjectId}?target=${encodeURIComponent(targetProjectId)}`;
    return this.#gatewayBase === undefined ? path : `${this.#gatewayBase}${path}`;
  }

  #gatewayBase: string | undefined;

  /** The Gateway's public address. Set once, by the Gateway, when it starts. */
  setGatewayBase(base: string): void {
    this.#gatewayBase = base;
  }

  async #runProbe(): Promise<StudioSeamProbe> {
    const at = new Date().toISOString();
    const upstream = {
      repository: OPENFILM_PIN.repository,
      full_sha: OPENFILM_PIN.full_sha,
      package: OPENFILM_PIN.package,
      license: OPENFILM_PIN.license,
    };
    const availability = await openFilmAvailability(this.#deps.vendorRoot);
    const head = availability.observed_sha;
    const clean = !availability.reason.includes("local modifications");
    if (!availability.available) {
      return {
        kind: "narralens.studio_seam_probe@1.0", probed_at: at, upstream,
        checkout: { head_sha: head, clean, checked: availability.checked },
        seams: {
          start_studio: { module: STUDIO_SERVER_MODULE, sha256: null, export_present: false,
            option_names: [], missing_options: [...REQUIRED_STUDIO_OPTIONS], ok: false },
          studio_host: { module: STUDIO_HOST_MODULE, sha256: null, declares_version_1: false,
            members: [], missing_members: [...REQUIRED_STUDIO_HOST_MEMBERS], ok: false },
        },
        loaded_closure: {},
        studio_build: { editor_dir: STUDIO_EDITOR_DIR, files: {} },
        ok: false,
        reason: availability.reason,
      };
    }

    const root = await realpath(this.#deps.vendorRoot);
    const serverSource = await readFile(resolve(root, STUDIO_SERVER_MODULE), "utf8").catch(() => "");
    // The option list is read from the function's own destructuring pattern, so the probe
    // answers "does this seam accept the options M5 needs" and not "does the file contain
    // these words somewhere".
    const signature = /export\s+async\s+function\s+startStudio\s*\(\s*\{([^}]*)\}/u.exec(serverSource);
    const declaredOptions = signature === null ? [] : signature[1]!
      .split(",").map((part) => part.trim().split(/[:=]/u)[0]!.trim()).filter((name) => name !== "");
    const missingOptions = REQUIRED_STUDIO_OPTIONS.filter((name) => !declaredOptions.includes(name));

    const hostSource = await readFile(resolve(root, STUDIO_HOST_MODULE), "utf8").catch(() => "");
    const hostMembers = REQUIRED_STUDIO_HOST_MEMBERS.filter((name) =>
      new RegExp(`\\b${name}\\b`, "u").test(hostSource));
    const missingMembers = REQUIRED_STUDIO_HOST_MEMBERS.filter((name) => !hostMembers.includes(name));
    const declaresVersion1 = /version\s*:\s*1\b/u.test(hostSource);

    const closure = await collectModuleClosure(root, STUDIO_SERVER_MODULE);
    const buildFiles = await digestDirectory(root, STUDIO_EDITOR_DIR);

    const startStudioOk = missingOptions.length === 0 && serverSource.includes("export async function startStudio");
    const hostOk = missingMembers.length === 0 && declaresVersion1;
    const ok = startStudioOk && hostOk;

    return {
      kind: "narralens.studio_seam_probe@1.0", probed_at: at, upstream,
      checkout: { head_sha: head, clean, checked: availability.checked },
      seams: {
        start_studio: {
          module: STUDIO_SERVER_MODULE,
          sha256: serverSource === "" ? null : sha256(serverSource),
          export_present: serverSource.includes("export async function startStudio"),
          option_names: declaredOptions,
          missing_options: missingOptions,
          ok: startStudioOk,
        },
        studio_host: {
          module: STUDIO_HOST_MODULE,
          sha256: hostSource === "" ? null : sha256(hostSource),
          declares_version_1: declaresVersion1,
          members: hostMembers,
          missing_members: missingMembers,
          ok: hostOk,
        },
      },
      loaded_closure: Object.fromEntries([...closure.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      studio_build: { editor_dir: STUDIO_EDITOR_DIR, files: buildFiles },
      ok,
      reason: ok ? "the Studio seam is present at the pinned upstream"
        : `the Studio seam is not usable: ${[
          ...missingOptions.map((name) => `startStudio lacks the ${name} option`),
          ...missingMembers.map((name) => `StudioHost lacks ${name}`),
          declaresVersion1 ? [] : ["StudioHost does not declare version 1"],
        ].join("; ")}`,
    };
  }
}
