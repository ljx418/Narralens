#!/usr/bin/env python3
"""MAIN-admitted sequential native UI type/build, no browser/Host/network/provider."""
import datetime,hashlib,json,os,pathlib,subprocess,sys
here=pathlib.Path(__file__).resolve().parent;lane=here.parents[4];root=lane/'var/managed-native-observation/source';cwd=root/'packages/openfilm';evidence=here/(sys.argv[1] if len(sys.argv)>1 else 'check1');evidence.mkdir(exist_ok=False)
source=json.loads((here/'source-manifest.json').read_text())
for file in source['files']:
 if hashlib.sha256((root/file['path']).read_bytes()).hexdigest()!=file['post_sha256']:raise SystemExit('CANDIDATE_SOURCE_CHANGED')
env=dict(os.environ);env.pop('NODE_PATH',None);env['CI']='1'
result={'scope':'native hydration candidate UI types/build only','source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=lane,text=True).strip(),'network':'NONE','started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'upstream_sha':source['upstream_sha'],'patch_sha256':source['patch_sha256'],'source_files_sha256':source['source_files_sha256'],'internal_contract_sha256':json.loads((here/'internal-contract-manifest.json').read_text())['internal_contract_sha256'],'lock_sha256':hashlib.sha256((root/'pnpm-lock.yaml').read_bytes()).hexdigest(),'cwd':str(cwd),'commands':[]}
for name,args in [('typecheck',['node','node_modules/typescript/bin/tsc','-p','studio/ui']),('build',['node','node_modules/vite/bin/vite.js','build','--config','studio/ui/vite.config.ts'])]:
 start=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (evidence/(name+'.log')).open('x') as log:
  process=subprocess.Popen(args,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT);exit_code=process.wait()
 record={'name':name,'argv':args,'pid':process.pid,'started_at':start,'ended_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exit':exit_code,'log':str((evidence/(name+'.log')).relative_to(here))};result['commands'].append(record)
 (evidence/'results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(record),flush=True)
if result['commands'][-1]['exit']==0:
 files=[{'path':file.relative_to(cwd/'studio/ui/dist').as_posix(),'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()} for file in sorted((cwd/'studio/ui/dist').rglob('*')) if file.is_file()]
 manifest={'upstream_sha':result['upstream_sha'],'patch_sha256':result['patch_sha256'],'source_files_sha256':result['source_files_sha256'],'dependencies_sha256':json.loads((here.parent/'010-managed-native-observation/offline-dependencies.json').read_text())['closure_sha256'],'node':result['node'],'files':files,'dist_manifest_sha256':hashlib.sha256(json.dumps(files,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'browser':'NOT_RUN','independent_review':'PENDING'}
 (evidence/'build-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'dist_files':len(files),'dist_manifest_sha256':manifest['dist_manifest_sha256']}),flush=True)
result['ended_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();(evidence/'results.json').write_text(json.dumps(result,indent=2)+'\n')
sys.exit(0 if all(record['exit']==0 for record in result['commands']) else 1)
