import { createHash } from 'node:crypto';

export const NATIVE_SUBTITLE_MODULE_SHA256 = 'be4b1852bc254ff597e43694a732044ef51dd43a78df13735c2ff023957687dd';
export const NATIVE_SUBTITLE_BURN_ENTRY = '.film/cache/narralens-subtitle-burn/index.html';
const INVALID = 'Invalid native subtitle burn input';
const validationFailures = new WeakMap();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function requireInput(ok, message = INVALID) {
  if (!ok) { const error = new Error(message); validationFailures.set(error, message); throw error; }
}
/** Reject executable/accessor/non-JSON data before serialization. Native normalized cue/style fields are preserved. */
function requireJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { requireInput(Number.isFinite(value)); return; }
  requireInput(Array.isArray(value) || record(value));
  requireInput(!seen.has(value)); seen.add(value);
  requireInput(Object.getOwnPropertySymbols(value).length === 0);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      requireInput(descriptor && Object.hasOwn(descriptor, 'value')); requireJson(descriptor.value, seen);
    }
    requireInput(Object.getOwnPropertyNames(value).every(key => key === 'length' || (/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length)));
  } else {
    for (const key of Object.getOwnPropertyNames(value)) {
      requireInput(!['__proto__', 'constructor', 'prototype'].includes(key));
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      requireInput(descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value')); requireJson(descriptor.value, seen);
    }
  }
  seen.delete(value);
}

/**
 * Pure render-stage adapter of fixed exports.mjs private burnFilm; no evaluation of upstream source.
 * Input cues/style must come from the pinned public subtitlesForExport/readSubtitleStyle seam.
 * MAIN owns normalized native-style validation, staging EXCL writes, worker/graph pin and actual rendering.
 * This directly importable Node module never imports TS, creates a Job, writes a file or starts a process.
 */
export function buildPinnedNativeSubtitleBurnSource(input) {
  try {
    requireInput(record(input));
    requireInput(Object.getOwnPropertySymbols(input).length === 0);
    const keys = Object.getOwnPropertyNames(input);
    requireInput(keys.sort().join(',') === 'cues,frame_count,height,style,subtitle_module_bytes,width');
    for (const key of keys) requireInput(Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), 'value'));
    requireInput(Number.isSafeInteger(input.width) && input.width > 0 && Number.isSafeInteger(input.height) && input.height > 0 && Number.isSafeInteger(input.frame_count) && input.frame_count > 0, 'Invalid subtitle burn stage');
    requireInput(input.subtitle_module_bytes instanceof Uint8Array);
    const module = new Uint8Array(input.subtitle_module_bytes);
    requireInput(digest(module) === NATIVE_SUBTITLE_MODULE_SHA256, 'The fixed native subtitle renderer does not match');
    requireInput(Array.isArray(input.cues) && record(input.style));
    requireJson(input.cues); requireJson(input.style);
    requireInput(input.cues.length > 0 && input.cues.every(cue => record(cue) && typeof cue.text === 'string' && cue.text.trim().length > 0 && Number.isFinite(cue.startMs) && cue.startMs >= 0 && Number.isFinite(cue.durMs) && cue.durMs > 0 && cue.startMs + cue.durMs <= input.frame_count * 1000 / 30 + 1), 'Native subtitle cues must fit the complete film');
    const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
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
    return { entry: NATIVE_SUBTITLE_BURN_ENTRY, files: [
      { relative_path: NATIVE_SUBTITLE_BURN_ENTRY, bytes: Buffer.from(page, 'utf8'), sha256: digest(page) },
      { relative_path: '.film/cache/narralens-subtitle-burn/film-subtitle.mjs', bytes: module, sha256: digest(module) },
    ] };
  } catch (error) {
    // No input values, file paths, getter errors or upstream exception details escape this pure boundary.
    throw new Error(validationFailures.get(error) ?? INVALID);
  }
}
