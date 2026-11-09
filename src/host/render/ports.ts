import type {
  DeliveryManifest,
  ExecutionBinding,
  QCItem,
  Ref,
  RenderSpec,
} from "../../contracts/agent-driven-types.js";

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
