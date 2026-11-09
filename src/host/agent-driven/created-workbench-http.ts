import type {IncomingMessage,ServerResponse} from 'node:http';
import {randomUUID} from 'node:crypto';
import {validateAgentDefinition} from '../../contracts/agent-driven-validator.js';
import type {AgentPrincipal,ScopedAgentAuth} from './scoped-auth.js';
import {createTrustedCallerContext} from '../creative/trusted-context.js';
import {AgentRouteError} from './agent-http-router.js';
import {agentErrorCode} from './agent-error-alias.js';
import registry from '../../../contracts/agent-driven-a.registry.json' with {type:'json'};
import type {CreatedWorkbenchService} from './created-workbench-service.js';
const statuses=new Map(registry.errorMapping.map(row=>[row.code,row.http_status]));
/** UI-only pure read. No new Agent tool, operator secret, or anonymous Gateway authority. */
export class CreatedWorkbenchHttp {
 constructor(private readonly auth:ScopedAgentAuth,private readonly origin:()=>string,private readonly service:CreatedWorkbenchService,private readonly openNative?:(projectId:string,principal:AgentPrincipal)=>Promise<unknown>){}
 async handle(request:IncomingMessage,response:ServerResponse):Promise<boolean>{
  const url=new URL(request.url??'/',this.origin());
  if(!url.pathname.startsWith('/api/ui/v1/'))return false;
  const send=(status:number,body:unknown)=>{if(response.destroyed||response.writableEnded)return;response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});response.end(JSON.stringify(body));};
  try{
   if(url.origin!==this.origin()||request.headers.host!==new URL(this.origin()).host)throw new AgentRouteError('ORIGIN_REJECTED');
   let hosts=0;for(let i=0;i<request.rawHeaders.length;i+=2)if(request.rawHeaders[i]!.toLowerCase()==='host')hosts++;if(hosts!==1)throw new AgentRouteError('ORIGIN_REJECTED');
   const headers={method:request.method??'',origin:request.headers.origin,authorization:request.headers.authorization,...(request.headers.cookie?{cookie:request.headers.cookie}:{}),...(typeof request.headers['x-narralens-csrf']==='string'?{csrf:request.headers['x-narralens-csrf']}:{}),...(request.headers.referer?{referer:request.headers.referer}:{}),...(typeof request.headers['sec-fetch-site']==='string'?{secFetchSite:request.headers['sec-fetch-site']}:{}),rawHeaders:request.rawHeaders};
   const principal=this.auth.authenticate(headers,'trusted_ui');
   // A local same-host service receives cookies across ports. It cannot read this UI
   // without the proof held only in the correct origin's sessionStorage.
   if(!headers.csrf)throw new AgentRouteError('ORIGIN_REJECTED');
   const match=url.pathname.match(/^\/api\/ui\/v1\/projects\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/(created-workbench|native-open)$/);
   if(!match)throw new AgentRouteError('NOT_FOUND');
   if(match[2]==='native-open'){
    if(request.method!=='POST'||!this.openNative)throw new AgentRouteError('NOT_FOUND');
    if(url.search||request.headers['content-type']?.split(';')[0]?.trim()!=='application/json'||request.headers['content-encoding']&&request.headers['content-encoding']!=='identity')throw new AgentRouteError('INVALID_REQUEST');
    const chunks:Buffer[]=[];let size=0;const timer=setTimeout(()=>request.destroy(),5000);timer.unref();
    try{for await(const chunk of request){const data=Buffer.from(chunk);size+=data.length;if(size>1024)throw new AgentRouteError('PAYLOAD_TOO_LARGE');chunks.push(data);}}finally{clearTimeout(timer);}
    let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AgentRouteError('INVALID_REQUEST');}
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw new AgentRouteError('INVALID_REQUEST');
    const current=this.auth.authenticate(headers,'trusted_ui');
    if(current.session_ref!==principal.session_ref||current.principal_id!==principal.principal_id)throw new AgentRouteError('UNAUTHORIZED');
    const result=await this.openNative(match[1]!,current);this.auth.authenticate(headers,'trusted_ui');send(200,result);return true;
   }
   if(request.method!=='GET')throw new AgentRouteError('NOT_FOUND');
   if(url.search||request.headers['transfer-encoding']||Number(request.headers['content-length']??0)!==0)throw new AgentRouteError('INVALID_REQUEST');
   const value=await this.service.read(match[1]!,createTrustedCallerContext({principal_id:principal.principal_id,channel:'trusted_ui',source:'trusted_ui',session_ref:principal.session_ref}));
   const current=this.auth.authenticate(headers,'trusted_ui');
   if(current.session_ref!==principal.session_ref||current.principal_id!==principal.principal_id)throw new AgentRouteError('UNAUTHORIZED');
   send(200,value);
  }catch(error){const code=agentErrorCode(error),status=statuses.get(code)??500;send(status,{error:validateAgentDefinition('Error',{schema_version:'agent.v1',correlation_id:randomUUID(),code,http_status:status,message:'无法读取当前工程，请确认会话与项目状态。',retryable:code==='HOST_RESOURCE_EXHAUSTED',next_actions:['open_trusted_workbench']})});}
  return true;
 }
}
