import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import type {Server} from 'node:http';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,realpathSync,renameSync,rmSync,statSync,utimesSync,writeFileSync,openSync,closeSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createPinnedOpenFilmCacheProducer,createPinnedOpenFilmFolderServer,createPinnedOpenFilmServingOwner,openFilmServingBinding,openFilmServingBridge,genuineServingCleanupFailures} from '../../../src/adapters/openfilm/openfilm-upstream.js';
import type {OpenFilmCacheProducerOwner,OpenFilmServingOwner} from '../../../src/adapters/openfilm/openfilm-upstream.js';
import {issueNativeCacheWitness,nativeCacheKey,nativeCacheStamp,NativeCacheWitnessLedger} from '../../../src/host/agent-driven/native-cache-witness.js';
import type {NativeCacheWitness} from '../../../src/host/agent-driven/native-cache-witness.js';
import {CreatedNativeWorkspaceService} from '../../../src/host/agent-driven/created-native-workspace.js';
import {RetainedNativeClosure} from '../../../src/host/agent-driven/retained-native-closure.js';
import {retainedCleanupFailures} from '../../../src/host/agent-driven/retained-native-closure.js';
import {nativeSourceFixture} from './helpers/native-source-fixture.js';
import {vendorRoot} from './helpers/created-project-fixture.js';

/** Attach the cleanup failures to a failure without hiding it. */
function withCleanup(error:unknown,failures:readonly unknown[]):never{
 if(failures.length>0&&typeof error==='object'&&error!==null){
  try{Object.defineProperty(error,'cleanup_errors',{value:failures,enumerable:false,configurable:true});}catch{/* the error carries what it can */}
 }
 throw error;
}

/**
 * The G04 browser cases.
 *
 * They are the only cases that really draw: the FIXED upstream producer runs in the
 * headless browser it ships with, on a diagnostic local page, and the picture it
 * draws is the one the witness speaks about.
 *
 * Everything is offline and local: the page is served by the serving owner the
 * workspace service registered for the issued view - its own loopback listener,
 * answering only the files of that one folder - and nothing may leave the machine.
 * The upstream's own launch stays headless, and its own `headed` default is not
 * changed.
 *
 * TWO FACTS THAT ARE PROVEN, NOT ASSUMED:
 *
 * - SILENT: the pinned upstream launches the browser with `headless: !headed` and
 *   `headed` is false by default, and the INSTALLED Playwright adds `--mute-audio`
 *   in its headless branch (`playwright-core/lib/coreBundle.js`: `if (options.
 *   headless) chromeArguments.push('--headless','--hide-scrollbars','--mute-audio',
 *   ...)`). The browser of this fixture is therefore muted.
 * - NO EGRESS: the answer carries a content-security-policy that allows this folder
 *   only, and a file that is not really inside the folder is refused. The LIMITS are
 *   stated honestly: the request count of the serving owner shows what REACHED this
 *   origin, so it cannot prove that no request went anywhere else - the policy is
 *   what forbids it, and the page is the native's own film page, whose resources are
 *   the folder's.
 */

/**
 * The policy of the page origin.
 *
 * The page may load only from this origin and nothing may leave it. The headers
 * are handed to the upstream's own serving, so they are on every answer it makes:
 * the 200s, the 206s of a range request and the errors alike.
 */
const PAGE_ORIGIN_HEADERS:Record<string,string>={
 'content-security-policy':"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; frame-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'",
};

/**
 * The page origin of ONE folder, served by the FIXED upstream.
 *
 * The upstream's own serving answers: it decides what a project serves, what the
 * film's own page carries (its timeline runtime, served at `__film/timeline.mjs`)
 * and what is refused (a path out of the folder, a link out of it). The Host's own
 * constraints are in front of it: only a read is answered, only this machine under
 * its OWN port, and the policy above on every answer.
 *
 * The upstream's serving is not free of resources - it streams a file and it
 * really probes a media on the frame-duration route - so the serving tracks the
 * requests it really started and the real probes it really ran, and the close
 * waits for that settlement: a request that is still open is not a settled one,
 * and the owner says so instead of claiming a clean close.
 */
async function localFolderServer(root:string):Promise<{readonly ready:Promise<void>;readonly base:string;readonly requests:readonly string[];readonly responses:readonly string[];readonly pending:()=>number;close:()=>Promise<void>}>{
 const serving=await createPinnedOpenFilmFolderServer(vendorRoot,root,undefined,{headers:PAGE_ORIGIN_HEADERS});
 const requests:string[]=[];
 const responses:string[]=[];
 let port=0;
 const server=createServer((req,res)=>{
  // Only this machine answers, and only under this origin's OWN port.
  const host=String(req.headers.host??'').toLowerCase();
  if(!/^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)||Number(host.slice(host.lastIndexOf(':')+1))!==port){
   res.writeHead(403,PAGE_ORIGIN_HEADERS).end('forbidden');return;
  }
  requests.push(req.url??'/');
  res.on('finish',()=>responses.push(`${res.statusCode} ${req.url??'/'}`));
  serving.handle(req,res);
 });
 let base='';
 const ready=new Promise<void>((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{
   const address=server.address();
   if(address===null||typeof address==='string'){reject(new Error('the local server has no port'));return;}
   port=address.port;
   base=`http://127.0.0.1:${port}`;
   resolve();
  });
 });
 return {
  ready,
  get base():string{return base;},
  get requests():readonly string[]{return [...requests];},
  get responses():readonly string[]{return [...responses];},
  pending:()=>serving.pending(),
  close:async()=>{
   await ready;
   // The origin stops answering first; then the work it really started is waited
   // for - the requests it answered and the media it really probed. There is no
   // deadline here: a work that does not settle is named, never hidden.
   const closing=new Promise<void>(resolve=>{server.close(()=>resolve());});
   const settlement=await serving.drain();
   await closing;
   if(settlement.open>0)throw new Error(`the page origin still has ${settlement.open} unsettled items`);
  },
 };
}

/** The folder the native writes its cache entries into. */
const cacheFolder=(root:string)=>join(root,'.film','cache');
/** The triple the native writes for one request. */
const tripleFolder=(root:string)=>join(cacheFolder(root),'pageframes');

/**
 * B0-1 — the fixed producer really draws, and the witness speaks about that draw.
 *
 * The producer runs in the upstream's own headless browser, on the diagnostic local
 * page of the working copy. The picture it draws appears in the working copy, the
 * older proof does not verify any more, and the next stable round accepts the
 * witnessed entry.
 */
it('B0-1 the fixed producer really draws and the witness binds the request, the key, the triple and the dependencies',async()=>{
 const f=await nativeSourceFixture();
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  // The older proof: a stable round before the producer drew anything.
  const first=await f.reader.readSource({binding:f.binding});
  expect(first.verifyClosure()).toBe(true);
  // The real producer really runs, on the diagnostic local page.
  const witness=await f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:owner,rel:'film.html',ms:-1,width:480,overrides:null,kind:'film-poster'});
  // The witness is about this view and this generation, and about nothing else.
  expect(witness.kind).toBe('film-poster');
  expect(witness.rel).toBe('film.html');
  expect(witness.ms).toBe(-1);
  expect(witness.width).toBe(480);
  expect(f.workspace.cacheWitness(f.workspaceRef,f.generation,'film-poster')).not.toBeNull();
  expect(f.workspace.cacheWitness(f.workspaceRef,f.generation+1,'film-poster')).toBeNull();
  expect(f.workspace.cacheWitness('another-ref',f.generation,'film-poster')).toBeNull();
  // The picture is really there, and the witness speaks about those bytes.
  const poster=readFileSync(join(f.workspaceRoot,'.film','cache','film-poster.jpg'));
  expect(poster.length).toBeGreaterThan(0);
  expect(createHash('sha256').update(poster).digest('hex')).toBe(witness.jpeg_sha256);
  // The poster IS the picture of this very call: the producer returned it.
  expect(witness.poster_sha256).toBe(witness.jpeg_sha256);
  // The direct lookup of this FRAME is empty: the poster's witness is registered
  // under its own family, and not under the frame's key.
  expect(f.workspace.cacheWitness(f.workspaceRef,f.generation,witness.frame_key)).toBeNull();
  // The poster's witness IS the witness of this frame - the one draw wrote both.
  expect(f.workspace.cacheWitness(f.workspaceRef,f.generation,'film-poster')).not.toBeNull();
  // The producer's own dependency is the page it drew from.
  expect(witness.dependencies.some(entry=>entry.path==='film.html')).toBe(true);
  // The witness speaks about the WHOLE identity of what it wrote.
  expect(witness.outputs.length).toBeGreaterThanOrEqual(4);
  for(const output of witness.outputs)expect(output.mtime_ns).toMatch(/^\d+$/);
  // The older proof does not verify any more: the working copy is not the one it
  // was made against.
  expect(first.verifyClosure()).toBe(false);
  for(const handle of first.retained)handle.close();
  // The next stable round accepts the witnessed entry - the poster AND the triple
  // the very same draw wrote.
  const second=await f.reader.readSource({binding:f.binding});
  expect(second.verifyClosure()).toBe(true);
  for(const handle of second.retained)handle.close();
  // The very same triple under ANOTHER legitimate frame key is NOT covered by that
  // poster: the reader refuses it, because the poster was not drawn of that frame.
  const otherKey=nativeCacheKey({rel:'film.html',ms:0,width:480,overrides_json:null});
  expect(otherKey).not.toBe(witness.frame_key);
  const triple=tripleFolder(f.workspaceRoot);
  for(const part of ['jpg','json','stamp'] as const)
   copyFileSync(join(triple,`${witness.frame_key}.${part}`),join(triple,`${otherKey}.${part}`));
  await expect(f.reader.readSource({binding:f.binding})).rejects.toMatchObject({code:'NATIVE_SOURCE_CACHE_UNWITNESSED'});
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 // The producers are drained BEFORE the serving goes: a producer that is still
 // drawing needs the page that is served.
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * B0-2 — one owner's close never kills the peer's work in flight.
 *
 * Every draw happens in a worker of its own, with a browser of its own, in a
 * process group of its own. An owner that stops admits no new calls and drains the
 * calls it really started - and the process domain of the peer is a domain of its
 * own, so a close of one owner never reaches into it.
 */
it('B0-2 one owner close never kills the peer work in flight, and every draw has a process domain of its own',async()=>{
 const f=await nativeSourceFixture();
 let first:OpenFilmCacheProducerOwner|undefined;
 let second:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  first=await createPinnedOpenFilmCacheProducer(vendorRoot);
  second=await createPinnedOpenFilmCacheProducer(vendorRoot);
  // The second owner starts a REAL draw.
  // The draw goes through the PRIVATE BRIDGE of the serving this service registered:
  // the origin and the root are the serving's own facts, and the draw is ADMITTED by
  // that serving - so a close of the serving waits for it.
  const bridge=await f.workspace.servingFor(f.productionLease(),second,{headers:PAGE_ORIGIN_HEADERS});
  const drawing=bridge.draw({rel:'film.html',ms:-1,width:480,overrides:null});
  // The first owner stops admitting and drains the calls it really started - it has
  // none of its own.
  await first.close();
  // The peer's draw is untouched: it answers with a real picture.
  const jpeg=await drawing;
  expect(jpeg.picture.length).toBeGreaterThan(0);
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 // The producers are drained BEFORE the serving goes.
 try{if(second)await second.close();}catch(error){failures.push(error);}
 try{if(first)await first.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * B0-3 — a cache hit is not a production.
 *
 * The poster is already there - the fixed producer may answer from the disk - and
 * the wrapper refuses the instance instead of witnessing a picture nobody drew. The
 * old bytes are not deleted and not moved: they stay where the native put them.
 */
it('B0-3 refuses a cache entry that was already there and keeps its old bytes',async()=>{
 const f=await nativeSourceFixture();
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  const cache=cacheFolder(f.workspaceRoot);
  mkdirSync(cache,{recursive:true});
  const poster=join(cache,'film-poster.jpg');
  const old=Buffer.from('the picture the native kept before');
  rmSync(poster,{force:true});
  writeFileSync(poster,old);
  const before=statSync(poster);
  // The producer is refused for that instance: the picture there was not drawn by
  // this call, and a cache hit may never be witnessed as a production.
  await expect(f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:owner,rel:'film.html',ms:-1,width:480,overrides:null,kind:'film-poster'}))
   .rejects.toMatchObject({code:'NATIVE_CACHE_PREEXISTING'});
  // No witness was issued for it.
  expect(f.workspace.cacheWitness(f.workspaceRef,f.generation,'film-poster')).toBeNull();
  // The old bytes are still there, untouched: nothing was deleted and nothing was
  // moved out of the workspace.
  expect(readFileSync(poster).equals(old)).toBe(true);
  expect(statSync(poster).size).toBe(before.size);
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 // The producers are drained BEFORE the serving goes: a producer that is still
 // drawing needs the page that is served.
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * B0-4 — the normal page frame family.
 *
 * The fixed producer draws a frame of the film's own page, the witness binds the
 * request, the key, the three files and the dependencies, and the reader accepts the
 * witnessed entry in a stable round.
 */
it('B0-4 the fixed producer draws a page frame and the witness binds it',async()=>{
 const f=await nativeSourceFixture();
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  const witness=await f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:owner,rel:'film.html',ms:0,width:480,overrides:null,kind:'pageframe'});
  // The witness is about this view, this generation and this request.
  expect(witness.kind).toBe('pageframe');
  expect(witness.rel).toBe('film.html');
  expect(witness.ms).toBe(0);
  expect(witness.frame_key).toMatch(/^[0-9a-f]{24}$/);
  expect(witness.key).toBe(witness.frame_key);
  // The three files the producer really wrote are there, and the witness speaks
  // about those bytes.
  const triple=tripleFolder(f.workspaceRoot);
  expect(readdirSync(triple).length).toBe(3);
  expect(createHash('sha256').update(readFileSync(join(triple,`${witness.frame_key}.jpg`))).digest('hex')).toBe(witness.jpeg_sha256);
  // The dependency the producer read is the page itself.
  expect(witness.dependencies.some(entry=>entry.path==='film.html')).toBe(true);
  // And the reader accepts the witnessed entry.
  const facts=await f.reader.readSource({binding:f.binding});
  expect(facts.verifyClosure()).toBe(true);
  for(const handle of facts.retained)handle.close();
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * B0-5 — a producer that is not the fixed one may not draw a witnessed picture.
 */
it('B0-5 refuses a producer that the Host did not issue',async()=>{
 const f=await nativeSourceFixture();
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  // A stand-in with the right shape is not the producer.
  const standIn={pageFrame:async()=>Buffer.alloc(0),close:async()=>{}};
  await expect(f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:standIn as unknown as OpenFilmCacheProducerOwner,
   rel:'film.html',ms:-1,width:480,overrides:null,kind:'film-poster'}))
   .rejects.toMatchObject({code:'NATIVE_CACHE_PRODUCER_FOREIGN'});
  // No witness was issued for it.
  expect(f.workspace.cacheWitness(f.workspaceRef,f.generation,'film-poster')).toBeNull();
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * K01-a — a capability that is not the service's own is refused BEFORE the fixed
 * producer runs.
 *
 * The production entry is a method of the REAL workspace service, and the lease it
 * takes is resolved from that service's private table. An unknown object, a copy of
 * a lease and a plain object with the right shape are all unknown to that table.
 *
 * The oracle is the FILESYSTEM: the fixed producer must not have drawn anything,
 * so no cache entry of any kind may exist in the working copy afterwards.
 */
it('K01-a refuses an unknown, a copied and a shaped production lease before the producer runs',async()=>{
 const f=await nativeSourceFixture();
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  const lease=f.productionLease();
  // A COPY of the lease: the same fields, another object.
  const copy={...lease};
  const plain={workspace_ref:lease.workspace_ref,generation:lease.generation,root:lease.root};
  for(const foreign of [copy,plain,{},null,undefined]){
   await expect(f.workspace.produceNativeCacheEntry(foreign as never,{
    producer:owner,rel:'film.html',ms:-1,width:480,overrides:null,kind:'film-poster'}))
    .rejects.toMatchObject({code:'NATIVE_CACHE_PRODUCTION_FOREIGN'});
  }
  // The fixed producer never ran: the working copy holds no cache entry at all.
  expect(existsSync(cacheFolder(f.workspaceRoot))).toBe(false);
  expect(f.workspace.cacheWitness(f.workspaceRef,f.generation,'film-poster')).toBeNull();
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * K01-b — a lease of ANOTHER real service is refused by this one.
 *
 * The other service issues a real lease of its own view, with its own ref and its
 * own generation. The service that holds the working copy refuses it, and the
 * fixed producer never runs.
 */
it('K01-b refuses a production lease of another real service',async()=>{
 const f=await nativeSourceFixture();
 let owner:OpenFilmCacheProducerOwner|undefined;
 let other:CreatedNativeWorkspaceService|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  other=new CreatedNativeWorkspaceService(f.host.revisions,f.app.creation,f.app.committedSnapshots,{
   root:join(f.root,'other-native-workspaces'),protectedRoots:[join(f.root,'projects'),join(f.root,'snapshots'),vendorRoot]});
  const view=await other.prepare(f.projectId,f.owner);
  const registration=other.registerWorkspaceRef(view,'other-native-ref',{project_id:f.projectId,principal_id:'owner',
   transaction_id:f.host.revisions.activeCommit(f.projectId)!.transaction_id,
   snapshot_id:view.snapshot_id,source_digest:view.source_digest,revision:view.revision,native_project_id:f.binding.native_project_id});
  const foreign=other.acquireCacheProductionLease('other-native-ref',{project_id:registration.project_id,
   snapshot_id:registration.snapshot_id,source_digest:registration.source_digest,revision:registration.revision,
   native_project_id:registration.native_project_id});
  // The service that holds THIS working copy refuses the lease of the other one.
  await expect(f.workspace.produceNativeCacheEntry(foreign,{
   producer:owner,rel:'film.html',ms:-1,width:480,overrides:null,kind:'film-poster'}))
   .rejects.toMatchObject({code:'NATIVE_CACHE_PRODUCTION_FOREIGN'});
  // The fixed producer never ran.
  expect(existsSync(cacheFolder(f.workspaceRoot))).toBe(false);
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{other?.disposeAfterNative();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * K01-c — a witness this service did not produce is never promoted.
 *
 * The brand of the witness module is NOT authority: it says only that the object
 * came out of that module. The authority is the private association between the
 * witness and the production lease of THIS service, and that association is missing
 * for a hand-made witness.
 */
it('K01-c refuses a hand-branded witness and the reader refuses the entry it speaks about',async()=>{
 const f=await nativeSourceFixture();
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  // A witness that is BRANDED - it really came out of the witness module - but
  // that this service never produced.
  const fake:NativeCacheWitness=issueNativeCacheWitness({
   kind:'pageframe',workspace_ref:f.workspaceRef,generation:f.generation,root:f.workspaceRoot,
   rel:'film.html',ms:0,width:480,overrides_json:null,key:'f'.repeat(24),frame_key:'f'.repeat(24),
   jpeg_sha256:'0'.repeat(64),deps_sha256:'0'.repeat(64),stamp_sha256:'0'.repeat(64),poster_sha256:null,
   dependencies:[],outputs:[],issued_at:new Date().toISOString()});
  // The service refuses it: the brand is not the authority.
  expect(f.workspace.record(fake)).toBe(false);
  expect(f.workspace.cacheWitness(f.workspaceRef,f.generation,'f'.repeat(24))).toBeNull();
  // And a self-consistent triple of its own - the right key, a computed stamp - is
  // refused by the reader, because no real producer witnessed it.
  const key=nativeCacheKey({rel:'film.html',ms:0,width:480,overrides_json:null});
  const folder=tripleFolder(f.workspaceRoot);
  mkdirSync(folder,{recursive:true});
  writeFileSync(join(folder,`${key}.jpg`),Buffer.from('a picture nobody drew'));
  writeFileSync(join(folder,`${key}.json`),JSON.stringify({files:['film.html']}));
  writeFileSync(join(folder,`${key}.stamp`),nativeCacheStamp([{path:'film.html',mtime_ms:0,bytes:0}]));
  await expect(f.reader.readSource({binding:f.binding})).rejects.toMatchObject({code:'NATIVE_SOURCE_CACHE_UNWITNESSED'});
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * K01-d — the lease of a view that was replaced is refused.
 *
 * The window is proved, not assumed: the REAL old view and the REAL lease of it are
 * taken first, the derived working copy of THIS case is removed (that path only),
 * and the service really rebuilds it - a same-binding preparation reuses the cached
 * view by design, so a rebuild has to be made to happen. After the rebuild the new
 * view is a different object, in a different root, with a greater generation, and
 * the old lease is dead.
 *
 * The production is then refused with the STALE reason, and the refusal happens
 * BEFORE the producer: the page origin saw NO request at all and the new copy holds
 * no cache entry and no output. The absence of the cache is not the proof - the
 * absence of any page request is.
 */
it('K01-d refuses the production lease of a view that was replaced',async()=>{
 // The private observation of the serving: the requests that really reached it.
 const requests:string[]=[];
 const f=await nativeSourceFixture({servingLifecycle:point=>{if(point==='serving_request')requests.push('request');}});
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  const lease=f.productionLease();
  // The serving THIS service registered for the issued view, taken while the view is
  // still the current one.
  await f.workspace.servingFor(lease,owner,{headers:PAGE_ORIGIN_HEADERS});
  const expectation={project_id:f.projectId,snapshot_id:f.binding.workspace.snapshot_id,
   source_digest:f.binding.workspace.source_digest,revision:f.binding.workspace.revision,
   native_project_id:f.binding.native_project_id};
  // The REAL view and the REAL lease of it, before the replacement.
  const oldView=await f.workspace.prepare(f.projectId,f.owner);
  const oldLease=f.workspace.acquireExpectedLease(f.workspaceRef,expectation);
  expect(oldLease.assertCurrent()).toBe(true);
  const oldGeneration=oldLease.generation;
  // The derived working copy of THIS case is removed - that path only. The author
  // bytes, the snapshot and every other path are not touched.
  rmSync(f.workspaceRoot,{recursive:true,force:true});
  // The service really rebuilds the working copy.
  const newView=await f.workspace.prepare(f.projectId,f.owner);
  expect(newView).not.toBe(oldView);
  expect(newView.source_root.value).not.toBe(oldView.source_root.value);
  const newRegistration=f.workspace.registerWorkspaceRef(newView,'native-ws-rebuilt',{
   project_id:f.projectId,principal_id:'owner',
   transaction_id:f.host.revisions.activeCommit(f.projectId)!.transaction_id,
   snapshot_id:f.binding.workspace.snapshot_id,source_digest:f.binding.workspace.source_digest,
   revision:f.binding.workspace.revision,native_project_id:f.binding.native_project_id});
  expect(newRegistration.generation).toBeGreaterThan(oldGeneration);
  // The lease of the old view is dead.
  expect(oldLease.assertCurrent()).toBe(false);
  // The production is refused, and it is refused before the producer ran.
  const before=requests.length;
  await expect(f.workspace.produceNativeCacheEntry(lease,{
   producer:owner,rel:'film.html',ms:-1,width:480,overrides:null,kind:'film-poster'}))
   .rejects.toMatchObject({code:'NATIVE_CACHE_PRODUCTION_STALE'});
  // NO page was asked for, and nothing was written into the new copy.
  expect(requests.length).toBe(before);
  expect(existsSync(join(newView.source_root.value,'.film','cache'))).toBe(false);
  expect(f.workspace.cacheWitness(f.workspaceRef,oldGeneration,'film-poster')).toBeNull();
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * K03-a — a PARTIAL triple is refused, and the old bytes stay.
 *
 * The upstream may answer from the disk: a cache hit is not a production. The check
 * covers EVERY member of the triple - the picture, the dependency list and the
 * stamp - and not only the picture.
 */
it('K03-a refuses a partial triple of that key and keeps its bytes',async()=>{
 const f=await nativeSourceFixture();
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  const key=nativeCacheKey({rel:'film.html',ms:0,width:480,overrides_json:null});
  const folder=tripleFolder(f.workspaceRoot);
  mkdirSync(folder,{recursive:true});
  const old=Buffer.from('the dependency list of an earlier draw');
  writeFileSync(join(folder,`${key}.json`),old);
  await expect(f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:owner,rel:'film.html',ms:0,width:480,overrides:null,kind:'pageframe'}))
   .rejects.toMatchObject({code:'NATIVE_CACHE_PREEXISTING'});
  // The old bytes are untouched, and no picture was drawn beside them.
  expect(readFileSync(join(folder,`${key}.json`)).equals(old)).toBe(true);
  expect(existsSync(join(folder,`${key}.jpg`))).toBe(false);
  expect(f.workspace.cacheWitness(f.workspaceRef,f.generation,key)).toBeNull();
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * K03-b — a request that is not the exact request of its family is refused.
 *
 * The film poster is the paired output of the film page at -1 and 480, and a page
 * frame that would write that poster is the poster request, not a page frame. A
 * request with another moment, another page or another width is refused.
 */
it('K03-b refuses a request that is not the exact request of its family',async()=>{
 const f=await nativeSourceFixture();
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  // The poster request with another moment.
  await expect(f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:owner,rel:'film.html',ms:0,width:480,overrides:null,kind:'film-poster'}))
   .rejects.toMatchObject({code:'NATIVE_CACHE_REQUEST_FOREIGN'});
  // The poster request with another width.
  await expect(f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:owner,rel:'film.html',ms:-1,width:320,overrides:null,kind:'film-poster'}))
   .rejects.toMatchObject({code:'NATIVE_CACHE_REQUEST_FOREIGN'});
  // A page frame of the very request that writes the poster.
  await expect(f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:owner,rel:'film.html',ms:-1,width:480,overrides:null,kind:'pageframe'}))
   .rejects.toMatchObject({code:'NATIVE_CACHE_REQUEST_FOREIGN'});
  // Nothing was drawn by any of them.
  expect(existsSync(cacheFolder(f.workspaceRoot))).toBe(false);
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * K05-a — the producer fails AND a release fails: the primary keeps its place and
 * the genuine release failure is kept with it.
 *
 * BOTH failures are real and they are INDEPENDENT of each other:
 *  - the producer failure is the pinned owner's own refusal - the owner was closed,
 *    so it admits no new call;
 *  - the release failure is a REAL close of a descriptor of the retained tree that
 *    really happened and is reported afterwards: the descriptor is closed exactly
 *    once, nothing is left open, and no descriptor is closed twice.
 *
 * The assertions are about the CONJUNCTION: the primary is the producer's own
 * failure, the genuine release failure is carried with it, every allocation of the
 * tree was attempted, no witness is visible, and the service is sticky afterwards.
 */
it('K05-a keeps the primary of a failed producer and the genuine release failure',async()=>{
 const opened:{path:string;fd:number}[]=[];
 const hits:number[]=[];
 let closes=0;
 const f=await nativeSourceFixture({productionDescriptorOps:{
  open:(path:string,flags:number)=>{const fd=openSync(path,flags);opened.push({path,fd});return fd;},
  close:(fd:number)=>{
   closes+=1;
   // The descriptor is closed for REAL, exactly once, and the failure is reported
   // AFTER the close: nothing is left open and nothing is closed twice.
   closeSync(fd);
   const entry=opened[0];
   if(entry!==undefined&&entry.fd===fd){hits.push(fd);throw new Error('the release of the retained root failed');}
  },
 }});
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  // The real producer refuses the call: its own owner is closed.
  await owner.close();
  let thrown:unknown;
  try{
   await f.workspace.produceNativeCacheEntry(f.productionLease(),{
    producer:owner,rel:'film.html',ms:-1,width:480,overrides:null,kind:'film-poster'});
  }catch(error){thrown=error;}
  expect(thrown).toBeDefined();
  // The PRIMARY is the producer's own refusal: it is not a cleanup failure and it
  // was not replaced by one.
  expect(String((thrown as {message?:unknown}).message??'')).toMatch(/closing/i);
  expect(String((thrown as {code?:unknown}).code??'')).not.toBe('NATIVE_CACHE_CLEANUP_FAILED');
  // The genuine release failure is carried WITH the primary.
  const genuine=retainedCleanupFailures(thrown);
  expect(genuine.length).toBeGreaterThan(0);
  // The hit is proven, and the descriptor really was closed.
  expect(hits.length).toBe(1);
  expect(existsSync('/proc/self/fd/'+hits[0]!)).toBe(false);
  // Every allocation of the retained tree was attempted, and each of them once.
  expect(closes).toBe(opened.length);
  // Nothing is visible, and the service is sticky.
  expect(f.workspace.cacheWitness(f.workspaceRef,f.generation,'film-poster')).toBeNull();
  expect(f.workspace.uncertain).toBe(true);
  await expect(f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:owner,rel:'film.html',ms:-1,width:480,overrides:null,kind:'film-poster'}))
   .rejects.toMatchObject({code:'NATIVE_CACHE_PRODUCTION_UNCERTAIN'});
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * K05-b — a production whose resources did not settle delivers nothing.
 *
 * The fixed producer really draws - this case starts the real headless browser -
 * and the release of ONE descriptor of the retained tree really fails. The
 * descriptor is closed for real BEFORE the failure is reported, so nothing is left
 * open and no descriptor is closed twice.
 *
 * The witness is revoked before it was ever active, the lookup stays empty, the
 * service latches its uncertainty, and the next production is refused.
 */
it('K05-b delivers nothing when the release of the production did not finish',async()=>{
 const opened:{path:string;fd:number}[]=[];
 const hits:number[]=[];
 let closes=0;
 const f=await nativeSourceFixture({productionDescriptorOps:{
  open:(path:string,flags:number)=>{const fd=openSync(path,flags);opened.push({path,fd});return fd;},
  close:(fd:number)=>{
   closes+=1;
   // The real close happens first, exactly once; the failure is reported after it.
   closeSync(fd);
   const entry=opened[0];
   if(entry!==undefined&&entry.fd===fd){hits.push(fd);throw new Error('the release of the retained root failed');}
  },
 }});
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  let thrown:unknown;
  try{
   await f.workspace.produceNativeCacheEntry(f.productionLease(),{
    producer:owner,rel:'film.html',ms:-1,width:480,overrides:null,kind:'film-poster'});
  }catch(error){thrown=error;}
  expect(thrown).toBeDefined();
  expect(String((thrown as {code?:unknown}).code??'')).toBe('NATIVE_CACHE_CLEANUP_FAILED');
  // The hit is proven, and the descriptor really was closed.
  expect(hits.length).toBe(1);
  expect(existsSync('/proc/self/fd/'+hits[0]!)).toBe(false);
  // Every allocation of the retained trees was attempted, and each of them once.
  expect(closes).toBe(opened.length);
  // Nothing is visible: the witness was revoked before it was ever active.
  expect(f.workspace.cacheWitness(f.workspaceRef,f.generation,'film-poster')).toBeNull();
  // The service latches its uncertainty: it can no longer say what it holds.
  expect(f.workspace.uncertain).toBe(true);
  // And the next production is refused.
  await expect(f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:owner,rel:'film.html',ms:-1,width:480,overrides:null,kind:'film-poster'}))
   .rejects.toMatchObject({code:'NATIVE_CACHE_PRODUCTION_UNCERTAIN'});
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * P08 — the retained milliseconds ARE the platform's own numbers.
 *
 * The upstream's stamp is a digest of the text `${path}:${mtimeMs}:${size}`, and
 * that `mtimeMs` is the platform's. The closure keeps that number, so it must be
 * the platform's own value and not a recomputation of it: the vectors below compare
 * the retained milliseconds with the ACTUAL `stat` of the same file - a whole
 * second, a fractional one and a moment before the epoch. The formula is never
 * compared with itself.
 */
it('P08 keeps the platform own milliseconds for a whole, a fractional and a pre-epoch file',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'n1n2-platform-ms-'));
 try{
  const moments:{readonly name:string;readonly seconds:number}[]=[
   {name:'whole.bin',seconds:1700000000},
   {name:'fractional.bin',seconds:1700000000.123456},
   {name:'before-epoch.bin',seconds:-1000},
  ];
  for(const moment of moments){
   const path=join(folder,moment.name);
   writeFileSync(path,Buffer.from('the platform own bytes'));
   utimesSync(path,moment.seconds,moment.seconds);
  }
  const closure=await RetainedNativeClosure.open(folder,{});
  try{
   for(const moment of moments){
    const path=join(folder,moment.name);
    // The platform's own answer, twice: its milliseconds and its nanoseconds.
    const platform=statSync(path);
    const exact=statSync(path,{bigint:true});
    const retained=await closure.retainFile(moment.name);
    // The retained milliseconds ARE the platform's milliseconds.
    expect(retained.mtime_ms).toBe(platform.mtimeMs);
    expect(retained.ctime_ms).toBe(platform.ctimeMs);
    // And the nanosecond identity is the platform's own, exactly.
    expect(retained.mtime_ns).toBe(exact.mtimeNs.toString());
    expect(retained.ctime_ns).toBe(exact.ctimeNs.toString());
   }
  }finally{await closure.release();}
 }finally{rmSync(folder,{recursive:true,force:true});}
});

/**
 * K04-a — the consumer compares the WHOLE identity of what the witness saw.
 *
 * The picture is replaced by an equal copy: the same bytes, another inode. A
 * consumer that compared only the digest would accept it; this one refuses it.
 *
 * The witness is proved REAL before anything is touched: the consumer accepts the
 * witnessed entry first. Only then is the output replaced, and only then is the
 * refusal the one this case is about.
 */
it('K04-a refuses a witnessed picture that was replaced by an equal copy',async()=>{
 const f=await nativeSourceFixture();
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  const witness=await f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:owner,rel:'film.html',ms:0,width:480,overrides:null,kind:'pageframe'});
  // The witness is really valid: the consumer accepts it.
  const valid=await f.reader.readSource({binding:f.binding});
  expect(valid.verifyClosure()).toBe(true);
  for(const handle of valid.retained)handle.close();
  const picture=join(tripleFolder(f.workspaceRoot),`${witness.frame_key}.jpg`);
  const bytes=readFileSync(picture);
  const before=statSync(picture);
  // The very same bytes, another file: the inode moves.
  const copy=join(tripleFolder(f.workspaceRoot),'.replacement');
  writeFileSync(copy,bytes);
  renameSync(copy,picture);
  const after=statSync(picture);
  expect(after.ino).not.toBe(before.ino);
  expect(readFileSync(picture).equals(bytes)).toBe(true);
  // The consumer refuses it: the identity of the OUTPUT moved.
  await expect(f.reader.readSource({binding:f.binding})).rejects.toMatchObject({code:'NATIVE_SOURCE_CACHE_FORGED'});
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * K04-b — the same file, changed and written back: the change time of the INODE
 * is the witness of that change.
 *
 * The dependency the witness really reads is the film's own page. Its change time
 * is put on an exactly representable whole second BEFORE the production, so that
 * it can be restored exactly afterwards; the bytes are not touched.
 *
 * After a real production - whose witness the consumer accepts - the same inode
 * gets other bytes and then the very same bytes again, with the very same change
 * time, to the nanosecond. Only the change time of the INODE moved, and that is
 * what refuses the round: this is the complement of K04-a, where it was the OUTPUT
 * that was replaced.
 */
it('K04-b refuses a witnessed dependency that was changed and written back',async()=>{
 const f=await nativeSourceFixture();
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  // The dependency the witness must really read: the film's own page. Its change
  // time is put on an exactly representable whole second - the bytes stay.
  const film=join(f.workspaceRoot,'film.html');
  const filmBytes=readFileSync(film);
  const wholeSecond=Math.floor(statSync(film).mtimeMs/1000);
  utimesSync(film,wholeSecond,wholeSecond);
  expect(statSync(film,{bigint:true}).mtimeNs%1000000000n).toBe(0n);
  // A real production, and a witness that is really valid.
  const witness=await f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:owner,rel:'film.html',ms:0,width:480,overrides:null,kind:'pageframe'});
  expect(witness.dependencies.some(entry=>entry.path==='film.html')).toBe(true);
  const valid=await f.reader.readSource({binding:f.binding});
  expect(valid.verifyClosure()).toBe(true);
  for(const handle of valid.retained)handle.close();
  // The same file, other bytes, and the very same bytes again - with the very same
  // change time, to the nanosecond.
  const before=statSync(film,{bigint:true});
  writeFileSync(film,Buffer.alloc(filmBytes.length,0x5a));
  writeFileSync(film,filmBytes);
  utimesSync(film,wholeSecond,wholeSecond);
  const after=statSync(film,{bigint:true});
  expect(after.ino).toBe(before.ino);
  expect(after.mtimeNs).toBe(before.mtimeNs);
  expect(after.ctimeNs).not.toBe(before.ctimeNs);
  expect(readFileSync(film).equals(filmBytes)).toBe(true);
  // The consumer refuses it: the identity of the DEPENDENCY moved.
  await expect(f.reader.readSource({binding:f.binding})).rejects.toMatchObject({code:'NATIVE_SOURCE_CACHE_STALE'});
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * PF01 — the origin of the draw is the issued root, and only the issued root.
 *
 * The serving of a view is THIS service's own: the request hands over NEITHER an
 * origin nor a serving, and the draw goes through the private bridge of the serving
 * this service registered. The facts say which root that serving really serves.
 *
 * A serving of ANOTHER root - a REAL one, with its own listener and its own page - a
 * copy of an owner, the handler-only tool and a stand-in producer are all refused: a
 * bridge is only ever made for an owner this module issued AND for the producer this
 * module issued, and the service registers ONE serving per issued view.
 */
it('PF01 refuses a serving that this service did not register, before any page is asked for',async()=>{
 const requests:string[]=[];
 const f=await nativeSourceFixture({servingLifecycle:point=>{if(point==='serving_request')requests.push('request');}});
 let owner:OpenFilmCacheProducerOwner|undefined;
 let other:OpenFilmCacheProducerOwner|undefined;
 let foreign:OpenFilmServingOwner|undefined;
 let second:OpenFilmServingOwner|undefined;
 let tool:Awaited<ReturnType<typeof localFolderServer>>|undefined;
 let primary:unknown;
 let otherRoot='';
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  // The serving of THIS service, for the issued view.
  const bridge=await f.workspace.servingFor(f.productionLease(),owner,{headers:PAGE_ORIGIN_HEADERS});
  expect(bridge).toBeDefined();
  // The serving really serves the ISSUED working copy: the same canonical path and
  // the same directory - device and inode - that the view holds.
  const facts=f.workspace.servingFacts(f.workspaceRef,f.generation);
  expect(facts).not.toBeNull();
  expect(facts!.canonical_root).toBe(realpathSync(f.workspaceRoot));
  const held=statSync(f.workspaceRoot,{bigint:true});
  expect(facts!.dev).toBe(held.dev.toString());
  expect(facts!.ino).toBe(held.ino.toString());
  expect(facts!.requests).toBe(0);
  // Another root of its own, with its own page: the same relative names, other bytes.
  otherRoot=mkdtempSync(join(tmpdir(),'narralens-n1n2-other-root-'));
  mkdirSync(join(otherRoot,'.film'),{recursive:true});
  writeFileSync(join(otherRoot,'film.html'),'<html><body>the other root</body></html>');
  // A REAL serving owner of that other root, with its own listener.
  foreign=await createPinnedOpenFilmServingOwner(owner,otherRoot,{headers:PAGE_ORIGIN_HEADERS});
  expect(openFilmServingBinding(foreign)?.canonical_root).toBe(realpathSync(otherRoot));
  // A SECOND owner of the very root of this view.
  second=await createPinnedOpenFilmServingOwner(owner,f.workspaceRoot,{headers:PAGE_ORIGIN_HEADERS});
  // The handler-only tool: a real server, and no owner of anything.
  tool=await localFolderServer(otherRoot);
  await tool.ready;
  // A stand-in producer.
  const standIn={pageFrame:async()=>Buffer.alloc(0),close:async()=>{}};
  // A COPY of an owner has no facts at all, and the handler-only tool has none either.
  expect(openFilmServingBinding({...foreign})).toBeNull();
  expect(openFilmServingBinding(tool.base)).toBeNull();
  // A stand-in producer gets no bridge: the bridge is only for the ISSUED producer.
  expect(openFilmServingBridge(foreign,standIn)).toBeNull();
  // A production with a stand-in producer is refused, and NOTHING is asked for.
  await expect(f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:standIn as unknown as OpenFilmCacheProducerOwner,rel:'film.html',ms:-1,width:480,overrides:null,kind:'film-poster'}))
   .rejects.toMatchObject({code:'NATIVE_CACHE_PRODUCER_FOREIGN'});
  // A production with ANOTHER issued producer is refused as well: the serving of
  // this view is bound to the producer it was created with.
  other=await createPinnedOpenFilmCacheProducer(vendorRoot);
  await expect(f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:other,rel:'film.html',ms:-1,width:480,overrides:null,kind:'film-poster'}))
   .rejects.toMatchObject({code:'NATIVE_CACHE_ORIGIN_FOREIGN'});
  // NOT ONE page was asked for, and nothing was written into either root.
  expect(requests.length).toBe(0);
  expect(existsSync(cacheFolder(f.workspaceRoot))).toBe(false);
  expect(existsSync(cacheFolder(otherRoot))).toBe(false);
  expect(f.workspace.cacheWitness(f.workspaceRef,f.generation,'film-poster')).toBeNull();
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{if(other)await other.close();}catch(error){failures.push(error);}
 try{await foreign?.close();}catch(error){failures.push(error);}
 try{await second?.close();}catch(error){failures.push(error);}
 try{await tool?.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(otherRoot!=='')try{rmSync(otherRoot,{recursive:true,force:true});}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * PF02 — the film duration is a duration only when a WITNESSED draw produced it.
 *
 * The upstream writes `.film/cache/film-duration.json` while it draws the film's own
 * page. The draw that wrote it is witnessed, and the witness speaks about the WHOLE
 * identity of that file - so the next stable round accepts the duration, and a file
 * that was replaced by an equal copy, or that was changed and written back, is
 * refused.
 */
it('PF02 proves the film duration by the draw that wrote it, and refuses every other one',async()=>{
 const f=await nativeSourceFixture();
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  const witness=await f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:owner,rel:'film.html',ms:-1,width:480,overrides:null,kind:'film-poster'});
  // The duration is one of the REAL outputs of that draw.
  const duration=witness.outputs.find(entry=>entry.path==='.film/cache/film-duration.json');
  expect(duration).toBeDefined();
  expect(existsSync(join(f.workspaceRoot,'.film','cache','film-duration.json'))).toBe(true);
  // The ledger knows the CURRENT authorisation of that output.
  expect(f.workspace.cacheWitnessByOutput(f.workspaceRef,f.generation,'.film/cache/film-duration.json')).not.toBeNull();
  // The next stable round accepts the working copy: the duration is proved.
  const round=await f.reader.readSource({binding:f.binding});
  expect(round.verifyClosure()).toBe(true);
  for(const handle of round.retained)handle.close();
  // A duration that was REPLACED by an equal copy is refused: same bytes, other inode.
  const path=join(f.workspaceRoot,'.film','cache','film-duration.json');
  const copy=path+'.copy';
  copyFileSync(path,copy);
  rmSync(path);
  renameSync(copy,path);
  await expect(f.reader.readSource({binding:f.binding})).rejects.toMatchObject({code:'NATIVE_SOURCE_CACHE_FORGED'});
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * K05-c — the primary of a real draw AND the genuine release failures of BOTH trees.
 *
 * The producer really runs and really draws. The tree that is retained AFTER the draw
 * is opened at the very moment the working copy is changed on purpose - inside the
 * POST acquisition, before that tree takes the identity of the file - so the service
 * really compares two different identities and really refuses the draw with its own
 * race. That is the primary: it is not replaced by the cleanup that follows it.
 *
 * The releases of the PRE tree and of the POST tree then each fail on their own: two
 * different, named failures, each reported exactly once, each after its own
 * descriptor was really closed. Every allocation is released once, no witness is
 * visible, and the service refuses every later production.
 *
 * The allocation is named by its namespace, its monotonic id, its phase and its
 * path - never by the number of a descriptor, which the platform hands out again.
 */
it('K05-c keeps the primary of a real draw and the genuine release failure of each of the two trees',async()=>{
 const PRE_FAILURE='the release of the PRE tree failed';
 const POST_FAILURE='the release of the POST tree failed';
 // The TWO genuine failures are OBJECTS, and the case keeps those very objects.
 const preError=new Error(PRE_FAILURE);
 const postError=new Error(POST_FAILURE);
 const faults:{readonly phase:string;readonly id:number;readonly path:string;readonly message:string}[]=[];
 const changed:{readonly phase:string;readonly id:number}[]=[];
 // EVERY allocation of BOTH trees, named by its namespace, its monotonic id, its
 // phase and its path - never by the number of a descriptor.
 const opened:{readonly namespace:string;readonly id:number;readonly phase:string;readonly path:string}[]=[];
 const released:{readonly namespace:string;readonly id:number;readonly phase:string;readonly path:string}[]=[];
 let workspaceRoot='';
 const f=await nativeSourceFixture({productionDescriptorOps:{
  open:(path:string,flags:number,allocation)=>{
   const fd=openSync(path,flags);
   if(allocation!==undefined)opened.push({namespace:allocation.namespace,id:allocation.id,phase:allocation.phase,path:allocation.path});
   // The POST tree opens its root BEFORE it takes the identity of the files: the
   // working copy is changed exactly there, so the comparison of the two trees is a
   // real comparison of two real identities.
   if(allocation!==undefined&&allocation.phase==='POST'&&allocation.id===1){
    changed.push({phase:allocation.phase,id:allocation.id});
    writeFileSync(join(workspaceRoot,'film.html'),'<html><body>the working copy changed while it was drawn</body></html>');
   }
   return fd;
  },
  close:(fd:number,allocation)=>{
   // The descriptor is closed for REAL, exactly once, and the failure is reported
   // AFTER the close: nothing is left open and nothing is closed twice.
   closeSync(fd);
   if(allocation!==undefined)released.push({namespace:allocation.namespace,id:allocation.id,phase:allocation.phase,path:allocation.path});
   if(allocation===undefined||allocation.id!==1)return;
   if(allocation.phase==='PRE'){
    faults.push({phase:allocation.phase,id:allocation.id,path:allocation.path,message:PRE_FAILURE});
    throw preError;
   }
   if(allocation.phase==='POST'){
    faults.push({phase:allocation.phase,id:allocation.id,path:allocation.path,message:POST_FAILURE});
    throw postError;
   }
  },
 }});
 workspaceRoot=f.workspaceRoot;
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  let thrown:unknown;
  try{
   await f.workspace.produceNativeCacheEntry(f.productionLease(),{
    producer:owner,rel:'film.html',ms:-1,width:480,overrides:null,kind:'film-poster'});
  }catch(error){thrown=error;}
  expect(thrown).toBeDefined();
  // The working copy really changed inside the POST acquisition.
  expect(changed.length).toBe(1);
  // The PRIMARY is the race the comparison really found - and it was not replaced by
  // the cleanup that followed it.
  expect(String((thrown as {code?:unknown}).code??'')).toBe('NATIVE_CACHE_SOURCE_RACED');
  // BOTH trees really failed to release, each with its OWN genuine failure, each
  // exactly once, and both are carried by the primary. The primary carries the two
  // refusals of the two trees; each refusal carries the failure it really had.
  const genuine=retainedCleanupFailures(thrown);
  expect(genuine.length).toBe(2);
  // The genuine failures are the VERY OBJECTS that were thrown - kept once each, and
  // not replaced by a message that merely looks like them.
  const causes=genuine.flatMap(error=>retainedCleanupFailures(error));
  expect(causes.filter(cause=>cause===preError).length).toBe(1);
  expect(causes.filter(cause=>cause===postError).length).toBe(1);
  // EVERY allocation of BOTH trees was released exactly once: no allocation was
  // forgotten, none was closed twice, and no descriptor number was used as an
  // identity.
  expect(released.length).toBe(opened.length);
  const names=new Set(opened.map(allocation=>`${allocation.namespace}#${allocation.id}`));
  expect(new Set(released.map(allocation=>`${allocation.namespace}#${allocation.id}`)).size).toBe(names.size);
  for(const name of names)
   expect(released.filter(allocation=>`${allocation.namespace}#${allocation.id}`===name).length).toBe(1);
  // The faults are named by their phase and their allocation, not by a descriptor
  // number: one PRE tree and one POST tree, each released once.
  expect(faults.filter(fault=>fault.phase==='PRE').length).toBe(1);
  expect(faults.filter(fault=>fault.phase==='POST').length).toBe(1);
  // Nothing is visible, and the service is sticky afterwards.
  expect(f.workspace.cacheWitness(f.workspaceRef,f.generation,'film-poster')).toBeNull();
  expect(f.workspace.uncertain).toBe(true);
  await expect(f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:owner,rel:'film.html',ms:-1,width:480,overrides:null,kind:'film-poster'}))
   .rejects.toMatchObject({code:'NATIVE_CACHE_PRODUCTION_UNCERTAIN'});
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * Q01 — the construction of a serving is part of the service's own work.
 *
 * The whole construction is registered before its first await, so a close of the
 * service waits for it; two legal concurrent requests for the SAME view share ONE
 * construction; and everything that fails after the construction - a closing service,
 * a lease that died, a view that was replaced, a root that moved - closes the owner
 * AT ONCE instead of waiting for a later disposal.
 */
it('Q01 a close during the construction waits for it, and the failed owner is closed at once',async()=>{
 const points:string[]=[];
 let closing:Promise<void>|undefined;
 const f=await nativeSourceFixture({servingLifecycle:point=>{
  points.push(point);
  // The close happens WHILE the serving is being constructed.
  if(point==='serving_listening'&&closing===undefined)closing=f.workspace.close();
 }});
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  let thrown:unknown;
  try{await f.workspace.servingFor(f.productionLease(),owner,{headers:PAGE_ORIGIN_HEADERS});}catch(error){thrown=error;}
  expect(thrown).toBeDefined();
  // The close really waited for the construction.
  await closing;
  // The owner was closed AT ONCE, and it never answered a request.
  expect(points).toContain('serving_closed');
  expect(points).not.toContain('serving_request');
  // And the service says it holds no serving for that view any more.
  expect(f.workspace.servingFacts(f.workspaceRef,f.generation)).toBeNull();
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * Q01 — a root that moved while the serving was constructed is refused, and the owner
 * this service just created is closed AT ONCE.
 */
it('Q01 a root that moved during the construction closes the owner at once and refuses the serving',async()=>{
 const points:string[]=[];
 const f=await nativeSourceFixture({servingLifecycle:point=>{
  points.push(point);
  // The working copy is REPLACED right after the listener came up: the serving now
  // serves a directory that is not the one the view holds.
  if(point==='serving_root_verified'){
   rmSync(f.workspaceRoot,{recursive:true,force:true});
   mkdirSync(f.workspaceRoot,{recursive:true});
   writeFileSync(join(f.workspaceRoot,'film.html'),'<html><body>a different working copy</body></html>');
  }
 }});
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  let thrown:unknown;
  try{await f.workspace.servingFor(f.productionLease(),owner,{headers:PAGE_ORIGIN_HEADERS});}catch(error){thrown=error;}
  expect(thrown).toBeDefined();
  // The refusal that really happens is the EARLIER one: the working copy is gone, so
  // the issued view - and with it the lease - is no longer current, and the service
  // checks the lease before it compares the root. The origin check is not reached on
  // this path, and the case says so instead of pretending it was.
  expect(String((thrown as {code?:unknown}).code??'')).toBe('NATIVE_CACHE_PRODUCTION_STALE');
  // The owner was closed AT ONCE - not left to a later disposal.
  expect(points).toContain('serving_closed');
  expect(points).not.toContain('serving_request');
  expect(f.workspace.servingFacts(f.workspaceRef,f.generation)).toBeNull();
  // The resources were really released: the service can still say what it holds, and
  // it does NOT latch itself uncertain for a refusal that cleaned up after itself.
  expect(f.workspace.uncertain).toBe(false);
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * Q01 — two legal concurrent requests for the SAME view share ONE construction.
 */
it('Q01 two concurrent requests for the same view share one construction and one owner',async()=>{
 const points:string[]=[];
 const f=await nativeSourceFixture({servingLifecycle:point=>{points.push(point);}});
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  const [first,second]=await Promise.all([
   f.workspace.servingFor(f.productionLease(),owner,{headers:PAGE_ORIGIN_HEADERS}),
   f.workspace.servingFor(f.productionLease(),owner,{headers:PAGE_ORIGIN_HEADERS})]);
  // The SAME serving: one construction, one listener, one owner.
  // The parentheses matter: without them the compiler reads the arrow as a TYPE
  // ARGUMENT of filter, and the case would be about the types, not the facts.
  expect(first).toBe(second);
  expect(points.filter((point)=>point==='serving_listening').length).toBe(1);
  expect(points.filter((point)=>point==='serving_root_verified').length).toBe(1);
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * Q01 — a DISPOSE during the construction waits for it and settles it.
 *
 * The dispose is not the close: it also releases the roots of the service. The
 * construction is still admitted work, so the dispose waits for it - and the
 * construction itself sees that the service is closing and closes the owner it just
 * created AT ONCE.
 */
it('Q01 a dispose during the construction waits for it and settles the owner at once',async()=>{
 const points:string[]=[];
 const f=await nativeSourceFixture({servingLifecycle:point=>{
  points.push(point);
  // The service is disposed WHILE the serving is being constructed.
  if(point.startsWith('serving_listening:'))void f.workspace.disposeAfterNative();
 }});
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  let thrown:unknown;
  try{await f.workspace.servingFor(f.productionLease(),owner,{headers:PAGE_ORIGIN_HEADERS});}catch(error){thrown=error;}
  expect(thrown).toBeDefined();
  // The owner was closed AT ONCE, and the service holds no serving for that view.
  expect(points).toContain('serving_closed');
  expect(f.workspace.servingFacts(f.workspaceRef,f.generation)).toBeNull();
  // The port it really listened on is closed.
  const listening=points.find(point=>point.startsWith('serving_listening:'));
  expect(listening).toBeDefined();
  const origin=listening!.slice('serving_listening:'.length);
  await expect(fetch(origin+'/film.html')).rejects.toBeDefined();
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * Q01 — the factory settles its OWN construction.
 *
 * The observation of the serving's lifecycle is called INSIDE the factory's own
 * failure boundary: when it refuses, the factory closes the listener it really
 * opened, keeps the very error that was thrown as its primary, and reports that it
 * gave up. The owner was never returned, so nobody else could have closed it.
 */
it('Q01 the factory settles its own construction when the serving observation throws, and keeps the same primary',async()=>{
 const points:string[]=[];
 const named=new Error('the serving observation refused');
 const f=await nativeSourceFixture({servingLifecycle:point=>{
  points.push(point);
  if(point==='serving_root_verified')throw named;
 }});
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  let thrown:unknown;
  try{await f.workspace.servingFor(f.productionLease(),owner,{headers:PAGE_ORIGIN_HEADERS});}catch(error){thrown=error;}
  // The PRIMARY is the VERY object the observation threw - not a wrapper, not a
  // message that looks like it.
  expect(thrown).toBe(named);
  // The factory said that it gave up.
  expect(points.some(point=>point==='serving_aborted')).toBe(true);
  // And the port it REALLY listened on is closed: the request cannot be answered.
  const listening=points.find(point=>point.startsWith('serving_listening:'));
  expect(listening).toBeDefined();
  const origin=listening!.slice('serving_listening:'.length);
  await expect(fetch(origin+'/film.html')).rejects.toBeDefined();
  // The service holds no serving for that view.
  expect(f.workspace.servingFacts(f.workspaceRef,f.generation)).toBeNull();
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * Q01 — the root check of the factory fails AFTER the listener is up.
 */
it('Q01 the factory settles its own construction when the root check fails after the listener is up',async()=>{
 const points:string[]=[];
 const f=await nativeSourceFixture({servingLifecycle:point=>{
  points.push(point);
  // The working copy is removed right after the listener came up, so the factory's
  // OWN root verification fails - with the real error of the platform.
  if(point.startsWith('serving_listening:'))rmSync(f.workspaceRoot,{recursive:true,force:true});
 }});
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  let thrown:unknown;
  try{await f.workspace.servingFor(f.productionLease(),owner,{headers:PAGE_ORIGIN_HEADERS});}catch(error){thrown=error;}
  expect(thrown).toBeDefined();
  // It is the platform's own failure, not a wrapper around it.
  expect(String((thrown as {code?:unknown}).code??'')).toBe('ENOENT');
  expect(points.some(point=>point==='serving_aborted')).toBe(true);
  // The port it really listened on is closed.
  const listening=points.find(point=>point.startsWith('serving_listening:'));
  expect(listening).toBeDefined();
  const origin=listening!.slice('serving_listening:'.length);
  await expect(fetch(origin+'/film.html')).rejects.toBeDefined();
  expect(f.workspace.servingFacts(f.workspaceRef,f.generation)).toBeNull();
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * Q01 — a factory failure whose OWN settlement failed keeps the primary, keeps every
 * genuine failure, and leaves the service sticky.
 *
 * The observation refuses (that is the primary) and the settlement of the listener
 * fails genuinely AFTER the listener was really closed. The genuine failure is the
 * ADAPTER's own record - a property on an error would not be authority - and the
 * service can no longer say what it holds: it refuses every later production.
 */
it('Q01 a factory failure with a genuine settlement failure keeps the primary, the genuine object and the sticky service',async()=>{
 const points:string[]=[];
 const primary=new Error('the serving observation refused');
 const genuine=new Error('the listener release was reported as failed');
 const f=await nativeSourceFixture({servingLifecycle:point=>{
  points.push(point);
  // The observation refuses: that is the PRIMARY of the construction.
  if(point==='serving_root_verified')throw primary;
  // And the settlement of the listener fails genuinely - AFTER the listener was
  // really closed: the resource is released, and the failure is thrown after that.
  if(point==='serving_cleanup:listener')throw genuine;
 }});
 let owner:OpenFilmCacheProducerOwner|undefined;
 let failure:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  let thrown:unknown;
  try{await f.workspace.servingFor(f.productionLease(),owner,{headers:PAGE_ORIGIN_HEADERS});}catch(error){thrown=error;}
  // The PRIMARY is the very object the observation threw.
  expect(thrown).toBe(primary);
  // The genuine settlement failure is kept - exactly once, and it is the adapter's own
  // record, not a property on the error.
  const failures=genuineServingCleanupFailures(thrown);
  expect(failures.filter(error=>error===genuine).length).toBe(1);
  // The port it really listened on is closed: the resource was really released.
  const listening=points.find(point=>point.startsWith('serving_listening:'));
  expect(listening).toBeDefined();
  const origin=listening!.slice('serving_listening:'.length);
  await expect(fetch(origin+'/film.html')).rejects.toBeDefined();
  // The service can no longer say what it holds: it is sticky, and it refuses.
  expect(f.workspace.uncertain).toBe(true);
  await expect(f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:owner,rel:'film.html',ms:-1,width:480,overrides:null,kind:'film-poster'}))
   .rejects.toMatchObject({code:'NATIVE_CACHE_PRODUCTION_UNCERTAIN'});
 }catch(error){failure=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(failure!==undefined)withCleanup(failure,failures);
 if(failures.length>0){
  const error=new Error('The case could not release everything');
  Object.defineProperty(error,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw error;
 }
},600000);

/**
 * Q01 — a REGISTRATION failure whose own settlement failed is the same story on the
 * service's side: the primary keeps its place, the genuine failure is kept, and the
 * service is sticky.
 *
 * The working copy is REPLACED after the factory verified it, so the registration
 * check of the service is the one that refuses: the issued view - and with it the
 * lease - is no longer current.
 *
 * The REAL production lease is therefore taken BEFORE the working copy is broken.
 * It is the only capability that may drive this production, and a lease taken after
 * the break is not one: the fixture would have to re-acquire it, and that
 * re-acquisition is a REVISION_CONFLICT that never reaches the production at all.
 *
 * The later production is refused by the SAME precondition - the lease of this very
 * production is no longer current - so it is refused as NATIVE_CACHE_PRODUCTION_STALE
 * and NOT as the uncertain refusal: the service checks the lease BEFORE it consults
 * its own uncertainty. The two control flows are not mixed here. The uncertain branch
 * is covered by the factory case above, where the lease is still current.
 */
it('Q01 a registration failure with a genuine settlement failure keeps the primary and latches the service',async()=>{
 const genuine=new Error('the folder release was reported as failed');
 const points:string[]=[];
 const f=await nativeSourceFixture({servingLifecycle:point=>{
  points.push(point);
  // The working copy is REPLACED after the factory verified it: the registration
  // check of the service is the one that refuses now.
  if(point==='serving_root_verified')rmSync(f.workspaceRoot,{recursive:true,force:true});
  // And the settlement of the serving fails genuinely, after the release.
  if(point==='serving_cleanup:folder')throw genuine;
 }});
 let owner:OpenFilmCacheProducerOwner|undefined;
 let failure:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  // The REAL lease of the issued view, taken BEFORE the working copy is broken.
  const lease=f.productionLease();
  let thrown:unknown;
  try{await f.workspace.servingFor(lease,owner,{headers:PAGE_ORIGIN_HEADERS});}catch(error){thrown=error;}
  expect(thrown).toBeDefined();
  // The PRIMARY is the refusal the service really made: the working copy is gone, so
  // the issued view and its lease are no longer current.
  expect(String((thrown as {code?:unknown}).code??'')).toBe('NATIVE_CACHE_PRODUCTION_STALE');
  // The genuine settlement failure is kept with the primary, and it is read from the
  // HOST's own private ledger - the service merged it there. (The adapter's own
  // ledger belongs to the case where the FACTORY failed, and that case reads it.)
  const failures=retainedCleanupFailures(thrown);
  expect(failures.filter(error=>error===genuine).length).toBe(1);
  // The service can no longer say what it holds: it is sticky, and it refuses every
  // later production.
  expect(f.workspace.uncertain).toBe(true);
  // Nothing is visible: this production never produced a witness.
  expect(f.workspace.cacheWitness(f.workspaceRef,f.generation,'film-poster')).toBeNull();
  // The later production is refused by the SAME precondition - the lease of this very
  // production is no longer current - and NOT by the uncertain refusal. The case
  // says exactly that, instead of claiming the uncertain branch it did not reach.
  await expect(f.workspace.produceNativeCacheEntry(lease,{
   producer:owner,rel:'film.html',ms:-1,width:480,overrides:null,kind:'film-poster'}))
   .rejects.toMatchObject({code:'NATIVE_CACHE_PRODUCTION_STALE'});
  // The listener it really opened is closed: the resource was really released.
  const listening=points.find(point=>point.startsWith('serving_listening:'));
  expect(listening).toBeDefined();
  const origin=listening!.slice('serving_listening:'.length);
  await expect(fetch(origin+'/film.html')).rejects.toBeDefined();
 }catch(error){failure=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(failure!==undefined)withCleanup(failure,failures);
 if(failures.length>0){
  const error=new Error('The case could not release everything');
  Object.defineProperty(error,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw error;
 }
},600000);

/**
 * Q02 — a close during a real draw waits for the draw and keeps its origin alive.
 *
 * The page of the working copy asks for a dependency of its own LATER: the browser
 * requests it only after the page was answered, so there is a real gap in which the
 * origin is IDLE (nothing is in flight) while the draw is still ADMITTED.
 *
 * The close is asked for in that gap. The late dependency must still be requested
 * and still COMPLETE: the origin stayed up for the draw it had already accepted.
 *
 * The raw draw and the WHOLE production settle on DIFFERENT boundaries: the close
 * waits for the raw draw and its later requests, while the production goes on to the
 * POST closure and to the final fence - which refuses a CLOSING serving. The case
 * proves both, separately, and it does NOT weaken that fence.
 */
it('Q02 a close during a real draw waits for the draw and keeps its origin alive',async()=>{
 const requested:string[]=[];
 const completed:string[]=[];
 const f=await nativeSourceFixture({servingLifecycle:point=>{
  if(point.startsWith('serving_request:'))requested.push(point.slice('serving_request:'.length));
  if(point.startsWith('serving_request_completed:'))completed.push(point.slice('serving_request_completed:'.length));
 }});
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  // A REAL, decodable picture of the working copy: the page asks for it, and the
  // upstream's own page contract waits for the LOAD event - so the draw itself waits
  // for this picture to be fetched AND decoded.
  writeFileSync(join(f.workspaceRoot,'late-dependency.png'),Buffer.from(
   'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'));
  const film=join(f.workspaceRoot,'film.html');
  writeFileSync(film,readFileSync(film,'utf8')+'<img src="late-dependency.png" alt="late">');
  const order:string[]=[];
  // The production is handled from the start: no unhandled rejection, ever.
  const drawing=f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:owner,rel:'film.html',ms:-1,width:480,overrides:null,kind:'film-poster'});
  const settled=drawing.then(witness=>({witness,error:undefined as unknown}),error=>({witness:undefined,error}));
  // The PROVEN gap: the origin is idle (nothing is in flight) while the draw is
  // still admitted. The page has been answered; its picture has not been asked for.
  const until=Date.now()+30000;
  let facts=f.workspace.servingFacts(f.workspaceRef,f.generation);
  while(Date.now()<until&&!(facts!==null&&facts.pending===0&&facts.accepted>=1)){
   await new Promise(resolve=>setTimeout(resolve,5));
   facts=f.workspace.servingFacts(f.workspaceRef,f.generation);
  }
  expect(facts).not.toBeNull();
  expect(facts!.pending).toBe(0);
  expect(facts!.accepted).toBeGreaterThanOrEqual(1);
  // The picture has NOT been asked for yet: the gap is real.
  expect(requested.some(path=>path.includes('late-dependency.png'))).toBe(false);
  const before=requested.length;
  // The close is asked for NOW, while the draw is still admitted.
  const closing=f.workspace.closeServing(f.workspaceRef,f.generation).then(()=>{order.push('closed');});
  const again=f.workspace.closeServing(f.workspaceRef,f.generation).then(()=>{order.push('closed-again');});
  // The draw really settled: the production reached its FINAL fence, which refuses a
  // CLOSING serving - and the fence is only reached after the draw itself, which
  // waited for the picture's load.
  const outcome=await settled;
  expect(outcome.witness).toBeUndefined();
  expect(String((outcome.error as {code?:unknown}|undefined)?.code??'')).toBe('NATIVE_CACHE_ORIGIN_FOREIGN');
  // The EXACT picture was really asked for AFTER the close, and it was really
  // ANSWERED: the origin stayed up for the draw it had already accepted.
  expect(requested.length).toBeGreaterThan(before);
  expect(requested.some(path=>path.includes('late-dependency.png'))).toBe(true);
  expect(completed.some(path=>path.includes('late-dependency.png'))).toBe(true);
  // The close settled - and the production settled on its own, later boundary.
  await closing;
  await again;
  expect(order).toEqual(['closed','closed-again']);
  // No witness is visible, and the service is NOT sticky: the draw was refused, not lost.
  expect(f.workspace.cacheWitness(f.workspaceRef,f.generation,'film-poster')).toBeNull();
  expect(f.workspace.uncertain).toBe(false);
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * Q03 — a child page can never brand a duration it did not write.
 *
 * The forged duration is already in the working copy, with the real stamp of the
 * film. The draw is of ANOTHER page: the fixed upstream writes the duration only for
 * the film's own page, so this draw leaves the forged bytes exactly where they were.
 * The witness of that draw must NOT carry the duration, and the reader must keep
 * refusing it.
 */
it('Q03 a draw of another page never brands a duration it did not write',async()=>{
 const f=await nativeSourceFixture();
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  // A LEGITIMATE native page of its own: it provides the real window.film contract
  // that the fixed upstream's own draw waits for (packages/openfilm/src/host.mjs:351 -
  // the page has to offer window.film.frame), so the fixed producer really draws it.
  // It is the film's own runtime contract, not a mock of the producer.
  writeFileSync(join(f.workspaceRoot,'scenes.html'),[
   '<!doctype html><html><head><meta charset="utf-8"><title>scene</title></head>',
   '<body style="margin:0;background:#101010"><div id="box" style="width:160px;height:90px;background:#2080c0"></div>',
   '<script>',
   'window.film = window.film || {};',
   "window.film.version = '0.1'; window.film.name = 'film';",
   'window.film.width = 160; window.film.height = 90; window.film.duration = 5;',
   'window.film.ready = Promise.resolve();',
   'window.film.frame = async function (t) {',
   "  var box = document.getElementById('box');",
   "  if (box) box.style.background = 'rgb(' + Math.round(255 * (t / 5)) + ',80,160)';",
   '  await new Promise(function (resolve) { requestAnimationFrame(function () { resolve(); }); });',
   '};',
   '</script></body></html>',
  ].join('\n'));
  // The FORGED duration: the real stamp of the real film and a plausible number.
  const film=statSync(join(f.workspaceRoot,'film.html'));
  mkdirSync(join(f.workspaceRoot,'.film','cache'),{recursive:true});
  const forgedPath=join(f.workspaceRoot,'.film','cache','film-duration.json');
  const forged=JSON.stringify({film:`${film.mtimeMs}:${film.size}`,duration:999999});
  writeFileSync(forgedPath,forged);
  const forgedBefore=statSync(forgedPath);
  const witness=await f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:owner,rel:'scenes.html',ms:0,width:480,overrides:null,kind:'pageframe'});
  // The draw really happened: the triple of the scene page is really there.
  const triple=tripleFolder(f.workspaceRoot);
  expect(existsSync(join(triple,`${witness.frame_key}.jpg`))).toBe(true);
  expect(existsSync(join(triple,`${witness.frame_key}.json`))).toBe(true);
  expect(existsSync(join(triple,`${witness.frame_key}.stamp`))).toBe(true);
  expect(witness.outputs.some(entry=>entry.path===`.film/cache/pageframes/${witness.frame_key}.jpg`)).toBe(true);
  // The draw of the scene page carries NO duration: it did not write one.
  expect(witness.outputs.some(entry=>entry.path==='.film/cache/film-duration.json')).toBe(false);
  // The forged bytes and the forged identity are exactly as they were: this draw did
  // not touch them, and it did not authorise them.
  expect(readFileSync(forgedPath,'utf8')).toBe(forged);
  const forgedAfter=statSync(forgedPath);
  expect(forgedAfter.ino).toBe(forgedBefore.ino);
  expect(forgedAfter.dev).toBe(forgedBefore.dev);
  // And no authorisation of that output exists at all.
  expect(f.workspace.cacheWitnessByOutput(f.workspaceRef,f.generation,'.film/cache/film-duration.json')).toBeNull();
  // The reader keeps refusing it.
  await expect(f.reader.readSource({binding:f.binding})).rejects.toMatchObject({code:'NATIVE_SOURCE_CACHE_UNWITNESSED'});
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * Q03 — two lawful frames of the same film: both triples stay consumable, and the
 * CURRENT duration is the newest draw's.
 */
it('Q03 two lawful different frames keep both triples consumable and the current duration belongs to the newest draw',async()=>{
 const f=await nativeSourceFixture();
 let owner:OpenFilmCacheProducerOwner|undefined;
 let primary:unknown;
 try{
  owner=await createPinnedOpenFilmCacheProducer(vendorRoot);
  // The FIRST frame of the film.
  const first=await f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:owner,rel:'film.html',ms:0,width:480,overrides:null,kind:'pageframe'});
  // The SECOND frame of the same film: another key, another draw, another duration.
  const second=await f.workspace.produceNativeCacheEntry(f.productionLease(),{
   producer:owner,rel:'film.html',ms:1,width:480,overrides:null,kind:'pageframe'});
  expect(second.frame_key).not.toBe(first.frame_key);
  // Each triple is covered by its OWN witness.
  expect(f.workspace.cacheWitness(f.workspaceRef,f.generation,first.frame_key)).not.toBeNull();
  expect(f.workspace.cacheWitness(f.workspaceRef,f.generation,second.frame_key)).not.toBeNull();
  // The CURRENT authorisation of the duration is the NEWEST draw's.
  const duration=f.workspace.cacheWitnessByOutput(f.workspaceRef,f.generation,'.film/cache/film-duration.json');
  expect(duration).not.toBeNull();
  expect(duration!.frame_key).toBe(second.frame_key);
  // And BOTH triples are still consumable: the newer duration does not kill the older frame.
  const round=await f.reader.readSource({binding:f.binding});
  expect(round.verifyClosure()).toBe(true);
  for(const handle of round.retained)handle.close();
 }catch(error){primary=error;}
 const failures:unknown[]=[];
 try{if(owner)await owner.close();}catch(error){failures.push(error);}
 try{await f.close();}catch(error){failures.push(error);}
 if(primary!==undefined)withCleanup(primary,failures);
 if(failures.length>0){
  const failure=new Error('The case could not release everything');
  Object.defineProperty(failure,'cleanup_errors',{value:failures,enumerable:false,configurable:true});
  throw failure;
 }
},600000);

/**
 * Q03 — the newest authorisation of an output NEVER falls back to an older one.
 *
 * This is the ledger's own rule, proved on the ledger itself: the newest draw is the
 * current authorisation of the output, and when it is revoked the output has NO
 * authorisation at all - the older draw does not come back.
 */
it('Q03 the newest authorisation of an output never falls back to an older one',()=>{
 const ledger=new NativeCacheWitnessLedger();
 const make=(key:string):NativeCacheWitness=>issueNativeCacheWitness({
  kind:'pageframe',workspace_ref:'ref',generation:1,root:'/root',rel:'film.html',ms:0,width:480,
  overrides_json:null,key,frame_key:key,jpeg_sha256:'0'.repeat(64),deps_sha256:'0'.repeat(64),
  stamp_sha256:'0'.repeat(64),poster_sha256:null,dependencies:[],
  outputs:[{path:'.film/cache/film-duration.json',sha256:'0'.repeat(64),bytes:1,mtime_ms:0,
   mtime_ns:'0',ctime_ns:'0',dev:'0',ino:'0',nlink:'1'}],
  issued_at:new Date().toISOString()});
 const older=make('older'),newest=make('newest');
 expect(ledger.stage(older)).toBe(true);
 expect(ledger.activate(older)).toBe(true);
 expect(ledger.lookupByOutput('ref',1,'.film/cache/film-duration.json')).toBe(older);
 expect(ledger.stage(newest)).toBe(true);
 expect(ledger.activate(newest)).toBe(true);
 // The newest draw is the CURRENT authorisation of that output.
 expect(ledger.lookupByOutput('ref',1,'.film/cache/film-duration.json')).toBe(newest);
 // When it is revoked, the output has NO authorisation: it never falls back.
 ledger.revoke(newest);
 expect(ledger.lookupByOutput('ref',1,'.film/cache/film-duration.json')).toBeNull();
});
