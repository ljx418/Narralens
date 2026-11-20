import type { RevisionStore } from '../projects/revision-store.js';
import type { PersistentJobStore, LeaseIdentity } from '../persistent-job-store.js';
import type { ProductSqliteRepository } from './product-sqlite-repository.js';
import type { FixedWorkflowService } from '../creative/fixed-workflow-service.js';
import type { CreativeProjectAuthority } from './creative-project-authority.js';
import { createTrustedCallerContext } from '../creative/trusted-context.js';
import { CreatedTaskGate } from './created-task-gate.js';
import {
  CreatedTaskStore,
  type CreatedTaskPorts,
  type PreparedTaskFact,
  type TaskLease,
  type TaskReservation,
  type TaskTransactionDb,
} from './created-task-store.js';
import { CreatedTaskWorker, type CreatedTaskProcessor } from './created-task-worker.js';

/** The real processor MUST be produced by the owner of the media proof. A fixture
 * processor may not be injected into production, and this composition never fabricates
 * a success: the processor settles the original job through the original authorities. */
export interface CreatedTaskApplicationProcessor extends CreatedTaskProcessor {
  assertPrepared(
    rows: TaskTransactionDb,
    context: {
      readonly task: TaskReservation;
      readonly fact: PreparedTaskFact;
      readonly proof: unknown;
      readonly lease: TaskLease;
      readonly now: Date;
    },
  ): void;
  close?(): Promise<void> | void;
}

export interface CreatedTaskProcessorFactory {
  (tasks: CreatedTaskStore): CreatedTaskApplicationProcessor;
}

export interface CreatedTaskApplicationOptions {
  readonly revisions: RevisionStore;
  readonly repository: ProductSqliteRepository;
  readonly workflow: FixedWorkflowService;
  readonly authority: CreativeProjectAuthority;
  readonly jobs: PersistentJobStore;
  readonly createProcessor: CreatedTaskProcessorFactory;
  readonly worker?: {
    readonly capacity?: number;
    readonly pollMs?: number;
    readonly leaseMs?: number;
    readonly diagnostic?: (event: { code: string; job_id: string | null }) => void;
  };
}

/**
 * The production composition of the created-task chain over the ORIGINAL database.
 *
 * It owns exactly one reservation store, one worker over the original durable jobs and
 * the original workflow/Coordinator authorities. There is no second job table, no second
 * queue and no second state machine: the created_* rows are private facts about the same
 * original job.
 *
 * R0-M01: on a graceful Host shutdown the live lease and its workflow checkpoint are
 * released in ONE same-database transaction, so a reopened database never shows a queued
 * job that still owns a running checkpoint. The generic lease reaper cannot produce that
 * split because the released job is queued with no lease, and it must not settle these
 * jobs itself while the dedicated recovery owns them.
 */
export class CreatedTaskApplication {
  readonly tasks: CreatedTaskStore;
  readonly worker: CreatedTaskWorker;
  readonly #processor: CreatedTaskApplicationProcessor;
  readonly #repository: ProductSqliteRepository;
  readonly #workflow: FixedWorkflowService;
  #closed = false;

  constructor(private readonly options: CreatedTaskApplicationOptions) {
    const { revisions, repository, workflow, authority, jobs } = options;
    this.#repository = repository;
    this.#workflow = workflow;
    const gate = new CreatedTaskGate(revisions, repository, authority);
    // The processor needs the store and the store's assertPrepared hook needs the
    // processor. The cycle is closed by construction order, never by a default allow.
    let processor!: CreatedTaskApplicationProcessor;
    const ports: CreatedTaskPorts = {
      assertAllowed: (db, context) => gate.assertAllowed(db, context),
      bindStep: (db, { task, now }) => this.progress(db, task, 'pending', now),
      assertPrepared: (db, context) => processor.assertPrepared(db, context),
    };
    this.tasks = new CreatedTaskStore(revisions, ports);
    processor = options.createProcessor(this.tasks);
    this.#processor = processor;
    this.worker = new CreatedTaskWorker(
      revisions,
      this.tasks,
      jobs,
      processor,
      {
        ...(options.worker?.capacity === undefined ? {} : { capacity: options.worker.capacity }),
        ...(options.worker?.pollMs === undefined ? {} : { pollMs: options.worker.pollMs }),
        ...(options.worker?.leaseMs === undefined ? {} : { leaseMs: options.worker.leaseMs }),
        ...(options.worker?.diagnostic === undefined ? {} : { diagnostic: options.worker.diagnostic }),
        gracefulRelease: (task, lease) => this.releaseForShutdown(task, lease),
      },
    );
  }

  /** The durable workflow checkpoint for one task attempt, in the live task transaction. */
  progress(
    rows: TaskTransactionDb,
    task: TaskReservation,
    state: 'pending' | 'running' | 'waiting_user' | 'failed' | 'cancelled',
    now: Date,
  ): void {
    const e = task.request.execution;
    this.#repository.joinTaskTransaction(rows, (tx) =>
      this.#workflow.recordStepAttemptInTransaction(
        tx,
        {
          project_id: task.request.project_id,
          run_id: e.run_id,
          plan_version: 1,
          step_id: e.step_id,
          attempt: e.attempt,
          grant_id: e.authorization_id,
          input_digest: e.input_digest,
          state,
          job_id: task.job_id,
          input_refs: task.request.input_refs,
          observed_at: now.toISOString(),
        },
        createTrustedCallerContext({
          principal_id: task.principal_id,
          channel: 'authenticated',
          source: 'driver_relay',
          session_ref: task.job_id,
        }),
      ),
    );
  }

  /**
   * R0-M01. The checkpoint returns to `pending` and the lease returns to the queue in the
   * same transaction. A superseded attempt, a lost lease or an already settled job is
   * left exactly as it is.
   */
  releaseForShutdown(task: TaskReservation, lease: LeaseIdentity): boolean {
    return this.tasks.releaseForShutdown(task.job_id, lease, (rows, current, now) => {
      this.progress(rows, current, 'pending', now);
    });
  }

  /** The dedicated recovery owns these jobs; the generic reaper must not settle them. */
  leaseReaperExclusions(): readonly string[] {
    return this.tasks.leaseReaperExclusions();
  }

  /** Recovery runs before the generic reaper and before any new lease can be claimed. */
  recoverBeforeGeneric(): void {
    this.#processor.recover();
  }

  start(): void {
    this.worker.start();
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    // The worker settles or gracefully releases every admitted operation first; only
    // then may the processor release its descriptors, and only then may SQLite close.
    await this.worker.close();
    await this.#processor.close?.();
  }
}
