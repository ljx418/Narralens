#!/usr/bin/env python3
"""Owned test source mutations, with byte snapshot/restore; never checkout/reset user work."""
import hashlib,json,os,pathlib,subprocess,sys
repo=pathlib.Path(__file__).resolve().parents[1]
source=repo/'src/host/render/native-draft-io.ts'
output=repo/'docs/execution/A/logs/native-draft-directory-mutations-r1'
output.mkdir(parents=True,exist_ok=False)
original=source.read_bytes()
(output/'original-native-draft-io.ts').write_bytes(original)
sha=lambda b:hashlib.sha256(b).hexdigest()
results=[]
def run(name,pattern):
 argv=['corepack','pnpm','exec','vitest','run','tests/agent-driven/media/native-draft.test.ts','--maxWorkers=1','--minWorkers=1']
 if pattern:argv+=['--testNamePattern',pattern]
 (output/(name+'.cmd.json')).write_text(json.dumps({'cwd':str(repo),'argv':argv},indent=2)+'\n')
 with (output/(name+'.txt')).open('x') as log:done=subprocess.run(argv,cwd=repo,stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'COREPACK_ENABLE_NETWORK':'0'})
 (output/(name+'.exit')).write_text(str(done.returncode)+'\n')
 return done.returncode,(output/(name+'.txt')).read_text()
try:
 code,log=run('baseline',None)
 if code:raise RuntimeError('Original baseline did not pass')
 for name,needle,pattern in [
  ('ROOT_IDENTITY','if(!stat.isDirectory()||identity(stat)!==identity(this.#createdStat!))changed();','refuses a different real directory substituted'),
  ('NESTED_IDENTITY','if(!stat.isDirectory()||identity(stat)!==identity(created))changed();','refuses a substituted nested real output directory')]:
  text=original.decode();assert text.count(needle)==1
  mutated=text.replace(needle,'if(!stat.isDirectory())changed();').encode();source.write_bytes(mutated)
  try:
   code,log=run(name,pattern)
   bites=code!=0 and 'promise resolved' in log and '1 failed' in log
   results.append({'name':name,'exit':code,'expected_assertion_failed':bites})
   if not bites:raise RuntimeError('Mutation did not produce the expected failing assertion')
  finally:
   if source.read_bytes()!=mutated:raise RuntimeError('Concurrent source change; refusing destructive restore')
   source.write_bytes(original)
finally:
 restored=source.read_bytes()==original
 (output/'result.json').write_text(json.dumps({'source_sha256':sha(original),'restored':restored,'results':results},indent=2)+'\n')
 if not restored:raise RuntimeError('Source byte restoration not confirmed')
print(json.dumps({'restored':True,'mutation_gates':len(results),'all_bite':all(r['expected_assertion_failed'] for r in results)}))
