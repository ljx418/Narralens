import { randomUUID } from "node:crypto";
import { HttpError } from "../api-error.js";
import type { MaterializationV1 } from "../../contracts/wave2-types.js";
import type { PersistentJobStore } from "../persistent-job-store.js";
import type { MaterializationStore } from "./materialization-store.js";
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
  /** The media file behind an asset id, resolved from the target's own tree. */
  readonly resolveMedia: (projectId: string, assetId: string) => Promise<string>;
  readonly leaseMs?: number;
  readonly fault?: (point: MaterializeFaultPoint) => void | Promise<void>;
  /** Notified when a job row is created, so a harness can cancel it mid-run. */
  readonly onJob?: (job: { job_id: string }) => void;
  readonly now?: () => Date;
}

export const MATERIALIZE_LEASE_MS = 30_000;

export class MaterializeService {
  readonly #deps: MaterializeServiceDeps;
  readonly #inflight = new Map<string, Promise<void>>();

  constructor(deps: MaterializeServiceDeps) {
    this.#deps = deps;
  }

  /** Recorded intents, keyed by the id the POST returned. */
  readonly inflight = this.#inflight;

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

    const job = this.#deps.jobs.create({
      projectId: input.projectId, kind: "materialize",
      payload: { comparison_id: input.comparisonId, proposal_id: input.proposalId },
    });
    this.#deps.onJob?.({ job_id: job.job_id });
    await this.#deps.fault?.("after_job_create");

    const row = await this.#deps.materializations.create({
      materializationId: `mat_${randomUUID().replaceAll("-", "")}`,
      projectId: input.projectId, comparisonId: input.comparisonId, proposalId: input.proposalId,
      jobId: job.job_id, baseRevision: view.revision, sourceDigest: view.source_digest,
      controlRevision,
      // Left empty on purpose: these are facts the worker proves when it re-reads the
      // bindings, not things the request can assert.
      proposalSha256: "", assetInventorySha256: "", rightsDigest: "",
      requestDigest: input.requestDigest, idempotencyKey: input.idempotencyKey,
      requestedBindings: input.bindings,
    });
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

  /** Facts that no longer hold, by name, so a client can say why rather than just that. */
  async #drift(row: MaterializationV1): Promise<string[]> {
    const reasons: string[] = [];
    const view = await this.#deps.resolver.resolve(row.project_id).catch(() => undefined);
    if (view === undefined || view.kind !== "activated") {
      reasons.push("TARGET_NOT_RESOLVABLE");
      return reasons;
    }
    if (view.revision !== row.base_revision) reasons.push("BASE_REVISION_CHANGED");
    if (view.source_digest !== row.source_digest) reasons.push("SOURCE_DIGEST_CHANGED");
    if (view.control_revision !== row.control_revision) reasons.push("CONTROL_REVISION_CHANGED");
    const inventory = await this.#deps.inventory.inventory(row.project_id).catch(() => undefined);
    if (inventory === undefined) {
      reasons.push("INVENTORY_UNREADABLE");
    } else if (inventory.inventory_sha256 !== row.asset_inventory_sha256) {
      reasons.push("ASSET_INVENTORY_CHANGED");
    }
    return reasons;
  }

  /**
   * Runs one materialization to completion, holding a lease for the whole thing.
   *
   * Returns what happened rather than throwing for the ordinary outcomes: a render that
   * could not be proven is `failed` or `attention`, both of which are answers a client can
   * act on, not exceptions it has to guess at.
   */
  async run(materializationId: string, owner = `worker-${process.pid}`): Promise<{
    state: string; quarantined: boolean;
  }> {
    const jobId = this.#deps.materializations.require(materializationId).job_id;
    const now = this.#deps.now?.() ?? new Date();
    const lease = { owner, leaseMs: this.#deps.leaseMs ?? MATERIALIZE_LEASE_MS, now };
    if (!this.#deps.jobs.acquireLease(jobId, lease)) {
      // Another worker holds it. That is a normal outcome, not an error.
      return { state: this.#deps.jobs.require(jobId).state, quarantined: false };
    }
    const attempt = this.#deps.jobs.require(jobId).attempt;
    await this.#deps.fault?.("after_lease");

    let artifact: unknown = null;
    try {
      const row = this.#deps.materializations.require(materializationId);
      if (row.state !== "queued") {
        // A worker whose materialization already moved on must not advance it.
        this.#deps.jobs.recordCallback(jobId, { owner, attempt },
          { state: "cancelled", message: "materialization already left queued" });
        return { state: this.#deps.materializations.require(materializationId).state, quarantined: true };
      }
      this.#deps.materializations.transition(materializationId, "queued", "running");

      const bound = await this.#bind(row);
      this.#deps.materializations.setProvenFacts(materializationId, {
        proposalSha256: bound.binding_digest,
        assetInventorySha256: bound.asset_inventory_sha256,
        rightsDigest: bound.rights_digest,
      });
      const plan = this.#deps.plans.build(bound);
      await this.#deps.materializations.setPlan(materializationId, plan);
      await this.#deps.fault?.("after_plan");

      const rendered = await this.#deps.proxies.render({
        materializationId, projectId: row.project_id, plan,
        segments: await this.#segments(bound),
      });
      artifact = rendered.proxy;
      await this.#deps.materializations.setProxy(materializationId, rendered.proxy);
      await this.#deps.materializations.setLineage(materializationId, rendered.lineage);
      await this.#deps.fault?.("after_proxy");
      await this.#deps.fault?.("after_lineage");

      // The cancellation may have landed while this worker was rendering. The bytes exist
      // and the premises do not, so the result is recorded and never promoted.
      if (this.#deps.jobs.require(jobId).state === "cancel_requested") {
        const cancelled = this.#deps.jobs.recordCallback(jobId, { owner, attempt },
          { state: "cancelled", artifact });
        if (!cancelled.applied) this.#deps.materializations.quarantine(materializationId, rendered.lineage);
        return { state: this.#deps.jobs.require(jobId).state, quarantined: true };
      }

      this.#deps.materializations.transition(materializationId, "running", "validating");
      await this.#deps.fault?.("before_ready");
      this.#deps.materializations.transition(materializationId, "validating", "ready_for_adoption");
      await this.#deps.fault?.("after_ready");

      this.#deps.jobs.recordCallback(jobId, { owner, attempt }, { state: "succeeded", artifact });
      return { state: "ready_for_adoption", quarantined: false };
    } catch (error) {
      const cancelled = this.#deps.jobs.require(jobId).state === "cancel_requested";
      const code = error instanceof HttpError ? error.code : "INTERNAL_ERROR";
      if (cancelled) {
        // Late and cancelled: the bytes exist, the premises do not. Recorded, not adopted.
        const outcome = this.#deps.jobs.recordCallback(jobId, { owner, attempt },
          { state: "cancelled", artifact, message: "materialize finished after cancellation" });
        if (!outcome.applied && this.#deps.materializations.find(materializationId) !== undefined) {
          this.#deps.materializations.quarantine(materializationId, []);
        }
        return { state: this.#deps.jobs.require(jobId).state, quarantined: true };
      }
      const message = error instanceof Error ? error.message : String(error);
      // Whether this is a failure or attention depends on whether anything was published:
      // a torn state nobody can classify is attention, not a failure.
      const published = this.#deps.materializations.find(materializationId)?.proxy !== undefined
        && this.#deps.materializations.find(materializationId)?.proxy !== null;
      if (published && (await this.#deps.artifacts.stagingLeftovers()).length > 0) {
        this.#deps.materializations.quarantine(materializationId, []);
        this.#deps.jobs.recordCallback(jobId, { owner, attempt },
          { state: "attention", terminalReason: "materialize left artifacts it cannot classify" });
        return { state: "attention", quarantined: true };
      }
      this.#deps.jobs.recordCallback(jobId, { owner, attempt },
        { state: "failed", terminalReason: message.slice(0, 200),
          error: { code, message: message.slice(0, 200), correlation_id: "materialize" } });
      if (this.#deps.materializations.find(materializationId)?.state === "running") {
        this.#deps.materializations.markStale(materializationId, [code]);
      }
      return { state: this.#deps.jobs.require(jobId).state, quarantined: false };
    } finally {
      this.#deps.artifacts.removeStagingLeftovers().catch(() => undefined);
      this.#deps.jobs.releaseLease(jobId, owner);
    }
  }

  async #bind(row: MaterializationV1): Promise<BindingResult> {
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
      retried.push(row.materialization_id);
    }
    return { retried, quarantined, ownedElsewhere };
  }
}
