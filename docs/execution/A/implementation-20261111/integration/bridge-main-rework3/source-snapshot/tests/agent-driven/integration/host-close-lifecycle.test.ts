import {it,expect,beforeAll,afterAll} from 'vitest';
import {mkdtemp,rm,readFile,mkdir,cp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {NarralensHost} from '../../../src/host/server.js';
import {ProjectCatalog} from '../../../src/host/projects/project-catalog.js';
import {CreationApplication} from '../../../src/host/agent-driven/creation-application.js';
import {CreativeProjectAuthority} from '../../../src/host/agent-driven/creative-project-authority.js';
import {ProductSqliteRepository} from '../../../src/host/agent-driven/product-sqlite-repository.js';
import {FixedWorkflowService} from '../../../src/host/creative/fixed-workflow-service.js';
import {CreativeService} from '../../../src/host/creative/creative-service.js';
import {ApplicationDispatcher,creativeHandlers} from '../../../src/host/agent-driven/application-dispatcher.js';
import {ScopedAgentAuth} from '../../../src/host/agent-driven/scoped-auth.js';
import {CreatedTaskGate} from '../../../src/host/agent-driven/created-task-gate.js';
import {RevisionStore} from '../../../src/host/projects/revision-store.js';
import {creativeInputClosure} from '../../../src/host/creative/creative-closure.js';
import {canonicalDigest} from '../../../src/host/creative/digest.js';
import {createTrustedCallerContext} from '../../../src/host/creative/trusted-context.js';
import {LocalAssetRegistry} from '../../../src/host/agent-driven/local-asset-registry.js';
import {CreatedTaskApplication} from '../../../src/host/agent-driven/created-task-application.js';
import {CreatedDraftTaskProcessor} from '../../../src/host/agent-driven/created-draft-processor.js';
import {PreparedDraftVerifier} from '../../../src/host/agent-driven/prepared-draft-verifier.js';
import {PersistentJobStore} from '../../../src/host/persistent-job-store.js';
import {createdProjectFixture,vendorRoot} from './helpers/created-project-fixture.js';
import {TestAdoptionAuthority} from '../product/support/fixtures.js';
import type {TaskPrepare} from '../../../src/contracts/agent-driven-types.js';

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(check:()=>boolean,timeout=60000){const end=Date.now()+timeout;while(!check()&&Date.now()<end)await sleep(20);expect(check()).toBe(true);}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};}
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');

let media='';
beforeAll(async()=>{
 media=await mkdtemp(join(tmpdir(),'narralens-close-media-'));
 const ff=(args:string[])=>execFileSync('ffmpeg',['-nostdin','-hide_banner','-v','error',...args],{windowsHide:true,timeout:60000});
 ff(['-f','lavfi','-i','color=c=0x185a88:s=320x180:r=30:d=3','-threads','1','-c:v','libx264','-pix_fmt','yuv420p',join(media,'video.mp4')]);
 ff(['-f','lavfi','-i','sine=frequency=430:sample_rate=48000:duration=3','-threads','1','-c:a','pcm_s16le',join(media,'voice.wav')]);
},180000);
afterAll(async()=>{await rm(media,{recursive:true,force:true});});

interface Media{readonly inputRoot:string;readonly blobRoot:string;readonly taskRoot:string;}

/**
 * A real created project with real registered media, a real run and a real grant.
 *
 * Nothing here is a fixture processor: the task is executed by the real
 * CreatedDraftTaskProcessor over the real pinned assembler and the real verifier.
 */
async function live(boundary?:(point:string)=>Promise<void>){
 const f=await createdProjectFixture();
 const paths:Media={inputRoot:join(f.root,'inputs'),blobRoot:join(f.root,'local-assets'),taskRoot:join(f.root,'tasks')};
 await mkdir(paths.inputRoot,{mode:0o700});
 await cp(join(media,'video.mp4'),join(paths.inputRoot,'video.mp4'));
 await cp(join(media,'voice.wav'),join(paths.inputRoot,'voice.wav'));
 const registry=new LocalAssetRegistry(f.host.revisions,f.app.creation,{sourceRoot:paths.inputRoot,storageRoot:paths.blobRoot,projectsRoot:join(f.root,'projects'),snapshotsRoot:join(f.root,'snapshots')});
 const ui=createTrustedCallerContext({principal_id:'owner',channel:'trusted_ui',source:'trusted_ui',session_ref:f.ui.principal.session_ref});
 const registered=[];
 for(const [file,kind] of [['video.mp4','video'],['voice.wav','audio']] as const){
  const bytes=await readFile(join(paths.inputRoot,file));
  registered.push(await registry.import({project_id:f.projectId,idempotency_key:'import-'+kind,relative_path:file,expected_sha256:sha(bytes),kind,source:{kind:'generated',label:'Test-created local diagnostic media'},license:{status:'cleared',label:'Diagnostic fixture only',commercial_use:true},recording_origin:kind==='audio'?'synthetic':null,attestation_ref:'test-'+kind},ui));
 }
 const repo=new ProductSqliteRepository(f.host.revisions),authority=new CreativeProjectAuthority(f.app.creation),creative=new CreativeService({repository:repo,artifactAuthority:authority.assertArtifact,contentAuthority:authority.assertContent}),created=f.app.creation.forProject(f.projectId)!;
 const brief=structuredClone(created.brief);
 brief.local_asset_ids=registered.map(a=>a.asset_id);brief.narration_asset_id=registered[1]!.asset_id;
 Object.assign(brief.content_brief.material_strategy,{asset_ids:brief.local_asset_ids,narration_asset_id:brief.narration_asset_id,rights_refs:registered.map(a=>({id:a.rights_ref,version:1,sha256:a.registration_digest}))});
 const intake=await creative.putIntake({meta:{idempotency_key:'updated',correlation_id:'updated'},intake_id:created.request.intake_id,base_version:1,brief},f.owner);
 const closure=await repo.transaction(tx=>canonicalDigest(creativeInputClosure(tx,intake.intake_id,intake.version)));
 const script=await creative.putArtifact({meta:{idempotency_key:'script',correlation_id:'script'},project_id:f.projectId,artifact_id:null,base_version:0,input_digest:closure,content:{kind:'script',paragraphs:[{paragraph_id:'p1',text:'第一段诊断内容。'},{paragraph_id:'p2',text:'第二段诊断内容。'},{paragraph_id:'p3',text:'原生概念说明。'}]},input_refs:[]},f.owner);
 const storyboard=await creative.putArtifact({meta:{idempotency_key:'storyboard',correlation_id:'storyboard'},project_id:f.projectId,artifact_id:null,base_version:0,input_digest:closure,content:{kind:'storyboard',fps:30,shots:[{shot_id:'s1',paragraph_id:'p1',asset_id:registered[0]!.asset_id,duration_frames:31,caption:'第一条诊断字幕。',concept_text:''},{shot_id:'s2',paragraph_id:'p2',asset_id:registered[0]!.asset_id,duration_frames:29,caption:'第二条诊断字幕。',concept_text:''},{shot_id:'s3',paragraph_id:'p3',asset_id:null,duration_frames:30,caption:'概念说明字幕。',concept_text:'可编辑概念'}]},input_refs:[script.ref]},f.owner);
 const style=await repo.transaction(tx=>{const row=tx.list('artifact_version',{project_id:f.projectId}).find(a=>a.kind==='brief')!;return{id:row.artifact_id,version:row.version,sha256:row.content_digest};});
 const decision=await creative.relayContentDecision({meta:{idempotency_key:'content',correlation_id:'content'},project_id:f.projectId,intake_id:intake.intake_id,intake_version:intake.version,input_digest:closure,request_id:'request',choice:'accept_content',source:'driver_relay',source_message_ref:'component-confirmation'},f.owner);
 const facts={readProjectFacts:async()=>({project_id:f.projectId,exists:true,project_revision:1,control_revision:0,source_digest:f.commit.source_digest,snapshot_id:f.commit.snapshot_id,rights_authorized:true,rights_reason:'fixture eligibility only; actual assets separately verified',capability_available:true,capability_fingerprint:'a'.repeat(64),capability_reason:'fixture producer registration only'})};
 const workflow=new FixedWorkflowService({repository:repo,adoption:new TestAdoptionAuthority(),facts});
 const run=await workflow.prepareRun({meta:{idempotency_key:'run',correlation_id:'run'},project_id:f.projectId,intake_decision_id:decision.decision_id,template_id:'local-short-film',template_version:1,input_refs:[script.ref,storyboard.ref],input_digest:closure,style_ref:style,content_type:'short_film'},f.owner);
 const grant=await workflow.authorizeRun({meta:{idempotency_key:'grant',correlation_id:'grant'},project_id:f.projectId,run_id:run.run_id,scope_digest:run.scope_digest,choice:'authorize'},ui);
 const request:TaskPrepare={meta:{idempotency_key:'task',correlation_id:'task'},project_id:f.projectId,kind:'assemble_draft',input_refs:[script.ref,storyboard.ref],snapshot_id:f.commit.snapshot_id,base_revision:1,source_digest:f.commit.source_digest,execution:{run_id:run.run_id,plan_version:1,step_id:'sample',attempt:1,input_digest:closure,run_scope_digest:run.scope_digest,authorization_id:grant.authorization_id},render_spec:null};
 const jobs=f.host.jobs;
 if(!(jobs instanceof PersistentJobStore))throw Error('The real persistent Host job store is required');
 const gate=new CreatedTaskGate(f.host.revisions,repo,authority);
 const verifier=new PreparedDraftVerifier(vendorRoot,{stageDomainRoot:paths.taskRoot,blobPath:asset=>registry.blobPathForFact(asset)});
 const tasks=new CreatedTaskApplication({revisions:f.host.revisions,repository:repo,workflow,authority,jobs,worker:{pollMs:10},createProcessor:(store)=>new CreatedDraftTaskProcessor(f.host,store,gate,repo,workflow,authority,registry,verifier,{root:paths.taskRoot,vendorRoot,protectedRoots:[join(f.root,'projects'),join(f.root,'snapshots')],width:320,height:180,...(boundary?{boundary:(point)=>boundary(point)}:{})})});
 const task=tasks.tasks.reserve(request,'owner',{job_kind:'snapshot_publish',max_attempts:3}).task;
 return {f,paths,registry,repo,workflow,authority,tasks,run,request,task,gate,verifier,ui};
}

it('joins simultaneous Host closes and lets an admitted real HTTP handler finish before closing SQLite',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-close-race-'));
 let entered!:()=>void,release!:()=>void;
 const reached=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
 let auth!:ScopedAgentAuth;
 const host=new NarralensHost({catalog:new ProjectCatalog(new Map()),dbPath:join(root,'host.sqlite'),snapshotsRoot:join(root,'snapshots'),adoptionStagingRoot:join(root,'stage'),migrationsRoot:join(root,'migrations'),derivedRoot:join(root,'derived'),agentApplication:instance=>{
  auth=new ScopedAgentAuth(()=>instance.origin);
  const handlers=creativeHandlers(new CreativeService({repository:new ProductSqliteRepository(instance.revisions)}));
  return {auth,dispatcher:new ApplicationDispatcher({...handlers,'intake.read':async(input,principal)=>{entered();await gate;return handlers['intake.read']!(input,principal);}})};
 }});
 try{
  await host.listen(0);const credential=auth.issue({principal_id:'owner',channel:'authenticated',expires_at:Date.now()+60000});
  const request=fetch(host.origin+'/api/agent/v1/intakes/missing',{headers:{Origin:host.origin,Authorization:'Bearer '+credential.token}});
  await reached;const first=host.close(),second=host.close();const settled=Promise.allSettled([first,second]);
  // Even if the assertion fails on the old implementation, release the admitted request.
  release();const response=await request;await settled;expect(response.status).toBe(404);expect(first).toBe(second);await Promise.all([first,second]);
 }finally{release();await host.close();await rm(root,{recursive:true,force:true});}
},120000);

it('releases the live lease and its checkpoint together on a graceful close, survives a reopen and resumes the same job',async()=>{
 const reached=deferred(),release=deferred();
 const live1=await live(async(point)=>{if(point==='before_prepare'){reached.resolve();await release.promise;}});
 const {f,paths,registry,repo,workflow,tasks,task,run}=live1;
 const jobId=task.job_id;
 const stepKey={project_id:f.projectId,run_id:run.run_id,plan_version:1 as const,step_id:'sample',attempt:1};
 const eventsOf=()=>f.host.revisions.compose(db=>Number(db.prepare('SELECT count(*) AS n FROM job_event WHERE job_id=?').get(jobId)?.n));
 const eventTypes=()=>f.host.revisions.compose(db=>(db.prepare('SELECT type FROM job_event WHERE job_id=? ORDER BY seq').all(jobId) as Array<{type:string}>).map(row=>row.type));
 try{
  tasks.start();
  await reached.promise;
  // The real processor recorded the running checkpoint before the boundary.
  const running=await repo.transaction(tx=>tx.get('step_attempt',stepKey));
  expect(running?.state).toBe('running');
  expect(running?.job_id).toBe(jobId);
  expect(f.host.revisions.readJob(jobId)).toMatchObject({state:'running',lease_owner:expect.any(String)});
  const eventsBefore=await eventsOf();
  // The graceful shutdown: the worker aborts the processor and the release happens in
  // the same transaction as the checkpoint reset.
  const closing=tasks.close();
  release.resolve();
  await closing;
  const released=f.host.revisions.readJob(jobId)!;
  expect(released.state).toBe('queued');
  expect(released.lease_owner).toBeNull();
  expect(released.lease_expires_at).toBeNull();
  const pending=await repo.transaction(tx=>tx.get('step_attempt',stepKey));
  expect(pending?.state).toBe('pending');
  expect(pending?.job_id).toBe(jobId);
  const runRow=await repo.transaction(tx=>tx.get('run',{project_id:f.projectId,run_id:run.run_id}));
  expect(runRow?.checkpoint_json.attempts[0]).toMatchObject({state:'pending',job_id:jobId});
  // Exactly one durable event for the release, and no invented failure.
  expect(await eventsOf()).toBe(eventsBefore+1);
  expect(await eventTypes()).toEqual(['queued','running','queued']);
  // The author state, the revision and the source are untouched by a shutdown.
  expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
  expect(await readFile(join(f.authorRoot,'film.html'))).toEqual(f.authorBytes);
  // Close the database and reopen the SAME isolated database without a worker.
  await registry.close();
  await f.host.close();
  const reopened=new RevisionStore(join(f.root,'host.sqlite'));
  try{
   const job=reopened.readJob(jobId)!;
   expect(job.state).toBe('queued');expect(job.lease_owner).toBeNull();expect(job.lease_expires_at).toBeNull();
   // The durable checkpoint survived the restart as pending, not running.
   const repo2=new ProductSqliteRepository(reopened);
   const after=await repo2.transaction(tx=>tx.get('step_attempt',stepKey));
   expect(after?.state).toBe('pending');
   expect(after?.job_id).toBe(jobId);
  }finally{reopened.close();}
  // Reopen the Host over the same database and resume the original job.
  let app2!:CreationApplication;
  const host2=new NarralensHost({catalog:new ProjectCatalog(new Map()),dbPath:join(f.root,'host.sqlite'),snapshotsRoot:join(f.root,'snapshots'),adoptionStagingRoot:join(f.root,'stage'),migrationsRoot:join(f.root,'migrations'),derivedRoot:join(f.root,'derived'),openFilmVendorRoot:vendorRoot,isolatedStudioRuntimeRoot:join(f.root,'studio-runtime'),agentApplication:instance=>app2=new CreationApplication(instance,{createdRoot:join(f.root,'projects'),vendorRoot,worker:{pollMs:10}})});
  try{
   const registry2=new LocalAssetRegistry(host2.revisions,app2.creation,{sourceRoot:paths.inputRoot,storageRoot:paths.blobRoot,projectsRoot:join(f.root,'projects'),snapshotsRoot:join(f.root,'snapshots')});
   const repo2=new ProductSqliteRepository(host2.revisions),authority2=new CreativeProjectAuthority(app2.creation);
   const workflow2=new FixedWorkflowService({repository:repo2,adoption:new TestAdoptionAuthority(),facts:{readProjectFacts:async()=>({project_id:f.projectId,exists:true,project_revision:1,control_revision:0,source_digest:f.commit.source_digest,snapshot_id:f.commit.snapshot_id,rights_authorized:true,rights_reason:'fixture eligibility only',capability_available:true,capability_fingerprint:'a'.repeat(64),capability_reason:'fixture producer registration only'})}});
   const gate2=new CreatedTaskGate(host2.revisions,repo2,authority2);
   const verifier2=new PreparedDraftVerifier(vendorRoot,{stageDomainRoot:paths.taskRoot,blobPath:asset=>registry2.blobPathForFact(asset)});
   const tasks2=new CreatedTaskApplication({revisions:host2.revisions,repository:repo2,workflow:workflow2,authority:authority2,jobs:host2.jobs as unknown as PersistentJobStore,worker:{pollMs:10},createProcessor:(store)=>new CreatedDraftTaskProcessor(host2,store,gate2,repo2,workflow2,authority2,registry2,verifier2,{root:paths.taskRoot,vendorRoot,protectedRoots:[join(f.root,'projects'),join(f.root,'snapshots')],width:320,height:180})});
   // The dedicated recovery owns these jobs: a queued job with no lease is not settled
   // again by the recovery, and it is not double settled either.
   expect(tasks2.tasks.leaseReaperExclusions()).toContain(jobId);
   tasks2.start();
   await until(()=>['succeeded','failed','attention','cancelled'].includes(host2.revisions.readJob(jobId)!.state));
   const resumed=host2.revisions.readJob(jobId)!;
   expect(resumed.state).toBe('succeeded');
   // The lease attempt advanced, the execution attempt did not.
   expect(resumed.attempt).toBe(2);
   const receipt=tasks2.tasks.receipt(jobId,'owner');
   expect(receipt).toMatchObject({state:'succeeded',attempt:2,result_ref:null,next_actions:['review_prepared_source']});
   const prepared=tasks2.tasks.readPrepared(jobId,'owner');
   expect(prepared).not.toBeNull();
   expect(tasks2.tasks.preparedLeaseAttempt(jobId,'owner')).toBe(2);
   const final=await repo2.transaction(tx=>tx.get('step_attempt',stepKey));
   expect(final?.state).toBe('waiting_user');
   // The author state, the revision and the source are still untouched.
   expect(host2.revisions.activeCommit(f.projectId)).toEqual(f.commit);
   expect(await readFile(join(f.authorRoot,'film.html'))).toEqual(f.authorBytes);
   await tasks2.close();
   await registry2.close();
  }finally{await host2.close();}
 }finally{
  release.resolve();
  await tasks.close().catch(()=>undefined);
  await registry.close().catch(()=>undefined);
  await f.host.close().catch(()=>undefined);
  await rm(f.root,{recursive:true,force:true}).catch(()=>undefined);
 }
},300000);

it('settles a user cancellation through the real processor instead of requeueing it',async()=>{
 const reached=deferred(),release=deferred();
 const live1=await live(async(point)=>{if(point==='before_prepare'){reached.resolve();await release.promise;}});
 const {f,registry,tasks,task}=live1;
 const jobId=task.job_id;
 try{
  tasks.start();
  await reached.promise;
  // The user asks for the cancellation while the real processor is still working.
  f.host.jobs.requestCancel(jobId);
  const closing=tasks.close();
  release.resolve();
  await closing;
  const settled=f.host.revisions.readJob(jobId)!;
  expect(settled.state).toBe('cancelled');
  expect(settled.lease_owner).toBeNull();
  expect(tasks.tasks.readPrepared(jobId,'owner')).toBeNull();
  expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
 }finally{
  release.resolve();
  await tasks.close().catch(()=>undefined);
  await registry.close().catch(()=>undefined);
  await f.host.close().catch(()=>undefined);
  await rm(f.root,{recursive:true,force:true}).catch(()=>undefined);
 }
},300000);
