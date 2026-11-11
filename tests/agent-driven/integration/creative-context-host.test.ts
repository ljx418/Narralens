import {it,expect} from 'vitest';
import {mkdtemp,rm,readFile,writeFile,unlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {NarralensHost} from '../../../src/host/server.js';
import {ProjectCatalog} from '../../../src/host/projects/project-catalog.js';
import {CreationApplication} from '../../../src/host/agent-driven/creation-application.js';
import {ProductSqliteRepository} from '../../../src/host/agent-driven/product-sqlite-repository.js';
import {readGuardFacts} from '../../../src/host/creative/execution-guard.js';
import {FixedWorkflowService} from '../../../src/host/creative/fixed-workflow-service.js';
import {ProjectContextService} from '../../../src/host/agent-driven/project-context-service.js';
import {CreativeProjectAuthority} from '../../../src/host/agent-driven/creative-project-authority.js';
import {createTrustedCallerContext} from '../../../src/host/creative/trusted-context.js';
import {TestAdoptionAuthority} from '../product/support/fixtures.js';
import {PersistentJobStore} from '../../../src/host/persistent-job-store.js';
import {canonicalDigest,styleDigest} from '../../../src/host/creative/digest.js';
import type {IntakePut,Intake,Decision,JobReceipt,Artifact,ArtifactPut,Context,Ref,ContentDecision,QuestionPut,Question} from '../../../src/contracts/agent-driven-types.js';
const vendorRoot='/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm';
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'narralens-creative-context-'));let app!:CreationApplication;
 const host=new NarralensHost({catalog:new ProjectCatalog(new Map()),dbPath:join(root,'host.sqlite'),snapshotsRoot:join(root,'snapshots'),adoptionStagingRoot:join(root,'stage'),migrationsRoot:join(root,'migrations'),derivedRoot:join(root,'derived'),openFilmVendorRoot:vendorRoot,agentApplication:instance=>app=new CreationApplication(instance,{createdRoot:join(root,'projects'),vendorRoot,worker:{pollMs:10}})});
 await host.listen(0);
 const owner=app.auth.issue({principal_id:'owner',channel:'authenticated',expires_at:Date.now()+300000}),human=app.auth.issue({principal_id:'owner',channel:'trusted_ui',expires_at:Date.now()+300000}),other=app.auth.issue({principal_id:'other',channel:'authenticated',expires_at:Date.now()+300000});
 const request=(path:string,body?:unknown,as:'owner'|'ui'|'other'='owner')=>fetch(host.origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:host.origin,...(as==='ui'?{Cookie:app.auth.cookieName+'='+human.token,'X-Narralens-CSRF':human.csrf!}:{Authorization:'Bearer '+(as==='other'?other:owner).token}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const vectors=JSON.parse(readFileSync('docs/agent-driven-v1/cp-a0/contract-vectors.json','utf8')) as {vectors:{id:string;value:unknown}[]};
 const input=structuredClone(vectors.vectors.find(v=>v.id==='definition:IntakePut:valid')!.value) as IntakePut;
 input.intake_id=null;input.base_version=0;input.brief.local_asset_ids=[];input.brief.narration_asset_id=null;input.brief.content_brief.material_strategy.asset_ids=[];input.brief.content_brief.material_strategy.narration_asset_id=null;input.brief.content_brief.material_strategy.rights_refs=[];input.brief.content_brief.script_ref=null;input.brief.content_brief.style.style_digest=styleDigest(input.brief.content_brief.style);
 const response=await request('/api/agent/v1/intakes',input);expect(response.status).toBe(200);const intake=await response.json() as Intake;
 const confirmation=await request('/api/agent/v1/intakes/'+intake.intake_id+'/decision',{meta:{idempotency_key:'confirm',correlation_id:'confirm'},intake_version:intake.version,brief_sha256:intake.brief_sha256,choice:'confirm_brief'},'ui');expect(confirmation.status).toBe(200);const decision=await confirmation.json() as Decision;
 const create=await request('/api/agent/v1/projects',{meta:{idempotency_key:'create',correlation_id:'create'},intake_id:intake.intake_id,intake_version:intake.version,decision_id:decision.decision_id});expect(create.status).toBe(202);let job=await create.json() as JobReceipt;
 const until=Date.now()+30000;while(Date.now()<until&&job.state!=='succeeded'){const response=await request('/api/agent/v1/projects/'+job.project_id+'/jobs/'+job.job_id);expect(response.status).toBe(200);job=await response.json() as JobReceipt;if(['failed','attention','cancelled'].includes(job.state))throw new Error('Creation failed');await new Promise(r=>setTimeout(r,10));}
 expect(job.state).toBe('succeeded');const projectId=job.project_id!;
 const closure=canonicalDigest({intake_id:intake.intake_id,intake_version:intake.version,brief_sha256:intake.brief_sha256,questions:[]});
 const script=(key='script',refs:Ref[]=[job.bootstrap!.intake_ref]):ArtifactPut=>({meta:{idempotency_key:key,correlation_id:key},project_id:projectId,artifact_id:null,base_version:0,input_digest:closure,content:{kind:'script',paragraphs:[{paragraph_id:'p1',text:'真实创作内容草稿，尚未生成影片。'}]},input_refs:refs});
 const put=(body:ArtifactPut,as:'owner'|'ui'|'other'='owner')=>request('/api/agent/v1/projects/'+projectId+'/artifacts',body,as);
 const count=(table:string)=>Number(host.revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM '+table).get()?.n));
 return {root,host,app,request,input,intake,projectId,job,closure,script,put,count,vectors,decision,close:async()=>{await host.close();await rm(root,{recursive:true,force:true});}};
}
it('writes Script and bound Storyboard through real HTTP and observes them beside the actual committed native project',async()=>{
 const f=await fixture();
 try{
  const before=await readFile(join(f.root,'projects',f.projectId,'source','film.html'),'utf8');
  const response=await f.put(f.script());expect(response.status,await response.clone().text()).toBe(200);const script=await response.json() as Artifact;
  const board:ArtifactPut={...f.script('board',[script.ref]),content:{kind:'storyboard',fps:30,shots:[{shot_id:'s1',paragraph_id:'p1',asset_id:null,duration_frames:900,caption:'第一段',concept_text:'原生概念镜头草稿'}]}};
  const saved=await f.put(board);expect(saved.status).toBe(200);const storyboard=await saved.json() as Artifact;
  const observed=await f.request('/api/agent/v1/projects/'+f.projectId+'/context');expect(observed.status,await observed.clone().text()).toBe(200);const context=await observed.json() as Context;
  expect(context).toMatchObject({project_id:f.projectId,origin:'created',project_revision:1,snapshot_id:f.job.bootstrap!.initial_snapshot_id,source_digest:f.job.bootstrap!.source_digest,active_jobs:[],active_run:null,native_ack:null,native_sync:'unknown',current_selection:null,selection_version:0,capabilities:[]});
  expect(context.artifacts).toContainEqual(script.ref);expect(context.artifacts).toContainEqual(storyboard.ref);expect(context.artifacts).toHaveLength(3);
  expect(JSON.stringify(context)).not.toContain(f.root);expect(await readFile(join(f.root,'projects',f.projectId,'source','film.html'),'utf8')).toBe(before);expect(f.host.revisions.activeCommit(f.projectId)?.revision).toBe(1);
  const replay=await f.put({...f.script(),meta:{idempotency_key:'script',correlation_id:'replay'}});expect(replay.status).toBe(200);expect(await replay.json()).toEqual(script);
 }finally{await f.close();}
},120000);
it('rejects foreign owner access and unresolved or altered lineage without inserting content/outbox/command facts',async()=>{
 const f=await fixture();
 try{
  const baseline={artifacts:f.count('cp_a0_artifact_version'),outbox:f.count('outbox'),commands:f.count('operation_idempotency')};
  expect((await f.put(f.script(),'other')).status).toBe(404);expect((await f.request('/api/agent/v1/projects/'+f.projectId+'/context',undefined,'other')).status).toBe(404);
  const invalids=[{...f.script('missing',[{id:'missing',version:1,sha256:'1'.repeat(64)}])},{...f.script('changed'),input_refs:[{...f.job.bootstrap!.intake_ref,sha256:'0'.repeat(64)}]},{...f.script('stale'),input_digest:'0'.repeat(64)}];
  for(const input of invalids){const response=await f.put(input);expect([404,409]).toContain(response.status);}
  const duplicate=f.script('duplicate');duplicate.content={kind:'script',paragraphs:[{paragraph_id:'p1',text:'one'},{paragraph_id:'p1',text:'two'}]};expect((await f.put(duplicate)).status).toBe(400);
  expect({artifacts:f.count('cp_a0_artifact_version'),outbox:f.count('outbox'),commands:f.count('operation_idempotency')}).toEqual(baseline);
 }finally{await f.close();}
},120000);
it('keeps original artifact replay after input changes but refuses new stale writes and rejects dangling storyboard paragraphs',async()=>{
 const f=await fixture();
 try{
  const response=await f.put(f.script());expect(response.status).toBe(200);const saved=await response.json() as Artifact;
  const dangling:ArtifactPut={...f.script('dangling',[saved.ref]),content:{kind:'storyboard',fps:30,shots:[{shot_id:'s1',paragraph_id:'unknown',asset_id:null,duration_frames:900,caption:'',concept_text:'draft'}]}};
  expect((await f.put(dangling)).status).toBe(409);
  const wrongAsset:ArtifactPut={...dangling,meta:{idempotency_key:'wrong-asset',correlation_id:'wrong-asset'},content:{...dangling.content,kind:'storyboard',fps:30,shots:[{shot_id:'s1',paragraph_id:'p1',asset_id:'unselected',duration_frames:900,caption:'',concept_text:'draft'}]}};
  expect((await f.put(wrongAsset)).status).toBe(409);
  const changed={...f.input,intake_id:f.intake.intake_id,base_version:1,meta:{idempotency_key:'update',correlation_id:'update'},brief:{...f.input.brief,topic:'新版本的主题'}};
  expect((await f.request('/api/agent/v1/intakes',changed)).status).toBe(200);
  const replay=await f.put(f.script());expect(replay.status).toBe(200);expect(await replay.json()).toEqual(saved);
  expect((await f.put(f.script('stale-new'))).status).toBe(409);
 }finally{await f.close();}
},120000);

it('reports an actual non-creator active Job as missing its producer, never hides it or misreports a revision conflict',async()=>{
 const f=await fixture();
 try{
  const job=new PersistentJobStore(f.host.revisions).create({projectId:f.projectId,kind:'render',payload:{fixture:'receipt-producer-unavailable'}});
  const jobPath='/api/agent/v1/projects/'+f.projectId+'/jobs/'+job.job_id;expect((await f.request(jobPath)).status).toBe(503);expect((await f.request(jobPath,undefined,'other')).status).toBe(404);
  const response=await f.request('/api/agent/v1/projects/'+f.projectId+'/context');expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
 }finally{await f.close();}
},120000);

it('does not resolve another real project artifact even for the same owner and matching hash',async()=>{
 const f=await fixture();
 try{
  const savedResponse=await f.put(f.script());expect(savedResponse.status).toBe(200);const saved=await savedResponse.json() as Artifact;
  const create=await f.request('/api/agent/v1/projects',{meta:{idempotency_key:'second-project',correlation_id:'second-project'},intake_id:f.intake.intake_id,intake_version:1,decision_id:f.decision.decision_id});expect(create.status).toBe(202);let job=await create.json() as JobReceipt;
  const deadline=Date.now()+30000;while(job.state!=='succeeded'&&Date.now()<deadline){const read=await f.request('/api/agent/v1/projects/'+job.project_id+'/jobs/'+job.job_id);job=await read.json() as JobReceipt;await new Promise(r=>setTimeout(r,10));}expect(job.state).toBe('succeeded');
  const result=await f.request('/api/agent/v1/projects/'+job.project_id+'/artifacts',{...f.script('cross-project',[saved.ref]),project_id:job.project_id});expect(result.status).toBe(404);
  expect(f.host.revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM cp_a0_artifact_version WHERE project_id=?').get(job.project_id!)?.n)).toBe(1);
 }finally{await f.close();}
},120000);
it('binds new draft writes to the question closure, while replay keeps the original artifact after a new question',async()=>{
 const f=await fixture();
 try{
  const savedResponse=await f.put(f.script());expect(savedResponse.status).toBe(200);const saved=await savedResponse.json() as Artifact;
  const question=structuredClone(f.vectors.vectors.find(v=>v.id==='definition:QuestionPut:valid')!.value) as QuestionPut;
  question.intake_id=f.intake.intake_id;question.expected_intake_version=1;question.question_id=null;question.expected_question_version=0;question.input_digest=f.intake.brief_sha256;
  const response=await f.request('/api/agent/v1/intakes/'+f.intake.intake_id+'/questions',question);expect(response.status,await response.clone().text()).toBe(200);const q=await response.json() as Question;
  expect((await f.put(f.script('old-closure-new-write'))).status).toBe(409);
  const replay=await f.put(f.script());expect(replay.status).toBe(200);expect(await replay.json()).toEqual(saved);
  const updated=canonicalDigest({intake_id:f.intake.intake_id,intake_version:1,brief_sha256:f.intake.brief_sha256,questions:[{question_id:q.question_id,question_version:q.version,answer:null}]});
  expect((await f.put({...f.script('current-closure'),input_digest:updated})).status).toBe(200);
 }finally{await f.close();}
},120000);
it('maps a real native source drift to conflict and checks ownership before unavailable source lookup',async()=>{
 const f=await fixture();
 try{
  const source=join(f.root,'projects',f.projectId,'source','film.html');await writeFile(source,'external source drift');
  const own=await f.request('/api/agent/v1/projects/'+f.projectId+'/context');expect(own.status).toBe(409);expect(await own.json()).toMatchObject({code:'REVISION_CONFLICT'});
  expect((await f.request('/api/agent/v1/projects/'+f.projectId+'/context',undefined,'other')).status).toBe(404);
  expect(f.host.revisions.activeCommit(f.projectId)?.revision).toBe(1);
 }finally{await f.close();}
},120000);
// This is a persisted observer/authorization consistency fixture. Synthetic eligibility
// does NOT certify real material rights, capability registration, or production Run execution.
async function observerRun(f:Awaited<ReturnType<typeof fixture>>){
 const savedResponse=await f.put(f.script());expect(savedResponse.status).toBe(200);const script=await savedResponse.json() as Artifact;
 const repository=new ProductSqliteRepository(f.host.revisions);
 const style=await repository.transaction(tx=>{const row=tx.list('artifact_version',{project_id:f.projectId}).find(x=>x.kind==='brief')!;return {id:row.artifact_id,version:row.version,sha256:row.content_digest};});
 const response=await f.request('/api/agent/v1/content-decisions',{meta:{idempotency_key:'content-observer',correlation_id:'content-observer'},project_id:f.projectId,intake_id:f.intake.intake_id,intake_version:1,input_digest:f.closure,request_id:'observer-request',choice:'accept_content',source:'driver_relay',source_message_ref:'component-fixture-message'});expect(response.status).toBe(200);const decision=await response.json() as ContentDecision;
 let now=Math.floor(Date.now()/1000);
 const workflow=new FixedWorkflowService({repository,adoption:new TestAdoptionAuthority(),now:()=>now,authorizationTtlSeconds:60,facts:{readProjectFacts:async()=>({project_id:f.projectId,exists:true,project_revision:1,control_revision:0,snapshot_id:f.job.bootstrap!.initial_snapshot_id,source_digest:f.job.bootstrap!.source_digest,rights_authorized:true,rights_reason:'component fixture only',capability_available:true,capability_fingerprint:'7'.repeat(64),capability_reason:'component fixture only'})}});
 const caller=createTrustedCallerContext({principal_id:'owner',channel:'authenticated',source:'driver_relay',session_ref:'observer-driver'}),ui=createTrustedCallerContext({principal_id:'owner',channel:'trusted_ui',source:'trusted_ui',session_ref:'observer-ui'});
 const run=await workflow.prepareRun({meta:{idempotency_key:'observer-run',correlation_id:'observer-run'},project_id:f.projectId,intake_decision_id:decision.decision_id,template_id:'local-short-film',template_version:1,input_refs:[script.ref],input_digest:f.closure,style_ref:style,content_type:'short_film'},caller);
 return {workflow,run,caller,ui,setNow:(value:number)=>{now=value;},now:()=>now};
}
it('component observer uses the authorization written during native observation in its one final SQLite projection',async()=>{
 const f=await fixture();
 try{
  const fixtureRun=await observerRun(f);const {workflow,run,caller,ui}=fixtureRun;
  const context=new ProjectContextService(f.host,f.app.creation,new CreativeProjectAuthority(f.app.creation),workflow,{read:async()=>{await workflow.authorizeRun({meta:{idempotency_key:'during-read',correlation_id:'during-read'},project_id:f.projectId,run_id:run.run_id,scope_digest:run.scope_digest,choice:'authorize'},ui);return {selection:null,selection_version:0,ack:null,sync:'unknown',active_bridge_session_id:null};}});
  const result=await context.read(f.projectId,caller);expect(result.active_run?.authorization).toMatchObject({state:'active',principal_id:'owner'});expect(result.native_sync).toBe('unknown');
  expect((await f.request('/api/agent/v1/projects/'+f.projectId+'/context')).status).toBe(200);
 }finally{await f.close();}
},120000);
it('component observer reports expired grants honestly and prefers a new valid authorization over expired predecessors',async()=>{
 const f=await fixture();
 try{
  const {workflow,run,caller,ui,now,setNow}=await observerRun(f);
  const grant=await workflow.authorizeRun({meta:{idempotency_key:'first-auth',correlation_id:'first-auth'},project_id:f.projectId,run_id:run.run_id,scope_digest:run.scope_digest,choice:'authorize'},ui);
  const issued=now();setNow(issued-1);expect((await workflow.readCurrentRun(f.projectId,caller))?.authorization).toBeNull();
  const facts=await new ProductSqliteRepository(f.host.revisions).transaction(tx=>readGuardFacts(tx,f.projectId,{run_id:run.run_id,plan_version:1,step_id:'definition',attempt:1,input_digest:run.scope.input_digest,run_scope_digest:run.scope_digest,authorization_id:grant.authorization_id},'owner',issued-1));expect(facts.grant).toBeNull();
  setNow(issued);
  setNow(now()+61);expect((await workflow.readCurrentRun(f.projectId,caller))?.authorization).toMatchObject({authorization_id:grant.authorization_id,state:'expired'});
  const fresh=await workflow.authorizeRun({meta:{idempotency_key:'second-auth',correlation_id:'second-auth'},project_id:f.projectId,run_id:run.run_id,scope_digest:run.scope_digest,choice:'authorize'},ui);
  expect((await workflow.readCurrentRun(f.projectId,caller))?.authorization).toMatchObject({authorization_id:fresh.authorization_id,state:'active'});
 }finally{await f.close();}
},120000);

it('rejects a committed author source replaced by a FIFO without hanging the HTTP request or Host close',async()=>{
 const f=await fixture();const path=join(f.root,'projects',f.projectId,'source','film.html');let timedOut=false;
 try{
  await unlink(path);expect(spawnSync('mkfifo',['-m','600',path],{stdio:'ignore'}).status).toBe(0);
  let status:number|null=null;
  try{const credential=f.app.auth.issue({principal_id:'owner',channel:'authenticated',expires_at:Date.now()+60000});const response=await fetch(f.host.origin+'/api/agent/v1/projects/'+f.projectId+'/context',{headers:{Origin:f.host.origin,Authorization:'Bearer '+credential.token},signal:AbortSignal.timeout(3000)});status=response.status;}
  catch(error){if(error instanceof Error&&(error.name==='TimeoutError'||error.name==='AbortError'))timedOut=true;else throw error;}
  expect(timedOut,'a FIFO occupied the live request instead of being rejected').toBe(false);expect(status).toBe(503);
  expect(f.host.revisions.activeCommit(f.projectId)?.revision).toBe(1);
 }finally{
  // Old implementation's blocked reader must be released before closing its real Host.
  if(timedOut)await writeFile(path,'release blocked diagnostic reader');
  await f.close();
 }
},30000);
it.each(['pause','cancel'] as const)('component safe-control %s still commits with a future-issued grant and does not authorize a new action',async control=>{
 const f=await fixture();
 try{
  const {workflow,run,caller,ui,now,setNow}=await observerRun(f);
  const grant=await workflow.authorizeRun({meta:{idempotency_key:'future-auth',correlation_id:'future-auth'},project_id:f.projectId,run_id:run.run_id,scope_digest:run.scope_digest,choice:'authorize'},ui);setNow(now()-1);
  const input={meta:{idempotency_key:'tighten',correlation_id:'tighten'},project_id:f.projectId,run_id:run.run_id,expected_plan_version:1 as const,run_scope_digest:run.scope_digest,authorization_id:grant.authorization_id};
  const result=await (control==='pause'?workflow.pauseRun(input,caller):workflow.cancelRun(input,caller));
  expect(result.state).toBe(control==='pause'?'paused':'cancelled');expect(result.authorization).toBeNull();
  expect(f.host.revisions.compose(db=>db.prepare('SELECT state FROM cp_a0_run WHERE project_id=? AND run_id=?').get(f.projectId,run.run_id)?.state)).toBe(result.state);
  await expect(workflow.startRun({...input,meta:{idempotency_key:'not-a-new-action',correlation_id:'not-a-new-action'}},caller)).rejects.toMatchObject({code:'RUN_SCOPE_REQUIRED'});
  expect(f.host.revisions.activeCommit(f.projectId)?.revision).toBe(1);
 }finally{await f.close();}
},120000);

it('binds content relay project scope to its owned project and originating intake while preserving pre-project decisions',async()=>{
 const f=await fixture();
 try{
  const base={meta:{idempotency_key:'scoped-relay',correlation_id:'scoped-relay'},project_id:f.projectId,intake_id:f.intake.intake_id,intake_version:1,input_digest:f.closure,request_id:'scoped-relay',choice:'accept_content',source:'driver_relay',source_message_ref:'conversation-content'};
  const before=f.count('cp_a0_intake_content_decision');
  const unknown=await f.request('/api/agent/v1/content-decisions',{...base,project_id:'unknown-project'});expect(unknown.status,await unknown.clone().text()).toBe(404);expect(f.count('cp_a0_intake_content_decision')).toBe(before);
  const otherIntakeInput={...f.input,meta:{idempotency_key:'other-intake',correlation_id:'other-intake'}};
  const otherResponse=await f.request('/api/agent/v1/intakes',otherIntakeInput,'other');expect(otherResponse.status).toBe(200);const other=await otherResponse.json() as Intake;
  const otherClosure=canonicalDigest({intake_id:other.intake_id,intake_version:other.version,brief_sha256:other.brief_sha256,questions:[]});
  const foreign={...base,intake_id:other.intake_id,input_digest:otherClosure};
  expect((await f.request('/api/agent/v1/content-decisions',foreign,'other')).status).toBe(404);
  const ownSecondResponse=await f.request('/api/agent/v1/intakes',{...f.input,meta:{idempotency_key:'second-intake',correlation_id:'second-intake'}});const ownSecond=await ownSecondResponse.json() as Intake;
  const secondClosure=canonicalDigest({intake_id:ownSecond.intake_id,intake_version:ownSecond.version,brief_sha256:ownSecond.brief_sha256,questions:[]});
  expect((await f.request('/api/agent/v1/content-decisions',{...base,intake_id:ownSecond.intake_id,input_digest:secondClosure})).status).toBe(409);
  expect(f.count('cp_a0_intake_content_decision')).toBe(before);
  const accepted=await f.request('/api/agent/v1/content-decisions',base);expect(accepted.status).toBe(200);const saved=await accepted.json();expect(saved.project_id).toBe(f.projectId);
  expect(await (await f.request('/api/agent/v1/content-decisions',base)).json()).toEqual(saved);
  const preproject=await f.request('/api/agent/v1/content-decisions',{...foreign,project_id:null},'other');expect(preproject.status).toBe(200);expect((await preproject.json()).project_id).toBeNull();
 }finally{await f.close();}
},120000);

it('observes a real owned project before its first Run without creating workflow, Job or command facts',async()=>{
 const f=await fixture();try{
  const baseline={runs:f.count('cp_a0_run'),commands:f.count('operation_idempotency'),commit:f.host.revisions.activeCommit(f.projectId)};
  const bytes=await readFile(join(f.root,'projects',f.projectId,'source','film.html'),'utf8');
  const path='/api/agent/v1/projects/'+f.projectId+'/workflow';
  for(let read=0;read<2;read++){
   const response=await f.request(path);expect(response.status).toBe(200);
   expect(await response.json()).toEqual({project_id:f.projectId,workflow_revision:0,nodes:[],next_actions:['define_content']});
  }
  expect((await f.request(path,undefined,'other')).status).toBe(404);
  expect((await f.request('/api/agent/v1/projects/missing-owned-project/workflow')).status).toBe(404);
  expect({runs:f.count('cp_a0_run'),commands:f.count('operation_idempotency'),commit:f.host.revisions.activeCommit(f.projectId)}).toEqual(baseline);
  expect(await readFile(join(f.root,'projects',f.projectId,'source','film.html'),'utf8')).toBe(bytes);
 }finally{await f.close();}
},120000);
