import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,cp,unlink,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createdProjectFixture,vendorRoot} from '../integration/helpers/created-project-fixture.js';
import {LocalAssetRegistry} from '../../../src/host/agent-driven/local-asset-registry.js';
import {createTrustedCallerContext} from '../../../src/host/creative/trusted-context.js';
import {PinnedNativeDraftAssembler} from '../../../src/host/render/native-draft-assembler.js';
import {NativeRenderer} from '../../../src/host/render/native-renderer.js';
import type {NativeDraftAsset,NativeDraftRequest} from '../../../src/host/render/assembly-ports.js';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function ffmpeg(args:string[]){return execFileSync('ffmpeg',['-nostdin','-hide_banner','-v','error',...args],{stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:120000,maxBuffer:16*1024*1024});}
/** Real source-only diagnostic preview, NOT a committed export, human recording,
 * workflow route, adoption, Delivery or complete A acceptance. No mock media/probe. */
it.each([{caseName:'Chinese full-stop normalization',audioSeconds:'3',punctuation:'。'},{caseName:'fractional final audio frame',audioSeconds:'2.99',punctuation:''}])('registers real media and visibly burns native captions: $caseName',async({audioSeconds,punctuation})=>{
 const f=await createdProjectFixture();let registry:LocalAssetRegistry|undefined;
 try{
  const source=join(f.root,'local-input'),blobs=join(f.root,'registered-blobs');await mkdir(source,{mode:0o700});
  ffmpeg(['-filter_threads','1','-f','lavfi','-i','color=c=0x185a88:s=320x180:r=30:d=3','-threads','1','-c:v','libx264','-pix_fmt','yuv420p',join(source,'video.mp4')]);
  ffmpeg(['-f','lavfi','-i','sine=frequency=430:sample_rate=48000:duration='+audioSeconds,'-threads','1','-c:a','pcm_s16le',join(source,'diagnostic.wav')]);
  registry=new LocalAssetRegistry(f.host.revisions,f.app.creation,{sourceRoot:source,storageRoot:blobs,projectsRoot:join(f.root,'projects'),snapshotsRoot:join(f.root,'snapshots')});
  const ui=createTrustedCallerContext({principal_id:f.ui.principal.principal_id,channel:'trusted_ui',source:'trusted_ui',session_ref:f.ui.principal.session_ref});
  const resolved:NativeDraftAsset[]=[];
  for(const [index,[file,kind]] of ([['video.mp4','video'],['diagnostic.wav','audio']] as const).entries()){
   const input=await readFile(join(source,file));
   const asset=await registry.import({project_id:f.projectId,idempotency_key:'diagnostic-import-'+index,relative_path:file,expected_sha256:hash(input),kind,source:{kind:'generated',label:'Automatically generated local diagnostic fixture'},license:{status:'cleared',label:'Test-created diagnostic media only',commercial_use:true},recording_origin:kind==='audio'?'synthetic':null,attestation_ref:'diagnostic_fixture_'+index},ui);
   const actual=await registry.resolve(f.projectId,asset.asset_id,f.owner);
   resolved.push({project_id:f.projectId,asset_id:actual.asset.asset_id,absolute_path:actual.absolute_path,sha256:actual.asset.sha256,bytes:actual.asset.bytes,duration_frames:actual.asset.media.duration_frames,kind:actual.asset.media.kind,mime_type:actual.asset.media.media_type,source:actual.asset.source,license:actual.asset.license,rights_ref:actual.asset.rights_ref,recording_origin:actual.asset.attestation.recording_origin});
  }
  expect(resolved.every(a=>a.duration_frames===90)).toBe(true);expect(resolved[1]!.recording_origin).toBe('synthetic');
  const make=(target:string):NativeDraftRequest=>({project_id:f.projectId,target_root:target,protected_roots:[source,blobs,join(f.root,'projects'),join(f.root,'snapshots'),vendorRoot],width:320,height:180,assets:resolved,narration_asset_id:resolved[1]!.asset_id,
   script:{kind:'script',paragraphs:[{paragraph_id:'p1',text:'这是第一条诊断字幕。'},{paragraph_id:'p2',text:'这是第二条诊断字幕。'},{paragraph_id:'p3',text:'这是概念说明字幕。'}]},
   storyboard:{kind:'storyboard',fps:30,shots:[{shot_id:'s1',paragraph_id:'p1',asset_id:resolved[0]!.asset_id,duration_frames:30,caption:'第一条诊断字幕'+punctuation,concept_text:''},{shot_id:'s2',paragraph_id:'p2',asset_id:resolved[0]!.asset_id,duration_frames:30,caption:'第二条诊断字幕'+punctuation,concept_text:''},{shot_id:'s3',paragraph_id:'p3',asset_id:null,duration_frames:30,caption:'概念说明字幕'+punctuation,concept_text:'概念说明'}]}});
  const assembler=new PinnedNativeDraftAssembler(vendorRoot),renderer=new NativeRenderer({upstream_root:vendorRoot});
  const evidence=resolve('docs/execution/A/logs','native-draft-real-render-'+Date.now());await mkdir(evidence,{recursive:true});
  const products:{mode:string;sha256:string;frames:number;audio:boolean;audio_rms:number;crop_sha256:string}[]=[];const crops:Buffer[]=[];
  for(const mode of ['off','on']){
   const attempt=join(f.root,'attempt-'+mode);await mkdir(attempt,{mode:0o700});const draft=await assembler.prepare(make(join(attempt,'native')));
   expect(draft.clip_ids).toEqual(['shot-s1','shot-s2','shot-s3','narration']);
   const stylePath=join(draft.root,'.film/subtitles.json');if(mode==='off'){const style=JSON.parse(await readFile(stylePath,'utf8'));style.on=false;await writeFile(stylePath,JSON.stringify(style)+'\n');}
   const output=join(attempt,'diagnostic.mp4');await renderer.render({project_root:draft.root,native_entry:'film.html',frame_count:draft.frame_count,out_path:output,staging_root:attempt,upstream_root:vendorRoot,width:320,height:180,fps:30,timeout_ms:120000,signal:undefined});
   const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',output],{encoding:'utf8',timeout:30000}));const video=probe.streams.find((s:{codec_type:string})=>s.codec_type==='video');
   expect(Number(video.nb_read_frames)).toBe(90);expect(probe.streams.some((s:{codec_type:string})=>s.codec_type==='audio')).toBe(true);
   ffmpeg(['-xerror','-i',output,'-map','0:v:0','-map','0:a:0','-f','null','-']);
   const pcm=ffmpeg(['-i',output,'-map','0:a:0','-ac','1','-ar','48000','-t','3','-threads','1','-f','f32le','pipe:1']);
   expect(pcm.length).toBeGreaterThan(48000*4*2);let energy=0;
   for(let offset=0;offset+4<=pcm.length;offset+=4){const sample=pcm.readFloatLE(offset);expect(Number.isFinite(sample)).toBe(true);energy+=sample*sample;}
   const rms=Math.sqrt(energy/(pcm.length/4));expect(rms).toBeGreaterThan(0.01);
   const png=join(evidence,mode+'.png');ffmpeg(['-ss','0.5','-i',output,'-frames:v','1','-threads','1',png]);
   const crop=ffmpeg(['-ss','0.5','-i',output,'-frames:v','1','-vf','crop=320:72:0:108','-threads','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);crops.push(crop);
   await cp(output,join(evidence,mode+'.mp4'));await writeFile(join(evidence,mode+'-probe.json'),JSON.stringify(probe,null,2)+'\n');
   products.push({mode,sha256:hash(await readFile(output)),frames:Number(video.nb_read_frames),audio:true,audio_rms:rms,crop_sha256:hash(crop)});
  }
  expect(crops[0]!.length).toBe(crops[1]!.length);const difference=crops[0]!.reduce((sum,v,i)=>sum+Math.abs(v-crops[1]![i]!),0)/crops[0]!.length;
  let foregroundPixels=0;for(let i=0;i<crops[0]!.length;i+=3)if(Math.max(...[0,1,2].map(j=>Math.abs(crops[0]![i+j]!-crops[1]![i+j]!)))>96)foregroundPixels++;
  await writeFile(join(evidence,'observed.json'),JSON.stringify({scope:'three-second synthetic prepared-source diagnostic only; NOT human Chinese voice or committed snapshot/formal Delivery/A',headless:true,muted:true,real_registry:true,native_editable_shots:3,planned_subtitle_timing:'storyboard_plan',recording_origin:'synthetic',products,bottom_region_mean_absolute_difference:difference,high_contrast_caption_pixels:foregroundPixels},null,2)+'\n');
  // Sparse glyphs occupy a small part of this flat-background crop; require strong
  // foreground pixels rather than diluting them across all unchanged background pixels.
  expect(foregroundPixels).toBeGreaterThan(40);expect(products[0]!.sha256).not.toBe(products[1]!.sha256);
  const negatives: string[]=[];
  for(const mode of ['missing-vtt','malformed-style']){
   const attempt=join(f.root,'attempt-'+mode);await mkdir(attempt,{mode:0o700});const draft=await assembler.prepare(make(join(attempt,'native')));
   if(mode==='missing-vtt')await unlink(join(draft.root,draft.subtitles[0]!.path));else await writeFile(join(draft.root,'.film/subtitles.json'),'{invalid style');
   const output=join(attempt,'must-not-exist.mp4');
   await expect(renderer.render({project_root:draft.root,native_entry:'film.html',frame_count:draft.frame_count,out_path:output,staging_root:attempt,upstream_root:vendorRoot,width:320,height:180,fps:30,timeout_ms:120000,signal:undefined})).rejects.toMatchObject({code:'NATIVE_SUBTITLE_PREPARATION_FAILED'});
   await expect(stat(output)).rejects.toMatchObject({code:'ENOENT'});await cp(join(attempt,'render-response.json'),join(evidence,mode+'-response.json'));negatives.push(mode);
  }
  const observed=JSON.parse(await readFile(join(evidence,'observed.json'),'utf8'));observed.negative_rejections=negatives;await writeFile(join(evidence,'observed.json'),JSON.stringify(observed,null,2)+'\n');
  expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);expect(await readFile(join(f.authorRoot,'film.html'))).toEqual(f.authorBytes);
 }finally{await registry?.close();await f.close();}
},240000);
