import {afterEach,it,expect} from 'vitest';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {NarralensHost} from '../../../src/host/server.js';
import {ProjectCatalog} from '../../../src/host/projects/project-catalog.js';
import {CreationApplication} from '../../../src/host/agent-driven/creation-application.js';
import {ScopedAgentAuth} from '../../../src/host/agent-driven/scoped-auth.js';
import {WorkbenchSessionService} from '../../../src/host/agent-driven/workbench-session.js';
import {createServer,request as httpRequest} from 'node:http';
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'narralens-workbench-session-'));
 let app!:CreationApplication;
 const operator=randomBytes(32).toString('base64url');
 const host=new NarralensHost({catalog:new ProjectCatalog(new Map()),dbPath:join(root,'host.sqlite'),snapshotsRoot:join(root,'snapshots'),adoptionStagingRoot:join(root,'stage'),migrationsRoot:join(root,'migrations'),derivedRoot:join(root,'derived'),agentApplication:instance=>app=new CreationApplication(instance,{createdRoot:join(root,'projects'),vendorRoot:join(root,'unavailable-pinned-vendor'),workbench:{principalId:'local-owner',operatorSecret:operator}})});
 await host.listen(0);cleanup.push(async()=>{await host.close();await rm(root,{recursive:true,force:true});});
 const driver=app.auth.issue({principal_id:'local-owner',channel:'authenticated',expires_at:Date.now()+60000});
 const post=(path:string,body:unknown={},headers:Record<string,string>={})=>fetch(host.origin+'/api/workbench/session'+path,{method:'POST',headers:{Origin:host.origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const open=()=>post('/open',{}, {Authorization:'Bearer '+operator});
 const ticket=async()=>{const response=await open();expect(response.status).toBe(200);const body=await response.json() as {url:string};return new URL(body.url).hash.slice('#workbench_ticket='.length);};
 const exchange=async()=>{const response=await post('/exchange',{ticket:await ticket()});expect(response.status).toBe(200);const cookie=response.headers.get('set-cookie')!.split(';')[0]!;const session=await response.json() as {csrf:string;principal_id:string;session_ref:string};return {cookie,session,response};};
 return {root,host,app,operator,driver,post,open,ticket,exchange};
}
it('exchanges a genuine Host-only ticket once; browser cookie reads a session without creating any approval or project',async()=>{
 const f=await fixture(),ticket=await f.ticket();
 const response=await f.post('/exchange',{ticket});expect(response.status).toBe(200);
 expect(response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');expect(response.headers.get('cache-control')).toBe('no-store');
 const cookie=response.headers.get('set-cookie')!.split(';')[0]!;
 const session=await response.json() as {csrf:string;principal_id:string};expect(session.principal_id).toBe('local-owner');expect(session.csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
 expect((await f.post('/exchange',{ticket})).status).toBe(401);
 const read=await fetch(f.host.origin+'/api/workbench/session',{headers:{Origin:f.host.origin,Cookie:cookie,'X-Narralens-CSRF':session.csrf}});expect(read.status).toBe(200);expect(await read.json()).toMatchObject(session);
 expect(f.host.revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM cp_a0_project_origin').get()?.n)).toBe(0);
});
it('does not allow ordinary Agent credentials, a body-supplied role, or a UI cookie to obtain operator authority',async()=>{
 const f=await fixture();expect((await f.post('/open',{}, {Authorization:'Bearer '+f.driver.token})).status).toBe(401);
 expect((await f.post('/open',{principal_id:'local-owner',channel:'trusted_ui'},{Authorization:'Bearer '+f.operator})).status).toBe(400);
 const ui=await f.exchange();expect((await f.post('/open',{}, {Cookie:ui.cookie,Authorization:'Bearer '+f.operator})).status).toBe(401);
 expect((await fetch(f.host.origin+'/api/workbench/session',{headers:{Origin:f.host.origin,Authorization:'Bearer '+f.driver.token}})).status).toBe(403);
});
it('requires CSRF for renewal, preserves a predecessor after lost responses, and permits reopening with an existing cookie',async()=>{
 const f=await fixture(),ui=await f.exchange();
 expect((await f.post('/renew',{}, {Cookie:ui.cookie})).status).toBe(403);
 const renewed=await f.post('/renew',{}, {Cookie:ui.cookie,'X-Narralens-CSRF':ui.session.csrf});expect(renewed.status).toBe(200);expect(renewed.headers.get('set-cookie')!.includes(ui.cookie)).toBe(true);
 const renewedSession=await renewed.json() as {csrf:string};expect(renewedSession.csrf===ui.session.csrf).toBe(true);
 expect((await fetch(f.host.origin+'/api/workbench/session',{headers:{Origin:f.host.origin,Cookie:ui.cookie,'X-Narralens-CSRF':ui.session.csrf}})).status).toBe(200);
 const reopened=await f.post('/exchange',{ticket:await f.ticket()},{Cookie:ui.cookie});expect(reopened.status).toBe(200);
 const reopenedSession=await reopened.json() as {csrf:string};expect(reopenedSession.csrf===ui.session.csrf).toBe(true);
 // A new shared cookie plus an existing tab's proof remains usable even if the renew body was lost.
 expect((await fetch(f.host.origin+'/api/workbench/session',{headers:{Origin:f.host.origin,Cookie:renewed.headers.get('set-cookie')!.split(';')[0]!,'X-Narralens-CSRF':ui.session.csrf}})).status).toBe(200);
});
it('rejects cross-origin, malformed ticket, unknown fields, oversized body, and unavailable paths without leaking credentials',async()=>{
 const f=await fixture();expect((await f.post('/open',{}, {Origin:'http://127.0.0.1:1',Authorization:'Bearer '+f.operator})).status).toBe(403);
 expect((await f.post('/exchange',{ticket:'bad'})).status).toBe(401);
 expect((await f.post('/exchange',{ticket:await f.ticket(),principal_id:'forged'})).status).toBe(400);
 const oversized=await f.post('/exchange',{ticket:'x'.repeat(2000)});expect(oversized.status).toBe(413);
 expect((await oversized.text()).includes(f.root)).toBe(false);
 expect((await f.post('/missing')).status).toBe(404);
});
it('rejects UI bearer transport and invalidates its actual cookie on application close',async()=>{
 const f=await fixture(),ui=await f.exchange(),token=ui.cookie.split('=')[1]!;
 expect((await fetch(f.host.origin+'/api/workbench/session',{headers:{Origin:f.host.origin,Authorization:'Bearer '+token}})).status).toBe(403);
 f.app.workbenchSessions!.close();
 expect((await f.open()).status).toBe(503);
 expect((await f.post('/exchange',{ticket:'x'.repeat(43)})).status).toBe(503);
 expect(()=>f.app.auth.authenticate({method:'GET',origin:f.host.origin,authorization:undefined,cookie:ui.cookie,csrf:ui.session.csrf},'trusted_ui')).toThrow();
});
it('expires tickets exactly at their deadline and never accepts tickets in a different Host instance',async()=>{
 let now=100000,origin='';const auth=new ScopedAgentAuth(()=>origin,()=>now),operator=randomBytes(32).toString('base64url');
 const service=new WorkbenchSessionService(auth,()=>origin,'local-owner',operator,()=>now);
 const server=createServer((request,response)=>{void service.handle(request,response);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+((server.address() as {port:number}).port);
 cleanup.push(()=>new Promise<void>((resolve,reject)=>{service.close();server.close(error=>error?reject(error):resolve());}));
 const post=(path:string,body:unknown,authorization?:string)=>fetch(origin+'/api/workbench/session'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{})},body:JSON.stringify(body)});
 const opened=await post('/open',{},'Bearer '+operator),body=await opened.json() as {url:string};const ticket=new URL(body.url).hash.slice('#workbench_ticket='.length);
 const other=await fixture();expect((await other.post('/exchange',{ticket})).status).toBe(401);
 now+=5*60*1000;expect((await post('/exchange',{ticket})).status).toBe(401);
});

for(const mode of ['expiry','revocation'] as const)it(`rechecks ${mode} after a slow renewal body instead of extending an invalid session`,async()=>{
 let now=100000,origin='';const auth=new ScopedAgentAuth(()=>origin,()=>now),operator=randomBytes(32).toString('base64url');
 const service=new WorkbenchSessionService(auth,()=>origin,'local-owner',operator,()=>now);
 const server=createServer((request,response)=>{void service.handle(request,response);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+((server.address() as {port:number}).port);
 cleanup.push(()=>new Promise<void>((resolve,reject)=>{service.close();server.close(error=>error?reject(error):resolve());}));
 const post=(path:string,body:unknown,authorization?:string)=>fetch(origin+'/api/workbench/session'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{})},body:JSON.stringify(body)});
 const opened=await post('/open',{},'Bearer '+operator),entry=await opened.json() as {url:string};
 const exchange=await post('/exchange',{ticket:new URL(entry.url).hash.slice('#workbench_ticket='.length)}),cookie=exchange.headers.get('set-cookie')!.split(';')[0]!;
 const session=await exchange.json() as {csrf:string;expires_at:number};now=session.expires_at-1;
 const received=new Promise<void>(resolve=>server.once('request',()=>resolve()));
 const request=httpRequest(origin+'/api/workbench/session/renew',{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-Narralens-CSRF':session.csrf,'Content-Type':'application/json','Content-Length':'2'}});
 const result=new Promise<{status:number;cookie:string|undefined}>((resolve,reject)=>{request.once('error',reject);request.once('response',response=>{response.resume();response.once('end',()=>resolve({status:response.statusCode!,cookie:response.headers['set-cookie']?.[0]}));});});
 request.write('{');await received;
 if(mode==='expiry')now=session.expires_at;else auth.revoke(cookie.slice(cookie.indexOf('=')+1));
 request.end('}');expect(await result).toEqual({status:401,cookie:undefined});
});

it('refuses a stolen cookie on both session discovery and Agent UI reads without the port-scoped proof',async()=>{
 const f=await fixture(),ui=await f.exchange();
 // Another loopback service can receive this Cookie: ports do not isolate cookies.
 const attacker=createServer((request,response)=>{response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({cookie:request.headers.cookie}));});
 await new Promise<void>(resolve=>attacker.listen(0,'127.0.0.1',resolve));
 cleanup.push(()=>new Promise<void>((resolve,reject)=>attacker.close(error=>error?reject(error):resolve())));
 const stolen=await fetch('http://127.0.0.1:'+((attacker.address() as {port:number}).port),{headers:{Cookie:ui.cookie}}).then(r=>r.json()) as {cookie:string};
 expect(stolen.cookie===ui.cookie).toBe(true);
 const headers={Origin:f.host.origin,Cookie:stolen.cookie};
 expect((await fetch(f.host.origin+'/api/workbench/session',{headers})).status).toBe(403);
 expect((await fetch(f.host.origin+'/api/session',{headers})).status).toBe(403);
 expect((await fetch(f.host.origin+'/api/agent/v1/intakes/not-owned',{headers})).status).toBe(403);
 expect((await f.post('/renew',{},headers)).status).toBe(403);
 const proven=await fetch(f.host.origin+'/api/session',{headers:{...headers,'X-Narralens-CSRF':ui.session.csrf}});expect(proven.status).toBe(200);expect(await proven.json()).toEqual({mode:'trusted_ui'});
});

it('does not exhaust session capacity after 80 real renewals and still permits an operator reopen',async()=>{
 const f=await fixture(),ui=await f.exchange();
 for(let i=0;i<80;i++){
  const response=await f.post('/renew',{}, {Cookie:ui.cookie,'X-Narralens-CSRF':ui.session.csrf});expect(response.status).toBe(200);
  const body=await response.json() as {csrf:string;session_ref:string};expect(body.session_ref===ui.session.session_ref).toBe(true);expect(body.csrf===ui.session.csrf).toBe(true);
  expect(response.headers.get('set-cookie')!.split(';')[0]===ui.cookie).toBe(true);
 }
 const reopened=await f.exchange();expect(reopened.cookie===ui.cookie).toBe(true);expect(reopened.session.session_ref===ui.session.session_ref).toBe(true);
});
it('allows an explicit operator ticket to reopen after the prior cookie was revoked',async()=>{
 const f=await fixture(),ui=await f.exchange();f.app.auth.revoke(ui.cookie.slice(ui.cookie.indexOf('=')+1));
 expect((await f.post('/renew',{}, {Cookie:ui.cookie,'X-Narralens-CSRF':ui.session.csrf})).status).toBe(401);
 const reopened=await f.exchange();expect(reopened.cookie===ui.cookie).toBe(false);expect(reopened.session.csrf===ui.session.csrf).toBe(true);
});
