/** Linux-only real headless Chromium containment probe. Not a T20/film acceptance. */
import {spawn} from 'node:child_process';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const policy=resolve(root,'src/host/render/media-process-policy.mjs');
const vendor='/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm';
const wait=ms=>new Promise(done=>setTimeout(done,ms));
if(process.argv[2]==='--worker'){
 const {installMediaProcessPolicy}=await import(pathToFileURL(policy));installMediaProcessPolicy();
 const {guardBrowser,guardedLaunchArgs}=await import(pathToFileURL(resolve(root,'src/host/render/openfilm-guard-rules.mjs')));
 const {launch}=await import(pathToFileURL(resolve(vendor,'packages/openfilm/src/host.mjs')));
 const browser=guardBrowser(await launch({args:guardedLaunchArgs(['--mute-audio'])}));
 process.stdout.write(JSON.stringify({ready:true,pid:process.pid})+'\n');
 process.stdin.once('data',()=>{void browser.close().then(()=>process.exit(0),()=>process.exit(2));});
}else{
 if(process.platform!=='linux')throw new Error('Linux procfs required; no platform substitution');
 const output=process.argv[2];if(!output)throw new Error('Explicit evidence output path required');
 async function stat(pid){try{const text=await readFile('/proc/'+pid+'/stat','utf8');const fields=text.slice(text.lastIndexOf(')')+2).split(' ');return {pid:Number(pid),state:fields[0],ppid:Number(fields[1]),pgid:Number(fields[2]),start:fields[19]};}catch{return null;}}
 async function descendants(pid){const rows=(await Promise.all((await readdir('/proc')).filter(v=>/^\d+$/.test(v)).map(stat))).filter(Boolean);const ids=new Set([pid]);for(let changed=true;changed;){changed=false;for(const row of rows)if(ids.has(row.ppid)&&!ids.has(row.pid)){ids.add(row.pid);changed=true;}}return rows.filter(row=>ids.has(row.pid));}
 const results=[];
 for(const mode of ['normal-close','kill-group']){
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--worker'],{detached:true,stdio:['pipe','pipe','pipe']});
  let stderr='',stdout='',owned=[];child.stderr.on('data',value=>stderr+=value);child.stdout.on('data',value=>stdout+=value);
  const closed=new Promise(done=>{child.once('close',(code,signal)=>done({code,signal}));child.once('error',error=>done({error:error.message}));});
  try{
   const end=Date.now()+25000;while(!stdout.includes('"ready":true')&&Date.now()<end&&child.exitCode===null)await wait(50);
   owned=await descendants(child.pid);
   if(!stdout.includes('"ready":true'))throw new Error('Browser did not become ready: '+stderr.slice(-500));
   if(mode==='normal-close')child.stdin.end('close\n');else process.kill(-child.pid,'SIGKILL');
   const outcome=await Promise.race([closed,wait(15000).then(()=>({timeout:true}))]);
   let remaining=[];const limit=Date.now()+5000;
   do{remaining=(await Promise.all(owned.map(async previous=>{const current=await stat(previous.pid);return current&&current.start===previous.start?current:null;}))).filter(Boolean);if(!remaining.length)break;await wait(50);}while(Date.now()<limit);
   results.push({mode,owner:child.pid,owned,remaining,outcome,all_in_owner_group:owned.every(row=>row.pgid===child.pid),passed:owned.length>1&&owned.every(row=>row.pgid===child.pid)&&remaining.length===0&&!outcome.timeout});
  }catch(error){results.push({mode,owner:child.pid,owned,passed:false,error:String(error.message)});}
  finally{
   // Only terminate this probe's identities. Start ticks prevent killing a reused PID.
   for(const previous of owned){const current=await stat(previous.pid);if(current&&current.start===previous.start&&current.state!=='Z')try{process.kill(current.pid,'SIGKILL');}catch{}}
   if(child.exitCode===null&&child.signalCode===null)try{process.kill(-child.pid,'SIGKILL');}catch{}
   await Promise.race([closed,wait(2000)]);
  }
 }
 const result={scope:'Real headless Chromium process containment only; no render/Host/T20 acceptance',policy_sha256:createHash('sha256').update(await readFile(policy)).digest('hex'),results,passed:results.every(row=>row.passed)};
 await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
 process.stdout.write(JSON.stringify({passed:result.passed,results:results.map(row=>({mode:row.mode,passed:row.passed,owned:row.owned.length,remaining:row.remaining?.length,error:row.error}))})+'\n');
 process.exitCode=result.passed?0:1;
}
