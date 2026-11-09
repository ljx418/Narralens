import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const plan=JSON.parse(readFileSync(resolve(root,'docs/agent-driven-v1/parallel-plan.json')));
const iteration=JSON.parse(readFileSync(resolve(root,'docs/agent-driven-v1/iteration-plan.json')));
if(createHash('sha256').update(readFileSync(resolve(root,iteration.source))).digest('hex')!==iteration.source_sha256)throw Error('STALE_ITERATION_PLAN; run node tools/check-iteration-plan.mjs first');
const roles=new Set(['main',...plan.lanes.map(l=>l.id)]);
function allowed(lane,path){return !plan.protectedFiles.includes(path)&&!plan.protectedPrefixes.some(p=>path.startsWith(p))&&lane.allowPrefixes.some(p=>path.startsWith(p))}
if(plan.lanes.length!==3||new Set(plan.lanes.map(l=>l.directory)).size!==3||new Set(plan.lanes.map(l=>l.branch)).size!==3)throw Error('Lane isolation invalid');
for(let i=0;i<plan.lanes.length;i++)for(let j=i+1;j<plan.lanes.length;j++)for(const a of plan.lanes[i].allowPrefixes)for(const b of plan.lanes[j].allowPrefixes)if(a.startsWith(b)||b.startsWith(a))throw Error('Overlapping ownership '+a+' '+b);
if(plan.tickets.length!==17||new Set(plan.tickets.map(t=>t.id)).size!==17)throw Error('Ticket ownership incomplete');
for(const ticket of iteration.tickets){const owner=plan.tickets.find(t=>t.id===ticket.id);if(!owner||!roles.has(owner.lead)||owner.contributors.some(r=>!roles.has(r)))throw Error('Missing owner '+ticket.id)}
const bridge=plan.lanes.find(l=>l.id==='bridge'),product=plan.lanes.find(l=>l.id==='product'),media=plan.lanes.find(l=>l.id==='media');
const probes=[['bridge module',allowed(bridge,'src/mcp/server.ts')],['product module',allowed(product,'src/app/observation/WorkflowPanel.tsx')],['media module',allowed(media,'src/host/render/renderer.ts')],['protected overrides broad prefix',!allowed(product,'src/host/creative/project-creation-service.ts')],['server denied',!allowed(bridge,'src/host/server.ts')],['DDL denied',!allowed(media,'src/host/projects/revision-store.ts')],['shared schema denied',!allowed(product,'src/contracts/types.ts')],['cross lane denied',!allowed(bridge,'src/host/render/renderer.ts')],['lockfile denied',!allowed(media,'pnpm-lock.yaml')],['replacement app denied',!allowed(product,'src/app/agent-workbench/App.tsx')],['legacy M5 denied',!allowed(product,'src/app/m5/M5Panel.tsx')]];
if(probes.some(([,ok])=>!ok))throw Error('Ownership deny rules failed');
const args=process.argv.slice(2),laneName=args[args.indexOf('--lane')+1];
if(args.includes('--lane')){
 const lane=plan.lanes.find(l=>l.id===laneName);if(!lane)throw Error('Unknown lane');
 const branch=execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).trim();
 if(branch!==lane.branch)throw Error('WRONG_LANE_BRANCH: '+branch+' expected '+lane.branch);
 const base=args[args.indexOf('--base')+1];if(!args.includes('--base')||!base||!/^[a-f0-9]{40}$/.test(base))throw Error('Full --base SHA required');
 execFileSync('git',['merge-base','--is-ancestor',base,'HEAD'],{cwd:root});
 const changed=[...new Set([
  ...execFileSync('git',['diff','--no-renames','--name-only',base],{cwd:root,encoding:'utf8'}).trim().split('\n'),
  ...execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim().split('\n')
 ].filter(Boolean))];
 const denied=changed.filter(path=>!allowed(lane,path));
 if(denied.length)throw Error('OUTSIDE_LANE_OWNERSHIP:\n'+denied.join('\n'));
 console.log(JSON.stringify({lane:lane.id,base,checkedPaths:changed.length,status:'PASS',limitation:'path guard is not a sandbox or CP release check; MAIN must bind exact release base/contract and review content'},null,2));
}else{
 const receipt={format:'narralens.parallel-plan-check@1',status:'PASS',stages:iteration.stages,tickets:17,lanes:3,uniqueOwnership:true,denyRuleProbes:probes.map(([name,passed])=>({name,passed})),implementationRelease:plan.implementationRelease,businessAcceptance:'NOT_RUN'};
 writeFileSync(resolve(root,'docs/agent-driven-v1/parallel-check.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
}
