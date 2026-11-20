from pathlib import Path
import subprocess,hashlib,json,time,os
R=Path('/mnt/c/workspace/videoworkline/Narralens-agents/main-integration')
O=Path(__file__).parent
H=R/'docs/execution/A/implementation-20261111/integration/e1-main-takeover'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def snapshot():
 paths=subprocess.check_output(['git','ls-files','-z'],cwd=R).decode().split('\0')
 files={x:sha(R/x) for x in paths if x and (R/x).is_file() and (x.startswith(('src/','tests/','tools/','contracts/')) or '/' not in x)}
 historical={str(x):sha(x) for x in H.glob('recovery-ownership-*') if x.is_file()}
 for x in H.glob('RECOVERY_OWNERSHIP_*'): historical[str(x)]=sha(x)
 for d in ['recovery-family-ownership-main','host-recovery-composition-review']:
  for x in (O.parent/d).rglob('*'):
   if x.is_file():historical[str(x)]=sha(x)
 index=Path(subprocess.check_output(['git','rev-parse','--git-path','index'],cwd=R,text=True).strip());index=index if index.is_absolute() else R/index
 return {'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=R,text=True).strip(),'index':sha(index),'files':files,'historical':historical,'status':subprocess.check_output(['git','status','--short'],cwd=R,text=True)}
before=snapshot();(O/'before.json').write_text(json.dumps(before,indent=2));assert before['head']=='e2eff61b464d75d36598103d718cd2a75db5dfda'
commands=[('pure-001',['corepack','pnpm','exec','vitest','run','--config','vitest.config.ts','tests/agent-driven/integration/controlled-recovery-families.test.ts','tests/agent-driven/integration/controlled-recovery-scheduler.test.ts']),('type-002',['corepack','pnpm','exec','tsc','--noEmit']),('host-003',['corepack','pnpm','exec','vitest','run','--config','vitest.config.ts','tests/wave2/m4b/adoption-route.test.ts','-t','owned adoption marker|unparseable unknown request'])]
results=[]
for name,argv in commands:
 meta={'argv':argv,'cwd':str(R),'start':time.time()}
 with (O/(name+'.stdout')).open('xb') as a,(O/(name+'.stderr')).open('xb') as b:
  child=subprocess.Popen(argv,cwd=R,stdout=a,stderr=b,start_new_session=True);meta['pid']=child.pid;meta['pgid']=child.pid
  (O/(name+'.command.json')).write_text(json.dumps(meta,indent=2));meta['exit']=child.wait()
 meta['end']=time.time();meta['stdout_sha256']=sha(O/(name+'.stdout'));meta['stderr_sha256']=sha(O/(name+'.stderr'))
 live=[]
 for proc in Path('/proc').glob('[0-9]*'):
  try:
   if os.getpgid(int(proc.name))==child.pid:live.append(int(proc.name))
  except (OSError,ProcessLookupError):pass
 meta['remaining_process_group_pids']=live
 (O/(name+'.result.json')).write_text(json.dumps(meta,indent=2));results.append(meta);print(name,meta['exit'],'remaining',live,flush=True)
 if live or meta['exit']!=0:break
after=snapshot();(O/'after.json').write_text(json.dumps(after,indent=2));(O/'results.json').write_text(json.dumps({'commands':results,'unchanged':before==after},indent=2));print('unchanged',before==after,flush=True)
