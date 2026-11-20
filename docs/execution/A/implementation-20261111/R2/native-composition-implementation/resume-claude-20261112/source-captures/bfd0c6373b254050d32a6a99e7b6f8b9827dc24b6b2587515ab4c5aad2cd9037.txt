import {it,expect} from 'vitest';
import {mkdtemp,rm,readFile,writeFile,rename,symlink,unlink} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NarralensHost} from '../../../src/host/server.js';
import {ProjectCatalog} from '../../../src/host/projects/project-catalog.js';
import {CreationApplication} from '../../../src/host/agent-driven/creation-application.js';
import {OpenFilmEngineAdapter} from '../../../src/adapters/openfilm/openfilm-engine-adapter.js';
import {createPinnedOpenFilmUpstream} from '../../../src/adapters/openfilm/openfilm-upstream.js';
import {CommittedSnapshotAuthority} from '../../../src/host/agent-driven/committed-snapshot-authority.js';
import {styleDigest} from '../../../src/host/creative/digest.js';
import type {IntakePut,Intake,Decision,JobReceipt} from '../../../src/contracts/agent-driven-types.js';
const vendorRoot='/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm';
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'narralens-committed-read-'));let app!:CreationApplication;
 const host=new NarralensHost({catalog:new ProjectCatalog(new Map()),dbPath:join(root,'host.sqlite'),snapshotsRoot:join(root,'snapshots'),adoptionStagingRoot:join(root,'stage'),migrationsRoot:join(root,'migrations'),derivedRoot:join(root,'derived'),openFilmVendorRoot:vendorRoot,agentApplication:instance=>app=new CreationApplication(instance,{createdRoot:join(root,'projects'),vendorRoot,worker:{pollMs:10}})});
 await host.listen(0);
 const owner=app.auth.issue({principal_id:'owner',channel:'authenticated',expires_at:Date.now()+300000}),human=app.auth.issue({principal_id:'owner',channel:'trusted_ui',expires_at:Date.now()+300000});
 const request=(path:string,body?:unknown,ui=false)=>fetch(host.origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:host.origin,...(ui?{Cookie:app.auth.cookieName+'='+human.token,'X-Narralens-CSRF':human.csrf!}:{Authorization:'Bearer '+owner.token}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const vectors=JSON.parse(readFileSync('docs/agent-driven-v1/cp-a0/contract-vectors.json','utf8')) as {vectors:{id:string;value:unknown}[]};
 const input=structuredClone(vectors.vectors.find(v=>v.id==='definition:IntakePut:valid')!.value) as IntakePut;
 input.intake_id=null;input.base_version=0;input.brief.local_asset_ids=[];input.brief.narration_asset_id=null;input.brief.content_brief.material_strategy.asset_ids=[];input.brief.content_brief.material_strategy.narration_asset_id=null;input.brief.content_brief.material_strategy.rights_refs=[];input.brief.content_brief.script_ref=null;input.brief.content_brief.style.style_digest=styleDigest(input.brief.content_brief.style);
 const intakeResponse=await request('/api/agent/v1/intakes',input);expect(intakeResponse.status).toBe(200);const intake=await intakeResponse.json() as Intake;
 const confirm=await request('/api/agent/v1/intakes/'+intake.intake_id+'/decision',{meta:{idempotency_key:'confirm',correlation_id:'confirm'},intake_version:1,brief_sha256:intake.brief_sha256,choice:'confirm_brief'},true);expect(confirm.status).toBe(200);const decision=await confirm.json() as Decision;
 const created=await request('/api/agent/v1/projects',{meta:{idempotency_key:'create',correlation_id:'create'},intake_id:intake.intake_id,intake_version:1,decision_id:decision.decision_id});expect(created.status).toBe(202);let job=await created.json() as JobReceipt;
 const until=Date.now()+30000;while(Date.now()<until&&job.state!=='succeeded'){const response=await request('/api/agent/v1/projects/'+job.project_id+'/jobs/'+job.job_id);expect(response.status).toBe(200);job=await response.json() as JobReceipt;if(['failed','attention','cancelled'].includes(job.state))throw new Error('Actual creator failed');await new Promise(r=>setTimeout(r,10));}
 expect(job.state).toBe('succeeded');const bootstrap=job.bootstrap!,reservation=app.creation.forProject(bootstrap.project_id)!;
 const reader=()=>app.committedSnapshots.readerForTransaction(bootstrap.project_id,reservation.transaction_id,'owner');
 const read={project_id:bootstrap.project_id,snapshot_id:bootstrap.initial_snapshot_id,source_digest:bootstrap.source_digest};
 const snapshotRoot=host.snapshots.snapshotRoot(read.project_id,read.snapshot_id),source=join(snapshotRoot,'source');
 return {root,host,app,bootstrap,reservation,read,reader,snapshotRoot,source,close:async()=>{await host.close();await rm(root,{recursive:true,force:true});}};
}
it('uses a real committed Host transaction and pinned native parser for its immutable snapshot, never claims a draft is a film',async()=>{
 const f=await fixture();try{
  const closure=await f.reader().readSnapshot(f.read);
  expect(closure).toMatchObject({...f.read,project_revision:1,expected_frames:0,expected_duration_seconds:0,native_root:f.source,native_entry:'film.html',rights:[]});
  expect(closure.entries).toHaveLength(1);expect(closure.entries[0]).toMatchObject({relative_path:'film.html',kind:'native_source',rights_ref:null});
  expect(f.host.revisions.activeCommit(f.read.project_id)?.revision).toBe(1);
 }finally{await f.close();}
},120000);
it('continues to read the committed snapshot after the live author source drifts',async()=>{
 const f=await fixture();try{
  const reader=f.reader(),before=await reader.readSnapshot(f.read);
  await writeFile(join(f.root,'projects',f.read.project_id,'source','film.html'),'not the committed movie');
  expect(await reader.readSnapshot(f.read)).toEqual(before);
 }finally{await f.close();}
},120000);
it('refuses another principal, another transaction, another snapshot and a false expected digest',async()=>{
 const f=await fixture();try{
  expect(()=>f.app.committedSnapshots.readerForTransaction(f.read.project_id,f.reservation.transaction_id,'other')).toThrow(/owned committed/);
  expect(()=>f.app.committedSnapshots.readerForTransaction(f.read.project_id,'unknown-transaction','owner')).toThrow(/owned committed/);
  const reader=f.reader();await expect(reader.readSnapshot({...f.read,project_id:'foreign-project'})).rejects.toMatchObject({code:'NOT_FOUND'});
  await expect(reader.readSnapshot({...f.read,snapshot_id:'a'.repeat(64)})).rejects.toMatchObject({code:'NOT_FOUND'});
  await expect(reader.readSnapshot({...f.read,source_digest:'b'.repeat(64)})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
 }finally{await f.close();}
},120000);
it('rechecks the committed transaction on every read rather than trusting a once-created reader',async()=>{
 const f=await fixture();try{
  const reader=f.reader();
  // Deliberate authority-store corruption injection, not an actual approved project edit.
  f.host.revisions.compose(db=>db.prepare("UPDATE project_transaction SET state='prepared' WHERE transaction_id=?").run(f.reservation.transaction_id));
  await expect(reader.readSnapshot(f.read)).rejects.toMatchObject({code:'NOT_FOUND'});
 }finally{await f.close();}
},120000);
it('rejects mutated immutable bytes even while the database digest stays unchanged',async()=>{
 const f=await fixture();try{
  const path=join(f.source,'film.html'),bytes=await readFile(path);await writeFile(path,Buffer.concat([bytes,Buffer.from('\n<!-- unauthorized -->')]));
  await expect(f.reader().readSnapshot(f.read)).rejects.toMatchObject({code:'REVISION_CONFLICT'});
 }finally{await f.close();}
},120000);
it('refuses a snapshot source symlink to identical bytes outside its own snapshot directory',async()=>{
 const f=await fixture();try{
  const outside=join(f.root,'outside');await rename(f.source,outside);await symlink(outside,f.source,'dir');
  await expect(f.reader().readSnapshot(f.read)).rejects.toMatchObject({code:'REVISION_CONFLICT'});
 }finally{await f.close();}
},120000);
it('refuses a FIFO substituted for a snapshot entry without occupying the request forever',async()=>{
 const f=await fixture();let timedOut=false;const path=join(f.source,'film.html');
 try{
  await unlink(path);expect(spawnSync('mkfifo',['-m','600',path],{stdio:'ignore'}).status).toBe(0);
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([f.reader().readSnapshot(f.read).then(()=>{throw new Error('Unexpected successful FIFO read');},error=>{expect(error).toMatchObject({code:'CAPABILITY_UNAVAILABLE'});expect(String(error.message)).not.toContain(f.root);}),new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;reject(new Error('Snapshot reader hung on FIFO'));},3000);})]);}finally{clearTimeout(timer);}
 }finally{if(timedOut)await writeFile(path,'release diagnostic blocked reader');await f.close();}
},30000);

it('reports unavailable snapshot paths without leaking absolute server paths or latching a read failure',async()=>{
 const f=await fixture();const backup=join(f.snapshotRoot,'source-backup');
 try{
  const reader=f.reader();await rename(f.source,backup);
  await expect(reader.readSnapshot(f.read)).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE',message:'Committed snapshot verification is unavailable'});
  await rename(backup,f.source);expect((await reader.readSnapshot(f.read)).snapshot_id).toBe(f.read.snapshot_id);
 }finally{await f.close();}
},120000);
it('retries a failed pinned upstream initialization instead of caching unavailable forever',async()=>{
 const f=await fixture();try{
  const mount=join(f.root,'temporarily-unavailable-vendor');
  const authority=new CommittedSnapshotAuthority(f.host.revisions,f.host.snapshots,f.app.creation,mount);
  const reader=authority.readerForTransaction(f.read.project_id,f.reservation.transaction_id,'owner');
  await expect(reader.readSnapshot(f.read)).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
  await symlink(vendorRoot,mount,'dir');
  expect((await reader.readSnapshot(f.read)).project_revision).toBe(1);
 }finally{await f.close();}
},120000);

it('refuses a FIFO installed after the digest but immediately before the actual pinned parser reads the film',async()=>{
 const f=await fixture();let timedOut=false;const path=join(f.source,'film.html');let reading:Promise<unknown>|undefined;
 try{
  const pinned=await createPinnedOpenFilmUpstream(vendorRoot);let hits=0;
  const adapter=new OpenFilmEngineAdapter({...pinned,readProjectFilm:async root=>{hits++;await unlink(path);expect(spawnSync('mkfifo',['-m','600',path],{stdio:'ignore'}).status).toBe(0);return pinned.readProjectFilm(root);}});
  reading=adapter.inspectSnapshot({root:f.source,roots:['film.html']},f.read.source_digest,{projectId:f.read.project_id,correlationId:'parser-boundary-fault',signal:AbortSignal.timeout(20000)});
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([reading.then(()=>{throw new Error('FIFO was accepted');},error=>{expect(error).toMatchObject({code:'ENGINE_UNAVAILABLE'});}),new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;reject(new Error('The pinned parser blocked after digest verification'));},3000);})]);}finally{clearTimeout(timer);}
  expect(hits).toBe(1);expect(timedOut).toBe(false);
 }finally{if(timedOut){await writeFile(path,'release old diagnostic parser');await reading?.catch(()=>undefined);}await f.close();}
},30000);

it('refuses changed film bytes between digest and pinned parsing even when its editable document is equivalent',async()=>{
 const f=await fixture();try{
  const pinned=await createPinnedOpenFilmUpstream(vendorRoot);
  const path=join(f.source,'film.html'),original=await readFile(path,'utf8');
  const adapter=new OpenFilmEngineAdapter({...pinned,readProjectFilm:async root=>{await writeFile(path,original+'\n<!-- parser-boundary drift -->');return pinned.readProjectFilm(root);}});
  await expect(adapter.inspectSnapshot({root:f.source,roots:['film.html']},f.read.source_digest,{projectId:f.read.project_id,correlationId:'parser-drift',signal:AbortSignal.timeout(20000)})).rejects.toMatchObject({status:409,code:'SOURCE_CHANGED'});
 }finally{await f.close();}
},120000);
