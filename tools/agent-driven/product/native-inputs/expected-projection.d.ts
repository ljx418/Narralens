export type Sha256 = string;
export interface SourceEntry { relative_path: string; sha256: Sha256 }
export interface SourceFileFact { relative_path: string; state: 'present' | 'absent'; sha256: Sha256 | null }
export interface ProjectSettings {
  fps?: number;
  trackNames?: Array<{ name: string; index: number; clips: string[] }>;
  trackHeights?: Array<{ height: number; index: number; clips: string[] }>;
}
export interface Marker { id: string; t: number; clip?: string; name?: string; color: 'blue' | 'green' | 'yellow' | 'orange' | 'red' | 'purple' }
export interface NumericNativeClip {
  id: string; src: string; at: number; time: [number, number]; speed?: number;
  [nativeField: string]: unknown;
}
export interface NativeValue {
  stage?: { w: number; h: number };
  tracks: Array<{ clips: NumericNativeClip[]; [nativeField: string]: unknown }>;
  [nativeField: string]: unknown;
}
export interface NormalizedMediaFact {
  source_ref: string; source_sha256: Sha256;
  origin: 'host_actual_probe' | 'host_deterministic_source'; proof_digest: Sha256;
  /** Exactly native factsOfProbe durationMs, not a guessed source duration. */
  duration_ms: number | null; has_audio: boolean; fps: number | null;
}
export interface SpanFact {
  id: string; src: string; at: number; end: number; native: number | null;
  w?: number; h?: number; reflows?: true;
}
export interface ExpectedProjectionInput {
  format: 'narralens.native-expected-input@1';
  upstream_sha: 'e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3';
  profile: 'narralens.native-expected-numeric@1';
  binding: { project_id: string; project_revision: number; snapshot_id: Sha256; source_digest: Sha256; film_sha256: Sha256 };
  /** Host-only provenance references. Structural acceptance is not proof of authority or independent observation. */
  provenance: { origin: 'host_independent'; source_manifest_digest: Sha256; rights_digest: Sha256 | null; media_catalog_digest: Sha256 | null; listing_digest: Sha256 };
  /** Baseline calculation excludes transients; the helper does not prove their absence in a real native view. */
  ui_profile: { pending_drops: 'excluded'; preview_error: 'excluded'; live_height: 'excluded'; browser_preferences: 'excluded' };
  source_entries: SourceEntry[];
  film: { file: SourceFileFact; value: NativeValue };
  settings: { file: SourceFileFact; value: ProjectSettings };
  markers: { file: SourceFileFact; value: Marker[] };
  clip_refs: Array<{ clip_id: string; source_ref: string; source_sha256: Sha256; provenance:
    { kind: 'registered_asset'; asset_id: string; rights_digest: Sha256 }
    | { kind: 'controlled_source_artifact'; artifact_ref: { id: string; version: number; sha256: Sha256 };
        producer_digest: Sha256; producer_receipt_digest: Sha256 } }>;
  media_facts: NormalizedMediaFact[];
  /** Exact independently obtained native listFiles video order; do not sort observed UI rows into expected input. */
  video_files_in_native_order: string[];
  span_facts: { profile: 'numeric_source_only'; origin: 'not_used'; proof_digest: null; values: [] }
    | { profile: 'host_attested'; origin: 'host_independent'; proof_digest: Sha256; values: SpanFact[] };
}
export interface SettingsEffectiveValue {
  settings: ProjectSettings; resolved_fps: number; fps_source: 'project' | 'footage_or_default';
  track_names: Array<{ doc_index: number; name: string }>;
  track_heights: Array<{ lane: string; doc_index: number | null; index: number; height: number }>;
}
export interface MarkersEffectiveValue { placed: Array<{ marker: Marker; ms: number; clip_id: string | null }> }
export interface EffectivePart<T> { value: T; canonical_utf8: string; sha256: Sha256 }
export type UnsupportedReason = 'INPUT_INVALID' | 'UI_PROFILE_UNSUPPORTED' | 'UNPROVEN_FACTS' | 'SOURCE_FACTS_MISMATCH'
  | 'INPUT_NOT_NATIVE_NORMALIZED' | 'CLIP_REFERENCE_MISMATCH' | 'NON_NUMERIC_CLIP_UNSUPPORTED' | 'INCOMPLETE_PROBE_FACTS'
  | 'LISTING_FACTS_MISMATCH' | 'SPAN_FACTS_UNSUPPORTED' | 'NATIVE_PROJECTION_UNSUPPORTED';
export type ExpectedProjectionResult = { status: 'unsupported'; profile: 'narralens.native-expected-numeric@1'; reason: UnsupportedReason }
  | { status: 'computed'; profile: 'narralens.native-expected-numeric@1'; binding: ExpectedProjectionInput['binding']; input_sha256: Sha256;
      settings: EffectivePart<SettingsEffectiveValue>; markers: EffectivePart<MarkersEffectiveValue>; not_proven: string[] };
export const EXPECTED_PROFILE: 'narralens.native-expected-numeric@1';
export function computeExpectedProjection(input: unknown): ExpectedProjectionResult;
export function parseProjectSettings(value: unknown): ProjectSettings;
export function parseMarkers(value: unknown): Marker[];
