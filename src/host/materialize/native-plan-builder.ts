import { createHash } from "node:crypto";
import { canonicalJson } from "../engine/source-digest-v1.js";
import { validatorFor, contractIds } from "../../contracts/validator.js";
import type { NativePlanClipV1, NativePlanV1 } from "../../contracts/wave2-types.js";
import type { BindingResult } from "./binding-service.js";

/**
 * NativePlanBuilder (M3.2).
 *
 * Turns bound segments into OpenFilm-native clip specs: one clip per segment, each pointing
 * at its own asset and its own source span, so the adopted film stays independently
 * editable. Three shots in means three clips out, and the middle one can change without
 * touching its neighbours.
 *
 * What it deliberately does not produce is a timeline. The plan is derived from the bindings
 * and holds nothing they do not: no track ordering, no shot list, no second copy of the
 * selection. A plan that also carried a sequence would be a second authority, and after an
 * edit the two could disagree — and the one an operator reads would be the wrong one.
 *
 * The single-clip case is refused by name. C-01 retired the D4.2 `composite_asset_id`
 * shape, where one asset stood for a whole film; a plan with one clip is that shape wearing
 * a native plan's type, and it would pass every structural check while describing exactly
 * the flattened composite Wave 2 exists to avoid.
 *
 * `plan_sha256` is over the whole spec including every frame position, so an impact can
 * bind to exactly the plan that was approved.
 */

export const MAX_SEGMENTS = 64;
export const VISUAL_TRACK_ID = "track_visual";

export class NativePlanBuilder {
  build(result: BindingResult): NativePlanV1 {
    const bindings = result.bindings;
    if (bindings.length === 0) {
      throw new Error("A native plan needs at least one bound segment");
    }
    if (bindings.length < 2) {
      // One clip is the retired D4.2 composite shape, not a short film.
      throw new Error(
        "A native plan needs one clip per segment and at least two segments; a single clip is a flattened composite",
      );
    }
    if (bindings.length > MAX_SEGMENTS) {
      throw new Error(`A proposal may contribute at most ${MAX_SEGMENTS} segments; got ${bindings.length}`);
    }

    // The timeline must be a contiguous, gapless, overlap-free cover of the selection. The
    // bindings came from BindingService, which already enforces this; re-checking here means
    // the builder cannot be handed a result from anywhere else and produce a broken plan.
    const ordered = [...bindings].sort((a, b) => a.target_start_frame - b.target_start_frame);
    let cursor = result.selection.start_frame;
    for (const entry of ordered) {
      if (entry.target_start_frame !== cursor) {
        throw new Error(
          `Binding ${entry.segment_id} starts at ${entry.target_start_frame} but the timeline is contiguous up to ${cursor}`,
        );
      }
      const length = entry.target_end_frame_exclusive - entry.target_start_frame;
      const sourceLength = entry.source_end_frame_exclusive - entry.source_start_frame;
      if (length !== entry.duration_frames) {
        throw new Error(`Binding ${entry.segment_id} spans ${length} frame(s) but declares ${entry.duration_frames}`);
      }
      if (sourceLength !== length) {
        // Not looped, not frozen, not slowed: a different source length would need one of
        // those, and all three change what the viewer sees.
        throw new Error(
          `Binding ${entry.segment_id} has a ${sourceLength}-frame source span for a ${length}-frame timeline; that would need a speed change`,
        );
      }
      cursor = entry.target_end_frame_exclusive;
    }
    const covered = cursor - result.selection.start_frame;
    const selected = result.selection.end_frame_exclusive - result.selection.start_frame;
    if (covered !== selected || result.total_frames !== selected) {
      throw new Error(
        `The bound segments cover ${covered} frame(s) but the proposal selection is ${selected} and declares ${result.total_frames} total`,
      );
    }

    const clips: NativePlanClipV1[] = ordered.map((entry) => ({
      clip_id: `clip-${entry.segment_id}`,
      segment_id: entry.segment_id,
      asset_id: entry.asset_id,
      asset_sha256: entry.asset_sha256,
      timeline: { start_frame: entry.target_start_frame, end_frame_exclusive: entry.target_end_frame_exclusive },
      source: { start_frame: entry.source_start_frame, end_frame_exclusive: entry.source_end_frame_exclusive },
      track_id: VISUAL_TRACK_ID,
    }));

    if (new Set(clips.map((clip) => clip.clip_id)).size !== clips.length) {
      throw new Error("Two bindings produced the same clip id");
    }

    const plan: NativePlanV1 = {
      format: "narralens.native-plan@1.0",
      engine: "openfilm",
      fps: { num: 30, den: 1 },
      clips,
      narration_policy: "preserve",
      duration_policy: "preserve",
      total_frames: covered,
      plan_sha256: "",
    };
    return { ...plan, plan_sha256: planDigest(plan) };
  }
}

/** Over the whole spec, `plan_sha256` excluded, so the hash is of the plan itself. */
export function planDigest(plan: Omit<NativePlanV1, "plan_sha256">): string {
  const { plan_sha256: _excluded, ...spec } = plan as NativePlanV1;
  const digest = createHash("sha256");
  digest.update("narralens-native-plan-v1\n");
  // The hash is of the spec, so `plan_sha256` is removed rather than set to undefined:
  // `canonicalJson` refuses undefined rather than dropping the key, and a key whose
  // presence depends on a value would make the digest depend on that too.
  digest.update(canonicalJson(spec));
  return digest.digest("hex");
}

/**
 * Replays the runtime contract on a plan alone, so a builder change cannot emit something
 * the frozen `MaterializationV1` would later refuse.
 */
export function assertPlanValid(plan: NativePlanV1): void {
  const placeholder = "0".repeat(64);
const PLACEHOLDER_PROXY_TOKEN = ["proxies", "placeholder"].join("/");
  const envelope = {
    format: "narralens.materialization@1.0", materialization_id: "m", job_id: "j", project_id: "p",
    comparison_id: "c", proposal_id: "r", state: "validating", base_revision: 0,
    source_digest: placeholder, control_revision: 0, proposal_sha256: placeholder,
    asset_inventory_sha256: placeholder, rights_digest: placeholder, request_digest: placeholder,
    native_plan: plan,
    proxy: { token: PLACEHOLDER_PROXY_TOKEN, sha256: placeholder, frame_count: plan.total_frames, profile_id: "p" },
    lineage: [{ output_sha256: placeholder, input_asset_id: "a", input_sha256: placeholder,
      source: { start_frame: 0, end_frame_exclusive: 1 }, output: { start_frame: 0, end_frame_exclusive: 1 } }],
    blocking_reasons: [], created_at: "1970-01-01T00:00:00.000Z", updated_at: "1970-01-01T00:00:00.000Z",
  };
  if (!validatorFor(contractIds.materialization)(envelope)) {
    throw new Error("The native plan does not satisfy the frozen materialization contract");
  }
}
