import {describe,it,expect} from 'vitest';
import {computeNativeEffectiveSidecars, type NativeSidecarInputs} from '../../../src/host/m5/native-effective-sidecars.js';
import fixtures from './fixtures/native-effective-sidecars.vectors.json';
const input=(index:number)=>structuredClone(fixtures.vectors[index]!.input) as NativeSidecarInputs;
describe('pinned native effective sidecars, pure independent inputs',()=>{
 for(const vector of fixtures.vectors)it(vector.name,async()=>{
  const before=JSON.stringify(vector.input);
  const result=await computeNativeEffectiveSidecars(vector.input as NativeSidecarInputs);
  if('unsupported' in vector)expect(result).toMatchObject({status:'unsupported',reason:vector.unsupported});
  else {expect(result.status).toBe('computed');if(result.status==='computed'){expect(result.style).toEqual(vector.expected.style);expect(result.captions).toEqual(vector.expected.captions);}}
  expect(JSON.stringify(vector.input)).toBe(before);
 });
 it('oracle has real Chinese timing, translations and speaker behavior',()=>{
  const c=fixtures.vectors[1]!.expected.captions.value;
  expect(c.cues.length).toBeGreaterThan(0);expect(c.sourceLanguage).toBeTruthy();expect(c.languages).toContain('en');
  expect(c.cues[0]!.startMs).toBeGreaterThanOrEqual(2000);
  expect(fixtures.vectors[12]!.expected.captions.value.cues.some(c=>'speaker'in c)).toBe(true);
 });
 it('unknown sidecar is not absent',async()=>{const i=input(0);delete (i.files as Record<string,unknown>)['.film/subtitles.json'];expect(await computeNativeEffectiveSidecars(i)).toMatchObject({status:'unsupported',reason:'DEPENDENCY_INPUT_MISSING',missing:['.film/subtitles.json']});});
 it('missing directory cannot drop translations',async()=>{const i=input(1);delete (i.directories as Record<string,unknown>)['assets/vo'];expect(await computeNativeEffectiveSidecars(i)).toMatchObject({status:'unsupported',missing:['directory:assets/vo']});});
 it('missing media cannot silently become unknown duration',async()=>{const i=input(1);delete (i.media as Record<string,unknown>)['assets/vo/a.wav'];expect(await computeNativeEffectiveSidecars(i)).toMatchObject({status:'unsupported',missing:['media:assets/vo/a.wav']});});
 it('new translation listed but bytes not supplied refuses',async()=>{const i=input(1);(i.directories['assets/vo'] as string[]).push('a.fr.vtt');expect(await computeNativeEffectiveSidecars(i)).toMatchObject({status:'unsupported',missing:['assets/vo/a.fr.vtt']});});
 it('closed negative reads and consumed/listing facts are returned',async()=>{const result=await computeNativeEffectiveSidecars(input(1));expect(result.consumed_paths).toContain('assets/vo/a.en.vtt');expect(result.negative_lookups).toContain('.film/subtitles.json');expect(result.directory_lookups).toContain('assets/vo');expect(result.media_lookups).toContain('assets/vo/a.wav');});
 it('listing and negative read conflict refuses',async()=>{const i=input(1);(i.files as Record<string,unknown>)['assets/vo/a.en.vtt']=null;expect(await computeNativeEffectiveSidecars(i)).toMatchObject({status:'unsupported',reason:'DIRECTORY_FILE_CONFLICT'});});
 it('bad film never becomes empty captions',async()=>{const i=input(0);(i.files as Record<string,unknown>)['film.html']='<script>alert(1)</script>';expect(await computeNativeEffectiveSidecars(i)).toMatchObject({status:'unsupported',reason:'FILM_INVALID'});});
 it('external source is unsupported',async()=>{const i=input(0);(i.files as Record<string,unknown>)['film.html']='<section><audio src="../escape.wav#t=0,2"></audio></section>';expect(await computeNativeEffectiveSidecars(i)).toMatchObject({status:'unsupported',reason:'SOURCE_PATH_UNSUPPORTED'});});
 it('caller mutation after call cannot change pending projection',async()=>{const i=input(1),pending=computeNativeEffectiveSidecars(i);(i.files as Record<string,unknown>)['assets/vo/a.vtt']='changed';const out=await pending;expect(out.status).toBe('computed');if(out.status==='computed')expect(out.captions).toEqual(fixtures.vectors[1]!.expected.captions);});
 it('result defaults do not alias later calls',async()=>{const a=await computeNativeEffectiveSidecars(input(0));if(a.status==='computed')(a.style.value as Record<string,unknown>).font=null;const b=await computeNativeEffectiveSidecars(input(0));if(b.status==='computed')expect(b.style).toEqual(fixtures.vectors[0]!.expected.style);});
});
