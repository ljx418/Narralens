import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CacheProcessSupervisor,
  observeCacheProcessGroup,
  observeCacheProcessIdentity,
} from "../../../src/adapters/openfilm/cache-process-supervisor.js";
import {
  OPENFILM_CACHE_PRODUCER_FILE,
  OPENFILM_CACHE_PRODUCER_SHA256,
  createPinnedOpenFilmCacheProducer,
  isIssuedOpenFilmCacheProducer,
} from "../../../src/adapters/openfilm/openfilm-upstream.js";
import { cacheProductionRootState } from "../../../src/adapters/openfilm/cache-production-scope.js";
import { nativeSourceFixture } from "./helpers/native-source-fixture.js";
import { vendorRoot } from "./helpers/created-project-fixture.js";

/**
 * The settlement of a native cache draw.
 *
 * Every case here needs a REAL process: the worker of a draw is a process of
 * its own, watched by a custodian that lives outside its group, and the whole
 * point of the supervisor is that it can prove - or refuse to prove - that the
 * process domain of that draw really disappeared. A double that resolves a
 * promise proves nothing about that.
 *
 * These cases are NOT RUN in this wave: the wave that released this file
 * allowed the identity, the scheduler, the static gates and the pure unit tests
 * only. The real cases need the pinned upstream, a browser and a heavy slot,
 * and they run under the exact P2a resource ticket.
 *
 * THE TWO LANES ARE SEPARATE, and the file says so:
 *
 *  - the NON-BROWSER lane (the first describe) needs the custodian, the helper
 *    of the faults and nothing else. No media, no browser, no Host;
 *  - the BROWSER lane (the last describe) draws a real picture with the pinned
 *    upstream. It is a P2b case, and it is NOT part of a non-browser grant.
 *
 * Nothing here is a claim that a case passed: a case that was not run is
 * NOT_RUN.
 *
 * The helper of the faults is ONE file with SCENARIO MODES
 * (`tests/agent-driven/integration/helpers/cache-worker-fixture.mjs`): three
 * workers that do the same thing differently would be three files to keep in
 * step for no reason.
 */

/** The worker of a draw. Its path is fixed; it is never taken from a request. */
const WORKER_PATH = fileURLToPath(
  new URL("../../../src/adapters/openfilm/openfilm-cache-worker.mjs", import.meta.url));
/** The worker of the faults. */
const FIXTURE_PATH = fileURLToPath(
  new URL("./helpers/cache-worker-fixture.mjs", import.meta.url));
/** The file that names the mode of the next run of the fixture. */
const SCENARIO_PATH = fileURLToPath(
  new URL("./helpers/cache-worker-fixture.scenario", import.meta.url));
/** The file the fixture appends its events to. */
const EVENTS_PATH = fileURLToPath(
  new URL("./helpers/cache-worker-fixture.events", import.meta.url));
/** The custodian of a draw. */
const CUSTODIAN_PATH = fileURLToPath(
  new URL("../../../src/adapters/openfilm/cache-process-custodian.py", import.meta.url));
/** The interpreter the custodian runs under. */
const PYTHON = "/usr/bin/python3.12";

/** The fixtures that are still open. */
const closers: (() => Promise<void>)[] = [];
/** The directories that may be removed: only the ones whose draw really ended. */
const removable: string[] = [];
/** The directories that are KEPT because something may still be alive in them. */
const kept: string[] = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  for (const path of removable.splice(0)) rmSync(path, { recursive: true, force: true });
  // A directory whose draw did not settle is NOT removed: something may still be
  // alive in it, and the next case has to find it.
  for (const path of kept.splice(0)) {
    if (existsSync(path)) {
      throw new Error(`the directory ${path} was kept: the draw of it did not really end`);
    }
  }
  if (existsSync(SCENARIO_PATH)) rmSync(SCENARIO_PATH, { force: true });
  if (existsSync(EVENTS_PATH)) rmSync(EVENTS_PATH, { force: true });
});

/** A supervisor whose worker is the helper of the faults. */
function fixtureSupervisor(): CacheProcessSupervisor {
  return new CacheProcessSupervisor({
    vendorRoot: "/nonexistent/vendor",
    producerFile: OPENFILM_CACHE_PRODUCER_FILE,
    producerSha256: OPENFILM_CACHE_PRODUCER_SHA256,
    workerPath: FIXTURE_PATH,
    custodianPath: CUSTODIAN_PATH,
    pythonExecutable: PYTHON,
  });
}

/** Ask the helper for one mode, and clean its files up afterwards. */
async function withScenario(scenario: string, work: () => Promise<void>): Promise<void> {
  writeFileSync(SCENARIO_PATH, `${scenario}\n`);
  rmSync(EVENTS_PATH, { force: true });
  try {
    await work();
  } finally {
    rmSync(SCENARIO_PATH, { force: true });
  }
}

/** The events the helper wrote: they show that a mode was really REACHED. */
function fixtureEvents(): { event: string; scenario?: string }[] {
  if (!existsSync(EVENTS_PATH)) return [];
  return readFileSync(EVENTS_PATH, "utf8")
    .split("\n")
    .filter(line => line.trim() !== "")
    .map(line => JSON.parse(line) as { event: string; scenario?: string });
}

/** A working copy of the draw: a real directory, and nothing else. */
function workingRoot(tag: string): string {
  const root = mkdtempSync(join(tmpdir(), `narralens-settlement-${tag}-`));
  removable.push(root);
  return root;
}

describe("the settlement of a native cache draw - the NON-BROWSER lane", () => {
  it("reads the identity of THIS process from the kernel, and its group with it", () => {
    // The pid of a process is NOT the number of its group: the group is read
    // from the identity, and never assumed.
    const observation = observeCacheProcessIdentity(process.pid);
    expect(observation.presence).toBe("known");
    const pgid = observation.identity!.pgid;
    const group = observeCacheProcessGroup(pgid);
    expect(group.presence).toBe("known");
    expect(group.members.some(member => member.pid === process.pid)).toBe(true);
    // A group that does not exist is gone, and only that is gone.
    expect(observeCacheProcessGroup(0x7ffffff0).presence).toBe("gone");
  });

  it("refuses a handle that this supervisor did not issue", async () => {
    const supervisor = new CacheProcessSupervisor({
      vendorRoot, producerFile: OPENFILM_CACHE_PRODUCER_FILE,
      producerSha256: OPENFILM_CACHE_PRODUCER_SHA256,
      workerPath: WORKER_PATH, custodianPath: CUSTODIAN_PATH, pythonExecutable: PYTHON,
    });
    // A lookalike, a JSON object and a bare number are all unrecognised.
    expect(supervisor.inspectCleanup({}).known).toBe(false);
    expect(supervisor.inspectCleanup(null).known).toBe(false);
    await expect(supervisor.reconcileCleanup({} as never)).rejects.toMatchObject({ code: "DRAW_FOREIGN" });
    await expect(supervisor.reconcileCleanup(4711 as never)).rejects.toMatchObject({ code: "DRAW_FOREIGN" });
  });

  it("settles a draw whose custodian cannot be started, and leaves no process behind", async () => {
    const supervisor = new CacheProcessSupervisor({
      vendorRoot, producerFile: OPENFILM_CACHE_PRODUCER_FILE,
      producerSha256: OPENFILM_CACHE_PRODUCER_SHA256,
      workerPath: WORKER_PATH,
      // A custodian that is not there: the draw fails, and it fails as a SETTLED
      // failure - there is no process to prove anything about.
      custodianPath: "/nonexistent/narralens-cache-custodian.py",
      pythonExecutable: PYTHON,
    });
    const before = observeCacheProcessGroup(process.pid).members.length;
    await expect(supervisor.draw({
      root: "/tmp", base: "http://127.0.0.1:1", rel: "film.html", ms: -1, width: 480, overrides: null,
    })).rejects.toBeDefined();
    // Nothing was left behind in the group of this process.
    expect(observeCacheProcessGroup(process.pid).members.length).toBe(before);
  });

  it("really draws with the helper of the faults, and the domain is gone afterwards", async () => {
    const root = workingRoot("normal");
    await withScenario("normal", async () => {
      const supervisor = fixtureSupervisor();
      // The positive control: the helper REALLY succeeds. A case that accepted
      // any rejection would pass here without proving anything.
      const picture = await supervisor.draw({
        root, base: "http://127.0.0.1:1", rel: "film.html",
        ms: -1, width: 480, overrides: null,
      });
      expect(picture.length).toBeGreaterThan(0);
      expect(fixtureEvents().some(entry => entry.event === "answered")).toBe(true);
    });
  });

  it("keeps the scope of a production while the production runs", async () => {
    const fixture = await nativeSourceFixture();
    closers.push(() => fixture.close());
    const producer = await createPinnedOpenFilmCacheProducer(vendorRoot);
    const production = fixture.workspace.produceNativeCacheEntry(fixture.productionLease(), {
      producer, rel: "film.html", ms: -1, width: 480, overrides: null, kind: "film-poster",
    });
    // While the production runs, the root is not quiet: a reader of that root may
    // not deliver facts about a tree that is being written.
    expect(cacheProductionRootState(fixture.workspaceRoot)).toBe("producing");
    await production;
    expect(cacheProductionRootState(fixture.workspaceRoot)).toBe("idle");
  });
});

describe("the settlement of a native cache draw - the BROWSER lane (P2b)", () => {
  it("draws a real picture in a worker of its own, and the domain of that worker is gone afterwards", async () => {
    const fixture = await nativeSourceFixture();
    closers.push(() => fixture.close());
    const producer = await createPinnedOpenFilmCacheProducer(vendorRoot);
    expect(isIssuedOpenFilmCacheProducer(producer)).toBe(true);
    // The production of the fixture draws the film's poster. The draw happens in a
    // worker of its own under a custodian that is outside its group; the picture
    // comes back only after that custodian really reaped everything.
    const witness = await fixture.workspace.produceNativeCacheEntry(fixture.productionLease(), {
      producer, rel: "film.html", ms: -1, width: 480, overrides: null, kind: "film-poster",
    });
    expect(witness.kind).toBe("film-poster");
    // The root is quiet again: the scope of the production was given back.
    expect(cacheProductionRootState(fixture.workspaceRoot)).toBe("idle");
    // The picture is really in the working copy.
    expect(witness.outputs.length).toBeGreaterThan(0);
  });
});

/**
 * The cases of the P2a resource ticket.
 *
 * Each of them needs the helper of the faults - ONE file with scenario modes -
 * and each of them needs the pinned upstream and a heavy slot:
 *
 *  - ISO-04: a worker that starts a page AFTER the draw - the late continuation
 *    may not outlive the execution domain of the draw.
 *  - ISO-08: a worker that floods its output and one that sends an oversized
 *    frame: both are refused and really cleaned.
 *  - ISO-09: a worker that ignores SIGTERM: the group is really taken down, and
 *    the leader, the group and every known descendant - zombies included - are
 *    gone.
 *  - ISO-10: a worker whose leader dies on its own, and a worker whose group the
 *    Host may not signal: neither is settled, and the scope, the descriptors and
 *    the capacity stay where they are.
 *  - ISO-11: the reconcile of a held draw with FRESH evidence, exactly once; a
 *    copied handle, an old JSON and a bare pid settle nothing.
 *  - ISO-15: the order of the finalisation - a complete candidate, then the
 *    recorded FINALIZE_AFTER_OK, then the authorised termination, then the real
 *    settlement, then the final source and witness gates.
 *
 * The helper file these cases need is named here and is written:
 *
 *  - tests/agent-driven/integration/helpers/cache-worker-fixture.mjs
 */
export const CACHE_SETTLEMENT_P2_CASES = Object.freeze([
  "ISO-04", "ISO-08", "ISO-09", "ISO-10", "ISO-11", "ISO-15",
]);
