const PROOF_KEY='narralens.workbench.proof';
let memoryProof:string|null=null;
function proofStorage():Pick<Storage,'getItem'|'setItem'>|undefined{try{return globalThis.sessionStorage;}catch{return undefined;}}
/** Per-origin sessionStorage is intentionally port-scoped; cookies alone are not. */
export function workbenchProofHeaders():Record<string,string>{
 let proof=memoryProof;try{proof??=proofStorage()?.getItem(PROOF_KEY)??null;}catch{}
 return proof&&/^[A-Za-z0-9_-]{43}$/.test(proof)?{'X-Narralens-CSRF':proof}:{};
}
/** Exchange the operator's one-use fragment before mounting the existing workbench.
 * It is neither a user decision nor a bearer usable by MCP. Only the origin-scoped
 * proof is session-stored; entry tickets and operator secrets are never persisted.
 */
export async function exchangeWorkbenchFragment(
 location:Pick<Location,'hash'|'pathname'|'search'>,
 history:Pick<History,'replaceState'>,
 fetcher:typeof fetch=fetch,
):Promise<void>{
 if(!location.hash.startsWith('#workbench_ticket='))return;
 const ticket=location.hash.slice('#workbench_ticket='.length);
 // Clear even malformed/expired entries before any await, navigation or diagnostics.
 history.replaceState(null,'',location.pathname+location.search);
 if(!/^[A-Za-z0-9_-]{43}$/.test(ticket))throw new Error('WORKBENCH_ENTRY_UNAVAILABLE');
 const response=await fetcher('/api/workbench/session/exchange',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})});
 if(!response.ok)throw new Error('WORKBENCH_ENTRY_UNAVAILABLE');
 const body=await response.json() as {csrf?:string};
 if(typeof body.csrf!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.csrf))throw new Error('WORKBENCH_ENTRY_UNAVAILABLE');
 memoryProof=body.csrf;
 try{proofStorage()?.setItem(PROOF_KEY,body.csrf);}catch{}
 // Only the proof is stored, never the HttpOnly cookie, ticket, or operator token.
}
