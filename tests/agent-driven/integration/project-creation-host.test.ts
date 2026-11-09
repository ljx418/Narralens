import {it,expect} from 'vitest';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {PersistentJobStore} from '../../../src/host/persistent-job-store.js';
import {NarralensHost} from '../../../src/host/server.js';
import {ProjectCatalog} from '../../../src/host/projects/project-catalog.js';
import {CreationApplication} from '../../../src/host/agent-driven/creation-application.js';
import {styleDigest} from '../../../src/host/creative/digest.js';
import type {IntakePut,Intake,Decision,JobReceipt,CreateProject} from '../../../src/contracts/agent-driven-types.js';
import type {CreationServiceDeps} from '../../../src/host/projects/project-creation-service.js';

const vendorRoot='/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm';
async function fixture(root:string,worker?:Pick<CreationServiceDeps,'boundary'|'pollMs'>){
 let app!:CreationApplication;
 const host=new NarralensHost({catalog:new ProjectCatalog(new Map()),leaseReapIntervalMs:10,dbPath:join(root,'host.sqlite'),snapshotsRoot:join(root,'snapshots'),adoptionStagingRoot:join(root,'stage'),migrationsRoot:join(root,'migrations'),derivedRoot:join(root,'derived'),openFilmVendorRoot:vendorRoot,
  agentApplication:instance=>app=new CreationApplication(instance,{createdRoot:join(root,'projects'),vendorRoot,worker:{pollMs:10,...worker}})});
 await host.listen(0);
 const driver=app.auth.issue({principal_id:'owner',channel:'authenticated',expires_at:Date.now()+300000});
 const human=app.auth.issue({principal_id:'owner',channel:'trusted_ui',expires_at:Date.now()+300000});
 const request=async(path:string,body?:unknown,ui=false)=>fetch(host.origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:host.origin,...(ui?{Cookie:app.auth.cookieName+'='+human.token,'X-Narralens-CSRF':human.csrf!}:{Authorization:'Bearer '+driver.token}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const prepare=async()=>{
  const vectors=JSON.parse(readFileSync('docs/agent-driven-v1/cp-a0/contract-vectors.json','utf8')) as {vectors:{id:string;value:unknown}[]};
  const intake=structuredClone(vectors.vectors.find(v=>v.id==='definition:IntakePut:valid')!.value) as IntakePut;
  intake.intake_id=null;intake.base_version=0;intake.brief.narration_asset_id=null;intake.brief.content_brief.material_strategy.narration_asset_id=null;intake.brief.content_brief.script_ref=null;intake.brief.content_brief.style.style_digest=styleDigest(intake.brief.content_brief.style);
  const savedResponse=await request('/api/agent/v1/intakes',intake);expect(savedResponse.status).toBe(200);const saved=await savedResponse.json() as Intake;
  const decisionResponse=await request('/api/agent/v1/intakes/'+saved.intake_id+'/decision',{meta:{idempotency_key:'confirm',correlation_id:'confirm'},intake_version:saved.version,brief_sha256:saved.brief_sha256,choice:'confirm_brief'},true);expect(decisionResponse.status).toBe(200);const decision=await decisionResponse.json() as Decision;
  return {meta:{idempotency_key:'create',correlation_id:'create'},intake_id:saved.intake_id,intake_version:saved.version,decision_id:decision.decision_id} satisfies CreateProject;
 };
 const poll=async(receipt:JobReceipt)=>{
  const until=Date.now()+30000;let current=receipt;
  while(Date.now()<until){const response=await request('/api/agent/v1/projects/'+receipt.project_id+'/jobs/'+receipt.job_id);expect(response.status).toBe(200);current=await response.json() as JobReceipt;if(['succeeded','failed','attention','cancelled'].includes(current.state))return current;await new Promise(r=>setTimeout(r,25));}
  throw new Error('Creation did not converge: '+JSON.stringify({receipt:current,failures:app.worker.failures}));
 };
 return {host,app,request,prepare,poll};
}
it('creates through HTTP and Host scheduling only; reopens native source without migration or manual registration',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-create-http-'));let current:Awaited<ReturnType<typeof fixture>>|undefined;
 try{
  current=await fixture(root);const input=await current.prepare();
  const acceptedResponse=await current.request('/api/agent/v1/projects',input);expect(acceptedResponse.status).toBe(202);const accepted=await acceptedResponse.json() as JobReceipt;
  expect(accepted.state).toBe('queued');const done=await current.poll(accepted);expect(done.state,JSON.stringify(current.app.worker.failures)).toBe('succeeded');
  expect(done.bootstrap).toMatchObject({origin:'created',project_revision:1,control_revision:0,native_state:'unconfirmed',native_ack:null});
  const result=done.bootstrap!;
  expect(current.host.revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM migration').get()?.n)).toBe(0);
  const view=await current.host.projectResolver.resolveNative(result.project_id);expect(view.kind).toBe('created');
  const before=await readFile(join(root,'projects',result.project_id,'source','film.html'),'utf8');expect(before).toContain('data-track="picture"');expect(before).toContain('data-track="narration"');
  await current.host.close();current=undefined;
  current=await fixture(root);const reopened=await current.poll(accepted);expect(reopened.bootstrap).toEqual(done.bootstrap);
  expect((await current.host.projectResolver.resolveNative(result.project_id)).kind).toBe('created');
  const native=await current.host.projectResolver.resolveNative(result.project_id);await current.host.projections.layoutFor(native);
  const projection=await current.host.engines.resolve(result.project_id).port.inspect({project_id:result.project_id,engine:'openfilm',source_digest:native.source_digest},{projectId:result.project_id,correlationId:'reopen',signal:AbortSignal.timeout(10000)});expect(projection.problems).toEqual([]);
  const replay=await current.request('/api/agent/v1/projects',input);expect(replay.status).toBe(202);expect(await replay.json()).toEqual(accepted);
  expect(current.host.revisions.activeCommit(result.project_id)?.revision).toBe(1);
 }finally{await current?.host.close();await rm(root,{recursive:true,force:true});}
},120000);
it('refuses unknown fields and driver-minted confirmation before creating any Job',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-create-reject-'));const f=await fixture(root);
 try{const input=await f.prepare();const bad=await f.request('/api/agent/v1/projects',{...input,actor:'human'});expect(bad.status).toBe(400);const missing=await f.request('/api/agent/v1/projects',{...input,decision_id:'invented'});expect(missing.status).toBe(428);expect(f.host.revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM job').get()?.n)).toBe(0);}
 finally{await f.host.close();await rm(root,{recursive:true,force:true});}
},120000);
it('rejects modified initial source before committing a pointer or origin',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-create-drift-'));
 const f=await fixture(root,{boundary:async(point,reservation)=>{if(point==='after_source')await writeFile(join(root,'projects',reservation.project_id,'source','film.html'),'external change');}});
 try{const response=await f.request('/api/agent/v1/projects',await f.prepare());expect(response.status).toBe(202);const accepted=await response.json() as JobReceipt;const done=await f.poll(accepted);expect(done.state).toBe('failed');expect(done.bootstrap).toBeNull();expect(f.host.revisions.activeCommit(accepted.project_id!)).toBeUndefined();expect(f.app.creation.origin(accepted.project_id!)).toBeNull();}
 finally{await f.host.close();await rm(root,{recursive:true,force:true});}
},120000);

it('quiesces an interrupted creation before closing SQLite, then resumes the same durable Job on reopen',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-create-stop-'));
 let entered!:()=>void,release!:()=>void;
 const reached=new Promise<void>(r=>{entered=r;}), gate=new Promise<void>(r=>{release=r;});
 let current:Awaited<ReturnType<typeof fixture>>|undefined;
 try{
  current=await fixture(root,{boundary:async point=>{if(point==='after_source'){entered();await gate;}}});
  const response=await current.request('/api/agent/v1/projects',await current.prepare());expect(response.status).toBe(202);const accepted=await response.json() as JobReceipt;
  await reached;
  const closing=current.host.close();release();await closing;current=undefined;
  current=await fixture(root);const done=await current.poll(accepted);expect(done.state,JSON.stringify(current.app.worker.failures)).toBe('succeeded');
  expect(done.job_id).toBe(accepted.job_id);expect(done.project_id).toBe(accepted.project_id);expect(done.attempt).toBe(2);
  expect(current.host.revisions.activeCommit(accepted.project_id!)?.revision).toBe(1);
  expect(current.host.revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM cp_a0_bootstrap_command').get()?.n)).toBe(1);
 }finally{release?.();await current?.host.close();await rm(root,{recursive:true,force:true});}
},120000);

it('settles owner cancellation without publishing or wedging a subsequent Host start',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-create-cancel-'));let current:Awaited<ReturnType<typeof fixture>>|undefined;
 try{
  current=await fixture(root,{boundary:(point,reservation)=>{if(point==='after_source')new PersistentJobStore(current!.host.revisions).requestCancel(reservation.job_id);}});
  const response=await current.request('/api/agent/v1/projects',await current.prepare());expect(response.status).toBe(202);const accepted=await response.json() as JobReceipt;
  const done=await current.poll(accepted);expect(done.state).toBe('cancelled');expect(current.host.revisions.activeCommit(accepted.project_id!)).toBeUndefined();
  await current.host.close();current=undefined;current=await fixture(root);expect((await current.poll(accepted)).state).toBe('cancelled');
 }finally{await current?.host.close();await rm(root,{recursive:true,force:true});}
},120000);
it.each(['after_lease','after_project_directory','after_owner_claim','after_source','after_snapshot','before_commit','after_commit','cancel_after_source'])('survives actual SIGKILL at %s and decides its own journal before generic recovery',async point=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-create-kill-'));let current:Awaited<ReturnType<typeof fixture>>|undefined;
 try{
  const loader=createRequire(import.meta.url).resolve('tsx/esm');
  const child=spawn(process.execPath,['--import',loader,resolve('tests/agent-driven/integration/helpers/creation-crash-child.ts'),root,point],{stdio:['ignore','ignore','pipe']});
  let stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-2000);});
  const exit=await new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  expect(exit,stderr).toEqual({code:null,signal:'SIGKILL'});
  const marker=JSON.parse(await readFile(join(root,'crash-marker.json'),'utf8')) as {boundary:string;accepted:JobReceipt;transaction_id:string};expect(marker.boundary).toBe(point);
  // Let the killed process's real 1-second lease expire; no fake clock or thrown-error crash.
  await new Promise(r=>setTimeout(r,1100));
  current=await fixture(root);const done=await current.poll(marker.accepted);
  if(point==='after_project_directory'){
   expect(done.state).toBe('failed');expect(done.bootstrap).toBeNull();expect(current.app.creation.origin(done.project_id!)).toBeNull();expect(current.host.revisions.activeCommit(done.project_id!)).toBeUndefined();expect(current.host.revisions.projectTransaction(marker.transaction_id)?.state).toBe('aborted');
  }else if(point==='cancel_after_source'){
   expect(done.state).toBe('cancelled');expect(current.host.revisions.activeCommit(done.project_id!)).toBeUndefined();expect(current.host.revisions.projectTransaction(marker.transaction_id)?.state).toBe('aborted');
  }else{
   expect(done.state,JSON.stringify(current.app.worker.failures)).toBe('succeeded');expect(done.project_id).toBe(marker.accepted.project_id);expect(current.host.revisions.activeCommit(done.project_id!)?.revision).toBe(1);expect(current.host.revisions.projectTransaction(marker.transaction_id)?.state).toBe('committed');
  }
 }finally{await current?.host.close();await rm(root,{recursive:true,force:true});}
},120000);

it('lets the dedicated owner settle expired cancellation while the real global reaper is ticking',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-create-reaper-'));let current:Awaited<ReturnType<typeof fixture>>|undefined;
 try{
  current=await fixture(root,{boundary:async(point,reservation)=>{if(point==='after_source'){
   new PersistentJobStore(current!.host.revisions).requestCancel(reservation.job_id);
   current!.host.revisions.compose(db=>db.prepare('UPDATE job SET lease_expires_at=? WHERE job_id=?').run(Date.now()-1,reservation.job_id));
   await new Promise(r=>setTimeout(r,70));
  }}});
  const response=await current.request('/api/agent/v1/projects',await current.prepare());expect(response.status).toBe(202);const accepted=await response.json() as JobReceipt;
  const done=await current.poll(accepted);expect(done.state).toBe('cancelled');expect(current.app.creation.pending()).toEqual([]);
  expect(current.host.revisions.compose(db=>db.prepare('SELECT attention FROM project_state WHERE project_id=?').get(accepted.project_id!)?.attention)).toBe(0);
  await current.host.close();current=undefined;current=await fixture(root);expect((await current.poll(accepted)).state).toBe('cancelled');
 }finally{await current?.host.close();await rm(root,{recursive:true,force:true});}
},120000);
