import { NativeDraftError, digestBytes, draftCheck } from './native-draft-plan.js';

export const NATIVE_SUBTITLE_MODULE_SHA256 = 'be4b1852bc254ff597e43694a732044ef51dd43a78df13735c2ff023957687dd';
export const NATIVE_SUBTITLE_BURN_ENTRY = '.film/cache/narralens-subtitle-burn/index.html';
export interface NativeBurnCue {
  readonly text: string; readonly startMs: number; readonly durMs: number;
  readonly [nativeField: string]: unknown;
}
export interface NativeSubtitleBurnSource {
  readonly entry: typeof NATIVE_SUBTITLE_BURN_ENTRY;
  readonly files: readonly { relative_path: string; bytes: Uint8Array; sha256: string }[];
}

/**
 * Pure render-stage source adapter, adapted from fixed exports.mjs burnFilm (private, NOT an exported API).
 * MAIN must pin this helper, resolve cues/style with the fixed public subtitlesForExport, and write EXCL only
 * in its copied render staging root. This helper never writes author/snapshot files or starts a render/Job.
 * The normal pinned render engine still draws the wrapper; filmSounds/cuts are forwarded from the real film.
 */
export function buildPinnedNativeSubtitleBurnSource(input: {
  width: number; height: number; frame_count: number;
  cues: readonly NativeBurnCue[];
  /** Actual normalized style from fixed readSubtitleStyle/subtitlesForExport, never a tool body. */
  style: Readonly<Record<string, unknown>>;
  /** Actual bytes of fixed studio/server/film-subtitle.mjs, checked again before copying to render stage. */
  subtitle_module_bytes: Uint8Array;
}): NativeSubtitleBurnSource {
  draftCheck(Number.isSafeInteger(input.width) && input.width > 0 && Number.isSafeInteger(input.height) && input.height > 0 && Number.isSafeInteger(input.frame_count) && input.frame_count > 0, 'Invalid subtitle burn stage');
  if (digestBytes(input.subtitle_module_bytes) !== NATIVE_SUBTITLE_MODULE_SHA256) throw new NativeDraftError('DRAFT_FORMAT_UNAVAILABLE', 'The fixed native subtitle renderer does not match');
  draftCheck(input.cues.length > 0 && input.cues.every(cue => typeof cue.text === 'string' && cue.text.trim().length > 0 && Number.isFinite(cue.startMs) && cue.startMs >= 0 && Number.isFinite(cue.durMs) && cue.durMs > 0 && cue.startMs + cue.durMs <= input.frame_count * 1000 / 30 + 1), 'Native subtitle cues must fit the complete film');
  const json = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');
  const page = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${input.width}px;height:${input.height}px;overflow:hidden;background:#000}
#film{position:absolute;left:0;top:0;width:${input.width}px;height:${input.height}px;border:0}
#subs{position:absolute;left:0;top:0;width:${input.width}px;height:${input.height}px}
</style></head><body><div id="subs"></div><script type="module">
import { filmSubtitleFrameHtml } from './film-subtitle.mjs';
const cues = ${json(input.cues)};
const style = ${json({ ...input.style, on: true })};
const size = { w: ${input.width}, h: ${input.height} };
const subs = document.getElementById('subs');
const el = document.createElement('iframe');
el.id = 'film';
let inner = null;
const loaded = new Promise((ok) => el.addEventListener('load', ok, { once: true }));
el.src = '/film.html';
document.body.prepend(el);
const ready = loaded.then(async () => {
  const win = el.contentWindow;
  const t0 = performance.now();
  while (!(win.film && typeof win.film.frame === 'function')) {
    if (performance.now() - t0 > 10000) throw new Error('the film did not set window.film');
    await new Promise((r) => setTimeout(r, 20));
  }
  await (typeof win.film.ready === 'function' ? win.film.ready() : win.film.ready);
  inner = win;
});
window.film = {
  get duration() { return inner ? inner.film.duration : 0.001; },
  width: size.w, height: size.h,
  ready,
  async frame(t) {
    inner.filmHost?.time?.(t);
    await inner.film.frame(t);
    inner.filmHost?.settle?.(t);
    subs.innerHTML = filmSubtitleFrameHtml(cues, style, size, t * 1000);
    await document.fonts?.ready;
  },
};
window.__filmCuts = () => inner?.__filmCuts?.() ?? null;
window.__filmSounds = () => inner?.__filmSounds?.() ?? [];
</script></body></html>\n`;
  const module = new Uint8Array(input.subtitle_module_bytes);
  return { entry: NATIVE_SUBTITLE_BURN_ENTRY, files: [
    { relative_path: NATIVE_SUBTITLE_BURN_ENTRY, bytes: Buffer.from(page, 'utf8'), sha256: digestBytes(page) },
    { relative_path: '.film/cache/narralens-subtitle-burn/film-subtitle.mjs', bytes: module, sha256: digestBytes(module) },
  ] };
}
