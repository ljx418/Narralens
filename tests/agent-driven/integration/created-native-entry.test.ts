import {it,expect} from 'vitest';
import {Script} from 'node:vm';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createdProjectFixture} from './helpers/created-project-fixture.js';
import {CONTROLLED_NATIVE_ENTRY_HTML,CONTROLLED_NATIVE_TRANSPORT_SCRIPT} from '../../../src/host/m5/controlled-studio-browser.js';
type Fixture=Awaited<ReturnType<typeof createdProjectFixture>>;
interface Session {origin:string;cookie:string;csrf:string;read_token:string;native_project_id:string;project_id:string;path:string}
async function entry(f:Fixture){
 const response=await f.request('/api/ui/v1/projects/'+f.projectId+'/native-open',{},true);expect(response.status).toBe(200);
 const result=await response.json() as {url:string;revision:number;snapshot_id:string;native_state:string};expect(result.native_state).toBe('unconfirmed');expect(result.revision).toBe(f.commit.revision);expect(result.snapshot_id).toBe(f.commit.snapshot_id);expect(JSON.stringify(result)).not.toContain(f.root);
 return new URL(result.url);
}
async function exchange(url:URL):Promise<Session>{
 const response=await fetch(url.origin+'/narralens/session/exchange',{method:'POST',headers:{Origin:url.origin,'Content-Type':'application/json'},body:JSON.stringify({ticket:url.hash.slice('#native_ticket='.length)})});expect(response.status).toBe(200);expect(response.headers.get('Set-Cookie')).toMatch(/HttpOnly; SameSite=Strict/);
 return {...await response.json() as Omit<Session,'origin'|'cookie'>,origin:url.origin,cookie:response.headers.get('Set-Cookie')!.split(';')[0]!};
}
const headers=(s:Session)=>({Origin:s.origin,Cookie:s.cookie,'X-Narralens-Native-CSRF':s.csrf});
it('opens the real owned committed project and scopes native API, film assets and panel reads without elevating a cookie or read token',async()=>{
 const f=await createdProjectFixture();
 try{
  new Script(CONTROLLED_NATIVE_ENTRY_HTML.match(/<script>([\s\S]*)<\/script>/)![1]!);new Script(CONTROLLED_NATIVE_TRANSPORT_SCRIPT);
  const link=await entry(f),session=await exchange(link);
  const replay=await fetch(session.origin+'/narralens/session/exchange',{method:'POST',headers:{Origin:session.origin,'Content-Type':'application/json'},body:JSON.stringify({ticket:link.hash.slice('#native_ticket='.length)})});expect(replay.status).toBe(401);
  expect((await fetch(session.origin+'/api/projects',{headers:headers(session)})).status).toBe(200);
  expect((await fetch(session.origin+'/api/projects',{headers:{Origin:session.origin,Cookie:session.cookie}})).status).toBe(401);
  expect((await fetch(session.origin+'/api/projects',{headers:{...headers(session),Origin:'http://127.0.0.1:1'}})).status).toBe(403);
  const raw=await fetch(session.origin+'/api/projects/'+session.native_project_id,{headers:headers(session)});expect(raw.status).toBe(200);
  const native=await raw.json() as {project:{id:string;path:string};folder:string;text:string};expect(native.project.id).toBe(session.native_project_id);expect(native.project.path).toBe('');expect(native.folder).toContain('/s/'+session.read_token+'/film/p/');
  const film=await fetch(native.folder+'film.html?film-host=0');expect(film.status).toBe(200);expect(await film.text()).toBe(f.authorBytes.toString());
  const unscoped=new URL(native.folder+'film.html');unscoped.pathname=unscoped.pathname.replace('/s/'+session.read_token,'');expect((await fetch(unscoped)).status).toBe(401);
  expect((await fetch(session.origin+'/api/projects/'+session.native_project_id+'?native_read='+session.read_token,{headers:{Origin:session.origin}})).status).toBe(401);
  expect((await fetch(session.origin+'/api/projects/foreign-project',{headers:headers(session)})).status).toBe(403);
  const panel=await fetch(session.origin+'/narralens/api/workbench?project_id='+f.projectId,{headers:headers(session)});expect(panel.status).toBe(200);expect(await panel.json()).toMatchObject({format:'narralens.created-workbench@1.0',project_id:f.projectId,frame_count:0});
  expect((await fetch(session.origin+'/narralens/api/workbench?project_id=foreign',{headers:headers(session)})).status).toBe(403);
  expect((await fetch(session.origin+'/api/projects/'+session.native_project_id+'/edit',{method:'POST',headers:{...headers(session),'Content-Type':'application/json'},body:JSON.stringify({ops:[{op:'remove',clip:'any'}]})})).status).toBe(403);
  expect(await readFile(join(f.authorRoot,'film.html'))).toEqual(f.authorBytes);expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
  f.app.auth.revoke(f.ui.token);
  expect((await fetch(session.origin+'/api/projects/'+session.native_project_id,{headers:headers(session)})).status).toBe(409);
  expect((await fetch(native.folder+'film.html')).status).toBe(409);
 }finally{await f.close();}
},90000);
it('preserves existing tab proofs when reopening the same scope and revokes old native IDs when the actual prepared copy changes',async()=>{
 const f=await createdProjectFixture();
 try{
  const one=await exchange(await entry(f)),two=await exchange(await entry(f));expect(one.cookie).toBe(two.cookie);expect(one.csrf).toBe(two.csrf);
  for(const session of [one,two])expect((await fetch(session.origin+'/api/projects/'+session.native_project_id,{headers:headers(session)})).status).toBe(200);
  const prepared=await f.app.nativeWorkspaces.prepare(f.projectId,f.owner);await writeFile(join(prepared.source_root.value,'film.html'),'damaged disposable copy');await f.app.nativeWorkspaces.prepare(f.projectId,f.owner);
  const fresh=await exchange(await entry(f));expect(fresh.native_project_id).not.toBe(one.native_project_id);
  const listed=await (await fetch(fresh.origin+'/api/projects',{headers:headers(fresh)})).json() as {projects:{id:string}[]};expect(listed.projects.map(p=>p.id)).toEqual([fresh.native_project_id]);
  expect((await fetch(one.origin+'/api/projects/'+one.native_project_id,{headers:headers(one)})).status).toBe(409);
  expect((await fetch(fresh.origin+'/api/projects/'+one.native_project_id,{headers:headers(fresh)})).status).toBe(403);expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
 }finally{await f.close();}
},90000);
it('requires actual UI authority and an empty validated open command before starting native',async()=>{
 const f=await createdProjectFixture(),path='/api/ui/v1/projects/'+f.projectId+'/native-open';
 try{
  expect((await f.request(path,{})).status).toBe(403);
  expect((await f.request(path,{principal_id:'owner'},true)).status).toBe(400);
  const foreign=f.app.auth.issue({principal_id:'foreign',channel:'trusted_ui',expires_at:Date.now()+60000});
  expect((await fetch(f.host.origin+path,{method:'POST',headers:{Origin:f.host.origin,Cookie:f.app.auth.cookieName+'='+foreign.token,'X-Narralens-CSRF':foreign.csrf!,'Content-Type':'application/json'},body:'{}'})).status).toBe(404);
  await expect(stat(join(f.root,'studio-runtime'))).rejects.toMatchObject({code:'ENOENT'});expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
 }finally{await f.close();}
},60000);

it('revokes the old native child capability before networking and closes its previous Gateways when replacing that child',async()=>{
 const children:{close:()=>Promise<void>;listening:()=>boolean}[]=[];
 const f=await createdProjectFixture({studioBeforeGatewayPublish:async state=>{children.push({close:state.close_native,listening:state.gateway_is_listening});}});
 try{
  const old=await exchange(await entry(f));expect(children[0]!.listening()).toBe(true);
  await children[0]!.close();
  expect((await fetch(old.origin+'/api/projects/'+old.native_project_id,{headers:headers(old)})).status).toBe(409);
  const fresh=await exchange(await entry(f));expect(children.length).toBe(2);expect(children[0]!.listening()).toBe(false);expect(children[1]!.listening()).toBe(true);
  expect((await fetch(fresh.origin+'/api/projects/'+fresh.native_project_id,{headers:headers(fresh)})).status).toBe(200);expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
 }finally{await f.close();}
},90000);
