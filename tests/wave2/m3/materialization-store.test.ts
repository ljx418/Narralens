import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MaterializationStore } from "../../../src/host/materialize/materialization-store.js";
import type { NativePlanV1 } from "../../../src/contracts/wave2-types.js";
import { RevisionStore } from "../../../src/host/projects/revision-store.js";

/**
 * M3.1: the materialization read model.
 *
 * A materialization is a *discardable preparation fact*. It is recomputable from the
 * comparison, the asset ledger and the bindings, so it may be thrown away and rebuilt — which
 * is exactly why it must never be mistaken for content. Nothing here may be read as a second
 * timeline or as a licence: the authoritative facts stay in the comparison, the ledger and
 * the bindings, and this row records what was believed at a moment.
 *
 * So the store's first obligation is to be honest about staleness. Every field that could
 * have moved since the row was written is stored separately and re-checked on read; a row
 * whose facts no longer agree is `stale`, and it never returns to `ready` on its own.
 */

const dirs: string[] = [];
const stores: RevisionStore[] = [];
afterEach(async () => {
  while (stores.length > 0) stores.pop()!.close();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);
const PROJECT = "of_d1-30s_abcdef12";

async function harness(): Promise<{ store: MaterializationStore; revisions: RevisionStore }> {
  const base = await mkdtemp(join(tmpdir(), "narralens-m31-"));
  dirs.push(base);
  const revisions = new RevisionStore(join(base, "narralens.sqlite"));
  stores.push(revisions);
  return { store: new MaterializationStore(revisions), revisions };
}

/** Three independent clips. A single clip is a flattened composite and is not a plan. */
/** Captures what a synchronous call threw, without letting it fail the test. */
function captureThrow(operation: () => unknown): string {
  try { operation(); return "NO_THROW"; }
  catch (error) { return error instanceof Error ? error.message : String(error); }
}

function plan1(): NativePlanV1 {
  return {
    format: "narralens.native-plan@1.0", engine: "openfilm", fps: { num: 30, den: 1 },
    clips: [0, 1, 2].map((index) => ({
      clip_id: `shot-00${index + 1}`, segment_id: `seg-${index + 1}`, asset_id: `asset_${index}`,
      asset_sha256: index === 1 ? OTHER_SHA : SHA,
      timeline: { start_frame: index * 300, end_frame_exclusive: (index + 1) * 300 },
      source: { start_frame: 0, end_frame_exclusive: 300 }, track_id: "track_visual",
    })),
    narration_policy: "preserve", duration_policy: "preserve", total_frames: 900, plan_sha256: SHA,
  };
}

const NEW = {
  materializationId: "mat_1",
  projectId: PROJECT,
  comparisonId: "cmp_1",
  proposalId: "proposal_1",
  jobId: "job_mat_1",
  baseRevision: 4,
  sourceDigest: SHA,
  controlRevision: 2,
  proposalSha256: SHA,
  assetInventorySha256: OTHER_SHA,
  rightsDigest: SHA,
  requestDigest: OTHER_SHA,
  idempotencyKey: "materialize-0001",
};

describe("M3.1 the materialization row", () => {
  it("starts queued and keeps every fact it was seeded with", async () => {
    const { store } = await harness();
    const created = await store.create(NEW);
    expect(created).toMatchObject({
      materialization_id: "mat_1", project_id: PROJECT, state: "queued",
      base_revision: 4, source_digest: SHA, control_revision: 2,
      native_plan: null, proxy: null,
    });
    expect(created.request_digest).toBe(OTHER_SHA);
  });

  it("replays the same request under the same idempotency key without creating a second row", async () => {
    const { store, revisions } = await harness();
    const first = await store.create(NEW);
    const second = await store.create(NEW);
    expect(second.materialization_id).toBe(first.materialization_id);
    expect(store.byProject(PROJECT)).toHaveLength(1);
    expect(revisions.compose((db) => db.prepare("SELECT COUNT(*) AS n FROM materialization").get()))
      .toMatchObject({ n: 1 });
  });

  it("refuses the same key with a different digest rather than silently replacing", async () => {
    const { store } = await harness();
    await store.create(NEW);
    await expect(store.create({ ...NEW, requestDigest: SHA }))
      .rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_KEY_CONFLICT" });
    expect(store.byProject(PROJECT)).toHaveLength(1);
  });

  it("scopes the idempotency key per project, so two projects may use the same key", async () => {
    const { store } = await harness();
    await store.create(NEW);
    const other = await store.create({ ...NEW, projectId: "of_other_000000001", materializationId: "mat_2" });
    expect(other.materialization_id).toBe("mat_2");
    expect(store.byProject(PROJECT)).toHaveLength(1);
  });

  it("stores the native plan and proxy once they exist, and reads them back unchanged", async () => {
    const { store } = await harness();
    await store.create(NEW);
    const plan = plan1();
    await store.setPlan("mat_1", plan);
    await store.setProxy("mat_1", { token: `proxies/${SHA}`, sha256: OTHER_SHA, frame_count: 300, profile_id: "wave2-proxy-720p30-v1" });
    await store.setLineage("mat_1", [{ output_sha256: OTHER_SHA, input_asset_id: "asset_a", input_sha256: SHA,
      source: { start_frame: 0, end_frame_exclusive: 300 }, output: { start_frame: 0, end_frame_exclusive: 300 } }]);

    const row = store.require("mat_1");
    expect(row.native_plan).toEqual(plan);
    expect(row.proxy).toMatchObject({ frame_count: 300 });
    expect(row.lineage).toHaveLength(1);
    // Writing an artefact does not move the state; only an explicit transition does.
    expect(row.state).toBe("queued");
  });

  it("only reaches ready_for_adoption through the frozen state machine", async () => {
    const { store } = await harness();
    await store.create(NEW);
    expect(() => store.transition("mat_1", "queued", "ready_for_adoption"))
      .toThrow(/INVALID_MATERIALIZATION_TRANSITION/u);
    for (const to of ["running", "validating"] as const) {
      expect(store.transition("mat_1", store.require("mat_1").state, to).state).toBe(to);
    }
    // ready additionally requires that everything it promises is actually recorded.
    expect(() => store.transition("mat_1", "validating", "ready_for_adoption"))
      .toThrow(/not complete/u);
  });

  it("reaches ready only once plan, proxy and lineage are all present", async () => {
    const { store } = await harness();
    await store.create(NEW);
    store.transition("mat_1", "queued", "running");
    store.transition("mat_1", "running", "validating");
    await store.setPlan("mat_1", plan1());
    expect(() => store.transition("mat_1", "validating", "ready_for_adoption"))
      .toThrow(/not complete/u);
    await store.setProxy("mat_1", { token: `proxies/${SHA}`, sha256: OTHER_SHA, frame_count: 300, profile_id: "p" });
    expect(() => store.transition("mat_1", "validating", "ready_for_adoption"))
      .toThrow(/not complete/u);
    await store.setLineage("mat_1", [{ output_sha256: OTHER_SHA, input_asset_id: "asset_a", input_sha256: SHA,
      source: { start_frame: 0, end_frame_exclusive: 300 }, output: { start_frame: 0, end_frame_exclusive: 300 } }]);
    expect(store.transition("mat_1", "validating", "ready_for_adoption").state).toBe("ready_for_adoption");
  });

  it("refuses to store a plan that is a single flattened clip", async () => {
    const { store } = await harness();
    await store.create(NEW);
    // A one-clip plan is the retired D4.2 composite shape. It must not reach the store at
    // all, because a materialization that recorded one would look like a valid plan.
    const flattened = { ...plan1(), clips: [plan1().clips[0]!], total_frames: 300 };
    await expect(store.setPlan("mat_1", flattened as NativePlanV1))
      .rejects.toThrow(/does not satisfy the contract/u);

    expect(store.require("mat_1").native_plan).toBeNull();
  });

  it("moves to stale when a fact no longer matches, and never returns to ready on its own", async () => {
    const { store } = await harness();
    await store.create(NEW);
    store.transition("mat_1", "queued", "running");
    store.transition("mat_1", "running", "validating");
    await store.setPlan("mat_1", plan1());
    await store.setProxy("mat_1", { token: `proxies/${SHA}`, sha256: OTHER_SHA, frame_count: 300, profile_id: "p" });
    await store.setLineage("mat_1", [{ output_sha256: OTHER_SHA, input_asset_id: "asset_a", input_sha256: SHA,
      source: { start_frame: 0, end_frame_exclusive: 300 }, output: { start_frame: 0, end_frame_exclusive: 300 } }]);
    store.transition("mat_1", "validating", "ready_for_adoption");

    // A caller re-verifies and finds the source moved.
    expect(store.markStale("mat_1", ["SOURCE_CHANGED"]).state).toBe("stale");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(store.require("mat_1").state).toBe("stale");
    }
    // `stale` is not an upgradeable state; going back needs an explicit new materialization.
    expect(() => store.transition("mat_1", "stale", "ready_for_adoption"))
      .toThrow(/INVALID_MATERIALIZATION_TRANSITION/u);
    expect(() => store.transition("mat_1", "stale", "running"))
      .toThrow(/INVALID_MATERIALIZATION_TRANSITION/u);
  });

  it("refuses ready when the proxy is not the one the lineage accounts for", async () => {
    const { store } = await harness();
    await store.create(NEW);
    store.transition("mat_1", "queued", "running");
    store.transition("mat_1", "running", "validating");
    await store.setPlan("mat_1", plan1());
    // The lineage explains one artefact and the proxy claims another: ready would be a claim
    // about a comparison the evidence does not cover.
    await store.setProxy("mat_1", { token: `proxies/${OTHER_SHA}`, sha256: SHA, frame_count: 900, profile_id: "p" });
    await store.setLineage("mat_1", [{ output_sha256: OTHER_SHA, input_asset_id: "asset_0", input_sha256: SHA,
      source: { start_frame: 0, end_frame_exclusive: 300 }, output: { start_frame: 0, end_frame_exclusive: 300 } }]);
    expect(() => store.transition("mat_1", "validating", "ready_for_adoption"))
      .toThrow(/not covered by the lineage/u);
  });

  it("refuses ready when only the plan is missing", async () => {
    const { store } = await harness();
    await store.create(NEW);
    store.transition("mat_1", "queued", "running");
    store.transition("mat_1", "running", "validating");
    await store.setProxy("mat_1", { token: `proxies/${OTHER_SHA}`, sha256: OTHER_SHA, frame_count: 900, profile_id: "p" });
    await store.setLineage("mat_1", [{ output_sha256: OTHER_SHA, input_asset_id: "asset_0", input_sha256: SHA,
      source: { start_frame: 0, end_frame_exclusive: 300 }, output: { start_frame: 0, end_frame_exclusive: 300 } }]);
    const error = captureThrow(() => store.transition("mat_1", "validating", "ready_for_adoption"));
    expect(error).toMatch(/native_plan/u);
  });

  it("refuses to mark a terminal materialization merely stale", async () => {
    const { store } = await harness();
    await store.create(NEW);
    store.transition("mat_1", "queued", "running");
    store.quarantine("mat_1", [{ output_sha256: OTHER_SHA, input_asset_id: "asset_0", input_sha256: SHA,
      source: { start_frame: 0, end_frame_exclusive: 300 }, output: { start_frame: 0, end_frame_exclusive: 300 } }]);
    // A quarantined or failed materialization must not be relabelled as merely stale: those
    // say something different about what happened.
    expect(() => store.markStale("mat_1", ["LATER"]))
      .toThrow(/INVALID_MATERIALIZATION_TRANSITION/u);
    expect(store.require("mat_1").state).toBe("attention");
  });

  it("marks a blocked materialization with its reasons, readable without parsing prose", async () => {
    const { store } = await harness();
    await store.create(NEW);
    store.transition("mat_1", "queued", "running");
    const blocked = store.markStale("mat_1", ["BYTES_UNAVAILABLE", "RIGHTS_NOT_CLEARED"]);
    expect(blocked).toMatchObject({ state: "stale", blocking_reasons: ["BYTES_UNAVAILABLE", "RIGHTS_NOT_CLEARED"] });
    expect(store.require("mat_1").blocking_reasons).toEqual(["BYTES_UNAVAILABLE", "RIGHTS_NOT_CLEARED"]);
  });

  it("never writes a state without its predecessor, from a row that moved on", async () => {
    const { store } = await harness();
    await store.create(NEW);
    store.transition("mat_1", "queued", "running");
    // A second worker holding a stale view tries to advance the row.
    expect(() => store.transitionFrom("mat_1", "queued", "validating"))
      .toThrow(/INVALID_MATERIALIZATION_TRANSITION/u);
    expect(store.require("mat_1").state).toBe("running");
  });

  it("keeps quarantine separate from readiness", async () => {
    const { store } = await harness();
    await store.create(NEW);
    store.transition("mat_1", "queued", "running");
    const quarantined = store.quarantine("mat_1", [{ output_sha256: OTHER_SHA, input_asset_id: "asset_a",
      input_sha256: SHA, source: { start_frame: 0, end_frame_exclusive: 300 },
      output: { start_frame: 0, end_frame_exclusive: 300 } }]);
    expect(quarantined.state).toBe("attention");
    expect(store.require("mat_1").state).toBe("attention");
    // The orphan is recorded, not discarded: a later question about what that worker left
    // behind has to have an answer.
    expect(store.require("mat_1").lineage).toHaveLength(1);
    expect(() => store.transition("mat_1", "attention", "ready_for_adoption"))
      .toThrow(/INVALID_MATERIALIZATION_TRANSITION/u);
  });

  it("holds no frame timeline of its own", async () => {
    const { revisions } = await harness();
    await new MaterializationStore(revisions).create(NEW);
    const source = revisions.compose((db) => db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='materialization'").get()) as { sql: string };
    // The plan is stored as opaque validated JSON, never as columns that could be read as a
    // second authoritative timeline.
    expect(source.sql).toContain("plan_json");
    expect(source.sql).not.toMatch(/start_frame|end_frame_exclusive|clip_order|track_id/u);
  });

  it("records the replay lineage when a comparison was rebuilt from recorded provider output", async () => {
    const { store } = await harness();
    await store.create({ ...NEW, replay: {
      recorded_stdout_sha256: SHA, recorded_payload_sha256: OTHER_SHA,
      mode: "RECORDED_PROVIDER_OUTPUT_REPLAY",
    } });
    // Audit view, not a wire field: `MaterializationV1` is frozen and the comparison's own
    // `generation_audit` already carries the recorded runner's stdout hash.
    expect(store.replayOf("mat_1")).toMatchObject({
      recorded_stdout_sha256: SHA, mode: "RECORDED_PROVIDER_OUTPUT_REPLAY",
    });
    expect(store.require("mat_1")).not.toHaveProperty("replay");
  });
});
