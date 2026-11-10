const SPEED_MIN = 0.25;
const SPEED_MAX = 4;
const TRIM_EPS = 1e-6;
const STILL_EXTENSIONS = /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "webp", "avif", "gif", "bmp", "svg"]);
function isStill(src) {
  const dot = src.lastIndexOf(".");
  return dot > 0 && STILL_EXTENSIONS.has(src.slice(dot + 1).toLowerCase());
}
function soundRole(src) {
  const path = String(src).toLowerCase();
  const folders = path.split("/").slice(0, -1).reverse();
  for (const folder of folders) {
    if (/^(sfx|fx|effects?|sound-?effects?)$/.test(folder)) return "sfx";
    if (/^(music|bgm)$/.test(folder)) return "music";
    if (/^(vo|voices?|voice-?over|narration)$/.test(folder)) return "voice";
  }
  const name = path.split("/").pop() ?? "";
  if (/(^|[^a-z])(bed|music|song|soundtrack|score|theme|loop|ambient|ambience|beat)([^a-z]|$)/.test(name)) return "music";
  if (/(^|[^a-z])(sfx|fx|hit|whoosh|swoosh|riser|impact|ding|chime)([^a-z]|$)/.test(name)) return "sfx";
  return "voice";
}
function isPage(src) {
  return /\.html?$/i.test(src);
}
const SOUND_EXTENSIONS = /* @__PURE__ */ new Set(["mp3", "m4a", "wav", "aac", "ogg", "oga", "opus", "flac", "aif", "aiff", "weba"]);
const VIDEO_EXTENSIONS = /* @__PURE__ */ new Set(["mp4", "m4v", "mov", "webm", "mkv", "avi", "ogv"]);
function clipKind(src) {
  if (typeof src !== "string") return null;
  if (isPage(src)) return "page";
  if (isStill(src)) return "still";
  const ext = src.slice(src.lastIndexOf(".") + 1).toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (SOUND_EXTENSIONS.has(ext)) return "sound";
  return null;
}
function kindOf(clip) {
  const kind = clipKind(clip?.src);
  return clip?.sound === true && kind === "video" ? "sound" : kind;
}
const isFinite = (v) => typeof v === "number" && Number.isFinite(v);
function clipSpeed(clip) {
  const kind = kindOf(clip);
  if (kind === "page" || kind === "still") return 1;
  const v = clip.speed;
  return isFinite(v) && v >= SPEED_MIN && v <= SPEED_MAX ? v : 1;
}
function clipSpan(clip, native, where = "clip") {
  const kind = kindOf(clip);
  const time = clip.time ?? [];
  const from = time[0] ?? 0;
  const still = kind === "still";
  if (still) {
    if (!(time.length === 2 && time[1] > 0)) {
      throw new Error(`${where}: a still has no length of its own — say how long it stays with a media fragment, e.g. src="photo.png#t=0,4".
  On a video or a sound #t= is a trim into the file; on a picture there is nothing to trim, so those two numbers are the length.`);
    }
    return { from, to: time[1], speed: 1, length: time[1] - from };
  }
  if (!(isFinite(native) && native > 0) && time.length !== 2) {
    if (kind === "page") {
      throw new Error(`${where}: this page has no duration, so it has no end of its own — say how long it plays with a media fragment, e.g. src="title.html#t=0,4".
  A page with a duration plays all of it without #t=; a page without one is like a still.`);
    }
    throw new Error(`${where}: no length to trim against.`);
  }
  const to = time[1] ?? native;
  if (from < -TRIM_EPS) throw new Error(`${where}: #t=${from},… starts below 0 (#t= is a part of the file, within [0, its length]).`);
  if (to + TRIM_EPS < from) throw new Error(`${where}: #t=${from},${to} has to end after it starts.`);
  if (kind !== "page" && isFinite(native) && native > 0) {
    if (to > native + TRIM_EPS) throw new Error(`${where}: #t=${from},${to} ends past the file's length of ${native} s (#t= is a part of the file, within [0, its length]).`);
    if (from > native + TRIM_EPS) throw new Error(`${where}: #t=${from},${to} starts past the file's length of ${native} s (#t= is a part of the file, within [0, its length]).`);
  }
  const speed = clipSpeed(clip);
  return { from, to, speed, length: (to - from) / speed };
}
const FILM_DOC_FILE = "film.html";
const filmSrcIsStill = isStill;
const filmSrcKind = clipKind;
function filmClipKind(of) {
  const kind = typeof of === "string" ? clipKind(of) : kindOf(of);
  return kind === "page" ? "mg" : kind === "sound" ? "audio" : "video";
}
function filmTrackKind(track) {
  const kinds = new Set(track.clips.map((clip) => filmClipKind(clip)));
  if (kinds.size === 1) return [...kinds][0];
  return "video";
}
function fileStem(path) {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[a-z0-9]{1,5}$/i, "") || base;
}
function filmTrackPrefix(kind) {
  return kind === "mg" ? "P" : kind === "video" ? "V" : "A";
}
function filmTrackBadges(tracks) {
  const prefixes = tracks.map((track) => filmTrackPrefix("kind" in track ? track.kind : filmTrackKind(track)));
  const total = /* @__PURE__ */ new Map();
  for (const p of prefixes) total.set(p, (total.get(p) ?? 0) + 1);
  const seen = /* @__PURE__ */ new Map();
  return prefixes.map((prefix) => {
    const nth = (seen.get(prefix) ?? 0) + 1;
    seen.set(prefix, nth);
    return `${prefix}${prefix === "A" ? nth : total.get(prefix) - nth + 1}`;
  });
}
function filmAudioRoleOf(src) {
  return soundRole(src);
}
function filmDocLoc(track, clip) {
  return `${FILM_DOC_FILE}#${track}.${clip}`;
}
const ms = (sec) => Math.round(sec * 1e3);
function trimOf(clip) {
  const time = Array.isArray(clip.time) ? clip.time : [];
  const speed = typeof clip.speed === "number" && clip.speed > 0 ? clip.speed : 1;
  return { from: time[0] ?? 0, speed };
}
const GUESS_SEC = 5;
function guessedSpan(clip, native) {
  const at = typeof clip.at === "number" && clip.at >= 0 ? clip.at : 0;
  const time = Array.isArray(clip.time) ? clip.time : [];
  const speed = typeof clip.speed === "number" && clip.speed > 0 ? clip.speed : 1;
  const from = time[0] ?? 0;
  const length = time.length === 2 && time[1] > from ? (time[1] - from) / speed : time.length < 2 && native != null && native > from ? (native - from) / speed : GUESS_SEC;
  return { id: String(clip.id ?? ""), src: clip.src, at, end: at + length, native: native ?? null };
}
function filmShape(doc, spans, media = /* @__PURE__ */ new Map(), guess = false) {
  const byId = new Map(spans.map((s) => [s.id, s]));
  const scenes = [];
  const videos = [];
  const sounds = [];
  doc.tracks.forEach((track, ti) => {
    const ref = {
      index: ti,
      name: filmTrackKind(track),
      kind: filmTrackKind(track),
      ...track.hidden ? { hidden: true } : {},
      ...track.muted ? { muted: true } : {},
      ...track.locked ? { locked: true } : {}
    };
    track.clips.forEach((clip, ci) => {
      const known = clip.id ? byId.get(clip.id) : void 0;
      const probed = filmSrcIsStill(clip.src) ? void 0 : media.get(clip.src)?.duration;
      const placed = clip.at == null || typeof clip.at === "number";
      const plain = placed && (Array.isArray(clip.time) && clip.time.length === 2 && clip.time[1] > clip.time[0] || !(Array.isArray(clip.time) && clip.time.length === 2) && probed != null && probed > 0);
      const noLength = guess && !(Array.isArray(clip.time) && clip.time.length === 2) && (filmSrcIsStill(clip.src) || filmClipKind(clip.src) === "mg" && known != null && known.native == null);
      const span = known && known.end > known.at && !noLength ? known : guess || plain ? guessedSpan(clip, probed) : void 0;
      if (!span || !(span.end > span.at)) return;
      const raw = clip;
      const loc = filmDocLoc(ti, ci);
      const kind = filmClipKind(clip);
      const startMs = ms(span.at);
      const durMs = ms(span.end - span.at);
      const { from, speed } = trimOf(raw);
      const inMs = from ? ms(from) : void 0;
      const still = filmSrcIsStill(clip.src);
      const anchor = { move: "at", resize: "end", trimFrom: from, ...still ? { still } : {}, parentStartMs: 0 };
      const volume = typeof raw.volume === "number" ? raw.volume : void 0;
      const silent = volume != null && volume <= 0;
      const box = raw.box;
      const size = span.w && span.h ? { w: span.w, h: span.h } : void 0;
      const sourceDurMs = span.native != null && Number.isFinite(span.native) ? Math.floor(span.native * 1e3 + 1e-6) : void 0;
      const shared = {
        key: `${fileStem(clip.src)}#${ti}.${ci}`,
        ...noLength ? { meta: { noLength: true } } : {},
        startMs,
        durMs,
        loc,
        track: ref,
        clipId: clip.id,
        ...volume != null ? { volume } : {},
        ...silent ? { silent: true } : {}
      };
      if (kind === "audio") {
        sounds.push({
          ...shared,
          kind: filmAudioRoleOf(clip.src),
          src: clip.src,
          anchor,
          ...sourceDurMs != null ? { sourceDurMs } : {},
          ...inMs ? { inMs } : {},
          ...speed !== 1 ? { speed } : {}
        });
        return;
      }
      const label = clip.id || fileStem(clip.src);
      scenes.push({
        ...shared,
        label,
        z: -ti,
        anchor,
        ...kind === "mg" ? { src: clip.src } : {},
        ...box ? { box } : {},
        ...size ? { size } : {},
        ...sourceDurMs != null && kind === "mg" ? { sourceDurMs } : {},
        ...inMs ? { inMs } : {}
      });
      if (kind === "video") {
        videos.push({
          ...shared,
          src: clip.src,
          ...inMs ? { inMs } : {},
          ...speed !== 1 ? { speed } : {},
          ...!still && sourceDurMs != null ? { sourceDurMs } : {},
          label,
          ...box ? { box } : {},
          z: -ti
        });
        if (!still && media.get(clip.src)?.audio) {
          sounds.push({ ...shared, kind: "voice", src: clip.src, ...inMs ? { inMs } : {}, ...speed !== 1 ? { speed } : {} });
        }
      }
    });
  });
  return { scenes, videos, sounds, captions: [], doc: { ...doc, tracks: doc.tracks.map((t) => ({ ...t, kind: filmTrackKind(t) })) } };
}
const DISPLAY_FPS = 30;
const FRAME_RATES$1 = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
function namedRate(fps) {
  const named = FRAME_RATES$1.find((r) => Math.abs(r - fps) < 0.01);
  return named ?? Math.round(fps * 1e3) / 1e3;
}
function footageFps(rates) {
  for (const r of rates) {
    if (r == null || !(r > 0)) continue;
    const named = namedRate(r);
    if (FRAME_RATES$1.includes(named)) return named;
  }
  return DISPLAY_FPS;
}
function trimFence(block, others) {
  let startMs;
  let endMs;
  for (const r of others) {
    if (r.startMs < block.startMs) {
      const edge = Math.min(r.endMs, block.startMs);
      startMs = startMs == null ? edge : Math.max(startMs, edge);
    } else {
      const edge = Math.max(r.startMs, block.endMs);
      endMs = endMs == null ? edge : Math.min(endMs, edge);
    }
  }
  return { ...startMs != null ? { startMs } : {}, ...endMs != null ? { endMs } : {} };
}
function metaFields(meta) {
  if (!meta) return {};
  return {
    ...meta.cues?.length ? { cues: meta.cues } : {},
    ...meta.atRef ? { atRef: meta.atRef } : {},
    ...meta.durRef ? { durRef: meta.durRef } : {},
    ...meta.noLength ? { noLength: true } : {}
  };
}
const TOUCH_MS = 1;
function layered(blocks) {
  const rows = [];
  for (const block of [...blocks].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)) {
    const row = rows.find((r) => (r.at(-1)?.endMs ?? 0) <= block.startMs + TOUCH_MS);
    if (row) row.push(block);
    else rows.push([block]);
  }
  return rows;
}
function withDocTimes(film) {
  const clips = /* @__PURE__ */ new Map();
  for (const track of docTracksOf(film.doc)) {
    for (const c of Array.isArray(track.clips) ? track.clips : []) {
      const clip = c;
      if (typeof clip?.id === "string" && typeof clip.src === "string" && !clips.has(clip.id)) {
        clips.set(clip.id, clip);
      }
    }
  }
  if (!clips.size) return film;
  const fix = (entry) => {
    const clip = entry.clipId ? clips.get(entry.clipId) : void 0;
    if (!clip) return entry;
    const at = clip.at == null ? 0 : typeof clip.at === "number" ? clip.at : null;
    let length = null;
    try {
      length = clipSpan(clip, entry.sourceDurMs != null ? entry.sourceDurMs / 1e3 : void 0).length;
    } catch {
    }
    const startMs = at != null && Math.abs(at * 1e3 - entry.startMs) >= 1 ? Math.round(at * 1e3) : entry.startMs;
    const durMs = length != null && Number.isFinite(length) && length > 0 && Math.abs(length * 1e3 - entry.durMs) >= 1 ? at != null ? Math.round((at + length) * 1e3) - startMs : Math.round(length * 1e3) : entry.durMs;
    if (startMs === entry.startMs && durMs === entry.durMs) return entry;
    return { ...entry, startMs, durMs };
  };
  return {
    ...film,
    scenes: film.scenes.map(fix),
    videos: film.videos.map(fix),
    sounds: film.sounds.map(fix)
  };
}
function docTracksOf(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return [];
  const tracks = doc.tracks;
  if (!Array.isArray(tracks)) return [];
  return tracks.filter((row) => !!row && typeof row === "object");
}
function docTrackKind(track) {
  if (typeof track.kind === "string") return track.kind;
  const clips = Array.isArray(track.clips) ? track.clips : [];
  return filmTrackKind({
    clips: clips.filter((c) => !!c && typeof c.src === "string")
  });
}
function badgeRows(rows) {
  const badges = filmTrackBadges(rows.map((row) => ({ kind: row.role })));
  return rows.map((row, i) => ({ ...row, badge: badges[i] }));
}
function trimRoom(durMs, sourceDurMs, inMs, speed = 1) {
  if (sourceDurMs == null) return {};
  const inPoint = Math.max(0, inMs ?? 0);
  const k = speed > 0 ? speed : 1;
  const spare = Math.max(0, sourceDurMs - inPoint - durMs * k);
  return {
    room: {
      headMs: inPoint / k,
      tailMs: spare / k
    },
    sourceDurMs
  };
}
function speedOf(speed) {
  return speed != null && speed > 0 && speed !== 1 ? { speed } : {};
}
function soundBlockOf(s) {
  return {
    id: s.key,
    title: nameOf(s.src) || s.clipId || "",
    startMs: s.startMs,
    endMs: s.startMs + s.durMs,
    kind: s.kind,
    src: s.src,
    ...s.cast ? { cast: s.cast } : {},
    ...s.loc ? { loc: s.loc } : {},
    ...s.anchor ? { anchor: s.anchor } : {},
    ...s.inMs ? { inMs: s.inMs } : {},
    ...s.clipId ? { clipId: s.clipId } : {},
    ...s.off ? { off: true } : {},
    ...speedOf(s.speed ?? s.rate),
    ...audioExtras(s),
    ...trimRoom(s.durMs, s.sourceDurMs, s.inMs, s.speed ?? s.rate),
    ...metaFields(s.meta)
  };
}
function audioExtras(s) {
  return {
    ...s.gainDb != null ? { gainDb: s.gainDb } : {},
    ...s.volume != null ? { volume: s.volume } : {},
    ...s.duck != null ? { duck: s.duck } : {},
    ...s.silent ? { silent: true } : {}
  };
}
function visualExtras(v) {
  return {
    ...v.clipId ? { clipId: v.clipId } : {},
    ...v.src ? { src: v.src } : {},
    ...v.box ? { box: v.box } : {},
    ...v.size ? { size: v.size } : {},
    ...v.z != null ? { z: v.z } : {}
  };
}
function videoBlockOf(v, anchor, ownAudio) {
  return {
    id: v.key,
    title: nameOf(v.src) || v.clipId || "",
    startMs: v.startMs,
    endMs: v.startMs + v.durMs,
    kind: "video",
    src: v.src,
    inMs: v.inMs,
    ...v.loc ? { loc: v.loc } : {},
    ...anchor ? { anchor } : {},
    ...ownAudio ? { ownAudio: true } : {},
    ...speedOf(v.speed),
    ...trimRoom(v.durMs, v.sourceDurMs, v.inMs, v.speed),
    ...audioExtras(v),
    ...visualExtras(v),
    ...metaFields(v.meta)
  };
}
function layoutTracks(evaluated) {
  const film = withDocTimes(evaluated);
  const tracks = [];
  const byIndex = /* @__PURE__ */ new Map();
  const take = (t) => {
    let row = byIndex.get(t.index);
    if (!row) {
      row = { name: t.name, kind: t.kind, blocks: [] };
      byIndex.set(t.index, row);
    }
    if (t.hidden) row.hidden = true;
    if (t.muted) row.muted = true;
    if (t.locked) row.locked = true;
    return row;
  };
  const claimed = /* @__PURE__ */ new Map();
  const claim = (index, clipId) => {
    if (!clipId) return;
    const list = claimed.get(index) ?? [];
    list.push(clipId);
    claimed.set(index, list);
  };
  const sceneAnchor = /* @__PURE__ */ new Map();
  const sceneSize = /* @__PURE__ */ new Map();
  for (const s of film.scenes) {
    if (s.loc && s.anchor) sceneAnchor.set(s.loc, s.anchor);
    if (s.loc && s.size) sceneSize.set(s.loc, s.size);
  }
  const mainVideos = film.videos.filter((video) => !film.scenes.some((scene) => {
    if (!scene.src || scene.src === video.src) return false;
    if (scene.clipId && video.clipId) return scene.clipId === video.clipId;
    return Boolean(scene.loc && scene.loc === video.loc);
  }));
  const videoLocs = /* @__PURE__ */ new Set();
  for (const v of mainVideos) {
    if (v.track && v.loc) videoLocs.add(v.loc);
  }
  for (const s of film.scenes) {
    if (!s.track || s.durMs <= 0 || s.loc != null && videoLocs.has(s.loc)) continue;
    claim(s.track.index, s.clipId);
    take(s.track).blocks.push({
      id: s.key,
      /* a clip is called by its file, as in any editor (its id is film.html's, shown in the inspector); a page's
         file name drops the extension: `.html` says what it is written in, not what the clip is */
      title: fileStem(s.src ?? "") || s.clipId || fileStem(s.label),
      startMs: s.startMs,
      endMs: s.startMs + s.durMs,
      kind: "mg",
      ...s.loc ? { loc: s.loc } : {},
      ...s.anchor ? { anchor: s.anchor } : {},
      /* an MG's right edge is unlimited (past its end it holds the last frame); its left edge stops at its start,
         with or without a duration of its own (without the limit a left edge past 0 only slid the page along) */
      room: { headMs: Math.max(0, s.inMs ?? 0) },
      ...visualExtras(s),
      ...metaFields(s.meta)
    });
  }
  const videoSpans = /* @__PURE__ */ new Map();
  for (const v of mainVideos) {
    if (!v.track || v.durMs <= 0) continue;
    const list = videoSpans.get(v.src) ?? [];
    list.push({ startMs: v.startMs, durMs: v.durMs });
    videoSpans.set(v.src, list);
  }
  const ownAudioOf = (s) => {
    if (s.loc && videoLocs.has(s.loc)) return true;
    if (s.loc) return false;
    return (videoSpans.get(s.src) ?? []).some(
      (span) => Math.abs(span.startMs - s.startMs) <= 2 && Math.abs(span.durMs - s.durMs) <= 2
    );
  };
  const videoHasOwnAudio = /* @__PURE__ */ new Set();
  for (const s of film.sounds) {
    if (ownAudioOf(s)) videoHasOwnAudio.add(`${s.src}@${Math.round(s.startMs)}`);
  }
  for (const v of mainVideos) {
    if (!v.track || v.durMs <= 0) continue;
    claim(v.track.index, v.clipId);
    const size = v.loc ? sceneSize.get(v.loc) : void 0;
    take(v.track).blocks.push(videoBlockOf(
      size ? { ...v, size } : v,
      v.loc ? sceneAnchor.get(v.loc) : void 0,
      videoHasOwnAudio.has(`${v.src}@${Math.round(v.startMs)}`)
    ));
  }
  for (const s of film.sounds) {
    if (!s.track || !Number.isFinite(s.durMs) || s.durMs <= 0) continue;
    if (ownAudioOf(s)) continue;
    claim(s.track.index, s.clipId);
    take(s.track).blocks.push(soundBlockOf(s));
  }
  const docIndexOfClip = /* @__PURE__ */ new Map();
  docTracksOf(film.doc).forEach((t, i) => {
    const clips = Array.isArray(t.clips) ? t.clips : [];
    for (const c of clips) {
      const id = c && typeof c === "object" ? c.id : null;
      if (typeof id === "string" && id && !docIndexOfClip.has(id)) docIndexOfClip.set(id, i);
    }
  });
  if (docIndexOfClip.size) {
    const moved = [...byIndex.entries()].map(([index, row]) => {
      const real = (claimed.get(index) ?? []).map((id) => docIndexOfClip.get(id)).find((i) => i != null);
      return [real ?? index, row];
    });
    byIndex.clear();
    for (const [index, row] of moved) {
      const there = byIndex.get(index);
      if (!there) {
        byIndex.set(index, row);
        continue;
      }
      there.blocks.push(...row.blocks);
      if (row.hidden) there.hidden = true;
      if (row.muted) there.muted = true;
      if (row.locked) there.locked = true;
    }
  }
  for (const [index, t] of docTracksOf(film.doc).entries()) {
    if (byIndex.has(index)) continue;
    const kind = docTrackKind(t);
    byIndex.set(index, {
      name: kind,
      kind,
      blocks: [],
      ...t.hidden ? { hidden: true } : {},
      ...t.muted ? { muted: true } : {},
      ...t.locked ? { locked: true } : {}
    });
  }
  const add = (lane, role, kind, blocks, name, docIndex, flags) => {
    const hidden = Boolean(flags?.hidden);
    const muted = Boolean(flags?.muted);
    const locked = Boolean(flags?.locked);
    const painted = (hidden ? blocks.map((b) => ({ ...b, off: true })) : blocks).map((b) => {
      const nextMs = trimFence(b, blocks.filter((o) => o.id !== b.id)).endMs;
      return nextMs != null ? { ...b, nextMs } : b;
    });
    const layers = layered(painted);
    if (!layers.length) layers.push([]);
    for (const [i, row] of layers.entries()) {
      tracks.push({
        lane: i ? `${lane}#${i + 1}` : lane,
        role,
        index: i + 1,
        name: name == null || name === "" ? null : i ? `${name} ${i + 1}` : name,
        kind,
        ...docIndex != null ? { docIndex } : {},
        muted,
        hidden,
        locked,
        ...flags?.incomplete ? { incomplete: true } : {},
        blocks: row
      });
    }
  };
  const rows = [...byIndex.entries()].sort((a, b) => a[0] - b[0]);
  if (rows.every(([, row]) => row.blocks.length === 0)) return [];
  const docTracks = docTracksOf(film.doc);
  for (const [index, row] of rows) {
    const drawn = new Set(row.blocks.map((b) => b.clipId));
    const docClips = docTracks[index]?.clips;
    const incomplete = Array.isArray(docClips) && docClips.some((c) => {
      const id = c?.id;
      return typeof id === "string" && !drawn.has(id);
    });
    const role = row.kind === "mg" || row.kind === "video" ? row.kind : "audio";
    add(
      `doc-${index}`,
      role,
      role === "audio" ? "audio" : "visual",
      row.blocks,
      row.name || row.kind,
      index,
      {
        hidden: row.hidden,
        muted: row.muted,
        locked: row.locked,
        incomplete
      }
    );
  }
  const badged = badgeRows(tracks);
  const pictures = badged.filter((r) => r.role !== "audio" && r.docIndex != null).map((r) => r.docIndex);
  const main = pictures.length ? Math.max(...pictures) : null;
  return main == null ? badged : badged.map((r) => r.docIndex === main ? { ...r, main: true } : r);
}
function nameOf(path) {
  return path.split("/").pop() ?? path;
}
function placeSaved(saved, tracks) {
  const out = /* @__PURE__ */ new Map();
  const taken = /* @__PURE__ */ new Set();
  const late = [];
  for (const entry of saved) {
    const had = new Set(entry.clips);
    let best = -1;
    let most = 0;
    tracks.forEach((tr, i) => {
      const n = tr.clips.filter((c) => had.has(c.id)).length;
      if (n > most && !taken.has(i)) {
        most = n;
        best = i;
      }
    });
    if (best >= 0) {
      out.set(entry, best);
      taken.add(best);
    } else late.push(entry);
  }
  for (const entry of late) {
    if (entry.index < tracks.length && !taken.has(entry.index)) {
      out.set(entry, entry.index);
      taken.add(entry.index);
    }
  }
  return out;
}
function trackNamesOf(saved, tracks) {
  return new Map([...placeSaved(saved, tracks)].map(([entry, i]) => [i, entry.name]));
}
const TRACK_MIN_H$1 = 28;
const TRACK_MAX_H$1 = 160;
const TRACK_SIZES = {
  medium: { visual: 56, audio: 44 }
};
const MAIN_TRACK_H = 68;
function ownTrackHeight(track) {
  return track.main ? MAIN_TRACK_H : TRACK_SIZES.medium[track.kind];
}
function clampTrackHeight(h) {
  return Math.round(Math.max(TRACK_MIN_H$1, Math.min(TRACK_MAX_H$1, h)));
}
function trackHeightsOf(saved, tracks) {
  return new Map([...placeSaved(saved, tracks)].map(([entry, i]) => [i, clampTrackHeight(entry.height)]));
}
const MARKER_COLORS = ["blue", "green", "yellow", "orange", "red", "purple"];
const MARKERS_MAX = 1e3;
const MARKER_NAME_MAX = 80;
const isRecord$1 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function parseMarkers(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const ids = /* @__PURE__ */ new Set();
  for (const m of raw) {
    if (!isRecord$1(m) || typeof m.id !== "string" || !m.id || ids.has(m.id)) continue;
    if (typeof m.t !== "number" || !Number.isFinite(m.t) || m.t < 0) continue;
    ids.add(m.id);
    const name = typeof m.name === "string" ? m.name.trim().slice(0, MARKER_NAME_MAX) : "";
    out.push({
      id: m.id,
      t: Math.round(m.t * 1e3) / 1e3,
      ...typeof m.clip === "string" && m.clip ? { clip: m.clip } : {},
      ...name ? { name } : {},
      color: MARKER_COLORS.includes(String(m.color)) ? m.color : "blue"
    });
    if (out.length >= MARKERS_MAX) break;
  }
  return out;
}
function clipMarkerMs(m, clip) {
  const ms2 = clip.startMs + (m.t * 1e3 - (clip.inMs ?? 0)) / (clip.speed ?? 1);
  return ms2 >= clip.startMs - 0.5 && ms2 <= clip.endMs + 0.5 ? ms2 : null;
}
function placeMarkers(list, tracks) {
  const clips = /* @__PURE__ */ new Map();
  for (const tr of tracks) for (const b of tr.blocks) if (b.clipId && b.loc) clips.set(b.clipId, b);
  const out = [];
  for (const marker of list) {
    if (!marker.clip) {
      out.push({ marker, ms: marker.t * 1e3 });
      continue;
    }
    const clip = clips.get(marker.clip);
    const ms2 = clip ? clipMarkerMs(marker, clip) : null;
    if (clip && ms2 != null) out.push({ marker, ms: ms2, clip });
  }
  return out.sort((a, b) => a.ms - b.ms);
}
const FRAME_RATES = (
  /** @type {const} */
  [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120]
);
const TRACK_MIN_H = 28;
const TRACK_MAX_H = 160;
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function frameRateOf(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return FRAME_RATES.find((r) => Math.abs(r - v) < 0.01) ?? null;
}
function trackNameOf(v) {
  if (!isRecord(v) || typeof v.name !== "string" || !v.name.trim()) return null;
  if (!(Number.isInteger(v.index) && Number(v.index) >= 0)) return null;
  const clips = Array.isArray(v.clips) ? v.clips.filter((c) => typeof c === "string" && c).slice(0, 500) : [];
  return { name: v.name.trim().slice(0, 40), index: Number(v.index), clips: (
    /** @type {string[]} */
    clips
  ) };
}
function trackHeightOf(v) {
  if (!isRecord(v) || typeof v.height !== "number" || !Number.isFinite(v.height)) return null;
  if (!(Number.isInteger(v.index) && Number(v.index) >= 0)) return null;
  const clips = Array.isArray(v.clips) ? v.clips.filter((c) => typeof c === "string" && c).slice(0, 500) : [];
  const height = Math.round(Math.max(TRACK_MIN_H, Math.min(TRACK_MAX_H, v.height)));
  return { height, index: Number(v.index), clips: (
    /** @type {string[]} */
    clips
  ) };
}
function parseProjectSettings(raw) {
  if (!isRecord(raw)) return {};
  const out = {};
  const fps = frameRateOf(raw.fps);
  if (fps != null) out.fps = fps;
  if (Array.isArray(raw.trackNames)) {
    const names = raw.trackNames.map(trackNameOf).filter((n) => n != null).slice(0, 200);
    if (names.length) out.trackNames = /** @type {TrackName[]} */
    names;
  }
  if (Array.isArray(raw.trackHeights)) {
    const heights = raw.trackHeights.map(trackHeightOf).filter((h) => h != null).slice(0, 200);
    if (heights.length) out.trackHeights = /** @type {TrackHeight[]} */
    heights;
  }
  return out;
}
function hydrationCanonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(hydrationCanonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value;
    return `{${Object.keys(record).filter((key) => record[key] !== void 0).sort().map((key) => `${JSON.stringify(key)}:${hydrationCanonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error("UNSUPPORTED_HYDRATION_VALUE");
}
export {
  filmShape,
  filmSrcKind,
  footageFps,
  hydrationCanonicalJson,
  layoutTracks,
  ownTrackHeight,
  parseMarkers,
  parseProjectSettings,
  placeMarkers,
  trackHeightsOf,
  trackNamesOf
};
