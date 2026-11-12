import {validateAgentDefinition} from '../../../src/contracts/agent-driven-validator.js';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {RevisionStore} from '../../../src/host/projects/revision-store.js';
import {ProjectCreationStore} from '../../../src/host/projects/project-creation-store.js';
import {ProjectCoordinator} from '../../../src/host/projects/project-coordinator.js';
import {InMemoryProjectOperationQueue} from '../../../src/host/projects/project-operation-queue.js';
import {RetainedSourceTree} from '../../../src/host/agent-driven/retained-source-tree.js';
import {PublicationCleanupError} from '../../../src/host/agent-driven/publication-cleanup.js';
import type {ApplyChange} from '../../../src/contracts/agent-driven-types.js';
import {readFile,writeFile,stat,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {preparedDraftFixture,waitForCompletedDraft} from './helpers/created-draft-fixture.js';
import {canonicalDigest,canonicalJson,contentDigest} from '../../../src/host/creative/digest.js';
import {CreatedPreparedSourceStore} from '../../../src/host/agent-driven/created-prepared-source-store.js';
import {CreatedSourceImpactStore} from '../../../src/host/agent-driven/created-source-impact-store.js';
import {CreatedSourceAdoptionStore} from '../../../src/host/agent-driven/created-source-adoption-store.js';
import {CreatedSourceChangeService} from '../../../src/host/agent-driven/created-source-change-service.js';
import {CreatedSourceFactsReader} from '../../../src/host/agent-driven/created-source-facts-reader.js';
import {CreativeProjectAuthority} from '../../../src/host/agent-driven/creative-project-authority.js';
import {CreatedSourcePublisher,preparedSourceConsumerGraph} from '../../../src/host/agent-driven/created-source-publisher.js';
import {CreatedSourceRecovery} from '../../../src/host/agent-driven/created-source-recovery.js';
import {ImpactStore} from '../../../src/host/impact/impact-store.js';
import {OperationIdempotencyStore} from '../../../src/host/projects/operation-idempotency-store.js';
import {computeSourceDigest} from '../../../src/host/engine/source-digest-v1.js';
import {OPENFILM_UPSTREAM_SHA} from '../../../src/host/engine/engine-binding-store.js';
import type {PreparedAdoptionPlanV1} from '../../../src/host/agent-driven/created-source-ports.js';
import {preparedAdoptionPlanDigest} from '../../../src/host/agent-driven/created-source-ports.js';
import type {ReviewPackage} from '../../../src/contracts/agent-driven-types.js';

/**
 * Business recovery evidence for the created-source adoption family.
 *
 * Every case below runs on the real created bootstrap -> SOURCE_ONLY producer -> publisher
 * chain over a real SQLite database and real files. Nothing here proves a Host startup
 * wiring, a real SIGKILL, an official render or a human acceptance.
 *
 * Two expectations of the first candidate were reversed by the MAIN ruling of 2026-11-12
 * (`R2/D10_MAIN_RULING_REQUEST_AND_DURABLE_RECOVERY.md`). Both reversals are marked in
 * place with the reason, and the rejected expectation is kept in the case itself so the
 * reversal stays readable:
 *
 * - a marker-only request is never compensated and never aborted; it is preserved and
 *   the original coordinator records a real attention;
 * - an attention is a persistent fact in the original database, not a returned label.
 */

const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const close of cleanups.splice(0).reverse())await close();});

async function recoveryFixture(options:{publish?:boolean}={}){
 const f=await preparedDraftFixture();cleanups.push(f.close);f.worker.start();const completed=await waitForCompletedDraft(f);await f.worker.close();
 const revisions=f.host.revisions,repo=f.repo,now=new Date(),execution=f.task.request.execution;
 if(completed.fact.plan_digest===null)throw Error('Assembly must produce a native plan digest');
 const prepared=new CreatedPreparedSourceStore(revisions),adoptions=new CreatedSourceAdoptionStore(revisions);
 let selection=0;
 const operations=new OperationIdempotencyStore(revisions.compose(db=>db));
 const impacts=new CreatedSourceImpactStore(revisions,new ImpactStore(revisions,operations));
 const metadata=JSON.parse(await readFile(join(completed.root,'prepared-native.json'),'utf8')) as Parameters<typeof preparedSourceConsumerGraph>[0];
 const factDigest=canonicalDigest(completed.fact);
 const original=await computeSourceDigest({root:f.authorRoot,roots:f.app.creation.sourceFact(f.projectId,f.commit.snapshot_id)!.roots,engine:'openfilm',engineUpstreamSha:OPENFILM_UPSTREAM_SHA});
 const originalFiles=[...original.manifest.files,...original.manifest.assets].map(file=>({relative_path:file.path,bytes:file.size,sha256:file.sha256}));
 const mapping=prepared.register({project_id:f.projectId,job_id:f.task.job_id,request_digest:f.task.request_digest,
  fact_digest:factDigest,execution,base_revision:1,source_digest:f.commit.source_digest,plan_sha256:completed.fact.plan_digest,
  rights_digest:completed.fact.rights_digest,frame_count:90,fps_numerator:30,fps_denominator:1,stage_root:completed.root,roots:completed.fact.roots,files:completed.fact.files});
 const reader=new CreatedSourceFactsReader({host:f.host,authority:new CreativeProjectAuthority(f.app.creation),prepared,tasks:f.tasks,
  assets:f.registry,verifier:f.verifier,selection:{currentSelectionVersion:()=>selection},stageDomainRoot:f.taskRoot});
 cleanups.push(()=>reader.close());
 const readInput={project_id:f.projectId,prepared_source_id:mapping.prepared_source_id,execution};
 const readProof=await reader.acquire(readInput,'owner');
 reader.release(readProof);
 const changeService=new CreatedSourceChangeService({host:f.host,prepared,impacts,facts:reader,authority:new CreativeProjectAuthority(f.app.creation)});
 const change=await changeService.prepare({meta:{idempotency_key:'recovery-prepare',correlation_id:'recovery-prepare'},project_id:f.projectId,
  materialization_id:mapping.prepared_source_id,base_revision:1,source_digest:f.commit.source_digest,selection_version:0,execution},'owner');
 const impactId=change.impact_id;
 const storedPlan=impacts.planFact(impactId)!.plan as PreparedAdoptionPlanV1;
 const planDigest=preparedAdoptionPlanDigest(storedPlan),transactionId='txn_'+randomUUID().replaceAll('-','');
 const approvalId='approval_'+randomUUID().replaceAll('-',''),confirmationId='confirm_'+randomUUID().replaceAll('-',''),reviewId='review_'+randomUUID().replaceAll('-',''),packageId='package_'+randomUUID().replaceAll('-','');
 const applyChange={meta:{idempotency_key:'module-apply',correlation_id:'module-root'},project_id:f.projectId,impact_id:impactId,approval_id:approvalId,
  base_revision:1,source_digest:storedPlan.base_source_digest,execution};
 const requestDigest=contentDigest(applyChange);
 const pkg:ReviewPackage={project_id:f.projectId,run_id:execution.run_id,plan_version:1,package_id:packageId,version:1,kind:'sample',chapter_id:null,
  input_digest:execution.input_digest,output_digest:completed.fact.source_digest,quality_digest:canonicalDigest({fixture:'accepted review policy only'}),
  parts:(['preview','narration','subtitles','shot_summary','rights_quality'] as const).map(kind=>({kind,artifact_ref:{id:'module-'+kind,version:1,sha256:factDigest},download_ref:null})),source_shot_ids:[...metadata.clip_ids],selection_reason:'Module fixture; no human review or UI claim',allowed_choices:['accept_and_adopt'],
  impact:{impact_id:impactId,project_id:f.projectId,materialization_id:mapping.prepared_source_id,base_revision:1,control_revision:0,source_digest:storedPlan.base_source_digest,
   selection_version:0,plan_sha256:planDigest,target_snapshot_id:storedPlan.target_snapshot_id,expires_at:storedPlan.expires_at,state:'active',summary:'module fixture'},
  reuse_of_package_id:null,review_url:`/workbench/projects/${f.projectId}/reviews/${reviewId}`,state:'accepted'};
 const packageDigest=canonicalDigest(pkg);
 // The original database holds the prepared authorization behind a foreign key on the
 // transaction row, so the transaction exists before the authorization that names it.
 revisions.beginTransaction({transaction_id:transactionId,project_id:f.projectId,kind:'edit',correlation_id:'module-root',
  request_json:canonicalJson({operation:'agent.created_source.apply@1',input:applyChange}),request_hash:requestDigest,base_revision:1});
 await repo.transaction(tx=>{
  const actionDigest=planDigest;
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
  const runKey={project_id:f.projectId,run_id:execution.run_id},run=tx.get('run',runKey)!;
  tx.put('run',runKey,{...run,checkpoint_json:{...run.checkpoint_json,
   workflow_revision:run.checkpoint_json.workflow_revision+1,
   gates:run.checkpoint_json.gates.map(g=>g.kind==='sample'?{...g,state:'accepted' as const,review_package_id:reviewId}:g)}});
 });
 prepared.bindPackage({prepared_source_id:mapping.prepared_source_id,package_id:packageId,package_version:1,receipt_digest:packageDigest});
 adoptions.record({transaction_id:transactionId,project_id:f.projectId,prepared_source_id:mapping.prepared_source_id,impact_id:impactId,approval_id:approvalId,
  plan_sha256:planDigest,facts_digest:planDigest,original_source_digest:storedPlan.base_source_digest,target_source_digest:storedPlan.target_source_digest,expected_snapshot_id:storedPlan.target_snapshot_id,
  native_plan:storedPlan.native_plan,original_closure:originalFiles,target_closure:storedPlan.files,stage_root:completed.root,backup_token:'backup_'+transactionId,execution,now});
 for(const [from,to]of [['received','preconditions_checked'],['preconditions_checked','staged'],['staged','validated'],['validated','prepared']] as const)revisions.transition(transactionId,from,to);
 const publisherPrivateRoot=join(f.root,'publication',f.projectId);
 const publisher=new CreatedSourcePublisher({revisions,authorRoot:f.authorRoot,privateRoot:publisherPrivateRoot,snapshots:f.host.snapshots,
  selection:{currentSelectionVersion:()=>selection},assets:f.registry,tasks:f.tasks,verifier:f.verifier,stageDomainRoot:f.taskRoot});
 cleanups.push(()=>publisher.close());
 const publicationInput={project_id:f.projectId,transaction_id:transactionId,prepared_source_id:mapping.prepared_source_id,stage_root:completed.root,files:storedPlan.files,
  original_source_digest:storedPlan.base_source_digest,published_source_digest:storedPlan.target_source_digest,target_snapshot_id:storedPlan.target_snapshot_id};
 // The publication is optional so that the early, never-published branch can be proved
 // on a project whose author root still holds the committed base.
 if(options.publish!==false)await publisher.publish(publicationInput);
 // The bytes and the identity of the author file as they are right now. A recovery that
 // compensates would replace them; a recovery that preserves would not.
 const authorPath=join(f.authorRoot,'film.html');
 const authorBytesNow=await readFile(authorPath);
 const authorIdentityNow=await stat(authorPath);
 const recovery=new CreatedSourceRecovery({host:f.host,creation:f.app.creation,tasks:f.tasks,assets:f.registry,verifier:f.verifier,
  selection:{currentSelectionVersion:()=>selection},createdRoot:dirname(dirname(f.authorRoot)),privateRoot:join(f.root,'publication'),stageDomainRoot:f.taskRoot});
 cleanups.push(()=>recovery.close());
 return {...f,revisions,repo,plan:storedPlan,impactId,approvalId,confirmationId,reviewId,packageId,transactionId,adoptions,publisher,publicationInput,
  applyChange,requestDigest,recovery,originalFiles,authorBytes:f.authorBytes,publisherPrivateRoot,authorPath,authorBytesNow,authorIdentityNow,
  advanceSelection:()=>selection++};
}

/** Everything a recovery must not change when it refuses to decide a transaction. */
async function witness(f:Awaited<ReturnType<typeof recoveryFixture>>){
 const db=f.revisions.compose(value=>value);
 const required=<T>(row:T|undefined,what:string):T=>{if(row===undefined)throw Error('Missing witness row: '+what);return row;};
 const approval=required(db.prepare('SELECT state,consumed_transaction_id FROM cp_a0_approval WHERE approval_id=?').get(f.approvalId) as {state:string;consumed_transaction_id:unknown}|undefined,'approval');
 const impact=required(db.prepare('SELECT state FROM impact WHERE impact_id=?').get(f.impactId) as {state:string}|undefined,'impact');
 const project=required(db.prepare('SELECT revision,source_digest,control_revision FROM project_state WHERE project_id=?').get(f.projectId) as {revision:number;source_digest:string;control_revision:number}|undefined,'project_state');
 const active=required(db.prepare('SELECT revision,snapshot_id,source_digest FROM active_commit WHERE project_id=?').get(f.projectId) as {revision:number;snapshot_id:string;source_digest:string}|undefined,'active_commit');
 const step=required(db.prepare('SELECT state,attempt,job_id FROM cp_a0_step_attempt WHERE project_id=? AND run_id=? AND step_id=?').get(f.projectId,f.task.request.execution.run_id,f.task.request.execution.step_id) as {state:string;attempt:number;job_id:string}|undefined,'step_attempt');
 const outbox=required(db.prepare('SELECT COUNT(*) AS n FROM outbox WHERE project_id=?').get(f.projectId) as {n:number},'outbox');
 const idempotency=required(db.prepare('SELECT COUNT(*) AS n FROM operation_idempotency WHERE project_id=?').get(f.projectId) as {n:number},'idempotency');
 const journal=db.prepare('SELECT phase FROM created_publication_journal WHERE transaction_id=? ORDER BY phase').all(f.transactionId).map(row=>String(row.phase));
 return {approval,impact,project,active,step,outbox,idempotency,journal};
}

describe('D10 created-source business recovery',()=>{
 it('D10 recovery commits the original published transaction exactly once and replays its receipt',async()=>{
  const f=await recoveryFixture();
  expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('prepared');
  const result=await f.recovery.recoverTransaction(f.transactionId);
  expect(result).toMatchObject({outcome:'committed',reason:'RECOVERED_COMMIT',revision:2});
  expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('committed');
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(2);
  const approval=f.revisions.compose(db=>db.prepare('SELECT state,consumed_transaction_id FROM cp_a0_approval WHERE approval_id=?').get(f.approvalId));
  expect(approval).toMatchObject({state:'consumed',consumed_transaction_id:f.transactionId});
  const again=await f.recovery.recoverTransaction(f.transactionId);
  expect(again).toMatchObject({outcome:'already_committed',reason:'ALREADY_COMMITTED',revision:2});
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(2);
 },120000);

 it('D10 recovery reconstructs a missing published journal from the actual resources and commits once',async()=>{
  const f=await recoveryFixture();
  f.revisions.compose(db=>{const sql=String(db.prepare("SELECT sql FROM sqlite_master WHERE name='created_publication_journal_no_delete'").get()?.sql);
   db.exec('DROP TRIGGER created_publication_journal_no_delete');try{db.prepare("DELETE FROM created_publication_journal WHERE transaction_id=? AND phase='published'").run(f.transactionId);}finally{db.exec(sql);}});
  const result=await f.recovery.recoverTransaction(f.transactionId);
  expect(result).toMatchObject({outcome:'committed',reason:'RECOVERED_PUBLISHED_JOURNAL',revision:2});
  expect(f.revisions.compose(db=>db.prepare('SELECT phase FROM created_publication_journal WHERE transaction_id=?').all(f.transactionId).map(r=>String(r.phase)))).toEqual(['prepared','published']);
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(2);
 },120000);

 it('D10 recovery never takes over an unknown operation or an unknown transaction kind',async()=>{
  const f=await recoveryFixture();
  const other='txn_'+randomUUID().replaceAll('-','');
  f.revisions.beginTransaction({transaction_id:other,project_id:f.projectId,kind:'edit',correlation_id:'other',
   request_json:canonicalJson({operation:'agent.some.other@1'}),request_hash:contentDigest({operation:'agent.some.other@1'}),base_revision:1});
  const foreign=await f.recovery.recoverTransaction(other);
  expect(foreign).toMatchObject({outcome:'not_owned',reason:'NOT_A_CREATED_TRANSACTION'});
  expect(f.revisions.projectTransaction(other)?.state).toBe('received');
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
 },120000);

 it('D10 recovery preserves the published source and refuses a marker-only request with a real attention',async()=>{
  const f=await recoveryFixture();
  const before=await witness(f);
  // A marker-only request is not a legitimate ApplyChange wrapper. The first candidate
  // compensated the source and aborted this row; the MAIN ruling reversed that: the
  // request is damaged, so nothing is moved, nothing is aborted and an operator is told.
  f.revisions.compose(db=>db.prepare('UPDATE project_transaction SET request_json=? WHERE transaction_id=?')
   .run(canonicalJson({operation:'agent.created_source.apply@1'}),f.transactionId));
  const result=await f.recovery.recoverTransaction(f.transactionId);
  expect(result).toMatchObject({outcome:'attention',reason:'REQUEST_NOT_LEGITIMATE'});
  // The attention is a persistent fact of the original database, not a returned label.
  expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('attention');
  expect(f.revisions.projectTransaction(f.transactionId)?.terminal_reason).toBe('REQUEST_NOT_LEGITIMATE');
  expect(f.revisions.compose(db=>db.prepare('SELECT attention,attention_reason FROM project_state WHERE project_id=?').get(f.projectId)))
   .toMatchObject({attention:1,attention_reason:'REQUEST_NOT_LEGITIMATE'});
  // The complete file bytes and the file identity are untouched: nothing was moved.
  expect(await readFile(f.authorPath)).toEqual(f.authorBytesNow);
  expect((await stat(f.authorPath)).ino).toBe(f.authorIdentityNow.ino);
  // No authority, revision, pointer, impact, step, outbox or idempotency row changed.
  const after=await witness(f);
  expect(after.approval).toMatchObject({state:'active',consumed_transaction_id:null});
  expect(after.impact).toMatchObject({state:before.impact.state});
  expect(after.project).toMatchObject({revision:before.project.revision,source_digest:before.project.source_digest,control_revision:before.project.control_revision});
  expect(after.active).toMatchObject({revision:before.active.revision,snapshot_id:before.active.snapshot_id,source_digest:before.active.source_digest});
  expect(after.step).toMatchObject({state:before.step.state,attempt:before.step.attempt});
  expect(after.outbox).toMatchObject(before.outbox);
  expect(after.idempotency).toMatchObject(before.idempotency);
  expect(after.journal).toEqual(before.journal);
 },120000);

 it('D10 recovery aborts an early unpublished transaction after proving the complete original closure',async()=>{
  // No publication happened for this project, so the author root still holds the
  // committed base. The early branch proves that from the real files; it never borrows
  // the published target of another transaction as a claim that nothing changed.
  const f=await recoveryFixture({publish:false});
  expect(f.applyChange.source_digest).toBe(f.commit.source_digest);
  const early='txn_'+randomUUID().replaceAll('-','');
  f.revisions.beginTransaction({transaction_id:early,project_id:f.projectId,kind:'edit',correlation_id:'early',
   request_json:canonicalJson({operation:'agent.created_source.apply@1',input:f.applyChange}),request_hash:f.requestDigest,base_revision:1,createdAt:new Date(0)});
  const result=await f.recovery.recoverTransaction(early);
  expect(result).toMatchObject({outcome:'aborted',reason:'PROVEN_ABORTED'});
  expect(f.revisions.projectTransaction(early)?.state).toBe('aborted');
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
  // The author root still holds the committed base: the abort moved nothing.
  expect(await readFile(f.authorPath)).toEqual(f.authorBytes);
 },120000);

 it('D10 recovery preserves everything when the published author bytes were tampered with',async()=>{
  const f=await recoveryFixture();
  await writeFile(f.authorPath,'tampered outside the recovery path');
  const result=await f.recovery.recoverTransaction(f.transactionId);
  expect(result.outcome).toBe('attention');
  // The first candidate returned the label "attention" and left the row `prepared`.
  // The MAIN ruling reversed that: an attention is persisted by the original
  // coordinator, so the row really is `attention` and the project really is held.
  expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('attention');
  expect(f.revisions.compose(db=>db.prepare('SELECT attention FROM project_state WHERE project_id=?').get(f.projectId)))
   .toMatchObject({attention:1});
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
  expect(f.revisions.compose(db=>db.prepare('SELECT state,consumed_transaction_id FROM cp_a0_approval WHERE approval_id=?').get(f.approvalId)))
   .toMatchObject({state:'active',consumed_transaction_id:null});
 },120000);

 it('D10 recovery keeps an attention in the unresolved set instead of reporting an empty readiness',async()=>{
  const f=await recoveryFixture();
  f.revisions.compose(db=>db.prepare('UPDATE project_transaction SET request_json=? WHERE transaction_id=?')
   .run(canonicalJson({operation:'agent.created_source.apply@1'}),f.transactionId));
  const report=await f.recovery.recoverOnStart();
  // The attention is persisted, so the sweep decided this row, and the row is still
  // unresolved: it blocks its project's write gate.
  expect(report.results.map(r=>r.outcome)).toContain('attention');
  expect(report.unresolved_transaction_ids).toContain(f.transactionId);
  expect(report.decided).toBe(1);
  expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('attention');
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
 },120000);

 it('D10 recovery preserves the published source and defers on a transient resource error',async()=>{
  const f=await recoveryFixture();
  const {CreatedPublicationRecoveryFiles}=await import('../../../src/host/agent-driven/created-publication-recovery-files.js');
  vi.spyOn(CreatedPublicationRecoveryFiles.prototype,'inspect').mockRejectedValue(Object.assign(new Error('injected transient EIO'),{code:'EIO'}));
  const result=await f.recovery.recoverTransaction(f.transactionId);
  expect(result).toMatchObject({outcome:'deferred',reason:'TRANSIENT_RESOURCE_ERROR'});
  expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('prepared');
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
 },120000);

 it('D10 recovery treats an exhausted host resource as deferred and never as a terminal fact',async()=>{
  const f=await recoveryFixture();
  const {CreatedPublicationRecoveryFiles}=await import('../../../src/host/agent-driven/created-publication-recovery-files.js');
  const {ProductError}=await import('../../../src/host/creative/trusted-context.js');
  vi.spyOn(CreatedPublicationRecoveryFiles.prototype,'inspect').mockRejectedValue(new ProductError('HOST_RESOURCE_EXHAUSTED','injected 503'));
  const result=await f.recovery.recoverTransaction(f.transactionId);
  expect(result).toMatchObject({outcome:'deferred',reason:'TRANSIENT_RESOURCE_ERROR'});
  expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('prepared');
  expect(f.revisions.compose(db=>db.prepare('SELECT state FROM cp_a0_approval WHERE approval_id=?').get(f.approvalId)?.state)).toBe('active');
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
 },120000);

 it('D10 recovery treats an out-of-memory failure as unknown rather than as a lost source',async()=>{
  const f=await recoveryFixture();
  const {CreatedPublicationRecoveryFiles}=await import('../../../src/host/agent-driven/created-publication-recovery-files.js');
  vi.spyOn(CreatedPublicationRecoveryFiles.prototype,'inspect').mockRejectedValue(Object.assign(new Error('injected ENOMEM'),{code:'ENOMEM'}));
  const result=await f.recovery.recoverTransaction(f.transactionId);
  expect(result).toMatchObject({outcome:'deferred',reason:'TRANSIENT_RESOURCE_ERROR'});
  expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('prepared');
  expect(await readFile(f.authorPath)).toEqual(f.authorBytesNow);
 },120000);

 it('D10 recovery preserves the publication when the adoption fact is missing but the publication evidence exists',async()=>{
  const f=await recoveryFixture();
  // The publication evidence is real; the matching adoption fact is gone. That is not
  // an early abort and not a compensation: everything is preserved for an operator.
  f.revisions.compose(db=>{const sql=String(db.prepare("SELECT sql FROM sqlite_master WHERE name='created_adoption_fact_no_delete'").get()?.sql);
   db.exec('DROP TRIGGER created_adoption_fact_no_delete');try{db.prepare('DELETE FROM created_adoption_fact WHERE transaction_id=?').run(f.transactionId);}finally{db.exec(sql);}});
  const result=await f.recovery.recoverTransaction(f.transactionId);
  expect(result).toMatchObject({outcome:'attention',reason:'IDENTITY_NOT_PROVABLE'});
  expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('attention');
  expect(await readFile(f.authorPath)).toEqual(f.authorBytesNow);
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
  expect(f.revisions.compose(db=>db.prepare('SELECT state,consumed_transaction_id FROM cp_a0_approval WHERE approval_id=?').get(f.approvalId)))
   .toMatchObject({state:'active',consumed_transaction_id:null});
 },120000);

 it('D10 recovery refuses to replay a committed transaction whose receipt is gone',async()=>{
  const f=await recoveryFixture();
  expect((await f.recovery.recoverTransaction(f.transactionId)).outcome).toBe('committed');
  const committed=f.revisions.activeCommit(f.projectId)!;
  // The receipt of the original commit is gone. The transaction stays committed, but
  // this service must not report a success it cannot prove and must not invent a
  // revision: the honest answer is that the receipt has to be reconciled.
  f.revisions.compose(db=>db.prepare('DELETE FROM operation_idempotency WHERE project_id=? AND transaction_id=?').run(f.projectId,f.transactionId));
  const replay=await f.recovery.recoverTransaction(f.transactionId);
  expect(replay).toMatchObject({outcome:'deferred',reason:'RECEIPT_NOT_REPLAYABLE',revision:null});
  expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('committed');
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(committed.revision);
  expect(f.revisions.activeCommit(f.projectId)?.snapshot_id).toBe(committed.snapshot_id);
 },120000);

 it('D10 recovery refuses a replay whose receipt names another principal, key or correlation',async()=>{
  const f=await recoveryFixture();
  expect((await f.recovery.recoverTransaction(f.transactionId)).outcome).toBe('committed');
  const committed=f.revisions.activeCommit(f.projectId)!;
  const read=()=>f.revisions.compose(db=>db.prepare('SELECT response_json FROM operation_idempotency WHERE project_id=? AND transaction_id=?').get(f.projectId,f.transactionId));
  const write=(envelope:unknown)=>f.revisions.compose(db=>db.prepare('UPDATE operation_idempotency SET response_json=? WHERE project_id=? AND transaction_id=?')
   .run(JSON.stringify(envelope),f.projectId,f.transactionId));
  const original=JSON.parse(String((read() as {response_json:string}).response_json)) as {receipt:Record<string,unknown>};
  for(const [what,patch]of [['principal',{principal_id:'somebody-else'}],['key',{idempotency_key:'some-other-key'}],['correlation',{correlation_id:'some-other-correlation'}]] as const){
   const tampered={...original,receipt:{...original.receipt,...patch}};
   write(tampered);
   const replay=await f.recovery.recoverTransaction(f.transactionId);
   expect(replay,what).toMatchObject({outcome:'deferred',reason:'RECEIPT_NOT_REPLAYABLE',revision:null});
   // The refusal has no side effect at all.
   expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('committed');
   expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(committed.revision);
   expect(f.revisions.activeCommit(f.projectId)?.snapshot_id).toBe(committed.snapshot_id);
   write(original);
  }
  // The untouched receipt still replays.
  expect(await f.recovery.recoverTransaction(f.transactionId)).toMatchObject({outcome:'already_committed',reason:'ALREADY_COMMITTED',revision:2});
 },120000);

 it('D10 recovery replays the original receipt independently of a corrupted current pointer',async()=>{
  // NOT a legal successor commit. The active pointer is deliberately corrupted here:
  // no Coordinator, no closed commit, no snapshot, no source fact and no project_state
  // row backs it. It is therefore labelled a synthetic pointer corruption, and it
  // proves exactly one thing: the receipt replay of an original transaction does not
  // consult the current pointer. The integration with a real legal successor commit
  // is NOT_RUN and stays pending the unified acceptance gate.
  const f=await recoveryFixture();
  expect((await f.recovery.recoverTransaction(f.transactionId)).outcome).toBe('committed');
  const original=f.revisions.activeCommit(f.projectId)!;
  f.revisions.compose(db=>db.prepare('UPDATE active_commit SET revision=revision+1,snapshot_id=?,source_digest=? WHERE project_id=?')
   .run('snap_synthetic_'+randomUUID().replaceAll('-',''),'c'.repeat(64),f.projectId));
  const replay=await f.recovery.recoverTransaction(f.transactionId);
  expect(replay).toMatchObject({outcome:'already_committed',reason:'ALREADY_COMMITTED',revision:2});
  // The synthetic corruption changed nothing the recovery reported.
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(original.revision+1);
  expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('committed');
  expect(f.revisions.projectTransaction(f.transactionId)?.snapshot_id).toBe(original.snapshot_id);
 },120000);

 it('D10 recovery keeps no retained descriptor when a guard verification fails',async()=>{
  const f=await recoveryFixture({publish:false});
  const {RetainedSourceTree}=await import('../../../src/host/agent-driven/retained-source-tree.js');
  const original=RetainedSourceTree.prototype.verify;
  let verifications=0;
  // A verification that fails only after the guard was constructed would leave its
  // retained descriptors unowned if the service verified a second time on its own.
  vi.spyOn(RetainedSourceTree.prototype,'verify').mockImplementation(function(this:{root:string}){
   if(this.root===f.authorRoot){verifications+=1;if(verifications>1)throw new Error('injected guard verification failure after construction');}
   return original.call(this);
  });
  const before=(await readdir('/proc/self/fd')).length;
  const early='txn_'+randomUUID().replaceAll('-','');
  f.revisions.beginTransaction({transaction_id:early,project_id:f.projectId,kind:'edit',correlation_id:'early',
   request_json:canonicalJson({operation:'agent.created_source.apply@1',input:f.applyChange}),request_hash:f.requestDigest,base_revision:1,createdAt:new Date(0)});
  const result=await f.recovery.recoverTransaction(early);
  expect(result).toMatchObject({outcome:'aborted',reason:'PROVEN_ABORTED'});
  const after=(await readdir('/proc/self/fd')).length;
  // The guard is verified once, by its own constructor, and it is closed again.
  expect(verifications).toBeLessThanOrEqual(1);
  expect(after).toBeLessThanOrEqual(before);
 },120000);

 it('D10 recovery refuses further work for a project whose resource cleanup failed',async()=>{
  const f=await recoveryFixture();
  const {CreatedPublicationRecoveryFiles}=await import('../../../src/host/agent-driven/created-publication-recovery-files.js');
  vi.spyOn(CreatedPublicationRecoveryFiles.prototype,'release').mockImplementationOnce(()=>{throw new Error('injected resource release failure');});
  // A second instance keeps the failure out of the fixture's own shutdown path.
  const service=new CreatedSourceRecovery({host:f.host,creation:f.app.creation,tasks:f.tasks,assets:f.registry,verifier:f.verifier,
   selection:{currentSelectionVersion:()=>0},createdRoot:dirname(dirname(f.authorRoot)),privateRoot:join(f.root,'publication'),stageDomainRoot:f.taskRoot});
  const committed=await service.recoverTransaction(f.transactionId);
  // The fact that really happened is kept: the commit happened.
  expect(committed).toMatchObject({outcome:'committed',reason:'RECOVERED_COMMIT',revision:2});
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(2);
  // The next work for the same project is refused, and it is a real deferral.
  const next='txn_'+randomUUID().replaceAll('-','');
  f.revisions.beginTransaction({transaction_id:next,project_id:f.projectId,kind:'edit',correlation_id:'next',
   request_json:canonicalJson({operation:'agent.created_source.apply@1',input:f.applyChange}),request_hash:f.requestDigest,base_revision:1,createdAt:new Date()});
  const refused=await service.recoverTransaction(next);
  expect(refused).toMatchObject({outcome:'deferred',reason:'TRANSIENT_RESOURCE_ERROR'});
  expect(f.revisions.projectTransaction(next)?.state).toBe('received');
  // The failure is still visible when the service closes.
  await expect(service.close()).rejects.toBeDefined();
 },120000);

 it('D10 recovery compensates and aborts when the approval has expired, without consuming any authority',async()=>{
  const f=await recoveryFixture();
  vi.useFakeTimers({toFake:['Date']});
  try{
   vi.setSystemTime(new Date(Date.parse(f.plan.expires_at)+1000));
   const result=await f.recovery.recoverTransaction(f.transactionId);
   expect(result).toMatchObject({outcome:'aborted',reason:'AUTHORITY_EXPIRED'});
  }finally{vi.useRealTimers();}
  expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('aborted');
  expect(await readFile(f.authorPath)).toEqual(f.authorBytes);
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
  expect(f.revisions.compose(db=>db.prepare('SELECT state,consumed_transaction_id FROM cp_a0_approval WHERE approval_id=?').get(f.approvalId))).toMatchObject({state:'active',consumed_transaction_id:null});
 },120000);

 it('D10 recovery compensates and aborts when the selection moved',async()=>{
  const f=await recoveryFixture();
  f.advanceSelection();
  const result=await f.recovery.recoverTransaction(f.transactionId);
  expect(result).toMatchObject({outcome:'aborted',reason:'SELECTION_CHANGED'});
  expect(await readFile(f.authorPath)).toEqual(f.authorBytes);
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
 },120000);

 it('D10 recovery compensates and aborts when an active lock covers the project',async()=>{
  const f=await recoveryFixture();
  const at=new Date().toISOString();
  f.revisions.upsertLock({lock_id:'lock_'+randomUUID().replaceAll('-',''),project_id:f.projectId,lock_type:'visual',scope:'project',target_id:f.projectId,
   start_frame:0,end_frame_exclusive:90,owner:'diagnostic',reason:'D10 recovery lock evidence',control_revision:0,active:true,created_at:at,updated_at:at});
  const result=await f.recovery.recoverTransaction(f.transactionId);
  expect(result).toMatchObject({outcome:'aborted',reason:'LOCK_ACTIVE'});
  expect(await readFile(f.authorPath)).toEqual(f.authorBytes);
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
 },120000);

 it('D10 recovery compensates and aborts when the run was cancelled',async()=>{
  const f=await recoveryFixture();
  await f.repo.transaction(tx=>{const key={project_id:f.projectId,run_id:f.task.request.execution.run_id},run=tx.get('run',key)!;tx.put('run',key,{...run,state:'cancelled'});});
  const result=await f.recovery.recoverTransaction(f.transactionId);
  expect(result).toMatchObject({outcome:'aborted',reason:'RUN_CANCELLED'});
  expect(await readFile(f.authorPath)).toEqual(f.authorBytes);
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
 },120000);

 it('D10 recovery defers behind an older controlled pending row of another family',async()=>{
  const f=await recoveryFixture();
  const older='txn_'+randomUUID().replaceAll('-','');
  f.revisions.beginTransaction({transaction_id:older,project_id:f.projectId,kind:'edit',correlation_id:'older',
   request_json:canonicalJson({format:'narralens.adopt-request@1.0'}),request_hash:'a'.repeat(64),base_revision:1,createdAt:new Date(0)});
  const result=await f.recovery.recoverTransaction(f.transactionId);
  expect(result).toMatchObject({outcome:'deferred',reason:'ORDERED_AFTER_OLDER_PENDING'});
  expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('prepared');
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
 },120000);

 it('D10 recovery leaves an unrelated unknown pending row to the original gate',async()=>{
  const f=await recoveryFixture();
  const unknown='txn_'+randomUUID().replaceAll('-','');
  f.revisions.beginTransaction({transaction_id:unknown,project_id:f.projectId,kind:'edit',correlation_id:'unknown',
   request_json:canonicalJson({legacy:true}),request_hash:'b'.repeat(64),base_revision:1,createdAt:new Date(0)});
  const result=await f.recovery.recoverTransaction(f.transactionId);
  expect(result).toMatchObject({outcome:'deferred',reason:'GATE_BLOCKED'});
  expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('prepared');
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(1);
 },120000);

 it('D10 recovery startup decides only its own family rows and reports the unresolved ones',async()=>{
  const f=await recoveryFixture();
  const report=await f.recovery.recoverOnStart();
  expect(report.results.map(r=>r.outcome)).toContain('committed');
  expect(report.unresolved_transaction_ids).not.toContain(f.transactionId);
  expect(f.revisions.activeCommit(f.projectId)?.revision).toBe(2);
 },120000);

 it('D10 recovery closes after the work it already accepted and refuses new work',async()=>{
  const f=await recoveryFixture();
  const closing=f.recovery.close();
  await expect(f.recovery.recoverTransaction(f.transactionId)).rejects.toBeDefined();
  await closing;
  expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('prepared');
 },120000);
});


/** Seeded diagnostic authorities on real SQLite/queue/FS/FDs. These cases test
 * lifecycle only; they do not prove bootstrap, production startup or SIGKILL. */
function lifecycleFixture(){
 const root=mkdtempSync(join(tmpdir(),'narralens-d10-lifecycle-'));
 const revisions=new RevisionStore(':memory:');new ProjectCreationStore(revisions);
 const queue=new InMemoryProjectOperationQueue();
 const coordinator=new ProjectCoordinator({store:revisions,queue} as unknown as ConstructorParameters<typeof ProjectCoordinator>[0]);
 const service=new CreatedSourceRecovery({host:{revisions,coordinator,snapshots:{}},
  creation:{forProject:()=>({command_id:'creation-command',transaction_id:'creation-txn'}),origin:()=>({origin:'created'}),ownerOf:()=> 'owner'},
  createdRoot:root,privateRoot:join(root,'private'),stageDomainRoot:join(root,'stage'),
  selection:{currentSelectionVersion:()=>0},tasks:{},assets:{},verifier:{}} as unknown as ConstructorParameters<typeof CreatedSourceRecovery>[0]);
 // A cleanup-error test explicitly observes close rejection before afterEach. Do not
 // retry numeric descriptors, or convert an unexpected close failure into a test pass.
 let closed=false;
 const close=async()=>{try{await service.close();}finally{closed=true;}};
 cleanups.push(async()=>{try{if(!closed)await close();}finally{revisions.close();rmSync(root,{recursive:true,force:true});}});
 const vector=(JSON.parse(readFileSync(join(process.cwd(),'docs/agent-driven-v1/cp-a0/contract-vectors.json'),'utf8')) as
  {vectors:Array<{id:string;value:ApplyChange}>}).vectors.find(v=>v.id==='definition:ApplyChange:valid')!.value;
 const add=(id:string,project:string,input?:ApplyChange)=>revisions.beginTransaction({transaction_id:id,project_id:project,kind:'edit',correlation_id:'id1',
  request_json:canonicalJson(input?{operation:'agent.created_source.apply@1',input}:{operation:'agent.created_source.apply@1'}),
  request_hash:input?contentDigest(input):'a'.repeat(64),base_revision:1,createdAt:new Date(id.endsWith('1')?0:1)});
 const author=async(project:string)=>{
  const source=join(root,project,'source');mkdirSync(source,{recursive:true});writeFileSync(join(source,'film.html'),'<html><body>diagnostic</body></html>');
  writeFileSync(join(root,project,'owner.json'),canonicalJson({kind:'narralens.created-root@1',project_id:project,command_id:'creation-command',transaction_id:'creation-txn'}));
  const digest=await computeSourceDigest({root:source,roots:['film.html'],engine:'openfilm',engineUpstreamSha:OPENFILM_UPSTREAM_SHA});
  revisions.ensureProject(project,1);const fact={schema_version:1,roots:['film.html'],subtitles:[],frame_count:0,fps:{num:30,den:1},assets:[]};
  revisions.compose(db=>{db.prepare('UPDATE project_state SET source_digest=? WHERE project_id=?').run(digest.source_digest,project);
   db.prepare('INSERT INTO snapshot(snapshot_id,project_id,source_digest,engine,created_at) VALUES(?,?,?,?,?)').run('snapshot-'+project,project,digest.source_digest,'openfilm',new Date().toISOString());
   db.prepare('INSERT INTO active_commit VALUES(?,?,?,?,?,?,?)').run(project,1,'snapshot-'+project,digest.source_digest,'openfilm','creation-txn',new Date().toISOString());
   db.prepare('INSERT INTO created_source_fact VALUES(?,?,?,?)').run(project,'snapshot-'+project,canonicalJson(fact),canonicalDigest(fact));});
  return {source,input:{...vector,project_id:project,base_revision:1,source_digest:digest.source_digest}};
 };
 return {root,revisions,queue,coordinator,service,close,add,author};
}

describe('D10 MAIN lifecycle regressions (diagnostic authorities)',()=>{
 it('MAIN lifecycle keeps abort truthful and cleanup uncertainty sticky until close',async()=>{
  const f=lifecycleFixture();const {source,input}=await f.author('early');f.add('early1','early',input);
  const original=RetainedSourceTree.prototype.close;const cause=new Error('injected guard close uncertainty');let injected=0;
  vi.spyOn(RetainedSourceTree.prototype,'close').mockImplementation(function(this:RetainedSourceTree){original.call(this);if(this.root===source&&injected++===0)throw new PublicationCleanupError([cause]);});
  const first=await f.service.recoverTransaction('early1');f.add('early2','early',input);
  const second=await f.service.recoverTransaction('early2');
  let failure:unknown;try{await f.close();}catch(error){failure=error;}
  expect(first).toMatchObject({outcome:'aborted',reason:'PROVEN_ABORTED'});
  expect(f.revisions.projectTransaction('early1')?.state).toBe('aborted');
  expect(second).toMatchObject({outcome:'deferred',reason:'TRANSIENT_RESOURCE_ERROR'});
  expect(f.revisions.projectTransaction('early2')?.state).toBe('received');
  expect(failure).toBeInstanceOf(PublicationCleanupError);
  expect((failure as PublicationCleanupError).errors.flatMap(error=>error instanceof PublicationCleanupError?[...error.errors]:[error])).toContain(cause);
  expect(JSON.stringify(f.revisions.activeCommit('early'))).toContain('snapshot-early');
 });
 it('MAIN lifecycle keeps failed constructor cleanup sticky instead of treating it as an ordinary retry',async()=>{
  const f=lifecycleFixture();const {source,input}=await f.author('construct');f.add('construct1','construct',input);
  const original=RetainedSourceTree.prototype.close;let closing=0;
  vi.spyOn(RetainedSourceTree.prototype,'verify').mockImplementationOnce(()=>{throw new Error('injected verification I/O failure');});
  const closeSpy=vi.spyOn(RetainedSourceTree.prototype,'close').mockImplementation(function(this:RetainedSourceTree){original.call(this);if(this.root===source&&closing++===0)throw new Error('injected constructor cleanup uncertainty');});
  const first=await f.service.recoverTransaction('construct1');
  closeSpy.mockRestore();
  const second=await f.service.recoverTransaction('construct1');
  let failure:unknown;try{await f.close();}catch(error){failure=error;}
  expect(first).toMatchObject({outcome:'deferred',reason:'TRANSIENT_RESOURCE_ERROR'});
  expect(second).toMatchObject({outcome:'deferred',reason:'TRANSIENT_RESOURCE_ERROR'});
  expect(f.revisions.projectTransaction('construct1')?.state).toBe('received');
  expect(failure).toBeInstanceOf(PublicationCleanupError);
 });
 it('MAIN lifecycle preserves the primary operation error and also exposes cleanup uncertainty',async()=>{
  const f=lifecycleFixture();const {source,input}=await f.author('primary');f.add('primary1','primary',input);
  const primary=new Error('injected abort failed before a decision');const cleanup=new Error('injected guard cleanup outcome unknown');
  vi.spyOn(f.coordinator,'abort').mockImplementationOnce(()=>{throw primary;});
  const original=RetainedSourceTree.prototype.close;
  vi.spyOn(RetainedSourceTree.prototype,'close').mockImplementation(function(this:RetainedSourceTree){original.call(this);if(this.root===source)throw cleanup;});
  let operationError:unknown;try{await f.service.recoverTransaction('primary1');}catch(error){operationError=error;}
  let closeError:unknown;try{await f.close();}catch(error){closeError=error;}
  expect(operationError).toBe(primary);expect(f.revisions.projectTransaction('primary1')?.state).toBe('received');
  expect(closeError).toBeInstanceOf(PublicationCleanupError);expect((closeError as PublicationCleanupError).errors).toContain(cleanup);
 });
 it('MAIN lifecycle close waits for the complete accepted startup sweep and rejects new admissions',async()=>{
  const f=lifecycleFixture();f.add('sweep1','sweep-a');f.add('sweep2','sweep-b');
  let release!:()=>void;const gate=new Promise<void>(r=>release=r);const held=f.queue.run('sweep-a',()=>gate);
  const sweep=f.service.recoverOnStart();const swept=sweep.then(value=>({value}),error=>({error}));
  const closing=f.close();const refused=f.service.recoverTransaction('sweep2').then(()=>false,()=>true);
  release();await held;await closing;const result=await swept;
  expect(await refused).toBe(true);expect(result).toHaveProperty('value');
  expect(f.revisions.projectTransaction('sweep1')?.state).toBe('attention');
  expect(f.revisions.projectTransaction('sweep2')?.state).toBe('attention');
 });
});

describe('D10 MAIN authorization regression (real producer)',()=>{
 it('MAIN authorization checks existing authorization before any source proof when adoption is missing',async()=>{
  const f=await recoveryFixture({publish:false});
  f.revisions.compose(db=>{const sql=String(db.prepare("SELECT sql FROM sqlite_master WHERE name='created_adoption_fact_no_delete'").get()?.sql);
   db.exec('DROP TRIGGER created_adoption_fact_no_delete');try{db.prepare('DELETE FROM created_adoption_fact WHERE transaction_id=?').run(f.transactionId);}finally{db.exec(sql);}});
  const input={...f.applyChange,approval_id:'approval_'+randomUUID().replaceAll('-','')};
  f.revisions.compose(db=>db.prepare('UPDATE project_transaction SET request_json=?,request_hash=? WHERE transaction_id=?')
   .run(canonicalJson({operation:'agent.created_source.apply@1',input}),contentDigest(input),f.transactionId));
  const before=await witness(f);
  const guard=vi.spyOn(RetainedSourceTree.prototype,'verify');
  const outcome=await f.recovery.recoverTransaction(f.transactionId);
  expect(outcome).toMatchObject({outcome:'attention',reason:'REQUEST_NOT_LEGITIMATE'});
  expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('attention');
  expect(guard).not.toHaveBeenCalled();
  expect(await witness(f)).toEqual(before);expect(await readFile(f.authorPath)).toEqual(f.authorBytesNow);
 },120000);
});


describe('D10 MAIN surviving authorization control (real producer)',()=>{
 it('MAIN authorization still permits a proven early abort with matching surviving authorization',async()=>{
  const f=await recoveryFixture({publish:false});
  f.revisions.compose(db=>{const sql=String(db.prepare("SELECT sql FROM sqlite_master WHERE name='created_adoption_fact_no_delete'").get()?.sql);
   db.exec('DROP TRIGGER created_adoption_fact_no_delete');try{db.prepare('DELETE FROM created_adoption_fact WHERE transaction_id=?').run(f.transactionId);}finally{db.exec(sql);}});
  const before=await witness(f);
  expect(await f.recovery.recoverTransaction(f.transactionId)).toMatchObject({outcome:'aborted',reason:'PROVEN_ABORTED'});
  expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('aborted');
  expect(await witness(f)).toEqual(before);expect(await readFile(f.authorPath)).toEqual(f.authorBytesNow);
 },120000);
 it('MAIN cleanup records guard uncertainty in the prepared adoption branch without hiding the abort',async()=>{
  const f=await recoveryFixture({publish:false});const original=RetainedSourceTree.prototype.close;let injected=false;
  vi.spyOn(RetainedSourceTree.prototype,'close').mockImplementation(function(this:RetainedSourceTree){original.call(this);if(!injected&&this.root===f.authorRoot){injected=true;throw new PublicationCleanupError([new Error('prepared guard cleanup uncertainty')]);}});
  const outcome=await f.recovery.recoverTransaction(f.transactionId);
  let failure:unknown;try{await f.recovery.close();}catch(error){failure=error;}
  // This service's sticky failure is asserted here; remove only its already-observed
  // close callback, not the fixture/reader/publisher cleanup obligations.
  cleanups.pop();
  expect(injected).toBe(true);expect(outcome).toMatchObject({outcome:'aborted',reason:'PROVEN_ABORTED'});
  expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('aborted');
  expect(failure).toBeInstanceOf(PublicationCleanupError);expect(await readFile(f.authorPath)).toEqual(f.authorBytesNow);
 },120000);
});


describe('D10 MAIN full execution binding (real producer, controlled corruption)',()=>{
 it.each(['missing','present'] as const)('MAIN full execution rejects a substituted grant when adoption is %s',async(presence)=>{
  const f=await recoveryFixture({publish:false});
  const input={...f.applyChange,execution:{...f.applyChange.execution,authorization_id:'grant_'+randomUUID().replaceAll('-','')}};
  expect(()=>validateAgentDefinition('ApplyChange',input)).not.toThrow();
  f.revisions.compose(db=>{
   if(presence==='missing'){
    const trigger=String(db.prepare("SELECT sql FROM sqlite_master WHERE name='created_adoption_fact_no_delete'").get()?.sql);
    db.exec('DROP TRIGGER created_adoption_fact_no_delete');try{db.prepare('DELETE FROM created_adoption_fact WHERE transaction_id=?').run(f.transactionId);}finally{db.exec(trigger);}
   }else{
    // Corrupt the redundant adoption execution together with the request, while the
    // independently immutable producer plan and original authorization stay intact.
    const trigger=String(db.prepare("SELECT sql FROM sqlite_master WHERE name='created_adoption_fact_no_update'").get()?.sql);
    db.exec('DROP TRIGGER created_adoption_fact_no_update');try{db.prepare('UPDATE created_adoption_fact SET execution_json=? WHERE transaction_id=?').run(canonicalJson(input.execution),f.transactionId);}finally{db.exec(trigger);}
   }
   db.prepare('UPDATE project_transaction SET request_json=?,request_hash=? WHERE transaction_id=?')
    .run(canonicalJson({operation:'agent.created_source.apply@1',input}),contentDigest(input),f.transactionId);
  });
  const before=await witness(f),identity=await stat(f.authorPath);const guard=vi.spyOn(RetainedSourceTree.prototype,'verify');
  const owner=vi.spyOn(f.app.creation,'ownerOf');
  const outcome=await f.recovery.recoverTransaction(f.transactionId);
  expect(outcome).toMatchObject({outcome:'attention',reason:'REQUEST_NOT_LEGITIMATE'});
  expect(f.revisions.projectTransaction(f.transactionId)?.state).toBe('attention');
  expect(guard).not.toHaveBeenCalled();expect(owner).not.toHaveBeenCalled();
  expect(await witness(f)).toEqual(before);expect(await readFile(f.authorPath)).toEqual(f.authorBytesNow);
  const after=await stat(f.authorPath);expect([after.dev,after.ino,after.size,after.mtimeMs]).toEqual([identity.dev,identity.ino,identity.size,identity.mtimeMs]);
 },120000);
});
