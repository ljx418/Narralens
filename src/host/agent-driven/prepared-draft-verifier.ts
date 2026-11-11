import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {constants,openSync,closeSync,fstatSync,lstatSync,realpathSync,readdirSync,readSync,type BigIntStats} from 'node:fs';
import {resolve,dirname,basename,join,sep,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonicalDigest} from '../creative/digest.js';
import {ProductError} from '../creative/trusted-context.js';
import {asHostResourceError} from '../api-error.js';
import {computeSourceDigest} from '../engine/source-digest-v1.js';
import {OPENFILM_UPSTREAM_SHA} from '../engine/engine-binding-store.js';
import {assertSafeRelativePath} from '../render/snapshot-copy.js';
import {planNativeDraft,draftVtt,frameSeconds,type DraftPlan} from '../render/native-draft-plan.js';
import {verifyRenderPin} from '../render/upstream-pin.js';
import type {StagedNativeDraft,NativeDraftAsset,CompletedPreparedSourceV1,PreparedReadBindingV1,PreparedAdoptionBindingV1,PreparedReadProofV1,PreparedAdoptionProofV1} from '../render/assembly-ports.js';
import type {LocalAsset} from './local-asset-registry.js';
import {PublicationCleanupError} from './publication-cleanup.js';
import type {TaskReservation,TaskLease,PreparedTaskFact} from './created-task-store.js';

const META='prepared-native.json';
const STYLE='packages/openfilm/studio/server/film-subtitle.mjs';
const STYLE_SHA='be4b1852bc254ff597e43694a732044ef51dd43a78df13735c2ff023957687dd';
const HASH=/^[a-f0-9]{64}$/;
const reject=()=>new ProductError('REVISION_CONFLICT','Prepared native source is stale or unverified');
function check(value:unknown):asserts value {if(!value)throw reject();}
function failure(error:unknown):never {
 if(error instanceof PublicationCleanupError)throw error;
 if(error&&typeof error==='object'){
  const resource=asHostResourceError(error);if(resource)throw resource;
  if(error instanceof ProductError)throw new ProductError(error.code,'Prepared native source verification could not complete');
  if('code'in error&&error.code==='HOST_RESOURCE_EXHAUSTED')throw new ProductError('HOST_RESOURCE_EXHAUSTED','Prepared native source verification could not complete');
 }
 throw reject();
}
function obj(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;}
function finiteJson(value:unknown):void {
 if(value===null||typeof value==='string'||typeof value==='boolean')return;
 if(typeof value==='number'){check(Number.isFinite(value));return;}
 if(Array.isArray(value)){value.forEach(finiteJson);return;}
 check(obj(value));Object.values(value).forEach(finiteJson);
}
/** Native seconds/style values legitimately contain fractions. Never feed them to
 * CP's restricted integer-only canonicalDigest; those digest domains stay unchanged. */
const same=(a:unknown,b:unknown)=>{finiteJson(a);finiteJson(b);return isDeepStrictEqual(a,b);};
const identity=(s:BigIntStats)=>`${s.dev}:${s.ino}`;
const dirIdentity=(s:BigIntStats)=>`${identity(s)}:${s.mode}:${s.uid}`;
const fingerprint=(s:BigIntStats)=>`${dirIdentity(s)}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
const at=(fd:number,name='')=>`/proc/self/fd/${fd}${name?'/'+name:''}`;
const inside=(root:string,path:string)=>path.startsWith(root+sep);
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function absolute(path:string):string {check(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&!/[\u0000-\u001f\u007f]/u.test(path));return path;}
function relative(path:string):string {check(typeof path==='string'&&!/[\u0000-\u001f\u007f:]/u.test(path));try{check(assertSafeRelativePath(path)===path);}catch{throw reject();}return path;}
function freeze<T>(value:T):T {if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
interface Dir {path:string;fd:number;stat:BigIntStats}
interface File {path:string;fd:number;stat:BigIntStats;sha256:string;bytes:number}
interface RecordProof {
 taskDigest:string;leaseDigest:string;factDigest:string;root:string;registry:readonly LocalAsset[];
 dirs:Map<string,Dir>;files:Map<string,File>;blobs:Map<string,File>;fds:Set<number>;closed:boolean;
 /** Which purpose this record was opened for. A read proof is never an adoption proof. */
 purpose:'lease'|'read'|'adoption';
 /** The digest of the complete binding this record was opened with. */
 bindingDigest:string;
 /** The attempt that produced the bytes, for a completed-source proof. Zero otherwise. */
 producerAttempt:number;
}
interface NativeFormat {readFilmFile:(text:string)=>{doc:unknown;problems:readonly unknown[]};style:unknown;}
export interface PreparedDraftVerifierOptions {
 /** Fixed Host-selected existing private stage domain; never a request field. */
 readonly stageDomainRoot:string;
 /** Actual registry resolver, equality/anchor checked by MAIN. No URL/path DTO. */
 readonly blobPath:(asset:LocalAsset)=>string;
}
/** Read-only source proof. Current job/lease/Run/base gates remain TaskStore/MAIN.
 * Descriptors have explicit release/close ownership; GC is never relied on. */
export class PreparedDraftVerifier {
 readonly #domain:string;
 readonly #blobPath:(asset:LocalAsset)=>string;
 readonly #proofs=new WeakMap<object,RecordProof>();
 readonly #records=new Set<RecordProof>();
 readonly #cleanupFaults=new Set<unknown>();
 readonly #pending=new Set<Promise<unknown>>();
 #closing:Promise<void>|undefined;
 #closed=false;
 constructor(private readonly vendorRoot:string,options:PreparedDraftVerifierOptions){
  check(process.platform==='linux'&&typeof process.getuid==='function'&&options&&typeof options.blobPath==='function');
  this.#domain=absolute(options.stageDomainRoot);this.#blobPath=options.blobPath;
 }
 #bindingTask(task:TaskReservation):void {
  const {meta:_meta,...request}=task.request;
  check(task.request.kind==='assemble_draft'&&task.request_digest===canonicalDigest({principal_id:task.principal_id,request}));
  check(task.accepted.job_id===task.job_id&&task.accepted.project_id===task.request.project_id&&same(task.accepted.execution,task.request.execution));
  check(/^stage_[A-Za-z0-9_-]{32}$/.test(task.stage_token));
 }
 #bindingLease(lease:TaskLease):void {
  check(typeof lease.owner==='string'&&lease.owner.length>0&&Number.isSafeInteger(lease.attempt)&&lease.attempt>=1);
 }
 #binding(task:TaskReservation,lease:TaskLease):void {this.#bindingTask(task);this.#bindingLease(lease);}
 #dir(record:RecordProof,path:string):Dir {
  absolute(path);const known=record.dirs.get(path);if(known)return known;
  const parent=path==='/'?null:this.#dir(record,dirname(path));const before=lstatSync(path,{bigint:true});
  check(before.isDirectory()&&!before.isSymbolicLink());
  const fd=openSync(parent?at(parent.fd,basename(path)):'/',constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);record.fds.add(fd);
  const stat=fstatSync(fd,{bigint:true});check(stat.isDirectory()&&identity(before)===identity(stat)&&realpathSync(at(fd))===path);
  if(path===this.#domain||inside(this.#domain,path))check(stat.uid===BigInt(process.getuid!())&&(stat.mode&0o077n)===0n);
  const value={path,fd,stat};record.dirs.set(path,value);return value;
 }
 #file(record:RecordProof,path:string,privateFile=false):File {
  absolute(path);const parent=this.#dir(record,dirname(path));
  const fd=openSync(at(parent.fd,basename(path)),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);record.fds.add(fd);
  const stat=fstatSync(fd,{bigint:true});check(stat.isFile()&&stat.size>=0n&&stat.size<=BigInt(Number.MAX_SAFE_INTEGER));
  if(privateFile)check(stat.uid===BigInt(process.getuid!())&&(stat.mode&0o077n)===0n&&stat.nlink===1n);
  const named=lstatSync(at(parent.fd,basename(path)),{bigint:true});check(fingerprint(named)===fingerprint(stat)&&realpathSync(at(fd))===path);
  const result={path,fd,stat,bytes:Number(stat.size),sha256:''};result.sha256=this.#hash(result);return result;
 }
 #hash(file:File):string {
  check(fingerprint(fstatSync(file.fd,{bigint:true}))===fingerprint(file.stat));
  const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let pos=0;
  for(;;){const count=readSync(file.fd,buffer,0,buffer.length,pos);if(!count)break;pos+=count;check(pos<=file.bytes);hash.update(buffer.subarray(0,count));}
  check(pos===file.bytes&&fingerprint(fstatSync(file.fd,{bigint:true}))===fingerprint(file.stat));return hash.digest('hex');
 }
 #bytes(record:RecordProof,path:string):Buffer {
  const file=record.files.get(path);check(file);const bytes=Buffer.alloc(file.bytes);let pos=0;
  while(pos<bytes.length){const count=readSync(file.fd,bytes,pos,bytes.length-pos,pos);check(count>0);pos+=count;}
  check(sha(bytes)===file.sha256&&fingerprint(fstatSync(file.fd,{bigint:true}))===fingerprint(file.stat));return bytes;
 }
 #json(record:RecordProof,path:string):unknown {try{return JSON.parse(this.#bytes(record,path).toString('utf8'));}catch(error){failure(error);}}
 #tree(record:RecordProof):void {
  const seen=new Set<string>();
  const walk=(path:string,prefix:string)=>{const directory=this.#dir(record,path);for(const name of readdirSync(at(directory.fd))){
   const rel=relative(prefix?prefix+'/'+name:name),full=join(record.root,rel),s=lstatSync(at(directory.fd,name),{bigint:true});
   check(!s.isSymbolicLink());
   if(s.isDirectory()){check([...record.files.keys()].some(file=>file.startsWith(rel+'/')));walk(full,rel);}
   else{check(s.isFile()&&record.files.has(rel));seen.add(rel);}
  }};
  walk(record.root,'');check(seen.size===record.files.size);
 }
 #current(record:RecordProof,hashFiles:boolean):void {
  check(!this.#closed&&!record.closed&&this.#records.has(record));
  for(const d of record.dirs.values()){
   const named=lstatSync(d.path,{bigint:true});check(named.isDirectory()&&!named.isSymbolicLink()&&dirIdentity(named)===dirIdentity(d.stat)&&dirIdentity(fstatSync(d.fd,{bigint:true}))===dirIdentity(d.stat)&&realpathSync(d.path)===d.path&&realpathSync(at(d.fd))===d.path);
  }
  for(const file of [...record.files.values(),...record.blobs.values()]){
   const parent=record.dirs.get(dirname(file.path));check(parent);const named=lstatSync(at(parent.fd,basename(file.path)),{bigint:true});
   check(named.isFile()&&!named.isSymbolicLink()&&fingerprint(named)===fingerprint(file.stat)&&fingerprint(fstatSync(file.fd,{bigint:true}))===fingerprint(file.stat)&&realpathSync(at(file.fd))===file.path);
   if(hashFiles)check(this.#hash(file)===file.sha256);
  }
  for(const asset of record.registry){const path=this.#blobPath(asset);check(typeof path==='string'&&path===record.blobs.get(asset.asset_id)?.path);}
  this.#tree(record);
 }
 #dispose(record:RecordProof):void {
  if(record.closed)return;record.closed=true;this.#records.delete(record);const failures:unknown[]=[];
  for(const fd of [...record.fds].reverse()){record.fds.delete(fd);try{closeSync(fd);}catch(error){failures.push(error);}}
  if(failures.length){for(const error of failures)this.#cleanupFaults.add(error);throw new PublicationCleanupError(failures);}
 }
 release(proof:object):void {const record=this.#proofs.get(proof);if(!record)return;this.#proofs.delete(proof);this.#dispose(record);}
 close():Promise<void> {
  this.#closed=true;
  return this.#closing??=(async()=>{
   const failures=new Set<unknown>(this.#cleanupFaults);
   const collect=(error:unknown)=>{if(error instanceof PublicationCleanupError)for(const cause of error.errors)failures.add(cause);else failures.add(error);};
   for(const record of [...this.#records])try{this.#dispose(record);}catch(error){collect(error);}
   const pending=await Promise.allSettled([...this.#pending]);
   for(const result of pending)if(result.status==='rejected'&&result.reason instanceof PublicationCleanupError)collect(result.reason);
   for(const record of [...this.#records])try{this.#dispose(record);}catch(error){collect(error);}
   for(const error of this.#cleanupFaults)failures.add(error);
   if(failures.size)throw new PublicationCleanupError([...failures]);
  })();
 }
 async #format():Promise<NativeFormat>{
  const pin=await verifyRenderPin(this.vendorRoot);check(!this.#closed);if(!pin.ok)throw new ProductError('CAPABILITY_UNAVAILABLE','Pinned native format is unavailable');
  const fd=openSync(resolve(pin.upstream_root,STYLE),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const stat=fstatSync(fd,{bigint:true});check(stat.isFile());const file:File={path:resolve(pin.upstream_root,STYLE),fd,stat,bytes:Number(stat.size),sha256:STYLE_SHA};check(this.#hash(file)===STYLE_SHA);}finally{closeSync(fd);}
  const film:unknown=await import(pathToFileURL(resolve(pin.upstream_root,'packages/openfilm/src/film-doc.mjs')).href);
  const style:unknown=await import(pathToFileURL(resolve(pin.upstream_root,STYLE)).href);
  check(film&&typeof film==='object'&&'readFilmFile'in film&&typeof film.readFilmFile==='function'&&style&&typeof style==='object'&&'FILM_SUBTITLE_DEFAULT'in style&&obj(style.FILM_SUBTITLE_DEFAULT));
  return {readFilmFile:film.readFilmFile as NativeFormat['readFilmFile'],style:structuredClone(style.FILM_SUBTITLE_DEFAULT)};
 }
 #registry(task:TaskReservation,registry:readonly LocalAsset[]):readonly LocalAsset[]{
  const copy=structuredClone([...registry]).sort((a,b)=>a.asset_id<b.asset_id?-1:a.asset_id>b.asset_id?1:0),ids=new Set<string>();
  for(const a of copy){
   check(obj(a)&&Object.keys(a).sort().join(',')==='asset_id,attestation,bytes,license,media,project_id,registration_digest,rights_ref,sha256,source');
   check(typeof a.asset_id==='string'&&typeof a.registration_digest==='string'&&HASH.test(a.registration_digest)&&obj(a.media)&&obj(a.source)&&obj(a.license)&&obj(a.attestation));
   check(a.project_id===task.request.project_id&&!ids.has(a.asset_id)&&typeof a.sha256==='string'&&HASH.test(a.sha256)&&Number.isSafeInteger(a.bytes)&&a.bytes>0&&a.license.status==='cleared'&&a.license.commercial_use===true);
   const core={project_id:a.project_id,sha256:a.sha256,bytes:a.bytes,media:a.media,source:a.source,license:a.license,recording_origin:a.attestation.recording_origin,attestation_ref:a.attestation.source_message_ref,operator_id:a.attestation.operator_id};
   check(canonicalDigest(core)===a.registration_digest&&a.asset_id==='asset_'+a.registration_digest.slice(0,56)&&a.rights_ref==='rights_'+a.registration_digest.slice(0,56));ids.add(a.asset_id);
  }
  return freeze(copy);
 }
 #plan(record:RecordProof,task:TaskReservation,draft:StagedNativeDraft,format:NativeFormat):DraftPlan {
  const raw=this.#json(record,'draft-plan.json');check(obj(raw)&&Array.isArray(raw.assets));
  const registry=new Map(record.registry.map(asset=>[asset.asset_id,asset]));const assets:NativeDraftAsset[]=raw.assets.map(value=>{
   check(obj(value)&&typeof value.asset_id==='string');const a=registry.get(value.asset_id);check(a);const blob=record.blobs.get(a.asset_id);check(blob);
   return {project_id:a.project_id,asset_id:a.asset_id,absolute_path:blob.path,sha256:a.sha256,bytes:a.bytes,duration_frames:a.media.duration_frames,kind:a.media.kind,mime_type:a.media.media_type,source:a.source,license:a.license,rights_ref:a.rights_ref,recording_origin:a.attestation.recording_origin};
  });
  check(assets.length===record.registry.length);
  const plan=planNativeDraft({project_id:task.request.project_id,script:raw.script as DraftPlan['script'],storyboard:raw.storyboard as DraftPlan['storyboard'],assets,narration_asset_id:raw.narration_asset_id as string|null,width:raw.width as number,height:raw.height as number,target_root:record.root,protected_roots:[this.#domain]});
  check(same(raw,JSON.parse(plan.factJson))&&draft.plan_digest===plan.digest&&draft.frame_count===plan.totalFrames&&same(draft.fps,{num:30,den:1}));
  check(task.request.input_refs.some(ref=>ref.sha256===canonicalDigest(plan.script))&&task.request.input_refs.some(ref=>ref.sha256===canonicalDigest(plan.storyboard)));
  check(same(this.#json(record,'.film/settings.json'),{fps:30})&&same(this.#json(record,'.film/subtitles.json'),format.style));
  const expectedAssets=draft.assets.map(value=>{
   const a=registry.get(value.asset_id);check(a);relative(value.path);
   const file=record.files.get(value.path);check(file&&file.sha256===a.sha256&&file.bytes===a.bytes);
   return {asset_id:a.asset_id,path:value.path,sha256:a.sha256,bytes:a.bytes,duration_frames:a.media.duration_frames,media_type:a.media.media_type,source:a.source,license:a.license,rights_ref:a.rights_ref,recording_origin:a.attestation.recording_origin};
  });
  check(expectedAssets.length===registry.size&&new Set(expectedAssets.map(a=>a.asset_id)).size===registry.size&&same(draft.assets,expectedAssets));
  check(same(this.#json(record,'rights.json'),{format:'narralens.staged-rights@1',project_id:task.request.project_id,assets:expectedAssets}));
  const expectedSubtitles=plan.narration&&plan.storyboard.shots.some(s=>s.caption)?[{subtitle_id:'storyboard-captions',path:draft.assets.find(a=>a.asset_id===plan.narration!.asset_id)!.path.replace(/\.[a-z0-9]+$/,'.vtt')}]:[];
  check(same(draft.subtitles,expectedSubtitles));for(const subtitle of draft.subtitles)check(this.#bytes(record,subtitle.path).equals(Buffer.from(draftVtt(plan),'utf8')));
  const parsed=format.readFilmFile(this.#bytes(record,'film.html').toString('utf8'));check(parsed.problems.length===0&&obj(parsed.doc)&&obj(parsed.doc.stage)&&parsed.doc.stage.w===plan.width&&parsed.doc.stage.h===plan.height&&Array.isArray(parsed.doc.tracks));
  const clips=parsed.doc.tracks.flatMap(track=>{check(obj(track)&&Array.isArray(track.clips));return track.clips;});
  const ids=clips.map(clip=>{check(obj(clip)&&typeof clip.id==='string');return clip.id;});
  const expectedIds=plan.storyboard.shots.flatMap(shot=>[...['shot-'+shot.shot_id],...(shot.asset_id!==null&&shot.concept_text?['concept-'+shot.shot_id]:[])]).concat(plan.narration?['narration']:[]);
  check(new Set(ids).size===ids.length&&ids.length===expectedIds.length&&expectedIds.every(id=>ids.includes(id))&&same(ids,draft.clip_ids));
  // Feed the real producer's seconds through the SAME pinned parser normalization.
  // film-doc readClip currently toMs-normalizes raw numbers; do not hand-round or
  // compare raw frameSeconds directly to the parsed native state.
  const timing=(start:number,length:number)=>{
   const probe=format.readFilmFile(`<!doctype html><html><head><meta name="viewport" content="width=${plan.width}, height=${plan.height}"></head><body><section><iframe id="timing" src="timing.html#t=0,${frameSeconds(length)}" at="${frameSeconds(start)}"></iframe></section></body></html>`);
   check(probe.problems.length===0&&obj(probe.doc)&&Array.isArray(probe.doc.tracks));
   const track=probe.doc.tracks[0];check(obj(track)&&Array.isArray(track.clips)&&track.clips.length===1);const clip=track.clips[0];check(obj(clip));return clip;
  };
  let frame=0;
  for(const [index,shot]of plan.storyboard.shots.entries()){
   const clip=clips.find(c=>obj(c)&&c.id==='shot-'+shot.shot_id);check(obj(clip));
   const path=shot.asset_id===null?`scenes/${String(index+1).padStart(3,'0')}.html`:draft.assets.find(a=>a.asset_id===shot.asset_id)!.path;
   const expectedTiming=timing(frame,shot.duration_frames);
   check(clip.src===path&&clip.at===expectedTiming.at&&same(clip.time,expectedTiming.time)&&clip.speed===undefined);
   if(shot.asset_id!==null)check(plan.narration?clip.volume===0:clip.volume===undefined);
   if(shot.asset_id!==null&&shot.concept_text){const overlay=clips.find(c=>obj(c)&&c.id==='concept-'+shot.shot_id);check(obj(overlay)&&overlay.src===`scenes/${String(index+1).padStart(3,'0')}.html`&&overlay.at===expectedTiming.at&&same(overlay.time,expectedTiming.time));}
   frame+=shot.duration_frames;
  }
  if(plan.narration){const audio=clips.find(c=>obj(c)&&c.id==='narration');check(obj(audio)&&audio.src===draft.assets.find(a=>a.asset_id===plan.narration!.asset_id)!.path&&audio.at===0&&audio.time===undefined&&audio.speed===undefined&&audio.volume===undefined);}
  return plan;
 }
 async #prove(taskInput:TaskReservation,leaseInput:TaskLease|null,rootInput:string,files:StagedNativeDraft['files'],roots:readonly string[],registryInput:readonly LocalAsset[],options:{readonly purpose:'lease'|'read'|'adoption';readonly bindingDigest?:string;readonly proofValue?:object;readonly producerAttempt?:number;readonly known?:StagedNativeDraft;readonly expected?:PreparedTaskFact}):Promise<{fact:PreparedTaskFact;proof:object}>{
  const task=freeze(structuredClone(taskInput)),lease=leaseInput===null?null:freeze({...leaseInput});
  if(lease)this.#binding(task,lease);else this.#bindingTask(task);
  check(!this.#closed);
  const root=absolute(rootInput);check(inside(this.#domain,root));
  const record:RecordProof={taskDigest:canonicalDigest(task),leaseDigest:lease?canonicalDigest(lease):'',factDigest:'',root,registry:this.#registry(task,registryInput),dirs:new Map(),files:new Map(),blobs:new Map(),fds:new Set(),closed:false,purpose:options.purpose,bindingDigest:options.bindingDigest??'',producerAttempt:options.producerAttempt??0};this.#records.add(record);
  try{
   const domain=this.#dir(record,this.#domain),directory=this.#dir(record,root);for(const d of [domain,directory])check(d.stat.uid===BigInt(process.getuid!())&&(d.stat.mode&0o077n)===0n);
   check(files.length>0&&roots[0]==='film.html'&&new Set(roots).size===roots.length);
   const folded=new Set<string>();for(const file of files){const path=relative(file.relative_path);check(!folded.has(path.toLowerCase())&&HASH.test(file.sha256)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0);folded.add(path.toLowerCase());const actual=this.#file(record,join(root,path),true);check(actual.bytes===file.bytes&&actual.sha256===file.sha256);record.files.set(path,actual);}
   check(roots.every(path=>record.files.has(relative(path)))&&roots.includes(META));this.#tree(record);
   for(const asset of record.registry){const path=this.#blobPath(asset);check(typeof path==='string');absolute(path);check(!inside(this.#domain,path)&&path!==this.#domain);const file=this.#file(record,path);check(file.sha256===asset.sha256&&file.bytes===asset.bytes);record.blobs.set(asset.asset_id,file);}
   const metadata=this.#json(record,META);check(obj(metadata)&&Object.keys(metadata).sort().join(',')==='assets,clip_ids,format,fps,frame_count,plan_digest,project_id,subtitle_timing_basis,subtitles');
   check(metadata.format==='narralens.prepared-native-output@1'&&metadata.project_id===task.request.project_id&&metadata.subtitle_timing_basis==='storyboard_plan');
   const draft=freeze({format:'narralens.staged-native-draft@1',project_id:metadata.project_id,root,fps:metadata.fps,frame_count:metadata.frame_count,clip_ids:metadata.clip_ids,roots:[...roots],files:structuredClone([...files]),subtitles:metadata.subtitles,assets:metadata.assets,plan_digest:metadata.plan_digest,subtitle_timing_basis:metadata.subtitle_timing_basis} as StagedNativeDraft);
   if(options.known)check(same(draft,options.known));check(Array.isArray(draft.assets)&&draft.assets.every(asset=>roots.includes(asset.path)));
   const format=await this.#format();this.#current(record,true);const plan=this.#plan(record,task,draft,format);
   const digest=await computeSourceDigest({root,roots,engine:'openfilm',engineUpstreamSha:OPENFILM_UPSTREAM_SHA});this.#current(record,true);
   check(digest.external_reference_count===0);
   const actual=[...digest.manifest.files,...digest.manifest.assets].map(f=>({relative_path:f.path,bytes:f.size,sha256:f.sha256})).sort((a,b)=>a.relative_path<b.relative_path?-1:a.relative_path>b.relative_path?1:0);
   const described=[...files].sort((a,b)=>a.relative_path<b.relative_path?-1:a.relative_path>b.relative_path?1:0);check(same(actual,described));
   check(same(digest.manifest.assets.map(a=>({path:a.path,sha256:a.sha256,bytes:a.size})).sort((a,b)=>a.path<b.path?-1:1),draft.assets.map(a=>({path:a.path,sha256:a.sha256,bytes:a.bytes})).sort((a,b)=>a.path<b.path?-1:1)));
   const fact=freeze({format:'narralens.created-task-prepared@1',stage_token:task.stage_token,source_digest:digest.source_digest,plan_digest:plan.digest,rights_digest:canonicalDigest(record.registry),files:structuredClone([...files]),roots:[...roots]} as PreparedTaskFact);
   if(options.expected)check(same(fact,options.expected));record.factDigest=canonicalDigest(fact);const proof=Object.freeze(options.proofValue??{});this.#proofs.set(proof,record);return {fact,proof};
  }catch(error){
   try{this.#dispose(record);}catch(cleanup){throw new PublicationCleanupError([error,cleanup]);}
   failure(error);
  }
 }
 async prove(task:TaskReservation,lease:TaskLease,draft:StagedNativeDraft,registryFacts:readonly LocalAsset[]):Promise<{fact:PreparedTaskFact;proof:object}>{
  let work:Promise<{fact:PreparedTaskFact;proof:object}>|undefined;
  try{
   const copy=freeze(structuredClone(draft)),binding=freeze(structuredClone(task)),identity=freeze({...lease}),registry=freeze(structuredClone([...registryFacts]));
   work=Promise.resolve().then(()=>this.#prove(binding,identity,copy.root,copy.files,copy.roots,registry,{purpose:'lease',known:copy}));this.#pending.add(work);return await work;
  }catch(error){return failure(error);}finally{if(work)this.#pending.delete(work);}
 }
 async proveExisting(task:TaskReservation,lease:TaskLease,root:string,fact:PreparedTaskFact,registryFacts:readonly LocalAsset[]):Promise<object>{
  let work:Promise<{fact:PreparedTaskFact;proof:object}>|undefined;
  try{
   const expected=freeze(structuredClone(fact)),binding=freeze(structuredClone(task)),identity=freeze({...lease}),registry=freeze(structuredClone([...registryFacts]));check(expected.stage_token===binding.stage_token);
   work=Promise.resolve().then(()=>this.#prove(binding,identity,root,expected.files,expected.roots,registry,{purpose:'lease',expected}));this.#pending.add(work);return (await work).proof;
  }catch(error){return failure(error);}finally{if(work)this.#pending.delete(work);}
 }
 /* ---- CR-R1-001 §5: the completed-source proofs.
  A succeeded SOURCE_ONLY job has no live lease by then, so these never claim one and
  never borrow an old TaskLease proof: they reopen the real descriptors, rebuild the
  closure facts and bind the result to their own purpose and their own complete
  binding. A read proof is never an adoption proof, in the type or at runtime. ---- */
 #completedSource(completed:CompletedPreparedSourceV1):void {
  check(completed&&typeof completed==='object'&&completed.format==='narralens.completed-prepared-source@1');
  const task=completed.task;check(task&&typeof task==='object');this.#bindingTask(task);
  check(completed.project_id===task.request.project_id);
  check(completed.job&&typeof completed.job==='object'&&completed.job.job_id===task.job_id&&completed.job.project_id===task.request.project_id&&completed.job.state==='succeeded');
  check(same(completed.job.execution,task.request.execution));
  check(completed.terminal_reason==='SOURCE_ONLY');
  check(completed.provider_receipt&&typeof completed.provider_receipt==='object'&&completed.provider_receipt.kind==='local.native-draft@1'&&completed.provider_receipt.stage==='SOURCE_ONLY');
  check(completed.fact&&typeof completed.fact==='object'&&completed.fact.format==='narralens.created-task-prepared@1'&&completed.fact.stage_token===task.stage_token);
  check(completed.provider_receipt.source_digest===completed.fact.source_digest);
  check(Number.isSafeInteger(completed.producer_attempt)&&completed.producer_attempt>=1);
 }
 /** The prepared root of the producer attempt. It is the attempt's own directory, and
  * nothing else: a root of another attempt or another stage is not this source. */
 #completedRoot(completed:CompletedPreparedSourceV1):string {
  const root=absolute(completed.root);check(inside(this.#domain,root));
  check(root.endsWith('/'+completed.task.stage_token+'/attempt-'+completed.producer_attempt+'/source'));
  return root;
 }
 #baseBinding(completed:CompletedPreparedSourceV1,binding:PreparedReadBindingV1|PreparedAdoptionBindingV1):void {
  const task=completed.task;check(binding&&typeof binding==='object');
  check(binding.project_id===task.request.project_id);
  check(binding.run_id===task.request.execution.run_id);
  // The execution identifies the run and the step of the preparation. Its attempt may
  // have advanced when the preparation was retried, so only the run, plan and step are
  // required to be the same; the attempt itself is a positive integer.
  // The binding is the current author baseline of the preparation. The execution is
  // the producer's own execution: a lease retry is a lease attempt, not a change of
  // the execution, so the whole binding has to be the one the preparation ran under.
  check(binding.execution&&typeof binding.execution==='object'&&same(binding.execution,task.request.execution));
  check(typeof binding.prepared_source_id==='string'&&binding.prepared_source_id.length>0&&binding.prepared_source_id.length<=128&&!/[\u0000-\u001f\u007f]/u.test(binding.prepared_source_id));
  check(binding.prepared_job_id===task.job_id);
  check(binding.fact_digest===canonicalDigest(completed.fact));
  check(binding.source_digest===task.request.source_digest);
  check(binding.base_revision===task.request.base_revision);
  check(Number.isSafeInteger(binding.control_revision)&&binding.control_revision>=0);
  check(Number.isSafeInteger(binding.selection_version)&&binding.selection_version>=0);
 }
 #readBinding(completed:CompletedPreparedSourceV1,binding:PreparedReadBindingV1):void {
  check(binding.purpose==='impact'||binding.purpose==='preview');this.#baseBinding(completed,binding);
 }
 #adoptionBinding(completed:CompletedPreparedSourceV1,binding:PreparedAdoptionBindingV1):void {
  check(binding.purpose==='adoption');this.#baseBinding(completed,binding);
  for(const value of [binding.transaction_id,binding.impact_id,binding.approval_id,binding.target_snapshot_id])check(typeof value==='string'&&value.length>0&&value.length<=128&&!/[\u0000-\u001f\u007f]/u.test(value));
  check(typeof binding.impact_hash==='string'&&HASH.test(binding.impact_hash));
  check(typeof binding.plan_sha256==='string'&&HASH.test(binding.plan_sha256));
 }
 async #proveCompleted(completed:CompletedPreparedSourceV1,binding:PreparedReadBindingV1|PreparedAdoptionBindingV1,purpose:'read'|'adoption',registry:readonly LocalAsset[]):Promise<object>{
  check(!this.#closed);this.#completedSource(completed);
  if(purpose==='read')this.#readBinding(completed,binding as PreparedReadBindingV1);else this.#adoptionBinding(completed,binding as PreparedAdoptionBindingV1);
  const root=this.#completedRoot(completed),bindingDigest=canonicalDigest(binding);
  const proofValue=purpose==='read'
   ?Object.freeze({format:'narralens.prepared-read-proof@1',purpose:(binding as PreparedReadBindingV1).purpose})
   :Object.freeze({format:'narralens.prepared-adoption-proof@1',purpose:'adoption'});
  const result=await this.#prove(completed.task,null,root,completed.fact.files,completed.fact.roots,registry,{purpose,bindingDigest,proofValue,producerAttempt:completed.producer_attempt,expected:completed.fact});
  return result.proof;
 }
 async proveForRead<P extends PreparedReadBindingV1['purpose']>(completed:CompletedPreparedSourceV1,binding:PreparedReadBindingV1&{readonly purpose:P},registryFacts:readonly LocalAsset[]):Promise<PreparedReadProofV1&{readonly purpose:P}>{
  let work:Promise<PreparedReadProofV1&{readonly purpose:P}>|undefined;
  try{
   const source=freeze(structuredClone(completed)),bound=freeze(structuredClone(binding)) as PreparedReadBindingV1&{readonly purpose:P},registry=freeze(structuredClone([...registryFacts]));
   work=Promise.resolve().then(()=>this.#proveCompleted(source,bound,'read',registry) as Promise<PreparedReadProofV1&{readonly purpose:P}>);this.#pending.add(work);return await work;
  }catch(error){return failure(error);}finally{if(work)this.#pending.delete(work);}
 }
 async proveForAdoption(completed:CompletedPreparedSourceV1,binding:PreparedAdoptionBindingV1,registryFacts:readonly LocalAsset[]):Promise<PreparedAdoptionProofV1>{
  let work:Promise<PreparedAdoptionProofV1>|undefined;
  try{
   const source=freeze(structuredClone(completed)),bound=freeze(structuredClone(binding)),registry=freeze(structuredClone([...registryFacts]));
   work=Promise.resolve().then(()=>this.#proveCompleted(source,bound,'adoption',registry) as Promise<PreparedAdoptionProofV1>);this.#pending.add(work);return await work;
  }catch(error){return failure(error);}finally{if(work)this.#pending.delete(work);}
 }
 /** The final synchronous check inside BRIDGE's controlled transaction. It is
  * synchronous on purpose: an asynchronous callback would leave the window open. */
 #assertRights(assertCurrentRights:()=>void):void {
  check(typeof assertCurrentRights==='function');
  const result:unknown=assertCurrentRights();
  if(result&&typeof(result as {then?:unknown}).then==='function'){void Promise.resolve(result).catch(()=>{});throw reject();}
  check(result===undefined);
 }
 assertCurrentForRead<P extends PreparedReadBindingV1['purpose']>(completed:CompletedPreparedSourceV1,binding:PreparedReadBindingV1&{readonly purpose:P},proof:PreparedReadProofV1&{readonly purpose:P},assertCurrentRights:()=>void):void {
  const record=proof&&typeof proof==='object'?this.#proofs.get(proof):undefined;
  try{
   check(record&&record.purpose==='read'&&!record.closed&&!this.#closed&&this.#records.has(record));
   this.#completedSource(completed);this.#readBinding(completed,binding);
   check(record.bindingDigest===canonicalDigest(binding)&&record.taskDigest===canonicalDigest(completed.task)&&record.factDigest===canonicalDigest(completed.fact));
   // The opened descriptors belong to this root and to this producer attempt. A root
   // that was changed after the proof was made is not the proof's root.
   check(record.root===this.#completedRoot(completed)&&record.producerAttempt===completed.producer_attempt);
   this.#assertRights(assertCurrentRights);this.#current(record,true);this.#assertRights(assertCurrentRights);this.#current(record,false);
  }catch(error){failure(error);}
 }
 assertCurrentForAdoption(completed:CompletedPreparedSourceV1,binding:PreparedAdoptionBindingV1,proof:PreparedAdoptionProofV1,assertCurrentRights:()=>void):void {
  const record=proof&&typeof proof==='object'?this.#proofs.get(proof):undefined;
  try{
   check(record&&record.purpose==='adoption'&&!record.closed&&!this.#closed&&this.#records.has(record));
   this.#completedSource(completed);this.#adoptionBinding(completed,binding);
   check(record.bindingDigest===canonicalDigest(binding)&&record.taskDigest===canonicalDigest(completed.task)&&record.factDigest===canonicalDigest(completed.fact));
   check(record.root===this.#completedRoot(completed)&&record.producerAttempt===completed.producer_attempt);
   this.#assertRights(assertCurrentRights);this.#current(record,true);this.#assertRights(assertCurrentRights);this.#current(record,false);
  }catch(error){failure(error);}
 }
 assertCurrent(task:TaskReservation,lease:TaskLease,fact:PreparedTaskFact,proof:object,assertCurrentRights:()=>void):void {
  const record=proof&&typeof proof==='object'?this.#proofs.get(proof):undefined;
  try{
   check(record&&record.purpose==='lease'&&!record.closed&&!this.#closed&&this.#records.has(record));this.#binding(task,lease);check(record.taskDigest===canonicalDigest(task)&&record.leaseDigest===canonicalDigest(lease)&&record.factDigest===canonicalDigest(fact));
   const rights=()=>{check(typeof assertCurrentRights==='function');const result:unknown=assertCurrentRights();if(result&&typeof(result as {then?:unknown}).then==='function'){void Promise.resolve(result).catch(()=>{});throw reject();}check(result===undefined);};
   rights();this.#current(record,true);rights();this.#current(record,false);
  }catch(error){failure(error);}
 }
}
