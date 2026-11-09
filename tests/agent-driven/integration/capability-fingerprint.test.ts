import {describe,it,expect} from 'vitest';
import {A_CAPABILITIES,capabilityFingerprint,type RuntimeCapabilityDescriptor} from '../../../src/host/agent-driven/capability-fingerprint.js';
const descriptors:RuntimeCapabilityDescriptor[]=A_CAPABILITIES.map((id,i)=>({id,version:1,implementation_digest:String(i+1).repeat(64),configuration_digest:'a'.repeat(64)}));
describe('actual capability descriptor fingerprint format',()=>{
 it('is order independent but binds every implementation and configuration change',()=>{
  const first=capabilityFingerprint(descriptors);expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(capabilityFingerprint([...descriptors].reverse())).toBe(first);
  expect(capabilityFingerprint(descriptors.map((d,i)=>i===0?{...d,implementation_digest:'f'.repeat(64)}:d))).not.toBe(first);
  expect(capabilityFingerprint(descriptors.map((d,i)=>i===0?{...d,configuration_digest:'f'.repeat(64)}:d))).not.toBe(first);
 });
 it('rejects missing, repeated, invented or unversioned registrations instead of hashing a list of names',()=>{
  expect(()=>capabilityFingerprint(descriptors.slice(1))).toThrow();
  expect(()=>capabilityFingerprint([descriptors[0]!,descriptors[0]!,...descriptors.slice(2)])).toThrow();
  expect(()=>capabilityFingerprint(descriptors.map((d,i)=>i===0?{...d,id:'invented'} as never:d))).toThrow();
  expect(()=>capabilityFingerprint(descriptors.map((d,i)=>i===0?{...d,version:2} as never:d))).toThrow();
 });
});
