// Review-only controlled port probe; not production NativeAck evidence.
import { OpenFilmNativeExpected } from "../../../../../../src/host/m5/openfilm-native-expected.ts";
import { mkdtempSync, writeFileSync, openSync, closeSync, fstatSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const hash='a'.repeat(64);
const bindingOf=()=>({project_id:'p1',native_project_id:'n1',revision:3,snapshot_id:'snap1',source_digest:hash,instance_generation:2,selection_version:4,workspace:{workspace_ref:'ws1',snapshot_id:'snap1',source_digest:hash,revision:3},isCurrent:()=>true});
const library={computeExpectedProjection:()=>({status:'unsupported',reason:'INPUT_INVALID'}),hydrationCanonicalJson:JSON.stringify};
const root=mkdtempSync(join(tmpdir(),'native-review-'));
const results=[];
try {
 for (const scenario of ['verifyClosure_getter_closes_before_registration','isCurrent_mutates_binding_during_assert','closure_mutates_binding_during_assert','last_file_mutates_binding_during_assert','closure_releases_proof_control','last_file_closes_service_control']) {
  const file=join(root,scenario);writeFileSync(file,'review');const fd=openSync(file,'r');let closed=false;let closes=0;let armed=false;let service;let proof;
  const binding=bindingOf();
  const resource={relative_path:'film.html',sha256:hash,bytes:6,verify:()=>{if(armed&&scenario==='last_file_mutates_binding_during_assert')binding.project_id='p2';if(armed&&scenario==='last_file_closes_service_control')service.close();return true;},close:()=>{closes++;if(!closed){closeSync(fd);closed=true;}}};
  const facts={retained:[resource],entries:[],film:{relative_path:'film.html',sha256:hash,bytes:6,native_rev:'r1'},expected_input:{},style:{state:'absent',value:{}},captions:{state:'absent',value:[]},verifyClosure:()=>{if(armed&&scenario==='closure_mutates_binding_during_assert')binding.project_id='p2';if(armed&&scenario==='closure_releases_proof_control')service.release(proof);return true;}};
  if(scenario==='verifyClosure_getter_closes_before_registration')Object.defineProperty(facts,'verifyClosure',{get(){service.close();return ()=>true;}});
  service=new OpenFilmNativeExpected({source:{readSource:async()=>facts},loader:{load:async()=>library},approved:{}} as any);
  let proveError=null,assertError=null,projection=null;
  try {proof=await service.prove(binding);}catch(e){proveError=e.message;}
  const closesAfterProve=closes;
  if(proof&&scenario!=='verifyClosure_getter_closes_before_registration'){
   armed=true;if(scenario==='isCurrent_mutates_binding_during_assert')binding.isCurrent=()=>{binding.project_id='p2';return true;};
   try {projection=service.assertCurrent(binding,proof);}catch(e){assertError=e.message;}
  }
  let fdOpen=false;try{fstatSync(fd);fdOpen=true;}catch{}
  const defect=scenario==='verifyClosure_getter_closes_before_registration'?!!proof&&fdOpen:scenario.endsWith('_control')?assertError===null:projection!==null&&binding.project_id!==projection.project_id;
  results.push({scenario,proveResolved:!!proof,proveError,assertError,projectionProject:projection?.project_id,bindingProject:binding.project_id,closesAfterProve,fdOpenBeforeCleanup:fdOpen,defect});
  try{service.close();}finally{if(!closed){closeSync(fd);closed=true;}}
 }
}finally{rmSync(root,{recursive:true,force:true});}
console.log(JSON.stringify(results,null,2));
process.exitCode=results.some(r=>r.defect)?1:0;
