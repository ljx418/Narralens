import type {Script,Storyboard} from '../../contracts/agent-driven-types.js';
import type {AssetLicense,AssetSource} from '../../contracts/types.js';
/** Host-only verified registry facts. Never accepted from a tool or UI request body. */
export interface NativeDraftAsset {
 readonly project_id:string;readonly asset_id:string;readonly absolute_path:string;
 readonly sha256:string;readonly bytes:number;readonly duration_frames:number;
 readonly kind:'video'|'audio';readonly mime_type:string;
 readonly source:AssetSource;readonly license:AssetLicense;readonly rights_ref:string;
 readonly recording_origin:'human_recording'|'synthetic'|'unknown'|null;
}
export interface NativeDraftRequest {
 readonly project_id:string;readonly script:Script;readonly storyboard:Storyboard;
 readonly assets:readonly NativeDraftAsset[];readonly narration_asset_id:string|null;
 /** Host-chosen private output directory that must not already exist. */
 readonly target_root:string;
 /** All author/snapshot/input/blob roots; overlaps must be rejected before any mkdir. */
 readonly protected_roots:readonly string[];
 readonly width:number;readonly height:number;readonly signal?:AbortSignal;
}
export interface NativeDraftFile {readonly relative_path:string;readonly bytes:number;readonly sha256:string;}
export interface StagedNativeDraft {
 readonly format:'narralens.staged-native-draft@1';readonly project_id:string;
 /** Private uncommitted staging source; not a snapshot or a second project. */
 readonly root:string;readonly fps:{readonly num:30;readonly den:1};readonly frame_count:number;
 readonly clip_ids:readonly string[];readonly roots:readonly string[];
 readonly files:readonly NativeDraftFile[];
 readonly subtitles:readonly {subtitle_id:string;path:string}[];
 readonly assets:readonly {
  asset_id:string;path:string;sha256:string;bytes:number;duration_frames:number;
  media_type:string;source:AssetSource;license:AssetLicense;rights_ref:string;
  recording_origin:NativeDraftAsset['recording_origin'];
 }[];
 readonly plan_digest:string;
 /** Approved storyboard intervals, never an ASR/word-alignment claim. */
 readonly subtitle_timing_basis:'storyboard_plan';
}
/** Preparation only. MAIN owns real Run/Job fencing, current facts, review and commit. */
export interface NativeDraftAssembler {prepare(request:NativeDraftRequest):Promise<StagedNativeDraft>;}
