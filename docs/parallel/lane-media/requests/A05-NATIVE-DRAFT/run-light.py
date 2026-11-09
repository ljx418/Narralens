#!/usr/bin/env python3
"""Only run with MAIN's exclusive light slot; captures failures unchanged. No Host/browser/media."""
import hashlib, json, os, pathlib, subprocess, sys, datetime
lane = pathlib.Path(__file__).resolve().parents[5]
docs = pathlib.Path(__file__).resolve().parent
run = sys.argv[1]
if not run.isalnum(): raise SystemExit('Invalid capture label')
logs = docs / 'checks' / run
logs.mkdir(parents=True, exist_ok=False)
cwd = lane / 'var/native-draft-824b7db/source'
manifest = json.loads((docs / 'candidate-manifest.json').read_text())
for item in manifest['files']:
    if hashlib.sha256((cwd / item['path']).read_bytes()).hexdigest() != item['post_sha256']: raise RuntimeError('Stale archive overlay')
env = dict(os.environ); env.pop('NODE_PATH', None)
commands = [
    ['node', 'node_modules/typescript/bin/tsc', '--noEmit'],
    ['node', 'node_modules/vitest/vitest.mjs', 'run', 'tests/agent-driven/media/native-draft.test.ts', '--maxWorkers=1', '--minWorkers=1'],
]
record = {'scope': 'tsc then singleworker pure filesystem/fixed parser only; no real media', 'cwd': str(cwd), 'patch_sha256': manifest['patch_sha256'], 'inputs': manifest['files'], 'commands': []}
code = 0
for index, command in enumerate(commands):
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with (logs / f'{index}.log').open('wb') as output:
        result = subprocess.run(command, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT)
    code = result.returncode
    item = {'argv': command, 'started_at': started, 'ended_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'exit': code, 'log': f'{index}.log', 'log_sha256': hashlib.sha256((logs / f'{index}.log').read_bytes()).hexdigest()}
    record['commands'].append(item)
    (logs / 'commands.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(item), flush=True)
    if code: break
(logs / 'exit').write_text(str(code) + '\n')
sys.exit(code)
