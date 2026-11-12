import {readFile,writeFile,symlink,rename,open,readdir} from 'node:fs/promises';
import {lstatSync,readFileSync,readdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {vendorRoot} from './helpers/created-project-fixture.js';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {preparedDraftFixture,waitForCompletedDraft,registryFacts} from './helpers/created-draft-fixture.js';
import {canonicalDigest} from '../../../src/host/creative/digest.js';
import {CreativeService} from '../../../src/host/creative/creative-service.js';
import {FixedWorkflowService} from '../../../src/host/creative/fixed-workflow-service.js';
import {CreatedPreparedSourceStore} from '../../../src/host/agent-driven/created-prepared-source-store.js';
import {CreatedSourceImpactStore} from '../../../src/host/agent-driven/created-source-impact-store.js';
import {CreatedSourceAdoptionStore} from '../../../src/host/agent-driven/created-source-adoption-store.js';
import {CreatedSourceChangeService} from '../../../src/host/agent-driven/created-source-change-service.js';
import {CreatedSourceFactsReader} from '../../../src/host/agent-driven/created-source-facts-reader.js';
import {CreativeProjectAuthority} from '../../../src/host/agent-driven/creative-project-authority.js';
import {CreatedSourcePublisher,isCreatedSourcePublicationProof,preparedSourceConsumerGraph} from '../../../src/host/agent-driven/created-source-publisher.js';
import {CreatedPublicationIdentityStore,type PublicationIdentityInput} from '../../../src/host/agent-driven/created-publication-identity-store.js';
import {CreatedPublicationRecoveryFiles} from '../../../src/host/agent-driven/created-publication-recovery-files.js';
import {PublicationCleanupError} from '../../../src/host/agent-driven/publication-cleanup.js';
import {RetainedSourceTree} from '../../../src/host/agent-driven/retained-source-tree.js';
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
async function fixture(options:{scopedPublicationRoot?:boolean;transactionKind?:'edit'|'snapshot_publish';mutatePlan?:(plan:PreparedAdoptionPlanV1)=>void;fsync?:(path:string)=>Promise<void>;onPrepared?:(f:Awaited<ReturnType<typeof preparedDraftFixture>>)=>void;onPublisher?:(publisher:CreatedSourcePublisher,close:()=>Promise<void>)=>void}={}){
 const f=await preparedDraftFixture();cleanups.push(f.close);f.worker.start();const completed=await waitForCompletedDraft(f);await f.worker.close();
 const revisions=f.host.revisions,repo=f.repo,now=new Date(),execution=f.task.request.execution;
 if(completed.fact.plan_digest===null)throw Error('Assembly must produce a native plan digest');
 const prepared=new CreatedPreparedSourceStore(revisions),adoptions=new CreatedSourceAdoptionStore(revisions);
 let selection=0;
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
 let plan:PreparedAdoptionPlanV1={format:'narralens.prepared-adoption-plan@1',version:1,source_kind:'created_prepared_source',project_id:f.projectId,
  base_revision:1,base_source_digest:f.commit.source_digest,control_revision:0,selection_version:0,materialization_id:mapping.prepared_source_id,
  prepared_fact_digest:factDigest,request_digest:execution.input_digest,producer_execution:execution,target_source_digest:completed.fact.source_digest,
  target_snapshot_id:snapshotIdFor(f.projectId,completed.fact.source_digest),roots:mapping.roots,files:mapping.files,
  rights:registry.map(asset=>({ref_id:asset.rights_ref,artifact_version:1,sha256:asset.registration_digest})),
  consumer:{consumer_id:'native',project_id:f.projectId,run_id:execution.run_id,graph_digest:canonicalDigest(graph)},
  native_plan:{native_plan_sha256:completed.fact.plan_digest,film_sha256:hashFor('film.html'),film_bytes:completed.fact.files.find(x=>x.relative_path==='film.html')!.bytes,
   settings_digest:hashFor('.film/settings.json'),subtitle_style_digest:hashFor('.film/subtitles.json'),captions_digest:hashFor(completed.fact.roots.find(x=>x.endsWith('.vtt'))??''),markers_digest:canonicalDigest([])},
  frame_count:90,fps_numerator:30,fps_denominator:1,affected_ranges:graph.clips.map(c=>({start_frame:c.start_frame,end_frame_exclusive:c.end_frame_exclusive,clip_id:c.clip_id})),locks_checked:[],engine_upstream_sha:OPENFILM_UPSTREAM_SHA,
  expires_at:new Date(now.getTime()+900000).toISOString()};
 const reader=new CreatedSourceFactsReader({host:f.host,authority:new CreativeProjectAuthority(f.app.creation),prepared,tasks:f.tasks,
  assets:f.registry,verifier:f.verifier,selection:{currentSelectionVersion:()=>selection},stageDomainRoot:f.taskRoot});
 cleanups.push(()=>reader.close());
 const readInput={project_id:f.projectId,prepared_source_id:mapping.prepared_source_id,execution};
 const readProof=await reader.acquire(readInput,'owner');
 const {rights_digest:observedRights,...observed}=reader.assertCurrent(readInput,'owner',readProof);
 const {format:_format,version:_version,source_kind:_kind,expires_at:_expiry,...expected}=plan;
 expect(observed).toEqual(expected);expect(observedRights).toBe(completed.fact.rights_digest);
 reader.release(readProof);
 options.mutatePlan?.(plan);options.onPrepared?.(f);
 let impactId='imp_'+randomUUID().replaceAll('-','');
 let preparedByService=false;
 if(!options.mutatePlan){
  const service=new CreatedSourceChangeService({host:f.host,prepared,impacts,facts:reader,authority:new CreativeProjectAuthority(f.app.creation)});
  const request={meta:{idempotency_key:'module-prepare',correlation_id:'module-prepare'},project_id:f.projectId,materialization_id:mapping.prepared_source_id,
   base_revision:1,source_digest:f.commit.source_digest,selection_version:0,execution};
  const beforeRevision=revisions.activeCommit(f.projectId)!.revision;
  const change=await service.prepare(request,'owner');impactId=change.impact_id;
  expect(await service.prepare({...request,meta:{...request.meta,correlation_id:'module-prepare-replay'}},'owner')).toEqual(change);
  expect(revisions.activeCommit(f.projectId)!.revision).toBe(beforeRevision);
  plan=impacts.planFact(impactId)!.plan as PreparedAdoptionPlanV1;preparedByService=true;
 }
 const planDigest=preparedAdoptionPlanDigest(plan),transactionId='txn_'+randomUUID().replaceAll('-','');
 const approvalId='approval_'+randomUUID().replaceAll('-',''),confirmationId='confirm_'+randomUUID().replaceAll('-',''),reviewId='review_'+randomUUID().replaceAll('-',''),packageId='package_'+randomUUID().replaceAll('-','');
 const requestDigest=canonicalDigest({project_id:f.projectId,impact_id:impactId,execution});
 const impact=preparedByService?impacts.read(impactId)!:impacts.create({impact_id:impactId,project_id:f.projectId,materialization_id:mapping.prepared_source_id,target_snapshot_id:plan.target_snapshot_id,
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
 revisions.beginTransaction({transaction_id:transactionId,project_id:f.projectId,kind:options.transactionKind??'edit',correlation_id:'module-root',request_json:JSON.stringify({operation:'agent.created_source.apply@1'}),request_hash:requestDigest,base_revision:1});
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
  // Explicit accepted-review fixture, including the original checkpoint binding.
  // This is not evidence that a human or the production decision UI accepted it.
  const runKey={project_id:f.projectId,run_id:execution.run_id},run=tx.get('run',runKey)!;
  tx.put('run',runKey,{...run,checkpoint_json:{...run.checkpoint_json,
   workflow_revision:run.checkpoint_json.workflow_revision+1,
   gates:run.checkpoint_json.gates.map(g=>g.kind==='sample'?{...g,state:'accepted' as const,review_package_id:reviewId}:g)}});

 });
 prepared.bindPackage({prepared_source_id:mapping.prepared_source_id,package_id:packageId,package_version:1,receipt_digest:packageDigest});
 adoptions.record({transaction_id:transactionId,project_id:f.projectId,prepared_source_id:mapping.prepared_source_id,impact_id:impactId,approval_id:approvalId,
  plan_sha256:planDigest,facts_digest:planDigest,original_source_digest:plan.base_source_digest,target_source_digest:plan.target_source_digest,expected_snapshot_id:plan.target_snapshot_id,
  native_plan:plan.native_plan,original_closure:originalFiles,target_closure:plan.files,stage_root:completed.root,backup_token:'backup_'+transactionId,execution,now});
 for(const [from,to]of [['received','preconditions_checked'],['preconditions_checked','staged'],['staged','validated'],['validated','prepared']] as const)revisions.transition(transactionId,from,to);
 const publisherPrivateRoot=options.scopedPublicationRoot?join(f.root,'publication',f.projectId):join(f.root,'publication');
 const publisher=new CreatedSourcePublisher({revisions,authorRoot:f.authorRoot,privateRoot:publisherPrivateRoot,snapshots:new SnapshotStore({snapshotsRoot:join(f.root,'snapshots')}),
  selection:{currentSelectionVersion:()=>selection},assets:f.registry,tasks:f.tasks,verifier:f.verifier,stageDomainRoot:f.taskRoot,...(options.fsync?{fsync:options.fsync}:{})});
 const closePublisher=()=>publisher.close();cleanups.push(closePublisher);options.onPublisher?.(publisher,closePublisher);
 const publicationInput={project_id:f.projectId,transaction_id:transactionId,prepared_source_id:mapping.prepared_source_id,stage_root:completed.root,files:plan.files,
  original_source_digest:plan.base_source_digest,published_source_digest:plan.target_source_digest,target_snapshot_id:plan.target_snapshot_id};
 const proof=await publisher.publish(publicationInput);
 const input:CommitPreparedCreatedSourceInput={project_id:f.projectId,transaction_id:transactionId,impact_id:impactId,approval_id:approvalId,prepared_source_id:mapping.prepared_source_id,
  execution,idempotency_key:'module-apply',request_digest:requestDigest,publication_proof:proof};
 return {...f,revisions,repo,plan,impact,adoptions,publisher,closePublisher,input,publicationInput,proof,publisherPrivateRoot,selectionPort:{currentSelectionVersion:()=>selection},advanceSelection:()=>selection++};
}

async function recoveryFixture(){
 const f=await fixture({scopedPublicationRoot:true});await f.closePublisher();
 const files=new CreatedPublicationRecoveryFiles({revisions:f.revisions,snapshots:f.host.snapshots,
  createdRoot:dirname(dirname(f.authorRoot)),privateRoot:join(f.root,'publication'),creationIdentity:id=>{
   const source=f.app.creation.forProject(id);return source?{command_id:source.command_id,transaction_id:source.transaction_id}:null;
  }});cleanups.push(()=>files.close());
 const lease=await files.inspect(f.input.transaction_id);
 const publisher=new CreatedSourcePublisher({revisions:f.revisions,authorRoot:f.authorRoot,privateRoot:f.publisherPrivateRoot,snapshots:f.host.snapshots,
  selection:f.selectionPort,assets:f.registry,tasks:f.tasks,verifier:f.verifier,stageDomainRoot:f.taskRoot});cleanups.push(()=>publisher.close());
 return {...f,files,lease,recoveredPublisher:publisher};
}

describe('actual closed created-source commit and publisher',()=>{
 it('D10 recovery issuer reopens actual published source and commits the original transaction exactly once',async()=>{
  const f=await recoveryFixture(),outbox=f.revisions.outboxRowCount();expect(isCreatedSourcePublicationProof(f.proof)).toBe(false);
  const originalIdentity=new CreatedPublicationIdentityStore(f.revisions).read(f.input.transaction_id);
  const proof=await f.recoveredPublisher.recoverPublished(f.publicationInput,f.files,f.lease);
  expect(isCreatedSourcePublicationProof(proof)).toBe(true);expect(proof.facts.publisher_instance).not.toBe(f.proof.facts.publisher_instance);
  const input={...f.input,publication_proof:proof},applied=f.revisions.commitPreparedCreatedSource(input);
  expect(applied).toMatchObject({project_revision:2,transaction_id:f.input.transaction_id,replayed:false,snapshot_id:f.plan.target_snapshot_id});
  expect(f.revisions.commitPreparedCreatedSource(input)).toEqual({...applied,replayed:true});expect(f.revisions.outboxRowCount()).toBe(outbox+2);
  expect(new CreatedPublicationIdentityStore(f.revisions).read(f.input.transaction_id)).toEqual(originalIdentity);f.files.release(f.lease);
 },120000);
 it('D10 recovery issuer reconstructs a missing published journal from actual resources without publishing a new snapshot or job',async()=>{
  const f=await recoveryFixture(),jobs=f.revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM job').get()?.n);
  f.revisions.compose(db=>{const sql=String(db.prepare("SELECT sql FROM sqlite_master WHERE name='created_publication_journal_no_delete'").get()?.sql);
   db.exec('DROP TRIGGER created_publication_journal_no_delete');try{db.prepare("DELETE FROM created_publication_journal WHERE transaction_id=? AND phase='published'").run(f.input.transaction_id);}finally{db.exec(sql);}});
  expect(f.publisher.journalOf(f.input.transaction_id).map(row=>row.phase)).toEqual(['prepared']);
  const publishing=vi.spyOn(SnapshotStore.prototype,'publish').mockRejectedValue(new Error('Recovery must not publish another snapshot'));
  const proof=await f.recoveredPublisher.recoverPublished(f.publicationInput,f.files,f.lease);
  expect(f.recoveredPublisher.journalOf(f.input.transaction_id).map(row=>row.phase)).toEqual(['prepared','published']);
  const applied=f.revisions.commitPreparedCreatedSource({...f.input,publication_proof:proof});expect(applied.project_revision).toBe(2);
  expect(publishing).not.toHaveBeenCalled();expect(f.revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM job').get()?.n)).toBe(jobs);f.files.release(f.lease);
 },120000);
 it('D10 recovery issuer refuses a JSON lease and a changed selection without consuming approval',async()=>{
  const f=await recoveryFixture();await expect(f.recoveredPublisher.recoverPublished(f.publicationInput,f.files,JSON.parse(JSON.stringify(f.lease)))).rejects.toThrow(/not live/);
  f.advanceSelection();await expect(f.recoveredPublisher.recoverPublished(f.publicationInput,f.files,f.lease)).rejects.toThrow(/bindings changed/);
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);expect(f.revisions.compose(db=>db.prepare('SELECT state FROM cp_a0_approval WHERE approval_id=?').get(f.input.approval_id)?.state)).toBe('active');f.files.release(f.lease);
 },120000);
 it('D10 recovery issuer refuses expired authority and the actual resource lease compensates the complete original before abort',async()=>{
  const f=await recoveryFixture(),outbox=f.revisions.outboxRowCount();vi.useFakeTimers({toFake:['Date']});
  try{vi.setSystemTime(new Date(Date.parse(f.plan.expires_at)+1000));
   await expect(f.recoveredPublisher.recoverPublished(f.publicationInput,f.files,f.lease)).rejects.toThrow(/approval expired/);
   await f.files.restoreOriginal(f.lease);f.files.assertOriginalRestored(f.lease);f.host.coordinator.abort(f.input.transaction_id,'CREATED_ADOPTION_AUTHORITY_EXPIRED');
   expect(f.revisions.projectTransaction(f.input.transaction_id)?.state).toBe('aborted');expect(await readFile(join(f.authorRoot,'film.html'))).toEqual(f.authorBytes);
   const fact=f.app.creation.sourceFact(f.projectId,f.commit.snapshot_id)!;
   expect((await computeSourceDigest({root:f.authorRoot,roots:fact.roots,engine:'openfilm',engineUpstreamSha:OPENFILM_UPSTREAM_SHA})).source_digest).toBe(f.commit.source_digest);
   expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);expect(f.revisions.outboxRowCount()).toBe(outbox);
   expect(f.revisions.compose(db=>db.prepare('SELECT state,consumed_transaction_id FROM cp_a0_approval WHERE approval_id=?').get(f.input.approval_id))).toMatchObject({state:'active',consumed_transaction_id:null});
   f.files.release(f.lease);
  }finally{vi.useRealTimers();}
 },120000);

 it('D10 identity records actual three retained trees in the prepared journal transaction before any rename',async()=>{
  let prepared:Awaited<ReturnType<typeof preparedDraftFixture>>|undefined,captured:PublicationIdentityInput|undefined;
  const record=CreatedPublicationIdentityStore.prototype.record;
  const f=await fixture({onPrepared:value=>{prepared=value;},onPublisher:()=>{
   vi.spyOn(CreatedPublicationIdentityStore.prototype,'record').mockImplementation(function(this:CreatedPublicationIdentityStore,input,now){
    const db=prepared!.host.revisions.compose(db=>db);expect(db.isTransaction).toBe(true);
    expect(db.prepare('SELECT count(*) AS n FROM created_publication_journal').get()?.n).toBe(0);
    expect(readFileSync(join(prepared!.authorRoot,'film.html'))).toEqual(prepared!.authorBytes);
    const workspace=join(prepared!.root,'publication',readdirSync(join(prepared!.root,'publication'))[0]!);
    const original=lstatSync(prepared!.authorRoot,{bigint:true}),target=lstatSync(join(workspace,'staging'),{bigint:true});
    const container=join(prepared!.root,'snapshots',prepared!.projectId,input.target_snapshot_id);
    const snapshot=lstatSync(join(container,'source'),{bigint:true}),directory=lstatSync(container,{bigint:true});
    expect(input.original_tree.directories[0]).toMatchObject({dev:String(original.dev),ino:String(original.ino)});
    expect(input.target_tree.directories[0]).toMatchObject({dev:String(target.dev),ino:String(target.ino)});
    expect(input.snapshot_tree.directories[0]).toMatchObject({dev:String(snapshot.dev),ino:String(snapshot.ino)});
    expect(input.snapshot_container).toEqual({dev:String(directory.dev),ino:String(directory.ino)});
    expect(()=>lstatSync(join(workspace,'backup'))).toThrow();captured=input;
    return record.call(this,input,now);
   });
  }});
  expect(captured).toBeDefined();
  expect(f.publisher.journalOf(f.input.transaction_id).map(row=>row.phase)).toEqual(['prepared','published']);
  const fresh=new RevisionStore(join(f.root,'host.sqlite'));
  try{expect(new CreatedPublicationIdentityStore(fresh).read(f.input.transaction_id)).toMatchObject(captured!);}finally{fresh.close();}
  const receipt=f.revisions.commitPreparedCreatedSource(f.input);expect(receipt.project_revision).toBe(2);
  expect(f.revisions.commitPreparedCreatedSource(f.input)).toEqual({...receipt,replayed:true});
 },120000);
 it.each(['identity','prepared journal'] as const)('D10 identity rolls back both pre-rename facts when the %s insert fails',async phase=>{
  let prepared:Awaited<ReturnType<typeof preparedDraftFixture>>|undefined,transactionId='';
  await expect(fixture({onPrepared:value=>{prepared=value;},onPublisher:()=>{
   const revisions=prepared!.host.revisions;new CreatedPublicationIdentityStore(revisions);
   revisions.compose(db=>{
    transactionId=String(db.prepare("SELECT transaction_id FROM project_transaction WHERE state='prepared'").get()?.transaction_id);
    if(phase==='identity')db.exec("CREATE TEMP TRIGGER identity_insert_fault AFTER INSERT ON created_publication_identity BEGIN SELECT RAISE(ABORT,'identity atomic insert fault'); END");
    else db.exec("CREATE TEMP TRIGGER journal_insert_fault AFTER INSERT ON created_publication_journal WHEN NEW.phase='prepared' BEGIN SELECT RAISE(ABORT,'identity atomic insert fault'); END");
   });
  }})).rejects.toThrow('identity atomic insert fault');
  const f=prepared!,revisions=f.host.revisions;
  expect(revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM created_publication_identity').get()?.n)).toBe(0);
  expect(revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM created_publication_journal').get()?.n)).toBe(0);
  const fact=f.app.creation.sourceFact(f.projectId,f.commit.snapshot_id)!;
  const actual=await computeSourceDigest({root:f.authorRoot,roots:fact.roots,engine:'openfilm',engineUpstreamSha:OPENFILM_UPSTREAM_SHA});
  expect(actual.source_digest).toBe(f.commit.source_digest);expect(revisions.activeCommit(f.projectId)?.revision).toBe(1);
  const files=[...actual.manifest.files,...actual.manifest.assets].map(file=>({relative_path:file.path,bytes:file.size,sha256:file.sha256}));
  const guard=new RetainedSourceTree(f.authorRoot,files);try{guard.verify();}finally{guard.close();}
  expect(revisions.projectTransaction(transactionId)?.state).toBe('prepared');
  expect(revisions.compose(db=>db.prepare('SELECT state FROM created_adoption_fact JOIN impact USING(impact_id) WHERE transaction_id=?').get(transactionId)?.state)).toBe('active');
  expect(readdirSync(join(f.root,'publication'))).toEqual([]);
 },120000);
 it('D10 identity missing after publication refuses the original closed commit without consuming authorities',async()=>{
  const f=await fixture(),before=f.revisions.outboxRowCount();
  f.revisions.compose(db=>{
   const sql=String(db.prepare("SELECT sql FROM sqlite_master WHERE name='created_publication_identity_no_delete'").get()?.sql);
   db.exec('DROP TRIGGER created_publication_identity_no_delete');
   try{db.prepare('DELETE FROM created_publication_identity WHERE transaction_id=?').run(f.input.transaction_id);}finally{db.exec(sql);}
  });
  expect(()=>f.revisions.commitPreparedCreatedSource(f.input)).toThrow(/identity/i);
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);expect(f.revisions.outboxRowCount()).toBe(before);
  expect(f.revisions.projectTransaction(f.input.transaction_id)?.state).toBe('prepared');
  expect(f.revisions.compose(db=>db.prepare('SELECT state FROM impact WHERE impact_id=?').get(f.input.impact_id)?.state)).toBe('active');
  expect(f.revisions.compose(db=>db.prepare('SELECT state FROM cp_a0_approval WHERE approval_id=?').get(f.input.approval_id)?.state)).toBe('active');
 },120000);

 it.each(['stage','outer held'] as const)('N3 real issuance revokes a genuine token when the %s guard cleanup fails',async mode=>{
  const fault=new Error('injected post-issuance '+mode+' close');
  let prepared:Awaited<ReturnType<typeof preparedDraftFixture>>|undefined,publisher:CreatedSourcePublisher|undefined;
  let captured:import('../../../src/host/agent-driven/created-source-ports.js').CreatedSourcePublicationProof|undefined;
  let armed=false,matches=0,injected=false,restoreGuard:(()=>void)|undefined,restoreAssert:(()=>void)|undefined;
  const originalClose=RetainedSourceTree.prototype.close;
  try{
   let failure:unknown;
   try{await fixture({onPrepared:f=>{prepared=f;},onPublisher:(p,close)=>{
    publisher=p;ownFaultCleanup(close);
    const originalAssert=p.assertCurrentForCommit.bind(p);
    const assertion=vi.spyOn(p,'assertCurrentForCommit').mockImplementation((...args)=>{
     originalAssert(...args);if(!isCreatedSourcePublicationProof(args[0]))throw Error('Expected genuine issued proof');captured=args[0];armed=true;
    });restoreAssert=()=>assertion.mockRestore();
    const guard=vi.spyOn(RetainedSourceTree.prototype,'close').mockImplementation(function(this:RetainedSourceTree){
     if(armed&&this.root.startsWith(prepared!.taskRoot+'/')&&++matches===(mode==='stage'?1:2)){injected=true;throw fault;}
     return originalClose.call(this);
    });restoreGuard=()=>guard.mockRestore();
   }});}catch(error){failure=error;}
   expect(injected).toBe(true);expect(captured).toBeDefined();
   expect(isCreatedSourcePublicationProof(captured)).toBe(false);
   expect(leaves(failure)).toContain(fault);expect(failure).toMatchObject({requires_reconciliation:true});
   expect(publisher!.isUsable()).toBe(false);expect(prepared!.host.revisions.activeCommit(prepared!.projectId)?.revision).toBe(1);
   expect(await readFile(join(captured!.facts.backup_root,'film.html'))).toEqual(prepared!.authorBytes);
  }finally{restoreGuard?.();restoreAssert?.();if(publisher)await settleFaultCleanup(publisher,[fault]);}
 },120000);
 it('N3 real pending close waits for publication and never returns an issued proof after closing',async()=>{
  let entered!:()=>void,release!:()=>void,publisher:CreatedSourcePublisher|undefined,prepared:Awaited<ReturnType<typeof preparedDraftFixture>>|undefined,parked=false;
  const entry=new Promise<void>(done=>{entered=done;}),gate=new Promise<void>(done=>{release=done;});
  const work=fixture({onPrepared:f=>{prepared=f;},onPublisher:p=>{publisher=p;},fsync:async path=>{
   if(!parked&&path.includes('/staging/')){parked=true;entered();await gate;}
   const fd=await open(path,'r');try{await fd.sync();}finally{await fd.close();}
  }});
  const observed=work.then(result=>({result,error:undefined}),error=>({result:undefined,error}));
  let closing:Promise<void>|undefined;
  try{
   await Promise.race([entry,observed.then(value=>{throw value.error??Error('Publication did not pause at fsync');})]);
   const first=publisher!.close(),second=publisher!.close();closing=first;
   expect(second).toBe(first);let done=false;const closeObserved=first.then(()=>{done=true;},()=>{done=true;});
   await new Promise<void>(resolve=>setImmediate(resolve));expect(done).toBe(false);
   release();const outcome=await observed;expect(outcome.result).toBeUndefined();expect(outcome.error).toBeDefined();
   await Promise.all([first,second,closeObserved]);
   expect(prepared!.host.revisions.activeCommit(prepared!.projectId)?.revision).toBe(1);
   expect(await readFile(join(prepared!.authorRoot,'film.html'))).toEqual(prepared!.authorBytes);
  }finally{release();await observed;if(closing)await closing;}
 },120000);
 it.each([false,true])('N3 real temporary default fsync close preserves uncertainty (sync also fails=%s)',async dual=>{
  const closeFault=Object.assign(new Error('injected observed fsync close failure'),{code:'EIO'}),primary=new Error('injected sync failure');
  let prepared:Awaited<ReturnType<typeof preparedDraftFixture>>|undefined,publisher:CreatedSourcePublisher|undefined;
  let handle:Awaited<ReturnType<typeof open>>|undefined,restoreClose:(()=>Promise<void>)|undefined,injected=false;
  const probe=await open('/dev/null','r'),prototype=Object.getPrototypeOf(probe);await probe.close();
  const original=prototype.sync;
  const spy=vi.spyOn(prototype,'sync').mockImplementation(async function(this:Awaited<ReturnType<typeof open>>,...args:unknown[]){
   const path=await(await import('node:fs/promises')).readlink('/proc/self/fd/'+this.fd);
   if(!injected&&path.includes('/publication-')&&path.includes('/staging/')){
    injected=true;handle=this;restoreClose=this.close.bind(this);
    this.close=async()=>{await restoreClose!();throw closeFault;};
    if(dual)throw primary;
   }
   return Reflect.apply(original,this,args);
  });
  try{
   let failure:unknown;try{await fixture({onPrepared:f=>{prepared=f;},onPublisher:(p,close)=>{publisher=p;ownFaultCleanup(close);}});}catch(error){failure=error;}
   expect(injected).toBe(true);
   expect(leaves(failure)).toEqual(expect.arrayContaining(dual?[primary,closeFault]:[closeFault]));
   expect(failure).toMatchObject({code:'CAPABILITY_UNAVAILABLE',http_status:503,retryable:false,requires_reconciliation:true});
   expect(JSON.stringify(failure)).not.toContain(prepared!.root);expect(publisher!.isUsable()).toBe(false);
   if(handle&&restoreClose)handle.close=restoreClose;
   await expect(publisher!.close()).rejects.toBeInstanceOf(PublicationCleanupError);
   expect(prepared!.host.revisions.activeCommit(prepared!.projectId)?.revision).toBe(1);
  }finally{spy.mockRestore();if(handle&&restoreClose)handle.close=restoreClose;if(publisher)await settleFaultCleanup(publisher,dual?[primary,closeFault]:[closeFault]);}
 },120000);
 it.each([false,true])('N3 real temporary style descriptor close preserves uncertainty (stat also fails=%s)',async dual=>{
  const closeFault=Object.assign(new Error('injected observed style close failure'),{code:'EIO'}),primary=new Error('injected style stat failure');
  const native=createRequire(import.meta.url)('node:fs') as typeof import('node:fs');
  const originalClose=native.closeSync,originalStat=Object.getOwnPropertyDescriptor(native,'fstatSync')!;
  const target=native.realpathSync(join(vendorRoot,'packages/openfilm/studio/server/film-subtitle.mjs'));
  let prepared:Awaited<ReturnType<typeof preparedDraftFixture>>|undefined,publisher:CreatedSourcePublisher|undefined,injected=false;
  const targetOf=(fd:number)=>{try{return native.readlinkSync('/proc/self/fd/'+fd);}catch{return '';}};
  try{
   let failure:unknown;
   try{await fixture({onPrepared:f=>{prepared=f;ownFaultCleanup(f.close);},onPublisher:(p,close)=>{
    publisher=p;ownFaultCleanup(close);
    native.closeSync=(fd:number)=>{const matched=targetOf(fd)===target;originalClose(fd);if(matched){injected=true;throw closeFault;}};
    Object.defineProperty(native,'fstatSync',{...originalStat,value:(...args:unknown[])=>{
     if(dual&&targetOf(args[0] as number)===target)throw primary;
     return Reflect.apply(originalStat.value,native,args);
    }});syncBuiltinESMExports();
   }});}catch(error){failure=error;}
   expect(injected).toBe(true);
   expect(leaves(failure)).toEqual(expect.arrayContaining(dual?[primary,closeFault]:[closeFault]));
   expect(failure).toMatchObject({code:'CAPABILITY_UNAVAILABLE',http_status:503,retryable:false,requires_reconciliation:true});
   expect(publisher!.isUsable()).toBe(false);expect(JSON.stringify(failure)).not.toContain(prepared!.root);
   await expect(prepared!.verifier.close()).rejects.toBeInstanceOf(PublicationCleanupError);
   await expect(publisher!.close()).rejects.toBeInstanceOf(PublicationCleanupError);
   expect(prepared!.host.revisions.activeCommit(prepared!.projectId)?.revision).toBe(1);
  }finally{
   native.closeSync=originalClose;Object.defineProperty(native,'fstatSync',originalStat);syncBuiltinESMExports();
   const known:readonly unknown[]=dual?[primary,closeFault]:[closeFault];if(publisher)await settleFaultCleanup(publisher,known);
   if(prepared){
    // The fixture's generic close stops at verifier failure. This case owns each
    // teardown step and permits only the deliberately recorded close uncertainty.
    const unexpected:unknown[]=[];
    try{await prepared.worker.close();}catch(error){unexpected.push(error);}
    let verifierFailed=false;
    try{await prepared.verifier.close();}catch(error){verifierFailed=true;if(!(error instanceof PublicationCleanupError)||leaves(error).some(cause=>!known.includes(cause)))unexpected.push(error);}
    try{await prepared.processor.close();}catch(error){if(!verifierFailed||!(error&&typeof error==='object'&&'code'in error&&error.code==='CAPABILITY_UNAVAILABLE'))unexpected.push(error);}
    try{await prepared.registry.close();}catch(error){unexpected.push(error);}
    try{await prepared.host.close();}catch(error){unexpected.push(error);}
    try{await(await import('node:fs/promises')).rm(prepared.root,{recursive:true,force:true});}catch(error){unexpected.push(error);}
    if(unexpected.length)throw new AggregateError(unexpected,'Unexpected temporary-handle fixture cleanup failure');
   }
  }
 },120000);
 const leaves=(error:unknown):unknown[]=>error instanceof PublicationCleanupError?error.errors.flatMap(leaves):[error];
 const ownFaultCleanup=(close:()=>Promise<void>)=>{const index=cleanups.indexOf(close);expect(index).toBeGreaterThanOrEqual(0);cleanups.splice(index,1);};
 const settleFaultCleanup=async(publisher:CreatedSourcePublisher,known:readonly unknown[])=>{
  try{await publisher.close();}catch(error){
   if(!(error instanceof PublicationCleanupError)||leaves(error).some(cause=>!known.includes(cause)))throw error;
  }
 };
 it('N3 real publication attempts every guard when verifier release fails and never revives the proof',async()=>{
  const f=await fixture();ownFaultCleanup(f.closePublisher);
  const fault=new Error('injected verifier release before close'),roots:string[]=[],original=RetainedSourceTree.prototype.close;
  const guardSpy=vi.spyOn(RetainedSourceTree.prototype,'close').mockImplementation(function(this:RetainedSourceTree){roots.push(this.root);return original.call(this);});
  const releaseSpy=vi.spyOn(f.verifier,'release').mockImplementationOnce(()=>{throw fault;});
  try{
   let failure:unknown;try{f.publisher.release(f.proof);}catch(error){failure=error;}
   expect(isCreatedSourcePublicationProof(f.proof)).toBe(false);
   expect(roots).toEqual(expect.arrayContaining([f.authorRoot,f.proof.facts.backup_root,join(f.root,'snapshots',f.projectId,f.plan.target_snapshot_id,'source')]));
   expect(failure).toBeInstanceOf(PublicationCleanupError);expect(f.publisher.isUsable()).toBe(false);
   releaseSpy.mockRestore();guardSpy.mockRestore();
   const first=f.publisher.close(),second=f.publisher.close();expect(second).toBe(first);
   await Promise.all([expect(first).rejects.toBeInstanceOf(PublicationCleanupError),expect(second).rejects.toBeInstanceOf(PublicationCleanupError)]);
   expect(()=>f.revisions.commitPreparedCreatedSource(f.input)).toThrow();expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
  }finally{releaseSpy.mockRestore();guardSpy.mockRestore();await settleFaultCleanup(f.publisher,[fault]);}
 },120000);
 it('N3 real publication attempts other guards after the first guard close fails',async()=>{
  const f=await fixture();ownFaultCleanup(f.closePublisher);
  const fault=new Error('injected guard close before close'),completed:string[]=[],original=RetainedSourceTree.prototype.close;let injected=false;
  const spy=vi.spyOn(RetainedSourceTree.prototype,'close').mockImplementation(function(this:RetainedSourceTree){
   if(!injected){injected=true;throw fault;}original.call(this);completed.push(this.root);
  });
  try{
   let failure:unknown;try{f.publisher.release(f.proof);}catch(error){failure=error;}
   expect(injected).toBe(true);
   expect(completed).toEqual(expect.arrayContaining([f.authorRoot,f.proof.facts.backup_root]));
   expect(failure).toBeInstanceOf(PublicationCleanupError);expect(isCreatedSourcePublicationProof(f.proof)).toBe(false);
  }finally{spy.mockRestore();await settleFaultCleanup(f.publisher,[fault]);}
 },120000);
 it('N3 real publication preserves the primary publish failure and cleanup failures together',async()=>{
  const primary=new Error('injected publish fsync failure'),cleanup=new Error('injected cleanup before close');
  let prepared:Awaited<ReturnType<typeof preparedDraftFixture>>|undefined,publisher:CreatedSourcePublisher|undefined,armed=false,injected=false;
  let spy:ReturnType<typeof vi.spyOn>|undefined;
  const original=RetainedSourceTree.prototype.close;
  try{
   let failure:unknown;
   try{await fixture({onPrepared:f=>{prepared=f;spy=vi.spyOn(RetainedSourceTree.prototype,'close').mockImplementation(function(this:RetainedSourceTree){
     if(armed&&!injected){injected=true;throw cleanup;}return original.call(this);
    });},onPublisher:(value,close)=>{publisher=value;ownFaultCleanup(close);},fsync:async path=>{
     if(path.includes('/staging/')&&path.endsWith('/film.html')){armed=true;throw primary;}
     const fd=await open(path,'r');try{await fd.sync();}finally{await fd.close();}
    }});}catch(error){failure=error;}
   expect(injected).toBe(true);
   expect(leaves(failure)).toEqual(expect.arrayContaining([primary,cleanup]));
   expect(failure).toBeInstanceOf(PublicationCleanupError);
   expect(await readFile(join(prepared!.authorRoot,'film.html'))).toEqual(prepared!.authorBytes);
   expect(prepared!.host.revisions.activeCommit(prepared!.projectId)?.revision).toBe(1);
  }finally{spy?.mockRestore();if(publisher)await settleFaultCleanup(publisher,[primary,cleanup]);}
 },120000);
 it('refuses authority expiring during the final creative closure scan',async()=>{
  const f=await fixture(),workflow=new FixedWorkflowService({repository:f.repo});
  const before=await workflow.readWorkflow(f.projectId,f.owner),outbox=f.revisions.outboxRowCount();
  const expires=f.revisions.compose(db=>Number(db.prepare('SELECT expires_at FROM cp_a0_approval WHERE approval_id=?').get(f.input.approval_id)!.expires_at))*1000;
  const original=ProductSqliteRepository.prototype.joinCreatedSourceCommit;
  let crossed=false;
  vi.spyOn(ProductSqliteRepository.prototype,'joinCreatedSourceCommit').mockImplementation(function<T>(this:ProductSqliteRepository,scope:CreatedSourceCommitScope,work:(tx:ProductTransaction)=>T):T{
   return original.call(this,scope,(tx:ProductTransaction)=>work(new Proxy(tx,{get(target,property,receiver){
    if(property!=='list')return Reflect.get(target,property,receiver);
    return ((...args:Parameters<ProductTransaction['list']>)=>{const rows=Reflect.apply(target.list,target,args);
     if(args[0]==='question_head'){crossed=true;vi.setSystemTime(expires);}return rows;}) as ProductTransaction['list'];
   }}))) as T;
  });
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(expires-100);
  try{expect(()=>f.revisions.commitPreparedCreatedSource(f.input)).toThrow('AUTHORITY_EXPIRED_AT_COMMIT');expect(crossed).toBe(true);
   expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);expect(f.revisions.outboxRowCount()).toBe(outbox);
   expect(await workflow.readWorkflow(f.projectId,f.owner)).toEqual(before);
   expect(f.revisions.projectTransaction(f.input.transaction_id)?.state).toBe('prepared');
   expect(f.revisions.compose(db=>db.prepare('SELECT state FROM impact WHERE impact_id=?').get(f.input.impact_id)?.state)).toBe('active');
   expect(f.revisions.compose(db=>db.prepare('SELECT state FROM cp_a0_approval WHERE approval_id=?').get(f.input.approval_id)?.state)).toBe('active');
   expect(new OperationIdempotencyStore(f.revisions.compose(db=>db)).recall(f.projectId,'agent.v1:change.apply',f.input.idempotency_key)).toBeUndefined();
  }finally{vi.useRealTimers();}
 },120000);
 it('rolls back checkpoint, attempt and every authority after a post-checkpoint transaction failure',async()=>{
  const f=await fixture(),workflow=new FixedWorkflowService({repository:f.repo});
  const before=await workflow.readWorkflow(f.projectId,f.owner),outbox=f.revisions.outboxRowCount();
  f.revisions.compose(db=>db.exec("CREATE TEMP TRIGGER fail_created_terminal BEFORE UPDATE OF state ON project_transaction WHEN NEW.state='committed' BEGIN SELECT RAISE(ABORT,'after checkpoint fault'); END"));
  expect(()=>f.revisions.commitPreparedCreatedSource(f.input)).toThrow('after checkpoint fault');
  expect(await workflow.readWorkflow(f.projectId,f.owner)).toEqual(before);
  expect(await f.repo.transaction(tx=>tx.get('step_attempt',{project_id:f.projectId,run_id:f.input.execution.run_id,plan_version:1,step_id:f.input.execution.step_id,attempt:f.input.execution.attempt})?.state)).toBe('waiting_user');
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);expect(f.revisions.outboxRowCount()).toBe(outbox);
  expect(f.revisions.projectTransaction(f.input.transaction_id)?.state).toBe('prepared');
  expect(f.revisions.compose(db=>db.prepare('SELECT state FROM impact WHERE impact_id=?').get(f.input.impact_id)?.state)).toBe('active');
  expect(f.revisions.compose(db=>db.prepare('SELECT state FROM cp_a0_approval WHERE approval_id=?').get(f.input.approval_id)?.state)).toBe('active');
 },120000);
 it('poisons a swallowed read of another intake inside the project commit scope',async()=>{
  const f=await fixture(),original=ProductSqliteRepository.prototype.joinCreatedSourceCommit;
  vi.spyOn(ProductSqliteRepository.prototype,'joinCreatedSourceCommit').mockImplementation(function<T>(this:ProductSqliteRepository,scope:CreatedSourceCommitScope,work:(tx:ProductTransaction)=>T):T{
   return original.call(this,scope,(tx:ProductTransaction)=>{try{tx.get('intake_head',{intake_id:'another-intake'});}catch{}return work(tx);}) as T;
  });
  expect(()=>f.revisions.commitPreparedCreatedSource(f.input)).toThrow();expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
 },120000);
 it('rejects a real intake update after approval without consuming database authorities',async()=>{
  const f=await fixture(),creation=f.app.creation.forProject(f.projectId)!;
  const current=await f.repo.transaction(tx=>{const head=tx.get('intake_head',{intake_id:creation.request.intake_id})!;
   return tx.get('intake_version',{intake_id:head.intake_id,version:head.current_version})!;});
  const authority=new CreativeProjectAuthority(f.app.creation);
  const creative=new CreativeService({repository:f.repo,artifactAuthority:authority.assertArtifact,contentAuthority:authority.assertContent});
  await creative.putIntake({meta:{idempotency_key:'after-approval-intake',correlation_id:'after-approval-intake'},
   intake_id:current.intake_id,base_version:current.version,brief:{...current.content_json,topic:current.content_json.topic+' 修订'}},f.owner);
  const before=f.revisions.outboxRowCount();
  expect(()=>f.revisions.commitPreparedCreatedSource(f.input)).toThrow('CREATIVE_INPUT_CHANGED');
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);expect(f.revisions.outboxRowCount()).toBe(before);
  expect(f.revisions.compose(db=>db.prepare('SELECT state FROM impact WHERE impact_id=?').get(f.input.impact_id)?.state)).toBe('active');
  expect(f.revisions.compose(db=>db.prepare('SELECT state FROM cp_a0_approval WHERE approval_id=?').get(f.input.approval_id)?.state)).toBe('active');
 },120000);
 it.each(['pending','rejected'] as const)('rejects a predecessor gate changed to %s after approval',async state=>{
  const f=await fixture(),execution=f.input.execution;
  await f.repo.transaction(tx=>{const key={project_id:f.projectId,run_id:execution.run_id},run=tx.get('run',key)!;
   tx.put('run',key,{...run,checkpoint_json:{...run.checkpoint_json,gates:run.checkpoint_json.gates.map(g=>g.kind==='definition'?{...g,state}:g)}});});
  const before=f.revisions.outboxRowCount();let failure:unknown;try{f.revisions.commitPreparedCreatedSource(f.input);}catch(error){failure=error;}
  expect(failure).toMatchObject({code:'RUN_GATE_BLOCKED',details:{gate_kind:'definition',gate_state:state}});
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);expect(f.revisions.outboxRowCount()).toBe(before);
  expect(f.revisions.compose(db=>db.prepare('SELECT state FROM impact WHERE impact_id=?').get(f.input.impact_id)?.state)).toBe('active');
  expect(f.revisions.compose(db=>db.prepare('SELECT state FROM cp_a0_approval WHERE approval_id=?').get(f.input.approval_id)?.state)).toBe('active');
 },120000);
 it('persists the same succeeded attempt in workflow checkpoint and a freshly opened SQLite reader',async()=>{
  const f=await fixture(),workflow=new FixedWorkflowService({repository:f.repo});
  const before=await workflow.readWorkflow(f.projectId,f.owner);
  expect(before.nodes.find(n=>n.node_id===f.input.execution.step_id)?.state).toBe('waiting_user');
  f.revisions.commitPreparedCreatedSource(f.input);
  const after=await workflow.readWorkflow(f.projectId,f.owner);
  expect(after.workflow_revision).toBe(before.workflow_revision+1);
  expect(await f.repo.transaction(tx=>tx.get('step_attempt',{project_id:f.projectId,run_id:f.input.execution.run_id,plan_version:1,step_id:f.input.execution.step_id,attempt:f.input.execution.attempt})?.state)).toBe('succeeded');
  expect(after.nodes.find(n=>n.node_id===f.input.execution.step_id)).toMatchObject({state:'succeeded',job_id:f.task.job_id});
  const reopened=new RevisionStore(join(f.root,'host.sqlite'));
  try{const fresh=new FixedWorkflowService({repository:new ProductSqliteRepository(reopened)});
   expect(await fresh.readWorkflow(f.projectId,f.owner)).toEqual(after);
  }finally{reopened.close();}
 },120000);
 it('publishes complete native source, commits once, preserves R1 geometry and replays without a second commit',async()=>{
  const f=await fixture();expect(isCreatedSourcePublicationProof(f.proof)).toBe(true);
  const before=f.revisions.outboxRowCount();const applied=f.revisions.commitPreparedCreatedSource(f.input);
  expect(applied).toMatchObject({project_revision:2,snapshot_id:f.plan.target_snapshot_id,replayed:false});
  expect(f.app.creation.sourceFact(f.projectId,applied.snapshot_id)?.frame_count).toBe(90);
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(2);
  expect(f.revisions.commitPreparedCreatedSource(f.input)).toEqual({...applied,replayed:true});
  expect(f.revisions.outboxRowCount()).toBe(before+2);
 },120000);
 it('refuses a prepared transaction of another kind before publishing source',async()=>{
  let prepared:Awaited<ReturnType<typeof preparedDraftFixture>>|undefined;
  await expect(fixture({transactionKind:'snapshot_publish',onPrepared:f=>{prepared=f;}})).rejects.toThrow(/bindings changed/);
  expect(prepared!.host.revisions.activeCommit(prepared!.projectId)?.revision).toBe(1);
 },120000);
 it('refuses a workflow attempt detached from the actual prepared job',async()=>{
  const f=await fixture(),execution=f.input.execution;
  await f.repo.transaction(tx=>{const key={project_id:f.projectId,run_id:execution.run_id,plan_version:1 as const,step_id:execution.step_id,attempt:execution.attempt};
   const step=tx.get('step_attempt',key)!;tx.put('step_attempt',key,{...step,job_id:null});});
  expect(()=>f.revisions.commitPreparedCreatedSource(f.input)).toThrow();expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
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
