import {expect} from 'vitest';
import {mkdir,readFile,writeFile,readdir,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createdProjectFixture,vendorRoot} from './created-project-fixture.js';
import {LocalAssetRegistry} from '../../../../src/host/agent-driven/local-asset-registry.js';
import {ProductSqliteRepository} from '../../../../src/host/agent-driven/product-sqlite-repository.js';
import {CreativeProjectAuthority} from '../../../../src/host/agent-driven/creative-project-authority.js';
import {CreatedTaskStore,type CreatedTaskPorts, type TaskReservation} from '../../../../src/host/agent-driven/created-task-store.js';
import {CreatedTaskGate} from '../../../../src/host/agent-driven/created-task-gate.js';
import {PersistentJobStore} from '../../../../src/host/persistent-job-store.js';
import {CreatedTaskWorker} from '../../../../src/host/agent-driven/created-task-worker.js';
import {CreatedDraftTaskProcessor} from '../../../../src/host/agent-driven/created-draft-processor.js';
import {PreparedDraftVerifier} from '../../../../src/host/agent-driven/prepared-draft-verifier.js';
import {CreativeService} from '../../../../src/host/creative/creative-service.js';
import {FixedWorkflowService} from '../../../../src/host/creative/fixed-workflow-service.js';
import {creativeInputClosure} from '../../../../src/host/creative/creative-closure.js';
import {canonicalDigest} from '../../../../src/host/creative/digest.js';
import {createTrustedCallerContext} from '../../../../src/host/creative/trusted-context.js';
import {TestAdoptionAuthority} from '../../product/support/fixtures.js';
import type {TaskPrepare} from '../../../../src/contracts/agent-driven-types.js';
import type {CompletedPreparedSourceV1,PreparedReadBindingV1,PreparedAdoptionBindingV1} from '../../../../src/host/render/assembly-ports.js';

const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
const meta=(id:string)=>({idempotency_key:id,correlation_id:id});
export async function preparedDraftFixture(boundary?:(point:string,task:TaskReservation,context:{host:Awaited<ReturnType<typeof createdProjectFixture>>['host'];root:string;grantId:string})=>Promise<void>){
 const f=await createdProjectFixture();let registry:LocalAssetRegistry|undefined,worker:CreatedTaskWorker|undefined,processor:CreatedDraftTaskProcessor|undefined;
 try{
  const inputRoot=join(f.root,'inputs'),blobRoot=join(f.root,'local-assets'),taskRoot=join(f.root,'tasks');await mkdir(inputRoot,{mode:0o700});
  const ff=(args:string[])=>execFileSync('ffmpeg',['-nostdin','-hide_banner','-v','error',...args],{windowsHide:true,timeout:30000});
  ff(['-f','lavfi','-i','color=c=0x185a88:s=320x180:r=30:d=3','-threads','1','-c:v','libx264','-pix_fmt','yuv420p',join(inputRoot,'video.mp4')]);
  ff(['-f','lavfi','-i','sine=frequency=430:sample_rate=48000:duration=3','-threads','1','-c:a','pcm_s16le',join(inputRoot,'voice.wav')]);
  registry=new LocalAssetRegistry(f.host.revisions,f.app.creation,{sourceRoot:inputRoot,storageRoot:blobRoot,projectsRoot:join(f.root,'projects'),snapshotsRoot:join(f.root,'snapshots')});
  const ui=createTrustedCallerContext({principal_id:'owner',channel:'trusted_ui',source:'trusted_ui',session_ref:f.ui.principal.session_ref});
  const registered=[];for(const [file,kind]of [['video.mp4','video'],['voice.wav','audio']] as const){const bytes=await readFile(join(inputRoot,file));registered.push(await registry.import({project_id:f.projectId,idempotency_key:'import-'+kind,relative_path:file,expected_sha256:sha(bytes),kind,source:{kind:'generated',label:'Test-created local diagnostic media'},license:{status:'cleared',label:'Diagnostic fixture only',commercial_use:true},recording_origin:kind==='audio'?'synthetic':null,attestation_ref:'test-'+kind},ui));}
  const repo=new ProductSqliteRepository(f.host.revisions),authority=new CreativeProjectAuthority(f.app.creation),creative=new CreativeService({repository:repo,artifactAuthority:authority.assertArtifact,contentAuthority:authority.assertContent}),created=f.app.creation.forProject(f.projectId)!;
  const brief=structuredClone(created.brief);brief.local_asset_ids=registered.map(a=>a.asset_id);brief.narration_asset_id=registered[1]!.asset_id;Object.assign(brief.content_brief.material_strategy,{asset_ids:brief.local_asset_ids,narration_asset_id:brief.narration_asset_id,rights_refs:registered.map(a=>({id:a.rights_ref,version:1,sha256:a.registration_digest}))});
  const intake=await creative.putIntake({meta:meta('updated'),intake_id:created.request.intake_id,base_version:1,brief},f.owner);
  const closure=await repo.transaction(tx=>canonicalDigest(creativeInputClosure(tx,intake.intake_id,intake.version)));
  const script=await creative.putArtifact({meta:meta('script'),project_id:f.projectId,artifact_id:null,base_version:0,input_digest:closure,content:{kind:'script',paragraphs:[{paragraph_id:'p1',text:'第一段诊断内容。'},{paragraph_id:'p2',text:'第二段诊断内容。'},{paragraph_id:'p3',text:'原生概念说明。'}]},input_refs:[]},f.owner);
  const storyboard=await creative.putArtifact({meta:meta('storyboard'),project_id:f.projectId,artifact_id:null,base_version:0,input_digest:closure,content:{kind:'storyboard',fps:30,shots:[{shot_id:'s1',paragraph_id:'p1',asset_id:registered[0]!.asset_id,duration_frames:31,caption:'第一条诊断字幕。',concept_text:''},{shot_id:'s2',paragraph_id:'p2',asset_id:registered[0]!.asset_id,duration_frames:29,caption:'第二条诊断字幕。',concept_text:''},{shot_id:'s3',paragraph_id:'p3',asset_id:null,duration_frames:30,caption:'概念说明字幕。',concept_text:'可编辑概念'}]},input_refs:[script.ref]},f.owner);
  const style=await repo.transaction(tx=>{const row=tx.list('artifact_version',{project_id:f.projectId}).find(a=>a.kind==='brief')!;return {id:row.artifact_id,version:row.version,sha256:row.content_digest};});
  const decision=await creative.relayContentDecision({meta:meta('content'),project_id:f.projectId,intake_id:intake.intake_id,intake_version:intake.version,input_digest:closure,request_id:'request',choice:'accept_content',source:'driver_relay',source_message_ref:'component-confirmation'},f.owner);
  const workflow=new FixedWorkflowService({repository:repo,adoption:new TestAdoptionAuthority(),facts:{readProjectFacts:async()=>({project_id:f.projectId,exists:true,project_revision:1,control_revision:0,source_digest:f.commit.source_digest,snapshot_id:f.commit.snapshot_id,rights_authorized:true,rights_reason:'fixture eligibility only; actual assets separately verified',capability_available:true,capability_fingerprint:'a'.repeat(64),capability_reason:'fixture producer registration only'})}});
  const run=await workflow.prepareRun({meta:meta('run'),project_id:f.projectId,intake_decision_id:decision.decision_id,template_id:'local-short-film',template_version:1,input_refs:[script.ref,storyboard.ref],input_digest:closure,style_ref:style,content_type:'short_film'},f.owner);
  const grant=await workflow.authorizeRun({meta:meta('grant'),project_id:f.projectId,run_id:run.run_id,scope_digest:run.scope_digest,choice:'authorize'},ui);
  const request:TaskPrepare={meta:meta('task'),project_id:f.projectId,kind:'assemble_draft',input_refs:[script.ref,storyboard.ref],snapshot_id:f.commit.snapshot_id,base_revision:1,source_digest:f.commit.source_digest,execution:{run_id:run.run_id,plan_version:1,step_id:'sample',attempt:1,input_digest:closure,run_scope_digest:run.scope_digest,authorization_id:grant.authorization_id},render_spec:null};
  const gate=new CreatedTaskGate(f.host.revisions,repo,authority),ports:CreatedTaskPorts={assertAllowed:gate.assertAllowed,bindStep:(rows,{task,now})=>{const e=task.request.execution;repo.joinTaskTransaction(rows,tx=>workflow.recordStepAttemptInTransaction(tx,{project_id:f.projectId,run_id:e.run_id,plan_version:1,step_id:e.step_id,attempt:e.attempt,grant_id:e.authorization_id,input_digest:e.input_digest,state:'pending',job_id:task.job_id,input_refs:task.request.input_refs,observed_at:now.toISOString()},f.owner));},assertPrepared:(rows,context)=>processor!.assertPrepared(rows,context)};
  const tasks=new CreatedTaskStore(f.host.revisions,ports),verifier=new PreparedDraftVerifier(vendorRoot,{stageDomainRoot:taskRoot,blobPath:asset=>registry!.blobPathForFact(asset)});
  processor=new CreatedDraftTaskProcessor(f.host,tasks,gate,repo,workflow,authority,registry,verifier,{root:taskRoot,vendorRoot,protectedRoots:[join(f.root,'projects'),join(f.root,'snapshots')],width:320,height:180,...(boundary?{boundary:(point,task)=>boundary(point,task,{host:f.host,root:f.root,grantId:grant.authorization_id})}:{})});
  const jobs=f.host.jobs;if(!(jobs instanceof PersistentJobStore))throw Error('Real persistent Host jobs required');
  worker=new CreatedTaskWorker(f.host.revisions,tasks,jobs,processor,{pollMs:10});
  const task=tasks.reserve(request,'owner',{job_kind:'snapshot_publish',max_attempts:3}).task;
  return {...f,registry,worker,processor,verifier,tasks,task,repo,run,taskRoot,grant,close:async()=>{await worker!.close();await processor!.close();await registry!.close();await f.close();}};
 }catch(e){await worker?.close();await processor?.close();await registry?.close();await f.close();throw e;}
}
type Fixture=Awaited<ReturnType<typeof preparedDraftFixture>>;
export function completedSource(f:Fixture):CompletedPreparedSourceV1{
 const task=f.tasks.read(f.task.job_id,'owner'),fact=f.tasks.readPrepared(f.task.job_id,'owner'),attempt=f.tasks.preparedLeaseAttempt(f.task.job_id,'owner');
 const row=f.host.revisions.compose(db=>db.prepare('SELECT terminal_reason,provider_receipt_json FROM job WHERE job_id=?').get(f.task.job_id)) as {terminal_reason:string;provider_receipt_json:string}|undefined;
 if(!row||!fact||attempt===null)throw Error('The completed preparation is missing');
 const provider=JSON.parse(row.provider_receipt_json) as {kind:string;source_digest:string;stage:string};
 return {format:'narralens.completed-prepared-source@1',project_id:f.projectId,task,producer_attempt:attempt,job:f.tasks.receipt(f.task.job_id,'owner'),
  terminal_reason:row.terminal_reason as 'SOURCE_ONLY',
  provider_receipt:{kind:provider.kind as 'local.native-draft@1',source_digest:provider.source_digest,stage:provider.stage as 'SOURCE_ONLY'},
  fact,root:join(f.taskRoot,task.stage_token,'attempt-'+attempt,'source')};
}
export function readBinding(completed:CompletedPreparedSourceV1,purpose:'impact'|'preview'):PreparedReadBindingV1{
 const execution=completed.task.request.execution;
 return {purpose,project_id:completed.project_id,run_id:execution.run_id,execution,
  prepared_source_id:'prepared_'+completed.fact.source_digest.slice(0,24),prepared_job_id:completed.task.job_id,
  fact_digest:canonicalDigest(completed.fact),base_revision:completed.task.request.base_revision,
  control_revision:0,source_digest:completed.task.request.source_digest,selection_version:0};
}
export function adoptionBinding(completed:CompletedPreparedSourceV1):PreparedAdoptionBindingV1{
 return {...readBinding(completed,'preview'),purpose:'adoption',transaction_id:'txn_'+'1'.repeat(32),impact_id:'imp_'+'2'.repeat(32),
  impact_hash:'3'.repeat(64),plan_sha256:'4'.repeat(64),approval_id:'apr_'+'5'.repeat(32),target_snapshot_id:'snap_'+'6'.repeat(32)};
}
export function registryFacts(f:Fixture){return f.registry!.list(f.projectId,createTrustedCallerContext({principal_id:'owner',channel:'authenticated',source:'driver_relay',session_ref:f.task.job_id}));}

/** Wait for the actual worker's persisted terminal result; never synthesize success. */
export async function waitForCompletedDraft(f: Awaited<ReturnType<typeof preparedDraftFixture>>) {
 const end=Date.now()+30000;
 while(!['succeeded','failed','attention','cancelled'].includes(f.host.revisions.readJob(f.task.job_id)!.state)&&Date.now()<end)
  await new Promise<void>(done=>setTimeout(done,20));
 expect(f.tasks.receipt(f.task.job_id,'owner')).toMatchObject({state:'succeeded'});
 return completedSource(f);
}
