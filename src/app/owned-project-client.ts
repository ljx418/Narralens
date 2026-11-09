import {validateOwnedProjects,validateNativeEntry} from '../contracts/owned-projects.js';
import {workbenchProofHeaders} from './workbench-session.js';
/** Only navigate to the entry issued for the explicitly selected owned project. */
export async function readOwnedProjects(after:string|null=null,fetcher:typeof fetch=fetch){
 const query=after===null?'':'?after='+encodeURIComponent(after);
 const response=await fetcher('/api/ui/v1/projects'+query,{credentials:'same-origin',cache:'no-store',redirect:'error',headers:workbenchProofHeaders()});
 if(!response.ok)throw new Error('工程列表暂不可用，请刷新；会话失效时请从启动入口重新打开。');
 return validateOwnedProjects(await response.json());
}
export async function openOwnedProject(projectId:string,fetcher:typeof fetch=fetch){
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(projectId))throw new Error('工程标识无效。');
 const response=await fetcher('/api/ui/v1/projects/'+projectId+'/native-open',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{...workbenchProofHeaders(),'Content-Type':'application/json'},body:'{}'});
 if(!response.ok)throw new Error('工程暂时无法打开，请刷新状态后重试。');
 const entry=validateNativeEntry(await response.json());
 if(entry.project_id!==projectId||entry.expires_at<=Date.now())throw new Error('工程入口已失效，请重新打开。');
 return entry;
}
export async function discoverWorkbenchMode(fetcher:typeof fetch=fetch):Promise<'owned'|'legacy'>{
 const response=await fetcher('/api/session',{credentials:'same-origin',cache:'no-store',redirect:'error',headers:workbenchProofHeaders()});
 if(!response.ok)throw new Error('工作台会话已失效，请从本机启动入口重新打开。');
 const value=await response.json() as {mode?:unknown;token?:unknown;expires_at?:unknown};
 if(value.mode==='trusted_ui')return 'owned';
 if(typeof value.token==='string'&&value.token.length>0&&typeof value.expires_at==='string')return 'legacy';
 throw new Error('无法确认工作台服务，请从本机启动入口重新打开。');
}
