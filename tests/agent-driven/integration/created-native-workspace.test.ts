import {createServer} from 'node:http';
import {OpenFilmStudioSupervisor} from '../../../src/host/m5/openfilm-studio-supervisor.js';
import {it,expect} from 'vitest';
import {readFile,writeFile,readdir,stat,symlink,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {CreatedNativeWorkspaceService} from '../../../src/host/agent-driven/created-native-workspace.js';
import {startIsolatedStudio} from '../../../src/host/m5/isolated-studio.js';
import {createdProjectFixture,vendorRoot} from './helpers/created-project-fixture.js';
function workspace(f:Awaited<ReturnType<typeof createdProjectFixture>>,root=join(f.root,'native-workspaces'),boundary?:ConstructorParameters<typeof CreatedNativeWorkspaceService>[3]['boundary']){
 return new CreatedNativeWorkspaceService(f.host.revisions,f.app.creation,f.app.committedSnapshots,{root,...(boundary?{boundary}:{}),protectedRoots:[join(f.root,'projects'),join(f.root,'snapshots'),vendorRoot]});
}
it('opens the real HTTP-created committed project in native Studio using only its independent verified working copy',async()=>{
 const f=await createdProjectFixture(),service=workspace(f);let native:Awaited<ReturnType<typeof startIsolatedStudio>>|undefined;
 try{
  const snapshotBefore=await readFile(join(f.closure.native_root,'film.html'));
  const view=await service.prepare(f.projectId,f.owner);expect(view.source_root.value===f.authorRoot).toBe(false);expect(view.source_root.value===f.closure.native_root).toBe(false);
  expect(await readFile(join(view.source_root.value,'film.html'))).toEqual(snapshotBefore);
  native=await startIsolatedStudio({vendorRoot,runtimeRoot:join(f.root,'native-state')});
  const response=await fetch(native.origin+'/api/projects',{method:'POST',headers:{'x-studio-key':native.key,'Content-Type':'application/json'},body:JSON.stringify({path:view.source_root.value,create:false})});expect(response.status).toBe(200);
  expect((await readFile(join(view.source_root.value,'.film','id'),'utf8')).trim().length>0).toBe(true);
  expect(await readdir(f.authorRoot)).toEqual(['film.html']);expect(await readdir(f.closure.native_root)).toEqual(['film.html']);
  expect(await readFile(join(f.authorRoot,'film.html'))).toEqual(f.authorBytes);expect(await readFile(join(f.closure.native_root,'film.html'))).toEqual(snapshotBefore);
  expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
  await service.close();expect((await stat(view.source_root.value)).isDirectory()).toBe(true);
  await native.close();native=undefined;await service.disposeAfterNative();await expect(stat(view.source_root.value)).rejects.toMatchObject({code:'ENOENT'});
 }finally{await native?.close();await service.disposeAfterNative();await f.close();}
},60000);
it('coalesces identical preparation, rejects a foreign principal before I/O, and does not turn a copy into a revision',async()=>{
 const f=await createdProjectFixture(),service=workspace(f);
 try{
  await expect(service.prepare(f.projectId,f.foreign)).rejects.toMatchObject({code:'NOT_FOUND'});await expect(stat(join(f.root,'native-workspaces'))).rejects.toMatchObject({code:'ENOENT'});
  const [a,b]=await Promise.all([service.prepare(f.projectId,f.owner),service.prepare(f.projectId,f.owner)]);expect(a.source_root.value).toBe(b.source_root.value);
  expect((await service.rootFor(f.projectId)).value).toBe(a.source_root.value);expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
 }finally{await service.disposeAfterNative();await f.close();}
},60000);
it('refuses a modified disposable source, then rebuilds from the still-proven immutable snapshot',async()=>{
 const f=await createdProjectFixture(),service=workspace(f);
 try{
  const original=await service.prepare(f.projectId,f.owner);await writeFile(join(original.source_root.value,'film.html'),'uncontrolled cache modification');
  await expect(service.rootFor(f.projectId)).rejects.toMatchObject({code:'REVISION_CONFLICT'});
  const rebuilt=await service.prepare(f.projectId,f.owner);expect(rebuilt.source_root.value===original.source_root.value).toBe(false);expect(rebuilt.snapshot_id).toBe(original.snapshot_id);
  expect(await readFile(join(rebuilt.source_root.value,'film.html'))).toEqual(f.authorBytes);expect(await readFile(join(f.closure.native_root,'film.html'))).toEqual(f.authorBytes);expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
 }finally{await service.disposeAfterNative();await f.close();}
},60000);
it('rejects storage overlapping an author or snapshot root before creating any directories',async()=>{
 const f=await createdProjectFixture();
 try{
  expect(()=>workspace(f,join(f.authorRoot,'bad-cache'))).toThrow();expect(()=>workspace(f,join(f.closure.native_root,'bad-cache'))).toThrow();
  await expect(stat(join(f.authorRoot,'bad-cache'))).rejects.toMatchObject({code:'ENOENT'});expect(await readdir(f.authorRoot)).toEqual(['film.html']);
 }finally{await f.close();}
},60000);
it('does not follow a symbolic-link leaf in a damaged derived copy',async()=>{
 const f=await createdProjectFixture(),service=workspace(f);
 try{
  const view=await service.prepare(f.projectId,f.owner);const path=join(view.source_root.value,'film.html');
  const {unlink}=await import('node:fs/promises');await unlink(path);await symlink(join(f.authorRoot,'film.html'),path);
  await expect(service.rootFor(f.projectId)).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
  const rebuilt=await service.prepare(f.projectId,f.owner);expect(rebuilt.source_root.value===view.source_root.value).toBe(false);expect(await readFile(join(f.authorRoot,'film.html'))).toEqual(f.authorBytes);
 }finally{await service.disposeAfterNative();await f.close();}
},60000);
it('wires the actual Host Supervisor to a prepared committed copy and removes it only after native shutdown',async()=>{
 const f=await createdProjectFixture();
 try{
  const prepared=await f.app.nativeWorkspaces.prepare(f.projectId,f.owner);
  const preview=await f.host.m5Supervisor.ensure(f.projectId,'actual-created-native-open');
  const url=new URL(preview.url);expect(url.searchParams.get('target')).toBe(f.projectId);expect(url.pathname).toMatch(/^\/projects\//);
  expect((await fetch(preview.url)).status).toBe(200);expect((await stat(join(prepared.source_root.value,'.film','id'))).isFile()).toBe(true);
  expect(await readFile(join(f.authorRoot,'film.html'))).toEqual(f.authorBytes);expect(await readdir(f.authorRoot)).toEqual(['film.html']);expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
  await f.host.close();await expect(stat(prepared.source_root.value)).rejects.toMatchObject({code:'ENOENT'});await expect(fetch(preview.url,{signal:AbortSignal.timeout(1000)})).rejects.toThrow();
 }finally{await f.close();}
},60000);
it('closes every actual late-created Gateway/Studio listener when Host close races Gateway publication',async()=>{
 let reached!:()=>void,release!:()=>void;
 const ready=new Promise<void>(resolve=>{reached=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 let origins:string[]=[];
 const f=await createdProjectFixture({studioBeforeGatewayPublish:async state=>{origins=[state.gateway_origin,state.studio_origin,state.film_origin];reached();await gate;}});
 try{
  await f.app.nativeWorkspaces.prepare(f.projectId,f.owner);
  const opening=f.host.m5Supervisor.ensure(f.projectId,'close-before-publish').then(()=>false,()=>true);
  await ready;
  const gateway=await fetch(origins[0]!+'/api/health');
  const filmGateway=gateway.headers.get('content-security-policy')?.match(/frame-src (http:\/\/127\.0\.0\.1:\d+)/)?.[1];expect(typeof filmGateway).toBe('string');if(filmGateway)origins.push(filmGateway);
  const normalize=(origin:string)=>{const url=new URL(origin);url.hostname='127.0.0.1';return url.origin;};
  for(const origin of origins)expect((await fetch(normalize(origin)+'/api/health',{signal:AbortSignal.timeout(1000)})).status>0).toBe(true);
  const closing=f.host.close();release();await closing;expect(await opening).toBe(true);
  for(const origin of origins)await expect(fetch(normalize(origin)+'/api/health',{signal:AbortSignal.timeout(1000)})).rejects.toThrow();
 }finally{release();await f.close();}
},60000);

it('rechecks the actual cached preparation after its awaited verification when shutdown begins',async()=>{
 const f=await createdProjectFixture();let service!:CreatedNativeWorkspaceService,closing:Promise<void>|undefined;
 service=workspace(f,join(f.root,'native-workspaces'),async()=>{closing=service.close();});
 try{
  await service.prepare(f.projectId,f.owner);
  await expect(service.prepare(f.projectId,f.owner)).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});await closing;
 }finally{await service.disposeAfterNative();await f.close();}
},60000);
it('rejects an ancestor alias installed after construction without creating anything inside the real snapshot',async()=>{
 const f=await createdProjectFixture(),parent=join(f.root,'cache-parent');await mkdir(parent,{mode:0o700});
 const service=workspace(f,join(parent,'workspaces'));
 try{
  await rm(parent,{recursive:true});await symlink(f.closure.native_root,parent,'dir');
  await expect(service.prepare(f.projectId,f.owner)).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
  expect(await readdir(f.closure.native_root)).toEqual(['film.html']);await expect(stat(join(f.closure.native_root,'workspaces'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{await service.disposeAfterNative();await f.close();}
},60000);
it('refuses an obsolete prepared version after the actual native startup window',async()=>{
 let reached!:()=>void,release!:()=>void;
 const entered=new Promise<void>(resolve=>{reached=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const f=await createdProjectFixture({studioBeforeGatewayPublish:async()=>{reached();await gate;}});
 try{
  const old=await f.app.nativeWorkspaces.prepare(f.projectId,f.owner);
  const opening=f.host.m5Supervisor.ensure(f.projectId,'startup-version-window');void opening.catch(()=>undefined);await entered;
  await writeFile(join(old.source_root.value,'film.html'),'damaged disposable copy');const fresh=await f.app.nativeWorkspaces.prepare(f.projectId,f.owner);expect(fresh.source_root.value===old.source_root.value).toBe(false);
  release();await expect(opening).rejects.toMatchObject({code:'SOURCE_CHANGED'});await expect(stat(join(old.source_root.value,'.film','id'))).rejects.toMatchObject({code:'ENOENT'});
  expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
 }finally{release();await f.close();}
},60000);
it('does not publish a preview when the actual native-open response races a prepared version replacement',async()=>{
 const f=await createdProjectFixture();let realOrigin='',key='',replace:()=>Promise<void>;
 const proxy=createServer((request,response)=>{void(async()=>{
  if(request.method!=='POST'||request.url!=='/api/projects'||request.headers['x-studio-key']!==key){response.writeHead(403);response.end();return;}
  const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
  const result=await fetch(realOrigin+'/api/projects',{method:'POST',headers:{'x-studio-key':key,'Content-Type':'application/json'},body:Buffer.concat(chunks).toString('utf8')});
  const bytes=Buffer.from(await result.arrayBuffer());await replace();response.writeHead(result.status,{'Content-Type':'application/json'});response.end(bytes);
 })().catch(()=>{response.writeHead(500);response.end('Diagnostic open proxy failed');});});
 await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 const proxyOrigin='http://127.0.0.1:'+((proxy.address() as {port:number}).port);
 const supervisor=new OpenFilmStudioSupervisor({vendorRoot,isolatedRuntimeRoot:join(f.root,'response-window-native'),targetRootOf:async()=> (await f.app.nativeWorkspaces.rootFor(f.projectId)).value,onStudio:studio=>{realOrigin=studio.origin;key=studio.key;Object.defineProperty(studio,'origin',{value:proxyOrigin});}});
 try{
  const old=await f.app.nativeWorkspaces.prepare(f.projectId,f.owner);
  replace=async()=>{await writeFile(join(old.source_root.value,'film.html'),'damaged after actual native open');await f.app.nativeWorkspaces.prepare(f.projectId,f.owner);};
  await expect(supervisor.ensure(f.projectId,'response-version-window')).rejects.toMatchObject({code:'SOURCE_CHANGED'});
  expect((await stat(join(old.source_root.value,'.film','id'))).isFile()).toBe(true);expect(f.host.revisions.activeCommit(f.projectId)).toEqual(f.commit);
 }finally{await supervisor.close();proxy.closeAllConnections();await new Promise<void>((resolve,reject)=>proxy.close(error=>error?reject(error):resolve()));await f.close();}
},60000);
