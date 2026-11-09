import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const directory=resolve(process.argv[2]??'var/native-session-mutations');mkdirSync(directory,{recursive:true});
const path=resolve('src/host/m5/controlled-studio-access.ts'),original=readFileSync(path),hash=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
writeFileSync(join(directory,'original-controlled-studio-access.ts'),original);
let current=hash(original);
const restore=()=>{const found=hash(readFileSync(path));if(found!==current&&found!==hash(original))throw new Error('REFUSE_TO_OVERWRITE_CONCURRENT_SOURCE_CHANGE; original backup remains in '+directory);writeFileSync(path,original);current=hash(original);};
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{restore();process.exit(130);});
const reuse=' #existing(grant:NativeStudioGrant){return [...this.#proofs.values()].find(session=>this.#sameScope(session.grant,grant));}';
const gc='if(now>=s.expires_at||!this.#current(s.grant))';
const gates=[
 {id:'CNE-REUSE',anchor:reuse,replacement:' #existing(_grant:NativeStudioGrant):NativeStudioSession|undefined{return undefined;}',name:'reopens the same actual scope 80 times'},
 {id:'CNE-RECLAIM',anchor:gc,replacement:'if(now>=s.expires_at)',name:'reclaims 64 revoked owners'},
];
const results:unknown[]=[];
try{
 for(const gate of gates){
  const source=original.toString('utf8');if(source.split(gate.anchor).length!==2)throw new Error('MUTATION_ANCHOR_NOT_UNIQUE:'+gate.id);
  const mutated=source.replace(gate.anchor,gate.replacement);current=hash(mutated);writeFileSync(path,mutated);
  const args=['node_modules/vitest/vitest.mjs','run','--config','vitest.config.ts','tests/agent-driven/integration/controlled-native-session-capacity.test.ts','--testNamePattern',gate.name];
  writeFileSync(join(directory,gate.id+'.cmd.json'),JSON.stringify({file:process.execPath,args,cwd:process.cwd()},null,2)+'\n');
  const result=spawnSync(process.execPath,args,{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
  writeFileSync(join(directory,gate.id+'.txt'),(result.stdout??'')+(result.stderr??''));writeFileSync(join(directory,gate.id+'.exit'),String(result.status)+'\n');restore();
  const expected=result.status===1&&/expected 503 to be 200/.test((result.stdout??'')+(result.stderr??''));
  results.push({id:gate.id,exit:result.status,expected_assertion_failed:expected});if(!expected)throw new Error('MUTATION_DID_NOT_HIT_EXPECTED_ASSERTION:'+gate.id);
 }
}finally{restore();writeFileSync(join(directory,'result.json'),JSON.stringify({scope:'native transport capacity component gates only',results,source_restored:hash(readFileSync(path))===hash(original)},null,2)+'\n');}
console.log('2/2 native session capacity gates reject injected regressions; original source bytes restored');
