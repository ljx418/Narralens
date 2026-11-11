from pathlib import Path
import subprocess,re,hashlib,json
repo='/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm';sha='e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3'
def read(p):return subprocess.check_output(['git','-C',repo,'show',sha+':'+p]).decode()
base='packages/openfilm/'
paths=['src/film-doc.mjs','studio/server/film-subtitle.mjs','studio/server/subtitle-segments.mjs','studio/server/transcripts.mjs','studio/server/captions.mjs']
src={p:read(base+p) for p in paths}
def block(name,s,exports):
 s=re.sub(r'^export ', '',s,flags=re.M)
 return '\nconst '+name+' = (() => {\n'+s+'\nreturn {'+','.join(exports)+'};\n})();\n'
header='// @ts-nocheck -- vendored pinned JavaScript retained verbatim; public boundary types below.\n'
header+='/* '+read('LICENSE')+'\nPinned native algorithms; no runtime source loading or evaluation.\nUpstream '+sha+'\n'+json.dumps({p:hashlib.sha256(s.encode()).hexdigest() for p,s in src.items()},indent=2)+'\n*/\n'
header+="import { posix } from 'node:path';\n"
out=header
out+=block('NativeFilm',src[paths[0]],['readFilmFile','kindOf','clipKind','soundRole','clipSpan'])
out+=block('NativeStyle',src[paths[1]],['parseFilmSubtitleStyle','FILM_SUBTITLE_DEFAULT','filmSubtitleLanguageOf','filmSubtitleLanguagesIn'])
out+=block('NativeSegments',src[paths[2]],['segmentLine','alignTranslation','subtitleEnd'])
t=src[paths[3]]
tpure=t[t.index('export const CUT_NOTE'):t.index('/** @param {string} path */')]
tpure+=t[t.index('const CJK ='):t.index('/** Keep `src`')]
tpure+=t[t.index('const MAX_CELLS ='):]
out+=block('NativeTranscript','const {basename,dirname,extname} = posix;\n'+tpure,['transcriptPath','parseVtt','wordCues','linesOfWords'])
c=src[paths[4]]
cpure=c[c.index('export const MIN_CAPTION_MS'):c.index('/**\n * The clips that can be heard')]
cpure+=c[c.index('const OUTLAST_MS'):c.index('/**\n * The film\'s subtitles as film.html')]
out+=block('NativeCues','const {segmentLine,alignTranslation,subtitleEnd}=NativeSegments;\n'+cpure,['clipCues','transcriptOutlasts'])
# Retain full pinned async caption orchestration and transcript-read/listing algorithms in the input adapter.
body=c[c.index('function heardClips'):c.index('/** How far past')]
body+=c[c.index('export async function filmCaptions'):c.index('/** Whether `src`\'s transcript outlasts')]
body+=t[t.index('export async function readTranscript'):t.index('const CJK =')]
body+=t[t.index('export async function translationsOf'):t.index('/**\n * The person\'s change')]
body=re.sub(r'^export ', '',body,flags=re.M)
Path('src/host/m5/native-effective-sidecars.ts').write_text(out+'\n// CLOSED_ADAPTER_START\n'+Path('docs/parallel/lane-product/A-R2-20261112/sidecars-wrapper.txt').read_text().replace('/* PINNED_ASYNC_CONSUMERS */',body))
