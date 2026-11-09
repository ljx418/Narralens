import {requestWorkbenchEntry} from '../../../src/launcher/workbench-entry.js';
import {it,expect} from 'vitest';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm,stat,readFile,mkdir,symlink,writeFile,chmod,lstat,unlink} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {runtimeRoot,readPrivateJson,readRuntimeConnection,readRuntimeState,processStart,writePrivateJson} from '../../../src/host/agent-driven/owned-runtime.js';
import {probeRuntime} from '../../../src/host/agent-driven/runtime-probe.js';
import {styleDigest} from '../../../src/host/creative/digest.js';
import type {IntakePut,Intake,Instance,HealthRead} from '../../../src/contracts/agent-driven-types.js';
const loader=createRequire(import.meta.url).resolve('tsx/esm');
const vendorRoot='/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm';
interface Started {event:'host.listening'|'host.reused';instance_id:string;generation:number;pid:number;origin:string;health:string;}
function launch(root:string){
 const child=spawn(process.execPath,['--import',loader,resolve('tools/agent-runtime.ts'),'start','--root',root,'--vendor',vendorRoot,'--port','0'],{stdio:['ignore','pipe','pipe'],env:{...process.env,NARRALENS_AGENT_TOKEN_TTL_MS:'8000'}});
 let output='',stderr='';child.stderr.on('data',b=>{stderr=(stderr+String(b)).slice(-2000);});
 const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((r,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>r({code,signal}));});
 const ready=new Promise<Started>((r,reject)=>{
  const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Runtime start observation timed out: '+stderr));},25000);
  child.stdout.on('data',chunk=>{output+=String(chunk);if(output.length>65536){clearTimeout(timer);reject(new Error('Unbounded runtime stdout'));return;}
   const lines=output.split('\n');output=lines.pop()!;for(const line of lines){try{const value=JSON.parse(line) as Started;if(['host.listening','host.reused'].includes(value.event)){clearTimeout(timer);r(value);}}catch{}}
  });
  void exited.then(result=>{clearTimeout(timer);if(result.code!==0)reject(new Error('Runtime exited before readiness: '+JSON.stringify(result)+' '+stderr));});
 });
 return {child,ready,exited};
}
async function control(root:string,command:'status'|'stop'|'open'){
 const child=spawn(process.execPath,['--import',loader,resolve('tools/agent-runtime.ts'),command,'--root',root],{stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',b=>{out+=String(b);});child.stderr.on('data',b=>{err+=String(b);});
 const code=await new Promise<number|null>((r,reject)=>{child.once('error',reject);child.once('exit',r);});return {code,out,err};
}
it('uses real flock, persistent instance generations, authenticated HTTP and actual MCP without fake readiness',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-owned-runtime-'));const wrappers:ReturnType<typeof launch>[]=[];const owned=new Map<number,string>();
 try{
  // Two independent cold-start wrappers, not merely a shared in-memory promise.
  const a=launch(root),b=launch(root);wrappers.push(a,b);const [first,duplicate]=await Promise.all([a.ready,b.ready]);
  expect(new Set([first.event,duplicate.event])).toEqual(new Set(['host.listening','host.reused']));
  expect(first.pid).toBe(duplicate.pid);expect(first.instance_id).toBe(duplicate.instance_id);expect(first.generation).toBe(1);expect(first.health).toBe('degraded');owned.set(first.pid,processStart(first.pid));
  const connection=readRuntimeConnection(root)!;
  expect((await stat(join(root,'connection.json'))).mode&0o077).toBe(0);
  const headers=()=>({Origin:connection.origin,Authorization:'Bearer '+readRuntimeConnection(root)!.token});
  const instanceResponse=await fetch(connection.origin+'/api/agent/v1/instance',{headers:headers()});expect(instanceResponse.status).toBe(200);const instance=await instanceResponse.json() as Instance;
  expect(instance).toMatchObject({instance_id:first.instance_id,generation:1,health:'degraded',capabilities:[]});
  const healthResponse=await fetch(connection.origin+'/api/agent/v1/health',{headers:headers()});expect(healthResponse.status).toBe(200);const health=await healthResponse.json() as HealthRead;
  expect(health.services.find(s=>s.service_id==='host')?.state).toBe('ready');expect(health.services.find(s=>s.service_id==='video-production')?.state).toBe('degraded');
  expect((await fetch(connection.origin+'/api/agent/v1/instance',{headers:{Origin:connection.origin,Authorization:'Bearer invalid'}})).status).toBe(401);
  const operator=readPrivateJson(root,'workbench-operator.json') as {token:string;generation:number};
  expect(operator.generation).toBe(1);expect(operator.token===connection.token).toBe(false);expect((await stat(join(root,'workbench-operator.json'))).mode&0o077).toBe(0);
  expect((await fetch(connection.origin+'/api/workbench/session/open',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:'{}'})).status).toBe(401);
  const entry=await requestWorkbenchEntry(root),ticket=new URL(entry.url).hash.slice('#workbench_ticket='.length);
  const exchange=await fetch(connection.origin+'/api/workbench/session/exchange',{method:'POST',headers:{Origin:connection.origin,'Content-Type':'application/json'},body:JSON.stringify({ticket})});
  expect(exchange.status).toBe(200);const uiSession=await exchange.json() as {csrf:string};const uiCookie=exchange.headers.get('set-cookie')!.split(';')[0]!;
  const uiRead=await fetch(connection.origin+'/api/workbench/session',{headers:{Origin:connection.origin,Cookie:uiCookie,'X-Narralens-CSRF':uiSession.csrf}});expect(uiRead.status).toBe(200);expect(await uiRead.json()).toMatchObject({principal_id:'local-owner'});
  const cliEntry=await control(root,'open');expect(cliEntry.code,cliEntry.err).toBe(0);expect(JSON.parse(cliEntry.out).event).toBe('workbench.entry');
  const snapshot=readRuntimeState(root)!;
  try{await expect(probeRuntime(root,async(url,init)=>{const response=await fetch(url,init);await writePrivateJson(root,'instance.json',{...snapshot,generation:snapshot.generation+1});return response;})).rejects.toThrow('INSTANCE_CHANGED_DURING_PROBE');}
  finally{await writePrivateJson(root,'instance.json',snapshot);}
  const invalidSignal=spawnSync('python3',['-I',resolve('tools/agent-signal-owned.py'),String(first.pid),snapshot.process_start+'0'],{stdio:'ignore'});expect(invalidSignal.status).toBe(3);expect(processStart(first.pid)).toBe(snapshot.process_start);
  const env=Object.fromEntries(Object.entries(process.env).filter((v):v is [string,string]=>v[1]!==undefined));delete env.NARRALENS_HOST_URL;delete env.NARRALENS_HOST_TOKEN;
  const transport=new StdioClientTransport({command:process.execPath,args:['--import',loader,resolve('tools/agent-mcp.ts'),'--root',root],cwd:process.cwd(),env,stderr:'pipe'});
  const client=new Client({name:'owned-runtime-real-mcp',version:'1.0.0'},{capabilities:{}});
  try{
   await client.connect(transport);
   const handshake=await client.callTool({name:'narralens_capabilities',arguments:{}});expect(handshake.isError).not.toBe(true);expect(handshake.structuredContent).toEqual(instance);
   const vectors=JSON.parse(readFileSync('docs/agent-driven-v1/cp-a0/contract-vectors.json','utf8')) as {vectors:{id:string;value:unknown}[]};
   const input=structuredClone(vectors.vectors.find(v=>v.id==='definition:IntakePut:valid')!.value) as IntakePut;
   input.intake_id=null;input.base_version=0;input.brief.narration_asset_id=null;input.brief.content_brief.material_strategy.narration_asset_id=null;input.brief.content_brief.script_ref=null;input.brief.content_brief.style.style_digest=styleDigest(input.brief.content_brief.style);
   const saved=await client.callTool({name:'narralens_intake_put',arguments:input});expect(saved.isError,JSON.stringify(saved)).not.toBe(true);const intake=saved.structuredContent as unknown as Intake;
   const read=await fetch(connection.origin+'/api/agent/v1/intakes/'+intake.intake_id,{headers:headers()});expect(read.status).toBe(200);expect(await read.json()).toEqual(intake);
   const beforeRotation=readRuntimeConnection(root)!;await new Promise(r=>setTimeout(r,9000));const afterRotation=readRuntimeConnection(root)!;expect(afterRotation.generation).toBe(beforeRotation.generation);expect(afterRotation.token===beforeRotation.token).toBe(false);
   const after=await client.callTool({name:'narralens_intake_read',arguments:{intake_id:intake.intake_id}});expect(after.isError).not.toBe(true);expect(after.structuredContent).toEqual(intake);
   const currentState=readRuntimeState(root)!;
   try{await writePrivateJson(root,'instance.json',{...currentState,generation:currentState.generation+1});const blocked=await client.callTool({name:'narralens_intake_put',arguments:{...input,meta:{...input.meta,idempotency_key:'stale-generation-write'}}});expect(blocked.isError).toBe(true);expect(blocked.structuredContent).toMatchObject({code:'UNAUTHORIZED',next_actions:['reconnect_authorized_instance']});}
   finally{await writePrivateJson(root,'instance.json',currentState);}
   const stillThere=await client.callTool({name:'narralens_intake_read',arguments:{intake_id:intake.intake_id}});expect(stillThere.isError).not.toBe(true);expect(stillThere.structuredContent).toEqual(intake);
  }finally{await client.close();await transport.close();}
  const status=await control(root,'status');expect(status.code,status.err).toBe(0);expect(status.out).not.toContain(connection.token);
  // Killing just the wrapper must NOT free a live child's inherited kernel lock.
  const wrapper=first.event==='host.listening'?a:b;wrapper.child.kill('SIGKILL');await wrapper.exited;
  const attached=launch(root);wrappers.push(attached);expect(await attached.ready).toMatchObject({event:'host.reused',pid:first.pid,generation:1});expect((await attached.exited).code).toBe(0);
  const stop=await control(root,'stop');expect(stop.code,stop.err).toBe(0);
  const deadline=Date.now()+10000;while(Date.now()<deadline&&readRuntimeState(root)?.state!=='stopped')await new Promise(r=>setTimeout(r,25));
  expect(readRuntimeState(root)?.state).toBe('stopped');
  const restarted=launch(root);wrappers.push(restarted);const second=await restarted.ready;owned.set(second.pid,processStart(second.pid));expect(second.instance_id).toBe(first.instance_id);expect(second.generation).toBe(2);
  expect((readPrivateJson(root,'workbench-operator.json') as {token:string}).token===operator.token).toBe(false);
  expect((await fetch(second.origin+'/api/workbench/session',{headers:{Origin:second.origin,Cookie:uiCookie,'X-Narralens-CSRF':uiSession.csrf}})).status).toBe(401);
  const fresh=readRuntimeConnection(root)!;expect((await fetch(fresh.origin+'/api/agent/v1/instance',{headers:{Origin:fresh.origin,Authorization:'Bearer '+connection.token}})).status).toBe(401);
  // Crash the actual Host; its next launch advances, never resets, the generation.
  process.kill(second.pid,'SIGKILL');expect((await restarted.exited).code).toBe(1);
  const recovered=launch(root);wrappers.push(recovered);const third=await recovered.ready;owned.set(third.pid,processStart(third.pid));expect(third.instance_id).toBe(first.instance_id);expect(third.generation).toBe(3);
  const stopped=await control(root,'stop');expect(stopped.code,stopped.err).toBe(0);expect((await recovered.exited).code).toBe(0);
  const key=JSON.parse(await readFile(join(root,'cursor-key.json'),'utf8')) as {key:string};expect(Buffer.from(key.key,'base64url')).toHaveLength(32);
 }finally{
  // Only process identities observed from our own actual starts; never kill by name.
  for(const [pid,start] of owned){try{if(processStart(pid)===start)process.kill(pid,'SIGTERM');}catch{}}
  for(const wrapper of wrappers)if(wrapper.child.exitCode===null&&wrapper.child.signalCode===null)wrapper.child.kill('SIGTERM');
  await Promise.allSettled(wrappers.map(w=>w.exited));await rm(root,{recursive:true,force:true});
 }
},180000);

it('rejects a symlink ancestor before creating an aliased runtime and never loosens an existing directory',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-runtime-paths-'));
 try{expect(runtimeRoot(join(root,'safe','nested'))).toBe(join(root,'safe','nested'));const target=join(root,'target');await mkdir(target,{mode:0o700});await symlink(target,join(root,'alias'),'dir');expect(()=>runtimeRoot(join(root,'alias','new'))).toThrow('RUNTIME_ROOT_ALIAS_REJECTED');await expect(lstat(join(target,'new'))).rejects.toMatchObject({code:'ENOENT'});
  const broad=join(root,'broad');await mkdir(broad,{mode:0o755});expect(()=>runtimeRoot(broad)).toThrow('RUNTIME_OWNERSHIP_UNVERIFIED');expect((await stat(broad)).mode&0o777).toBe(0o755);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('bounds and no-follows private JSON, rejecting unknown names, permissions and malformed metadata',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-runtime-json-'));
 try{await writePrivateJson(root,'instance.json',{sentinel:'intact'});expect(readPrivateJson(root,'instance.json')).toEqual({sentinel:'intact'});expect(()=>readRuntimeState(root)).toThrow('RUNTIME_STATE_INVALID');expect(()=>readPrivateJson(root,'../outside.json')).toThrow('RUNTIME_FILE_NAME_INVALID');
  await symlink(join(root,'instance.json'),join(root,'connection.json'));expect(()=>readPrivateJson(root,'connection.json')).toThrow();
  await expect(writePrivateJson(root,'connection.json',{replaced:true})).rejects.toThrow('RUNTIME_OWNERSHIP_UNVERIFIED');expect(readPrivateJson(root,'instance.json')).toEqual({sentinel:'intact'});
  await writeFile(join(root,'large.json'),'x'.repeat(65537),{mode:0o600});expect(()=>readPrivateJson(root,'large.json')).toThrow('RUNTIME_FILE_INVALID');
  await chmod(join(root,'instance.json'),0o644);expect(()=>readPrivateJson(root,'instance.json')).toThrow('RUNTIME_FILE_INVALID');
 }finally{await rm(root,{recursive:true,force:true});}
});
it('refuses the actual Host child entry without an inherited kernel lock',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-runtime-unlocked-'));
 try{const child=spawn(process.execPath,['--import',loader,resolve('src/host/agent-driven/start-runtime.ts'),root,vendorRoot,'0'],{stdio:'ignore'});const code=await new Promise<number|null>((r,reject)=>{child.once('error',reject);child.once('exit',r);});expect(code).toBe(1);expect(readRuntimeState(root)).toBeNull();}
 finally{await rm(root,{recursive:true,force:true});}
},30000);

it('refuses a second Host after its live predecessor lock path is unlinked, then permits a real stopped restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-runtime-unlinked-'));const wrappers:ReturnType<typeof launch>[]=[];const owned=new Map<number,string>();
 try{
  const first=launch(root);wrappers.push(first);const one=await first.ready;owned.set(one.pid,processStart(one.pid));
  await unlink(join(root,'instance.lock'));
  const duplicate=launch(root);wrappers.push(duplicate);
  void duplicate.ready.then(value=>{owned.set(value.pid,processStart(value.pid));},()=>undefined);
  const observed=await Promise.race([duplicate.exited.then(exit=>({kind:'exit' as const,exit})),duplicate.ready.then(value=>({kind:'ready' as const,value}),()=>({kind:'rejected' as const}))]);
  expect(observed.kind).not.toBe('ready');expect((await duplicate.exited).code).toBe(1);expect(readRuntimeState(root)).toMatchObject({pid:one.pid,generation:1});
  expect((await control(root,'stop')).code).toBe(0);expect((await first.exited).code).toBe(0);
  const next=launch(root);wrappers.push(next);const two=await next.ready;owned.set(two.pid,processStart(two.pid));expect(two.instance_id).toBe(one.instance_id);expect(two.generation).toBe(2);expect((await control(root,'stop')).code).toBe(0);expect((await next.exited).code).toBe(0);
 }finally{
  for(const [pid,start] of owned){try{if(processStart(pid)===start)process.kill(pid,'SIGTERM');}catch{}}
  for(const wrapper of wrappers)if(wrapper.child.exitCode===null&&wrapper.child.signalCode===null)wrapper.child.kill('SIGTERM');
  await Promise.allSettled(wrappers.map(w=>w.exited));await rm(root,{recursive:true,force:true});
 }
},120000);

it('rejects a private FIFO without blocking the launcher event loop',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-runtime-fifo-'));
 try{
  expect(spawnSync('mkfifo',['-m','600',join(root,'instance.json')],{stdio:'ignore'}).status).toBe(0);
  const code="import {readPrivateJson} from './src/host/agent-driven/owned-runtime.ts';try{readPrivateJson(process.argv[1],'instance.json');process.exit(7);}catch{process.exit(1);}";
  const child=spawn(process.execPath,['--import',loader,'--input-type=module','-e',code,root],{stdio:'ignore'});
  const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
  const exit=await new Promise<{code:number|null;signal:NodeJS.Signals|null}>((r,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>r({code,signal}));});clearTimeout(timer);
  expect(exit).toEqual({code:1,signal:null});
 }finally{await rm(root,{recursive:true,force:true});}
},20000);
it('cancels only its spawned Host when TERM reaches the wrapper before Host readiness',async()=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-runtime-cancel-start-'));let pid:number|undefined,start:string|undefined;const wrapper=launch(root);void wrapper.ready.catch(()=>undefined);
 try{
  const until=Date.now()+15000;
  while(Date.now()<until&&pid===undefined){
   try{
    const children=(await readFile('/proc/'+wrapper.child.pid+'/task/'+wrapper.child.pid+'/children','utf8')).trim().split(/\s+/).filter(Boolean);
    for(const value of children){const command=await readFile('/proc/'+value+'/cmdline','utf8');if(command.includes('src/host/agent-driven/start-runtime.ts')&&command.includes(root)&&readRuntimeState(root)?.state!=='listening'){pid=Number(value);start=processStart(pid);break;}}
   }catch{}
   if(pid===undefined)await new Promise(r=>setTimeout(r,20));
  }
  expect(pid,'must observe our real child before ready, not assume a timing window').toBeDefined();
  wrapper.child.kill('SIGTERM');await wrapper.exited;
  const deadline=Date.now()+5000;let alive=true;
  while(Date.now()<deadline){try{alive=processStart(pid!)===start;}catch{alive=false;}if(!alive)break;await new Promise(r=>setTimeout(r,50));}
  expect(alive,'wrapper cancellation left a hidden Host running').toBe(false);
 }finally{
  if(pid&&start)spawnSync('python3',['-I',resolve('tools/agent-signal-owned.py'),String(pid),start],{stdio:'ignore'});
  if(wrapper.child.exitCode===null&&wrapper.child.signalCode===null)wrapper.child.kill('SIGTERM');await wrapper.exited;
  await new Promise(r=>setTimeout(r,100));await rm(root,{recursive:true,force:true});
 }
},40000);
