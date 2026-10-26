import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NarralensHost } from "../../../src/host/server.js";
import { SimulatedHistoryCrash } from "../../../src/host/history/history-service.js";
import {
  HISTORY_ALL_FAULT_POINTS, HISTORY_DB_FAULT_POINTS, HISTORY_SERVICE_FAULT_POINTS,
  PUBLISHER_FAULT_POINTS, historyDbFaultPoint,
} from "../../../src/host/history/history-fault-registry.js";
import {
  adoptedProject, postImpact, postRestore, restoreImpactBody, restoreRequestBody, start, startOn,
  stopAll, type Started,
} from "./harness.js";

/**
 * M4C TX-08C: the fault matrix.
 *
 * The development gate §6 names the boundaries a controlled restore has to survive and says
 * that every one of them must be injected and asserted — a representative subset is not a
 * matrix. So this file walks the **registry** (`history-fault-registry.ts`), not a hand-picked
 * list, and it asserts the same facts at every boundary: what the source, the revision, the
 * pointer, the impact, the outbox, the idempotency rows, the temporary files and the
 * snapshots were before and after.
 *
 * The outcome every boundary has to reach is one of three: **committed**, **aborted** or
 * **attention**. What it must never be is a transaction left in flight, a revision that
 * moved twice, or a source that is neither the before nor the after.
 */

const hosts: NarralensHost[] = [];
const dirs: string[] = [];
afterEach(async () => { await stopAll(hosts.splice(0), dirs.splice(0)); });

interface WriteFacts {
  /** The digest of the active source's film. */
  readonly source_digest: string | null;
  readonly revision: number | null;
  /** The snapshot the active commit names. */
  readonly pointer: string | null;
  /** The impact's state. */
  readonly impact: string | null;
  readonly outbox: number;
  readonly idempotency: number;
  /** The publication's temporary files still on disk. */
  readonly temp: readonly string[];
  readonly snapshots: number;
  /** The state of the project's last transaction. */
  readonly transaction: string | null;
}

async function recursiveTemps(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true }).catch(() => [] as string[]);
  return entries.filter((name) => name.endsWith(".tmp") || name.includes(".film.tmp")).sort();
}

async function facts(host: NarralensHost, projectId: string, impactId: string): Promise<WriteFacts> {
  const commit = host.revisions.activeCommit(projectId);
  const view = await host.projectResolver.resolveActivated(projectId).catch(() => undefined);
  let sourceDigest: string | null = null;
  let temp: string[] = [];
  if (view !== undefined) {
    try {
      sourceDigest = createHash("sha256")
        .update(await readFile(join(view.source_root.value, "film.html"))).digest("hex");
      temp = await recursiveTemps(view.source_root.value);
    } catch { sourceDigest = null; }
  }
  const impact = host.impacts.get(impactId);
  const counts = host.revisions.compose((db) => ({
    idempotency: Number((db.prepare(
      "SELECT COUNT(*) AS n FROM operation_idempotency WHERE project_id=?").get(projectId) as { n: number }).n),
    snapshots: Number((db.prepare(
      "SELECT COUNT(*) AS n FROM snapshot WHERE project_id=?").get(projectId) as { n: number }).n),
    // The outbox **rows**, not the pending ones: the Host delivers them within a quarter
    // of a second, so "pending" is a race and a row count is a fact.
    outbox: Number((db.prepare(
      "SELECT COUNT(*) AS n FROM outbox WHERE project_id=?").get(projectId) as { n: number }).n),
  }));
  const transactions = host.revisions.projectTransactions(projectId);
  return {
    source_digest: sourceDigest,
    revision: commit?.revision ?? null,
    pointer: commit?.snapshot_id ?? null,
    impact: impact?.state ?? null,
    outbox: counts.outbox,
    idempotency: counts.idempotency,
    temp,
    snapshots: counts.snapshots,
    transaction: transactions.at(-1)?.state ?? null,
  };
}

async function hardExit(base: string, projectId: string, request: unknown, point: string): Promise<void> {
  const requestPath = join(base, `hard-exit-${point.replaceAll(":", "-")}.json`);
  await writeFile(requestPath, JSON.stringify(request), "utf8");
  const worker = join(process.cwd(), "tests/wave2/m4c/history-hard-exit-worker.ts");
  const exit = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", worker, base, projectId, requestPath, point], {
      cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 86 && stderr !== "") process.stderr.write(stderr);
      resolve(code);
    });
  });
  expect(exit, `child did not hard-exit at ${point}`).toBe(86);
}

/**
 * What each boundary has to converge to.
 *
 * A boundary *before* the publication leaves the source untouched, so the write is
 * abandoned with revision +0. A boundary *after* the film's rename has published the
 * source already, so the write has to finish: it commits with revision +1.
 */
type ExpectedOutcome = "aborted" | "committed" | "not_reached" | "nothing";

/**
 * The boundaries before the transaction exists.
 *
 * The gate's algorithm resolves the target *before* it opens the transaction, so a crash
 * there leaves nothing to abort: there is no row, the revision does not move and the
 * authorization is not spent. "Aborted" would be a claim about a transaction that was never
 * opened.
 */
const BEFORE_THE_TRANSACTION: ReadonlySet<string> = new Set(["after_target_resolved"]);

const BEFORE_PUBLICATION: ReadonlySet<string> = new Set([
  "after_received", "after_preconditions", "after_plan",
  "after_stage_copy", "during_stage_copy", "after_stage", "after_validate", "before_snapshot_publish",
  "after_snapshot_publish", "before_prepared", "after_prepared",
  "after_film_temp_fsync", "before_film_rename",
  // The assets are installed before the film is renamed, so a fault there leaves the active
  // film on the before bytes — the same answer as every other pre-publication boundary.
  "before_asset_install", "after_asset_install",
]);

const AFTER_PUBLICATION: ReadonlySet<string> = new Set([
  "after_film_rename", "after_parent_fsync", "after_active_inspect",
  "before_response", "after_committed",
]);

/**
 * The two asset-install boundaries.
 *
 * They need an asset to install, so they get their own setup (see the test body) rather
 * than being recorded as "not reached".
 */
const ASSET_BOUNDARIES: ReadonlySet<string> = new Set([
  "before_asset_install", "after_asset_install",
]);

function expectedOutcome(point: string): ExpectedOutcome {
  if (BEFORE_THE_TRANSACTION.has(point)) return "nothing";
  if (BEFORE_PUBLICATION.has(point)) return "aborted";
  if (AFTER_PUBLICATION.has(point)) return "committed";
  return "committed"; // every database boundary is inside the commit, after the publication
}

describe("M4C TX-08C: the fault matrix", () => {
  it("registers every boundary the gate names", () => {
    // The registry is the contract the matrix walks. These are the boundaries the gate §6
    // names, and a boundary that is not in the registry cannot be walked.
    for (const point of ["after_received", "after_preconditions", "after_target_resolved",
      "after_plan", "after_stage_copy", "during_stage_copy", "after_stage", "after_validate",
      "before_snapshot_publish", "after_snapshot_publish", "before_prepared", "after_prepared",
      "before_asset_install", "after_asset_install", "after_film_temp_fsync",
      "before_film_rename", "after_film_rename", "after_parent_fsync",
      "after_active_inspect", "before_response", "after_committed"]) {
      expect(HISTORY_SERVICE_FAULT_POINTS, point).toContain(point);
    }
    // And the database boundaries: one before and one after every statement of the one
    // commit transaction.
    for (const statement of ["verify_fact", "project_state", "impact", "snapshot",
      "projection_fact", "active_commit", "outbox", "idempotency", "transaction"]) {
      expect(HISTORY_DB_FAULT_POINTS, statement).toContain(`before_db_statement:${statement}`);
      expect(HISTORY_DB_FAULT_POINTS, statement).toContain(`after_db_statement:${statement}`);
    }
    expect(HISTORY_ALL_FAULT_POINTS.length)
      .toBe(HISTORY_SERVICE_FAULT_POINTS.length + HISTORY_DB_FAULT_POINTS.length);
  });

  it("the registry and the production code name the same boundaries, in both directions", () => {
    // The registry claims a two-way contract, so it is checked here rather than asserted:
    // every boundary the service, the publisher or the commit names is in the registry, and
    // every boundary in the registry is named by one of them.
    const service = readFileSync("src/host/history/history-service.ts", "utf8");
    const publisher = readFileSync("src/host/adoption/author-source-publisher.ts", "utf8");
    const store = readFileSync("src/host/projects/revision-store.ts", "utf8");
    const called = new Set<string>();
    for (const match of service.matchAll(/#deps\.fault\?\.\("([^"]+)"\)/gu)) called.add(match[1]!);
    for (const match of publisher.matchAll(/boundary\("([^"]+)"\)/gu)) {
      const mapped = PUBLISHER_FAULT_POINTS[match[1]!];
      expect(mapped, `the publisher's boundary ${match[1]!} is not in the registry's mapping`).toBeDefined();
      called.add(mapped!);
    }
    for (const match of store.matchAll(/statement\("([^"]+)", "(before|after)"\)/gu)) {
      called.add(historyDbFaultPoint(match[1]! as never, match[2]! as "before" | "after"));
    }
    const adapter = readFileSync("src/adapters/openfilm/openfilm-engine-adapter.ts", "utf8");
    for (const match of adapter.matchAll(/#fault\("([^"]+)"\)/gu)) called.add(match[1]!);
    const registered = new Set(HISTORY_ALL_FAULT_POINTS);
    const uncalled = [...called].filter((point) => !registered.has(point)).sort();
    const unreachable = [...registered].filter((point) => !called.has(point)).sort();
    // A boundary the code names that the registry does not: the matrix would walk a
    // boundary nobody can inject.
    expect(uncalled).toEqual([]);
    // A boundary the registry names that the code does not: the matrix would walk a
    // boundary nobody can reach — and would record it as covered.
    expect(unreachable).toEqual([]);
  });

  it.each(HISTORY_ALL_FAULT_POINTS)("converges the boundary %s to a decided state", async (point) => {
    let fired = false;
    const running = await start({ historyFault: (at) => {
      if (at !== point) return;
      fired = true;
      // The process-loss model: the write dies where it is, and nothing compensates.
      throw new SimulatedHistoryCrash(`FAULT:${point}`);
    } });
    hosts.push(running.host); dirs.push(running.base);

    const project = await adoptedProject(running, `fault-${point.replace(/[^A-Za-z0-9]/gu, "-")}`);
    // **The two asset-install boundaries need an asset to install.** The restore only
    // installs a content-addressed asset the target references and the active root does not
    // carry, so the ordinary flow — where the active root still has every asset the earlier
    // adoption installed — never reaches the publisher's asset boundaries. These two cases
    // therefore set that situation up: they restore the *older* snapshot first, delete the
    // adopted asset from the active root, and then restore the adopted snapshot, whose
    // closure needs the asset back.
    const assetCase = ASSET_BOUNDARIES.has(point);
    let target = project.migrationSnapshot;
    let view = project.view;
    if (assetCase) {
      const toOld = await postImpact(running, project.projectId,
        restoreImpactBody(project.view, project.migrationSnapshot, `m4c-fault-old-${point}`));
      expect(toOld.status, JSON.stringify(toOld.body)).toBe(201);
      const old = await postRestore(running, project.projectId, restoreRequestBody(
        project.view, project.migrationSnapshot,
        toOld.body as { impact_id: string; impact_hash: string }, `m4c-fault-old-restore-${point}`));
      expect(old.status, JSON.stringify(old.body)).toBe(200);
      const adoptedToken = running.host.adoptionFacts.projectionFact(project.adoptedSnapshot)
        ?.roots.find((root) => /^assets\/[a-f0-9]{64}\/source\.mp4$/u.test(root));
      expect(adoptedToken, "the adoption installed a content-addressed asset").toBeTruthy();
      const current = await running.host.projectResolver.resolveActivated(project.projectId);
      await rm(join(current.source_root.value, adoptedToken!), { force: true });
      target = project.adoptedSnapshot;
      view = await running.host.projectResolver.resolveActivated(project.projectId);
    }
    const impact = await postImpact(running, project.projectId,
      restoreImpactBody(view, target, `m4c-fault-impact-${point}`));
    expect(impact.status, JSON.stringify(impact.body)).toBe(201);
    const impactId = impact.body.impact_id as string;
    const before = await facts(running.host, project.projectId, impactId);

    const request = restoreRequestBody(view, target,
      impact.body as { impact_id: string; impact_hash: string }, `m4c-fault-${point}`);
    const response = await postRestore(running, project.projectId, request);
    const crashed = await facts(running.host, project.projectId, impactId);
    // The outcome is decided *after* the write, because whether the boundary was reached is
    // what the write itself tells us.
    const outcome = fired ? expectedOutcome(point) : "committed";

    if (fired) {
      // **The write died at the boundary.** Nothing may have moved that the boundary does
      // not own.
      expect(response.status).toBeGreaterThanOrEqual(400);
      // The crash left the transaction where it died — the process is gone, so nothing
      // compensated it. The *restart* is what has to decide it, and that is asserted below.
      expect(crashed.transaction).not.toBeNull();
      // The revision never moves twice and the pointer never moves backwards.
      if (crashed.revision !== null) expect(crashed.revision).toBeGreaterThanOrEqual(before.revision ?? 0);
      if (outcome === "aborted" || outcome === "nothing") {
        // Nothing that the boundary does not own moved.
        expect(crashed.revision).toBe(before.revision);
        expect(crashed.pointer).toBe(before.pointer);
        expect(crashed.source_digest).toBe(before.source_digest);
      }
    } else {
      // **The boundary did not fire and nobody said it would not.** That means the seam is
      // unreachable — the registry names a boundary the code cannot reach — and the write
      // completed without it. Recording that as a green "committed" would be exactly the
      // over-claim the gate forbids, so it fails here instead.
      throw new Error(`FAULT_POINT_UNREACHABLE:${point}`);
    }

    // ── the restart: the write must converge ───────────────────────────────────────────
    await running.host.close();
    hosts.splice(hosts.indexOf(running.host), 1);
    const restarted = await startOn(running.base);
    hosts.push(restarted.host);
    const after = await facts(restarted.host, project.projectId, impactId);

    if (outcome === "aborted") {
      // **Aborted.** The revision did not move, the pointer did not move, the source did
      // not move, the impact was not consumed, no outbox row was written, no snapshot was
      // added, and the temporary file is gone.
      expect(after.transaction).toBe("aborted");
      expect(after.revision).toBe(before.revision);
      expect(after.pointer).toBe(before.pointer);
      expect(after.source_digest).toBe(before.source_digest);
      expect(after.impact).toBe("active");
      expect(after.outbox).toBe(before.outbox);
      expect(after.snapshots).toBe(before.snapshots);
      expect(after.temp).toEqual([]);
    } else if (outcome === "committed") {
      // **Committed.** Exactly one revision, the pointer moved once, the impact was consumed,
      // exactly one outbox row was written, no new snapshot appeared — the restored content
      // *is* the target's content, so that snapshot already existed — and the temporary file
      // is gone.
      expect(after.transaction).toBe("committed");
      expect(after.revision).toBe((before.revision ?? 0) + 1);
      expect(after.pointer).not.toBe(before.pointer);
      expect(after.impact).toBe("consumed");
      expect(after.outbox).toBe(before.outbox + 1);
      expect(after.snapshots).toBe(before.snapshots);
      expect(after.temp).toEqual([]);
    } else if (outcome === "not_reached") {
      // **Not reached.** The write completed and nothing about it is in doubt.
      expect(after.transaction).toBe("committed");
      expect(after.revision).toBe((before.revision ?? 0) + 1);
      expect(after.impact).toBe("consumed");
      expect(after.outbox).toBe(before.outbox + 1);
      expect(after.snapshots).toBe(before.snapshots);
    } else {
      // **Nothing happened.** The boundary is before the transaction is opened, so there is
      // no row to abort, the revision did not move, the pointer did not move, the source did
      // not move and the authorization was not spent.
      expect(after.revision).toBe(before.revision);
      expect(after.pointer).toBe(before.pointer);
      expect(after.source_digest).toBe(before.source_digest);
      expect(after.impact).toBe("active");
      expect(after.idempotency).toBe(before.idempotency);
      expect(after.temp).toEqual([]);
    }

    // **No orphan of any kind.** No transaction left in flight, no temporary file, and the
    // idempotency authority holds exactly one answer for the key.
    const transactions = restarted.host.revisions.projectTransactions(project.projectId);
    expect(transactions.filter((row) => !["committed", "aborted", "attention"].includes(row.state)))
      .toEqual([]);
    const rows = restarted.host.revisions.compose((db) => Number((db.prepare(
      "SELECT COUNT(*) AS n FROM operation_idempotency WHERE project_id=? AND operation_kind=? AND idempotency_key=?")
      .get(project.projectId, "controlled_write.restore_snapshot", `m4c-fault-${point}`) as { n: number }).n));
    if (outcome === "nothing") {
      // Nothing was opened, so nothing was recorded against the key.
      expect(rows).toBe(0);
    } else {
      // Exactly one answer for the key: the write is decided, and the key is spent.
      expect(rows).toBe(1);
      expect(after.idempotency).toBe(before.idempotency + 1);
    }
  }, 900_000);
});

describe("M4C TX-08C: real process loss", () => {
  it.each(["before_asset_install", "after_asset_install"])(
    "hard-exits a child at %s and sweeps nested asset temporaries", async (point) => {
      const running = await start();
      hosts.push(running.host); dirs.push(running.base);
      const project = await adoptedProject(running, `hard-${point}`);

      // Put the migration snapshot back, then remove the adopted snapshot's immutable
      // asset. Restoring the adopted snapshot now has to execute the asset publisher.
      const toOld = await postImpact(running, project.projectId,
        restoreImpactBody(project.view, project.migrationSnapshot, `hard-old-impact-${point}`));
      expect(toOld.status, JSON.stringify(toOld.body)).toBe(201);
      const restoredOld = await postRestore(running, project.projectId, restoreRequestBody(
        project.view, project.migrationSnapshot,
        toOld.body as { impact_id: string; impact_hash: string }, `hard-old-restore-${point}`));
      expect(restoredOld.status, JSON.stringify(restoredOld.body)).toBe(200);
      const asset = running.host.adoptionFacts.projectionFact(project.adoptedSnapshot)
        ?.roots.find((root) => /^assets\/[a-f0-9]{64}\/source\.mp4$/u.test(root));
      expect(asset).toBeTruthy();
      const current = await running.host.projectResolver.resolveActivated(project.projectId);
      await rm(join(current.source_root.value, asset!), { force: true });

      const impact = await postImpact(running, project.projectId,
        restoreImpactBody(current, project.adoptedSnapshot, `hard-impact-${point}`));
      expect(impact.status, JSON.stringify(impact.body)).toBe(201);
      const request = restoreRequestBody(current, project.adoptedSnapshot,
        impact.body as { impact_id: string; impact_hash: string }, `hard-restore-${point}`);
      const before = await facts(running.host, project.projectId, impact.body.impact_id as string);
      await running.host.close();
      hosts.splice(hosts.indexOf(running.host), 1);
      await hardExit(running.base, project.projectId, request, point);

      const restarted = await startOn(running.base);
      hosts.push(restarted.host);
      const after = await facts(restarted.host, project.projectId, impact.body.impact_id as string);
      expect(after.transaction).toBe("aborted");
      expect(after.revision).toBe(before.revision);
      expect(after.pointer).toBe(before.pointer);
      expect(after.temp).toEqual([]);
      expect(await recursiveTemps(join(running.base, "adoption-stage"))).toEqual([]);
      expect(after.outbox).toBe(before.outbox);
      expect(after.idempotency).toBe(before.idempotency + 1);
      expect(after.snapshots).toBe(before.snapshots);
    }, 900_000);

  it.each([
    "after_film_temp_fsync",
    "after_film_rename",
    "after_db_statement:transaction",
  ])("hard-exits a child at %s and recovers from durable state only", async (point) => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const project = await adoptedProject(running, `hard-${point.replaceAll(":", "-")}`);
    const impact = await postImpact(running, project.projectId,
      restoreImpactBody(project.view, project.migrationSnapshot, `hard-impact-${point}`));
    expect(impact.status, JSON.stringify(impact.body)).toBe(201);
    const request = restoreRequestBody(project.view, project.migrationSnapshot,
      impact.body as { impact_id: string; impact_hash: string }, `hard-restore-${point}`);
    const before = await facts(running.host, project.projectId, impact.body.impact_id as string);

    await running.host.close();
    hosts.splice(hosts.indexOf(running.host), 1);
    await hardExit(running.base, project.projectId, request, point);

    const restarted = await startOn(running.base);
    hosts.push(restarted.host);
    const after = await facts(restarted.host, project.projectId, impact.body.impact_id as string);
    expect(after.transaction).toBe(point === "after_film_temp_fsync" ? "aborted" : "committed");
    expect(after.revision).toBe((before.revision ?? 0) + (point === "after_film_temp_fsync" ? 0 : 1));
    expect(after.temp).toEqual([]);
    expect(await recursiveTemps(join(running.base, "adoption-stage"))).toEqual([]);
    expect(after.outbox).toBe(before.outbox + (point === "after_film_temp_fsync" ? 0 : 1));
    expect(after.idempotency).toBe(before.idempotency + 1);
    expect(after.snapshots).toBe(before.snapshots);
  }, 900_000);
});
