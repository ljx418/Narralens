import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CursorClaims } from '../../contracts/agent-driven-types.js';
import { validateAgentDefinition } from '../../contracts/agent-driven-validator.js';
import { canonicalJson } from '../engine/source-digest-v1.js';
import type { RevisionStore } from '../projects/revision-store.js';

export class CursorError extends Error {
  constructor(readonly code:'INVALID_REQUEST'|'ORIGIN_REJECTED'|'CURSOR_EXPIRED') {super('Cursor is invalid, unavailable or expired');}
}
/** Transport receipts only: no workflow, engine, project revision or business event writes. */
export class DurableCursorCodec {
  readonly #db:DatabaseSync;
  readonly #keys:ReadonlyMap<string,Uint8Array>;
  constructor(private readonly revisions:RevisionStore,keys:ReadonlyMap<string,Uint8Array>,private readonly now:()=>number=Date.now) {
    if(!keys.size||[...keys.values()].some(k=>k.byteLength<32))throw new Error('Cursor signing keys must contain at least 256 bits');
    // Defensively copy caller buffers: key bytes cannot silently mutate after construction.
    this.#keys=new Map([...keys].map(([id,key])=>[id,Uint8Array.from(key)] as const));
    this.#db=revisions.compose(db=>{db.exec(`CREATE TABLE IF NOT EXISTS agent_cursor_claim(
      nonce TEXT PRIMARY KEY NOT NULL, claims_json TEXT NOT NULL CHECK(json_valid(claims_json))
    )`);return db;});
  }
  private signature(nonce:string,claims:CursorClaims):string {
    const key=this.#keys.get(claims.key_id);if(!key)throw new CursorError('ORIGIN_REJECTED');
    return createHmac('sha256',key).update(canonicalJson({nonce,claims})).digest('base64url');
  }
  private dates(claims:CursorClaims) {
    const issued=Date.parse(claims.issued_at),expires=Date.parse(claims.expires_at);
    if(!Number.isSafeInteger(issued)||!Number.isSafeInteger(expires)||expires<=issued||issued>this.now())throw new CursorError('ORIGIN_REJECTED');
    if(this.now()>=expires)throw new CursorError('CURSOR_EXPIRED');
  }
  async sign(input:CursorClaims):Promise<string> {
    const claims=validateAgentDefinition<CursorClaims>('CursorClaims',input);
    this.dates(claims);
    const nonce='c'+randomBytes(12).toString('base64url');
    const sig=this.signature(nonce,claims);
    this.revisions.atomic(()=>this.#db.prepare('INSERT INTO agent_cursor_claim VALUES(?,?)').run(nonce,canonicalJson(claims)));
    const token=nonce+'_'+sig; // 17+1+43=61, first character is alphabetic, exactly within frozen ID bounds.
    return token;
  }
  async verifySignature(token:string):Promise<CursorClaims> {
    if(!/^c[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/.test(token))throw new CursorError('INVALID_REQUEST');
    const nonce=token.slice(0,17),sig=token.slice(18);
    const row=this.#db.prepare('SELECT claims_json FROM agent_cursor_claim WHERE nonce=?').get(nonce);
    if(!row)throw new CursorError('ORIGIN_REJECTED');
    let claims:CursorClaims;
    try{claims=validateAgentDefinition<CursorClaims>('CursorClaims',JSON.parse(String(row.claims_json)));}
    catch{throw new CursorError('ORIGIN_REJECTED');}
    const expected=this.signature(nonce,claims);
    if(!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))throw new CursorError('ORIGIN_REJECTED');
    return claims;
  }
  async verify(token:string):Promise<CursorClaims> {
    const claims=await this.verifySignature(token);
    this.dates(claims);
    return claims;
  }
}
