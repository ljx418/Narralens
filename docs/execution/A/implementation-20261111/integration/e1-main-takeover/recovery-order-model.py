"""Design-only exhaustive state model. Does not execute Host or certify RCV cases."""
import itertools,json,hashlib
from pathlib import Path
FAMILIES=('C','H','A')
def sweep(rows,states,family,blocked=()):
 for index,row in enumerate(rows):
  if row[0]!=family or states[index]!='pending':continue
  if any(states[j]=='pending' and other[1]==row[1] and (other[2],other[3])<(row[2],row[3]) for j,other in enumerate(rows)):continue
  if index not in blocked:states[index]='aborted'
def make(labels,equal=False,projects=1):
 return [(family,index%projects,0 if equal else index,'txn_'+str(index).zfill(8)) for index,family in enumerate(labels)]
def fixed(labels):
 rows=make(labels);states=['pending']*len(rows)
 for family in ('C','H','A','H','C'):sweep(rows,states,family)
 return states
def progress(rows,blocked=(),fake_count=False):
 states=['pending']*len(rows);passes=0
 while True:
  before=tuple(states);passes+=1
  for family in FAMILIES:
   if not fake_count:sweep(rows,states,family,blocked)
  pending=[i for i,state in enumerate(states) if state=='pending']
  if not pending or tuple(states)==before:return states,passes
  assert passes<=len(rows),'Actual monotone progress must terminate'
assert fixed('ACH')==['aborted','aborted','pending']
checks=0;max_passes=0
for size in range(1,8):
 for labels in itertools.product(FAMILIES,repeat=size):
  for equal,projects in ((False,1),(True,1),(True,2)):
   states,passes=progress(make(labels,equal,projects));assert 'pending' not in states
   assert passes<=size;checks+=1;max_passes=max(max_passes,passes)
long_cases=[]
for labels in ('ACH','HCA CH'.replace(' ',''),'ACH'*32):
 states,passes=progress(make(labels,True));assert 'pending' not in states;max_passes=max(max_passes,passes)
 long_cases.append({'length':len(labels),'passes':passes,'unresolved':states.count('pending')})
rows=make('ACH');states,passes=progress(rows,blocked=(0,));assert states==['pending']*3 and passes==1
states,passes=progress(rows,fake_count=True);assert states==['pending']*3 and passes==1
result={'scope':'DESIGN_MODEL_ONLY_NOT_BUSINESS_ACCEPTANCE','script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
 'fixed_pass_counterexample':{'chain':'A1-C2-H3','outcome':fixed('ACH')},'exhaustive_configurations':checks,'max_progress_passes_observed':max_passes,
 'longest_chain':96,'alternating_examples':long_cases,'blocked_oldest_stops_without_false_progress':True,'reported_counts_without_state_change_not_progress':True,
 'source_impl_scheduler':'NOT_IMPLEMENTED','all_RCV_D10_cases':'NOT_RUN'}
print(json.dumps(result,indent=2))
