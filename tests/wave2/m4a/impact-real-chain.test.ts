import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NarralensHost } from "../../../src/host/server.js";
import type { ProposalComparison, ProposalComparisonRequest } from "../../../src/contracts/types.js";
import type { MaterializationV1 } from "../../../src/contracts/wave2-types.js";
import { validateImpactSpec } from "../../../src/contracts/validator.js";
import {
  adoptBody, headers, migrate, postImpact, start, stopAll, type Started,
} from "./harness.js";

/**
 * M4A-R01, the whole chain, with nothing stubbed on the way through.
 *
 * Every other M4A test builds its `ready_for_adoption` row through the store, which is right
 * for testing arithmetic and wrong for testing the route a client walks. This one starts a
 * Host, migrates `d1-30s` through the Host's own `migrate-copy` route, POSTs the real
 * materialize route with real segment bindings against real repository media, lets the Host's
 * own worker encode a real proxy, and only then asks for an impact.
 *
 * That is deliberately slow and deliberately not repeated. One test asserts the chain; the
 * per-case detail lives in the unit files beside it.
 *
 * Headless, offline, no window, no provider call, no payment. The only external input is the
 * pinned OpenFilm checkout and the repository's own media fixtures.
 */

const hosts: NarralensHost[] = [];
const dirs: string[] = [];
afterEach(async () => { await stopAll(hosts.splice(0), dirs.splice(0)); });

const POLL_ATTEMPTS = 400;
const POLL_INTERVAL_MS = 250;

const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** Drives the Host's own drain until the materialization settles, then reads it back. */
async function settle(running: Started, materializationId: string): Promise<MaterializationV1> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    await running.host.materialize.drain();
    const row = await running.host.materialize.read(materializationId).catch((error: unknown) => {
      if (["MEDIA_TOOL_UNAVAILABLE", "HOST_RESOURCE_EXHAUSTED"]
        .includes(String((error as { code?: string }).code))) return undefined;
      throw error;
    });
    if (row !== undefined && !["queued", "running", "validating"].includes(row.state)) return row;
    await new Promise((done) => setTimeout(done, POLL_INTERVAL_MS));
  }
  throw new Error(`SETTLE_TIMEOUT:${materializationId}`);
}

/** Splits a duration vector so the parts still sum to the whole. */
function split(durations: readonly number[], firstShare: number): number[] {
  const [first, ...rest] = durations;
  const head = Math.max(1, Math.round((first ?? 1) * firstShare));
  const tail = Math.max(1, (first ?? 1) - head);
  return [head, ...rest.map((frames) => (tail === frames ? frames + 1 : frames)), tail];
}

const STRATEGIES = ["chronology", "contrast", "evidence-led"] as const;

/**
 * Writes a comparison through the Host's own adapter, so its ids are the adapter's.
 *
 * D4.1 requires three to six candidates that differ *structurally*, not just in wording, so
 * the three here sum to the same total and no two share a duration vector.
 */
async function seedComparison(running: Started, projectId: string, durations: readonly number[]): Promise<ProposalComparison> {
  const role = (index: number): "anchor" | "context" | "evidence" | "conclusion" =>
    (["anchor", "context", "evidence", "conclusion"] as const)[index % 4]!;
  const option = (index: number, segments: readonly number[]) => ({
    option_key: `option_${index}`, title: `recorded option ${index}`,
    strategy: { kind: STRATEGIES[(index - 1) % STRATEGIES.length]!, rationale: "recorded" },
    summary: "recorded draft replayed onto the target",
    segments: segments.map((duration_frames, part) => ({
      segment_id: `s_${index}_${part}`, duration_frames, role: role(part),
      intent: "视觉意图", asset_requirement_ids: [],
    })),
    assets_needed: [], source_refs: [], requires_materialization: true, renderable: false,
  });
  const total = durations.reduce((sum, frames) => sum + frames, 0);
  const draft = { schema_version: "1.0", kind: "narralens.proposal_comparison_draft",
    proposals: [option(1, durations), option(2, split(durations, 0.6)), option(3, split(durations, 0.4))] };
  const request: ProposalComparisonRequest = {
    base_revision: 1, selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: total },
    intent: "recorded", preserve: ["narration"], proposal_count: 3,
  };
  const built = running.host.comparisons.build(draft, projectId, request, {
    stdout_sha256: sha(Buffer.from("recorded-runner-stdout")), model_names: ["<recorded>"],
    total_cost_usd: 0, duration_ms: 1, num_turns: 1, service_tier: null,
  });
  await running.host.comparisons.save(built);
  return built;
}

describe("M4A-R01: the chain a client actually walks", () => {
  it("migrates, materializes for real, and then gets a valid impact — twice, idempotently", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const { projectId, view } = await migrate(running);

    // Three segments of 300 frames summing to the whole 900-frame film, so the plan preserves
    // duration — the only shape M4A can express — and no segment outruns the 300-frame
    // visual assets the migration actually carried.
    const durations = [300, 300, 300];
    const comparison = await seedComparison(running, projectId, durations);
    const proposal = comparison.proposals[0]!;
    const assets = running.host.assetLedger.assets(projectId)
      .filter((asset) => !/\.(vtt|srt)$/iu.test(asset.target_path))
      .map((asset) => asset.asset_id).sort();

    const posted = await fetch(
      `${running.origin}/api/migration/v1/projects/${projectId}/proposals/${proposal.proposal_id}/materialize`,
      { method: "POST", headers: headers(running.origin, running.token), body: JSON.stringify({
        format: "narralens.materialize-request@1.0", profile: { profile_id: "wave2-proxy-720p30-v1" },
        comparison_id: comparison.comparison_id, base_revision: view.revision,
        expected_source_digest: view.source_digest, control_revision: view.control_revision,
        segment_bindings: proposal.segments.map((segment, index) => ({
          segment_id: segment.segment_id, asset_id: assets[index % assets.length]!,
          source_start_frame: 0, source_end_frame_exclusive: segment.duration_frames,
        })),
        idempotency_key: "m4a-real-materialize",
      }) },
    );
    expect(posted.status, await posted.clone().text()).toBe(202);
    const job = await posted.json() as { job_id: string; materialization_id: string };

    const ready = await settle(running, job.materialization_id);
    expect(ready.state, `${JSON.stringify(running.host.failures.recent(4).map((e) => e.message_redacted))}`)
      .toBe("ready_for_adoption");
    expect(ready.native_plan?.total_frames).toBe(900);

    // The materialize routes still answer, which is what "M3 is unchanged" means here.
    const readBack = await fetch(`${running.origin}/api/migration/v1/materializations/${job.materialization_id}`,
      { headers: headers(running.origin, running.token) });
    expect(readBack.status).toBe(200);

    // Now the impact, over HTTP, on a materialization a real worker really produced.
    const body = adoptBody(view, job.materialization_id, "m4a-real-impact");
    const created = await postImpact(running, projectId, body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(validateImpactSpec(created.body).ok).toBe(true);
    expect(created.body.approvals_required).toEqual(["human_confirmation"]);
    // Current clip ids, never the plan's `clip-<segment>` ids.
    expect((created.body.affected_ranges as Array<{ clip_id: string }>).map((range) => range.clip_id))
      .toEqual(["shot-001", "shot-002", "shot-003"]);

    // Same key, same digest: the whole spec replays, byte for byte.
    const replay = await postImpact(running, projectId, body);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(created.body);
    expect(running.host.impacts.byProject(projectId)).toHaveLength(1);

    // No locator or server path crossed the wire.
    const serialised = JSON.stringify(created.body);
    expect(serialised).not.toContain("target_path");
    expect(serialised).not.toContain("source_root");
    expect(serialised).not.toMatch(/"[^"]*\/(?:tmp|var|home|Users|mnt)\/"/u);
  }, 900_000);
});

