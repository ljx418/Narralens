import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NarralensHost} from '../../../../src/host/server.js';
import {ProjectCatalog} from '../../../../src/host/projects/project-catalog.js';
import {CreationApplication} from '../../../../src/host/agent-driven/creation-application.js';
import {styleDigest} from '../../../../src/host/creative/digest.js';
import {createTrustedCallerContext} from '../../../../src/host/creative/trusted-context.js';
import type {IntakePut,Intake,Decision,JobReceipt} from '../../../../src/contracts/agent-driven-types.js';
export const vendorRoot='/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm';
/** Real HTTP/bootstrap/pinned snapshot, not a synthetic migration or verifier. UI
 * credentials below are fixture authority; these tests never claim human acceptance. */
export async function createdProjectFixture(options:{studioBeforeGatewayPublish?:(state:{gateway_origin:string;studio_origin:string;film_origin:string})=>Promise<void>}={}){
 const root=await mkdtemp(join(tmpdir(),'narralens-created-workspace-'));let app!:CreationApplication;
 const host=new NarralensHost({...options,catalog:new ProjectCatalog(new Map()),dbPath:join(root,'host.sqlite'),snapshotsRoot:join(root,'snapshots'),adoptionStagingRoot:join(root,'stage'),migrationsRoot:join(root,'migrations'),derivedRoot:join(root,'derived'),openFilmVendorRoot:vendorRoot,isolatedStudioRuntimeRoot:join(root,'studio-runtime'),agentApplication:instance=>app=new CreationApplication(instance,{createdRoot:join(root,'projects'),vendorRoot,worker:{pollMs:10}})});
 try{
  await host.listen(0);
  const driver=app.auth.issue({principal_id:'owner',channel:'authenticated',expires_at:Date.now()+300000}),ui=app.auth.issue({principal_id:'owner',channel:'trusted_ui',expires_at:Date.now()+300000});
  const request=(path:string,body?:unknown,human=false)=>fetch(host.origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:host.origin,...(human?{Cookie:app.auth.cookieName+'='+ui.token,'X-Narralens-CSRF':ui.csrf!}:{Authorization:'Bearer '+driver.token}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const vectors=JSON.parse(readFileSync('docs/agent-driven-v1/cp-a0/contract-vectors.json','utf8')) as {vectors:{id:string;value:unknown}[]};
  const input=structuredClone(vectors.vectors.find(v=>v.id==='definition:IntakePut:valid')!.value) as IntakePut;
  input.intake_id=null;input.base_version=0;input.brief.local_asset_ids=[];input.brief.narration_asset_id=null;
  Object.assign(input.brief.content_brief.material_strategy,{asset_ids:[],narration_asset_id:null,rights_refs:[]});input.brief.content_brief.script_ref=null;input.brief.content_brief.style.style_digest=styleDigest(input.brief.content_brief.style);
  const saved=await request('/api/agent/v1/intakes',input);if(saved.status!==200)throw new Error('Fixture intake was not accepted');const intake=await saved.json() as Intake;
  const confirmed=await request('/api/agent/v1/intakes/'+intake.intake_id+'/decision',{meta:{idempotency_key:'fixture-confirm',correlation_id:'fixture-confirm'},intake_version:intake.version,brief_sha256:intake.brief_sha256,choice:'confirm_brief'},true);
  if(confirmed.status!==200)throw new Error('Fixture confirmation was not accepted');const decision=await confirmed.json() as Decision;
  const created=await request('/api/agent/v1/projects',{meta:{idempotency_key:'fixture-create',correlation_id:'fixture-create'},intake_id:intake.intake_id,intake_version:intake.version,decision_id:decision.decision_id});if(created.status!==202)throw new Error('Fixture creation was not accepted');
  let job=await created.json() as JobReceipt;const until=Date.now()+30000;
  while(Date.now()<until&&job.state!=='succeeded'){
   if(['failed','cancelled','attention'].includes(job.state))throw new Error('Fixture creation failed');
   await new Promise(resolve=>setTimeout(resolve,10));const response=await request('/api/agent/v1/projects/'+job.project_id+'/jobs/'+job.job_id);if(!response.ok)throw new Error('Fixture job unavailable');job=await response.json() as JobReceipt;
  }
  if(job.state!=='succeeded'||!job.project_id||!job.bootstrap)throw new Error('Fixture creation did not converge');
  const projectId=job.project_id,commit=host.revisions.activeCommit(projectId)!;
  const closure=await app.committedSnapshots.readerForTransaction(projectId,commit.transaction_id,'owner').readSnapshot({project_id:projectId,snapshot_id:commit.snapshot_id,source_digest:commit.source_digest});
  const owner=createTrustedCallerContext({principal_id:'owner',channel:'authenticated',source:'driver_relay',session_ref:'fixture-owner'}),foreign=createTrustedCallerContext({principal_id:'other',channel:'authenticated',source:'driver_relay',session_ref:'fixture-other'});
  const authorRoot=join(root,'projects',projectId,'source'),authorBytes=await readFile(join(authorRoot,'film.html'));
  return {root,host,app,projectId,commit,closure,owner,foreign,authorRoot,authorBytes,request,ui,driver,close:async()=>{await host.close();await rm(root,{recursive:true,force:true});}};
 }catch(error){await host.close();await rm(root,{recursive:true,force:true});throw error;}
}
