import { createHash } from 'node:crypto';
import { validateAgentDefinition } from '../../contracts/agent-driven-validator.js';
import type { Script, Storyboard } from '../../contracts/agent-driven-types.js';
import type { NativeDraftAsset, NativeDraftRequest } from './assembly-ports.js';

export class NativeDraftError extends Error {
  constructor(readonly code: 'INVALID_DRAFT' | 'DRAFT_RIGHTS_BLOCKED' | 'DRAFT_SOURCE_CHANGED' | 'DRAFT_PATH_REJECTED' | 'DRAFT_CANCELLED' | 'DRAFT_IO_FAILED' | 'DRAFT_FORMAT_UNAVAILABLE', message: string) {
    super(message); this.name = 'NativeDraftError';
  }
}
export function draftCheck(ok: unknown, message: string): asserts ok {
  if (!ok) throw new NativeDraftError('INVALID_DRAFT', message);
}
export function checkDraftAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new NativeDraftError('DRAFT_CANCELLED', 'Native draft preparation cancelled');
}
export const digestBytes = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
/** Stable JSON over contract facts, never host paths. */
export function canonicalDraftJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalDraftJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalDraftJson(item)}`).join(',')}}`;
  const text = JSON.stringify(value); draftCheck(text !== undefined, 'Draft facts must be JSON'); return text;
}
const idOk = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id);
const textOk = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 6000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff]/u.test(value);
function uniqueIds(values: readonly string[], kind: string): void {
  draftCheck(values.every(idOk) && new Set(values.map(v => v.toLowerCase())).size === values.length, `Duplicate or aliased ${kind} identifiers`);
}
export interface DraftPlan {
  readonly projectId: string; readonly script: Script; readonly storyboard: Storyboard;
  readonly assets: readonly NativeDraftAsset[]; readonly narration: NativeDraftAsset | null;
  readonly totalFrames: number; readonly width: number; readonly height: number;
  readonly factJson: string; readonly digest: string;
}
/** Detaches mutable caller objects before the first asynchronous operation. */
export function planNativeDraft(request: NativeDraftRequest): DraftPlan {
  let script: Script, storyboard: Storyboard, assets: NativeDraftAsset[];
  try {
    script = structuredClone(validateAgentDefinition<Script>('Script', request.script));
    storyboard = structuredClone(validateAgentDefinition<Storyboard>('Storyboard', request.storyboard));
    assets = structuredClone([...request.assets]);
  } catch { throw new NativeDraftError('INVALID_DRAFT', 'Invalid Script, Storyboard or registry facts'); }
  draftCheck(idOk(request.project_id), 'Invalid project identifier');
  draftCheck(assets.every(asset => asset !== null && typeof asset === 'object'), 'Invalid registry fact');
  draftCheck(Number.isSafeInteger(request.width) && request.width >= 16 && request.width <= 8192 && Number.isSafeInteger(request.height) && request.height >= 16 && request.height <= 8192, 'Invalid native stage size');
  uniqueIds(script.paragraphs.map(p => p.paragraph_id), 'paragraph');
  uniqueIds(storyboard.shots.map(s => s.shot_id), 'shot');
  uniqueIds(assets.map(a => a.asset_id), 'asset');
  const paragraphs = new Set(script.paragraphs.map(p => p.paragraph_id));
  const usedParagraphs = new Set(storyboard.shots.map(s => s.paragraph_id));
  draftCheck(script.paragraphs.every(p => textOk(p.text)) && usedParagraphs.size === paragraphs.size && [...usedParagraphs].every(p => paragraphs.has(p)), 'Storyboard must cover the actual Script paragraphs');
  const byId = new Map(assets.map(a => [a.asset_id, a]));
  const usedAssets = new Set<string>();
  let totalFrames = 0;
  for (const shot of storyboard.shots) {
    draftCheck(!shot.caption || textOk(shot.caption), 'Invalid caption text');
    draftCheck(!shot.concept_text || textOk(shot.concept_text), 'Invalid concept text');
    draftCheck(shot.asset_id !== null || shot.concept_text.trim().length > 0, 'A concept shot needs actual concept text');
    if (shot.asset_id !== null) {
      const asset = byId.get(shot.asset_id);
      draftCheck(asset?.kind === 'video' && asset.duration_frames >= shot.duration_frames, 'A shot requires enough registered video frames');
      usedAssets.add(shot.asset_id);
    }
    totalFrames += shot.duration_frames;
  }
  draftCheck(Number.isSafeInteger(totalFrames) && totalFrames > 0, 'Invalid total frame count');
  draftCheck(request.narration_asset_id === null || idOk(request.narration_asset_id), 'Invalid narration identifier');
  const narration = request.narration_asset_id === null ? null : byId.get(request.narration_asset_id);
  if (request.narration_asset_id !== null) {
    draftCheck(narration?.kind === 'audio' && narration.duration_frames === totalFrames, 'Narration must cover the complete draft at 30 fps without trimming or retiming');
    usedAssets.add(request.narration_asset_id);
  } else {
    draftCheck(storyboard.shots.every(s => !s.caption), 'Native planned captions currently require the complete narration source');
  }
  draftCheck(usedAssets.size === assets.length, 'Only explicitly used registry assets may enter the draft');
  for (const asset of assets) {
    draftCheck(Object.keys(asset).sort().join(',') === 'absolute_path,asset_id,bytes,duration_frames,kind,license,mime_type,project_id,recording_origin,rights_ref,sha256,source', 'Unexpected registry fact fields');
    draftCheck(asset.project_id === request.project_id && /^[a-f0-9]{64}$/.test(asset.sha256) && Number.isSafeInteger(asset.bytes) && asset.bytes > 0 && Number.isSafeInteger(asset.duration_frames) && asset.duration_frames > 0, 'Invalid registry asset identity');
    draftCheck(asset.kind === 'video' || asset.kind === 'audio', 'Unsupported registry media kind');
    draftCheck(asset.kind === 'video' ? asset.mime_type === 'video/mp4' : ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/flac', 'audio/ogg', 'audio/webm'].includes(asset.mime_type), 'Unsupported registered media type');
    draftCheck(asset.recording_origin === null || ['human_recording', 'synthetic', 'unknown'].includes(asset.recording_origin), 'Invalid recording origin');
    if (asset.license?.status !== 'cleared' || asset.license.commercial_use !== true || !textOk(asset.rights_ref) || !textOk(asset.license.label)) throw new NativeDraftError('DRAFT_RIGHTS_BLOCKED', 'Every used asset requires explicit cleared commercial rights');
    draftCheck(Object.keys(asset.license).sort().join(',') === 'commercial_use,label,status', 'Unexpected license fields');
    draftCheck(asset.source && ['owned', 'generated', 'licensed', 'derived'].includes(asset.source.kind) && textOk(asset.source.label), 'Invalid asset provenance');
    const sourceKeys = Object.keys(asset.source).sort().join(',');
    draftCheck(asset.source.kind === 'derived' ? sourceKeys === 'kind,label,lineage' : sourceKeys === 'kind,label' || sourceKeys === 'kind,label,uri', 'Unexpected provenance fields');
    if (asset.source.kind === 'derived') draftCheck(Array.isArray(asset.source.lineage) && asset.source.lineage.length > 0 && asset.source.lineage.every(idOk), 'Derived asset requires actual lineage');
    else if (asset.source.uri !== undefined) {
      let url: URL; try { url = new URL(asset.source.uri); } catch { throw new NativeDraftError('INVALID_DRAFT', 'Invalid provenance URI'); }
      draftCheck(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash, 'Provenance URI must not contain local paths or credentials');
    }
  }
  const facts = { format: 'narralens.native-draft-plan@1', status: 'SOURCE_ONLY', timing_basis: 'storyboard_plan', project_id: request.project_id, script, storyboard, narration_asset_id: request.narration_asset_id, width: request.width, height: request.height, fps: { num: 30, den: 1 }, assets: assets.map(({ absolute_path: _hostPath, ...asset }) => asset) };
  const factJson = canonicalDraftJson(facts);
  return { projectId: request.project_id, script, storyboard, assets, narration: narration ?? null, totalFrames, width: request.width, height: request.height, factJson, digest: digestBytes(factJson) };
}

export const escapeDraftHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const frameSeconds = (frame: number): string => (frame / 30).toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
const vttStamp = (frame: number): string => {
  const ms = Math.round(frame * 1000 / 30);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
};
/** Native transcript control marker preserves pre-cut storyboard cues; it is no human approval. */
export function draftVtt(plan: DraftPlan): string {
  let frame = 0;
  const cues = plan.storyboard.shots.flatMap(shot => {
    const start = frame; frame += shot.duration_frames;
    const payload = shot.caption.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\s+/g, ' ').trim();
    return shot.caption ? [`${vttStamp(start)} --> ${vttStamp(frame)}\n${payload}`] : [];
  });
  // Fixed transcripts.mjs CUT_NOTE_RE accepts this prefix; the suffix states real plan provenance.
  return `WEBVTT\n\nNOTE Each cue is one subtitle, timed from the storyboard plan (not speech alignment).\n\n${cues.join('\n\n')}\n`;
}
