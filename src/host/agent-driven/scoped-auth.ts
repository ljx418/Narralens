import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type AgentChannel='authenticated'|'trusted_ui'|'native_bridge';
export interface AgentPrincipal {
  readonly principal_id:string;
  readonly channel:AgentChannel;
  readonly session_ref:string;
  readonly expires_at:number;
}
export class AgentAuthError extends Error {
  constructor(readonly code:'UNAUTHORIZED'|'ORIGIN_REJECTED') {super('The request is not authorized for this channel');}
}
interface Credential {
  digest:Buffer;
  csrfDigest:Buffer|null;
  principal:AgentPrincipal;
  revoked:boolean;
}
const hash=(v:string)=>createHash('sha256').update(v).digest();
const match=(v:string,digest:Buffer)=>timingSafeEqual(hash(v),digest);
const forbidden=()=>new AgentAuthError('ORIGIN_REJECTED');
/** MAIN supplies credentials out-of-band. Nothing in the protocol can mint a human identity. */
export class ScopedAgentAuth {
  readonly #credentials=new Map<string,Credential>();
  constructor(private readonly origin:()=>string,private readonly now:()=>number=Date.now,readonly cookieName='narralens_a_session'){}
  issue(input:{principal_id:string;channel:AgentChannel;expires_at:number;session_ref?:string}) {
    if(typeof input.principal_id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(input.principal_id)||!['authenticated','trusted_ui','native_bridge'].includes(input.channel)||!Number.isSafeInteger(input.expires_at)||input.expires_at<=this.now())throw new Error('Invalid credential lifetime');
    // Rotation keeps valid predecessor credentials until their natural expiry.
    for(const [key,record] of this.#credentials)if(record.revoked||record.principal.expires_at<=this.now())this.#credentials.delete(key);
    const token=randomBytes(32).toString('base64url'),csrf=input.channel==='trusted_ui'?randomBytes(32).toString('base64url'):null;
    const principal=Object.freeze({...input,session_ref:input.session_ref??'session_'+randomBytes(12).toString('hex')});
    this.#credentials.set(hash(token).toString('hex'),{digest:hash(token),csrfDigest:csrf?hash(csrf):null,principal,revoked:false});
    return {token,csrf,principal};
  }
  revoke(token:string){const record=this.#credentials.get(hash(token).toString('hex'));if(record)record.revoked=true;}
  /** Origin and credential channel are checked BEFORE resource lookup. Body fields are never consulted. */
  authenticate(input:{method:string;origin:string|undefined;authorization:string|undefined;cookie?:string;csrf?:string;referer?:string;secFetchSite?:string;rawHeaders?:readonly string[]},expected?:AgentChannel):AgentPrincipal {
    if(input.rawHeaders){
      const counts=new Map<string,number>();
      for(let i=0;i<input.rawHeaders.length;i+=2){const k=input.rawHeaders[i]!.toLowerCase();counts.set(k,(counts.get(k)??0)+1);}
      if(['authorization','origin','cookie','x-narralens-csrf'].some(k=>(counts.get(k)??0)>1))throw forbidden();
    }
    let wanted:string;
    try {const url=new URL(this.origin());if(!['127.0.0.1','[::1]'].includes(url.hostname)||url.protocol!=='http:'||url.username||url.password)throw forbidden();wanted=url.origin;}
    catch {throw forbidden();}
    if(input.origin!==wanted){
      let browserSameOrigin=false;
      if(input.origin===undefined&&input.secFetchSite==='same-origin'&&input.referer){try{browserSameOrigin=new URL(input.referer).origin===wanted;}catch{}}
      if(!browserSameOrigin)throw forbidden();
    }
    const cookieTokens=(input.cookie??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(this.cookieName+'='));
    if(cookieTokens.length>1)throw forbidden();
    const bearer=input.authorization?.startsWith('Bearer ')?input.authorization.slice(7):undefined;
    const cookie=cookieTokens[0]?.slice(this.cookieName.length+1);
    if(bearer&&cookie)throw forbidden();
    const token=bearer??cookie;if(!token)throw new AgentAuthError('UNAUTHORIZED');
    const record=this.#credentials.get(hash(token).toString('hex'));
    if(!record||!match(token,record.digest)||record.revoked||this.now()>=record.principal.expires_at)throw new AgentAuthError('UNAUTHORIZED');
    const channel=record.principal.channel;
    if(expected!==undefined&&(expected==='authenticated'?(channel!=='authenticated'&&channel!=='trusted_ui'):channel!==expected))throw forbidden();
    if(channel==='trusted_ui') {
      // A known UI token is still NOT a bearer credential. It requires the verified browser session.
      if(!cookie||bearer)throw forbidden();
      if(!['GET','HEAD'].includes(input.method)&&(!input.csrf||!record.csrfDigest||!match(input.csrf,record.csrfDigest)))throw forbidden();
    } else if(!bearer||cookie)throw forbidden();
    return record.principal;
  }
}
