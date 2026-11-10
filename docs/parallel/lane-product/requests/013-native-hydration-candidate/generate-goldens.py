#!/usr/bin/env python3
"""Source-contract hash inputs only, not a native hydration/runtime test."""
import copy,hashlib,json,pathlib
here=pathlib.Path(__file__).resolve().parent
style={'on':True,'pos':{'x':0.5,'y':0.94},'maxWidthPct':100,'align':'center','font':{'family':'ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif','sizePct':4,'weight':500,'italic':False,'letterSpacingEm':0.04,'lineHeight':1.45,'upper':False},'fill':'#ffffff','stroke':{'widthEm':0.055,'color':'rgba(0,0,0,0.84)'},'shadow':{'dxEm':0,'dyEm':0.05,'blurEm':0.22,'color':'rgba(0,0,0,0.72)'},'box':None,'karaoke':None,'language':None,'bilingual':False}
values={'settings':{'settings':{},'resolved_fps':30,'fps_source':'footage_or_default','track_names':[],'track_heights':[]},'subtitle_style':style,'captions':{'cues':[{'startMs':0,'durMs':1000,'text':'第一章','clip':'voice-1','src':'assets/voice.wav','line':0,'part':0}],'sourceLanguage':'zh','languages':[],'untranscribed':[]},'markers':{'placed':[{'marker':{'id':'marker-1','t':1,'name':'首章','color':'blue'},'ms':1000,'clip_id':None}]}}
rows=[]
for part,value in values.items():
 for changed in [False,True]:
  v=copy.deepcopy(value)
  if changed:
   if part=='settings':v['resolved_fps']=25
   elif part=='subtitle_style':v['on']=False
   elif part=='captions':v['cues'][0]['text']='第二章'
   else:v['placed'][0]['ms']=1100
  envelope={'format':'narralens.native-hydration-effective@1','part':part,'value':v};canonical=json.dumps(envelope,sort_keys=True,separators=(',',':'),ensure_ascii=False)
  rows.append({'id':part+('-single-field-change' if changed else '-base'),'envelope':envelope,'canonical_utf8':canonical,'sha256':hashlib.sha256(canonical.encode('utf-8')).hexdigest(),'relation':'must_differ_from_base' if changed else 'base'})
(here/'effective-goldens.json').write_text(json.dumps({'scope':'Literal source-contract hash vectors, not browser/parser/hydration PASS','format':'narralens.native-hydration-effective@1','upstream_sha':'e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3','canonical':'UTF8 JSON sorted object keys/no whitespace; array order retained; no trim/translation; finite JSON values only; undefined object members omitted by JS implementation','vectors':rows},indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'literal_vectors':len(rows),'runtime_test':'NOT_RUN'}))
