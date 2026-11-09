import {describe,it,expect} from 'vitest';
import {createServer,type Server} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {RevisionStore} from '../../../src/host/projects/revision-store.js';
import {ProductSqliteRepository} from '../../../src/host/agent-driven/product-sqlite-repository.js';
import {CreativeService} from '../../../src/host/creative/creative-service.js';
import {ScopedAgentAuth} from '../../../src/host/agent-driven/scoped-auth.js';
import {AgentHttpRouter,MAX_AGENT_BODY_BYTES} from '../../../src/host/agent-driven/agent-http-router.js';
import {ApplicationDispatcher,creativeHandlers,type AgentHandlers} from '../../../src/host/agent-driven/application-dispatcher.js';
import {canonicalJson} from '../../../src/host/engine/source-digest-v1.js';
import type {Intake,IntakePut,DecisionInput,EventSnapshot} from '../../../src/contracts/agent-driven-types.js';
const vectors=JSON.parse(readFileSync('docs/agent-driven-v1/cp-a0/contract-vectors.json','utf8')) as {vectors:{id:string;value:unknown}[]};
function intake():IntakePut {
 const body=structuredClone(vectors.vectors.find(v=>v.id==='definition:IntakePut:valid')!.value) as IntakePut;
 body.intake_id=null;body.base_version=0;
 const style=body.brief.content_brief.style;const {style_digest:_,...preimage}=style;
 style.style_digest=createHash('sha256').update(canonicalJson(preimage)).digest('hex');
 return body;
}
async function fixture(extra:AgentHandlers={}){
 const store=new RevisionStore(),repo=new ProductSqliteRepository(store),service=new CreativeService({repository:repo});let origin='';
 const auth=new ScopedAgentAuth(()=>origin),dispatcher=new ApplicationDispatcher({...creativeHandlers(service),...extra});
 const router=new AgentHttpRouter(auth,()=>origin,dispatcher);
 const server=createServer((req,res)=>{void router.handle(req,res);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 const driver=auth.issue({principal_id:'local-user',channel:'authenticated',expires_at:Date.now()+60000});
 const ui=auth.issue({principal_id:'local-user',channel:'trusted_ui',expires_at:Date.now()+60000});
 const request=(path:string,body?:unknown,headers:Record<string,string>={})=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Authorization:'Bearer '+driver.token,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const close=async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));store.close();};
 return {store,auth,origin,driver,ui,request,close};
}
describe('Agent HTTP transport with the actual SQLite creative service (not full NarralensHost acceptance)',()=>{
 it('creates and replays one actual intake, preserving unknown-field validation',async()=>{
  const f=await fixture();try{
   const body=intake();const first=await f.request('/api/agent/v1/intakes',body);expect(first.status).toBe(200);const saved=await first.json() as Intake;
   const second=await f.request('/api/agent/v1/intakes',{...body,meta:{...body.meta,correlation_id:'other-correlation'}});expect(second.status).toBe(200);expect(await second.json()).toEqual(saved);
   const bad=await f.request('/api/agent/v1/intakes',{...body,actor:'human'});expect(bad.status).toBe(400);
   expect(f.store.compose(db=>db.prepare('SELECT count(*) AS n FROM cp_a0_intake_version').get()?.n)).toBe(1);
   const read=await f.request('/api/agent/v1/intakes/'+saved.intake_id);expect(read.status).toBe(200);
   const duplicate=await f.request('/api/agent/v1/intakes/'+saved.intake_id+'?intake_id=other');expect(duplicate.status).toBe(400);
  }finally{await f.close();}
 },20000);
 it('cannot let a driver impersonate a trusted decision, and checks Origin before resource existence',async()=>{
  const f=await fixture();try{
   const saved=await (await f.request('/api/agent/v1/intakes',intake())).json() as Intake;
   const input:DecisionInput={meta:{idempotency_key:'confirm1',correlation_id:'confirm1'},intake_id:saved.intake_id,intake_version:saved.version,brief_sha256:saved.brief_sha256,choice:'confirm_brief'};
   const denied=await f.request(`/api/agent/v1/intakes/${saved.intake_id}/decision`,input);expect(denied.status).toBe(403);
   const cross=await f.request('/api/agent/v1/intakes/missing',undefined,{Origin:'http://127.0.0.1:9000'});expect(cross.status).toBe(403);
   const accepted=await fetch(`${f.origin}/api/agent/v1/intakes/${saved.intake_id}/decision`,{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:f.auth.cookieName+'='+f.ui.token,'X-Narralens-CSRF':f.ui.csrf!},body:JSON.stringify(input)});
   expect(accepted.status).toBe(200);
   expect(f.store.compose(db=>db.prepare('SELECT count(*) AS n FROM cp_a0_intake_confirmation').get()?.n)).toBe(1);
  }finally{await f.close();}
 },20000);
 it('binds native acknowledgement to its nested project identity without inventing a DTO field',async()=>{
  let calls=0;
  const f=await fixture({'editor.native.ack':async input=>{calls++;return input.ack;}});try{
   const input=structuredClone(vectors.vectors.find(v=>v.id==='definition:NativeAckInput:valid')!.value) as import('../../../src/contracts/agent-driven-types.js').NativeAckInput;
   const credential=f.auth.issue({principal_id:'local-user',channel:'native_bridge',expires_at:Date.now()+60000});
   const headers={Origin:f.origin,Authorization:'Bearer '+credential.token,'Content-Type':'application/json'};
   const path=f.origin+'/api/agent/v1/projects/'+input.ack.project_id+'/native-ack';
   const response=await fetch(path,{method:'POST',headers,body:JSON.stringify(input)});
   expect(response.status).toBe(200);expect(await response.json()).toEqual(input.ack);
   const crossed=await fetch(path,{method:'POST',headers,body:JSON.stringify({...input,ack:{...input.ack,project_id:'other-project'}})});
   expect(crossed.status).toBe(400);
   const driver=await f.request('/api/agent/v1/projects/'+input.ack.project_id+'/native-ack',input);expect(driver.status).toBe(403);
   expect(calls).toBe(1);
  }finally{await f.close();}
 },20000);
 it('restores nullable GET cursor fields and refuses disagreement with Last-Event-ID',async()=>{
  let inputSeen:unknown;
  const snapshot=structuredClone(vectors.vectors.find(v=>v.id==='definition:EventSnapshot:valid')!.value) as EventSnapshot;
  const f=await fixture({'events.snapshot':async input=>{inputSeen=input;return snapshot;}});try{
   const path=`/api/agent/v1/projects/${snapshot.context.project_id}/events-snapshot?filter_digest=${'a'.repeat(64)}`;
   expect((await f.request(path)).status).toBe(200);
   expect(inputSeen).toEqual({project_id:snapshot.context.project_id,filter_digest:'a'.repeat(64),cursor:null,last_event_id:null});
   const bad=await f.request(path+'&last_event_id='+'b'.repeat(32),undefined,{'Last-Event-ID':'c'.repeat(32)});expect(bad.status).toBe(400);
  }finally{await f.close();}
 },20000);
 it('redacts producer errors, rejects invalid producer DTOs, and bounds body bytes before dispatch',async()=>{
  const f=await fixture({'instance':async()=>({private_path:'C:/private'} as never)});try{
   const bad=await f.request('/api/agent/v1/instance');expect(bad.status).toBe(500);expect(JSON.stringify(await bad.json())).not.toContain('private');
   const large=await f.request('/api/agent/v1/intakes',{padding:'x'.repeat(MAX_AGENT_BODY_BYTES+1)});expect(large.status).toBe(413);
   expect(f.store.compose(db=>db.prepare('SELECT count(*) AS n FROM cp_a0_intake_version').get()?.n)).toBe(0);
  }finally{await f.close();}
 },20000);
});
