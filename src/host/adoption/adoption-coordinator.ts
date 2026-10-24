import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { AdoptRequestV1, ControlledWriteFailureResponseV1, ControlledWriteResponseV1,
  ImpactSpecV1, MaterializationV1 } from "../../contracts/wave2-types.js";
import { validateAdoptRequest } from "../../contracts/validator.js";
import { OpenFilmEngineAdapter } from "../../adapters/openfilm/openfilm-engine-adapter.js";
import { HttpError } from "../api-error.js";
import { absoluteServerPath } from "../engine/isolated-root.js";
import { canonicalJson, computeSourceDigest } from "../engine/source-digest-v1.js";
import type { EngineRegistry } from "../engine/engine-registry.js";
import type { NativeWriteGateway } from "../engine/native-write-gateway.js";
import type { ImpactService } from "../impact/impact-service.js";
import type { MaterializeService } from "../materialize/materialize-service.js";
import type { ActivatedProjectionService } from "../engine/activated-projection-service.js";
import type { MigratedAssetLedger } from "../projects/migrated-asset-ledger.js";
import type { ProjectResolver } from "../projects/project-resolver.js";
import type { LockService, AffectedLock } from "../projects/lock-service.js";
import type { ProjectCoordinator } from "../projects/project-coordinator.js";
import type { RevisionStore, AdoptionLedgerRow } from "../projects/revision-store.js";
import type { SnapshotStore } from "../projects/snapshot-store.js";
import type { OperationIdempotencyStore } from "../projects/operation-idempotency-store.js";
import { AdoptionStore, type InstalledAdoptionAsset } from "./adoption-store.js";
import { AuthorSourcePublisher } from "./author-source-publisher.js";

export interface AdoptionCoordinatorDeps {
  readonly coordinator: ProjectCoordinator;
  readonly revisions: RevisionStore;
  readonly idempotency: OperationIdempotencyStore;
  readonly resolver: ProjectResolver;
  readonly materialize: MaterializeService;
  readonly impact: ImpactService;
  readonly projections: ActivatedProjectionService;
  readonly engines: EngineRegistry;
  readonly gateway: NativeWriteGateway;
  readonly locks: LockService;
  readonly ledger: MigratedAssetLedger;
  readonly snapshots: SnapshotStore;
  readonly adoption: AdoptionStore;
  readonly publisher: AuthorSourcePublisher;
  readonly stagingRoot: string;
  /**
   * Test-only crash seams; production composition omits them.
   *
   * Gate §7 names the boundaries the crash matrix has to cover independently: received,
   * preconditions_checked, after plan, after stage, after validate, either side of the
   * snapshot rename, either side of the asset install, after the film temp fsync, either
   * side of the film rename, after the active inspect, either side of the database commit,
   * either side of the outbox insert, and before the response. The database-side ones are
   * covered by `commitAdoption`'s single transaction and its rollback matrix rather than by
   * a seam here; everything before the commit has its own seam, so the pre-publish abort
   * rule is exercised rather than merely present.
   */
  readonly fault?: (boundary: AdoptionFaultBoundary) => void | Promise<void>;
}

/** Test-only marker that models process loss: online compensation must not run. */
export class SimulatedAdoptionCrash extends Error {}

const OPERATION_KIND = "controlled_write.adopt_materialization";
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const assetToken = (digest: string) => `assets/${digest}/source.mp4`;

/** M4B's sole orchestration entry. It owns no source or database writer of its own. */
export type AdoptionFaultBoundary =
  | "after_received" | "after_preconditions" | "after_plan" | "after_stage" | "after_validate"
  | "after_snapshot_publish" | "after_prepared" | "after_published" | "after_active_inspect"
  | "after_committed";

export class AdoptionCoordinator {
  constructor(private readonly deps: AdoptionCoordinatorDeps) {}

  /**
   * The staging root this coordinator actually uses.
   *
   * Exposed so a test can *observe* the root rather than recompute it. A test that recomputes
   * it proves the derivation is pure, which is not the property that matters: what matters is
   * that the next boot sweeps the directory the previous boot wrote to.
   */
  get stagingRoot(): string { return this.deps.stagingRoot; }

  async adopt(projectId: string, request: AdoptRequestV1, correlationId = randomUUID()): Promise<ControlledWriteResponseV1 | ControlledWriteFailureResponseV1> {
    // Gate §7: every versioned edit HTTP must complete this project's unfinished M4B
    // recovery *before* it handles a replay. The unfinished transaction is named up front so
    // the recovery gate can ignore it — it is the very thing being resolved — while still
    // refusing a project that another condition has closed.
    const unfinished = this.#unfinishedAdoption(projectId);
    return await this.deps.coordinator.controlledWrite(projectId, correlationId, async () => {
      const requestJson = canonicalJson(request);
      const requestDigest = sha256(requestJson);
      if (unfinished !== undefined) {
        // Re-read inside the queue slot. The pre-read named the transaction the gate was
        // told to ignore; if the pending set has changed since, the write must not proceed
        // on a project that has another unfinished transaction.
        let pending = this.#unfinishedAdoption(projectId);
        if (pending !== undefined && pending.transaction_id !== unfinished.transaction_id) {
          throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
            "Another unfinished adoption appeared for this project",
            { transaction_id: pending.transaction_id }, correlationId);
        }
        if (pending !== undefined && pending.claims_adoption === false) {
          // The pending row is not an adoption — the legacy edit route's row. It belongs to
          // the generic recovery, so this module does not take it over.
          pending = undefined;
        }
        if (pending !== undefined) {
          // **The request's identity is settled before any recovery is taken over.**
          //
          // The pending row records the digest of the request that created it. A request
          // with the *same* digest is that transaction and may take it over. A request with
          // the same key and a *different* digest is a conflict, and answering it with the
          // old transaction's failure would give one key two different public bodies: the
          // old failure the first time, a 409 the second. A request with a *different* key
          // is a different attempt; the pending row is still this project's unfinished
          // write and still has to be recovered, but the answer belongs to this request.
          if (pending.request_hash === requestDigest) {
            const failure = await this.#takeOverRecovery(pending, request, correlationId);
            if (failure !== undefined) return failure;
          } else if (pending.idempotency_key === request.idempotency_key) {
            throw new HttpError(409, "IDEMPOTENCY_KEY_CONFLICT",
              "This idempotency key was used with a different request",
              { operation_kind: OPERATION_KIND }, correlationId);
          } else {
            // A different key: the pending row is still this project's unfinished write and
            // still has to be recovered, but the error it raises concerns *that*
            // transaction, not this request. The message says so, so the client does not
            // read the old transaction's problem as its own.
            try {
              await this.#takeOverRecovery(pending, request, correlationId);
            } catch (error) {
              if (error instanceof HttpError) {
                throw new HttpError(error.status, error.code,
                  `An unfinished adoption for this project could not be recovered: ${error.message}`,
                  { ...(error.details ?? {}), transaction_id: pending.transaction_id },
                  correlationId);
              }
              throw error;
            }
          }
        }
      }
      const replay = this.deps.idempotency.recall(projectId, OPERATION_KIND, request.idempotency_key);
      if (replay !== undefined) {
        this.deps.idempotency.assertSameRequest(replay, requestDigest, OPERATION_KIND, projectId,
          correlationId);
        return JSON.parse(replay.response_json) as ControlledWriteResponseV1 | ControlledWriteFailureResponseV1;
      }

      const view = await this.deps.resolver.resolveActivated(projectId);
      this.#assertBaseline(view, request, correlationId);
      const materialization = await this.deps.materialize.read(request.materialization_id);
      if (materialization.project_id !== projectId || materialization.state !== "ready_for_adoption"
        || materialization.native_plan === null) {
        throw new HttpError(404, "NOT_FOUND", "Materialization not found", undefined, correlationId);
      }
      const impact = await this.deps.impact.requireCurrent(request.impact_id);
      if (impact.project_id !== projectId || impact.materialization_id !== request.materialization_id
        || impact.operation !== "adopt_materialization" || impact.impact_hash !== request.impact_hash) {
        throw new HttpError(428, "IMPACT_STALE", "Impact does not authorise this adoption", undefined, correlationId);
      }
      const decision = this.deps.gateway.decide({ entry_id: "timeline.adopt_materialization",
        materialization_id: request.materialization_id, impact_id: request.impact_id,
        impact_hash: request.impact_hash, approval_confirmed: request.approval.confirmed },
      await this.deps.engines.resolve(projectId, correlationId).port.capabilities({ project_id: projectId,
        engine: "openfilm", source_digest: view.source_digest }, { correlationId, projectId,
        signal: AbortSignal.timeout(20_000) }));
      if (decision.kind !== "translated" || decision.edit.op !== "adopt_materialization") {
        throw this.deps.gateway.toHttpError(decision, correlationId);
      }
      const affected: AffectedLock[] = impact.affected_ranges.map((range) => ({ lock_type: "visual",
        scope: "shot", target_id: range.clip_id, start_frame: range.start_frame,
        end_frame_exclusive: range.end_frame_exclusive }));
      this.deps.locks.assertUnlocked(projectId, affected);

      const transactionId = this.deps.coordinator.beginTransaction({ projectId, kind: "edit",
        requestJson, requestHash: requestDigest, baseRevision: request.base_revision, correlationId });
      await this.deps.fault?.("after_received");
      this.deps.coordinator.preconditionsChecked(transactionId, view.source_digest);
      await this.deps.fault?.("after_preconditions");
      await mkdir(this.deps.stagingRoot, { recursive: true });
      const isolated = await mkdtemp(join(this.deps.stagingRoot, "adopt-"));
      try {
        const stagedInputs = await this.#stageInputs(projectId, view.source_root.value, isolated,
          materialization.native_plan.clips.map((clip) => ({ assetId: clip.asset_id, sha: clip.asset_sha256 })));
        const installed = stagedInputs.installed;
        const resolved = this.deps.engines.resolveVerified(projectId, view.engine_upstream_sha, correlationId);
        if (resolved.engine !== "openfilm" || !(resolved.port instanceof OpenFilmEngineAdapter)) {
          throw new HttpError(404, "CAPABILITY_NOT_ENABLED", "Pinned OpenFilm adapter is unavailable", undefined, correlationId);
        }
        await this.deps.projections.layoutFor(view, correlationId);
        const ctx = { correlationId, projectId, idempotencyKey: request.idempotency_key,
          baseRevision: request.base_revision, expectedSourceDigest: request.expected_source_digest,
          controlRevision: request.control_revision, isolatedRoot: absoluteServerPath(isolated),
          signal: AbortSignal.timeout(120_000) };
        const plan = await resolved.port.plan({ project_id: projectId, engine: "openfilm",
          source_digest: view.source_digest }, { edit: decision.edit, native_plan: materialization.native_plan,
          materialization_id: request.materialization_id, rights_digest: materialization.rights_digest,
          impact_hash: request.impact_hash }, ctx);
        await this.deps.fault?.("after_plan");
        const staged = await resolved.port.stage(plan, absoluteServerPath(isolated), ctx);
        this.deps.coordinator.stage(transactionId);
        await this.deps.fault?.("after_stage");
        const report = await resolved.port.validate(staged, ctx);
        if (!report.ok || report.source_digest === null || report.source_digest !== staged.source_digest) {
          throw new HttpError(422, "UNSUPPORTED_EDIT", "Staged OpenFilm adoption failed validation",
            { problems: report.problems }, correlationId);
        }
        this.deps.coordinator.validate(transactionId);
        await this.deps.fault?.("after_validate");
        const stagedRoot = await realpath(join(isolated, staged.isolated_relative_root));
        const previousLayout = await this.deps.projections.layoutFor(view, correlationId);
        const roots = [...new Set([...previousLayout.layout.roots, ...installed.map((asset) => asset.token)])].sort();
        const publishedSnapshot = await this.deps.snapshots.publish({ projectId, engine: "openfilm",
          engineUpstreamSha: view.engine_upstream_sha, sourceRoot: stagedRoot, roots });
        await this.deps.fault?.("after_snapshot_publish");
        const beforeFilm = sha256(await readFile(join(view.source_root.value, "film.html")));
        const afterFilm = sha256(await readFile(join(stagedRoot, "film.html")));
        const filmTempToken = `.narralens-${transactionId}.film.tmp`;
        this.deps.adoption.prepare({ transaction_id: transactionId, source_before_sha256: beforeFilm,
          source_after_sha256: afterFilm, staged_source_digest: staged.source_digest,
          snapshot_id: publishedSnapshot.snapshot_id, installed_assets: installed,
          film_temp_token: filmTempToken,
          publish_intent_created_at: new Date().toISOString() });
        await this.deps.fault?.("after_prepared");

        // Final, live authorization checks at the publication boundary.
        //
        // The lock check comes *first*, and that order is the point. Acquiring a lock moves
        // the control revision, and the control revision is one of the facts `requireCurrent`
        // re-reads — so a currentness check first answers a held visual lock as a stale
        // impact, which is both less specific and less actionable. Checking the locks first
        // means a visual lock is reported as `TARGET_LOCKED`, and it means the lock check is
        // the thing under test rather than a line the control check always pre-empts.
        const lockScope = await this.deps.impact.read(request.impact_id);
        this.deps.locks.assertUnlocked(projectId, lockScope.affected_ranges.map((range) => ({
          lock_type: "visual" as const, scope: "shot" as const, target_id: range.clip_id,
          start_frame: range.start_frame, end_frame_exclusive: range.end_frame_exclusive,
        })));
        const finalImpact = await this.deps.impact.requireCurrent(request.impact_id);
        const finalMaterialization = await this.deps.materialize.read(request.materialization_id);
        const finalView = await this.deps.resolver.resolveActivated(projectId);
        this.#assertBaseline(finalView, request, correlationId);
        if (finalMaterialization.state !== "ready_for_adoption"
          || finalMaterialization.rights_digest !== materialization.rights_digest
          || finalImpact.impact_hash !== impact.impact_hash) {
          throw new HttpError(428, "IMPACT_STALE", "Adoption premises moved before publication", undefined, correlationId);
        }
        this.deps.locks.assertUnlocked(projectId, affected);
        await this.deps.publisher.publish({ activeRoot: view.source_root.value, stagedRoot, transactionId,
          filmTempToken, installedAssets: installed, protectedTokens: previousLayout.layout.roots,
          expectedFilmBeforeSha256: beforeFilm,
          expectedFilmAfterSha256: afterFilm });
        await this.deps.fault?.("after_published");

        resolved.port.registerLayout(projectId, { ...previousLayout.layout, roots });
        const activeProjection = await resolved.port.inspect({ project_id: projectId, engine: "openfilm",
          source_digest: staged.source_digest }, { correlationId, projectId, signal: AbortSignal.timeout(20_000) });
        if (activeProjection.problems.length > 0 || activeProjection.source_digest !== staged.source_digest) {
          throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "Published source cannot be proven", undefined, correlationId);
        }
        await this.deps.fault?.("after_active_inspect");
        const committed = this.deps.revisions.commitAdoption({ transactionId, projectId,
          previousRevision: request.base_revision, expectedSourceDigest: request.expected_source_digest,
          expectedControlRevision: request.control_revision, snapshotId: publishedSnapshot.snapshot_id,
          sourceDigestAfter: staged.source_digest, impactId: request.impact_id, impactHash: request.impact_hash,
          idempotencyKey: request.idempotency_key, requestDigest,
          projection: { migration_id: view.migration_id, engine_upstream_sha: view.engine_upstream_sha,
            roots_json: canonicalJson(roots), subtitles_json: canonicalJson(previousLayout.layout.subtitles ?? []),
            // The adopted source's *own* length, not the project's. Recording the project's
            // value made the projection guard a tautology — it compared a copy with the
            // thing it was copied from, so it could never fail. This way the guard proves
            // that the adoption did not change the duration, which is a fact worth proving.
            frame_count: materialization.native_plan.total_frames }, ledgerRows: stagedInputs.ledgerRows,
        });
        await this.deps.fault?.("after_committed");
        return committed;
      } catch (error) {
        if (error instanceof SimulatedAdoptionCrash) throw error;
        const transaction = this.deps.revisions.projectTransaction(transactionId);
        if (transaction !== undefined && ["received", "preconditions_checked", "staged", "validated"].includes(transaction.state)) {
          return this.#abort(transactionId, projectId, request, requestDigest, error);
        }
        if (transaction?.state === "prepared") {
          const fact = this.deps.adoption.adoptionFact(transactionId);
          const current = await this.deps.resolver.resolveActivated(projectId);
          const activeFilmSha = fact === undefined ? null
            : sha256(await readFile(join(current.source_root.value, "film.html")));
          if (fact !== undefined && activeFilmSha === fact.source_before_sha256) {
            // Nothing was published: the write can be abandoned cleanly.
            return this.#abort(transactionId, projectId, request, requestDigest, error);
          }
          if (fact !== undefined && activeFilmSha !== null && activeFilmSha !== fact.source_after_sha256) {
            // The active film is neither the bytes we staged nor the bytes we prepared to
            // publish, and no future boot can prove it either — something outside the Host
            // changed it. That is a terminal condition, and it is latched *here* with its
            // reason. Leaving the row `prepared` with an empty `error_code` threw the reason
            // away and left the next boot to rediscover it from scratch.
            this.deps.coordinator.attention(transactionId, "ADOPTION_RECOVERY_UNPROVABLE",
              "Active film matches neither adoption boundary");
            throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
              "Active film matches neither adoption boundary", undefined, correlationId);
          }
          // The active film is the *after* bytes, so the publication happened and only the
          // database commit is outstanding. Gate §7 fixes the two answers for this state and
          // they are not interchangeable:
          //
          //   - a live conflict (a lock is held right now) is a *controlled* 423: not
          //     terminal, no idempotency row, and the same key may take the recovery over;
          //   - evidence that cannot be proven (the impact expired, a snapshot or an asset
          //     cannot be re-proved) is *terminal attention*: the source stays as it is and
          //     nobody retries the write automatically.
          //
          // `TRANSACTION_FAILED` 500 is reserved for the case where the source is provably
          // still `before`, so a 500 here would be the gate saying the opposite of what it
          // means.
          try {
            return await this.#recoverTransaction(transactionId, request, requestDigest, correlationId);
          } catch (recoveryError) {
            // Four different answers, because four different things can go wrong here and
            // only one of them is terminal. Latching attention for all of them used to
            // strand a *recoverable* project: a busy database or a full disk would close
            // the project for good, with no operator remedy and no retry that could help.
            //
            // - a held lock is a live conflict: the client can release it and come back;
            // - unprovable evidence (423) and a changed fact (428) are terminal, because
            //   no later attempt can prove them either;
            // - a conflict (409) means somebody else moved the project: the write simply
            //   did not happen, and the client retries against fresh facts;
            // - anything else is transient, and is reported as recoverable so a retry can
            //   try again.
            if (recoveryError instanceof HttpError) {
              if (recoveryError.code === "TARGET_LOCKED") throw recoveryError;
              if (recoveryError.code === "PROJECT_ATTENTION_REQUIRED"
                || recoveryError.code === "IMPACT_STALE") {
                this.deps.coordinator.attention(transactionId, "ADOPTION_RECOVERY_UNPROVABLE",
                  recoveryError.message);
              }
              throw recoveryError;
            }
            const reason = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
            // A missing immutable fact cannot be recovered by a later attempt either, so it
            // is latched rather than reported as a transient 503 that leaves the row
            // `prepared` forever and the project silently closed.
            if (/^(ADOPTION_[A-Z_]*MISSING|HISTORY_[A-Z_]*MISSING)$/u.test(reason)) {
              // The fact is latched as terminal, so the answer is terminal too. Telling the
              // client to retry a state that cannot be retried is worse than a 423.
              this.deps.coordinator.attention(transactionId, "ADOPTION_FACT_MISSING", reason);
              throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
                "The published adoption's immutable fact is missing", { reason }, correlationId);
            }
            throw new HttpError(503, "ENGINE_UNAVAILABLE",
              "The published adoption could not be recovered right now", { reason }, correlationId);
          }
        }
        throw error;
      } finally {
        await rm(isolated, { recursive: true, force: true }).catch(() => undefined);
      }
    }, unfinished?.transaction_id);
  }

  /**
   * The project's one unfinished adoption transaction, if it has one.
   *
   * Only `prepared` counts. A row in `received`…`validated` never published anything, and a
   * row in `attention` is decided; neither is a recovery this request could take over.
   */
  /**
   * The pending rows of *this* module for a project.
   *
   * A row is M4B's when its request claims the adopt-request format; a legacy edit row is
   * not, and it keeps blocking the gate — which is right, because the legacy module owns it.
   */
  #ownPendingRows(projectId: string): string[] {
    const own: string[] = [];
    for (const transaction of this.deps.revisions.projectTransactions(projectId)) {
      if (transaction.state === "committed" || transaction.state === "aborted") continue;
      let claims = false;
      try {
        claims = (JSON.parse(transaction.request_json) as { format?: unknown }).format
          === "narralens.adopt-request@1.0";
      } catch { claims = false; }
      if (claims) own.push(transaction.transaction_id);
    }
    return own;
  }

  #unfinishedAdoption(projectId: string): {
    transaction_id: string; request_hash: string; idempotency_key: string;
    /** Whether the row claims to be an adoption. A row that does not is not M4B's. */
    claims_adoption: boolean;
  } | undefined {
    for (const transaction of this.deps.revisions.projectTransactions(projectId)) {
      if (transaction.state !== "prepared") continue;
      let key = "";
      let claims = false;
      try {
        const parsed = JSON.parse(transaction.request_json) as
          { idempotency_key?: unknown; format?: unknown };
        key = String(parsed.idempotency_key ?? "");
        claims = parsed.format === "narralens.adopt-request@1.0";
      } catch { key = ""; claims = false; }
      return { transaction_id: transaction.transaction_id, request_hash: transaction.request_hash,
        idempotency_key: key, claims_adoption: claims };
    }
    return undefined;
  }

  /**
   * Take over an unfinished adoption and drive it to a decision.
   *
   * The controlled 423 that gate §7 names — "source=after, waiting for recovery" — is not a
   * terminal state and writes no idempotency row, so the client's next move is the same key
   * again. That request has to *recover* first, not be answered by the generic gate. A
   * recovery that completes commits and returns 200; one that cannot proves nothing and is
   * answered with the same controlled 423, with the source left as it is.
   */
  /**
   * Take over an unfinished adoption and drive it to a decision.
   *
   * The controlled 423 that gate §7 names — "source=after, waiting for recovery" — is not a
   * terminal state and writes no idempotency row, so the client's next move is the same key
   * again. That request has to *recover* first, not be answered by the generic gate. A
   * recovery that completes commits and returns 200; one that cannot proves nothing and is
   * answered with the same controlled 423, with the source left as it is.
   *
   * When the recovery concludes that the old write was *abandoned*, the answer is the
   * canonical `ControlledWriteFailureResponseV1` — byte for byte the body the durable replay
   * of that key returns. It used to be thrown as a generic `HttpError`, which the route
   * renders as `{code,message,correlation_id}`: the same key then had two different public
   * bodies, and a client validating against the frozen failure contract rejected the first
   * and accepted the second.
   *
   * A request with a *new* key is not answered with the old transaction's failure — that
   * failure belongs to the old key — and is allowed to start its own attempt.
   */
  async #takeOverRecovery(unfinished: { transaction_id: string; request_hash: string; idempotency_key: string },
    request: AdoptRequestV1, correlationId: string): Promise<ControlledWriteFailureResponseV1 | undefined> {
    const row = this.deps.revisions.projectTransaction(unfinished.transaction_id);
    let value: unknown;
    try {
      value = JSON.parse(row?.request_json ?? "null") as unknown;
    } catch {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "The unfinished adoption's request cannot be read, so it cannot be recovered",
        { transaction_id: unfinished.transaction_id }, correlationId);
    }
    const parsed = validateAdoptRequest(value);
    if (!parsed.ok) {
      // Silently giving up here would leave the old row `prepared` forever, and the next
      // boot would refuse the project for it. The row is latched instead, so it is a decided
      // state rather than one the generic recovery would strand.
      this.deps.coordinator.attention(unfinished.transaction_id, "ADOPTION_REQUEST_UNREADABLE",
        "the unfinished adoption's request does not satisfy its contract");
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "The unfinished adoption's request cannot be recovered",
        { transaction_id: unfinished.transaction_id }, correlationId);
    }
    const outcome = await this.#recoverTransaction(unfinished.transaction_id, parsed.value,
      unfinished.request_hash, correlationId);
    if (outcome.status === "aborted"
      && parsed.value.idempotency_key === request.idempotency_key) {
      return outcome;
    }
    return undefined;
  }

  /**
   * Runs before generic journal recovery and takes every unfinished M4B row terminal.
   *
   * Two properties this method has to have, and both were defects:
   *
   * - **One blocked project must not stop the Host.** A transaction already in `attention` is
   *   terminal by the state machine and has nothing left to recover, so it is skipped. And
   *   the recovery gate's refusal — which is what a latched project produces — is caught
   *   here rather than allowed to escape. It used to escape, and it escaped `listen()` with
   *   it, so a single latched project took every other project in the deployment down with
   *   it: the Host could not start a second time.
   * - **An unprovable boundary must be decided, not rediscovered.** When the active film
   *   matches neither the pre-publication nor the post-publication bytes, no future boot can
   *   prove it either. That is latched as terminal attention with its reason, instead of
   *   leaving the row `prepared` with an empty `error_code` for the next boot to trip over.
   */
  async recoverOnStart(): Promise<{ recovered: number; aborted: number; attention: number }> {
    const report = { recovered: 0, aborted: 0, attention: 0 };
    await this.#sweepOrphanedStaging();
    for (const transaction of this.deps.revisions.incompleteTransactions()) {
      if (transaction.state === "attention") {
        // Terminal by the state machine: there is no outgoing edge and nothing to recover.
        report.attention += 1;
        continue;
      }
      // **Only a row that claims to be an adoption is M4B's to decide.**
      //
      // The legacy edit route writes `project_transaction` rows with a non-adoption
      // `request_json`, and the generic recovery — which gate §7 orders *after* this one —
      // owns them. Deciding them here would make one module answer for another's
      // transaction, with a reason that is false about a perfectly readable request.
      //
      // A row that cannot be parsed at all is a different case: it *may* be M4B's, and the
      // generic recovery would move a pre-publish row to `recovering`, which has no legal
      // outgoing edge. So an unreadable row is latched, and a readable non-adoption row is
      // left alone.
      let value: unknown;
      let readable = true;
      try { value = JSON.parse(transaction.request_json); } catch { readable = false; }
      if (!readable) {
        // The request cannot be read. That *may* be M4B's row, and leaving it for the
        // generic recovery would move it to `recovering`, which has no legal outgoing edge.
        this.deps.coordinator.attention(transaction.transaction_id, "ADOPTION_REQUEST_UNREADABLE",
          "the unfinished adoption's request cannot be read");
        report.attention += 1;
        continue;
      }
      // **Only a row that claims to be an adoption is M4B's to decide.**
      //
      // The legacy edit route writes `project_transaction` rows with a non-adoption
      // `request_json`, and the generic recovery — which gate §7 orders *after* this one —
      // owns them. Deciding them here would make one module answer for another's
      // transaction, with a reason that is false about a perfectly readable request.
      const claimsAdoption = (value as { format?: unknown } | null)?.format
        === "narralens.adopt-request@1.0";
      if (!claimsAdoption) continue;
      const parsed = validateAdoptRequest(value);
      if (!parsed.ok) {
        // It is M4B's row and it cannot be recovered. Latching it is a decided state, and
        // the generic recovery would have moved it to `recovering` — which has no legal
        // outgoing edge, and TX-08B forbids leaving one.
        this.deps.coordinator.attention(transaction.transaction_id, "ADOPTION_REQUEST_UNREADABLE",
          "the unfinished adoption's request does not satisfy its contract");
        report.attention += 1;
        continue;
      }
      // Every one of *this* module's own pending rows for the project is excluded from the
      // recovery gate. A recovery that is blocked by its own sibling rows could never
      // resolve them: the gate sees a pending transaction, refuses, and the row it was
      // supposed to recover stays exactly as it was.
      const ownRows = this.#ownPendingRows(transaction.project_id);
      try {
        await this.deps.coordinator.controlledRecovery(transaction.project_id, transaction.transaction_id,
          transaction.correlation_id, async () => {
          try {
            const outcome = await this.#recoverTransaction(transaction.transaction_id, parsed.value,
              transaction.request_hash, transaction.correlation_id);
            if (outcome.status === "committed") report.recovered += 1;
            else report.aborted += 1;
          } catch (error) {
            const current = this.deps.revisions.projectTransaction(transaction.transaction_id);
            // Only evidence that cannot be proven, or a fact that changed, is terminal. A
            // held lock will clear and a transient failure may not reproduce, so latching
            // either of them closes a project a later boot could have recovered.
            // A missing immutable fact is unrecoverable by any later attempt, so it is
            // terminal even though it is not an `HttpError`: leaving the row `prepared`
            // would close the project with nothing in `projectsInAttention()`.
            const missingFact = error instanceof Error
              && /^(ADOPTION_[A-Z_]*MISSING|HISTORY_[A-Z_]*MISSING)$/u.test(error.message);
            const terminal = missingFact || (error instanceof HttpError
              && (error.code === "PROJECT_ATTENTION_REQUIRED" || error.code === "IMPACT_STALE"));
            if (terminal && current !== undefined && current.state !== "attention") {
              this.deps.coordinator.attention(transaction.transaction_id, "ADOPTION_RECOVERY_UNPROVABLE",
                error instanceof Error ? error.message : String(error));
            }
            report.attention += 1;
          }
        }, ownRows);
      } catch (error) {
        // The recovery gate refused: something else is in the way for this project. That is
        // this transaction's problem to wait for, not a reason to refuse to serve the rest
        // of the deployment, and not a reason to throw out of startup.
        //
        // The row is latched terminal, with its reason, and the project with it.
        //
        // The gate refuses because *another module's* transaction is pending — this module's
        // own rows are excluded, so a recovery is never blocked by the rows it is about to
        // resolve. A foreign pending row is the generic recovery's to resolve, and the
        // generic recovery would move this row to `recovering`, a state with no legal
        // outgoing edge. Latching it here instead makes the condition visible: the project is
        // closed, and `projectsInAttention()` names why. The closure is permanent — no M4B
        // path clears `attention` — which is the price of a decided state over a stranded
        // one.
        report.attention += 1;
        // The row is latched as a terminal state with its reason. Leaving it alone would let
        // the generic recovery move it to `recovering` — which has no legal outgoing edge,
        // the very outcome TX-08B forbids — and the project would be closed silently, with
        // nothing in `projectsInAttention()` naming why. Latching it makes the condition
        // visible; the project is closed either way, because the foreign row that blocks it
        // belongs to another module's recovery.
        this.deps.coordinator.attention(transaction.transaction_id, "ADOPTION_RECOVERY_BLOCKED",
          error instanceof Error ? error.message : String(error));
      }
    }
    return report;
  }

  /**
   * Remove adoption staging trees left behind by a process that died.
   *
   * A crash cannot run the `finally` that removes the isolated tree, so every hard kill left
   * a full copy of the source plus its input media on disk with nothing that would ever
   * reclaim it — the staging path is not in the adoption fact, which is immutable. The
   * sweep runs at startup, when no adoption of this process is in flight, so every
   * `adopt-*` directory under the staging root is by definition an orphan of a previous
   * process. Under the frozen "one Host, one database" architecture there is no second
   * process whose in-flight tree this could delete.
   */
  async #sweepOrphanedStaging(): Promise<void> {
    let entries: string[];
    try { entries = await readdir(this.deps.stagingRoot); }
    catch { return; }
    for (const entry of entries) {
      if (!entry.startsWith("adopt-")) continue;
      await rm(join(this.deps.stagingRoot, entry), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  #abort(transactionId: string, projectId: string, request: AdoptRequestV1, requestDigest: string,
    error: unknown): ControlledWriteFailureResponseV1 {
    const failure = error instanceof HttpError ? error
      : new HttpError(500, "INTERNAL_ERROR", "Controlled adoption failed before publication");
    const status = [409, 422, 423, 428, 500].includes(failure.status)
      ? failure.status as 409 | 422 | 423 | 428 | 500 : 500;
    return this.deps.revisions.abortAdoption({ transactionId, projectId,
      idempotencyKey: request.idempotency_key, requestDigest, httpStatus: status,
      code: failure.code, message: failure.message, details: failure.details });
  }

  async #recoverTransaction(transactionId: string, request: AdoptRequestV1, requestDigest: string,
    correlationId: string): Promise<ControlledWriteResponseV1 | ControlledWriteFailureResponseV1> {
    const transaction = this.deps.revisions.projectTransaction(transactionId);
    if (transaction === undefined) throw new Error("ADOPTION_TRANSACTION_MISSING");
    if (transaction.state === "committed" || transaction.state === "aborted") {
      const replay = this.deps.idempotency.recall(transaction.project_id, OPERATION_KIND, request.idempotency_key);
      if (replay === undefined) throw new Error("ADOPTION_TERMINAL_REPLAY_MISSING");
      return JSON.parse(replay.response_json) as ControlledWriteResponseV1 | ControlledWriteFailureResponseV1;
    }
    if (transaction.state !== "prepared") {
      return this.#abort(transactionId, transaction.project_id, request, requestDigest,
        new HttpError(500, "INTERNAL_ERROR", "Adoption stopped before its publication intent"));
    }
    const fact = this.deps.adoption.adoptionFact(transactionId);
    if (fact === undefined) throw new Error("ADOPTION_PREPARED_FACT_MISSING");
    const view = await this.deps.resolver.resolveActivated(transaction.project_id);
    const activeFilmSha = sha256(await readFile(join(view.source_root.value, "film.html")));
    if (activeFilmSha === fact.source_before_sha256) {
      await rm(join(view.source_root.value, fact.film_temp_token), { force: true }).catch(() => undefined);
      return this.#abort(transactionId, transaction.project_id, request, requestDigest,
        new HttpError(500, "INTERNAL_ERROR", "Prepared adoption did not publish its author source"));
    }
    if (activeFilmSha !== fact.source_after_sha256) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "Active film matches neither adoption boundary");
    }
    // The lock check comes before the recovery-current check, for the same reason it does in
    // the online path: acquiring a lock moves the control revision, and the control revision
    // is one of the facts the recovery-current check re-reads. A currentness check first would
    // answer a held visual lock as a stale impact and would never reach the lock check at all.
    //
    // It also decides the two different answers gate §7 wants for "source=after". A held lock
    // is a *live* conflict — the client can release it and retry, so it is a controlled 423
    // and the transaction stays `prepared`. An impact that expired or a fact that moved is
    // terminal, and the recovery-current check below is what says so.
    const scope = await this.deps.impact.readScope(request.impact_id);
    this.deps.locks.assertUnlocked(transaction.project_id, scope.affected_ranges.map((range) => ({
      lock_type: "visual" as const, scope: "shot" as const, target_id: range.clip_id,
      start_frame: range.start_frame, end_frame_exclusive: range.end_frame_exclusive,
    })));
    const impact = await this.deps.impact.requirePreparedRecoveryCurrent(transactionId,
      request.impact_id, request.impact_hash, fact.publish_intent_created_at);
    const materialization = await this.deps.materialize.read(request.materialization_id);
    this.#assertRecoveryReferences(view, request, impact, materialization, fact.snapshot_id, correlationId);
    const previous = await this.deps.projections.layoutFor(view, correlationId);
    const roots = [...new Set([...previous.layout.roots, ...fact.installed_assets.map((asset) => asset.token)])].sort();
    for (const asset of fact.installed_assets) {
      if (sha256(await readFile(join(view.source_root.value, asset.token))) !== asset.sha256) {
        throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "Published adoption asset cannot be proven");
      }
    }
    const activeDigest = await computeSourceDigest({ root: view.source_root.value, roots,
      engine: "openfilm", engineUpstreamSha: view.engine_upstream_sha }, correlationId);
    if (activeDigest.source_digest !== fact.staged_source_digest) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "Published adoption closure cannot be proven");
    }
    const snapshotDigest = await computeSourceDigest({
      root: join(this.deps.snapshots.snapshotRoot(transaction.project_id, fact.snapshot_id), "source"), roots,
      engine: "openfilm", engineUpstreamSha: view.engine_upstream_sha,
    }, correlationId);
    if (snapshotDigest.source_digest !== fact.staged_source_digest) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "Adoption snapshot cannot be proven");
    }
    const affected: AffectedLock[] = impact.affected_ranges.map((range) => ({ lock_type: "visual",
      scope: "shot", target_id: range.clip_id, start_frame: range.start_frame,
      end_frame_exclusive: range.end_frame_exclusive }));
    this.deps.locks.assertUnlocked(transaction.project_id, affected);
    this.deps.engines.resolveVerified(transaction.project_id, view.engine_upstream_sha, correlationId);
    const ledgerRows = this.#ledgerRows(transaction.project_id, materialization);
    return this.deps.revisions.commitAdoption({ transactionId, projectId: transaction.project_id,
      previousRevision: request.base_revision, expectedSourceDigest: request.expected_source_digest,
      expectedControlRevision: request.control_revision, snapshotId: fact.snapshot_id,
      sourceDigestAfter: fact.staged_source_digest, impactId: request.impact_id, impactHash: request.impact_hash,
      idempotencyKey: request.idempotency_key, requestDigest,
      projection: { migration_id: view.migration_id, engine_upstream_sha: view.engine_upstream_sha,
        roots_json: canonicalJson(roots), subtitles_json: canonicalJson(previous.layout.subtitles ?? []),
        // The adopted source's own length, for the same reason as the online path.
        frame_count: materialization.native_plan?.total_frames ?? view.frame_count }, ledgerRows,
    });
  }

  #assertRecoveryReferences(view: Awaited<ReturnType<ProjectResolver["resolveActivated"]>>,
    request: AdoptRequestV1, impact: ImpactSpecV1, materialization: MaterializationV1,
    snapshotId: string, correlationId: string): void {
    this.#assertBaseline(view, request, correlationId);
    if (impact.project_id !== view.project_id || impact.materialization_id !== request.materialization_id
      || impact.impact_hash !== request.impact_hash || materialization.project_id !== view.project_id
      || materialization.state !== "ready_for_adoption" || materialization.native_plan === null
      || snapshotId === "") {
      throw new HttpError(428, "IMPACT_STALE", "Prepared adoption references no longer agree");
    }
  }

  #ledgerRows(projectId: string, materialization: MaterializationV1): AdoptionLedgerRow[] {
    const rows: AdoptionLedgerRow[] = [];
    const existing = this.deps.ledger.assets(projectId);
    for (const clip of materialization.native_plan?.clips ?? []) {
      const token = assetToken(clip.asset_sha256);
      if (existing.some((candidate) => candidate.target_path === token)
        || rows.some((candidate) => candidate.target_path === token)) continue;
      const row = this.deps.ledger.get(projectId, clip.asset_id);
      if (row === undefined || row.target_sha256 !== clip.asset_sha256) throw new Error("ADOPTION_LEDGER_SOURCE_MISSING");
      rows.push({ asset_id: `adopted_${clip.asset_sha256.slice(0, 32)}`, migration_id: row.migration_id,
        source_project_id: row.source_project_id, source_manifest_sha256: row.source_manifest_sha256,
        source_path: row.source_path, target_path: token, source_sha256: row.source_sha256,
        target_sha256: clip.asset_sha256, duration_frames: row.duration_frames, media_type: row.media_type,
        source_json: canonicalJson(row.source), license_json: canonicalJson(row.license) });
    }
    return rows;
  }

  #assertBaseline(view: Awaited<ReturnType<ProjectResolver["resolveActivated"]>>, request: AdoptRequestV1,
    correlationId: string): void {
    if (view.revision !== request.base_revision || view.control_revision !== request.control_revision) {
      throw new HttpError(409, "REVISION_CONFLICT", "Project or control revision moved", undefined, correlationId);
    }
    if (view.source_digest !== request.expected_source_digest) {
      throw new HttpError(409, "SOURCE_CHANGED", "Project source moved", undefined, correlationId);
    }
  }

  async #stageInputs(projectId: string, activeRoot: string, isolated: string,
    refs: readonly { assetId: string; sha: string }[]): Promise<{
      installed: InstalledAdoptionAsset[]; ledgerRows: AdoptionLedgerRow[];
    }> {
    const installed: InstalledAdoptionAsset[] = [];
    const ledgerRows: AdoptionLedgerRow[] = [];
    const seen = new Set<string>();
    const existing = this.deps.ledger.assets(projectId);
    for (const ref of refs) {
      if (seen.has(ref.sha)) continue;
      const row = this.deps.ledger.get(projectId, ref.assetId);
      if (row === undefined || row.target_sha256 !== ref.sha
        || row.license.status !== "cleared" || !row.license.commercial_use) {
        throw new HttpError(422, "MISSING_ASSET", "Adoption asset is absent, changed, or not licensed", { asset_id: ref.assetId });
      }
      const source = resolve(activeRoot, row.target_path);
      const root = resolve(activeRoot);
      if (!source.startsWith(`${root}${sep}`) || sha256(await readFile(source)) !== ref.sha) {
        throw new HttpError(409, "SOURCE_CHANGED", "Adoption asset bytes moved before staging", { asset_id: ref.assetId });
      }
      const token = assetToken(ref.sha);
      const input = join(isolated, "inputs", ref.sha, "source.mp4");
      await mkdir(dirname(input), { recursive: true });
      await copyFile(source, input);
      installed.push({ token, sha256: ref.sha });
      if (!existing.some((candidate) => candidate.target_path === token)) {
        ledgerRows.push({ asset_id: `adopted_${ref.sha.slice(0, 32)}`, migration_id: row.migration_id,
          source_project_id: row.source_project_id, source_manifest_sha256: row.source_manifest_sha256,
          source_path: row.source_path, target_path: token, source_sha256: row.source_sha256,
          target_sha256: ref.sha, duration_frames: row.duration_frames, media_type: row.media_type,
          source_json: canonicalJson(row.source), license_json: canonicalJson(row.license) });
      }
      seen.add(ref.sha);
    }
    return { installed, ledgerRows };
  }
}
