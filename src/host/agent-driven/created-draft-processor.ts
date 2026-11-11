import {asHostResourceError} from '../api-error.js';
import {createHash} from 'node:crypto';
import {constants,lstatSync,realpathSync,openSync,fstatSync,readFileSync,closeSync} from 'node:fs';
import {mkdir,open,readFile,realpath,lstat} from 'node:fs/promises';
import type {FileHandle} from 'node:fs/promises';
import {resolve,dirname,relative,sep} from 'node:path';
import type {Brief,Script,Storyboard} from '../../contracts/agent-driven-types.js';
import type {NarralensHost} from '../server.js';
import type {LocalAssetRegistry,LocalAsset} from './local-asset-registry.js';
import type {CreatedTaskStore,TaskReservation,TaskLease,TaskTransactionDb,PreparedTaskFact} from './created-task-store.js';
import type {CreatedTaskGate} from './created-task-gate.js';
import type {ProductSqliteRepository} from './product-sqlite-repository.js';
import type {FixedWorkflowService} from '../creative/fixed-workflow-service.js';
import type {CreatedTaskProcessor} from './created-task-worker.js';
import type {CreativeProjectAuthority} from './creative-project-authority.js';
import {createTrustedCallerContext,ProductError} from '../creative/trusted-context.js';
import {canonicalJson,canonicalDigest} from '../creative/digest.js';
import {computeSourceDigest} from '../engine/source-digest-v1.js';
import {OPENFILM_UPSTREAM_SHA} from '../engine/engine-binding-store.js';
import {PinnedNativeDraftAssembler} from '../render/native-draft-assembler.js';
import type {StagedNativeDraft,NativeDraftAsset} from '../render/assembly-ports.js';
import {runtimeRoot} from './owned-runtime.js';

export interface PreparedDraftProofPort {
 release(proof:object):Promise<void>|void;
 close():Promise<void>|void;
 prove(task:TaskReservation,lease:TaskLease,draft:StagedNativeDraft,assets:readonly LocalAsset[]):Promise<{fact:PreparedTaskFact;proof:object}>;
 proveExisting(task:TaskReservation,lease:TaskLease,root:string,fact:PreparedTaskFact,assets:readonly LocalAsset[]):Promise<object>;
 assertCurrent(task:TaskReservation,lease:TaskLease,fact:PreparedTaskFact,proof:unknown,assertCurrentRights:()=>void):void;
}
interface AuthorProof {root:string;identity:string;files:readonly {path:string;size:number;sha256:string}[];}
interface Evidence {task:TaskReservation;lease:TaskLease;author:AuthorProof;assets:readonly LocalAsset[];draft:StagedNativeDraft;}
interface ProcessorOptions {root:string;vendorRoot:string;protectedRoots:readonly string[];width:number;height:number;boundary?:(point:'before_prepare'|'after_prepare'|'before_record'|'before_finish',task:TaskReservation)=>Promise<void>;}
const changed=()=>new ProductError('REVISION_CONFLICT','Native preparation facts or bytes changed');
const unavailable=()=>new ProductError('CAPABILITY_UNAVAILABLE','Native preparation is unavailable');
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const identity=(s:{dev:number|bigint;ino:number|bigint})=>`${s.dev}:${s.ino}`;
const overlaps=(a:string,b:string)=>a===b||a.startsWith(b+sep)||b.startsWith(a+sep);
const META='prepared-native.json';
function prospective(path:string):string {let p=resolve(path);while(true){try{lstatSync(p);break;}catch(e){if((e as {code?:string}).code!=='ENOENT')throw e;p=dirname(p);}}return resolve(realpathSync(p),relative(p,resolve(path)));}
function fileHash(path:string,bytes:number,digest:string):void {
 if(realpathSync(path)!==path)throw changed();const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const before=fstatSync(fd,{bigint:true});if(!before.isFile()||before.size!==BigInt(bytes))throw changed();const value=readFileSync(fd),after=fstatSync(fd,{bigint:true});if(value.length!==bytes||sha(value)!==digest||identity(before)!==identity(after)||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||realpathSync(path)!==path)throw changed();}finally{closeSync(fd);}
}
/** Real local preparation processor, not a committed project producer. It uses actual
 * registry resolution + fixed assembler; all durable writes share the original DB. */
export class CreatedDraftTaskProcessor implements CreatedTaskProcessor {
 readonly #proofs=new WeakMap<object,Evidence>();readonly #assembler:PinnedNativeDraftAssembler;
 readonly #path:string;#root:Promise<FileHandle>|undefined;#closing=false;
 constructor(private readonly host:NarralensHost,private readonly tasks:CreatedTaskStore,private readonly gate:CreatedTaskGate,private readonly repo:ProductSqliteRepository,private readonly workflow:FixedWorkflowService,private readonly authority:CreativeProjectAuthority,private readonly assets:LocalAssetRegistry,private readonly verifier:PreparedDraftProofPort,private readonly options:ProcessorOptions){
  this.#path=resolve(options.root);this.#assembler=new PinnedNativeDraftAssembler(options.vendorRoot);
  for(const path of [...options.protectedRoots,...assets.protectedRoots(),options.vendorRoot])if(overlaps(prospective(this.#path),prospective(path)))throw unavailable();
  if(!Number.isSafeInteger(options.width)||!Number.isSafeInteger(options.height)||options.width<16||options.height<16||options.width>8192||options.height>8192)throw unavailable();
 }
 #caller(task:TaskReservation){return createTrustedCallerContext({principal_id:task.principal_id,channel:'authenticated',source:'driver_relay',session_ref:task.job_id});}
 #checkAbort(signal:AbortSignal){if(signal.aborted||this.#closing)throw new ProductError('CAPABILITY_UNAVAILABLE','Native preparation was interrupted');}
 async #rootHandle(){
  if(this.#root)return this.#root;let pending:Promise<FileHandle>;
  pending=open(runtimeRoot(this.#path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW).catch(error=>{if(this.#root===pending)this.#root=undefined;throw asHostResourceError(error)??error;});
  this.#root=pending;return pending;
 }
 async #directory(parent:FileHandle,path:string,name:string):Promise<FileHandle>{
  if(!/^[A-Za-z0-9_-]+$/.test(name))throw unavailable();const at='/proc/self/fd/'+parent.fd+'/'+name;
  try{await mkdir(at,{mode:0o700});}catch(e){if((e as {code?:string}).code!=='EEXIST')throw e;}
  const before=await lstat(at,{bigint:true}),handle=await open(at,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{const held=await handle.stat({bigint:true});if(!before.isDirectory()||before.isSymbolicLink()||identity(before)!==identity(held)||held.uid!==BigInt(process.getuid!())||(held.mode&0o077n)!==0n||await realpath('/proc/self/fd/'+handle.fd)!==path)throw changed();await handle.sync();await parent.sync();return handle;}catch(e){await handle.close();throw e;}
 }
 async #stage(task:TaskReservation,attempt:number):Promise<string>{
  const root=await this.#rootHandle(),held=await root.stat({bigint:true}),current=await lstat(this.#path,{bigint:true});
  if(identity(held)!==identity(current)||current.isSymbolicLink()||await realpath(this.#path)!==this.#path)throw changed();
  const token=resolve(this.#path,task.stage_token),a=await this.#directory(root,token,task.stage_token);
  try{const b=await this.#directory(a,resolve(token,'attempt-'+attempt),'attempt-'+attempt);try{return resolve(token,'attempt-'+attempt,'source');}finally{await b.close();}}finally{await a.close();}
 }
 #location(task:TaskReservation,attempt:number){if(!/^stage_[A-Za-z0-9_-]{32}$/.test(task.stage_token)||!Number.isSafeInteger(attempt)||attempt<1)throw changed();return resolve(this.#path,task.stage_token,'attempt-'+attempt,'source');}
 async #author(task:TaskReservation):Promise<AuthorProof>{
  const view=await this.host.projectResolver.resolveCreated(task.request.project_id),root=view.source_root.value;
  const stat=await lstat(root);if(stat.isSymbolicLink()||await realpath(root)!==root||view.revision!==task.request.base_revision||view.source_digest!==task.request.source_digest)throw changed();
  const actual=await computeSourceDigest({root,roots:view.source_fact.roots,engine:'openfilm',engineUpstreamSha:OPENFILM_UPSTREAM_SHA});
  if(actual.source_digest!==task.request.source_digest||actual.external_reference_count!==0)throw changed();
  const result={root,identity:identity(stat),files:[...actual.manifest.files,...actual.manifest.assets].map(f=>({path:f.path,size:f.size,sha256:f.sha256}))};this.#assertAuthor(result);return result;
 }
 #assertAuthor(proof:AuthorProof){const stat=lstatSync(proof.root);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(proof.root)!==proof.root||identity(stat)!==proof.identity)throw changed();for(const file of proof.files){const path=resolve(proof.root,file.path);if(!path.startsWith(proof.root+sep))throw changed();fileHash(path,file.size,file.sha256);}}
 #rights(task:TaskReservation,expected:readonly LocalAsset[]){
  const rows=this.assets.list(task.request.project_id,this.#caller(task));
  for(const asset of expected){if(!rows.some(row=>row.asset_id===asset.asset_id&&canonicalDigest(row)===canonicalDigest(asset)))throw changed();fileHash(this.assets.blobPathForFact(asset),asset.bytes,asset.sha256);}
 }
 async #resolveAssets(task:TaskReservation,brief:Brief,storyboard:Storyboard){
  const ids=[...new Set([...storyboard.shots.flatMap(s=>s.asset_id?[s.asset_id]:[]),...(brief.narration_asset_id?[brief.narration_asset_id]:[])])];
  if(ids.some(id=>!brief.local_asset_ids.includes(id)))throw changed();
  const result=await Promise.all(ids.map(id=>this.assets.resolve(task.request.project_id,id,this.#caller(task))));
  return {facts:result.map(r=>r.asset),native:result.map(({asset,absolute_path}):NativeDraftAsset=>({project_id:asset.project_id,asset_id:asset.asset_id,absolute_path,sha256:asset.sha256,bytes:asset.bytes,duration_frames:asset.media.duration_frames,kind:asset.media.kind,mime_type:asset.media.media_type,source:asset.source,license:asset.license,rights_ref:asset.rights_ref,recording_origin:asset.attestation.recording_origin}))};
 }
 #progress(rows:TaskTransactionDb,task:TaskReservation,state:'pending'|'running'|'waiting_user'|'failed'|'cancelled',now:Date){
  const e=task.request.execution;this.repo.joinTaskTransaction(rows,tx=>this.workflow.recordStepAttemptInTransaction(tx,{project_id:task.request.project_id,run_id:e.run_id,plan_version:1,step_id:e.step_id,attempt:e.attempt,grant_id:e.authorization_id,input_digest:e.input_digest,state,job_id:task.job_id,input_refs:task.request.input_refs,observed_at:now.toISOString()},this.#caller(task)));
 }
 assertPrepared=(rows:TaskTransactionDb,context:{task:TaskReservation;fact:PreparedTaskFact;proof:unknown;lease:TaskLease;now:Date}):void=>{
  const {task,lease,fact,proof}=context,evidence=proof&&typeof proof==='object'?this.#proofs.get(proof):undefined;
  if(!evidence||evidence.task.job_id!==task.job_id||evidence.lease.owner!==lease.owner||evidence.lease.attempt!==lease.attempt)throw changed();
  this.gate.assertWorker(rows,task,context.now);this.#assertAuthor(evidence.author);
  this.verifier.assertCurrent(task,lease,fact,proof,()=>this.#rights(task,evidence.assets));
 };
 async #metadata(draft:StagedNativeDraft):Promise<StagedNativeDraft>{
  const {project_id,plan_digest,fps,frame_count,clip_ids,subtitles,assets,subtitle_timing_basis}=draft;
  const data=Buffer.from(canonicalJson({format:'narralens.prepared-native-output@1',project_id,plan_digest,fps,frame_count,clip_ids,subtitles,assets,subtitle_timing_basis})+'\n');
  const before=await lstat(draft.root,{bigint:true}),root=await open(draft.root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{
   if(identity(before)!==identity(await root.stat({bigint:true}))||await realpath('/proc/self/fd/'+root.fd)!==draft.root)throw changed();
   const file=await open('/proc/self/fd/'+root.fd+'/'+META,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{await file.writeFile(data);await file.sync();}finally{await file.close();}
   await root.sync();
   return {...draft,roots:[...new Set([...draft.roots,META,...assets.map(a=>a.path)])],files:[...draft.files,{relative_path:META,bytes:data.length,sha256:sha(data)}].sort((a,b)=>a.relative_path<b.relative_path?-1:1)};
  }finally{await root.close();}
 }
 async execute(task:TaskReservation,lease:TaskLease,signal:AbortSignal):Promise<void>{
  this.#checkAbort(signal);if(task.request.kind!=='assemble_draft')throw unavailable();
  const input=this.tasks.withRunningTask(task.job_id,lease,(rows,current,now)=>{
   this.gate.assertWorker(rows,current,now);this.#progress(rows,current,'running',now);
   return this.repo.joinTaskTransaction(rows,tx=>{
    const docs=current.request.input_refs.map(ref=>this.authority.ref(tx,current.request.project_id,ref));
    const script=docs.find(d=>d.namespace==='artifact'&&d.record.kind==='script'),storyboard=docs.find(d=>d.namespace==='artifact'&&d.record.kind==='storyboard');
    const created=this.authority.creation.forProject(current.request.project_id)!,head=tx.get('intake_head',{intake_id:created.request.intake_id}),brief=head?tx.get('intake_version',{intake_id:created.request.intake_id,version:head.current_version}):null;
    if(!script||script.namespace!=='artifact'||!storyboard||storyboard.namespace!=='artifact'||!brief)throw changed();
    return {script:structuredClone(script.record.content_json) as Script,storyboard:structuredClone(storyboard.record.content_json) as Storyboard,brief:structuredClone(brief.content_json)};
   });
  });
  const author=await this.#author(task),assets=await this.#resolveAssets(task,input.brief,input.storyboard);this.#checkAbort(signal);
  const existing=this.tasks.readPrepared(task.job_id,task.principal_id);let fact:PreparedTaskFact,proof:object|undefined,draft:StagedNativeDraft;
  try{
  if(existing){
   const attempt=this.tasks.preparedLeaseAttempt(task.job_id,task.principal_id);if(attempt===null)throw changed();const root=this.#location(task,attempt);
   proof=await this.verifier.proveExisting(task,lease,root,existing,assets.facts);fact=existing;
   const meta=JSON.parse(await readFile(resolve(root,META),'utf8'));draft={...meta,format:'narralens.staged-native-draft@1',root,files:fact.files,roots:fact.roots};
  }else{
   await this.options.boundary?.('before_prepare',task);this.#checkAbort(signal);
   this.tasks.withRunningTask(task.job_id,lease,(rows,current,now)=>this.gate.assertWorker(rows,current,now));
   const root=await this.#stage(task,lease.attempt);
   draft=await this.#metadata(await this.#assembler.prepare({project_id:task.request.project_id,script:input.script,storyboard:input.storyboard,assets:assets.native,narration_asset_id:input.brief.narration_asset_id,target_root:root,protected_roots:[...this.options.protectedRoots,...this.assets.protectedRoots(),this.options.vendorRoot],width:this.options.width,height:this.options.height,signal}));
   await this.options.boundary?.('after_prepare',task);this.#checkAbort(signal);
   ({fact,proof}=await this.verifier.prove(task,lease,draft,assets.facts));
  }
  if(!proof)throw unavailable();
  this.#proofs.set(proof,{task,lease:{...lease},author,assets:assets.facts,draft});
   this.#checkAbort(signal);await this.options.boundary?.('before_record',task);this.#checkAbort(signal);
   this.tasks.recordPrepared(task.job_id,lease,fact,proof);
   await this.options.boundary?.('before_finish',task);this.#checkAbort(signal);
   this.tasks.finishPrepared(task.job_id,lease,proof,(rows,current,_fact,now)=>{this.gate.assertWorker(rows,current,now);this.#progress(rows,current,'waiting_user',now);});
  }finally{if(proof){this.#proofs.delete(proof);await this.verifier.release(proof);}}
 }
 recover():void{this.tasks.reapExpired((rows,task,state,now)=>this.#progress(rows,task,state,now));}
 async failed(task:TaskReservation,lease:TaskLease,error:unknown):Promise<void>{
  const code=error&&typeof error==='object'&&'code'in error?String(error.code):'INTERNAL_ERROR';
  if((code==='HOST_RESOURCE_EXHAUSTED'||asHostResourceError(error))&&this.tasks.retryRecoverable(task.job_id,lease,(rows,current,now)=>this.#progress(rows,current,'pending',now)))return;
  this.tasks.finishFailed(task.job_id,lease,code,(rows,current,state,now)=>this.#progress(rows,current,state,now));
 }
 /** Called only after scheduler close has awaited every admitted operation. */
 async close(){this.#closing=true;const results=await Promise.allSettled([Promise.resolve().then(()=>this.verifier.close()),(async()=>{const root=await this.#root?.catch(()=>undefined);await root?.close();})()]);if(results.some(r=>r.status==='rejected'))throw unavailable();}
}
