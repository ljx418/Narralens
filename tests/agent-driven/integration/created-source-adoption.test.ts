import {readFile,writeFile,symlink,rename,open,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {preparedDraftFixture,waitForCompletedDraft,registryFacts} from './helpers/created-draft-fixture.js';
import {canonicalDigest} from '../../../src/host/creative/digest.js';
import {CreatedPreparedSourceStore} from '../../../src/host/agent-driven/created-prepared-source-store.js';
import {CreatedSourceImpactStore} from '../../../src/host/agent-driven/created-source-impact-store.js';
import {CreatedSourceAdoptionStore} from '../../../src/host/agent-driven/created-source-adoption-store.js';
import {CreatedSourcePublisher,isCreatedSourcePublicationProof,preparedSourceConsumerGraph} from '../../../src/host/agent-driven/created-source-publisher.js';
import {ProductSqliteRepository} from '../../../src/host/agent-driven/product-sqlite-repository.js';
import {RevisionStore} from '../../../src/host/projects/revision-store.js';
import {SnapshotStore,snapshotIdFor} from '../../../src/host/projects/snapshot-store.js';
import {ImpactStore} from '../../../src/host/impact/impact-store.js';
import {OperationIdempotencyStore} from '../../../src/host/projects/operation-idempotency-store.js';
import {computeSourceDigest} from '../../../src/host/engine/source-digest-v1.js';
import {OPENFILM_UPSTREAM_SHA} from '../../../src/host/engine/engine-binding-store.js';
import type {PreparedAdoptionPlanV1,CommitPreparedCreatedSourceInput,CreatedSourceCommitScope} from '../../../src/host/agent-driven/created-source-ports.js';
import {preparedAdoptionPlanDigest} from '../../../src/host/agent-driven/created-source-ports.js';
import type {ReviewPackage} from '../../../src/contracts/agent-driven-types.js';
import type {ProductTransaction} from '../../../src/host/creative/product-repository.js';

// This is transaction/module evidence: real Host/bootstrap/worker/native source,
// actual media and source proofs; accepted review policy is explicitly fixture data.
// It never claims that a person reviewed the film or that the review UI path passed.
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const close of cleanups.splice(0).reverse())await close();});
async function fixture(options:{mutatePlan?:(plan:PreparedAdoptionPlanV1)=>void;fsync?:(path:string)=>Promise<void>;onPrepared?:(f:Awaited<ReturnType<typeof preparedDraftFixture>>)=>void}={}){
 const f=await preparedDraftFixture();cleanups.push(f.close);f.worker.start();const completed=await waitForCompletedDraft(f);await f.worker.close();
 const revisions=f.host.revisions,repo=f.repo,now=new Date(),execution=f.task.request.execution;
 if(completed.fact.plan_digest===null)throw Error('Assembly must produce a native plan digest');
 const prepared=new CreatedPreparedSourceStore(revisions),adoptions=new CreatedSourceAdoptionStore(revisions);
 const operations=new OperationIdempotencyStore(revisions.compose(db=>db));
 const impacts=new CreatedSourceImpactStore(revisions,new ImpactStore(revisions,operations));
 const metadata=JSON.parse(await readFile(join(completed.root,'prepared-native.json'),'utf8')) as Parameters<typeof preparedSourceConsumerGraph>[0];
 const draft=JSON.parse(await readFile(join(completed.root,'draft-plan.json'),'utf8')) as Parameters<typeof preparedSourceConsumerGraph>[1];
 const graph=preparedSourceConsumerGraph(metadata,draft);
 const registry=registryFacts(f),factDigest=canonicalDigest(completed.fact);
 const original=await computeSourceDigest({root:f.authorRoot,roots:f.app.creation.sourceFact(f.projectId,f.commit.snapshot_id)!.roots,engine:'openfilm',engineUpstreamSha:OPENFILM_UPSTREAM_SHA});
 const originalFiles=[...original.manifest.files,...original.manifest.assets].map(file=>({relative_path:file.path,bytes:file.size,sha256:file.sha256}));
 const mapping=prepared.register({project_id:f.projectId,job_id:f.task.job_id,request_digest:f.task.request_digest,
  fact_digest:factDigest,execution,base_revision:1,source_digest:f.commit.source_digest,plan_sha256:completed.fact.plan_digest,
  rights_digest:completed.fact.rights_digest,frame_count:90,fps_numerator:30,fps_denominator:1,stage_root:completed.root,roots:completed.fact.roots,files:completed.fact.files});
 const hashFor=(path:string)=>completed.fact.files.find(file=>file.relative_path===path)?.sha256??canonicalDigest([]);
 const plan:PreparedAdoptionPlanV1={format:'narralens.prepared-adoption-plan@1',version:1,source_kind:'created_prepared_source',project_id:f.projectId,
  base_revision:1,base_source_digest:f.commit.source_digest,control_revision:0,selection_version:0,materialization_id:mapping.prepared_source_id,
  prepared_fact_digest:factDigest,request_digest:execution.input_digest,producer_execution:execution,target_source_digest:completed.fact.source_digest,
  target_snapshot_id:snapshotIdFor(f.projectId,completed.fact.source_digest),roots:mapping.roots,files:mapping.files,
  rights:registry.map(asset=>({ref_id:asset.rights_ref,artifact_version:1,sha256:asset.registration_digest})),
  consumer:{consumer_id:'native',project_id:f.projectId,run_id:execution.run_id,graph_digest:canonicalDigest(graph)},
  native_plan:{native_plan_sha256:completed.fact.plan_digest,film_sha256:hashFor('film.html'),film_bytes:completed.fact.files.find(x=>x.relative_path==='film.html')!.bytes,
   settings_digest:hashFor('.film/settings.json'),subtitle_style_digest:hashFor('.film/subtitles.json'),captions_digest:hashFor(completed.fact.roots.find(x=>x.endsWith('.vtt'))??''),markers_digest:canonicalDigest([])},
  frame_count:90,fps_numerator:30,fps_denominator:1,affected_ranges:graph.clips.map(c=>({start_frame:c.start_frame,end_frame_exclusive:c.end_frame_exclusive,clip_id:c.clip_id})),locks_checked:[],engine_upstream_sha:OPENFILM_UPSTREAM_SHA,
  expires_at:new Date(now.getTime()+900000).toISOString()};
 options.mutatePlan?.(plan);options.onPrepared?.(f);
 const planDigest=preparedAdoptionPlanDigest(plan),transactionId='txn_'+randomUUID().replaceAll('-',''),impactId='imp_'+randomUUID().replaceAll('-','');
 const approvalId='approval_'+randomUUID().replaceAll('-',''),confirmationId='confirm_'+randomUUID().replaceAll('-',''),reviewId='review_'+randomUUID().replaceAll('-',''),packageId='package_'+randomUUID().replaceAll('-','');
 const requestDigest=canonicalDigest({project_id:f.projectId,impact_id:impactId,execution});
 const impact=impacts.create({impact_id:impactId,project_id:f.projectId,materialization_id:mapping.prepared_source_id,target_snapshot_id:plan.target_snapshot_id,
  base_revision:1,source_digest:plan.base_source_digest,control_revision:0,engine_upstream_sha:OPENFILM_UPSTREAM_SHA,affected_ranges:plan.affected_ranges,
  affected_consumers:[{kind:'native',id:'native',action:'replace'}],locks_checked:[],rights_digest:completed.fact.rights_digest,native_plan_sha256:planDigest,
  approvals_required:['change.approve'],request_digest:requestDigest,plan,now});
 const pkg:ReviewPackage={project_id:f.projectId,run_id:execution.run_id,plan_version:1,package_id:packageId,version:1,kind:'sample',chapter_id:null,
  input_digest:execution.input_digest,output_digest:completed.fact.source_digest,quality_digest:canonicalDigest({fixture:'accepted review policy only'}),
  parts:(['preview','narration','subtitles','shot_summary','rights_quality'] as const).map(kind=>({kind,artifact_ref:{id:'module-'+kind,version:1,sha256:factDigest},download_ref:null})),source_shot_ids:[...metadata.clip_ids],selection_reason:'Module fixture; no human review or UI claim',allowed_choices:['accept_and_adopt'],
  impact:{impact_id:impactId,project_id:f.projectId,materialization_id:mapping.prepared_source_id,base_revision:1,control_revision:0,source_digest:plan.base_source_digest,
   selection_version:0,plan_sha256:planDigest,target_snapshot_id:plan.target_snapshot_id,expires_at:plan.expires_at,state:'active',summary:'module fixture'},
  reuse_of_package_id:null,review_url:`/workbench/projects/${f.projectId}/reviews/${reviewId}`,state:'accepted'};
 const packageDigest=canonicalDigest(pkg),actionDigest=planDigest;
 revisions.beginTransaction({transaction_id:transactionId,project_id:f.projectId,kind:'snapshot_publish',correlation_id:'module-root',request_json:JSON.stringify({operation:'adopt_prepared_source'}),request_hash:requestDigest,base_revision:1});
 await repo.transaction(tx=>{
  tx.put('artifact_version',{project_id:f.projectId,artifact_id:packageId,version:1},{project_id:f.projectId,artifact_id:packageId,version:1,kind:'chapter',schema_version:1,
   input_digest:execution.input_digest,content_digest:packageDigest,content_json:pkg,input_refs_json:[],created_at:now.toISOString()});
  tx.put('review_request',{project_id:f.projectId,run_id:execution.run_id,review_id:reviewId},{project_id:f.projectId,run_id:execution.run_id,review_id:reviewId,
   plan_version:1,run_scope_digest:execution.run_scope_digest,gate:'sample',artifact_id:packageId,artifact_version:1,input_digest:execution.input_digest,package_digest:packageDigest,state:'accepted',reuse_review_id:null,created_at:now.toISOString()});
  tx.put('trusted_confirmation',{project_id:f.projectId,run_id:execution.run_id,confirmation_id:confirmationId},{project_id:f.projectId,run_id:execution.run_id,confirmation_id:confirmationId,
   review_id:reviewId,input_digest:execution.input_digest,purpose:'change.approve',channel:'trusted_ui',authenticated_actor:'owner',session_ref:f.ui.principal.session_ref,
   action_digest:actionDigest,issued_at:Math.floor(now.getTime()/1000),expires_at:Math.floor(now.getTime()/1000)+900});
  tx.put('approval',{project_id:f.projectId,run_id:execution.run_id,approval_id:approvalId},{project_id:f.projectId,run_id:execution.run_id,approval_id:approvalId,
   run_scope_digest:execution.run_scope_digest,confirmation_id:confirmationId,plan_version:1,step_id:execution.step_id,attempt:execution.attempt,input_digest:execution.input_digest,
   change_id:impactId,impact_id:impactId,base_revision:1,control_revision:0,action_digest:actionDigest,facts_digest:planDigest,state:'active',expires_at:Math.floor(now.getTime()/1000)+900,consumed_transaction_id:null});
  tx.put('prepared_authorization',{transaction_id:transactionId},{transaction_id:transactionId,project_id:f.projectId,run_id:execution.run_id,approval_id:approvalId,facts_digest:planDigest});
 });
 prepared.bindPackage({prepared_source_id:mapping.prepared_source_id,package_id:packageId,package_version:1,receipt_digest:packageDigest});
 adoptions.record({transaction_id:transactionId,project_id:f.projectId,prepared_source_id:mapping.prepared_source_id,impact_id:impactId,approval_id:approvalId,
  plan_sha256:planDigest,facts_digest:planDigest,original_source_digest:plan.base_source_digest,target_source_digest:plan.target_source_digest,expected_snapshot_id:plan.target_snapshot_id,
  native_plan:plan.native_plan,original_closure:originalFiles,target_closure:plan.files,stage_root:completed.root,backup_token:'backup_'+transactionId,execution,now});
 for(const [from,to]of [['received','preconditions_checked'],['preconditions_checked','staged'],['staged','validated'],['validated','prepared']] as const)revisions.transition(transactionId,from,to);
 let selection=0;
 const publisher=new CreatedSourcePublisher({revisions,authorRoot:f.authorRoot,privateRoot:join(f.root,'publication'),snapshots:new SnapshotStore({snapshotsRoot:join(f.root,'snapshots')}),
  selection:{currentSelectionVersion:()=>selection},assets:f.registry,tasks:f.tasks,verifier:f.verifier,...(options.fsync?{fsync:options.fsync}:{})});
 cleanups.push(()=>publisher.close());
 const publicationInput={project_id:f.projectId,transaction_id:transactionId,prepared_source_id:mapping.prepared_source_id,stage_root:completed.root,files:plan.files,
  original_source_digest:plan.base_source_digest,published_source_digest:plan.target_source_digest,target_snapshot_id:plan.target_snapshot_id};
 const proof=await publisher.publish(publicationInput);
 const input:CommitPreparedCreatedSourceInput={project_id:f.projectId,transaction_id:transactionId,impact_id:impactId,approval_id:approvalId,prepared_source_id:mapping.prepared_source_id,
  execution,idempotency_key:'module-apply',request_digest:requestDigest,publication_proof:proof};
 return {...f,revisions,repo,plan,impact,adoptions,publisher,input,publicationInput,proof,advanceSelection:()=>selection++};
}

describe('actual closed created-source commit and publisher',()=>{
 it('publishes complete native source, commits once, preserves R1 geometry and replays without a second commit',async()=>{
  const f=await fixture();expect(isCreatedSourcePublicationProof(f.proof)).toBe(true);
  const before=f.revisions.outboxRowCount();const applied=f.revisions.commitPreparedCreatedSource(f.input);
  expect(applied).toMatchObject({project_revision:2,snapshot_id:f.plan.target_snapshot_id,replayed:false});
  expect(f.app.creation.sourceFact(f.projectId,applied.snapshot_id)?.frame_count).toBe(90);
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(2);
  expect(f.revisions.commitPreparedCreatedSource(f.input)).toEqual({...applied,replayed:true});
  expect(f.revisions.outboxRowCount()).toBe(before+2);
 },120000);
 it('refuses JSON-cloned publication proof without moving database authorities',async()=>{
  const f=await fixture();expect(()=>f.revisions.commitPreparedCreatedSource({...f.input,publication_proof:JSON.parse(JSON.stringify(f.proof))})).toThrow();
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);expect(f.revisions.compose(db=>db.prepare('SELECT state FROM impact WHERE impact_id=?').get(f.input.impact_id)?.state)).toBe('active');
 },120000);
 it('refuses author bytes changed after publication even while database base is unchanged',async()=>{
  const f=await fixture();await writeFile(join(f.authorRoot,'film.html'),'changed after publication');
  expect(()=>f.revisions.commitPreparedCreatedSource(f.input)).toThrow();expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
 },120000);
 it('refuses current selection changed after publication',async()=>{
  const f=await fixture();f.advanceSelection();expect(()=>f.revisions.commitPreparedCreatedSource(f.input)).toThrow(/Selection/);
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
 },120000);
 it('refuses a symlink replacement of the committed snapshot source',async()=>{
  const f=await fixture(),source=join(f.root,'snapshots',f.projectId,f.plan.target_snapshot_id,'source');
  await rename(source,source+'-real');await symlink(source+'-real',source,'dir');
  expect(()=>f.revisions.commitPreparedCreatedSource(f.input)).toThrow();expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
 },120000);
 it('rolls every database authority back if an actual post-consume write fails',async()=>{
  const f=await fixture(),before=f.revisions.outboxRowCount();
  f.revisions.compose(db=>db.exec("CREATE TEMP TRIGGER fail_created_pointer BEFORE UPDATE ON active_commit BEGIN SELECT RAISE(ABORT,'actual commit fault'); END"));
  expect(()=>f.revisions.commitPreparedCreatedSource(f.input)).toThrow('actual commit fault');
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);expect(f.revisions.outboxRowCount()).toBe(before);
  expect(f.revisions.projectTransaction(f.input.transaction_id)?.state).toBe('prepared');
  expect(f.revisions.compose(db=>db.prepare('SELECT state FROM impact WHERE impact_id=?').get(f.input.impact_id)?.state)).toBe('active');
  expect(f.revisions.compose(db=>db.prepare('SELECT state FROM cp_a0_approval WHERE approval_id=?').get(f.input.approval_id)?.state)).toBe('active');
 },120000);
 it('poisons the outer transaction when a project-bound repository guard failure is swallowed',async()=>{
  const f=await fixture(),original=ProductSqliteRepository.prototype.joinCreatedSourceCommit;
  vi.spyOn(ProductSqliteRepository.prototype,'joinCreatedSourceCommit').mockImplementation(function<T>(this:ProductSqliteRepository,scope:CreatedSourceCommitScope,work:(tx:ProductTransaction)=>T):T{
   return original.call(this,scope,(tx:ProductTransaction)=>{try{tx.list('approval',{project_id:'another-project',run_id:f.input.execution.run_id});}catch{}return work(tx);}) as T;
  });
  expect(()=>f.revisions.commitPreparedCreatedSource(f.input)).toThrow();expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
 },120000);
 it('poisons the owner if a real scope is used against another database even when the error is swallowed',async()=>{
  const f=await fixture(),other=new RevisionStore(':memory:'),otherRepo=new ProductSqliteRepository(other),original=ProductSqliteRepository.prototype.joinCreatedSourceCommit;
  let captured:CreatedSourceCommitScope|undefined;
  vi.spyOn(ProductSqliteRepository.prototype,'joinCreatedSourceCommit').mockImplementation(function<T>(this:ProductSqliteRepository,scope:CreatedSourceCommitScope,work:(tx:ProductTransaction)=>T):T{
   captured=scope;expect(()=>original.call(otherRepo,scope,()=>undefined)).toThrow();return original.call(this,scope,work) as T;
  });
  try{expect(()=>f.revisions.commitPreparedCreatedSource(f.input)).toThrow();expect(captured).toBeDefined();expect(()=>original.call(f.repo,captured!,()=>undefined)).toThrow();expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);}finally{other.close();}
 },120000);
 it('invalidates an authentic joined scope when its successful commit ends',async()=>{
  const f=await fixture(),original=ProductSqliteRepository.prototype.joinCreatedSourceCommit;let captured:CreatedSourceCommitScope|undefined;
  vi.spyOn(ProductSqliteRepository.prototype,'joinCreatedSourceCommit').mockImplementation(function<T>(this:ProductSqliteRepository,scope:CreatedSourceCommitScope,work:(tx:ProductTransaction)=>T):T{
   captured=scope;expect(Object.isFrozen(scope)).toBe(true);return original.call(this,scope,work) as T;
  });
  f.revisions.commitPreparedCreatedSource(f.input);expect(captured).toBeDefined();
  expect(()=>original.call(f.repo,captured!,()=>undefined)).toThrow();
 },120000);
 it('does not expose mutable issuer, guard or geometry authority on a real publication token',async()=>{
  const f=await fixture();
  expect(Object.keys(f.proof)).toEqual(['facts']);expect(Object.isFrozen(f.proof)).toBe(true);
  for(const key of ['issuer','geometry','guards'])expect(Reflect.set(f.proof,key,{assertCurrentForCommit(){}})).toBe(false);
  await writeFile(join(f.authorRoot,'film.html'),'changed after attempted token pollution');
  expect(()=>f.revisions.commitPreparedCreatedSource(f.input)).toThrow();expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
 },120000);
 it('refuses an authority that expires during final synchronous file verification',async()=>{
  const f=await fixture(),original=f.publisher.assertCurrentForCommit.bind(f.publisher);
  const expires=f.revisions.compose(db=>Number(db.prepare('SELECT expires_at FROM cp_a0_approval WHERE approval_id=?').get(f.input.approval_id)!.expires_at))*1000;
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(expires-100);
  let calls=0;vi.spyOn(f.publisher,'assertCurrentForCommit').mockImplementation((...args)=>{original(...args);if(++calls===2)vi.setSystemTime(expires);});
  try{expect(()=>f.revisions.commitPreparedCreatedSource(f.input)).toThrow('AUTHORITY_EXPIRED_AT_COMMIT');
   expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
  }finally{vi.useRealTimers();}
 },120000);
 it('retains the original backup inode when a same-byte replacement happens after rename',async()=>{
  let prepared:Awaited<ReturnType<typeof preparedDraftFixture>>|undefined,replaced=false;
  const fsync=async(path:string)=>{
   if(prepared&&path===dirname(prepared.authorRoot)&&!replaced){
    const domain=join(prepared.root,'publication'),entry=(await readdir(domain)).find(n=>n.startsWith('publication-'))!;
    const file=join(domain,entry,'backup','film.html'),bytes=await readFile(file),replacement=file+'.same-bytes';
    await writeFile(replacement,bytes);await rename(replacement,file);expect(await readFile(file)).toEqual(bytes);replaced=true;
   }
   const h=await open(path,'r');try{await h.sync();}finally{await h.close();}
  };
  await expect(fixture({fsync,onPrepared:f=>{prepared=f;}})).rejects.toThrow(/identity changed/);
  expect(replaced).toBe(true);expect(prepared!.host.revisions.activeCommit(prepared!.projectId)?.revision).toBe(1);
 },120000);
 it.each(['film','settings','captions','native_plan','rights','consumer','upstream','ranges'] as const)('refuses a fully rehashed approved plan that lies about %s',async field=>{
  let prepared:Awaited<ReturnType<typeof preparedDraftFixture>>|undefined;
  const mutatePlan=(plan:PreparedAdoptionPlanV1)=>{
   const replacement='f'.repeat(64);
   if(field==='film')Reflect.set(plan.native_plan,'film_sha256',replacement);
   if(field==='settings')Reflect.set(plan.native_plan,'settings_digest',replacement);
   if(field==='captions')Reflect.set(plan.native_plan,'captions_digest',replacement);
   if(field==='native_plan')Reflect.set(plan.native_plan,'native_plan_sha256',replacement);
   if(field==='rights')Reflect.set(plan.rights[0]!,'sha256',replacement);
   if(field==='consumer')Reflect.set(plan.consumer,'graph_digest',replacement);
   if(field==='upstream')Reflect.set(plan,'engine_upstream_sha','f'.repeat(40));
   if(field==='ranges')Reflect.set(plan.affected_ranges[0]!,'end_frame_exclusive',30);
  };
  await expect(fixture({mutatePlan,onPrepared:f=>{prepared=f;}})).rejects.toThrow();
  expect(prepared).toBeDefined();expect(prepared!.host.revisions.activeCommit(prepared!.projectId)?.revision).toBe(1);
 },120000);
});
