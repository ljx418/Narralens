'use strict';
const $=id=>document.getElementById(id);
const state={phase:'intent',expanded:false,system:false,tab:'services',scenario:'normal',draft:$('intent').value,revision:1,editorRevision:1,view:'original',candidate:false,viewedCandidate:false,worker:'ready',model:'unloaded',expiredOnce:false,token:0,systemToken:0,events:[]};
const stage={intent:0,preparing:1,blocked:1,offline:1,review:2,confirm:2,expired:2,committing:3,syncing:3,unknown:3,done:4};
const words={intent:['先确认修改目标，其他镜头保持','准备这个镜头的候选','只准备预览，不写工程。'],preparing:['Agent正在准备候选 · 暂无需决定','准备中…','可取消准备，目标与草稿保留。'],review:['候选已准备好 · 等你查看差异','核对采用影响','先看差异，下一步再确认采用。'],confirm:['等你确认 · 仅替换镜头2画面','确认采用这个画面','确认后才写入工程，不会改旁白和时长。'],committing:['确认已受理 · 尚未提交完成','正在提交…','不重复提交，等待明确回报。'],syncing:['工程已提交 · 编辑区待确认','等待编辑区确认…','提交成功不等于画面已经同步。'],done:['镜头2已更新 · 可以继续精修','继续调整这一镜','新的修改会重新准备候选，不覆盖其他镜头。'],blocked:['镜头2等待媒体服务 · 草稿已保留','检查服务后继续准备','查看系统面板中的具体阻塞。'],offline:['连接中断 · 保留最后已知状态','恢复连接并核对原任务','不会重复创建候选任务。'],expired:['确认依据过期 · 需要重新核对','重新核对采用影响','重核后仍需由你确认。'],unknown:['采用结果未知 · 暂不重提','查询原请求结果','查询不会重新提交或自动采用。']};
function log(event){state.events.push({event,phase:state.phase,revision:state.revision,editorRevision:state.editorRevision});}
function phase(p,message=''){state.phase=p;if(message)$('feedback').textContent=message;log('phase:'+p);render();}
function later(ms,fn){const token=state.token;setTimeout(()=>{if(token===state.token)fn()},ms);}
function laterSystem(ms,fn){const token=state.systemToken;setTimeout(()=>{if(token===state.systemToken)fn()},ms);}
function render(){
  const [status,action,help]=words[state.phase];$('top-title').textContent='镜头2 · '+state.draft;$('top-title').title=state.draft;$('top-status').textContent=status;$('primary').textContent=state.phase==='review'&&!state.viewedCandidate?'查看候选并比较':action;$('primary').disabled=['preparing','committing','syncing'].includes(state.phase)||state.phase==='intent'&&!state.draft.trim();$('decision-help').textContent=help;
  document.querySelectorAll('[data-phase]').forEach(el=>el.hidden=!el.dataset.phase.split(' ').includes(state.phase));
  $('confirmation').hidden=state.phase!=='confirm';$('workflow').hidden=!state.expanded;$('flow-toggle').setAttribute('aria-expanded',String(state.expanded));$('flow-toggle').textContent=state.expanded?'收起工作流':'工作流';
  [...$('flow-rail').children].forEach((el,i)=>{el.classList.toggle('done',i<stage[state.phase]);if(i===stage[state.phase])el.setAttribute('aria-current','step');else el.removeAttribute('aria-current')});
  $('flow-explanation').textContent=status+'；仅镜头2画面受影响，旁白、时长与其他镜头保持。';
  $('workspace').classList.toggle('system-open',state.system);$('system-panel').hidden=!state.system;$('system-open').setAttribute('aria-expanded',String(state.system));
  $('view-candidate').disabled=!state.candidate;$('view-original').setAttribute('aria-pressed',String(state.view==='original'));$('view-candidate').setAttribute('aria-pressed',String(state.view==='candidate'));$('scene').classList.toggle('candidate',state.view==='candidate');
  $('preview-title').textContent=state.view==='candidate'?'候选A · 暖色城市暮景':'当前 · '+(state.editorRevision>1?'已采用的暖色城市暮景':'城市远景');
  if(state.editorRevision>1&&state.view==='original')$('scene').classList.add('candidate');
  $('scene-title').textContent=$('preview-title').textContent+'，演练示意，不是真实视频';$('editor-sync').textContent=`工程 r${state.revision} · 编辑区 r${state.editorRevision}（演练）`;$('history').textContent=`工程 r${state.revision}：采用镜头2候选；编辑区 r${state.editorRevision}。`;
  renderSystem();
}
function renderSystem(){
  const impact=state.phase==='blocked'?'镜头2候选准备受阻：媒体 Worker 尚未就绪。':state.phase==='offline'?'连接中断：镜头2任务结果待核对。':state.phase==='unknown'?'镜头2采用结果未知：先查证原请求，禁止重提。':'当前无已知阻塞（演练）。';
  $('system-impact').textContent=impact;$('recovery-impact').textContent=impact;$('worker-state').textContent={ready:'就绪（模拟）',stopped:'未启动（模拟）',checking:'正在检查（模拟）'}[state.worker];
  $('worker-check').disabled=state.worker==='checking';
  for(const tab of ['services','models','recovery']){const active=state.tab===tab;$('tab-'+tab).setAttribute('aria-selected',String(active));$('tab-'+tab).tabIndex=active?0:-1;$('panel-'+tab).hidden=!active}
  $('model-state').textContent={unloaded:'未加载（模拟）',loading:'请求已受理 · 装载中',loaded:'已加载 · 尚未预热',warming:'预热中 · 尚未就绪',ready:'就绪 · 已预热（模拟）',unloading:'卸载中'}[state.model];
  $('model-load').disabled=state.model!=='unloaded';$('model-warm').disabled=state.model!=='loaded';$('model-unload').disabled=!['loaded','ready'].includes(state.model)||['preparing','blocked','offline','committing','syncing','unknown'].includes(state.phase);
  $('primary').disabled=['preparing','committing','syncing'].includes(state.phase)||state.phase==='intent'&&(!state.draft.trim()||state.model==='unloading');
}
function openSystem(){state.system=true;render();$('system-title').tabIndex=-1;$('system-title').focus();}
function prepare(){if(state.model==='unloading'){$('feedback').textContent='先等待模型安全卸载完成，再准备候选。';return;}state.token++;state.candidate=false;state.viewedCandidate=false;state.view='original';phase('preparing','演练：已登记目标，等待模拟候选回报。');later(900,()=>{if(state.scenario==='blocked'&&state.worker!=='ready')return phase('blocked','只阻塞这次候选准备，工程未改变。');if(state.scenario==='offline')return phase('offline','演练：收到断线事件，最后已知状态为准备中。');state.candidate=true;phase('review','候选A已准备好（演练）。比较不修改工程。');});}
$('intent').addEventListener('input',()=>{state.draft=$('intent').value;$('top-title').textContent='镜头2 · '+state.draft;$('top-title').title=state.draft;$('primary').disabled=!state.draft.trim()||state.model==='unloading';});
$('flow-toggle').onclick=()=>{state.expanded=!state.expanded;render();if(state.expanded)$('flow-rail').querySelector('[aria-current]')?.scrollIntoView({block:'nearest',inline:'center',behavior:'instant'});};
$('locate').onclick=()=>{const field=state.phase==='intent'?$('intent'):$('primary').disabled?$('director-title'):$('primary');if(field===$('director-title'))field.tabIndex=-1;field.scrollIntoView({block:'nearest'});field.focus();};
$('system-open').onclick=()=>{if(state.system){state.system=false;render();$('system-open').focus();}else openSystem();};$('system-close').onclick=()=>{state.system=false;render();$('system-open').focus();};$('open-blocker').onclick=openSystem;
$('system-panel').addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();$('system-close').click();return}const tabs=['services','models','recovery'];const idx=tabs.findIndex(t=>'tab-'+t===e.target.id);if(idx<0||!['ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;e.preventDefault();state.tab=e.key==='Home'?tabs[0]:e.key==='End'?tabs[2]:tabs[(idx+(e.key==='ArrowRight'?1:2))%3];renderSystem();$('tab-'+state.tab).focus();});
for(const tab of ['services','models','recovery'])$('tab-'+tab).onclick=()=>{state.tab=tab;renderSystem();};
$('view-original').onclick=()=>{state.view='original';render();};$('view-candidate').onclick=()=>{if(state.candidate){state.view='candidate';state.viewedCandidate=true;render();$('feedback').textContent='正在查看候选示意帧，工程没有改变。';}};
$('cancel-prepare').onclick=()=>{state.token++;phase('intent','本次准备已取消，晚到回报不再生效，目标已保留。');};
$('rework').onclick=()=>{state.token++;state.candidate=false;state.view='original';phase('intent','只调整镜头2的要求；已有工程和其他镜头保持。');$('intent').focus();};
$('primary').onclick=()=>{
  if(state.phase==='intent')return prepare();
  if(state.phase==='review'){if(!state.viewedCandidate){$('view-candidate').click();$('view-candidate').focus();return;}return phase('confirm','演练检查通过：范围、保留项与采用影响已列明，仍需你确认。');}
  if(state.phase==='expired')return phase('confirm','演练：重新核对已完成，仍需再次确认。');
  if(state.phase==='confirm'){
    if(state.scenario==='expired'&&!state.expiredOnce){state.expiredOnce=true;return phase('expired','演练：过期的确认依据未被使用，工程未写入。');}
    phase('committing','演练：确认已受理，等待提交结果。');
    later(700,()=>{if(state.scenario==='unknown')return phase('unknown','演练：提交结果无法确认，保留原请求，不重提。');state.revision++;phase('syncing','演练：Host提交成功，编辑区仍显示旧版本。');later(1000,()=>{state.editorRevision=state.revision;state.view='original';phase('done','演练：收到编辑区版本确认，本次修改完成。');});});return;
  }
  if(state.phase==='done'){state.candidate=false;state.view='original';return phase('intent','继续精修这一镜，工程当前版本保持。');}
  if(state.phase==='blocked'){if(state.worker!=='ready'){$('feedback').textContent='媒体服务还未就绪，请在系统面板检查。';return openSystem();}return prepare();}
  if(state.phase==='offline'){state.candidate=true;return phase('review','演练：重连已核对原任务，候选可查看；未新建请求。');}
  if(state.phase==='unknown'){$('feedback').textContent='演练：查询仍无明确结果，保持阻塞；未重提、未增加版本。';log('query-original-result');}
};
$('worker-check').onclick=()=>{if(state.worker==='checking')return;state.worker='checking';renderSystem();$('system-feedback').textContent='演练：检查请求已受理，尚未就绪。';laterSystem(650,()=>{state.worker='ready';renderSystem();$('system-feedback').textContent='演练：收到就绪探针回报，可回到导演栏继续原任务。';});};
$('shared-check').onclick=()=>{$('system-feedback').textContent='演练：只读连接检查，未接管、未重启共享实例。';};
$('diagnostic').onclick=()=>{$('system-feedback').textContent='演练：只检查依赖，未重新执行媒体任务或重提采用请求。';};
for(const [id,start,end]of [['model-load','loading','loaded'],['model-warm','warming','ready'],['model-unload','unloading','unloaded']])$(id).onclick=()=>{if($(id).disabled)return;state.model=start;renderSystem();$('system-feedback').textContent='演练：请求已受理，等待模拟runtime回报。';laterSystem(650,()=>{state.model=end;renderSystem();$('system-feedback').textContent='演练：收到runtime回报，状态已更新；真实模型未操作。';});};
function reset(){state.token++;state.systemToken++;Object.assign(state,{phase:'intent',revision:1,editorRevision:1,candidate:false,viewedCandidate:false,view:'original',worker:state.scenario==='blocked'?'stopped':'ready',model:'unloaded',expiredOnce:false,events:[]});$('feedback').textContent='演练已重新开始。目标草稿保留；这不是生产工程回退。';$('system-feedback').textContent='所有服务与模型操作仅改变演练状态。';render();}
$('scenario').onchange=()=>{state.scenario=$('scenario').value;reset();};$('restart-demo').onclick=reset;
window.NARRALENS_DEMO={read:()=>JSON.parse(JSON.stringify(state))};
render();
