#!/usr/bin/env python3
"""Literal expected math fixtures. Does NOT run native functions, build, JS or media probes."""
import copy,hashlib,json,pathlib
here=pathlib.Path(__file__).resolve().parent
sha=lambda label:hashlib.sha256(('LITERAL-ONLY:'+label).encode()).hexdigest()
def file(path,present):return {'relative_path':path,'state':'present' if present else 'absent','sha256':sha(path) if present else None}
def fixture(doc,settings,markers,*,settings_present=True,facts=None,listing=None):
 clips=[c for t in doc['tracks'] for c in t['clips']];entries=[{'relative_path':'film.html','sha256':sha('film.html')}]
 for p,yes in [('.film/settings.json',settings_present),('.film/markers.json',bool(markers))]:
  if yes:entries.append({'relative_path':p,'sha256':sha(p)})
 sources=[]
 for c in clips:
  if c['src'] not in sources:sources.append(c['src'])
 for f in facts or []:
  if f['source_ref'] not in sources:sources.append(f['source_ref'])
 entries += [{'relative_path':p,'sha256':sha(p)} for p in sources]
 return {'format':'narralens.native-expected-input@1','upstream_sha':'e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3','profile':'narralens.native-expected-numeric@1','binding':{'project_id':'literal-project','project_revision':1,'snapshot_id':sha('snapshot'),'source_digest':sha('source'),'film_sha256':sha('film.html')},'provenance':{'origin':'host_independent','source_manifest_digest':sha('source-manifest'),'rights_digest':sha('rights') if any(f['origin']=='host_actual_probe' for f in facts or []) else None,'media_catalog_digest':sha('catalog') if any(f['origin']=='host_actual_probe' for f in facts or []) else None,'listing_digest':sha('listing')},'ui_profile':{'pending_drops':'excluded','preview_error':'excluded','live_height':'excluded','browser_preferences':'excluded'},'source_entries':entries,'film':{'file':file('film.html',True),'value':doc},'settings':{'file':file('.film/settings.json',settings_present),'value':settings},'markers':{'file':file('.film/markers.json',bool(markers)),'value':markers},'clip_refs':[{'clip_id':c['id'],'source_ref':c['src'],'source_sha256':sha(c['src']),'provenance':({'kind':'controlled_source_artifact','artifact_ref':{'id':'literal-artifact:'+c['id'],'version':1,'sha256':sha('artifact:'+c['id'])},'producer_digest':sha('controlled-page-writer'),'producer_receipt_digest':sha('receipt:'+c['src'])} if c['src'].endswith('.html') else {'kind':'registered_asset','asset_id':'literal-asset:'+c['src'],'rights_digest':sha('rights:'+c['src'])})} for c in clips],'media_facts':facts or [],'video_files_in_native_order':listing or [],'span_facts':{'profile':'numeric_source_only','origin':'not_used','proof_digest':None,'values':[]}}
def media(src,duration,fps=None,origin='host_actual_probe'):
 return {'source_ref':src,'source_sha256':sha(src),'origin':origin,'proof_digest':sha('probe:'+src),'duration_ms':duration,'has_audio':False,'fps':fps}
def clip(id,src,at,time,speed=None):
 out={'id':id,'src':src,'at':at,'time':time}
 if speed is not None:out['speed']=speed
 return out
def doc(tracks):return {'stage':{'w':1920,'h':1080},'tracks':[{'clips':x} for x in tracks]}
def expected(settings,fps,heights,names=None,placed=None):
 out={'settings':{'settings':settings,'resolved_fps':fps,'fps_source':'project' if 'fps' in settings else 'footage_or_default','track_names':names or [],'track_heights':heights},'markers':{'placed':placed or []}}
 parts={}
 for part,value in out.items():
  envelope={'format':'narralens.native-hydration-effective@1','part':part,'value':value};text=json.dumps(envelope,sort_keys=True,separators=(',',':'),ensure_ascii=False);parts[part]={'value':value,'canonical_utf8':text,'sha256':hashlib.sha256(text.encode()).hexdigest()}
 return {'status':'computed','parts':parts}
positive=[]
i=fixture(doc([]),{},[],settings_present=False)
positive.append({'id':'initial-empty','input':i,'literal_expected':expected({},30,[])})
concept=fixture(doc([[clip('concept-1','scenes/concept.html',0,[0,3])]]),{},[],settings_present=False,facts=[media('scenes/concept.html',None,None,'host_deterministic_source')])
positive.append({'id':'controlled-concept-page-no-asset-registry-rights','input':concept,'literal_expected':expected({},30,[{'lane':'doc-0','doc_index':0,'index':1,'height':68}])})
s={'fps':30,'trackNames':[{'name':'场景','index':0,'clips':['scene-1']},{'name':'画面','index':1,'clips':['video-1']},{'name':'旁白','index':2,'clips':['voice-1']}],'trackHeights':[{'height':80,'index':0,'clips':['scene-1']}]}
m=[{'id':'cut','t':2,'name':'接镜','color':'blue'},{'id':'in-video','t':1,'clip':'video-1','color':'green'}]
i=fixture(doc([[clip('scene-1','scenes/page.html',0,[0,2])],[clip('video-1','assets/video.mp4',2,[0,3])],[clip('voice-1','assets/voice.wav',0,[0,5])]]),s,m,facts=[media('scenes/page.html',4000,None,'host_deterministic_source'),media('assets/video.mp4',5000,30),media('assets/voice.wav',6000)],listing=['assets/video.mp4'])
positive.append({'id':'simple-page-video-audio','input':i,'literal_expected':expected(s,30,[{'lane':'doc-0','doc_index':0,'index':1,'height':80},{'lane':'doc-1','doc_index':1,'index':1,'height':68},{'lane':'doc-2','doc_index':2,'index':1,'height':44}],names=[{'doc_index':0,'name':'场景'},{'doc_index':1,'name':'画面'},{'doc_index':2,'name':'旁白'}],placed=[{'marker':m[0],'ms':2000,'clip_id':None},{'marker':m[1],'ms':3000,'clip_id':'video-1'}])})
s={'fps':30,'trackNames':[{'name':'双画面','index':0,'clips':['video-a','video-b']}],'trackHeights':[{'height':90,'index':0,'clips':['video-a','video-b']}]}
m=[{'id':'on-a','t':1,'clip':'video-a','color':'blue'},{'id':'on-b','t':1,'clip':'video-b','color':'green'}]
i=fixture(doc([[clip('video-a','assets/video-a.mp4',0,[0,3]),clip('video-b','assets/video-b.mp4',1,[0,3])]]),s,m,facts=[media('assets/video-a.mp4',5000,30),media('assets/video-b.mp4',5000,30)],listing=['assets/video-a.mp4','assets/video-b.mp4'])
positive.append({'id':'actual-overlap-two-native-rows','input':i,'literal_expected':expected(s,30,[{'lane':'doc-0','doc_index':0,'index':1,'height':90},{'lane':'doc-0#2','doc_index':0,'index':2,'height':90}],names=[{'doc_index':0,'name':'双画面'}],placed=[{'marker':m[0],'ms':1000,'clip_id':'video-a'},{'marker':m[1],'ms':2000,'clip_id':'video-b'}])})
m=[{'id':'start','t':1,'clip':'voice','color':'blue'},{'id':'end','t':5,'clip':'voice','color':'blue'},{'id':'outside','t':5.01,'clip':'voice','color':'blue'}]
i=fixture(doc([[clip('voice','assets/voice.wav',2,[1,5],2)]]),{},m,settings_present=False,facts=[media('assets/voice.wav',6000)])
positive.append({'id':'marker-trim-speed-inclusive-end','input':i,'literal_expected':expected({},30,[{'lane':'doc-0','doc_index':0,'index':1,'height':44}],placed=[{'marker':m[0],'ms':2000,'clip_id':'voice'},{'marker':m[1],'ms':4000,'clip_id':'voice'}])})
i=fixture(doc([]),{},[],settings_present=False,facts=[media('assets/unreferenced.mp4',5000,25)],listing=['assets/unreferenced.mp4'])
positive.append({'id':'empty-with-listed-footage-fps','input':i,'literal_expected':expected({},25,[])})
attested=copy.deepcopy(positive[2]['input'])
attested['span_facts']={'profile':'host_attested','origin':'host_independent','proof_digest':sha('independent-span-facts'),'values':[
 {'id':'scene-1','src':'scenes/page.html','at':0,'end':2,'native':4,'w':1920,'h':1080},
 {'id':'video-1','src':'assets/video.mp4','at':2,'end':5,'native':5,'w':1280,'h':720},
 {'id':'voice-1','src':'assets/voice.wav','at':0,'end':5,'native':6}]}
positive.append({'id':'independent-attested-spans-numeric-consistent','input':attested,'literal_expected':copy.deepcopy(positive[2]['literal_expected'])})
negative=[]
def bad(id,base,change,reason):
 x=copy.deepcopy(base);change(x);negative.append({'id':id,'input':x,'literal_expected':{'status':'unsupported','reason':reason}})
base=positive[2]['input']
bad('missing-clip-ref',base,lambda x:x['clip_refs'].clear(),'CLIP_REFERENCE_MISMATCH')
bad('live-height-excluded-profile-violated',base,lambda x:x['ui_profile'].update(live_height='active'),'UI_PROFILE_UNSUPPORTED')
bad('ui-observed-provenance',base,lambda x:x['provenance'].update(origin='ui_observed'),'UNPROVEN_FACTS')
bad('video-probe-fps-unknown',base,lambda x:x['media_facts'][1].update(fps=None),'INCOMPLETE_PROBE_FACTS')
bad('string-placement',base,lambda x:x['film']['value']['tracks'][0]['clips'][0].update(at='previous.end'),'NON_NUMERIC_CLIP_UNSUPPORTED')
bad('observed-row-backfill-field',base,lambda x:x.update(observed_rows=[]),'INPUT_INVALID')
bad('clip-source-digest-mismatch',base,lambda x:x['clip_refs'][0].update(source_sha256='0'*64),'CLIP_REFERENCE_MISMATCH')
bad('ui-observed-span-facts',attested,lambda x:x['span_facts'].update(origin='ui_observed'),'SPAN_FACTS_UNSUPPORTED')
(here/'literal-vectors.json').write_text(json.dumps({'scope':'LITERAL ONLY, NOT EXECUTED. Digests are hashes of fixture labels, not actual source/media/rights/probe evidence. Must never be used as production facts.','native_functions_executed':False,'build':'NOT_RUN','vectors':positive+negative},indent=2,ensure_ascii=False)+'\n');print(json.dumps({'literal_positive':len(positive),'literal_negative':len(negative),'native_execution':'NOT_RUN'}))
