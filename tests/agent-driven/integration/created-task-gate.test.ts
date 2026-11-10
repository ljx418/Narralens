import {it,expect} from 'vitest';
import type {TaskPrepare,ArtifactPut,Artifact} from '../../../src/contracts/agent-driven-types.js';
import {createdProjectFixture} from './helpers/created-project-fixture.js';
import {ProductSqliteRepository} from '../../../src/host/agent-driven/product-sqlite-repository.js';
import {CreatedTaskStore,type CreatedTaskPorts} from '../../../src/host/agent-driven/created-task-store.js';
import {CreatedTaskGate} from '../../../src/host/agent-driven/created-task-gate.js';
import {CreativeProjectAuthority} from '../../../src/host/agent-driven/creative-project-authority.js';
import {FixedWorkflowService} from '../../../src/host/creative/fixed-workflow-service.js';
import {CreativeService} from '../../../src/host/creative/creative-service.js';
import {createTrustedCallerContext} from '../../../src/host/creative/trusted-context.js';
import {TestAdoptionAuthority} from '../product/support/fixtures.js';
const policy={job_kind:'snapshot_publish',max_attempts:3} as const;
/** Real Host creation + real creative/run services + SQL reserve/step/event. Eligibility
 * and trusted confirmation below are explicit TEST ports, NOT production media/Run proof. */
async function fixture(){
 const f=await createdProjectFixture();
 try{
  const repo=new ProductSqliteRepository(f.host.revisions),authority=new CreativeProjectAuthority(f.app.creation),created=f.app.creation.forProject(f.projectId)!;
  const creative=new CreativeService({repository:repo,artifactAuthority:authority.assertArtifact,contentAuthority:authority.assertContent});
  const make=(content:ArtifactPut['content'],refs:ArtifactPut['input_refs'],key:string)=>creative.putArtifact({meta:{idempotency_key:key,correlation_id:key},project_id:f.projectId,artifact_id:null,base_version:0,input_digest:created.closure_digest,content,input_refs:refs},f.owner);
  const script=await make({kind:'script',paragraphs:[{paragraph_id:'p1',text:'真实任务准备边界测试。'}]},[],'script');
  const storyboard=await make({kind:'storyboard',fps:30,shots:[{shot_id:'s1',paragraph_id:'p1',asset_id:null,duration_frames:90,caption:'',concept_text:'可编辑概念'}]},[script.ref],'storyboard');
  const style=await repo.transaction(tx=>{const row=tx.list('artifact_version',{project_id:f.projectId}).find(x=>x.kind==='brief')!;return {id:row.artifact_id,version:row.version,sha256:row.content_digest};});
  const decision=await creative.relayContentDecision({meta:{idempotency_key:'content',correlation_id:'content'},project_id:f.projectId,intake_id:created.request.intake_id,intake_version:created.request.intake_version,input_digest:created.closure_digest,request_id:'request',choice:'accept_content',source:'driver_relay',source_message_ref:'test-component-confirmation'},f.owner);
  const workflow=new FixedWorkflowService({repository:repo,adoption:new TestAdoptionAuthority(),facts:{readProjectFacts:async()=>({project_id:f.projectId,exists:true,project_revision:f.commit.revision,control_revision:0,source_digest:f.commit.source_digest,snapshot_id:f.commit.snapshot_id,rights_authorized:true,rights_reason:'explicit component eligibility only',capability_available:true,capability_fingerprint:'a'.repeat(64),capability_reason:'explicit component registration only'})}});
  const run=await workflow.prepareRun({meta:{idempotency_key:'run',correlation_id:'run'},project_id:f.projectId,intake_decision_id:decision.decision_id,template_id:'local-short-film',template_version:1,input_refs:[script.ref,storyboard.ref],input_digest:created.closure_digest,style_ref:style,content_type:'short_film'},f.owner);
  const ui=createTrustedCallerContext({principal_id:'owner',channel:'trusted_ui',source:'trusted_ui',session_ref:'component-ui'});
  const grant=await workflow.authorizeRun({meta:{idempotency_key:'grant',correlation_id:'grant'},project_id:f.projectId,run_id:run.run_id,scope_digest:run.scope_digest,choice:'authorize'},ui);
  const input:TaskPrepare={meta:{idempotency_key:'task',correlation_id:'task'},project_id:f.projectId,kind:'assemble_draft',input_refs:[script.ref,storyboard.ref],snapshot_id:f.commit.snapshot_id,base_revision:f.commit.revision,source_digest:f.commit.source_digest,execution:{run_id:run.run_id,plan_version:1,step_id:'sample',attempt:1,input_digest:created.closure_digest,run_scope_digest:run.scope_digest,authorization_id:grant.authorization_id},render_spec:null};
  const gate=new CreatedTaskGate(f.host.revisions,repo,authority);
  const ports:CreatedTaskPorts={assertAllowed:gate.assertAllowed,bindStep:(rows,{task,now})=>repo.joinTaskTransaction(rows,tx=>{const e=task.request.execution;workflow.recordStepAttemptInTransaction(tx,{project_id:task.request.project_id,run_id:e.run_id,plan_version:1,step_id:e.step_id,attempt:e.attempt,grant_id:e.authorization_id,input_digest:e.input_digest,state:'pending',job_id:task.job_id,input_refs:task.request.input_refs,observed_at:now.toISOString()},f.owner);}),assertPrepared:()=>{throw Error('No production prepared proof registered');}};
  const store=new CreatedTaskStore(f.host.revisions,ports);
  const counts=()=>f.host.revisions.compose(db=>Object.fromEntries(['job','job_event','outbox','operation_idempotency','created_task_input','cp_a0_step_attempt','cp_a0_event'].map(table=>[table,Number(db.prepare('SELECT count(*) AS n FROM '+table).get()?.n)])));
  return {...f,repo,workflow,run,grant,input,ports,store,counts,script,storyboard};
 }catch(error){await f.close();throw error;}
}
it('reserves one real job, cp step/checkpoint and mirrored event atomically, then replays without new effects',async()=>{
 const f=await fixture();try{
  const before=f.counts(),result=f.store.reserve(f.input,'owner',policy);expect(result.replayed).toBe(false);
  expect(f.counts()).toMatchObject({job:before.job!+1,cp_a0_step_attempt:1,cp_a0_event:before.cp_a0_event!+1});
  const record=await f.repo.transaction(tx=>tx.get('run',{project_id:f.projectId,run_id:f.run.run_id}));expect(record?.checkpoint_json.attempts.find(s=>s.step_id==='sample')).toMatchObject({state:'pending',job_id:result.task.job_id});
  expect(await f.repo.transaction(tx=>tx.get('step_attempt',{project_id:f.projectId,run_id:f.run.run_id,plan_version:1,step_id:'sample',attempt:1}))).toMatchObject({state:'pending',job_id:result.task.job_id});
  const after=f.counts();expect(f.store.reserve(f.input,'owner',policy).task.accepted).toEqual(result.task.accepted);expect(f.counts()).toEqual(after);
  expect(()=>f.store.reserve(f.input,'foreign',policy)).toThrow();expect(f.counts()).toEqual(after);expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
 }finally{await f.close();}
},120000);
it('rejects stale base, altered refs/scope/attempt and crossing the sample gate before creating any job',async()=>{
 const f=await fixture();try{
  const before=f.counts();
  const variants:TaskPrepare[]=[{...f.input,base_revision:f.input.base_revision+1},{...f.input,source_digest:'0'.repeat(64)},{...f.input,input_refs:[f.script.ref]},{...f.input,input_refs:[{...f.script.ref,sha256:'0'.repeat(64)},f.storyboard.ref]},{...f.input,input_refs:[f.script.ref,f.script.ref]},{...f.input,execution:{...f.input.execution,attempt:2}},{...f.input,execution:{...f.input.execution,step_id:'first_chapter'}},{...f.input,execution:{...f.input.execution,run_scope_digest:'0'.repeat(64)}},{...f.input,execution:{...f.input.execution,authorization_id:'unknown-grant'}}];
  for(const value of variants){expect(()=>f.store.reserve(value,'owner',policy)).toThrow();expect(f.counts()).toEqual(before);}
 }finally{await f.close();}
},120000);
it('rolls back real job, step, checkpoint, event and grant mutation if final authorization is revoked',async()=>{
 const f=await fixture();try{
  const before=f.counts(),beforeRun=await f.workflow.readRun({project_id:f.projectId,run_id:f.run.run_id},f.owner),bind=f.ports.bindStep;
  f.ports.bindStep=(rows,ctx)=>{bind(rows,ctx);rows.prepare("UPDATE cp_a0_execution_grant SET state='revoked' WHERE project_id=? AND grant_id=?").run(f.projectId,f.grant.authorization_id);};
  expect(()=>f.store.reserve(f.input,'owner',policy)).toThrow();expect(f.counts()).toEqual(before);expect(await f.workflow.readRun({project_id:f.projectId,run_id:f.run.run_id},f.owner)).toEqual(beforeRun);
 }finally{await f.close();}
},120000);
it('rejects a creative closure changed after authorization without task side effects',async()=>{
 const f=await fixture();try{
  const created=f.app.creation.forProject(f.projectId)!;const brief={...created.brief,topic:'改变后的创作方向'};
  const creative=new CreativeService({repository:f.repo});await creative.putIntake({meta:{idempotency_key:'changed',correlation_id:'changed'},intake_id:created.request.intake_id,base_version:created.request.intake_version,brief},f.owner);
  const before=f.counts();expect(()=>f.store.reserve(f.input,'owner',policy)).toThrowError(expect.objectContaining({code:'REVIEW_STALE'}));expect(f.counts()).toEqual(before);
 }finally{await f.close();}
},120000);
it('emits real pending-to-running progress and rolls back step/checkpoint/outbox if the event mirror fails',async()=>{
 const f=await fixture();try{
  const task=f.store.reserve(f.input,'owner',policy).task,e=f.input.execution;
  const command={project_id:f.projectId,run_id:e.run_id,plan_version:1 as const,step_id:e.step_id,attempt:e.attempt,grant_id:e.authorization_id,input_digest:e.input_digest,job_id:task.job_id,observed_at:new Date().toISOString()};
  const before=f.counts();await f.workflow.recordStepAttempt({...command,state:'running'},f.owner);
  expect(f.counts()).toMatchObject({outbox:before.outbox!+1,cp_a0_event:before.cp_a0_event!+1});
  const payload=f.host.revisions.compose(db=>JSON.parse(String(db.prepare("SELECT payload_json FROM outbox WHERE topic='workflow.run.state_changed' AND project_id=? ORDER BY event_id DESC LIMIT 1").get(f.projectId)?.payload_json)));
  expect(payload.payload).toMatchObject({step_id:'sample',state:'running',job_id:task.job_id});
  const checkpoint=await f.repo.transaction(tx=>tx.get('run',{project_id:f.projectId,run_id:e.run_id})),settled=f.counts();
  f.host.revisions.compose(db=>db.exec("CREATE TEMP TRIGGER fixture_fail_workflow_event BEFORE INSERT ON cp_a0_event BEGIN SELECT RAISE(ABORT,'fixture event mirror failure'); END;"));
  await expect(f.workflow.recordStepAttempt({...command,state:'waiting_user'},f.owner)).rejects.toThrow('fixture event mirror failure');
  expect(f.counts()).toEqual(settled);expect(await f.repo.transaction(tx=>tx.get('run',{project_id:f.projectId,run_id:e.run_id}))).toEqual(checkpoint);
  expect(await f.repo.transaction(tx=>tx.get('step_attempt',{project_id:f.projectId,run_id:e.run_id,plan_version:1,step_id:'sample',attempt:1}))).toMatchObject({state:'running'});
 }finally{await f.close();}
},120000);
