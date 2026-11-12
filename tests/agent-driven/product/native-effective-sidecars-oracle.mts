/** Isolated oracle: exact Git blobs in a VM; real pinned algorithms, virtual closed I/O only.
 * Run: node --experimental-vm-modules --import tsx <this-file> [--write]
 * No production import, Host, listener, browser, ffmpeg, provider or upstream mutable import. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';
import vm from 'node:vm';
const sha='e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3';
const repo='/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm';
const base='packages/openfilm/';
const names=['src/film-doc.mjs','studio/server/film-subtitle.mjs','studio/server/subtitle-segments.mjs','studio/server/transcripts.mjs','studio/server/captions.mjs'];
const sources=Object.fromEntries(names.map(name=>[base+name,execFileSync('git',['-C',repo,'show',sha+':'+base+name],{encoding:'utf8'})]));
const sourceHashes=Object.fromEntries(Object.entries(sources).map(([p,s])=>[p,createHash('sha256').update(s).digest('hex')]));
type Input={upstream_sha:string;files:Record<string,string|null>;directories:Record<string,string[]>;media:Record<string,{duration:number|null;audio:boolean}>};
async function oracle(input:Input){
 const context=vm.createContext({});const modules=new Map<string,vm.Module>();
 const synthetic=(id:string,exports:Record<string,unknown>)=>{let m=modules.get(id);if(!m){m=new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v]of Object.entries(exports))this.setExport(k,v);},{context,identifier:id});modules.set(id,m);}return m;};
 const denied=()=>{throw new Error('ORACLE_FORBIDDEN_IO');};
 const text=async(p:string)=>{if(!Object.hasOwn(input.files,p)||input.files[p]===null)throw new Error('ENOENT');return input.files[p];};
 async function load(id:string):Promise<vm.Module>{
  const previous=modules.get(id);if(previous)return previous;
  if(id==='node:path')return synthetic(id,{...posix});
  if(id==='node:fs/promises')return synthetic(id,{readFile:text,readdir:async(p:string)=>{if(!Object.hasOwn(input.directories,p))throw new Error('ORACLE_MISSING_DIRECTORY');return input.directories[p];},stat:denied,mkdir:denied});
  if(id.endsWith('/derived.mjs'))return synthetic(id,{probe:async(_root:string,p:string)=>{const f=input.media[p];if(!f)throw new Error('ORACLE_MISSING_PROBE');return {duration:f.duration??undefined,audio:f.audio};}});
  if(id.endsWith('/film.mjs'))return synthetic(id,{readProjectFilm:async()=>{const film=modules.get(base+'src/film-doc.mjs')!;return (film.namespace as any).readFilmFile(await text('film.html'));}});
  if(id.endsWith('/files.mjs'))return synthetic(id,{inProject:(_r:string,p:string)=>p,inside:denied,trashFile:denied});
  if(id.endsWith('/atomic.mjs'))return synthetic(id,{writeAtomic:denied});
  if(id.endsWith('/http.mjs'))return synthetic(id,{HttpError:Error,json:denied,readJson:denied});
  if(id.endsWith('/projects.mjs'))return synthetic(id,{TOOL_DIR:'.film'});
  if(id.endsWith('/subtitle-edits.mjs'))return synthetic(id,{subtitleEditRoutes:denied});
  if(!Object.hasOwn(sources,id))throw new Error('ORACLE_UNPINNED_IMPORT:'+id);
  const m=new vm.SourceTextModule(sources[id]!,{context,identifier:id});modules.set(id,m);
  await m.link((specifier,referencing)=>load(specifier.startsWith('node:')?specifier:posix.normalize(posix.join(posix.dirname(referencing.identifier),specifier))));return m;
 }
 const film=await load(base+'src/film-doc.mjs');await film.evaluate();
 const caption=await load(base+'studio/server/captions.mjs');await caption.evaluate();
 const style=modules.get(base+'studio/server/film-subtitle.mjs')!;
 const c=caption.namespace as any,s=style.namespace as any;
 const kept=await c.readSubtitleStyle('.');
 const result={style:{state:kept?'present':'absent',value:kept?s.parseFilmSubtitleStyle(kept):s.FILM_SUBTITLE_DEFAULT},captions:{state:'present',value:await c.filmCaptions('closed')}};
 return JSON.parse(JSON.stringify(result));
}
const vtt=(text:string)=>`WEBVTT\n\n00:00:00.000 --> 00:00:06.000\n${text}\n`;
const film=(clips:string,track='')=>`<html><head><meta name="viewport" content="width=1280, height=720"></head><body><section ${track}>${clips}</section></body></html>`;
const sound='<audio id="voice" src="assets/vo/a.wav#t=1,5" at="2" speed="2"></audio>';
function make(name:string,html:string,extra:Record<string,string|null>,media:Input['media']={'assets/vo/a.wav':{duration:6,audio:true}},unsupported?:string){
 const files={'film.html':html,'.film/subtitles.json':null,...extra};
 const dirs:Record<string,string[]>={};for(const p of [...Object.keys(files).filter(p=>files[p as keyof typeof files]!==null),...Object.keys(media)]){const d=posix.dirname(p);(dirs[d]??=[]).push(posix.basename(p));}
 for(const d of Object.keys(dirs))dirs[d]=[...new Set(dirs[d])];
 return {name,input:{upstream_sha:sha,files,directories:dirs,media},...(unsupported?{unsupported}:{})};
}
const cases=[
 make('absent-style-empty-film',film(''),{},{}),
 make('chinese-trim-offset-speed-translated',film(sound),{'assets/vo/a.vtt':vtt('<v 小林>你好，<00:00:01.000>今天<00:00:02.000>我们一起<00:00:03.000>学习中文，<00:00:04.000>非常开心。'),'assets/vo/a.en.vtt':vtt('Hello, today we learn Chinese together. Very happy.')}),
 make('latin-filler-false-start',film(sound),{'assets/vo/a.vtt':vtt('Um, th- the quick brown fox jumps over the lazy dog.')}),
 make('hand-cut-marks',film(sound),{'assets/vo/a.vtt':'WEBVTT\n\nNOTE Each cue is one subtitle, as cut by hand in OpenFilm Studio.\n\n00:00:00.000 --> 00:00:06.000\nOne <00:00:01.000>two <00:00:02.000>three <00:00:04.000>four\n'}),
 make('word-cues',film('<audio id="voice" src="assets/vo/a.wav#t=0,3"></audio>'),{'assets/vo/a.vtt':'WEBVTT\n\n00:00:00.000 --> 00:00:00.500\nHello\n\n00:00:00.500 --> 00:00:01.000\nworld\n\n00:00:01.000 --> 00:00:01.500\ntoday\n'}),
 make('missing-voice-transcript',film(sound),{'assets/vo/a.vtt':null}),
 make('malformed-vtt-native-untranscribed',film(sound),{'assets/vo/a.vtt':'WEBVTT\n\nnot a cue'}),
 make('outlasts-source',film(sound),{'assets/vo/a.vtt':vtt('A transcript that is longer than its source.')},{'assets/vo/a.wav':{duration:2,audio:true}}),
 make('native-style-clamps',film(''),{'.film/subtitles.json':JSON.stringify({font:{sizePct:999,weight:123},position:{x:-9,y:99},language:'zh'})},{}),
 make('malformed-style-refused',film(''),{'.film/subtitles.json':'{'},{},'STYLE_JSON_INVALID'),
 make('muted',film(sound,'muted'),{},{}),
 make('missing-video-transcript',film('<video id="v" src="assets/v.mp4#t=0,4"></video>'),{'assets/v.vtt':null},{'assets/v.mp4':{duration:4,audio:true}}),
 make('two-speakers',film('<audio id="a" src="assets/vo/a.wav#t=0,5"></audio><audio id="b" src="assets/vo/b.wav#t=0,5" at="6"></audio>'),{'assets/vo/a.vtt':vtt('<v Alice>Hello world.'),'assets/vo/b.vtt':vtt('<v Bob>Another voice.')},{'assets/vo/a.wav':{duration:6,audio:true},'assets/vo/b.wav':{duration:6,audio:true}}),
];
const vectors=[];for(const item of cases)vectors.push({...item,expected:await oracle(item.input)});
const output={upstream_sha:sha,source_hashes:sourceHashes,node:process.version,icu:process.versions.icu,oracle:'Exact Git blob modules in isolated VM; virtual readFile/readdir/probe and pinned readFilmFile; no production implementation imported',vectors};
const path='tests/agent-driven/product/fixtures/native-effective-sidecars.vectors.json';
if(process.argv.includes('--write'))writeFileSync(path,JSON.stringify(output,null,2)+'\n');
else {const old=JSON.parse(readFileSync(path,'utf8'));if(JSON.stringify(old.source_hashes)!==JSON.stringify(sourceHashes)||JSON.stringify(old.vectors)!==JSON.stringify(vectors))throw new Error('ORACLE_VECTOR_DRIFT');}
console.log(JSON.stringify({vectors:vectors.length,upstream:sha,source_hashes:sourceHashes,node:process.version,icu:process.versions.icu,status:'PASS'}));
