import { randomUUID } from "node:crypto";
import type { JobEvent, JobResponse, JobState } from "../contracts/types.js";

const terminal = new Set<JobState>(["cancelled", "succeeded", "failed", "completed_after_cancel"]);

interface StoredJob { snapshot: JobResponse; events: JobEvent[]; nextEventId: number }
type JobListener = (event: JobEvent) => void;

export class JobStore {
  readonly #jobs = new Map<string, StoredJob>();
  readonly #listeners = new Map<string, Set<JobListener>>();

  create(projectId: string, now = new Date()): JobResponse {
    const at = now.toISOString();
    const job: StoredJob = {
      snapshot: { job_id: `job_${randomUUID().replaceAll("-", "")}`, project_id: projectId, state: "queued", created_at: at, updated_at: at },
      events: [], nextEventId: 1,
    };
    this.#jobs.set(job.snapshot.job_id, job);
    this.transition(job.snapshot.job_id, "queued", undefined, now);
    return structuredClone(job.snapshot);
  }

  get(jobId: string): JobResponse | undefined { return structuredClone(this.#jobs.get(jobId)?.snapshot); }

  eventsAfter(jobId: string, after: number): JobEvent[] {
    return (this.#require(jobId).events.filter((event) => event.event_id > after)).map((event) => structuredClone(event));
  }

  subscribe(jobId: string, listener: JobListener): () => void {
    this.#require(jobId);
    const listeners = this.#listeners.get(jobId) ?? new Set<JobListener>();
    listeners.add(listener);
    this.#listeners.set(jobId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(jobId);
    };
  }

  transition(jobId: string, state: JobState, extra?: Pick<JobEvent, "message" | "proposal_id" | "error">, now = new Date()): JobResponse {
    const job = this.#require(jobId);
    if (terminal.has(job.snapshot.state)) throw new Error("JOB_TERMINAL");
    const at = now.toISOString();
    const event: JobEvent = { event_id: job.nextEventId++, job_id: jobId, type: state, at, ...extra };
    job.events.push(event);
    job.snapshot = { ...job.snapshot, state, updated_at: at,
      ...(extra?.proposal_id ? { proposal_id: extra.proposal_id } : {}),
      ...(extra?.error ? { error: extra.error } : {}) };
    for (const listener of this.#listeners.get(jobId) ?? []) listener(structuredClone(event));
    return structuredClone(job.snapshot);
  }

  requestCancel(jobId: string, now = new Date()): JobResponse {
    const job = this.#require(jobId);
    if (terminal.has(job.snapshot.state)) return structuredClone(job.snapshot);
    return this.transition(jobId, "cancel_requested", { message: "Cancellation requested; completion may still arrive." }, now);
  }

  #require(jobId: string): StoredJob {
    const job = this.#jobs.get(jobId);
    if (!job) throw new Error("JOB_NOT_FOUND");
    return job;
  }
}
