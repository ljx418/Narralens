"""Evidence-capture harness checks only; never a business gate."""
import subprocess,sys,json,hashlib
from pathlib import Path
r=Path(__file__).resolve().parent
cmd=[sys.executable,str(r/'run-recorded.py'),'runner-v3-exit7',sys.executable,'-c','raise SystemExit(7)']
first=subprocess.run(cmd,capture_output=True,text=True)
assert first.returncode==7,(first.returncode,first.stderr)
files=sorted(r.glob('runner-v3-exit7.*'))
before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
assert json.loads((r/'runner-v3-exit7.result.json').read_text())['exit']==7
second=subprocess.run(cmd,capture_output=True,text=True)
assert second.returncode!=0 and 'CAPTURE_NAME_ALREADY_EXISTS' in second.stderr
assert before=={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
with (r/'runner-v3-self-check.json').open('x') as out:
 json.dump({'scope':'HARNESS_ONLY_NOT_BUSINESS_ACCEPTANCE','argv':cmd,'actual_first_exit':first.returncode,'actual_duplicate_exit':second.returncode,
 'duplicate_stderr':second.stderr,'preserved_hashes':before,'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},out,indent=2)
print('Harness exit propagation and duplicate capture refusal PASS (not business acceptance)')
