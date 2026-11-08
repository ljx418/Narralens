// Isolated metadata regression for audit findings; never touches user worktrees.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const source=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const temporary=mkdtempSync(join(tmpdir(),'narralens-parallel-tools-'));
const root=join(temporary,'Narralens');mkdirSync(root);
const checks=[];
function run(cmd,args,cwd=root){return spawnSync(cmd,args,{cwd,encoding:'utf8'})}
function ok(name,condition){if(!condition)throw Error(name);checks.push({name,status:'PASS'})}
function git(args,cwd=root){return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}
try{
 for(const path of ['tools/check-iteration-plan.mjs','tools/check-parallel-plan.mjs','tools/parallel-workspace.mjs','docs/agent-driven-v1/06_ITERATION_EXECUTION_PLAN.md','docs/agent-driven-v1/parallel-plan.json','docs/agent-driven-v1/iteration-plan.json']){mkdirSync(dirname(join(root,path)),{recursive:true});copyFileSync(join(source,path),join(root,path))}
 git(['init','-b','integration']);git(['config','user.name','Narralens Metadata Test']);git(['config','user.email','test@example.invalid']);
 ok('fresh parallel-plan source binding',run('node',['tools/check-parallel-plan.mjs']).status===0);
 git(['add','.']);git(['commit','-m','isolated baseline']);const baseline=git(['rev-parse','HEAD']);
 let result=run('node',['tools/parallel-workspace.mjs','--prepare']);
 ok('fresh worktrees all share clean baseline',result.status===0&&JSON.parse(result.stdout).lanes.every(l=>l.head===baseline&&l.status==='ALIGNED_CLEAN'));
 result=run('node',['tools/parallel-workspace.mjs','--prepare']);ok('aligned preparation is idempotent',result.status===0&&JSON.parse(result.stdout).implementationReady===false);
 const lane=join(temporary,'Narralens-agents/bridge-observability');
 mkdirSync(join(lane,'src/mcp'),{recursive:true});writeFileSync(join(lane,'src/mcp/example.ts'),'export const fixture = true;\n');
 result=run('node',['tools/check-parallel-plan.mjs','--lane','bridge','--base',baseline],lane);
 ok('allowed untracked module can be inspected',result.status===0);
 writeFileSync(join(lane,'user-uncommitted.txt'),'keep this exact user-like fixture');
 result=run('node',['tools/parallel-workspace.mjs','--prepare']);
 ok('dirty/untracked lane refuses preparation without deletion',result.status!==0&&result.stderr.includes('NEEDS_RECONCILIATION')&&readFileSync(join(lane,'user-uncommitted.txt'),'utf8')==='keep this exact user-like fixture');
 result=run('node',['tools/check-parallel-plan.mjs','--lane','bridge','--base',baseline],lane);
 ok('out-of-scope untracked file is rejected',result.status!==0&&result.stderr.includes('OUTSIDE_LANE_OWNERSHIP'));
 rmSync(join(lane,'user-uncommitted.txt'));git(['add','src/mcp/example.ts'],lane);git(['commit','-m','isolated divergence'],lane);
 result=run('node',['tools/parallel-workspace.mjs','--prepare']);ok('clean but divergent lane refuses preparation',result.status!==0&&result.stderr.includes('BASE_MISMATCH'));
 const planPath=join(root,'docs/agent-driven-v1/06_ITERATION_EXECUTION_PLAN.md');const original=readFileSync(planPath,'utf8');writeFileSync(planPath,original+'\nchanged source\n');
 result=run('node',['tools/check-parallel-plan.mjs']);ok('stale derived iteration plan cannot pass',result.status!==0&&result.stderr.includes('STALE_ITERATION_PLAN'));
 writeFileSync(planPath,original.replace(' | 无 | DOC-PROTOTYPE',' | IT-P02 | DOC-PROTOTYPE'));
 result=run('node',['tools/check-iteration-plan.mjs']);ok('multi-predecessor dependency cycle is rejected',result.status!==0&&result.stderr.includes('Dependency cycle'));
 const receipt={kind:'isolated-planning-tool-regression',status:'PASS',checks,productionAcceptance:'NOT_RUN',userWorktreesTouched:false,toolHashes:Object.fromEntries(['check-iteration-plan.mjs','check-parallel-plan.mjs','parallel-workspace.mjs'].map(name=>[name,createHash('sha256').update(readFileSync(join(source,'tools',name))).digest('hex')]))};
 writeFileSync(join(source,'docs/agent-driven-v1/parallel-tool-tests.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
}finally{
 // Exact task-created root containing only generated fixture repositories and their worktrees.
 if(!temporary.startsWith(join(tmpdir(),'narralens-parallel-tools-')))throw Error('Unexpected cleanup root');
 rmSync(temporary,{recursive:true,force:true});
}
