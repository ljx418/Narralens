import {it,expect} from 'vitest';
import {cp,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createPinnedOpenFilmUpstream,upstreamRevOf} from '../../../src/adapters/openfilm/openfilm-upstream.js';
import {OpenFilmEngineAdapter} from '../../../src/adapters/openfilm/openfilm-engine-adapter.js';
import {computeSourceDigest} from '../../../src/host/engine/source-digest-v1.js';
import {OPENFILM_UPSTREAM_SHA} from '../../../src/host/engine/engine-binding-store.js';
const vendor='/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm';
const original='/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/spikes/openfilm-m1b/project';
it('reads the actual three-page/audio project through the pinned parser and keeps completeness, source and cancellation guards',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'narralens-a06-three-clip-'));const root=join(directory,'project');
 const sourceFilmBefore=await readFile(join(original,'film.html'));
 try{
  await cp(original,root,{recursive:true});
  const upstream=await createPinnedOpenFilmUpstream(vendor),adapter=new OpenFilmEngineAdapter(upstream);
  const layout={root,roots:['film.html','assets/narration.vtt'],declaredAssets:[{path:'assets/narration.wav',asset_id:'asset_narration_m1b'}],subtitles:[{subtitle_id:'narration',path:'assets/narration.vtt'}]};
  const ctx=()=>({projectId:'a06-real-project',correlationId:'a06-real-read',signal:AbortSignal.timeout(20000)});
  const digest=()=>computeSourceDigest({...layout,engine:'openfilm',engineUpstreamSha:OPENFILM_UPSTREAM_SHA});
  const initial=await digest(),first=await upstream.readProjectFilm(root);
  expect(first.text).toBe(sourceFilmBefore.toString('utf8'));expect(first.rev).toBe(upstreamRevOf(first.text));expect(first.problems).toEqual([]);
  const withOverride=await adapter.inspectSnapshot(layout,initial.source_digest,ctx());
  expect(withOverride.problems).toContain('OPENFILM_PROJECTION:CLIP_OVERRIDES:shot-02');
  // Explicit diagnostic preparation in our private copy, through the real native mutator.
  // Preserve the original artwork and retain the fail-closed override assertion above.
  await upstream.editProjectFilm(root,first.rev,[{op:'set',clip:'shot-02',field:'overrides',value:[]}]);
  const clean=await digest(),projection=await adapter.inspectSnapshot(layout,clean.source_digest,ctx());
  expect(projection.problems).toEqual([]);expect(projection.frame_count).toBe(900);expect(projection.fps).toEqual({num:30,den:1});
  expect(projection.clips.filter(clip=>clip.kind==='page').map(clip=>clip.clip_id)).toEqual(['shot-01','shot-02','shot-03']);
  expect(projection.clips.filter(clip=>clip.kind==='sound').map(clip=>clip.clip_id)).toEqual(['narration']);expect(projection.subtitles).toHaveLength(1);
  const bytesBeforeRefusal=await readFile(join(root,'film.html'));
  await expect(adapter.inspectSnapshot(layout,initial.source_digest,ctx())).rejects.toMatchObject({code:'SOURCE_CHANGED',status:409});
  expect(await readFile(join(root,'film.html'))).toEqual(bytesBeforeRefusal);
  const controller=new AbortController();controller.abort(new Error('observer cancelled'));
  await expect(adapter.inspectSnapshot(layout,clean.source_digest,{...ctx(),signal:controller.signal})).rejects.toThrow('observer cancelled');
  // UTF8 decoding must not turn different committed bytes into the same accepted text.
  await writeFile(join(root,'film.html'),Buffer.concat([bytesBeforeRefusal,Buffer.from([255])]));const invalid=await digest();
  await expect(adapter.inspectSnapshot(layout,invalid.source_digest,ctx())).rejects.toMatchObject({code:'SOURCE_CHANGED'});
  expect(createHash('sha256').update(await readFile(join(original,'film.html'))).digest('hex')).toBe(createHash('sha256').update(sourceFilmBefore).digest('hex'));
 }finally{await rm(directory,{recursive:true,force:true});}
},120000);
