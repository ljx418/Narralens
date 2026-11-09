import type {CreatedWorkbenchProjection} from '../../contracts/created-workbench.js';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
export interface NativeStudioGrant {
 readonly project_id:string;readonly native_project_id:string;
 readonly owner_session_ref:string;readonly instance_generation:number;
 readonly revision:number;readonly snapshot_id:string;readonly source_digest:string;
 /** Captures authenticated owner and exact Host-issued prepared view, never body fields. */
 readonly isCurrent:()=>boolean;
 readonly readWorkbench:()=>Promise<CreatedWorkbenchProjection>;
}
export interface NativeStudioSession {readonly grant:NativeStudioGrant;readonly proof:string;readonly read_token:string;readonly expires_at:number}
interface Ticket {grant:NativeStudioGrant;expires_at:number}
const digest=(value:string)=>createHash('sha256').update(value).digest();
const key=(value:string)=>digest(value).toString('hex');
const secret=()=>randomBytes(32).toString('base64url');
const validSecret=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
export class StudioAccessError extends Error {
 constructor(readonly status:number,readonly code:'UNAUTHORIZED'|'ORIGIN_REJECTED'|'INVALID_REQUEST'|'NOT_FOUND'|'NATIVE_SESSION_STALE'|'CAPABILITY_UNAVAILABLE'){super('The controlled native session is unavailable');}
}
/** Ephemeral browser transport, not a business fact store or an approval authority. */
export class ControlledStudioAccess {
 readonly cookieName='narralens_native_'+randomBytes(12).toString('hex');
 readonly #cookie=secret();
 readonly #tickets=new Map<string,Ticket>();
 readonly #proofs=new Map<string,NativeStudioSession>();
 readonly #reads=new Map<string,NativeStudioSession>();
 readonly #retired=new Map<string,number>();
 #closed=false;
 constructor(private readonly origin:()=>string,private readonly now:()=>number=Date.now){}
 close(){this.#closed=true;this.#tickets.clear();this.#proofs.clear();this.#reads.clear();this.#retired.clear();}
 #current(grant:NativeStudioGrant){try{return !this.#closed&&grant.isCurrent();}catch{return false;}}
 #sameScope(a:NativeStudioGrant,b:NativeStudioGrant){return a.project_id===b.project_id&&a.native_project_id===b.native_project_id&&a.owner_session_ref===b.owner_session_ref&&a.instance_generation===b.instance_generation&&a.revision===b.revision&&a.snapshot_id===b.snapshot_id&&a.source_digest===b.source_digest;}
 #existing(grant:NativeStudioGrant){return [...this.#proofs.values()].find(session=>this.#sameScope(session.grant,grant));}
 #collect(){
  const now=this.now();
  for(const [k,t] of this.#tickets)if(now>=t.expires_at||!this.#current(t.grant))this.#tickets.delete(k);
  for(const [k,s] of this.#proofs)if(now>=s.expires_at||!this.#current(s.grant)){
   this.#proofs.delete(k);this.#reads.delete(key(s.read_token));
   if(now<s.expires_at){this.#retired.set('p:'+k,Math.min(s.expires_at,now+300000));this.#retired.set('r:'+key(s.read_token),Math.min(s.expires_at,now+300000));}
  }
  for(const [k,expires] of this.#retired)if(now>=expires)this.#retired.delete(k);
  while(this.#retired.size>256)this.#retired.delete(this.#retired.keys().next().value!);
 }
 #alive(grant:NativeStudioGrant){
  if(this.#closed)throw new StudioAccessError(503,'CAPABILITY_UNAVAILABLE');
  const current=this.#current(grant);
  if(!current)throw new StudioAccessError(409,'NATIVE_SESSION_STALE');
 }
 recheck(session:NativeStudioSession){
  if(this.#proofs.get(key(session.proof))!==session||this.now()>=session.expires_at)throw new StudioAccessError(401,'UNAUTHORIZED');
  this.#alive(session.grant);return session;
 }
 issue(grant:NativeStudioGrant):{url:string;expires_at:number}{
  this.#collect();this.#alive(grant);
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(grant.project_id)||!/^[A-Za-z0-9_-]{1,200}$/.test(grant.native_project_id)||!Number.isSafeInteger(grant.instance_generation)||grant.instance_generation<1)throw new StudioAccessError(503,'CAPABILITY_UNAVAILABLE');
  if(this.#tickets.size>=64||this.#proofs.size>=64&&!this.#existing(grant))throw new StudioAccessError(503,'CAPABILITY_UNAVAILABLE');
  const ticket=secret(),expires_at=this.now()+300000;
  this.#tickets.set(key(ticket),{grant:Object.freeze({...grant}),expires_at});
  return {url:this.origin()+'/narralens/entry#native_ticket='+ticket,expires_at};
 }
 #headers(request:IncomingMessage,requireOrigin:boolean){
  const expected=new URL(this.origin());
  if(request.headers.host!==expected.host)throw new StudioAccessError(403,'ORIGIN_REJECTED');
  const counts=new Map<string,number>();for(let i=0;i<request.rawHeaders.length;i+=2){const name=request.rawHeaders[i]!.toLowerCase();counts.set(name,(counts.get(name)??0)+1);}
  if(['host','origin','cookie','authorization','x-narralens-native-csrf','content-type','sec-websocket-protocol'].some(name=>(counts.get(name)??0)>1))throw new StudioAccessError(403,'ORIGIN_REJECTED');
  if(requireOrigin&&request.headers.origin!==expected.origin){
   let same=false;
   if(request.headers.origin===undefined&&request.headers['sec-fetch-site']==='same-origin'){same=true;if(request.headers.referer){try{same=new URL(request.headers.referer).origin===expected.origin;}catch{same=false;}}}
   if(!same)throw new StudioAccessError(403,'ORIGIN_REJECTED');
  }
  if(this.#closed)throw new StudioAccessError(503,'CAPABILITY_UNAVAILABLE');
 }
 authenticate(request:IncomingMessage):NativeStudioSession {
  this.#headers(request,true);this.#collect();
  if(request.headers.authorization)throw new StudioAccessError(403,'ORIGIN_REJECTED');
  const proof=request.headers['x-narralens-native-csrf'];
  if(!validSecret(proof))throw new StudioAccessError(401,'UNAUTHORIZED');
  const cookies=(request.headers.cookie??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(this.cookieName+'='));
  if(cookies.length!==1||!timingSafeEqual(digest(cookies[0]!.slice(this.cookieName.length+1)),digest(this.#cookie)))throw new StudioAccessError(401,'UNAUTHORIZED');
  const session=this.#proofs.get(key(proof));if(!session)throw new StudioAccessError(this.#retired.has('p:'+key(proof))?409:401,this.#retired.has('p:'+key(proof))?'NATIVE_SESSION_STALE':'UNAUTHORIZED');
  return this.recheck(session);
 }
 readSession(token:unknown):NativeStudioSession {
  this.#collect();if(!validSecret(token))throw new StudioAccessError(401,'UNAUTHORIZED');
  const session=this.#reads.get(key(token));if(!session)throw new StudioAccessError(this.#retired.has('r:'+key(token))?409:401,this.#retired.has('r:'+key(token))?'NATIVE_SESSION_STALE':'UNAUTHORIZED');return this.recheck(session);
 }
 streamSession(request:IncomingMessage):NativeStudioSession {
  this.#headers(request,true);
  // Browsers send an Origin on WebSocket handshakes. Film code cannot substitute the editor origin.
  if(request.headers.origin!==this.origin())throw new StudioAccessError(403,'ORIGIN_REJECTED');
  const parts=String(request.headers['sec-websocket-protocol']??'').split(',').map(p=>p.trim());
  if(parts.length!==2||parts[0]!=='narralens.read.v1')throw new StudioAccessError(401,'UNAUTHORIZED');
  return this.readSession(parts[1]);
 }
 assertNative(session:NativeStudioSession,nativeId:string){this.recheck(session);if(nativeId!==session.grant.native_project_id)throw new StudioAccessError(403,'ORIGIN_REJECTED');}
 assertProject(session:NativeStudioSession,projectId:string){this.recheck(session);if(projectId!==session.grant.project_id)throw new StudioAccessError(403,'ORIGIN_REJECTED');}
 async #body(request:IncomingMessage):Promise<string>{
  if(request.headers['content-type']?.split(';')[0]?.trim()!=='application/json'||request.headers['content-encoding']&&request.headers['content-encoding']!=='identity')throw new StudioAccessError(400,'INVALID_REQUEST');
  const timer=setTimeout(()=>request.destroy(),5000);timer.unref();const chunks:Buffer[]=[];let bytes=0;
  try{for await(const chunk of request){const data=Buffer.from(chunk);bytes+=data.length;if(bytes>1024)throw new StudioAccessError(400,'INVALID_REQUEST');chunks.push(data);}}
  finally{clearTimeout(timer);}
  let value:unknown;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new StudioAccessError(400,'INVALID_REQUEST');}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||!('ticket' in value)||!validSecret(value.ticket))throw new StudioAccessError(400,'INVALID_REQUEST');
  return value.ticket;
 }
 async exchange(request:IncomingMessage,response:ServerResponse){
  this.#headers(request,true);
  if(request.method!=='POST'||request.headers.authorization)throw new StudioAccessError(403,'ORIGIN_REJECTED');
  const ticket=await this.#body(request);this.#headers(request,true);this.#collect();
  const stored=this.#tickets.get(key(ticket));if(!stored||this.now()>=stored.expires_at)throw new StudioAccessError(401,'UNAUTHORIZED');
  this.#alive(stored.grant);
  let session=this.#existing(stored.grant);
  if(!session){
   if(this.#proofs.size>=64)throw new StudioAccessError(503,'CAPABILITY_UNAVAILABLE');
   session=Object.freeze({grant:stored.grant,proof:secret(),read_token:secret(),expires_at:this.now()+28800000});
   this.#proofs.set(key(session.proof),session);this.#reads.set(key(session.read_token),session);
  }
  this.#tickets.delete(key(ticket));
  response.setHeader('Set-Cookie',this.cookieName+'='+this.#cookie+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800');
  response.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  response.end(JSON.stringify({csrf:session.proof,read_token:session.read_token,expires_at:session.expires_at,path:'/projects/'+encodeURIComponent(session.grant.native_project_id)+'?target='+encodeURIComponent(session.grant.project_id),project_id:session.grant.project_id,native_project_id:session.grant.native_project_id}));
 }
}
