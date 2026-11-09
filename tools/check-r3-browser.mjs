import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=join(root,'docs/agent-driven-v1/s0-r3');
const chrome='/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
const profile=await mkdtemp('/mnt/c/workspace/videoworkline/.narralens-r3-review-');
const win=path=>path.replace(/^\/mnt\/([a-z])\//,(_,drive)=>drive.toUpperCase()+':/');
const uri=path=>'file:///'+win(path);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket,child;let sequence=0;const pending=new Map();
const receipt={kind:'supplementary-windows-headless-CDP',status:'running',businessAcceptance:'NOT_RUN',viewports:[],screenshots:[]};
const call=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP_TIMEOUT:'+method))},15000);
  pending.set(id,msg=>{clearTimeout(timer);msg.error?reject(Error(JSON.stringify(msg.error))):resolve(msg.result)});
  socket.send(JSON.stringify({id,method,params}));
});
const evaluate=async(expression)=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value};
async function navigate(path){await call('Page.navigate',{url:uri(path)});await wait(900)}
async function viewport(width,height){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await wait(180)}
async function capture(name){const result=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(output,name),Buffer.from(result.data,'base64'));receipt.screenshots.push(name)}
try{
  child=spawn(chrome,['--headless=new','--disable-gpu','--mute-audio','--no-first-run','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${win(profile)}`,'about:blank'],{stdio:'ignore'});
  child.on('error',()=>{});
  let port;
  for(let i=0;i<80;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break}catch{}await wait(150)}
  if(!port)throw Error('CHROME_PORT_UNAVAILABLE');
  const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});
  socket.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.method?.startsWith('Browser.download')){(receipt.downloadEvents??=[]).push(msg)}if(msg.id&&pending.has(msg.id)){pending.get(msg.id)(msg);pending.delete(msg.id)}});
  await call('Page.enable');
  const assert=(id,ok)=>{if(!ok)throw Error(id);(receipt.checks??=[]).push({id,status:'PASS'})};receipt.hashes={};for(const n of ['prototype.html','review.html','README.md','image-manifest.json'])receipt.hashes[n]=createHash('sha256').update(await readFile(join(output,n))).digest('hex');
  await navigate(join(output,'prototype.html'));await viewport(1440,1000);const base=await evaluate("(()=>{const i=document.querySelector('#baseline-image'),r=i.getBoundingClientRect();return {src:i.src,top:r.top,width:r.width}})()");assert('workflow-collapsed-by-default',await evaluate("document.querySelector('#workflow').hidden&&!document.querySelector('#system-dialog').open"));await evaluate("document.querySelector('#flow-toggle').click()");const expanded=await evaluate("(()=>{const a=[...document.querySelectorAll('.step')].map(x=>x.getBoundingClientRect());return {shown:!document.querySelector('#workflow').hidden,count:a.length,sameRow:a.every(r=>Math.abs(r.top-a[0].top)<1),imageTop:document.querySelector('#baseline-image').getBoundingClientRect().top,src:document.querySelector('#baseline-image').src}})()");assert('top-flow-horizontal-and-reserves-space',expanded.shown&&expanded.count===6&&expanded.sameRow&&expanded.imageTop>base.top+100&&expanded.src===base.src);await capture('prototype-flow-expanded.png');await evaluate("document.querySelector('#flow-toggle').click()");assert('collapse-retains-original-editor',await evaluate(`document.querySelector('#baseline-image').src===${JSON.stringify(base.src)}&&document.querySelector('#workflow').hidden`));
  await evaluate("document.querySelector('#system-open').click()");assert('separate-system-dialog',await evaluate("document.querySelector('#system-dialog').open&&document.querySelector('#system-title').textContent==='系统控制'"));assert('shared-service-control-disabled',await evaluate("document.querySelector('#shared-restart').disabled"));await evaluate("document.querySelector('#worker-start').click()");assert('start-request-is-not-readiness',await evaluate("SYS_DEMO.read().worker==='starting'"));await evaluate("document.querySelector('#simulate-reply').click()");assert('worker-ready-only-after-reply',await evaluate("SYS_DEMO.read().worker==='ready'"));
  await evaluate("document.querySelector('#tab-models').click();document.querySelector('#model-load').click()");assert('model-loading-is-not-loaded',await evaluate("SYS_DEMO.read().image==='loading'&&document.querySelector('#model-warm').disabled&&document.querySelector('#model-load').disabled"));await evaluate("document.querySelector('#simulate-reply').click()");assert('loaded-not-prewarmed',await evaluate("SYS_DEMO.read().image==='loaded'&&!SYS_DEMO.read().warm&&!document.querySelector('#model-warm').disabled"));await evaluate("document.querySelector('#model-warm').click()");assert('warm-request-not-ready',await evaluate("SYS_DEMO.read().image==='warming'"));await evaluate("document.querySelector('#simulate-reply').click()");assert('model-ready-after-warm-reply',await evaluate("SYS_DEMO.read().warm&&SYS_DEMO.read().image==='loaded'"));assert('active-video-model-unload-disabled',await evaluate("document.querySelector('#busy-unload').disabled"));await capture('prototype-system-models.png');await evaluate("document.querySelector('#model-unload').click()");assert('unload-request-not-completed',await evaluate("SYS_DEMO.read().image==='unloading'&&document.querySelector('#model-load').disabled"));await evaluate("document.querySelector('#simulate-reply').click()");assert('unloaded-after-runtime-reply',await evaluate("SYS_DEMO.read().image==='unloaded'&&!SYS_DEMO.read().warm"));
  await evaluate("document.querySelector('#tab-recovery').click();document.querySelector('#retry-check').click()");assert('retry-check-not-media-reexecution',await evaluate("SYS_DEMO.read().retry==='checking'&&document.querySelector('#system-message').textContent.includes('不重提媒体')"));await evaluate("document.querySelector('#reconcile').click()");assert('unknown-result-not-resubmitted',await evaluate("document.querySelector('#system-message').textContent.includes('不自动重提')"));await evaluate("document.querySelector('#system-close').click()");assert('close-does-not-stop-services-or-reset-workflow',await evaluate("!document.querySelector('#system-dialog').open&&SYS_DEMO.read().worker==='ready'&&document.querySelector('#workflow').hidden"));
  for(const [width,height]of [[1440,1000],[390,844]]){await viewport(width,height);const r=await evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})');assert('prototype-layout-'+width,r.scrollWidth<=width);receipt.viewports.push({artifact:'prototype',...r});await capture('prototype-'+width+'.png');await evaluate("document.querySelector('#system-open').click()");const d=await evaluate("(()=>{const r=document.querySelector('#system-dialog').getBoundingClientRect();return {width:r.width,height:r.height}})()");assert('system-dialog-fits-'+width,d.width<=width&&d.height<=height);await evaluate("document.querySelector('#system-close').click()")}
  await navigate(join(output,'review.html'));await viewport(1440,1000);assert('three-host-generated-images',await evaluate("document.querySelectorAll('[data-image]').length===3"));for(let i=0;i<3;i++){await evaluate(`document.querySelector('[data-image="${i}"]').click()`);await wait(500);assert('generated-image-visible-'+i,await evaluate("document.querySelector('#effect-image').complete&&document.querySelector('#effect-image').naturalWidth>1000"));}for(const [width,height]of [[1440,1000],[390,844]]){await viewport(width,height);const r=await evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})');assert('gallery-layout-'+width,r.scrollWidth<=width);receipt.viewports.push({artifact:'review',...r});await capture('review-'+width+'.png')};receipt.status='pass';delete receipt.downloadEvents;console.log(JSON.stringify({status:'pass',checks:receipt.checks.length,runtimeModelsOrServicesTouched:false}));
}catch(error){receipt.status='fail';receipt.error=String(error);console.error(error);process.exitCode=1}
finally{
  await writeFile(join(output,'browser-check.json'),JSON.stringify(receipt,null,2)+'\n');
  if(socket?.readyState===1){try{await call('Browser.close')}catch{}socket.close()}
  await wait(500);
  if(child?.exitCode===null){await new Promise(done=>{const cleanup=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$needle='--user-data-dir='+$env:NARRALENS_REVIEW_PROFILE; Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($needle)} | ForEach-Object {taskkill.exe /PID $_.ProcessId /T /F | Out-Null}"],{env:{...process.env,NARRALENS_REVIEW_PROFILE:win(profile)},stdio:'ignore'});cleanup.once('exit',done);cleanup.once('error',done)})}
  await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
