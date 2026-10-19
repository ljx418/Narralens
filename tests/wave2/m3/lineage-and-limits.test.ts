import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DerivedArtifactStore } from "../../../src/host/materialize/derived-artifact-store.js";
import { ProxyRenderer, lineageDigest } from "../../../src/host/materialize/proxy-renderer.js";
import type { LineageEntryV1, NativePlanV1 } from "../../../src/contracts/wave2-types.js";

/**
 * M3.2: lineage must be tamper-evident, and the renderer must be bounded.
 *
 * Two separate claims, both easy to make and hard to keep.
 *
 * Lineage is the answer to "where did this proxy come from". A list of entries that can be
 * edited without detection is not an answer, so the whole set is digested together with the
 * tool profile that produced it — changing one asset id, one byte hash, one frame boundary
 * or the profile moves the digest. Entry order does not, because the order is an accident of
 * how a request was written rather than a fact about the film.
 *
 * Bounded concurrency is about the Host, not the renderer: one client must not be able to
 * start four encoders on the machine. The ceilings are global (2) and per project (1), and
 * a test that only ever renders one thing at a time cannot tell the difference between
 * having them and not.
 */

const SOURCE_A = resolve("fixtures/d1-30s/assets/generated/visual-10s.mp4");
const SOURCE_B = resolve("fixtures/d1-30s/assets/generated/visual-alt-10s.mp4");
const PROFILE = "wave2-proxy-720p30-v1";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "narralens-m32-lineage-"));
  dirs.push(base);
  return base;
}

/**
 * Hashes in-process rather than shelling out to `sha256sum`.
 *
 * The subprocess was one more thing to fail under this box's memory pressure, and a
 * hashing helper does not need to be one: the assertion it serves is identical.
 */
async function sha256Of(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function oneClipPlan(total = 300): NativePlanV1 {
  return {
    format: "narralens.native-plan@1.0", engine: "openfilm", fps: { num: 30, den: 1 },
    clips: [{ clip_id: "clip-seg-1", segment_id: "seg-1", asset_id: "asset_1",
      asset_sha256: "a".repeat(64),
      timeline: { start_frame: 0, end_frame_exclusive: total },
      source: { start_frame: 0, end_frame_exclusive: total }, track_id: "track_visual" }],
    narration_policy: "preserve", duration_policy: "preserve", total_frames: total,
    plan_sha256: "c".repeat(64),
  };
}

function entry(over: Partial<LineageEntryV1> = {}): LineageEntryV1 {
  return {
    output_sha256: "d".repeat(64), input_asset_id: "asset_1", input_sha256: "e".repeat(64),
    source: { start_frame: 0, end_frame_exclusive: 300 },
    output: { start_frame: 0, end_frame_exclusive: 300 },
    ...over,
  };
}

describe("MT-03 lineage is tamper-evident", () => {
  const TOOL = { profile_id: PROFILE, version: "ffmpeg version 6.1.1", argv_is_fixed: true } as const;

  it("binds the entries and the tool profile together", () => {
    const digest = lineageDigest([entry()], TOOL);
    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(lineageDigest([entry()], { ...TOOL, version: "ffmpeg version 7.0" })).not.toBe(digest);
    expect(lineageDigest([entry()], { ...TOOL, profile_id: "other-profile" })).not.toBe(digest);
  });

  it("changes when any single fact behind an output changes", () => {
    const base = lineageDigest([entry()], TOOL);
    const mutations: Array<[string, LineageEntryV1]> = [
      ["input asset id", entry({ input_asset_id: "asset_2" })],
      ["input bytes", entry({ input_sha256: "1".repeat(64) })],
      ["output bytes", entry({ output_sha256: "2".repeat(64) })],
      ["source start", entry({ source: { start_frame: 1, end_frame_exclusive: 300 } })],
      ["source end", entry({ source: { start_frame: 0, end_frame_exclusive: 301 } })],
      ["output start", entry({ output: { start_frame: 1, end_frame_exclusive: 300 } })],
    ];
    for (const [label, mutated] of mutations) {
      expect(lineageDigest([mutated], TOOL), label).not.toBe(base);
    }
  });

  it("changes when an entry is added or removed", () => {
    const one = lineageDigest([entry()], TOOL);
    const two = lineageDigest([entry(), entry({ output_sha256: "9".repeat(64) })], TOOL);
    expect(two).not.toBe(one);
  });

  it("does not change when only the entry order does", () => {
    const a = entry({ segment_free: undefined } as never) ;
    const first = entry();
    const second = entry({ output_sha256: "9".repeat(64), input_asset_id: "asset_2" });
    expect(lineageDigest([second, first], TOOL)).toBe(lineageDigest([first, second], TOOL));
    void a;
  });

  it("cannot be made to collide by moving one entry's output frame range", () => {
    // A swap of two entries' output ranges is a real tampering, not a reordering.
    const a = entry({ output: { start_frame: 0, end_frame_exclusive: 300 } });
    const b = entry({ output_sha256: "9".repeat(64), output: { start_frame: 300, end_frame_exclusive: 600 } });
    const swapped = [entry({ output_sha256: "9".repeat(64), output: { start_frame: 0, end_frame_exclusive: 300 } }),
      entry({ output: { start_frame: 300, end_frame_exclusive: 600 } })];
    expect(lineageDigest([b, a], TOOL)).not.toBe(lineageDigest(swapped, TOOL));
  });

  it("matches what a real render produced, so the digest covers the actual outputs", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    const renderer = new ProxyRenderer({ artifacts: store, profile: PROFILE });
    const result = await renderer.render({
      materializationId: "mat_1", projectId: "p1", plan: oneClipPlan(),
      segments: [{ segment_id: "seg-1", asset_path: SOURCE_A, sha256: await sha256Of(SOURCE_A),
        start_frame: 0, end_frame_exclusive: 300,
        license_status: "cleared", commercial_use: true }],
    });
    expect(result.lineage).toHaveLength(1);
    expect(result.lineage[0]!.input_sha256).toBe(await sha256Of(SOURCE_A));
    expect(result.lineage[0]!.output_sha256).toBe(result.proxy.sha256);
    expect(lineageDigest(result.lineage, result.tool)).toMatch(/^[a-f0-9]{64}$/u);
  }, 180_000);
});

describe("M3.2 the renderer is bounded", () => {
  it("reports the ceilings it enforces", () => {
    expect(ProxyRenderer.limits()).toMatchObject({ global: 2, per_project: 1 });
  });

  it("never runs more than the global ceiling inside itself", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    const peak = new ConcurrencyProbe();
    const renderer = new ProxyRenderer({
      artifacts: store, profile: PROFILE, observer: peak,
    });
    await renderConcurrently(renderer, 6, ["p1", "p1", "p2", "p2", "p3", "p3"]);
    // Measured by the renderer reporting when it actually admits a render, not by the
    // caller counting its own promises: the latter would pass with no limiter at all.
    expect(peak.globalPeak).toBeLessThanOrEqual(2);
    expect(peak.globalPeak).toBeGreaterThan(0);
  }, 300_000);

  it("never runs more than one render for a single project at a time", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    const peak = new ConcurrencyProbe();
    const renderer = new ProxyRenderer({ artifacts: store, profile: PROFILE, observer: peak });
    await renderConcurrently(renderer, 4, ["same", "same", "same", "same"]);
    expect(peak.perProjectPeak["same"]).toBe(1);
  }, 300_000);

  it("does let two different projects run at once", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    const peak = new ConcurrencyProbe();
    const renderer = new ProxyRenderer({ artifacts: store, profile: PROFILE, observer: peak });
    await renderConcurrently(renderer, 4, ["p1", "p2", "p3", "p4"]);
    // A global ceiling of one would satisfy every other assertion here while making the
    // Host needlessly serial, so prove the parallelism is real.
    expect(peak.globalPeak).toBe(2);
  }, 300_000);

  it("still completes every render it accepted", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    const renderer = new ProxyRenderer({ artifacts: store, profile: PROFILE });
    const done = await renderConcurrently(renderer, 3, ["p1", "p2", "p3"]);
    expect(done.succeeded).toBe(3);
    expect(done.failed).toBe(0);
  }, 300_000);

  it("releases its slot when a render fails, so one bad input cannot wedge the queue", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    const peak = new ConcurrencyProbe();
    const renderer = new ProxyRenderer({ artifacts: store, profile: PROFILE, observer: peak });
    await expect(renderer.render({
      materializationId: "bad", projectId: "p1", plan: oneClipPlan(),
      segments: [{ segment_id: "seg-1", asset_path: SOURCE_A, sha256: "0".repeat(64),
        start_frame: 0, end_frame_exclusive: 300,
        license_status: "cleared", commercial_use: true }],
    })).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    // If the slot leaked, this render would never be admitted and the test would time out
    // rather than pass.
    const good = await renderer.render({
      materializationId: "good", projectId: "p1", plan: oneClipPlan(),
      segments: [{ segment_id: "seg-1", asset_path: SOURCE_A, sha256: await sha256Of(SOURCE_A),
        start_frame: 0, end_frame_exclusive: 300,
        license_status: "cleared", commercial_use: true }],
    });
    expect(good.proxy.frame_count).toBe(300);
  }, 300_000);
});

/** Records what the renderer admitted, which is the only place the limiter is visible. */
class ConcurrencyProbe {
  globalPeak = 0;
  private global = 0;
  private readonly perProject = new Map<string, number>();
  readonly perProjectPeak: Record<string, number> = {};

  readonly entered = (projectId: string): void => {
    this.global += 1;
    this.globalPeak = Math.max(this.globalPeak, this.global);
    const next = (this.perProject.get(projectId) ?? 0) + 1;
    this.perProject.set(projectId, next);
    this.perProjectPeak[projectId] = Math.max(this.perProjectPeak[projectId] ?? 0, next);
  };

  readonly exited = (projectId: string): void => {
    this.global -= 1;
    this.perProject.set(projectId, (this.perProject.get(projectId) ?? 1) - 1);
  };
}

/** Renders several times at once and records the peak concurrency observed. */
async function renderConcurrently(
  renderer: ProxyRenderer, count: number, projects: string[],
): Promise<{ global: number; perProject: Record<string, number>; succeeded: number; failed: number }> {
  const peak = { global: 0, perProject: {} as Record<string, number>, succeeded: 0, failed: 0 };
  let active = 0;
  const perProject = new Map<string, number>();
  const sourceSha = await sha256Of(SOURCE_A);
  const awaits: Array<Promise<unknown>> = [];
  for (let index = 0; index < count; index += 1) {
    const project = projects[index % projects.length]!;
    active += 1;
    perProject.set(project, (perProject.get(project) ?? 0) + 1);
    peak.global = Math.max(peak.global, active);
    peak.perProject[project] = Math.max(peak.perProject[project] ?? 0, perProject.get(project)!);
    awaits.push((async () => {
      try {
        await renderer.render({
          materializationId: `mat_${index}`, projectId: project, plan: oneClipPlan(),
          segments: [{ segment_id: "seg-1", asset_path: SOURCE_A, sha256: sourceSha,
            // Thirty frames, not the source's full three hundred. What is under test here is
            // how many renders run at once and whether a slot is released; the frame count is
            // irrelevant to that, and six full-length encodes of a 3.4 MB clip made this file
            // the heaviest in the suite for no additional evidence.
            start_frame: 0, end_frame_exclusive: 30,
            license_status: "cleared", commercial_use: true }],
        });
        peak.succeeded += 1;
      } catch (error) {
        console.error("CONCURRENCY_RENDER_FAILED", String(error));
        peak.failed += 1;
      } finally {
        active -= 1;
        perProject.set(project, (perProject.get(project) ?? 1) - 1);
      }
    })());
  }
  await Promise.all(awaits);
  return peak;
}

void createHash;
