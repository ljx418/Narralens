from pathlib import Path
import subprocess,json,sys
b=Path(__file__).resolve().parent;lane=sys.argv[1];assert lane in ('bridge','product','media')
old=json.loads((b/f'placement/{lane}-lead-launch.json').read_text())['result'];assert old['state']=='failed' and old['failedStage']=='agent_readiness' and 'agent-trust-workspace' in old['lastError']
args=['orca-ide','orchestration','worker-start','--run','run_399f9dd3ce5a','--task',old['taskId'],'--retry-of',old['dispatchId'],'--worktree','id:'+old['workspace'],'--terminal',old['terminal'],'--keep-open','--json']
r=subprocess.run(args,capture_output=True,text=True);(b/f'placement/{lane}-lead-retry1.json').write_text(r.stdout);print(r.stdout,flush=True);print(r.stderr,flush=True);sys.exit(r.returncode)
