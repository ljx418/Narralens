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
 * Run with `pnpm test:wave2:m4c:vectors [output-path]`. The default writes the committed
 * file; the evidence capture passes a temporary path and *diffs* it against the committed
 * one, so the gate detects drift rather than causing it.
 */

const sha = (character: string): string => character.repeat(64);

const BASE: HistoryRestorePlanPreimage = {
  format: "narralens.history-restore-plan@1.0",
  project_id: "of_d1-30s_0123456789abcdef",
  current_snapshot_id: sha("a"),
  current_revision: 2,
  current_source_digest: sha("b"),
  target_snapshot_id: sha("c"),
  target_source_digest: sha("d"),
  target_film_sha256: sha("e"),
  entry_root: "film.html",
  roots: [
    "assets/1111111111111111111111111111111111111111111111111111111111111111/source.mp4",
    "film.html",
    "narration.wav",
  ],
  assets: ["assets/1111111111111111111111111111111111111111111111111111111111111111/source.mp4"],
  subtitles: [{ subtitle_id: "narration", path: "assets/narration.vtt", changed: false }],
  clips: [
    {
      clip_id: "shot-001", track_id: "track_0", kind: "visual",
      start_frame: 0, end_frame_exclusive: 300,
      current_source_ref: "assets/1111111111111111111111111111111111111111111111111111111111111111/source.mp4",
      target_source_ref: "scenes/shot-001.html",
      current_source_start_frame: 0, current_source_end_frame_exclusive: 300,
      target_source_start_frame: 0, target_source_end_frame_exclusive: 300,
      current_overrides_sha256: null, target_overrides_sha256: null,
      changed: true,
    },
    {
      clip_id: "narration", track_id: "track_1", kind: "sound",
      start_frame: 0, end_frame_exclusive: 900,
      current_source_ref: "narration.wav", target_source_ref: "narration.wav",
      current_source_start_frame: 0, current_source_end_frame_exclusive: 900,
      target_source_start_frame: 0, target_source_end_frame_exclusive: 900,
      current_overrides_sha256: null, target_overrides_sha256: null,
      changed: false,
    },
  ],
  consumers: [
    { kind: "visual", id: "shot-001", action: "replace" },
    { kind: "narration", id: "narration", action: "preserve" },
  ],
  required_locks: [
    { lock_type: "visual", scope: "shot", target_id: "shot-001",
      start_frame: 0, end_frame_exclusive: 300 },
  ],
  rights_digest: sha("f"),
};

/** One mutation per field. Every one of them has to move the hash. */
const MUTATIONS: ReadonlyArray<{ name: string; mutate: (plan: HistoryRestorePlanPreimage) => HistoryRestorePlanPreimage }> = [
  { name: "project-id", mutate: (plan) => ({ ...plan, project_id: "of_other_0123456789abcdef" }) },
  { name: "current-snapshot", mutate: (plan) => ({ ...plan, current_snapshot_id: sha("1") }) },
  { name: "current-revision", mutate: (plan) => ({ ...plan, current_revision: 3 }) },
  { name: "current-digest", mutate: (plan) => ({ ...plan, current_source_digest: sha("2") }) },
  { name: "target-snapshot", mutate: (plan) => ({ ...plan, target_snapshot_id: sha("3") }) },
  { name: "target-digest", mutate: (plan) => ({ ...plan, target_source_digest: sha("4") }) },
  { name: "target-film", mutate: (plan) => ({ ...plan, target_film_sha256: sha("5") }) },
  { name: "entry-root", mutate: (plan) => ({ ...plan, entry_root: "narration.wav" }) },
  {
    name: "roots",
    mutate: (plan) => ({ ...plan, roots: [...plan.roots, "scenes/shot-001.html"] }),
  },
  { name: "assets", mutate: (plan) => ({ ...plan, assets: [] }) },
  {
    name: "subtitles",
    mutate: (plan) => ({ ...plan, subtitles: [{ subtitle_id: "narration", path: "assets/other.vtt", changed: false }] }),
  },
  {
    name: "clips",
    mutate: (plan) => ({ ...plan, clips: plan.clips.map((clip) => clip.clip_id === "shot-001"
      ? { ...clip, changed: false } : clip) }),
  },
  {
    name: "consumers",
    mutate: (plan) => ({ ...plan, consumers: [{ kind: "visual", id: "shot-001", action: "preserve" }] }),
  },
  {
    name: "required-locks",
    mutate: (plan) => ({ ...plan, required_locks: [] }),
  },
  { name: "rights-digest", mutate: (plan) => ({ ...plan, rights_digest: sha("6") }) },
];

/**
 * A synthetic pair of projections, so the frozen bytes are tied to what the *builder*
 * produces and not only to a hand-written document.
 */
function projection(clips: EngineProjection["clips"], subtitles: EngineProjection["subtitles"],
  frameCount: number): EngineProjection {
  return {
    engine: "openfilm", engine_upstream_sha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
    snapshot_id: sha("9"), project_revision: 2, control_revision: 0, source_digest: sha("9"),
    fps: { num: 30, den: 1 }, frame_count: frameCount, clips, tracks: [],
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
  current_revision: 2,
  current_source_digest: sha("b"),
  target_snapshot_id: sha("c"),
  target_source_digest: sha("d"),
  target_film_sha256: sha("e"),
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
      roots: [...BASE.roots].reverse(),
      assets: [...BASE.assets].reverse(),
      clips: [...BASE.clips].reverse(),
      consumers: [...BASE.consumers].reverse(),
      required_locks: [...BASE.required_locks].reverse(),
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
