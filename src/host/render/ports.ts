import type {
  DeliveryManifest,
  ExecutionBinding,
  QCItem,
  Ref,
  RenderSpec,
} from "../../contracts/agent-driven-types.js";
import type { PackageReceipt, PublishedPackageStore } from "../delivery/published-package-store.js";
import type { MediaToolRunner } from "../delivery/qc.js";
import { canonicalDigest } from "../creative/digest.js";
import type { NativeRenderPort } from "./native-renderer.js";
import type { RenderPinVerdict } from "./upstream-pin.js";

/**
 * The ports IT-A06 consumes.
 *
 * Everything durable belongs to MAIN. This module owns no database, no job table and no
 * state machine: it renders, inspects and packages, and then *asks* MAIN to record what
 * happened. A second store of delivery facts would be a second truth about the same film,
 * and the recovery matrix in `cp-a0/02_DATA_AND_RECOVERY.md` is written against exactly one
 * of them.
 *
 * The three ports below are the whole surface MAIN has to supply:
 *
 * - `SnapshotReadPort` hands over the immutable bytes of one committed snapshot.
 * - `AttemptFencePort` decides whether this attempt may still act.
 * - `DeliveryCommitPort` performs MAIN's single durable transaction (receipt, `ready`,
 *   and the business outbox event) or nothing at all.
 *
 * The render boundary hooks exist so that a crash probe can terminate the process at a
 * named point — the four T20-E points are not observable from the outside otherwise, and a
 * crash that is simulated with a thrown error is not a crash.
 */

/** One file of a committed snapshot's closure. */
export interface SnapshotEntry {
  /**
   * The file's path relative to the snapshot's native root, with POSIX separators.
   *
   * This is the only path the delivery package uses. The absolute path exists so MAIN can
   * find the bytes; it never reaches a manifest, a package or a response.
   */
  readonly relative_path: string;
  /** Absolute host path of the immutable bytes MAIN holds for this snapshot. */
  readonly absolute_path: string;
  /** SHA-256 of the bytes as committed. Recomputed before the bytes are used. */
  readonly sha256: string;
  readonly bytes: number;
  readonly kind: "native_source" | "asset" | "supplement";
  /** The rights reference that covers this entry. Null only for the film's own source. */
  readonly rights_ref: string | null;
  /**
   * The role the entry fills, when it has one.
   *
   * A supplement is not "a supplement": a package that promises subtitles and a licence
   * has to carry both, and the role is how the promise is checked.
   */
  readonly role: string | null;
}

/** What the rights record says about one asset of a snapshot. */
export interface SnapshotRightsFact {
  readonly asset_id: string;
  readonly status: "cleared" | "restricted" | "unknown";
  readonly commercial_use: boolean;
  readonly ref: string | null;
}

/**
 * The immutable closure of one committed snapshot.
 *
 * `project_revision` is the revision the snapshot was committed at, not the project's
 * current revision: a render must keep describing the film it started from even while the
 * project moves on (T20-G).
 */
export interface SnapshotClosure {
  readonly project_id: string;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly project_revision: number;
  /**
   * How many frames the film has, as the committed native document says.
   *
   * The quality control compares the rendered file against this: a file that decodes
   * and holds fewer frames than the film has is a shortened film. It comes from the
   * snapshot, not from the renderer — a renderer that reports its own length is not a
   * check.
   */
  readonly expected_frames: number | undefined;
  /** How long the film is, in seconds, as the committed native document says. */
  readonly expected_duration_seconds: number | undefined;
  /** Absolute path of the native project folder that holds the film's entry document. */
  readonly native_root: string;
  /** The film document's path relative to `native_root`. */
  readonly native_entry: string;
  readonly entries: readonly SnapshotEntry[];
  readonly rights: readonly SnapshotRightsFact[];
}

/** The request half of `SnapshotReadPort`. */
export interface SnapshotReadRequest {
  readonly project_id: string;
  readonly snapshot_id: string;
  /** The digest the caller believes this snapshot has. A mismatch is a rejection. */
  readonly source_digest: string | undefined;
}

/**
 * Reads one committed snapshot of one project.
 *
 * Implementations must reject a snapshot that is not committed, not this project's, or
 * whose digest differs from the one requested. MAIN's implementation is the only place
 * that knows those facts; this module cannot re-derive them from the filesystem.
 */
export interface SnapshotReadPort {
  readSnapshot(request: SnapshotReadRequest): Promise<SnapshotClosure>;
}

/** The identity of one render attempt. */
export interface AttemptIdentity {
  readonly project_id: string;
  readonly job_id: string;
  readonly attempt: number;
  readonly execution: ExecutionBinding;
}

/** Whether the attempt may still act. */
export type AttemptFenceVerdict = "proceed" | "cancelled" | "superseded";

/**
 * The attempt fence.
 *
 * A fence has to answer two different questions and they must not be confused: *may I
 * start* (is another attempt already running?) and *may I still act* (was this attempt
 * cancelled, or has a newer attempt taken over?). The second question is asked again
 * before the package is published, because a render that was cancelled while it encoded
 * must not become a delivery afterwards (T20-D).
 */
export interface AttemptFencePort {
  /** Claim the attempt. False when another live attempt already owns it. */
  claimAttempt(attempt: AttemptIdentity): Promise<boolean>;
  /** Ask whether this attempt may still act. */
  checkAttempt(attempt: AttemptIdentity): Promise<AttemptFenceVerdict>;
  /** Release the claim. Called whatever the outcome, so a failed attempt does not wedge the job. */
  releaseAttempt(attempt: AttemptIdentity): Promise<void>;
}

/**
 * The named points at which a crash probe can terminate the process.
 *
 * The order is fixed and is the order of durable effects:
 * `encode_finished` → `qc_finished` → `package_published` → `ready_committed` →
 * `events_published`. T20-E kills the process at four of them; each kill must leave the
 * world in one of the three allowed states (recoverable, clearly failed, or completely
 * published), never in a half-published state.
 */
export type RenderBoundary =
  | "encode_finished"
  | "qc_finished"
  | "package_published"
  | "ready_committed"
  | "events_published";

/** What a boundary hook is told about the attempt that reached it. */
export interface RenderBoundaryContext {
  readonly project_id: string;
  readonly job_id: string;
  readonly snapshot_id: string;
  readonly attempt: number;
  /** The published manifest, once one exists. */
  readonly manifest: DeliveryManifest | null;
  /** The delivery id this attempt would use. */
  readonly delivery_id: string;
}

/**
 * The hook MAIN uses to record facts and to kill the process.
 *
 * A hook that throws aborts the render. That is deliberate: it is how a crash probe
 * terminates a *real* process at a real boundary instead of simulating one with a thrown
 * error inside a single function.
 */
export interface RenderBoundaryHooks {
  onBoundary(boundary: RenderBoundary, context: RenderBoundaryContext): Promise<void>;
}

/** What MAIN is asked to record, atomically, when a package is ready. */
export interface DeliveryCommitRequest {
  readonly project_id: string;
  readonly job_id: string;
  readonly snapshot_id: string;
  readonly source_digest: string;
  /**
   * The attempt that produced the published bytes.
   *
   * It may be an earlier attempt's: when two attempts race for one delivery key, the
   * winner's package is the one that exists, and the record has to describe the bytes
   * that are actually published.
   */
  readonly attempt: number;
  readonly delivery_id: string;
  /** The exact `DeliveryManifest` DTO. Validated against the frozen schema before it is passed on. */
  readonly manifest: DeliveryManifest;
  /** The controlled download token of the published media. */
  readonly download_ref: string;
  /** The binding of the attempt that is recording this. */
  readonly execution: ExecutionBinding;
  /** The package that was published, so MAIN can reconcile it by name. */
  readonly package_id: string;
  /** The immutable object the package's receipt names. */
  readonly object_id: string;
}

/**
 * MAIN's durable delivery transaction.
 *
 * One call, one transaction: the receipt, the `ready` state and the business outbox event
 * either all become durable or none of them do. This module never writes that state and
 * never assumes it happened.
 */
export interface DeliveryCommitPort {
  /**
   * Commit the ready delivery.
   *
   * `hooks` is passed on so MAIN can emit `ready_committed` and `events_published` from
   * inside its own transaction, which is the only place those two boundaries exist.
   *
   * The transaction has to check the attempt fence again. This module checks it before
   * it publishes, but a cancellation that arrives between that check and the commit
   * must still stop the record: the check that matters is the one inside the
   * transaction that makes the record durable.
   */
  commitReady(request: DeliveryCommitRequest, hooks: RenderBoundaryHooks): Promise<void>;
}

/** Everything one render needs to know. */
export interface RenderRequest {
  readonly project_id: string;
  readonly job_id: string;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly render_spec: RenderSpec;
  readonly execution: ExecutionBinding;
  readonly attempt: number;
  /**
   * The quality checks a person has already dispositioned.
   *
   * A check that warns is not a failure, but it is not a silent pass either: the
   * contract asks for a recorded decision. The decision is MAIN's to hold — it is a fact
   * about the review, not about the film — so MAIN passes the ids of the checks it has
   * recorded, and a warning without one blocks the delivery.
   */
  readonly qc_dispositions: readonly string[] | undefined;
  /**
   * The roles the package has to carry.
   *
   * A promised supplement that is not in the package blocks the delivery: a package
   * with a film and no licence is not the delivery that was promised.
   */
  readonly required_supplements: readonly string[];
  /** Cancels the render. The child process is awaited before this promise settles. */
  readonly signal: AbortSignal | undefined;
}

/** Why a render did not produce a delivery. */
export interface RenderFailure {
  /** A stable, dotless identifier of the failing step. */
  readonly code: string;
  readonly message: string;
  /** True when the same request could succeed later without anything changing. */
  readonly retryable: boolean;
}

/** The result of one render attempt. */
export interface RenderOutcome {
  readonly state: "ready" | "blocked" | "failed";
  /** The published manifest. Non-null exactly when the state is `ready`. */
  readonly manifest: DeliveryManifest | null;
  readonly qc: "pending" | "passed" | "blocked";
  readonly artifact_ref: Ref | null;
  readonly download_ref: string | null;
  readonly failure: RenderFailure | null;
  /** The QC items as they were recorded, so a blocked delivery can say why. */
  readonly qc_items: readonly QCItem[];
  /**
   * True when something is still running that this module could not confirm stopped.
   *
   * A cancelled render whose descendants could not be seen to end is not finished: MAIN
   * has to record a reconciling fact and keep the attempt claimed, because a process
   * that is still running may still write.
   */
  readonly requires_reconciliation: boolean;
}

/**
 * The port MAIN wires into the render job.
 *
 * `render` never throws for a media failure: a failed encode is a reported outcome with a
 * reason, because the job state machine belongs to MAIN and it has to be able to record
 * "failed" rather than "crashed". It does throw when the caller has broken the contract
 * (an unusable snapshot, a missing port) — those are programming errors, not media facts.
 */
export interface RenderPort {
  render(request: RenderRequest): Promise<RenderOutcome>;
}

/* -------------------------------------------------------------------------------------- */
/* L07 — the committed render phases: encode, inspect, publish                              */
/* -------------------------------------------------------------------------------------- */

/**
 * The three media stages of a committed render, as one port.
 *
 * The legacy `RenderPort` above is a *facade*: it runs the whole delivery path in one
 * call and then asks MAIN to record the result. The stage port is the same work split
 * at the points where a fact becomes durable, so that BRIDGE's phase executor can hold
 * the lease, record each stage in its own transaction and wait for a human between the
 * inspection and the publication without holding a descriptor.
 *
 * Three rules shape it:
 *
 * - **A stage never claims a job or a lease.** The executor holds the real lease and
 *   passes the fence of the execution it is running; a stage only asks the fence
 *   whether the attempt it is bound to may still act.
 * - **A stage returns a fact, not a state.** `prepareEncoded` returns an encoded fact
 *   and never a "ready"; the durable registration of that fact is BRIDGE's, in its own
 *   transaction.
 * - **A stage never invents an approval.** A technical pass is not a human acceptance:
 *   `inspectEncoded` reports what the tools found, and `publishValidated` refuses to
 *   publish a blocked inspection or a warning without a recorded disposition.
 */
export interface CommittedRenderPhasesPort {
  /**
   * Encode the committed closure and return the immutable encoded fact.
   *
   * The bytes are written, hashed and made durable before the fact exists, and the
   * fact names an immutable private object. The object is never removed by this module:
   * a crash between the fsync and BRIDGE's registration leaves a private orphan that
   * MAIN reconciles, never a half-written object that somebody else may adopt.
   */
  prepareEncoded(request: RenderRequest): Promise<EncodedFactV1>;
  /**
   * Inspect the encoded object and return the immutable quality-control receipt.
   *
   * The encoded object is reopened and re-verified — hash, size, closure and rights —
   * before anything is inspected, and the inspection writes its *own* immutable object.
   * The encoded object is never altered by the inspection.
   */
  inspectEncoded(input: InspectEncodedInput): Promise<QcReceiptV1>;
  /**
   * Publish the delivery package from the already encoded and already inspected bytes.
   *
   * Nothing is rendered again: the package carries the very bytes the encoder produced
   * and the very evidence the inspection produced. `PublishedPackageStore` stays the
   * only public publisher, so the no-clobber rule is unchanged.
   */
  publishValidated(input: PublishValidatedInput): Promise<PublishedPhaseReceiptV1>;
}

/** The input of `inspectEncoded`. The request is the *delivery* job's request. */
export interface InspectEncodedInput {
  readonly request: RenderRequest;
  /** The encoded fact the executor resolved from the durable registry. */
  readonly encoded: EncodedFactV1;
}

/** The input of `publishValidated`. The request is the *delivery* job's request. */
export interface PublishValidatedInput {
  readonly request: RenderRequest;
  /** The encoded fact this publication is derived from. */
  readonly encoded: EncodedFactV1;
  /** The inspection receipt this publication is derived from. */
  readonly qc: QcReceiptV1;
}

/**
 * One file of an immutable private phase object.
 *
 * The path is relative to the object's own root. An absolute path never appears in a
 * receipt: a receipt is a fact about bytes, and a fact about bytes does not carry the
 * place on a disk where they happened to be written.
 */
export interface PhaseObjectFileV1 {
  /** The id the file is known by. Unique inside the object. */
  readonly id: string;
  /** The path relative to the object's root, with POSIX separators. */
  readonly relative_path: string;
  /** The role the file fills: `media`, `native_document`, `native_source`, a supplement role. */
  readonly role: string;
  readonly bytes: number;
  readonly sha256: string;
}

/**
 * The immutable fact of one encode.
 *
 * It names the job that really produced the bytes and the lease attempt that was live
 * at that moment. It carries no quality-control verdict and no readiness: the
 * inspection has its own receipt and the durable registration belongs to BRIDGE.
 */
export interface EncodedFactV1 {
  readonly format: "narralens.encoded-fact@1";
  readonly project_id: string;
  /** The real encoder job. It is not necessarily the delivery job. */
  readonly job_id: string;
  /** The execution the encoder ran under. */
  readonly producer_execution: ExecutionBinding;
  /** The lease attempt that was live when the bytes were produced. */
  readonly producer_lease_attempt: number;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly render_spec: RenderSpec;
  /** The digest of the render configuration that produced the bytes. */
  readonly config_digest: string;
  /** The immutable private object that holds the encoded bytes. */
  readonly media_object_id: string;
  /** The reference of the media file inside that object. */
  readonly media_ref: Ref;
  /** Every file of the object, including the media and its supplements. */
  readonly files: readonly PhaseObjectFileV1[];
  readonly frame_count: number;
  readonly fps_numerator: number;
  readonly fps_denominator: number;
  /** The digest of the committed closure the bytes were rendered from. */
  readonly closure_digest: string;
  /** The digest of the rights facts the closure carried at that moment. */
  readonly rights_digest: string;
  readonly created_at: string;
  /** The digest of this receipt, computed over its own content without this field. */
  readonly receipt_digest: string;
}

/**
 * The immutable receipt of one inspection.
 *
 * `technical_status` says what the *tools* found. It is not an acceptance: a technical
 * pass still waits for the human review, and a warning still needs a recorded
 * disposition before anything is published.
 */
export interface QcReceiptV1 {
  readonly format: "narralens.qc-receipt@1";
  readonly project_id: string;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly config_digest: string;
  /** The digest of the encoded fact this inspection belongs to. */
  readonly parent_encoded_digest: string;
  /** The immutable private object that holds the inspection's evidence. */
  readonly qc_object_id: string;
  /** The checks exactly as the quality control recorded them. */
  readonly qc_items: readonly QCItem[];
  readonly technical_status: "pass" | "warn" | "block";
  /** Every file of the inspection object: the probe output and the decode output. */
  readonly files: readonly PhaseObjectFileV1[];
  readonly created_at: string;
  readonly receipt_digest: string;
}

/**
 * The immutable receipt of one publication.
 *
 * It carries the package receipt of the real publication, so the winner's identity is
 * in the receipt and not in the caller's memory, and it names the two receipts the
 * publication was derived from.
 */
export interface PublishedPhaseReceiptV1 {
  readonly format: "narralens.published-phase-receipt@1";
  /** The receipt of the published package, as `PublishedPackageStore` wrote it. */
  readonly package_receipt: PackageReceipt;
  readonly parent_encoded_digest: string;
  readonly parent_qc_digest: string;
  /** The execution the publication ran under. It may be another job's and another lease. */
  readonly publication_execution: ExecutionBinding;
  readonly publication_lease_attempt: number;
  readonly receipt_digest: string;
}

/**
 * The largest read a phase object handle ever serves.
 *
 * The bound is the same one the prepared-review media handle uses: a phase object is
 * opened to check a few bytes, never to carry a film through memory.
 */
export const PHASE_OBJECT_MAX_READ_BYTES = 1024 * 1024;

/** The input of the phase object resolver. */
export interface PhaseObjectOpenInput {
  /** The immutable object the file belongs to. */
  readonly object_id: string;
  /** The path of the file relative to the object's root. */
  readonly relative_path: string;
  /** The digest the file is expected to have. */
  readonly sha256: string;
  /** The size the file is expected to have. */
  readonly bytes: number;
  readonly signal?: AbortSignal;
}

/**
 * One verified, read-only handle on a file of an immutable phase object.
 *
 * The descriptor is not business state and it is not held across a wait: the handle is
 * closed by its owner, and the next phase opens the object again.
 */
export interface PhaseObjectHandle {
  readonly object_id: string;
  readonly relative_path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly content_type: string;
  /** A bounded read of the verified bytes. `length` is at most 1 MiB. */
  read(range: { readonly offset: number; readonly length: number }): Promise<Uint8Array>;
  /** Idempotent. Every open descriptor is closed exactly once by its owner. */
  close(): Promise<void>;
}

/**
 * The resolver of the private phase objects.
 *
 * It resolves an object id inside the Host's own private object root. It never accepts
 * an absolute path, never accepts a URL and never exposes an HTTP route: only the Host
 * executor, after it has verified the durable fact, may ask for a handle.
 */
export interface PhaseObjectResolver {
  openPhaseObject(input: PhaseObjectOpenInput): Promise<PhaseObjectHandle>;
}

/**
 * The dependencies a phase service is built from.
 *
 * The two roots are chosen by the Host, not by a caller: the workspace is where the
 * attempt's own staging happens and the object root is where the immutable objects
 * live. A request never names either of them.
 */
export interface CommittedRenderPhasesDeps {
  /** Reads the committed snapshot. MAIN's implementation is the only authority. */
  readonly snapshots: SnapshotReadPort;
  /** The fence of the execution the phase is running under. */
  readonly fence: AttemptFencePort;
  /** The real renderer. */
  readonly native_renderer: NativeRenderPort;
  /** The store that publishes the public package. It stays the only one. */
  readonly packages: PublishedPackageStore;
  /** The pinned OpenFilm checkout. */
  readonly upstream_root: string;
  /** The Host-selected private root of the immutable phase objects. */
  readonly object_root: string;
  /** The Host-selected private root of this attempt's staging. */
  readonly workspace_root: string;
  /** MAIN's boundary hooks, when the executor wants the named boundaries. */
  readonly hooks?: RenderBoundaryHooks;
  /** How the quality control runs its tools. The default is the real runner. */
  readonly qc_runner?: MediaToolRunner;
  /** How the pinned upstream is checked. The default is the real check. */
  readonly pin_verifier?: (upstream_root: string) => Promise<RenderPinVerdict>;
  readonly render_timeout_ms?: number;
  readonly qc_timeout_ms?: number;
}

/**
 * How a phase failed.
 *
 * A phase reports a media failure as a thrown error rather than as a state, because a
 * state would have to be invented for a stage that has no state machine: the durable
 * state belongs to BRIDGE. `requires_reconciliation` is the honest answer to "may
 * something still be running?" — it is true when a child process could not be seen to
 * end.
 */
export class CommittedRenderPhaseError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly requires_reconciliation = false,
  ) {
    super(message);
    this.name = "CommittedRenderPhaseError";
  }
}

/**
 * The digest of a phase receipt.
 *
 * The receipt's own digest field is removed before the canonical text is built, so a
 * receipt can be checked by anyone who holds it — and the preimage contains no
 * absolute path, because a receipt describes bytes and not the place they were written.
 * The canonicalization is the frozen restricted one: safe integers, strings, booleans
 * and null only.
 */
export function phaseReceiptDigest<T extends { readonly receipt_digest: string }>(receipt: T): string {
  const { receipt_digest: _self, ...content } = receipt;
  return canonicalDigest(content);
}
