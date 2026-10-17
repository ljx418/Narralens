import { randomUUID } from "node:crypto";
import { HttpError } from "../api-error.js";
import type { EditRequest, EditResponse } from "../../contracts/types.js";
import type { EngineKind } from "../../contracts/engine-types.js";
import type { ProjectOperationQueue } from "./project-operation-queue.js";
import type { ProjectWriteActor } from "./project-write-actor.js";
import type { RevisionStore, ProjectTransactionKind } from "./revision-store.js";
import type { EngineBindingStore } from "../engine/engine-binding-store.js";
import type { EngineRegistry } from "../engine/engine-registry.js";
import { computeAffectedLocks, impactForEdit, LockService, type AffectedLock, type EngineLock } from "./lock-service.js";
import { capabilityMapFor, hostServiceCapabilityMap } from "../engine/engine-capabilities.js";
import type { NativeWriteGateway } from "../engine/native-write-gateway.js";
import { SnapshotStore } from "./snapshot-store.js";
import type { ProjectDescriptor } from "./project-catalog.js";
import type { SourceDigestResult } from "../engine/source-digest-v1.js";

/**
 * ProjectCoordinator (M2.2 plan §1).
 *
 * Every project-level write goes through the one existing `ProjectOperationQueue`, through
 * the one authoritative transaction machine, and past the native write gateway. This class
 * owns commit; `ProjectWriteActor` keeps its exact legacy behaviour and is only delegated
 * to, never rewritten.
 */

export interface ResolvedSource {
  readonly engine: EngineKind;
  readonly engineUpstreamSha: string;
  readonly descriptor: ProjectDescriptor;
  readonly sourceRoot: string;
}

export interface CoordinatorDeps {
  readonly queue: ProjectOperationQueue;
  readonly store: RevisionStore;
  readonly actor: ProjectWriteActor;
  readonly bindings: EngineBindingStore;
  readonly engines: EngineRegistry;
  readonly gateway: NativeWriteGateway;
  readonly locks: LockService;
  readonly snapshots: SnapshotStore;
  /** Reads the project's current source closure. Injected so the engine owns its closure. */
  readonly sourceFor: (projectId: string) => Promise<ResolvedSource>;
  /** The same closure, computed now. Used to detect an out-of-band change. */
  readonly digestFor: (source: ResolvedSource) => Promise<SourceDigestResult>;
}

export interface CommitInput {
  readonly transactionId: string;
  readonly snapshotId: string;
  readonly sourceDigestAfter: string;
  readonly revision: number;
  readonly idempotencyKey: string;
  readonly response: EditResponse;
  readonly outboxTopic: string;
  readonly outboxPayload: string;
}

export interface RecoveryReport {
  readonly transactions_marked_recovering: number;
  readonly outbox_pending: number;
  readonly leases_expired: number;
  readonly attention_projects: string[];
}

const ENTRY_FOR_EDIT = {
  set_visual_fit: "timeline.set_visual_fit",
  replace_visual_asset: "timeline.replace_visual_asset",
} as const;

export class ProjectCoordinator {
  constructor(private readonly deps: CoordinatorDeps) {}

  // ── the write gate (plan §8) ────────────────────────────────────────────────────────

  /** False means this project must not be written to. Same predicate the store uses. */
  recoverStatus(projectId: string): boolean {
    return !this.deps.store.recoveryGate(projectId, 0);
  }

  // ── the transaction machine (plan §3) ────────────────────────────────────────────────

  beginTransaction(input: {
    projectId: string; kind: ProjectTransactionKind; requestJson: string; requestHash: string;
    baseRevision: number; correlationId: string; createdAt?: Date;
  }): string {
    const transactionId = `txn_${randomUUID().replaceAll("-", "")}`;
    this.deps.store.beginTransaction({
      transaction_id: transactionId, project_id: input.projectId, kind: input.kind,
      correlation_id: input.correlationId, request_json: input.requestJson,
      request_hash: input.requestHash, base_revision: input.baseRevision,
      createdAt: input.createdAt,
    });
    return transactionId;
  }

  /**
   * Record the baseline this commit will be measured against. The journal's first row stays
   * with the actor for `edit`, because that is where D3 put it and D3's recovery reads it.
   */
  preconditionsChecked(transactionId: string, sourceDigestBefore: string, now = new Date()): void {
    this.deps.store.transition(transactionId, "received", "preconditions_checked",
      { source_digest_before: sourceDigestBefore }, now);
  }

  stage(transactionId: string, now = new Date()): void {
    this.deps.store.transition(transactionId, "preconditions_checked", "staged", {}, now);
  }

  validate(transactionId: string, now = new Date()): void {
    this.deps.store.transition(transactionId, "staged", "validated", {}, now);
  }

  prepare(transactionId: string, now = new Date()): void {
    this.deps.store.transition(transactionId, "validated", "prepared", {}, now);
  }

  abort(transactionId: string, errorCode: string, terminalReason?: string, now = new Date()): void {
    const current = this.deps.store.projectTransaction(transactionId);
    if (current === undefined || current.state === "committed") return;
    this.deps.store.transition(transactionId, current.state, "aborted",
      { error_code: errorCode, ...(terminalReason === undefined ? {} : { terminal_reason: terminalReason }) }, now);
  }

  attention(transactionId: string, errorCode: string, terminalReason: string, now = new Date()): void {
    const current = this.deps.store.projectTransaction(transactionId);
    if (current === undefined || current.state === "committed") return;
    this.deps.store.transition(transactionId, current.state, "attention",
      { error_code: errorCode, terminal_reason: terminalReason }, now);
    this.deps.store.markAttention(current.project_id, transactionId, errorCode, terminalReason, now);
  }

  attentionForProject(projectId: string, transactionId: string, errorCode: string, reason?: string): void {
    this.deps.store.markAttention(projectId, transactionId, errorCode, reason);
  }

  // ── locks (plan §5) ─────────────────────────────────────────────────────────────────

  computeAffectedLocks = computeAffectedLocks;

  acquireLock(input: Parameters<LockService["acquire"]>[0], initialRevision: number): EngineLock {
    return this.deps.locks.acquire(input, initialRevision);
  }

  releaseLock(lockId: string, initialRevision: number): number {
    return this.deps.locks.release(lockId, initialRevision);
  }

  // ── commit (plan §4.2 step 7) ───────────────────────────────────────────────────────

  /**
   * Revision, the active commit record, the idempotency entry and the outbox row move in
   * one transaction. A failure rolls all of it back and the caller undoes the snapshot.
   */
  commit(input: CommitInput, now = new Date()): void {
    const current = this.deps.store.projectTransaction(input.transactionId);
    if (current === undefined) throw new Error(`TRANSACTION_NOT_FOUND:${input.transactionId}`);
    this.deps.store.commitWithPointer({
      transactionId: input.transactionId, projectId: current.project_id, revision: input.revision,
      snapshotId: input.snapshotId, sourceDigestAfter: input.sourceDigestAfter,
      engine: this.deps.bindings.read(current.project_id)?.engine ?? "hypit",
      idempotencyKey: input.idempotencyKey, response: input.response,
      outboxTopic: input.outboxTopic, outboxPayload: input.outboxPayload, now,
    });
  }

  // ── the one write entry point (plan §1, four steps) ─────────────────────────────────

  /**
   * ① gate, ② begin + preconditions, ③ delegate unchanged to the actor, ④ commit or fail.
   *
   * The response is the actor's, byte for byte (AC-019).
   */
  async executeEdit(projectId: string, request: EditRequest, correlationId = randomUUID()): Promise<EditResponse> {
    const operation = request.operations[0]!;

    // ① the write gate, before anything else runs
    if (!this.recoverStatus(projectId)) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "Project requires recovery before it can be written",
        { attention_reason: this.deps.store.attentionReason(projectId) }, correlationId);
    }

    // The native write gateway is in front of every production write path.
    const binding = this.deps.bindings.require(projectId, undefined, correlationId);
    const decision = this.deps.gateway.decide({
      entry_id: ENTRY_FOR_EDIT[operation.op], shot_id: operation.shot_id,
      ...(operation.op === "set_visual_fit" ? { value: operation.value } : { asset_id: operation.asset_id }),
    }, capabilityMapFor(binding.engine), hostServiceCapabilityMap().entries);
    if (decision.kind !== "translated") {
      throw this.deps.gateway.toHttpError(decision as never, correlationId);
    }

    return await this.deps.queue.run(projectId, async () => {
      const source = await this.deps.sourceFor(projectId);
      const baseline = this.deps.store.sourceBaseline(projectId).committed;
      const now = await this.deps.digestFor(source);

      // A source that moved since the committed baseline is refused before the actor runs;
      // a native "rebased" result can never be adopted as a success (AC-004).
      if (baseline !== "" && now.source_digest !== baseline) {
        this.attentionForProject(projectId, `txn_${randomUUID().replaceAll("-", "")}`,
          "SOURCE_CHANGED", "source changed outside the Host");
        throw new HttpError(409, "SOURCE_CHANGED", "Project source changed since the committed baseline", undefined, correlationId);
      }

        const range = { start_frame: request.selection.start_frame, end_frame_exclusive: request.selection.end_frame_exclusive };
      const projection = await this.#projectionFor(projectId, source, correlationId);
      this.#assertUnlocked(projectId,
        computeAffectedLocks(impactForEdit(operation, range), projection), correlationId);

      // ② the transaction and its baseline
      const transactionId = this.beginTransaction({
        projectId, kind: "edit", requestJson: JSON.stringify(request), requestHash: baseline,
        baseRevision: request.base_revision, correlationId,
      });
      this.preconditionsChecked(transactionId, baseline);

      // ③ the actor, unchanged
      let response: EditResponse;
      try {
        response = await this.deps.actor.execute(projectId, request, correlationId);
      } catch (error) {
        const code = error instanceof HttpError ? error.code : "TRANSACTION_FAILED";
        if (code === "PROJECT_ATTENTION_REQUIRED") this.attention(transactionId, code, "actor reported attention");
        else this.abort(transactionId, code);
        throw error;
      }

      // ④ publish, then point at it
      this.stage(transactionId);
      this.validate(transactionId);
      this.prepare(transactionId);
      const published = await this.deps.snapshots.publish({
        projectId, engine: source.engine, engineUpstreamSha: source.engineUpstreamSha,
        descriptor: source.descriptor, sourceRoot: source.sourceRoot,
      });
      try {
        this.commit({
          transactionId, snapshotId: published.snapshot_id, sourceDigestAfter: published.source_digest,
          revision: response.new_revision, idempotencyKey: request.idempotency_key, response,
          outboxTopic: "project.committed",
          outboxPayload: JSON.stringify({ project_id: projectId, transaction_id: transactionId,
            revision: response.new_revision, snapshot_id: published.snapshot_id, changed: response.changed }),
        });
      } catch (error) {
        await this.deps.snapshots.rollback(projectId, published.snapshot_id);
        this.attention(transactionId, "TRANSACTION_FAILED", error instanceof Error ? error.message : String(error));
        throw error;
      }
      return response;
    });
  }

  /** The committed projection the lock classifier reads; never a staged one. */
  async #projectionFor(projectId: string, source: ResolvedSource, correlationId: string) {
    const resolved = this.deps.engines.resolve(projectId, correlationId);
    void source;
    return await resolved.port.inspect(
      { project_id: projectId, engine: resolved.engine, source_digest: this.deps.store.sourceBaseline(projectId).committed },
      { correlationId, projectId, signal: AbortSignal.timeout(10_000) });
  }

  #assertUnlocked(projectId: string, affected: readonly AffectedLock[], correlationId: string): void {
    try { this.deps.locks.assertUnlocked(projectId, affected); }
    catch (error) {
      throw new HttpError(423, "TARGET_LOCKED", error instanceof Error ? error.message : "Locked", undefined, correlationId);
    }
  }

  // ── recovery order (plan §8) ────────────────────────────────────────────────────────

  /** Journal recovery → outbox replay → lease reclaim → report attention. */
  async recoverOnStart(now = new Date()): Promise<RecoveryReport> {
    let transactionsMarkedRecovering = 0;
    for (const transaction of this.deps.store.incompleteTransactions()) {
      this.deps.store.markRecovering(transaction.transaction_id, "CRASH_RECOVERY_REQUIRED", now);
      transactionsMarkedRecovering += 1;
    }
    return {
      transactions_marked_recovering: transactionsMarkedRecovering,
      outbox_pending: this.deps.store.pendingOutboxCount(),
      leases_expired: this.deps.store.expireStaleLeases(now),
      attention_projects: this.deps.store.projectsInAttention(),
    };
  }

  /** The pointer a reader must resolve; never a directory listing. */
  activeCommit(projectId: string) {
    return this.deps.store.activeCommit(projectId);
  }
}
