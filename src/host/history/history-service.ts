import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ControlledWriteFailureResponseV1, ControlledWriteResponseV1,
  RestoreRequestV1 } from "../../contracts/wave2-types.js";
import { HttpError } from "../api-error.js";
import { OpenFilmEngineAdapter } from "../../adapters/openfilm/openfilm-engine-adapter.js";
import { AuthorSourcePublisher } from "../adoption/author-source-publisher.js";
import { canonicalJson, computeSourceDigest } from "../engine/source-digest-v1.js";
import { absoluteServerPath } from "../engine/isolated-root.js";
import type { ActivatedProjectionService } from "../engine/activated-projection-service.js";
import type { EngineRegistry } from "../engine/engine-registry.js";
import type { NativeWriteGateway } from "../engine/native-write-gateway.js";
import type { RestoreEnginePlanIntent } from "../engine/engine-plan-intent.js";
import type { ImpactService } from "../impact/impact-service.js";
import type { LockService } from "../projects/lock-service.js";
import type { OperationIdempotencyStore } from "../projects/operation-idempotency-store.js";
import type { ProjectCoordinator } from "../projects/project-coordinator.js";
import type { ProjectResolver } from "../projects/project-resolver.js";
import type { RevisionStore } from "../projects/revision-store.js";
import type { SnapshotStore } from "../projects/snapshot-store.js";
import { claimsControlledWrite, claimsHistoryRestore } from "../projects/controlled-write-formats.js";
import type { HistoryCommandTranslator, HistoryIntentV1 } from "./history-command-translator.js";
import type { HistoryStore } from "./history-store.js";
import type { RestorePlanContext, RestorePlanner } from "./restore-planner.js";
import { PUBLISHER_FAULT_POINTS } from "./history-fault-registry.js";

/**
 * `HistoryService` (M4C gate §2, §4, §6).
 *
 * The one orchestration for a controlled restore. It owns no source writer and no database
 * writer of its own: it sequences the *existing* pieces — the resolver, the planner, the
 * engine port, the snapshot store, the publisher, the revision store — inside the one
 * project queue, and it decides every boundary.
 *
 * The order of the steps is the gate's order, and each step exists because the next one
 * would otherwise be able to assume something it has not established:
 *
 * ```
 * replay/conflict → current project → impact → gateway → plan → locks
 *   → transaction → stage → validate → publish → prepare
 *   → final re-checks → publish the author source → prove the active source
 *   → one database commit
 * ```
 *
 * Three properties this module is built around:
 *
 * 1. **A restore adds a revision; it never rewinds one.** There is no path in here that
 *    writes a revision the project already had, and the pointer moves only inside the one
 *    commit at the end.
 * 2. **The result is content addressed.** Restoring identical bytes produces the *same*
 *    snapshot id as the target, and the service proves it rather than assuming it.
 * 3. **Every boundary has a decided outcome.** A crash before `prepared` aborts with
 *    revision +0; a crash after it converges to exactly one commit, or to a terminal
 *    attention when nothing can be proved. Nothing is guessed.
 */

export const HISTORY_OPERATION_KIND = "controlled_write.restore_snapshot";

/**
 * The boundaries the crash matrix has to cover independently.
 *
 * Every one of them is a seam a test can fire at, so the rule each boundary implies can be
 * exercised rather than merely present.
 */
export interface HistoryServiceDeps {
  readonly coordinator: ProjectCoordinator;
  readonly revisions: RevisionStore;
  readonly idempotency: OperationIdempotencyStore;
  readonly resolver: ProjectResolver;
  readonly impact: ImpactService;
  readonly projections: ActivatedProjectionService;
  readonly planner: RestorePlanner;
  readonly engines: EngineRegistry;
  readonly gateway: NativeWriteGateway;
  readonly locks: LockService;
  readonly snapshots: SnapshotStore;
  readonly history: HistoryStore;
  readonly translator: HistoryCommandTranslator;
  readonly publisher: AuthorSourcePublisher;
  readonly stagingRoot: string;
  /**
   * Test-only crash seams; production composition omits them.
   *
   * The seam takes *any* boundary name, because the matrix walks two vocabularies: the
   * service's own boundaries and the publisher's. The publisher's boundaries are mapped in
   * `#publisherFault` so the registry can name them in one vocabulary.
   */
  readonly fault?: (boundary: string) => void;
}

/** Test-only marker that models process loss: online compensation must not run. */
export class SimulatedHistoryCrash extends Error {}

const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

export class HistoryService {
  readonly #deps: HistoryServiceDeps;

  constructor(deps: HistoryServiceDeps) { this.#deps = deps; }

  /** The staging root this service actually uses, so a test can observe it. */
  get stagingRoot(): string { return this.#deps.stagingRoot; }

  /**
   * `POST /api/migration/v1/projects/:id/history/restore`.
   *
   * The whole controlled write happens inside the project's queue, so a restore cannot
   * interleave with an adoption, with a lock acquisition, or with another restore.
   */
  async restore(projectId: string, request: RestoreRequestV1,
    correlationId = randomUUID(),
    signal?: AbortSignal): Promise<ControlledWriteResponseV1 | ControlledWriteFailureResponseV1> {
    const unfinished = this.#unfinishedRestore(projectId);
    return await this.#deps.coordinator.controlledWrite(projectId, correlationId, async () => {
      const requestJson = canonicalJson(request);
      const requestDigest = sha256(requestJson);
      if (unfinished !== undefined) {
        const pending = this.#unfinishedRestore(projectId);
        if (pending !== undefined && pending.transaction_id !== unfinished.transaction_id) {
          throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
            "Another unfinished restore appeared for this project",
            { transaction_id: pending.transaction_id }, correlationId);
        }
        if (pending !== undefined) {
          // The request's identity is settled before any recovery is taken over: the same
          // digest is that transaction, the same key with a different digest is a conflict,
          // and a different key is a different attempt.
          if (pending.request_hash === requestDigest) {
            const failure = await this.#takeOverRecovery(pending, request, correlationId);
            if (failure !== undefined) return failure;
          } else if (pending.idempotency_key === request.idempotency_key) {
            throw new HttpError(409, "IDEMPOTENCY_KEY_CONFLICT",
              "This idempotency key was used with a different request",
              { operation_kind: HISTORY_OPERATION_KIND }, correlationId);
          } else {
            try {
              await this.#takeOverRecovery(pending, request, correlationId);
            } catch (error) {
              if (error instanceof HttpError) {
                throw new HttpError(error.status, error.code,
                  `An unfinished restore for this project could not be recovered: ${error.message}`,
                  { ...(error.details ?? {}), transaction_id: pending.transaction_id },
                  correlationId);
              }
              throw error;
            }
          }
        }
      }
      const replay = this.#deps.idempotency.recall(projectId, HISTORY_OPERATION_KIND, request.idempotency_key);
      if (replay !== undefined) {
        this.#deps.idempotency.assertSameRequest(replay, requestDigest, HISTORY_OPERATION_KIND,
          projectId, correlationId);
        return JSON.parse(replay.response_json) as
          ControlledWriteResponseV1 | ControlledWriteFailureResponseV1;
      }

      const view = await this.#deps.resolver.resolveActivated(projectId);
      this.#assertBaseline(view, request, correlationId);

      // ── the impact authorizes this restore, and only this restore ─────────────────────
      const impact = await this.#deps.impact.requireCurrent(request.impact_id);
      if (impact.project_id !== projectId || impact.operation !== "restore_snapshot"
        || impact.target_snapshot_id !== request.target_snapshot_id
        || impact.impact_hash !== request.impact_hash) {
        throw new HttpError(428, "IMPACT_STALE",
          "The impact does not authorise this restore", undefined, correlationId);
      }

      // ── the native entry point is translated, never executed ─────────────────────────
      const decision = this.#deps.gateway.decide({
        entry_id: "history.restore", target_snapshot_id: request.target_snapshot_id,
        impact_id: request.impact_id, impact_hash: request.impact_hash,
        approval_confirmed: request.approval.confirmed,
      }, await this.#capabilities(projectId, correlationId));
      if (decision.kind !== "translated" || decision.edit.op !== "restore_snapshot") {
        throw this.#deps.gateway.toHttpError(decision as never, correlationId);
      }

      // ── the plan is rebuilt and must be the plan the impact authorized ────────────────
      const context = await this.#deps.planner.plan(projectId, request.target_snapshot_id, correlationId);
      await this.#deps.fault?.("after_target_resolved");
      this.#assertPlanMatchesImpact(context, impact, correlationId);
      this.#deps.locks.assertUnlocked(projectId, context.plan.required_locks);

      const transactionId = this.#deps.coordinator.beginTransaction({
        projectId, kind: "history", requestJson, requestHash: requestDigest,
        baseRevision: request.base_revision, correlationId,
      });
      await this.#deps.fault?.("after_received");
      this.#deps.coordinator.preconditionsChecked(transactionId, view.source_digest);
      await this.#deps.fault?.("after_preconditions");

      await mkdir(this.#deps.stagingRoot, { recursive: true });
      const isolated = await mkdtemp(join(this.#deps.stagingRoot, "restore-"));
      try {
        const resolved = this.#deps.engines.resolveVerified(projectId, view.engine_upstream_sha, correlationId);
        if (!(resolved.port instanceof OpenFilmEngineAdapter)) {
          throw new HttpError(404, "CAPABILITY_NOT_ENABLED",
            "The pinned OpenFilm adapter is unavailable", undefined, correlationId);
        }
        const openfilm = resolved.port;
        const intent: RestoreEnginePlanIntent = {
          op: "restore_snapshot",
          target_snapshot_id: context.target.snapshot_id,
          target_film_sha256: context.target.film_sha256,
          target_film_text: context.target.film_text,
          target_roots: context.target.roots,
          target_entry_root: context.target.entry_root,
          target_source_digest: context.target.source_digest,
          restore_plan_sha256: context.plan.plan_sha256,
          impact_hash: request.impact_hash,
          rights_digest: context.rights.rights_digest,
          missing_assets: context.missing_assets,
        };
        const ctx = {
          correlationId, projectId, idempotencyKey: request.idempotency_key,
          baseRevision: request.base_revision, expectedSourceDigest: request.expected_source_digest,
          controlRevision: request.control_revision, isolatedRoot: absoluteServerPath(isolated),
          // The write is bounded by a timeout, and — when the caller supplied one — by the
          // caller's own cancellation. A cancellation *before* the publication intent stops
          // the write and discards the staged result; one *after* it cannot, because the
          // atomic publication has already begun.
          signal: signal === undefined ? AbortSignal.timeout(120_000)
            : AbortSignal.any([AbortSignal.timeout(120_000), signal]),
        };
        // The content-addressed assets the active root is missing are read out of the
        // snapshot and staged into the isolated root's `inputs` area, with their digests
        // proved there and then again in the adapter. The Host reads them; the adapter
        // never learns a path.
        for (const asset of context.missing_assets) {
          const bytes = await readFile(join(context.target.source_root, asset.token));
          if (sha256(bytes) !== asset.sha256) {
            throw new HttpError(422, "UNSUPPORTED_EDIT",
              "The restore target's asset does not match its content address",
              { token: asset.token }, correlationId);
          }
          const input = join(isolated, "inputs", asset.sha256, "source.mp4");
          await mkdir(dirname(input), { recursive: true });
          await writeFile(input, bytes);
        }

        const enginePlan = await resolved.port.plan({
          project_id: projectId, engine: "openfilm", source_digest: view.source_digest,
        }, intent, ctx);
        await this.#deps.fault?.("after_plan");
        const staged = await resolved.port.stage(enginePlan, absoluteServerPath(isolated), ctx);
        this.#deps.coordinator.stage(transactionId);
        await this.#deps.fault?.("after_stage");
        const report = await resolved.port.validate(staged, ctx);
        if (!report.ok || report.source_digest === null
          || report.source_digest !== staged.source_digest
          || report.source_digest !== context.target.source_digest) {
          throw new HttpError(422, "UNSUPPORTED_EDIT", "The staged restore failed validation",
            { problems: report.problems }, correlationId);
        }
        this.#deps.coordinator.validate(transactionId);
        await this.#deps.fault?.("after_validate");

        // **A cancellation before the publication intent discards the staged result.**
        // After `prepared` the write has to converge, because the source may already have
        // been published; before it, nothing has left the isolated root.
        if (ctx.signal.aborted) {
          throw new HttpError(500, "INVALID_REQUEST",
            "The restore was cancelled before its publication intent", undefined, correlationId);
        }

        const stagedRoot = await realpath(join(isolated, staged.isolated_relative_root));
        await this.#deps.fault?.("before_snapshot_publish");
        const digestRoots = [context.target.entry_root,
          ...context.target.roots.filter((root) => root !== context.target.entry_root)];
        const published = await this.#deps.snapshots.publish({
          projectId, engine: "openfilm", engineUpstreamSha: view.engine_upstream_sha,
          sourceRoot: stagedRoot, roots: digestRoots,
        });
        await this.#deps.fault?.("after_snapshot_publish");
        // Content addressing: the restored closure *is* the target's closure, so the
        // published snapshot must carry the target's own id. A different id would mean the
        // stage produced something other than the target.
        if (published.snapshot_id !== context.target.snapshot_id) {
          throw new HttpError(422, "UNSUPPORTED_EDIT",
            "The published restore snapshot does not carry the target's content address",
            { expected: context.target.snapshot_id, observed: published.snapshot_id }, correlationId);
        }

        const beforeFilm = sha256(await readFile(join(view.source_root.value, "film.html")));
        const afterFilm = context.target.film_sha256;
        const filmTempToken = `.narralens-${transactionId}.film.tmp`;
        await this.#deps.fault?.("before_prepared");
        this.#deps.history.prepare({
          transaction_id: transactionId, project_id: projectId,
          target_snapshot_id: context.target.snapshot_id,
          result_snapshot_id: published.snapshot_id,
          source_before_snapshot_id: view.snapshot_id,
          source_before_sha256: beforeFilm, source_after_sha256: afterFilm,
          staged_source_digest: staged.source_digest,
          restore_plan_sha256: context.plan.plan_sha256,
          impact_id: request.impact_id, impact_hash: request.impact_hash,
          rights_digest: context.rights.rights_digest,
          required_locks: context.plan.required_locks,
          // The content-addressed assets the restore installed, if any. ADR-W2.0-006 §D-05
          // allows exactly this one asset change.
          installed_assets: context.missing_assets.map((asset) => ({
            token: asset.token, sha256: asset.sha256,
          })),
          film_temp_token: filmTempToken,
          publish_intent_created_at: new Date().toISOString(),
        });
        await this.#deps.fault?.("after_prepared");

        // ── the final, live re-checks at the publication boundary ───────────────────────
        await this.#finalRechecks(projectId, request, context, correlationId);

        await this.#deps.publisher.publish({
          activeRoot: view.source_root.value, stagedRoot, transactionId,
          filmTempToken, installedAssets: context.missing_assets.map((asset) => ({
            token: asset.token, sha256: asset.sha256,
          })),
          protectedTokens: context.current_roots,
          expectedFilmBeforeSha256: beforeFilm,
          expectedFilmAfterSha256: afterFilm,
        }, this.#publisherFault);
        await this.#deps.fault?.("after_published");

        // The active source must now *be* the target, read by the pinned upstream over the
        // target's own roots. The registered layout is replaced too, so a later read sees
        // the restored closure rather than the one that was replaced.
        const activeLayout = {
          root: view.source_root.value, roots: digestRoots,
          subtitles: context.target.subtitles.map((subtitle) => ({ ...subtitle })),
        };
        this.#deps.projections.useLayout(projectId, activeLayout);
        const active = await openfilm.inspectSnapshot(activeLayout, context.target.source_digest, ctx);
        if (active.problems.length > 0 || active.source_digest !== context.target.source_digest) {
          throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
            "The published restore cannot be proven", undefined, correlationId);
        }
        await this.#deps.fault?.("after_active_inspect");

        const committed = this.#deps.revisions.commitHistoryRestore({
          transactionId, projectId, previousRevision: request.base_revision,
          expectedSourceDigest: request.expected_source_digest,
          expectedControlRevision: request.control_revision,
          snapshotId: published.snapshot_id, sourceDigestAfter: staged.source_digest,
          impactId: request.impact_id, impactHash: request.impact_hash,
          idempotencyKey: request.idempotency_key, requestDigest,
          projection: {
            migration_id: view.migration_id, engine_upstream_sha: view.engine_upstream_sha,
            roots_json: canonicalJson(digestRoots),
            subtitles_json: canonicalJson(activeLayout.subtitles),
            // The restored film's own length. It is the target's, and the target's is the
            // project's, because M4C only restores a snapshot with the same clip identity.
            frame_count: context.target_projection.frame_count,
          },
          restorePlanSha256: context.plan.plan_sha256,
        }, (point) => { this.#deps.fault?.(point); });
        await this.#deps.fault?.("before_response");
        await this.#deps.fault?.("after_committed");
        return committed;
      } catch (error) {
        if (error instanceof SimulatedHistoryCrash) throw error;
        const transaction = this.#deps.revisions.projectTransaction(transactionId);
        if (transaction !== undefined
          && ["received", "preconditions_checked", "staged", "validated"].includes(transaction.state)) {
          return this.#abort(transactionId, projectId, request, requestDigest, error);
        }
        if (transaction?.state === "prepared") {
          const fact = this.#deps.history.restoreFact(transactionId);
          const current = await this.#deps.resolver.resolveActivated(projectId);
          const activeFilmSha = fact === undefined ? null
            : sha256(await readFile(join(current.source_root.value, "film.html")));
          if (fact !== undefined && activeFilmSha === fact.source_before_sha256) {
            // Nothing was published: the write can be abandoned cleanly.
            return this.#abort(transactionId, projectId, request, requestDigest, error);
          }
          if (fact !== undefined && activeFilmSha !== null && activeFilmSha !== fact.source_after_sha256) {
            this.#deps.coordinator.attention(transactionId, "HISTORY_RECOVERY_UNPROVABLE",
              "Active film matches neither restore boundary");
            throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
              "Active film matches neither restore boundary", undefined, correlationId);
          }
          try {
            return await this.#recoverTransaction(transactionId, request, requestDigest, correlationId);
          } catch (recoveryError) {
            if (recoveryError instanceof HttpError) {
              if (recoveryError.code === "TARGET_LOCKED") throw recoveryError;
              if (recoveryError.code === "PROJECT_ATTENTION_REQUIRED"
                || recoveryError.code === "IMPACT_STALE") {
                this.#deps.coordinator.attention(transactionId, "HISTORY_RECOVERY_UNPROVABLE",
                  recoveryError.message);
              }
              throw recoveryError;
            }
            const reason = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
            if (/^HISTORY_[A-Z_]*MISSING$/u.test(reason)) {
              this.#deps.coordinator.attention(transactionId, "HISTORY_FACT_MISSING", reason);
              throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
                "The published restore's immutable fact is missing", { reason }, correlationId);
            }
            throw new HttpError(503, "ENGINE_UNAVAILABLE",
              "The published restore could not be recovered right now", { reason }, correlationId);
          }
        }
        throw error;
      } finally {
        await rm(isolated, { recursive: true, force: true }).catch(() => undefined);
      }
    }, unfinished?.transaction_id);
  }

  /**
   * The history read model: which snapshots this project has committed.
   *
   * A read. It never moves the active pointer and it never changes a revision.
   */
  history(projectId: string): ReturnType<HistoryStore["history"]> {
    return this.#deps.history.history(projectId);
  }

  /**
   * Translate an undo or a redo into a typed intent.
   *
   * It does not commit, and it does not approve. The client still has to ask for an impact
   * with the returned target and then submit an explicit approval — that is the whole
   * point of translating rather than executing.
   */
  async intent(projectId: string, command: "undo" | "redo",
    correlationId = randomUUID()): Promise<HistoryIntentV1> {
    const entryId = command === "undo" ? "history.undo" : "history.redo";
    const permitted = this.#deps.gateway.permits(entryId, await this.#capabilities(projectId, correlationId));
    if (!permitted.permitted) {
      throw new HttpError(422, "UNSUPPORTED_EDIT", permitted.reason, undefined, correlationId);
    }
    return await this.#deps.translator.translate(projectId, command);
  }

  /**
   * Runs before the generic journal recovery and takes every unfinished restore row to a
   * terminal state.
   *
   * A provable prepared restore is *decided* here — committed or aborted — never handed to
   * the generic recovery, which would move it to `attention` and throw away the evidence
   * that would have let it converge.
   */
  async recoverOnStart(options: { sweep?: boolean } = {}): Promise<{
    recovered: number; aborted: number; attention: number; deferred: number;
  }> {
    const report = { recovered: 0, aborted: 0, attention: 0, deferred: 0 };
    if (options.sweep !== false) await this.#sweepOrphanedStaging();
    for (const transaction of this.#deps.revisions.incompleteTransactions()) {
      if (transaction.state === "attention") {
        report.attention += 1;
        continue;
      }
      if (!claimsHistoryRestore(transaction.request_json)) continue;
      // **The two specialized recoveries decide the transactions in the order they were
      // created.** A restore row that is younger than a still-pending adoption row for the
      // same project is *deferred*: the adoption's row is the older one, and it is the
      // adoption's recovery that owns it. Deciding the younger restore first would move the
      // revision under the older adoption, and the adoption's publication would then be
      // unprovable — a terminal attention produced purely by the order of two recoveries.
      //
      // The deferred row is decided by a second pass, after the adoption's recovery has
      // taken its own rows.
      if (this.#olderControlledPending(transaction)) {
        report.deferred += 1;
        continue;
      }
      let value: unknown;
      try { value = JSON.parse(transaction.request_json); } catch { value = undefined; }
      const request = this.#parseRestoreRequest(value);
      if (request === undefined) {
        this.#deps.coordinator.attention(transaction.transaction_id, "HISTORY_REQUEST_UNREADABLE",
          "the unfinished restore's request does not satisfy its contract");
        report.attention += 1;
        continue;
      }
      const ownRows = this.#controlledPendingRows(transaction.project_id);
      try {
        await this.#deps.coordinator.controlledRecovery(transaction.project_id,
          transaction.transaction_id, transaction.correlation_id, async () => {
            try {
              const outcome = await this.#recoverTransaction(transaction.transaction_id, request,
                transaction.request_hash, transaction.correlation_id);
              if (outcome.status === "committed") report.recovered += 1;
              else report.aborted += 1;
            } catch (error) {
              const current = this.#deps.revisions.projectTransaction(transaction.transaction_id);
              const missingFact = error instanceof Error && /^HISTORY_[A-Z_]*MISSING$/u.test(error.message);
              const terminal = missingFact || (error instanceof HttpError
                && (error.code === "PROJECT_ATTENTION_REQUIRED" || error.code === "IMPACT_STALE"));
              if (terminal && current !== undefined && current.state !== "attention") {
                this.#deps.coordinator.attention(transaction.transaction_id,
                  "HISTORY_RECOVERY_UNPROVABLE",
                  error instanceof Error ? error.message : String(error));
              }
              report.attention += 1;
            }
          }, ownRows);
      } catch (error) {
        report.attention += 1;
        this.#deps.coordinator.attention(transaction.transaction_id, "HISTORY_RECOVERY_BLOCKED",
          error instanceof Error ? error.message : String(error));
      }
    }
    return report;
  }

  // ── internals ───────────────────────────────────────────────────────────────────────

  /**
   * The bridge from the publisher's boundary names to the registry's.
   *
   * The publisher is M4B's module and its vocabulary is its own; the fault matrix needs
   * one vocabulary, and the mapping is the only place the two meet.
   */
  readonly #publisherFault = (boundary: string): void => {
    const mapped = PUBLISHER_FAULT_POINTS[boundary];
    if (mapped === undefined) {
      // A publisher boundary this table does not know about would be *unreachable* for the
      // fault matrix, and the matrix would then record a boundary as covered that no test
      // ever reached. That is the "标绿" the gate forbids, so it is refused here instead of
      // being skipped in silence.
      throw new Error(`UNMAPPED_PUBLISHER_FAULT_POINT:${boundary}`);
    }
    this.#deps.fault?.(mapped);
  };

  async #capabilities(projectId: string, correlationId: string) {
    const resolved = this.#deps.engines.resolve(projectId, correlationId);
    return await resolved.port.capabilities({
      project_id: projectId, engine: "openfilm", source_digest: "",
    }, { correlationId, projectId, signal: AbortSignal.timeout(20_000) });
  }

  #assertBaseline(view: Awaited<ReturnType<ProjectResolver["resolveActivated"]>>,
    request: RestoreRequestV1, correlationId: string): void {
    if (view.revision !== request.base_revision || view.control_revision !== request.control_revision) {
      throw new HttpError(409, "REVISION_CONFLICT", "Project or control revision moved",
        undefined, correlationId);
    }
    if (view.source_digest !== request.expected_source_digest) {
      throw new HttpError(409, "SOURCE_CHANGED", "Project source moved", undefined, correlationId);
    }
  }

  /**
   * The plan the impact authorized and the plan the restore rebuilt must be the same.
   *
   * Both the plan's hash and the rights digest are compared. A plan that moved means the
   * difference moved, and an authorization for a different difference is not an
   * authorization for this one.
   */
  #assertPlanMatchesImpact(context: RestorePlanContext, impact: { native_plan_sha256: string;
    rights_digest: string }, correlationId: string): void {
    if (context.plan.plan_sha256 !== impact.native_plan_sha256) {
      throw new HttpError(428, "IMPACT_STALE",
        "The restore plan no longer matches the impact that authorised it", undefined, correlationId);
    }
    if (context.rights.rights_digest !== impact.rights_digest) {
      throw new HttpError(428, "IMPACT_STALE",
        "The rights no longer match the impact that authorised it", undefined, correlationId);
    }
  }

  /**
   * The live re-checks at the publication boundary.
   *
   * The lock check comes first, for the same reason it does in M4B: acquiring a lock moves
   * the control revision, and the control revision is one of the facts the currentness
   * check re-reads — so a currentness check first would answer a held visual lock as a
   * stale impact, which is both less specific and less actionable.
   */
  async #finalRechecks(projectId: string, request: RestoreRequestV1, context: RestorePlanContext,
    correlationId: string): Promise<void> {
    this.#deps.locks.assertUnlocked(projectId, context.plan.required_locks);
    const finalImpact = await this.#deps.impact.requireCurrent(request.impact_id);
    const finalView = await this.#deps.resolver.resolveActivated(projectId);
    this.#assertBaseline(finalView, request, correlationId);
    const finalContext = await this.#deps.planner.plan(projectId, request.target_snapshot_id, correlationId);
    this.#assertPlanMatchesImpact(finalContext, finalImpact, correlationId);
    this.#deps.locks.assertUnlocked(projectId, finalContext.plan.required_locks);
  }

  #abort(transactionId: string, projectId: string, request: RestoreRequestV1, requestDigest: string,
    error: unknown): ControlledWriteFailureResponseV1 {
    const failure = error instanceof HttpError ? error
      : new HttpError(500, "INTERNAL_ERROR", "The controlled restore failed before publication");
    const status = [409, 422, 423, 428, 500].includes(failure.status)
      ? failure.status as 409 | 422 | 423 | 428 | 500 : 500;
    return this.#deps.revisions.abortHistoryRestore({
      transactionId, projectId, idempotencyKey: request.idempotency_key, requestDigest,
      httpStatus: status, code: failure.code, message: failure.message, details: failure.details,
    });
  }

  /**
   * Drive a prepared restore to a decision.
   *
   * The four outcomes gate §6 names, in the order the evidence decides them:
   *
   * - the active film is the *before* bytes → nothing was published → abort, revision +0;
   * - the active film is the *after* bytes → the publication happened → finish the commit;
   * - the active film is neither → terminal attention, because no later attempt can prove
   *   it either;
   * - the transaction is already terminal → replay the durable answer.
   */
  async #recoverTransaction(transactionId: string, request: RestoreRequestV1, requestDigest: string,
    correlationId: string): Promise<ControlledWriteResponseV1 | ControlledWriteFailureResponseV1> {
    const transaction = this.#deps.revisions.projectTransaction(transactionId);
    if (transaction === undefined) throw new Error("HISTORY_TRANSACTION_MISSING");
    if (transaction.state === "committed" || transaction.state === "aborted") {
      const replay = this.#deps.idempotency.recall(transaction.project_id, HISTORY_OPERATION_KIND,
        request.idempotency_key);
      if (replay === undefined) throw new Error("HISTORY_TERMINAL_REPLAY_MISSING");
      return JSON.parse(replay.response_json) as
        ControlledWriteResponseV1 | ControlledWriteFailureResponseV1;
    }
    if (transaction.state !== "prepared") {
      return this.#abort(transactionId, transaction.project_id, request, requestDigest,
        new HttpError(500, "INTERNAL_ERROR", "The restore stopped before its publication intent"));
    }
    const fact = this.#deps.history.restoreFact(transactionId);
    if (fact === undefined) throw new Error("HISTORY_PREPARED_FACT_MISSING");
    const view = await this.#deps.resolver.resolveActivated(transaction.project_id);
    const activeFilmSha = sha256(await readFile(join(view.source_root.value, "film.html")));
    if (activeFilmSha === fact.source_before_sha256) {
      await rm(join(view.source_root.value, fact.film_temp_token), { force: true }).catch(() => undefined);
      return this.#abort(transactionId, transaction.project_id, request, requestDigest,
        new HttpError(500, "INTERNAL_ERROR", "The prepared restore did not publish its author source"));
    }
    if (activeFilmSha !== fact.source_after_sha256) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "Active film matches neither restore boundary");
    }
    // The lock check comes before the recovery-current check, for the same reason it does
    // in the online path.
    const scope = await this.#deps.impact.readScope(request.impact_id);
    this.#deps.locks.assertUnlocked(transaction.project_id, scope.affected_ranges.map((range) => ({
      lock_type: "visual" as const, scope: "shot" as const, target_id: range.clip_id,
      start_frame: range.start_frame, end_frame_exclusive: range.end_frame_exclusive,
    })));
    const impact = await this.#deps.impact.requirePreparedRecoveryCurrent(transactionId,
      request.impact_id, request.impact_hash, fact.publish_intent_created_at);
    // **The plan is not rebuilt here, and it must not be.**
    //
    // The source was already published, so the *current* source now *is* the target: the
    // difference between them is empty by construction. A plan rebuilt at this moment would
    // either be empty — which the builder refuses — or, worse, a different difference from
    // the one that was authorized. The difference was proved when the impact was computed,
    // it is recorded in the immutable fact, and the impact's own plan hash has to be that
    // same hash. What the recovery re-proves is the *target's* facts, which do not move:
    // its ownership, its commitment, its bytes and its rights.
    if (impact.native_plan_sha256 !== fact.restore_plan_sha256) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "The impact's restore plan does not match the published fact");
    }
    const resolvedTarget = await this.#deps.planner.resolveTarget(transaction.project_id,
      request.target_snapshot_id, correlationId);
    if (resolvedTarget.rights.rights_digest !== fact.rights_digest) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "The rights no longer match the published fact");
    }
    const context = resolvedTarget;
    const digestRoots = [context.target.entry_root,
      ...context.target.roots.filter((root) => root !== context.target.entry_root)];
    const activeDigest = await computeSourceDigest({
      root: view.source_root.value, roots: digestRoots, engine: "openfilm",
      engineUpstreamSha: view.engine_upstream_sha,
    }, correlationId);
    if (activeDigest.source_digest !== fact.staged_source_digest) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "The published restore closure cannot be proven");
    }
    this.#deps.locks.assertUnlocked(transaction.project_id, fact.required_locks);
    this.#deps.engines.resolveVerified(transaction.project_id, view.engine_upstream_sha, correlationId);
    return this.#deps.revisions.commitHistoryRestore({
      transactionId, projectId: transaction.project_id,
      previousRevision: request.base_revision,
      expectedSourceDigest: request.expected_source_digest,
      expectedControlRevision: request.control_revision,
      snapshotId: fact.result_snapshot_id, sourceDigestAfter: fact.staged_source_digest,
      impactId: request.impact_id, impactHash: request.impact_hash,
      idempotencyKey: request.idempotency_key, requestDigest,
      projection: {
        migration_id: view.migration_id, engine_upstream_sha: view.engine_upstream_sha,
        roots_json: canonicalJson(digestRoots),
        subtitles_json: canonicalJson(context.target.subtitles),
        frame_count: context.target_projection.frame_count,
      },
      restorePlanSha256: fact.restore_plan_sha256,
    });
  }

  /**
   * Take over an unfinished restore and drive it to a decision.
   *
   * When the recovery concludes that the old write was abandoned, the answer is the
   * canonical failure body — byte for byte the body the durable replay of that key returns.
   */
  async #takeOverRecovery(unfinished: { transaction_id: string; request_hash: string;
    idempotency_key: string }, request: RestoreRequestV1,
    correlationId: string): Promise<ControlledWriteFailureResponseV1 | undefined> {
    const row = this.#deps.revisions.projectTransaction(unfinished.transaction_id);
    let value: unknown;
    try { value = JSON.parse(row?.request_json ?? "null") as unknown; }
    catch {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "The unfinished restore's request cannot be read, so it cannot be recovered",
        { transaction_id: unfinished.transaction_id }, correlationId);
    }
    const parsed = this.#parseRestoreRequest(value);
    if (parsed === undefined) {
      this.#deps.coordinator.attention(unfinished.transaction_id, "HISTORY_REQUEST_UNREADABLE",
        "the unfinished restore's request does not satisfy its contract");
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "The unfinished restore's request cannot be recovered",
        { transaction_id: unfinished.transaction_id }, correlationId);
    }
    const outcome = await this.#recoverTransaction(unfinished.transaction_id, parsed,
      unfinished.request_hash, correlationId);
    if (outcome.status === "aborted" && parsed.idempotency_key === request.idempotency_key) {
      return outcome;
    }
    return undefined;
  }

  #parseRestoreRequest(value: unknown): RestoreRequestV1 | undefined {
    if (value === null || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    if (record.format !== "narralens.restore-request@1.0") return undefined;
    if (typeof record.target_snapshot_id !== "string" || record.target_snapshot_id === "") return undefined;
    if (typeof record.impact_id !== "string" || record.impact_id === "") return undefined;
    if (typeof record.impact_hash !== "string") return undefined;
    if (typeof record.idempotency_key !== "string" || record.idempotency_key === "") return undefined;
    if (!Number.isSafeInteger(record.base_revision) || !Number.isSafeInteger(record.control_revision)) {
      return undefined;
    }
    if (typeof record.expected_source_digest !== "string") return undefined;
    const approval = record.approval as { confirmed?: unknown } | undefined;
    if (approval?.confirmed !== true) return undefined;
    return record as unknown as RestoreRequestV1;
  }

  /** The project's one unfinished restore, if it has one. */
  #unfinishedRestore(projectId: string): { transaction_id: string; request_hash: string;
    idempotency_key: string } | undefined {
    for (const transaction of this.#deps.revisions.projectTransactions(projectId)) {
      if (transaction.state !== "prepared") continue;
      if (!claimsHistoryRestore(transaction.request_json)) continue;
      let key = "";
      try { key = String((JSON.parse(transaction.request_json) as { idempotency_key?: unknown }).idempotency_key ?? ""); }
      catch { key = ""; }
      return { transaction_id: transaction.transaction_id, request_hash: transaction.request_hash,
        idempotency_key: key };
    }
    return undefined;
  }

  /**
   * Whether an *older* controlled row for the same project is still pending.
   *
   * "Controlled" means either module's: an adoption and a restore are both controlled
   * writes, and the one that was created first has to be decided first.
   */
  #olderControlledPending(transaction: { transaction_id: string; project_id: string; created_at: string }): boolean {
    for (const other of this.#deps.revisions.projectTransactions(transaction.project_id)) {
      if (other.transaction_id === transaction.transaction_id) continue;
      if (other.state === "committed" || other.state === "aborted") continue;
      if (other.created_at > transaction.created_at) continue;
      if (!claimsControlledWrite(other.request_json)) continue;
      return true;
    }
    return false;
  }

  /** Every pending controlled row of a project, whichever module owns it. */
  #controlledPendingRows(projectId: string): string[] {
    const own: string[] = [];
    for (const transaction of this.#deps.revisions.projectTransactions(projectId)) {
      if (transaction.state === "committed" || transaction.state === "aborted") continue;
      if (!claimsControlledWrite(transaction.request_json)) continue;
      own.push(transaction.transaction_id);
    }
    return own;
  }

  /**
   * Remove restore staging trees left behind by a process that died.
   *
   * The sweep runs at startup, when no restore of this process is in flight, so every
   * `restore-*` directory under the staging root is by definition an orphan of a previous
   * process.
   */
  async #sweepOrphanedStaging(): Promise<void> {
    let entries: string[];
    try { entries = await readdir(this.#deps.stagingRoot); }
    catch { return; }
    for (const entry of entries) {
      if (!entry.startsWith("restore-")) continue;
      await rm(join(this.#deps.stagingRoot, entry), { recursive: true, force: true })
        .catch(() => undefined);
    }
  }
}
