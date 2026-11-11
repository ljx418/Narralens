import {it,expect,vi} from 'vitest';
import {mkdir,readFile,writeFile,readdir,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createdProjectFixture,vendorRoot} from './helpers/created-project-fixture.js';
import {LocalAssetRegistry} from '../../../src/host/agent-driven/local-asset-registry.js';
import {ProductSqliteRepository} from '../../../src/host/agent-driven/product-sqlite-repository.js';
import {CreativeProjectAuthority} from '../../../src/host/agent-driven/creative-project-authority.js';
import {CreatedTaskStore,type CreatedTaskPorts, type TaskReservation} from '../../../src/host/agent-driven/created-task-store.js';
import {CreatedTaskGate} from '../../../src/host/agent-driven/created-task-gate.js';
import {PersistentJobStore} from '../../../src/host/persistent-job-store.js';
import {CreatedTaskWorker} from '../../../src/host/agent-driven/created-task-worker.js';
import {CreatedDraftTaskProcessor} from '../../../src/host/agent-driven/created-draft-processor.js';
import {PreparedDraftVerifier} from '../../../src/host/agent-driven/prepared-draft-verifier.js';
import {CreativeService} from '../../../src/host/creative/creative-service.js';
import {FixedWorkflowService} from '../../../src/host/creative/fixed-workflow-service.js';
import {creativeInputClosure} from '../../../src/host/creative/creative-closure.js';
import {canonicalDigest} from '../../../src/host/creative/digest.js';
import {createTrustedCallerContext} from '../../../src/host/creative/trusted-context.js';
import {TestAdoptionAuthority} from '../product/support/fixtures.js';
import type {TaskPrepare} from '../../../src/contracts/agent-driven-types.js';
import type {CompletedPreparedSourceV1,PreparedReadBindingV1,PreparedAdoptionBindingV1} from '../../../src/host/render/assembly-ports.js';
const openFault=vi.hoisted(()=>({path:'',remaining:0,hits:0}));
vi.mock('node:fs/promises',async importOriginal=>{const actual=await importOriginal<typeof import('node:fs/promises')>();return {...actual,open:async(path:Parameters<typeof actual.open>[0],...args:unknown[])=>{if(String(path)===openFault.path&&openFault.remaining>0){openFault.remaining--;openFault.hits++;throw Object.assign(Error('injected private domain open resource failure'),{code:'EMFILE'});}return (actual.open as (...args:unknown[])=>unknown)(path,...args);}};});
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
const meta=(id:string)=>({idempotency_key:id,correlation_id:id});
async function until(check:()=>boolean){const end=Date.now()+30000;while(!check()&&Date.now()<end)await new Promise(r=>setTimeout(r,20));expect(check()).toBe(true);}
/** Real local registration, source files, pinned parser/verifier, worker and original
 * durable workflow. Trusted confirmation/capability eligibility are TEST ports; not
 * production MCP/Run/approval/human voice, committed adoption or full A acceptance. */
async function fixture(boundary?:(point:string,task:TaskReservation,context:{host:Awaited<ReturnType<typeof createdProjectFixture>>['host'];root:string;grantId:string})=>Promise<void>){
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
it('autonomously prepares actual registered media into editable native source with matching immutable facts and no author commit',async()=>{
 const f=await fixture();try{
  f.worker.start();await until(()=>['succeeded','failed','attention','cancelled'].includes(f.host.revisions.readJob(f.task.job_id)!.state));
  expect(f.tasks.receipt(f.task.job_id,'owner')).toMatchObject({state:'succeeded',result_ref:null,next_actions:['review_prepared_source']});
  const fact=f.tasks.readPrepared(f.task.job_id,'owner')!;expect(fact).not.toBeNull();expect(f.tasks.preparedLeaseAttempt(f.task.job_id,'owner')).toBe(1);
  const root=join(f.taskRoot,f.task.stage_token,'attempt-1/source'),metadata=JSON.parse(await readFile(join(root,'prepared-native.json'),'utf8'));
  expect(metadata).toMatchObject({frame_count:90,clip_ids:['shot-s1','shot-s2','shot-s3','narration'],subtitle_timing_basis:'storyboard_plan'});expect(metadata.assets.find((a:{recording_origin:string})=>a.recording_origin==='synthetic')).toBeTruthy();
  for(const file of fact.files)expect(sha(await readFile(join(root,file.relative_path)))).toBe(file.sha256);
  const run=await f.repo.transaction(tx=>tx.get('run',{project_id:f.projectId,run_id:f.run.run_id}));expect(run?.checkpoint_json.attempts[0]).toMatchObject({state:'waiting_user',job_id:f.task.job_id});
  expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);expect(await readFile(join(f.authorRoot,'film.html'))).toEqual(f.authorBytes);
  const evidence=resolve('docs/parallel/lane-media/A-R1-20261111/evidence','draft-processor-real-'+Date.now());await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'observed.json'),JSON.stringify({scope:'real synthetic registered media + actual source-only processor; not production Run rights/MCP/human voice/adoption/Delivery',job:f.tasks.receipt(f.task.job_id,'owner'),fact,metadata,author_unchanged:true},null,2)+'\n');await cp(join(root,'film.html'),join(evidence,'film.html'));await cp(join(root,'assets/vo',metadata.assets.find((a:{media_type:string})=>a.media_type.startsWith('audio/')).path.split('/').at(-1)),join(evidence,'diagnostic.wav'));
 }finally{await f.close();}
},120000);
it('rechecks a revoked grant after asynchronous resolution and writes no stage or prepared fact',async()=>{
 const f=await fixture(async(point,_task,{host,grantId})=>{if(point==='before_prepare')host.revisions.compose(db=>db.prepare("UPDATE cp_a0_execution_grant SET state='revoked' WHERE grant_id=?").run(grantId));});try{
  f.worker.start();await until(()=>f.host.revisions.readJob(f.task.job_id)?.state==='failed');expect(f.tasks.readPrepared(f.task.job_id,'owner')).toBeNull();
  expect(await readdir(f.taskRoot).catch(e=>{if(e.code==='ENOENT')return[];throw e;})).toEqual([]);expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
 }finally{await f.close();}
},120000);
it('cancels after real preparation without publishing a prepared result or changing author state',async()=>{
 const f=await fixture(async(point,task,{host})=>{if(point==='after_prepare')host.jobs.requestCancel(task.job_id);});try{
  f.worker.start();await until(()=>f.host.revisions.readJob(f.task.job_id)?.state==='cancelled');expect(f.tasks.readPrepared(f.task.job_id,'owner')).toBeNull();expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
 }finally{await f.close();}
},120000);
it('reproves a durable complete source after lease loss instead of re-encoding or trusting an old in-memory proof',async()=>{
 let interrupted=false;
 const f=await fixture(async(point,task,{host})=>{if(point==='before_finish'&&!interrupted){interrupted=true;const job=host.revisions.readJob(task.job_id)!;if(!(host.jobs instanceof PersistentJobStore))throw Error('Real persistent jobs required');host.jobs.releaseLease(task.job_id,job.lease_owner!);throw Error('injected lost lease before final settlement');}});try{
  f.worker.start();await until(()=>['succeeded','failed','attention'].includes(f.host.revisions.readJob(f.task.job_id)!.state));expect(f.tasks.receipt(f.task.job_id,'owner')).toMatchObject({state:'succeeded',attempt:2});expect(f.tasks.preparedLeaseAttempt(f.task.job_id,'owner')).toBe(1);
  expect(await readdir(join(f.taskRoot,f.task.stage_token))).toEqual(['attempt-1']);expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
 }finally{await f.close();}
},120000);

it('recovers a real asynchronous domain-open resource failure in the same processor and closes its descriptors',async()=>{
 const f=await fixture();try{
  openFault.path=f.taskRoot;openFault.remaining=1;openFault.hits=0;f.worker.start();
  await until(()=>['succeeded','failed','attention'].includes(f.host.revisions.readJob(f.task.job_id)!.state));
  expect(f.tasks.receipt(f.task.job_id,'owner')).toMatchObject({state:'succeeded',attempt:2});expect(openFault.hits).toBe(1);expect(f.tasks.preparedLeaseAttempt(f.task.job_id,'owner')).toBe(2);
 }finally{openFault.path='';openFault.remaining=0;await f.close();}
 const {readlink}=await import('node:fs/promises');const targets=await Promise.all((await readdir('/proc/self/fd')).map(fd=>readlink('/proc/self/fd/'+fd).catch(()=>'')));expect(targets.filter(path=>path.startsWith(f.root))).toEqual([]);
},120000);

/* ---- CR-R1-001 section 5: the completed SOURCE_ONLY source and its two proofs. The
 * job has succeeded and its lease is gone, so nothing here may claim it again. ---- */
type Fixture=Awaited<ReturnType<typeof fixture>>;
function completedSource(f:Fixture):CompletedPreparedSourceV1{
 const task=f.tasks.read(f.task.job_id,'owner'),fact=f.tasks.readPrepared(f.task.job_id,'owner'),attempt=f.tasks.preparedLeaseAttempt(f.task.job_id,'owner');
 const row=f.host.revisions.compose(db=>db.prepare('SELECT terminal_reason,provider_receipt_json FROM job WHERE job_id=?').get(f.task.job_id)) as {terminal_reason:string;provider_receipt_json:string}|undefined;
 if(!row||!fact||attempt===null)throw Error('The completed preparation is missing');
 const provider=JSON.parse(row.provider_receipt_json) as {kind:string;source_digest:string;stage:string};
 return {format:'narralens.completed-prepared-source@1',project_id:f.projectId,task,producer_attempt:attempt,job:f.tasks.receipt(f.task.job_id,'owner'),
  terminal_reason:row.terminal_reason as 'SOURCE_ONLY',
  provider_receipt:{kind:provider.kind as 'local.native-draft@1',source_digest:provider.source_digest,stage:provider.stage as 'SOURCE_ONLY'},
  fact,root:join(f.taskRoot,task.stage_token,'attempt-'+attempt,'source')};
}
function readBinding(completed:CompletedPreparedSourceV1,purpose:'impact'|'preview'):PreparedReadBindingV1{
 const execution=completed.task.request.execution;
 return {purpose,project_id:completed.project_id,run_id:execution.run_id,execution,
  prepared_source_id:'prepared_'+completed.fact.source_digest.slice(0,24),prepared_job_id:completed.task.job_id,
  fact_digest:canonicalDigest(completed.fact),base_revision:completed.task.request.base_revision,
  control_revision:0,source_digest:completed.fact.source_digest,selection_version:0};
}
function adoptionBinding(completed:CompletedPreparedSourceV1):PreparedAdoptionBindingV1{
 return {...readBinding(completed,'preview'),purpose:'adoption',transaction_id:'txn_'+'1'.repeat(32),impact_id:'imp_'+'2'.repeat(32),
  impact_hash:'3'.repeat(64),plan_sha256:'4'.repeat(64),approval_id:'apr_'+'5'.repeat(32),target_snapshot_id:'snap_'+'6'.repeat(32)};
}
function registryFacts(f:Fixture){return f.registry!.list(f.projectId,createTrustedCallerContext({principal_id:'owner',channel:'authenticated',source:'driver_relay',session_ref:f.task.job_id}));}

it('re-proves a succeeded SOURCE_ONLY source without a live lease and keeps the read proof away from the adoption assertion',async()=>{
 const f=await fixture();try{
  f.worker.start();await until(()=>['succeeded','failed','attention','cancelled'].includes(f.host.revisions.readJob(f.task.job_id)!.state));
  expect(f.tasks.receipt(f.task.job_id,'owner').state).toBe('succeeded');
  const completed=completedSource(f);
  expect(completed.terminal_reason).toBe('SOURCE_ONLY');
  expect(completed.provider_receipt).toMatchObject({kind:'local.native-draft@1',stage:'SOURCE_ONLY'});
  expect(completed.provider_receipt.source_digest).toBe(completed.fact.source_digest);
  expect(completed.producer_attempt).toBe(1);
  const assets=registryFacts(f);expect(assets.length).toBe(2);
  const binding=readBinding(completed,'preview'),adoption=adoptionBinding(completed);
  const proof=await f.verifier.proveForRead(completed,binding,assets);
  expect(()=>f.verifier.assertCurrentForRead(completed,binding,proof,()=>{})).not.toThrow();
  // A read proof is never an adoption proof, and another binding is not this binding.
  expect(()=>f.verifier.assertCurrentForAdoption(completed,adoption,proof as never,()=>{})).toThrow();
  expect(()=>f.verifier.assertCurrentForRead(completed,{...binding,base_revision:binding.base_revision+1},proof,()=>{})).toThrow();
  expect(()=>f.verifier.assertCurrentForRead(completed,{...binding,source_digest:'0'.repeat(64)},proof,()=>{})).toThrow();
  // A JSON fact is not a proof.
  expect(()=>f.verifier.assertCurrentForRead(completed,binding,JSON.parse(JSON.stringify(completed)) as never,()=>{})).toThrow();
  // The final check is synchronous: an asynchronous callback is refused.
  expect(()=>f.verifier.assertCurrentForRead(completed,binding,proof,(()=>Promise.resolve()) as never)).toThrow();
  // The current author and rights are re-checked by the Host, and their refusal stops the assertion.
  expect(()=>f.verifier.assertCurrentForRead(completed,binding,proof,()=>{throw new Error('the current author changed');})).toThrow();
  const adoptionProof=await f.verifier.proveForAdoption(completed,adoption,assets);
  expect(()=>f.verifier.assertCurrentForAdoption(completed,adoption,adoptionProof,()=>{})).not.toThrow();
  expect(()=>f.verifier.assertCurrentForRead(completed,binding,adoptionProof as never,()=>{})).toThrow();
  expect(()=>f.verifier.assertCurrentForAdoption(completed,{...adoption,transaction_id:'txn_'+'9'.repeat(32)},adoptionProof,()=>{})).toThrow();
  f.verifier.release(proof);f.verifier.release(adoptionProof);
  // A released proof is gone.
  expect(()=>f.verifier.assertCurrentForRead(completed,binding,proof,()=>{})).toThrow();
 }finally{await f.close();}
 const {readlink}=await import('node:fs/promises');
 const targets=await Promise.all((await readdir('/proc/self/fd')).map(fd=>readlink('/proc/self/fd/'+fd).catch(()=>'')));
 expect(targets.filter(path=>path.startsWith(f.root))).toEqual([]);
},120000);

it('refuses a read proof of prepared bytes that changed under the same size and closes its descriptors',async()=>{
 const f=await fixture();try{
  f.worker.start();await until(()=>['succeeded','failed','attention','cancelled'].includes(f.host.revisions.readJob(f.task.job_id)!.state));
  const completed=completedSource(f),file=completed.fact.files.find(entry=>entry.relative_path==='film.html');
  if(!file)throw Error('The prepared film is missing');
  const path=join(completed.root,file.relative_path),original=await readFile(path),tampered=Buffer.from(original);
  tampered[0]=tampered[0]===0x3c?0x3e:0x3c;expect(tampered.length).toBe(original.length);
  await writeFile(path,tampered);
  const binding=readBinding(completed,'preview');
  await expect(f.verifier.proveForRead(completed,binding,registryFacts(f))).rejects.toMatchObject({code:'REVISION_CONFLICT'});
  expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
 }finally{await f.close();}
 const {readlink}=await import('node:fs/promises');
 const targets=await Promise.all((await readdir('/proc/self/fd')).map(fd=>readlink('/proc/self/fd/'+fd).catch(()=>'')));
 expect(targets.filter(path=>path.startsWith(f.root))).toEqual([]);
},120000);
