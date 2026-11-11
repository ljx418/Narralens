import {describe,it,expect} from 'vitest';
import {preparedSourceConsumerGraph} from '../../../src/host/agent-driven/created-source-publisher.js';

describe('actual native consumer graph membership',()=>{
 const draft={storyboard:{kind:'storyboard' as const,fps:30 as const,shots:[
  {shot_id:'v',paragraph_id:'p1',asset_id:'video',duration_frames:31,caption:'',concept_text:'可编辑叠层'},
  {shot_id:'c',paragraph_id:'p2',asset_id:null,duration_frames:29,caption:'',concept_text:'概念镜头'},
 ]},narration_asset_id:'voice'};
 const metadata={format:'narralens.staged-native-draft@1',project_id:'project',clip_ids:['concept-v','shot-c','narration','shot-v'],
  fps:{num:30 as const,den:1 as const},frame_count:60,subtitles:[],assets:[],plan_digest:'0'.repeat(64)};
 it('includes each native overlay and narration independently of track traversal order',()=>{
  const graph=preparedSourceConsumerGraph(metadata,draft);
  expect(graph.clips).toEqual([
   {clip_id:'shot-v',kind:'visual',shot_id:'v',paragraph_id:'p1',asset_id:'video',start_frame:0,end_frame_exclusive:31},
   {clip_id:'concept-v',kind:'concept',shot_id:'v',paragraph_id:'p1',asset_id:null,start_frame:0,end_frame_exclusive:31},
   {clip_id:'shot-c',kind:'visual',shot_id:'c',paragraph_id:'p2',asset_id:null,start_frame:31,end_frame_exclusive:60},
   {clip_id:'narration',kind:'narration',shot_id:null,paragraph_id:null,asset_id:'voice',start_frame:0,end_frame_exclusive:60},
  ]);
  expect(new Set(graph.clips.map(c=>c.clip_id))).toEqual(new Set(metadata.clip_ids));
 });
 it.each([
  [['shot-v','shot-c','narration']],
  [['shot-v','concept-v','shot-c','narration','concept-c']],
  [['shot-v','concept-v','shot-c','narration','narration']],
 ])('rejects missing, invented or duplicate native consumers: %j',clip_ids=>{
  expect(()=>preparedSourceConsumerGraph({...metadata,clip_ids},draft)).toThrow();
 });
 it('omits narration only when the immutable plan omits it',()=>{
  const graph=preparedSourceConsumerGraph({...metadata,clip_ids:['concept-v','shot-c','shot-v']},{...draft,narration_asset_id:null});
  expect(graph.clips).toHaveLength(3);
 });
});
