from pathlib import Path
import subprocess,datetime,hashlib,json,sys
base=Path(__file__).resolve().parent
root=Path('/mnt/c/workspace/videoworkline/Narralens-agents/main-integration')
commands=[('typecheck',['corepack','pnpm','exec','tsc','--noEmit']),('affected',['corepack','pnpm','test','tests/agent-driven/integration/created-task-store.test.ts','tests/agent-driven/integration/created-task-worker.test.ts','tests/agent-driven/integration/created-task-gate.test.ts','tests/agent-driven/integration/created-draft-processor.test.ts','tests/agent-driven/integration/source-digest-resource-boundary.test.ts','tests/agent-driven/integration/local-assets-host.test.ts','tests/agent-driven/media/native-draft.test.ts','tests/m2.1/source-digest-v1.test.ts','--maxWorkers=1','--minWorkers=1'])]
results=[]
for name,argv in commands:
 log=base/'logs'/f'{name}.txt';started=datetime.datetime.now(datetime.timezone.utc).isoformat()
 meta={'argv':argv,'cwd':str(root),'started_at':started,'scope':'R0 affected checks; component/actual synthetic media, not A acceptance','source_head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()}
 (base/'logs'/f'{name}.cmd.json').write_text(json.dumps(meta,indent=2)+'\n')
 with log.open('wb') as f:r=subprocess.run(argv,cwd=root,stdout=f,stderr=subprocess.STDOUT)
 (base/'logs'/f'{name}.exit').write_text(str(r.returncode)+'\n')
 results.append({**meta,'ended_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exit':r.returncode,'log':str(log),'sha256':hashlib.sha256(log.read_bytes()).hexdigest()})
 print(name+' exit='+str(r.returncode),flush=True)
 if r.returncode:break
(base/'checks.json').write_text(json.dumps({'scope':'R0 affected validation only','commands':results,'all_requested_completed':len(results)==len(commands),'passed':len(results)==len(commands) and all(x['exit']==0 for x in results)},indent=2)+'\n')
sys.exit(0 if len(results)==len(commands) and all(x['exit']==0 for x in results) else 1)
