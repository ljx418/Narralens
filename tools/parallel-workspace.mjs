// Prepare worktrees only. Does not launch Agents, services, installs or tests.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const plan=JSON.parse(readFileSync(join(root,'docs/agent-driven-v1/parallel-plan.json')));
const parent=resolve(root,plan.workspaceParent);
if(parent!==join(dirname(root),'Narralens-agents'))throw Error('Unexpected workspace parent');
const git=(args,cwd=root)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const head=git(['rev-parse','HEAD']);
const worktrees=git(['worktree','list','--porcelain']).split('\n\n').map(block=>Object.fromEntries(block.split('\n').map(line=>{const pos=line.indexOf(' ');return pos<0?[line,true]:[line.slice(0,pos),line.slice(pos+1)]})));
const lanes=plan.lanes.map(l=>{
 if(!/^[a-z-]+$/.test(l.directory)||!/^agent-driven\/lane-[a-z]+$/.test(l.branch))throw Error('Unsafe lane declaration');
 const path=join(parent,l.directory),registered=worktrees.find(w=>resolve(String(w.worktree))===path);
 if(existsSync(path)&&(!registered||registered.branch!==`refs/heads/${l.branch}`))throw Error('Existing directory preserved; unexpected worktree '+path);
 if(!registered){try{git(['show-ref','--verify','--quiet',`refs/heads/${l.branch}`]);throw Error('Existing branch preserved; not reusing '+l.branch)}catch(error){if(error.status!==1)throw error}}
 const actualHead=registered?git(['rev-parse','HEAD'],path):null;
 const dirty=registered?git(['status','--porcelain'],path)!=='':false;
 const status=!registered?'NOT_CREATED':dirty?'DIRTY':actualHead!==head?'BASE_MISMATCH':'ALIGNED_CLEAN';
 return {lane:l.id,path,branch:l.branch,exists:!!registered,head:actualHead,dirty,status};
});
const prepare=process.argv.includes('--prepare');
if(prepare){
 if(git(['status','--porcelain'])!=='')throw Error('Commit or resolve integration worktree changes before preparing lanes');
 const unreconciled=lanes.filter(l=>l.exists&&l.status!=='ALIGNED_CLEAN');
 if(unreconciled.length)throw Error('NEEDS_RECONCILIATION; all existing work preserved: '+JSON.stringify(unreconciled));
 mkdirSync(parent,{recursive:true});
 for(const lane of lanes)if(!lane.exists){git(['worktree','add','-b',lane.branch,lane.path,head]);lane.exists=true;lane.head=git(['rev-parse','HEAD'],lane.path);lane.status='ALIGNED_CLEAN'}
}
const receipt={format:'narralens.parallel-workspaces@1',mode:prepare?'PREPARED':'PLAN_ONLY',integrationRoot:root,integrationBranch:git(['branch','--show-current']),preparedFromCommit:head,alignedClean:lanes.every(l=>l.status==='ALIGNED_CLEAN'),implementationReady:false,implementationRelease:'NOT_RELEASED',agentsStarted:false,dependenciesInstalled:false,lanes};
if(prepare)writeFileSync(join(parent,'workspace-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
