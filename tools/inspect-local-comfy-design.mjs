// Read-only design inventory. Never submits prompts or starts ComfyUI.
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const workspace=dirname(root);
const source=resolve(workspace,'comfyui-ai-comic-workflows');
const definitions=[
 ['h3-ref','workflows/api/01_H3_R2V_Character_Cinematic_5s.api.json','参考图生成概念片段'],
 ['h3-first-last','workflows/api/02_H3_FL2V_Storyboard_5s.api.json','首尾帧概念镜头/转场候选'],
 ['wan-i2v','workflows/api/03B_Wan22_I2V_Wrapper_LowMem_Smoke.api.json','静态概念图短动态'],
 ['rife','workflows/api/05A_Finish_RIFE_Prepare_30fps.api.json','插帧准备，需执行器组合'],
 ['upscale','workflows/api/05B_Finish_Fast_AnimeSharp_1080p.api.json','分批超分，非整片执行器'],
 ['seedvr2','workflows/api/06_Finish_HQ_SeedVR2_1080p.api.json','自定义后台长任务包装节点']
];
const candidates=definitions.map(([id,relative,purpose])=>{
 const path=resolve(source,relative);const bytes=readFileSync(path);const doc=JSON.parse(bytes);
 const graph=doc.prompt??doc;const nodes=Object.entries(graph).filter(([,n])=>n?.class_type);
 return {id,path,sha256:hash(bytes),format:doc.prompt?'prompt-envelope':'api-graph',purpose,nodes:nodes.length,nodeClasses:[...new Set(nodes.map(([,n])=>n.class_type))],narralensStatus:'CANDIDATE_NOT_INTEGRATED',runtimeTest:'NOT_RUN'};
});
for(const relative of ['image_z_image_turbo.json','（工作流）image_z_image_turbo.json']){
 const path='/mnt/c/ComfyUI-aki-v2/ComfyUI/user/default/workflows/项目工作流总库/05_图像生成与编辑/'+relative;
 if(existsSync(path)){const bytes=readFileSync(path),doc=JSON.parse(bytes);candidates.push({id:'image-'+candidates.length,path,sha256:hash(bytes),format:Array.isArray(doc.nodes)?'canvas-requires-conversion':'unknown',purpose:'概念图/封面候选',nodes:doc.nodes?.length??0,nodeClasses:[...new Set((doc.nodes??[]).map(n=>n.type))],narralensStatus:'CANDIDATE_NOT_INTEGRATED',runtimeTest:'NOT_RUN'})}
}
const reportPath=resolve(source,'preflight-status.json');const bytes=readFileSync(reportPath);const report=JSON.parse(bytes);
const inventory={format:'narralens.local-comfy-design-inventory@1',observed_at:new Date().toISOString(),scope:'file/schema/source inspection only; no GPU execution or prompt submission',candidates,historicalPreflight:{path:reportPath,sha256:hash(bytes),ready:report.ready,blockers:report.blocking_count,failedChecks:report.checks.filter(c=>!c.ok).map(c=>c.name)},currentExistenceForHistoricalMissingFiles:report.checks.filter(c=>c.kind==='file'&&!c.ok).map(c=>({name:c.name,exists:existsSync(c.path),bytes:existsSync(c.path)?statSync(c.path).size:null})),warnings:['Registry and per-workflow docs disagree about historical readiness. No current runtime capability approval.','Canvas and prompt-envelope formats must be distinguished. Custom async output nodes may return job handles rather than final media.']};
const output=resolve(root,'docs/agent-driven-v1/local-comfy-inventory.json');writeFileSync(output,JSON.stringify(inventory,null,2)+'\n');console.log(JSON.stringify({output,candidates:candidates.length,allRuntimeTests:'NOT_RUN'},null,2));
