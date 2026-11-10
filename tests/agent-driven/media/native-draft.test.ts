import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { NativeDraftAsset, NativeDraftRequest } from '../../../src/host/render/assembly-ports.js';
import { PinnedNativeDraftAssembler } from '../../../src/host/render/native-draft-assembler.js';
import { DraftWorkspace } from '../../../src/host/render/native-draft-io.js';
import { digestBytes, draftVtt, planNativeDraft } from '../../../src/host/render/native-draft-plan.js';
import { computeSourceDigest } from '../../../src/host/engine/source-digest-v1.js';

// These bytes are deliberate non-media unit fixtures. Registry facts are the Host-only trust seam.
// No test here establishes real decode, recorded speech, render, visible captions or native loaded ack.
const unitVideo = Buffer.from('unit registry-owned video bytes');
const unitAudio = Buffer.from('unit registry-owned synthetic diagnostic audio bytes');
const upstream = '/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm';
let root: string, source: string, stage: string, protectedRoot: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'narralens-draft-unit-'));
  source = join(root, 'source'); stage = join(root, 'private'); protectedRoot = join(root, 'snapshot');
  for (const path of [root, source, stage, protectedRoot]) { await mkdir(path, { recursive: true }); await chmod(path, 0o700); }
  await writeFile(join(source, 'video.mp4'), unitVideo);
  await writeFile(join(source, 'voice.wav'), unitAudio);
  await writeFile(join(protectedRoot, 'author-fact'), 'must remain exact');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
function asset(id: string, kind: 'video' | 'audio'): NativeDraftAsset {
  const bytes = kind === 'video' ? unitVideo : unitAudio;
  return { project_id: 'project1', asset_id: id, absolute_path: join(source, kind === 'video' ? 'video.mp4' : 'voice.wav'), sha256: digestBytes(bytes), bytes: bytes.length, duration_frames: kind === 'video' ? 90 : 60, kind, mime_type: kind === 'video' ? 'video/mp4' : 'audio/wav', source: { kind: 'owned', label: 'unit fixture owned by test' }, license: { status: 'cleared', label: 'explicit unit-only fact', commercial_use: true }, rights_ref: `rights_${id}`, recording_origin: kind === 'audio' ? 'synthetic' : null };
}
function request(): NativeDraftRequest {
  return { project_id: 'project1', target_root: join(stage, 'draft'), protected_roots: [source, protectedRoot], width: 640, height: 360,
    script: { kind: 'script', paragraphs: [{ paragraph_id: 'p1', text: 'The actual script.' }, { paragraph_id: 'p2', text: 'Second explanation.' }] },
    storyboard: { kind: 'storyboard', fps: 30, shots: [
      { shot_id: 's1', paragraph_id: 'p1', asset_id: 'v1', duration_frames: 30, caption: 'A "quote" & <literal>', concept_text: '' },
      { shot_id: 's2', paragraph_id: 'p2', asset_id: null, duration_frames: 30, caption: 'Second explanation.', concept_text: 'Concept <script> must be literal.' },
    ] }, assets: [asset('v1', 'video'), asset('a1', 'audio')], narration_asset_id: 'a1' };
}
describe('native draft creative and rights planning', () => {
  it('binds actual script, source facts, complete narration and explicit storyboard timing without host paths', () => {
    const input = request(), plan = planNativeDraft(input);
    expect(plan.totalFrames).toBe(60); expect(plan.narration?.recording_origin).toBe('synthetic');
    expect(plan.factJson).not.toContain(source); expect(plan.factJson).toContain('"timing_basis":"storyboard_plan"');
    input.script.paragraphs[0]!.text = 'caller mutation';
    expect(plan.script.paragraphs[0]!.text).toBe('The actual script.');
    expect(digestBytes(plan.factJson)).toBe(plan.digest);
    const vtt = draftVtt(plan);
    expect(vtt).toContain('00:00:00.000 --> 00:00:01.000');
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.000');
    expect(vtt).toContain('A "quote" &amp; &lt;literal&gt;'); expect(vtt).not.toContain('&quot;');
  });
  it.each([59, 61])('rejects narration frame length %s instead of trimming or retiming', frames => {
    const input = request(); (input.assets[1] as { duration_frames: number }).duration_frames = frames;
    expect(() => planNativeDraft(input)).toThrow(/complete draft/);
  });
  it('blocks unknown rights, wrong project, source alias IDs and omitted script content', () => {
    const unknown = request(); unknown.assets[0]!.license.status = 'unknown'; expect(() => planNativeDraft(unknown)).toThrow(/rights/);
    const owner = request(); (owner.assets[0] as { project_id: string }).project_id = 'other'; expect(() => planNativeDraft(owner)).toThrow(/identity/);
    const alias = request(); (alias.assets[1] as { asset_id: string }).asset_id = 'V1'; expect(() => planNativeDraft(alias)).toThrow(/aliased asset/);
    const omit = request(); omit.script.paragraphs.push({ paragraph_id: 'p3', text: 'Do not silently omit this.' }); expect(() => planNativeDraft(omit)).toThrow(/cover/);
  });
  it('fails closed on planned captions without the full narration source', () => {
    const input = { ...request(), assets: [asset('v1', 'video')], narration_asset_id: null };
    expect(() => planNativeDraft(input)).toThrow(/captions/);
  });
});

describe('private fd-anchored draft IO (unit bytes, no media process)', () => {
  it('streams and fsyncs exact copied bytes, rejects wrong digest and cleans only its new root', async () => {
    const input = request(); const wrong = { ...input.assets[0]!, sha256: '0'.repeat(64) };
    const workspace = await DraftWorkspace.create(input.target_root, input.protected_roots, [wrong]);
    try { await expect(workspace.copyAsset('v1', 'assets/v.mp4')).rejects.toMatchObject({ code: 'DRAFT_SOURCE_CHANGED' }); }
    finally { await workspace.dispose(); }
    await expect(lstat(input.target_root)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(protectedRoot, 'author-fact'), 'utf8')).toBe('must remain exact');
  });
  it('no-clobber leaves a pre-existing root and its contents unchanged', async () => {
    const input = request(); await mkdir(input.target_root); await writeFile(join(input.target_root, 'sentinel'), 'mine');
    await expect(DraftWorkspace.create(input.target_root, input.protected_roots, [])).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(join(input.target_root, 'sentinel'), 'utf8')).toBe('mine');
  });
  it('rejects protected overlap and symlink ancestors before any target mkdir', async () => {
    await expect(DraftWorkspace.create(join(protectedRoot, 'bad'), [protectedRoot], [])).rejects.toMatchObject({ code: 'DRAFT_PATH_REJECTED' });
    const alias = join(root, 'alias'); await symlink(stage, alias);
    await expect(DraftWorkspace.create(join(alias, 'bad'), [protectedRoot], [])).rejects.toBeDefined();
    expect(await readdir(stage)).toEqual([]); expect(await readdir(protectedRoot)).toEqual(['author-fact']);
  });
  it('rejects a non-private parent and cross-ID hardlink inputs without creating output', async () => {
    const input = request(); await chmod(stage, 0o755);
    await expect(DraftWorkspace.create(input.target_root, input.protected_roots, [])).rejects.toMatchObject({ code: 'DRAFT_PATH_REJECTED' });
    await chmod(stage, 0o700);
    await link(join(source, 'video.mp4'), join(source, 'alias.mp4'));
    await expect(DraftWorkspace.create(input.target_root, input.protected_roots, [asset('v1', 'video'), { ...asset('v2', 'video'), absolute_path: join(source, 'alias.mp4') }])).rejects.toMatchObject({ code: 'DRAFT_PATH_REJECTED' });
    expect(await readdir(stage)).toEqual([]);
  });
  it('opens FIFO nonblocking and rejects non-regular source without leaving a root', async () => {
    const fifo = join(source, 'fifo.mp4'); execFileSync('mkfifo', [fifo]);
    await expect(DraftWorkspace.create(join(stage, 'fifo'), [protectedRoot], [{ ...asset('v1', 'video'), absolute_path: fifo }])).rejects.toMatchObject({ code: 'DRAFT_PATH_REJECTED' });
    expect(await readdir(stage)).toEqual([]);
  });
  it('cancels before the next copied chunk, closes files and removes partial owned stage', async () => {
    const input = request(), controller = new AbortController();
    const workspace = await DraftWorkspace.create(input.target_root, input.protected_roots, input.assets, controller.signal);
    await workspace.writeText('partial.json', '{}'); controller.abort();
    try { await expect(workspace.copyAsset('v1', 'assets/v.mp4')).rejects.toMatchObject({ code: 'DRAFT_CANCELLED' }); }
    finally { await workspace.dispose(); }
    await expect(lstat(input.target_root)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('source replacement is rejected and cleanup leaves the replacement source untouched', async () => {
    const input = request(), workspace = await DraftWorkspace.create(input.target_root, input.protected_roots, input.assets);
    await rename(join(source, 'video.mp4'), join(source, 'old.mp4')); await writeFile(join(source, 'video.mp4'), 'replacement');
    try { await expect(workspace.copyAsset('v1', 'assets/v.mp4')).rejects.toMatchObject({ code: 'DRAFT_SOURCE_CHANGED' }); }
    finally { await workspace.dispose(); }
    expect(await readFile(join(source, 'video.mp4'), 'utf8')).toBe('replacement');
    expect(await readdir(stage)).toEqual([]);
  });
  it('refuses a different real directory substituted after new root stat, without writing or deleting the replacement', async () => {
    const input=request(),moved=join(stage,'moved-created');let boundaryHit=false;
    let opened:DraftWorkspace|undefined;
    try{await expect(DraftWorkspace.create(input.target_root,input.protected_roots,input.assets,undefined,{afterCreatedDirectoryStat:async relative=>{
      if(relative!=='')return;boundaryHit=true;await rename(input.target_root,moved);await mkdir(input.target_root,{mode:0o700});await writeFile(join(input.target_root,'foreign-sentinel'),'must survive');
    }}).then(value=>{opened=value;return value;})).rejects.toMatchObject({code:'DRAFT_IO_FAILED'});}
    finally{if(opened)await opened.dispose().catch(()=>undefined);}
    expect(boundaryHit).toBe(true);expect(await readdir(moved)).toEqual([]);expect(await readdir(input.target_root)).toEqual(['foreign-sentinel']);expect(await readFile(join(input.target_root,'foreign-sentinel'),'utf8')).toBe('must survive');
  });
  it('refuses a substituted nested real output directory and never writes into its replacement', async () => {
    const input=request(),moved=join(stage,'moved-nested');let boundaryHit=false;
    const workspace=await DraftWorkspace.create(input.target_root,input.protected_roots,input.assets,undefined,{afterCreatedDirectoryStat:async relative=>{
      if(relative!=='nested')return;boundaryHit=true;await rename(join(input.target_root,'nested'),moved);await mkdir(join(input.target_root,'nested'),{mode:0o700});await writeFile(join(input.target_root,'nested','foreign-sentinel'),'must survive');
    }});
    try{await expect(workspace.writeText('nested/not-ours.json','{}')).rejects.toMatchObject({code:'DRAFT_SOURCE_CHANGED'});}
    finally{await expect(workspace.dispose()).rejects.toMatchObject({code:'DRAFT_IO_FAILED'});}
    expect(boundaryHit).toBe(true);expect(await readdir(moved)).toEqual([]);expect(await readdir(join(input.target_root,'nested'))).toEqual(['foreign-sentinel']);expect(await readFile(join(input.target_root,'nested','foreign-sentinel'),'utf8')).toBe('must survive');
  });
  it('a swapped output ancestor cannot redirect writes or cleanup into snapshot', async () => {
    const input = request(), workspace = await DraftWorkspace.create(input.target_root, input.protected_roots, input.assets);
    await rename(stage, join(root, 'private-old')); await symlink(protectedRoot, stage);
    try { await expect(workspace.writeText('forbidden.json', '{}')).rejects.toMatchObject({ code: 'DRAFT_SOURCE_CHANGED' }); }
    finally { await workspace.dispose(); }
    expect(await readdir(protectedRoot)).toEqual(['author-fact']); expect(await readdir(join(root, 'private-old'))).toEqual([]);
  });
});

describe('source-only integration with the real fixed pure parser, no browser/render/decode', () => {
  it('creates editable primary clips and exact native source/settings/VTT closure from registry unit facts', async () => {
    const input = request(); const result = await new PinnedNativeDraftAssembler(upstream).prepare(input);
    expect(result.frame_count).toBe(60); expect(result.subtitle_timing_basis).toBe('storyboard_plan');
    expect(result.clip_ids).toEqual(['shot-s1', 'shot-s2', 'narration']);
    expect(result.assets[1]!.recording_origin).toBe('synthetic');
    const film = await readFile(join(result.root, 'film.html'), 'utf8');
    expect(film).toContain('<video id="shot-s1"'); expect(film).toContain('<iframe id="shot-s2"');
    const audio = film.match(/<audio[^>]+>/)![0]; expect(audio).not.toMatch(/#t=|speed=|muted|volume=/);
    expect(JSON.parse(await readFile(join(result.root, '.film/settings.json'), 'utf8'))).toEqual({ fps: 30 });
    expect(JSON.parse(await readFile(join(result.root, '.film/subtitles.json'), 'utf8')).on).toBe(true);
    expect(await readFile(join(result.root, 'scenes/002.html'), 'utf8')).toContain('Concept &lt;script&gt; must be literal.');
    for (const file of result.files) {
      const bytes = await readFile(join(result.root, file.relative_path)); expect(bytes.length).toBe(file.bytes); expect(digestBytes(bytes)).toBe(file.sha256);
    }
    expect(await readFile(join(result.root, result.assets[1]!.path))).toEqual(unitAudio);
    expect((await lstat(result.root)).mode & 0o077).toBe(0);
    expect(result.roots[0]).toBe('film.html');
    expect(result.roots).toContain('.film/settings.json'); expect(result.roots).toContain('.film/subtitles.json');
    expect(result.roots).toContain(result.subtitles[0]!.path);
    const before = await computeSourceDigest({ root: result.root, roots: result.roots, engine: 'openfilm', engineUpstreamSha: 'e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3' });
    expect(new Set([...before.manifest.files, ...before.manifest.assets].map(file => file.path))).toEqual(new Set(result.files.map(file => file.relative_path)));
    await writeFile(join(result.root, '.film/settings.json'), '{"fps":24}\n');
    const after = await computeSourceDigest({ root: result.root, roots: result.roots, engine: 'openfilm', engineUpstreamSha: 'e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3' });
    expect(after.source_digest).not.toBe(before.source_digest);
  });
});
