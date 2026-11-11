import { createHash, randomUUID } from 'node:crypto';
import { constants,openSync,closeSync,lstatSync,realpathSync,fstatSync,readdirSync,readSync,type BigIntStats } from 'node:fs';
import { access, copyFile, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, basename, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson, canonicalDigest } from '../creative/digest.js';
import { RevisionStore } from '../projects/revision-store.js';
import { matchesFrozenSchemaNamespace } from './agent-schema-definition.js';
import { assertSafeRelativePath } from '../render/snapshot-copy.js';
import {assertPreparedAdoptionPlan,preparedAdoptionPlanDigest,type PreparedAdoptionPlanV1,type CreatedSourcePublicationFacts,type CreatedSourcePublicationProof,type PreparedSourceFileFact} from './created-source-ports.js';
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

/** A retained tree guards original file descriptors, names and complete membership. */
class RetainedTree {
  readonly #dirs = new Map<string, {fd:number; identity:string}>();
  readonly #files = new Map<string, {fd:number; fingerprint:string; bytes:number; sha256:string}>();
  #closed = false;
  #root:string;
  get root():string{return this.#root;}
  constructor(root:string, files:readonly PreparedSourceFileFact[], private readonly whole=true) {
    this.#root=root;
    try {
      this.#directory(root);
      for (const file of files) {
        assertSafeRelativePath(file.relative_path);
        const path=resolve(root,file.relative_path),parent=this.#directory(dirname(path));
        const fd=openSync(`/proc/self/fd/${parent.fd}/${basename(path)}`,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
        this.#files.set(file.relative_path,{fd,fingerprint:'',bytes:file.bytes,sha256:file.sha256});
        const info=fstatSync(fd,{bigint:true});
        this.#files.set(file.relative_path,{fd,fingerprint:stamp(info),bytes:file.bytes,sha256:file.sha256});
        if(!info.isFile())fail('REVISION_CONFLICT','The source entry is not a regular file');
      }
      this.verify();
    } catch(error) { this.close(); throw error; }
  }
  /** Follow the actual retained directory through a Host rename. Never reopen the
   * backup and establish a new inode as authority merely because its bytes match. */
  relocatedTo(nextRoot:string):void {
    if(this.#closed||resolve(nextRoot)!==nextRoot)fail('REVISION_CONFLICT','Invalid backup relocation');
    const original=this.#dirs.get(this.#root);
    if(!original||realpathSync(`/proc/self/fd/${original.fd}`)!==nextRoot)
      fail('REVISION_CONFLICT','Original backup identity was not retained');
    const previous=this.#root,entries=[...this.#dirs.entries()];
    for(const [path] of entries)if(path===previous||path.startsWith(previous+sep))this.#dirs.delete(path);
    for(const [path,value] of entries)if(path===previous||path.startsWith(previous+sep))this.#dirs.set(nextRoot+path.slice(previous.length),value);
    this.#root=nextRoot;this.#directory(dirname(nextRoot));this.verify();
  }
  #directory(path:string):{fd:number;identity:string} {
    const old=this.#dirs.get(path);if(old)return old;
    const parent=path==='/'?null:this.#directory(dirname(path));
    const fd=openSync(parent?`/proc/self/fd/${parent.fd}/${basename(path)}`:'/',constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    const entry={fd,identity:''};this.#dirs.set(path,entry);const info=fstatSync(fd,{bigint:true});entry.identity=directoryStamp(info);
    if(!info.isDirectory()||realpathSync(`/proc/self/fd/${fd}`)!==path)fail('REVISION_CONFLICT','Source root identity differs');
    return entry;
  }
  verify():void {
    if(this.#closed)fail('REVISION_CONFLICT','The source guard was released');
    for(const [path,d] of this.#dirs){
      const named=lstatSync(path,{bigint:true});
      if(!named.isDirectory()||named.isSymbolicLink()||directoryStamp(named)!==d.identity
        ||directoryStamp(fstatSync(d.fd,{bigint:true}))!==d.identity||realpathSync(path)!==path)
        fail('REVISION_CONFLICT','A source directory changed');
    }
    for(const [relative,file] of this.#files){
      const path=resolve(this.root,relative),d=this.#dirs.get(dirname(path));if(!d)fail('REVISION_CONFLICT','Source parent missing');
      const named=lstatSync(`/proc/self/fd/${d.fd}/${basename(path)}`,{bigint:true});
      if(!named.isFile()||named.isSymbolicLink()||stamp(named)!==file.fingerprint
        ||stamp(fstatSync(file.fd,{bigint:true}))!==file.fingerprint)fail('REVISION_CONFLICT','A source file identity changed');
      const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let offset=0;
      for(;;){const n=readSync(file.fd,buffer,0,buffer.length,offset);if(!n)break;offset+=n;if(offset>file.bytes)fail('REVISION_CONFLICT','Source size changed');hash.update(buffer.subarray(0,n));}
      if(offset!==file.bytes||hash.digest('hex')!==file.sha256||stamp(fstatSync(file.fd,{bigint:true}))!==file.fingerprint)
        fail('REVISION_CONFLICT','Source bytes changed');
    }
    if(this.whole){
      const found:string[]=[];
      const walk=(path:string,prefix:string):void=>{
        const directory=this.#dirs.get(path);if(!directory)fail('REVISION_CONFLICT','Unproven directory');
        for(const name of readdirSync(`/proc/self/fd/${directory.fd}`)){
          const rel=prefix?`${prefix}/${name}`:name,full=resolve(this.root,rel),s=lstatSync(`/proc/self/fd/${directory.fd}/${name}`);
          if(s.isSymbolicLink())fail('REVISION_CONFLICT','Source link refused');
          if(s.isDirectory())walk(full,rel);else if(s.isFile())found.push(rel);else fail('REVISION_CONFLICT','Unknown source entry');
        }
      };walk(this.root,'');
      if(canonicalDigest(found.sort())!==canonicalDigest([...this.#files.keys()].sort()))fail('REVISION_CONFLICT','Source closure membership changed');
    }
  }
  close():void {if(this.#closed)return;this.#closed=true;let failed=false;for(const f of [...this.#files.values()].reverse())try{closeSync(f.fd);}catch{failed=true;}
    for(const d of [...this.#dirs.values()].reverse())try{closeSync(d.fd);}catch{failed=true;}
    this.#files.clear();this.#dirs.clear();if(failed)fail('REVISION_CONFLICT','Source descriptors could not be closed');}
}
const directoryStamp=(s:BigIntStats)=>`${s.dev}:${s.ino}:${s.mode}:${s.uid}`;
const stamp=(s:BigIntStats)=>`${directoryStamp(s)}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
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
}
type PreparedNativeMetadata=Pick<StagedNativeDraft,'project_id'|'clip_ids'|'fps'|'frame_count'|'subtitles'|'assets'|'plan_digest'>&{readonly format:string};
type PreparedNativeConsumerPlan={readonly storyboard:Storyboard;readonly narration_asset_id:string|null};
/** Derived consumer edges of the already-verified immutable native plan. This is a
 * hash preimage, not another writable timeline or a source of approval authority. */
export function preparedSourceConsumerGraph(metadata:PreparedNativeMetadata,draft:PreparedNativeConsumerPlan){
  if(metadata.clip_ids.length!==draft.storyboard.shots.length)fail('REVISION_CONFLICT','Native consumer membership differs');
  let start=0;
  const clips=draft.storyboard.shots.map((shot,index)=>{const begin=start;start+=shot.duration_frames;
    return {clip_id:metadata.clip_ids[index]!,shot_id:shot.shot_id,paragraph_id:shot.paragraph_id,asset_id:shot.asset_id,
      start_frame:begin,end_frame_exclusive:start};});
  if(start!==metadata.frame_count)fail('REVISION_CONFLICT','Native consumer frames differ');
  return {clips,narration_asset_id:draft.narration_asset_id,subtitles:metadata.subtitles,
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
  readonly tasks:CreatedTaskStore;readonly verifier:PreparedDraftVerifier;
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
  readonly #tasks:CreatedTaskStore;readonly #verifier:PreparedDraftVerifier;
  readonly #now:()=>Date;readonly #fsync:(path:string)=>Promise<void>;readonly #instance=`publisher_${randomUUID()}`;
  readonly #issued=new Set<object>();readonly #pending=new Set<Promise<unknown>>();
  #failed=false;#closed=false;#closing:Promise<void>|undefined;
  constructor(options:CreatedSourcePublisherOptions){
    this.#owner=options.revisions;this.#db=options.revisions.compose(db=>db);this.#authorRoot=resolve(options.authorRoot);this.#privateRoot=resolve(options.privateRoot);
    this.#snapshots=options.snapshots;this.#selection=options.selection;this.#assets=options.assets;this.#tasks=options.tasks;this.#verifier=options.verifier;this.#now=options.now??(()=>new Date());
    this.#fsync=options.fsync??(async path=>{const fd=await open(path,constants.O_RDONLY);try{await fd.sync();}finally{await fd.close();}});
    const exists=this.#db.prepare("SELECT name FROM sqlite_master WHERE name='created_publication_journal'").get();
    if(!exists)this.#db.exec(CREATED_PUBLICATION_JOURNAL_DDL);
    else if(!matchesFrozenSchemaNamespace(this.#db,CREATED_PUBLICATION_JOURNAL_DDL,'created_publication_journal'))fail('REVISION_CONFLICT','Publication journal schema differs');
  }
  get instance():string{return this.#instance;}
  isUsable():boolean{return !this.#closed&&!this.#failed;}
  #assertOpen():void{if(!this.isUsable())fail('REVISION_CONFLICT','Publisher is not usable');}
  publish(input:PublishCreatedSourceInput):Promise<CreatedSourcePublicationProof>{
    this.#assertOpen();const task=Promise.resolve().then(()=>this.#publish(freeze(structuredClone(input))));this.#pending.add(task);
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
    if(!transaction||transaction.project_id!==input.project_id||transaction.state!=='prepared'
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
    const metadata=JSON.parse(await readFile(resolve(input.stage_root,'prepared-native.json'),'utf8')) as PreparedNativeMetadata;
    const draft=JSON.parse(await readFile(resolve(input.stage_root,'draft-plan.json'),'utf8')) as PreparedNativeConsumerPlan;
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
      this.#journal(input,'prepared',staged,backup,targetFiles);
      await rename(this.#authorRoot,backup);moved=true;
      originalGuard.relocatedTo(backup);
      await rename(staged,this.#authorRoot);published=true;
      await this.#fsync(dirname(this.#authorRoot));await this.#fsync(workspace);
      originalGuard.verify();
      finalGuards.push(originalGuard,new RetainedTree(this.#authorRoot,targetFiles));originalGuard=undefined;
      for(const guard of finalGuards)guard.verify();for(const guard of blobGuards)guard.verify();this.#assertOpen();
      this.#journal(input,'published',staged,backup,targetFiles);
      const facts=freeze({publisher_instance:this.#instance,project_id:input.project_id,transaction_id:input.transaction_id,
        prepared_source_id:input.prepared_source_id,original_source_digest:plan.base_source_digest,published_source_digest:plan.target_source_digest,
        target_snapshot_id:plan.target_snapshot_id,published_files:targetFiles,journal_id:`${input.transaction_id}:published`,backup_root:backup,issued_at:this.#now().toISOString()});
      const proof=Object.freeze({facts});
      const record:PublicationRecord=Object.freeze({facts,issuer:this,guards:Object.freeze([...finalGuards,...blobGuards]),geometry,
        plan:freeze(structuredClone(plan)),registry:freeze(structuredClone(registry)),completed:freeze(structuredClone(completed)),
        adoptionBinding:freeze(adoptionBinding),preparedProof,metadata:freeze(structuredClone(metadata)),draft:freeze(structuredClone(draft))});
      liveProofs.set(proof,record);this.#issued.add(proof);issuedToken=proof;
      this.assertCurrentForCommit(proof,this.#owner,{...input,selection_version:plan.selection_version});
      transferred=true;return proof;
    }catch(error){
      if(issuedToken){liveProofs.delete(issuedToken);this.#issued.delete(issuedToken);}
      this.#failed=true;
      for(const guard of finalGuards)guard.close();for(const guard of blobGuards)guard.close();
      // After either rename the durable journal and all evidence remain for recovery.
      // Never erase the original backup or conceal an unproven compensation.
      if(!moved&&workspace)await rm(workspace,{recursive:true,force:true});
      throw error;
    }finally{originalGuard?.close();stageGuard?.close();if(!transferred)this.#verifier.release(preparedProof);void published;}
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
  }
  async verify(value:unknown,expected:Omit<PublicationCommitExpectation,'selection_version'>):Promise<void>{
    if(!value||typeof value!=='object')fail('REVISION_CONFLICT','Proof missing');const proof=liveProofs.get(value);if(!proof)fail('REVISION_CONFLICT','Proof not issued');
    this.assertCurrentForCommit(value,this.#owner,{...expected,selection_version:proof.plan.selection_version});
  }
  release(value:unknown):void{
    if(!value||typeof value!=='object')return;
    const proof=liveProofs.get(value);if(!proof||proof.issuer!==this)return;liveProofs.delete(value);this.#issued.delete(value);this.#verifier.release(proof.preparedProof);for(const guard of proof.guards)guard.close();
  }
  close():Promise<void>{
    this.#closed=true;return this.#closing??=(async()=>{await Promise.allSettled([...this.#pending]);for(const proof of [...this.#issued])this.release(proof);})();
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
