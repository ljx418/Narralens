import { afterEach, describe, expect, it } from "vitest";
import { validateImpactRequest, validateImpactSpec } from "../../../src/contracts/validator.js";
import { NarralensHost } from "../../../src/host/server.js";
import {
  adoptBody, migrate, postImpact, readyMaterialization, start, stopAll,
} from "./harness.js";

/**
 * M4A-C01 — the request contract, and the rule that a client may not author an impact.
 *
 * Half of this file is schema-shaped and cheap. The other half goes over HTTP against a
 * real migrated target, because "the schema forbids an extra field" is a weaker claim than
 * "the route refuses it and creates nothing".
 */

const hosts: NarralensHost[] = [];
const dirs: string[] = [];
afterEach(async () => { await stopAll(hosts.splice(0), dirs.splice(0)); });

const VALID = {
  format: "narralens.impact-request@1.0",
  base_revision: 0,
  expected_source_digest: "a".repeat(64),
  control_revision: 0,
  intent: { op: "adopt_materialization", materialization_id: "mat_1" },
  idempotency_key: "m4a-contract-1",
};

describe("M4A-C01: the request schema accepts exactly what a client may assert", () => {
  it("accepts both intent arms and nothing else", () => {
    expect(validateImpactRequest(VALID).ok).toBe(true);
    expect(validateImpactRequest({ ...VALID,
      intent: { op: "restore_snapshot", target_snapshot_id: "snap_1" } }).ok).toBe(true);
  });

  it("rejects every attempt to carry an impact fact in the request", () => {
    // Each of these is a field M4A computes. A client that may send one of them can claim an
    // authorization, which is the entire failure this contract exists to prevent.
    for (const [field, value] of [
      ["affected_ranges", [{ clip_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 }]],
      ["affected_consumers", [{ kind: "visual", id: "shot-001", action: "preserve" }]],
      ["locks_checked", [{ lock_id: "lock_1", control_revision: 0 }]],
      ["locks", []],
      ["rights_digest", "a".repeat(64)],
      ["native_plan_sha256", "a".repeat(64)],
      ["engine_upstream_sha", "b".repeat(40)],
      ["expires_at", "2030-01-01T00:00:00.000Z"],
      ["impact_hash", "a".repeat(64)],
      ["impact_id", "imp_1"],
      ["source_root", "/mnt/c/anything"],
      ["path", "scenes/shot-001.html"],
      ["url", "http://127.0.0.1/x"],
      ["shell", "ffmpeg"],
    ] as const) {
      const result = validateImpactRequest({ ...VALID, [field]: value });
      expect(result.ok, `${field} must be refused`).toBe(false);
    }
  });

  it("rejects an intent that borrows the other arm's reference", () => {
    expect(validateImpactRequest({ ...VALID, intent: {
      op: "adopt_materialization", materialization_id: "mat_1", target_snapshot_id: "snap_1",
    } }).ok).toBe(false);
    expect(validateImpactRequest({ ...VALID, intent: {
      op: "restore_snapshot", target_snapshot_id: "snap_1", materialization_id: "mat_1",
    } }).ok).toBe(false);
    expect(validateImpactRequest({ ...VALID, intent: { op: "delete_everything" } }).ok).toBe(false);
  });

  it("holds the shape of the fields it does accept", () => {
    for (const bad of [
      { ...VALID, format: "narralens.impact-request@2.0" },
      { ...VALID, expected_source_digest: "A".repeat(64) },
      { ...VALID, expected_source_digest: "a".repeat(63) },
      { ...VALID, base_revision: -1 },
      { ...VALID, base_revision: 1.5 },
      { ...VALID, control_revision: -1 },
      { ...VALID, idempotency_key: "" },
      { ...VALID, idempotency_key: "k".repeat(201) },
      { ...VALID, idempotency_key: "   " },
      { ...VALID, intent: { op: "adopt_materialization", materialization_id: "" } },
    ]) {
      expect(validateImpactRequest(bad).ok, JSON.stringify(bad)).toBe(false);
    }
    // A one-character key is legal: the length floor is 1, and shortening the floor to
    // match M3's 8 would be a different contract from the one ADR-W2.0-004 §2 froze.
    expect(validateImpactRequest({ ...VALID, idempotency_key: "k" }).ok).toBe(true);
  });
});

describe("M4A-C01 over HTTP: the route refuses a self-authored impact and creates nothing", () => {
  it("returns 400 for a client that names its own scope, consumers, locks, rights or hash", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId);
    const before = running.host.impacts.byProject(projectId).length;

    const extras: ReadonlyArray<Record<string, unknown>> = [
      { affected_ranges: [{ clip_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 }] },
      { affected_consumers: [{ kind: "visual", id: "shot-001", action: "preserve" }] },
      { locks_checked: [] },
      { rights_digest: "a".repeat(64) },
      { impact_hash: "a".repeat(64) },
      { impact_id: "imp_client" },
      { expires_at: "2030-01-01T00:00:00.000Z" },
      { engine: "openfilm" },
    ];
    for (const extra of extras) {
      const response = await postImpact(running, projectId,
        { ...adoptBody(view, materialization.materialization_id, `key-${Object.keys(extra).join()}`), ...extra });
      expect(response.status, JSON.stringify(extra)).toBe(400);
      expect(response.body.code, JSON.stringify(extra)).toBe("INVALID_REQUEST");
    }
    expect(running.host.impacts.byProject(projectId)).toHaveLength(before);
  }, 300_000);

  it("computes a spec that satisfies its own contract, and 201s it", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const { projectId, view } = await migrate(running);
    const materialization = await readyMaterialization(running.host, projectId);

    const response = await postImpact(running, projectId,
      adoptBody(view, materialization.materialization_id, "m4a-c01-happy"));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(validateImpactSpec(response.body).ok).toBe(true);
  }, 300_000);
});
