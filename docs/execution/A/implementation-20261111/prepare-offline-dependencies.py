from pathlib import Path
import subprocess,json,hashlib,datetime,os,sys
b=Path(__file__).resolve().parent;(b/'dependencies').mkdir(exist_ok=True)
results=[]
for lane in ('bridge','product','media'):
 root=Path('/home/administrator/orca/workspaces/Narralens/Narralens-A-R1-'+lane.upper())
 assert not (root/'node_modules').exists(),'Do not replace existing dependency root'
 before={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ('package.json','pnpm-lock.yaml')}
 argv=['corepack','pnpm','install','--offline','--frozen-lockfile','--ignore-scripts','--package-import-method=copy']
 record={'lane':lane,'cwd':str(root),'argv':argv,'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'authorization':'MAIN local fixed offline dependency preparation for authorized A implementation; no Claude model call','before':before}
 (b/f'dependencies/{lane}.cmd.json').write_text(json.dumps(record,indent=2)+'\n')
 env=os.environ.copy();env['COREPACK_ENABLE_NETWORK']='0'
 log=b/f'dependencies/{lane}.txt'
 with log.open('wb') as stream:r=subprocess.run(argv,cwd=root,stdout=stream,stderr=subprocess.STDOUT,env=env)
 after={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in before};assert before==after,'Pinned files changed'
 record.update({'exit':r.returncode,'ended_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'after':after,'log_sha256':hashlib.sha256(log.read_bytes()).hexdigest()});results.append(record)
 (b/'dependencies/result.json').write_text(json.dumps({'scope':'MAIN offline dependency setup only; no lifecycle scripts/model/provider/network install','results':results},indent=2)+'\n')
 print(lane+' dependencies exit='+str(r.returncode),flush=True)
 if r.returncode:sys.exit(r.returncode)
