import sys, os, json, hashlib, time, datetime, subprocess
from pathlib import Path
P=Path(__file__).resolve().parent
W=Path('/mnt/c/workspace/videoworkline/Narralens-agents/main-integration')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(p,data): p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
mode=sys.argv[1]
assert mode in ('normal','assertion-failure')
release=json.loads((P/('RELEASE_'+('NORMAL' if mode=='normal' else 'FAULT')+'.json')).read_text())
assert release['mode']==mode and release['runtime_release'] is True
assert sha(Path(__file__).resolve())==release['observer_sha256']
for f,h in release['source651'].items(): assert sha(W/f)==h,f
for f,h in release['protected7'].items(): assert sha(W/f)==h,f
for f,v in release['binaries'].items(): assert sha(Path(f))==v['sha256'],f
assert not subprocess.check_output(['git','diff','--cached','--name-only'],cwd=W,text=True).strip()
E=W/release['recorder']; name=release['capture']; assert sha(E)==release['recorder_sha256']
assert not (E.parent/(name+'.claim.json')).exists()
case=P/release['case_directory'];case.mkdir(exist_ok=True)
base=W/'var/native-cache-positive-pilot'
before=sorted(str(x.resolve()) for x in base.iterdir()) if base.exists() else []
def stat(pid):
 try:
  raw=Path('/proc')/str(pid);txt=(raw/'stat').read_text();i=txt.rfind(')');tail=txt[i+2:].split()
  return {'pid':int(txt[:txt.index('(')].strip()),'ppid':int(tail[1]),'pgid':int(tail[2]),'sid':int(tail[3]),'start_ticks':int(tail[19]),'state':tail[0]}
 except (FileNotFoundError,ProcessLookupError):return None
 except (OSError,ValueError,IndexError):return {'pid':int(pid),'unknown':True}
def census():
 rows={}
 for f in Path('/proc').iterdir():
  if f.name.isdigit():
   v=stat(int(f.name))
   if v is not None:rows[int(f.name)]=v
 return rows
# Pre-existing matching helpers are not owned by this ticket.
prior=[]
for pid,v in census().items():
 try:
  cmd=(Path('/proc')/str(pid)/'cmdline').read_bytes()
  if str(W).encode() in cmd and (b'cache-process-custodian.py' in cmd or b'cache-worker-fixture.mjs' in cmd):prior.append(v)
 except OSError:pass
assert not prior,('PREEXISTING_TARGET_NOT_OWNED',prior)
save(case/'PRESTART.json',{'at':now(),'argv':release['argv'],'source_binding':sha(P/'INPUT_BINDING.json'),'runtime_roots_before':before,'preexisting_targets':prior})
child=subprocess.Popen([sys.executable,str(E),name,*release['argv']],cwd=W,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
known={};last={};events=[];count=0;truncated=False
recorder_stat=stat(child.pid);save(case/'LAUNCH.json',{'at':now(),'recorder_pid':child.pid,'recorder_identity':recorder_stat,'observer_pid':os.getpid(),'argv':release['argv']})
while child.poll() is None:
 rows=census();selected={child.pid};changed=True
 while changed:
  changed=False
  for pid,v in rows.items():
   if not v.get('unknown') and v['ppid'] in selected and pid not in selected:selected.add(pid);changed=True
 for pid in selected:
  v=rows.get(pid)
  if not v or v.get('unknown'):continue
  key=str(pid)+':'+str(v['start_ticks'])
  if key not in known:
   try:cmd=(Path('/proc')/str(pid)/'cmdline').read_bytes()
   except OSError:cmd=b''
   role='pipeline'
   if str(W/'src/adapters/openfilm/cache-process-custodian.py').encode() in cmd:role='C'
   if b'cache-worker-fixture.mjs' in cmd:role='N'
   known[key]={**v,'role':role,'first_seen_at':now(),'cmdline_sha256':hashlib.sha256(cmd).hexdigest()}
  signature=(v['ppid'],v['pgid'],v['sid'],v['state'])
  if last.get(key)!=signature:
   if len(events)<4096:events.append({'at':now(),'identity':v,'role':known[key]['role']})
   else:truncated=True
   last[key]=signature
 count+=1
 if count%50==0:save(case/'LIVE.json',{'at':now(),'recorder_pid':child.pid,'samples':count,'roles':list(known.values()),'events_truncated':truncated})
 time.sleep(.01)
out,err=child.communicate()
save(case/'OBSERVER.json',{'at':now(),'outer_wait_returncode':child.returncode,'recorder_identity':recorder_stat,'samples':count,'observed':list(known.values()),'state_changes':events,'events_truncated':truncated,'recorder_stdout':out.decode(errors='replace'),'recorder_stderr':err.decode(errors='replace'),'destructive_signals_sent':[],'scope':'Own recorder descendant observation only; not a raw protocol transcript'})
res=json.loads((E.parent/(name+'.result.json')).read_text());cmd=json.loads((E.parent/(name+'.cmd.json')).read_text())
assert cmd['argv']==release['argv'] and cmd['cwd']==str(W)
assert res['exit']==child.returncode==int((E.parent/(name+'.exit')).read_text())
assert not res['source_changed'] and not res['source_added']
assert sha(E.parent/(name+'.txt'))==res['log_sha256']
for f,h in release['source651'].items(): assert sha(W/f)==h,f
for f,v in release['binaries'].items(): assert sha(Path(f))==v['sha256'],f
roots=sorted(str(x.resolve()) for x in base.iterdir()) if base.exists() else []
new=[Path(x) for x in roots if x not in before]
save(case/'POST_COMMAND.json',{'at':now(),'actual_outer_exit':child.returncode,'capture_result':res,'new_runtime_roots':[str(x) for x in new],'source651_unchanged':True,'binary_pins_unchanged':True})
try:
 assert len(new)==1,('NEW_ROOT_COUNT',new)
 root=new[0];assert root.parent==base.resolve() and root.is_dir()
 for file in ['candidate.json','manifest.json','final.json']:assert (root/file).is_file(),file
 candidate=json.loads((root/'candidate.json').read_text());manifest=json.loads((root/'manifest.json').read_text());final=json.loads((root/'final.json').read_text())
 identities={role:snap[key] for role,key in [('C','custodian'),('N','worker')]}
 terminal={};groups={};observed_birth={}
 for role,v in identities.items():
  assert isinstance(v,dict) and v['pid']>0 and v['pgid']>0
  rows=[x for x in known.values() if x['role']==role and x['pid']==v['pid'] and x['start_ticks']==v['start_ticks'] and x['pgid']==v['pgid'] and x['sid']==v['sid']]
  observed_birth[role]=rows
  assert rows,('NO_INDEPENDENT_ALIVE_OBSERVATION',role)
  current=stat(v['pid']);terminal[role]={'original':v,'current':current,'at':now()}
  assert current is None or (not current.get('unknown') and current['start_ticks']!=v['start_ticks']),('TARGET_EPOCH_REMAINS',role,current)
  # Only signal 0 on the original group documented by this own run; never destructive.
  try:os.killpg(v['pgid'],0);groups[role]='EXISTS'
  except ProcessLookupError:groups[role]='ESRCH'
  except OSError as x:groups[role]={'errno':x.errno}
  assert groups[role]=='ESRCH',('ORIGINAL_GROUP_NOT_GONE',role,groups[role])
 save(case/'INDEPENDENT_TERMINAL.json',{'at':now(),'terminal':terminal,'groups':groups,'alive':observed_birth})
 # Independent byte-chain validation. Do not infer the future OS exit from JSON.
 assert final['kind']=='positive-pilot-final' and final['authoritative'] is True
 assert final['publication_protocol']=='positive-pilot-publication-v2'
 assert final['mode']==candidate['mode']==mode and final['root']==candidate['root']==manifest['root']==str(root)
 for file,prefix in [('candidate.json','candidate'),('manifest.json','manifest')]:
  assert final[prefix+'_sha256']==sha(root/file)
  assert final[prefix+'_bytes']==(root/file).stat().st_size
 assert manifest['listing_error'] is None
 seen=set()
 for row in manifest['artifacts']:
  name2=row['name'];assert name2 not in seen and Path(name2).name==name2 and name2 not in ('.','..','manifest.json','final.json');seen.add(name2)
  assert row['error'] is None and len(row['digest'])==64
  assert sha(root/name2)==row['digest'] and (root/name2).stat().st_size==row['bytes']
 assert {'candidate.json','cache-worker-fixture.mjs'}<=seen
 assert final['reporting_failure'] is None and final['manifest_error'] is None
 for key in ['cleanup_facts','reporting_failures','evidence_errors','evidence_problems']: assert final[key]==[],key
 assert final['terminal_proof'] is candidate['terminal_proof'] is True
 snap=final['diagnostic_snapshot'];assert snap['cleanup_failures']==0 and snap['cleanup_facts']==[] and snap['transport_failure'] is None
 assert snap['terminal_proof']['proven'] is True
 assert final['terminal_proof_observations']==candidate['terminal_proof_observations']==snap['terminal_proof']
 assert candidate['receipt_summary']==snap['receipt_summary'] and candidate['accumulator_summary']==snap['accumulator_summary']
 assert candidate['raw_segments_saved'] is False
 if mode=='normal':
  assert child.returncode==final['exit_code']==0 and final['kind_of_run']=='ok' and final['fault_case_passed'] is False
  assert final['picture_bytes']==1024 and final['picture_sha256']==hashlib.sha256(bytes([0x4a])*1024).hexdigest() and final['picture_is_the_exact_one'] is True
  assert final['original_failure'] is None and final['settlement_failure'] is None
  assert snap['latched_outcome']['kind']!='failure'
 else:
  assert child.returncode==final['exit_code']==1 and final['kind_of_run']=='fault-observed' and final['fault_case_passed'] is True
  assert final['original_failure']['code']=='EXPECTED_ASSERTION_FAILURE'
  assert final['picture_bytes'] is None and final['picture_sha256'] is None and final['picture_is_the_exact_one'] is False
  assert snap['cancel_provenance']['accepted_as_primary'] is True and snap['cancel_provenance']['superseded_by_earlier_failure'] is False
  assert snap['latched_outcome']['code']=='DRAW_CANCELLED'
  assert snap['cancel_provenance']['error_code']==final['original_failure']['code']
  assert candidate['original_failure']==final['original_failure'] and candidate['settlement_failure']==final['settlement_failure']
  artifacts={file.name:{'sha256':sha(file),'bytes':file.stat().st_size} for file in root.iterdir() if file.is_file()}
 # Missing an alive observation is disclosed instead of manufactured; main decides its evidence scope.
 artifacts={file.name:{'sha256':sha(file),'bytes':file.stat().st_size} for file in root.iterdir() if file.is_file()}
 save(case/'EXTERNAL_ACCEPTANCE.json',{'at':now(),'verdict':'BYTE_CHAIN_AND_OUTER_EXIT_AND_FRESH_TERMINAL_PASSED','mode':mode,'actual_outer_exit':child.returncode,'runtime_root':str(root),'artifacts':artifacts,'independent_terminal':terminal,'independent_original_group_probes':groups,'independent_alive_observations':observed_birth,'all_original_roles_seen_alive':all(observed_birth.values()),'source651_unchanged':True,'scope':'Minimal synthetic protocol only; not video/Chrome/N1N2/full acceptance; actual same-Error/cause checked inside reviewed CLI, not reconstructed from JSON'})
 print(json.dumps({'mode':mode,'outer_exit':child.returncode,'runtime_root':str(root),'verdict':'MINIMAL_CASE_COMPLETED_REQUIRES_MAIN_SCOPE_REVIEW','all_roles_seen_alive':all(observed_birth.values())}))
except BaseException as error:
 save(case/'FAILED_ACCEPTANCE.json',{'at':now(),'verdict':'FAILED','actual_outer_exit':child.returncode,'error_type':type(error).__name__,'error':str(error),'new_runtime_roots':[str(x) for x in new],'terminal_evidence':str(case/'INDEPENDENT_TERMINAL.json'),'source651_unchanged':True,'scope':'Failure preserved; not a passing acceptance'})
 raise
