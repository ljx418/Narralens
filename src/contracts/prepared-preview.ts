import type {ReviewPart} from './agent-driven-types.js';

/** Public preview DTOs only: no Host paths, Task objects, file handles or authority. */
/** The five review parts a prepared preview carries. There is no sixth slot. */
export type PreparedPreviewPartKind='preview'|'narration'|'subtitles'|'shot_summary'|'rights_quality';

/** The real measured facts of one product. Never a project default and never a guess. */
export interface PreparedPreviewVideoFactsV1 {
 readonly kind:'video';
 readonly fps:{readonly num:number;readonly den:number};
 readonly frame_count:number;
}
export interface PreparedPreviewAudioFactsV1 {
 readonly kind:'audio';
 readonly sample_rate:number;
 readonly sample_count:number;
 readonly channels:number;
}
export interface PreparedPreviewTextFactsV1 {readonly kind:'text';}
export interface PreparedPreviewJsonFactsV1 {readonly kind:'json';}
export type PreparedPreviewMediaFactsV1=
 PreparedPreviewVideoFactsV1|PreparedPreviewAudioFactsV1|PreparedPreviewTextFactsV1|PreparedPreviewJsonFactsV1;

/** The timeline a preview belongs to. It is measured, not defaulted. */
export interface PreparedPreviewTimelineV1 {
 readonly fps:{readonly num:number;readonly den:number};
 readonly frame_count:number;
}

/** One real product of the preview. `object_id` is opaque; no path ever appears here. */
export interface PreparedPreviewPartV1 {
 readonly slot:PreparedPreviewPartKind;
 readonly object_id:string;
 readonly content_type:string;
 readonly bytes:number;
 readonly sha256:string;
 readonly media_facts:PreparedPreviewMediaFactsV1;
}

/**
 * The immutable receipt of one isolated prepared preview.
 *
 * The receipt is produced before any review package exists and never names one: the
 * package binds the receipt, so a package hash can never reference back into this
 * receipt. `receipt_digest` covers the deterministic canonical content, including the
 * measured fps and frame counts.
 */
export interface PreparedPreviewReceiptV1 {
 readonly format:'narralens.prepared-preview-receipt@1';
 readonly project_id:string;
 readonly run_id:string;
 readonly plan_version:1;
 readonly step_id:string;
 readonly execution_attempt:number;
 readonly prepared_job_id:string;
 readonly prepared_source_id:string;
 readonly source_digest:string;
 readonly plan_digest:string;
 readonly rights_digest:string;
 readonly producer_attempt:number;
 /** The measured video facts of the rendered preview. */
 readonly fps:{readonly num:number;readonly den:number};
 readonly frame_count:number;
 readonly parts:readonly PreparedPreviewPartV1[];
 readonly receipt_digest:string;
}

/**
 * The controlled description of one review part.
 *
 * BRIDGE builds it from the real package and the verified receipt; PRODUCT checks it
 * against the current package and the project's playback clock before it plays anything.
 */
export interface PreviewMediaDescriptorV1 {
 readonly format:'narralens.review-media-descriptor@1';
 readonly project_id:string;
 readonly run_id:string;
 readonly package_id:string;
 readonly package_version:number;
 readonly package_digest:string;
 /** The complete original ReviewPart value. */
 readonly part:ReviewPart;
 readonly receipt_digest:string;
 readonly object_id:string;
 readonly content_type:string;
 readonly bytes:number;
 readonly sha256:string;
 readonly timeline:PreparedPreviewTimelineV1;
 readonly media_facts:PreparedPreviewMediaFactsV1;
}

/** Maximum bytes of a single controlled reader chunk, shared with UI consumers. */
export const PREPARED_REVIEW_MAX_READ_BYTES=1024*1024;
