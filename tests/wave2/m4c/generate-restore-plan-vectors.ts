import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildHistoryRestorePlan, computeHistoryRestorePlanHash, historyRestorePlanPreimage,
  type HistoryRestorePlanPreimage,
} from "../../../src/host/history/history-restore-plan.js";
import type { EngineProjection } from "../../../src/contracts/engine-types.js";

/**
 * Generate `restore-plan.vectors.json` (M4C-05).
 *
 * The vectors are *frozen evidence*, not a snapshot of whatever the code does today: the
 * file is committed, the Python implementation checks itself against it, and a test asserts
 * that the TypeScript still produces the same bytes. A change to the canonical rules
 * therefore has to change this file deliberately, which is what makes the cross-check a
 * check.
 *
 * The shape below is ADR-W2.0-006 §D-03's, field for field. When the ADR and the
 * implementation disagreed, the implementation regressed to the ADR — so these vectors are
 * the frozen contract's bytes, not the earlier, richer shape's.
 *
 * Run with `pnpm test:wave2:m4c:vectors [output-path]`. The default writes the committed
 * file; the evidence capture passes a temporary path and *diffs* it against the committed
 * one, so the gate detects drift rather than causing it.
 */

const sha = (character: string): string => character.repeat(64);

const BASE: HistoryRestorePlanPreimage = {
  format: "narralens.history-restore-plan@1.0",
  project_id: "of_d1-30s_0123456789abcdef",
  target_snapshot_id: sha("c"),
  current_snapshot_id: sha("a"),
  current_projection_sha256: sha("1"),
  target_projection_sha256: sha("2"),
  affected_ranges: [
    { clip_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 },
    { clip_id: "shot-002", start_frame: 300, end_frame_exclusive: 600 },
  ],
  affected_consumers: [
    { kind: "visual", id: "shot-001", action: "replace" },
    { kind: "narration", id: "narration", action: "preserve" },
  ],
  required_locks: [
    { lock_type: "visual", scope: "shot", target_id: "shot-001",
      start_frame: 0, end_frame_exclusive: 300 },
  ],
  target_roots: ["film.html", "narration.wav", "scenes/shot-001.html"],
  target_subtitles: [{ subtitle_id: "narration", path: "assets/narration.vtt" }],
  target_frame_count: 900,
  rights_digest: sha("f"),
};

/** One mutation per field. Every one of them has to move the hash. */
const MUTATIONS: ReadonlyArray<{ name: string; mutate: (plan: HistoryRestorePlanPreimage) => HistoryRestorePlanPreimage }> = [
  { name: "format", mutate: (plan) => ({ ...plan, format: "narralens.history-restore-plan@1.1" as typeof plan.format }) },
  { name: "project-id", mutate: (plan) => ({ ...plan, project_id: "of_other_0123456789abcdef" }) },
  { name: "target-snapshot", mutate: (plan) => ({ ...plan, target_snapshot_id: sha("3") }) },
  { name: "current-snapshot", mutate: (plan) => ({ ...plan, current_snapshot_id: sha("4") }) },
  { name: "current-projection", mutate: (plan) => ({ ...plan, current_projection_sha256: sha("5") }) },
  { name: "target-projection", mutate: (plan) => ({ ...plan, target_projection_sha256: sha("6") }) },
  {
    name: "affected-ranges",
    mutate: (plan) => ({ ...plan, affected_ranges: [{ clip_id: "shot-001", start_frame: 0, end_frame_exclusive: 299 }] }),
  },
  {
    name: "affected-consumers",
    mutate: (plan) => ({ ...plan, affected_consumers: [{ kind: "visual", id: "shot-001", action: "preserve" }] }),
  },
  {
    name: "required-locks",
    mutate: (plan) => ({ ...plan, required_locks: [{
      lock_type: "visual", scope: "project", target_id: "", start_frame: 0, end_frame_exclusive: 900 }] }),
  },
  { name: "target-roots", mutate: (plan) => ({ ...plan, target_roots: [...plan.target_roots, "settings.json"] }) },
  {
    name: "target-subtitles",
    mutate: (plan) => ({ ...plan, target_subtitles: [{ subtitle_id: "narration", path: "assets/other.vtt" }] }),
  },
  { name: "target-frame-count", mutate: (plan) => ({ ...plan, target_frame_count: 901 }) },
  { name: "rights-digest", mutate: (plan) => ({ ...plan, rights_digest: sha("7") }) },
];

/**
 * A synthetic pair of projections, so the frozen bytes are tied to what the *builder*
 * produces and not only to a hand-written document.
 */
function projection(clips: EngineProjection["clips"], subtitles: EngineProjection["subtitles"],
  frameCount: number): EngineProjection {
  const grouped = new Map<string, string[]>();
  for (const clip of clips) grouped.set(clip.track_id, [...(grouped.get(clip.track_id) ?? []), clip.clip_id]);
  return {
    engine: "openfilm", engine_upstream_sha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
    snapshot_id: sha("9"), project_revision: 2, control_revision: 0, source_digest: sha("9"),
    fps: { num: 30, den: 1 }, frame_count: frameCount, clips,
    tracks: [...grouped.entries()].map(([track_id, clip_ids], index) => ({ track_id, index, clip_ids })),
    subtitles, asset_references: [], editable_capabilities: { entries: {}, fps: { num: 30, den: 1 }, fps_verified: true },
    preview: { kind: "openfilm-studio", url: "/api/migration/v1/projects/of/preview" },
    problems: [],
  };
}

const BUILDER_PLAN = buildHistoryRestorePlan({
  project_id: "of_d1-30s_0123456789abcdef",
  current: projection([
    { clip_id: "shot-001", track_id: "track_0", kind: "video",
      frame_range: { start_frame: 0, end_frame_exclusive: 300 },
      source_frame_range: { start_frame: 0, end_frame_exclusive: 300 },
      source_ref: "assets/1111111111111111111111111111111111111111111111111111111111111111/source.mp4",
      overrides_digest: null },
  ], [], 300),
  target: projection([
    { clip_id: "shot-001", track_id: "track_0", kind: "page",
      frame_range: { start_frame: 0, end_frame_exclusive: 300 },
      source_frame_range: { start_frame: 0, end_frame_exclusive: 300 },
      source_ref: "scenes/shot-001.html", overrides_digest: null },
  ], [], 300),
  current_snapshot_id: sha("a"),
  target_snapshot_id: sha("c"),
  target_roots: ["film.html", "scenes/shot-001.html"],
  target_subtitles: [],
  narration_target_path: null,
  rights_digest: sha("f"),
}, "of_d1-30s_0123456789abcdef");

const { plan_sha256: _builderHash, ...builderPlan } = BUILDER_PLAN;

const CASES: ReadonlyArray<{ name: string; plan: HistoryRestorePlanPreimage }> = [
  { name: "base", plan: BASE },
  ...MUTATIONS.map((mutation) => ({ name: `mutated-${mutation.name}`, plan: mutation.mutate(BASE) })),
  {
    // The same content, in a different order. The hash must not move: a plan whose hash
    // moved for a cosmetic reason would be indistinguishable from one that genuinely
    // changed.
    name: "reordered-arrays",
    plan: {
      ...BASE,
      affected_ranges: [...BASE.affected_ranges].reverse(),
      affected_consumers: [...BASE.affected_consumers].reverse(),
      required_locks: [...BASE.required_locks].reverse(),
      target_roots: [...BASE.target_roots].reverse(),
      target_subtitles: [...BASE.target_subtitles].reverse(),
    },
  },
  { name: "builder", plan: builderPlan },
];

const document = {
  format: "narralens.restore-plan-vectors@1",
  domain: "narralens-history-restore-plan-v1\\n",
  vectors: CASES.map(({ name, plan }) => ({
    name, plan, plan_sha256: computeHistoryRestorePlanHash(plan),
    preimage: historyRestorePlanPreimage(plan),
  })),
};

const target = resolve(process.argv[2] ?? "tests/wave2/m4c/restore-plan.vectors.json");
writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
process.stdout.write(`wrote ${document.vectors.length} vectors to ${target}\n`);
