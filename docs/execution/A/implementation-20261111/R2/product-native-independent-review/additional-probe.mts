import { OpenFilmNativeExpected } from '/home/administrator/orca/workspaces/Narralens/Narralens-A-R1-PRODUCT/src/host/m5/openfilm-native-expected.ts';
import { openSync, closeSync, fstatSync, writeFileSync, unlinkSync } from 'node:fs';
const root = new URL('.', import.meta.url).pathname;
const hash='a'.repeat(64);
const bindingOf=()=>({project_id:'p1',native_project_id:'n1',revision:3,snapshot_id:'snap1',source_digest:hash,instance_generation:2,selection_version:4,workspace:{workspace_ref:'ws1',snapshot_id:'snap1',source_digest:hash,revision:3},isCurrent:()=>true});
const library=()=>({EXPECTED_PROFILE:'narralens.native-expected-numeric@1',upstream_sha:'e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3',computeExpectedProjection:()=>({status:'computed',settings:{sha256:hash},markers:{sha256:hash}}),hydrationCanonicalJson:JSON.stringify});
const resources:any[]=[];
function resource(name:string, before?:()=>void){
 const path=root+name;writeFileSync(path,'review');const fd=openSync(path,'r');let closed=false;
 const obj={relative_path:name,sha256:hash,bytes:6,verify:()=>{try {fstatSync(fd);return !closed;}catch{return false;}},close:()=>{before?.();if(!closed){closeSync(fd);closed=true;}},cleanup:()=>{if(!closed){closeSync(fd);closed=true;}unlinkSync(path);}};resources.push(obj);return obj;
}
const factsOf=(retained:any[])=>({retained,entries:retained.map(x=>({relative_path:x.relative_path,sha256:x.sha256})),film:{relative_path:'film.html',sha256:hash,bytes:6,native_rev:'r1'},expected_input:{},style:{state:'absent',value:{}},captions:{state:'absent',value:[]},verifyClosure:()=>true});
const results:any[]=[];
try {
 let service:any;let proofB:any;const binding=bindingOf();let nested:any=null;let nestedError:any=null;let read=0;
 const first=resource('cleanup-failing.fd',()=>{throw new Error('CLOSE_FAILED');});
 const second=resource('cleanup-reentry.fd',()=>{try{nested=service.assertCurrent(binding,proofB);}catch(e){nestedError=e.message;}});
 const other=resource('other-proof.fd');
 service=new OpenFilmNativeExpected({source:{readSource:async()=>factsOf(++read===1?[first,second]:[other])},loader:{load:async()=>library()},approved:{}} as any);
 const proofA=await service.prove(binding);proofB=await service.prove(binding);
 let releaseError:any=null;try{service.release(proofA);}catch(e){releaseError=e.message;}
 let afterError:any=null;try{service.assertCurrent(binding,proofB);}catch(e){afterError=e.message;}
 results.push({scenario:'failed_close_then_next_cleanup_reenters_other_proof',nestedProjectionReturned:nested!==null,nestedError,releaseError,afterError,defect:nested!==null});
 try{service.close();}catch{}
 for(const mutator of ['canonical','closure_getter']){
  const b=bindingOf();const file=resource(mutator+'.fd');const lib=library();const facts=factsOf([file]);
  if(mutator==='canonical')lib.hydrationCanonicalJson=(v:any)=>{b.project_id='p2';return JSON.stringify(v);};
  // Canonical is also used while computing parts; mutate only on the final input call.
  if(mutator==='canonical')lib.hydrationCanonicalJson=(v:any)=>{if(v===facts.expected_input)b.project_id='p2';return JSON.stringify(v);};
  if(mutator==='closure_getter')Object.defineProperty(facts,'verifyClosure',{get(){b.project_id='p2';return ()=>true;}});
  const s=new OpenFilmNativeExpected({source:{readSource:async()=>facts},loader:{load:async()=>lib},approved:{}} as any);
  let projection:any=null,error:any=null;try{const p=await s.prove(b);projection=s.assertCurrent(b,p);}catch(e){error=e.message;}
  results.push({scenario:'prove_binding_changed_by_'+mutator,projectionProject:projection?.project_id,bindingProject:b.project_id,error,defect:projection!==null&&projection.project_id!==b.project_id});s.close();
 }
} finally {for(const r of resources)r.cleanup();}
console.log(JSON.stringify(results,null,2));process.exitCode=results.some(x=>x.defect)?1:0;
