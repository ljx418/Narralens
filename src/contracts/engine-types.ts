import type { ControlledEditOperation, EditOperation } from "./types.js";

/**
 * M2.1 engine-layer wire types.
 *
 * This module is a pure type surface: no Node, React, adapter or host imports
 * (`02_ARCHITECTURE_L0_L1.md` dependency rule 2). It is the only place engine
 * shapes are declared so that `src/host/**` can depend on the contract without
 * depending on a concrete engine.
 */

export type EngineKind = "hypit" | "openfilm";

/** Lowercase hex SHA-256. */
export type Sha256 = string;

/** Rational frame rate, reduced, `num > 0`, `den > 0`. AC-D02. */
export interface Fps {
  readonly num: number;
  readonly den: number;
}

/** Integer half-open frame range `[start_frame, end_frame_exclusive)`. AC-D02. */
export interface HalfOpenFrameRange {
  readonly start_frame: number;
  readonly end_frame_exclusive: number;
}

/**
 * M2.1 opened no new edit semantics. The gateway's `translated` output is exactly the
 * legacy typed edit so `ProjectWriteActor` stays the sole commit owner and no
 * translation layer exists that could itself be bypassed (ADR D-07, AC-019).
 *
 * W2.0 adds the two controlled operations (W2-G03). Both carry an `impact_id`/`impact_hash`
 * pair by construction, so an adapter cannot be handed an adoption or a restore that the
 * Host never authorized; there is no "native" form of either operation that skips them.
 */
export type TypedEdit = EditOperation | ControlledEditOperation;

export type CapabilityState = "supported" | "blocked" | "read_only" | "unverified";

export interface CapabilityEntry {
  readonly state: CapabilityState;
  readonly reason: string;
}

export interface CapabilityMap {
  readonly entries: Readonly<Record<string, CapabilityEntry>>;
  readonly fps: Fps;
  readonly fps_verified: boolean;
}

export interface EngineTrack {
  readonly track_id: string;
  readonly index: number;
  readonly clip_ids: readonly string[];
}

export interface EngineSubtitle {
  readonly subtitle_id: string;
  readonly source_ref: string;
  readonly content_sha256: Sha256;
}

export interface EngineAssetReference {
  readonly asset_id: string | null;
  /** Relative, `/`-separated, fragment-free; same name and meaning as `manifest.assets[].path`. */
  readonly path: string;
  readonly content_sha256: Sha256;
}

export interface PreviewDescriptor {
  readonly kind: "hypit-studio" | "openfilm-studio";
  readonly url: string;
}

export type EngineClipKind = "page" | "video" | "sound" | "still";

export interface EngineClip {
  readonly clip_id: string;
  readonly track_id: string;
  readonly kind: EngineClipKind;
  readonly frame_range: HalfOpenFrameRange;
  readonly source_frame_range: HalfOpenFrameRange | null;
  readonly source_ref: string;
  readonly overrides_digest: Sha256 | null;
}

/**
 * Read-only projection of a committed source. It is mapped from the engine's own parsed
 * document; it is never persisted and never consulted by a write path, so it cannot
 * become a second author timeline (`03_M2_M4_MODULE_DESIGN.md:9`).
 */
export interface EngineProjection {
  readonly engine: EngineKind;
  readonly engine_upstream_sha: string;
  readonly snapshot_id: string;
  readonly project_revision: number;
  readonly control_revision: number;
  readonly source_digest: Sha256;
  readonly fps: Fps;
  readonly frame_count: number;
  readonly clips: readonly EngineClip[];
  readonly tracks: readonly EngineTrack[];
  readonly subtitles: readonly EngineSubtitle[];
  readonly asset_references: readonly EngineAssetReference[];
  readonly editable_capabilities: CapabilityMap;
  readonly preview: PreviewDescriptor;
  readonly problems: readonly string[];
}

export interface EngineBinding {
  readonly project_id: string;
  readonly engine: EngineKind;
  readonly engine_upstream_sha: string;
  readonly binding_version: number;
  readonly created_at: string;
  readonly migrated_from: string | null;
}

/** Response of `GET /api/migration/v1/projects/:id/engine`. Read-only. */
export interface EngineResponse {
  readonly format: "narralens.engine-response@1.0";
  readonly project_id: string;
  readonly binding: EngineBinding;
  readonly capabilities: CapabilityMap;
  readonly projection: EngineProjection;
}

export type SourceFileRole = "entry" | "scene" | "html" | "js" | "css" | "subtitle" | "settings" | "font";

export interface SourceDigestManifest {
  readonly format: "narralens.source-digest-manifest@1.0";
  readonly engine: EngineKind;
  readonly engine_upstream_sha: string;
  readonly files: ReadonlyArray<{ path: string; role: SourceFileRole; sha256: Sha256; size: number }>;
  readonly assets: ReadonlyArray<{ path: string; asset_id: string | null; sha256: Sha256; size: number }>;
}
