import {OpenFilmStudioSupervisor} from '../../../../src/host/m5/openfilm-studio-supervisor.js';
const [root,vendorRoot]=process.argv.slice(2);
if(!root||!vendorRoot)throw new Error('Missing fixture arguments');
let attempts=0,closed=true;
const origins:string[]=[];
const supervisor=new OpenFilmStudioSupervisor({vendorRoot,targetRootOf:async()=>root,onStudio:studio=>{attempts++;origins.push(studio.origin,studio.filmOrigin);throw new Error('EXPECTED_GATEWAY_FAILURE');}});
try{
 for(let i=0;i<2;i++){
  let refused=false;try{await supervisor.ensure('diagnostic','legacy-retry');}catch(error){refused=error instanceof Error&&error.message==='EXPECTED_GATEWAY_FAILURE';}
  if(!refused)throw new Error('Legacy composition did not fail at its intended boundary');
  for(const origin of origins){try{await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)});closed=false;}catch{}}
 }
 await supervisor.close();
 process.stdout.write(JSON.stringify({attempts,closed})+'\n');
}finally{await supervisor.close();}
