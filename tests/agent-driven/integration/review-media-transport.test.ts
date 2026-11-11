import {it,expect} from 'vitest';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {ScopedAgentAuth} from '../../../src/host/agent-driven/scoped-auth.js';
import {ReviewMediaHttp,type ReviewMediaBinding,type ReviewMediaBindingPort} from '../../../src/host/agent-driven/review-media-http.js';
import type {PreparedPreviewReceiptV1,PreparedReviewMediaHandleV1,PreparedReviewMediaReader} from '../../../src/host/render/assembly-ports.js';
import type {ReviewPart} from '../../../src/contracts/agent-driven-types.js';

/**
 * The review media transport's own behaviour, over a real scoped auth, a real binding
 * port shape and a test reader. There is no Host, no media and no Chromium here, and
 * the test reader is NOT the MEDIA producer: this is the transport's evidence, not the
 * producer's. Without the real producer the production surface stays fail closed.
 */
const ORIGIN='http://127.0.0.1:4173';
const PART:ReviewPart={kind:'preview',artifact_ref:{id:'artifact-1',version:1,sha256:'a'.repeat(64)},download_ref:null};
const SHA='e'.repeat(64);

/** The immutable receipt of a package whose preview object has exactly `bytes`. */
function receiptOf(bytes:number):PreparedPreviewReceiptV1{
 return {
  format:'narralens.prepared-preview-receipt@1',
  project_id:'project-1',
  run_id:'run-1',
  plan_version:1,
  step_id:'sample',
  execution_attempt:1,
  prepared_job_id:'job-1',
  prepared_source_id:'source-1',
  source_digest:'b'.repeat(64),
  plan_digest:'c'.repeat(64),
  rights_digest:'d'.repeat(64),
  producer_attempt:1,
  fps:{num:30,den:1},
  frame_count:90,
  parts:[{slot:'preview',object_id:'object-1',content_type:'video/mp4',bytes,sha256:SHA,media_facts:{kind:'video',fps:{num:30,den:1},frame_count:90}}],
  receipt_digest:'f'.repeat(64),
 };
}
function bindingOf(bytes:number):ReviewMediaBinding{
 return {
  project_id:'project-1',run_id:'run-1',package_id:'package-1',package_version:1,package_digest:'1'.repeat(64),
  part:PART,receipt:receiptOf(bytes),object_id:'object-1',slot:'preview',
 };
}

interface Recorded{readonly status:number;readonly headers:Record<string,unknown>;readonly chunks:Buffer[];}
function mockRequest(url:string,options:{method?:string;headers?:Record<string,string>;body?:string}={}):IncomingMessage{
 const headers={host:'127.0.0.1:4173',origin:ORIGIN,...(options.headers??{})};
 const rawHeaders=Object.entries(headers).flatMap(([key,value])=>[key,value]);
 return {
  url,method:options.method??'GET',headers,rawHeaders,
  aborted:false,destroyed:false,
  once(){return this;},
  off(){return this;},
  removeListener(){return this;},
  [Symbol.asyncIterator]:async function*(){if(options.body!==undefined)yield Buffer.from(options.body);},
 } as unknown as IncomingMessage;
}
function mockResponse():{response:ServerResponse;recorded:Recorded}{
 const state={headersSent:false,ended:false,destroyed:false};
 const recorded={status:0,headers:{} as Record<string,unknown>,chunks:[] as Buffer[]};
 const response={
  get headersSent(){return state.headersSent;},
  get destroyed(){return state.destroyed;},
  get writableEnded(){return state.ended;},
  writeHead(status:number,headers?:Record<string,unknown>){recorded.status=status;recorded.headers=headers??{};state.headersSent=true;return response;},
  write(chunk:Buffer){recorded.chunks.push(Buffer.from(chunk));return true;},
  end(chunk?:Buffer){if(chunk)recorded.chunks.push(Buffer.from(chunk));state.ended=true;return response;},
  destroy(){state.destroyed=true;return response;},
  once(){return response;},
  off(){return response;},
  removeListener(){return response;},
 };
 return {response:response as unknown as ServerResponse,recorded};
}

/** A test reader over a fixed object. It is NOT the MEDIA producer. */
function testReader(bytes:number):{reader:PreparedReviewMediaReader;opened:number;closed:number;maxRead:number}{
 const state={opened:0,closed:0,maxRead:0};
 const reader:PreparedReviewMediaReader={
  open:async()=>{
   state.opened++;
   const content=Buffer.alloc(bytes,7);
   let closed=false;
   const handle:PreparedReviewMediaHandleV1={
    content_type:'video/mp4',bytes,sha256:SHA,
    media_facts:{kind:'video',fps:{num:30,den:1},frame_count:90},
    timeline:{fps:{num:30,den:1},frame_count:90},
    read:async({offset,length})=>{
     if(closed)throw Error('the handle is closed');
     if(length>state.maxRead)state.maxRead=length;
     return new Uint8Array(content.subarray(offset,offset+length));
    },
    close:async()=>{if(closed)return;closed=true;state.closed++;},
   };
   return handle;
  },
 };
 return {reader,get opened(){return state.opened;},get closed(){return state.closed;},get maxRead(){return state.maxRead;}};
}
function bindings(current:ReviewMediaBinding|null):ReviewMediaBindingPort{
 return {
  currentPart:async()=>current,
  currentByReference:async(_projectId,reference)=>reference==='ref-1'?current:null,
 };
}
function fixture(options:{current?:ReviewMediaBinding|null;reader?:PreparedReviewMediaReader;bytes?:number}={}){
 const auth=new ScopedAgentAuth(()=>ORIGIN,Date.now,'narralens_a_session');
 const ui=auth.issue({principal_id:'owner',channel:'trusted_ui',expires_at:Date.now()+300000});
 const driver=auth.issue({principal_id:'owner',channel:'authenticated',expires_at:Date.now()+300000});
 const foreign=auth.issue({principal_id:'other',channel:'authenticated',expires_at:Date.now()+300000});
 const bytes=options.bytes??64;
 const http=new ReviewMediaHttp({
  auth,origin:()=>ORIGIN,
  assertOwner:(projectId,principalId)=>{if(principalId!=='owner')throw Object.assign(new Error('not the owner'),{code:'NOT_FOUND'});},
  ...(options.reader?{reader:options.reader}:{}),
  ...(options.current!==undefined?{bindings:bindings(options.current)}:{}),
 });
 const uiRequest=(url:string,extra?:Record<string,string>)=>mockRequest(url,{headers:{cookie:'narralens_a_session='+ui.token,'x-narralens-csrf':ui.csrf!,...extra}});
 const driverRequest=(url:string,extra?:Record<string,string>)=>mockRequest(url,{headers:{authorization:'Bearer '+driver.token,...extra}});
 const foreignRequest=(url:string)=>mockRequest(url,{headers:{authorization:'Bearer '+foreign.token}});
 return {auth,ui,driver,foreign,http,uiRequest,driverRequest,foreignRequest};
}

it('fails closed with no binding producer and no reader instead of serving anything',async()=>{
 const f=fixture({current:bindingOf(64)});
 const {response,recorded}=mockResponse();
 await f.http.handle(f.driverRequest('/api/ui/v1/projects/project-1/review-media/ref-1'),response);
 expect(recorded.status).toBe(503);
 expect(Buffer.concat(recorded.chunks).toString('utf8')).toContain('CAPABILITY_UNAVAILABLE');
});

it('refuses a cross-owner reader before it reaches the producer',async()=>{
 const reader=testReader(64);
 const f=fixture({current:bindingOf(64),reader:reader.reader});
 const {response,recorded}=mockResponse();
 await f.http.handle(f.foreignRequest('/api/ui/v1/projects/project-1/review-media/ref-1'),response);
 expect(recorded.status).toBe(404);
 expect(reader.opened).toBe(0);
});

it('streams the whole object in bounded reads and closes the descriptor exactly once',async()=>{
 const bytes=3*1024*1024+7;
 const reader=testReader(bytes);
 const f=fixture({current:bindingOf(bytes),reader:reader.reader});
 const {response,recorded}=mockResponse();
 await f.http.handle(f.driverRequest('/api/ui/v1/projects/project-1/review-media/ref-1'),response);
 expect(recorded.status).toBe(200);
 expect(recorded.headers['Content-Length']).toBe(bytes);
 expect(recorded.headers['ETag']).toBe(`"${SHA}"`);
 expect(Buffer.concat(recorded.chunks).length).toBe(bytes);
 expect(Buffer.concat(recorded.chunks).subarray(0,1)[0]).toBe(7);
 // No single read is larger than the media bound.
 expect(reader.maxRead).toBeLessThanOrEqual(1024*1024);
 expect(reader.closed).toBe(1);
});

it('answers a bounded range with 206 and refuses an unsatisfiable range with 416',async()=>{
 const reader=testReader(4096);
 const f=fixture({current:bindingOf(4096),reader:reader.reader});
 const first=mockResponse();
 await f.http.handle(f.driverRequest('/api/ui/v1/projects/project-1/review-media/ref-1',{range:'bytes=0-99'}),first.response);
 expect(first.recorded.status).toBe(206);
 expect(first.recorded.headers['Content-Range']).toBe('bytes 0-99/4096');
 expect(first.recorded.headers['Content-Length']).toBe(100);
 expect(Buffer.concat(first.recorded.chunks).length).toBe(100);
 const second=mockResponse();
 await f.http.handle(f.driverRequest('/api/ui/v1/projects/project-1/review-media/ref-1',{range:'bytes=99999-'}),second.response);
 expect(second.recorded.status).toBe(416);
 expect(second.recorded.headers['Content-Range']).toBe('bytes */4096');
});

it('describes a part only when the owner, the current package and the receipt agree',async()=>{
 const reader=testReader(64);
 const f=fixture({current:bindingOf(64),reader:reader.reader});
 const descriptor=await f.http.describe({run_id:'run-1',package_id:'package-1',package_version:1,part_kind:'preview',artifact_ref:{id:'artifact-1',version:1,sha256:'a'.repeat(64)}},'project-1',{principal_id:'owner',channel:'trusted_ui',session_ref:'session-1'});
 expect(descriptor).toMatchObject({format:'narralens.review-media-descriptor@1',project_id:'project-1',run_id:'run-1',package_id:'package-1',package_version:1,receipt_digest:'f'.repeat(64),object_id:'object-1',sha256:SHA,bytes:64});
 expect(descriptor.part).toEqual(PART);
 expect(reader.closed).toBe(1);
 // A part kind that does not match the current binding is not described.
 await expect(f.http.describe({run_id:'run-1',package_id:'package-1',package_version:1,part_kind:'narration',artifact_ref:{id:'artifact-1',version:1,sha256:'a'.repeat(64)}},'project-1',{principal_id:'owner',channel:'trusted_ui',session_ref:'session-1'})).rejects.toThrow();
 // A foreign owner is not described either.
 await expect(f.http.describe({run_id:'run-1',package_id:'package-1',package_version:1,part_kind:'preview',artifact_ref:{id:'artifact-1',version:1,sha256:'a'.repeat(64)}},'project-1',{principal_id:'other',channel:'trusted_ui',session_ref:'session-2'})).rejects.toThrow();
});
