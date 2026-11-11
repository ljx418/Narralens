import {preparedDraftFixture,waitForCompletedDraft,readBinding,registryFacts} from '../integration/helpers/created-draft-fixture.js';
import {it,expect,vi,afterEach} from 'vitest';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile,mkdtemp,rm,rename,symlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {NativeRenderer} from '../../../src/host/render/native-renderer.js';
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
import type {CompletedPreparedSourceV1,NativeDraftAsset,PreparedPreviewBindingV1,PreparedPreviewReceiptV1} from '../../../src/host/render/assembly-ports.js';

const ioFault=vi.hoisted(()=>({cleanupRoot:'',onCleanupClose:undefined as undefined|(()=>void),root:'',readerMode:'' as ''|'read'|'hash-eof',onRead:undefined as undefined|(()=>Promise<void>),beforePublish:undefined as undefined|(()=>Promise<void>),onFifthSync:undefined as undefined|(()=>void),shortWrite:false,zeroWrite:false,shortHits:0,closes:0,publishes:0}));
vi.mock('node:fs/promises',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs/promises')>();
 return {...actual,open:async(path:Parameters<typeof actual.open>[0],flags:Parameters<typeof actual.open>[1],...rest:any[])=>{
  const name=String(path),object=/\/obj_[a-f0-9]{32}$/.test(name);
  if(object&&typeof flags==='number'&&(flags&constants.O_CREAT)!==0&&ioFault.beforePublish){const hook=ioFault.beforePublish;ioFault.beforePublish=undefined;await hook();}
  const handle=await (actual.open as (...args:any[])=>ReturnType<typeof actual.open>)(path,flags,...rest);
  if(name===ioFault.cleanupRoot&&typeof flags==='number'&&(flags&constants.O_DIRECTORY)!==0){
   const close=handle.close.bind(handle);
   handle.close=async()=>{const hook=ioFault.onCleanupClose;ioFault.onCleanupClose=undefined;hook?.();await close();};
  }
  if(object&&typeof flags==='number'&&(flags&constants.O_CREAT)!==0){
   const sync=handle.sync.bind(handle);
   handle.sync=async()=>{ioFault.publishes++;if(ioFault.publishes===5)ioFault.onFifthSync?.();await sync();};
  }
  if(object&&ioFault.root&&name.startsWith(ioFault.root+'/')){
   const read=handle.read.bind(handle) as (...args:any[])=>Promise<any>,close=handle.close.bind(handle);
   handle.close=async()=>{ioFault.closes++;await close();};
   handle.read=(async(...args:any[])=>{
    if(ioFault.readerMode==='read'&&typeof args[3]==='number'&&ioFault.onRead){const hook=ioFault.onRead;ioFault.onRead=undefined;await hook();}
    const result=await read(...args);
    if(ioFault.readerMode==='hash-eof'&&args[3]===null&&result.bytesRead===0&&ioFault.onRead){const hook=ioFault.onRead;ioFault.onRead=undefined;await hook();}
    return result;
   }) as typeof handle.read;
  }
  if(name.endsWith('/film.html')&&typeof flags==='number'&&(flags&constants.O_CREAT)!==0&&(ioFault.shortWrite||ioFault.zeroWrite)){
   const write=handle.write.bind(handle) as (...args:any[])=>Promise<any>;
   handle.write=(async(buffer:Buffer,offset:number,length:number,position?:number|null)=>{
    ioFault.shortHits++;
    if(ioFault.zeroWrite)return {bytesWritten:0,buffer};
    return write(buffer,offset,Math.min(length,7),position??null);
   }) as typeof handle.write;
  }
  return handle;
 }};
});
afterEach(()=>{Object.assign(ioFault,{cleanupRoot:'',onCleanupClose:undefined,root:'',readerMode:'',onRead:undefined,beforePublish:undefined,onFifthSync:undefined,shortWrite:false,zeroWrite:false,shortHits:0,closes:0,publishes:0});vi.restoreAllMocks();});

const vendorRoot='/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const PROJECT='project_preview_probe';

/** Actual durable SOURCE_ONLY worker/metadata/proof, registered diagnostic media and
 * real pinned render. Workflow eligibility and adoption authority remain explicit test
 * ports in the shared fixture; this is not production Run/approval or A human evidence. */
async function fixture(){
 const f=await preparedDraftFixture();
 let service:PreparedPreviewService|undefined;
 try{
  f.worker.start();
  const completed=await waitForCompletedDraft(f);
  const binding={...readBinding(completed,'preview'),purpose:'preview' as const};
  const objects=join(f.root,'preview-objects'),workspace=join(f.root,'preview-workspace');
  for(const directory of [objects,workspace])await mkdir(directory,{mode:0o700});
  const protectedRoots=[f.authorRoot,f.taskRoot,...f.registry.protectedRoots()];
  const assertCurrentAuthorAndRights=()=>{
   expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
   expect(registryFacts(f)).toEqual(registryFactsAtPreparation);
  };
  const registryFactsAtPreparation=registryFacts(f);
  service=new PreparedPreviewService(f.verifier,{upstreamRoot:vendorRoot,workspaceRoot:workspace,objectRoot:objects,protectedRoots,width:320,height:180,timeoutMs:120000,assertCurrentAuthorAndRights});
  const reader=new PreparedReviewMediaReaderImpl(objects);
  return {...f,service,reader,completed,binding,stage:f.taskRoot,author:f.authorRoot,objects,workspace,registryFacts:registryFactsAtPreparation,
   close:async()=>{await service!.close();await f.close();}};
 }catch(error){await service?.close();await f.close();throw error;}
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
  expect(receipt.frame_count).toBe(90);
  const slots=receipt.parts.map(part=>part.slot);
  expect(slots).toEqual(['preview','narration','subtitles','shot_summary','rights_quality']);
  for(const part of receipt.parts){expect(part.bytes).toBeGreaterThan(0);expect(part.sha256).toMatch(/^[a-f0-9]{64}$/);expect(part.object_id).toMatch(/^obj_[a-f0-9]{32}$/);expect(JSON.stringify(part)).not.toContain(f.completed.root);}
  const video=receipt.parts.find(part=>part.slot==='preview')!;
  expect(video.content_type).toBe('video/mp4');
  expect(video.media_facts).toEqual({kind:'video',fps:{num:30,den:1},frame_count:90});
  const narration=receipt.parts.find(part=>part.slot==='narration')!;
  expect(narration.media_facts).toMatchObject({kind:'audio',sample_rate:48000,channels:1});
  expect((narration.media_facts as {sample_count:number}).sample_count).toBe(144000);
  expect(receipt.parts.find(part=>part.slot==='subtitles')!.media_facts).toEqual({kind:'text'});
  expect(receipt.parts.find(part=>part.slot==='subtitles')!.content_type).toBe('text/vtt; charset=utf-8');
  expect(receipt.parts.find(part=>part.slot==='shot_summary')!.media_facts).toEqual({kind:'json'});
  expect(receipt.parts.find(part=>part.slot==='shot_summary')!.content_type).toBe('application/json; charset=utf-8');
  expect(receipt.parts.find(part=>part.slot==='rights_quality')!.media_facts).toEqual({kind:'json'});
  expect(receipt.parts.find(part=>part.slot==='rights_quality')!.content_type).toBe('application/json; charset=utf-8');
  // The quality product records measured decoded time units, not fps as a time delta.
  const quality=receipt.parts.find(part=>part.slot==='rights_quality')!;
  const qualityHandle=await f.reader.open(receipt,quality.object_id);
  try{
   const bytes=await qualityHandle.read({offset:0,length:quality.bytes});
   const value=JSON.parse(Buffer.from(bytes).toString('utf8'));
   expect(value.quality.measured_video.constant_frame_step).toBeCloseTo(1/30,12);
   expect(value.quality.measured_video.nb_read_frames).toBe(90);
  }finally{await qualityHandle.close();}
  // Retain independently hashable diagnostic products before the tamper tests below
  // remove the fixture. These are a real three-second render, never A human evidence.
  const evidence=join('docs/parallel/lane-media/A-R1-20261111/evidence','prepared-preview-real-'+Date.now());
  await mkdir(evidence,{recursive:true});
  const names={preview:'preview.mp4',narration:'narration.wav',subtitles:'subtitles.vtt',shot_summary:'shot-summary.json',rights_quality:'rights-quality.json'} as const;
  const artifacts=[];
  for(const part of receipt.parts){
   const opened=await f.reader.open(receipt,part.object_id);
   try{
    const chunks:Buffer[]=[];
    for(let offset=0;offset<part.bytes;offset+=1024*1024)
     chunks.push(Buffer.from(await opened.read({offset,length:Math.min(1024*1024,part.bytes-offset)})));
    const bytes=Buffer.concat(chunks);
    expect(bytes.length).toBe(part.bytes);expect(sha(bytes)).toBe(part.sha256);
    await writeFile(join(evidence,names[part.slot]),bytes,{mode:0o600});
    artifacts.push({file:names[part.slot],slot:part.slot,bytes:bytes.length,sha256:sha(bytes),content_type:part.content_type});
   }finally{await opened.close();}
  }
  await writeFile(join(evidence,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  await writeFile(join(evidence,'observed.json'),JSON.stringify({scope:'synthetic diagnostic3seconds, real completed worker+pinned render/decode; NOT human voice, production Run admission or A acceptance',receipt_digest:receipt.receipt_digest,artifacts,prepared_source_unchanged:true,active_commit_unchanged:true},null,2)+'\n');
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
   expect(handle.timeline).toEqual({fps:{num:30,den:1},frame_count:90});
   expect(handle.media_facts).toEqual({kind:'video',fps:{num:30,den:1},frame_count:90});
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

it('refuses the boundaries a prepared preview must not cross',async()=>{
 const f=await fixture();try{
  const proof=await f.verifier.proveForRead(f.completed,f.binding,f.registryFacts);
  // A binding that is not the current author baseline of the preparation.
  await expect(f.service.preview({format:'narralens.prepared-preview-request@1',completed:f.completed,binding:{...f.binding,source_digest:'9'.repeat(64)},proof})).rejects.toBeTruthy();
  // A completed source whose root was changed after the proof was made.
  await expect(f.service.preview({format:'narralens.prepared-preview-request@1',completed:{...f.completed,root:join(f.stage,'other')},binding:f.binding,proof})).rejects.toBeTruthy();
  // A cancelled preview publishes nothing.
  const controller=new AbortController();controller.abort();
  await expect(f.service.preview({format:'narralens.prepared-preview-request@1',completed:f.completed,binding:f.binding,proof,signal:controller.signal})).rejects.toBeTruthy();
  expect(await readdir(f.objects)).toEqual([]);
  // A closed service publishes nothing.
  await f.service.close();
  await expect(f.service.preview({format:'narralens.prepared-preview-request@1',completed:f.completed,binding:f.binding,proof})).rejects.toBeTruthy();
  f.verifier.release(proof);
 }finally{await f.close();}
 // A workspace or object domain that overlaps a protected source domain is refused.
 expect(()=>new PreparedPreviewService(f.verifier,{upstreamRoot:vendorRoot,workspaceRoot:f.author,objectRoot:f.objects,protectedRoots:[f.author],width:320,height:180,timeoutMs:1000,assertCurrentAuthorAndRights:()=>{}})).toThrow();
 expect(()=>new PreparedPreviewService(f.verifier,{upstreamRoot:vendorRoot,workspaceRoot:f.workspace,objectRoot:f.author,protectedRoots:[f.author],width:320,height:180,timeoutMs:1000,assertCurrentAuthorAndRights:()=>{}})).toThrow();
},600000);

it('refuses a part whose content type or media facts do not belong to its slot',async()=>{
 const f=await fixture();try{
  const proof=await f.verifier.proveForRead(f.completed,f.binding,f.registryFacts);
  const receipt=await f.service.preview({format:'narralens.prepared-preview-request@1',completed:f.completed,binding:f.binding,proof});
  const video=receipt.parts.find(part=>part.slot==='preview')!;
  const retype=(content_type:string,media_facts:unknown):PreparedPreviewReceiptV1=>{
   const parts=receipt.parts.map(part=>part.slot==='preview'?{...part,content_type,media_facts}:part);
   const content={...receipt,parts};const {receipt_digest:_digest,...rest}=content;
   return {...rest,receipt_digest:canonicalDigest(rest)} as PreparedPreviewReceiptV1;
  };
  // The digest is recomputed, so only the slot rule can refuse these.
  await expect(f.reader.open(retype('text/plain; charset=utf-8',video.media_facts),video.object_id)).rejects.toBeTruthy();
  await expect(f.reader.open(retype(video.content_type,{kind:'text'}),video.object_id)).rejects.toBeTruthy();
  f.verifier.release(proof);
 }finally{await f.close();}
},600000);


it.each(['read','hash-eof'] as const)('refuses a same-inode rewrite during %s and closes its verified descriptor once',async mode=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-review-reader-race-'));
 try{
  const evidence='docs/parallel/lane-media/A-R1-20261111/evidence/prepared-preview-real-1794409475326';
  const receipt=JSON.parse(await readFile(join(evidence,'receipt.json'),'utf8')) as PreparedPreviewReceiptV1;
  const part=receipt.parts.find(p=>p.slot==='preview')!,path=join(root,part.object_id),bytes=await readFile(join(evidence,'preview.mp4'));
  await writeFile(path,bytes,{mode:0o600});
  ioFault.root=root;ioFault.readerMode=mode;
  ioFault.onRead=async()=>{const changed=Buffer.from(bytes);changed[0]=changed[0]!^1;await writeFile(path,changed);};
  const reader=new PreparedReviewMediaReaderImpl(root);
  if(mode==='hash-eof'){
   let unexpected:Awaited<ReturnType<PreparedReviewMediaReaderImpl['open']>>|undefined;
   try{await expect(reader.open(receipt,part.object_id).then(handle=>{unexpected=handle;return 'unexpected verified handle';})).rejects.toBeTruthy();}
   finally{await unexpected?.close();}
  }
  else{
   const handle=await reader.open(receipt,part.object_id);
   try{await expect(handle.read({offset:0,length:bytes.length}).then(()=>'unexpected changed bytes')).rejects.toBeTruthy();}
   finally{await handle.close();}
  }
  expect(ioFault.onRead).toBeUndefined();expect(ioFault.closes).toBe(1);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('cannot redirect object publication into author source by replacing the object directory at open',async()=>{
 const f=await fixture();try{
  const authorBefore=await treeDigest(f.authorRoot);
  const held=join(f.root,'objects-held');
  ioFault.beforePublish=async()=>{await rename(f.objects,held);await symlink(f.authorRoot,f.objects,'dir');};
  const proof=await f.verifier.proveForRead(f.completed,f.binding,f.registryFacts);
  try{await expect(f.service.preview({format:'narralens.prepared-preview-request@1',completed:f.completed,binding:f.binding,proof})).rejects.toBeTruthy();}
  finally{f.verifier.release(proof);}
  expect(ioFault.beforePublish).toBeUndefined();
  expect(await treeDigest(f.authorRoot)).toEqual(authorBefore);
  expect(await readdir(held)).toEqual([]);
 }finally{await f.close();}
},600000);

it.each(['partial','zero'] as const)('handles a %s target write without rendering different copied bytes',async mode=>{
 const f=await fixture();let observed:string|undefined;
 try{
  const expected=f.completed.fact.files.find(file=>file.relative_path==='film.html')!.sha256;
  vi.spyOn(NativeRenderer.prototype,'render').mockImplementation(async request=>{
   observed=sha(await readFile(join(request.project_root,'film.html')));
   throw new Error('stop after actual copy inspection; no renderer stand-in acceptance');
  });
  ioFault.shortWrite=mode==='partial';ioFault.zeroWrite=mode==='zero';
  const proof=await f.verifier.proveForRead(f.completed,f.binding,f.registryFacts);
  try{await expect(f.service.preview({format:'narralens.prepared-preview-request@1',completed:f.completed,binding:f.binding,proof})).rejects.toBeTruthy();}
  finally{f.verifier.release(proof);}
  expect(ioFault.shortHits).toBeGreaterThan(0);
  if(mode==='partial')expect(observed).toBe(expected);else expect(observed).toBeUndefined();
 }finally{await f.close();}
},600000);

it.each(['cancel','close'] as const)('does not expose a receipt after %s at the fifth publication',async mode=>{
 const f=await fixture(),controller=new AbortController();let closing:Promise<void>|undefined;
 try{
  ioFault.publishes=0;
  ioFault.onFifthSync=()=>{if(mode==='cancel')controller.abort();else closing=f.service.close();};
  const proof=await f.verifier.proveForRead(f.completed,f.binding,f.registryFacts);
  try{await expect(f.service.preview({format:'narralens.prepared-preview-request@1',completed:f.completed,binding:f.binding,proof,signal:controller.signal})).rejects.toBeTruthy();}
  finally{f.verifier.release(proof);}
  await closing;
  expect(ioFault.publishes).toBe(5);
  expect(await readdir(f.objects)).toEqual([]);
 }finally{await f.close();}
},600000);

it.each(['cancel','close','revoke'] as const)('does not expose a receipt after %s during awaited copy cleanup',async mode=>{
 const f=await fixture(),controller=new AbortController();let closing:Promise<void>|undefined;
 try{
  const proof=await f.verifier.proveForRead(f.completed,f.binding,f.registryFacts);
  ioFault.cleanupRoot=f.completed.root;
  let hit=false;
  ioFault.onCleanupClose=()=>{hit=true;if(mode==='cancel')controller.abort();else if(mode==='close')closing=f.service.close();else f.verifier.release(proof);};
  try{await expect(f.service.preview({format:'narralens.prepared-preview-request@1',completed:f.completed,binding:f.binding,proof,signal:controller.signal})).rejects.toBeTruthy();}
  finally{f.verifier.release(proof);}
  await closing;
  expect(hit).toBe(true);
  expect(ioFault.publishes).toBe(5);
  expect(await readdir(f.objects)).toEqual([]);
 }finally{await f.close();}
},600000);
