import {it,expect} from 'vitest';
import {mkdtemp,rm,readdir,readFile,stat,symlink,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {processStart} from '../../../src/host/agent-driven/owned-runtime.js';
import {filmHtml} from '../../../src/host/projects/openfilm-migrator.js';
import {FPS_30} from '../../../src/host/engine/time-model.js';
import {startIsolatedStudio} from '../../../src/host/m5/isolated-studio.js';
import {OpenFilmStudioSupervisor,type StartedStudio} from '../../../src/host/m5/openfilm-studio-supervisor.js';
const vendorRoot='/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm';
it('starts the actual pinned Studio in an owned child, isolates its key/state, and waits for both listeners to stop',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-isolated-studio-'));let studio:StartedStudio|undefined;
 const before={home:process.env.OPENFILM_HOME,library:process.env.OPENFILM_LIBRARY,updates:process.env.OPENFILM_NO_UPDATE_CHECK};
 try{
  const probe=await new OpenFilmStudioSupervisor({vendorRoot,targetRootOf:async()=>{throw new Error('Not opening any project');},onStudio:()=>{}}).probe();
  expect(probe.ok,probe.reason).toBe(true);
  studio=await startIsolatedStudio({vendorRoot,runtimeRoot:join(root,'runtime')});
  expect(studio.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);expect(studio.filmOrigin).toMatch(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/);expect(studio.origin===studio.filmOrigin).toBe(false);
  const health=await fetch(studio.origin+'/api/health',{headers:{'x-studio-key':studio.key}});expect(health.status).toBe(200);expect(await health.json()).toMatchObject({product:'openfilm-studio',filmOrigin:studio.filmOrigin});
  expect((await stat(join(root,'runtime','home'))).mode&0o077).toBe(0);
  // A real native open writes .film metadata and recent-project state: only this disposable
  // projection, never an author source or committed snapshot, is handed to upstream.
  const projection=join(root,'projection');await mkdir(projection,{mode:0o700});
  const film=filmHtml([],null,FPS_30,0,{width:1280,height:720});await writeFile(join(projection,'film.html'),film,{mode:0o600});
  const opened=await fetch(studio.origin+'/api/projects',{method:'POST',headers:{'x-studio-key':studio.key,'Content-Type':'application/json'},body:JSON.stringify({path:projection,create:false})});expect(opened.status).toBe(200);
  expect((await readFile(join(projection,'.film','id'),'utf8')).trim().length>0).toBe(true);
  expect((await readFile(join(projection,'film.html'),'utf8'))===film).toBe(true);
  expect((await readFile(join(root,'runtime','home','studio.json'),'utf8')).includes(projection)).toBe(true);
  expect({home:process.env.OPENFILM_HOME,library:process.env.OPENFILM_LIBRARY,updates:process.env.OPENFILM_NO_UPDATE_CHECK}).toEqual(before);
  const origin=studio.origin,filmOrigin=studio.filmOrigin;await Promise.all([studio.close(),studio.close()]);studio=undefined;
  await expect(fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).rejects.toThrow();
  await expect(fetch(filmOrigin+'/',{signal:AbortSignal.timeout(1000)})).rejects.toThrow();
 }finally{await studio?.close();await rm(root,{recursive:true,force:true});}
},60000);
it('refuses a symlinked runtime directory before importing or starting upstream',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-studio-root-reject-'));
 try{
  await mkdir(join(root,'other'),{mode:0o700});await symlink(join(root,'other'),join(root,'runtime'),'dir');
  await expect(startIsolatedStudio({vendorRoot,runtimeRoot:join(root,'runtime')})).rejects.toMatchObject({code:'ENGINE_UNAVAILABLE'});
  expect(await readdir(join(root,'other'))).toEqual([]);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('stops its real Studio child when the owning parent is actually killed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-studio-parent-loss-'));
 const loader=createRequire(import.meta.url).resolve('tsx/esm');
 const parent=spawn(process.execPath,['--import',loader,'tests/agent-driven/integration/helpers/isolated-studio-parent.ts',join(root,'runtime'),vendorRoot],{stdio:['ignore','pipe','pipe']});
 const exited=new Promise<void>(resolve=>{parent.once('close',()=>resolve());});
 let timeout:ReturnType<typeof setTimeout>|undefined,childIdentity:{pid:number;start:string}|undefined;
 try{
  const ready=await new Promise<{origin:string;filmOrigin:string;pid:number}>((resolve,reject)=>{
   let text='';timeout=setTimeout(()=>reject(new Error('Owned Studio parent did not become ready')),20000);
   parent.once('error',reject);parent.once('exit',()=>reject(new Error('Owned Studio parent exited before readiness')));
   parent.stdout.on('data',chunk=>{text+=String(chunk);if(text.length>4096)return reject(new Error('Unexpected parent output'));if(text.includes('\n'))try{resolve(JSON.parse(text.trim()));}catch{reject(new Error('Malformed parent readiness'));}});
  });clearTimeout(timeout);
  childIdentity={pid:ready.pid,start:processStart(ready.pid)};
  expect((await fetch(ready.origin+'/api/health')).status).toBe(200);
  parent.kill('SIGKILL');await exited;
  const deadline=Date.now()+10000;let active=true;
  while(Date.now()<deadline){try{active=processStart(ready.pid)===childIdentity.start;}catch{active=false;}if(!active)break;await new Promise(resolve=>setTimeout(resolve,100));}
  expect(active).toBe(false);
  await expect(fetch(ready.origin+'/api/health',{signal:AbortSignal.timeout(1000)})).rejects.toThrow();
 }finally{
  if(timeout)clearTimeout(timeout);if(parent.exitCode===null&&parent.signalCode===null)parent.kill('SIGKILL');await exited;
  // Exact start time, never kill a recycled PID in a failed test's cleanup.
  if(childIdentity)try{if(processStart(childIdentity.pid)===childIdentity.start)spawnSync('python3',['-I','tools/agent-signal-owned.py',String(childIdentity.pid),childIdentity.start],{stdio:'ignore'});}catch{}
  await rm(root,{recursive:true,force:true});
 }
},40000);

it('retries a failed Gateway composition using a fresh actual native child instead of caching a rejected startup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-studio-retry-')),projection=join(root,'projection');
 let attempts=0;
 const supervisor=new OpenFilmStudioSupervisor({vendorRoot,isolatedRuntimeRoot:join(root,'runtime'),targetRootOf:async()=>projection,onStudio:()=>{attempts++;if(attempts===1)throw new Error('Diagnostic gateway construction failure');}});
 try{
  await mkdir(projection,{mode:0o700});await writeFile(join(projection,'film.html'),filmHtml([],null,FPS_30,0,{width:1280,height:720}),{mode:0o600});
  await expect(supervisor.ensure('diagnostic-created','first-attempt')).rejects.toThrow('Diagnostic gateway construction failure');
  const second=await supervisor.ensure('diagnostic-created','second-attempt');expect(attempts).toBe(2);expect(second.url).toMatch(/^\/projects\//);expect(new URL(second.url,'http://127.0.0.1').searchParams.get('target')).toBe('diagnostic-created');
 }finally{await supervisor.close();await rm(root,{recursive:true,force:true});}
},60000);
