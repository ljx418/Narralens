import subprocess,os,json,time
from pathlib import Path
src=Path('/mnt/c/workspace/videoworkline/Narralens-agents/bridge-observability/var/independent-owned-entry-01c2340/source');out=Path('/mnt/c/workspace/videoworkline/Narralens-agents/bridge-observability/docs/parallel/lane-bridge/reviews/frozen-01c2340')
steps=[('tsc',['corepack','pnpm','exec','tsc','--noEmit']),('build',['corepack','pnpm','build']),('tests',['corepack','pnpm','exec','vitest','run','tests/agent-driven/integration/owned-projects.test.ts','tests/agent-driven/integration/owned-project-client.test.ts','tests/agent-driven/headless/owned-project-entry.test.ts','tests/agent-driven/integration/created-native-entry.test.ts','--maxWorkers=1','--minWorkers=1'])]
for name,cmd in steps:
 (out/(name+'.cmd.json')).write_text(json.dumps({'cwd':str(src),'command':cmd,'environment_overrides':{'COREPACK_ENABLE_NETWORK':'0','CI':'1'}},indent=2)+'\n')
 print('START '+name,flush=True);start=time.monotonic()
 with(out/(name+'.stdout')).open('wb')as so,(out/(name+'.stderr')).open('wb')as se:r=subprocess.run(cmd,cwd=src,env=dict(os.environ,COREPACK_ENABLE_NETWORK='0',CI='1'),stdout=so,stderr=se)
 (out/(name+'.exit')).write_text(str(r.returncode)+'\n');print('END '+name+' exit='+str(r.returncode)+' seconds='+str(round(time.monotonic()-start,2)),flush=True)
 if r.returncode:raise SystemExit(r.returncode)
