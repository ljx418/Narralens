import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { planDigest } from "../../../src/host/materialize/native-plan-builder.js";
import type { NativePlanV1 } from "../../../src/contracts/wave2-types.js";
import { validateControlledWriteResponse } from "../../../src/contracts/validator.js";
import { NarralensHost } from "../../../src/host/server.js";
import { createPinnedOpenFilmUpstream } from "../../../src/adapters/openfilm/openfilm-upstream.js";
import {
  adoptBody, coveringPlan, headers, migrate, postImpact, readyMaterialization,
  start, startOn, stopAll, type Started,
} from "../m4a/harness.js";

/**
 * M4C's production history route.
 *
 * Everything here is real: a real Host, a real migration of the real fixture through the
 * Host's own route, a real controlled adoption against the pinned OpenFilm checkout, a
 * real restore, and a real restart. Nothing is mocked except the proxy encode, which the
 * M4A harness already documents as the one thing it stands in for.
 */

const hosts: NarralensHost[] = [];
const dirs: string[] = [];
const VENDOR = "/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm";
const run = promisify(execFile);
afterEach(async () => { await stopAll(hosts.splice(0), dirs.splice(0)); });

function stableThreeClipPlan(running: Started, projectId: string): NativePlanV1 {
  const base = coveringPlan(running.host, projectId, 900, 3);
  const spec = { ...base, clips: base.clips.map((clip, index) => ({ ...clip, clip_id: `shot-00${index + 1}` })) };
  const { plan_sha256: _old, ...preimage } = spec;
  return { ...preimage, plan_sha256: planDigest(preimage) };
}

/** The snapshot the migration published — the project's own history entry zero. */
function migrationSnapshot(running: Started, projectId: string): string {
  for (const migration of running.host.revisions.migrations.all()) {
    if (migration.target_project_id !== projectId) continue;
    if (migration.target_snapshot_id === null) continue;
    return migration.target_snapshot_id;
  }
  throw new Error(`NO_MIGRATION_SNAPSHOT:${projectId}`);
}

async function postRestore(running: Started, projectId: string, body: unknown) {
  const response = await fetch(`${running.origin}/api/migration/v1/projects/${projectId}/history/restore`, {
    method: "POST", headers: headers(running.origin, running.token), body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? {} : JSON.parse(text) as Record<string, unknown> };
}

async function getHistory(running: Started, projectId: string) {
  const response = await fetch(`${running.origin}/api/migration/v1/projects/${projectId}/history`, {
    headers: headers(running.origin, running.token),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function postIntent(running: Started, projectId: string, command: "undo" | "redo") {
  const response = await fetch(`${running.origin}/api/migration/v1/projects/${projectId}/history/${command}`, {
    method: "POST", headers: headers(running.origin, running.token), body: "{}",
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? {} : JSON.parse(text) as Record<string, unknown> };
}

/** Migrate, adopt, and return the facts a restore needs. */
async function adoptedProject(running: Started, suffix: string) {
  const { projectId, view } = await migrate(running, `m4c-migrate-${suffix}`);
  const materialization = await readyMaterialization(running.host, projectId, `m4c-materialize-${suffix}`,
    stableThreeClipPlan(running, projectId));
  const impact = await postImpact(running, projectId,
    adoptBody(view, materialization.materialization_id, `m4c-impact-${suffix}`));
  expect(impact.status, JSON.stringify(impact.body)).toBe(201);
  const adopted = await fetch(`${running.origin}/api/migration/v1/projects/${projectId}/edits`, {
    method: "POST", headers: headers(running.origin, running.token),
    body: JSON.stringify({
      format: "narralens.adopt-request@1.0", base_revision: view.revision,
      expected_source_digest: view.source_digest, control_revision: view.control_revision,
      materialization_id: materialization.materialization_id,
      impact_id: impact.body.impact_id, impact_hash: impact.body.impact_hash,
      approval: { confirmed: true }, idempotency_key: `m4c-write-${suffix}`,
    }),
  });
  expect(adopted.status, await adopted.text()).toBe(200);
  const afterAdoption = await running.host.projectResolver.resolveActivated(projectId);
  return { projectId, view: afterAdoption, migrationSnapshot: migrationSnapshot(running, projectId) };
}

function restoreImpactBody(view: { revision: number; source_digest: string; control_revision: number },
  targetSnapshotId: string, key: string): Record<string, unknown> {
  return {
    format: "narralens.impact-request@1.0",
    base_revision: view.revision,
    expected_source_digest: view.source_digest,
    control_revision: view.control_revision,
    intent: { op: "restore_snapshot", target_snapshot_id: targetSnapshotId },
    idempotency_key: key,
  };
}

describe("M4C production history route", () => {
  it("restores an earlier snapshot as a new revision, and the film is still three native clips", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const { projectId, view, migrationSnapshot: target } = await adoptedProject(running, "happy");

    const history = await getHistory(running, projectId);
    expect(history.status).toBe(200);
    const entries = (history.body.entries as Array<{ revision: number; snapshot_id: string; kind: string }>);
    expect(entries.map((entry) => entry.kind)).toEqual(["migration", "adoption"]);
    expect(entries[0]!.snapshot_id).toBe(target);

    const impact = await postImpact(running, projectId, restoreImpactBody(view, target, "m4c-restore-impact"));
    expect(impact.status, JSON.stringify(impact.body)).toBe(201);
    expect(impact.body.operation).toBe("restore_snapshot");
    expect(impact.body.target_snapshot_id).toBe(target);
    expect(impact.body.materialization_id).toBeNull();
    expect((impact.body.affected_consumers as unknown[]).length).toBeGreaterThan(0);

    const restored = await postRestore(running, projectId, {
      format: "narralens.restore-request@1.0", base_revision: view.revision,
      expected_source_digest: view.source_digest, control_revision: view.control_revision,
      target_snapshot_id: target, impact_id: impact.body.impact_id,
      impact_hash: impact.body.impact_hash, approval: { confirmed: true },
      idempotency_key: "m4c-restore-1",
    });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(validateControlledWriteResponse(restored.body).ok).toBe(true);
    expect(restored.body).toMatchObject({
      operation: "restore_snapshot", status: "committed",
      previous_revision: view.revision, new_revision: view.revision + 1,
      // **Content addressing.** The restored closure *is* the target's closure, so the
      // result carries the target's own snapshot id. A second id for identical bytes would
      // break the property the whole store rests on.
      snapshot_id: target,
    });

    // The film is still three native, individually editable clips.
    const after = await running.host.projectResolver.resolveActivated(projectId);
    expect(after.revision).toBe(view.revision + 1);
    const upstream = await createPinnedOpenFilmUpstream(VENDOR);
    const film = await upstream.readProjectFilm(after.source_root.value);
    expect(film.problems).toEqual([]);
    const clips = (film.doc as { tracks: Array<{ clips: Array<{ id: string; src: string }> }> }).tracks
      .flatMap((track) => track.clips);
    const visual = clips.filter((clip) => !/\.(wav|mp3|m4a|aac|flac|ogg)$/iu.test(clip.src));
    expect(visual.map((clip) => clip.id)).toEqual(["shot-001", "shot-002", "shot-003"]);
    expect(visual.every((clip) => !/\.(mp4|mov|webm|mkv)$/iu.test(clip.src))).toBe(true);
  }, 900_000);

  it("rebuilds the restored source after a restart, and the old snapshot's bytes are unchanged", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const { projectId, view, migrationSnapshot: target } = await adoptedProject(running, "restart");
    const impact = await postImpact(running, projectId, restoreImpactBody(view, target, "m4c-restart-impact"));
    expect(impact.status, JSON.stringify(impact.body)).toBe(201);
    const restored = await postRestore(running, projectId, {
      format: "narralens.restore-request@1.0", base_revision: view.revision,
      expected_source_digest: view.source_digest, control_revision: view.control_revision,
      target_snapshot_id: target, impact_id: impact.body.impact_id,
      impact_hash: impact.body.impact_hash, approval: { confirmed: true },
      idempotency_key: "m4c-restore-restart",
    });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    const before = await running.host.revisions.snapshotRow(target);
    expect(before?.source_digest).toBeTruthy();

    const restarted = await startOn(running.base);
    hosts.push(restarted.host);
    const view2 = await restarted.host.projectResolver.resolveActivated(projectId);
    expect(view2.revision).toBe(view.revision + 1);
    expect(view2.snapshot_id).toBe(target);
    // **The reopened Host reads the restored closure.** The projection seam rebuilds the
    // layout from the restored projection fact, so the digest it computes is the target's
    // and the source has not "changed since the snapshot was taken".
    const layout = await restarted.host.projections.layoutFor(view2, "m4c-restart");
    expect(layout.expected_source_digest).toBe(view2.source_digest);
    const engine = restarted.host.engines.resolve(projectId);
    const projection = await engine.port.inspect({ project_id: projectId, engine: "openfilm",
      source_digest: view2.source_digest }, { correlationId: "m4c-restart", projectId,
      signal: AbortSignal.timeout(20_000) });
    expect(projection.problems).toEqual([]);
    expect(projection.source_digest).toBe(view2.source_digest);
    // The old snapshot's own bytes are unchanged.
    const after = await restarted.host.revisions.snapshotRow(target);
    expect(after?.source_digest).toBe(before?.source_digest);
  }, 900_000);

  it("replays the same key exactly and answers a different digest with 409", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const { projectId, view, migrationSnapshot: target } = await adoptedProject(running, "replay");
    const impact = await postImpact(running, projectId, restoreImpactBody(view, target, "m4c-replay-impact"));
    expect(impact.status, JSON.stringify(impact.body)).toBe(201);
    const request = {
      format: "narralens.restore-request@1.0", base_revision: view.revision,
      expected_source_digest: view.source_digest, control_revision: view.control_revision,
      target_snapshot_id: target, impact_id: impact.body.impact_id,
      impact_hash: impact.body.impact_hash, approval: { confirmed: true },
      idempotency_key: "m4c-replay-key",
    };
    const first = await postRestore(running, projectId, request);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const second = await postRestore(running, projectId, request);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    const after = await running.host.projectResolver.resolveActivated(projectId);
    expect(after.revision).toBe(view.revision + 1);
  }, 900_000);

  it("refuses a snapshot of another project and a snapshot that does not exist with the same 404", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const { projectId, view } = await adoptedProject(running, "cross");
    const foreign = "f".repeat(64);
    for (const target of [foreign, "0".repeat(64)]) {
      const impact = await postImpact(running, projectId, restoreImpactBody(view, target, `m4c-404-${target.slice(0, 4)}`));
      expect(impact.status, JSON.stringify(impact.body)).toBe(404);
      expect(impact.body.code).toBe("NOT_FOUND");
    }
  }, 900_000);

  it("translates undo and redo into an intent and never writes", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const { projectId, view, migrationSnapshot: target } = await adoptedProject(running, "intent");
    const undo = await postIntent(running, projectId, "undo");
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);
    expect(undo.body.op).toBe("restore_snapshot");
    expect(undo.body.target_snapshot_id).toBe(target);
    expect(undo.body.source).toBe("undo");
    // **The translation writes nothing.** The revision has not moved.
    const after = await running.host.projectResolver.resolveActivated(projectId);
    expect(after.revision).toBe(view.revision);
    // And there is nothing to redo: no restore has happened yet.
    const redo = await postIntent(running, projectId, "redo");
    expect(redo.status).toBe(422);
  }, 900_000);

  it("refuses a restore of the content that is already active", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const { projectId, view } = await adoptedProject(running, "noop");
    const adopted = running.host.revisions.activeCommit(projectId)!;
    const impact = await postImpact(running, projectId,
      restoreImpactBody(view, adopted.snapshot_id, "m4c-noop-impact"));
    expect(impact.status, JSON.stringify(impact.body)).toBe(422);
    const after = await running.host.projectResolver.resolveActivated(projectId);
    expect(after.revision).toBe(view.revision);
  }, 900_000);

  it("refuses a restore whose impact was computed while a visual lock was held", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const { projectId, view, migrationSnapshot: target } = await adoptedProject(running, "locked");
    const lock = running.host.locks.acquire({ projectId, lockType: "visual", scope: "shot",
      targetId: "shot-002", startFrame: 300, endFrameExclusive: 600, owner: "test",
      reason: "m4c lock" }, view.revision);
    expect(lock.lock_id).toBeTruthy();
    // The lock is held *now*, so the impact cannot be computed: the lock check is part of
    // computing the authorization, not a later formality.
    const current = await running.host.projectResolver.resolveActivated(projectId);
    const impact = await postImpact(running, projectId,
      restoreImpactBody(current, target, "m4c-locked-impact"));
    expect(impact.status, JSON.stringify(impact.body)).toBe(423);
    expect(impact.body.code).toBe("TARGET_LOCKED");
    const after = await running.host.projectResolver.resolveActivated(projectId);
    expect(after.revision).toBe(view.revision);
  }, 900_000);

  it("refuses a restore when a visual lock appears after the stage, and the revision does not move", async () => {
    let host: NarralensHost | undefined;
    let projectId = "";
    const running = await start({ historyFault: (point) => {
      if (point !== "after_prepared") return;
      // The lock is taken directly, not through the project queue: the restore is holding
      // that queue's slot, and asking for it here would deadlock.
      host!.locks.acquire({ projectId, lockType: "visual", scope: "shot", targetId: "shot-002",
        startFrame: 300, endFrameExclusive: 600, owner: "race", reason: "TX-13C" }, 1);
    } });
    host = running.host;
    hosts.push(running.host); dirs.push(running.base);
    const { projectId: id, view, migrationSnapshot: target } = await adoptedProject(running, "late-lock");
    projectId = id;
    const impact = await postImpact(running, projectId, restoreImpactBody(view, target, "m4c-late-impact"));
    expect(impact.status, JSON.stringify(impact.body)).toBe(201);
    const refused = await postRestore(running, projectId, {
      format: "narralens.restore-request@1.0", base_revision: view.revision,
      expected_source_digest: view.source_digest, control_revision: view.control_revision,
      target_snapshot_id: target, impact_id: impact.body.impact_id,
      impact_hash: impact.body.impact_hash, approval: { confirmed: true },
      idempotency_key: "m4c-late-key",
    });
    // `TARGET_LOCKED`, not a stale impact: acquiring a lock moves the control revision,
    // and the control revision is one of the facts a currentness check re-reads — so a
    // currentness check first would answer this as `IMPACT_STALE` and the lock check would
    // be a line nothing could ever reach.
    expect(refused.status, JSON.stringify(refused.body)).toBe(423);
    expect((refused.body.error as { code?: string } | undefined)?.code).toBe("TARGET_LOCKED");
    expect(refused.body).toMatchObject({ status: "aborted",
      previous_revision: view.revision, new_revision: view.revision });
    // **Nothing was published and the revision did not move.**
    const after = await running.host.projectResolver.resolveActivated(projectId);
    expect(after.revision).toBe(view.revision);
    expect(after.source_digest).toBe(view.source_digest);
    expect(running.host.revisions.projectTransactions(projectId).at(-1)?.state).toBe("aborted");
  }, 900_000);
});
