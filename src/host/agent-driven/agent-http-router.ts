import type { IncomingMessage,ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { ApplicationPorts,Error as WireError } from '../../contracts/agent-driven-types.js';
import { agentRoutes,validateAgentRouteInput,validateAgentRouteOutput,validateAgentDefinition,type AgentRouteId } from '../../contracts/agent-driven-validator.js';
import registry from '../../../contracts/agent-driven-a.registry.json' with {type:'json'};
import { ScopedAgentAuth,type AgentPrincipal,type AgentChannel } from './scoped-auth.js';
import {agentErrorCode} from './agent-error-alias.js';
import { CursorRejection,rejectionToCode } from '../observability/cursor.js';

export interface AgentDispatcher {
 invoke<K extends AgentRouteId>(id:K,input:Parameters<ApplicationPorts[K]>[0],principal:AgentPrincipal):Promise<Awaited<ReturnType<ApplicationPorts[K]>>>;
}
export class AgentRouteError extends Error {
 constructor(readonly code:WireError['code']){super('The requested operation could not be completed');}
}
const statusMap=new Map(registry.errorMapping.map(row=>[row.code,row.http_status]));
export const MAX_AGENT_BODY_BYTES=1024*1024;
function pathFields(pattern:string,path:string):Record<string,string>|null {
 const wanted=pattern.split('/'),actual=path.split('/');if(wanted.length!==actual.length)return null;
 const out:Record<string,string>=Object.create(null) as Record<string,string>;
 for(let i=0;i<wanted.length;i++){
  const part=wanted[i]!;
  if(!part.startsWith(':')){if(part!==actual[i])return null;continue;}
  let value:string;try{value=decodeURIComponent(actual[i]!);}catch{throw new AgentRouteError('INVALID_REQUEST');}
  if(!value||/[\\/\0]/.test(value))throw new AgentRouteError('INVALID_REQUEST');
  const name=part.slice(1);
  const field=name==='id'?(pattern.includes('/intakes/')?'intake_id':'project_id'):({job:'job_id',run:'run_id',impact:'impact_id',question:'question_id',package:'package_id'} as Record<string,string>)[name];
  if(!field)throw new AgentRouteError('INTERNAL_ERROR');out[field]=value;
 }
 return out;
}
async function jsonBody(request:IncomingMessage):Promise<Record<string,unknown>> {
 if((request.headers['content-type']??'').split(';')[0]?.trim().toLowerCase()!=='application/json')throw new AgentRouteError('INVALID_REQUEST');
 const chunks:Buffer[]=[];let size=0;
 await new Promise<void>((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timer);request.off('data',onData);request.off('end',onEnd);request.off('error',onError);request.off('aborted',onAborted);};
  const fail=(error:unknown)=>{cleanup();request.pause();request.once('error',()=>{});reject(error);};
  const onData=(value:Buffer|string)=>{const chunk=Buffer.isBuffer(value)?value:Buffer.from(value);size+=chunk.length;if(size>MAX_AGENT_BODY_BYTES){fail(new AgentRouteError('PAYLOAD_TOO_LARGE'));return;}chunks.push(chunk);};
  const onEnd=()=>{cleanup();resolve();};
  const onError=()=>fail(new AgentRouteError('INVALID_REQUEST'));
  const onAborted=()=>fail(new AgentRouteError('INVALID_REQUEST'));
  const timer=setTimeout(()=>fail(new AgentRouteError('INVALID_REQUEST')),5000);timer.unref();
  request.on('data',onData);request.once('end',onEnd);request.once('error',onError);request.once('aborted',onAborted);
 });
 let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AgentRouteError('INVALID_REQUEST');}
 if(!body||typeof body!=='object'||Array.isArray(body))throw new AgentRouteError('INVALID_REQUEST');
 return body as Record<string,unknown>;
}
function send(response:ServerResponse,status:number,body:unknown){
 if(response.destroyed||response.writableEnded)return;
 response.statusCode=status;response.setHeader('Content-Type','application/json; charset=utf-8');response.setHeader('Cache-Control','no-store');response.end(JSON.stringify(body));
}
function failure(error:unknown,correlation:string):WireError {
 let code:string=error instanceof CursorRejection?rejectionToCode(error.kind):agentErrorCode(error);
 if(!statusMap.has(code))code='INTERNAL_ERROR';
 const next=code==='UNAUTHORIZED'?['reconnect_authorized_instance']:code==='ORIGIN_REJECTED'?['open_trusted_workbench']:code==='CURSOR_EXPIRED'?['resync_snapshot']:code==='PROVIDER_RESULT_UNKNOWN'?['reconcile_same_idempotency_key']:code==='INVALID_REQUEST'?['correct_request']:['read_current_context'];
 return validateAgentDefinition<WireError>('Error',{schema_version:'agent.v1',correlation_id:correlation,code,http_status:statusMap.get(code),message:'请求未完成，请按当前权限和状态处理',retryable:code==='HOST_RESOURCE_EXHAUSTED',next_actions:next});
}
/** Mounted by the ONE Host. Transport owns validation/identity, never domain facts or project commits. */
export class AgentHttpRouter {
 constructor(private readonly auth:ScopedAgentAuth,private readonly origin:()=>string,private readonly dispatcher:AgentDispatcher){}
 async handle(request:IncomingMessage,response:ServerResponse):Promise<void> {
  let correlation='request_'+randomBytes(12).toString('hex');
  try {
   const headers={method:request.method??'',origin:request.headers.origin,authorization:request.headers.authorization,
    ...(request.headers.cookie?{cookie:request.headers.cookie}:{}),
    ...(typeof request.headers['x-narralens-csrf']==='string'?{csrf:request.headers['x-narralens-csrf']}:{}),
    ...(request.headers.referer?{referer:request.headers.referer}:{}),
    ...(typeof request.headers['sec-fetch-site']==='string'?{secFetchSite:request.headers['sec-fetch-site']}:{}),rawHeaders:request.rawHeaders};
   this.auth.authenticate(headers); // BEFORE route/resource lookup and body parse.
   const url=new URL(request.url??'/',this.origin());
   if(url.origin!==new URL(this.origin()).origin)throw new AgentRouteError('ORIGIN_REJECTED');
   let found:(typeof agentRoutes)[number]|undefined,params:Record<string,string>|null=null;
   for(const route of agentRoutes){if(route.method!==request.method)continue;const fields=pathFields(route.path,url.pathname);if(fields){found=route;params=fields;break;}}
   if(!found||!params)throw new AgentRouteError('NOT_FOUND');
   const principal=this.auth.authenticate(headers,found.authChannel as AgentChannel);
   const id=found.id as AgentRouteId;
   let body:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
   if(request.method==='GET'){
    for(const [key,value] of url.searchParams){if(Object.hasOwn(body,key)||Object.hasOwn(params,key))throw new AgentRouteError('INVALID_REQUEST');body[key]=value;}
    if(id==='events.snapshot'){
     body.cursor??=null;body.last_event_id??=null;
     const last=request.headers['last-event-id'];
     if(last!==undefined){if(typeof last!=='string'||body.last_event_id!==null&&body.last_event_id!==last)throw new AgentRouteError('INVALID_REQUEST');body.last_event_id=last;}
    }
   } else {
    if(url.search)throw new AgentRouteError('INVALID_REQUEST');
    body=await jsonBody(request);
   }
   for(const [field,value] of Object.entries(params)){
    if(id==='editor.native.ack'&&field==='project_id'){
     // The frozen DTO nests its identity in ack; do not invent a top-level field.
     const ack=body.ack;
     if(!ack||typeof ack!=='object'||Array.isArray(ack)||!('project_id' in ack)||ack.project_id!==value)throw new AgentRouteError('INVALID_REQUEST');
     continue;
    }
    if(Object.hasOwn(body,field)&&body[field]!==value)throw new AgentRouteError('INVALID_REQUEST');
    body[field]=value;
   }
   // Preserve all unknown fields: stripping them before validation would defeat additionalProperties.
   const input=validateAgentRouteInput(id,found.input===null?(Object.keys(body).length?body:undefined):body);
   if(input&&typeof input==='object'&&'meta' in input){const meta=input.meta as {correlation_id?:unknown};if(typeof meta.correlation_id==='string')correlation=meta.correlation_id;}
   const result=await this.dispatcher.invoke(id,input,principal);
   let output:unknown;try{output=validateAgentRouteOutput(id,result);}catch{throw new AgentRouteError('INTERNAL_ERROR');}
   send(response,id==='project.create'||id==='task.prepare'?202:200,output);
  } catch(error){
   const body=failure(error,correlation);
   if(!request.complete)response.setHeader('Connection','close');
   send(response,body.http_status,body);
  }
 }
}
