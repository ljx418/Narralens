import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {validateImportedMedia} from '../assets/media-validator.js';
import {localMediaArgs} from '../render/media-process-policy.mjs';
import {asHostResourceError} from '../api-error.js';
import {ProductError} from '../creative/trusted-context.js';
const execute=promisify(execFile);
export interface LocalMediaFacts {
 readonly kind:'video'|'audio';
 readonly media_type:string;
 readonly extension:'mp4'|'wav'|'m4a'|'mp3'|'flac'|'ogg';
 readonly duration_frames:number;
 readonly duration_ms:number;
 readonly width:number|null;
 readonly height:number|null;
 readonly sample_rate:number|null;
 readonly channels:number|null;
 readonly codec:string;
}
async function tool(command:'ffprobe'|'ffmpeg',args:string[],signal?:AbortSignal):Promise<{stdout:string;stderr:string}>{
 try{return await execute(command,localMediaArgs(command,['-format_whitelist','mov,wav,mp3,flac,ogg',...args]),{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4*1024*1024,killSignal:'SIGKILL',...(signal?{signal}:{})});}
 catch(error){
  if(signal?.aborted)throw new ProductError('CAPABILITY_UNAVAILABLE','Media inspection was cancelled');
  if(asHostResourceError(error))throw new ProductError('HOST_RESOURCE_EXHAUSTED','Local media inspection could not complete');
  if(error&&typeof error==='object'&&'code' in error&&['ENOENT','EACCES','ENOEXEC','ETIMEDOUT'].includes(String(error.code)))throw new ProductError('CAPABILITY_UNAVAILABLE','Local media inspection tools are unavailable');
  throw new ProductError('INVALID_REQUEST','The local media could not be fully probed or decoded');
 }
}
/** Fixed local demuxer/protocol allowlists; no shell, provider, URL or command supplied by clients. */
export async function probeLocalMedia(path:string,kind:'video'|'audio',sha256:string,fps:{num:number;den:number},signal?:AbortSignal):Promise<LocalMediaFacts>{
 const rate=fps.num/fps.den;
 if(kind==='video'){
  let result:Awaited<ReturnType<typeof validateImportedMedia>>,codec:string|undefined;
  try{result=await validateImportedMedia(path,rate,sha256,{...(signal?{signal}:{}),execute:async(command,args,options)=>{
   const actual=[...args];if(command==='ffprobe'){const at=actual.indexOf('-show_entries');if(at>=0)actual[at+1]+=",codec_name";}
   const output=await tool(command==='ffprobe'?'ffprobe':'ffmpeg',actual,options.signal);
   if(command==='ffprobe'){
    const streams=(JSON.parse(output.stdout) as {streams?:Array<{codec_type?:string;codec_name?:string}>}).streams??[];
    if(streams.some(stream=>!['video','audio'].includes(String(stream.codec_type))))throw new ProductError('CAPABILITY_UNAVAILABLE','This media stream combination is not supported');
    codec=streams.find(stream=>stream.codec_type==='video')?.codec_name;
   }
   return output;
  }});}
  catch(error){
   if(error instanceof ProductError)throw error;
   if(asHostResourceError(error))throw new ProductError('HOST_RESOURCE_EXHAUSTED','Local video inspection could not complete');
   if(error&&typeof error==='object'&&'code' in error&&error.code==='INVALID_MEDIA')throw new ProductError('INVALID_REQUEST','The video does not satisfy the project media requirements');
   throw new ProductError('CAPABILITY_UNAVAILABLE','Local video inspection is unavailable');
  }
  if(!codec)throw new ProductError('INVALID_REQUEST','The video codec was not observed');
  const decoded=await tool('ffmpeg',['-nostdin','-hide_banner','-nostats','-v','error','-xerror','-err_detect','explode','-i',path,'-map','0:v','-map','0:a?','-f','null','-'],signal);
  if(decoded.stderr.trim())throw new ProductError('INVALID_REQUEST','The video or its audio stream failed strict decoding');
  const duration_ms=Math.ceil(result.durationFrames*fps.den*1000/fps.num);
  if(!Number.isSafeInteger(duration_ms)||duration_ms<1)throw new ProductError('INVALID_REQUEST','Media duration cannot be represented');
  return {kind,media_type:'video/mp4',extension:'mp4',duration_frames:result.durationFrames,duration_ms,width:result.width,height:result.height,sample_rate:null,channels:null,codec};
 }
 const probe=await tool('ffprobe',['-v','error','-show_entries','format=format_name:stream=codec_type,codec_name,sample_rate,channels,duration_ts,time_base','-of','json',path],signal);
 let parsed:{format?:{format_name?:unknown};streams?:Array<{codec_type?:unknown;codec_name?:unknown;sample_rate?:unknown;channels?:unknown;duration_ts?:unknown;time_base?:unknown}>};
 try{parsed=JSON.parse(probe.stdout) as typeof parsed;}catch{throw new ProductError('INVALID_REQUEST','Media tools returned malformed facts');}
 const streams=parsed.streams??[];
 if(streams.length!==1||streams[0]?.codec_type!=='audio')throw new ProductError('INVALID_REQUEST','A narration asset must have exactly one audio stream and no video');
 const stream=streams[0]!,sampleRate=Number(stream.sample_rate),channels=Number(stream.channels),duration=Number(stream.duration_ts),timeBase=typeof stream.time_base==='string'?/^(\d+)\/(\d+)$/.exec(stream.time_base):null;
 if(![sampleRate,channels,duration].every(n=>Number.isSafeInteger(n)&&n>0)||!timeBase||!timeBase.slice(1).every(v=>Number.isSafeInteger(Number(v))&&Number(v)>0)||typeof stream.codec_name!=='string')throw new ProductError('INVALID_REQUEST','The narration has no usable duration, sample rate or channel facts');
 const ceil=(numerator:bigint,denominator:bigint):number=>{
  const value=(numerator+denominator-1n)/denominator;
  if(value<1n||value>BigInt(Number.MAX_SAFE_INTEGER))throw new ProductError('INVALID_REQUEST','Narration duration exceeds the supported integer range');
  return Number(value);
 };
 const numerator=BigInt(duration)*BigInt(timeBase[1]!),denominator=BigInt(timeBase[2]!);
 const duration_ms=ceil(numerator*1000n,denominator);
 const duration_frames=ceil(numerator*BigInt(fps.num),denominator*BigInt(fps.den));
 const formats=String(parsed.format?.format_name??'').split(',');
 const extension=formats.includes('wav')?'wav':formats.includes('mov')?'m4a':formats.includes('mp3')?'mp3':formats.includes('flac')?'flac':formats.includes('ogg')?'ogg':null;
 if(!extension||duration_frames<1)throw new ProductError('INVALID_REQUEST','Narration is not in a supported local audio container');
 const decoded=await tool('ffmpeg',['-nostdin','-hide_banner','-nostats','-v','error','-xerror','-err_detect','explode','-i',path,'-map','0:a:0','-f','null','-'],signal);
 if(decoded.stderr.trim())throw new ProductError('INVALID_REQUEST','The audio failed strict decoding');
 const media_type=({wav:'audio/wav',m4a:'audio/mp4',mp3:'audio/mpeg',flac:'audio/flac',ogg:'audio/ogg'} as const)[extension];
 return {kind,media_type,extension,duration_frames,duration_ms,width:null,height:null,sample_rate:sampleRate,channels,codec:stream.codec_name};
}
