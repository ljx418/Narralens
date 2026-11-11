import {it,expect,beforeAll,afterAll} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm,mkdir,readFile,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {NarralensHost} from '../../../src/host/server.js';
import {ProjectCatalog} from '../../../src/host/projects/project-catalog.js';
import {CreationApplication} from '../../../src/host/agent-driven/creation-application.js';
import {styleDigest} from '../../../src/host/creative/digest.js';
import type {IntakePut,Intake,Decision,JobReceipt} from '../../../src/contracts/agent-driven-types.js';

const vendorRoot='/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm';
let media='';
beforeAll(async()=>{
 media=await mkdtemp(join(tmpdir(),'narralens-transport-media-'));
 const ff=(args:string[])=>execFileSync('ffmpeg',['-nostdin','-hide_banner','-v','error',...args],{windowsHide:true,timeout:60000});
 ff(['-f','lavfi','-i','color=c=0x185a88:s=320x180:r=30:d=3','-threads','1','-c:v','libx264','-pix_fmt','yuv420p',join(media,'video.mp4')]);
 ff(['-f','lavfi','-i','sine=frequency=430:sample_rate=48000:duration=3','-threads','1','-c:a','pcm_s16le',join(media,'voice.wav')]);
},180000);
afterAll(async()=>{await rm(media,{recursive:true,force:true});});

/**
 * The adjunct local-material transport over the REAL Host.
 *
 * The project is real, the local material is real and the media probe is real. The
 * transport adds no second registry: the Host's own registry, rows and command ledger
 * are the only state.
 */
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'narralens-local-transport-'));
 const sourceRoot=join(root,'input'),storageRoot=join(root,'prepared-assets');
 await mkdir(sourceRoot,{mode:0o700});
 await copyFile(join(media,'video.mp4'),join(sourceRoot,'video.mp4'));
 await copyFile(join(media,'voice.wav'),join(sourceRoot,'voice.wav'));
 let app!:CreationApplication;
 const host=new NarralensHost({catalog:new ProjectCatalog(new Map()),dbPath:join(root,'host.sqlite'),snapshotsRoot:join(root,'snapshots'),adoptionStagingRoot:join(root,'stage'),migrationsRoot:join(root,'migrations'),derivedRoot:join(root,'derived'),openFilmVendorRoot:vendorRoot,isolatedStudioRuntimeRoot:join(root,'studio-runtime'),agentApplication:instance=>app=new CreationApplication(instance,{createdRoot:join(root,'projects'),vendorRoot,worker:{pollMs:10},localAssets:{sourceRoot,storageRoot}})});
 await host.listen(0);
 const driver=app.auth.issue({principal_id:'owner',channel:'authenticated',expires_at:Date.now()+300000});
 const human=app.auth.issue({principal_id:'owner',channel:'trusted_ui',expires_at:Date.now()+300000});
 const foreign=app.auth.issue({principal_id:'other',channel:'authenticated',expires_at:Date.now()+300000});
 const ui=(path:string,body?:unknown)=>fetch(host.origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:host.origin,Cookie:app.auth.cookieName+'='+human.token,'X-Narralens-CSRF':human.csrf!,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const owner=(path:string)=>fetch(host.origin+path,{headers:{Origin:host.origin,Authorization:'Bearer '+driver.token}});
 const asForeign=(path:string)=>fetch(host.origin+path,{headers:{Origin:host.origin,Authorization:'Bearer '+foreign.token}});
 const vectors=JSON.parse(readFileSync('docs/agent-driven-v1/cp-a0/contract-vectors.json','utf8')) as {vectors:{id:string;value:unknown}[]};
 const input=structuredClone(vectors.vectors.find(v=>v.id==='definition:IntakePut:valid')!.value) as IntakePut;
 input.intake_id=null;input.base_version=0;input.brief.local_asset_ids=[];input.brief.narration_asset_id=null;
 Object.assign(input.brief.content_brief.material_strategy,{asset_ids:[],narration_asset_id:null,rights_refs:[]});input.brief.content_brief.script_ref=null;input.brief.content_brief.style.style_digest=styleDigest(input.brief.content_brief.style);
 const posted=await fetch(host.origin+'/api/agent/v1/intakes',{method:'POST',headers:{Origin:host.origin,Authorization:'Bearer '+driver.token,'Content-Type':'application/json'},body:JSON.stringify(input)});
 if(posted.status!==200)throw new Error('The fixture intake was not accepted');
 const intake=await posted.json() as Intake;
 const confirmed=await ui('/api/agent/v1/intakes/'+intake.intake_id+'/decision',{meta:{idempotency_key:'fixture-confirm',correlation_id:'fixture-confirm'},intake_version:intake.version,brief_sha256:intake.brief_sha256,choice:'confirm_brief'});
 if(confirmed.status!==200)throw new Error('The fixture confirmation was not accepted');
 const decision=await confirmed.json() as Decision;
 const projectResponse=await fetch(host.origin+'/api/agent/v1/projects',{method:'POST',headers:{Origin:host.origin,Authorization:'Bearer '+driver.token,'Content-Type':'application/json'},body:JSON.stringify({meta:{idempotency_key:'fixture-create',correlation_id:'fixture-create'},intake_id:intake.intake_id,intake_version:intake.version,decision_id:decision.decision_id})});
 if(projectResponse.status!==202)throw new Error('The fixture creation was not accepted');
 let job=await projectResponse.json() as JobReceipt;
 const until=Date.now()+30000;
 while(Date.now()<until&&job.state!=='succeeded'){
  if(['failed','cancelled','attention'].includes(job.state))throw new Error('The fixture creation failed');
  await new Promise(r=>setTimeout(r,20));
  const response=await owner('/api/agent/v1/projects/'+job.project_id+'/jobs/'+job.job_id);
  job=await response.json() as JobReceipt;
 }
 if(job.state!=='succeeded'||!job.project_id)throw new Error('The fixture creation did not converge');
 const projectId=job.project_id;
 return {root,host,app,projectId,ui,owner,asForeign,driver,human,foreign,sourceRoot,storageRoot,close:async()=>{await host.close();await rm(root,{recursive:true,force:true});}};
}

const declaration=(candidate_id:string,key:string,label='Diagnostic transport media')=>({
 meta:{idempotency_key:key,correlation_id:key},
 project_id:'PLACEHOLDER',
 candidate_id,
 source:{kind:'generated' as const,label,uri:null},
 license:{status:'cleared' as const,label:'Diagnostic only',commercial_use:true},
 recording_origin:null as null,
});

it('lists the safe source files to the trusted UI and refuses the driver channel',async()=>{
 const f=await fixture();
 try{
  const listed=await f.ui(`/api/ui/v1/projects/${f.projectId}/local-source-files`);
  expect(listed.status).toBe(200);
  const body=await listed.json() as {format:string;project_id:string;items:Array<{candidate_id:string;display_name:string;kind:string;bytes:number;expires_at:string}>};
  expect(body.format).toBe('narralens.local-source-files@1');
  expect(body.project_id).toBe(f.projectId);
  expect(body.items.map(item=>item.display_name).sort()).toEqual(['video.mp4','voice.wav']);
  // The listing is opaque: it carries no path, no root and no credential.
  const raw=JSON.stringify(body);
  expect(raw).not.toContain(f.sourceRoot);
  expect(raw).not.toContain('/tmp/');
  expect(raw).not.toContain('token');
  expect(body.items.every(item=>/^cand_[a-f0-9]{56}$/.test(item.candidate_id))).toBe(true);
  expect(body.items.every(item=>item.bytes>0)).toBe(true);
  expect(body.items.every(item=>Date.parse(item.expires_at)>Date.now())).toBe(true);
  // The driver relay may not enumerate the source candidates.
  const forbidden=await f.owner(`/api/ui/v1/projects/${f.projectId}/local-source-files`);
  expect(forbidden.status).toBe(403);
  // The inventory read is owner scoped and works for the driver.
  const inventory=await f.owner(`/api/ui/v1/projects/${f.projectId}/asset-inventory`);
  expect(inventory.status).toBe(200);
  const empty=await inventory.json() as {format:string;items:unknown[];cursor_next:null};
  expect(empty.format).toBe('narralens.asset-inventory@1');
  expect(empty.items).toEqual([]);
  expect(empty.cursor_next).toBeNull();
  // A read never registers anything.
  const again=await f.owner(`/api/ui/v1/projects/${f.projectId}/asset-inventory`);
  expect((await again.json() as {items:unknown[]}).items).toEqual([]);
 }finally{await f.close();}
},180000);

it('registers the selected file once, replays the original receipt and refuses a different declaration',async()=>{
 const f=await fixture();
 try{
  const listed=await f.ui(`/api/ui/v1/projects/${f.projectId}/local-source-files`);
  const items=(await listed.json() as {items:Array<{candidate_id:string;display_name:string}>}).items;
  const video=items.find(item=>item.display_name==='video.mp4')!;
  const request=declaration(video.candidate_id,'transport-key');
  request.project_id=f.projectId;
  const registered=await f.ui(`/api/ui/v1/projects/${f.projectId}/local-assets`,request);
  expect(registered.status).toBe(200);
  const item=await registered.json() as {asset_id:string;sha256:string;bytes:number;registration_digest:string;rights_ref:{id:string;version:number;sha256:string};media:{kind:string;extension:string};source_label:string;license:{status:string};recording_origin:null};
  expect(item.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(item.bytes).toBeGreaterThan(0);
  expect(item.media).toMatchObject({kind:'video',extension:'mp4'});
  // The rights reference is the real row: id=the asset's rights_ref, version 1 and the
  // registration digest as the sha256.
  expect(item.rights_ref).toEqual({id:item.rights_ref.id,version:1,sha256:item.registration_digest});
  expect(item.rights_ref.id).toMatch(/^rights_[a-f0-9]{56}$/);
  // The registered bytes are the real file bytes.
  const expected=await readFile(join(f.sourceRoot,'video.mp4'));
  expect(item.bytes).toBe(expected.length);
  // The same key with the same declaration replays the ORIGINAL item and registers
  // nothing new.
  const replay=await f.ui(`/api/ui/v1/projects/${f.projectId}/local-assets`,request);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(item);
  const inventory=await f.owner(`/api/ui/v1/projects/${f.projectId}/asset-inventory`);
  const listed2=await inventory.json() as {items:unknown[]};
  expect(listed2.items).toHaveLength(1);
  // The same key with a DIFFERENT declaration is a conflict, never a second asset.
  const different=declaration(video.candidate_id,'transport-key','A different declaration');
  different.project_id=f.projectId;
  const conflict=await f.ui(`/api/ui/v1/projects/${f.projectId}/local-assets`,different);
  expect(conflict.status).toBe(409);
  const after=await (await f.owner(`/api/ui/v1/projects/${f.projectId}/asset-inventory`)).json() as {items:unknown[]};
  expect(after.items).toHaveLength(1);
  // The inventory never leaks a path, a token or the source root.
  expect(JSON.stringify(after)).not.toContain(f.sourceRoot);
  expect(JSON.stringify(after)).not.toContain(f.storageRoot);
 }finally{await f.close();}
},180000);

it('refuses an unknown candidate, a foreign reader and an unusable cursor without side effects',async()=>{
 const f=await fixture();
 try{
  const unknown=declaration('cand_'+'0'.repeat(56),'missing-candidate');
  unknown.project_id=f.projectId;
  const missing=await f.ui(`/api/ui/v1/projects/${f.projectId}/local-assets`,unknown);
  expect(missing.status).toBe(404);
  // Another principal cannot enumerate this project's inventory.
  const foreign=await f.asForeign(`/api/ui/v1/projects/${f.projectId}/asset-inventory`);
  expect(foreign.status).toBe(404);
  // An unknown cursor is refused instead of silently continuing.
  const cursor=await f.owner(`/api/ui/v1/projects/${f.projectId}/asset-inventory?cursor=not-a-real-cursor`);
  expect(cursor.status).toBe(410);
  // An unknown query parameter is refused.
  const unknownParameter=await f.owner(`/api/ui/v1/projects/${f.projectId}/asset-inventory?everything=1`);
  expect(unknownParameter.status).toBe(400);
  // An unusable limit is refused.
  const badLimit=await f.owner(`/api/ui/v1/projects/${f.projectId}/asset-inventory?limit=999`);
  expect(badLimit.status).toBe(400);
  // A registration for another project is refused.
  const listed=await f.ui(`/api/ui/v1/projects/${f.projectId}/local-source-files`);
  const video=(await listed.json() as {items:Array<{candidate_id:string;display_name:string}>}).items.find(item=>item.display_name==='video.mp4')!;
  const other=declaration(video.candidate_id,'other-project');
  other.project_id='another-project';
  const mismatched=await f.ui(`/api/ui/v1/projects/${f.projectId}/local-assets`,other);
  expect(mismatched.status).toBe(400);
  // Nothing was registered by any of the refused calls.
  const inventory=await (await f.owner(`/api/ui/v1/projects/${f.projectId}/asset-inventory`)).json() as {items:unknown[]};
  expect(inventory.items).toEqual([]);
 }finally{await f.close();}
},180000);


it('uses the real independent UI delegate for strict empty reopen and closed paginated source reads',async()=>{
 const f=await fixture();try{
  const opened=await f.ui(`/api/ui/v1/projects/${f.projectId}/native-open`,{});
  expect(opened.status).toBe(200);const entry=new URL((await opened.json() as {url:string}).url);
  const exchanged=await fetch(entry.origin+'/narralens/session/exchange',{method:'POST',headers:{Origin:entry.origin,'Content-Type':'application/json'},body:JSON.stringify({ticket:entry.hash.slice('#native_ticket='.length)})});
  expect(exchanged.status).toBe(200);
  const grant=await exchanged.json() as {ui?:{csrf:string}};
  expect(grant.ui).toBeDefined();
  const cookies=exchanged.headers.getSetCookie();
  const cookie=cookies.find(value=>/^narralens_ui_[0-9a-f]+=/.test(value))!.split(';')[0]!;
  const call=(surface:string,operation:string,input:unknown)=>fetch(entry.origin+'/narralens/api/ui/call',{method:'POST',headers:{Origin:entry.origin,Cookie:cookie,'X-Narralens-Workbench-CSRF':grant.ui!.csrf,'Content-Type':'application/json'},body:JSON.stringify({surface,operation,input})});
  const before=f.host.revisions.activeCommit(f.projectId);
  expect((await call('agent.v1','health.read',{unexpected:true})).status).toBe(400);
  for(const input of [null,[],0,'', {unexpected:true}])expect((await call('workbench.v1','native.reopen',input)).status).toBe(400);
  for(const input of [{root:'/'},{limit:0},{limit:65},{limit:'1'},{cursor:1},{project_id:123}])expect((await call('local-assets.v1','local-source-files.read',input)).status).toBe(400);
  const page1=await call('local-assets.v1','local-source-files.read',{project_id:f.projectId,limit:1,cursor:null});
  expect(page1.status).toBe(200);
  const first=await page1.json() as {items:Array<{candidate_id:string}>;cursor_next:string|null};
  expect(first.items).toHaveLength(1);expect(typeof first.cursor_next).toBe('string');
  const page2=await call('local-assets.v1','local-source-files.read',{project_id:f.projectId,limit:1,cursor:first.cursor_next});
  expect(page2.status).toBe(200);
  const second=await page2.json() as {items:Array<{candidate_id:string}>;cursor_next:string|null};
  expect(second.items).toHaveLength(1);expect(second.items[0]!.candidate_id).not.toBe(first.items[0]!.candidate_id);
  expect(second.cursor_next).toBeNull();
  expect(f.host.revisions.activeCommit(f.projectId)).toEqual(before);
 }finally{await f.close();}
},180000);
