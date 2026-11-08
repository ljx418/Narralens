import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=join(root,'docs/agent-driven-v1');
const chrome='/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
const profile=await mkdtemp('/mnt/c/workspace/videoworkline/.narralens-design-review-');
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
  const architecturePath=join(root,'docs/architecture/agent-driven-v1-r2.architecture.html');
  const bytes=await readFile(architecturePath);receipt.architecture={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
  await navigate(architecturePath);
  for(const [width,height] of [[1440,900],[1600,1000],[1920,1080],[2048,1320]]){
    await viewport(width,height);
    const result=await evaluate(`({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight})`);
    receipt.viewports.push({artifact:'architecture',...result});
    if(result.scrollWidth>width||result.scrollHeight>height)throw Error('ARCHITECTURE_OVERFLOW:'+JSON.stringify(result));
    if(width===1440||width===2048)for(const theme of ['light','dark']){await evaluate(`document.documentElement.setAttribute('data-theme',${JSON.stringify(theme)})`);await capture(`r2-architecture-${width}-${theme}.png`)}
  }
  const reviewPath=join(output,'review.html');
  const reviewBytes=await readFile(reviewPath);receipt.review={sha256:createHash('sha256').update(reviewBytes).digest('hex'),bytes:reviewBytes.length};
  await navigate(reviewPath);
  for(const [width,height] of [[1440,1000],[390,844]]){
    await viewport(width,height);
    const result=await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,items:document.querySelectorAll('.review-item').length,embeddedDiagram:document.querySelector('iframe').contentDocument.querySelectorAll('svg').length})`);
    receipt.viewports.push({artifact:'review',...result});
    if(result.scrollWidth>width||result.items!==40||result.embeddedDiagram<1)throw Error('REVIEW_LAYOUT:'+JSON.stringify(result));
    await capture(`r2-review-${width}.png`);
  }
  await viewport(1440,1000);
  receipt.workflowDemo=await evaluate(`(()=>{document.querySelector('[data-demo-node="visual"]').click();document.querySelector('#demo-output').value='新的概念图示例';document.querySelector('#demo-edit').click();const text=document.querySelector('#demo-impact').textContent;return {nodes:document.querySelectorAll('[data-demo-node]').length,retainsVoice:text.includes('保留：创作简报、脚本章节、分镜方案、旁白与字幕'),noExecution:text.includes('未执行重算')}})()`);
  if(receipt.workflowDemo.nodes!==8||!receipt.workflowDemo.retainsVoice||!receipt.workflowDemo.noExecution)throw Error('WORKFLOW_DEMO');
  receipt.monitorDemo=await evaluate(`(()=>{document.querySelector('#mon-step').click();const before=document.querySelector('#mon-workflow').textContent;document.querySelector('#mon-disconnect').click();document.querySelector('#mon-step').click();const frozen=before===document.querySelector('#mon-workflow').textContent;const unknown=document.querySelector('#mon-services').textContent.includes('未知');document.querySelector('#mon-recover').click();return {frozenOnDisconnect:frozen,showsUnknown:unknown,recovered:document.querySelector('#mon-connection').textContent.includes('已连接'),clearlySimulated:document.querySelector('#monitor-design').textContent.includes('全部为模拟数据')}})()`);
  if(Object.values(receipt.monitorDemo).some(value=>!value))throw Error('MONITOR_DEMO');
  await evaluate("document.querySelector('#monitor-design').scrollIntoView()");await capture('monitoring-demo.png');
  await evaluate("document.querySelector('#r2-summary').scrollIntoView()");await capture('r2-workflow-demo.png');await evaluate('scrollTo(0,0)');
  receipt.interactions=await evaluate(`(()=>{const item=document.querySelector('[data-id="AD-E01"]');item.querySelector('[value="change"]').click();const note=item.querySelector('textarea');note.value='需要明确启动状态';note.dispatchEvent(new Event('input',{bubbles:true}));const result=report();return {choice:result.items[0].choice,note:result.items[0].note,total:result.items.length,approvalStatus:result.status,documentCount:Object.keys(result.documents).length,stored:localStorage.getItem(key)!==null}})()`);
  if(receipt.interactions.choice!=='change'||receipt.interactions.total!==40||!receipt.interactions.stored)throw Error('REVIEW_INTERACTION');
  await call('Page.reload');await wait(500);
  receipt.reload=await evaluate(`({selected:document.querySelector('[data-id="AD-E01"] [value="change"]').checked,note:document.querySelector('[data-id="AD-E01"] textarea').value})`);
  if(!receipt.reload.selected||receipt.reload.note!=='需要明确启动状态')throw Error('REVIEW_PERSISTENCE');
  const downloadRoot=join(profile,'downloads');await mkdir(downloadRoot);
  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:win(downloadRoot).replaceAll('/','\\'),eventsEnabled:true});
  receipt.downloadAttempt=await call('Runtime.evaluate',{expression:"document.querySelector('#download').click();document.querySelector('#message').textContent",userGesture:true,returnByValue:true});
  let downloaded;
  for(let i=0;i<100;i++){try{const names=await readdir(downloadRoot);receipt.downloadFiles=names;const name=names.find(name=>name.endsWith('.json'));if(name){downloaded=JSON.parse(await readFile(join(downloadRoot,name),'utf8'));break}}catch{}await wait(100)}
  if(!downloaded||downloaded.items.length!==40||downloaded.items[0].choice!=='change'||downloaded.document_revision!==await evaluate('revision'))throw Error('REVIEW_DOWNLOAD:'+JSON.stringify({files:receipt.downloadFiles,downloaded}));
  receipt.download={status:'pass',items:downloaded.items.length,versionBound:true};
  await evaluate('localStorage.removeItem(key)');
  receipt.status='pass';
  console.log(JSON.stringify(receipt,null,2));
}catch(error){receipt.status='fail';receipt.error=String(error);console.error(error);process.exitCode=1}
finally{
  await writeFile(join(output,'review-check.json'),JSON.stringify(receipt,null,2)+'\n');
  if(socket?.readyState===1){try{await call('Browser.close')}catch{}socket.close()}
  await wait(500);
  if(child?.exitCode===null){await new Promise(done=>{const cleanup=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$needle='--user-data-dir='+$env:NARRALENS_REVIEW_PROFILE; Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($needle)} | ForEach-Object {taskkill.exe /PID $_.ProcessId /T /F | Out-Null}"],{env:{...process.env,NARRALENS_REVIEW_PROFILE:win(profile)},stdio:'ignore'});cleanup.once('exit',done);cleanup.once('error',done)})}
  await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
