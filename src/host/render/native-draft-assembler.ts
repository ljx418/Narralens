import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { NativeDraftAssembler, NativeDraftAsset, NativeDraftFile, NativeDraftRequest, StagedNativeDraft } from './assembly-ports.js';
import { verifyRenderPin } from './upstream-pin.js';
import { DraftWorkspace } from './native-draft-io.js';
import { NativeDraftError, canonicalDraftJson, checkDraftAbort, digestBytes, draftCheck, draftVtt, escapeDraftHtml, frameSeconds, planNativeDraft, type DraftPlan } from './native-draft-plan.js';

const STYLE_MODULE = 'packages/openfilm/studio/server/film-subtitle.mjs';
const STYLE_SHA256 = 'be4b1852bc254ff597e43694a732044ef51dd43a78df13735c2ff023957687dd';
const extensionOf = (asset: NativeDraftAsset): string => ({ 'video/mp4': 'mp4', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/flac': 'flac', 'audio/ogg': 'ogg', 'audio/webm': 'webm' })[asset.mime_type]!;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

interface DraftFormat {
  readFilmFile(text: string): { doc: unknown; problems: readonly unknown[] };
  subtitleStyle: unknown;
}
async function loadDraftFormat(upstreamRoot: string, signal?: AbortSignal): Promise<DraftFormat> {
  checkDraftAbort(signal);
  const pin = await verifyRenderPin(upstreamRoot);
  if (!pin.ok) throw new NativeDraftError('DRAFT_FORMAT_UNAVAILABLE', 'The fixed native format is unavailable');
  const stylePath = resolve(pin.upstream_root, STYLE_MODULE);
  if (digestBytes(await readFile(stylePath)) !== STYLE_SHA256) throw new NativeDraftError('DRAFT_FORMAT_UNAVAILABLE', 'The fixed native subtitle style does not match');
  const film: unknown = await import(pathToFileURL(resolve(pin.upstream_root, 'packages/openfilm/src/film-doc.mjs')).href);
  const subtitle: unknown = await import(pathToFileURL(stylePath).href);
  checkDraftAbort(signal);
  if (!object(film) || typeof film.readFilmFile !== 'function' || !object(subtitle) || !object(subtitle.FILM_SUBTITLE_DEFAULT)) throw new NativeDraftError('DRAFT_FORMAT_UNAVAILABLE', 'The fixed native format exports are unavailable');
  return { readFilmFile: film.readFilmFile as DraftFormat['readFilmFile'], subtitleStyle: structuredClone(subtitle.FILM_SUBTITLE_DEFAULT) };
}

function conceptPage(plan: DraftPlan, text: string, frames: number): string {
  return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=${plan.width}, height=${plan.height}"><style>
html,body{margin:0;width:${plan.width}px;height:${plan.height}px;overflow:hidden;background:#101b2c;color:#f4f7fc;font-family:ui-sans-serif,system-ui,sans-serif}body{display:grid;place-items:center}article{box-sizing:border-box;width:86%;max-height:78%;padding:5%;border:2px solid #6dc7d9;border-radius:24px;background:#172943;white-space:pre-wrap;overflow-wrap:anywhere;overflow:hidden;font-size:${Math.max(16, Math.round(Math.min(plan.width, plan.height) * 0.045))}px;line-height:1.45}
</style></head><body><article>${escapeDraftHtml(text)}</article><script>
const ready=document.fonts.ready.then(()=>{const card=document.querySelector('article');if(card.scrollHeight>card.clientHeight+1||card.scrollWidth>card.clientWidth+1)throw new Error('Concept text does not fit its native card; revise the storyboard instead of hiding text.');});
window.film={width:${plan.width},height:${plan.height},duration:${frameSeconds(frames)},ready,frame(){}};</script></body></html>\n`;
}

/** Prepares source only. It neither renders a video nor publishes a committed project/snapshot. */
export class PinnedNativeDraftAssembler implements NativeDraftAssembler {
  constructor(private readonly upstreamRoot: string) {}
  async prepare(request: NativeDraftRequest): Promise<StagedNativeDraft> {
    checkDraftAbort(request.signal);
    const plan = planNativeDraft(request);
    // Copy all path-domain facts before any await as well as the creative plan/registry facts.
    const target = request.target_root;
    const protectedRoots = [...request.protected_roots];
    const signal = request.signal;
    let workspace: DraftWorkspace | undefined;
    try {
      const format = await loadDraftFormat(this.upstreamRoot, signal);
      workspace = await DraftWorkspace.create(target, protectedRoots, plan.assets, signal);
      const files: NativeDraftFile[] = [];
      const paths = new Map<string, string>();
      const assets: StagedNativeDraft['assets'][number][] = [];
      for (const [index, asset] of plan.assets.entries()) {
        const path = `${asset.kind === 'audio' ? 'assets/vo' : 'assets/video'}/${String(index + 1).padStart(3, '0')}-${asset.sha256}.${extensionOf(asset)}`;
        const copied = await workspace.copyAsset(asset.asset_id, path); files.push(copied); paths.set(asset.asset_id, path);
        assets.push({ asset_id: asset.asset_id, path, sha256: asset.sha256, bytes: asset.bytes, duration_frames: asset.duration_frames, media_type: asset.mime_type, source: asset.source, license: asset.license, rights_ref: asset.rights_ref, recording_origin: asset.recording_origin });
      }
      const visuals: string[] = [], concepts: string[] = [];
      const clipIds: string[] = [];
      let frame = 0;
      for (const [index, shot] of plan.storyboard.shots.entries()) {
        const id = `shot-${shot.shot_id}`;
        clipIds.push(id);
        const page = `scenes/${String(index + 1).padStart(3, '0')}.html`;
        if (shot.concept_text) files.push(await workspace.writeText(page, conceptPage(plan, shot.concept_text, shot.duration_frames)));
        const at = frameSeconds(frame), duration = frameSeconds(shot.duration_frames);
        if (shot.asset_id !== null) {
          visuals.push(`<video id="${id}" src="${paths.get(shot.asset_id)}#t=0,${duration}" at="${at}"${plan.narration ? ' muted' : ''} style="object-fit: contain"></video>`);
          if (shot.concept_text) {
            const overlay = `concept-${shot.shot_id}`; clipIds.push(overlay);
            // A separate editable page clip; it does not flatten the video's source into a composite MP4.
            concepts.push(`<iframe id="${overlay}" src="${page}#t=0,${duration}" at="${at}" style="left: ${Math.round(plan.width * 0.62)}px; top: ${Math.round(plan.height * 0.06)}px; width: ${Math.round(plan.width * 0.34)}px; height: ${Math.round(plan.height * 0.74)}px"></iframe>`);
          }
        } else visuals.push(`<iframe id="${id}" src="${page}#t=0,${duration}" at="${at}"></iframe>`);
        frame += shot.duration_frames;
      }
      const subtitles: StagedNativeDraft['subtitles'][number][] = [];
      const sounds: string[] = [];
      if (plan.narration) {
        const path = paths.get(plan.narration.asset_id)!;
        // No #t trim, no speed, no mute or gain: the complete source is its one native sound clip.
        sounds.push(`<audio id="narration" src="${path}" at="0"></audio>`); clipIds.push('narration');
        if (plan.storyboard.shots.some(s => s.caption)) {
          const vtt = path.replace(/\.[a-z0-9]+$/, '.vtt');
          files.push(await workspace.writeText(vtt, draftVtt(plan)));
          subtitles.push({ subtitle_id: 'storyboard-captions', path: vtt });
        }
      }
      const sections = [concepts, visuals, sounds].filter(clips => clips.length).map(clips => `<section>\n${clips.join('\n')}\n</section>`).join('\n');
      const film = `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=${plan.width}, height=${plan.height}"><title>Native draft</title></head><body>\n${sections}\n</body></html>\n`;
      const parsed = format.readFilmFile(film);
      if (!parsed.doc || parsed.problems.length) throw new NativeDraftError('DRAFT_FORMAT_UNAVAILABLE', 'The generated source was rejected by the fixed native parser');
      draftCheck(object(parsed.doc) && object(parsed.doc.stage) && parsed.doc.stage.w === plan.width && parsed.doc.stage.h === plan.height, 'The native parser did not preserve stage dimensions');
      draftCheck(Array.isArray(parsed.doc.tracks), 'The native parser did not return tracks');
      const nativeClipIds = parsed.doc.tracks.flatMap((track: unknown) => {
        draftCheck(object(track) && Array.isArray(track.clips), 'The native parser did not return clips');
        return track.clips.map((clip: unknown) => { draftCheck(object(clip) && typeof clip.id === 'string', 'The native parser did not preserve clip identifiers'); return clip.id; });
      });
      draftCheck(nativeClipIds.length === clipIds.length && new Set(nativeClipIds).size === clipIds.length && clipIds.every(id => nativeClipIds.includes(id)), 'The native parser changed draft clip identities');
      files.push(await workspace.writeText('film.html', film));
      files.push(await workspace.writeText('.film/settings.json', canonicalDraftJson({ fps: 30 }) + '\n'));
      files.push(await workspace.writeText('.film/subtitles.json', canonicalDraftJson(format.subtitleStyle) + '\n'));
      files.push(await workspace.writeText('draft-plan.json', plan.factJson + '\n'));
      files.push(await workspace.writeText('rights.json', canonicalDraftJson({ format: 'narralens.staged-rights@1', project_id: plan.projectId, assets }) + '\n'));
      files.sort((a, b) => a.relative_path < b.relative_path ? -1 : a.relative_path > b.relative_path ? 1 : 0);
      // VTT/editor settings are implicit native sidecars, not HTML src edges. Explicit roots bind them too.
      const mediaPaths = new Set(assets.map(asset => asset.path));
      const roots = ['film.html', ...files.map(file => file.relative_path).filter(path => path !== 'film.html' && !mediaPaths.has(path))];
      await workspace.finish(files);
      return { format: 'narralens.staged-native-draft@1', project_id: plan.projectId, root: target, fps: { num: 30, den: 1 }, frame_count: plan.totalFrames, clip_ids: nativeClipIds, roots, files, subtitles, assets, plan_digest: plan.digest, subtitle_timing_basis: 'storyboard_plan' };
    } catch (error) {
      if (error instanceof NativeDraftError) throw error;
      if (signal?.aborted) throw new NativeDraftError('DRAFT_CANCELLED', 'Native draft preparation cancelled');
      throw new NativeDraftError('DRAFT_IO_FAILED', 'Native draft preparation could not complete');
    } finally { await workspace?.dispose(); }
  }
}
