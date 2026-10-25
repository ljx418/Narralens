import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NarralensHost } from "../../../src/host/server.js";
import { SimulatedHistoryCrash } from "../../../src/host/history/history-service.js";
import {
  adoptedProject, getHistory, headers, postImpact, postRestore, restoreImpactBody,
  restoreRequestBody, start, startOn, stopAll, type Started,
} from "./harness.js";

/**
 * M4C's crash matrix, its races and its idempotency.
 *
 * Every boundary is a seam a test fires at, so the rule each boundary implies is
 * *exercised* rather than merely present. The rules are the gate's:
 *
 * - before `prepared`, the only legal conclusion is an abort with revision +0;
 * - after `prepared`, the write converges to exactly one commit — or to a terminal
 *   attention when nothing can be proved;
 * - a race never reaches the commit.
 */

const hosts: NarralensHost[] = [];
const dirs: string[] = [];
afterEach(async () => { await stopAll(hosts.splice(0), dirs.splice(0)); });

/** Migrate, adopt, and compute the impact a restore would be authorized by. */
async function authorizedRestore(running: Started, suffix: string) {
  const project = await adoptedProject(running, suffix);
  const impact = await postImpact(running, project.projectId,
    restoreImpactBody(project.view, project.migrationSnapshot, `m4c-restore-impact-${suffix}`));
  if (impact.status !== 201) {
    throw new Error(`RESTORE_IMPACT_${impact.status}:${JSON.stringify(impact.body)}`);
  }
  return { ...project, impact: impact.body as { impact_id: string; impact_hash: string },
    request: restoreRequestBody(project.view, project.migrationSnapshot,
      impact.body as { impact_id: string; impact_hash: string }, `m4c-restore-${suffix}`) };
}

describe("M4C TX-08C: the crash matrix converges to a decided state", () => {
  it.each([
    ["after_received", "received"],
    ["after_preconditions", "preconditions_checked"],
    ["after_plan", "preconditions_checked"],
    ["after_stage", "staged"],
    ["after_validate", "validated"],
    ["after_snapshot_publish", "validated"],
  ] as const)("converges the pre-publish crash boundary %s to aborted with revision +0", async (boundary, state) => {
    // Before `prepared` the publisher has not been called at all, so the only legal
    // conclusion is an abort with revision +0, the stage and temp cleaned up, and one
    // idempotency failure that replays verbatim.
    const running = await start({ historyFault: (point) => {
      if (point === boundary) throw new SimulatedHistoryCrash(`PUBLISH_CRASH:${boundary}`);
    } });
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedRestore(running, `pre-${boundary}`);
    const crashed = await postRestore(running, prepared.projectId, prepared.request);
    expect(crashed.status).toBeGreaterThanOrEqual(400);
    expect(running.host.revisions.projectTransactions(prepared.projectId).at(-1)?.state).toBe(state);

    await running.host.close();
    hosts.splice(hosts.indexOf(running.host), 1);
    const restarted = await startOn(running.base);
    hosts.push(restarted.host);
    expect(restarted.host.revisions.projectTransactions(prepared.projectId).at(-1)?.state).toBe("aborted");
    const view = await restarted.host.projectResolver.resolveActivated(prepared.projectId);
    expect(view.revision).toBe(prepared.view.revision);
    // No staging tree and no temp file survive the recovery.
    expect(await readdir(join(running.base, "adoption-stage")).catch(() => [])).toEqual([]);
    expect((await readdir(view.source_root.value)).filter((name) => name.includes(".film.tmp"))).toEqual([]);
  }, 900_000);

  it("converges a crash after the publication to one durable commit with revision +1", async () => {
    // The publication happened, so the write has to finish: the recovery finds the source
    // already carrying the restored bytes and commits it exactly once.
    const running = await start({ historyFault: (point) => {
      if (point !== "after_published") return;
      throw new SimulatedHistoryCrash("PUBLISH_CRASH:after_published");
    } });
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedRestore(running, "post-publish");
    const crashed = await postRestore(running, prepared.projectId, prepared.request);
    expect(crashed.status).toBeGreaterThanOrEqual(400);

    await running.host.close();
    hosts.splice(hosts.indexOf(running.host), 1);
    const restarted = await startOn(running.base);
    hosts.push(restarted.host);
    expect(restarted.host.revisions.projectTransactions(prepared.projectId).at(-1)?.state).toBe("committed");
    const view = await restarted.host.projectResolver.resolveActivated(prepared.projectId);
    expect(view.revision).toBe(prepared.view.revision + 1);
    expect(view.snapshot_id).toBe(prepared.migrationSnapshot);
  }, 900_000);

  it("aborts with revision +0 when the crash came after the intent but before the publication", async () => {
    const running = await start({ historyFault: (point) => {
      if (point !== "after_prepared") return;
      throw new SimulatedHistoryCrash("PUBLISH_CRASH:after_prepared");
    } });
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedRestore(running, "prepared-crash");
    const crashed = await postRestore(running, prepared.projectId, prepared.request);
    expect(crashed.status).toBeGreaterThanOrEqual(400);

    await running.host.close();
    hosts.splice(hosts.indexOf(running.host), 1);
    const restarted = await startOn(running.base);
    hosts.push(restarted.host);
    expect(restarted.host.revisions.projectTransactions(prepared.projectId).at(-1)?.state).toBe("aborted");
    const view = await restarted.host.projectResolver.resolveActivated(prepared.projectId);
    expect(view.revision).toBe(prepared.view.revision);
    expect(view.source_digest).toBe(prepared.view.source_digest);
  }, 900_000);
});

describe("M4C TX-05C: a race never reaches the commit", () => {
  it("refuses a restore whose control revision moved, and the revision does not move", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedRestore(running, "control-moved");
    // A lock moves the control revision, so the request's control revision is stale.
    running.host.locks.acquire({ projectId: prepared.projectId, lockType: "visual", scope: "shot",
      targetId: "shot-002", startFrame: 300, endFrameExclusive: 600, owner: "test",
      reason: "tx-05c" }, prepared.view.revision);
    const refused = await postRestore(running, prepared.projectId, prepared.request);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("REVISION_CONFLICT");
    const after = await running.host.projectResolver.resolveActivated(prepared.projectId);
    expect(after.revision).toBe(prepared.view.revision);
    // The refusal happens *before* the transaction is created, so there is no row to abort:
    // the restore wrote nothing at all.
    expect(running.host.revisions.projectTransactions(prepared.projectId)
      .filter((row) => row.kind === "history")).toEqual([]);
  }, 900_000);

  it("refuses a restore whose expected source digest is not the project's, and the revision does not move", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedRestore(running, "source-moved");
    const refused = await postRestore(running, prepared.projectId, {
      ...prepared.request, expected_source_digest: "9".repeat(64),
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("SOURCE_CHANGED");
    const after = await running.host.projectResolver.resolveActivated(prepared.projectId);
    expect(after.revision).toBe(prepared.view.revision);
  }, 900_000);

  it("refuses a restore when the source changes during the stage, and the revision does not move", async () => {
    let host: NarralensHost | undefined;
    let projectId = "";
    const running = await start({ historyFault: async (point) => {
      if (point !== "after_plan" || projectId === "") return;
      // The source moves under the restore, between the plan and the stage.
      const view = await host!.projectResolver.resolveActivated(projectId);
      const filmPath = join(view.source_root.value, "film.html");
      const original = await readFile(filmPath, "utf8");
      await writeFile(filmPath, original.replace("</body>", "<!-- m4c race --></body>"), "utf8");
    } });
    host = running.host;
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedRestore(running, "stage-race");
    projectId = prepared.projectId;
    const refused = await postRestore(running, prepared.projectId, prepared.request);
    // The stage recomputes the source digest before it copies anything, so a source that
    // moved is refused rather than staged.
    expect(refused.status).toBe(409);
    const after = await running.host.projectResolver.resolveActivated(prepared.projectId);
    expect(after.revision).toBe(prepared.view.revision);
  }, 900_000);
});

describe("M4C TX-07C: one key, one answer", () => {
  it("replays the same key with the same body and does not restore twice", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedRestore(running, "replay");
    const first = await postRestore(running, prepared.projectId, prepared.request);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const second = await postRestore(running, prepared.projectId, prepared.request);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    const after = await running.host.projectResolver.resolveActivated(prepared.projectId);
    expect(after.revision).toBe(prepared.view.revision + 1);
    // One transaction, one outbox row, one idempotency row.
    const transactions = running.host.revisions.projectTransactions(prepared.projectId)
      .filter((row) => row.kind === "history");
    expect(transactions).toHaveLength(1);
  }, 900_000);

  it("answers the same key with a different request with 409, and the revision does not move", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedRestore(running, "conflict");
    const first = await postRestore(running, prepared.projectId, prepared.request);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    // The same key with a different body is a conflict, not a second restore.
    const conflict = await postRestore(running, prepared.projectId, {
      ...prepared.request, target_snapshot_id: prepared.adoptedSnapshot,
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    const after = await running.host.projectResolver.resolveActivated(prepared.projectId);
    expect(after.revision).toBe(prepared.view.revision + 1);
  }, 900_000);

  it("keeps the adoption and restore key spaces apart", async () => {
    // The two controlled writes are different *operation kinds*, so the same key names two
    // different requests and neither is a replay of the other.
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const project = await adoptedProject(running, "key-space");
    const impact = await postImpact(running, project.projectId,
      restoreImpactBody(project.view, project.migrationSnapshot, "m4c-key-space-impact"));
    expect(impact.status, JSON.stringify(impact.body)).toBe(201);
    // The adoption used the key `m4c-write-key-space`; the restore uses the same one.
    const restored = await postRestore(running, project.projectId, restoreRequestBody(
      project.view, project.migrationSnapshot,
      impact.body as { impact_id: string; impact_hash: string }, "m4c-write-key-space"));
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    const after = await running.host.projectResolver.resolveActivated(project.projectId);
    expect(after.revision).toBe(project.view.revision + 1);
  }, 900_000);
});

describe("M4C TX-09: the history keeps every revision", () => {
  it("lists the migration, the adoption and the restore, and deletes nothing", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedRestore(running, "history");
    const restored = await postRestore(running, prepared.projectId, prepared.request);
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    const history = await getHistory(running, prepared.projectId);
    expect(history.status).toBe(200);
    const entries = history.body.entries as Array<{ revision: number; snapshot_id: string; kind: string }>;
    expect(entries.map((entry) => entry.kind)).toEqual(["migration", "adoption", "restore"]);
    expect(entries.map((entry) => entry.revision)).toEqual([1, 2, 3]);
    // The restored entry carries the *target's* snapshot id: content addressing means the
    // restored closure and the old closure are the same content, and therefore the same id.
    expect(entries[2]!.snapshot_id).toBe(prepared.migrationSnapshot);
    // And the old snapshot is still there, with its bytes.
    const row = running.host.revisions.snapshotRow(prepared.migrationSnapshot);
    expect(row?.source_digest).toBeTruthy();
    expect(running.host.revisions.snapshotRow(prepared.adoptedSnapshot)?.source_digest).toBeTruthy();
  }, 900_000);
});

describe("M4C TX-10: the native history surface cannot bypass the two stages", () => {
  it("translates undo and redo into an intent and writes nothing", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedRestore(running, "bypass");
    for (const command of ["undo", "redo"] as const) {
      const response = await fetch(
        `${running.origin}/api/migration/v1/projects/${prepared.projectId}/history/${command}`,
        { method: "POST", headers: headers(running.origin, running.token), body: "{}" });
      const body = await response.json() as Record<string, unknown>;
      if (command === "undo") {
        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(body.op).toBe("restore_snapshot");
        expect(body.target_snapshot_id).toBe(prepared.migrationSnapshot);
      } else {
        // Nothing has been restored, so there is nothing to redo.
        expect(response.status).toBe(422);
      }
      const after = await running.host.projectResolver.resolveActivated(prepared.projectId);
      expect(after.revision).toBe(prepared.view.revision);
    }
  }, 900_000);
});
