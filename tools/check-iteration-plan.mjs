// Documentation consistency only. Does not implement or accept any business feature.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source='docs/agent-driven-v1/06_ITERATION_EXECUTION_PLAN.md';
const text=readFileSync(resolve(root,source),'utf8');
const rows=text.split('\n').filter(line=>line.startsWith('| IT-')).map(line=>line.split('|').slice(1,-1).map(s=>s.trim()));
if(rows.length!==17)throw Error('Expected 17 work packages');
const seen=new Set(),cases=new Set(),stages=new Set();
const tickets=rows.map(([id,stage,deliverable,dependency,tests,status])=>{
 if(seen.has(id))throw Error('Duplicate ticket '+id);
 if(dependency!=='无'&&!seen.has(dependency))throw Error('Missing or forward/cyclic dependency '+id+' -> '+dependency);
 if(status!=='PLANNED')throw Error('Unverified implementation status '+id);
 if(!/^AD-S[0-5]$/.test(stage))throw Error('Invalid stage '+stage);
 const refs=[...tests.matchAll(/AD-T\d{2}/g)].map(x=>x[0]);
 if(id!=='IT-C03')refs.forEach(c=>cases.add(c));
 seen.add(id);stages.add(stage);
 return {id,stage,wave:id.startsWith('IT-P')?'PREPARE':id.slice(3,4),deliverable,dependencies:dependency==='无'?[]:[dependency],acceptanceFamilies:refs,documentGate:refs.length?null:tests,status};
});
for(let i=1;i<=35;i++)if(!cases.has(`AD-T${String(i).padStart(2,'0')}`))throw Error('Case only in final omnibus or missing: '+i);
if(stages.size!==6)throw Error('Incomplete stage coverage');
const receipt={format:'narralens.iteration-plan@1',source,source_sha256:createHash('sha256').update(text).digest('hex'),validation:'DOC_CONSISTENT_NOT_BUSINESS_ACCEPTANCE',implementationAuthorization:'NOT_GRANTED_BY_CURRENT_PLANNING_REQUEST',stages:6,workPackages:tickets.length,acceptanceFamilies:cases.size,tickets};
writeFileSync(resolve(root,'docs/agent-driven-v1/iteration-plan.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({status:'PASS',stages:6,workPackages:tickets.length,acceptanceFamilies:cases.size,dependencyOrder:'acyclic',businessAcceptance:'NOT_RUN'},null,2));
