export declare const NATIVE_SUBTITLE_MODULE_SHA256: 'be4b1852bc254ff597e43694a732044ef51dd43a78df13735c2ff023957687dd';
export declare const NATIVE_SUBTITLE_BURN_ENTRY: '.film/cache/narralens-subtitle-burn/index.html';
export interface NativeBurnCue {
  readonly text: string;
  readonly startMs: number;
  readonly durMs: number;
  readonly [nativeField: string]: unknown;
}
export interface NativeSubtitleBurnInput {
  readonly width: number;
  readonly height: number;
  readonly frame_count: number;
  readonly cues: readonly NativeBurnCue[];
  /** Actual normalized JSON style from fixed readSubtitleStyle/subtitlesForExport, not a tool body. */
  readonly style: Readonly<Record<string, unknown>>;
  /** Actual bytes of fixed studio/server/film-subtitle.mjs; copied and hashed by the helper. */
  readonly subtitle_module_bytes: Uint8Array;
}
export interface NativeSubtitleBurnSource {
  readonly entry: typeof NATIVE_SUBTITLE_BURN_ENTRY;
  readonly files: readonly {
    readonly relative_path: string;
    readonly bytes: Uint8Array;
    readonly sha256: string;
  }[];
}
/** Direct Node mjs runtime; invalid inputs throw a fixed, path-free ordinary Error. No IO/process side effects. */
export declare function buildPinnedNativeSubtitleBurnSource(input: NativeSubtitleBurnInput): NativeSubtitleBurnSource;
