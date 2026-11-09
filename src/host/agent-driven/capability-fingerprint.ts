import { createHash } from 'node:crypto';
import { canonicalJson } from '../engine/source-digest-v1.js';
export const A_CAPABILITIES=['clip.prepare','snapshot.render','qc.inspect','delivery.package'] as const;
export interface RuntimeCapabilityDescriptor {
 readonly id:(typeof A_CAPABILITIES)[number];
 readonly version:1;
 readonly implementation_digest:string;
 readonly configuration_digest:string;
}
/** The MAIN assembly supplies digests from verified real producer manifests, never client claims. */
export function capabilityFingerprint(descriptors:readonly RuntimeCapabilityDescriptor[]):string {
 if(descriptors.length!==A_CAPABILITIES.length)throw new Error('Incomplete capability registration');
 const seen=new Set<string>();
 for(const descriptor of descriptors){
  const fields=Object.keys(descriptor).sort();
  if(JSON.stringify(fields)!==JSON.stringify(['configuration_digest','id','implementation_digest','version'])||!A_CAPABILITIES.includes(descriptor.id)||seen.has(descriptor.id)||descriptor.version!==1||!/^[a-f0-9]{64}$/.test(descriptor.implementation_digest)||!/^[a-f0-9]{64}$/.test(descriptor.configuration_digest))throw new Error('Invalid capability registration');
  seen.add(descriptor.id);
 }
 const capabilities=[...descriptors].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 return createHash('sha256').update(canonicalJson({schema_version:1,capabilities})).digest('hex');
}
