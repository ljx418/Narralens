import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=join(root,'docs/agent-driven-v1/s0-r2');
const chrome='/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
const profile=await mkdtemp('/mnt/c/workspace/videoworkline/.narralens-observation-r2-');
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
  const assert=(id,ok)=>{if(!ok)throw Error(id);(receipt.checks??=[]).push({id,status:'PASS'})};
  receipt.hashes={};for(const name of ['prototype.html','review.html','architecture.html','baseline.png'])receipt.hashes[name]=createHash('sha256').update(await readFile(join(output,name))).digest('hex');
  const expectedWidth=(await readFile(join(output,'baseline.png'))).readUInt32BE(16);await navigate(join(output,'prototype.html'));await viewport(1440,1000);
  assert('two-new-sections-only',await evaluate("document.querySelectorAll('details.new-panel').length===2"));assert('historical-editor-image-loaded',await evaluate(`document.querySelector('#editor-baseline').naturalWidth===${expectedWidth}&&document.querySelector('.original-header img').naturalWidth===${expectedWidth}`));
  const original=await evaluate("(()=>{const x=document.querySelector('#editor-baseline'),r=x.getBoundingClientRect();return {src:x.src,width:r.width,height:r.height}})()");
  await evaluate("document.querySelector('#workflow-panel').open=false;document.querySelector('#console-panel').open=true");const after=await evaluate("(()=>{const x=document.querySelector('#editor-baseline'),r=x.getBoundingClientRect();return {src:x.src,width:r.width,height:r.height}})()");assert('collapse-does-not-replace-or-resize-editor-image',JSON.stringify(original)===JSON.stringify(after));
  await evaluate("document.querySelector('#agent-note').click()");assert('agent-claim-does-not-commit',await evaluate('OBS_DEMO.read().hostRevision===1&&OBS_DEMO.read().stage===0'));await evaluate("document.querySelector('#workflow-panel').open=true;document.querySelector('#console-panel').open=false;document.querySelector('#next').click();document.querySelector('#next').click();document.querySelector('#next').click()");assert('prepare-and-wait-no-write',await evaluate('OBS_DEMO.read().stage===3&&OBS_DEMO.read().hostRevision===1'));
  await evaluate("document.querySelector('#existing-approval').click()");assert('link-to-old-ui-not-an-approval',await evaluate('OBS_DEMO.read().stage===3&&OBS_DEMO.read().hostRevision===1'));await evaluate('scrollTo(0,0)');
  await evaluate("document.querySelector('#approve').click()");assert('commit-not-editor-ack',await evaluate("OBS_DEMO.read().hostRevision===2&&OBS_DEMO.read().editorRevision===1&&document.querySelector('#sync-state').textContent.includes('尚未确认')"));assert('committed-content-cannot-cancel',await evaluate("document.querySelector('#cancel').disabled"));
  await evaluate("document.querySelector('#editor-ack').click()");assert('editor-ack-honestly-simulated',await evaluate("OBS_DEMO.read().editorSimulated&&document.querySelector('#sync-state').textContent.includes('底图仍为历史r1')"));assert('baseline-image-unmodified-after-simulation',await evaluate(`document.querySelector('#editor-baseline').src===${JSON.stringify(original.src)}`));
  await evaluate("document.querySelector('#reset').click();document.querySelector('#next').click();document.querySelector('#next').click();document.querySelector('#cancel').click()");assert('cancel-request-not-cancelled',await evaluate('OBS_DEMO.read().requested&&!OBS_DEMO.read().cancelled'));await evaluate("document.querySelector('#cancel-ack').click();document.querySelector('#late').click()");assert('cancelled-late-result-not-adopted',await evaluate("OBS_DEMO.read().cancelled&&OBS_DEMO.read().hostRevision===1&&OBS_DEMO.read().logs.at(-1).summary.includes('隔离')"));
  await evaluate("document.querySelector('#reset').click();document.querySelector('#next').click();document.querySelector('#disconnect').click()");assert('offline-last-known-not-fake-running',await evaluate("OBS_DEMO.read().stage===1&&document.querySelector('#phase-badge').textContent.includes('最后已知')&&document.querySelector('#health').textContent.includes('未知')"));await evaluate("document.querySelector('#reconnect').click();document.querySelector('#error').click()");assert('error-visible-with-console-folded',await evaluate("!document.querySelector('#console-panel').open&&document.querySelector('#error-strip').textContent.includes('503')&&OBS_DEMO.read().hostRevision===1"));
  await evaluate("document.querySelector('#console-panel').open=true;OBS_DEMO.injectNote('<img src=x onerror=\"window.BAD_XSS=true\">')");assert('console-untrusted-text-not-html',await evaluate("document.querySelector('#logs').textContent.includes('<img')&&!document.querySelector('#logs img')&&!window.BAD_XSS"));await evaluate("document.querySelector('#filter').value='error';document.querySelector('#filter').dispatchEvent(new Event('change'))");assert('log-filter-matches-error',await evaluate("[...document.querySelectorAll('#logs .log')].every(x=>x.classList.contains('error'))"));
  await evaluate("document.querySelector('#reset').click();document.querySelector('#idle').click()");assert('idle-no-invented-agent-or-range',await evaluate("document.querySelector('#driver-label').textContent.includes('无活动Agent')&&document.querySelector('#scope-note').textContent.includes('不填造')&&document.querySelectorAll('#steps li').length===0"));await evaluate("document.querySelector('#reset').click();document.querySelector('#locate').click()");assert('locate-only-explicit-highlight',await evaluate("document.querySelector('#focus-outline').classList.contains('visible')&&OBS_DEMO.read().hostRevision===1"));
  await viewport(1440,1000);await evaluate("document.querySelector('#workflow-panel').open=true;document.querySelector('#console-panel').open=true");await capture('panels-expanded-1440.png');await evaluate("document.querySelector('#workflow-panel').open=false;document.querySelector('#console-panel').open=false");
  for(const [width,height]of [[1440,1000],[1920,1080],[390,844]]){await viewport(width,height);const m=await evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})');assert('prototype-no-overflow-'+width,m.scrollWidth<=width);receipt.viewports.push({artifact:'prototype',...m});await capture('prototype-'+width+'.png')}
  await navigate(join(output,'architecture.html'));for(const [width,height]of [[1440,900],[1600,1000],[1920,1080],[2048,1320]]){await viewport(width,height);const m=await evaluate('({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight})');assert('diagram-fit-'+width,m.scrollWidth<=width&&m.scrollHeight<=height);receipt.viewports.push({artifact:'architecture',...m});if(width===2048)await capture('architecture-2048.png')}
  await navigate(join(output,'review.html'));for(const [width,height]of [[1440,1000],[390,844]]){await viewport(width,height);const m=await evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,count:document.querySelectorAll("[data-id]").length})');assert('review-layout-'+width,m.scrollWidth<=width&&m.count===6);receipt.viewports.push({artifact:'review',...m});await capture('review-'+width+'.png')}
  await evaluate("document.querySelector('[data-id=R2-1] [value=change]').click();const t=document.querySelector('[data-id=R2-1] textarea');t.value='保留原工作台';t.dispatchEvent(new Event('input',{bubbles:true}))");await call('Page.reload');await wait(800);assert('opinion-saved',await evaluate("document.querySelector('[data-id=R2-1] [value=change]').checked"));const dl=join(profile,'downloads');await mkdir(dl);await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:win(dl).replaceAll('/','\\'),eventsEnabled:true});await call('Runtime.evaluate',{expression:"document.querySelector('#download').click()",userGesture:true,returnByValue:true});let downloaded;for(let i=0;i<100;i++){try{const n=(await readdir(dl)).find(n=>n.endsWith('.json'));if(n){downloaded=JSON.parse(await readFile(join(dl,n),'utf8'));break}}catch{}await wait(100)}assert('download-six-opinions-version-bound',downloaded?.items.length===6&&downloaded.items[0].choice==='change'&&downloaded.revision===await evaluate('revision'));receipt.status='pass';delete receipt.downloadEvents;console.log(JSON.stringify({status:'pass',checks:receipt.checks.length,productionAcceptance:'NOT_RUN'}));
}catch(error){receipt.status='fail';receipt.error=String(error);console.error(error);process.exitCode=1}
finally{
  await writeFile(join(output,'browser-check.json'),JSON.stringify(receipt,null,2)+'\n');
  if(socket?.readyState===1){try{await call('Browser.close')}catch{}socket.close()}
  await wait(500);
  if(child?.exitCode===null){await new Promise(done=>{const cleanup=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$needle='--user-data-dir='+$env:NARRALENS_REVIEW_PROFILE; Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($needle)} | ForEach-Object {taskkill.exe /PID $_.ProcessId /T /F | Out-Null}"],{env:{...process.env,NARRALENS_REVIEW_PROFILE:win(profile)},stdio:'ignore'});cleanup.once('exit',done);cleanup.once('error',done)})}
  await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
