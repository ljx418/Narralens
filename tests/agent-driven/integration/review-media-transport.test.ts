import {it,expect,describe} from 'vitest';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {ScopedAgentAuth} from '../../../src/host/agent-driven/scoped-auth.js';
import {ReviewMediaHttp,type ReviewMediaBinding,type ReviewMediaBindingPort} from '../../../src/host/agent-driven/review-media-http.js';
import type {PreparedPreviewReceiptV1,PreparedReviewMediaHandleV1,PreparedReviewMediaReader} from '../../../src/host/render/assembly-ports.js';
import type {ReviewPackage,ReviewPart} from '../../../src/contracts/agent-driven-types.js';
import {RevisionStore} from '../../../src/host/projects/revision-store.js';
import {ProductSqliteRepository} from '../../../src/host/agent-driven/product-sqlite-repository.js';
import {CreatedReviewMediaBindings} from '../../../src/host/agent-driven/created-review-media-bindings.js';
import {canonicalDigest} from '../../../src/host/creative/digest.js';
import {CreativeService} from '../../../src/host/creative/creative-service.js';
import {FixedWorkflowService} from '../../../src/host/creative/fixed-workflow-service.js';
import {creativeInputClosure} from '../../../src/host/creative/creative-closure.js';
import {CreatedReviewPackageService} from '../../../src/host/agent-driven/created-review-package-service.js';
import type {PreparedPreviewPartKind,PreparedPreviewPort,PreparedReadProofV1,PreparedSourceProofPort} from '../../../src/host/render/assembly-ports.js';
import {BRIEF,NOW_ISO,RELAY_CALLER,TRUSTED_CALLER,TestAdoptionAuthority,TestFactPort,fixedClock,meta} from '../product/support/fixtures.js';


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

/**
 * The real binding producer.
 *
 * The cases above use a test binding port, because they are the transport's evidence.
 * These are the producer's: the bindings are read back out of the real tables, and
 * the package that names them is the one the review table points at.
 */
describe('the created review media bindings',()=>{
 const ORIGIN2='http://127.0.0.1:4173';
 function packageDocument(parts:ReviewPart[]):ReviewPackage{
  return {
   project_id:'project-1',run_id:'run-1',plan_version:1,package_id:'package-1',version:1,kind:'sample',
   chapter_id:'chapter-1',input_digest:'b'.repeat(64),output_digest:'c'.repeat(64),quality_digest:'2'.repeat(64),
   parts,source_shot_ids:['shot-1'],selection_reason:'the only shot',allowed_choices:['accept','accept_and_adopt'],
   impact:null,reuse_of_package_id:null,review_url:'/workbench/projects/project-1/reviews/package-1',state:'pending',
  };
 }
 async function fixtureWithBindings(options:{package?:ReviewPackage;bind?:boolean}={}){
  const revisions=new RevisionStore(':memory:');
  const repository=new ProductSqliteRepository(revisions);
  const bindings=new CreatedReviewMediaBindings(revisions);
  const document=options.package??packageDocument([PART]);
  const digest=canonicalDigest(document);
  // The frozen CP-A0 tables have real foreign keys, so the parents of a review
  // request are written first: the project, the published template, the run and its
  // plan version. Nothing here is a shortcut around the schema.
  const db=revisions.compose(d=>d);
  const at='2026-11-12T00:00:00.000Z';
  db.prepare(`INSERT OR IGNORE INTO project_state(project_id,revision,visual_locked,attention,source_digest,source_digest_observed,source_digest_detected_at,updated_at) VALUES(?,?,0,0,'','','',?)`).run('project-1',1,at);
  db.prepare(`INSERT OR IGNORE INTO cp_a0_template_version(template_id,version,parent_version,execution_digest,capability_id,capability_version,definition_json,created_at) VALUES('local-short-film',1,NULL,?,'clip.prepare','1','{}',?)`).run('b70615d5ad4246caac7d0e770022429de5826831b222447e4be7637e4a07ca32',at);
  db.prepare(`INSERT OR IGNORE INTO cp_a0_run(project_id,run_id,run_scope_digest,template_id,template_version,current_plan_version,state,scope_json,checkpoint_json,created_at) VALUES('project-1','run-1',?,'local-short-film',1,1,'running','{}','{}',?)`).run('a'.repeat(64),at);
  db.prepare(`INSERT OR IGNORE INTO cp_a0_plan_version(project_id,run_id,plan_version,run_scope_digest,input_digest,plan_json,created_at) VALUES('project-1','run-1',1,?,?,'{}',?)`).run('a'.repeat(64),'b'.repeat(64),at);
  await repository.transaction(tx=>{
   tx.put('artifact_version',{project_id:'project-1',artifact_id:'package-1',version:1},{
    project_id:'project-1',artifact_id:'package-1',version:1,kind:'chapter',schema_version:1,
    input_digest:'b'.repeat(64),content_digest:digest,content_json:document,input_refs_json:[PART.artifact_ref],
    created_at:'2026-11-12T00:00:00.000Z',
   });
   tx.put('review_request',{project_id:'project-1',run_id:'run-1',review_id:'package-1'},{
    project_id:'project-1',run_id:'run-1',review_id:'package-1',plan_version:1,
    run_scope_digest:'a'.repeat(64),gate:'sample',artifact_id:'package-1',artifact_version:1,
    input_digest:'b'.repeat(64),package_digest:digest,state:'pending',reuse_review_id:null,
    created_at:'2026-11-12T00:00:00.000Z',
   });
  });
  if(options.bind!==false)bindings.bind({
   project_id:'project-1',run_id:'run-1',package_id:'package-1',package_version:1,package_digest:digest,
   receipt:receiptOf(64),parts:document.parts,now:new Date('2026-11-12T00:00:00.000Z'),
  });
  return {revisions,repository,bindings,document,digest};
 }

 it('resolves the current package part and the reference behind it',async()=>{
  const f=await fixtureWithBindings();
  const part=await f.bindings.currentPart({project_id:'project-1',run_id:'run-1',part_kind:'preview',artifact_ref:PART.artifact_ref});
  expect(part).not.toBeNull();
  expect(part!.package_id).toBe('package-1');
  expect(part!.object_id).toBe('object-1');
  expect(part!.slot).toBe('preview');
  expect(part!.receipt.receipt_digest).toBe('f'.repeat(64));
  const byReference=await f.bindings.currentByReference('project-1',PART.artifact_ref.id);
  expect(byReference!.object_id).toBe('object-1');
  f.revisions.close();
 });

 it('refuses a part of another package version, another project and an unknown reference',async()=>{
  const f=await fixtureWithBindings();
  expect(await f.bindings.currentPart({project_id:'project-1',run_id:'run-1',part_kind:'preview',artifact_ref:{...PART.artifact_ref,version:2}})).toBeNull();
  expect(await f.bindings.currentPart({project_id:'project-2',run_id:'run-1',part_kind:'preview',artifact_ref:PART.artifact_ref})).toBeNull();
  expect(await f.bindings.currentPart({project_id:'project-1',run_id:'run-1',part_kind:'narration',artifact_ref:PART.artifact_ref})).toBeNull();
  expect(await f.bindings.currentByReference('project-1','ref-unknown')).toBeNull();
  f.revisions.close();
 });

 it('serves nothing when the package was published without a binding',async()=>{
  const f=await fixtureWithBindings({bind:false});
  expect(await f.bindings.currentPart({project_id:'project-1',run_id:'run-1',part_kind:'preview',artifact_ref:PART.artifact_ref})).toBeNull();
  expect(await f.bindings.currentByReference('project-1',PART.artifact_ref.id)).toBeNull();
  f.revisions.close();
 });

 it('replays an identical immutable binding without adding another row',async()=>{
  const f=await fixtureWithBindings();
  try {
   expect(()=>f.bindings.bind({project_id:'project-1',run_id:'run-1',package_id:'package-1',package_version:1,
    package_digest:f.digest,receipt:receiptOf(64),parts:f.document.parts,now:new Date(NOW_ISO)})).not.toThrow();
   expect(f.revisions.compose(db=>db.prepare('SELECT count(*) AS n FROM created_review_media_binding').get()?.n)).toBe(1);
  } finally { f.revisions.close(); }
 });

 it('refuses immutable binding replay with another package digest',async()=>{
  const f=await fixtureWithBindings();
  try {
   expect(()=>f.bindings.bind({project_id:'project-1',run_id:'run-1',package_id:'package-1',package_version:1,
    package_digest:'f'.repeat(64),receipt:receiptOf(64),parts:f.document.parts,now:new Date(NOW_ISO)}))
    .toThrow();
  } finally { f.revisions.close(); }
 });

 it('never serves a persisted binding whose package digest differs from the current package',async()=>{
  const f=await fixtureWithBindings({bind:false});
  try {
   f.bindings.bind({project_id:'project-1',run_id:'run-1',package_id:'package-1',package_version:1,
    package_digest:'f'.repeat(64),receipt:receiptOf(64),parts:f.document.parts,now:new Date(NOW_ISO)});
   expect(await f.bindings.currentPart({project_id:'project-1',run_id:'run-1',part_kind:PART.kind,artifact_ref:PART.artifact_ref})).toBeNull();
   expect(await f.bindings.currentByReference('project-1',PART.artifact_ref.id)).toBeNull();
  } finally { f.revisions.close(); }
 });

 it('refuses a second, different binding of the same package part',async()=>{
  const f=await fixtureWithBindings();
  expect(()=>f.bindings.bind({
   project_id:'project-1',run_id:'run-1',package_id:'package-1',package_version:1,package_digest:f.digest,
   receipt:receiptOf(128),parts:f.document.parts,now:new Date('2026-11-12T00:01:00.000Z'),
  })).toThrow();
  f.revisions.close();
 });
});

/**
 * The real publication of a review package and the real binding of its parts.
 *
 * The workflow service, the product repository, the bindings store and the database are
 * the production ones. Only the MEDIA proof and preview surfaces are doubles here:
 * they are the seam BRIDGE consumes, and the real MEDIA producer is not in this
 * repository. What the cases below prove is the BRIDGE side of the chain — that the
 * package and its bindings become visible together, that a binding failure takes the
 * package with it, and that the receipt and the current author are really checked.
 */
describe('the review package publication and its bindings',()=>{
 const STYLE_EXEC='b70615d5ad4246caac7d0e770022429de5826831b222447e4be7637e4a07ca32';
 const BASE_SOURCE='9'.repeat(64);
 const PACKAGE_PARTS:ReviewPart[]=[
  {kind:'preview',artifact_ref:{id:'video',version:1,sha256:'a'.repeat(64)},download_ref:null},
  {kind:'narration',artifact_ref:{id:'audio',version:1,sha256:'b'.repeat(64)},download_ref:null},
  {kind:'subtitles',artifact_ref:{id:'subs',version:1,sha256:'c'.repeat(64)},download_ref:null},
  {kind:'shot_summary',artifact_ref:{id:'shots',version:1,sha256:'d'.repeat(64)},download_ref:null},
  {kind:'rights_quality',artifact_ref:{id:'rights',version:1,sha256:'e'.repeat(64)},download_ref:null},
 ];
 const STORYBOARD_LOCAL={kind:'storyboard' as const,fps:30 as const,shots:[{shot_id:'shot-1',paragraph_id:'p-1',asset_id:null,duration_frames:300,caption:'城市远景',concept_text:'傍晚的城市'}]};

 function receiptOfParts(parts:readonly {kind:string;bytes:number;sha256:string}[],runId:string):PreparedPreviewReceiptV1{
  const content={
   format:'narralens.prepared-preview-receipt@1' as const,
   project_id:'project-1',run_id:runId,plan_version:1 as const,step_id:'sample',execution_attempt:1,
   prepared_job_id:'job-sample',prepared_source_id:'ps-1',source_digest:'f'.repeat(64),
   plan_digest:'1'.repeat(64),rights_digest:'2'.repeat(64),producer_attempt:1,
   fps:{num:30,den:1},frame_count:90,
   parts:parts.map(part=>({
    slot:part.kind as PreparedPreviewPartKind,
    object_id:`object-${part.kind}`,
    content_type:part.kind==='preview'?'video/mp4':part.kind==='narration'?'audio/mpeg':'text/plain',
    bytes:part.bytes,sha256:part.sha256,
    media_facts:part.kind==='preview'?{kind:'video' as const,fps:{num:30,den:1},frame_count:90}
      :part.kind==='narration'?{kind:'audio' as const,sample_rate:48000,sample_count:48000,channels:2}
      :{kind:'text' as const},
   })),
  };
  return {...content,receipt_digest:canonicalDigest(content)};
 }

 const COMPLETED={
  format:'narralens.completed-prepared-source@1' as const,
  project_id:'project-1',
  task:{
   job_id:'job-sample',principal_id:'human-1',
   request:{meta:{idempotency_key:'k-task',correlation_id:'c-1'},project_id:'project-1',kind:'assemble_draft' as const,
    input_refs:[],snapshot_id:null,base_revision:3,source_digest:'f'.repeat(64),
    execution:{run_id:'run-1',plan_version:1 as const,step_id:'sample',attempt:1,input_digest:'e'.repeat(64),run_scope_digest:'3'.repeat(64),authorization_id:'grant-1'},
    render_spec:null},
   request_digest:'4'.repeat(64),stage_token:'stage_'+'a'.repeat(32),
   accepted:{job_id:'job-sample',project_id:'project-1',state:'succeeded' as const,attempt:1,snapshot_id:null,result_ref:null,next_actions:['poll_job'],
    execution:{run_id:'run-1',plan_version:1 as const,step_id:'sample',attempt:1,input_digest:'e'.repeat(64),run_scope_digest:'3'.repeat(64),authorization_id:'grant-1'},bootstrap:null},
   job_kind:'snapshot_publish' as const,max_attempts:3,
  },
  producer_attempt:1,
  job:{job_id:'job-sample',project_id:'project-1',state:'succeeded' as const,attempt:1,snapshot_id:null,result_ref:null,next_actions:['poll_job'],
   execution:{run_id:'run-1',plan_version:1 as const,step_id:'sample',attempt:1,input_digest:'e'.repeat(64),run_scope_digest:'3'.repeat(64),authorization_id:'grant-1'},bootstrap:null},
  terminal_reason:'SOURCE_ONLY' as const,
  provider_receipt:{kind:'local.native-draft@1' as const,source_digest:'f'.repeat(64),stage:'SOURCE_ONLY' as const},
  fact:{format:'narralens.created-task-prepared@1' as const,stage_token:'stage_'+'a'.repeat(32),source_digest:'f'.repeat(64),
   plan_digest:'1'.repeat(64),rights_digest:'2'.repeat(64),roots:['film.html'],
   files:[{relative_path:'film.html',bytes:10,sha256:'5'.repeat(64)}]},
  root:'/private/stage',
 };
 const BINDING={
  project_id:'project-1',run_id:'run-1',
  execution:{run_id:'run-1',plan_version:1 as const,step_id:'sample',attempt:1,input_digest:'e'.repeat(64),run_scope_digest:'3'.repeat(64),authorization_id:'grant-1'},
  prepared_source_id:'ps-1',prepared_job_id:'job-sample',fact_digest:'6'.repeat(64),
  base_revision:3,control_revision:1,source_digest:'f'.repeat(64),selection_version:0,
  purpose:'preview' as const,
 };

 function testMediaPorts(receipt:PreparedPreviewReceiptV1){
  const state={released:0,asserted:0};
  const proofPort:PreparedSourceProofPort={
   proveForRead:async<P extends 'impact'|'preview'>(_completed:unknown,_binding:unknown,_facts:unknown)=>({format:'narralens.prepared-read-proof@1',purpose:'preview'}) as PreparedReadProofV1&{purpose:P},
   assertCurrentForRead:<P extends 'impact'|'preview'>(_completed:unknown,_binding:unknown,_proof:unknown,check:()=>void)=>{state.asserted++;check();},
   proveForAdoption:async()=>{throw new Error('the adoption proof is not used here');},
   assertCurrentForAdoption:()=>{throw new Error('the adoption proof is not used here');},
   release:()=>{state.released++;},
   close:()=>undefined,
  };
  const previewPort:PreparedPreviewPort={preview:async()=>receipt};
  return {proofPort,previewPort,get released(){return state.released;},get asserted(){return state.asserted;}};
 }

 async function publicationFixture(options:{receipt?:PreparedPreviewReceiptV1;authorized?:boolean;source_digest?:string;omitAuthorProbe?:boolean}={}){
  const revisions=new RevisionStore(':memory:');
  const repository=new ProductSqliteRepository(revisions);
  const db=revisions.compose(d=>d);
  db.prepare(`INSERT OR IGNORE INTO project_state(project_id,revision,visual_locked,attention,source_digest,source_digest_observed,source_digest_detected_at,updated_at) VALUES('project-1',3,0,0,'','','',?)`).run(NOW_ISO);
  db.prepare(`INSERT OR IGNORE INTO cp_a0_template_version(template_id,version,parent_version,execution_digest,capability_id,capability_version,definition_json,created_at) VALUES('local-short-film',1,NULL,?,'clip.prepare','1','{}',?)`).run(STYLE_EXEC,NOW_ISO);
  const adoption=new TestAdoptionAuthority();
  const facts=new TestFactPort();
  const creative=new CreativeService({repository,now:fixedClock});
  const service=new FixedWorkflowService({repository,adoption,facts,now:fixedClock});
  const intake=await creative.putIntake({meta:meta('k-intake'),intake_id:null,base_version:0,brief:BRIEF},RELAY_CALLER);
  await repository.transaction(tx=>{
   tx.put('artifact_version',{project_id:'project-1',artifact_id:'brief-carrier',version:1},{
    project_id:'project-1',artifact_id:'brief-carrier',version:1,kind:'brief',schema_version:1,
    input_digest:canonicalDigest(BRIEF),content_digest:canonicalDigest(BRIEF),content_json:BRIEF,
    input_refs_json:[],created_at:NOW_ISO});
   tx.compareAndSet('artifact_head',{project_id:'project-1',artifact_id:'brief-carrier'},0,{project_id:'project-1',artifact_id:'brief-carrier',draft_version:1});
  });
  const inputArtifact=await creative.putArtifact({meta:meta('k-input'),project_id:'project-1',artifact_id:null,base_version:0,input_digest:'e'.repeat(64),content:STORYBOARD_LOCAL,input_refs:[]},RELAY_CALLER);
  const closureDigest=await repository.transaction(tx=>canonicalDigest(creativeInputClosure(tx,intake.intake_id,intake.version)));
  const decision=await creative.relayContentDecision({meta:meta('k-relay'),project_id:null,intake_id:intake.intake_id,intake_version:intake.version,input_digest:closureDigest,request_id:'request-1',choice:'accept_content',source:'driver_relay',source_message_ref:'message-1'},RELAY_CALLER);
  const run=await service.prepareRun({meta:meta('k-run'),project_id:'project-1',intake_decision_id:decision.decision_id,template_id:'local-short-film',template_version:1,input_refs:[inputArtifact.ref],input_digest:closureDigest,style_ref:{id:'brief-carrier',version:1,sha256:canonicalDigest(BRIEF)},content_type:'short_film'},RELAY_CALLER);
  const authorization=await service.authorizeRun({meta:meta('k-authorize'),project_id:'project-1',run_id:run.run_id,scope_digest:run.scope_digest,choice:'authorize'},TRUSTED_CALLER);
  await service.recordStepAttempt({project_id:'project-1',run_id:run.run_id,plan_version:1,step_id:'sample',attempt:1,grant_id:authorization.authorization_id,input_digest:closureDigest,state:'succeeded',job_id:null,observed_at:NOW_ISO},TRUSTED_CALLER);

  const bindings=new CreatedReviewMediaBindings(revisions);
  const receipt=options.receipt??receiptOfParts(PACKAGE_PARTS.map(part=>({kind:part.kind,bytes:64,sha256:'7'.repeat(64)})),run.run_id);
  const media=testMediaPorts(receipt);
  const reviewService=new CreatedReviewPackageService(bindings,{
   proofPort:media.proofPort,previewPort:media.previewPort,
   publisher:{
    publish:async(input,caller,work)=>repository.transaction(tx=>{
     const published=service.publishReviewPackageInScope(tx,input,caller);
     work(published);
     return published;
    }),
   },
   registryFacts:()=>[],
   ...(options.omitAuthorProbe?{}:{currentAuthorAndRights:()=>({
     source_digest:options.source_digest??BASE_SOURCE,
     rights_digest:receipt.rights_digest,
     authorized:options.authorized??true,
     reason:'the current author and rights were read',
   })}),
  });
  return {revisions,repository,service,bindings,reviewService,media,receipt,runId:run.run_id,inputDigest:closureDigest};
 }

 const packageInput=(runId:string,inputDigest:string)=>({
  project_id:'project-1',run_id:runId,package_id:'package-1',kind:'sample' as const,chapter_id:'chapter-1',
  input_digest:inputDigest,output_digest:'8'.repeat(64),quality_digest:'9'.repeat(64),parts:PACKAGE_PARTS,
  source_shot_ids:['shot-1'],selection_reason:'the only shot',allowed_choices:['accept','changes_requested','reject'] as const,
  impact:null,reuse_of_package_id:null,step_id:'sample',attempt:1,
 });

 it('publishes the package and writes its binding in one scope',async()=>{
  const f=await publicationFixture();
  const published=await f.reviewService.publish({package:packageInput(f.runId,f.inputDigest) as never,completed:COMPLETED as never,binding:BINDING as never,base_source_digest:BASE_SOURCE},RELAY_CALLER);
  expect(published.package_id).toBe('package-1');
  // The proof was released exactly once, and the final check ran while it was held.
  expect(f.media.released).toBe(1);
  expect(f.media.asserted).toBe(1);
  // The package is visible and the binding resolves to the real receipt.
  const review=await f.repository.transaction(tx=>tx.get('review_request',{project_id:'project-1',run_id:f.runId,review_id:'package-1'}));
  expect(review?.state).toBe('pending');
  const part=await f.bindings.currentPart({project_id:'project-1',run_id:f.runId,part_kind:'preview',artifact_ref:PACKAGE_PARTS[0]!.artifact_ref});
  expect(part?.receipt.receipt_digest).toBe(f.receipt.receipt_digest);
  expect(part?.object_id).toBe('object-preview');
  f.revisions.close();
 });

 it('rolls the package back when the binding cannot be written',async()=>{
  const f=await publicationFixture();
  // A different binding already exists for this package part, so the second write
  // fails. The package must not survive it.
  await f.bindings.bind({
   project_id:'project-1',run_id:f.runId,package_id:'package-1',package_version:1,package_digest:'a'.repeat(64),
   receipt:f.receipt,parts:PACKAGE_PARTS,now:new Date(NOW_ISO),
  });
  await expect(f.reviewService.publish({package:packageInput(f.runId,f.inputDigest) as never,completed:COMPLETED as never,binding:BINDING as never,base_source_digest:BASE_SOURCE},RELAY_CALLER)).rejects.toThrow();
  // The package was rolled back with the binding.
  const review=await f.repository.transaction(tx=>tx.get('review_request',{project_id:'project-1',run_id:f.runId,review_id:'package-1'}));
  expect(review).toBeNull();
  f.revisions.close();
 });

 it('refuses to publish a receipt that does not match its own digest',async()=>{
  const f0=await publicationFixture();
  const broken={...f0.receipt,frame_count:91};
  f0.revisions.close();
  const f=await publicationFixture({receipt:broken});
  await expect(f.reviewService.publish({package:packageInput(f.runId,f.inputDigest) as never,completed:COMPLETED as never,binding:BINDING as never,base_source_digest:BASE_SOURCE},RELAY_CALLER)).rejects.toMatchObject({code:'REVIEW_STALE'});
  // The proof was still released.
  expect(f.media.released).toBe(1);
  f.revisions.close();
 });

 it('refuses to publish when the committed source moved after the proof was released',async()=>{
  // The committed source moved away from the base the preparation was made against.
  const f=await publicationFixture({source_digest:'0'.repeat(64)});
  await expect(f.reviewService.publish({package:packageInput(f.runId,f.inputDigest) as never,completed:COMPLETED as never,binding:BINDING as never,base_source_digest:BASE_SOURCE},RELAY_CALLER)).rejects.toMatchObject({code:'REVISION_CONFLICT'});
  f.revisions.close();
 });

 it('refuses to publish when the rights are no longer authorized',async()=>{
  const f=await publicationFixture({authorized:false});
  await expect(f.reviewService.publish({package:packageInput(f.runId,f.inputDigest) as never,completed:COMPLETED as never,binding:BINDING as never,base_source_digest:BASE_SOURCE},RELAY_CALLER)).rejects.toMatchObject({code:'APPROVAL_REQUIRED'});
  f.revisions.close();
 });

 it('refuses to publish when the current author and rights cannot be read at all',async()=>{
  const f=await publicationFixture({omitAuthorProbe:true});
  await expect(f.reviewService.publish({package:packageInput(f.runId,f.inputDigest) as never,completed:COMPLETED as never,binding:BINDING as never,base_source_digest:BASE_SOURCE},RELAY_CALLER)).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
  f.revisions.close();
 });
});
