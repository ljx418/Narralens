/** Pure Host-only expected math. This module grants no authority and proves no native UI load. */
import { createHash } from 'node:crypto';
import { filmShape, filmSrcKind, layoutTracks, trackNamesOf, trackHeightsOf, ownTrackHeight,
  parseMarkers, placeMarkers, footageFps, parseProjectSettings, hydrationCanonicalJson } from './native-pure-library.mjs';

export { parseProjectSettings, parseMarkers };
export const EXPECTED_PROFILE = 'narralens.native-expected-numeric@1';
const PIN = 'e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3';
const SHA = /^[a-f0-9]{64}$/;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const unsupported = (reason) => ({ status: 'unsupported', profile: EXPECTED_PROFILE, reason });
const demand = (condition, reason) => { if (!condition) throw new Error(reason); };
const sameJson = (a, b) => hydrationCanonicalJson(a) === hydrationCanonicalJson(b);
function keys(value, required, optional = []) {
  demand(isObject(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key)), 'INPUT_INVALID');
}
function relativePath(value) {
  return typeof value === 'string' && value.length > 0 && !/[\\\u0000-\u001f:%?#]/.test(value)
    && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');
}
function fileFact(value, path, entries) {
  keys(value, ['relative_path', 'sha256', 'state']);
  demand(value.relative_path === path && relativePath(path), 'SOURCE_FACTS_MISMATCH');
  if (value.state === 'absent') demand(value.sha256 === null && !entries.has(path), 'SOURCE_FACTS_MISMATCH');
  else demand(value.state === 'present' && SHA.test(value.sha256) && entries.get(path) === value.sha256, 'SOURCE_FACTS_MISMATCH');
}
function part(part, value) {
  const canonical_utf8 = hydrationCanonicalJson({ format: 'narralens.native-hydration-effective@1', part, value });
  return { value, canonical_utf8, sha256: createHash('sha256').update(canonical_utf8, 'utf8').digest('hex') };
}

/** Computes only the declared no-transient UI baseline from independently proved Host facts. */
export function computeExpectedProjection(input) {
  try {
    keys(input, ['format', 'upstream_sha', 'profile', 'binding', 'provenance', 'ui_profile', 'source_entries',
      'film', 'settings', 'markers', 'clip_refs', 'media_facts', 'video_files_in_native_order', 'span_facts']);
    demand(input.format === 'narralens.native-expected-input@1' && input.profile === EXPECTED_PROFILE
      && input.upstream_sha === PIN, 'INPUT_INVALID');
    keys(input.ui_profile, ['pending_drops', 'preview_error', 'live_height', 'browser_preferences']);
    demand(input.ui_profile.pending_drops === 'excluded' && input.ui_profile.preview_error === 'excluded'
      && input.ui_profile.live_height === 'excluded' && input.ui_profile.browser_preferences === 'excluded', 'UI_PROFILE_UNSUPPORTED');
    keys(input.binding, ['project_id', 'project_revision', 'snapshot_id', 'source_digest', 'film_sha256']);
    demand(typeof input.binding.project_id === 'string' && input.binding.project_id.length > 0
      && Number.isSafeInteger(input.binding.project_revision) && input.binding.project_revision >= 1
      && ['snapshot_id', 'source_digest', 'film_sha256'].every(key => SHA.test(input.binding[key])), 'INPUT_INVALID');
    keys(input.provenance, ['origin', 'source_manifest_digest', 'rights_digest', 'media_catalog_digest', 'listing_digest']);
    demand(input.provenance.origin === 'host_independent' && ['source_manifest_digest', 'listing_digest']
      .every(key => SHA.test(input.provenance[key])) && ['rights_digest', 'media_catalog_digest']
      .every(key => input.provenance[key] === null || SHA.test(input.provenance[key])), 'UNPROVEN_FACTS');
    demand(Array.isArray(input.source_entries), 'INPUT_INVALID');
    const entries = new Map();
    for (const entry of input.source_entries) {
      keys(entry, ['relative_path', 'sha256']);
      demand(relativePath(entry.relative_path) && SHA.test(entry.sha256) && !entries.has(entry.relative_path), 'SOURCE_FACTS_MISMATCH');
      entries.set(entry.relative_path, entry.sha256);
    }
    demand(entries.get('film.html') === input.binding.film_sha256, 'SOURCE_FACTS_MISMATCH');
    keys(input.film, ['file', 'value']); fileFact(input.film.file, 'film.html', entries);
    demand(input.film.file.state === 'present', 'SOURCE_FACTS_MISMATCH');
    keys(input.settings, ['file', 'value']); fileFact(input.settings.file, '.film/settings.json', entries);
    keys(input.markers, ['file', 'value']); fileFact(input.markers.file, '.film/markers.json', entries);
    const doc = input.film.value;
    demand(isObject(doc) && Array.isArray(doc.tracks) && doc.tracks.every(track => isObject(track) && Array.isArray(track.clips)), 'INPUT_INVALID');
    const settings = parseProjectSettings(input.settings.value);
    const markers = parseMarkers(input.markers.value);
    demand(sameJson(settings, input.settings.value) && sameJson(markers, input.markers.value), 'INPUT_NOT_NATIVE_NORMALIZED');
    demand(input.settings.file.state !== 'absent' || sameJson(settings, {}), 'SOURCE_FACTS_MISMATCH');
    demand(input.markers.file.state !== 'absent' || markers.length === 0, 'SOURCE_FACTS_MISMATCH');
    demand(Array.isArray(input.clip_refs) && Array.isArray(input.media_facts) && Array.isArray(input.video_files_in_native_order), 'INPUT_INVALID');
    const clips = doc.tracks.flatMap(track => track.clips), refs = new Map(), clipIds = new Set();
    for (const ref of input.clip_refs) {
      keys(ref, ['clip_id', 'source_ref', 'source_sha256', 'provenance']);
      demand(typeof ref.clip_id === 'string' && ref.clip_id && relativePath(ref.source_ref) && !refs.has(ref.clip_id)
        && SHA.test(ref.source_sha256) && entries.get(ref.source_ref) === ref.source_sha256, 'CLIP_REFERENCE_MISMATCH');
      const provenance = ref.provenance;
      if (filmSrcKind(ref.source_ref) === 'page') {
        keys(provenance, ['kind', 'artifact_ref', 'producer_digest', 'producer_receipt_digest']);
        keys(provenance.artifact_ref, ['id', 'version', 'sha256']);
        demand(provenance.kind === 'controlled_source_artifact' && typeof provenance.artifact_ref.id === 'string'
          && provenance.artifact_ref.id.length > 0 && Number.isSafeInteger(provenance.artifact_ref.version) && provenance.artifact_ref.version >= 1
          && SHA.test(provenance.artifact_ref.sha256) && SHA.test(provenance.producer_digest)
          && SHA.test(provenance.producer_receipt_digest), 'UNPROVEN_FACTS');
      } else {
        keys(provenance, ['kind', 'asset_id', 'rights_digest']);
        demand(provenance.kind === 'registered_asset' && typeof provenance.asset_id === 'string' && provenance.asset_id.length > 0
          && SHA.test(provenance.rights_digest), 'UNPROVEN_FACTS');
      }
      refs.set(ref.clip_id, ref);
    }
    for (const clip of clips) {
      demand(isObject(clip) && typeof clip.id === 'string' && clip.id && !clipIds.has(clip.id)
        && relativePath(clip.src), 'CLIP_REFERENCE_MISMATCH');
      clipIds.add(clip.id);
      demand(typeof clip.at === 'number' && Number.isFinite(clip.at) && clip.at >= 0 && Array.isArray(clip.time)
        && clip.time.length === 2 && clip.time.every(Number.isFinite) && clip.time[0] >= 0 && clip.time[1] > clip.time[0]
        && (clip.speed === undefined || (typeof clip.speed === 'number' && Number.isFinite(clip.speed) && clip.speed > 0)), 'NON_NUMERIC_CLIP_UNSUPPORTED');
      demand(['page', 'video', 'still', 'sound'].includes(filmSrcKind(clip.src)), 'CLIP_REFERENCE_MISMATCH');
      const ref = refs.get(clip.id);
      demand(ref && ref.source_ref === clip.src, 'CLIP_REFERENCE_MISMATCH');
    }
    demand(refs.size === clips.length, 'CLIP_REFERENCE_MISMATCH');
    const facts = new Map(), media = new Map();
    for (const fact of input.media_facts) {
      keys(fact, ['source_ref', 'source_sha256', 'origin', 'proof_digest', 'duration_ms', 'has_audio', 'fps']);
      demand(relativePath(fact.source_ref) && !facts.has(fact.source_ref) && entries.get(fact.source_ref) === fact.source_sha256
        && SHA.test(fact.source_sha256) && SHA.test(fact.proof_digest) && ['host_actual_probe', 'host_deterministic_source'].includes(fact.origin)
        && typeof fact.has_audio === 'boolean' && (fact.duration_ms === null || (Number.isSafeInteger(fact.duration_ms) && fact.duration_ms > 0))
        && (fact.fps === null || (typeof fact.fps === 'number' && Number.isFinite(fact.fps) && fact.fps > 0)), 'UNPROVEN_FACTS');
      const kind = filmSrcKind(fact.source_ref);
      demand(['page', 'video', 'still', 'sound'].includes(kind), 'UNPROVEN_FACTS');
      demand(kind === 'page' ? fact.origin === 'host_deterministic_source' : fact.origin === 'host_actual_probe', 'UNPROVEN_FACTS');
      if (kind === 'video') demand(fact.duration_ms !== null && fact.fps !== null, 'INCOMPLETE_PROBE_FACTS');
      if (kind === 'sound') demand(fact.duration_ms !== null, 'INCOMPLETE_PROBE_FACTS');
      facts.set(fact.source_ref, fact);
      media.set(fact.source_ref, { audio: fact.has_audio, ...(fact.duration_ms === null ? {} : { duration: fact.duration_ms / 1000 }) });
    }
    for (const clip of clips) demand(facts.has(clip.src), 'INCOMPLETE_PROBE_FACTS');
    const hasRegisteredMedia = [...refs.values()].some(ref => ref.provenance.kind === 'registered_asset')
      || [...facts.values()].some(fact => fact.origin === 'host_actual_probe');
    demand(!hasRegisteredMedia || (SHA.test(input.provenance.rights_digest) && SHA.test(input.provenance.media_catalog_digest)), 'UNPROVEN_FACTS');
    const listed = new Set();
    for (const source of input.video_files_in_native_order) {
      demand(relativePath(source) && !listed.has(source) && source.startsWith('assets/') && entries.has(source)
        && filmSrcKind(source) === 'video' && facts.has(source), 'LISTING_FACTS_MISMATCH'); listed.add(source);
    }
    // A media-bearing clip outside assets is not probed by the same native listing path in this profile.
    for (const clip of clips) if (filmSrcKind(clip.src) !== 'page') demand(clip.src.startsWith('assets/'), 'LISTING_FACTS_MISMATCH');
    for (const [source] of entries) if (source.startsWith('assets/') && filmSrcKind(source) === 'video')
      demand(listed.has(source), 'LISTING_FACTS_MISMATCH');
    keys(input.span_facts, ['profile', 'origin', 'proof_digest', 'values']);
    demand(Array.isArray(input.span_facts.values), 'INPUT_INVALID');
    let spans;
    if (input.span_facts.profile === 'numeric_source_only') {
      demand(input.span_facts.origin === 'not_used' && input.span_facts.proof_digest === null
        && input.span_facts.values.length === 0, 'SPAN_FACTS_UNSUPPORTED'); spans = [];
    } else {
      demand(input.span_facts.profile === 'host_attested' && input.span_facts.origin === 'host_independent'
        && SHA.test(input.span_facts.proof_digest) && input.span_facts.values.length === clips.length, 'SPAN_FACTS_UNSUPPORTED');
      const seen = new Set();
      for (const span of input.span_facts.values) {
        keys(span, ['id', 'src', 'at', 'end', 'native'], ['w', 'h', 'reflows']);
        const clip = clips.find(clip => clip.id === span.id);
        demand(clip && !seen.has(span.id) && span.src === clip.src && Number.isFinite(span.at) && Number.isFinite(span.end)
          && span.end > span.at && (span.native === null || (Number.isFinite(span.native) && span.native > 0))
          && Math.abs(span.at - clip.at) < 0.000001
          && Math.abs(span.end - (clip.at + (clip.time[1] - clip.time[0]) / (clip.speed ?? 1))) < 0.000001, 'SPAN_FACTS_UNSUPPORTED');
        demand(['w', 'h'].every(key => span[key] === undefined || (Number.isFinite(span[key]) && span[key] > 0))
          && (span.reflows === undefined || span.reflows === true), 'SPAN_FACTS_UNSUPPORTED'); seen.add(span.id);
      }
      spans = input.span_facts.values;
    }
    // All layout/placement arithmetic is the fixed native implementation, not a Host timeline rewrite.
    const tracks = layoutTracks(filmShape(doc, spans, media, false));
    const names = trackNamesOf(settings.trackNames ?? [], doc.tracks);
    const heights = trackHeightsOf(settings.trackHeights ?? [], doc.tracks);
    const shown = tracks.map(track => { const height = track.docIndex == null ? undefined : heights.get(track.docIndex);
      return height == null ? track : { ...track, height }; });
    const fps = settings.fps ?? footageFps([
      ...tracks.flatMap(track => track.blocks).filter(block => block.kind === 'video' && block.src)
        .sort((a, b) => a.startMs - b.startMs).map(block => facts.get(block.src)?.fps ?? undefined),
      ...input.video_files_in_native_order.map(source => facts.get(source)?.fps ?? undefined),
    ]);
    const settingsValue = { settings, resolved_fps: fps, fps_source: settings.fps == null ? 'footage_or_default' : 'project',
      track_names: [...names].sort(([a], [b]) => a - b).map(([doc_index, name]) => ({ doc_index, name })),
      track_heights: shown.map(track => ({ lane: track.lane, doc_index: track.docIndex ?? null, index: track.index,
        height: track.height ?? ownTrackHeight(track) })) };
    const markersValue = { placed: placeMarkers(markers, tracks).map(({ marker, ms, clip }) => ({ marker, ms, clip_id: clip?.clipId ?? null })) };
    return { status: 'computed', profile: EXPECTED_PROFILE, binding: input.binding,
      input_sha256: createHash('sha256').update(hydrationCanonicalJson(input), 'utf8').digest('hex'),
      settings: part('settings', settingsValue), markers: part('markers', markersValue),
      not_proven: ['native_document_loaded', 'native_hydration', 'media_decoded', 'subtitle_style', 'captions',
        'source_currentness', 'rights_authorization', 'absence_of_transient_ui_state'] };
  } catch (error) {
    const allowed = new Set(['INPUT_INVALID', 'UI_PROFILE_UNSUPPORTED', 'UNPROVEN_FACTS', 'SOURCE_FACTS_MISMATCH',
      'INPUT_NOT_NATIVE_NORMALIZED', 'CLIP_REFERENCE_MISMATCH', 'NON_NUMERIC_CLIP_UNSUPPORTED', 'INCOMPLETE_PROBE_FACTS',
      'LISTING_FACTS_MISMATCH', 'SPAN_FACTS_UNSUPPORTED']);
    return unsupported(allowed.has(error?.message) ? error.message : 'NATIVE_PROJECTION_UNSUPPORTED');
  }
}
