import {it,expect,vi} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const fault=vi.hoisted(()=>({path:'',code:'',hits:0}));
vi.mock('node:fs/promises',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs/promises')>();
 return {...actual,realpath:async(path:Parameters<typeof actual.realpath>[0],...args:unknown[])=>{
  if(String(path)===fault.path&&fault.code){fault.hits++;throw Object.assign(Error('injected leaf realpath resource failure'),{code:fault.code});}
  return (actual.realpath as (...args:unknown[])=>unknown)(path,...args);
 }};
});
import {computeSourceDigest} from '../../../src/host/engine/source-digest-v1.js';
import {OPENFILM_UPSTREAM_SHA} from '../../../src/host/engine/engine-binding-store.js';
it.each(['ENOMEM','EMFILE','EIO'])('preserves %s at the real leaf canonicalization boundary without claiming source drift',async code=>{
 const root=await mkdtemp(join(tmpdir(),'narralens-digest-resource-')),path=join(root,'film.html'),source='<!doctype html><html><body>Resource boundary fixture</body></html>';
 try{
  await writeFile(path,source);const input={root,roots:['film.html'],engine:'openfilm' as const,engineUpstreamSha:OPENFILM_UPSTREAM_SHA};
  const before=await computeSourceDigest(input);fault.path=path;fault.code=code;fault.hits=0;
  await expect(computeSourceDigest(input)).rejects.toMatchObject({status:503,code:'HOST_RESOURCE_EXHAUSTED'});expect(fault.hits).toBe(1);
  fault.code='';expect((await computeSourceDigest(input)).source_digest).toBe(before.source_digest);expect(await readFile(path,'utf8')).toBe(source);
 }finally{fault.code='';fault.path='';await rm(root,{recursive:true,force:true});}
});
