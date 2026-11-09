import { CursorRejection } from '../observability/cursor.js';
import type { CursorSigningPort, CursorVerificationPort } from '../observability/ports.js';
import { CursorError, type DurableCursorCodec } from './durable-cursor.js';
/** Keep cryptographic validation here; BRIDGE evaluates scope BEFORE expiry. */
export function observationCursorPorts(codec:DurableCursorCodec,keyId:string):{signing:CursorSigningPort;verification:CursorVerificationPort} {
 return {
  signing:{key_id:keyId,sign:claims=>codec.sign(claims)},
  verification:{verify:async token=>{
   try{return await codec.verifySignature(token);}
   catch(error){
    if(error instanceof CursorError){
     const kind=error.code==='INVALID_REQUEST'?'malformed':error.code==='CURSOR_EXPIRED'?'expired':'tampered';
     throw new CursorRejection(kind,'cursor_rejected');
    }
    throw error;
   }
  }},
 };
}
