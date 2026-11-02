import type { HeadlessEnvironment } from "./environment.js";
import { writeEvidence } from "./environment.js";

/**
 * The write paths, before and after (Wave 3 `02` §3, `04` §8).
 *
 * The evidence for a write is not its status code. It is the *facts*: the source digest,
 * the revision, the active commit, the snapshot, the impact rows, the idempotency rows,
 * the outbox rows and the locks — before and after, for the writes that happen and for
 * the ones that must not.
 *
 * This file records that difference against a real migrated target, through the Host's
 * own routes, and writes it where a reader can check it.
 */
export interface WritePathFacts {
  readonly source_digest: string;
  readonly revision: number;
  readonly control_revision: number;
  readonly snapshot_id: string;
  readonly commit_transaction: string;
  readonly impact_rows: number;
  readonly outbox_rows: number;
  readonly lock_rows: number;
  readonly ledger_assets: number;
}

export interface WritePathDiff {
  readonly name: string;
  readonly before: WritePathFacts;
  readonly after: WritePathFacts;
  readonly changed: readonly string[];
  readonly unchanged: readonly string[];
}

async function facts(env: HeadlessEnvironment): Promise<WritePathFacts> {
  const view = await env.host.projectResolver.resolveActivated(env.projectId);
  const commit = env.host.revisions.activeCommit(env.projectId);
  return {
    source_digest: view.source_digest,
    revision: view.revision,
    control_revision: view.control_revision,
    snapshot_id: view.snapshot_id,
    commit_transaction: commit?.transaction_id ?? "",
    impact_rows: env.host.impacts.byProject(env.projectId).length,
    outbox_rows: env.host.revisions.outboxRowCount(),
    lock_rows: env.host.revisions.activeLocks(env.projectId).length,
    ledger_assets: env.host.assetLedger.assets(env.projectId).length,
  };
}

function diffOf(name: string, before: WritePathFacts, after: WritePathFacts): WritePathDiff {
  const keys = Object.keys(before) as Array<keyof WritePathFacts>;
  const changed = keys.filter((key) => before[key] !== after[key]);
  const unchanged = keys.filter((key) => before[key] === after[key]);
  return { name, before, after, changed, unchanged };
}

/**
 * Record the write-path differences.
 *
 * It runs on its own Host: the point is to measure each write against the state it
 * started from, and a write that shares a Host with another write does not.
 */
export async function recordWritePaths(env: HeadlessEnvironment, root: string): Promise<WritePathDiff[]> {
  const headers = {
    origin: env.origin, authorization: `Bearer ${env.token}`, "content-type": "application/json",
  };
  const diffs: WritePathDiff[] = [];

  // 1. A read: the workbench changes nothing at all.
  const beforeRead = await facts(env);
  await fetch(`${env.origin}/api/migration/v1/projects/${env.projectId}/workbench`, { headers });
  diffs.push(diffOf("read:workbench", beforeRead, await facts(env)));

  // 2. A replay: a new comparison, and nothing else.
  const beforeReplay = await facts(env);
  await fetch(`${env.origin}/api/migration/v1/projects/${env.projectId}/comparisons/replay`, {
    method: "POST", headers,
    body: JSON.stringify({
      format: "narralens.comparison-replay-request@1.0",
      source_comparison_id: env.sourceComparisonId,
      base_revision: 1, idempotency_key: "m5-write-path-replay-1",
    }),
  });
  diffs.push(diffOf("write:comparison-replay", beforeReplay, await facts(env)));

  // 3. A lock: the lock row, the counter and the outbox row move; nothing else does.
  const beforeLock = await facts(env);
  const created = await fetch(`${env.origin}/api/migration/v1/projects/${env.projectId}/locks`, {
    method: "POST", headers,
    body: JSON.stringify({
      format: "narralens.lock-request@1.0", base_control_revision: beforeLock.control_revision,
      lock_type: "visual", scope: "project", target_id: null,
      start_frame: 0, end_frame_exclusive: beforeLock.revision === 0 ? 0 : 900,
      reason_code: "preserve_visual", idempotency_key: "m5-write-path-lock-1",
    }),
  });
  const createdBody = await created.json() as { lock?: { lock_id?: string } };
  diffs.push(diffOf("write:lock.create", beforeLock, await facts(env)));

  // 4. A stale CAS: nothing changes at all.
  const beforeStale = await facts(env);
  await fetch(`${env.origin}/api/migration/v1/projects/${env.projectId}/locks`, {
    method: "POST", headers,
    body: JSON.stringify({
      format: "narralens.lock-request@1.0", base_control_revision: beforeStale.control_revision - 1,
      lock_type: "narration", scope: "project", target_id: null,
      start_frame: 0, end_frame_exclusive: 900,
      reason_code: "preserve_narration", idempotency_key: "m5-write-path-lock-stale-1",
    }),
  });
  diffs.push(diffOf("write:lock.create(stale-cas)", beforeStale, await facts(env)));

  // 5. The release: the lock row goes, the counter and the outbox row move.
  const beforeRelease = await facts(env);
  const lockId = createdBody.lock?.lock_id;
  if (lockId !== undefined) {
    await fetch(`${env.origin}/api/migration/v1/projects/${env.projectId}/locks/${lockId}`
      + `?base_control_revision=${beforeRelease.control_revision}&idempotency_key=m5-write-path-release-1`,
    { method: "DELETE", headers });
  }
  diffs.push(diffOf("write:lock.release", beforeRelease, await facts(env)));

  await writeEvidence(root, "write-paths/diffs.json", `${JSON.stringify({
    captured_at: new Date().toISOString(),
    target_project_id: env.projectId,
    note: "每一行都是同一组事实的前后差；changed 是动了的，unchanged 是不该动的。",
    diffs,
  }, null, 2)}\n`);
  return diffs;
}
