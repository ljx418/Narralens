import {readPrivateJson} from '../host/agent-driven/owned-runtime.js';
import {probeRuntime,assertRuntimeSnapshot} from '../host/agent-driven/runtime-probe.js';
/** Explicit local operator action. Driver connection never contains this credential.
 * The returned fragment is a short-lived entry secret; callers must not log it or
 * treat opening the workbench as a creative approval. No browser is opened here.
 */
export async function requestWorkbenchEntry(root:string):Promise<{url:string;expires_at:number}>{
 const snapshot=await probeRuntime(root);
 const value=readPrivateJson(root,'workbench-operator.json');
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('WORKBENCH_OPERATOR_UNAVAILABLE');
 const operator=value as Record<string,unknown>;
 if(Object.keys(operator).sort().join(',')!=='format,generation,instance_id,origin,token'||operator.format!=='narralens.workbench-operator@1'||operator.instance_id!==snapshot.instance.instance_id||operator.generation!==snapshot.instance.generation||operator.origin!==snapshot.connection.origin||typeof operator.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(operator.token))throw new Error('WORKBENCH_OPERATOR_UNAVAILABLE');
 assertRuntimeSnapshot(root,snapshot);
 const response=await fetch(snapshot.connection.origin+'/api/workbench/session/open',{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Origin:snapshot.connection.origin,Authorization:'Bearer '+operator.token,'Content-Type':'application/json'},body:'{}'});
 if(!response.ok)throw new Error('WORKBENCH_ENTRY_UNAVAILABLE');
 const body=await response.json() as Record<string,unknown>;
 if(!body||Object.keys(body).sort().join(',')!=='expires_at,url'||typeof body.url!=='string'||typeof body.expires_at!=='number'||!Number.isSafeInteger(body.expires_at)||body.expires_at<=Date.now()||body.expires_at>Date.now()+5*60*1000)throw new Error('WORKBENCH_ENTRY_INVALID');
 const url=new URL(body.url);
 if(url.origin!==snapshot.connection.origin||url.pathname!=='/'||url.search||!/^#workbench_ticket=[A-Za-z0-9_-]{43}$/.test(url.hash))throw new Error('WORKBENCH_ENTRY_INVALID');
 assertRuntimeSnapshot(root,snapshot);
 return {url:url.href,expires_at:body.expires_at};
}
