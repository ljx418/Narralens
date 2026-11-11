import type {ExecutionBinding,JobReceipt,ReviewPart,Script,Storyboard} from '../../contracts/agent-driven-types.js';
import type {AssetLicense,AssetSource} from '../../contracts/types.js';
import type {TaskReservation,PreparedTaskFact} from '../agent-driven/created-task-store.js';
import type {LocalAsset} from '../agent-driven/local-asset-registry.js';
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

/* -------------------------------------------------------------------------------------- */
/* CR-R1-001 §5: purpose-separated prepared-source proofs (MEDIA I1)                        */
/* -------------------------------------------------------------------------------------- */

/**
 * The completed SOURCE_ONLY preparation a later read or adoption depends on.
 *
 * This is Host-only and it is assembled from real same-DB rows by BRIDGE: the
 * reservation, the attempt that actually produced the bytes, the succeeded job and its
 * prepared receipt, the immutable prepared fact and the root the Host resolved. It is
 * never accepted from a browser, a tool or a request body, and MEDIA does not claim any
 * authority over the job database itself.
 */
export interface CompletedPreparedSourceV1 {
 readonly format:'narralens.completed-prepared-source@1';
 readonly project_id:string;
 /** The real reservation that produced the prepared source. */
 readonly task:TaskReservation;
 /** The attempt that actually produced the bytes. Not necessarily the current attempt. */
 readonly producer_attempt:number;
 /** The real succeeded job receipt. */
 readonly job:JobReceipt;
 /**
  * The job row's real `terminal_reason`.
  *
  * `SOURCE_ONLY` is what the durable settlement writes: the source was prepared, the
  * project was not committed. It is read from the row, not asserted here.
  */
 readonly terminal_reason:'SOURCE_ONLY';
 /**
  * The durable provider receipt the job row carries.
  *
  * This is the real `provider_receipt_json` of the settlement, with the exact kind,
  * source digest and stage the Host wrote. MEDIA checks it against the prepared fact;
  * it never restates it.
  */
 readonly provider_receipt:{
  readonly kind:'local.native-draft@1';
  readonly source_digest:string;
  readonly stage:'SOURCE_ONLY';
 };
 /** The immutable prepared fact stored with that job. */
 readonly fact:PreparedTaskFact;
 /** The Host-resolved prepared root. Never a request field and never a public path. */
 readonly root:string;
}

/**
 * The real identity and baseline every prepared-source proof is bound to.
 *
 * No transaction, impact or approval appears here. Those exist only in the adoption
 * binding, and only when they are real: an impact or a preview preparation has no
 * approval yet and must not be given a fictional one.
 */
export interface PreparedSourceIdentityV1 {
 readonly project_id:string;
 readonly run_id:string;
 readonly execution:ExecutionBinding;
 readonly prepared_source_id:string;
 readonly prepared_job_id:string;
 readonly fact_digest:string;
 readonly base_revision:number;
 readonly control_revision:number;
 readonly source_digest:string;
 readonly selection_version:number;
}

/**
 * A read binding: impact preparation or preview.
 *
 * It proves what may be *read*, never what may be *applied*. A successful SOURCE_ONLY
 * job has no live lease by then, so this binding carries the completed identity rather
 * than a TaskLease and never re-claims the succeeded job.
 */
export interface PreparedReadBindingV1 extends PreparedSourceIdentityV1 {
 readonly purpose:'impact'|'preview';
}

/**
 * An adoption binding: the full controlled apply.
 *
 * It carries the real transaction, impact, plan and approval identifiers on top of the
 * same identity and baseline. It is never accepted for an impact preparation and a read
 * proof is never accepted for it.
 */
export interface PreparedAdoptionBindingV1 extends PreparedSourceIdentityV1 {
 readonly purpose:'adoption';
 readonly transaction_id:string;
 readonly impact_id:string;
 readonly impact_hash:string;
 readonly plan_sha256:string;
 readonly approval_id:string;
 readonly target_snapshot_id:string;
}

/** The opaque Host-only proof of one completed prepared source. It never crosses a wire. */
export interface PreparedReadProofV1 {
 readonly format:'narralens.prepared-read-proof@1';
 readonly purpose:'impact'|'preview';
}
/** A distinct proof type: a read proof is not an adoption proof, at runtime or in types. */
export interface PreparedAdoptionProofV1 {
 readonly format:'narralens.prepared-adoption-proof@1';
 readonly purpose:'adoption';
}

/**
 * The proof surface MEDIA exposes for completed prepared sources.
 *
 * `prove*` reopens the real file descriptors and rebuilds the closure facts; the
 * `assertCurrent*` methods are the synchronous final check performed inside BRIDGE's
 * controlled transaction, where the current author and rights are re-verified.
 */
export interface PreparedSourceProofPort {
 proveForRead<P extends PreparedReadBindingV1['purpose']>(completed:CompletedPreparedSourceV1,binding:PreparedReadBindingV1&{readonly purpose:P},registryFacts:readonly LocalAsset[]):Promise<PreparedReadProofV1&{readonly purpose:P}>;
 assertCurrentForRead<P extends PreparedReadBindingV1['purpose']>(completed:CompletedPreparedSourceV1,binding:PreparedReadBindingV1&{readonly purpose:P},proof:PreparedReadProofV1&{readonly purpose:P},assertCurrentAuthorAndRights:()=>void):void;
 proveForAdoption(completed:CompletedPreparedSourceV1,binding:PreparedAdoptionBindingV1,registryFacts:readonly LocalAsset[]):Promise<PreparedAdoptionProofV1>;
 assertCurrentForAdoption(completed:CompletedPreparedSourceV1,binding:PreparedAdoptionBindingV1,proof:PreparedAdoptionProofV1,assertCurrentAuthorAndRights:()=>void):void;
 /** The descriptors of one proof are released explicitly. GC is never the release path. */
 release(proof:object):Promise<void>|void;
 /** Every descriptor this port still holds is closed. */
 close():Promise<void>|void;
}

/* -------------------------------------------------------------------------------------- */
/* CR-R1-001 §6/§8: the immutable preview receipt and the controlled media reader           */
/* -------------------------------------------------------------------------------------- */

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

/** The request half of the preview. The proof must already have been verified. */
export interface PreparedPreviewRequestV1 {
 readonly format:'narralens.prepared-preview-request@1';
 readonly completed:CompletedPreparedSourceV1;
 /** A read binding whose purpose is `preview`. */
 readonly binding:PreparedPreviewBindingV1;
 readonly proof:PreparedPreviewProofV1;
 readonly signal?:AbortSignal;
}

/** The read binding of a preview. An impact binding is not a preview binding. */
export type PreparedPreviewBindingV1=PreparedReadBindingV1&{readonly purpose:'preview'};
/** The read proof of a preview. An impact proof is not a preview proof. */
export type PreparedPreviewProofV1=PreparedReadProofV1&{readonly purpose:'preview'};

/** The preview service. It renders an isolated copy and never touches the author tree. */
export interface PreparedPreviewPort {
 preview(request:PreparedPreviewRequestV1):Promise<PreparedPreviewReceiptV1>;
}

/** One verified, read-only media handle. The descriptor is not business state. */
export interface PreparedReviewMediaHandleV1 {
 readonly content_type:string;
 readonly bytes:number;
 readonly sha256:string;
 readonly media_facts:PreparedPreviewMediaFactsV1;
 readonly timeline:PreparedPreviewTimelineV1;
 /** A bounded read of the verified bytes. `length` is at most 1 MiB. */
 read(range:{readonly offset:number;readonly length:number}):Promise<Uint8Array>;
 /** Idempotent. Every open descriptor is closed exactly once by its owner. */
 close():Promise<void>;
}

/**
 * The controlled reader of preview objects.
 *
 * `open` takes a receipt and an object id — never a path and never a URL — verifies the
 * fixed object domain and the recorded hash on the very descriptor it hands out, and
 * returns a handle that reads only those bytes.
 */
export interface PreparedReviewMediaReader {
 open(receipt:PreparedPreviewReceiptV1,object_id:string,options?:{readonly signal?:AbortSignal}):Promise<PreparedReviewMediaHandleV1>;
}

/** The largest single read a handle serves. */
export const PREPARED_REVIEW_MAX_READ_BYTES=1024*1024;

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
