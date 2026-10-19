import { randomUUID } from "node:crypto";
import { canonicalJson } from "../engine/source-digest-v1.js";
import { redact, type FailureDiagnostic } from "../host-diagnostics.js";
import { HttpError } from "../api-error.js";
import type { ProposalComparison } from "../../contracts/types.js";
import type { MaterializationV1 } from "../../contracts/wave2-types.js";
import type { PersistentJobStore } from "../persistent-job-store.js";
import type { LeaseIdentity } from "../persistent-job-store.js";
import type { MaterializationStore, ReplayLineage } from "./materialization-store.js";
import type { LineageEntryV1 } from "../../contracts/wave2-types.js";
import type { BindingService, BindingResult } from "./binding-service.js";
import type { NativePlanBuilder } from "./native-plan-builder.js";
import type { ProxyRenderer } from "./proxy-renderer.js";
import type { ProjectResolver } from "../projects/project-resolver.js";
import type { AssetInventoryPort } from "../projects/asset-inventory-port.js";
import type { DerivedArtifactStore } from "./derived-artifact-store.js";

/**
 * MaterializeService (M3.3).
 *
 * Two entry points and one worker. `POST` records an intent and a job; the worker does the
 * work under a lease. Nothing here writes author source, a revision, a binding or an active
 * commit — the only things it writes are the materialization read model, its job and its
 * derived artifacts.
 *
 * Three rules carry most of the weight, and each exists because its absence was a bug
 * someone has already had somewhere:
 *
 * - **The worker holds a lease before it touches anything.** Not after it starts, before.
 *   Two workers must never render the same materialization, and the lease is the only thing
 *   that says so.
 *
 * - **A result that arrives late is quarantined, never adopted.** A cancelled or lost-lease
 *   worker that finishes anyway has produced real bytes against premises that no longer
 *   hold. Those bytes are recorded and never become `ready_for_adoption`.
 *
 * - **Every read re-verifies.** A materialization is a claim about a moment. Reading one
 *   re-checks base revision, source digest, control revision, inventory and rights; if any
 *   moved it becomes `stale`, which is not upgradeable.
 */

export type MaterializeFaultPoint =
  | "after_job_create"
  | "after_lease"
  | "after_plan"
  | "after_proxy"
  | "after_lineage"
  | "before_ready"
  | "after_ready"
  | "after_cancel";

export interface MaterializeServiceDeps {
  readonly jobs: PersistentJobStore;
  readonly materializations: MaterializationStore;
  readonly bindings: BindingService;
  readonly plans: NativePlanBuilder;
  readonly proxies: ProxyRenderer;
  readonly artifacts: DerivedArtifactStore;
  readonly resolver: ProjectResolver;
  readonly inventory: AssetInventoryPort;
  /** Reads a target-owned comparison. Never the source project's. */
  readonly readComparison: (comparisonId: string) => Promise<ProposalComparison>;
  /** The media file behind an asset id, resolved from the target's own tree. */
  readonly resolveMedia: (projectId: string, assetId: string) => Promise<string>;
  readonly leaseMs?: number;
  /** How often a running worker renews its lease. Must be well under `leaseMs`. */
  readonly heartbeatMs?: number;
  /** Injected so tests can drive a render past its lease deterministically. */
  readonly scheduler?: Scheduler;
  readonly fault?: (point: MaterializeFaultPoint) => void | Promise<void>;
  /** Notified when a job row is created, so a harness can cancel it mid-run. */
  readonly onJob?: (job: { job_id: string }) => void;
  /** Where scheduler-level failures go. Never a silent `.catch`. */
  readonly onDiagnostic?: (entry: FailureDiagnostic) => void;
  readonly now?: () => Date;
}

export const MATERIALIZE_LEASE_MS = 30_000;
/** A third of the lease: several renewals fit inside one expiry even if one is delayed. */
export const MATERIALIZE_HEARTBEAT_MS = MATERIALIZE_LEASE_MS / 3;

/**
 * The timer surface, injected so tests can hold a render open across its lease expiry.
 */
export interface Scheduler {
  setInterval(handler: () => void, ms: number): { unref?: () => void };
  clearInterval(handle: { unref?: () => void }): void;
}

export const realScheduler: Scheduler = {
  setInterval: (handler, ms) => setInterval(handler, ms) as unknown as { unref?: () => void },
  clearInterval: (handle) => clearInterval(handle as unknown as ReturnType<typeof setInterval>),
};

function codeOf(error: unknown): string {
  return error instanceof HttpError ? error.code : "INTERNAL_ERROR";
}

export class MaterializeService {
  readonly #deps: MaterializeServiceDeps;
  /** Every run in flight, so close can wait for a durable ending rather than abandon one. */
  readonly #inflight = new Set<Promise<unknown>>();
  readonly #controllers = new Map<string, AbortController>();
  #accepting = true;

  constructor(deps: MaterializeServiceDeps) {
    this.#deps = deps;
  }

  /** In-flight runs, for close() to await. Previously declared and never written. */
  get inflight(): number { return this.#inflight.size; }

  get acceptingWork(): boolean { return this.#accepting; }

  /**
   * Stop taking new work and tell running workers to finish.
   *
   * A worker that is mid-encoder gets an abort so close does not have to wait for it, and
   * every one of them reaches a durable ending — a released lease, or one a restart can
   * reclaim — before the caller may close the database.
   */
  async shutdown(timeoutMs = 5_000): Promise<void> {
    this.#accepting = false;
    for (const controller of this.#controllers.values()) controller.abort();
    const deadline = Date.now() + timeoutMs;
    while (this.#inflight.size > 0 && Date.now() < deadline) {
      await Promise.race([
        Promise.allSettled([...this.#inflight]),
        new Promise((resolvePromise) => setTimeout(resolvePromise, 25)),
      ]);
      if (Date.now() >= deadline) break;
    }
    // Anything still running past the deadline keeps its lease, which is precisely what
    // makes it recoverable on the next start rather than orphaned.
  }

  /**
   * `POST .../materialize`. Records the intent, creates the job, and returns both.
   *
   * Idempotent by request digest: the same key with the same bindings replays the original
   * row rather than queueing a second render of the same film.
   */
  async request(input: {
    projectId: string;
    comparisonId: string;
    proposalId: string;
    baseRevision: number;
    sourceDigest: string;
    controlRevision: number;
    bindings: ReadonlyArray<{
      segment_id: string; asset_id: string;
      source_start_frame: number; source_end_frame_exclusive: number;
    }>;
    idempotencyKey: string;
    requestDigest: string;
    /** The comparison as it stands now, read to pin its digest and its replay provenance. */
    comparison: ProposalComparison;
    replay?: ReplayLineage;
  }): Promise<{ job_id: string; materialization_id: string; replayed: boolean }> {
    const view = await this.#deps.resolver.resolve(input.projectId);
    if (view.kind !== "activated") {
      throw new HttpError(422, "UNSUPPORTED_EDIT",
        "Materialize runs against an activated OpenFilm target", undefined, input.projectId);
    }
    if (view.revision !== input.baseRevision) {
      throw new HttpError(409, "REVISION_CONFLICT",
        "The project has moved since this request was prepared",
        { expected: view.revision, supplied: input.baseRevision }, input.projectId);
    }
    if (view.source_digest !== input.sourceDigest) {
      throw new HttpError(409, "SOURCE_CHANGED",
        "The source has changed since this request was prepared", undefined, input.projectId);
    }

    // The row records the project's *actual* control revision, not the caller's number.
    // A stale expectation is refused; a fresh one is still not trusted to be right.
    const controlRevision = view.control_revision;
    if (input.controlRevision !== controlRevision) {
      throw new HttpError(409, "REVISION_CONFLICT",
        "The control revision has moved since this request was prepared",
        { expected: controlRevision, supplied: input.controlRevision }, input.projectId);
    }

    // Idempotency is decided before any side effect. Creating the job first meant a
    // concurrent replay — same key, same digest, so `create` returns the original row
    // rather than throwing — left a second queued job nobody would ever run.
    const replayed = this.#deps.materializations.byIdempotencyKey(input.projectId, input.idempotencyKey);
    if (replayed !== undefined) {
      if (replayed.request_digest !== input.requestDigest) {
        throw new HttpError(409, "IDEMPOTENCY_KEY_CONFLICT",
          "This idempotency key was used with a different request",
          { materialization_id: replayed.materialization_id }, input.projectId);
      }
      return { job_id: replayed.job_id, materialization_id: replayed.materialization_id, replayed: true };
    }

    const job = this.#deps.jobs.create({
      projectId: input.projectId, kind: "materialize",
      payload: { comparison_id: input.comparisonId, proposal_id: input.proposalId },
    });
    this.#deps.onJob?.({ job_id: job.job_id });
    await this.#deps.fault?.("after_job_create");

    let row;
    try {
      row = await this.#deps.materializations.create({
        materializationId: `mat_${randomUUID().replaceAll("-", "")}`,
        projectId: input.projectId, comparisonId: input.comparisonId, proposalId: input.proposalId,
        jobId: job.job_id, baseRevision: view.revision, sourceDigest: view.source_digest,
        controlRevision,
      // Left empty on purpose: these are facts the worker proves when it re-reads the
      // bindings, not things the request can assert.
      proposalSha256: "", assetInventorySha256: "", rightsDigest: "",
        requestDigest: input.requestDigest, idempotencyKey: input.idempotencyKey,
        requestedBindings: input.bindings,
        comparisonSha256: canonicalJson(input.comparison),
        ...(input.replay === undefined ? {} : { replay: input.replay }),
      });
    } catch (error) {
      // The job row is already durable. Leaving it queued would orphan it: nothing reaps a
      // queued job, because reaping is for leases, and the client has just been told the
      // request failed. `recordCallback` is the wrong tool here — it only applies to a job
      // holding a lease, and this one never acquired one, so it silently did nothing.
      this.#deps.jobs.transition(job.job_id, "failed",
        { terminalReason: "materialization row was not created" });
      throw error;
    }
    return { job_id: job.job_id, materialization_id: row.materialization_id, replayed: false };
  }

  /**
   * `GET /materializations/:id`. Re-verifies before answering.
   *
   * The re-verification is what makes drift visible to a client: a materialization that was
   * ready when it was made and whose premises have since moved comes back `stale`, with the
   * reasons, rather than as a 200 that quietly describes a film nobody can produce.
   */
  async read(materializationId: string): Promise<MaterializationV1> {
    const row = this.#deps.materializations.require(materializationId);
    if (row.state === "ready_for_adoption") {
      const drift = await this.#drift(row);
      if (drift.length > 0) return this.#deps.materializations.markStale(materializationId, drift);
    }
    return this.#deps.materializations.require(materializationId);
  }

  /**
   * Facts that no longer hold, by name, so a client can say why rather than just that.
   *
   * Only a completed verification may produce a verdict. If the inventory cannot be read the
   * honest answer is "not checked right now", not "the premises moved" — treating an
   * unreadable ledger as proof of drift made one transient read failure permanently strand a
   * healthy row, because `stale` is terminal.
   */
  async #drift(row: MaterializationV1): Promise<string[]> {
    const reasons: string[] = [];
    const view = await this.#deps.resolver.resolve(row.project_id).catch((error: unknown) => {
      throw new HttpError(503, "ENGINE_UNAVAILABLE",
        "The target could not be resolved, so its premises could not be checked",
        undefined, row.project_id);
    });
    if (view.kind !== "activated") {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "The target is no longer an activated OpenFilm project", undefined, row.project_id);
    }
    if (view.revision !== row.base_revision) reasons.push("BASE_REVISION_CHANGED");
    if (view.source_digest !== row.source_digest) reasons.push("SOURCE_DIGEST_CHANGED");
    if (view.control_revision !== row.control_revision) reasons.push("CONTROL_REVISION_CHANGED");

    let inventory;
    try {
      inventory = await this.#deps.inventory.inventory(row.project_id);
    } catch (error) {
      if (error instanceof HttpError && error.code === "PROJECT_ATTENTION_REQUIRED") {
        // The ledger proved its own facts wrong. That is real drift, and this row was built
        // on them, so it goes stale — the project's own attention is recorded separately.
        reasons.push("ASSET_LEDGER_ATTENTION");
        return reasons;
      }
      throw new HttpError(503, "MEDIA_TOOL_UNAVAILABLE",
        "The asset inventory could not be read, so this materialization could not be verified",
        undefined, row.project_id);
    }
    if (inventory.inventory_sha256 !== row.asset_inventory_sha256) reasons.push("ASSET_INVENTORY_CHANGED");
    return reasons;
  }

  /**
   * Runs one materialization to completion, holding a lease for the whole thing.
   *
   * Returns what happened rather than throwing for the ordinary outcomes: a render that
   * could not be proven is `failed` or `attention`, both of which are answers a client can
   * act on, not exceptions it has to guess at.
   */
  /**
   * Runs one materialization to completion under a lease it keeps.
   *
   * The lease is renewed on a timer for as long as this worker is alive, and re-checked by
   * CAS at every boundary where a late worker could otherwise publish something nobody can
   * attribute: before the proxy is promoted into the row, before lineage is written, before
   * `ready_for_adoption`, and before the `succeeded` callback. Losing the lease at any of
   * them means this attempt is over: the materialization may not be promoted, the job may not
   * be succeeded, and whatever it produced is quarantined rather than discarded — the bytes
   * exist and their premises are unknown, which is the definition of an orphan.
   */
  async run(materializationId: string, owner = `worker-${process.pid}`): Promise<{
    state: string; quarantined: boolean;
  }> {
    if (!this.#accepting) return { state: "attention", quarantined: false };
    const work = this.#runOwned(materializationId, owner);
    this.#inflight.add(work);
    try { return await work; }
    catch (error) {
      // `run` never rejects: a caller on a closing database would otherwise surface this as
      // an unhandled rejection with nothing left to handle it.
      const current = this.#deps.materializations.find(materializationId);
      return {
        state: current?.state ?? "attention",
        quarantined: current?.state === "attention",
        ...(error instanceof Error ? {} : {}),
      };
    }
    finally { this.#inflight.delete(work); }
  }

  async #runOwned(materializationId: string, owner: string): Promise<{
    state: string; quarantined: boolean;
  }> {
    const row = this.#deps.materializations.require(materializationId);
    const jobId = row.job_id;
    const now = this.#deps.now?.() ?? new Date();
    const leaseMs = this.#deps.leaseMs ?? MATERIALIZE_LEASE_MS;
    if (!this.#deps.jobs.acquireLease(jobId, { owner, leaseMs, now })) {
      // Another worker holds it. That is a normal outcome, not an error.
      return { state: this.#deps.jobs.require(jobId).state, quarantined: false };
    }
    const attempt = this.#deps.jobs.require(jobId).attempt;
    const identity = { owner, attempt };

    const heartbeat = this.#startHeartbeat(jobId, identity, leaseMs);
    const controller = new AbortController();
    this.#controllers.set(materializationId, controller);

    let artifact: unknown = null;
    try {
      await this.#deps.fault?.("after_lease");

      // Joint recovery: a row left `running` or `validating` by a worker that lost its lease
      // is resumable, provided nothing about it contradicts what is recorded. `resumeOrReset`
      // decides, and it is the only thing allowed to move a row off `queued` here.
      const resumed = this.#deps.materializations.resumeOrReset(materializationId, now);
      if (resumed === "cancelled") {
        this.#deps.jobs.recordCallback(jobId, identity,
          { state: "cancelled", message: "materialization was cancelled before this attempt" });
        return { state: this.#deps.materializations.require(materializationId).state, quarantined: true };
      }
      if (resumed === "stale" || resumed === "ready") {
        // Its premises moved, or it was already promoted. Either way this attempt has
        // nothing to add, and touching it would re-open a row the reader already moved.
        return { state: this.#deps.materializations.require(materializationId).state, quarantined: false };
      }
      if (resumed === "attention") {
        this.#deps.jobs.recordCallback(jobId, identity,
          { state: "attention", terminalReason: "materialization ownership could not be established" });
        return { state: "attention", quarantined: true };
      }

      const bound = await this.#bind(this.#deps.materializations.require(materializationId));
      this.#deps.materializations.setProvenFacts(materializationId, {
        proposalSha256: bound.binding_digest,
        assetInventorySha256: bound.asset_inventory_sha256,
        rightsDigest: bound.rights_digest,
      });
      const plan = this.#deps.plans.build(bound);
      await this.#deps.materializations.setPlan(materializationId, plan);
      await this.#deps.fault?.("after_plan");

      const rendered = await this.#deps.proxies.render({
        materializationId, projectId: row.project_id, plan, signal: controller.signal,
        segments: await this.#segments(bound),
      });
      artifact = rendered.proxy;

      // Boundary one: the proxy has been encoded. Before it becomes part of the row, this
      // attempt must still own the job.
      const first = this.#mayPublish(jobId, identity, materializationId, rendered.lineage);
      if (first !== undefined) return first;
      await this.#deps.materializations.setProxy(materializationId, rendered.proxy);

      // Boundary two: before lineage is written.
      const second = this.#mayPublish(jobId, identity, materializationId, rendered.lineage);
      if (second !== undefined) return second;
      await this.#deps.materializations.setLineage(materializationId, rendered.lineage);
      await this.#deps.fault?.("after_proxy");
      await this.#deps.fault?.("after_lineage");

      if (this.#deps.materializations.require(materializationId).state === "running") {
        // Guarded like every other write here: a late worker must not advance the row.
        const beforeValidating = this.#mayPublish(jobId, identity, materializationId, rendered.lineage);
        if (beforeValidating !== undefined) return beforeValidating;
        this.#deps.materializations.transition(materializationId, "running", "validating");
      }
      await this.#deps.fault?.("before_ready");

      // Boundary three: the promotion. Checked with no `await` between the check and the
      // write, so a cancellation or a requeue cannot land in the gap.
      const jobState = this.#deps.jobs.require(jobId).state;
      if (jobState === "cancel_requested") {
        const cancelled = this.#deps.jobs.recordCallback(jobId, identity,
          { state: "cancelled", artifact });
        if (!cancelled.applied) this.#deps.materializations.quarantine(materializationId, rendered.lineage);
        return { state: this.#deps.jobs.require(jobId).state, quarantined: true };
      }
      const third = this.#mayPublish(jobId, identity, materializationId, rendered.lineage);
      if (third !== undefined) return third;
      this.#deps.materializations.transition(materializationId, "validating", "ready_for_adoption");
      await this.#deps.fault?.("after_ready");

      // Boundary four: the succeeded callback.
      const fourth = this.#mayPublish(jobId, identity, materializationId, rendered.lineage);
      if (fourth !== undefined) return fourth;
      const recorded = this.#deps.jobs.recordCallback(jobId, identity, { state: "succeeded", artifact });
      if (!recorded.applied) {
        // The job was no longer `running` — a peer or the reaper moved it. Reporting ready
        // here is the exact state Codex M1 forbids: the row claims to be adoptable while the
        // job that would have made it adoptable is terminal.
        this.#deps.materializations.quarantine(materializationId, rendered.lineage);
        return { state: this.#deps.materializations.require(materializationId).state, quarantined: true };
      }
      return { state: "ready_for_adoption", quarantined: false };
    } catch (error) {
      const cancelled = this.#deps.jobs.require(jobId).state === "cancel_requested";
      if (cancelled) {
        this.#record("materialize.cancelled", materializationId, jobId, identity, "cancelled after the work finished",
          { boundary: "render" });
        const outcome = this.#deps.jobs.recordCallback(jobId, identity,
          { state: "cancelled", artifact, message: "materialize finished after cancellation" });
        if (!outcome.applied) this.#deps.materializations.quarantine(materializationId, []);
        return { state: this.#deps.jobs.require(jobId).state, quarantined: true };
      }
      const message = error instanceof Error ? error.message : String(error);
      const current = this.#deps.materializations.find(materializationId);
      // A complete row has not had its premises contradicted; it had its *promotion*
      // interrupted. Marking it stale would discard a proxy that is already encoded and
      // content-addressed. It is left where it is for a retry to promote.
      if (current !== undefined && this.#deps.materializations.isComplete(materializationId)) {
        // The job is deliberately left `running`. The `finally` releases the lease, which
        // puts it back to `queued`, and that is the *only* state a new attempt can lease
        // from. Marking it `failed` here made the retry the comment promised impossible:
        // `acquireLease` accepts only `queued`, and `recover()` treats a failed job as a row
        // to park. The row keeps its artefacts and the next attempt promotes it.
        this.#record("materialize.promotion_interrupted", materializationId, jobId, identity,
          "the promotion was interrupted and the row was left for a retry",
          { boundary: "promotion" });
        void message;
        return { state: current.state, quarantined: false };
      }
      const published = current?.proxy !== undefined && current?.proxy !== null;
      if (published && (await this.#deps.artifacts.stagingLeftovers()).length > 0) {
        this.#deps.materializations.quarantine(materializationId, []);
        this.#deps.jobs.transition(jobId, "attention",
          { terminalReason: "materialize left artifacts it cannot classify" });
        return { state: "attention", quarantined: true };
      }
      this.#deps.jobs.transition(jobId, "failed",
        { terminalReason: message.slice(0, 200), artifact });
      if (this.#deps.materializations.find(materializationId)?.state === "running") {
        this.#deps.materializations.markStale(materializationId, [codeOf(error)]);
        this.#record("materialize.stale", materializationId, jobId, identity, codeOf(error),
          { boundary: "render" });
      }
      return { state: this.#deps.jobs.require(jobId).state, quarantined: false };
    } finally {
      // Every exit — success, failure, cancellation, a thrown abort — releases the heartbeat
      // and the abort controller. A timer left running would renew a lease for a worker that
      // has already finished.
      heartbeat.stop();
      this.#controllers.delete(materializationId);
      // A worker can still be here when `shutdown` reaches its budget and the database is
      // about to close. Throwing from a `finally` would reject this promise into a drain
      // interval that is being torn down, so each step is contained.
      try { this.#deps.jobs.releaseLease(jobId, owner); }
      catch { /* the lease is left for the reaper to reclaim on the next start */ }
      await this.#deps.artifacts.removeStagingLeftovers().catch(() => undefined);
    }
  }

  /**
   * Whether this attempt may still publish, and what to do when it may not.
   *
   * Cancellation is checked *before* the lease, and the order matters: a cancelled job fails
   * the lease test too, so testing the lease first sent every cancellation down the "lost
   * lease" path, which left the job in `cancel_requested` forever instead of closing it.
   * Returns undefined when the attempt may proceed.
   */
  #mayPublish(jobId: string, identity: LeaseIdentity, materializationId: string,
    lineage: readonly LineageEntryV1[]): { state: string; quarantined: boolean } | undefined {
    if (this.#deps.jobs.require(jobId).state === "cancel_requested") {
      const cancelled = this.#deps.jobs.recordCallback(jobId, identity,
        { state: "cancelled", artifact: this.#deps.materializations.require(materializationId).proxy });
      if (!cancelled.applied) this.#deps.materializations.quarantine(materializationId, lineage);
      return { state: this.#deps.jobs.require(jobId).state, quarantined: true };
    }
    if (!this.#ownsJob(jobId, identity)) {
      return this.#quarantineOrphan(jobId, identity, materializationId, lineage, "lost lease");
    }
    return undefined;
  }

  /**
   * Records a structured diagnostic for a materialization event.
   *
   * Every row that leaves the queue for any reason other than success is recorded here
   * with the identifiers an operator needs. Without this, a row that went stale or was
   * quarantined was only visible by reading the database and inferring what had happened.
   */
  #record(stage: string, materializationId: string, jobId: string,
    identity: LeaseIdentity | undefined, reason: string, extra: Record<string, string> = {}): void {
    const message = `${stage}: ${reason}`;
    this.#deps.onDiagnostic?.({
      correlation_id: materializationId,
      stage,
      kind: "MaterializationOutcome",
      message_sha256: "",
      message_redacted: redact(message),
      context: {
        materialization_id: materializationId,
        job_id: jobId,
        attempt: identity === undefined ? "unknown" : String(identity.attempt),
        lease_owner: identity === undefined ? "unknown" : identity.owner,
        reason,
        ...extra,
      },
      at: new Date().toISOString(),
    });
  }

  /** Keeps this attempt's lease alive while it works. */
  #startHeartbeat(jobId: string, identity: LeaseIdentity, leaseMs: number): { stop: () => void } {
    const scheduler = this.#deps.scheduler ?? realScheduler;
    const period = Math.max(1, Math.min(this.#deps.heartbeatMs ?? MATERIALIZE_HEARTBEAT_MS, Math.floor(leaseMs / 2)));
    const handle = scheduler.setInterval(() => {
      const now = this.#deps.now?.() ?? new Date();
      this.#deps.jobs.renewLease(jobId, identity, leaseMs, now);
    }, period);
    handle.unref?.();
    let stopped = false;
    return { stop: () => { if (stopped) return; stopped = true; scheduler.clearInterval(handle); } };
  }

  #ownsJob(jobId: string, identity: LeaseIdentity): boolean {
    return this.#deps.jobs.holdsLease(jobId, identity, this.#deps.now?.() ?? new Date());
  }

  /**
   * This attempt is over. The materialization is parked in `attention` with the lineage that
   * was produced, and the job is left alone: the next attempt owns it now, and an old
   * attempt writing to either row is exactly what the lease exists to prevent.
   */
  #quarantineOrphan(jobId: string, identity: LeaseIdentity, materializationId: string,
    lineage: readonly LineageEntryV1[], why: string): { state: string; quarantined: boolean } {
    this.#record("materialize.quarantine", materializationId, jobId, identity, why);
    const current = this.#deps.materializations.find(materializationId);
    if (current !== undefined && (current.state === "running" || current.state === "validating")) {
      this.#deps.materializations.quarantine(materializationId, lineage);
    }
    void jobId;
    void identity;
    return { state: this.#deps.materializations.require(materializationId).state, quarantined: true };
  }

  async #bind(row: MaterializationV1): Promise<BindingResult> {
    // The comparison is pinned at request time. A rebuild at the same base revision keeps
    // every client-supplied field identical while changing the segment content, so nothing
    // else in the request would notice.
    const pinned = this.#deps.materializations.comparisonSha256Of(row.materialization_id);
    const current = await this.#deps.readComparison(row.comparison_id);
    if (pinned !== "" && canonicalJson(current) !== pinned) {
      throw new HttpError(409, "REVISION_CONFLICT",
        "The comparison was rebuilt after this materialization was prepared",
        { comparison_id: row.comparison_id }, row.project_id);
    }
    return await this.#deps.bindings.bind({
      projectId: row.project_id, comparisonId: row.comparison_id, proposalId: row.proposal_id,
      baseRevision: row.base_revision,
      requested: this.#deps.materializations.requestedBindingsOf(row.materialization_id),
    });
  }

  async #segments(bound: BindingResult): Promise<Array<{
    segment_id: string; asset_path: string; sha256: string;
    start_frame: number; end_frame_exclusive: number;
    license_status: string; commercial_use: boolean;
  }>> {
    const inventory = await this.#deps.inventory.inventory(bound.project_id);
    const segments: Array<{
      segment_id: string; asset_path: string; sha256: string;
      start_frame: number; end_frame_exclusive: number;
      license_status: string; commercial_use: boolean;
    }> = [];
    for (const entry of bound.bindings) {
      const asset = inventory.assets.find((candidate) => candidate.asset_id === entry.asset_id);
      if (asset === undefined) {
        throw new HttpError(422, "MISSING_ASSET", `Asset ${entry.asset_id} is not registered`,
          undefined, bound.project_id);
      }
      segments.push({
        segment_id: entry.segment_id,
        asset_path: await this.#deps.resolveMedia(bound.project_id, entry.asset_id),
        sha256: asset.sha256,
        start_frame: entry.source_start_frame, end_frame_exclusive: entry.source_end_frame_exclusive,
        license_status: entry.license_status, commercial_use: entry.commercial_use,
      });
    }
    return segments;
  }

  /**
   * Drains the queue: takes one runnable row at a time and runs it.
   *
   * Called on a timer by the Host. Returns how many rows it attempted, so a caller (and a
   * test) can tell a drained queue from one that is merely empty right now.
   */
  /**
   * The drain in flight, and whether one is owed.
   *
   * A bare boolean could not express "I am still working but more work arrived": the flag
   * stayed true for as long as a slow render took, and every later tick returned nothing at
   * all. The queue was then starved for the length of the hang, with no error anywhere —
   * a Host that had stopped working looked exactly like a Host with nothing to do.
   *
   * So the state is a promise plus a coalesced rerun flag. A tick that arrives during a
   * drain joins the current one and marks a rerun; when the drain finishes, `finally` runs
   * exactly one more pass if the flag is set, and only then releases the identity it owns. A
   * drain that finishes later than a later drain started cannot clear the newer one, because
   * only the promise that owns the current identity clears it.
   */
  #current: Promise<{ attempted: number; ready: number; failed: number }> | null = null;
  #rerunRequested = false;

  async drain(limit = 8): Promise<{ attempted: number; ready: number; failed: number }> {
    if (!this.#accepting) return { attempted: 0, ready: 0, failed: 0 };
    const inFlight = this.#current;
    if (inFlight !== null) {
      // Join it, and owe a pass for whatever arrived while it was running.
      this.#rerunRequested = true;
      return await inFlight;
    }
    const identity = this.#drainLoop(limit);
    this.#current = identity;
    try {
      return await identity;
    } finally {
      // Only the identity this invocation installed may clear the slot, and only after any
      // coalesced rerun has been handed off.
      if (this.#current === identity) this.#current = null;
    }
  }

  async #drainLoop(limit: number): Promise<{ attempted: number; ready: number; failed: number }> {
    let totals = { attempted: 0, ready: 0, failed: 0 };
    for (;;) {
      try {
        const pass = await this.#drainOnce(limit);
        totals = {
          attempted: totals.attempted + pass.attempted,
          ready: totals.ready + pass.ready,
          failed: totals.failed + pass.failed,
        };
      } catch (error) {
        // Recorded rather than thrown into a timer that may already be torn down. The Host
        // used to swallow this entirely, which made a stopped scheduler indistinguishable
        // from an idle one.
        this.#deps.onDiagnostic?.({
          correlation_id: `drain-${randomUUID().slice(0, 8)}`,
          stage: "materialize.drain",
          kind: error instanceof Error ? error.constructor.name : typeof error,
          message_sha256: "",
          message_redacted: redact(error instanceof Error ? error.message : String(error)),
          at: new Date().toISOString(),
        });
      }
      if (!this.#rerunRequested) return totals;
      this.#rerunRequested = false;
      // Refuse to spin: a rerun is owed for work that arrived during a pass, not forever.
      if (!this.#accepting) return totals;
    }
  }

  /**
   * One pass over the queue.
   *
   * The runs are started together rather than awaited one at a time. Awaiting them
   * serially meant a single slow render held the whole queue behind it: the pass was still
   * inside the first `await` when every other row should have been picked up. The actual
   * concurrency ceiling is the renderer's — two overall and one per project — so starting
   * several runs here costs nothing and the limit is still enforced in one place.
   *
   * Each row's own lease is what stops two workers taking the same row, so starting them
   * together cannot double-run anything.
   */
  async #drainOnce(limit: number): Promise<{ attempted: number; ready: number; failed: number }> {
    const pending: Array<Promise<{ state: string; quarantined: boolean }>> = [];
    for (const row of this.#deps.materializations.runnable()) {
      if (pending.length >= limit) break;
      if (row.state === "cancel_requested") {
        this.#deps.materializations.quarantine(row.materialization_id, []);
        continue;
      }
      if (this.#deps.jobs.require(row.job_id).state !== "queued") continue;
      pending.push(this.run(row.materialization_id));
    }
    const outcomes = await Promise.allSettled(pending);
    let ready = 0;
    let failed = 0;
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") { failed += 1; continue; }
      if (outcome.value.state === "ready_for_adoption") ready += 1;
      else failed += 1;
    }
    return { attempted: pending.length, ready, failed };
  }

  /** Startup recovery: anything left running is retried or quarantined, never assumed done. */
  /**
   * Startup recovery. Every runnable row gets one of two answers, never a shrug.
   *
   * A cancelled one is quarantined, because the work is finished and its result is not
   * wanted. A running one whose lease is still live belongs to somebody — possibly this
   * process's predecessor, possibly another Host — and is left alone rather than raced. Only
   * a row that is queued, or whose lease has expired and been reaped, is retried.
   */
  async recover(): Promise<{ retried: string[]; quarantined: string[]; ownedElsewhere: string[] }> {
    const retried: string[] = [];
    const quarantined: string[] = [];
    const ownedElsewhere: string[] = [];
    for (const row of this.#deps.materializations.runnable()) {
      const job = this.#deps.jobs.require(row.job_id);
      if (row.state === "cancel_requested" || job.state === "cancel_requested") {
        this.#deps.materializations.quarantine(row.materialization_id, []);
        quarantined.push(row.materialization_id);
        continue;
      }
      if (job.state === "running") {
        // Someone still holds it. Whether that is a live worker or a corpse is the lease's
        // question, not recovery's.
        ownedElsewhere.push(row.materialization_id);
        continue;
      }
      if (job.state === "failed" || job.state === "attention") {
        // `acquireLease` only takes a *queued* job, so this row can never be retried by
        // anyone. Calling it "retried" promised something no caller could deliver.
        this.#deps.materializations.markStale(row.materialization_id,
          [`JOB_${job.state.toUpperCase()}`]);
        quarantined.push(row.materialization_id);
        continue;
      }
      retried.push(row.materialization_id);
    }
    return { retried, quarantined, ownedElsewhere };
  }
}
