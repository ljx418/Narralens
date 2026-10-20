import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
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
  /** Test-only crash seam; production composition omits it. */
  readonly fault?: (boundary: "after_prepared" | "after_published" | "after_committed") => void | Promise<void>;
}

/** Test-only marker that models process loss: online compensation must not run. */
export class SimulatedAdoptionCrash extends Error {}

const OPERATION_KIND = "controlled_write.adopt_materialization";
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const assetToken = (digest: string) => `assets/${digest}/source.mp4`;

/** M4B's sole orchestration entry. It owns no source or database writer of its own. */
export class AdoptionCoordinator {
  constructor(private readonly deps: AdoptionCoordinatorDeps) {}

  async adopt(projectId: string, request: AdoptRequestV1, correlationId = randomUUID()): Promise<ControlledWriteResponseV1 | ControlledWriteFailureResponseV1> {
    return await this.deps.coordinator.controlledWrite(projectId, correlationId, async () => {
      const requestJson = canonicalJson(request);
      const requestDigest = sha256(requestJson);
      const replay = this.deps.idempotency.recall(projectId, OPERATION_KIND, request.idempotency_key);
      if (replay !== undefined) {
        this.deps.idempotency.assertSameRequest(replay, requestDigest, OPERATION_KIND, projectId);
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
      this.deps.coordinator.preconditionsChecked(transactionId, view.source_digest);
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
        const staged = await resolved.port.stage(plan, absoluteServerPath(isolated), ctx);
        this.deps.coordinator.stage(transactionId);
        const report = await resolved.port.validate(staged, ctx);
        if (!report.ok || report.source_digest === null || report.source_digest !== staged.source_digest) {
          throw new HttpError(422, "UNSUPPORTED_EDIT", "Staged OpenFilm adoption failed validation",
            { problems: report.problems }, correlationId);
        }
        this.deps.coordinator.validate(transactionId);
        const stagedRoot = await realpath(join(isolated, staged.isolated_relative_root));
        const previousLayout = await this.deps.projections.layoutFor(view, correlationId);
        const roots = [...new Set([...previousLayout.layout.roots, ...installed.map((asset) => asset.token)])].sort();
        const publishedSnapshot = await this.deps.snapshots.publish({ projectId, engine: "openfilm",
          engineUpstreamSha: view.engine_upstream_sha, sourceRoot: stagedRoot, roots });
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
        const committed = this.deps.revisions.commitAdoption({ transactionId, projectId,
          previousRevision: request.base_revision, expectedSourceDigest: request.expected_source_digest,
          expectedControlRevision: request.control_revision, snapshotId: publishedSnapshot.snapshot_id,
          sourceDigestAfter: staged.source_digest, impactId: request.impact_id, impactHash: request.impact_hash,
          idempotencyKey: request.idempotency_key, requestDigest,
          projection: { migration_id: view.migration_id, engine_upstream_sha: view.engine_upstream_sha,
            roots_json: canonicalJson(roots), subtitles_json: canonicalJson(previousLayout.layout.subtitles ?? []),
            frame_count: view.frame_count }, ledgerRows: stagedInputs.ledgerRows,
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
          return await this.#recoverTransaction(transactionId, request, requestDigest, correlationId);
        }
        throw error;
      } finally {
        await rm(isolated, { recursive: true, force: true }).catch(() => undefined);
      }
    });
  }

  /** Runs before generic journal recovery and takes every unfinished M4B row terminal. */
  async recoverOnStart(): Promise<{ recovered: number; aborted: number; attention: number }> {
    const report = { recovered: 0, aborted: 0, attention: 0 };
    for (const transaction of this.deps.revisions.incompleteTransactions()) {
      let value: unknown;
      try { value = JSON.parse(transaction.request_json); } catch { continue; }
      const parsed = validateAdoptRequest(value);
      if (!parsed.ok) continue;
      await this.deps.coordinator.controlledRecovery(transaction.project_id, transaction.transaction_id,
        transaction.correlation_id, async () => {
        try {
          const outcome = await this.#recoverTransaction(transaction.transaction_id, parsed.value,
            transaction.request_hash, transaction.correlation_id);
          if (outcome.status === "committed") report.recovered += 1;
          else report.aborted += 1;
        } catch (error) {
          const current = this.deps.revisions.projectTransaction(transaction.transaction_id);
          if (current !== undefined && current.state !== "attention") {
            this.deps.coordinator.attention(transaction.transaction_id, "ADOPTION_RECOVERY_UNPROVABLE",
              error instanceof Error ? error.message : String(error));
          }
          report.attention += 1;
        }
      });
    }
    return report;
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
        frame_count: view.frame_count }, ledgerRows,
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
