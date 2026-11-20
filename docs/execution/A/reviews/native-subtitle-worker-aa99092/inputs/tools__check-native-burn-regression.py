#!/usr/bin/env python3
"""Actual media regression: the previous worker must fail caption pixels, then restore bytes."""
import hashlib,json,os,pathlib,subprocess,sys,re
repo=pathlib.Path(__file__).resolve().parents[1]
run_id=sys.argv[1] if len(sys.argv)>1 else 'r1'
if not re.fullmatch(r'r[1-9][0-9]*',run_id):raise SystemExit('Invalid owned capture ID')
full_suite='--full-media-suite' in sys.argv[2:]
output=repo/('docs/execution/A/logs/native-burn-regression-'+run_id);output.mkdir(parents=True,exist_ok=False)
worker=repo/'src/host/render/openfilm-render-worker.mjs';pin=repo/'src/host/render/openfilm-render-pin.json'
original_worker=worker.read_bytes();original_pin=pin.read_bytes()
(output/'original-worker.mjs').write_bytes(original_worker);(output/'original-pin.json').write_bytes(original_pin)
sha=lambda b:hashlib.sha256(b).hexdigest()
argv=['corepack','pnpm','exec','vitest','run','tests/agent-driven/media/native-draft-real-render.test.ts','--maxWorkers=1','--minWorkers=1']
def run(name):
 actual_argv=argv if name!='current' or not full_suite else ['corepack','pnpm','exec','vitest','run','tests/agent-driven/media','--maxWorkers=1','--minWorkers=1']
 (output/(name+'.cmd.json')).write_text(json.dumps({'cwd':str(repo),'argv':actual_argv},indent=2)+'\n')
 with (output/(name+'.txt')).open('x') as log:done=subprocess.run(actual_argv,cwd=repo,stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'COREPACK_ENABLE_NETWORK':'0'})
 (output/(name+'.exit')).write_text(str(done.returncode)+'\n');return done.returncode,(output/(name+'.txt')).read_text()
result={'current_worker_sha256':sha(original_worker),'original_pin_sha256':sha(original_pin),'baseline_scope':'full_media_suite' if full_suite else 'real_render_only','baseline_exit':None,'regression_exit':None,'expected_caption_assertion_failed':False}
mutated_worker=None;mutated_pin=None
try:
 code,log=run('current');result['baseline_exit']=code
 if code:raise RuntimeError('Current real-media positive failed; regression NOT_RUN')
 mutated_worker=subprocess.check_output(['git','show','7b48bc17fb65d966d6239c537f856ff240846766:src/host/render/openfilm-render-worker.mjs'],cwd=repo)
 changed=json.loads(original_pin);changed['worker_sha256']=sha(mutated_worker);mutated_pin=(json.dumps(changed,indent=2)+'\n').encode()
 worker.write_bytes(mutated_worker);pin.write_bytes(mutated_pin)
 code,log=run('previous-worker');result['regression_exit']=code
 result['expected_caption_assertion_failed']=code!=0 and 'expected 0 to be greater than 40' in log and '1 failed' in log
 if not result['expected_caption_assertion_failed']:raise RuntimeError('Old worker did not fail the actual caption pixel assertion')
finally:
 if mutated_worker is not None:
  if worker.read_bytes()!=mutated_worker or pin.read_bytes()!=mutated_pin:raise RuntimeError('Concurrent source change; refusing destructive restore')
  worker.write_bytes(original_worker);pin.write_bytes(original_pin)
 result['source_restored']=worker.read_bytes()==original_worker and pin.read_bytes()==original_pin
 (output/'result.json').write_text(json.dumps(result,indent=2)+'\n')
 if not result['source_restored']:raise RuntimeError('Source restoration not confirmed')
print(json.dumps(result))
