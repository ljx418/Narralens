import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, open, rename, rm, type FileHandle } from 'node:fs/promises';
import { dirname, basename, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson, canonicalDigest } from '../creative/digest.js';
import { RevisionStore } from '../projects/revision-store.js';
import { matchesFrozenSchemaNamespace } from './agent-schema-definition.js';
import {CreatedPublicationIdentityStore} from './created-publication-identity-store.js';
import {RetainedSourceTree as RetainedTree} from './retained-source-tree.js';
import {assertPreparedAdoptionPlan,preparedAdoptionPlanDigest,isCreatedSourceApplyTransaction,type PreparedAdoptionPlanV1,type CreatedSourcePublicationFacts,type CreatedSourcePublicationProof,type PreparedSourceFileFact} from './created-source-ports.js';
import {SnapshotStore,snapshotIdFor} from '../projects/snapshot-store.js';
import {validateCreatedSourceFact,type CreatedSourceFact} from '../projects/project-creation-store.js';
import {computeSourceDigest,type SourceDigestResult} from '../engine/source-digest-v1.js';
import {OPENFILM_UPSTREAM_SHA} from '../engine/engine-binding-store.js';
import type {LocalAssetRegistry,LocalAsset} from './local-asset-registry.js';
import type {CreatedTaskStore} from './created-task-store.js';
import type {PreparedDraftVerifier} from './prepared-draft-verifier.js';
import type {CompletedPreparedSourceV1,PreparedAdoptionBindingV1,PreparedAdoptionProofV1} from '../render/assembly-ports.js';
import type {StagedNativeDraft} from '../render/assembly-ports.js';
import type {Storyboard} from '../../contracts/agent-driven-types.js';
import {PublicationCleanup,PublicationCleanupError,type PublicationCleanupResource} from './publication-cleanup.js';

/**
 * The publication journal of the created source.
 *
 * It is append-only: one row per phase of one publication, and never a state column
 * that a second writer could move. The recovery reads the last phase and decides
 * whether the publication has to be completed or the original closure restored.
 */
export const CREATED_PUBLICATION_JOURNAL_DDL = `
CREATE TABLE created_publication_journal (
  journal_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  prepared_source_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('prepared','published')),
  original_source_digest TEXT NOT NULL,
  published_source_digest TEXT NOT NULL,
  target_snapshot_id TEXT NOT NULL,
  author_root TEXT NOT NULL,
  backup_root TEXT NOT NULL,
  staging_root TEXT NOT NULL,
  files_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER created_publication_journal_no_update BEFORE UPDATE ON created_publication_journal BEGIN SELECT RAISE(ABORT,'immutable publication journal'); END;
CREATE TRIGGER created_publication_journal_no_delete BEFORE DELETE ON created_publication_journal BEGIN SELECT RAISE(ABORT,'immutable publication journal'); END;
`;

/** The phase a publication reached. */
export type PublicationPhase = 'prepared' | 'published';

/** One row of the publication journal. */
export interface PublicationJournalRow {
  readonly journal_id: string;
  readonly project_id: string;
  readonly transaction_id: string;
  readonly prepared_source_id: string;
  readonly phase: PublicationPhase;
  readonly original_source_digest: string;
  readonly published_source_digest: string;
  readonly target_snapshot_id: string;
  readonly author_root: string;
  readonly backup_root: string;
  readonly staging_root: string;
  readonly files: readonly PreparedSourceFileFact[];
  readonly created_at: string;
}

/** The failure of the created source publisher. */
export class CreatedSourcePublishError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'REVISION_CONFLICT' | 'NOT_FOUND',
    message: string) {
    super(message);
    this.name = 'CreatedSourcePublishError';
  }
}

function fail(code: CreatedSourcePublishError['code'], message: string): never {
  throw new CreatedSourcePublishError(code, message);
}

/**
 * The digest of a source tree.
 *
 * It is the digest of the canonical list of the tree's files: the relative path, the
 * byte count and the SHA-256 of each, sorted by path. The digest of a tree is a
 * function of its membership and its bytes, so a file that was added, removed or
 * changed moves it.
 */
export function createdSourceTreeDigest(files: readonly PreparedSourceFileFact[]): string {
  const canonical = [...files]
    .map((file) => ({ relative_path: file.relative_path, bytes: file.bytes, sha256: file.sha256 }))
    .sort((left, right) => (left.relative_path < right.relative_path ? -1 : left.relative_path > right.relative_path ? 1 : 0));
  return createHash('sha256').update(canonicalJson(canonical), 'utf8').digest('hex');
}

/* -------------------------------------------------------------------------------------- */
/* The opaque proof                                                                        */
/* -------------------------------------------------------------------------------------- */

const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
export interface CreatedSourceSelectionPort {currentSelectionVersion(project_id:string):number;}
export interface PublicationCommitExpectation {
  readonly project_id:string;readonly transaction_id:string;readonly prepared_source_id:string;
  readonly original_source_digest:string;readonly published_source_digest:string;readonly target_snapshot_id:string;
  readonly selection_version:number;
}
interface PublicationRecord {
  readonly facts:CreatedSourcePublicationFacts;readonly issuer:CreatedSourcePublisher;
  readonly guards:readonly RetainedTree[];readonly geometry:CreatedSourceFact;readonly plan:PreparedAdoptionPlanV1;
  readonly registry:readonly LocalAsset[];readonly completed:CompletedPreparedSourceV1;
  readonly adoptionBinding:PreparedAdoptionBindingV1;readonly preparedProof:PreparedAdoptionProofV1;
  readonly metadata:PreparedNativeMetadata;readonly draft:PreparedNativeConsumerPlan;
  readonly originalTree:RetainedTree;readonly targetTree:RetainedTree;readonly snapshotTree:RetainedTree;readonly snapshotContainer:string;
}
type PreparedNativeMetadata=Pick<StagedNativeDraft,'project_id'|'clip_ids'|'fps'|'frame_count'|'subtitles'|'assets'|'plan_digest'>&{readonly format:string};
type PreparedNativeConsumerPlan={readonly storyboard:Storyboard;readonly narration_asset_id:string|null};
/** Derived consumer edges of the already-verified immutable native plan. This is a
 * hash preimage, not another writable timeline or a source of approval authority. */
export function preparedSourceConsumerGraph(metadata:PreparedNativeMetadata,draft:PreparedNativeConsumerPlan){
  const expected=[...draft.storyboard.shots.flatMap(s=>['shot-'+s.shot_id,
    ...(s.asset_id!==null&&s.concept_text?['concept-'+s.shot_id]:[])]),...(draft.narration_asset_id===null?[]:['narration'])];
  if(new Set(metadata.clip_ids).size!==metadata.clip_ids.length||metadata.clip_ids.length!==expected.length
    ||expected.some(id=>!metadata.clip_ids.includes(id)))fail('REVISION_CONFLICT','Native consumer membership differs');
  type Consumer={clip_id:string;kind:'visual'|'concept'|'narration';shot_id:string|null;paragraph_id:string|null;
    asset_id:string|null;start_frame:number;end_frame_exclusive:number};
  let start=0;
  const nativeClips:Consumer[]=[];
  for(const shot of draft.storyboard.shots){const begin=start;start+=shot.duration_frames;
    const range={shot_id:shot.shot_id,paragraph_id:shot.paragraph_id,start_frame:begin,end_frame_exclusive:start};
    nativeClips.push({...range,clip_id:'shot-'+shot.shot_id,kind:'visual',asset_id:shot.asset_id});
    // Match the actual assembler's separate editable page above an asset-backed shot.
    // A concept-only shot already uses shot-<id> and must not acquire a second clip.
    if(shot.asset_id!==null&&shot.concept_text)nativeClips.push({...range,clip_id:'concept-'+shot.shot_id,kind:'concept',asset_id:null});
  }
  if(start!==metadata.frame_count)fail('REVISION_CONFLICT','Native consumer frames differ');
  if(draft.narration_asset_id!==null)nativeClips.push({clip_id:'narration',kind:'narration',shot_id:null,paragraph_id:null,
    asset_id:draft.narration_asset_id,start_frame:0,end_frame_exclusive:metadata.frame_count});
  return {clips:nativeClips,narration_asset_id:draft.narration_asset_id,subtitles:metadata.subtitles,
    assets:metadata.assets.map(a=>({asset_id:a.asset_id,path:a.path,rights_ref:a.rights_ref})).sort((a,b)=>a.asset_id<b.asset_id?-1:1)};
}
// The returned token contains no issuer, guards, geometry or validation machinery.
// Runtime authority is held only in this module-private record, never on the token.
const liveProofs=new WeakMap<object,PublicationRecord>();
export function isCreatedSourcePublicationProof(value:unknown):value is CreatedSourcePublicationProof {
  return !!value&&typeof value==='object'&&liveProofs.get(value)?.issuer.isUsable()===true;
}
export function createdSourcePublicationFacts(value:unknown):CreatedSourcePublicationFacts|undefined {
  return value&&typeof value==='object'?liveProofs.get(value)?.facts:undefined;
}
export function assertCreatedPublicationForCommit(value:unknown,owner:RevisionStore,expected:PublicationCommitExpectation):{readonly geometry:CreatedSourceFact} {
  if(!value||typeof value!=='object')fail('REVISION_CONFLICT','Publication proof missing');
  const proof=liveProofs.get(value);if(!proof)fail('REVISION_CONFLICT','Publication proof is not issued');
  proof.issuer.assertCurrentForCommit(value,owner,expected);
  return {geometry:proof.geometry};
}
export interface CreatedSourcePublisherOptions {
  readonly revisions:RevisionStore;readonly authorRoot:string;readonly privateRoot:string;
  readonly snapshots:SnapshotStore;readonly selection:CreatedSourceSelectionPort;readonly assets:LocalAssetRegistry;
  readonly tasks:CreatedTaskStore;readonly verifier:PreparedDraftVerifier;readonly stageDomainRoot:string;
  readonly now?:()=>Date;readonly fsync?:(path:string)=>Promise<void>;
}
export interface PublishCreatedSourceInput {
  readonly project_id:string;readonly transaction_id:string;readonly prepared_source_id:string;readonly stage_root:string;
  readonly files:readonly PreparedSourceFileFact[];readonly original_source_digest:string;readonly published_source_digest:string;
  readonly target_snapshot_id:string;
}
export class CreatedSourcePublisher {
  readonly #db:DatabaseSync;readonly #owner:RevisionStore;readonly #authorRoot:string;readonly #privateRoot:string;
  readonly #snapshots:SnapshotStore;readonly #selection:CreatedSourceSelectionPort;readonly #assets:LocalAssetRegistry;
  readonly #tasks:CreatedTaskStore;readonly #verifier:PreparedDraftVerifier;readonly #stageDomainRoot:string;
  readonly #now:()=>Date;readonly #fsync:(path:string)=>Promise<void>;readonly #instance=`publisher_${randomUUID()}`;
  readonly #issued=new Set<object>();readonly #pending=new Set<Promise<unknown>>();
  readonly #cleanup=new PublicationCleanup();
  readonly #identities:CreatedPublicationIdentityStore;
  readonly #fsyncHandles=new Set<FileHandle>();
  #failed=false;#closed=false;#closing:Promise<void>|undefined;
  constructor(options:CreatedSourcePublisherOptions){
    this.#owner=options.revisions;this.#db=options.revisions.compose(db=>db);this.#authorRoot=resolve(options.authorRoot);this.#privateRoot=resolve(options.privateRoot);
    this.#stageDomainRoot=resolve(options.stageDomainRoot);
    this.#snapshots=options.snapshots;this.#selection=options.selection;this.#assets=options.assets;this.#tasks=options.tasks;this.#verifier=options.verifier;this.#now=options.now??(()=>new Date());
    this.#fsync=options.fsync??(async path=>{
      const fd=await open(path,constants.O_RDONLY);this.#fsyncHandles.add(fd);
      let primary:unknown,failed=false;
      try{await fd.sync();}catch(error){primary=error;failed=true;throw error;}
      finally{try{await fd.close();this.#fsyncHandles.delete(fd);}catch(error){
        this.#cleanup.recordFailure(fd,error);
        throw new PublicationCleanupError([...(failed?[primary]:[]),error]);
      }}
    });
    const exists=this.#db.prepare("SELECT name FROM sqlite_master WHERE name='created_publication_journal'").get();
    if(!exists)this.#db.exec(CREATED_PUBLICATION_JOURNAL_DDL);
    else if(!matchesFrozenSchemaNamespace(this.#db,CREATED_PUBLICATION_JOURNAL_DDL,'created_publication_journal'))fail('REVISION_CONFLICT','Publication journal schema differs');
    this.#identities=new CreatedPublicationIdentityStore(this.#owner);
  }
  get instance():string{return this.#instance;}
  isUsable():boolean{return !this.#closed&&!this.#failed;}
  #assertOpen():void{if(!this.isUsable())fail('REVISION_CONFLICT','Publisher is not usable');}
  publish(input:PublishCreatedSourceInput):Promise<CreatedSourcePublicationProof>{
    this.#assertOpen();const cleanupOwner={};
    const task=Promise.resolve().then(()=>this.#publish(freeze(structuredClone(input)))).catch(error=>{
      if(error instanceof PublicationCleanupError || (error && typeof error==='object' && 'requires_reconciliation' in error && error.requires_reconciliation===true)){
        this.#failed=true;this.#cleanup.recordFailure(cleanupOwner,error);
      }
      throw error;
    });this.#pending.add(task);
    return task.finally(()=>this.#pending.delete(task));
  }
  #row(sql:string,...args:string[]):Record<string,unknown>{const value=this.#db.prepare(sql).get(...args);if(!value)fail('REVISION_CONFLICT','Publication fact missing');return value;}
  #plan(input:PublishCreatedSourceInput):PreparedAdoptionPlanV1{
    const transaction=this.#owner.projectTransaction(input.transaction_id);
    const fact=this.#row('SELECT * FROM created_adoption_fact WHERE transaction_id=?',input.transaction_id);
    const row=this.#row('SELECT * FROM created_impact_fact WHERE impact_id=?',String(fact.impact_id));
    const plan=assertPreparedAdoptionPlan(JSON.parse(String(row.plan_json)) as PreparedAdoptionPlanV1);
    const digest=preparedAdoptionPlanDigest(plan),active=this.#owner.activeCommit(input.project_id);
    const engine=this.#owner.readEngineBinding(input.project_id);
    if(!transaction||!isCreatedSourceApplyTransaction(transaction)||transaction.project_id!==input.project_id||transaction.state!=='prepared'
      ||fact.project_id!==input.project_id||fact.prepared_source_id!==input.prepared_source_id
      ||row.prepared_source_id!==input.prepared_source_id||digest!==row.plan_sha256||digest!==fact.plan_sha256||digest!==fact.facts_digest
      ||plan.project_id!==input.project_id||plan.materialization_id!==input.prepared_source_id
      ||plan.engine_upstream_sha!==OPENFILM_UPSTREAM_SHA||engine?.engine!=='openfilm'||engine.engine_upstream_sha!==plan.engine_upstream_sha
      ||plan.base_source_digest!==input.original_source_digest||plan.target_source_digest!==input.published_source_digest
      ||plan.target_snapshot_id!==input.target_snapshot_id||plan.target_snapshot_id!==snapshotIdFor(input.project_id,plan.target_source_digest)
      ||canonicalDigest(plan.files)!==canonicalDigest(input.files)||fact.stage_root!==input.stage_root
      ||!active||active.source_digest!==plan.base_source_digest||active.revision!==plan.base_revision
      ||this.#owner.controlRevision(input.project_id,0)!==plan.control_revision||this.#selection.currentSelectionVersion(input.project_id)!==plan.selection_version)
      fail('REVISION_CONFLICT','Publication bindings changed');
    if(this.#owner.activeLocks(input.project_id).some(lock=>lock.active))fail('REVISION_CONFLICT','Publication target is locked');
    const approval=this.#row('SELECT * FROM cp_a0_approval WHERE project_id=? AND run_id=? AND approval_id=?',input.project_id,plan.producer_execution.run_id,String(fact.approval_id));
    const impact=this.#row('SELECT * FROM impact WHERE impact_id=?',String(fact.impact_id));
    if(approval.state!=='active'||Number(approval.expires_at)<=Math.floor(this.#now().getTime()/1000)||approval.facts_digest!==digest
      ||approval.impact_id!==fact.impact_id||impact.state!=='active'||Date.parse(String(impact.expires_at))<=this.#now().getTime())fail('REVISION_CONFLICT','Publication approval expired');
    return plan;
  }
  #registry(project:string,metadata:readonly {asset_id:string}[]):LocalAsset[]{
    return metadata.map(asset=>{
      const row=this.#row('SELECT fact_json,fact_sha256 FROM created_local_asset WHERE project_id=? AND asset_id=?',project,asset.asset_id);
      const fact=JSON.parse(String(row.fact_json)) as LocalAsset;
      if(canonicalDigest(fact)!==row.fact_sha256||fact.project_id!==project||fact.asset_id!==asset.asset_id
        ||fact.license.status!=='cleared'||fact.license.commercial_use!==true)fail('REVISION_CONFLICT','Source rights are unavailable');
      this.#assets.blobPathForFact(fact);return fact;
    }).sort((a,b)=>a.asset_id<b.asset_id?-1:a.asset_id>b.asset_id?1:0);
  }
  #semanticPlan(plan:PreparedAdoptionPlanV1,metadata:PreparedNativeMetadata,draft:PreparedNativeConsumerPlan,registry:readonly LocalAsset[],completed:CompletedPreparedSourceV1):void {
    const file=(path:string)=>{const result=plan.files.find(f=>f.relative_path===path);if(!result)fail('REVISION_CONFLICT','A native plan file is missing');return result;};
    const captions=metadata.subtitles.map(s=>file(s.path)).sort((a,b)=>a.relative_path<b.relative_path?-1:1);
    const markers=plan.files.find(f=>f.relative_path==='.film/markers.json');
    const native={native_plan_sha256:completed.fact.plan_digest,film_sha256:file('film.html').sha256,film_bytes:file('film.html').bytes,
      settings_digest:file('.film/settings.json').sha256,subtitle_style_digest:file('.film/subtitles.json').sha256,
      captions_digest:captions.length===1?captions[0]!.sha256:canonicalDigest(captions),markers_digest:markers?.sha256??canonicalDigest([])};
    const rights=registry.map(a=>({ref_id:a.rights_ref,artifact_version:1,sha256:a.registration_digest})).sort((a,b)=>a.ref_id<b.ref_id?-1:1);
    const graph=preparedSourceConsumerGraph(metadata,draft);
    const ranges=graph.clips.map(c=>({start_frame:c.start_frame,end_frame_exclusive:c.end_frame_exclusive,clip_id:c.clip_id}));
    const orderedRanges=(v:typeof ranges)=>[...v].sort((a,b)=>a.start_frame-b.start_frame||a.end_frame_exclusive-b.end_frame_exclusive||(a.clip_id<b.clip_id?-1:a.clip_id>b.clip_id?1:0));
    if(completed.fact.plan_digest!==metadata.plan_digest||canonicalDigest(plan.native_plan)!==canonicalDigest(native)
      ||canonicalDigest([...plan.roots].sort())!==canonicalDigest([...completed.fact.roots].sort())
      ||canonicalDigest(ordered(plan.files))!==canonicalDigest(ordered(completed.fact.files))
      ||canonicalDigest([...plan.rights].sort((a,b)=>a.ref_id<b.ref_id?-1:1))!==canonicalDigest(rights)
      ||plan.consumer.project_id!==plan.project_id||plan.consumer.run_id!==completed.task.request.execution.run_id
      ||plan.consumer.consumer_id!=='native'||plan.consumer.graph_digest!==canonicalDigest(graph)
      ||canonicalDigest(orderedRanges([...plan.affected_ranges]))!==canonicalDigest(orderedRanges(ranges))
      ||plan.locks_checked.length!==0||plan.frame_count!==metadata.frame_count
      ||plan.fps_numerator!==metadata.fps.num||plan.fps_denominator!==metadata.fps.den)
      fail('REVISION_CONFLICT','Approved native plan contradicts the prepared source');
  }
  async #publish(input:PublishCreatedSourceInput):Promise<CreatedSourcePublicationProof>{
    this.#assertOpen();this.#plan(input);
    const mapping=this.#row('SELECT job_id,stage_root FROM created_prepared_source WHERE prepared_source_id=?',input.prepared_source_id);
    const taskInput=this.#row('SELECT principal_id FROM created_task_input WHERE job_id=?',String(mapping.job_id));
    const task=this.#tasks.read(String(mapping.job_id),String(taskInput.principal_id));
    const fact=this.#tasks.readPrepared(task.job_id,task.principal_id),attempt=this.#tasks.preparedLeaseAttempt(task.job_id,task.principal_id);
    if(!fact||attempt===null)fail('REVISION_CONFLICT','Prepared producer is unavailable');
    const expected=resolve(this.#stageDomainRoot,task.stage_token,'attempt-'+attempt,'source');
    if(input.stage_root!==expected||mapping.stage_root!==expected)fail('REVISION_CONFLICT','Prepared location is not producer-owned');
    const held=new RetainedTree(expected,fact.files);
    let result:CreatedSourcePublicationProof|undefined,primary:unknown;
    try{result=await this.#publishGuarded(input,held);return result;}
    catch(error){primary=error;throw error;}
    finally{
      this.#cleanup.register(held,[{identity:held,close:()=>held.close()}]);
      try{this.#cleanup.run(held);}
      catch(error){
        this.#failed=true;const failures:unknown[]=[...(primary===undefined?[]:[primary]),error];
        if(result)try{this.release(result);}catch(releaseError){failures.push(releaseError);}
        throw new PublicationCleanupError(failures);
      }
    }
  }
  async #publishGuarded(input:PublishCreatedSourceInput,held:RetainedTree):Promise<CreatedSourcePublicationProof>{
    this.#assertOpen();const plan=this.#plan(input),active=this.#owner.activeCommit(input.project_id)!;
    const originalRow=this.#row('SELECT fact_json,fact_sha256 FROM created_source_fact WHERE project_id=? AND snapshot_id=?',input.project_id,active.snapshot_id);
    const original=validateCreatedSourceFact(JSON.parse(String(originalRow.fact_json)) as CreatedSourceFact);
    if(canonicalDigest(original)!==originalRow.fact_sha256)fail('REVISION_CONFLICT','Original source geometry differs');
    const originalDigest=await computeSourceDigest({root:this.#authorRoot,roots:original.roots,engine:'openfilm',engineUpstreamSha:OPENFILM_UPSTREAM_SHA});
    if(originalDigest.external_reference_count||originalDigest.source_digest!==plan.base_source_digest)fail('REVISION_CONFLICT','Original source bytes differ');
    const targetDigest=await computeSourceDigest({root:input.stage_root,roots:['film.html',...plan.roots.filter(root=>root!=='film.html')],engine:'openfilm',engineUpstreamSha:OPENFILM_UPSTREAM_SHA});
    const targetFiles=manifestFiles(targetDigest);
    if(targetDigest.external_reference_count||targetDigest.source_digest!==plan.target_source_digest
      ||canonicalDigest(targetFiles)!==canonicalDigest(ordered(plan.files)))fail('REVISION_CONFLICT','Prepared source differs');
    const metadata=JSON.parse(held.readBytes('prepared-native.json').toString('utf8')) as PreparedNativeMetadata;
    const draft=JSON.parse(held.readBytes('draft-plan.json').toString('utf8')) as PreparedNativeConsumerPlan;
    if(metadata.format!=='narralens.prepared-native-output@1'||metadata.project_id!==input.project_id||metadata.frame_count!==plan.frame_count
      ||metadata.fps.num!==plan.fps_numerator||metadata.fps.den!==plan.fps_denominator)fail('REVISION_CONFLICT','Prepared native geometry differs');
    const geometry=freeze(validateCreatedSourceFact({schema_version:1,roots:['film.html',...plan.roots.filter(root=>root!=='film.html')],subtitles:metadata.subtitles,
      frame_count:metadata.frame_count,fps:metadata.fps,assets:metadata.assets.map(a=>({asset_id:a.asset_id,path:a.path,sha256:a.sha256,bytes:a.bytes,duration_frames:a.duration_frames,media_type:a.media_type,source:a.source,license:a.license}))}));
    const registry=this.#registry(input.project_id,geometry.assets);
    const prepared=this.#row('SELECT rights_digest FROM created_prepared_source WHERE prepared_source_id=?',input.prepared_source_id);
    if(canonicalDigest(registry)!==prepared.rights_digest)fail('REVISION_CONFLICT','Prepared rights drifted');
    for(const asset of geometry.assets){const registered=registry.find(a=>a.asset_id===asset.asset_id);if(!registered||registered.sha256!==asset.sha256||registered.bytes!==asset.bytes
      ||canonicalDigest(registered.source)!==canonicalDigest(asset.source)||canonicalDigest(registered.license)!==canonicalDigest(asset.license))fail('REVISION_CONFLICT','Native asset differs from rights');}
    const mapping=this.#row('SELECT * FROM created_prepared_source WHERE prepared_source_id=?',input.prepared_source_id);
    const taskInput=this.#row('SELECT principal_id FROM created_task_input WHERE job_id=?',String(mapping.job_id));
    const task=this.#tasks.read(String(mapping.job_id),String(taskInput.principal_id));
    const fact=this.#tasks.readPrepared(task.job_id,task.principal_id),attempt=this.#tasks.preparedLeaseAttempt(task.job_id,task.principal_id);
    const job=this.#row('SELECT terminal_reason,provider_receipt_json FROM job WHERE job_id=?',task.job_id);
    if(!fact||attempt===null||canonicalDigest(fact)!==mapping.fact_digest
      ||mapping.project_id!==input.project_id||mapping.request_digest!==task.request_digest
      ||mapping.plan_sha256!==fact.plan_digest||mapping.rights_digest!==fact.rights_digest
      ||fact.source_digest!==plan.target_source_digest||mapping.stage_root!==input.stage_root
      ||mapping.source_digest!==plan.base_source_digest||Number(mapping.base_revision)!==plan.base_revision
      ||canonicalDigest(JSON.parse(String(mapping.execution_json)))!==canonicalDigest(task.request.execution))
      fail('REVISION_CONFLICT','Prepared producer fact differs');
    const completed:CompletedPreparedSourceV1={format:'narralens.completed-prepared-source@1',project_id:input.project_id,task,
      producer_attempt:attempt,job:this.#tasks.receipt(task.job_id,task.principal_id),terminal_reason:job.terminal_reason as 'SOURCE_ONLY',
      provider_receipt:JSON.parse(String(job.provider_receipt_json)) as CompletedPreparedSourceV1['provider_receipt'],fact,root:input.stage_root};
    this.#semanticPlan(plan,metadata,draft,registry,completed);
    const adoption=this.#row('SELECT impact_id,approval_id FROM created_adoption_fact WHERE transaction_id=?',input.transaction_id);
    const impact=this.#row('SELECT impact_hash FROM impact WHERE impact_id=?',String(adoption.impact_id));
    const adoptionBinding:PreparedAdoptionBindingV1={purpose:'adoption',project_id:input.project_id,run_id:plan.producer_execution.run_id,
      execution:plan.producer_execution,prepared_source_id:input.prepared_source_id,prepared_job_id:task.job_id,fact_digest:plan.prepared_fact_digest,
      base_revision:plan.base_revision,control_revision:plan.control_revision,source_digest:plan.base_source_digest,selection_version:plan.selection_version,
      transaction_id:input.transaction_id,impact_id:String(adoption.impact_id),impact_hash:String(impact.impact_hash),plan_sha256:preparedAdoptionPlanDigest(plan),
      approval_id:String(adoption.approval_id),target_snapshot_id:plan.target_snapshot_id};
    const preparedProof=await this.#verifier.proveForAdoption(completed,adoptionBinding,registry);
    const originalFiles=manifestFiles(originalDigest),blobGuards:RetainedTree[]=[];
    let originalGuard:RetainedTree|undefined,stageGuard:RetainedTree|undefined,workspace='',moved=false,published=false,transferred=false;
    const finalGuards:RetainedTree[]=[];let issuedToken:object|undefined;
    const cleanupOwner={};let primary:unknown;
    try{
      originalGuard=new RetainedTree(this.#authorRoot,originalFiles);stageGuard=new RetainedTree(input.stage_root,targetFiles);
      for(const asset of registry){const path=this.#assets.blobPathForFact(asset);blobGuards.push(new RetainedTree(dirname(path),[{relative_path:basename(path),sha256:asset.sha256,bytes:asset.bytes}],false));}
      workspace=resolve(this.#privateRoot,`publication-${randomUUID()}`);const staged=resolve(workspace,'staging'),backup=resolve(workspace,'backup');
      await mkdir(staged,{recursive:true,mode:0o700});
      for(const file of targetFiles){const target=resolve(staged,file.relative_path);await mkdir(dirname(target),{recursive:true,mode:0o700});await copyFile(resolve(input.stage_root,file.relative_path),target);await this.#fsync(target);}
      const directories=new Set<string>();for(const file of targetFiles){let p=dirname(resolve(staged,file.relative_path));while(p.startsWith(staged+sep)){directories.add(p);p=dirname(p);}}
      for(const directory of [...directories].sort((a,b)=>b.length-a.length))await this.#fsync(directory);
      await this.#fsync(staged);await this.#fsync(workspace);
      originalGuard.verify();stageGuard.verify();for(const guard of blobGuards)guard.verify();this.#plan(input);this.#assertOpen();
      const snapshot=await this.#snapshots.publish({projectId:input.project_id,engine:'openfilm',engineUpstreamSha:OPENFILM_UPSTREAM_SHA,sourceRoot:staged,roots:geometry.roots});
      if(snapshot.snapshot_id!==plan.target_snapshot_id||snapshot.source_digest!==plan.target_source_digest)fail('REVISION_CONFLICT','Snapshot differs from target');
      const snapshotSource=resolve(this.#snapshots.snapshotRoot(input.project_id,snapshot.snapshot_id),'source');
      const snapshotGuard=new RetainedTree(snapshotSource,targetFiles);finalGuards.push(snapshotGuard);
      originalGuard.verify();stageGuard.verify();for(const guard of blobGuards)guard.verify();this.#plan(input);this.#assertOpen();
      // Capture the actual isolated copy, not the producer stage that was copied.
      // Both durable facts commit together before either source directory is moved.
      const isolatedGuard=new RetainedTree(staged,targetFiles);finalGuards.push(isolatedGuard);
      this.#owner.atomic(()=>{
        this.#identities.record({transaction_id:input.transaction_id,project_id:input.project_id,
          original_source_digest:plan.base_source_digest,target_source_digest:plan.target_source_digest,target_snapshot_id:plan.target_snapshot_id,
          original_tree:originalGuard!.identity(),target_tree:isolatedGuard.identity(),snapshot_tree:snapshotGuard.identity(),
          snapshot_container:snapshotGuard.directoryIdentity(dirname(snapshotSource))},this.#now());
        this.#journal(input,'prepared',staged,backup,targetFiles);
      });
      await rename(this.#authorRoot,backup);moved=true;
      originalGuard.relocatedTo(backup);
      await rename(staged,this.#authorRoot);published=true;
      isolatedGuard.relocatedTo(this.#authorRoot);
      await this.#fsync(dirname(this.#authorRoot));await this.#fsync(workspace);
      originalGuard.verify();
      const backupGuard=originalGuard;finalGuards.push(backupGuard);originalGuard=undefined;
      for(const guard of finalGuards)guard.verify();for(const guard of blobGuards)guard.verify();this.#assertOpen();
      this.#journal(input,'published',staged,backup,targetFiles);
      const facts=freeze({publisher_instance:this.#instance,project_id:input.project_id,transaction_id:input.transaction_id,
        prepared_source_id:input.prepared_source_id,original_source_digest:plan.base_source_digest,published_source_digest:plan.target_source_digest,
        target_snapshot_id:plan.target_snapshot_id,published_files:targetFiles,journal_id:`${input.transaction_id}:published`,backup_root:backup,issued_at:this.#now().toISOString()});
      const proof=Object.freeze({facts});
      const record:PublicationRecord=Object.freeze({facts,issuer:this,guards:Object.freeze([...finalGuards,...blobGuards]),geometry,
        plan:freeze(structuredClone(plan)),registry:freeze(structuredClone(registry)),completed:freeze(structuredClone(completed)),
        adoptionBinding:freeze(adoptionBinding),preparedProof,metadata:freeze(structuredClone(metadata)),draft:freeze(structuredClone(draft)),
        originalTree:backupGuard,targetTree:isolatedGuard,snapshotTree:snapshotGuard,snapshotContainer:dirname(snapshotSource)});
      liveProofs.set(proof,record);this.#issued.add(proof);issuedToken=proof;
      this.assertCurrentForCommit(proof,this.#owner,{...input,selection_version:plan.selection_version});
      transferred=true;return proof;
    }catch(error){
      primary=error;this.#failed=true;
      if(issuedToken)this.#retire(issuedToken);
      throw error;
    }finally{
      const guards=[...(originalGuard?[originalGuard]:[]),...(stageGuard?[stageGuard]:[]),
        ...(!transferred?[...finalGuards,...blobGuards]:[])];
      const resources:PublicationCleanupResource[]=guards.map(guard=>({identity:guard,close:()=>guard.close()}));
      if(!transferred)resources.push({identity:preparedProof,close:()=>this.#verifier.release(preparedProof)});
      this.#cleanup.register(cleanupOwner,resources);
      const failures:unknown[]=[];
      try{this.#cleanup.run(cleanupOwner);}catch(error){failures.push(error);}
      // After either rename preserve original backup/journal for recovery. Never
      // erase evidence or claim an unproven compensation succeeded.
      if(primary!==undefined&&!moved&&workspace)try{await rm(workspace,{recursive:true,force:true});}
      catch(error){this.#cleanup.recordFailure(cleanupOwner,error);failures.push(error);}
      // A temporary-guard cleanup failure after issuance must also revoke the
      // would-be returned token and attempt every transferred resource.
      if(failures.length&&issuedToken)this.#retire(issuedToken);
      if(issuedToken&&!liveProofs.has(issuedToken))try{this.#cleanup.run(issuedToken);}catch(error){failures.push(error);}
      if(failures.length){this.#failed=true;throw new PublicationCleanupError([...(primary===undefined?[]:[primary]),...failures]);}
      void published;
    }
  }
  assertCurrentForCommit(value:unknown,owner:RevisionStore,expected:PublicationCommitExpectation):void{
    this.#assertOpen();if(owner!==this.#owner||!value||typeof value!=='object')fail('REVISION_CONFLICT','Publication owner differs');
    const proof=liveProofs.get(value);if(!proof||proof.issuer!==this||!this.#issued.has(value))fail('REVISION_CONFLICT','Publication proof is not owned');
    for(const field of ['project_id','transaction_id','prepared_source_id','original_source_digest','published_source_digest','target_snapshot_id'] as const)
      if(proof.facts[field]!==expected[field])fail('REVISION_CONFLICT','Publication proof binding differs');
    if(this.#selection.currentSelectionVersion(expected.project_id)!==expected.selection_version||proof.plan.selection_version!==expected.selection_version)
      fail('REVISION_CONFLICT','Selection changed');
    const journal=this.journal(proof.facts.journal_id);
    if(!journal||journal.phase!=='published'||journal.author_root!==this.#authorRoot||journal.backup_root!==proof.facts.backup_root
      ||journal.project_id!==expected.project_id||journal.transaction_id!==expected.transaction_id||journal.prepared_source_id!==expected.prepared_source_id
      ||journal.original_source_digest!==expected.original_source_digest||journal.published_source_digest!==expected.published_source_digest
      ||journal.target_snapshot_id!==expected.target_snapshot_id||canonicalDigest(journal.files)!==canonicalDigest(proof.facts.published_files))fail('REVISION_CONFLICT','Publication journal differs');
    const registry=this.#registry(expected.project_id,proof.geometry.assets);
    if(canonicalDigest(registry)!==canonicalDigest(proof.registry))fail('REVISION_CONFLICT','Publication rights changed');
    this.#semanticPlan(proof.plan,proof.metadata,proof.draft,registry,proof.completed);
    this.#verifier.assertCurrentForAdoption(proof.completed,proof.adoptionBinding,proof.preparedProof,()=>{
      const actual=this.#registry(expected.project_id,proof.geometry.assets);
      if(canonicalDigest(actual)!==canonicalDigest(proof.registry))fail('REVISION_CONFLICT','Source rights changed');
    });
    for(const guard of proof.guards)guard.verify();
    this.#identities.assertCurrent(expected.transaction_id,proof.originalTree,proof.targetTree,proof.snapshotTree,proof.snapshotContainer);
  }
  async verify(value:unknown,expected:Omit<PublicationCommitExpectation,'selection_version'>):Promise<void>{
    if(!value||typeof value!=='object')fail('REVISION_CONFLICT','Proof missing');const proof=liveProofs.get(value);if(!proof)fail('REVISION_CONFLICT','Proof not issued');
    this.assertCurrentForCommit(value,this.#owner,{...expected,selection_version:proof.plan.selection_version});
  }
  #retire(value:object):void{
    const proof=liveProofs.get(value);if(!proof||proof.issuer!==this)return;
    // Preserve all cleanup ownership BEFORE revoking opaque commit authority.
    this.#cleanup.register(value,[{identity:proof.preparedProof,close:()=>this.#verifier.release(proof.preparedProof)},
      ...proof.guards.map(guard=>({identity:guard,close:()=>guard.close()}))]);
    liveProofs.delete(value);this.#issued.delete(value);
  }
  release(value:unknown):void{
    if(!value||typeof value!=='object')return;
    this.#retire(value);
    try{this.#cleanup.run(value);}catch(error){this.#failed=true;throw error;}
  }
  close():Promise<void>{
    this.#closed=true;if(this.#closing)return this.#closing;
    const closing=(async()=>{
      await Promise.allSettled([...this.#pending]);
      for(const proof of [...this.#issued])this.#retire(proof);
      const failures:unknown[]=[];
      try{this.#cleanup.drain();}catch(error){failures.push(error);}
      // Retry only the original FileHandle operation, never an unowned numeric FD.
      // Historical close uncertainty remains sticky even if this is now a no-op.
      for(const handle of [...this.#fsyncHandles])try{await handle.close();this.#fsyncHandles.delete(handle);}
      catch(error){this.#cleanup.recordFailure(handle,error);failures.push(error);}
      if(failures.length)throw new PublicationCleanupError(failures);
    })();
    this.#closing=closing;
    void closing.catch(()=>{if(this.#closing===closing)this.#closing=undefined;});
    return closing;
  }
  journal(id:string):PublicationJournalRow|undefined{
    const r=this.#db.prepare('SELECT * FROM created_publication_journal WHERE journal_id=?').get(id);if(!r)return undefined;
    return {journal_id:String(r.journal_id),project_id:String(r.project_id),transaction_id:String(r.transaction_id),prepared_source_id:String(r.prepared_source_id),phase:String(r.phase) as PublicationPhase,
      original_source_digest:String(r.original_source_digest),published_source_digest:String(r.published_source_digest),target_snapshot_id:String(r.target_snapshot_id),author_root:String(r.author_root),backup_root:String(r.backup_root),staging_root:String(r.staging_root),files:JSON.parse(String(r.files_json)) as PreparedSourceFileFact[],created_at:String(r.created_at)};
  }
  journalOf(transactionId:string):PublicationJournalRow[]{return this.#db.prepare('SELECT journal_id FROM created_publication_journal WHERE transaction_id=? ORDER BY created_at,journal_id').all(transactionId).map(r=>this.journal(String(r.journal_id))!);}
  #journal(input:PublishCreatedSourceInput,phase:PublicationPhase,staging:string,backup:string,files:readonly PreparedSourceFileFact[]):void{
    const id=`${input.transaction_id}:${phase}`;if(this.journal(id))fail('REVISION_CONFLICT','Publication phase already exists');
    this.#db.prepare('INSERT INTO created_publication_journal VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.project_id,input.transaction_id,input.prepared_source_id,phase,input.original_source_digest,input.published_source_digest,input.target_snapshot_id,this.#authorRoot,backup,staging,canonicalJson(files),this.#now().toISOString());
  }
}
function ordered(files:readonly PreparedSourceFileFact[]):PreparedSourceFileFact[]{return [...files].map(f=>({relative_path:f.relative_path,bytes:f.bytes,sha256:f.sha256})).sort((a,b)=>a.relative_path<b.relative_path?-1:a.relative_path>b.relative_path?1:0);}
function manifestFiles(digest:SourceDigestResult):PreparedSourceFileFact[]{return ordered([...digest.manifest.files,...digest.manifest.assets].map(f=>({relative_path:f.path,sha256:f.sha256,bytes:f.size})));}
export async function createdSourceAuthorRootExists(root:string):Promise<boolean>{return access(root).then(()=>true,()=>false);}
