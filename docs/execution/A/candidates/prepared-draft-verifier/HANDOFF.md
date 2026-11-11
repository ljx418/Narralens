# HANDOFF — PreparedDraftVerifier Host-only candidate

READY SOURCE ONLY, no tsc/test/build/Host/browser/media run. Base838ba5f2c8500f0103f56dbe51264ea9f70086fc. Only new intended file src/host/agent-driven/prepared-draft-verifier.ts; MAIN remains sole production writer. Review candidate.patch/full source +candidate-manifest/SOURCE-MAP. No CP schema, DB, author/snapshot write, render, paid/network/J action or alternate Run engine added.

## Exact confirmed API

constructor(vendorRoot,{stageDomainRoot,blobPath:(asset:LocalAsset)=>string}). All constructor values are Host-only, never Agent/UI DTO fields. MAIN's blobPathForFact must reread the real registry row/equality/private anchors; returned path is independently opened/retained/rehashed here, not treated as authority by string equality alone.

prove(task:TaskReservation,lease:TaskLease,draft:StagedNativeDraft,registryFacts:readonly LocalAsset[]):Promise<{fact:PreparedTaskFact;proof:object}>
assertCurrent(task,lease,fact,proof,assertCurrentRights:()=>void):void
proveExisting(task,lease,root:string,fact,registryFacts):Promise<object>
release(proof:object):void
close():Promise<void>

Both async inputs are detached before scheduling. WeakMap proof binds exact task digest, supplied lease owner/attempt, fact digest, root identity, retained stage+blob FDs and registry snapshot. assertCurrent must run only inside TaskStore's actual current-lease guards; verifier does NOT query/mutate DB or authorize job/Run/base. MAIN's processor guard/author-source observation remains separate mandatory authority. Old proof cannot be rebound to a new lease. Recovery takes immutable fact +Host-resolved existing root, reopens/recomputes everything and returns NEW proof for provided current lease. Fact/token/JSON object alone cannot pass WeakMap identity.

## Facts and bytes

Exact metadata file keys: format='narralens.prepared-native-output@1',project_id,plan_digest,fps,frame_count,clip_ids,subtitles,assets,subtitle_timing_basis='storyboard_plan'. No root/files/roots/source_digest/fact_digest/selfhash/lease. Metadata is compared with actual draft, and recovery reconstructs draft from that metadata +immutable fact files/roots +Host root. MAIN must append metadata descriptor and all media paths to roots, dedup, film.html first before prove.

Root must be under fixed private stageDomainRoot; every ancestor and leaf directory has canonical non-symlink path/held dev+ino+mode+uid identity. Stage files are regular/private/no-hardlink and opened O_NOFOLLOW|O_NONBLOCK through retained directory FDs. Complete actual tree must exactly match descriptors (including no extra directories/files), SourceDigestV1 closure must match the exact file descriptors and zero external references. Blob bytes/hash/fingerprint/path identity are likewise captured and checked. No unlink/mkdir/fsync/write occurs in this verifier.

SourceDigestV1 uses its unchanged domain/roles, openfilm e70d, roots and NO declaredAssets injection, matching existing creation semantics. Registry rights_digest is canonicalDigest(selected full LocalAsset facts sorted by asset_id), including original license/source/rights_ref/recording_origin/attestation; only selected actual assets belong in registryFacts. Existing registry registration/core/id/rights derivations are checked; original source bytes copied into each media path must match current registry/blob bytes. draft-plan.json is rebuilt with the actual planner from current registry values and verified against plan_digest/project/actual Script+Storyboard content hashes in TaskPrepare.input_refs. rights.json, settings, fixed default subtitle style, VTT/sidecars, parsed native stage/IDs/src/timing/untrimmed narration must agree. No parser fallback/default proof is accepted.

Native comparisons use finite-JSON validation +deep strict equality because native seconds/style have fractions. CP/task/fact/registry canonicalDigest remains unchanged. Initial parent claim that parser preserves raw seconds was corrected by actual fixed film-doc L238 and readClip at/time normalization; expected timing now feeds producer frameSeconds strings through SAME pinned readFilmFile before comparing. This is source-fact correction, not a relaxed test assertion. MAIN's31/29/30 actual case must validate final behavior.

## Currentness and lifecycle

assertCurrent rechecks WeakMap/task/lease/fact, calls required current-rights callback before and after full sync source+blob hashing, then final fingerprint/tree check. Callback must return undefined synchronously; thenable is rejected and its rejection absorbed, even if async prefix executed. MAIN callback must compare real current registry/list selection to the same resolved facts and enforce all real rights, not be a no-op. blobPathForFact is also re-invoked per original registry fact on every assert.

release explicitly closes all proof FDs once and invalidates it. close is idempotent, sets closed immediately, invalidates/ closes records, awaits in-flight async work (including SourceDigest's own reads), and closes any remainder. All failed prove paths close opened FDs; no GC reliance. Await worker.close first, then verifier.close before DB close, as MAIN prescribed. No source cleanup/deletion is performed here.

Raw transient FS errors preserve existing asHostResourceError/HOST_RESOURCE_EXHAUSTED; safe ProductError codes survive with a generic non-path message. Cleanup failure can be CAPABILITY_UNAVAILABLE. Other drift/forgery failures use fixed REVISION_CONFLICT. Existing SourceDigestV1 realpath catch can itself mask an errno as SOURCE_REFERENCE_UNRESOLVED; that inherited helper limitation cannot be recovered after the errno is discarded (separate MAIN patch if needed), while its open/stat/read errno remains visible and is preserved by this class.

## Explicit limits / MAIN selected validation

SOURCE ONLY, no claims of actual proof success, SQLite/worker/recovery, render/decode/ASR/readability, NativeAck, human/film or overall A. This validates a genuine Host assembler result's declared source bytes, not an arbitrary browser manifest. Root selection is MAIN-only opaque-token resolution; within-domain path alone is not job authority. Current registry and TaskStore lease/gate/author-source checks remain MAIN. No re-probe/media process or copyright authority is invented; callback verifies actual existing rights rows.

Selected next real tests: actual registry→pinned assembler→metadata→worker prove/assert;31/29/30 timing/default-style fractions; exact roots/media/sidecars/source digest; current rights/changed blob/metadata/source/root alias/extra file/FIFO/tamper negative; forged proof/token, wrong task/lease, async callback including rejected promise; real close/release/in-flight and recovery/new lease. These are existing integration needs, not a new manual gate. Source/property map is supplied to unblock MAIN; no resource was consumed for these checks here.
