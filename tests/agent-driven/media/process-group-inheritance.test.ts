import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

it.runIf(process.platform==='linux')('keeps detached-requesting real Node descendants in the owning worker process group',async()=>{
 const policy=pathToFileURL(resolve('src/host/render/media-process-policy.mjs')).href;
 const childCode=`const fs=require('node:fs');const stat=fs.readFileSync('/proc/self/stat','utf8');const group=Number(stat.slice(stat.lastIndexOf(')')+2).split(' ')[2]);console.log(JSON.stringify({pid:process.pid,group}));`;
 const workerCode=`
  import {spawn,spawnSync,execFile} from 'node:child_process';
  import {installMediaProcessPolicy} from ${JSON.stringify(policy)};
  installMediaProcessPolicy();
  const args=['-e',${JSON.stringify(childCode)}];
  const results=[];
  results.push(await new Promise((resolve,reject)=>{const c=spawn(process.execPath,args,{detached:true,stdio:['ignore','pipe','pipe']});let text='';c.stdout.on('data',x=>text+=x);c.on('error',reject);c.on('close',code=>code===0?resolve(JSON.parse(text)):reject(new Error('child failed')));}));
  const sync=spawnSync(process.execPath,args,{detached:true,encoding:'utf8'});if(sync.status!==0)throw new Error('sync failed');results.push(JSON.parse(sync.stdout));
  const exec=await new Promise((done,reject)=>execFile(process.execPath,args,{detached:true},(error,stdout)=>error?reject(error):done(stdout)));results.push(JSON.parse(exec));
  const explicit=await new Promise((done,reject)=>execFile(process.execPath,args,undefined,(error,stdout)=>error?reject(error):done(stdout)));results.push(JSON.parse(explicit));
  console.log(JSON.stringify({owner:process.pid,results}));
 `;
 const worker=spawn(process.execPath,['--input-type=module','-e',workerCode],{detached:true,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';worker.stdout!.on('data',x=>stdout+=x);worker.stderr!.on('data',x=>stderr+=x);
 const timeout=setTimeout(()=>{if(worker.pid)try{process.kill(-worker.pid,'SIGKILL');}catch{}},15000);
 try{
  const code=await new Promise<number|null>((done,reject)=>{worker.once('error',reject);worker.once('close',done);});
  expect(code,stderr).toBe(0);
  const result=JSON.parse(stdout) as {owner:number;results:{pid:number;group:number}[]};
  expect(result.owner).toBe(worker.pid);expect(result.results).toHaveLength(4);
  for(const child of result.results){expect(child.group).toBe(result.owner);expect(()=>process.kill(child.pid,0)).toThrow();}
 }finally{clearTimeout(timeout);if(worker.pid)try{process.kill(-worker.pid,'SIGKILL');}catch{}}
},20000);
