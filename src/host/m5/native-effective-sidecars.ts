// @ts-nocheck -- vendored pinned JavaScript retained verbatim; public boundary types below.
/* MIT License

Copyright (c) 2026 OpenFilm contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Pinned native algorithms; no runtime source loading or evaluation.
Upstream e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3
{
  "src/film-doc.mjs": "feef7be8181e7ec63cf2b8760f3a32b7b7e22cd851d4e5a233c04f1768cf719d",
  "studio/server/film-subtitle.mjs": "be4b1852bc254ff597e43694a732044ef51dd43a78df13735c2ff023957687dd",
  "studio/server/subtitle-segments.mjs": "b4791b6ec527379aeedaa5329ee7efc3855b8b5dc99cf36db25c2d4652e5784f",
  "studio/server/transcripts.mjs": "ff2c765bec47e7238a56f787c88da7cd1eea3ce893c8fe2959f0a1bdc6da50d3",
  "studio/server/captions.mjs": "7a9bd076c307b6296be6e3d05153bf3f386aa01e97503d23f5d5deac1f0d2df0"
}
*/
import { posix } from 'node:path';

const NativeFilm = (() => {
/**
 * film.html: what it says. The one reading of a project's edit, shared by everything that plays it: Studio (its
 * preview and its export), and `look` / `render` (the timeline, timeline.mjs). A film that one of them accepts the
 * other accepts, and the same clip lands at the same seconds and the same place in both. Plain JavaScript with no
 * dependencies, so a browser page can import it as it is.
 *
 * The file is HTML; what it says is a value (`{ stage, tracks: [{ clips }] }`), the one every reader and editor works
 * on. The file is read into that value and the value written back into the file, changing only what changed.
 *
 *   readFilmFile(text)      → { value, doc, problems }: the file's edit, or every problem in it (nothing thrown)
 *   filmHtml(value, before) → the file that says `value`, written over `before` (what is unchanged stays as it was)
 *   readFilm(value)         → { doc, problems }: the normalized edit, or every problem in it
 *   parseFilm(value)        → doc, or an Error listing every problem
 *   clipSpan(clip, …)       → which seconds of its source a clip plays, and how long it lasts on the film
 *   pictureRect(kind, …)    → where a clip's picture lands on the stage (its `box`)
 */

const FILM_FILE = 'film.html';
/** The stage of a film that says none. */
const DEFAULT_STAGE = Object.freeze({ w: 1920, h: 1080 });
const SPEED_MIN = 0.25;
const SPEED_MAX = 4;
const TRIM_EPS = 1e-6;

const STILL_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'svg']);

/** A still picture (it has no length of its own: its clip's `time` is how long it stays). */
function isStill(src) {
  /* `> 0`: a name with no dot, or a dot file (`.jpg`), is not a picture */
  const dot = src.lastIndexOf('.');
  return dot > 0 && STILL_EXTENSIONS.has(src.slice(dot + 1).toLowerCase());
}

/**
 * What a sound is for: `sfx`, `music` and `voice` by a folder it is in (where openfilm get saves them:
 * assets/audio/sfx/, music/, vo/; an agent's own assets/sfx/ alike), the nearest one deciding; elsewhere a name that
 * says music (bed, music, song, loop…) or an effect (sfx, hit, whoosh…) decides; anything else (a video's own sound
 * among them) is a voice.
 */
function soundRole(src) {
  const path = String(src).toLowerCase();
  const folders = path.split('/').slice(0, -1).reverse();
  for (const folder of folders) {
    if (/^(sfx|fx|effects?|sound-?effects?)$/.test(folder)) return 'sfx';
    if (/^(music|bgm)$/.test(folder)) return 'music';
    if (/^(vo|voices?|voice-?over|narration)$/.test(folder)) return 'voice';
  }
  const name = path.split('/').pop() ?? '';
  if (/(^|[^a-z])(bed|music|song|soundtrack|score|theme|loop|ambient|ambience|beat)([^a-z]|$)/.test(name)) return 'music';
  if (/(^|[^a-z])(sfx|fx|hit|whoosh|swoosh|riser|impact|ding|chime)([^a-z]|$)/.test(name)) return 'sfx';
  return 'voice';
}

/** A web page clip: an .html file that sets `window.film` (SPEC.md). */
function isPage(src) {
  return /\.html?$/i.test(src);
}

const SOUND_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'aac', 'ogg', 'oga', 'opus', 'flac', 'aif', 'aiff', 'weba']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ogv']);

/** What a clip is, from its `src`: a web page, a video, a still picture or a sound; null when it is none of them. */
function clipKind(src) {
  if (typeof src !== 'string') return null;
  if (isPage(src)) return 'page';
  if (isStill(src)) return 'still';
  const ext = src.slice(src.lastIndexOf('.') + 1).toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (SOUND_EXTENSIONS.has(ext)) return 'sound';
  return null;
}

/**
 * What a clip is: its file's kind (clipKind), but a clip of a video's sound alone (`sound: true`, an <audio> of a
 * video file in film.html, as when its sound is taken apart from its picture) is a sound.
 */
function kindOf(clip) {
  const kind = clipKind(clip?.src);
  return clip?.sound === true && kind === 'video' ? 'sound' : kind;
}

/** A clip that draws a picture (everything but a sound). */
function hasPicture(src) {
  const kind = clipKind(src);
  return kind != null && kind !== 'sound';
}

/* ── reading ─────────────────────────────────────────────────────────────── */

const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isFinite = (v) => typeof v === 'number' && Number.isFinite(v);
const isPositive = (v) => isFinite(v) && v > 0;
const pair = (v, ok) => Array.isArray(v) && v.length === 2 && ok(v[0]) && ok(v[1]);

/** The fields each kind of clip takes, in the order they are written back. */
const CLIP_FIELDS = {
  page: ['src', 'id', 'at', 'time', 'box', 'size', 'class', 'style', 'overrides', 'attrs'],
  video: ['src', 'id', 'at', 'time', 'box', 'volume', 'speed', 'class', 'style', 'overrides', 'attrs'],
  still: ['src', 'id', 'at', 'time', 'box', 'class', 'style', 'overrides', 'attrs'],
  sound: ['src', 'id', 'sound', 'at', 'time', 'volume', 'speed', 'overrides', 'attrs'],
};
/** Attributes a clip keeps that say nothing to the film: a description, a person's own data. */
const KEPT_ATTRIBUTE = /^(alt|title|lang|dir|data-[a-z0-9-]+|aria-[a-z]+)$/;
/** What a track keeps of its element that says nothing to the film: a name, a class, a description. */
const KEPT_TRACK_ATTRIBUTE = /^(id|class|title|lang|dir|data-[a-z0-9-]+|aria-[a-z]+)$/;
const OVERRIDE_FIELDS = ['at', 'n', 't', 's', 'r', 'style', 'lock', 'text', 'fade'];
const BOX_FIELDS = ['x', 'y', 'w', 'h', 'r'];
/** The largest side a page is laid out at (`size`): a stage's. */
const PAGE_SIZE_MAX = 8192;
/** A copy of `row` with only `fields`, in that order: what is written back reads the same every time. */
const ordered = (row, fields) => Object.fromEntries(fields.filter((k) => row[k] !== undefined).map((k) => [k, row[k]]));
const TRACK_FIELDS = ['clips', 'locked', 'hidden', 'muted', 'attrs'];

function unknownKeys(row, allowed, where, problems) {
  const extra = Object.keys(row).filter((k) => !allowed.includes(k));
  if (extra.length) problems.push(`${where}unrecognised field: ${extra.join(' · ')}`);
}

function checkTime(v, where, problems) {
  if (!Array.isArray(v) || (v.length !== 1 && v.length !== 2) || !v.every(isFinite)) {
    problems.push(`${where}its part of the file has to be [start, end] in seconds (#t=start,end).`);
    return;
  }
  if (v[0] < 0) problems.push(`${where}its part of the file (#t=${v.join(',')}) cannot start below 0.`);
  if (v.length === 2 && !(v[1] > v[0])) problems.push(`${where}its part of the file (#t=${v.join(',')}) has to end after it starts.`);
}

function checkBox(v, where, problems) {
  if (!isObject(v)) { problems.push(`${where}its place has to be left and top in px from the picture's top-left (style="left: 200px; top: 300px"), with a width and height if it has its own.`); return; }
  unknownKeys(v, BOX_FIELDS, `${where}its place: `, problems);
  if (!isFinite(v.x) || !isFinite(v.y)) problems.push(`${where}its place needs left and top: px from the picture's top-left.`);
  for (const [k, prop] of [['w', 'width'], ['h', 'height']]) if (v[k] !== undefined && !isPositive(v[k])) problems.push(`${where}${prop} has to be px above 0.`);
  if (v.r !== undefined && !isFinite(v.r)) problems.push(`${where}rotate has to be a number of degrees.`);
}

function checkOverride(o, where, problems, kind) {
  if (!isObject(o)) { problems.push(`${where}an override has to be an object: { "at": "#title", … }.`); return; }
  /* an entry without `at` is the clip's own: its fades */
  if (o.at === undefined) {
    unknownKeys(o, ['fade'], `${where}the clip's own entry (no at) holds fade only: `, problems);
    if (!pair(o.fade, (v) => isFinite(v) && v >= 0)) problems.push(`${where}fade has to be [in, out]: seconds, 0 or more.`);
    return;
  }
  if (kind !== 'page') { problems.push(`${where}at names an element inside a web page; this clip is not one (its own entry has no at: { "fade": [in, out] }).`); return; }
  unknownKeys(o, OVERRIDE_FIELDS.filter((k) => k !== 'fade'), where, problems);
  if (typeof o.at !== 'string' || !o.at || o.at.length > 512) problems.push(`${where}at has to be a CSS selector of the element.`);
  if (o.n !== undefined && !(Number.isInteger(o.n) && o.n > 0)) problems.push(`${where}n has to be a whole number from 1.`);
  if (o.t !== undefined && !pair(o.t, isFinite)) problems.push(`${where}t has to be [x, y] in px.`);
  if (o.s !== undefined && !isPositive(o.s) && !pair(o.s, isPositive)) problems.push(`${where}s has to be a multiplier above 0, or [x, y].`);
  if (o.r !== undefined && !isFinite(o.r)) problems.push(`${where}r has to be a number of degrees.`);
  if (o.style !== undefined) {
    const entries = isObject(o.style) ? Object.entries(o.style) : null;
    /* a value up to 2000 characters: a mask's inline SVG (`mask-image: url("data:image/svg+xml,…")`) runs to a few hundred */
    if (!entries || entries.length > 24
      || !entries.every(([k, v]) => /^[a-zA-Z]{1,40}$/.test(k) && ((typeof v === 'string' && v.length <= 2000) || isFinite(v)))) {
      problems.push(`${where}style has to be at most 24 camelCase properties, each text or a number.`);
    }
  }
  if (o.lock !== undefined && o.lock !== true) problems.push(`${where}lock is true, or not written.`);
  if (o.text !== undefined && (typeof o.text !== 'string' || o.text.length > 2000)) problems.push(`${where}text has to be text (at most 2000 characters).`);
}

/** One clip, checked for what its file is. Returns the clip with its fields in their written order. */
function readClip(raw, where, problems) {
  if (!isObject(raw)) { problems.push(`${where}: a clip has to be an object: { "src": …, "at": … }.`); return null; }
  const at = `${where}: `;
  if (typeof raw.src !== 'string' || !raw.src) {
    unknownKeys(raw, [...new Set(Object.values(CLIP_FIELDS).flat())], at, problems);
    problems.push(`${at}src has to be a path, relative to ${FILM_FILE}.`);
    return null;
  }
  /* a path written on Windows (path.join) uses `\`: a film's paths are `/` everywhere, as in a URL */
  if (raw.src.includes('\\') && !/^[a-z][a-z0-9+.-]*:/i.test(raw.src)) raw = { ...raw, src: raw.src.replace(/\\/g, '/') };
  if (raw.sound !== undefined && !(raw.sound === true && clipKind(raw.src) === 'video')) {
    problems.push(`${at}sound is true, on a clip of a video file's sound alone.`);
    return null;
  }
  const kind = kindOf(raw);
  if (!kind) {
    problems.push(`${at}src has to be a web page (.html), a video, a picture or a sound file — "${raw.src}" is none of them.`);
    return null;
  }
  const before = problems.length;
  /* times are kept to the millisecond (SPEC), in place like the ids (fillClipIds): what is written back is what was
     read. Finer is noise no frame shows, and clips that touch would overlap by it */
  if (typeof raw.at === 'number' && isFinite(raw.at)) raw.at = toMs(raw.at);
  if (Array.isArray(raw.time)) raw.time = raw.time.map((v) => (typeof v === 'number' && isFinite(v) ? toMs(v) : v));
  if (raw.at !== undefined && typeof raw.at !== 'number') {
    problems.push(`${at}at has to be a number of seconds from the film's start: work out the number before writing it.`);
    return null;
  }
  if (raw.time != null && !Array.isArray(raw.time)) {
    problems.push(`${at}its part of the file has to be #t=start,end in seconds.`);
    return null;
  }
  unknownKeys(raw, CLIP_FIELDS[kind], at, problems);
  if (typeof raw.id !== 'string' || !raw.id) problems.push(`${at}every clip needs an id, unique across the film`);
  if (raw.at !== undefined && !(isFinite(raw.at) && raw.at >= 0)) problems.push(`${at}at has to be seconds from the film's start (0 or more).`);
  if (raw.time !== undefined) checkTime(raw.time, at, problems);
  if (raw.volume !== undefined && CLIP_FIELDS[kind].includes('volume') && !(isFinite(raw.volume) && raw.volume >= 0)) problems.push(`${at}volume has to be 0 or more (1 is the original level).`);
  if (raw.speed !== undefined && CLIP_FIELDS[kind].includes('speed') && !(isFinite(raw.speed) && raw.speed >= SPEED_MIN && raw.speed <= SPEED_MAX)) {
    problems.push(`${at}speed has to be a number from ${SPEED_MIN} to ${SPEED_MAX}.`);
  }
  if (raw.box !== undefined && kind !== 'sound') checkBox(raw.box, at, problems);
  if (raw.size !== undefined && !(isObject(raw.size) && Object.keys(raw.size).length === 2 && [raw.size.w, raw.size.h].every((v) => Number.isInteger(v) && v > 0 && v <= PAGE_SIZE_MAX))) {
    problems.push(`${at}size is the px a page is laid out at, whole numbers up to ${PAGE_SIZE_MAX}: { "w": 1920, "h": 1080 }.`);
  }
  if (raw.overrides !== undefined) {
    if (!Array.isArray(raw.overrides) || raw.overrides.length > 200) problems.push(`${at}overrides has to be a list (at most 200).`);
    else {
      /* fades to the millisecond, as every time is */
      for (const o of raw.overrides) if (isObject(o) && Array.isArray(o.fade)) o.fade = o.fade.map((v) => (typeof v === 'number' && isFinite(v) ? toMs(v) : v));
      raw.overrides.forEach((o, i) => checkOverride(o, `${at}overrides[${i}]: `, problems, kind));
      const own = raw.overrides.filter((o) => isObject(o) && o.at === undefined);
      if (own.length > 1) problems.push(`${at}overrides has one entry of the clip's own (without at), not ${own.length}.`);
      /* both fades fit in the clip, when its length is written (a still's, or a fragment's end) */
      const fade = own[0]?.fade;
      const length = Array.isArray(raw.time) && raw.time.length === 2 && raw.time.every(isFinite) ? (raw.time[1] - raw.time[0]) / (CLIP_FIELDS[kind].includes('speed') && isFinite(raw.speed) && raw.speed > 0 ? raw.speed : 1) : null;
      if (pair(fade, isFinite) && length != null && fade[0] + fade[1] > length + 1e-3) {
        problems.push(`${at}fade [${fade.join(', ')}] is longer than the clip (${toMs(length)} s): in + out fit in its length.`);
      }
    }
  }
  if (raw.class !== undefined && (typeof raw.class !== 'string' || !raw.class.trim())) problems.push(`${at}class has to be class names.`);
  if (raw.style !== undefined && (typeof raw.style !== 'string' || !raw.style.trim())) problems.push(`${at}style has to be CSS declarations.`);
  if (raw.attrs !== undefined && !(isObject(raw.attrs) && Object.entries(raw.attrs).every(([k, v]) => (KEPT_ATTRIBUTE.test(k) || (kind === 'sound' && k === 'class')) && typeof v === 'string'))) {
    problems.push(`${at}attrs has to be text attributes: alt, title, lang, dir, data-* or aria-*.`);
  }
  if (problems.length > before) return null;
  const clip = ordered(raw, CLIP_FIELDS[kind]);
  if (clip.box) clip.box = ordered(clip.box, BOX_FIELDS);
  if (clip.size) clip.size = { w: clip.size.w, h: clip.size.h };
  if (clip.overrides) clip.overrides = clip.overrides.map((o) => ordered(o, OVERRIDE_FIELDS));
  return clip;
}

/** Seconds, to the millisecond. @param {number} s */
const toMs = (s) => Math.round(s * 1000) / 1000 || 0;

/** A name without the dashes at its ends (by index: a pattern for it backtracks over a long run of them). */
function trimDashes(/** @type {string} */ name) {
  let start = 0, end = name.length;
  while (start < end && name[start] === '-') start++;
  while (end > start && name[end - 1] === '-') end--;
  return name.slice(start, end);
}

/**
 * The name a clip gets when it has none: its source's file name (`assets/audio/vo/02-turn.m4a` → `02-turn`), with
 * `-2`, `-3` when taken. Letters are Unicode letters: a file named in Chinese keeps its name.
 */
function clipIdFor(src, used) {
  const base = (src ?? '').split(/[/\\]/).pop() ?? '';
  const stem = trimDashes(base.replace(/\.[A-Za-z0-9]+$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-')) || 'clip';
  const taken = new Set(used);
  if (!taken.has(stem)) return stem;
  let n = 2;
  while (taken.has(`${stem}-${n}`)) n++;
  return `${stem}-${n}`;
}

/**
 * Name the clips that have no id, in place (before checking, so every clip downstream has a name). In place on
 * purpose: what is written back is what was read, so a name, once given, stays put on disk.
 */
function fillClipIds(tracks) {
  const taken = new Set();
  const blank = [];
  for (const track of tracks) {
    if (!isObject(track) || !Array.isArray(track.clips)) continue;
    for (const clip of track.clips) {
      if (!isObject(clip)) continue;
      if (typeof clip.id === 'string' && clip.id) taken.add(clip.id);
      else blank.push(clip);
    }
  }
  for (const clip of blank) {
    clip.id = clipIdFor(typeof clip.src === 'string' ? clip.src : undefined, taken);
    taken.add(clip.id);
  }
}

/**
 * Read an edit. Returns the normalized edit (fields in their written order) and every
 * problem found; `doc` is null when there is any (`whole`: the problem is with the edit as a whole, so nothing in it
 * was checked). Clips without an id are named in `value` itself (see fillClipIds).
 */
function readFilm(value) {
  /* a problem with the whole (a wrong stage, no tracks) stops the reading: nothing below it can be checked */
  const fail = (message) => ({ doc: null, problems: [message], whole: true });
  if (!isObject(value)) return fail(`${FILM_FILE} has to be read as a stage and its tracks.`);
  if ('clips' in value && !('tracks' in value)) {
    return fail(`${FILM_FILE} holds its clips in tracks: each <section> is a track.`);
  }
  const extra = Object.keys(value).filter((k) => !['stage', 'tracks'].includes(k));
  if (extra.length) return fail(`${FILM_FILE} is a stage and its tracks; there is nothing else: ${extra.join(' · ')}`);
  const stage = value.stage ?? DEFAULT_STAGE;
  if (!isObject(stage) || !(Number.isInteger(stage.w) && stage.w > 0) || !(Number.isInteger(stage.h) && stage.h > 0)) {
    return fail(`${FILM_FILE} wants a picture size of positive whole numbers: <meta name="viewport" content="width=1920, height=1080"> (without one, it is 1920 × 1080).`);
  }
  if (!Array.isArray(value.tracks)) return fail(`${FILM_FILE} needs its tracks: each <section> is one.`);
  fillClipIds(value.tracks);

  const problems = [];
  const tracks = [];
  const seen = new Map();
  value.tracks.forEach((row, ti) => {
    if (!isObject(row)) { problems.push(`tracks[${ti}]: a track is a <section> of clips.`); return; }
    const extraKeys = Object.keys(row).filter((k) => !TRACK_FIELDS.includes(k));
    if (extraKeys.length) problems.push(`tracks[${ti}]: unrecognised field: ${extraKeys.join(' · ')}`);
    if (!Array.isArray(row.clips)) { problems.push(`tracks[${ti}]: a track is a <section> of clips; this one has none to read.`); return; }
    const clips = [];
    row.clips.forEach((raw, ci) => {
      const src = isObject(raw) && typeof raw.src === 'string' ? ` "${raw.src}"` : '';
      const where = `tracks[${ti}].clips[${ci}]${src}`;
      const clip = readClip(raw, where, problems);
      if (!clip) return;
      const dup = seen.get(clip.id);
      if (dup != null) {
        problems.push(`tracks[${ti}].clips[${ci}] and ${dup} both have the id "${clip.id}" — every clip id has to be unique.`);
        return;
      }
      seen.set(clip.id, `tracks[${ti}].clips[${ci}]`);
      clips.push(clip);
    });
    for (const flag of ['locked', 'hidden', 'muted']) {
      if (row[flag] != null && typeof row[flag] !== 'boolean') { problems.push(`tracks[${ti}]: ${flag} has to be true / false.`); return; }
    }
    if (row.attrs !== undefined && !(isObject(row.attrs) && Object.entries(row.attrs).every(([k, v]) => KEPT_TRACK_ATTRIBUTE.test(k) && typeof v === 'string'))) {
      problems.push(`tracks[${ti}]: attrs has to be text attributes: id, class, title, lang, dir, data-* or aria-*.`);
      return;
    }
    tracks.push({ clips, ...(row.locked === true ? { locked: true } : {}), ...(row.hidden === true ? { hidden: true } : {}), ...(row.muted === true ? { muted: true } : {}), ...(row.attrs && Object.keys(row.attrs).length ? { attrs: row.attrs } : {}) });
  });
  if (problems.length) return { doc: null, problems };
  return { doc: { stage: { w: stage.w, h: stage.h }, tracks }, problems };
}

/** The edit, or an Error that lists every problem in it. */
function parseFilm(value) {
  const { doc, problems, whole } = readFilm(value);
  if (doc) return doc;
  throw new Error(whole ? problems[0] : `${FILM_FILE} has ${problems.length} problem${problems.length > 1 ? 's' : ''}:\n  ${problems.join('\n  ')}`);
}

/* ── timing ──────────────────────────────────────────────────────────────── */

/** The rate a clip plays its source at: 1 for web pages and stills, which have no `speed`. */
function clipSpeed(clip) {
  const kind = kindOf(clip);
  if (kind === 'page' || kind === 'still') return 1;
  const v = clip.speed;
  return isFinite(v) && v >= SPEED_MIN && v <= SPEED_MAX ? v : 1;
}

/**
 * Which part of its source a clip plays and how long it lasts on the film.
 *
 * `native`: the source's own length in seconds: a video's or a sound's file length, a web page's duration. Not
 * needed for a still, whose `time` is its length (a still is a source of endless length, cut by `time`), and none
 * for a page without a duration, which has no end either: its `time` is its length too.
 *
 * Returns `{ from, to, speed, length }`: the source seconds [from, to) and the film seconds the clip takes,
 * `(to − from) / speed`. A web page may run past its own end (it holds its last frame); a file may not. Throws, with
 * the clip named by `where`, when the trim is impossible.
 */
function clipSpan(clip, native, where = 'clip') {
  const kind = kindOf(clip);
  const time = clip.time ?? [];
  const from = time[0] ?? 0;
  const still = kind === 'still';
  if (still) {
    if (!(time.length === 2 && time[1] > 0)) {
      throw new Error(`${where}: a still has no length of its own — say how long it stays with a media fragment, e.g. src="photo.png#t=0,4".`
        + '\n  On a video or a sound #t= is a trim into the file; on a picture there is nothing to trim,'
        + ' so those two numbers are the length.');
    }
    return { from, to: time[1], speed: 1, length: time[1] - from };
  }
  if (!(isFinite(native) && native > 0) && time.length !== 2) {
    if (kind === 'page') {
      throw new Error(`${where}: this page has no duration, so it has no end of its own — say how long it plays with a media fragment, e.g. src="title.html#t=0,4".`
        + '\n  A page with a duration plays all of it without #t=; a page without one is like a still.');
    }
    throw new Error(`${where}: no length to trim against.`);
  }
  const to = time[1] ?? native;
  if (from < -TRIM_EPS) throw new Error(`${where}: #t=${from},… starts below 0 (#t= is a part of the file, within [0, its length]).`);
  if (to + TRIM_EPS < from) throw new Error(`${where}: #t=${from},${to} has to end after it starts.`);
  if (kind !== 'page' && isFinite(native) && native > 0) {
    if (to > native + TRIM_EPS) throw new Error(`${where}: #t=${from},${to} ends past the file's length of ${native} s (#t= is a part of the file, within [0, its length]).`);
    if (from > native + TRIM_EPS) throw new Error(`${where}: #t=${from},${to} starts past the file's length of ${native} s (#t= is a part of the file, within [0, its length]).`);
  }
  const speed = clipSpeed(clip);
  return { from, to, speed, length: (to - from) / speed };
}

/**
 * The source second a clip shows `localSec` into the film's span of it. A web page past its own end holds its last
 * frame (`native` − 1 ms: the page's frame(t) takes t in [0, duration)).
 */
function sourceAt(span, localSec, clip, native) {
  const t = span.from + localSec * span.speed;
  return kindOf(clip) === 'page' && isFinite(native) ? Math.max(0, Math.min(t, native - 1e-3)) : t;
}

/* ── fades ───────────────────────────────────────────────────────────────── */

/** A clip's fades, `[in, out]` in seconds (its overrides' entry without `at`), or null when it has none. */
function clipFade(clip) {
  const own = Array.isArray(clip?.overrides) ? clip.overrides.find((o) => isObject(o) && o.at === undefined) : null;
  const fade = own?.fade;
  return pair(fade, (v) => isFinite(v) && v >= 0) && (fade[0] > 0 || fade[1] > 0) ? [fade[0], fade[1]] : null;
}

/**
 * How much of a clip shows and is heard `local` seconds into its `length` on the film, 0 to 1: a straight ramp up
 * over its first `fade[0]` seconds and down over its last `fade[1]` (SPEC §1). Fades longer together than the clip
 * (its length not written in the file) are shortened alike to fit.
 */
function fadeGain(local, length, fade) {
  if (!fade || !(length > 0)) return 1;
  const k = fade[0] + fade[1] > length ? length / (fade[0] + fade[1]) : 1;
  const fin = fade[0] * k, fout = fade[1] * k;
  let g = 1;
  if (fin > 0) g = Math.min(g, local / fin);
  if (fout > 0) g = Math.min(g, (length - local) / fout);
  return Math.max(0, Math.min(1, g));
}

/** A clip's fades fitted to its `length` (see fadeGain), or null. @returns {[number, number] | null} */
function fittedFade(fade, length) {
  if (!fade || !(length > 0)) return null;
  const k = fade[0] + fade[1] > length ? length / (fade[0] + fade[1]) : 1;
  return [fade[0] * k, fade[1] * k];
}

/* ── placement ───────────────────────────────────────────────────────────── */

/**
 * Where a clip's picture lands on the stage. `kind` is the clip's (see clipKind); `own` the picture's own size: a
 * page's width × height (when it sets none, its clip's `size`, else the stage's), a video's or still's pixels. The box's w and h, its own size
 * without them, and with only one of them the other follows the picture's proportions. A video or still is its box
 * (the stage without one), the picture inside it as CSS says; a page is fitted whole inside its box and centered (its
 * own size, centered, without one). Returns the rectangle drawn `{ x, y, w, h }` before it turns, and `r`: degrees clockwise
 * about its center, which is the box's.
 */
function pictureRect(kind, own, stage, box) {
  const [ow, oh] = own?.w > 0 && own?.h > 0 ? [own.w, own.h] : [stage.w, stage.h];
  const b = box ?? (kind === 'page' ? { x: (stage.w - ow) / 2, y: (stage.h - oh) / 2 } : { x: 0, y: 0, w: stage.w, h: stage.h });
  const bw = b.w ?? (b.h != null ? (b.h * ow) / oh : ow);
  const bh = b.h ?? (b.w != null ? (b.w * oh) / ow : oh);
  /* a video or still is its box; how the picture sits in it is CSS (object-fit: contain, unless the film says) */
  if (kind !== 'page') return { x: b.x, y: b.y, w: bw, h: bh, r: b.r ?? 0 };
  const k = Math.min(bw / ow, bh / oh);
  const w = ow * k, h = oh * k;
  return { x: b.x + (bw - w) / 2, y: b.y + (bh - h) / 2, w, h, r: b.r ?? 0 };
}

/* ── film.html: the file ──────────────────────────────────────────────────── */

/*
 * A film is a web page. Its <head> is the page's own (styles, fonts, the stage's size as the viewport); its <body> is
 * the tracks, each a <section>, the first on top, and each track's clips: <iframe> a web page, <video>, <img> a still,
 * <audio> a sound. Which seconds of its source a clip plays is a media fragment on its src (`a.mp4#t=2,6`); where it
 * starts on the film, `at`; where its picture sits, `left`, `top`, `width`, `height` and `rotate` in its own style;
 * how it looks, any other CSS. The reader below takes no more than that, and says where anything else is.
 */

/** The element of each kind of clip, and back. */
const KIND_OF_TAG = { iframe: 'page', video: 'video', img: 'still', audio: 'sound' };
const TAG_OF_KIND = { page: 'iframe', video: 'video', still: 'img', sound: 'audio' };
/** Where a picture sits: these of its style, in stage px (rotate in degrees), and nothing else may move it. */
const BOX_OF_PROP = { left: 'x', top: 'y', width: 'w', height: 'h', rotate: 'r' };
/** What the film sets itself (BOX_OF_PROP does the placing): written in a clip's style, it would fight the film. */
const PLACING = new Set(['position', 'inset', 'right', 'bottom', 'margin', 'transform', 'translate', 'scale', 'z-index', 'visibility', 'display']);
const TRACK_FLAGS = ['hidden', 'muted', 'locked'];
/** CSS that moves in time: a film's styles hold still (they would run on the film's clock, not a clip's). */
const TIMED = /^(animation|transition)(-|$)/;
const STILL_CSS = 'a film\'s CSS holds still — what moves is a web page of its own, a clip (its animation runs on the clip\'s time; in film.html it would run on the film\'s).';
/** A clip's attributes, each with what it says. */
const CLIP_ATTRIBUTES = new Set(['id', 'src', 'at', 'speed', 'volume', 'muted', 'size', 'class', 'style', 'overrides']);

/** What one kind of clip does not take, and why. */
const NO_SOUND = 'has no sound: a sound is a clip of its own, an <audio> (or a <video>\'s own sound)';
const PAGE_ONLY = 'size is the px a web page is laid out at: a file has its own size.';
const NOT_OF_KIND = {
  page: { volume: `a page ${NO_SOUND}.`, muted: `a page ${NO_SOUND}.`, speed: 'a page has no speed: its own frame(t) decides how fast it moves.' },
  video: { size: PAGE_ONLY },
  still: { volume: `a still ${NO_SOUND}.`, muted: `a still ${NO_SOUND}.`, speed: 'a still has no speed: it holds for as long as its #t=0,length.', size: PAGE_ONLY },
  sound: { style: 'a sound has no look: it is heard, not seen.', size: PAGE_ONLY },
};

/**
 * What an agent writes from elsewhere (other editors, web pages, HyperFrames), answered with what it is here.
 */
const ATTRIBUTE_HINTS = {
  time: 'the part of the file goes on src as a media fragment: src="a.mp4#t=2,6" (its seconds 2 to 6)',
  start: 'at="…" (the film second it starts at)',
  'data-start': 'at="…" (the film second it starts at)',
  offset: 'at="…" (the film second it starts at)',
  duration: 'src="…#t=start,end" (which seconds of the file it plays; a still, or a page without a duration: #t=0,length)',
  'data-duration': 'src="…#t=start,end" (which seconds of the file it plays; a still, or a page without a duration: #t=0,length)',
  end: 'src="…#t=start,end" (which seconds of the file it plays)',
  'data-track-index': 'nothing: a clip\'s track is the <section> it is in (the first section is on top)',
  track: 'nothing: a clip\'s track is the <section> it is in (the first section is on top)',
  width: 'style="width: …px" (stage px)',
  height: 'style="height: …px" (stage px)',
  rate: 'speed="…"',
  playbackrate: 'speed="…"',
  gain: 'volume="…" (1 is the file\'s own level, 0 silent)',
  autoplay: 'nothing: the film plays its clips itself',
  controls: 'nothing: the film plays its clips itself',
  loop: 'nothing: the film plays its clips itself; a clip plays its part of the file once',
  playsinline: 'nothing: the film plays its clips itself',
  preload: 'nothing: the film loads its clips itself',
  loading: 'nothing: the film loads its clips itself',
  poster: 'nothing: a video shows its own frames',
  frameborder: 'nothing: a page clip has no border',
  scrolling: 'nothing: a page clip never scrolls',
  allow: 'nothing',
  allowfullscreen: 'nothing',
};

/** What a page's head holds; any other element begins the body. */
const HEAD_TAGS = new Set(['html', 'head', 'meta', 'link', 'style', 'title', 'base', 'script', 'noscript']);
const VOID_TAGS = new Set(['img', 'meta', 'link', 'br', 'hr', 'base', 'input', 'source', 'track', 'col', 'area', 'embed', 'param', 'wbr']);
/** Elements whose content is text up to their end tag, not markup. */
const RAW_TEXT = new Set(['script', 'style', 'iframe', 'textarea', 'title', 'xmp', 'noembed', 'noframes', 'noscript']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

const decode = (v) => v.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENTITIES[e.toLowerCase()] ?? all;
});
const escapeAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * The markup of an HTML text, as a list: start tags (with their attributes, in order), end tags, comments and text,
 * each with where it is. The content of an element of RAW_TEXT is one text. Enough of HTML for a film's file: tags,
 * quoted and bare attribute values, comments, a doctype.
 */
function markup(text) {
  const out = [];
  let i = 0;
  const textUpTo = (end) => { if (end > i) out.push({ type: 'text', start: i, end, text: text.slice(i, end) }); i = end; };
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) { textUpTo(text.length); break; }
    textUpTo(lt);
    if (text.startsWith('<!--', i)) {
      const close = text.indexOf('-->', i + 4);
      const end = close < 0 ? text.length : close + 3;
      out.push({ type: 'comment', start: i, end });
      i = end;
      continue;
    }
    if (text[i + 1] === '!' || text[i + 1] === '?') {
      const end = text.indexOf('>', i) < 0 ? text.length : text.indexOf('>', i) + 1;
      out.push({ type: 'doctype', start: i, end });
      i = end;
      continue;
    }
    const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(text.slice(i, i + 64));
    if (!tag) { textUpTo(i + 1); continue; }
    const closing = tag[1] === '/';
    const name = tag[2].toLowerCase();
    let j = i + tag[0].length;
    const attrs = [];
    let selfClosing = false;
    for (;;) {
      while (j < text.length && /\s/.test(text[j])) j++;
      if (j >= text.length) break;
      if (text[j] === '>') { j++; break; }
      if (text.startsWith('/>', j)) { selfClosing = true; j += 2; break; }
      if (text[j] === '/') { j++; continue; }
      const at = /^[^\s"'>\/=]+/.exec(text.slice(j, j + 256));
      if (!at) { j++; continue; }
      const attr = { name: at[0].toLowerCase(), value: '', start: j, end: j + at[0].length, bare: true };
      j += at[0].length;
      let k = j;
      while (k < text.length && /\s/.test(text[k])) k++;
      if (text[k] === '=') {
        k++;
        while (k < text.length && /\s/.test(text[k])) k++;
        const q = text[k];
        if (q === '"' || q === "'") {
          const close = text.indexOf(q, k + 1);
          const stop = close < 0 ? text.length : close;
          attr.value = decode(text.slice(k + 1, stop));
          j = Math.min(text.length, stop + 1);
        } else {
          const bare = /^[^\s>]*/.exec(text.slice(k))[0];
          attr.value = decode(bare);
          j = k + bare.length;
        }
        attr.bare = false;
        attr.end = j;
      }
      attrs.push(attr);
    }
    out.push({ type: closing ? 'close' : 'open', name, attrs, start: i, end: j, selfClosing });
    i = j;
    if (!closing && RAW_TEXT.has(name)) {
      const close = new RegExp(`</${name}\\s*>`, 'i').exec(text.slice(i));
      const end = close ? i + close.index : text.length;
      if (end > i) out.push({ type: 'text', start: i, end, text: text.slice(i, end), raw: true });
      i = end;
      if (close) { out.push({ type: 'close', name, attrs: [], start: end, end: end + close[0].length }); i = end + close[0].length; }
    }
  }
  return out;
}

/** The line a place in the text is on, from 1. */
const lineAt = (text, at) => { let n = 1; for (let i = 0; i < at; i++) if (text.charCodeAt(i) === 10) n++; return n; };

/** Seconds as a media fragment writes them: plain seconds, `mm:ss` or `hh:mm:ss`, each with a fraction. */
function fragmentSeconds(v) {
  const s = v.replace(/^npt:/, '').trim();
  if (s === '') return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
}

/** A style attribute's declarations, in order: `[property, value]`, the property in lower case. */
function declarations(style) {
  const out = [];
  let depth = 0, quote = '', from = 0;
  const take = (to) => {
    const part = style.slice(from, to);
    const colon = part.indexOf(':');
    if (colon > 0) out.push([part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim()]);
    else if (part.trim()) out.push([part.trim().toLowerCase(), '']);
  };
  for (let i = 0; i < style.length; i++) {
    const ch = style[i];
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) { take(i); from = i + 1; }
  }
  take(style.length);
  return out;
}

/** A number of `unit` (`56px`, `12deg`; a bare 0 too), or NaN. */
const amount = (v, unit) => { const m = new RegExp(`^(-?\\d+(?:\\.\\d+)?|-?\\.\\d+)${unit}$`).exec(v.trim()); return m ? Number(m[1]) : v.trim() === '0' ? 0 : NaN; };

/** How an element is called in a problem: its tag, with its id or its file. */
function named(tag) {
  const id = tag.attrs.find((a) => a.name === 'id')?.value;
  const src = tag.attrs.find((a) => a.name === 'src')?.value;
  return `<${tag.name}${id ? ` id="${id}"` : src ? ` src="${src}"` : ''}>`;
}

/** One clip's element as the value's clip (unchecked: readFilm checks it), or null with what is wrong said. */
function clipOfTag(tag, where, problems) {
  const kind = KIND_OF_TAG[tag.name];
  const raw = {};
  const attrs = {};
  const before = problems.length;
  let muted = false;
  for (const a of tag.attrs) {
    const { name, value } = a;
    /* a sound's class names it, nothing more: it has no look */
    if (kind === 'sound' && name === 'class') { if (value.trim()) attrs.class = value; continue; }
    if (NOT_OF_KIND[kind]?.[name]) { problems.push(`${where}: ${NOT_OF_KIND[kind][name]}`); continue; }
    if (!CLIP_ATTRIBUTES.has(name)) {
      const hint = ATTRIBUTE_HINTS[name];
      if (!hint && KEPT_ATTRIBUTE.test(name)) { attrs[name] = value; continue; }
      problems.push(`${where}: ${name} is not an attribute of a clip${hint ? ` → ${hint}` : ' (a clip takes id, src, at, speed, volume, muted, class and style)'}.`);
      continue;
    }
    if (name === 'id') { if (value) raw.id = value; }
    else if (name === 'src') {
      const hash = value.indexOf('#');
      raw.src = hash < 0 ? value : value.slice(0, hash);
      if (hash >= 0) {
        const m = /^t=([^,]*)(?:,(.*))?$/.exec(value.slice(hash + 1));
        const from = m ? fragmentSeconds(m[1]) : NaN;
        const to = m && m[2] !== undefined ? fragmentSeconds(m[2]) : undefined;
        if (!m || !Number.isFinite(from) || (to !== undefined && !Number.isFinite(to))) {
          problems.push(`${where}: src's fragment says which seconds of the file it plays, like src="a.mp4#t=2,6" (2 s to 6 s) or "#t=2" (2 s to the end) — "${value.slice(hash)}" is not that.`);
        } else if (to !== undefined) raw.time = [from, to];
        else if (from > 0) raw.time = [from];
      }
    } else if (name === 'class') { if (value.trim()) raw.class = value.trim().split(/\s+/).join(' '); }
    else if (name === 'size') {
      const m = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(value);
      if (!m) problems.push(`${where}: size is the px the page is laid out at, width x height, like size="1920x1080" — "${value}" is not.`);
      else raw.size = { w: Number(m[1]), h: Number(m[2]) };
    }
    else if (name === 'muted') muted = true;
    else if (name === 'overrides') {
      try { raw.overrides = JSON.parse(value); }
      catch { problems.push(`${where}: overrides is Studio's list of the person's changes, as JSON — it does not read as JSON.`); }
    } else if (name === 'style') {
      const rest = [];
      for (const [prop, v] of declarations(value)) {
        if (BOX_OF_PROP[prop]) {
          const n = amount(v, prop === 'rotate' ? 'deg' : 'px');
          if (!Number.isFinite(n)) problems.push(`${where}: ${prop} is ${prop === 'rotate' ? 'degrees, like rotate: 8deg' : 'stage px, like ' + prop + ': 120px'} — "${v}" is not.`);
          else (raw.box ??= {})[BOX_OF_PROP[prop]] = n;
        } else if (PLACING.has(prop)) {
          problems.push(`${where}: ${prop} would move the clip — a picture is placed by left, top, width, height and rotate in its style.`);
        } else if (TIMED.test(prop)) {
          problems.push(`${where}: ${STILL_CSS}`);
        } else rest.push(`${prop}: ${v}`);
      }
      if (rest.length) raw.style = rest.join('; ');
    } else {
      /* at, speed, volume: numbers */
      const n = value.trim() === '' ? NaN : Number(value);
      if (!Number.isFinite(n)) problems.push(`${where}: ${name} is a number${name === 'at' ? ' of seconds (the film second it starts at)' : ''} — "${value}" is not.`);
      else raw[name] = n;
    }
  }
  if (raw.box) raw.box = { x: raw.box.x ?? 0, y: raw.box.y ?? 0, ...raw.box };
  if (muted) raw.volume = 0;
  if (Object.keys(attrs).length) raw.attrs = attrs;
  /* an <audio> of a video file is that video's sound alone (its picture, if used, is a <video> clip of its own) */
  if (kind === 'sound' && clipKind(raw.src) === 'video') raw.sound = true;
  if (typeof raw.src !== 'string' || !raw.src) problems.push(`${where}: a clip needs src, its file (relative to ${FILM_FILE}).`);
  else if (clipKind(raw.src) !== kind && !raw.sound) {
    const is = clipKind(raw.src);
    problems.push(`${where}: "${raw.src}" is ${is ? `a ${is === 'page' ? 'web page' : is}, a clip of <${TAG_OF_KIND[is]}>` : 'no clip a film plays (a web page, a video, a picture or a sound)'} — <${tag.name}> is for ${kind === 'page' ? 'a web page (.html)' : `a ${kind}`}.`);
  }
  return problems.length > before ? null : raw;
}

/**
 * Read a film.html: the value it says (clips named, see readFilm), checked, or every problem in it, each with the
 * line it is on. `layout` is where each part of the value is in the text, for filmHtml to write over.
 */
function readFilmFile(text) {
  const marks = markup(text);
  const problems = [];
  const at = (m) => `${FILM_FILE}:${lineAt(text, m.start)}`;
  let stage;
  let bodyStart = -1;
  let viewport = null;
  let i = 0;
  /* the head: anything a page's head holds, but no script (a film is not code: code is a page's), and the stage */
  for (; i < marks.length; i++) {
    const m = marks[i];
    if (m.type === 'open' && m.name === 'body') { bodyStart = m.end; i++; break; }
    /* an element of the body begins it, <body> written or not (as a browser reads it) */
    if (m.type === 'open' && !HEAD_TAGS.has(m.name)) { bodyStart = m.start; break; }
    if (m.type === 'text' && !m.raw && m.text.trim()) { bodyStart = m.start; break; }
    if (m.type !== 'open') continue;
    if (m.name === 'script') problems.push(`${at(m)}: a film runs no script — what moves is a web page of its own, a clip (<iframe src="title.html">).`);
    if (m.name === 'style' && /@keyframes|(^|[;{\s])(animation|transition)(-[a-z-]+)?\s*:/i.test(marks[i + 1]?.raw ? marks[i + 1].text : '')) problems.push(`${at(m)}: ${STILL_CSS}`);
    if (m.name === 'base') problems.push(`${at(m)}: a film has no <base>: its clips' files are relative to ${FILM_FILE}.`);
    if (m.name === 'meta' && m.attrs.find((a) => a.name === 'name')?.value.toLowerCase() === 'viewport') {
      viewport = m;
      const content = m.attrs.find((a) => a.name === 'content')?.value ?? '';
      const w = Number(/(?:^|[,;\s])width\s*=\s*(\d+)/i.exec(content)?.[1]);
      const h = Number(/(?:^|[,;\s])height\s*=\s*(\d+)/i.exec(content)?.[1]);
      if (!(w > 0 && h > 0)) problems.push(`${at(m)}: the viewport is the film's frame, in px: <meta name="viewport" content="width=1920, height=1080">.`);
      else stage = { w, h };
    }
  }
  if (bodyStart < 0) bodyStart = text.length;
  /* the body: tracks, each a <section> of clips */
  const tracks = [];
  const lines = [];
  const layout = { bodyStart, bodyEnd: text.length, viewport: viewport ? { start: viewport.start, end: viewport.end } : null, tracks: [], tail: [] };
  let track = null;
  let pending = [];
  /** Where an element that has no place here ends (said once: its content and end tag are passed over with it). */
  const past = (from) => {
    const m = marks[from];
    if (m.type !== 'open' || VOID_TAGS.has(m.name) || m.selfClosing) return from;
    for (let j = from + 1, depth = 1; j < marks.length; j++) {
      if (marks[j].name !== m.name) continue;
      depth += marks[j].type === 'open' ? 1 : marks[j].type === 'close' ? -1 : 0;
      if (!depth) return j;
    }
    return marks.length;
  };
  const stray = (m) => m.type === 'open' && m.name === 'script' ? 'a film runs no script — what moves is a web page of its own, a clip (<iframe src="title.html">).'
    : m.type === 'open' && (m.name === 'style' || m.name === 'link') ? 'styles go in <head>.'
      : `<${m.type === 'close' ? '/' : ''}${m.name}> — a film's body is its tracks, each a <section> of clips (<iframe>, <video>, <img>, <audio>); anything else on screen is a web page of its own, a clip.`;
  for (; i < marks.length; i++) {
    const m = marks[i];
    if (m.type === 'comment') { pending.push(m); continue; }
    if (m.type === 'text') {
      if (m.text.trim()) problems.push(`${at(m)}: text "${m.text.trim().slice(0, 40)}" is outside any clip — words on screen are a web page of their own, a clip (<iframe src="title.html">).`);
      continue;
    }
    if (m.type === 'close' && (m.name === 'body' || m.name === 'html')) { layout.bodyEnd = m.start; break; }
    if (!track) {
      if (m.type === 'open' && m.name === 'section') {
        const raw = { clips: [] };
        for (const a of m.attrs) {
          if (TRACK_FLAGS.includes(a.name)) raw[a.name] = true;
          else if (KEPT_TRACK_ATTRIBUTE.test(a.name)) (raw.attrs ??= {})[a.name] = a.value;
          else problems.push(`${at(m)}: ${a.name} is not an attribute of a track — a <section> takes hidden, muted and locked (and id, class, title, data-*, aria-*, which say nothing to the film).`);
        }
        track = { raw, open: m, lead: pending, clips: [] };
        pending = [];
        continue;
      }
      problems.push(m.type === 'open' && KIND_OF_TAG[m.name]
        ? `${at(m)}: ${named(m)} is outside any track — every clip is in a <section>, a track (the first section is on top).`
        : `${at(m)}: ${stray(m)}`);
      i = past(i);
      continue;
    }
    if (m.type === 'close' && m.name === 'section') {
      track.close = m;
      track.tail = pending;
      pending = [];
      tracks.push(track.raw);
      lines.push({ line: lineAt(text, track.open.start), clips: track.clips.map((c) => c.line) });
      layout.tracks.push({ open: track.open, close: m, lead: track.lead, tail: track.tail, clips: track.clips.map((c) => c.at) });
      track = null;
      continue;
    }
    if (m.type === 'open' && KIND_OF_TAG[m.name]) {
      const where = `${at(m)}: ${named(m)}`;
      let end = m.end;
      if (!VOID_TAGS.has(m.name) && !m.selfClosing) {
        /* <video>, <audio>, <iframe>: nothing inside, up to their end tag */
        let j = i + 1;
        while (j < marks.length && !(marks[j].type === 'close' && marks[j].name === m.name)) j++;
        if (j >= marks.length) { problems.push(`${where} has no </${m.name}>.`); break; }
        const inside = marks.slice(i + 1, j).find((n) => n.type !== 'comment' && !(n.type === 'text' && !n.text.trim()));
        if (inside) {
          problems.push(`${at(inside)}: ${named(m)} holds nothing: ${inside.name === 'source' ? 'its file is its own src' : inside.name === 'track' ? 'its words are a WebVTT beside its file (a.mp4 → a.vtt)' : 'a clip is its file'}.`);
        }
        end = marks[j].end;
        i = j;
      }
      const raw = clipOfTag(m, where, problems);
      if (raw) {
        track.raw.clips.push(raw);
        track.clips.push({ line: lineAt(text, m.start), at: { start: m.start, end, lead: pending, named: Boolean(raw.id) } });
      }
      pending = [];
      continue;
    }
    problems.push(`${at(m)}: ${m.type === 'open' && (m.name === 'script' || m.name === 'style') ? stray(m) : `<${m.type === 'close' ? '/' : ''}${m.name}> in a track — a track holds clips: <iframe> (a web page), <video>, <img> (a still) and <audio> (a sound).`}`);
    i = past(i);
  }
  if (track) problems.push(`${at(track.open)}: this <section> has no </section>.`);
  layout.tail = pending;
  const value = { stage: stage ?? { ...DEFAULT_STAGE }, tracks };
  if (problems.length) return { value: null, doc: null, problems, layout: null };
  const read = readFilm(value);
  /* the value's places (tracks[1].clips[0]) said as the file's lines */
  const said = read.problems.map((p) => p.replace(/\btracks\[(\d+)\](?:\.clips\[(\d+)\])?(?: "[^"]*")?/g, (all, t, c) => {
    const place = lines[Number(t)];
    if (!place) return all;
    return c === undefined ? `${FILM_FILE}:${place.line} <section>` : `${FILM_FILE}:${place.clips[Number(c)]}`;
  }));
  return { value: read.doc ? value : null, doc: read.doc, problems: said, layout: read.doc ? layout : null };
}

/**
 * The part of a film.html that is not its tracks (its head: the stage, the styles, the fonts), as text: a player
 * changes the film in place when only the tracks changed, and loads it again when this did.
 */
function filmHead(text) {
  const { layout } = readFilmFile(text);
  return layout ? text.slice(0, layout.bodyStart) + text.slice(layout.bodyEnd) : text;
}

/** A clip's element: its attributes in one order, its picture's place first in its style. */
function clipTag(clip) {
  const kind = kindOf(clip);
  const tag = TAG_OF_KIND[kind];
  const t = clip.time;
  const num = (n) => String(Number(n.toFixed(3)));
  const src = clip.src + (t ? (t.length === 2 ? `#t=${num(t[0])},${num(t[1])}` : `#t=${num(t[0])}`) : '');
  const parts = [];
  if (clip.id) parts.push(`id="${escapeAttr(clip.id)}"`);
  parts.push(`src="${escapeAttr(src)}"`);
  if (clip.at) parts.push(`at="${num(clip.at)}"`);
  if (clip.speed != null && clip.speed !== 1) parts.push(`speed="${clip.speed}"`);
  if (clip.volume === 0) parts.push('muted');
  else if (clip.volume != null && clip.volume !== 1) parts.push(`volume="${clip.volume}"`);
  if (clip.size) parts.push(`size="${clip.size.w}x${clip.size.h}"`);
  if (clip.class) parts.push(`class="${escapeAttr(clip.class)}"`);
  const b = clip.box;
  const px = (v) => Number(v.toFixed(3));
  const style = [
    /* left and top always: a box at 0, 0 is still a box (without one, a picture has its own place) */
    ...(b ? [`left: ${px(b.x)}px`, `top: ${px(b.y)}px`] : []),
    ...(b?.w != null ? [`width: ${px(b.w)}px`] : []),
    ...(b?.h != null ? [`height: ${px(b.h)}px`] : []),
    ...(b?.r ? [`rotate: ${px(b.r)}deg`] : []),
    ...(clip.style ? [clip.style] : []),
  ];
  if (style.length) parts.push(`style="${escapeAttr(style.join('; '))}"`);
  if (clip.overrides?.length) parts.push(`overrides='${JSON.stringify(clip.overrides).replace(/&/g, '&amp;').replace(/'/g, '&#39;')}'`);
  for (const [k, v] of Object.entries(clip.attrs ?? {})) parts.push(`${k}="${escapeAttr(v)}"`);
  return `<${tag} ${parts.join(' ')}>${tag === 'img' ? '' : `</${tag}>`}`;
}

const sectionTag = (track) => `<section${Object.entries(track.attrs ?? {}).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('')}${TRACK_FLAGS.filter((f) => track[f]).map((f) => ` ${f}`).join('')}>`;
const viewportTag = (stage) => `<meta name="viewport" content="width=${stage.w}, height=${stage.h}">`;
/** Two values read alike: what a reader makes of them is the same. */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The film.html that says `value`, written over `before` (the file's text as it was): its head stays as it was but
 * for the stage, and in its body every track and clip that did not change keeps its own text and the comments before
 * it; what changed is written anew. The body is laid out one element a line, a track's clips indented.
 */
function filmHtml(value, before = '') {
  const prev = before ? readFilmFile(before) : null;
  const old = prev?.doc && prev.layout ? { text: before, doc: prev.doc, layout: prev.layout } : null;
  const stage = value.stage ?? DEFAULT_STAGE;
  const piece = (m) => old.text.slice(m.start, m.end);
  const comments = (list, indent) => list.map((c) => `${indent}${piece(c)}\n`).join('');
  /* the old clips by id, with their text: an unchanged one is written as it was */
  const kept = new Map();
  if (old) {
    old.layout.tracks.forEach((t, ti) => t.clips.forEach((place, ci) => {
      const clip = old.doc.tracks[ti]?.clips[ci];
      /* one written without an id gets it written (a name, once given, stays put) */
      if (clip) kept.set(clip.id, { clip, place, named: place.named });
    }));
  }
  const checked = readFilm(structuredClone(value)).doc;
  let body = '\n';
  (value.tracks ?? []).forEach((track, ti) => {
    const was = old?.layout.tracks[ti];
    const wasTrack = old?.doc.tracks[ti];
    body += was ? comments(was.lead, '') : '';
    const sameTrack = wasTrack && TRACK_FLAGS.every((f) => Boolean(wasTrack[f]) === Boolean(track[f])) && same(wasTrack.attrs ?? {}, track.attrs ?? {});
    body += was && sameTrack ? piece(was.open) : sectionTag(track);
    body += '\n';
    (track.clips ?? []).forEach((clip, ci) => {
      const now = checked?.tracks[ti]?.clips[ci] ?? clip;
      const k = kept.get(now.id);
      if (k) body += comments(k.place.lead, '  ');
      body += `  ${k && k.named && same(k.clip, now) ? old.text.slice(k.place.start, k.place.end) : clipTag(now)}\n`;
    });
    if (was) body += comments(was.tail, '  ');
    body += '</section>\n';
  });
  if (old) body += comments(old.layout.tail, '');
  if (!old) {
    return `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n${viewportTag(stage)}\n</head>\n<body>${body}</body>\n</html>\n`;
  }
  let head = old.text.slice(0, old.layout.bodyStart);
  const sameStage = old.doc.stage.w === stage.w && old.doc.stage.h === stage.h;
  if (!sameStage) {
    const v = old.layout.viewport;
    if (v) head = head.slice(0, v.start) + viewportTag(stage) + head.slice(v.end);
    else {
      const open = /<head\b[^>]*>/i.exec(head) ?? /^\s*<!doctype[^>]*>/i.exec(head);
      const at = open ? open.index + open[0].length : 0;
      head = `${head.slice(0, at)}\n${viewportTag(stage)}${head.slice(at)}`;
    }
  }
  return head + body + old.text.slice(old.layout.bodyEnd);
}

return {readFilmFile,kindOf,clipKind,soundRole,clipSpan};
})();

const NativeStyle = (() => {
// @ts-check
/**
 * Subtitle styles: one table, one function, every place that draws them.
 *
 * Subtitles are drawn by Studio, never by the film: the editor lays them over the picture (SubtitleOverlay), and an
 * export burns them in or writes them as SRT / WebVTT / a transcript. Each of those builds its CSS here
 * (`filmSubtitleCss`, `filmSubtitleFrameHtml`), so what the person sees while editing is what the export draws. The
 * only legitimate difference is the unit of the font size (the editor follows the window with `cqmin`; an export draws
 * at the frame's pixels), so that one value is passed in.
 *
 * Everything that follows the frame is stored as a fraction or in `em`, never in px: the same style is used on a small
 * preview and on a 4K export.
 *
 * Plain JavaScript with no dependencies: the editor (studio/ui) imports it as it is, and so does the server's export.
 */

/* ── style ───────────────────────────────────────────────────────────────── */

/**
 * The typeface. `sizePct` is a percentage of the frame's SHORT edge (measuring by height would turn a vertical film's
 * subtitles into headlines); everything else follows the font size in `em`.
 * @typedef {{ family: string, sizePct: number, weight: number, italic: boolean, letterSpacingEm: number, lineHeight: number, upper: boolean }} FilmSubtitleFont
 */
/**
 * A real stroke (`-webkit-text-stroke` + `paint-order: stroke fill`), not eight text-shadows: those show jagged lobes on
 * a thick stroke and would take the text-shadow the drop shadow needs.
 * @typedef {{ widthEm: number, color: string }} FilmSubtitleStroke
 */
/** @typedef {{ dxEm: number, dyEm: number, blurEm: number, color: string }} FilmSubtitleShadow */
/**
 * A box behind the text. Color (`#rrggbb`) and opacity are separate: they are two controls, and dragging the opacity
 * must not rewrite the color.
 * @typedef {{ color: string, opacity: number, radiusEm: number, padXEm: number, padYEm: number }} FilmSubtitleBox
 */
/** @typedef {'left' | 'center' | 'right'} FilmSubtitleAlign */
/**
 * Word highlight (karaoke): the word being said gets a color (`color`), a box behind it (`box`), or a color and a
 * little growth (`pop`). Word times come from the cue's `words` when it has them, else each word gets a share of the
 * line's time by its length (a voice speaks at an even pace).
 * @typedef {'color' | 'box' | 'pop'} FilmSubtitleKaraokeMode
 * @typedef {{ mode: FilmSubtitleKaraokeMode, color: string }} FilmSubtitleKaraoke
 */
/**
 * How a project's subtitles look and where they sit. The person's look, kept with the project but not in film.html
 * (studio/server/captions.mjs: `.film/subtitles.json`): an agent rewriting the film never touches it.
 *
 * `pos` is a fraction of the frame (0..1): where the line nearest the frame's edge sits. It is dragged on the picture;
 * no top/bottom presets, since what a subtitle has to stay clear of differs in every film.
 * `language`: the language shown (null = the voices' own); each cue carries its translations (`alt`) and this picks
 * one. `bilingual`: the original on one line and the translation under it.
 * @typedef {{
 *   on: boolean,
 *   pos: { x: number, y: number },
 *   maxWidthPct: number,
 *   align: FilmSubtitleAlign,
 *   font: FilmSubtitleFont,
 *   fill: string,
 *   stroke: FilmSubtitleStroke | null,
 *   shadow: FilmSubtitleShadow | null,
 *   box: FilmSubtitleBox | null,
 *   karaoke: FilmSubtitleKaraoke | null,
 *   language: string | null,
 *   bilingual: boolean,
 * }} FilmSubtitleStyle
 */

/** @type {readonly FilmSubtitleKaraokeMode[]} */
const FILM_SUBTITLE_KARAOKE_MODES = ['color', 'box', 'pop'];
/** @type {FilmSubtitleKaraoke} */
const FILM_SUBTITLE_KARAOKE_DEFAULT = { mode: 'box', color: '#ffd400' };

/**
 * The languages subtitles can be translated into, named in their own language so whoever picks one recognizes it.
 * @type {ReadonlyArray<{ code: string, english: string, native: string }>}
 */
const FILM_SUBTITLE_LANGUAGES = [
  { code: 'en', english: 'English', native: 'English' },
  { code: 'zh', english: 'Simplified Chinese', native: '简体中文' },
  { code: 'zh-TW', english: 'Traditional Chinese', native: '繁體中文' },
  { code: 'ja', english: 'Japanese', native: '日本語' },
  { code: 'ko', english: 'Korean', native: '한국어' },
  { code: 'es', english: 'Spanish', native: 'Español' },
  { code: 'fr', english: 'French', native: 'Français' },
  { code: 'de', english: 'German', native: 'Deutsch' },
  { code: 'pt', english: 'Portuguese', native: 'Português' },
  { code: 'ru', english: 'Russian', native: 'Русский' },
  { code: 'ar', english: 'Arabic', native: 'العربية' },
  { code: 'hi', english: 'Hindi', native: 'हिन्दी' },
  { code: 'id', english: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'vi', english: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'th', english: 'Thai', native: 'ไทย' },
  { code: 'it', english: 'Italian', native: 'Italiano' },
];

/**
 * Which of FILM_SUBTITLE_LANGUAGES a text is in, by script: enough to name the original ("Original · Chinese") and to
 * skip translating a voice into its own language. Latin-script languages cannot be told apart this way: null.
 * @param {string} text @returns {string | null}
 */
function filmSubtitleLanguageOf(text) {
  const sample = text.slice(0, 4000);
  const count = (/** @type {RegExp} */ re) => (sample.match(re) ?? []).length;
  const kana = count(/[\u3040-\u30ff]/g);
  const hangul = count(/[\uac00-\ud7af]/g);
  const han = count(/[\u4e00-\u9fff]/g);
  /** @type {Array<[string, number]>} */
  const scripts = [
    ['ja', kana * 3 + (kana ? han : 0)], ['ko', hangul], ['zh', kana ? 0 : han],
    ['th', count(/[\u0e00-\u0e7f]/g)], ['ar', count(/[\u0600-\u06ff]/g)],
    ['hi', count(/[\u0900-\u097f]/g)], ['ru', count(/[\u0400-\u04ff]/g)],
  ];
  const [best, n] = scripts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return n >= 2 ? best : null;
}

/**
 * The same language for subtitles: Simplified and Traditional Chinese are different targets, everything else by its
 * base code.
 * @param {string | null | undefined} a @param {string | null | undefined} b
 */
function sameFilmSubtitleLanguage(a, b) {
  return !!a && !!b && (a === b || (a.split('-')[0] === b.split('-')[0] && a.split('-')[0] !== 'zh'));
}

/** @param {unknown} code @returns {code is string} */
const isFilmSubtitleLanguage = (code) =>
  typeof code === 'string' && FILM_SUBTITLE_LANGUAGES.some((item) => item.code === code);

/**
 * The typeface when none is chosen: a system stack, not one font, since subtitles have to set Chinese, Japanese,
 * Korean and Latin alike, and this stack lands on each platform's own sans for each.
 */
const FILM_SUBTITLE_FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB",'
  + ' "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';

/** The widest a subtitle block gets, as a percentage of the frame (default). 100 = edge to edge. */
const FILM_SUBTITLE_MAX_W_PCT = 100;

/**
 * Font size as a percentage of the frame's short edge. The three sizes are only ticks on the slider now (and the
 * decoding of an older `size` field); the size itself is continuous.
 * @typedef {'sm' | 'md' | 'lg'} FilmSubtitleSize
 * @type {Record<FilmSubtitleSize, number>}
 */
const FILM_SUBTITLE_SIZE_PCT = { sm: 3.2, md: 4.0, lg: 5.2 };

/** The size slider's ends: smaller cannot be read on a feed thumbnail, larger leaves a few words per line. */
const FILM_SUBTITLE_SIZE_PCT_MIN = 2;
const FILM_SUBTITLE_SIZE_PCT_MAX = 10;

/* ── looks ───────────────────────────────────────────────────────────────── */

/**
 * A ready-made look, like a character style: picking one sets the whole set, and every value can still be changed
 * after. They stay because the combinations that read well are few; built from scratch, subtitles tend to sink into
 * the picture.
 * @typedef {'outline' | 'bar' | 'bold' | 'yellow' | 'clean'} FilmSubtitleLookId
 * @typedef {Pick<FilmSubtitleStyle, 'font' | 'fill' | 'stroke' | 'shadow' | 'box'>} FilmSubtitleLook
 */

/** @type {readonly FilmSubtitleLookId[]} */
const FILM_SUBTITLE_LOOK_IDS = ['outline', 'bar', 'bold', 'yellow', 'clean'];

/** @param {Partial<FilmSubtitleFont>} [over] @returns {FilmSubtitleFont} */
function font(over = {}) {
  return {
    family: FILM_SUBTITLE_FONT_STACK,
    sizePct: FILM_SUBTITLE_SIZE_PCT.md,
    weight: 500,
    italic: false,
    /* set tight, Chinese subtitles look like UI labels: a little tracking and leading make them read as a line of text */
    letterSpacingEm: 0.04,
    lineHeight: 1.45,
    upper: false,
    ...over,
  };
}

/**
 * Each look's values. Only how it looks: never the position or the switch (a new look must not undo a drag).
 * @type {Record<FilmSubtitleLookId, FilmSubtitleLook>}
 */
const FILM_SUBTITLE_LOOKS = {
  /* the default is an outline, not a box: a box covers the picture, and subtitles sit in the lower third where there
     often is something; an outline reads on any background and hides almost nothing */
  outline: {
    font: font(),
    fill: '#ffffff',
    /* the stroke keeps the letters on light or busy backgrounds; the glow is what lifts them off the picture */
    stroke: { widthEm: 0.055, color: 'rgba(0,0,0,0.84)' },
    shadow: { dxEm: 0, dyEm: 0.05, blurEm: 0.22, color: 'rgba(0,0,0,0.72)' },
    box: null,
  },
  bar: {
    font: font(),
    fill: '#ffffff',
    stroke: null,
    shadow: null,
    box: { color: '#000000', opacity: 0.62, radiusEm: 0.08, padXEm: 0.4, padYEm: 0.12 },
  },
  /* the heavy social-media outline: muted feeds need words that read at thumbnail size */
  bold: {
    font: font({ weight: 800, letterSpacingEm: 0.01 }),
    fill: '#ffffff',
    stroke: { widthEm: 0.08, color: '#000000' },
    shadow: { dxEm: 0, dyEm: 0.03, blurEm: 0.08, color: 'rgba(0,0,0,0.6)' },
    box: null,
  },
  yellow: {
    font: font({ weight: 700 }),
    fill: '#ffe14d',
    stroke: { widthEm: 0.075, color: '#000000' },
    shadow: { dxEm: 0, dyEm: 0.03, blurEm: 0.08, color: 'rgba(0,0,0,0.6)' },
    box: null,
  },
  clean: {
    font: font(),
    fill: '#ffffff',
    stroke: null,
    shadow: { dxEm: 0, dyEm: 0.04, blurEm: 0.2, color: 'rgba(0,0,0,0.62)' },
    box: null,
  },
};

/**
 * Where the default position sits (y): one line at the default size ends about 3% above the bottom edge, where players
 * put subtitles, and two lines still fit. The overlay's snap lines use this value; do not copy it.
 */
const FILM_SUBTITLE_HOME_Y = 0.94;

/** @type {FilmSubtitleStyle} */
const FILM_SUBTITLE_DEFAULT = {
  on: true,
  pos: { x: 0.5, y: FILM_SUBTITLE_HOME_Y },
  maxWidthPct: FILM_SUBTITLE_MAX_W_PCT,
  align: 'center',
  ...FILM_SUBTITLE_LOOKS.outline,
  karaoke: null,
  language: null,
  bilingual: false,
};

/**
 * The default position on a vertical frame: Shorts / Reels / TikTok put their own title, avatar and buttons over the
 * bottom fifth, right on the landscape baseline.
 */
const FILM_SUBTITLE_PORTRAIT_Y = 0.72;

/**
 * The style as used on this frame: never moved (still at the default spot) on a vertical frame → the vertical default
 * spot. A moved one is the person's choice. Every renderer applies this first.
 * @param {FilmSubtitleStyle} style @param {{ w: number, h: number }} frame @returns {FilmSubtitleStyle}
 */
function filmSubtitleStyleFor(style, frame) {
  const home = style.pos.x === 0.5 && style.pos.y === FILM_SUBTITLE_HOME_Y;
  return home && frame.h > frame.w ? { ...style, pos: { x: 0.5, y: FILM_SUBTITLE_PORTRAIT_Y } } : style;
}

/**
 * The look this style is exactly (any size), else null: the swatch shown as picked. Worked out from the values, not
 * stored, so changing a color after picking a look un-picks it.
 * @param {FilmSubtitleStyle} style @returns {FilmSubtitleLookId | null}
 */
function matchFilmSubtitleLook(style) {
  for (const id of FILM_SUBTITLE_LOOK_IDS) {
    const look = FILM_SUBTITLE_LOOKS[id];
    if (JSON.stringify({ ...look, font: { ...look.font, sizePct: style.font.sizePct } })
      === JSON.stringify({ font: style.font, fill: style.fill, stroke: style.stroke, shadow: style.shadow, box: style.box })) return id;
  }
  return null;
}

/* ── CSS ─────────────────────────────────────────────────────────────────── */

/** `#rrggbb` + opacity → `rgba(...)`; any other color as it is. @param {string} color @param {number} opacity */
function rgba(color, opacity) {
  const digits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!digits) return color;
  const hex = digits.length === 3 ? digits.split('').map((c) => c + c).join('') : digits;
  const n = parseInt(hex, 16);
  const a = Math.min(1, Math.max(0, opacity));
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Number(a.toFixed(3))})`;
}

/**
 * A family name → a valid `font-family` value. Font lists give bare names (`Press Start 2P`, `Noto Serif SC`); a
 * multi-word name needs quotes and one starting with a digit is never a valid identifier, and an invalid declaration
 * is silently dropped. A stack (with commas) is used as it is; a single name is quoted, with the system stack behind it.
 * @param {string} family
 */
function cssFontFamily(family) {
  const name = family.trim();
  if (!name) return FILM_SUBTITLE_FONT_STACK;
  if (name.includes(',')) return name;
  return `"${name.replace(/"/g, '')}", ${FILM_SUBTITLE_FONT_STACK}`;
}

/** @type {Record<FilmSubtitleAlign, string>} */
const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' };

/**
 * `box`: the positioning block (absolute at `pos`, its max width, aligned); `text`: the text block (font, color,
 * stroke, shadow, box). camelCase properties, as React's `style` takes them (`filmSubtitleCssText` for a style
 * attribute).
 * @typedef {{ box: Record<string, string>, text: Record<string, string> }} FilmSubtitleCss
 */

/**
 * A style → its two sets of CSS declarations. The one way every renderer builds subtitles; `fontSize` is given by the
 * caller, which alone knows its units (the editor: container units; an export: the frame's pixels).
 * @param {FilmSubtitleStyle} style @param {{ fontSize: string }} opts @returns {FilmSubtitleCss}
 */
function filmSubtitleCss(style, opts) {
  const f = style.font;
  /* `pos` is where the line nearest the frame's edge sits (its middle). More lines (a long sentence wrapping, the
     original above its translation) grow away from that edge; centering the whole block pushed a bilingual pair's last
     line onto the frame's bottom edge. Near the middle the block stays centered. The box sits on its edge and the text
     reaches back half a line past it (a margin in `em`, so every renderer writes the same box whatever its units). */
  const anchor = style.pos.y > 0.55 ? 'bottom' : style.pos.y < 0.45 ? 'top' : 'middle';
  const halfLineEm = `-${Math.round((f.lineHeight / 2 + (style.box?.padYEm ?? 0)) * 1000) / 1000}em`;
  const dy = anchor === 'bottom' ? '-100%' : anchor === 'top' ? '0' : '-50%';

  /** @type {Record<string, string>} */
  const box = {
    position: 'absolute',
    left: `${style.pos.x * 100}%`,
    top: `${style.pos.y * 100}%`,
    transform: `translate(-50%, ${dy})`,
    /* `max-content` is needed: an absolute box with only `left` may be as wide as from there to the right edge (half
       the frame when centered), so a sentence would wrap at 50%; max-content sizes it by its text, then max-width caps
       it by the whole frame */
    width: 'max-content',
    maxWidth: `${style.maxWidthPct}%`,
    display: 'flex',
    justifyContent: JUSTIFY[style.align],
    zIndex: '5',
  };

  /** @type {Record<string, string>} */
  const text = {
    whiteSpace: 'pre-wrap',
    /* `strict` keeps CJK punctuation on the line it closes instead of starting the next one with it */
    lineBreak: 'strict',
    overflowWrap: 'break-word',
    /* a flex item's min-width:auto could push the text past a capped box */
    minWidth: '0',
    maxWidth: '100%',
    textAlign: style.align,
    lineHeight: String(f.lineHeight),
    fontSize: opts.fontSize,
    fontFamily: cssFontFamily(f.family),
    fontWeight: String(f.weight),
    color: style.fill,
  };
  if (anchor === 'bottom') text.marginBottom = halfLineEm;
  if (anchor === 'top') text.marginTop = halfLineEm;
  if (f.italic) text.fontStyle = 'italic';
  if (f.letterSpacingEm) text.letterSpacing = `${f.letterSpacingEm}em`;
  if (f.upper) text.textTransform = 'uppercase';

  if (style.stroke && style.stroke.widthEm > 0) {
    text.WebkitTextStrokeWidth = `${style.stroke.widthEm}em`;
    text.WebkitTextStrokeColor = style.stroke.color;
    /* without it the stroke is centered on the outline and eats into the letters, worst at light weights */
    text.paintOrder = 'stroke fill';
  }
  if (style.shadow) {
    const s = style.shadow;
    text.textShadow = `${s.dxEm}em ${s.dyEm}em ${s.blurEm}em ${s.color}`;
  }
  if (style.box) {
    const b = style.box;
    text.background = rgba(b.color, b.opacity);
    text.padding = `${b.padYEm}em ${b.padXEm}em`;
    text.borderRadius = `${b.radiusEm}em`;
  }
  return { box, text };
}

/** The same declarations as a `style="..."` attribute's text. @param {Record<string, string>} decls */
function filmSubtitleCssText(decls) {
  return Object.entries(decls)
    /* `WebkitTextStroke` → `-webkit-text-stroke`: the capital W gives the leading dash */
    .map(([k, v]) => `${k.replace(/([A-Z])/g, '-$1').toLowerCase()}:${v}`)
    .join(';');
}

/** The font size in a frame's pixels (an export's): by the short edge, as `sizePct` says. */
function filmSubtitleFontSizePx(/** @type {FilmSubtitleStyle} */ style, /** @type {{ w: number, h: number }} */ frame) {
  return Math.round((Math.min(frame.w, frame.h) * style.font.sizePct) / 100);
}

/* ── cues ────────────────────────────────────────────────────────────────── */

/**
 * One subtitle line on the film: film milliseconds, its text, who says it (only when the film has more than one
 * speaker), word times when known (film ms), its translations by language, the clip it comes from, and the line it
 * shows: `src`'s transcript line starting at `line` (source ms), and which subtitle of it (`part`, from 0) when the
 * spoken line is cut into several (studio/server/subtitle-segments.mjs).
 * @typedef {{
 *   startMs: number,
 *   durMs: number,
 *   text: string,
 *   speaker?: string,
 *   words?: readonly { text: string, startMs: number, durMs: number }[],
 *   alt?: Readonly<Record<string, string>>,
 *   clip?: string,
 *   src?: string,
 *   line?: number,
 *   part?: number,
 * }} FilmSubtitleCue
 */

/**
 * The cues as the style shows them: the original, one language's translation, or both (original above). Lines not
 * translated yet stay in the original. A translated line loses its word times (they are the original's). Where a
 * translation could not be cut as finely as its original, the same words follow pieces of one line: shown alone they
 * are one cue (not the same words flashing anew, nor repeated in a file).
 * @template {FilmSubtitleCue} T
 * @param {readonly T[]} cues @param {Pick<FilmSubtitleStyle, 'language' | 'bilingual'>} style @returns {T[]}
 */
function filmSubtitleShown(cues, style) {
  const language = style.language;
  if (!language) return [...cues];
  /** @type {T[]} */
  const out = [];
  for (const cue of cues) {
    const alt = cue.alt?.[language];
    if (!alt) { out.push(cue); continue; }
    const prev = out.at(-1);
    if (!style.bilingual && prev && cue.src !== undefined && prev.src === cue.src && prev.line === cue.line && prev.clip === cue.clip
      && prev.alt?.[language] === alt && prev.text === alt) {
      out[out.length - 1] = { ...prev, durMs: Math.max(prev.durMs, cue.startMs + cue.durMs - prev.startMs) };
      continue;
    }
    const { words: _words, ...rest } = cue;
    out.push(/** @type {T} */ ({ ...rest, text: style.bilingual ? `${cue.text}\n${alt}` : alt }));
  }
  return out;
}

/** The languages these cues have translations in (any line counts). @param {readonly FilmSubtitleCue[]} cues */
function filmSubtitleLanguagesIn(cues) {
  const found = new Set();
  for (const cue of cues) for (const code of Object.keys(cue.alt ?? {})) found.add(code);
  return /** @type {string[]} */ ([...found]);
}

/** A piece of a line: a word (which takes its turn to light up), or space, punctuation, a speaker prefix. @typedef {{ text: string, active: boolean }} FilmSubtitleWord */

const PUNCT_START = /^[\s，。、！？,.!?;:；：]/;

/**
 * A line cut into pieces, the one being said at `timeMs` marked. Every renderer uses it, so the highlight falls on the
 * same word in the editor and the export. Without word times: words by Intl.Segmenter (CJK into words, else by
 * character), punctuation and spaces take no time, each word gets time by its length.
 * @param {FilmSubtitleCue} cue @param {number} timeMs @returns {FilmSubtitleWord[]}
 */
function filmSubtitleWords(cue, timeMs) {
  /** @type {FilmSubtitleWord[]} */
  const out = [];
  if (cue.speaker) out.push({ text: `${cue.speaker}：`, active: false });
  const words = cue.words;
  if (words?.length) {
    words.forEach((w, i) => {
      if (i > 0 && !PUNCT_START.test(w.text) && /[A-Za-z0-9]$/.test(words[i - 1].text)) out.push({ text: ' ', active: false });
      out.push({ text: w.text, active: timeMs >= w.startMs && timeMs < w.startMs + w.durMs });
    });
    return out;
  }
  const segs = segmentWords(cue.text);
  const weight = segs.reduce((n, s) => n + (s.word ? [...s.text].length : 0), 0);
  if (!weight) {
    out.push({ text: cue.text, active: false });
    return out;
  }
  const at = Math.min(Math.max(0, timeMs - cue.startMs), Math.max(0, cue.durMs - 1));
  let t = 0;
  for (const seg of segs) {
    if (!seg.word) {
      out.push({ text: seg.text, active: false });
      continue;
    }
    const len = ([...seg.text].length / weight) * cue.durMs;
    out.push({ text: seg.text, active: at >= t && at < t + len });
    t += len;
  }
  return out;
}

/** @param {string} text @returns {{ text: string, word: boolean }[]} */
function segmentWords(text) {
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)]
      .map((s) => ({ text: s.segment, word: Boolean(s.isWordLike) }));
  }
  return text.split(/(\s+|[，。、！？,.!?;:；：]+)/).filter(Boolean)
    .map((part) => ({ text: part, word: !/^(\s+|[，。、！？,.!?;:；：]+)$/.test(part) }));
}

/**
 * What the word being said gets on top of the line's style. Only color, background and scale, never the font: a word
 * growing wider would make the whole line jump. The scale is an inline-block transform, which takes no room.
 * @param {FilmSubtitleStyle} style @returns {Record<string, string>}
 */
function filmSubtitleWordCss(style) {
  const k = style.karaoke;
  if (!k) return {};
  if (k.mode === 'box') {
    return {
      backgroundColor: k.color,
      color: readableOn(k.color),
      borderRadius: '0.18em',
      padding: '0 0.14em',
      margin: '0 -0.14em',
      boxDecorationBreak: 'clone',
      WebkitBoxDecorationBreak: 'clone',
      WebkitTextStroke: '0',
    };
  }
  if (k.mode === 'pop') {
    /* the growth spills over the gaps between words (a transform takes no room): more than this runs into neighbors */
    return { color: k.color, display: 'inline-block', transform: 'scale(1.08)', transformOrigin: '50% 60%' };
  }
  return { color: k.color };
}

/** Black or white text on a background, by its brightness. @param {string} bg */
function readableOn(bg) {
  const digits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(bg.trim())?.[1];
  if (!digits) return '#000000';
  const hex = digits.length === 3 ? digits.split('').map((c) => c + c).join('') : digits;
  const n = parseInt(hex, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000000' : '#ffffff';
}

/**
 * The line shown at `timeMs`. Ranges are [start, end); when two overlap the later-starting one wins (the earlier one's
 * tail is still hanging while the next has begun, and the viewer reads the one being said).
 * @template {FilmSubtitleCue} T
 * @param {readonly T[]} cues @param {number} timeMs @returns {T | null}
 */
function filmSubtitleAt(cues, timeMs) {
  /** @type {T | null} */
  let best = null;
  for (const cue of cues) {
    if (timeMs < cue.startMs || timeMs >= cue.startMs + cue.durMs) continue;
    if (!best || cue.startMs > best.startMs) best = cue;
  }
  return best;
}

/** A line as printed (speaker first). @param {FilmSubtitleCue} cue */
function filmSubtitleText(cue) {
  return cue.speaker ? `${cue.speaker}：${cue.text}` : cue.text;
}

/* ── reading a stored style ──────────────────────────────────────────────── */

const clamp01 = (/** @type {number} */ n) => Math.min(1, Math.max(0, n));

/** @param {unknown} v @param {number} fallback @param {number} lo @param {number} hi */
function num(v, fallback, lo, hi) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

/** @param {unknown} v @param {string} fallback */
const str = (v, fallback) => (typeof v === 'string' && v.trim() ? v : fallback);
/** @param {unknown} v @param {boolean} fallback */
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

/**
 * `null` is "no such layer", `undefined` is "not said": the two must not mix, or a stroke could never be turned off.
 * @template T
 * @param {unknown} v @param {T | null} fallback @param {(o: Record<string, unknown>) => T} read @returns {T | null}
 */
function layer(v, fallback, read) {
  if (v === null) return null;
  if (v && typeof v === 'object') return read(/** @type {Record<string, unknown>} */ (v));
  return fallback;
}

/**
 * A style from outside (a file, the browser's storage, a request), field by field: what was stored may be an earlier
 * shape, and one unreadable field should fall back alone rather than reset the whole style. The earlier shape
 * `{ on, size: 'md', look: 'outline', pos }` is still understood: the look first, then `size` over its font size.
 * @param {unknown} raw @returns {FilmSubtitleStyle}
 */
function parseFilmSubtitleStyle(raw) {
  const v = /** @type {Record<string, unknown>} */ (raw && typeof raw === 'object' ? raw : {});
  const lookId = typeof v.look === 'string' && v.look in FILM_SUBTITLE_LOOKS ? /** @type {FilmSubtitleLookId} */ (v.look) : null;
  /** @type {FilmSubtitleStyle} */
  const base = lookId ? { ...FILM_SUBTITLE_DEFAULT, ...FILM_SUBTITLE_LOOKS[lookId] } : FILM_SUBTITLE_DEFAULT;
  const legacySizePct = typeof v.size === 'string' && v.size in FILM_SUBTITLE_SIZE_PCT
    ? FILM_SUBTITLE_SIZE_PCT[/** @type {FilmSubtitleSize} */ (v.size)]
    : null;
  const rf = /** @type {Record<string, unknown>} */ (v.font && typeof v.font === 'object' ? v.font : {});
  const pos = /** @type {{ x?: unknown, y?: unknown } | undefined} */ (v.pos);

  return {
    on: bool(v.on, base.on),
    pos: typeof pos?.x === 'number' && typeof pos?.y === 'number' && Number.isFinite(pos.x) && Number.isFinite(pos.y)
      ? { x: clamp01(pos.x), y: clamp01(pos.y) }
      : base.pos,
    maxWidthPct: num(v.maxWidthPct, base.maxWidthPct, 10, 100),
    align: v.align === 'left' || v.align === 'right' || v.align === 'center' ? v.align : base.align,
    font: {
      family: str(rf.family, base.font.family),
      sizePct: num(rf.sizePct, legacySizePct ?? base.font.sizePct, FILM_SUBTITLE_SIZE_PCT_MIN, FILM_SUBTITLE_SIZE_PCT_MAX),
      weight: num(rf.weight, base.font.weight, 100, 900),
      italic: bool(rf.italic, base.font.italic),
      letterSpacingEm: num(rf.letterSpacingEm, base.font.letterSpacingEm, -0.1, 0.5),
      lineHeight: num(rf.lineHeight, base.font.lineHeight, 0.8, 3),
      upper: bool(rf.upper, base.font.upper),
    },
    fill: str(v.fill, base.fill),
    stroke: layer(v.stroke, base.stroke, (o) => ({
      widthEm: num(o.widthEm, base.stroke?.widthEm ?? 0.055, 0, 0.3),
      color: str(o.color, base.stroke?.color ?? '#000000'),
    })),
    shadow: layer(v.shadow, base.shadow, (o) => ({
      dxEm: num(o.dxEm, base.shadow?.dxEm ?? 0, -0.5, 0.5),
      dyEm: num(o.dyEm, base.shadow?.dyEm ?? 0, -0.5, 0.5),
      blurEm: num(o.blurEm, base.shadow?.blurEm ?? 0.22, 0, 1),
      color: str(o.color, base.shadow?.color ?? 'rgba(0,0,0,0.72)'),
    })),
    box: layer(v.box, base.box, (o) => ({
      color: str(o.color, base.box?.color ?? '#000000'),
      opacity: num(o.opacity, base.box?.opacity ?? 0.62, 0, 1),
      radiusEm: num(o.radiusEm, base.box?.radiusEm ?? 0.08, 0, 1),
      padXEm: num(o.padXEm, base.box?.padXEm ?? 0.4, 0, 2),
      padYEm: num(o.padYEm, base.box?.padYEm ?? 0.12, 0, 2),
    })),
    karaoke: layer(v.karaoke, base.karaoke ?? null, (o) => ({
      mode: FILM_SUBTITLE_KARAOKE_MODES.includes(/** @type {FilmSubtitleKaraokeMode} */ (o.mode))
        ? /** @type {FilmSubtitleKaraokeMode} */ (o.mode)
        : FILM_SUBTITLE_KARAOKE_DEFAULT.mode,
      color: str(o.color, FILM_SUBTITLE_KARAOKE_DEFAULT.color),
    })),
    language: isFilmSubtitleLanguage(v.language) ? v.language : null,
    bilingual: bool(v.bilingual, false),
  };
}

/* ── for an export ───────────────────────────────────────────────────────── */

const escapeHtml = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The subtitle layer of one frame, for an export that burns subtitles in: an HTML fragment to lay over the picture.
 *
 *   cues   the film's cues as studio/server/captions.mjs gives them (`filmCaptions(root).cues`), in film ms
 *   style  the project's style (`readSubtitleStyle(root)`), as the person left it; off → nothing
 *   frame  the delivered frame in pixels, `{ w, h }` (the delivery frame, bars included, not the film's stage:
 *          subtitles sit on the frame, as in the editor)
 *   timeMs the moment, in film ms
 *
 * Returns '' when nothing is said then. Otherwise one `<div>` of exactly `frame.w × frame.h` px, positioned absolute at
 * 0,0 (put it in a `position: relative` box of the frame's size, over the picture), holding the line with the same
 * declarations the editor's overlay uses, the font size in px. It picks the shown language, the vertical default spot
 * and the word highlight itself, so an export needs nothing else. The fonts are the machine's installed ones (the same
 * the editor offers), so a headless browser on this machine draws it as the editor does.
 * @param {readonly FilmSubtitleCue[]} cues @param {FilmSubtitleStyle} style @param {{ w: number, h: number }} frame
 * @param {number} timeMs @returns {string}
 */
function filmSubtitleFrameHtml(cues, style, frame, timeMs) {
  if (!style.on) return '';
  const cue = filmSubtitleAt(filmSubtitleShown(cues, style), timeMs);
  if (!cue) return '';
  const fitted = filmSubtitleStyleFor(style, frame);
  const css = filmSubtitleCss(fitted, { fontSize: `${filmSubtitleFontSizePx(fitted, frame)}px` });
  const body = fitted.karaoke
    ? filmSubtitleWords(cue, timeMs).map((w) => (w.active
      ? `<span style="${escapeHtml(filmSubtitleCssText(filmSubtitleWordCss(fitted)))}">${escapeHtml(w.text)}</span>`
      : escapeHtml(w.text))).join('')
    : escapeHtml(filmSubtitleText(cue));
  return `<div style="position:absolute;left:0;top:0;width:${frame.w}px;height:${frame.h}px;overflow:hidden;pointer-events:none">`
    + `<div style="${escapeHtml(filmSubtitleCssText(css.box))}"><span style="${escapeHtml(filmSubtitleCssText(css.text))}">${body}</span></div></div>`;
}

/* ── files ───────────────────────────────────────────────────────────────── */

/** `00:01:23,456`: SRT's time, with a comma. @param {number} ms */
function srtStamp(ms) {
  const total = Math.max(0, Math.round(ms));
  const pad = (/** @type {number} */ n, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(total / 3_600_000))}:${pad(Math.floor((total % 3_600_000) / 60_000))}`
    + `:${pad(Math.floor((total % 60_000) / 1000))},${pad(total % 1000, 3)}`;
}

/**
 * Sorted, empty lines dropped, and an overlapping line cut short where the next begins (files have no "two at once":
 * players disagree on overlaps). Cut, not dropped: the dropped line was really said.
 * @param {readonly FilmSubtitleCue[]} cues
 */
function sequencedCues(cues) {
  const sorted = [...cues].filter((c) => c.text.trim() && c.durMs > 0).sort((a, b) => a.startMs - b.startMs);
  /** @type {{ cue: FilmSubtitleCue, end: number }[]} */
  const out = [];
  for (const [i, cue] of sorted.entries()) {
    const next = sorted[i + 1];
    let end = cue.startMs + cue.durMs;
    if (next && end > next.startMs) end = next.startMs;
    if (end > cue.startMs) out.push({ cue, end });
  }
  return out;
}

/**
 * An SRT file of the cues (pass them through `filmSubtitleShown` first for the shown language). The speaker takes an
 * ASCII colon here: players and translation tools read this file, and some choke on full-width punctuation.
 * @param {readonly FilmSubtitleCue[]} cues
 */
function filmSubtitleSrt(cues) {
  const blocks = sequencedCues(cues).map(({ cue, end }, i) => {
    const line = cue.speaker ? `${cue.speaker}:${cue.text}` : cue.text;
    return `${i + 1}\n${srtStamp(cue.startMs)} --> ${srtStamp(end)}\n${line.trim()}`;
  });
  return blocks.length ? `${blocks.join('\n\n')}\n` : '';
}

/** A WebVTT file; the speaker as `<v name>`, VTT's own voice tag. @param {readonly FilmSubtitleCue[]} cues */
function filmSubtitleVtt(cues) {
  const blocks = sequencedCues(cues).map(({ cue, end }) => {
    const text = cue.text.trim().replace(/-->/g, '→');
    const line = cue.speaker ? `<v ${cue.speaker.replace(/[<>]/g, '')}>${text}` : text;
    return `${srtStamp(cue.startMs).replace(',', '.')} --> ${srtStamp(end).replace(',', '.')}\n${line}`;
  });
  return blocks.length ? `WEBVTT\n\n${blocks.join('\n\n')}\n` : '';
}

/** A plain transcript: one line per cue, a blank line where the speaker changes. @param {readonly FilmSubtitleCue[]} cues */
function filmSubtitleTranscript(cues) {
  /** @type {string[]} */
  const lines = [];
  /** @type {string | undefined} */
  let lastSpeaker;
  for (const { cue } of sequencedCues(cues)) {
    if (lines.length && cue.speaker !== lastSpeaker) lines.push('');
    lines.push(cue.speaker && cue.speaker !== lastSpeaker ? `${cue.speaker}:${cue.text.trim()}` : cue.text.trim());
    lastSpeaker = cue.speaker;
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

/**
 * The cues of one stretch of the film (an in–out export): outside dropped, crossing ones cut, and moved so the stretch
 * starts at 0.
 * @template {FilmSubtitleCue} T
 * @param {readonly T[]} cues @param {number} fromMs @param {number} toMs @returns {T[]}
 */
function filmSubtitleCuesInRange(cues, fromMs, toMs) {
  /** @type {T[]} */
  const out = [];
  for (const cue of cues) {
    const start = Math.max(cue.startMs, fromMs);
    const end = Math.min(cue.startMs + cue.durMs, toMs);
    if (end <= start) continue;
    out.push({ ...cue, startMs: start - fromMs, durMs: end - start });
  }
  return out;
}

return {parseFilmSubtitleStyle,FILM_SUBTITLE_DEFAULT,filmSubtitleLanguageOf,filmSubtitleLanguagesIn};
})();

const NativeSegments = (() => {
// @ts-check
/**
 * A spoken line cut into subtitles the way subtitlers cut them: one clause per subtitle, one line per subtitle, on
 * screen long enough to read and never for ages.
 *
 * A transcript (transcripts.mjs) keeps what was said as spoken lines; the film's subtitles (captions.mjs) are cut from
 * each line here, at cue time. So the transcript stays as it was spoken (the person corrects a line, an agent rewrites
 * it, a translation follows it line by line) and every subtitle is derived: a piece knows its line and its place in it
 * (`part`, `from`/`to`), so a correction of one subtitle goes back into the right characters of the right line.
 *
 * The rules, in order (every number is in SUBTITLE_SEGMENT_RULES):
 *   1. Units. The line's words (cores): a Latin word whole (with its inner `.'-/`: 3.5, e.g, don't, node.js), a CJK
 *      run cut into words by Intl.Segmenter. Punctuation sticks to its word: closing marks to the one before, opening
 *      ones to the one after. Each character has a time: from the word marks when the line has them (speech between
 *      marks at a speaking pace, the rest of the span is a pause), else spread over the line by weight (a CJK character
 *      1, a Latin letter less, a comma or full stop a short pause).
 *   2. Hard breaks: a sentence end (。！？!?… and a full stop that is not a decimal, an initial or an abbreviation like
 *      e.g. / Mr.), and a pause between two words of at least `pauseMs`.
 *   3. Clause breaks: ，；：,;:— and the edges of parentheses start a new subtitle when the part before and the part
 *      after each have `minUnits` (CJK 4 characters, Latin 2 words): no orphans like 好，. The enumeration comma 、
 *      joins the items of one list (苹果、香蕉、橙子): it is where a list too long for a line is cut first, not a break.
 *   4. Length: a subtitle is one line, at most `maxCells` (CJK: full-width 1, the rest ½) or `maxChars` (Latin). A clause
 *      still too long (or longer than `maxMs`) is cut where it costs least: a long pause first, then before a
 *      conjunction or after a closing particle, then balanced halves; never inside a word, between a number and its
 *      unit, or inside brackets and quotes (unless what they hold does not fit), and only reluctantly where Latin meets
 *      CJK ("MIT 协议" reads as one term).
 *   5. Time. A subtitle starts with its first word and ends with its last, held up to `holdMs` longer but never into
 *      the next one; a gap under `closeGapMs` is closed (no flicker); one shorter than `minMs` is held into the silence
 *      after it, else joined to a neighbor when the two still fit on a line. A line's last subtitle ends with the line.
 *   6. Text. Chinese convention: no ，。、；： at the end of a subtitle (？！… and closing quotes stay); Latin keeps its
 *      punctuation (subtitleEnd).
 *   7. Translations follow the original's cuts (alignTranslation): the translated line is cut, by the same marks, into
 *      as many pieces near the same moments; where it cannot be cut well, one translated piece spans several.
 *
 * Plain JavaScript, no dependencies, no I/O.
 */

const SUBTITLE_SEGMENT_RULES = Object.freeze({
  /** Longest subtitle when the line has CJK, in cells: a full-width character is 1, anything else ½ (16 ≈ a phone's width). */
  maxCells: 16,
  /** Longest subtitle in Latin script, in characters (the broadcast and streaming norm). */
  maxChars: 42,
  /** A clause mark starts a new subtitle only when each side has this many units: a CJK character is 1, a word 2. */
  minUnits: 4,
  /** A pause this long between two words ends a subtitle. */
  pauseMs: 500,
  /** Shortest time on screen: less cannot be read. */
  minMs: 700,
  /** Longest time on screen: more is a wall of text; cut further. */
  maxMs: 7000,
  /** A subtitle stays up this much after its last word ends (never into the next one). */
  holdMs: 200,
  /** A gap shorter than this between two subtitles is closed: the line blinking off and on is worse. */
  closeGapMs: 150,
  /** How long a CJK character takes to say, for timing text between word marks; everything else by its weight. */
  msPerCell: 220,
  /** Speaking weight of a character, a CJK character being 1. Punctuation weighs as the pause it is. */
  weight: Object.freeze({ latin: 0.32, space: 0.15, clause: 1.5, sentence: 2.5 }),
  /**
   * What a cut costs (lower is better), for a clause too long for one line and for cutting a translation. The pause
   * bonus outweighs the words', which outweigh balance: the speaker's own pause is the surest boundary.
   */
  cost: Object.freeze({
    /** each subtitle (fewer is better), and how much uneven pieces cost: balance × Σ(width / cap)² */
    piece: 10, balance: 4,
    /** a piece under minUnits; one over the cap (when nothing else fits); one over maxMs (× its length / maxMs) */
    short: 6, over: 50, long: 20,
    /** where the cut is: between CJK words (more when one is a single character: often a word the dictionary missed),
        where Latin meets CJK, inside brackets or quotes, before a particle that leans on the word before (了 的 们),
        after a word that leans on the next (the, by, 用, 把) */
    cjk: 1, cjkSingle: 1, mixed: 3, bracket: 8, leansBack: 8, leansForward: 4,
    /** before a conjunction, after a closing particle, at the most a pause (scaled up to pauseMs) */
    conjunction: -4, particle: -3, pause: -10,
    /** cutting a translation: at a sentence or clause mark, how far from the original's moment (× the fraction off),
        and not cutting it there at all */
    sentence: -6, clause: -4, distance: 20, merge: 6,
  }),
});

/** @typedef {typeof SUBTITLE_SEGMENT_RULES} SubtitleSegmentRules */
/** @typedef {{ text: string, startMs: number, endMs: number, marks?: readonly { index: number, startMs: number }[] }} SegmentLine */
/**
 * One subtitle cut from a line: its text (as the line has it, trimmed), its times, its timed words (indexes in `text`),
 * which piece of the line it is, and where its text sits in the line's (`from`/`to`, for putting a correction back).
 * @typedef {{ text: string, startMs: number, endMs: number, marks?: { index: number, startMs: number }[], part: number, from: number, to: number }} SubtitlePiece
 */

/* ── characters ──────────────────────────────────────────────────────────── */

/* written without spaces between words: cut by the dictionary, a character at a time */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3005\u3006\u30fc\uff70]/u;
const HANGUL = /\p{Script=Hangul}/u;
const LETTER = /[\p{L}\p{N}\p{M}]/u;
const DIGIT = /\p{N}/u;
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/;
const FULL_PUNCT = /[\uff0c\u3002\u3001\uff1b\uff1a\uff01\uff1f]/;
/* inside a Latin word when a letter follows: 3.5, e.g, don't, state-of-the-art, and/or, R&D, snake_case */
const JOIN = new Set(['.', '\'', '\u2019', '-', '_', '/', '&']);
/* inside a number when digits are on both sides: 1,000 and 10:30 */
const NUM_JOIN = new Set([',', ':']);
const OPEN = new Set([...'\uff08([\u3010\uff3b\u300c\u300e\u300a\u3008\u201c\u2018\uff5b{']);
const CLOSE = new Set([...'\uff09)]\u3011\uff3d\u300d\u300f\u300b\u3009\u201d\u2019\uff5d}']);
/* parentheses (not quotes or title marks): their edges are clause boundaries */
const PAREN_OPEN = /[\uff08(\u3010\uff3b[]/;
const PAREN_CLOSE = /[\uff09)\u3011\uff3d\]]/;
const CURRENCY = new Set([...'$\u00a5\u20ac\u00a3\u20a9#@']);
const SENTENCE_MARK = /[\u3002\uff01\uff1f!?\u2026\u203c\u2047\u2048\u2049\uff61]|\.{2,}/;
const CLAUSE_MARK = /[\uff0c,\uff1b;\uff1a:\u2014\uff5c|]/;
const LIST_MARK = /\u3001/;
/* a dash between spaces (a false start, "th- the", has none before it) */
const SPACED_DASH = /\s[-\u2013]+(?:\s|$)/;
const DOT = /[.\uff0e]/;

/* abbreviations a full stop follows without ending the sentence; the second kind ends it only before a capital */
const NEVER_ENDS = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'vs', 'e.g', 'i.e', 'cf', 'approx', 'dept', 'gen', 'gov', 'sgt', 'capt', 'lt', 'col', 'rev', 'hon']);
const NUMBERED = new Set(['no', 'nos', 'vol', 'ch', 'p', 'pp', 'fig', 'art', 'sec', 'ep']);
const ENDS_BEFORE_CAPITAL = new Set(['etc', 'inc', 'ltd', 'co', 'corp', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec']);

/* a CJK word after a number is mostly its unit or measure word (3 个, 5 秒, 100 元): they stay together */
const MEASURE = /^[\u79d2\u5206\u65f6\u4e2a\u53ea\u5143\u5757\u5c81\u5e74\u6708\u65e5\u53f7\u5929\u5468\u6b21\u500d\u5ea6\u7c73\u514b\u65a4\u91cc\u5c42\u4ef6\u4f4d\u540d\u6761\u5f20\u90e8\u672c\u53f0\u79cd\u70b9\u5e27\u884c\u9875\u5206\u4e07\u4ebf\u5343\u767e\u6beb\u5398\u5c0f\u79d2\u5341]/;
const UNITS = new Set(['s', 'ms', 'sec', 'secs', 'min', 'mins', 'h', 'hr', 'hrs', 'k', 'm', 'km', 'cm', 'mm', 'g', 'kg', 'mg', 'lb', 'lbs', 'ft', 'in', 'b', 'kb', 'mb', 'gb', 'tb', 'fps', 'px', 'pt', 'em', 'x', 'hz', 'khz', 'mhz', 'ghz', 'db', 'am', 'pm', 'p', 'mph', 'kph', 'percent', 'usd', 'rmb', 'yuan']);

/* a cut before these is where speech turns; after the particles, a thought has ended */
const CJK_CONJUNCTIONS = ['\u4f46\u662f', '\u4f46', '\u6240\u4ee5', '\u56e0\u4e3a', '\u7136\u540e', '\u800c\u4e14', '\u5982\u679c', '\u548c', '\u6216', '\u6216\u8005', '\u8fd8\u662f', '\u4e0d\u8fc7', '\u53ef\u662f', '\u5e76\u4e14', '\u4e8e\u662f', '\u56e0\u6b64', '\u867d\u7136', '\u7136\u800c', '\u800c\u662f', '\u4ee5\u53ca', '\u53ea\u8981', '\u5373\u4f7f'];
const LATIN_CONJUNCTIONS = new Set(['and', 'but', 'so', 'because', 'which', 'that', 'or', 'when', 'while', 'if', 'where', 'who', 'though', 'although', 'then', 'unless', 'until']);
/* words that lean on the one before (写了, 我们, 好的, 愿意的话): a cut before them leaves them hanging */
const LEANS_BACK = new Set(['\u4e86', '\u7684', '\u7740', '\u8fc7', '\u4eec', '\u5730', '\u5f97', '\u5417', '\u5462', '\u5427', '\u554a', '\u5440', '\u561b', '\u4e48', '\u4e4b', '\u7684\u8bdd']);
/* words that lean on the one after (to the, by, 用, 把): a cut after them leaves them hanging */
const LEANS_FORWARD = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'about', 'my', 'your', 'our',
  'their', 'his', 'her', 'its', 'this', 'these', 'those', 'very', '\u628a', '\u88ab', '\u7ed9', '\u5bf9', '\u4ece', '\u5411', '\u8ddf', '\u7528', '\u5728', '\u5c06']);
/* hesitations, which the printed subtitle leaves out (captions.mjs): they count for nothing in a piece's length */
const FILLERS = new Set(['\u5443', '\u55ef', '\u989d', 'uh', 'um', 'erm', 'mm', 'mmm', 'hmm', 'mhm']);
const CJK_PARTICLES = ['\u7684\u8bdd', '\u5427', '\u5462', '\u554a', '\u5417', '\u5440', '\u561b'];

/** @param {string} t @param {number} i */
const cpAt = (t, i) => String.fromCodePoint(/** @type {number} */ (t.codePointAt(i)));

/** Whether a text is set by CJK rules: it has CJK characters or full-width marks. @param {string} t */
const cjkText = (t) => CJK.test(t) || HANGUL.test(t) || FULL_PUNCT.test(t);

/** A text's width in cells: a full-width character is one, anything else half. @param {string} t */
function subtitleCells(t) {
  let n = 0;
  for (const ch of t) n += WIDE.test(ch) || CJK.test(ch) ? 1 : 0.5;
  return n;
}

/**
 * The end of a subtitle as it is printed. Chinese (and Japanese, Korean) subtitles drop a trailing ，。、；： (the
 * subtitle's end is the pause); a question, an exclamation, an ellipsis and closing quotes stay, they say something.
 * Latin subtitles keep their punctuation.
 * @param {string} text
 */
function subtitleEnd(text) {
  const t = text.trimEnd();
  if (!cjkText(t) || /(?:\.{2,}|\u2026)$/.test(t)) return t;
  return t.replace(/[\s\uff0c,\u3001\u3002\uff0e.\uff1b;\uff1a:]+$/u, '');
}

/* ── words ───────────────────────────────────────────────────────────────── */

/** @type {Intl.Segmenter | null | undefined} */
let segmenter;

/** A CJK run cut into words ([from, to) in the run): by the dictionary, else a character each. @param {string} run */
function cjkWords(run) {
  if (segmenter === undefined) segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;
  if (segmenter) return [...segmenter.segment(run)].map((s) => ({ from: s.index, to: s.index + s.segment.length }));
  /** @type {{ from: number, to: number }[]} */
  const out = [];
  for (let i = 0; i < run.length;) { const n = cpAt(run, i).length; out.push({ from: i, to: i + n }); i += n; }
  return out;
}

/** The words of a text, [from, to) each: CJK words, and Latin (or Hangul) words with their inner marks. @param {string} t */
function coresOf(t) {
  /** @type {{ from: number, to: number, cjk: boolean }[]} */
  const out = [];
  let i = 0;
  while (i < t.length) {
    const ch = cpAt(t, i);
    if (CJK.test(ch)) {
      let j = i;
      while (j < t.length && CJK.test(cpAt(t, j))) j += cpAt(t, j).length;
      for (const w of cjkWords(t.slice(i, j))) out.push({ from: i + w.from, to: i + w.to, cjk: true });
      i = j;
      continue;
    }
    if (!LETTER.test(ch)) { i += ch.length; continue; }
    let j = i + ch.length;
    while (j < t.length) {
      const c = cpAt(t, j);
      if (LETTER.test(c) && !CJK.test(c)) { j += c.length; continue; }
      const next = j + c.length < t.length ? cpAt(t, j + c.length) : '';
      const joins = next && LETTER.test(next) && !CJK.test(next)
        && (JOIN.has(c) || (NUM_JOIN.has(c) && DIGIT.test(t[j - 1] ?? '') && DIGIT.test(next)));
      if (!joins) break;
      j += c.length;
    }
    out.push({ from: i, to: j, cjk: false });
    i = j;
  }
  return out;
}

/**
 * A word with the punctuation that sticks to it: `from`..`coreFrom` opening marks, `coreTo`..`to` closing marks and the
 * spaces after. The atoms of a text cover it end to end.
 * @typedef {{ from: number, coreFrom: number, coreTo: number, to: number, core: string, trail: string, lead: string, cjk: boolean, number: boolean, units: number, start: number, end: number }} Atom
 */
/**
 * Between two atoms: what kind of boundary (`hard`: sentence end or pause; `clause`; `soft`), never to be cut (`glue`),
 * how much a cut costs there, and the silence there (ms).
 * @typedef {{ hard: boolean, sentence: boolean, clause: boolean, glue: boolean, cost: number, gap: number, depth: number }} Bound
 */

/** @param {string} t @returns {Atom[]} */
function atomsOf(t) {
  const cores = coresOf(t);
  return cores.map((c, k) => {
    const from = k === 0 ? 0 : leadStart(t, cores[k - 1].to, c.from);
    const to = k + 1 < cores.length ? leadStart(t, c.to, cores[k + 1].from) : t.length;
    const core = t.slice(c.from, c.to);
    return {
      from, coreFrom: c.from, coreTo: c.to, to, core, trail: t.slice(c.to, to), lead: t.slice(from, c.from), cjk: c.cjk,
      number: /^\p{N}[\p{N}.,:]*$/u.test(core),
      /* a CJK character is a unit, a word two: CJK ≥ 4 characters, Latin ≥ 2 words */
      units: FILLERS.has(core.toLowerCase()) ? 0 : c.cjk ? [...core].length : 2,
      start: 0, end: 0,
    };
  });
}

/**
 * Where a word's opening marks begin, between the word before (ending at `prevTo`) and it (at `from`): opening
 * brackets and quotes, a currency sign. A straight quote opens when what is before it is not a letter.
 * @param {string} t @param {number} prevTo @param {number} from
 */
function leadStart(t, prevTo, from) {
  let i = from;
  while (i > prevTo) {
    const ch = t[i - 1];
    const opening = OPEN.has(ch) || CURRENCY.has(ch) || (ch === '"' && i - 1 > prevTo && !LETTER.test(t[i - 2] ?? ''));
    if (!opening) break;
    i -= 1;
  }
  return i;
}

/** Whether a full stop after `prev` ends its sentence (`next`: the word after, if any). @param {Atom} prev @param {Atom | undefined} next */
function stopEnds(prev, next) {
  if (!next || next.cjk) return true;
  const word = prev.core.toLowerCase();
  if (NEVER_ENDS.has(word)) return false;
  /* No. 5, p. 12 */
  if (next.number && NUMBERED.has(word)) return false;
  /* an initial: J. K. Rowling */
  if (/^\p{Lu}$/u.test(prev.core)) return false;
  /* U.S., a.m., etc.: the sentence ends there only if the next word starts one */
  if (/^(?:\p{L}\.)+\p{L}$/u.test(prev.core) || ENDS_BEFORE_CAPITAL.has(word)) return /^\p{Lu}/u.test(next.core) && next.core !== 'I';
  return true;
}

/* ── timing ──────────────────────────────────────────────────────────────── */

/** @param {string} ch @param {SubtitleSegmentRules} R */
function weightOf(ch, R) {
  if (CJK.test(ch) || HANGUL.test(ch)) return 1;
  if (LETTER.test(ch)) return R.weight.latin;
  if (/\s/.test(ch)) return R.weight.space;
  if (SENTENCE_MARK.test(ch) || DOT.test(ch)) return R.weight.sentence;
  if (CLAUSE_MARK.test(ch) || LIST_MARK.test(ch) || PAREN_OPEN.test(ch) || PAREN_CLOSE.test(ch)) return R.weight.clause;
  return 0;
}

/**
 * When each character of a line starts and ends (ms, by code unit). With word marks, the text from one mark to the
 * next is said at the speaking pace from its mark (faster when the next mark comes sooner); what is left before the
 * next mark is a pause. Without marks, the line's time is shared out by weight.
 * @param {SegmentLine} line @param {SubtitleSegmentRules} R
 */
function timeline(line, R) {
  const t = line.text;
  const start = new Float64Array(t.length), end = new Float64Array(t.length);
  const weights = new Float64Array(t.length);
  for (let i = 0; i < t.length;) { const ch = cpAt(t, i); weights[i] = weightOf(ch, R); i += ch.length; }
  const marks = (line.marks ?? []).filter((m) => m.index >= 0 && m.index < t.length);
  const spans = marks.length
    ? [...(marks[0].index > 0 ? [{ index: 0, startMs: line.startMs }] : []), ...marks]
    : [{ index: 0, startMs: line.startMs }];
  spans.forEach((m, k) => {
    const to = spans[k + 1]?.index ?? t.length;
    const until = spans[k + 1]?.startMs ?? line.endMs;
    const room = Math.max(0, until - m.startMs);
    let total = 0;
    for (let i = m.index; i < to; i += 1) total += weights[i];
    const per = !total ? 0 : !marks.length ? room / total : Math.min(R.msPerCell, room / total);
    let at = m.startMs;
    for (let i = m.index; i < to; i += 1) { start[i] = at; at += weights[i] * per; end[i] = at; }
  });
  return { start, end };
}

/* ── one line ────────────────────────────────────────────────────────────── */

/**
 * A text's atoms and the boundaries between them (`bounds[k]`: between atom k-1 and k), timed when `times` is given;
 * pauses are told only from real word times (`heard`): spread-out times would invent them.
 * @param {string} t @param {SubtitleSegmentRules} R @param {{ start: Float64Array, end: Float64Array } | null} times @param {boolean} heard
 */
function analyse(t, R, times, heard) {
  const atoms = atomsOf(t);
  if (times) for (const a of atoms) { a.start = times.start[a.coreFrom]; a.end = times.end[a.coreTo - 1]; }
  /** @type {Bound[]} */
  const bounds = [];
  const C = R.cost;
  let depth = 0, quoted = false;
  for (let k = 0; k + 1 < atoms.length; k += 1) {
    const a = atoms[k], next = atoms[k + 1];
    for (const ch of a.lead) { if (OPEN.has(ch)) depth += 1; else if (ch === '"') { depth += 1; quoted = true; } }
    for (const ch of a.trail) {
      if (CLOSE.has(ch)) depth = Math.max(0, depth - 1);
      else if (ch === '"' && quoted) { depth = Math.max(0, depth - 1); quoted = false; }
    }
    const trail = a.trail.trim();
    const gap = heard ? Math.max(0, next.start - a.end) : 0;
    const stop = DOT.test(trail.slice(-1)) && !/\.{2,}$/.test(trail) && stopEnds(a, next);
    const sentence = SENTENCE_MARK.test(trail) || stop;
    const clause = CLAUSE_MARK.test(trail) || SPACED_DASH.test(a.trail) || PAREN_CLOSE.test(trail) || PAREN_OPEN.test(next.lead);
    /* a number with its unit (3.5 s, 5 秒), 第 with its number */
    const glue = !trail && ((a.number && (next.cjk ? MEASURE.test(next.core) : UNITS.has(next.core.toLowerCase())))
      || (a.cjk && a.core.endsWith('\u7b2c') && next.number));
    let cost = 0;
    if (a.cjk && next.cjk) cost += C.cjk + ([...a.core].length === 1 || [...next.core].length === 1 ? C.cjkSingle : 0);
    else if (a.cjk !== next.cjk) cost += C.mixed;
    if (depth > 0) cost += C.bracket;
    if (next.cjk && LEANS_BACK.has(next.core)) cost += C.leansBack;
    if (!trail && LEANS_FORWARD.has(a.core.toLowerCase())) cost += C.leansForward;
    if (gap >= 120) cost += C.pause * Math.min(1, (gap - 120) / Math.max(1, R.pauseMs - 120));
    const conjunction = next.cjk
      ? CJK_CONJUNCTIONS.some((c) => next.core === c || (c.length > 1 && next.core.startsWith(c)))
      : LATIN_CONJUNCTIONS.has(next.core.toLowerCase());
    if (conjunction) cost += C.conjunction;
    if (a.cjk && CJK_PARTICLES.some((p) => a.core === p || (p.length > 1 && a.core.endsWith(p)))) cost += C.particle;
    if (sentence) cost += C.sentence;
    else if (clause || LIST_MARK.test(trail)) cost += C.clause;
    bounds[k + 1] = {
      hard: gap >= R.pauseMs || (depth === 0 && sentence), sentence: depth === 0 && sentence, clause: depth === 0 && clause,
      glue, cost, gap, depth,
    };
  }
  return { atoms, bounds };
}

/**
 * Measures of a text's atoms: the width of atoms [i, j) (cells for CJK text, characters for Latin), their units, how
 * long they take to say.
 * @param {string} t @param {Atom[]} atoms @param {SubtitleSegmentRules} R
 */
function measures(t, atoms, R) {
  const cjk = cjkText(t);
  const cap = cjk ? R.maxCells : R.maxChars;
  /** @param {number} i @param {number} j */
  const width = (i, j) => {
    const shown = t.slice(atoms[i].from, atoms[j - 1].coreTo).trim();
    return cjk ? subtitleCells(shown) : [...shown].length;
  };
  /** @param {number} i @param {number} j */
  const units = (i, j) => { let n = 0; for (let k = i; k < j; k += 1) n += atoms[k].units; return n; };
  /** @param {number} i @param {number} j */
  const dur = (i, j) => atoms[j - 1].end - atoms[i].start;
  return { cap, width, units, dur };
}

/**
 * Atoms [s, e) too long for one subtitle, cut where the cuts cost least (dynamic programming over the boundaries):
 * returns the atom indexes the pieces start at.
 * @param {number} s @param {number} e @param {Bound[]} bounds @param {ReturnType<typeof measures>} m @param {SubtitleSegmentRules} R
 */
function cutLong(s, e, bounds, m, R) {
  const C = R.cost;
  const n = e - s;
  const best = new Float64Array(n + 1).fill(Infinity);
  const back = new Int32Array(n + 1);
  best[0] = 0;
  for (let j = 1; j <= n; j += 1) {
    for (let i = j - 1; i >= 0; i -= 1) {
      if (!Number.isFinite(best[i]) || (i > 0 && bounds[s + i].glue)) continue;
      const w = m.width(s + i, s + j);
      let cost = best[i] + C.piece + C.balance * (Math.min(w, m.cap) / m.cap) ** 2;
      if (w > m.cap) cost += C.over * (w - m.cap);
      if (m.units(s + i, s + j) < R.minUnits) cost += C.short;
      const d = m.dur(s + i, s + j);
      if (d > R.maxMs) cost += C.long * (d / R.maxMs);
      if (i > 0) cost += bounds[s + i].cost;
      if (cost < best[j]) { best[j] = cost; back[j] = i; }
    }
  }
  /** @type {number[]} */
  const starts = [];
  for (let j = n; j > 0; j = back[j]) starts.unshift(s + back[j]);
  return starts;
}

/**
 * A spoken line cut into subtitles (see the rules at the top). Always at least one piece; the pieces cover the line's
 * text end to end, in order, and depend on nothing but the line, so the same line always gives the same pieces (a
 * correction names its piece by number).
 * @param {SegmentLine} line @param {SubtitleSegmentRules} [R]
 * @returns {SubtitlePiece[]}
 */
function segmentLine(line, R = SUBTITLE_SEGMENT_RULES) {
  const t = line.text;
  const whole = () => [{ text: t.trim(), startMs: line.startMs, endMs: line.endMs, ...(line.marks?.length ? { marks: [...line.marks] } : {}), part: 0, from: t.length - t.trimStart().length, to: t.trimEnd().length }];
  const times = timeline(line, R);
  const { atoms, bounds } = analyse(t, R, times, Boolean(line.marks?.length));
  if (atoms.length < 2) return whole();
  const m = measures(t, atoms, R);

  /* 2. sentences (and long pauses), 3. clauses with enough on both sides, 4. what is still too long */
  /** @type {number[]} */
  const starts = [];
  let sentence = 0;
  for (let k = 1; k <= atoms.length; k += 1) {
    if (k < atoms.length && !bounds[k].hard) continue;
    let piece = sentence;
    /** @type {number[]} */
    const clauses = [sentence];
    for (let c = sentence + 1; c < k; c += 1) {
      if (!bounds[c].clause) continue;
      if (m.units(piece, c) >= R.minUnits && m.units(c, k) >= R.minUnits) { clauses.push(c); piece = c; }
    }
    clauses.forEach((from, n) => {
      const to = clauses[n + 1] ?? k;
      if (m.width(from, to) <= m.cap && m.dur(from, to) <= R.maxMs) starts.push(from);
      else starts.push(...cutLong(from, to, bounds, m, R));
    });
    sentence = k;
  }

  /* 5. times, the short ones held or joined */
  /** @type {{ a: number, b: number, startMs: number, endMs: number }[]} */
  let pieces = starts.map((a, n) => ({ a, b: starts[n + 1] ?? atoms.length, startMs: 0, endMs: 0 }));
  const strength = (/** @type {number} */ k) => (bounds[k].gap >= R.pauseMs ? 3 : bounds[k].sentence ? 2 : bounds[k].clause ? 1 : 0);
  const time = () => {
    pieces.forEach((p, n) => {
      p.startMs = n === 0 ? line.startMs : Math.max(Math.round(atoms[p.a].start), pieces[n - 1].startMs + 1);
    });
    pieces.forEach((p, n) => {
      const next = pieces[n + 1];
      if (!next) { p.endMs = Math.max(line.endMs, p.startMs + 1); return; }
      let end = Math.min(next.startMs, Math.max(Math.round(atoms[p.b - 1].end), p.startMs + 1) + R.holdMs);
      if (end - p.startMs < R.minMs) end = Math.min(next.startMs, p.startMs + R.minMs);
      if (next.startMs - end < R.closeGapMs) end = next.startMs;
      p.endMs = end;
    });
  };
  time();
  for (let guard = pieces.length; guard > 0; guard -= 1) {
    const n = pieces.findIndex((p, i) => p.endMs - p.startMs < R.minMs && pieces.length > 1 && [i - 1, i + 1].some((o) => joinable(i, o)));
    if (n < 0) break;
    const options = [n - 1, n + 1].filter((o) => joinable(n, o));
    /* across the weaker boundary, else into the shorter neighbor */
    options.sort((x, y) => strength(pieces[Math.max(n, x)].a) - strength(pieces[Math.max(n, y)].a) || m.width(pieces[x].a, pieces[x].b) - m.width(pieces[y].a, pieces[y].b));
    const o = options[0];
    const [lo, hi] = o < n ? [o, n] : [n, o];
    pieces.splice(lo, 2, { a: pieces[lo].a, b: pieces[hi].b, startMs: 0, endMs: 0 });
    time();
  }
  function joinable(/** @type {number} */ n, /** @type {number} */ o) {
    const p = pieces[n], q = pieces[o];
    if (!p || !q) return false;
    const a = Math.min(p.a, q.a), b = Math.max(p.b, q.b);
    return m.width(a, b) <= m.cap && m.dur(a, b) <= R.maxMs;
  }
  if (pieces.length === 1) return whole();

  /* the pieces' text and timed words, each mark moved to its place in the piece */
  const marks = line.marks ?? [];
  return pieces.map((p, part) => {
    const from = p.a === 0 ? t.length - t.trimStart().length : atoms[p.a].from;
    const to = p.b === atoms.length ? t.trimEnd().length : from + t.slice(from, atoms[p.b].from).trimEnd().length;
    const own = marks.filter((mk) => mk.index >= from && mk.index < to).map((mk) => ({ index: mk.index - from, startMs: mk.startMs }));
    const timed = marks.length ? (own[0]?.index === 0 ? own : [{ index: 0, startMs: p.startMs }, ...own]) : [];
    return { text: t.slice(from, to), startMs: p.startMs, endMs: p.endMs, ...(timed.length ? { marks: timed } : {}), part, from, to };
  });
}

/* ── translations ────────────────────────────────────────────────────────── */

/**
 * A translation of a line cut to follow the original's pieces: one entry per piece, its text and where it sits in
 * `text`. The translation is cut by the same marks (sentence, clause, word boundaries) as near as it can to the moments
 * the original's pieces start (by its speaking weight: the translation is read over the same speech). A cut too far
 * from any good boundary is not made: then one translated piece spans several of the original's (the same entry
 * repeated), rather than a translation cut mid-thought.
 * @param {string} text @param {readonly { startMs: number, endMs: number }[]} pieces @param {SubtitleSegmentRules} [R]
 * @returns {{ text: string, from: number, to: number }[]}
 */
function alignTranslation(text, pieces, R = SUBTITLE_SEGMENT_RULES) {
  const lead = text.length - text.trimStart().length, tail = text.trimEnd().length;
  const whole = { text: text.trim(), from: lead, to: Math.max(lead, tail) };
  if (pieces.length < 2 || !whole.text) return pieces.map(() => whole);
  const { atoms, bounds } = analyse(text, R, null, false);
  const A = atoms.length, N = pieces.length;
  if (A < 2) return pieces.map(() => whole);
  const C = R.cost;
  const m = measures(text, atoms, R);
  /* how far into the translation each boundary is, by speaking weight */
  const before = new Float64Array(A + 1);
  for (let k = 0; k < A; k += 1) {
    let w = 0;
    for (const ch of atoms[k].core) w += weightOf(ch, R);
    before[k + 1] = before[k] + w;
  }
  const total = before[A] || 1;
  const span = Math.max(1, pieces[N - 1].endMs - pieces[0].startMs);
  const target = pieces.slice(1).map((p) => (p.startMs - pieces[0].startMs) / span);
  const shortCost = (/** @type {number} */ a, /** @type {number} */ b) => (m.units(a, b) < R.minUnits ? C.short : 0);
  /* best[j][p]: the first j of the original's boundaries decided, the last cut at atom p (0: none yet) */
  const best = Array.from({ length: N }, () => new Float64Array(A).fill(Infinity));
  const back = Array.from({ length: N }, () => new Int32Array(A).fill(-1));
  best[0][0] = 0;
  for (let j = 0; j < N - 1; j += 1) {
    for (let p = 0; p < A; p += 1) {
      const here = best[j][p];
      if (!Number.isFinite(here)) continue;
      if (here + C.merge < best[j + 1][p]) { best[j + 1][p] = here + C.merge; back[j + 1][p] = p; }
      for (let q = p + 1; q < A; q += 1) {
        if (bounds[q].glue) continue;
        const cost = here + C.distance * Math.abs(before[q] / total - target[j]) + bounds[q].cost + shortCost(p, q);
        if (cost < best[j + 1][q]) { best[j + 1][q] = cost; back[j + 1][q] = p; }
      }
    }
  }
  let last = 0, lowest = Infinity;
  for (let p = 0; p < A; p += 1) {
    const cost = best[N - 1][p] + shortCost(p, A);
    if (cost < lowest) { lowest = cost; last = p; }
  }
  /* each of the original's boundaries: where the translation is cut there, or -1 */
  const cuts = new Array(N - 1).fill(-1);
  for (let j = N - 1, p = last; j > 0; j -= 1) {
    const prev = back[j][p];
    if (prev !== p) cuts[j - 1] = p;
    p = prev;
  }
  /** @type {{ text: string, from: number, to: number }[]} */
  const out = [];
  for (let n = 0, at = 0; n < N;) {
    /* pieces n..last share the translation from atom `at` to the next cut */
    let last = n;
    while (last < N - 1 && cuts[last] < 0) last += 1;
    const until = last < N - 1 ? cuts[last] : A;
    const a = at === 0 ? lead : atoms[at].from;
    const b = until === A ? tail : a + text.slice(a, atoms[until].from).trimEnd().length;
    const one = { text: text.slice(a, b), from: a, to: b };
    for (; n <= last; n += 1) out.push(one);
    at = until;
  }
  return out;
}

/* ── corrections ─────────────────────────────────────────────────────────── */

/**
 * A line with the person's correction of one of its pieces (`from`/`to` in its text) put in. What the subtitle dropped
 * at its end (a comma) goes back after the new words, unless they end with a mark of their own; emptied, the piece goes
 * with the space after it. Timed words outside the piece keep their times (so the other subtitles stay as they were);
 * the piece's own are one mark at its start (`startMs`): a changed piece is timed as a whole.
 * @param {SegmentLine} line @param {{ from: number, to: number }} piece @param {string} text @param {number} [startMs]
 * @returns {{ text: string, marks?: { index: number, startMs: number }[] }}
 */
function replacePiece(line, piece, text, startMs) {
  const t = line.text;
  const raw = t.slice(piece.from, piece.to);
  const dropped = raw.slice(subtitleEnd(raw).length);
  const said = text.replace(/\s+/g, ' ').trim();
  let end = piece.to;
  let insert = said;
  if (!said) {
    while (end < t.length && /\s/.test(t[end])) end += 1;
  } else if (!/\p{P}$/u.test(said)) {
    insert += dropped;
  }
  let out = t.slice(0, piece.from) + insert + t.slice(end);
  const delta = insert.length - (end - piece.from);
  /** @type {{ index: number, startMs: number }[]} */
  let marks = [];
  for (const mk of line.marks ?? []) {
    if (mk.index < piece.from) marks.push(mk);
    else if (mk.index >= end) marks.push({ index: mk.index + delta, startMs: mk.startMs });
  }
  if (said && startMs !== undefined && piece.from > 0 && line.marks?.length) {
    marks.push({ index: piece.from, startMs });
    marks.sort((a, b) => a.index - b.index);
  }
  const lead = out.length - out.trimStart().length;
  out = out.trim();
  marks = marks.map((mk) => ({ index: mk.index - lead, startMs: mk.startMs })).filter((mk) => mk.index >= 0 && mk.index < out.length);
  return { text: out, ...(marks.length ? { marks } : {}) };
}

return {segmentLine,alignTranslation,subtitleEnd};
})();

const NativeTranscript = (() => {
const {basename,dirname,extname} = posix;
const CUT_NOTE = 'NOTE Each cue is one subtitle, as cut by hand in OpenFilm Studio.';
const CUT_NOTE_RE = /^NOTE Each cue is one subtitle\b/;

/** The transcript of `src` (a path in the project), in `language` when given: its translation. @param {string} src @param {string} [language] */
function transcriptPath(src, language) {
  const name = basename(src, extname(src));
  const dir = dirname(src);
  return `${dir === '.' ? '' : `${dir}/`}${name}${language ? `.${language}` : ''}.vtt`;
}

/** `00:01.250` or `00:00:01.250` → milliseconds. @param {string} stamp */
function msOf(stamp) {
  const parts = stamp.trim().split(':').map(Number);
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return NaN;
  return Math.round(parts.reduce((acc, n) => acc * 60 + n, 0) * 1000);
}

/** milliseconds → `00:00:01.250`. @param {number} ms */
function stampOf(ms) {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000), m = Math.floor(t / 60_000) % 60, s = Math.floor(t / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(t % 1000).padStart(3, '0')}`;
}

const unescape = (/** @type {string} */ s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const escape = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A WebVTT's lines. Tags other than timestamps and voices (`<b>`, `<c.x>`, `<lang>`) are dropped; a cue's own lines
 * are one subtitle line.
 * @param {string} body @returns {Transcript}
 */
function parseVtt(body) {
  /** @type {SpokenLine[]} */
  const lines = [];
  /** @type {string | undefined} */
  let speaker;
  let cut = false;
  for (const block of body.replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n{2,}/)) {
    const rows = block.split('\n');
    if (CUT_NOTE_RE.test(rows[0] ?? '')) cut = true;
    const timing = rows.findIndex((r) => r.includes('-->'));
    if (timing < 0 || /^(NOTE|STYLE|REGION)\b/.test(rows[0] ?? '')) continue;
    const [a, b] = rows[timing].split('-->');
    const startMs = msOf(a), endMs = msOf(b.trim().split(/\s+/)[0] ?? '');
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    let raw = '';
    /** @type {{ index: number, startMs: number }[]} */
    const timed = [];
    let pending = /** @type {number | null} */ (null);
    for (const [, tag, chunk] of rows.slice(timing + 1).join(' ').matchAll(/<([^>]*)>|([^<]+)/g)) {
      if (tag !== undefined) {
        const at = msOf(tag);
        if (Number.isFinite(at)) pending = at;
        else if (/^v[\s.]/.test(tag)) speaker ??= tag.replace(/^v(\.\S*)?\s+/, '').trim() || undefined;
        continue;
      }
      const piece = unescape(chunk);
      if (pending !== null && piece.trim()) { timed.push({ index: raw.length + piece.length - piece.trimStart().length, startMs: pending }); pending = null; }
      raw += piece;
    }
    const said = raw.replace(/\s+/g, ' ').trim();
    if (!said) continue;
    const marks = remapMarks(raw, said, timed);
    /* a line whose words are timed: its first word starts with the cue */
    const all = marks.length && marks[0].index > 0 ? [{ index: 0, startMs }, ...marks] : marks;
    lines.push({ text: said, startMs, endMs: Math.max(endMs, startMs + 1), ...(all.length ? { marks: all } : {}) });
  }
  return { lines, ...(speaker ? { speaker } : {}), ...(cut ? { cut: true } : {}) };
}

/**
 * Marks found in the raw cue text, moved to the same characters once runs of spaces are one and the ends trimmed.
 * @param {string} raw @param {string} said @param {{ index: number, startMs: number }[]} marks
 */
function remapMarks(raw, said, marks) {
  /* the position in `said` of each raw position: spaces collapse, leading ones go */
  const at = new Array(raw.length + 1).fill(0);
  let j = 0, prevSpace = true;
  for (let i = 0; i < raw.length; i += 1) {
    at[i] = j;
    const space = /\s/.test(raw[i]);
    if (space && prevSpace) continue;
    j += 1;
    prevSpace = space;
  }
  at[raw.length] = j;
  return marks.map((m) => ({ index: Math.min(said.length, at[m.index] ?? said.length), startMs: m.startMs }))
    .filter((m, i, list) => m.index < said.length && (i === 0 || m.index > list[i - 1].index));
}

/**
 * A WebVTT of `lines`, the words timed where their marks are; `cut`: with CUT_NOTE.
 * @param {readonly SpokenLine[]} lines @param {{ speaker?: string, cut?: boolean }} [options]
 */
function vttOf(lines, { speaker, cut } = {}) {
  const cues = lines.map((line) => {
    const marks = (line.marks ?? []).filter((m) => m.index > 0 && m.index < line.text.length);
    let payload = '', from = 0;
    for (const m of marks) {
      payload += `${escape(line.text.slice(from, m.index))}<${stampOf(m.startMs)}>`;
      from = m.index;
    }
    payload += escape(line.text.slice(from));
    return `${stampOf(line.startMs)} --> ${stampOf(line.endMs)}\n${speaker ? `<v ${speaker}>` : ''}${payload}`;
  });
  return `WEBVTT\n\n${cut ? `${CUT_NOTE}\n\n` : ''}${cues.join('\n\n')}\n`;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Pieces of text joined as they are written: a space between words, none next to CJK. @param {readonly string[]} parts */
function joinParts(parts) {
  let out = '';
  for (const part of parts) out += out && !CJK.test(out.slice(-1)) && !CJK.test(part.slice(0, 1)) ? ` ${part}` : part;
  return out;
}

/** Whether a transcript's cues are its words, one each (as some tools time speech), rather than its lines. @param {readonly SpokenLine[]} lines */
function wordCues(lines) {
  if (lines.length < 3) return false;
  const words = lines.filter((l) => !/\s/.test(l.text) && l.endMs - l.startMs < 1200).length;
  return words / lines.length > 0.8;
}

/**
 * Word cues made into lines, as a transcript is cut (spokenLines), each word still timed. A cue of one letter after
 * another is the same word spelt out letter by letter: no space between them.
 * @param {readonly SpokenLine[]} cues
 */
function linesOfWords(cues) {
  const words = cues.map((c) => ({ token: c.text, startSec: c.startMs / 1000, endSec: c.endMs / 1000 }));
  let text = '';
  cues.forEach((c, i) => {
    const letters = c.text.length === 1 && cues[i - 1]?.text.length === 1;
    text = letters ? text + c.text : joinParts([text, c.text].filter(Boolean));
  });
  return spokenLines(text, words, cues.at(-1)?.endMs);
}

const MAX_CELLS = 20;
/** A sentence with only this many cells left stays on its line: a stub line reads worse than a longer one. */
const TAIL_CELLS = 6;
/** A hard break looks for a pause of at least this between two words. */
const MIN_BREAK_GAP_MS = 120;
/** A pause this long breaks the line. */
const GAP_MS = 700;
/** Without timing, about how long a cell takes to say. */
const FALLBACK_MS_PER_CELL = 180;
const SENTENCE_END = /[。！？!?…;；]/;
/* full-width and half-width both: Chinese text uses the full-width comma */
const CLAUSE_END = /[,，、:：]/;
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/;
/* the structural particles de, le, de, de, zhe: after these a Chinese word has almost always ended */
const PARTICLE = /[\u7684\u4e86\u5730\u5f97\u7740]/;
const AUDIO_TAG = /\[[a-z][a-z '-]{1,30}\] ?/g;

/** @param {string} t */
function cells(t) {
  let n = 0;
  for (const ch of t) n += WIDE.test(ch) ? 1 : 0.5;
  return n;
}

/** @param {string} t */
function stripAudioTags(t) {
  return t.replace(AUDIO_TAG, '').replace(/ {2,}/g, ' ').trim();
}

/** A half-width full stop ends a sentence only before a space or the end, and not after a digit (1.21, 0.5%). @param {string} t @param {number} i */
function endsSentence(t, i) {
  const ch = t[i];
  if (SENTENCE_END.test(ch)) return true;
  if (ch !== '.') return false;
  const next = t[i + 1];
  if (next != null && !/\s/.test(next)) return false;
  return !/\d/.test(t[i - 1] ?? '');
}

/** Each word's place in the text (words are said in order; one that does not match is skipped). @param {string} t @param {readonly Word[]} words */
function alignedAt(t, words) {
  /** @type {{ index: number, startSec: number, endSec?: number }[]} */
  const out = [];
  let cursor = 0;
  for (const w of words) {
    if (!w.token) continue;
    const index = t.indexOf(w.token, cursor);
    if (index < 0) continue;
    out.push({ index, startSec: Number.isFinite(w.startSec) ? w.startSec : 0, ...(w.endSec !== undefined ? { endSec: w.endSec } : {}) });
    cursor = index + w.token.length;
  }
  return out;
}

/** Chinese with no pause to break at: after the last structural particle in the second half of the line. @param {string} t @param {number} from @param {number} to */
function particleBreak(t, from, to) {
  for (let k = to - 1; k > from; k -= 1) {
    if (cells(t.slice(from, k)) < MAX_CELLS / 2) break;
    if (PARTICLE.test(t[k - 1])) return k;
  }
  return -1;
}

/** Cells from `i` to the next clause or sentence mark (a line full right before a comma breaks after it, not before the word). @param {string} t @param {number} i */
function restOfClause(t, i) {
  let j = i;
  while (j < t.length && !endsSentence(t, j) && !CLAUSE_END.test(t[j])) j += 1;
  return cells(t.slice(i, j + 1));
}

/**
 * The text cut into lines, as [from, to) indexes. `pauseAt(from, to)`: with no mark to break at, before the longest
 * pause in (from, to] (Chinese has no spaces: the speaker's own pause is the word boundary).
 * @param {string} t @param {(from: number, to: number) => number} [pauseAt]
 */
function chunks(t, pauseAt) {
  /** @type {{ from: number, to: number }[]} */
  const out = [];
  let from = 0;
  let fallback = -1;
  for (let i = 0; i < t.length; i += 1) {
    const ch = t[i];
    if (CLAUSE_END.test(ch)) fallback = i + 1;
    const long = cells(t.slice(from, i + 1)) >= MAX_CELLS;
    if (endsSentence(t, i)) {
      let to = i + 1;
      while (to < t.length && SENTENCE_END.test(t[to])) to += 1;
      out.push({ from, to });
      from = to;
      i = to - 1;
      fallback = -1;
      continue;
    }
    if (!long) continue;
    if (fallback <= from && cells(t.slice(from, i + 1)) < MAX_CELLS + TAIL_CELLS && restOfClause(t, i + 1) <= TAIL_CELLS) continue;
    /* too long: a clause mark, else a space (Latin text must not break inside a word), else a pause, a particle, here */
    let to = fallback > from ? fallback : -1;
    if (to <= from) {
      const space = t.lastIndexOf(' ', i);
      const pause = space > from ? -1 : pauseAt?.(from, i + 1) ?? -1;
      const particle = pause > from || space > from ? -1 : particleBreak(t, from, i + 1);
      to = space > from ? space + 1 : pause > from ? pause : particle > from ? particle : i + 1;
    }
    out.push({ from, to });
    from = to;
    i = to - 1;
    fallback = -1;
  }
  if (from < t.length) out.push({ from, to: t.length });
  return out.filter((c) => t.slice(c.from, c.to).trim().length > 0);
}

/** The first mark whose index is above `at` (marks are in text order). @param {readonly { index: number }[]} marks @param {number} at */
function firstAfter(marks, at) {
  let lo = 0, hi = marks.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (marks[mid].index > at) hi = mid; else lo = mid + 1; }
  return lo;
}

/**
 * A speech's text and word times broken into lines, in the source's own milliseconds (what a transcript is written
 * as). `marks`: each matched word's place in the line and its start. `durMs`: the source's length (the last line's
 * end), if known.
 * @param {string | undefined} source @param {readonly Word[] | undefined} words @param {number | undefined} durMs
 * @returns {SpokenLine[]}
 */
function spokenLines(source, words, durMs) {
  const said = stripAudioTags(source ?? '');
  if (!said) return [];
  const total = durMs !== undefined && Number.isFinite(durMs) ? durMs : undefined;
  const marks = words?.length ? alignedAt(said, words) : [];
  if (!marks.length) {
    /* no word times: the same lines, each given a share of the length by how much of the text it is */
    const pieces = chunks(said).map((piece) => said.slice(piece.from, piece.to).trim()).filter(Boolean);
    const length = total ?? cells(said) * FALLBACK_MS_PER_CELL;
    const weights = pieces.map((piece) => Math.max(1, cells(piece)));
    const sum = weights.reduce((a, b) => a + b, 0);
    let at = 0;
    return pieces.map((t, i) => {
      const startMs = Math.round(at);
      at += (length * weights[i]) / sum;
      return { text: t, startMs, endMs: Math.round(at) };
    });
  }
  const pauseAt = (/** @type {number} */ from, /** @type {number} */ to) => {
    let best = -1, bestGap = MIN_BREAK_GAP_MS / 1000;
    for (let k = Math.max(1, firstAfter(marks, from)); k < marks.length && marks[k].index <= to; k += 1) {
      const m = marks[k], prev = marks[k - 1];
      if (cells(said.slice(from, m.index)) < MAX_CELLS / 2) continue;
      const gap = m.startSec - (prev.endSec ?? prev.startSec);
      if (gap > bestGap) { best = m.index; bestGap = gap; }
    }
    return best;
  };
  const started = chunks(said, pauseAt).map((piece) => {
    const inPiece = marks.slice(firstAfter(marks, piece.from - 1), firstAfter(marks, piece.to - 1));
    const raw = said.slice(piece.from, piece.to);
    const lead = raw.length - raw.trimStart().length;
    return {
      text: raw.trim(),
      /* a piece with no matched word (all digits or marks) follows the one before */
      startMs: inPiece[0] ? Math.round(inPiece[0].startSec * 1000) : 0,
      spokenUntilMs: inPiece.reduce((end, m) => Math.max(end, Math.round((m.endSec ?? m.startSec) * 1000)), 0),
      marks: inPiece.map((m) => ({ index: m.index - piece.from - lead, startMs: Math.round(m.startSec * 1000) })),
    };
  });
  for (const [i, one] of started.entries()) {
    if (i > 0 && one.startMs <= started[i - 1].startMs) one.startMs = started[i - 1].startMs + 1;
  }
  return started.map((one, i) => {
    /* a line stays up until the next one starts (a gap would blank the line being read), the last until the source
       ends, unless that is a long silence: then through its words or the estimated speaking time, plus GAP_MS */
    const until = started[i + 1]?.startMs ?? total ?? Infinity;
    const spoken = Math.max(500, cells(one.text) * FALLBACK_MS_PER_CELL);
    return {
      text: one.text,
      startMs: one.startMs,
      endMs: Math.min(until, Math.max(one.startMs + spoken, one.spokenUntilMs) + GAP_MS),
      ...(one.marks.length ? { marks: one.marks } : {}),
    };
  }).filter((l) => l.endMs > l.startMs);
}

return {transcriptPath,parseVtt,wordCues,linesOfWords};
})();

const NativeCues = (() => {
const {segmentLine,alignTranslation,subtitleEnd}=NativeSegments;
const MIN_CAPTION_MS = 300;
/** A word counts as inside a trim within this much. */
const SLACK_MS = 60;
const EDGE_PUNCT = /^[\s，,、。．.；;：:！!？?…]+|[\s，,、；;：:]+$/g;
const LEAD_PUNCT = /^[\s，,、。．.；;：:！!？?…]+/;
/* standalone fillers (Chinese e, en, e; uh, um) are not printed; sentence particles that carry meaning are */
const FILLER = /(^|[\s\uff0c,\u3001\u3002.\uff01!\uff1f?])(?:\u5443|\u55ef|\u989d|uh|um|erm|mm+|hmm+|mhm)(?=$|[\s\uff0c,\u3001\u3002.\uff01!\uff1f?])[\uff0c,\u3001]?/giu;
/* a word broken off and said again ("a- and", "th- the"): the transcript marks it with a trailing hyphen */
const FALSE_START = /(^|\s)([\p{L}']{1,4})-\s+(?=(\p{L}+))/gu;
/* half-width punctuation after Chinese (common in text typed for TTS): Chinese subtitles set full-width */
const HALF_PUNCT = /(?<=[\u3400-\u9fff])\s*([,;:?!])(?=\s*(?:[\u3400-\u9fff\u201c\u2018\u300a\u300c]|$))/gu;
/** @type {Record<string, string>} */
const FULL_PUNCT = { ',': '\uff0c', ';': '\uff1b', ':': '\uff1a', '?': '\uff1f', '!': '\uff01' };

/**
 * A subtitle as it is printed: no fillers, no false starts, no punctuation it starts with, and its end set by the
 * convention of its script (subtitleEnd: Chinese drops a trailing ，。, Latin keeps its own); '' when nothing is left.
 * @param {string} t
 */
function captionText(t) {
  const out = subtitleEnd(t.replace(FALSE_START, (all, lead, stub, next) => (String(next).toLowerCase().startsWith(String(stub).toLowerCase()) ? lead : all))
    .replace(HALF_PUNCT, (_all, mark) => FULL_PUNCT[mark] ?? mark)
    .replace(FILLER, '$1').replace(/\s+(?:\.{2,}|…+)\s*$/u, '').replace(/\s{2,}/g, ' ').replace(LEAD_PUNCT, '')).trim();
  return /[\p{L}\p{N}]/u.test(out) ? out : '';
}

/** The part of a line whose words start inside [fromMs, untilMs) (source ms). @param {SpokenLine} line @param {number} fromMs @param {number} untilMs */
function trimToWindow(line, fromMs, untilMs) {
  const marks = line.marks;
  if (!marks?.length || (line.startMs >= fromMs - SLACK_MS && line.endMs <= untilMs + SLACK_MS)) return line.text;
  const first = marks.findIndex((m) => m.startMs >= fromMs - SLACK_MS);
  if (first < 0) return '';
  let last = marks.length - 1;
  while (last >= first && marks[last].startMs >= untilMs - SLACK_MS) last -= 1;
  if (last < first) return '';
  const begin = first === 0 ? 0 : marks[first].index;
  const end = last === marks.length - 1 ? line.text.length : marks[last + 1].index;
  return line.text.slice(begin, end).replace(EDGE_PUNCT, '');
}

/** Translations of a source's lines, by the line's start (source ms): language → text. @typedef {Map<number, Record<string, string>>} AltLines */

/** A line as one subtitle piece (segmentLine's shape). @param {SpokenLine} line */
const wholeLine = (line) => ({
  text: line.text, startMs: line.startMs, endMs: line.endMs, ...(line.marks?.length ? { marks: [...line.marks] } : {}), part: 0, from: 0, to: line.text.length,
});

/**
 * One clip's subtitles. `span` is where it plays: source ms from `fromMs`, on the film from `startMs` for `durMs`, at
 * `speed` source ms per film ms. Each line is cut into subtitles first (segmentLine), its translations to follow
 * (alignTranslation); each cue says which piece of which line of which source it shows (`src`, `line`: the line's
 * start in the source, `part`: the piece, when the line has more than one), so the person's correction goes back into
 * that transcript.
 * @param {readonly SpokenLine[]} lines
 * @param {{ fromMs: number, startMs: number, durMs: number, speed: number }} span
 * `cut`: the transcript was cut by hand (transcripts.mjs CUT_NOTE): each line is one subtitle, as it is.
 * @param {{ alt?: AltLines, speaker?: string, clip?: string, src?: string, cut?: boolean }} [extra]
 * @returns {FilmSubtitleCue[]}
 */
function clipCues(lines, span, extra = {}) {
  const speed = span.speed > 0 ? span.speed : 1;
  const until = span.fromMs + span.durMs * speed;
  const film = (/** @type {number} */ sourceMs) => Math.round(span.startMs + (sourceMs - span.fromMs) / speed);
  /** @type {FilmSubtitleCue[]} */
  const out = [];
  for (const line of lines) {
    const pieces = extra.cut ? [wholeLine(line)] : segmentLine(line);
    const alts = Object.entries(extra.alt?.get(line.startMs) ?? {}).map(([language, text]) => /** @type {const} */ ([language, alignTranslation(text, pieces)]));
    for (const piece of pieces) {
      const from = Math.max(piece.startMs, span.fromMs);
      const to = Math.min(piece.endMs, until);
      /* a piece belongs to this clip when one of its words starts inside the trim (its text is cut to those words: a
         piece across a cut shows its own half on each side); without word places, when its middle is inside */
      const mine = piece.marks?.length
        ? piece.marks.some((m) => m.startMs >= span.fromMs - SLACK_MS && m.startMs < until - SLACK_MS)
        : (piece.startMs + piece.endMs) / 2 >= span.fromMs && (piece.startMs + piece.endMs) / 2 < until;
      const said = captionText(trimToWindow(piece, span.fromMs, until));
      /* what a trim leaves of a piece can be a scrap; a piece itself is as long as segmentLine made it */
      const cut = from > piece.startMs || to < piece.endMs;
      if (!mine || !said || to <= from || (cut && (to - from) / speed < MIN_CAPTION_MS)) continue;
      /* the words shown, each from its mark to the next (the last to the piece's end), on the film; the last one ends as
         the subtitle does (no trailing comma in Chinese) */
      const shown = (piece.marks ?? []).filter((m) => m.startMs >= from - SLACK_MS && m.startMs < to);
      const words = shown.map((m, i) => {
        const next = shown[i + 1];
        const startMs = Math.max(from, m.startMs);
        const endMs = next ? next.startMs : to;
        const text = piece.text.slice(m.index, next ? next.index : undefined).trim();
        return { text: next ? text : subtitleEnd(text), startMs: film(startMs), durMs: Math.max(1, Math.round((endMs - startMs) / speed)) };
      }).filter((w) => w.text);
      const alt = Object.fromEntries(alts.map(([language, parts]) => [language, subtitleEnd(parts[piece.part].text)]).filter(([, text]) => text));
      out.push({
        startMs: film(from),
        durMs: Math.round((to - from) / speed),
        text: said,
        ...(words.length > 1 ? { words } : {}),
        ...(extra.speaker ? { speaker: extra.speaker } : {}),
        ...(Object.keys(alt).length ? { alt } : {}),
        ...(extra.clip ? { clip: extra.clip } : {}),
        ...(extra.src ? { src: extra.src, line: line.startMs, ...(pieces.length > 1 ? { part: piece.part } : {}) } : {}),
      });
    }
  }
  return out;
}

const OUTLAST_MS = 1000;

/**
 * Whether a transcript runs on past the end of its file (`seconds`; unknown: it cannot tell, so no): then it was made
 * from another version of the file.
 * @param {readonly { endMs: number }[]} lines @param {number | undefined} seconds
 */
function transcriptOutlasts(lines, seconds) {
  if (!(typeof seconds === 'number' && seconds > 0)) return false;
  const end = lines.reduce((m, line) => Math.max(m, line.endMs), 0);
  return end > seconds * 1000 + OUTLAST_MS;
}


return {clipCues,transcriptOutlasts};
})();

// CLOSED_ADAPTER_START
export const NATIVE_SIDECARS_UPSTREAM = 'e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3' as const;
export interface NativeSidecarInputs {
  readonly upstream_sha: typeof NATIVE_SIDECARS_UPSTREAM;
  /** Complete requested UTF-8 source reads; null is independently proved absence.
   * Consumer paths also include film-referenced media, whose byte identity MAIN verifies. */
  readonly files: Readonly<Record<string, string | null>>;
  /** Exact native readdir order, independently closed by MAIN. */
  readonly directories: Readonly<Record<string, readonly string[]>>;
  /** Independent native probe facts, never guessed from trim or observed UI. */
  readonly media: Readonly<Record<string, { readonly duration: number | null; readonly audio: boolean }>>;
}
export interface NativeSidecarDependencies {
  readonly consumed_paths: readonly string[];
  readonly negative_lookups: readonly string[];
  readonly directory_lookups: readonly string[];
  readonly media_lookups: readonly string[];
}
export type NativeSidecarResult = NativeSidecarDependencies & (
  { readonly status: 'computed'; readonly style: { readonly state: 'present' | 'absent'; readonly value: unknown };
    readonly captions: { readonly state: 'present'; readonly value: { readonly cues: readonly unknown[]; readonly sourceLanguage: string | null; readonly languages: readonly string[]; readonly untranscribed: readonly string[] } } }
  | { readonly status: 'unsupported'; readonly reason: string; readonly missing: readonly string[] });

/** Pure data only. This does not verify provenance, hash files, mint proof, or authorize Ack.
 * MAIN must retain all dependencies including negative lookups and directory membership.
 * Literal pinned JS above is intentionally not re-normalized; malformed films/styles fail
 * conservatively instead of native UI's error-to-empty fallback. */
export async function computeNativeEffectiveSidecars(input: NativeSidecarInputs): Promise<NativeSidecarResult> {
  const consumed = new Set<string>(), negative = new Set<string>(), directories = new Set<string>(), mediaPaths = new Set<string>(), missing = new Set<string>();
  const dependencies = () => ({ consumed_paths: [...consumed].sort(), negative_lookups: [...negative].sort(), directory_lookups: [...directories].sort(), media_lookups: [...mediaPaths].sort() });
  const unsupported = (reason: string): NativeSidecarResult => ({status:'unsupported',reason,missing:[...missing].sort(),...dependencies()});
  const safe = (p: string) => typeof p === 'string' && p.length > 0 && p.length <= 4096 && !p.includes('\\') && !p.includes('\0') && !p.includes(':') && !p.startsWith('/') && p.split('/').every(s=>s!==''&&s!=='.'&&s!=='..');
  const own = (o: object, p: string) => Object.prototype.hasOwnProperty.call(o,p);
  try {
    // Snapshot caller-owned mutable inputs before any await; results never alias them.
    input = structuredClone(input);
    if(input.upstream_sha !== NATIVE_SIDECARS_UPSTREAM || !input.files || !input.directories || !input.media) return unsupported('INPUT_INVALID');
    if(Object.keys(input.files).length>4096 || Object.keys(input.directories).length>4096 || Object.keys(input.media).length>4096) return unsupported('INPUT_LIMIT');
    for(const [p,text] of Object.entries(input.files)) if(!safe(p)||!(text===null||typeof text==='string')||(typeof text==='string'&&text.length>8*1024*1024)) return unsupported('INPUT_INVALID');
    for(const [p,names] of Object.entries(input.directories)) if(!(p==='.'||safe(p))||!Array.isArray(names)||names.length>4096||new Set(names).size!==names.length||names.some(n=>!safe(n)||n.includes('/'))) return unsupported('INPUT_INVALID');
    for(const [p,fact] of Object.entries(input.media)) if(!safe(p)||!fact||typeof fact.audio!=='boolean'||!(fact.duration===null||(typeof fact.duration==='number'&&Number.isFinite(fact.duration)&&fact.duration>=0))) return unsupported('INPUT_INVALID');
    const readText = async (p: string) => {
      if(!safe(p)||!own(input.files,p)){missing.add(p);throw new Error('SOURCE_INPUT_MISSING');}
      const value=input.files[p];if(value===null)negative.add(p);else consumed.add(p);return value;
    };
    const filmText=await readText('film.html');
    if(filmText===null)return unsupported('FILM_ABSENT');
    const parsed=NativeFilm.readFilmFile(filmText);
    if(!parsed.doc||parsed.problems.length)return unsupported('FILM_INVALID');
    // Refuse external/ambiguous native paths rather than silently omitting their captions.
    for(const track of parsed.doc.tracks)for(const clip of track.clips){if(!safe(clip.src))return unsupported('SOURCE_PATH_UNSUPPORTED');consumed.add(clip.src);}
    const styleText=await readText('.film/subtitles.json');
    let style;
    if(styleText===null)style={state:'absent',value:structuredClone(NativeStyle.FILM_SUBTITLE_DEFAULT)};
    else {
      let raw;try{raw=JSON.parse(styleText);}catch{return unsupported('STYLE_JSON_INVALID');}
      if(!raw||typeof raw!=='object'||Array.isArray(raw))return unsupported('STYLE_OBJECT_INVALID');
      // Server readSubtitleStyle then UI fetchSubtitleStyle parse the persisted value.
      style={state:'present',value:NativeStyle.parseFilmSubtitleStyle(NativeStyle.parseFilmSubtitleStyle(raw))};
    }
    const {clipKind,clipSpan,kindOf,soundRole}=NativeFilm;
    const {filmSubtitleLanguageOf,filmSubtitleLanguagesIn}=NativeStyle;
    const {clipCues,transcriptOutlasts}=NativeCues;
    const {transcriptPath,parseVtt,wordCues,linesOfWords}=NativeTranscript;
    const {basename,dirname,extname}=posix;
    const inProject=(_root:string,p:string)=>safe(p)?p:null;
    const readProjectFilm=async()=>parsed;
    const readdir=async(p:string)=>{directories.add(p);if(!own(input.directories,p)){missing.add('directory:'+p);throw new Error('DIRECTORY_INPUT_MISSING');}return [...input.directories[p]];};
    const probe=async(_root:string,p:string)=>{
      mediaPaths.add(p);consumed.add(p);
      if(!own(input.media,p)){missing.add('media:'+p);throw new Error('MEDIA_INPUT_MISSING');}
      const fact=input.media[p];return {duration:fact.duration??undefined,audio:fact.audio};
    };
    function heardClips(root, doc) {
  return doc.tracks.flatMap((track) => (track.muted || track.hidden ? [] : track.clips.filter((clip) => {
    const kind = kindOf(clip);
    return (kind === 'sound' || kind === 'video') && !(clip.volume !== undefined && clip.volume <= 0) && inProject(root, clip.src) !== null;
  })));
}

/**
 * Whether a clip with no transcript is speech that wants one: a voice (not music or an effect, by its folder or
 * name), or a video with sound.
 * @param {string} root @param {string} src
 */
async function wantsTranscript(root, src) {
  if (clipKind(src) === 'sound') return soundRole(src) === 'voice';
  return (await probe(root, src).catch(() => null))?.audio === true;
}

async function filmCaptions(root, options = {}) {
  const film = await readProjectFilm(root);
  const empty = { cues: /** @type {FilmSubtitleCue[]} */ ([]), sourceLanguage: null, languages: /** @type {string[]} */ ([]), untranscribed: /** @type {string[]} */ ([]) };
  const doc = /** @type {import('../../src/film-doc.d.mts').FilmDoc | null} */ (film.doc);
  if (!doc) return empty;
  const duration = options.duration ?? ((/** @type {string} */ src) => probe(root, src).then((p) => p.duration, () => undefined));
  /** @type {Map<string, { lines: SpokenLine[], speaker?: string, alt: AltLines, cut?: boolean } | null>} */
  const known = new Map();
  const transcriptOf = async (/** @type {string} */ src) => {
    if (known.has(src)) return known.get(src) ?? null;
    const read = await readTranscript(root, src);
    /** @type {AltLines} */
    const alt = new Map();
    if (read) {
      for (const language of await translationsOf(root, src)) {
        for (const line of (await readTranscript(root, src, language))?.lines ?? []) alt.set(line.startMs, { ...alt.get(line.startMs), [language]: line.text });
      }
    }
    const one = read ? { lines: read.lines, ...(read.speaker ? { speaker: read.speaker } : {}), alt, ...(read.cut ? { cut: true } : {}) } : null;
    known.set(src, one);
    return one;
  };
  /** @type {Map<string, Promise<number | undefined>>} */
  const lengths = new Map();
  const lengthOf = (/** @type {string} */ src) => {
    if (!lengths.has(src)) lengths.set(src, duration(src));
    return /** @type {Promise<number | undefined>} */ (lengths.get(src));
  };
  /** @type {FilmSubtitleCue[]} */
  const cues = [];
  const untranscribed = new Set();
  for (const clip of heardClips(root, doc)) {
    const said = await transcriptOf(clip.src);
    if (!said) { if (await wantsTranscript(root, clip.src)) untranscribed.add(clip.src); continue; }
    /* a transcript that runs on past the end of its file is not this file's any more (it was made again faster, or
       the transcript's times were moved): its lines would drift later and later and the last ones fall off. It is
       still shown, and made again with the rest (the CC button) */
    if (await transcriptOutlasts(said.lines, await lengthOf(clip.src))) untranscribed.add(clip.src);
    const native = clip.time?.length === 2 ? undefined : await lengthOf(clip.src) ?? (said.lines.at(-1)?.endMs ?? 0) / 1000;
    let span;
    try { span = clipSpan(clip, native ?? NaN); } catch { continue; }
    cues.push(...clipCues(said.lines, {
      fromMs: span.from * 1000, startMs: (clip.at ?? 0) * 1000, durMs: span.length * 1000, speed: span.speed,
    }, { alt: said.alt, ...(said.speaker ? { speaker: said.speaker } : {}), clip: clip.id, src: clip.src, ...(said.cut ? { cut: true } : {}) }));
  }
  cues.sort((a, b) => a.startMs - b.startMs);
  /* a speaker's name tells voices apart; with one voice in the film it tells nothing, and would open every line */
  if (new Set(cues.map((c) => c.speaker).filter(Boolean)).size <= 1) for (const c of cues) delete c.speaker;
  return {
    cues,
    sourceLanguage: filmSubtitleLanguageOf(cues.map((c) => c.text).join(' ')),
    languages: filmSubtitleLanguagesIn(cues),
    untranscribed: [...untranscribed],
  };
}

async function readTranscript(root, src, language) {
  const file = inProject(root, transcriptPath(src, language));
  const body = file ? await readText(file) : null;
  if (body == null) return null;
  const read = parseVtt(body);
  if (!read.lines.length) return null;
  /* cut by hand: one word a cue is what the person made */
  return !read.cut && wordCues(read.lines) ? { ...read, lines: linesOfWords(read.lines) } : read;
}

async function translationsOf(root, src) {
  const name = basename(src, extname(src));
  const file = inProject(root, src);
  if (!file) return [];
  const names = await readdir(dirname(file)).catch(() => /** @type {string[]} */ ([]));
  /** @type {string[]} */
  const out = [];
  for (const file of names) {
    const m = file.startsWith(`${name}.`) && /^\.([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)\.vtt$/.exec(file.slice(name.length));
    if (m) out.push(m[1]);
  }
  return out;
}


    const value=await filmCaptions('closed');
    if(missing.size)return unsupported('DEPENDENCY_INPUT_MISSING');
    // Explicit absence and listing must agree; new translation sidecars invalidate this closure.
    for(const p of [...consumed,...negative]){
      const dir=posix.dirname(p),name=posix.basename(p);
      if(directories.has(dir)&&input.directories[dir].includes(name)===negative.has(p))return unsupported('DIRECTORY_FILE_CONFLICT');
    }
    return {status:'computed',style,captions:{state:'present',value},...dependencies()};
  } catch(error) {
    return unsupported(missing.size?'DEPENDENCY_INPUT_MISSING':'NATIVE_CONSUMER_FAILED');
  }
}
