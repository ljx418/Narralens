from pathlib import Path
import subprocess,json,hashlib,datetime,os,sys
b=Path(__file__).resolve().parent
main=Path('/mnt/c/workspace/videoworkline/Narralens-agents/main-integration')
metadata=json.loads((main/'node_modules/.modules.yaml').read_text());store=Path(metadata['storeDir']);assert store.is_dir()
results=[]
for lane in ('bridge','product','media'):
 root=Path('/home/administrator/orca/workspaces/Narralens/Narralens-A-R1-'+lane.upper());mods=root/'node_modules';retained=None
 if mods.exists():
  assert lane=='bridge','Refuse replacing unexplained existing dependencies'
  retained=root/'node_modules.failed-offline-20261111';assert not retained.exists();mods.rename(retained)
 before={n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in ('package.json','pnpm-lock.yaml')}
 argv=['corepack','pnpm','install','--offline','--store-dir',str(store),'--frozen-lockfile','--ignore-scripts','--ignore-pnpmfile','--package-import-method=copy']
 rmeta={'lane':lane,'cwd':str(root),'argv':argv,'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'retained_failed_modules':str(retained) if retained else None,'store_evidence':'main node_modules metadata storeDir, read metadata only not user credentials','before':before}
 (b/f'dependencies/{lane}-store-retry1.cmd.json').write_text(json.dumps(rmeta,indent=2)+'\n')
 env=os.environ.copy();env['COREPACK_ENABLE_NETWORK']='0';log=b/f'dependencies/{lane}-store-retry1.txt'
 with log.open('wb') as f:r=subprocess.run(argv,cwd=root,stdout=f,stderr=subprocess.STDOUT,env=env)
 after={n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in before};assert before==after
 rmeta.update({'exit':r.returncode,'ended_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'after':after,'log_sha256':hashlib.sha256(log.read_bytes()).hexdigest()});results.append(rmeta)
 (b/'dependencies/correct-store-results.json').write_text(json.dumps({'scope':'fixed offline cache; no lifecycle scripts/provider/network downloads','results':results},indent=2)+'\n')
 print(lane+' correct-store dependencies exit='+str(r.returncode),flush=True)
 if r.returncode:sys.exit(r.returncode)
