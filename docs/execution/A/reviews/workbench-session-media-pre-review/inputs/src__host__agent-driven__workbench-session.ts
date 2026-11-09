import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {AgentAuthError, ScopedAgentAuth} from './scoped-auth.js';

const hash=(value:string)=>createHash('sha256').update(value).digest();
const secret=()=>randomBytes(32).toString('base64url');
const TICKET_MS=5*60*1000;
const SESSION_MS=8*60*60*1000;
const LIMIT=64;
const PREFIX='/api/workbench/session';
interface Ticket {expires:number}
interface Session {token:string;csrf:string;expires:number}
class EntryError extends Error {
 constructor(readonly status:number,readonly code:string){super(code);}
}
function reply(response:ServerResponse,status:number,body:unknown){
 response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
 response.end(JSON.stringify(body));
}
/** UI transport only. Operator authority is intentionally NOT a driver/MCP credential.
 * Owning a browser session proves a transport, never a creative approval or asset license.
 * The enclosing owned runtime supplies the operator secret out of band, separately from
 * connection.json; no ordinary Agent tool can mint or retrieve one.
 */
export class WorkbenchSessionService {
 readonly #operatorDigest:Buffer;
 readonly #browserProof=secret();
 readonly #tickets=new Map<string,Ticket>();
 readonly #sessions=new Map<string,Session>();
 #closed=false;
 constructor(private readonly auth:ScopedAgentAuth,private readonly origin:()=>string,
  private readonly principalId:string,operatorSecret:string,private readonly now:()=>number=Date.now){
  if(!/^[A-Za-z0-9_-]{43}$/.test(operatorSecret)||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(principalId))throw new Error('INVALID_WORKBENCH_CONFIGURATION');
  this.#operatorDigest=hash(operatorSecret);
 }
 close(){this.#closed=true;this.#tickets.clear();for(const session of this.#sessions.values())this.auth.revoke(session.token);this.#sessions.clear();}
 #collect(){
  for(const [key,value] of this.#tickets)if(this.now()>=value.expires)this.#tickets.delete(key);
  for(const [key,value] of this.#sessions)if(this.now()>=value.expires)this.#sessions.delete(key);
 }
 #boundary(request:IncomingMessage){
  let wanted:URL;try{wanted=new URL(this.origin());}catch{throw new EntryError(403,'ORIGIN_REJECTED');}
  if(wanted.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(wanted.hostname)||request.headers.host!==wanted.host)throw new EntryError(403,'ORIGIN_REJECTED');
  const counts=new Map<string,number>();
  for(let i=0;i<request.rawHeaders.length;i+=2){const key=request.rawHeaders[i]!.toLowerCase();counts.set(key,(counts.get(key)??0)+1);}
  if(['host','origin','authorization','cookie','x-narralens-csrf','content-type'].some(key=>(counts.get(key)??0)>1))throw new EntryError(403,'ORIGIN_REJECTED');
  if(request.headers.origin!==wanted.origin){
   let same=false;
   if(request.headers.origin===undefined&&request.headers['sec-fetch-site']==='same-origin'&&request.headers.referer){try{same=new URL(request.headers.referer).origin===wanted.origin;}catch{}}
   if(!same)throw new EntryError(403,'ORIGIN_REJECTED');
  }
  if(this.#closed)throw new EntryError(503,'CAPABILITY_UNAVAILABLE');
 }
 async #body(request:IncomingMessage,fields:readonly string[]):Promise<Record<string,unknown>>{
  if(request.headers['content-type']?.split(';')[0]?.trim().toLowerCase()!=='application/json')throw new EntryError(400,'INVALID_REQUEST');
  if(request.headers['content-encoding']&&request.headers['content-encoding']!=='identity')throw new EntryError(400,'INVALID_REQUEST');
  const chunks:Buffer[]=[];let bytes=0;
  const deadline=setTimeout(()=>request.destroy(),5000);deadline.unref();
  try{
   for await(const chunk of request){const part=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=part.length;if(bytes>1024)throw new EntryError(413,'INVALID_REQUEST');chunks.push(part);}
  }finally{clearTimeout(deadline);}
  let value:unknown;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new EntryError(400,'INVALID_REQUEST');}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==fields.length||fields.some(field=>!Object.hasOwn(value,field))||Object.keys(value).some(key=>!fields.includes(key)))throw new EntryError(400,'INVALID_REQUEST');
  return value as Record<string,unknown>;
 }
 #principal(request:IncomingMessage){
  if(typeof request.headers['x-narralens-csrf']!=='string')throw new EntryError(403,'ORIGIN_REJECTED');
  return this.auth.authenticate({method:request.method??'',origin:request.headers.origin,authorization:request.headers.authorization,
   ...(request.headers.cookie?{cookie:request.headers.cookie}:{}),
   ...(typeof request.headers['x-narralens-csrf']==='string'?{csrf:request.headers['x-narralens-csrf']}:{}),
   ...(request.headers.referer?{referer:request.headers.referer}:{}),
   ...(typeof request.headers['sec-fetch-site']==='string'?{secFetchSite:request.headers['sec-fetch-site']}:{}),rawHeaders:request.rawHeaders},'trusted_ui');
 }
 #issue(response:ServerResponse){
  let active:{ref:string;session:Session}|undefined;
  for(const [ref,session] of this.#sessions){
   try{
    const principal=this.auth.renewTrustedUi(session.token,Math.max(session.expires,this.now()+SESSION_MS));
    session.expires=principal.expires_at;active={ref,session};break;
   }catch(error){if(!(error instanceof AgentAuthError))throw error;this.#sessions.delete(ref);}
  }
  if(!active){
   const issued=this.auth.issue({principal_id:this.principalId,channel:'trusted_ui',expires_at:this.now()+SESSION_MS},{csrf:this.#browserProof});
   const session={token:issued.token,csrf:issued.csrf!,expires:issued.principal.expires_at};
   this.#sessions.set(issued.principal.session_ref,session);active={ref:issued.principal.session_ref,session};
  }
  const {ref,session}=active;
  response.setHeader('Set-Cookie',`${this.auth.cookieName}=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(0,Math.floor((session.expires-this.now())/1000))}`);
  return {principal_id:this.principalId,session_ref:ref,csrf:session.csrf,expires_at:session.expires};
 }
 /** Returns false for unrelated paths so existing routing remains authoritative. */
 async handle(request:IncomingMessage,response:ServerResponse):Promise<boolean>{
  const path=new URL(request.url??'/', 'http://127.0.0.1').pathname;
  if(path!==PREFIX&&!path.startsWith(PREFIX+'/'))return false;
  try{
   this.#boundary(request);this.#collect();
   if(path===PREFIX+'/open'&&request.method==='POST'){
    const bearer=request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if(!bearer||request.headers.cookie||!timingSafeEqual(hash(bearer),this.#operatorDigest))throw new EntryError(401,'UNAUTHORIZED');
    await this.#body(request,[]);
    if(this.#closed)throw new EntryError(503,'CAPABILITY_UNAVAILABLE');
    if(this.#tickets.size>=LIMIT)throw new EntryError(503,'CAPABILITY_UNAVAILABLE');
    const ticket=secret(),expires=this.now()+TICKET_MS;this.#tickets.set(hash(ticket).toString('hex'),{expires});
    reply(response,200,{url:this.origin()+'/#workbench_ticket='+ticket,expires_at:expires});
   }else if(path===PREFIX+'/exchange'&&request.method==='POST'){
    if(request.headers.authorization)throw new EntryError(403,'ORIGIN_REJECTED');
    const body=await this.#body(request,['ticket']);
    if(this.#closed)throw new EntryError(503,'CAPABILITY_UNAVAILABLE');
    if(typeof body.ticket!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.ticket))throw new EntryError(401,'UNAUTHORIZED');
    const key=hash(body.ticket).toString('hex'),ticket=this.#tickets.get(key);
    if(!ticket||this.now()>=ticket.expires)throw new EntryError(401,'UNAUTHORIZED');
    const session=this.#issue(response);this.#tickets.delete(key);reply(response,200,session);
   }else if(path===PREFIX&&request.method==='GET'){
    const principal=this.#principal(request),session=this.#sessions.get(principal.session_ref);
    if(!session)throw new EntryError(401,'UNAUTHORIZED');
    reply(response,200,{principal_id:principal.principal_id,session_ref:principal.session_ref,csrf:session.csrf,expires_at:session.expires});
   }else if(path===PREFIX+'/renew'&&request.method==='POST'){
    const principal=this.#principal(request);
    if(!this.#sessions.has(principal.session_ref))throw new EntryError(401,'UNAUTHORIZED');
    await this.#body(request,[]);if(this.#closed)throw new EntryError(503,'CAPABILITY_UNAVAILABLE');
    const current=this.#principal(request);
    if(current.session_ref!==principal.session_ref||!this.#sessions.has(current.session_ref))throw new EntryError(401,'UNAUTHORIZED');
    // Stable cookie/proof remain valid even when a renewal response is lost.
    reply(response,200,this.#issue(response));
   }else throw new EntryError(404,'NOT_FOUND');
  }catch(error){
   const status=error instanceof EntryError?error.status:error instanceof AgentAuthError?(error.code==='UNAUTHORIZED'?401:403):503;
   const code=error instanceof EntryError||error instanceof AgentAuthError?error.code:'CAPABILITY_UNAVAILABLE';
   if(!response.destroyed&&!response.headersSent)reply(response,status,{error:{code,message:'工作台会话不可用，请从本机启动入口重新打开。'}});
  }
  return true;
 }
}
