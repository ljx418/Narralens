#!/usr/bin/env python3
"""MAIN-authorized offline UI checks; no browser/Host/provider/network."""
import datetime,hashlib,json,os,pathlib,subprocess,sys
here=pathlib.Path(__file__).resolve().parent;lane=here.parents[4];root=lane/'var/managed-native-observation/source';cwd=root/'packages/openfilm'
evidence=here/sys.argv[1] if len(sys.argv)>1 else here
evidence.mkdir(exist_ok=True)
checks=evidence/'checks';checks.mkdir(exist_ok=True)
env=dict(os.environ);env.pop('NODE_PATH',None);env['CI']='1'
result={'scope':'managed native UI only, no browser or Host','network':'NONE','started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'upstream_sha':'e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3','patch_sha256':hashlib.sha256((here/'candidate.patch').read_bytes()).hexdigest(),'lock_sha256':hashlib.sha256((root/'pnpm-lock.yaml').read_bytes()).hexdigest(),'cwd':str(cwd),'commands':[]}
for name,args in [('typecheck',['node','node_modules/typescript/bin/tsc','-p','studio/ui']),('build',['node','node_modules/vite/bin/vite.js','build','--config','studio/ui/vite.config.ts'])]:
 start=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (checks/(name+'-first.log')).open('x') as log:
  done=subprocess.run(args,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT)
 result['commands'].append({'name':name,'argv':args,'started_at':start,'ended_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exit':done.returncode,'log':str((checks/(name+'-first.log')).relative_to(here))})
 (evidence/'ui-checks.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result['commands'][-1]),flush=True)
if result['commands'][-1]['exit']==0:
 files=[]
 for file in sorted((cwd/'studio/ui/dist').rglob('*')):
  if file.is_file():files.append({'path':file.relative_to(cwd/'studio/ui/dist').as_posix(),'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
 manifest={'upstream_sha':result['upstream_sha'],'patch_sha256':result['patch_sha256'],'dependencies_sha256':json.loads((here/'offline-dependencies.json').read_text())['closure_sha256'],'node':result['node'],'files':files}
 manifest['dist_manifest_sha256']=hashlib.sha256(json.dumps(files,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 (evidence/'build-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'dist_files':len(files),'dist_manifest_sha256':manifest['dist_manifest_sha256']}),flush=True)
result['ended_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();(evidence/'ui-checks.json').write_text(json.dumps(result,indent=2)+'\n')
sys.exit(0 if all(row['exit']==0 for row in result['commands']) else 1)
