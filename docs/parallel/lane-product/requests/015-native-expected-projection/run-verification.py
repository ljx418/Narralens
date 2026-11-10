#!/usr/bin/env python3
"""MAIN-admitted build then real Node artifact vectors; no Host/browser/media/network."""
import datetime,hashlib,json,os,pathlib,subprocess,sys
here=pathlib.Path(__file__).resolve().parent;lane=here.parents[4];root=lane/'var/managed-native-expected/source';native=lane/'var/managed-native-observation/source';evidence=here/(sys.argv[1] if len(sys.argv)>1 else 'check1');evidence.mkdir(exist_ok=False)
manifest=json.loads((here/'source-manifest.json').read_text());deps=json.loads((here.parent/'010-managed-native-observation/offline-dependencies.json').read_text())
def source_hashes():
 rows=[(row['path'],hashlib.sha256((root/row['path']).read_bytes()).hexdigest()) for row in manifest['files']]
 return {'files':len(rows),'sha256':hashlib.sha256(json.dumps(rows,separators=(',',':')).encode()).hexdigest(),'matches_manifest':all(sha==row['sha256'] for (path,sha),row in zip(rows,manifest['files']))}
def dependency_hashes():
 rows=[(path,hashlib.sha256((native/path).read_bytes()).hexdigest()) for path,expected in deps['file_sha256']]
 return {'files':len(rows),'sha256':hashlib.sha256(json.dumps(rows,separators=(',',':')).encode()).hexdigest(),'matches_frozen':rows==[tuple(row) for row in deps['file_sha256']]}
result={'scope':'pure expected library build and actual Node literal vectors only; no real source/media/UI acceptance','source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=lane,text=True).strip(),'source_files_sha256':manifest['source_files_sha256'],'contract_sha256':manifest['contract_sha256'],'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'source_before':source_hashes(),'dependencies_before':dependency_hashes(),'commands':[]}
(evidence/'results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'source_before':result['source_before'],'dependencies_before':result['dependencies_before']}),flush=True)
if not result['source_before']['matches_manifest'] or not result['dependencies_before']['matches_frozen']:raise SystemExit('FROZEN_INPUT_CHANGED')
env=dict(os.environ);env.pop('NODE_PATH',None);env['CI']='1'
commands=[('library-build',['node',str(root/'managed-expected/build-expected.mjs')]),('node-vectors',['node',str(here/'check-literal-vectors.mjs'),str(lane/'var/managed-native-expected/dist/expected-projection.mjs')])]
for name,args in commands:
 start=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (evidence/(name+'.log')).open('x') as log:
  process=subprocess.Popen(args,cwd=lane,env=env,stdout=log,stderr=subprocess.STDOUT);code=process.wait()
 row={'name':name,'argv':args,'cwd':str(lane),'pid':process.pid,'started_at':start,'ended_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exit':code,'log':str((evidence/(name+'.log')).relative_to(here))};result['commands'].append(row);(evidence/'results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(row),flush=True)
 if code!=0:break
result['source_after']=source_hashes();result['dependencies_after']=dependency_hashes();result['source_unchanged']=result['source_before']==result['source_after'];result['dependencies_unchanged']=result['dependencies_before']==result['dependencies_after'];result['ended_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();(evidence/'results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'source_after':result['source_after'],'dependencies_after':result['dependencies_after'],'source_unchanged':result['source_unchanged'],'dependencies_unchanged':result['dependencies_unchanged']}),flush=True)
sys.exit(0 if len(result['commands'])==2 and all(row['exit']==0 for row in result['commands']) and result['source_unchanged'] and result['dependencies_unchanged'] else 1)
