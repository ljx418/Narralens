import {resolve} from 'node:path';
import type {SQLInputValue} from 'node:sqlite';
import type {ExecutionBinding} from '../../contracts/agent-driven-types.js';
import {validateAgentDefinition} from '../../contracts/agent-driven-validator.js';
import {canonicalDigest} from '../creative/digest.js';
import type {PreparedImpactFacts} from '../creative/execution-guard.js';
import {createTrustedCallerContext,ProductError} from '../creative/trusted-context.js';
import {computeSourceDigest} from '../engine/source-digest-v1.js';
import {OPENFILM_UPSTREAM_SHA} from '../engine/engine-binding-store.js';
import type {NarralensHost} from '../server.js';
import {snapshotIdFor} from '../projects/snapshot-store.js';
import type {CompletedPreparedSourceV1,PreparedReadBindingV1,PreparedReadProofV1} from '../render/assembly-ports.js';
import {CreativeProjectAuthority} from './creative-project-authority.js';
import {CreatedPreparedSourceStore} from './created-prepared-source-store.js';
import {CreatedTaskStore} from './created-task-store.js';
import {LocalAssetRegistry,type LocalAsset} from './local-asset-registry.js';
import {PreparedDraftVerifier} from './prepared-draft-verifier.js';
import {preparedSourceConsumerGraph,type CreatedSourceSelectionPort} from './created-source-publisher.js';
import type {PreparedAdoptionPlanV1,PreparedSourceFileFact} from './created-source-ports.js';
import {RetainedSourceTree} from './retained-source-tree.js';

export interface CreatedPreparedReadInput {
 readonly project_id:string;readonly prepared_source_id:string;readonly execution:ExecutionBinding;
}
export type CreatedPreparedFacts=Omit<PreparedAdoptionPlanV1,'format'|'version'|'source_kind'|'expires_at'>&{readonly rights_digest:string};
/** A private read capability; it is never a lease, Approval, publication or NativeAck. */
export interface CreatedPreparedFactsProof {readonly facts:CreatedPreparedFacts;}
interface RecordOfRead {
 readonly input:CreatedPreparedReadInput;readonly principal:string;readonly mappingDigest:string;
 readonly completed:CompletedPreparedSourceV1;readonly binding:PreparedReadBindingV1&{purpose:'impact'};
 readonly preparedProof:PreparedReadProofV1&{purpose:'impact'};readonly original:RetainedSourceTree;
 readonly registry:readonly LocalAsset[];readonly facts:CreatedPreparedFacts;
}
type Metadata=Parameters<typeof preparedSourceConsumerGraph>[0];
type Draft=Parameters<typeof preparedSourceConsumerGraph>[1];
function changed(message='Prepared source facts are no longer current'):never{throw new ProductError('REVISION_CONFLICT',message);}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
const ordered=(files:readonly PreparedSourceFileFact[])=>[...files].sort((a,b)=>a.relative_path<b.relative_path?-1:a.relative_path>b.relative_path?1:0);

/** Actual same-Host facts for impact preparation. Completed SOURCE_ONLY work is read
 * without claiming a new lease or settling its Job again. Both original author bytes
 * and purpose-separated prepared bytes remain held until the caller's final guard. */
export class CreatedSourceFactsReader {
 readonly #proofs=new WeakMap<object,RecordOfRead>();readonly #issued=new Set<object>();
 readonly #pending=new Set<Promise<CreatedPreparedFactsProof>>();#closed=false;#closing:Promise<void>|undefined;
 constructor(private readonly options:{readonly host:NarralensHost;readonly authority:CreativeProjectAuthority;
  readonly prepared:CreatedPreparedSourceStore;readonly tasks:CreatedTaskStore;readonly assets:LocalAssetRegistry;
  readonly verifier:PreparedDraftVerifier;readonly selection:CreatedSourceSelectionPort;readonly stageDomainRoot:string}){}
 #open():void{if(this.#closed)throw new ProductError('CAPABILITY_UNAVAILABLE','Prepared source reader is closed');}
 #row(sql:string,...values:SQLInputValue[]):Record<string,unknown>{
  const row=this.options.host.revisions.compose(db=>db.prepare(sql).get(...values));if(!row)changed();return row;
 }
 #completed(input:CreatedPreparedReadInput,principal:string):{completed:CompletedPreparedSourceV1;mappingDigest:string}{
  const mapping=this.options.prepared.read(input.prepared_source_id);
  if(!mapping||mapping.project_id!==input.project_id)throw new ProductError('NOT_FOUND','No such prepared source');
  const task=this.options.tasks.read(mapping.job_id,principal),fact=this.options.tasks.readPrepared(task.job_id,principal);
  const attempt=this.options.tasks.preparedLeaseAttempt(task.job_id,principal);
  const job=this.#row('SELECT state,terminal_reason,provider_receipt_json FROM job WHERE job_id=?',task.job_id);
  if(!fact||attempt===null||task.request.kind!=='assemble_draft'||task.request.project_id!==input.project_id
   ||task.principal_id!==principal||job.state!=='succeeded'||job.terminal_reason!=='SOURCE_ONLY'
   ||canonicalDigest(task.request.execution)!==canonicalDigest(input.execution)||mapping.request_digest!==task.request_digest
   ||mapping.fact_digest!==canonicalDigest(fact)||mapping.plan_sha256!==fact.plan_digest||mapping.rights_digest!==fact.rights_digest
   ||mapping.base_revision!==task.request.base_revision||mapping.source_digest!==task.request.source_digest
   ||canonicalDigest(mapping.execution)!==canonicalDigest(input.execution)
   ||canonicalDigest([...mapping.roots].sort())!==canonicalDigest([...fact.roots].sort())
   ||canonicalDigest(ordered(mapping.files))!==canonicalDigest(ordered(fact.files)))changed();
  const step=this.#row('SELECT job_id FROM cp_a0_step_attempt WHERE project_id=? AND run_id=? AND plan_version=? AND step_id=? AND attempt=?',
   input.project_id,input.execution.run_id,input.execution.plan_version,input.execution.step_id,input.execution.attempt);
  if(step.job_id!==task.job_id)changed('The current workflow attempt belongs to another job');
  const root=resolve(this.options.stageDomainRoot,task.stage_token,'attempt-'+attempt,'source');
  if(mapping.stage_root!==root)changed('Prepared source does not have its producer-owned location');
  return {mappingDigest:canonicalDigest(mapping),completed:freeze({format:'narralens.completed-prepared-source@1',project_id:input.project_id,
   task,producer_attempt:attempt,job:this.options.tasks.receipt(task.job_id,principal),terminal_reason:'SOURCE_ONLY',
   provider_receipt:JSON.parse(String(job.provider_receipt_json)) as CompletedPreparedSourceV1['provider_receipt'],fact,root})};
 }
 #registry(project:string,principal:string,ids:readonly string[]):LocalAsset[]{
  const caller=createTrustedCallerContext({principal_id:principal,channel:'authenticated',source:'driver_relay',session_ref:'host-prepared-facts'});
  const all=this.options.assets.list(project,caller);
  const rows=ids.map(id=>{const row=all.find(a=>a.asset_id===id);if(!row||row.project_id!==project
    ||row.license.status!=='cleared'||row.license.commercial_use!==true)changed('Prepared rights are unavailable');return row;});
  if(new Set(ids).size!==ids.length)changed('Duplicate prepared rights');
  return rows.sort((a,b)=>a.asset_id<b.asset_id?-1:a.asset_id>b.asset_id?1:0);
 }
 #current(record:RecordOfRead):void{
  this.#open();const {input,principal,facts}=record;this.options.authority.assertOwner(input.project_id,principal);
  const revisions=this.options.host.revisions,active=revisions.activeCommit(input.project_id),engine=revisions.readEngineBinding(input.project_id);
  if(!active||active.engine!=='openfilm'||active.revision!==facts.base_revision||active.source_digest!==facts.base_source_digest
   ||revisions.controlRevision(input.project_id,0)!==facts.control_revision||revisions.recoveryGate(input.project_id,0)
   ||engine?.engine!=='openfilm'||engine.engine_upstream_sha!==OPENFILM_UPSTREAM_SHA
   ||this.options.selection.currentSelectionVersion(input.project_id)!==facts.selection_version)changed();
  if(revisions.activeLocks(input.project_id).some(l=>l.active))throw new ProductError('TARGET_LOCKED','Source replacement affects a locked project');
  const current=this.#completed(input,principal);
  if(current.mappingDigest!==record.mappingDigest||canonicalDigest(current.completed)!==canonicalDigest(record.completed))changed();
  record.original.verify();
  this.options.verifier.assertCurrentForRead(record.completed,record.binding,record.preparedProof,()=>{
   const actual=this.#registry(input.project_id,principal,record.registry.map(a=>a.asset_id));
   if(canonicalDigest(actual)!==canonicalDigest(record.registry))changed('Prepared rights changed');
  });
  record.original.verify();
 }
 acquire(input:CreatedPreparedReadInput,principal:string):Promise<CreatedPreparedFactsProof>{
  this.#open();const bound=freeze(structuredClone(input));validateAgentDefinition('ExecutionBinding',bound.execution);
  const work=Promise.resolve().then(()=>this.#acquire(bound,principal));this.#pending.add(work);
  return work.finally(()=>this.#pending.delete(work));
 }
 async #acquire(input:CreatedPreparedReadInput,principal:string):Promise<CreatedPreparedFactsProof>{
  this.options.authority.assertOwner(input.project_id,principal);const {completed,mappingDigest}=this.#completed(input,principal);
  const mapping=this.options.prepared.read(input.prepared_source_id)!;
  let original:RetainedSourceTree|undefined,stage:RetainedSourceTree|undefined,preparedProof:(PreparedReadProofV1&{purpose:'impact'})|undefined;
  let transferred=false;
  try{
   const view=await this.options.host.projectResolver.resolveCreated(input.project_id);this.#open();
   if(view.revision!==mapping.base_revision||view.source_digest!==mapping.source_digest||view.engine_upstream_sha!==OPENFILM_UPSTREAM_SHA)changed();
   const source=await computeSourceDigest({root:view.source_root.value,roots:view.source_fact.roots,engine:'openfilm',engineUpstreamSha:OPENFILM_UPSTREAM_SHA});this.#open();
   if(source.external_reference_count!==0||source.source_digest!==view.source_digest)changed('Original author bytes changed');
   original=new RetainedSourceTree(view.source_root.value,[...source.manifest.files,...source.manifest.assets].map(f=>({relative_path:f.path,bytes:f.size,sha256:f.sha256})));
   stage=new RetainedSourceTree(completed.root,completed.fact.files);
   const metadata=JSON.parse(stage.readBytes('prepared-native.json').toString('utf8')) as Metadata;
   const draft=JSON.parse(stage.readBytes('draft-plan.json').toString('utf8')) as Draft;this.#open();
   const registry=this.#registry(input.project_id,principal,metadata.assets.map(a=>a.asset_id));
   const selection=this.options.selection.currentSelectionVersion(input.project_id);
   const binding:PreparedReadBindingV1&{purpose:'impact'}={purpose:'impact',project_id:input.project_id,run_id:input.execution.run_id,execution:input.execution,
    prepared_source_id:input.prepared_source_id,prepared_job_id:completed.task.job_id,fact_digest:canonicalDigest(completed.fact),base_revision:view.revision,
    control_revision:view.control_revision,source_digest:view.source_digest,selection_version:selection};
   preparedProof=await this.options.verifier.proveForRead(completed,binding,registry);this.#open();original.verify();
   if(completed.fact.plan_digest===null||metadata.frame_count!==mapping.frame_count||metadata.fps.num!==mapping.fps_numerator
    ||metadata.fps.den!==mapping.fps_denominator||canonicalDigest(registry)!==completed.fact.rights_digest)changed();
   const files=ordered(completed.fact.files),file=(path:string)=>{const found=files.find(f=>f.relative_path===path);if(!found)changed('Prepared native file is missing');return found;};
   const captions=ordered(metadata.subtitles.map(s=>file(s.path))),markers=files.find(f=>f.relative_path==='.film/markers.json');
   const graph=preparedSourceConsumerGraph(metadata,draft);
   const facts:CreatedPreparedFacts=freeze({project_id:input.project_id,base_revision:view.revision,base_source_digest:view.source_digest,
    control_revision:view.control_revision,selection_version:selection,materialization_id:input.prepared_source_id,
    prepared_fact_digest:canonicalDigest(completed.fact),request_digest:input.execution.input_digest,producer_execution:input.execution,
    target_source_digest:completed.fact.source_digest,target_snapshot_id:snapshotIdFor(input.project_id,completed.fact.source_digest),
    roots:[...completed.fact.roots].sort(),files,rights:registry.map(a=>({ref_id:a.rights_ref,artifact_version:1,sha256:a.registration_digest})),
    rights_digest:completed.fact.rights_digest,consumer:{consumer_id:'native',project_id:input.project_id,run_id:input.execution.run_id,graph_digest:canonicalDigest(graph)},
    native_plan:{native_plan_sha256:completed.fact.plan_digest,film_sha256:file('film.html').sha256,film_bytes:file('film.html').bytes,
     settings_digest:file('.film/settings.json').sha256,subtitle_style_digest:file('.film/subtitles.json').sha256,
     captions_digest:captions.length===1?captions[0]!.sha256:canonicalDigest(captions),markers_digest:markers?.sha256??canonicalDigest([])},
    frame_count:metadata.frame_count,fps_numerator:metadata.fps.num,fps_denominator:metadata.fps.den,
    affected_ranges:graph.clips.map(c=>({start_frame:c.start_frame,end_frame_exclusive:c.end_frame_exclusive,clip_id:c.clip_id})),
    locks_checked:[],engine_upstream_sha:OPENFILM_UPSTREAM_SHA});
   const record:RecordOfRead={input,principal,mappingDigest,completed,binding,preparedProof,original,registry:freeze(structuredClone(registry)),facts};
   this.#current(record);const proof=Object.freeze({facts});this.#proofs.set(proof,record);this.#issued.add(proof);transferred=true;return proof;
  }finally{try{if(!transferred){try{if(preparedProof)this.options.verifier.release(preparedProof);}finally{original?.close();}}}finally{stage?.close();}}
 }
 assertCurrent(input:CreatedPreparedReadInput,principal:string,value:unknown):CreatedPreparedFacts{
  const record=value&&typeof value==='object'?this.#proofs.get(value):undefined;
  if(!record||record.principal!==principal||canonicalDigest(record.input)!==canonicalDigest(input))changed('Prepared read proof is not owned or bound');
  this.#current(record);return record.facts;
 }
 /** Projection for the common Host-only narrow guard. It is derived only after
  * checking this reader's live token; a structural projection never replaces it. */
 preparedImpactFacts(input:CreatedPreparedReadInput,principal:string,value:unknown):PreparedImpactFacts {
  this.assertCurrent(input,principal,value);
  const record=this.#proofs.get(value as object)!;
  if(record.completed.job.state!=='succeeded'||record.completed.terminal_reason!=='SOURCE_ONLY')changed();
  return freeze({project_id:input.project_id,completed_job:{job_id:record.completed.job.job_id,state:record.completed.job.state,
   terminal_reason:record.completed.terminal_reason},prepared_source_id:input.prepared_source_id,
   fact_digest:canonicalDigest(record.completed.fact),execution:structuredClone(record.completed.task.request.execution)});
 }
 release(value:unknown):void{
  if(!value||typeof value!=='object')return;const record=this.#proofs.get(value);if(!record)return;
  this.#proofs.delete(value);this.#issued.delete(value);
  try{this.options.verifier.release(record.preparedProof);}finally{record.original.close();}
 }
 close():Promise<void>{
  this.#closed=true;return this.#closing??=(async()=>{await Promise.allSettled([...this.#pending]);const errors:unknown[]=[];
   for(const proof of [...this.#issued])try{this.release(proof);}catch(e){errors.push(e);}
   if(errors.length)throw new AggregateError(errors,'Prepared source reader cleanup failed');})();
 }
}
