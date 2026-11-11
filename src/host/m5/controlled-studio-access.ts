import type {CreatedWorkbenchProjection} from '../../contracts/created-workbench.js';
import {PREPARED_REVIEW_MAX_READ_BYTES} from '../render/assembly-ports.js';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';

/**
 * The independent workbench UI delegate (CR-R1-001 §2).
 *
 * It is a **second, separate purpose** — not a wider native session. The native grant
 * below can read the native workbench projection and can never approve anything. This
 * grant can call the closed workbench RPC set, and it can open a prepared review medium,
 * and it still cannot write to the native editor.
 *
 * The value is never built from a request body. The Host's own authenticated
 * `trusted_ui` branch creates it, and it carries the real principal, the real project and
 * the real owner session; the browser can neither name a principal nor widen it.
 */

/** The three closed surfaces the UI delegate may reach. */
export type NativeStudioUiSurface='agent.v1'|'local-assets.v1'|'workbench.v1';

/** One closed UI call: a surface, an operation, and the original input DTO. */
export interface NativeStudioUiInvokeInput{
 readonly surface:NativeStudioUiSurface;
 readonly operation:string;
 readonly input:unknown;
 readonly correlation_id:string;
}

/** The Host's own answer: the status and the body it would have answered itself. */
export interface NativeStudioUiInvokeResult{
 readonly status:number;
 readonly body:unknown;
}

/** A byte range inside one prepared review object. */
export interface NativeStudioUiMediaRange{
 readonly offset:number;
 readonly length:number;
}

/**
 * One opened review medium.
 *
 * The reader is a verified handle, not a path and not a URL: the bytes come from the
 * object the Host has already bound to the current package, and `close` releases it. The
 * caller closes it in a `finally`, on success and on failure alike.
 */
export interface NativeStudioUiReviewMedia{
 readonly content_type:string;
 readonly bytes:number;
 readonly sha256:string;
 /** The quoted sha256, as the media alias answers it. */
 readonly etag:string;
 readonly read:(range:NativeStudioUiMediaRange)=>Promise<Uint8Array>;
 readonly close:()=>Promise<void>;
}

/**
 * The UI delegate a native grant may carry.
 *
 * It is optional: a native entry without it stays native-only, and the browser is told
 * the workbench surface is not ready rather than being handed a native proof that would
 * look like one.
 */
export interface NativeStudioUiGrantV1{
 /** The project the delegate is bound to. It is never taken from the request. */
 readonly project_id:string;
 readonly owner_session_ref:string;
 readonly instance_generation:number;
 /** The delegate's own expiry. It never outlasts its parent session. */
 readonly expires_at:number;
 /** Re-checks the real parent session's liveness, owner and generation. */
 readonly isCurrent:()=>boolean;
 /** Calls the Host's own closed dispatcher. It never loops back through HTTP. */
 readonly invoke:(input:NativeStudioUiInvokeInput)=>Promise<NativeStudioUiInvokeResult>;
 /** Opens one prepared review object for reading. */
 readonly openReviewMedia:(input:{readonly ref:string;readonly range?:NativeStudioUiMediaRange;readonly signal?:AbortSignal})=>Promise<NativeStudioUiReviewMedia>;
}

export interface NativeStudioGrant {
 readonly project_id:string;readonly native_project_id:string;
 readonly owner_session_ref:string;readonly instance_generation:number;
 readonly revision:number;readonly snapshot_id:string;readonly source_digest:string;
 /** Captures authenticated owner and exact Host-issued prepared view, never body fields. */
 readonly isCurrent:()=>boolean;
 readonly readWorkbench:()=>Promise<CreatedWorkbenchProjection>;
 /**
 * The optional independent UI delegate.
 *
 * It is a separate purpose with its own cookie, its own proof and its own lifetime: the
 * native session may go stale after a commit while this delegate may still read the new
 * Context, and the native proof can never stand in for it.
 */
 readonly ui?:NativeStudioUiGrantV1;
}
export interface NativeStudioSession {readonly grant:NativeStudioGrant;readonly proof:string;readonly read_token:string;readonly expires_at:number}
/** The independent UI session: its own proof, its own expiry, its own lifetime. */
export interface NativeStudioUiSession {readonly grant:NativeStudioUiGrantV1;readonly proof:string;readonly expires_at:number}
interface Ticket {grant:NativeStudioGrant;expires_at:number}
const digest=(value:string)=>createHash('sha256').update(value).digest();
const key=(value:string)=>digest(value).toString('hex');
const secret=()=>randomBytes(32).toString('base64url');
const validSecret=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
/** The UI delegate never outlasts its parent, and never longer than eight hours. */
const UI_MAX_LIFETIME_MS=8*60*60*1000;
/**
 * One read never asks for more than one mebibyte. A *requested range* may be larger.
 *
 * The bound is MEDIA's own: the prepared reader serves at most one mebibyte per read,
 * and the transport here does not widen it.
 */
export const UI_MAX_READ_BYTES=PREPARED_REVIEW_MAX_READ_BYTES;
/** The header that carries the independent UI proof. */
export const UI_CSRF_HEADER='x-narralens-workbench-csrf';
export class StudioAccessError extends Error {
 constructor(readonly status:number,readonly code:'UNAUTHORIZED'|'ORIGIN_REJECTED'|'INVALID_REQUEST'|'NOT_FOUND'|'NATIVE_SESSION_STALE'|'CAPABILITY_UNAVAILABLE'|'RANGE_NOT_SATISFIABLE'){super('The controlled native session is unavailable');}
}
/** Ephemeral browser transport, not a business fact store or an approval authority. */
export class ControlledStudioAccess {
 readonly cookieName='narralens_native_'+randomBytes(12).toString('hex');
 /** A different cookie, with a different secret: the native cookie never opens the UI. */
 readonly uiCookieName='narralens_ui_'+randomBytes(12).toString('hex');
 readonly #cookie=secret();
 readonly #uiCookie=secret();
 readonly #tickets=new Map<string,Ticket>();
 readonly #proofs=new Map<string,NativeStudioSession>();
 readonly #reads=new Map<string,NativeStudioSession>();
 readonly #retired=new Map<string,number>();
 readonly #uiProofs=new Map<string,NativeStudioUiSession>();
 readonly #uiRetired=new Map<string,number>();
 #closed=false;
 constructor(private readonly origin:()=>string,private readonly now:()=>number=Date.now){}
 close(){this.#closed=true;this.#tickets.clear();this.#proofs.clear();this.#reads.clear();this.#retired.clear();this.#uiProofs.clear();this.#uiRetired.clear();}
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
 /**
  * The UI sessions are collected on their own terms.
  *
  * A native session that goes stale after a commit must not take the still-valid UI
  * delegate with it: the delegate's lifetime is its parent's *session*, not the native
  * revision the editor happens to be showing.
  */
 #collectUi(){
  const now=this.now();
  for(const [k,s] of this.#uiProofs){
   if(now>=s.expires_at||!this.#uiCurrent(s.grant)){
    this.#uiProofs.delete(k);
    if(now<s.expires_at)this.#uiRetired.set('u:'+k,Math.min(s.expires_at,now+300000));
   }
  }
  for(const [k,expires] of this.#uiRetired)if(now>=expires)this.#uiRetired.delete(k);
  while(this.#uiRetired.size>256)this.#uiRetired.delete(this.#uiRetired.keys().next().value!);
 }
 #uiCurrent(grant:NativeStudioUiGrantV1){try{return !this.#closed&&grant.isCurrent();}catch{return false;}}
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
 #headers(request:IncomingMessage,requireOrigin:boolean,extra:readonly string[]=[]){
  const expected=new URL(this.origin());
  if(request.headers.host!==expected.host)throw new StudioAccessError(403,'ORIGIN_REJECTED');
  const counts=new Map<string,number>();for(let i=0;i<request.rawHeaders.length;i+=2){const name=request.rawHeaders[i]!.toLowerCase();counts.set(name,(counts.get(name)??0)+1);}
  if(['host','origin','cookie','authorization','x-narralens-native-csrf','content-type','sec-websocket-protocol',...extra].some(name=>(counts.get(name)??0)>1))throw new StudioAccessError(403,'ORIGIN_REJECTED');
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

 // ── the independent UI delegate ───────────────────────────────────────────────────────

 /**
  * The UI session a native ticket yields, when — and only when — the Host's grant
  * carries a real UI delegate.
  *
  * The UI credential is minted here, from the grant, and never from the request: the
  * browser cannot ask for one, and the native proof cannot be traded for one.
  */
 #mintUi(grant:NativeStudioGrant):NativeStudioUiSession|null{
  const ui=grant.ui;if(ui===undefined)return null;
  if(ui.project_id!==grant.project_id)throw new StudioAccessError(503,'CAPABILITY_UNAVAILABLE');
  if(ui.owner_session_ref!==grant.owner_session_ref||ui.instance_generation!==grant.instance_generation)throw new StudioAccessError(503,'CAPABILITY_UNAVAILABLE');
  if(!Number.isSafeInteger(ui.expires_at)||ui.expires_at<=this.now())return null;
  // The parent must still be live: a revoked or stale parent mints no UI credential at
  // all, so the exchange never hands out a proof that could not be used.
  if(!this.#current(grant)||!this.#uiCurrent(ui))return null;
  if(this.#uiProofs.size>=64)throw new StudioAccessError(503,'CAPABILITY_UNAVAILABLE');
  const expires_at=Math.min(ui.expires_at,this.now()+UI_MAX_LIFETIME_MS);
  const session:NativeStudioUiSession=Object.freeze({grant:ui,proof:secret(),expires_at});
  this.#uiProofs.set(key(session.proof),session);
  return session;
 }
 /** The UI session's own proof, for the exchange answer. */
 uiProof(session:NativeStudioUiSession):string{return session.proof;}
 /** Re-check one UI session: it must exist, not have expired, and its parent must be live. */
 recheckUi(session:NativeStudioUiSession):NativeStudioUiSession{
  if(this.#closed)throw new StudioAccessError(503,'CAPABILITY_UNAVAILABLE');
  if(this.#uiProofs.get(key(session.proof))!==session||this.now()>=session.expires_at)throw new StudioAccessError(401,'UNAUTHORIZED');
  if(!this.#uiCurrent(session.grant))throw new StudioAccessError(409,'NATIVE_SESSION_STALE');
  return session;
 }
 /**
  * Authenticate a UI request.
  *
  * The order is the contract's: the Host header, then the origin, then the duplicated
  * headers, then the independent cookie and proof, then the parent's liveness. A native
  * cookie, a `native_read` token, a Host bearer or another project's proof is not a
  * substitute: none of them is in this check.
  */
 authenticateUi(request:IncomingMessage):NativeStudioUiSession{
  this.#headers(request,true,[UI_CSRF_HEADER]);this.#collectUi();
  if(request.headers.authorization)throw new StudioAccessError(403,'ORIGIN_REJECTED');
  const proof=request.headers[UI_CSRF_HEADER];
  if(!validSecret(proof))throw new StudioAccessError(401,'UNAUTHORIZED');
  const cookies=(request.headers.cookie??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(this.uiCookieName+'='));
  if(cookies.length!==1||!timingSafeEqual(digest(cookies[0]!.slice(this.uiCookieName.length+1)),digest(this.#uiCookie)))throw new StudioAccessError(401,'UNAUTHORIZED');
  const session=this.#uiProofs.get(key(proof));
  if(!session)throw new StudioAccessError(this.#uiRetired.has('u:'+key(proof))?409:401,this.#uiRetired.has('u:'+key(proof))?'NATIVE_SESSION_STALE':'UNAUTHORIZED');
  return this.recheckUi(session);
 }
 /**
  * One closed UI call.
  *
  * The delegate's fixed project is the only project: an input that names another one is
  * refused before it reaches the Host. Everything else is passed on verbatim, so the
  * Host's own DTO validators see exactly what the caller sent.
  */
 async invokeUi(session:NativeStudioUiSession,input:{surface:string;operation:string;input:unknown;correlation_id:string}):Promise<{status:number;body:unknown}>{
  this.recheckUi(session);
  const body=input.input;
  if(body!==null&&typeof body==='object'&&!Array.isArray(body)){
   const named=(body as {project_id?:unknown}).project_id;
   if(typeof named==='string'&&named!==session.grant.project_id)throw new StudioAccessError(403,'ORIGIN_REJECTED');
  }
  const result=await session.grant.invoke({
   surface:input.surface as NativeStudioUiSurface,
   operation:input.operation,
   input:body,
   correlation_id:input.correlation_id,
  });
  this.recheckUi(session);
  return {status:result.status,body:result.body};
 }
 /**
  * Open one prepared review object.
  *
  * The requested range is bounded here, before the Host is asked: it is a window into
  * the object, never a path, never a URL and never an unbounded range. A range may be
  * larger than one mebibyte — the limit of one mebibyte is the limit of a single
  * *read*, and the caller reads the window in bounded pieces.
  *
  * When the parent is revoked while the object is being opened, the reader that was
  * just handed out is closed here: the caller never receives it, so it can never leak.
  */
 async openUiMedia(session:NativeStudioUiSession,ref:string,range?:NativeStudioUiMediaRange,signal?:AbortSignal):Promise<NativeStudioUiReviewMedia>{
  this.recheckUi(session);
  if(typeof ref!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(ref))throw new StudioAccessError(400,'INVALID_REQUEST');
  if(range!==undefined){
   if(!Number.isSafeInteger(range.offset)||!Number.isSafeInteger(range.length)||range.offset<0||range.length<1||range.offset+range.length>Number.MAX_SAFE_INTEGER)throw new StudioAccessError(400,'INVALID_REQUEST');
  }
  signal?.throwIfAborted();
  const input={ref,...(range===undefined?{}:{range}),...(signal===undefined?{}:{signal})};
  // Opening may finish after a disconnect. The late handle still belongs to us and
  // must be closed even though the HTTP caller has already gone away.
  const media=await awaitUiOperation(session.grant.openReviewMedia(input),signal,
   async late=>{await late.close();});
  try{signal?.throwIfAborted();this.recheckUi(session);}
  catch(error){await media.close().catch(()=>undefined);throw error;}
  let closing:Promise<void>|undefined;
  const close=()=>closing??=Promise.resolve().then(()=>media.close());
  // The single-read bound belongs to the transport, so it is enforced here rather than
  // trusted: a caller can ask for a window, but never for an unbounded read.
  return Object.freeze({
   content_type:media.content_type,bytes:media.bytes,sha256:media.sha256,etag:media.etag,
   read:async(window:NativeStudioUiMediaRange)=>{
    if(!Number.isSafeInteger(window?.offset)||!Number.isSafeInteger(window?.length)||window.offset<0||window.length<1||window.length>UI_MAX_READ_BYTES)throw new StudioAccessError(400,'INVALID_REQUEST');
    if(closing!==undefined)throw new StudioAccessError(503,'CAPABILITY_UNAVAILABLE');
    signal?.throwIfAborted();this.recheckUi(session);
    const bytes=await awaitUiOperation(media.read(window),signal);
    signal?.throwIfAborted();this.recheckUi(session);
    return bytes;
   },
   close,
  });
 }

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
  // The UI delegate is minted from the grant alone. A native entry without one stays
  // native-only, and the browser is told so rather than being handed a second proof.
  const ui=this.#mintUi(stored.grant);
  const cookies=[`${this.cookieName}=${this.#cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`];
  const answer:{csrf:string;read_token:string;expires_at:number;path:string;project_id:string;native_project_id:string;ui?:{format:'narralens.gateway-ui-session@1';csrf:string;expires_at:number}}={
   csrf:session.proof,read_token:session.read_token,expires_at:session.expires_at,path:'/projects/'+encodeURIComponent(session.grant.native_project_id)+'?target='+encodeURIComponent(session.grant.project_id),project_id:session.grant.project_id,native_project_id:session.grant.native_project_id};
  if(ui!==null){
   cookies.push(`${this.uiCookieName}=${this.#uiCookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`);
   answer.ui={format:'narralens.gateway-ui-session@1',csrf:ui.proof,expires_at:ui.expires_at};
  }
  response.setHeader('Set-Cookie',cookies);
  response.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  response.end(JSON.stringify(answer));
 }
}

/** Cancel the consumer without losing ownership of a late opened resource. */
function awaitUiOperation<T>(operation:Promise<T>,signal?:AbortSignal,onLate?:(value:T)=>Promise<void>):Promise<T>{
 if(signal===undefined)return operation;
 return new Promise<T>((resolve,reject)=>{
  let settled=false,aborted=false;
  const cancel=()=>{
   if(settled)return;
   settled=true;aborted=true;signal.removeEventListener('abort',cancel);
   reject(signal.reason??new DOMException('Review media request cancelled','AbortError'));
  };
  operation.then(value=>{
   if(aborted){if(onLate!==undefined)void Promise.resolve().then(()=>onLate(value)).catch(()=>undefined);return;}
   settled=true;signal.removeEventListener('abort',cancel);resolve(value);
  },error=>{
   if(settled)return;
   settled=true;signal.removeEventListener('abort',cancel);reject(error);
  });
  signal.addEventListener('abort',cancel,{once:true});
  if(signal.aborted)cancel();
 });
}
