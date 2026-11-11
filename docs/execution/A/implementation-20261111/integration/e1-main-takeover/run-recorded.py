import sys,subprocess,json,hashlib,datetime
from pathlib import Path
r=Path(__file__).resolve().parent
name=sys.argv[1];cmd=sys.argv[2:]
files=[p for prefix in ['src/host/agent-driven','src/host/projects','tests/agent-driven/integration','docs/parallel/lane-bridge/A-R2-20261112'] for p in Path(prefix).rglob('*') if p.is_file()]
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
before={str(p):h(p) for p in files}
(r/(name+'.inputs.json')).write_text(json.dumps(before,indent=2))
(r/(name+'.cmd.json')).write_text(json.dumps({'argv':cmd,'cwd':str(Path.cwd()),'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat()},indent=2))
with (r/(name+'.txt')).open('w') as log:
 result=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT)
(r/(name+'.exit')).write_text(str(result.returncode)+'\n')
out={'exit':result.returncode,'source_changed':[str(p) for p in files if not p.exists() or h(p)!=before[str(p)]],'log_sha256':h(r/(name+'.txt')),'finished_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(r/(name+'.result.json')).write_text(json.dumps(out,indent=2));print(json.dumps(out))
