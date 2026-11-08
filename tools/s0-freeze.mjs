import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dir=resolve(root,'docs/agent-driven-v1/s0');
const sha=b=>createHash('sha256').update(b).digest('hex');
const names=['README.md','01_SCOPE_AND_UX.md','02_CONTRACT_AND_SECURITY.md','03_DATA_AND_RECOVERY.md','04_EXECUTION_AND_ACCEPTANCE.md','05_REVIEW_RECORD.md','contracts.schema.json','contracts.ts','registry.json','migration.sql','vectors.json','baseline.json','prototype.html','architecture.json','architecture.html','review.html','contract-check.json','sql-check.json','browser-check.json','typecheck.json'];
const toolNames=['s0-contract-check.mjs','s0-sql-check.py','s0-browser-check.mjs','build-s0-review.mjs','s0-freeze.mjs'];
const files=Object.fromEntries([...names.map(n=>'docs/agent-driven-v1/s0/'+n),...toolNames.map(n=>'tools/'+n)].map(p=>{if(!existsSync(resolve(root,p)))throw Error('MISSING:'+p);return[p,sha(readFileSync(resolve(root,p)))];}));
for(const n of ['contract-check.json','sql-check.json','browser-check.json','typecheck.json']){const r=JSON.parse(readFileSync(resolve(dir,n)));if(!['pass','PASS'].includes(r.status))throw Error('CHECK_FAILED:'+n)}
const browser=JSON.parse(readFileSync(resolve(dir,'browser-check.json')));for(const [n,h]of Object.entries(browser.hashes))if(sha(readFileSync(resolve(dir,n)))!==h)throw Error('STALE_BROWSER:'+n);
const contracts=JSON.parse(readFileSync(resolve(dir,'contract-check.json')));for(const [n,h]of Object.entries(contracts.hashes))if(sha(readFileSync(resolve(dir,n)))!==h)throw Error('STALE_CONTRACT:'+n);
const sql=JSON.parse(readFileSync(resolve(dir,'sql-check.json')));if(sql.migration_sha256!==sha(readFileSync(resolve(dir,'migration.sql'))))throw Error('STALE_SQL');
const tc=JSON.parse(readFileSync(resolve(dir,'typecheck.json')));if(tc.typesSha256!==sha(readFileSync(resolve(dir,'contracts.ts'))))throw Error('STALE_TYPES');
const manifest={format:'narralens.s0-freeze-candidate@1',state:'S0_REVIEW_CANDIDATE',observedSourceCommit:'95087de9bfafdf2f2e339f3d2f2e8991ca11c8a7',humanReview:'REVIEW_PENDING',productionRelease:'NOT_RELEASED',productionAcceptance:'NOT_RUN',files};
const target=resolve(dir,'FREEZE.json');if(process.argv.includes('--write'))writeFileSync(target,JSON.stringify(manifest,null,2)+'\n');else{const saved=JSON.parse(readFileSync(target));if(JSON.stringify(saved)!==JSON.stringify(manifest))throw Error('FREEZE_DRIFT')}
console.log(JSON.stringify({status:'PASS',state:manifest.state,files:Object.keys(files).length,manifestSha256:sha(readFileSync(target)),productionRelease:'NOT_RELEASED'}));
