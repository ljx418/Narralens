import sys,subprocess,json,hashlib,datetime
from pathlib import Path
r=Path(__file__).resolve().parent
name=sys.argv[1];cmd=sys.argv[2:]
def inputs():
 suffixes={'.ts','.tsx','.js','.mjs','.cjs','.json','.py','.html','.css','.sql','.sh'}
 found={p for prefix in ['src','contracts','tests','tools','docs/parallel/lane-bridge/A-R2-20261112']
        for p in Path(prefix).rglob('*') if p.is_file() and p.suffix in suffixes}
 found.update(p for name in ['package.json','pnpm-lock.yaml','tsconfig.json','vitest.config.ts'] if (p:=Path(name)).is_file())
 found.add(Path(__file__).relative_to(Path.cwd()))
 return sorted(found)
files=inputs()
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
before={str(p):h(p) for p in files}
(r/(name+'.inputs.json')).write_text(json.dumps(before,indent=2))
(r/(name+'.cmd.json')).write_text(json.dumps({'argv':cmd,'cwd':str(Path.cwd()),'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'runner_version':2,'git_head':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
 'input_scope':'source/contracts/test/tool text, config/lock, D09 vectors and this runner; upstream pin and binary fixture receipts remain separate'},indent=2))
with (r/(name+'.txt')).open('w') as log:
 result=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT)
(r/(name+'.exit')).write_text(str(result.returncode)+'\n')
out={'exit':result.returncode,'source_changed':[str(p) for p in files if not p.exists() or h(p)!=before[str(p)]],
 'source_added':[str(p) for p in inputs() if str(p) not in before],
 'log_sha256':h(r/(name+'.txt')),'finished_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(r/(name+'.result.json')).write_text(json.dumps(out,indent=2));print(json.dumps(out))
