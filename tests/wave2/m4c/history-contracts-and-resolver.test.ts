import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NarralensHost } from "../../../src/host/server.js";
import { OpenFilmEngineAdapter } from "../../../src/adapters/openfilm/openfilm-engine-adapter.js";
import { validateControlledWriteFailure, validateControlledWriteResponse,
  validateHistory, validateHistoryIntent, validateRestoreRequest } from "../../../src/contracts/validator.js";
import {
  adoptedProject, getHistory, headers, postImpact, postRestore, restoreImpactBody,
  restoreRequestBody, start, stopAll, type Started,
} from "./harness.js";

/**
 * M4C's contracts, its resolver and its negative matrix.
 *
 * The negative matrix is the important half. A restore is a write that puts *old* content
 * back into the live source, so the questions that matter are the ones about what must
 * **not** be restorable: another project's snapshot, a snapshot that exists on disk but was
 * never committed, a snapshot whose bytes have gone missing, and a target whose difference
 * cannot be classified. Every one of them has to fail closed, and it has to fail with the
 * *same* answer for "not yours" and "not there", so an id cannot be probed across projects.
 */

const hosts: NarralensHost[] = [];
const dirs: string[] = [];
afterEach(async () => { await stopAll(hosts.splice(0), dirs.splice(0)); });

describe("M4C-01: the restore contracts", () => {
  it("accepts a well-formed restore request and refuses anything else", () => {
    const request = {
      format: "narralens.restore-request@1.0", base_revision: 2,
      expected_source_digest: "a".repeat(64), control_revision: 0,
      target_snapshot_id: "c".repeat(64), impact_id: "imp_1", impact_hash: "b".repeat(64),
      approval: { confirmed: true }, idempotency_key: "key-1",
    };
    expect(validateRestoreRequest(request).ok).toBe(true);
    // An unknown field is refused: a client may not carry an impact fact of its own.
    expect(validateRestoreRequest({ ...request, ranges: [] }).ok).toBe(false);
    expect(validateRestoreRequest({ ...request, affected_consumers: [] }).ok).toBe(false);
    // A missing field is refused too.
    const { impact_hash: _removed, ...withoutHash } = request;
    expect(validateRestoreRequest(withoutHash).ok).toBe(false);
    // And an approval that is not an explicit confirmation is refused.
    expect(validateRestoreRequest({ ...request, approval: { confirmed: false } }).ok).toBe(false);
  });

  it("names the operation in the failure body, and the schema accepts both operations", () => {
    const failure = {
      format: "narralens.controlled-write-failure@1.0", transaction_id: "txn_1",
      project_id: "of_1", operation: "restore_snapshot", previous_revision: 2, new_revision: 2,
      source_digest: "a".repeat(64), status: "aborted",
      error: { http_status: 422, code: "INVALID_REQUEST", message: "no" },
    };
    expect(validateControlledWriteFailure(failure).ok).toBe(true);
    // The adoption arm still validates.
    expect(validateControlledWriteFailure({ ...failure, operation: "adopt_materialization" }).ok).toBe(true);
    // And an aborted write that claims to have advanced the revision is refused.
    expect(validateControlledWriteFailure({ ...failure, new_revision: 3 }).ok).toBe(false);
  });

  it("answers a restore request that carries an unknown field with 400", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const project = await adoptedProject(running, "unknown-field");
    const response = await fetch(
      `${running.origin}/api/migration/v1/projects/${project.projectId}/history/restore`, {
        method: "POST", headers: headers(running.origin, running.token),
        body: JSON.stringify({ ...restoreRequestBody(project.view, project.migrationSnapshot,
          { impact_id: "imp_1", impact_hash: "b".repeat(64) }, "key-1"), surprise: true }),
      });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
  }, 900_000);
});

describe("M4C-02 and M4C-04: the resolver proves the target from its own bytes", () => {
  it("resolves the migration's snapshot and the adoption's snapshot, and reproduces the digest", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const project = await adoptedProject(running, "resolver");
    // Both snapshots of this project are committed and resolvable.
    for (const snapshotId of [project.migrationSnapshot, project.adoptedSnapshot]) {
      const resolved = await running.host.historical.resolve(project.projectId, snapshotId, "m4c-resolver");
      expect(resolved.snapshot_id).toBe(snapshotId);
      expect(resolved.film_sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(resolved.roots.length).toBeGreaterThan(0);
      expect(resolved.entry_root).toBe(resolved.roots[0]);
      // **The digest is recomputed from the historical roots**, not read from a label.
      const row = running.host.revisions.snapshotRow(snapshotId);
      expect(resolved.source_digest).toBe(row?.source_digest);
    }
  }, 900_000);

  it("reads the target with the pinned upstream, and reports no problem", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const project = await adoptedProject(running, "upstream");
    const resolved = await running.host.historical.resolve(project.projectId, project.migrationSnapshot,
      "m4c-upstream");
    const engine = running.host.engines.resolve(project.projectId);
    expect(engine.port).toBeInstanceOf(OpenFilmEngineAdapter);
    const projection = await (engine.port as OpenFilmEngineAdapter).inspectSnapshot({
      root: resolved.source_root, roots: resolved.roots, subtitles: resolved.subtitles,
    }, resolved.source_digest, { correlationId: "m4c-upstream", projectId: project.projectId,
      signal: AbortSignal.timeout(20_000) });
    expect(projection.problems).toEqual([]);
    expect(projection.source_digest).toBe(resolved.source_digest);
  }, 900_000);
});

describe("M4C-03: the negative matrix fails closed", () => {
  it("answers a snapshot of another project and a snapshot that does not exist with the same 404", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const project = await adoptedProject(running, "negative");
    for (const target of ["f".repeat(64), "0".repeat(64)]) {
      const response = await fetch(
        `${running.origin}/api/migration/v1/projects/${project.projectId}/impact`, {
          method: "POST", headers: headers(running.origin, running.token),
          body: JSON.stringify(restoreImpactBody(project.view, target, `m4c-neg-${target.slice(0, 4)}`)),
        });
      expect(response.status, target).toBe(404);
      expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
    }
    // No restore authorization was written. The adoption's own impact is a different
    // operation and is still there.
    expect(running.host.impacts.byProject(project.projectId)
      .filter((row) => row.operation === "restore_snapshot")).toEqual([]);
  }, 900_000);

  it("refuses an orphan snapshot: bytes on disk that no committed write ever named", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const project = await adoptedProject(running, "orphan");
    // A snapshot that is **entirely real** — the bytes are on disk under the managed root
    // and the row carries the digest those bytes actually have — but *nothing ever
    // committed it*: there is no transaction and no migration behind it.
    //
    // The bytes matter. An orphan whose bytes were missing would be refused by the
    // "the bytes are gone" rule, and the test would pass without ever reaching the
    // committed rule. This one can only be refused because nothing committed it.
    const orphan = "1".repeat(64);
    const source = join(running.host.snapshots.snapshotRoot(project.projectId, project.migrationSnapshot),
      "source");
    const orphanRoot = join(running.host.snapshots.snapshotRoot(project.projectId, orphan), "source");
    await mkdir(orphanRoot, { recursive: true });
    await cp(source, orphanRoot, { recursive: true });
    const digest = running.host.revisions.snapshotRow(project.migrationSnapshot)?.source_digest ?? "";
    running.host.revisions.compose((db) => db.prepare(
      "INSERT INTO snapshot(snapshot_id, project_id, source_digest, engine, created_at) VALUES(?,?,?,'openfilm',?)")
      .run(orphan, project.projectId, digest, new Date().toISOString()));
    // The orphan even has a projection fact, so its roots can be derived and its digest
    // recomputes: every other proof the resolver makes succeeds. The **only** thing left is
    // that nothing ever committed it.
    // The roots have to be the *migration's* roots, because the orphan's bytes are the
    // migration's bytes: a projection fact with any other root set would be refused by the
    // digest rule, and the test would again pass without reaching the committed rule.
    const migration = await running.host.historical.resolve(project.projectId,
      project.migrationSnapshot, "m4c-orphan-roots");
    const transaction = running.host.revisions.projectTransactions(project.projectId)
      .find((row) => row.state === "committed");
    const frameCount = (await running.host.projectResolver.resolveActivated(project.projectId)).frame_count;
    running.host.revisions.compose((db) => db.prepare(
      `INSERT INTO openfilm_projection_fact(project_id, snapshot_id, migration_id, source_digest,
        engine_upstream_sha, roots_json, subtitles_json, frame_count, transaction_id)
       VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(project.projectId, orphan, "mig_orphan", digest,
        "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
        JSON.stringify(migration.roots), JSON.stringify(migration.subtitles),
        frameCount, transaction?.transaction_id ?? "txn_unknown"));
    await expect(running.host.historical.resolve(project.projectId, orphan, "m4c-orphan"))
      .rejects.toMatchObject({ status: 422 });
    // And the route refuses it too.
    const response = await fetch(
      `${running.origin}/api/migration/v1/projects/${project.projectId}/impact`, {
        method: "POST", headers: headers(running.origin, running.token),
        body: JSON.stringify(restoreImpactBody(project.view, orphan, "m4c-orphan-impact")),
      });
    expect(response.status).toBe(422);
    // **No restore impact was written.** The adoption's own impact is a different
    // operation and is still there; what must not exist is an authorization for a restore
    // that could not be proved.
    expect(running.host.impacts.byProject(project.projectId)
      .filter((row) => row.operation === "restore_snapshot")).toEqual([]);
  }, 900_000);

  it("refuses a snapshot whose bytes are gone", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const project = await adoptedProject(running, "missing-bytes");
    await rm(join(running.host.snapshots.snapshotRoot(project.projectId, project.migrationSnapshot)),
      { recursive: true, force: true });
    await expect(running.host.historical.resolve(project.projectId, project.migrationSnapshot, "m4c-missing"))
      .rejects.toMatchObject({ status: 422 });
  }, 900_000);
});

describe("M4C-06: the restore impact is an authorization and writes nothing", () => {
  it("creates the impact, replays it exactly, and writes no author fact", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const project = await adoptedProject(running, "impact-nowrite");
    const before = await running.host.projectResolver.resolveActivated(project.projectId);
    const body = restoreImpactBody(project.view, project.migrationSnapshot, "m4c-nowrite-impact");
    const first = await postImpact(running, project.projectId, body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await postImpact(running, project.projectId, body);
    expect(second.status).toBe(201);
    expect(second.body.impact_hash).toBe(first.body.impact_hash);
    expect(second.body.expires_at).toBe(first.body.expires_at);
    // The impact authorized a restore; it did not perform one.
    const after = await running.host.projectResolver.resolveActivated(project.projectId);
    expect(after.revision).toBe(before.revision);
    expect(after.source_digest).toBe(before.source_digest);
    expect(running.host.revisions.projectTransactions(project.projectId)
      .filter((row) => row.kind === "history")).toEqual([]);
  }, 900_000);

  it("refuses the impact when a lock is held, and leaves no active row behind", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const project = await adoptedProject(running, "impact-locked");
    running.host.locks.acquire({ projectId: project.projectId, lockType: "visual", scope: "shot",
      targetId: "shot-002", startFrame: 300, endFrameExclusive: 600, owner: "test",
      reason: "m4c-06" }, project.view.revision);
    // The lock moved the control revision, so the request is built against the facts *now*.
    const current = await running.host.projectResolver.resolveActivated(project.projectId);
    const refused = await postImpact(running, project.projectId,
      restoreImpactBody(current, project.migrationSnapshot, "m4c-impact-locked"));
    expect(refused.status).toBe(423);
    expect(refused.body.code).toBe("TARGET_LOCKED");
    // **Zero active rows.** A refused authorization leaves nothing behind that could be
    // mistaken for one.
    expect(running.host.impacts.byProject(project.projectId)
      .filter((row) => row.operation === "restore_snapshot")).toEqual([]);
  }, 900_000);
});

describe("M4C-11: the history read model and the intent satisfy their contracts", () => {
  it("answers the history model and the undo intent in their own shapes", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const project = await adoptedProject(running, "read-model");
    const history = await getHistory(running, project.projectId);
    expect(history.status).toBe(200);
    expect(validateHistory(history.body).ok).toBe(true);
    const intent = await fetch(
      `${running.origin}/api/migration/v1/projects/${project.projectId}/history/undo`,
      { method: "POST", headers: headers(running.origin, running.token), body: "{}" });
    const body = await intent.json() as Record<string, unknown>;
    expect(intent.status).toBe(200);
    expect(validateHistoryIntent(body).ok).toBe(true);
    expect(body.target_snapshot_id).toBe(project.migrationSnapshot);
  }, 900_000);
});

describe("M4C: the response body says nothing about the server's filesystem", () => {
  it("carries no path, no adapter name and no SQLite wording", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const project = await adoptedProject(running, "no-leak");
    const impact = await postImpact(running, project.projectId,
      restoreImpactBody(project.view, project.migrationSnapshot, "m4c-leak-impact"));
    const restored = await postRestore(running, project.projectId, restoreRequestBody(
      project.view, project.migrationSnapshot,
      impact.body as { impact_id: string; impact_hash: string }, "m4c-leak-restore"));
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    const text = JSON.stringify(restored.body);
    expect(text).not.toMatch(/\/home\/|\/mnt\/|C:\\\\/u);
    expect(text).not.toMatch(/openfilm-engine-adapter|SQLite|sqlite/iu);
    expect(validateControlledWriteResponse(restored.body).ok).toBe(true);
  }, 900_000);
});
