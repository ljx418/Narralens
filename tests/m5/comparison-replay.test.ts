import { afterEach, describe, expect, it } from "vitest";
import { authHeaders, migrate, start, stopAll, type Started } from "./harness.js";
import { NarralensHost } from "../../src/host/server.js";
import type { ProposalComparison } from "../../src/contracts/types.js";

/**
 * M5's comparison replay (Wave 3 `04` §2).
 *
 * A replay copies a *recorded* D4.1 comparison onto the migrated target. It never calls a
 * provider and never changes the source, the revision, the active snapshot or the ledger.
 * What it produces is a new, target-owned, immutable comparison plus a lineage that says
 * which recorded comparison it came from.
 *
 * The test asserts the copy, the lineage, the refusals and — the claim that matters most —
 * that the whole operation is NOWRITE for everything except the new comparison file.
 */
const hosts: NarralensHost[] = [];
const dirs: string[] = [];

afterEach(async () => { await stopAll(hosts.splice(0), dirs.splice(0)); });

/** A recorded comparison, in the shape a D4.1 run left behind. */
function recorded(projectId: string, baseRevision: number,
  selection: { shot_id: string; start_frame: number; end_frame_exclusive: number },
  comparisonId = "comparison_recorded_1"): ProposalComparison {
  return {
    schema_version: "1.0",
    kind: "narralens.proposal_comparison",
    comparison_id: comparisonId,
    project_id: projectId,
    base_revision: baseRevision,
    selection,
    intent_sha256: "a".repeat(64),
    preserve: ["narration"],
    proposal_count: 3,
    proposals: [
      // Three structurally distinct proposals: the store refuses a set whose members have
      // the same shape, because three cards with the same structure are one card.
      { count: 1, roles: ["anchor"], kind: "chronology" },
      { count: 2, roles: ["anchor", "context"], kind: "contrast" },
      { count: 3, roles: ["anchor", "context", "evidence"], kind: "evidence-led" },
    ].map((shape, index) => ({
      proposal_id: `proposal_recorded_${index + 1}`,
      title: `方案 ${index + 1}`,
      strategy: { kind: shape.kind as "chronology" | "contrast" | "evidence-led", rationale: "recorded" },
      summary: "recorded summary",
      segments: shape.roles.map((role, segmentIndex) => ({
        segment_id: `segment_${index + 1}_${segmentIndex + 1}`,
        duration_frames: 300 / shape.count,
        role: role as "anchor" | "context" | "evidence",
        intent: "recorded", asset_requirement_ids: [],
      })),
      assets_needed: [], source_refs: [], requires_materialization: true as const, renderable: false as const,
      materialization_cost: { status: "unknown" as const, currency: null, amount: null },
    })),
    generation_audit: {
      stdout_sha256: "b".repeat(64), model_names: ["recorded-model"], total_cost_usd: 0,
      duration_ms: 1234, num_turns: 3, service_tier: null,
    },
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

async function migrated(): Promise<{ running: Started; projectId: string }> {
  const running = await start();
  hosts.push(running.host);
  dirs.push(running.base);
  const target = await migrate(running, "m5-replay-1");
  return { running, projectId: target.projectId };
}

async function replay(running: Started, projectId: string, body: unknown): Promise<{
  status: number; body: Record<string, unknown>;
}> {
  const response = await fetch(`${running.origin}/api/migration/v1/projects/${projectId}/comparisons/replay`,
    { method: "POST", headers: authHeaders(running.origin, running.token), body: JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown> };
}

describe("M5 comparison replay: a recorded comparison, copied onto the target", () => {
  it("copies the recorded comparison, adds the lineage, and writes nothing else", async () => {
    const { running, projectId } = await migrated();
    const plan = running.host.revisions.migrations.plan(
      (await running.host.projectResolver.resolveActivated(projectId)).migration_id)!;
    // The source revision the migration was made from. The fixture's own revision.
    expect(plan.source_revision).toBe(2);

    const source = recorded("d1-30s", plan.source_revision, { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 });
    await running.host.comparisons.save(source);

    // The facts that must not move.
    const view = await running.host.projectResolver.resolveActivated(projectId);
    const revisionBefore = view.revision;
    const snapshotBefore = view.snapshot_id;
    const digestBefore = view.source_digest;
    const outboxBefore = running.host.revisions.outboxRowCount();
    const jobsBefore = running.host.revisions.outboxRowCount("job.state_changed");
    const ledgerBefore = running.host.assetLedger.assets(projectId).length;

    const response = await replay(running, projectId, {
      format: "narralens.comparison-replay-request@1.0",
      source_comparison_id: source.comparison_id,
      base_revision: plan.source_revision,
      idempotency_key: "m5-replay-key-1",
    });
    expect(response.status).toBe(200);
    const body = response.body as {
      format: string; project_id: string; comparison_id: string; replayed: boolean;
      lineage: { source_comparison_id: string; source_project_id: string; migration_id: string; source_sha256: string };
      comparison: ProposalComparison;
    };
    expect(body.format).toBe("narralens.comparison-replay-response@1.0");
    expect(body.project_id).toBe(projectId);
    expect(body.replayed).toBe(false);
    // A *new* target-owned comparison.
    expect(body.comparison_id).not.toBe(source.comparison_id);
    expect(body.comparison.comparison_id).toBe(body.comparison_id);
    expect(body.comparison.project_id).toBe(projectId);
    // The new comparison is owned by the *target*, so it is bound to the target's own
    // revision — the recording's baseline is what the lineage carries, not what the new
    // comparison authorizes against.
    expect(body.comparison.base_revision).toBe(view.revision);
    // The lineage says exactly where it came from.
    expect(body.lineage.source_comparison_id).toBe(source.comparison_id);
    expect(body.lineage.source_project_id).toBe("d1-30s");
    expect(body.lineage.migration_id).toBe(view.migration_id);
    expect(body.lineage.source_sha256).toMatch(/^[a-f0-9]{64}$/u);
    // The proposals and the *original* generation audit are copied verbatim: this is a
    // recording, not a new generation.
    expect(body.comparison.proposals).toEqual(source.proposals);
    expect(body.comparison.generation_audit).toEqual(source.generation_audit);
    // The selection is the target's own clip, proved by the migrator's id.
    expect(body.comparison.selection.shot_id).toBe("shot-001");
    expect(body.comparison.selection.start_frame).toBe(0);
    expect(body.comparison.selection.end_frame_exclusive).toBe(300);

    // NOWRITE for everything else: the revision, the snapshot, the source digest, the
    // ledger, the outbox and the job table.
    const after = await running.host.projectResolver.resolveActivated(projectId);
    expect(after.revision).toBe(revisionBefore);
    expect(after.snapshot_id).toBe(snapshotBefore);
    expect(after.source_digest).toBe(digestBefore);
    expect(running.host.assetLedger.assets(projectId).length).toBe(ledgerBefore);
    expect(running.host.revisions.outboxRowCount()).toBe(outboxBefore);
    expect(running.host.revisions.outboxRowCount("job.state_changed")).toBe(jobsBefore);
  }, 300_000);

  it("replays the same response for the same key and refuses a different body under it", async () => {
    const { running, projectId } = await migrated();
    const plan = running.host.revisions.migrations.plan(
      (await running.host.projectResolver.resolveActivated(projectId)).migration_id)!;
    await running.host.comparisons.save(
      recorded("d1-30s", plan.source_revision, { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 }));
    const request = {
      format: "narralens.comparison-replay-request@1.0",
      source_comparison_id: "comparison_recorded_1",
      base_revision: plan.source_revision,
      idempotency_key: "m5-replay-key-2",
    };
    const first = await replay(running, projectId, request);
    expect(first.status).toBe(200);
    const again = await replay(running, projectId, request);
    expect(again.status).toBe(200);
    expect((again.body as { comparison_id: string }).comparison_id)
      .toBe((first.body as { comparison_id: string }).comparison_id);
    expect((again.body as { replayed: boolean }).replayed).toBe(true);

    const different = await replay(running, projectId, { ...request, source_comparison_id: "comparison_other_1" });
    expect(different.status).toBe(409);
    expect(different.body.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
  }, 300_000);

  it("refuses a comparison that belongs to another project", async () => {
    const { running, projectId } = await migrated();
    const plan = running.host.revisions.migrations.plan(
      (await running.host.projectResolver.resolveActivated(projectId)).migration_id)!;
    // A recorded comparison of a project that is not this target's source.
    await running.host.comparisons.save(
      recorded("d1-30s-other", plan.source_revision, { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 },
        "comparison_foreign_1"));
    const response = await replay(running, projectId, {
      format: "narralens.comparison-replay-request@1.0",
      source_comparison_id: "comparison_foreign_1",
      base_revision: plan.source_revision,
      idempotency_key: "m5-replay-key-3",
    });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe("INVALID_REQUEST");
  }, 300_000);

  it("refuses a comparison recorded against a baseline before the migration, with the message the page shows", async () => {
    const { running, projectId } = await migrated();
    const plan = running.host.revisions.migrations.plan(
      (await running.host.projectResolver.resolveActivated(projectId)).migration_id)!;
    await running.host.comparisons.save(
      recorded("d1-30s", 1, { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 },
        "comparison_older_1"));
    const response = await replay(running, projectId, {
      format: "narralens.comparison-replay-request@1.0",
      source_comparison_id: "comparison_older_1",
      base_revision: 1,
      idempotency_key: "m5-replay-key-4",
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("REVISION_CONFLICT");
    expect(String(response.body.message)).toContain("M5 不会重新调用模型");
  }, 300_000);

  it("refuses a selection that the target's own projection does not carry", async () => {
    const { running, projectId } = await migrated();
    const plan = running.host.revisions.migrations.plan(
      (await running.host.projectResolver.resolveActivated(projectId)).migration_id)!;
    // A shot that exists in the source but has no clip in the target.
    await running.host.comparisons.save(
      recorded("d1-30s", plan.source_revision, { shot_id: "shot-404", start_frame: 0, end_frame_exclusive: 300 },
        "comparison_unmapped_1"));
    const response = await replay(running, projectId, {
      format: "narralens.comparison-replay-request@1.0",
      source_comparison_id: "comparison_unmapped_1",
      base_revision: plan.source_revision,
      idempotency_key: "m5-replay-key-5",
    });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe("INVALID_REQUEST");
  }, 300_000);

  it("refuses a request that carries a prompt, and a request that names no key", async () => {
    const { running, projectId } = await migrated();
    const withPrompt = await replay(running, projectId, {
      format: "narralens.comparison-replay-request@1.0",
      source_comparison_id: "comparison_recorded_1",
      base_revision: 2, idempotency_key: "m5-replay-key-6", prompt: "write me a new one",
    });
    expect(withPrompt.status).toBe(400);
    const withoutKey = await replay(running, projectId, {
      format: "narralens.comparison-replay-request@1.0",
      source_comparison_id: "comparison_recorded_1", base_revision: 2,
    });
    expect(withoutKey.status).toBe(400);
  }, 300_000);
});
