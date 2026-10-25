import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NarralensHost } from "../../../src/host/server.js";
import { planDigest } from "../../../src/host/materialize/native-plan-builder.js";
import type { NativePlanV1 } from "../../../src/contracts/wave2-types.js";
import { adoptBody, coveringPlan, headers, migrate, postImpact, readyMaterialization,
  start, startOn, stopAll, type Started } from "../m4a/harness.js";

/**
 * The M4C test harness.
 *
 * Everything here is real: a real Host, a real migration of the real fixture through the
 * Host's own route, a real controlled adoption against the pinned OpenFilm checkout, and a
 * real restore. Nothing is mocked except the proxy encode, which the M4A harness already
 * documents as the one thing it stands in for.
 *
 * The helpers are shared by the M4C suites so that the "real chain" is built the same way
 * everywhere: migrate → adopt → restore. A suite that built its own chain would be testing
 * a slightly different project, and a difference nobody could see.
 */

export interface AdoptedProject {
  readonly projectId: string;
  readonly view: Awaited<ReturnType<typeof migrate>>["view"];
  /** The snapshot the migration published — the project's history entry zero. */
  readonly migrationSnapshot: string;
  /** The snapshot the adoption produced — the project's history entry one. */
  readonly adoptedSnapshot: string;
}

export { headers, migrate, postImpact, readyMaterialization, start, startOn, stopAll };
export type { Started };

/** The three-clip plan M4B's own tests use, so the two stages are comparable. */
export function stableThreeClipPlan(running: Started, projectId: string): NativePlanV1 {
  const base = coveringPlan(running.host, projectId, 900, 3);
  const spec = { ...base, clips: base.clips.map((clip, index) => ({ ...clip, clip_id: `shot-00${index + 1}` })) };
  const { plan_sha256: _old, ...preimage } = spec;
  return { ...preimage, plan_sha256: planDigest(preimage) };
}

/** The snapshot a migration published, read from the durable record. */
export function migrationSnapshot(running: Started, projectId: string): string {
  for (const migration of running.host.revisions.migrations.all()) {
    if (migration.target_project_id !== projectId) continue;
    if (migration.target_snapshot_id === null) continue;
    return migration.target_snapshot_id;
  }
  throw new Error(`NO_MIGRATION_SNAPSHOT:${projectId}`);
}

/** Migrate and adopt, so the project has a history to restore into. */
export async function adoptedProject(running: Started, suffix: string): Promise<AdoptedProject> {
  const { projectId, view } = await migrate(running, `m4c-migrate-${suffix}`);
  const materialization = await readyMaterialization(running.host, projectId, `m4c-materialize-${suffix}`,
    stableThreeClipPlan(running, projectId));
  const impact = await postImpact(running, projectId,
    adoptBody(view, materialization.materialization_id, `m4c-impact-${suffix}`));
  if (impact.status !== 201) {
    throw new Error(`ADOPT_IMPACT_${impact.status}:${JSON.stringify(impact.body)}`);
  }
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
  if (adopted.status !== 200) {
    throw new Error(`ADOPT_${adopted.status}:${(await adopted.text()).slice(0, 300)}`);
  }
  const after = await running.host.projectResolver.resolveActivated(projectId);
  return { projectId, view: after, migrationSnapshot: migrationSnapshot(running, projectId),
    adoptedSnapshot: after.snapshot_id };
}

/** The body a client builds from the project's own facts — never anything it computed. */
export function restoreImpactBody(view: { revision: number; source_digest: string;
  control_revision: number }, targetSnapshotId: string, key: string): Record<string, unknown> {
  return {
    format: "narralens.impact-request@1.0",
    base_revision: view.revision,
    expected_source_digest: view.source_digest,
    control_revision: view.control_revision,
    intent: { op: "restore_snapshot", target_snapshot_id: targetSnapshotId },
    idempotency_key: key,
  };
}

/** The restore request a client builds from the impact it was given. */
export function restoreRequestBody(view: { revision: number; source_digest: string;
  control_revision: number }, targetSnapshotId: string, impact: { impact_id: string;
  impact_hash: string }, key: string): Record<string, unknown> {
  return {
    format: "narralens.restore-request@1.0",
    base_revision: view.revision,
    expected_source_digest: view.source_digest,
    control_revision: view.control_revision,
    target_snapshot_id: targetSnapshotId,
    impact_id: impact.impact_id,
    impact_hash: impact.impact_hash,
    approval: { confirmed: true },
    idempotency_key: key,
  };
}

/**
 * Is this body the Host's *recoverable* resource failure?
 *
 * The Host maps ENOMEM and its siblings to `HOST_RESOURCE_EXHAUSTED` with
 * `recoverable: true` precisely so that a transient machine condition is not reported as a
 * behavioural failure. This box runs several sessions at once and has run out of memory
 * during a capture more than once.
 */
function isRecoverableResourceFailure(body: Record<string, unknown>): boolean {
  const error = body.error as { code?: string; details?: { recoverable?: boolean } } | undefined;
  const code = String(body.code ?? error?.code ?? "");
  const details = (body.details ?? error?.details) as { recoverable?: boolean } | undefined;
  return code === "HOST_RESOURCE_EXHAUSTED" && details?.recoverable !== false;
}

export async function postRestore(running: Started, projectId: string, body: unknown,
  signal?: AbortSignal): Promise<{
  status: number; body: Record<string, unknown>;
}> {
  // A recoverable resource failure is retried. The retry reuses the same idempotency key,
  // so it is a replay rather than a second restore — which is exactly what the key is for.
  // An assertion about behaviour is never relaxed: if the second attempt fails for any
  // reason, the failure stands.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${running.origin}/api/migration/v1/projects/${projectId}/history/restore`, {
      method: "POST", headers: headers(running.origin, running.token), body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    });
    const text = await response.text();
    const parsed = text === "" ? {} : JSON.parse(text) as Record<string, unknown>;
    if (!isRecoverableResourceFailure(parsed) || attempt === 2) {
      return { status: response.status, body: parsed };
    }
    await new Promise((done) => setTimeout(done, 500 * (attempt + 1)));
  }
  throw new Error("UNREACHABLE");
}

export async function getHistory(running: Started, projectId: string): Promise<{
  status: number; body: Record<string, unknown>;
}> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${running.origin}/api/migration/v1/projects/${projectId}/history`, {
      headers: headers(running.origin, running.token),
    });
    const body = await response.json() as Record<string, unknown>;
    if (!isRecoverableResourceFailure(body) || attempt === 2) return { status: response.status, body };
    await new Promise((done) => setTimeout(done, 500 * (attempt + 1)));
  }
  throw new Error("UNREACHABLE");
}

export async function postIntent(running: Started, projectId: string,
  command: "undo" | "redo"): Promise<{ status: number; body: Record<string, unknown> }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${running.origin}/api/migration/v1/projects/${projectId}/history/${command}`, {
      method: "POST", headers: headers(running.origin, running.token), body: "{}",
    });
    const text = await response.text();
    const parsed = text === "" ? {} : JSON.parse(text) as Record<string, unknown>;
    if (!isRecoverableResourceFailure(parsed) || attempt === 2) return { status: response.status, body: parsed };
    await new Promise((done) => setTimeout(done, 500 * (attempt + 1)));
  }
  throw new Error("UNREACHABLE");
}

/** A temporary directory a test may use for its own scratch files. */
export async function scratchDirectory(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "narralens-m4c-"));
}

export async function removeDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}

export { NarralensHost };
