import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {readRuntimeConnection,readRuntimeState,processStart,type RuntimeState,type RuntimeConnection} from './owned-runtime.js';
import {validateAgentDefinition} from '../../contracts/agent-driven-validator.js';
import type {Instance} from '../../contracts/agent-driven-types.js';
export interface RuntimeProbe {readonly state:RuntimeState;readonly connection:RuntimeConnection;readonly instance:Instance;}
function same(a:RuntimeState|null,b:RuntimeState):boolean{return !!a&&a.instance_id===b.instance_id&&a.generation===b.generation&&a.pid===b.pid&&a.process_start===b.process_start&&a.origin===b.origin&&a.state==='listening';}
export function assertRuntimeSnapshot(root:string,snapshot:RuntimeProbe):void {
 if(!same(readRuntimeState(root),snapshot.state)||processStart(snapshot.state.pid)!==snapshot.state.process_start)throw new Error('INSTANCE_CHANGED_DURING_PROBE');
}
export async function probeRuntime(root:string,fetcher:typeof fetch=fetch):Promise<RuntimeProbe>{
 const state=readRuntimeState(root),connection=readRuntimeConnection(root);
 if(!state||!connection||connection.instance_id!==state.instance_id||connection.generation!==state.generation||connection.origin!==state.origin)throw new Error('INSTANCE_NOT_READY');
 const response=await fetcher(connection.origin+'/api/agent/v1/instance',{redirect:'error',signal:AbortSignal.timeout(5000),headers:{Origin:connection.origin,Authorization:'Bearer '+connection.token}});
 if(!response.ok)throw new Error('INSTANCE_PROBE_REJECTED');
 const instance=validateAgentDefinition<Instance>('Instance',await response.json());
 if(instance.instance_id!==state.instance_id||instance.generation!==state.generation)throw new Error('INSTANCE_IDENTITY_MISMATCH');
 const snapshot={state,connection,instance};assertRuntimeSnapshot(root,snapshot);return snapshot;
}
/** pidfd binds the signal to the exact kernel process, closing the PID reuse window. */
export function stopProbedRuntime(root:string,snapshot:RuntimeProbe):void {
 assertRuntimeSnapshot(root,snapshot);
 if(snapshot.state.pid===process.pid)throw new Error('REFUSE_SELF_STOP');
 const result=spawnSync('python3',['-I',resolve('tools/agent-signal-owned.py'),String(snapshot.state.pid),snapshot.state.process_start],{stdio:'ignore'});
 if(result.error||result.status!==0)throw new Error('OWNED_PROCESS_STOP_UNVERIFIED');
}
