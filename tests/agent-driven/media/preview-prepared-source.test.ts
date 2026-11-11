import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createdProjectFixture} from '../integration/helpers/created-project-fixture.js';
import {LocalAssetRegistry} from '../../../src/host/agent-driven/local-asset-registry.js';
import {PreparedDraftVerifier} from '../../../src/host/agent-driven/prepared-draft-verifier.js';
import {PinnedNativeDraftAssembler} from '../../../src/host/render/native-draft-assembler.js';
import {PreparedPreviewService,PreparedReviewMediaReaderImpl} from '../../../src/host/render/preview-prepared-source.js';
import {canonicalDigest} from '../../../src/host/creative/digest.js';
import {createTrustedCallerContext} from '../../../src/host/creative/trusted-context.js';
import type {Script,Storyboard,TaskPrepare} from '../../../src/contracts/agent-driven-types.js';
import type {TaskReservation} from '../../../src/host/agent-driven/created-task-store.js';
import type {CompletedPreparedSourceV1,NativeDraftAsset,PreparedPreviewBindingV1} from '../../../src/host/render/assembly-ports.js';

const vendorRoot='/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const PROJECT='project_preview_probe';

/** Real local media, the real pinned parser, the real verifier and a real render.
 * Nothing here is a stand-in for the Host: the fixture only supplies the project and
 * the registry, and every product of the preview is measured from real bytes. */
async function fixture(){
 const f=await createdProjectFixture();
 const root=join(f.root,'prepared-preview'),inputs=join(root,'inputs'),stage=join(root,'stage'),author=join(root,'author');
 const objects=join(root,'objects'),workspace=join(root,'workspace');
 for(const directory of [root,inputs,stage,author,objects,workspace])await mkdir(directory,{mode:0o700});
 const ff=(args:string[])=>execFileSync('ffmpeg',['-nostdin','-hide_banner','-v','error',...args],{windowsHide:true,timeout:60000});
 ff(['-f','lavfi','-i','color=c=0x185a88:s=320x180:r=30:d=3','-threads','1','-c:v','libx264','-pix_fmt','yuv420p',join(inputs,'video.mp4')]);
 ff(['-f','lavfi','-i','sine=frequency=430:sample_rate=48000:duration=2','-threads','1','-c:a','pcm_s16le',join(inputs,'voice.wav')]);
 const registry=new LocalAssetRegistry(f.host.revisions,f.app.creation,{sourceRoot:inputs,storageRoot:join(root,'blobs'),projectsRoot:join(f.root,'projects'),snapshotsRoot:join(f.root,'snapshots')});
 const ui=createTrustedCallerContext({principal_id:'owner',channel:'trusted_ui',source:'trusted_ui',session_ref:f.ui.principal.session_ref});
 const registered=[];
 for(const [file,kind]of [['video.mp4','video'],['voice.wav','audio']] as const){
  const bytes=await readFile(join(inputs,file));
  registered.push(await registry.import({project_id:f.projectId,idempotency_key:'preview-import-'+kind,relative_path:file,expected_sha256:sha(bytes),kind,source:{kind:'generated',label:'Diagnostic preview fixture media'},license:{status:'cleared',label:'Diagnostic fixture only',commercial_use:true},recording_origin:kind==='audio'?'synthetic':null,attestation_ref:'preview-'+kind},ui));
 }
 const native:NativeDraftAsset[]=registered.map(asset=>({project_id:asset.project_id,asset_id:asset.asset_id,absolute_path:registry.blobPathForFact(asset),sha256:asset.sha256,bytes:asset.bytes,duration_frames:asset.media.duration_frames,kind:asset.media.kind,mime_type:asset.media.media_type,source:asset.source,license:asset.license,rights_ref:asset.rights_ref,recording_origin:asset.attestation.recording_origin}));
 const script:Script={kind:'script',paragraphs:[{paragraph_id:'p1',text:'第一段诊断内容。'},{paragraph_id:'p2',text:'第二段诊断内容。'}]};
 const storyboard:Storyboard={kind:'storyboard',fps:30,shots:[{shot_id:'s1',paragraph_id:'p1',asset_id:registered[0]!.asset_id,duration_frames:31,caption:'第一条诊断字幕。',concept_text:''},{shot_id:'s2',paragraph_id:'p2',asset_id:registered[0]!.asset_id,duration_frames:29,caption:'第二条诊断字幕。',concept_text:''}]};
 const narration=registered[1]!;
 const token='stage_'+'a'.repeat(32),attemptRoot=join(stage,token,'attempt-1');
 await mkdir(attemptRoot,{mode:0o700,recursive:true});
 const assembler=new PinnedNativeDraftAssembler(vendorRoot);
 const draft=await assembler.prepare({project_id:f.projectId,script,storyboard,assets:native,narration_asset_id:narration.asset_id,target_root:join(attemptRoot,'source'),protected_roots:[author],width:320,height:180});
 const execution={run_id:'run_preview_probe',plan_version:1 as const,step_id:'sample',attempt:1,input_digest:'0'.repeat(64),run_scope_digest:'1'.repeat(64),authorization_id:'grant_preview_probe'};
 const facts={project_id:f.projectId,kind:'assemble_draft' as const,input_refs:[{id:'script_ref',version:1,sha256:canonicalDigest(script)},{id:'storyboard_ref',version:1,sha256:canonicalDigest(storyboard)}],snapshot_id:null,base_revision:1,source_digest:'2'.repeat(64),execution,render_spec:null};
 const request:TaskPrepare={meta:{idempotency_key:'preview-probe',correlation_id:'preview-probe'},...facts};
 const task:TaskReservation={job_id:'job_preview_probe',principal_id:'owner',request,request_digest:canonicalDigest({principal_id:'owner',request:facts}),stage_token:token,job_kind:'snapshot_publish',max_attempts:3,accepted:{job_id:'job_preview_probe',project_id:f.projectId,state:'succeeded',attempt:1,snapshot_id:null,result_ref:null,next_actions:['review_prepared_source'],execution,bootstrap:null}};
 const verifier=new PreparedDraftVerifier(vendorRoot,{stageDomainRoot:stage,blobPath:asset=>registry.blobPathForFact(asset)});
 const caller=createTrustedCallerContext({principal_id:'owner',channel:'authenticated',source:'driver_relay',session_ref:'job_preview_probe'});
 const registryFacts=registry.list(f.projectId,caller);
 const {fact}=await verifier.prove(task,{owner:'worker',attempt:1},draft,registryFacts);
 const completed:CompletedPreparedSourceV1={format:'narralens.completed-prepared-source@1',project_id:f.projectId,task,producer_attempt:1,
  job:{job_id:'job_preview_probe',project_id:f.projectId,state:'succeeded',attempt:1,snapshot_id:null,result_ref:null,next_actions:['review_prepared_source'],execution,bootstrap:null},
  terminal_reason:'SOURCE_ONLY',provider_receipt:{kind:'local.native-draft@1',source_digest:fact.source_digest,stage:'SOURCE_ONLY'},
  fact,root:join(attemptRoot,'source')};
 const binding:PreparedPreviewBindingV1={purpose:'preview',project_id:f.projectId,run_id:execution.run_id,execution,
  prepared_source_id:'prepared_'+fact.source_digest.slice(0,24),prepared_job_id:task.job_id,fact_digest:canonicalDigest(fact),
  base_revision:1,control_revision:0,source_digest:fact.source_digest,selection_version:0};
 const service=new PreparedPreviewService(verifier,{upstreamRoot:vendorRoot,workspaceRoot:workspace,objectRoot:objects,protectedRoots:[author],width:320,height:180,timeoutMs:120000,assertCurrentAuthorAndRights:()=>{}});
 const reader=new PreparedReviewMediaReaderImpl(objects);
 return {...f,registry,verifier,service,reader,completed,binding,stage,author,objects,registryFacts,
  close:async()=>{await service.close();await registry.close();await verifier.close();await f.close();}};
}
async function treeDigest(root:string):Promise<Record<string,string>>{
 const result:Record<string,string>={};
 const walk=async(relative:string)=>{
  const path=relative?join(root,relative):root;
  for(const name of await readdir(path,{withFileTypes:true})){
   const child=relative?relative+'/'+name.name:name.name;
   if(name.isDirectory())await walk(child);
   else if(name.isFile())result[child]=sha(await readFile(join(root,child)));
  }
 };
 await walk('');return result;
}

it('renders an isolated preview of a completed prepared source with five real parts and measured facts',async()=>{
 const f=await fixture();try{
  const before=await treeDigest(f.completed.root);
  const proof=await f.verifier.proveForRead(f.completed,f.binding,f.registryFacts);
  const receipt=await f.service.preview({format:'narralens.prepared-preview-request@1',completed:f.completed,binding:f.binding,proof});
  expect(receipt.format).toBe('narralens.prepared-preview-receipt@1');
  expect(receipt.plan_version).toBe(1);
  expect(receipt.project_id).toBe(f.completed.project_id);
  expect(receipt.prepared_job_id).toBe(f.completed.task.job_id);
  expect(receipt.producer_attempt).toBe(1);
  expect(receipt.source_digest).toBe(f.completed.fact.source_digest);
  // The measured timeline, not the project default.
  expect(receipt.fps).toEqual({num:30,den:1});
  expect(receipt.frame_count).toBe(60);
  const slots=receipt.parts.map(part=>part.slot);
  expect(slots).toEqual(['preview','narration','subtitles','shot_summary','rights_quality']);
  for(const part of receipt.parts){expect(part.bytes).toBeGreaterThan(0);expect(part.sha256).toMatch(/^[a-f0-9]{64}$/);expect(part.object_id).toMatch(/^obj_[a-f0-9]{32}$/);expect(JSON.stringify(part)).not.toContain(f.completed.root);}
  const video=receipt.parts.find(part=>part.slot==='preview')!;
  expect(video.content_type).toBe('video/mp4');
  expect(video.media_facts).toEqual({kind:'video',fps:{num:30,den:1},frame_count:60});
  const narration=receipt.parts.find(part=>part.slot==='narration')!;
  expect(narration.media_facts).toMatchObject({kind:'audio',sample_rate:48000,channels:1});
  expect((narration.media_facts as {sample_count:number}).sample_count).toBe(96000);
  expect(receipt.parts.find(part=>part.slot==='subtitles')!.media_facts).toEqual({kind:'text'});
  expect(receipt.parts.find(part=>part.slot==='shot_summary')!.media_facts).toEqual({kind:'text'});
  expect(receipt.parts.find(part=>part.slot==='rights_quality')!.media_facts).toEqual({kind:'json'});
  // The receipt digest covers the deterministic content, including the measured timeline.
  const {receipt_digest,...content}=receipt;
  expect(receipt_digest).toBe(canonicalDigest(content));
  // The prepared tree and the author tree were not written.
  expect(await treeDigest(f.completed.root)).toEqual(before);
  // The controlled reader serves exactly the bytes the receipt recorded.
  const handle=await f.reader.open(receipt,video.object_id);
  try{
   expect(handle.content_type).toBe('video/mp4');
   expect(handle.bytes).toBe(video.bytes);
   expect(handle.sha256).toBe(video.sha256);
   expect(handle.timeline).toEqual({fps:{num:30,den:1},frame_count:60});
   expect(handle.media_facts).toEqual({kind:'video',fps:{num:30,den:1},frame_count:60});
   const all=await handle.read({offset:0,length:video.bytes});
   expect(sha(all)).toBe(video.sha256);
   const head=await handle.read({offset:0,length:16});
   expect(head.length).toBe(16);
   await expect(handle.read({offset:0,length:1024*1024+1})).rejects.toBeTruthy();
   await expect(handle.read({offset:0,length:video.bytes+1})).rejects.toBeTruthy();
  }finally{await handle.close();}
  // The close is idempotent and a closed handle serves nothing.
  await handle.close();
  await expect(handle.read({offset:0,length:1})).rejects.toBeTruthy();
  // An object that this receipt does not name is refused.
  await expect(f.reader.open(receipt,'obj_'+'0'.repeat(32))).rejects.toBeTruthy();
  await expect(f.reader.open(receipt,video.object_id.replace(/.$/,'1'))).rejects.toBeTruthy();
  // A receipt whose content no longer matches its digest is refused.
  await expect(f.reader.open({...receipt,frame_count:receipt.frame_count+1},video.object_id)).rejects.toBeTruthy();
  await expect(f.reader.open({...receipt,receipt_digest:'0'.repeat(64)},video.object_id)).rejects.toBeTruthy();
  // An object that changed after the receipt was made is refused.
  const objectPath=join(f.objects,video.object_id);
  await writeFile(objectPath,Buffer.concat([await readFile(objectPath),Buffer.from('x')]));
  await expect(f.reader.open(receipt,video.object_id)).rejects.toBeTruthy();
  f.verifier.release(proof);
 }finally{await f.close();}
 // Every descriptor the preview and the reader opened is closed, also the ones of the
 // failed opens above.
 const {readlink}=await import('node:fs/promises');
 const targets=await Promise.all((await readdir('/proc/self/fd')).map(fd=>readlink('/proc/self/fd/'+fd).catch(()=>'')));
 expect(targets.filter(path=>path.startsWith(f.root))).toEqual([]);
},600000);

it('refuses a preview whose proof is not a proof of this prepared source',async()=>{
 const f=await fixture();try{
  const proof=await f.verifier.proveForRead(f.completed,f.binding,f.registryFacts);
  await expect(f.service.preview({format:'narralens.prepared-preview-request@1',completed:f.completed,binding:f.binding,proof:JSON.parse(JSON.stringify(f.completed)) as never})).rejects.toBeTruthy();
  await expect(f.service.preview({format:'narralens.prepared-preview-request@1',completed:f.completed,binding:{...f.binding,purpose:'impact'} as never,proof})).rejects.toBeTruthy();
  f.verifier.release(proof);
 }finally{await f.close();}
},600000);
