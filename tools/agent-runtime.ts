/** Real local I/O is injected into the approved launcher planner; no second supervisor. */
import {closeSync} from 'node:fs';
import {resolve} from 'node:path';
import {runtimeRoot,openRuntimeLock,readRuntimeState,initialInstanceId} from '../src/host/agent-driven/owned-runtime.js';
import {LauncherSupervisor} from '../src/launcher/service-supervisor.js';
import {LocalRuntimePorts} from '../src/launcher/local-runtime-ports.js';
function args(){
 const input=process.argv.slice(2);let command='start',root=resolve('var/agent-a'),vendor=process.env.NARRALENS_OPENFILM_VENDOR?resolve(process.env.NARRALENS_OPENFILM_VENDOR,'vendor/openfilm'):resolve('../Narralens-openfilm-m1b/vendor/openfilm'),port='0';
 for(let i=0;i<input.length;i++){
  const value=input[i]!;
  if(['start','status','stop'].includes(value)&&i===0)command=value;
  else if(value==='--root'&&input[i+1])root=resolve(input[++i]!);
  else if(value==='--vendor'&&input[i+1])vendor=resolve(input[++i]!);
  else if(value==='--port'&&input[i+1]&&/^\d+$/.test(input[i+1]!)&&Number(input[i+1])<=65535)port=input[++i]!;
  else throw new Error('INVALID_LAUNCH_ARGUMENTS');
 }
 return {command,root:runtimeRoot(root),vendor,port};
}
async function main(){
 const config=args(),fd=config.command==='start'?openRuntimeLock(config.root):null;
 const ports=new LocalRuntimePorts({...config,lockFd:fd,allowLaunch:config.command==='start'});
 const supervisor=new LauncherSupervisor({discovery:ports,launch:ports,probe:ports});
 try{
  if(config.command==='start')for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>ports.forwardSignal(signal));
  const instanceId=readRuntimeState(config.root)?.instance_id??initialInstanceId(config.root);
  const outcome=await supervisor.start({runtime_root:config.root,instance_id:instanceId});
  const authenticated=ports.authenticatedInstance;
  if(outcome.instance.state!=='ready'||!authenticated||authenticated.instance_id!==outcome.instance.instance_id||authenticated.generation!==outcome.instance.generation)throw new Error('INSTANCE_UNVERIFIED');
  if(config.command==='stop'){
   const stopped=await supervisor.stop(outcome.instance.instance_id);
   if(!stopped.stopped)throw new Error('STOP_NOT_CONFIRMED');
   process.stdout.write(JSON.stringify({event:'host.stopped',instance_id:authenticated.instance_id,generation:authenticated.generation})+'\n');return;
  }
  if(config.command==='status'){
   process.stdout.write(JSON.stringify({event:'host.status',instance:authenticated,origin:outcome.instance.endpoint,pid:outcome.instance.pid})+'\n');return;
  }
  process.stdout.write(JSON.stringify({event:outcome.launched?'host.listening':'host.reused',instance_id:authenticated.instance_id,generation:authenticated.generation,pid:outcome.instance.pid,origin:outcome.instance.endpoint,health:authenticated.health})+'\n');
  const exit=await ports.waitForChild();if(exit)process.exitCode=exit.code??(exit.signal?1:0);
 }finally{if(fd!==null)closeSync(fd);}
}
void main().catch(()=>{process.stderr.write('NARRALENS_RUNTIME_OPERATION_UNAVAILABLE\n');process.exitCode=1;});
