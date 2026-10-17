import { createHash, randomUUID } from "node:crypto";
import { HttpError } from "./api-error.js";
import type { ApiError, JobEvent, JobResponse, JobState } from "../contracts/types.js";
import {
  JOB_TRANSITIONS, QUARANTINE_MESSAGE_PREFIX, TERMINAL_JOB_STATES,
  maxAttemptsFor, type JobKind,
} from "./job-defaults.js";
import type { JobRow, RevisionStore } from "./projects/revision-store.js";

/**
 * PersistentJobStore (`03_M2_M4_MODULE_DESIGN.md` §2.4, AC-012).
 *
 * Jobs, their events and their leases live in the project's one database, so a restart
 * keeps them. A worker takes a lease by compare-and-set; two workers can never both own a
 * job. A lost lease never becomes a success, an unknown provider outcome never auto-retries,
 * an unknown cost is never recorded as zero, and a result that arrives after cancellation is
 * quarantined rather than adopted.
 */

export interface JobSpec {
  readonly projectId: string;
  readonly kind: JobKind;
  readonly payload: unknown;
  readonly maxAttempts?: number;
}

export interface CallbackResult {
  readonly state: Extract<JobState, "succeeded" | "failed" | "cancelled" | "attention">;
  readonly providerReceipt?: unknown;
  readonly costStatus?: "unknown" | "known";
  readonly artifact?: unknown;
  readonly terminalReason?: string;
  readonly message?: string;
  readonly error?: ApiError;
}

export interface JobRecord extends JobResponse {
  readonly attempt: number;
  readonly max_attempts: number;
  readonly lease_owner: string | null;
  readonly cost_status: "unknown" | "known";
  readonly quarantined_artifact: unknown;
  readonly quarantined_receipt: unknown;
  readonly terminal_reason: string;
}

export interface AcquireLeaseOptions {
  readonly owner: string;
  readonly leaseMs?: number;
  readonly now?: Date;
}

const DEFAULT_LEASE_MS = 30_000;
type Listener = (event: JobEvent) => void;

export class PersistentJobStore {
  readonly #store: RevisionStore;
  readonly #listeners = new Map<string, Set<Listener>>();

  constructor(store: RevisionStore) { this.#store = store; }

  // ── lifecycle ───────────────────────────────────────────────────────────────────────

  create(spec: JobSpec | string, now = new Date()): JobResponse {
    // A bare string keeps the legacy `create(projectId)` shape working for existing callers.
    const resolved: JobSpec = typeof spec === "string" ? { projectId: spec, kind: "proposal_comparison", payload: {} } : spec;
    const jobId = `job_${randomUUID().replaceAll("-", "")}`;
    const at = now.toISOString();
    this.#store.createJobRow({
      job_id: jobId, project_id: resolved.projectId, kind: resolved.kind,
      payload_digest: createHash("sha256").update(JSON.stringify(resolved.payload ?? null)).digest("hex"),
      state: "queued", lease_owner: null, lease_expires_at: null, attempt: 0,
      max_attempts: maxAttemptsFor(resolved.kind, resolved.maxAttempts), cost_status: "unknown",
      created_at: at, updated_at: at,
    });
    this.#appendEvent(jobId, "queued", at, { message: "Job queued" });
    return this.#toResponse(this.require(jobId));
  }

  get(jobId: string): JobResponse | undefined {
    const row = this.#store.readJob(jobId);
    return row === undefined ? undefined : this.#toResponse(row);
  }

  /** Full record, including the fields added for M2.2 that old clients may ignore. */
  record(jobId: string): JobRecord | undefined {
    const row = this.#store.readJob(jobId);
    return row === undefined ? undefined : this.#toRecord(row);
  }

  // ── lease ───────────────────────────────────────────────────────────────────────────

  /**
   * Compare-and-set. Only a queued job can be taken, and only when no live lease is held,
   * so exactly one worker wins.
   */
  acquireLease(jobId: string, options: AcquireLeaseOptions): boolean {
    const now = options.now ?? new Date();
    const expires = now.getTime() + (options.leaseMs ?? DEFAULT_LEASE_MS);
    const won = this.#store.tryAcquireLease(jobId, options.owner, now.getTime(), expires);
    if (!won) return false;
    this.#appendEvent(jobId, "running", now.toISOString(),
      { message: `Lease acquired by ${options.owner}` });
    return true;
  }

  releaseLease(jobId: string, owner: string, now = new Date()): boolean {
    return this.#store.releaseLease(jobId, owner, now.getTime());
  }

  /**
   * Reclaim a lease nobody is holding any more. A reclaimed job goes back to `queued` while
   * attempts remain, and to `attention` once they do. It never becomes `succeeded`.
   */
  reapExpiredLeases(now = new Date()): Array<{ job_id: string; requeued: boolean; attention: boolean }> {
    const expired = this.#store.expiredLeases(now.getTime());
    for (const job of expired) {
      const requeue = job.attempt < job.max_attempts;
      if (!this.#store.reclaimLease(job.job_id, requeue, now)) continue;
      if (requeue) {
        this.#appendEvent(job.job_id, "queued", now.toISOString(),
          { message: "Lease expired; returned to the queue for another attempt" });
      } else {
        this.#transition(job.job_id, "attention", now,
          { message: `Lease expired and attempts are exhausted (${job.attempt}/${job.max_attempts})` });
        this.#store.markAttention(job.project_id, `txn_job_${job.job_id}`, "JOB_LEASE_LOST_EXHAUSTED",
          `失 lease 且已达 max_attempts 的 job ${job.job_id}`);
      }
    }
    return expired.map((job) => ({ job_id: job.job_id,
      requeued: job.attempt < job.max_attempts, attention: job.attempt >= job.max_attempts }));
  }

  // ── state ───────────────────────────────────────────────────────────────────────────

  transition(jobId: string, to: JobState, extra: Partial<CallbackResult>
    & { message?: string; proposalId?: string; comparisonId?: string } = {}, now = new Date()): JobResponse {
    const current = this.require(jobId);
    const state = current.state;
    if (TERMINAL_JOB_STATES.has(state)) {
      throw new HttpError(409, "REVISION_CONFLICT", `JOB_TERMINAL:${state}`);
    }
    if (!(JOB_TRANSITIONS[state] ?? []).includes(to)) {
      throw new HttpError(409, "REVISION_CONFLICT", `INVALID_JOB_TRANSITION:${state}->${to}`);
    }
    this.#transition(jobId, to, now, extra);
    return this.#toResponse(this.require(jobId));
  }

  requestCancel(jobId: string, now = new Date()): JobResponse {
    const current = this.require(jobId);
    if (TERMINAL_JOB_STATES.has(current.state) || current.state === "cancel_requested") {
      return this.#toResponse(current);
    }
    this.#transition(jobId, "cancel_requested", now,
      { message: "Cancellation requested; completion may still arrive" });
    return this.#toResponse(this.require(jobId));
  }

  /**
   * A worker result. Only a job that is still `running` may be finalised; anything else is a
   * late arrival from a worker whose lease was reclaimed, so it is quarantined and the
   * current state is left alone.
   */
  recordCallback(jobId: string, result: CallbackResult, now = new Date()): { applied: boolean; quarantined: boolean } {
    const current = this.require(jobId);
    if (current.state !== "running") {
      this.#store.quarantine(jobId, JSON.stringify(result.artifact ?? null),
        JSON.stringify(result.providerReceipt ?? null), now);
      this.#appendEvent(jobId, current.state, now.toISOString(),
        { message: `${QUARANTINE_MESSAGE_PREFIX} result arrived for a job that is ${current.state}` });
      return { applied: false, quarantined: true };
    }
    const applied = this.#store.completeCallback(jobId, result.state, result.costStatus ?? "unknown",
      JSON.stringify(result.providerReceipt ?? null), result.terminalReason ?? "", now);
    if (!applied) {
      this.#store.quarantine(jobId, JSON.stringify(result.artifact ?? null),
        JSON.stringify(result.providerReceipt ?? null), now);
      this.#appendEvent(jobId, current.state, now.toISOString(),
        { message: `${QUARANTINE_MESSAGE_PREFIX} the job moved on while the callback was in flight` });
      return { applied: false, quarantined: true };
    }
    this.#appendEvent(jobId, result.state, now.toISOString(),
      { message: result.message ?? `Job ${result.state}`, ...(result.error === undefined ? {} : { error: result.error }) });
    return { applied: true, quarantined: false };
  }

  // ── events and SSE ──────────────────────────────────────────────────────────────────

  /** Per-job monotonic sequence. `after` is a seq, so a reconnect never repeats or skips. */
  eventsAfter(jobId: string, after: number, limit = 500): JobEvent[] {
    this.require(jobId);
    // The wire event carries both ids: `seq` to resume by, `event_id` to dedupe by.
    return this.#store.jobEventsAfter(jobId, after, limit)
      .map((event) => ({ ...event }) as unknown as JobEvent);
  }

  subscribe(jobId: string, listener: Listener): () => void {
    this.require(jobId);
    const listeners = this.#listeners.get(jobId) ?? new Set<Listener>();
    listeners.add(listener);
    this.#listeners.set(jobId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(jobId);
    };
  }

  // ── internals ───────────────────────────────────────────────────────────────────────

  require(jobId: string): JobRow {
    const row = this.#store.readJob(jobId);
    if (row === undefined) throw new HttpError(404, "NOT_FOUND", "Job not found");
    return row;
  }

  #transition(jobId: string, to: JobState, now: Date, extra: Partial<CallbackResult>
    & { message?: string; proposalId?: string; comparisonId?: string }): void {
    const at = now.toISOString();
    this.#store.setJobState(jobId, to, at, extra.terminalReason ?? "", {
      ...(extra.proposalId === undefined ? {} : { proposal_id: extra.proposalId }),
      ...(extra.comparisonId === undefined ? {} : { comparison_id: extra.comparisonId }),
      ...(extra.error === undefined ? {} : { error_json: JSON.stringify(extra.error) }),
    });
    const message = extra.message
      ?? (extra.proposalId === undefined ? undefined : `proposal ${extra.proposalId}`);
    this.#appendEvent(jobId, to, at, {
      ...(message === undefined ? {} : { message }),
      ...(extra.proposalId === undefined ? {} : { proposal_id: extra.proposalId }),
      ...(extra.comparisonId === undefined ? {} : { comparison_id: extra.comparisonId }),
      ...(extra.error === undefined ? {} : { error: extra.error }),
    });
  }

  #appendEvent(jobId: string, type: JobState, at: string,
    extra: { message?: string; proposal_id?: string; comparison_id?: string; error?: ApiError } = {}): void {
    const event = this.#store.appendJobEvent(jobId, type, at, extra);
    for (const listener of this.#listeners.get(jobId) ?? []) listener(event as unknown as JobEvent);
  }

  #toResponse(row: JobRow): JobResponse {
    // Same fields as before M2.2: old clients must see no difference.
    return {
      job_id: row.job_id, project_id: row.project_id, state: row.state,
      created_at: row.created_at, updated_at: row.updated_at,
      ...(row.proposal_id === null ? {} : { proposal_id: row.proposal_id }),
      ...(row.comparison_id === null ? {} : { comparison_id: row.comparison_id }),
      ...(row.error_json === null ? {} : { error: JSON.parse(row.error_json) as ApiError }),
    };
  }

  #toRecord(row: JobRow): JobRecord {
    const stored = this.#store.readJob(row.job_id);
    const response = this.#toResponse(row);
    return {
      ...response, attempt: row.attempt, max_attempts: row.max_attempts,
      lease_owner: row.lease_owner, cost_status: row.cost_status,
      quarantined_artifact: safeParse(stored?.quarantined_artifact_json ?? "null"),
      quarantined_receipt: safeParse(stored?.quarantined_receipt_json ?? "null"),
      terminal_reason: row.terminal_reason,
    };
  }
}

function safeParse(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return null; }
}
