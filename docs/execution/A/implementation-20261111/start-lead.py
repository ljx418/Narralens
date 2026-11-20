from pathlib import Path
import subprocess,json,sys
lane=sys.argv[1];assert lane in ('bridge','product','media')
b=Path(__file__).resolve().parent
w=json.loads((b/f'placement/{lane}-create.json').read_text())['result']['worktree']
args=['orca-ide','orchestration','worker-start','--run','run_399f9dd3ce5a','--spec-file','C:\\workSpace\\videoWorkLine\\Narralens\\docs\\execution\\A\\implementation-20261111\\specs\\'+lane+'-r1-lead.txt','--worktree','id:'+w['id'],'--agent','codex','--keep-open','--task-title','Narralens A R1｜'+lane.upper()+' Codex 负责人','--json']
r=subprocess.run(args,capture_output=True,text=True)
(b/f'placement/{lane}-lead-launch.json').write_text(r.stdout)
print(r.stdout,flush=True);print(r.stderr,flush=True);sys.exit(r.returncode)
