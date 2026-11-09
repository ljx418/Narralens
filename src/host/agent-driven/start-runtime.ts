import {randomBytes} from 'node:crypto';
/** Private child entry. The launcher passes the kernel lock on fd9; never start unlocked. */
import {join,resolve} from 'node:path';
import {NarralensHost} from '../server.js';
import {ProjectCatalog} from '../projects/project-catalog.js';
import {CreationApplication} from './creation-application.js';
import {runtimeRoot,beginRuntime,writePrivateJson,type RuntimeState} from './owned-runtime.js';
import {ServiceHealthRegistry,HEALTH_SAMPLE_INTERVAL_MS} from '../../launcher/health-registry.js';
import {validateAgentDefinition} from '../../contracts/agent-driven-validator.js';
import type {Instance} from '../../contracts/agent-driven-types.js';
async function start(){
 const [rootInput,vendorInput,portInput]=process.argv.slice(2);
 if(!rootInput||!vendorInput||!portInput||!/^\d+$/.test(portInput)||Number(portInput)>65535)throw new Error('INVALID_RUNTIME_ARGUMENTS');
 const root=runtimeRoot(rootInput),vendorRoot=resolve(vendorInput);
 let identity:RuntimeState=await beginRuntime(root),app!:CreationApplication;
 const registry=new ServiceHealthRegistry();
 const operatorSecret=randomBytes(32).toString('base64url');
 const ttl=Number(process.env.NARRALENS_AGENT_TOKEN_TTL_MS??86400000);
 if(!Number.isSafeInteger(ttl)||ttl<1000||ttl>86400000)throw new Error('INVALID_RUNTIME_TOKEN_TTL');
 let credential:{token:string;expires_at:number}|undefined;
 let rotating:Promise<void>|undefined;
 let stopping=false;
 let rotationFailed=false;
 const rotate=()=>rotating??=(async()=>{
  if(stopping||credential&&credential.expires_at-Date.now()>ttl/4)return;
  const next=app.auth.issue({principal_id:'local-owner',channel:'authenticated',expires_at:Date.now()+ttl});
  try{await writePrivateJson(root,'connection.json',{format:'narralens.agent-connection@1',instance_id:identity.instance_id,generation:identity.generation,origin:host.origin,token:next.token,expires_at:next.principal.expires_at});}
  catch(error){app.auth.revoke(next.token);rotationFailed=true;throw error;}
  rotationFailed=false;credential={token:next.token,expires_at:next.principal.expires_at};
 })().finally(()=>{rotating=undefined;});
 let listening=false;
 const host=new NarralensHost({catalog:new ProjectCatalog(new Map()),dbPath:join(root,'host.sqlite'),snapshotsRoot:join(root,'snapshots'),adoptionStagingRoot:join(root,'adoption-stage'),migrationsRoot:join(root,'migrations'),derivedRoot:join(root,'derived'),openFilmVendorRoot:vendorRoot,isolatedStudioRuntimeRoot:join(root,'studio-runtime','generation-'+identity.generation),
  agentApplication:instance=>app=new CreationApplication(instance,{createdRoot:join(root,'projects'),vendorRoot,nativeWorkspaceRoot:join(root,'native-workspaces'),
   workbench:{principalId:'local-owner',operatorSecret},
   ...(process.env.NARRALENS_LOCAL_ASSETS_ROOT?{localAssets:{sourceRoot:resolve(process.env.NARRALENS_LOCAL_ASSETS_ROOT),storageRoot:join(root,'local-assets')}}:{}),
   instance:()=>validateAgentDefinition<Instance>('Instance',{instance_id:identity.instance_id,generation:identity.generation,api_version:'agent.v1',contract_version:'cp-a0-r4',capabilities:[],health:listening?'degraded':'starting'}),
   health:()=>registry.read(identity.instance_id),
  })});
 const sample=()=>{
  const at=Date.now();
  for(const service of [
   {id:'host',state:listening?'ready' as const:'starting' as const,reason:listening?'loopback_listener_bound':'starting'},
   {id:'openfilm',state:host.openFilmComposition?'ready' as const:'degraded' as const,reason:host.openFilmComposition?'pinned_parser_verified':'pinned_engine_unavailable'},
   {id:'credentials',state:!rotationFailed&&credential&&credential.expires_at>at?'ready' as const:'degraded' as const,reason:rotationFailed?'credential_rotation_failed':credential&&credential.expires_at>at?'credential_current':'credential_expired'},
   {id:'video-production',state:'degraded' as const,reason:'full_run_render_delivery_producers_not_registered'},
  ])registry.record({service_id:service.id,instance_id:identity.instance_id,ownership:'owned',state:service.state,reason:service.reason,sampled_at_ms:at,metrics:[]});
 };
 let sampler:ReturnType<typeof setInterval>|undefined;
 let rotator:ReturnType<typeof setInterval>|undefined;
 let shutdown:Promise<void>|undefined;
 const stop=()=>shutdown??=(async()=>{
  stopping=true;listening=false;if(sampler)clearInterval(sampler);if(rotator)clearInterval(rotator);await rotating?.catch(()=>undefined);
  await host.close();identity={...identity,state:'stopped'};await writePrivateJson(root,'instance.json',identity);
 })();
 for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{void stop().then(()=>process.exit(0),()=>process.exit(1));});
 try{
  await host.listen(Number(portInput));listening=true;
  identity={...identity,state:'listening',origin:host.origin};
  await rotate();
  await writePrivateJson(root,'workbench-operator.json',{format:'narralens.workbench-operator@1',instance_id:identity.instance_id,generation:identity.generation,origin:host.origin,token:operatorSecret});
  await writePrivateJson(root,'instance.json',identity);
  sample();sampler=setInterval(sample,HEALTH_SAMPLE_INTERVAL_MS);sampler.unref();
  rotator=setInterval(()=>{void rotate().catch(()=>{registry.record({service_id:'credentials',instance_id:identity.instance_id,ownership:'owned',state:'degraded',reason:'credential_rotation_failed',sampled_at_ms:Date.now(),metrics:[]});});},Math.min(5000,Math.floor(ttl/4)));rotator.unref();
  process.stdout.write(JSON.stringify({event:'host.listening',instance_id:identity.instance_id,generation:identity.generation,pid:process.pid,origin:host.origin,health:'degraded'})+'\n');
 }catch(error){await stop().catch(()=>undefined);throw error;}
}
void start().catch(()=>{process.stderr.write('NARRALENS_RUNTIME_START_FAILED\n');process.exitCode=1;});
