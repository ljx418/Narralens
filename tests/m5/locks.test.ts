import { afterEach, describe, expect, it } from "vitest";
import { authHeaders, migrate, start, startOn, stopAll, type Started } from "./harness.js";
import { NarralensHost } from "../../src/host/server.js";

/**
 * M5's lock API (Wave 3 `04` §4).
 *
 * Three properties carry the whole contract, and each is asserted with the *facts* and
 * not only with the status code:
 *
 * 1. **The CAS is strict.** A stale `base_control_revision` is refused and changes
 *    nothing: no lock row, no counter, no outbox row.
 * 2. **The owner is the installation, not the process.** The API publishes a fixed label
 *    and never the actor's UUID, and the UUID survives a restart.
 * 3. **A lock means something.** A shot lock names a clip of the *current* projection and
 *    stays inside it; a project lock covers the whole film.
 */
const hosts: NarralensHost[] = [];
const dirs: string[] = [];

afterEach(async () => { await stopAll(hosts.splice(0), dirs.splice(0)); });

async function migrated(key = "m5-locks-1"): Promise<{ running: Started; projectId: string }> {
  const running = await start();
  hosts.push(running.host);
  dirs.push(running.base);
  const target = await migrate(running, key);
  return { running, projectId: target.projectId };
}

async function facts(running: Started, projectId: string): Promise<{
  control_revision: number; frame_count: number;
}> {
  const view = await running.host.projectResolver.resolveActivated(projectId);
  return { control_revision: view.control_revision, frame_count: view.frame_count };
}

async function createLock(running: Started, projectId: string, body: unknown): Promise<{
  status: number; body: Record<string, unknown>;
}> {
  const response = await fetch(`${running.origin}/api/migration/v1/projects/${projectId}/locks`,
    { method: "POST", headers: authHeaders(running.origin, running.token), body: JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown> };
}

async function releaseLock(running: Started, projectId: string, lockId: string,
  query: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(
    `${running.origin}/api/migration/v1/projects/${projectId}/locks/${lockId}?${query}`,
    { method: "DELETE", headers: authHeaders(running.origin, running.token) },
  );
  const text = await response.text();
  return { status: response.status, body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown> };
}

describe("M5 locks: the strict control-revision CAS", () => {
  it("creates a lock, moves the control revision and writes exactly one lock.changed row", async () => {
    const { running, projectId } = await migrated();
    const before = await facts(running, projectId);
    const outboxBefore = running.host.revisions.outboxRowCount("lock.changed");

    const response = await createLock(running, projectId, {
      format: "narralens.lock-request@1.0",
      base_control_revision: before.control_revision,
      lock_type: "visual", scope: "project", target_id: null,
      start_frame: 0, end_frame_exclusive: before.frame_count,
      reason_code: "preserve_visual", idempotency_key: "m5-lock-create-1",
    });
    expect(response.status).toBe(200);
    const body = response.body as {
      format: string; project_id: string; active: boolean; control_revision: number;
      lock: { lock_id: string; owner_label: string; reason_code: string; scope: string; target_id: string | null };
    };
    expect(body.format).toBe("narralens.lock-mutation-response@1.0");
    expect(body.project_id).toBe(projectId);
    expect(body.active).toBe(true);
    expect(body.control_revision).toBe(before.control_revision + 1);
    // The owner is a fixed local label, and the actor's UUID is not published.
    expect(body.lock.owner_label).toBe("本机操作者");
    expect(body.lock.reason_code).toBe("preserve_visual");
    expect(body.lock.scope).toBe("project");
    expect(body.lock.target_id).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u);

    // The facts moved: the counter, the lock row and the outbox row.
    const after = await facts(running, projectId);
    expect(after.control_revision).toBe(before.control_revision + 1);
    expect(running.host.revisions.activeLocks(projectId)).toHaveLength(1);
    expect(running.host.revisions.outboxRowCount("lock.changed")).toBe(outboxBefore + 1);
  }, 300_000);

  it("refuses a stale base control revision and changes nothing at all", async () => {
    const { running, projectId } = await migrated();
    const before = await facts(running, projectId);
    const outboxBefore = running.host.revisions.outboxRowCount("lock.changed");

    // Move the control revision with a first lock, then try a second one at the old base.
    const first = await createLock(running, projectId, {
      format: "narralens.lock-request@1.0",
      base_control_revision: before.control_revision,
      lock_type: "visual", scope: "project", target_id: null,
      start_frame: 0, end_frame_exclusive: before.frame_count,
      reason_code: "preserve_visual", idempotency_key: "m5-lock-first-1",
    });
    expect(first.status).toBe(200);
    const outboxAfterFirst = running.host.revisions.outboxRowCount("lock.changed");

    const stale = await createLock(running, projectId, {
      format: "narralens.lock-request@1.0",
      base_control_revision: before.control_revision,
      lock_type: "narration", scope: "project", target_id: null,
      start_frame: 0, end_frame_exclusive: before.frame_count,
      reason_code: "preserve_narration", idempotency_key: "m5-lock-stale-1",
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("REVISION_CONFLICT");

    // Zero change: no second lock, no second counter move, no second outbox row.
    expect(running.host.revisions.activeLocks(projectId)).toHaveLength(1);
    expect((await facts(running, projectId)).control_revision).toBe(before.control_revision + 1);
    expect(running.host.revisions.outboxRowCount("lock.changed")).toBe(outboxAfterFirst);
    expect(outboxAfterFirst).toBe(outboxBefore + 1);
  }, 300_000);

  it("replays the same response for the same key and refuses a different body under it", async () => {
    const { running, projectId } = await migrated();
    const before = await facts(running, projectId);
    const body = {
      format: "narralens.lock-request@1.0",
      base_control_revision: before.control_revision,
      lock_type: "duration", scope: "project", target_id: null,
      start_frame: 0, end_frame_exclusive: before.frame_count,
      reason_code: "preserve_duration", idempotency_key: "m5-lock-replay-1",
    };
    const first = await createLock(running, projectId, body);
    expect(first.status).toBe(200);
    const again = await createLock(running, projectId, body);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    // One lock, one counter move, one outbox row: the replay wrote nothing.
    expect(running.host.revisions.activeLocks(projectId)).toHaveLength(1);
    expect((await facts(running, projectId)).control_revision).toBe(before.control_revision + 1);

    const different = await createLock(running, projectId, { ...body, reason_code: "user_review" });
    expect(different.status).toBe(409);
    expect(different.body.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(running.host.revisions.activeLocks(projectId)).toHaveLength(1);
  }, 300_000);

  it("refuses a request that names an owner, a type outside the set, or an extra field", async () => {
    const { running, projectId } = await migrated();
    const before = await facts(running, projectId);
    const base = {
      format: "narralens.lock-request@1.0",
      base_control_revision: before.control_revision,
      lock_type: "visual", scope: "project", target_id: null,
      start_frame: 0, end_frame_exclusive: before.frame_count,
      reason_code: "preserve_visual", idempotency_key: "m5-lock-shape-1",
    };
    for (const body of [
      { ...base, owner: "someone" },
      { ...base, lock_type: "audio" },
      { ...base, reason_code: "because" },
      { ...base, extra: 1 },
    ]) {
      const response = await createLock(running, projectId, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.code).toBe("INVALID_REQUEST");
    }
    expect(running.host.revisions.activeLocks(projectId)).toHaveLength(0);
  }, 300_000);

  it("refuses a shot lock that names no clip, a clip that does not exist, or a range outside it", async () => {
    const { running, projectId } = await migrated();
    const before = await facts(running, projectId);
    const base = {
      format: "narralens.lock-request@1.0",
      base_control_revision: before.control_revision,
      lock_type: "visual", scope: "shot",
      reason_code: "preserve_visual", idempotency_key: "m5-lock-shot-1",
    };
    // No clip named: the *contract* refuses the shape, so it is an invalid request.
    const noTarget = await createLock(running, projectId, { ...base, target_id: null, start_frame: 0, end_frame_exclusive: 300 });
    expect(noTarget.status).toBe(400);
    expect(noTarget.body.code).toBe("INVALID_REQUEST");
    // A clip that is not in the current projection: the shape is fine, the fact is not.
    const unknown = await createLock(running, projectId, { ...base, target_id: "shot-404", start_frame: 0, end_frame_exclusive: 300 });
    expect(unknown.status).toBe(422);
    // A range that leaves the clip it names.
    const outside = await createLock(running, projectId, { ...base, target_id: "shot-001", start_frame: 0, end_frame_exclusive: 900 });
    expect(outside.status).toBe(422);
    expect(outside.body.code).toBe("INVALID_RANGE");
    expect(running.host.revisions.activeLocks(projectId)).toHaveLength(0);

    // The honest one: a shot lock inside the clip it names.
    const good = await createLock(running, projectId,
      { ...base, idempotency_key: "m5-lock-shot-2", target_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 });
    expect(good.status).toBe(200);
    expect((good.body as { lock: { target_id: string } }).lock.target_id).toBe("shot-001");
  }, 300_000);

  it("refuses a project lock that does not cover the whole film", async () => {
    const { running, projectId } = await migrated();
    const before = await facts(running, projectId);
    const response = await createLock(running, projectId, {
      format: "narralens.lock-request@1.0",
      base_control_revision: before.control_revision,
      lock_type: "visual", scope: "project", target_id: null,
      start_frame: 0, end_frame_exclusive: 300,
      reason_code: "preserve_visual", idempotency_key: "m5-lock-partial-1",
    });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe("INVALID_RANGE");
  }, 300_000);

  it("answers 404 for a lock id that belongs to another project, and releases its own", async () => {
    const { running, projectId } = await migrated();
    const before = await facts(running, projectId);
    const created = await createLock(running, projectId, {
      format: "narralens.lock-request@1.0",
      base_control_revision: before.control_revision,
      lock_type: "visual", scope: "project", target_id: null,
      start_frame: 0, end_frame_exclusive: before.frame_count,
      reason_code: "preserve_visual", idempotency_key: "m5-lock-release-1",
    });
    const lockId = (created.body as { lock: { lock_id: string } }).lock.lock_id;

    // Another project: the id is not found there, and nothing is released. The other
    // project is the legacy source, which is a real project id and not this lock's.
    const cross = await releaseLock(running, "d1-30s", lockId,
      `base_control_revision=${before.control_revision}&idempotency_key=m5-lock-cross-1`);
    expect(cross.status).toBe(404);
    expect(running.host.revisions.activeLocks(projectId)).toHaveLength(1);

    // Its own project: released, and the counter moved.
    const released = await releaseLock(running, projectId, lockId,
      `base_control_revision=${before.control_revision + 1}&idempotency_key=m5-lock-release-2`);
    expect(released.status).toBe(200);
    expect((released.body as { active: boolean }).active).toBe(false);
    expect(running.host.revisions.activeLocks(projectId)).toHaveLength(0);
    expect((await facts(running, projectId)).control_revision).toBe(before.control_revision + 2);

    // Releasing again is a conflict, not a second release.
    const again = await releaseLock(running, projectId, lockId,
      `base_control_revision=${before.control_revision + 2}&idempotency_key=m5-lock-release-3`);
    expect(again.status).toBe(409);
  }, 300_000);

  it("keeps the installation's actor identity across a restart, and never publishes it", async () => {
    const { running, projectId } = await migrated();
    const before = await facts(running, projectId);
    const actor = running.host.revisions.hostIdentity();
    expect(actor).toMatch(/^[0-9a-f-]{36}$/u);

    const created = await createLock(running, projectId, {
      format: "narralens.lock-request@1.0",
      base_control_revision: before.control_revision,
      lock_type: "visual", scope: "project", target_id: null,
      start_frame: 0, end_frame_exclusive: before.frame_count,
      reason_code: "preserve_visual", idempotency_key: "m5-lock-actor-1",
    });
    expect(JSON.stringify(created.body)).not.toContain(actor);

    // A restart over the same working directory: the identity is the installation's, not
    // the process's.
    const base = running.base;
    await running.host.close();
    hosts.splice(hosts.indexOf(running.host), 1);
    const restarted = await startOn(base);
    hosts.push(restarted.host);
    expect(restarted.host.revisions.hostIdentity()).toBe(actor);
  }, 300_000);
});
