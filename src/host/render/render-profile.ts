import { createHash } from "node:crypto";
import { canonicalJson } from "../engine/source-digest-v1.js";
import type { RenderSpec } from "../../contracts/agent-driven-types.js";
import pin from "./openfilm-render-pin.json" with { type: "json" };

/**
 * The render profile and its configuration digest.
 *
 * A delivery is only reproducible if everything that can change the produced bytes is
 * named in one digest. The upstream renderer takes a dozen options; the ones that are not
 * fixed here are not passed at all, and the ones that are fixed are folded into the digest
 * together with the engine version and the pinned upstream.
 *
 * MAIN computes the `RenderSpec.config_digest` with `computeRenderConfigDigest` — the
 * same function — so that a spec that claims one configuration cannot be rendered under
 * another. When the digests disagree the render is refused rather than performed.
 */

/** The options that are fixed for every production render. */
export const FIXED_RENDER_OPTIONS = Object.freeze({
  /**
   * One browser.
   *
   * The upstream parallelises a render over several browsers and splits the frame range
   * between them. The parts are then concatenated, so the number of workers changes how
   * the frames are produced even when the film does not change. One worker keeps a render
   * reproducible and keeps the machine usable for whatever else the Host is doing.
   */
  workers: 1,
  /**
   * One sample per frame.
   *
   * Several samples average the frame over the shutter (motion blur). That is a creative
   * choice, not a delivery requirement, and it multiplies the render cost.
   */
  samples: 1,
  /** The shutter angle, in fractions of a frame. Only meaningful with several samples. */
  shutter: 0.5,
});

/** The inputs the configuration digest is computed over. */
export interface RenderConfigInput {
  readonly render_spec: RenderSpec;
  /** The pinned upstream commit the renderer was loaded from. */
  readonly upstream_sha: string;
  /** The digest of the worker that drives the upstream renderer. */
  readonly worker_sha256: string;
}

/**
 * The SHA-256 of the canonical JSON of everything that decides the produced bytes.
 *
 * The canonical form is the repository's restricted JCS (ASCII field names sorted by
 * code unit, arrays in order, safe integers only), the same rule the contract package
 * uses for digests, so a digest computed here and one computed by MAIN agree by
 * construction rather than by convention.
 */
export function computeRenderConfigDigest(input: RenderConfigInput): string {
  const spec = input.render_spec;
  const canonical = canonicalJson({
    engine_id: spec.engine_id,
    engine_version: spec.engine_version,
    width: spec.width,
    height: spec.height,
    fps_numerator: spec.fps_numerator,
    fps_denominator: spec.fps_denominator,
    container: spec.container,
    video_codec: spec.video_codec,
    audio_codec: spec.audio_codec,
    workers: FIXED_RENDER_OPTIONS.workers,
    samples: FIXED_RENDER_OPTIONS.samples,
    // The shutter is a fraction of a frame, written as a fraction: the canonical form
    // takes whole numbers only, and a float would have to be rounded to be digested.
    shutter: String(FIXED_RENDER_OPTIONS.shutter),
    upstream_sha: input.upstream_sha,
    worker_sha256: input.worker_sha256,
    renderer_modules: pin.loaded_module_sha256,
    renderer_policies: pin.guard_module_sha256,
    renderer_helpers: pin.implementation_module_sha256,
    subtitle_strategy: pin.subtitle_strategy,
    caption_text_strategy: pin.caption_text_strategy,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
