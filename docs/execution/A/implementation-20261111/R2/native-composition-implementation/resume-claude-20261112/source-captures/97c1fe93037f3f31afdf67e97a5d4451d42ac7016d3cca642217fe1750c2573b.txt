import {createHash} from 'node:crypto';

/** The NUL the upstream hashes between the parts of a cache key. */
const NUL=String.fromCharCode(0);

/** The identity of one file the producer read or wrote.
 *
 * The millisecond change time is the upstream's own stamp and nothing else; the
 * Host's identity of the file is the nanosecond pair, the device, the inode, the
 * size and the number of names. A millisecond double cannot tell two changes of
 * the same file apart, so it never decides anything here. */
export interface NativeCacheFileIdentity{
 readonly path:string;
 readonly sha256:string;
 readonly bytes:number;
 /** The change time of the content, in milliseconds: the upstream's stamp. */
 readonly mtime_ms:number;
 /** The change time of the content, in nanoseconds: the Host's identity. */
 readonly mtime_ns:string;
 /** The change time of the inode, in nanoseconds: the Host's identity. */
 readonly ctime_ns:string;
 readonly dev:string;
 readonly ino:string;
 /** How many names the file had. More than one is an alias to another file. */
 readonly nlink:string;
}

/** The witness of ONE native cache entry.
 *
 * It is issued ONLY by the guarded production of the FIXED upstream producer, when
 * that producer was really invoked and the resources of that call really settled.
 * It binds:
 *  - the issued workspace instance and its generation,
 *  - the request that produced it: the relative path, the moment, the width and the
 *    overrides exactly as the upstream hashed them,
 *  - the key the upstream computes from that request,
 *  - the digests of the files the producer really wrote,
 *  - the identities of the files the producer really read, BEFORE and AFTER the call,
 *  - the identities of the files the producer really wrote.
 *
 * The PUBLIC shape of a witness is not authority: a JSON object that looks like
 * this proves nothing. The authority is the issued brand below, which only the
 * guarded production can put on a witness, AND the private binding of the witness to
 * the opaque production lease of the real workspace service that produced it. */
export interface NativeCacheWitness{
 /** Which family of the native cache this witness is about. */
 readonly kind:'pageframe'|'film-poster';
 readonly workspace_ref:string;
 readonly generation:number;
 /** The request: the path of the page, the moment, the width and the overrides. */
 readonly rel:string;
 readonly ms:number;
 readonly width:number;
 /** The exact overrides the upstream hashed, or null when it hashed none. */
 readonly overrides_json:string|null;
 /** The root the producer really drew in: the issued root of that view. */
 readonly root:string;
 /** The upstream's own key of that request. */
 readonly key:string;
 /** The upstream's own key of the request's page frame, whatever family this
  *  witness is about: the triple of the files lives under it. */
 readonly frame_key:string;
 /** The digest of the picture the producer really drew. */
 readonly jpeg_sha256:string;
 /** The digest of the dependency list the producer really wrote. */
 readonly deps_sha256:string;
 /** The digest of the stamp the producer really wrote. */
 readonly stamp_sha256:string;
 /** The digest of the poster the producer really wrote, when it wrote one. */
 readonly poster_sha256:string|null;
 /** The files the producer really read, as they were when it read them. */
 readonly dependencies:readonly NativeCacheFileIdentity[];
 /** The files the producer really wrote, with the identity they had when it wrote
  *  them. The consumer compares the WHOLE identity, never only the digest. */
 readonly outputs:readonly NativeCacheFileIdentity[];
 readonly issued_at:string;
}

/** The upstream's own tweaks of a request.
 *
 * `studio/server/pageframes.mjs:65-66`: the overrides are hashed ONLY when one of
 * them is an object that carries an `at` - an empty list, or a list without such an
 * override, hashes as nothing at all. */
export function upstreamCacheTweaks(overrides:readonly unknown[]|null):string|null{
 if(overrides===null)return null;
 const hashed=overrides.some(entry=>!!entry&&typeof entry==='object'&&'at' in (entry as Record<string,unknown>));
 return hashed?JSON.stringify(overrides):null;
}

/** The upstream's own key of a request.
 *
 * `studio/server/pageframes.mjs:62-71`: the key is
 * `sha256('black' + NUL + rel + NUL + round(ms) + NUL + w [+ NUL + overrides])` cut
 * to its first 24 hex digits, and the width it hashes is the NORMALIZED one - the
 * width the producer really drew at. */
export function nativeCacheKey(request:{readonly rel:string;readonly ms:number;readonly width:number;readonly overrides_json:string|null}):string{
 const tweaks=request.overrides_json??'';
 return createHash('sha256').update(`black${NUL}${request.rel}${NUL}${Math.round(request.ms)}${NUL}${request.width}${tweaks?`${NUL}${tweaks}`:''}`).digest('hex').slice(0,24);
}

/** The upstream's own stamp of a dependency list.
 *
 * `studio/server/pageframes.mjs:119-122`: the stamp is the digest of
 * `${path}:${mtimeMs}:${size}` joined by newlines, cut to its first 24 hex digits. */
export function nativeCacheStamp(dependencies:readonly {readonly path:string;readonly mtime_ms:number;readonly bytes:number}[]):string{
 return createHash('sha256').update(dependencies.map(entry=>`${entry.path}:${entry.mtime_ms}:${entry.bytes}`).join('\n')).digest('hex').slice(0,24);
}

/** The witnesses this module issued.
 *
 * The brand is what makes a witness real: it cannot be copied, cannot be forged by
 * a JSON file and cannot be replayed for another workspace instance. It is NOT
 * enough on its own: the real workspace service binds every witness it accepts to
 * the opaque production lease of its own private table, so a branded witness of
 * another issuer is worth nothing there. */
const issuedWitnesses=new WeakSet<object>();
/** Whether this object is a witness this module issued. */
export function isIssuedNativeCacheWitness(value:unknown):value is NativeCacheWitness{
 return typeof value==='object'&&value!==null&&issuedWitnesses.has(value);
}
/** Put the brand on a witness.
 *
 * Only the guarded production of the real workspace service calls this: the service
 * holds the production lease, and the witness is bound to it privately. */
export function issueNativeCacheWitness(witness:NativeCacheWitness):NativeCacheWitness{
 const frozen=Object.freeze({...witness,
  dependencies:Object.freeze(witness.dependencies.map(entry=>Object.freeze({...entry}))),
  outputs:Object.freeze(witness.outputs.map(entry=>Object.freeze({...entry})))});
 issuedWitnesses.add(frozen);
 return frozen;
}

/** The state of one witnessed entry.
 *
 * `pending` is a witness whose resources have not settled yet: it is NOT
 * available - no lookup and no reader may see it. `active` is the only state a
 * reader may consume. `revoked` is a witness whose settlement was uncertain: it
 * stays invisible forever. */
export type NativeCacheWitnessState='pending'|'active'|'revoked';

/** The witnesses of ONE workspace instance.
 *
 * It is a container and nothing more: it holds no authority of its own, it issues
 * nothing, and it never hands out a witness that is not `active`. The authority is
 * the workspace service that owns it, and that service is private to it. */
export class NativeCacheWitnessLedger{
 /** The witnesses, by the view they belong to and by their key. */
 readonly #witnesses=new Map<string,{witness:NativeCacheWitness;state:NativeCacheWitnessState}>();
 /** The CURRENT active authorisation of every OUTPUT, by the output's own path.
  *
  * An output is authorised by the draw that really produced it. When a later draw
  * produces the same output again, that later draw is the current authorisation - and
  * when the current authorisation is revoked or invalidated, the output has NO
  * authorisation at all: it never falls back to the older one, which spoke about an
  * output that is no longer there. */
 readonly #byOutput=new Map<string,NativeCacheWitness>();
 /** Stage a witness: it is held, but it is NOT available yet.
  *
  * A witness that is already ACTIVE is never replaced by a staged one - a replay
  * of the record must not downgrade it - and a REVOKED one is never revived. */
 stage(witness:NativeCacheWitness):boolean{
  if(!isIssuedNativeCacheWitness(witness))return false;
  if(typeof witness.workspace_ref!=='string'||witness.workspace_ref==='')return false;
  if(!Number.isInteger(witness.generation)||witness.generation<1)return false;
  if(typeof witness.key!=='string'||witness.key==='')return false;
  const scope=`${witness.workspace_ref} ${witness.generation}`;
  const existing=this.#witnesses.get(scope+' '+witness.key);
  if(existing!==undefined){
   // A witness of another family never replaces the one that is already there.
   if(existing.witness.kind!==witness.kind)return false;
   // An active or a revoked witness is never staged again.
   if(existing.state!=='pending')return false;
  }
  this.#witnesses.set(scope+' '+witness.key,{witness,state:'pending'});
  return true;
 }
 /** Make a staged witness available. Only a staged witness can be activated. */
 activate(witness:NativeCacheWitness):boolean{
  if(!isIssuedNativeCacheWitness(witness))return false;
  const entry=this.#witnesses.get(`${witness.workspace_ref} ${witness.generation} ${witness.key}`);
  if(entry===undefined||entry.witness!==witness||entry.state!=='pending')return false;
  entry.state='active';
  // Every output this draw really wrote is authorised by THIS draw, from now on.
  const scope=`${witness.workspace_ref} ${witness.generation}`;
  for(const output of witness.outputs)this.#byOutput.set(scope+' '+output.path,witness);
  return true;
 }
 /** Revoke a witness: it was never certain, and it stays invisible. */
 revoke(witness:NativeCacheWitness):void{
  if(!isIssuedNativeCacheWitness(witness))return;
  const entry=this.#witnesses.get(`${witness.workspace_ref} ${witness.generation} ${witness.key}`);
  if(entry===undefined||entry.witness!==witness)return;
  entry.state='revoked';
  // The outputs of a revoked witness lose their authorisation. The older
  // authorisation of the same output does NOT come back: it spoke about a draw
  // that is no longer the current one.
  const scope=`${witness.workspace_ref} ${witness.generation}`;
  for(const output of witness.outputs){
   const key=scope+' '+output.path;
   if(this.#byOutput.get(key)===witness)this.#byOutput.delete(key);
  }
 }
 /** The ACTIVE witness that authorised ONE output of this view, or null when there is none.
  *
  * It is the CURRENT authorisation of that output: the draw that produced it last.
  * A staged, a revoked and an invalidated witness is not one, and an output whose
  * current authorisation was revoked has none at all. */
 lookupByOutput(workspace_ref:string,generation:number,output_path:string):NativeCacheWitness|null{
  const witness=this.#byOutput.get(`${workspace_ref} ${generation} ${output_path}`);
  if(witness===undefined)return null;
  const entry=this.#witnesses.get(`${witness.workspace_ref} ${witness.generation} ${witness.key}`);
  if(entry===undefined||entry.witness!==witness||entry.state!=='active')return null;
  return isIssuedNativeCacheWitness(witness)?witness:null;
 }
 /** The ACTIVE witness of this view's key, or null when there is none.
  *
  * A staged witness is not a witness yet, and a revoked one never becomes one
  * again. */
 lookup(workspace_ref:string,generation:number,key:string):NativeCacheWitness|null{
  const entry=this.#witnesses.get(`${workspace_ref} ${generation} ${key}`);
  if(entry===undefined||entry.state!=='active')return null;
  return isIssuedNativeCacheWitness(entry.witness)?entry.witness:null;
 }
 /** The state of one witness of this ledger: Host-private, for the cases. */
 stateOf(witness:NativeCacheWitness):NativeCacheWitnessState|null{
  const entry=this.#witnesses.get(`${witness.workspace_ref} ${witness.generation} ${witness.key}`);
  return entry===undefined?null:entry.state;
 }
 /** Forget the witnesses of the generations older than the given one: a new
  *  generation never inherits the witnesses of the old one. */
 invalidate(generation:number):void{
  for(const [scope,entry] of [...this.#witnesses]){
   if(entry.witness.generation<generation){
    this.#witnesses.delete(scope);
    // The outputs of an invalidated witness lose their authorisation too.
    const key=`${entry.witness.workspace_ref} ${entry.witness.generation}`;
    for(const output of entry.witness.outputs){
     const outputKey=key+' '+output.path;
     if(this.#byOutput.get(outputKey)===entry.witness)this.#byOutput.delete(outputKey);
    }
   }
  }
 }
}

/** The fixed producer the guarded production calls.
 *
 * It is the PINNED upstream producer and nothing else: the Host never draws a
 * picture of its own, and only the producer this module's factory issued may be
 * used here - a hand-written object with the right shape is refused. */
export interface NativeCacheProducer{
 /** Draw one page frame with the fixed producer.
  *
  * It answers the JPEG the producer really drew. The files it really read are not
  * taken from it: they are read back from the dependency list the producer itself
  * wrote, so the Host never trusts a report about its own origin. */
 pageFrame(request:{readonly root:string;readonly base:string;readonly rel:string;readonly ms:number;readonly width:number;readonly overrides:unknown[]|null}):Promise<Buffer>;
 /** The upstream's own close of its resources. It never kills another instance's
  *  work: the browser is shared and the owner ledger decides. */
 close():Promise<void>;
}

/** The failure of the native cache production. */
export class NativeCacheWitnessError extends Error{
 constructor(readonly code:string,message:string){super(message);this.name='NativeCacheWitnessError';}
}
