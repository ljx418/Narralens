import {beforeAll,afterAll,it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm,readFile,writeFile,cp,readdir,symlink,unlink} from 'node:fs/promises';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NarralensHost} from '../../../src/host/server.js';
import {ProjectCatalog} from '../../../src/host/projects/project-catalog.js';
import {CreationApplication} from '../../../src/host/agent-driven/creation-application.js';
import {createTrustedCallerContext} from '../../../src/host/creative/trusted-context.js';
import {styleDigest} from '../../../src/host/creative/digest.js';
import type {LocalAssetInput,LocalAssetRegistryOptions} from '../../../src/host/agent-driven/local-asset-registry.js';
import type {IntakePut,Intake,Decision,JobReceipt} from '../../../src/contracts/agent-driven-types.js';
const vendorRoot='/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm';
let generated:string;
beforeAll(async()=>{
 generated=await mkdtemp(join(tmpdir(),'narralens-local-asset-diagnostics-'));
 execFileSync('ffmpeg',['-nostdin','-hide_banner','-v','error','-filter_threads','1','-f','lavfi','-i','color=c=blue:s=160x90:r=30:d=1','-threads','1','-c:v','libx264','-pix_fmt','yuv420p',join(generated,'video.mp4')],{stdio:'pipe',windowsHide:true,timeout:30000});
 execFileSync('ffmpeg',['-nostdin','-hide_banner','-v','error','-f','lavfi','-i','sine=frequency=400:sample_rate=48000:duration=1','-threads','1','-c:a','pcm_s16le',join(generated,'audio.wav')],{stdio:'pipe',windowsHide:true,timeout:30000});
},60000);
afterAll(async()=>{await rm(generated,{recursive:true,force:true});});
async function fixture(boundary?:LocalAssetRegistryOptions['boundary']){
 const root=await mkdtemp(join(tmpdir(),'narralens-local-asset-host-')),sourceRoot=join(root,'input'),storageRoot=join(root,'prepared-assets');await cp(generated,sourceRoot,{recursive:true});let app!:CreationApplication;
 const host=new NarralensHost({catalog:new ProjectCatalog(new Map()),dbPath:join(root,'host.sqlite'),snapshotsRoot:join(root,'snapshots'),adoptionStagingRoot:join(root,'stage'),migrationsRoot:join(root,'migrations'),derivedRoot:join(root,'derived'),openFilmVendorRoot:vendorRoot,agentApplication:instance=>app=new CreationApplication(instance,{createdRoot:join(root,'projects'),vendorRoot,worker:{pollMs:10},localAssets:{sourceRoot,storageRoot,...(boundary?{boundary}:{})}})});
 await host.listen(0);const owner=app.auth.issue({principal_id:'owner',channel:'authenticated',expires_at:Date.now()+300000}),human=app.auth.issue({principal_id:'owner',channel:'trusted_ui',expires_at:Date.now()+300000});
 const request=(path:string,body?:unknown,ui=false)=>fetch(host.origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:host.origin,...(ui?{Cookie:app.auth.cookieName+'='+human.token,'X-Narralens-CSRF':human.csrf!}:{Authorization:'Bearer '+owner.token}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const vectors=JSON.parse(readFileSync('docs/agent-driven-v1/cp-a0/contract-vectors.json','utf8')) as {vectors:{id:string;value:unknown}[]};const input=structuredClone(vectors.vectors.find(v=>v.id==='definition:IntakePut:valid')!.value) as IntakePut;
 input.intake_id=null;input.base_version=0;input.brief.local_asset_ids=[];input.brief.narration_asset_id=null;input.brief.content_brief.material_strategy.asset_ids=[];input.brief.content_brief.material_strategy.narration_asset_id=null;input.brief.content_brief.material_strategy.rights_refs=[];input.brief.content_brief.script_ref=null;input.brief.content_brief.style.style_digest=styleDigest(input.brief.content_brief.style);
 const saved=await request('/api/agent/v1/intakes',input);expect(saved.status).toBe(200);const intake=await saved.json() as Intake;
 const confirmed=await request('/api/agent/v1/intakes/'+intake.intake_id+'/decision',{meta:{idempotency_key:'confirm',correlation_id:'confirm'},intake_version:1,brief_sha256:intake.brief_sha256,choice:'confirm_brief'},true);expect(confirmed.status).toBe(200);const decision=await confirmed.json() as Decision;
 const created=await request('/api/agent/v1/projects',{meta:{idempotency_key:'create',correlation_id:'create'},intake_id:intake.intake_id,intake_version:1,decision_id:decision.decision_id});expect(created.status).toBe(202);let job=await created.json() as JobReceipt;
 const until=Date.now()+30000;while(Date.now()<until&&job.state!=='succeeded'){const response=await request('/api/agent/v1/projects/'+job.project_id+'/jobs/'+job.job_id);expect(response.status).toBe(200);job=await response.json() as JobReceipt;if(['failed','cancelled','attention'].includes(job.state))throw new Error('Creation failed');await new Promise(r=>setTimeout(r,10));}expect(job.state).toBe('succeeded');
 const project=job.project_id!,ui=createTrustedCallerContext({principal_id:'owner',channel:'trusted_ui',source:'trusted_ui',session_ref:'real-test-ui'}),driver=createTrustedCallerContext({principal_id:'owner',channel:'authenticated',source:'driver_relay',session_ref:'real-test-driver'}),foreign=createTrustedCallerContext({principal_id:'other',channel:'trusted_ui',source:'trusted_ui',session_ref:'foreign-test-ui'});
 const video:LocalAssetInput={project_id:project,idempotency_key:'video',relative_path:'video.mp4',expected_sha256:createHash('sha256').update(await readFile(join(sourceRoot,'video.mp4'))).digest('hex'),kind:'video',source:{kind:'generated',label:'Locally generated diagnostic color, not A footage'},license:{status:'cleared',label:'Test-owned diagnostic generation',commercial_use:true},recording_origin:null,attestation_ref:'diagnostic-fixture'};
 const audio:LocalAssetInput={...video,idempotency_key:'audio',relative_path:'audio.wav',expected_sha256:createHash('sha256').update(await readFile(join(sourceRoot,'audio.wav'))).digest('hex'),kind:'audio',recording_origin:'synthetic'};
 const registry=app.localAssets!;
 const count=()=>Number(host.revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM created_local_asset').get()?.n));
 return {root,sourceRoot,storageRoot,host,app,project,ui,driver,foreign,video,audio,registry,count,close:async()=>{await host.close();await rm(root,{recursive:true,force:true});}};
}
it('actually probes and fully decodes video and synthetic diagnostic audio into the same Host database without modifying native source',async()=>{
 const f=await fixture();try{
  const author=join(f.root,'projects',f.project,'source','film.html'),before=await readFile(author);
  const video=await f.registry.import(f.video,f.ui),audio=await f.registry.import(f.audio,f.ui);
  expect(video.asset_id.length).toBeLessThanOrEqual(64);expect(audio.rights_ref.length).toBeLessThanOrEqual(64);
  expect(video.media).toMatchObject({kind:'video',duration_frames:30,width:160,height:90});expect(audio.media).toMatchObject({kind:'audio',duration_frames:30,sample_rate:48000,channels:1});expect(audio.attestation.recording_origin).toBe('synthetic');
  expect(f.registry.list(f.project,f.driver)).toHaveLength(2);expect(f.count()).toBe(2);expect(JSON.stringify(video)).not.toContain(f.root);
  expect(await readFile(author)).toEqual(before);expect(f.host.revisions.activeCommit(f.project)?.revision).toBe(1);expect(await readdir(join(f.storageRoot,'staging'))).toEqual([]);
  const resolved=await f.registry.resolve(f.project,audio.asset_id,f.driver);expect(createHash('sha256').update(await readFile(resolved.absolute_path)).digest('hex')).toBe(f.audio.expected_sha256);
 }finally{await f.close();}
},120000);
it('requires real trusted UI provenance and ownership before reading files or recording rights',async()=>{
 const f=await fixture();try{
  await expect(f.registry.import(f.video,f.driver)).rejects.toMatchObject({code:'ORIGIN_REJECTED'});await expect(f.registry.import(f.video,f.foreign)).rejects.toMatchObject({code:'NOT_FOUND'});
  await expect(f.registry.import(f.video,{principal_id:'owner',channel:'trusted_ui',source:'trusted_ui',session_ref:'forged-body'} as never)).rejects.toMatchObject({code:'UNAUTHORIZED'});expect(f.count()).toBe(0);
 }finally{await f.close();}
},120000);
it('replays the original registration without reimporting changed input and refuses a conflicting key',async()=>{
 const f=await fixture();try{
  const asset=await f.registry.import(f.video,f.ui);await unlink(join(f.sourceRoot,'video.mp4'));
  expect(await f.registry.import(f.video,f.ui)).toEqual(asset);await expect(f.registry.import({...f.video,license:{...f.video.license,status:'unknown'}},f.ui)).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});expect(f.count()).toBe(1);
 }finally{await f.close();}
},120000);
it.each(['before_insert','after_insert','after_receipt','after_event'] as const)('rolls back row, command and outbox together at %s, preserving an unreferenced blob for a safe retry',async point=>{
 let enabled=true;const f=await fixture(at=>{if(enabled&&at===point)throw new Error('injected SQL boundary');});try{
  const before=f.host.revisions.outboxRowCount('asset.local.registered');await expect(f.registry.import(f.video,f.ui)).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
  expect(f.count()).toBe(0);expect(f.host.revisions.outboxRowCount('asset.local.registered')).toBe(before);expect(f.host.revisions.compose(db=>db.prepare("SELECT count(*) AS n FROM operation_idempotency WHERE operation_kind='agent.v1:local-asset.import'").get()?.n)).toBe(0);
  enabled=false;await f.registry.import(f.video,f.ui);expect(f.count()).toBe(1);expect(f.host.revisions.outboxRowCount('asset.local.registered')).toBe(before+1);
 }finally{await f.close();}
},120000);
it('checks real input hashes, paths and media rather than accepting metadata as proof',async()=>{
 const f=await fixture();try{
  await expect(f.registry.import({...f.video,relative_path:'../outside'},f.ui)).rejects.toMatchObject({code:'INVALID_REQUEST'});await expect(f.registry.import({...f.video,expected_sha256:'0'.repeat(64)},f.ui)).rejects.toMatchObject({code:'REVISION_CONFLICT'});
  const outside=join(f.root,'outside.mp4');await cp(join(f.sourceRoot,'video.mp4'),outside);await symlink(outside,join(f.sourceRoot,'alias.mp4'));
  await expect(f.registry.import({...f.video,relative_path:'alias.mp4'},f.ui)).rejects.toMatchObject({code:'INVALID_REQUEST'});
  await writeFile(join(f.sourceRoot,'bad.mp4'),'not media');await expect(f.registry.import({...f.video,relative_path:'bad.mp4',expected_sha256:createHash('sha256').update('not media').digest('hex')},f.ui)).rejects.toMatchObject({code:'INVALID_REQUEST'});
  expect(f.count()).toBe(0);expect(await readdir(join(f.storageRoot,'staging'))).toEqual([]);
 }finally{await f.close();}
},120000);
it('preserves unknown license and synthetic origin as facts rather than silently clearing them',async()=>{
 const f=await fixture();try{
  const result=await f.registry.import({...f.audio,license:{status:'unknown',commercial_use:false,label:'Not cleared'}},f.ui);expect(result.license).toEqual({status:'unknown',commercial_use:false,label:'Not cleared'});expect(result.attestation.recording_origin).toBe('synthetic');
 }finally{await f.close();}
},120000);
it('detects a published blob changed inside the final SQL boundary and commits no registration',async()=>{
 const f=await fixture(point=>{if(point==='after_event')writeFileSync(join(f.storageRoot,'objects',f.video.expected_sha256+'.mp4'),'tampered');});try{
  await expect(f.registry.import(f.video,f.ui)).rejects.toMatchObject({code:'REVISION_CONFLICT'});expect(f.count()).toBe(0);expect(f.host.revisions.outboxRowCount('asset.local.registered')).toBe(0);
 }finally{await f.close();}
},120000);
it('converges concurrent same-key imports to one immutable row, one command and one business event',async()=>{
 const f=await fixture();try{
  const results=await Promise.all([f.registry.import(f.video,f.ui),f.registry.import(f.video,f.ui)]);expect(results[0]).toEqual(results[1]);expect(f.count()).toBe(1);expect(f.host.revisions.outboxRowCount('asset.local.registered')).toBe(1);expect(await readdir(join(f.storageRoot,'staging'))).toEqual([]);
 }finally{await f.close();}
},120000);
