import {it,expect} from 'vitest';
import {createServer,type Server} from 'node:http';
import {ControlledStudioAccess,StudioAccessError,type NativeStudioGrant} from '../../../src/host/m5/controlled-studio-access.js';
/** Component-level transport lifetime tests only; no business/film/approval proof. */
async function server(){
 let origin='';const access=new ControlledStudioAccess(()=>origin);
 const host=createServer((request,response)=>{void(async()=>{
  if(request.url==='/exchange')await access.exchange(request,response);
  else{const session=access.authenticate(request);response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({project_id:session.grant.project_id}));}
 })().catch(error=>{response.writeHead(error instanceof StudioAccessError?error.status:500);response.end();});});
 await new Promise<void>(resolve=>host.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+((host.address() as {port:number}).port);
 return {access,origin,host,close:async()=>{access.close();host.closeAllConnections();await new Promise<void>((resolve,reject)=>host.close(error=>error?reject(error):resolve()));}};
}
const grant=(isCurrent:()=>boolean):NativeStudioGrant=>({project_id:'project_capacity',native_project_id:'native_capacity',owner_session_ref:'owner_session',instance_generation:1,revision:1,snapshot_id:'a'.repeat(64),source_digest:'b'.repeat(64),isCurrent,readWorkbench:async()=>{throw new Error('Not part of this component transport test');}});
async function exchange(f:Awaited<ReturnType<typeof server>>,g:NativeStudioGrant){
 let issued:ReturnType<ControlledStudioAccess['issue']>;try{issued=f.access.issue(g);}catch(error){if(error instanceof StudioAccessError)expect(error.status).toBe(200);throw error;}
 const ticket=new URL(issued.url).hash.slice('#native_ticket='.length);
 const response=await fetch(f.origin+'/exchange',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json'},body:JSON.stringify({ticket})});expect(response.status).toBe(200);
 return {...await response.json() as {csrf:string;read_token:string},cookie:response.headers.get('Set-Cookie')!.split(';')[0]!};
}
it('reopens the same actual scope 80 times without exhausting capacity or invalidating an existing tab proof',async()=>{
 const f=await server(),g=grant(()=>true);
 try{
  const first=await exchange(f,g);
  let stable=true;for(let i=0;i<80;i++){const next=await exchange(f,g);stable&&=next.csrf===first.csrf&&next.read_token===first.read_token&&next.cookie===first.cookie;}expect(stable).toBe(true);
  expect((await fetch(f.origin+'/probe',{headers:{Origin:f.origin,Cookie:first.cookie,'X-Narralens-Native-CSRF':first.csrf}})).status).toBe(200);
 }finally{await f.close();}
});
it('reclaims 64 revoked owners and workspace versions while retaining a bounded stale-token answer and a usable fresh owner',async()=>{
 const f=await server();let current=true;
 try{
  let first:Awaited<ReturnType<typeof exchange>>|undefined;
  for(let i=0;i<64;i++){const session=await exchange(f,{...grant(()=>current),owner_session_ref:'owner_'+i});first??=session;}
  current=false;const fresh=await exchange(f,{...grant(()=>true),owner_session_ref:'replacement_owner'});
  expect((await fetch(f.origin+'/probe',{headers:{Origin:f.origin,Cookie:fresh.cookie,'X-Narralens-Native-CSRF':fresh.csrf}})).status).toBe(200);
  expect((await fetch(f.origin+'/probe',{headers:{Origin:f.origin,Cookie:first!.cookie,'X-Narralens-Native-CSRF':first!.csrf}})).status).toBe(409);
 }finally{await f.close();}
});
