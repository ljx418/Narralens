import { createHash, randomUUID } from "node:crypto";
import { HttpError } from "../api-error.js";
import { canonicalJson } from "../engine/source-digest-v1.js";
import type { EngineRegistry } from "../engine/engine-registry.js";
import type { ActivatedProjectionService } from "../engine/activated-projection-service.js";
import type { MaterializationStore } from "../materialize/materialization-store.js";
import type { MaterializeService } from "../materialize/materialize-service.js";
import type { AssetInventoryPort } from "../projects/asset-inventory-port.js";
import type { LockService } from "../projects/lock-service.js";
import type { MigratedAssetLedger, MigratedAssetRecord } from "../projects/migrated-asset-ledger.js";
import type { MigrationStore } from "../projects/migration-store.js";
import type { OperationIdempotencyStore } from "../projects/operation-idempotency-store.js";
import type { ProjectOperationQueue } from "../projects/project-operation-queue.js";
import type { ActivatedProjectView, ProjectResolver } from "../projects/project-resolver.js";
import { buildConsumerGraph } from "../projects/consumer-graph.js";
import type { MigrationPlanV1 } from "../../contracts/migration-types.js";
import type {
  ImpactRequestV1, ImpactSpecV1, LockChecked, MaterializationV1,
} from "../../contracts/wave2-types.js";
import { ImpactStore } from "./impact-store.js";
import { computeImpactHash, impactExpiry, isExpired, sortImpactArrays, verifyImpactHash } from "./impact-canonical.js";
import type { RestorePlanner } from "../history/restore-planner.js";

/**
 * ImpactService (ADR-W2.0-004 §5).
 *
 * The order of the checks below *is* the contract. Each one exists because a later step
 * would otherwise be able to assume something an earlier one has not established:
 *
 * ```
 * resolveActivated → idempotent replay/conflict → base/source/control
 *   → inspect the committed snapshot → re-verify the materialization
 *   → asset/rights/bytes → consumer graph → locks → second currentness → insert
 * ```
 *
 * The read barrier (`operations.run`) wraps the whole thing, so a lock acquired, a source
 * edited or a materialization marked stale by another request cannot interleave with the
 * reads this service makes.
 *
 * What the service deliberately does **not** do is compute anything from the request. The
 * request carries a base, a source digest, a control revision, an intent and an idempotency
 * key; the base/source/control in the *spec* are the Host's own readings, and the request's
 * three revision fields are only ever compared against them.
 */

/** `locks_checked` records every active lock the read saw; past this the contract cannot hold it. */
const MAX_LOCKS_CHECKED = 64;

export interface ImpactServiceDeps {
  readonly resolver: ProjectResolver;
  readonly operations: ProjectOperationQueue;
  readonly engines: EngineRegistry;
  readonly projections: ActivatedProjectionService;
  readonly materializations: MaterializationStore;
  readonly materialize: MaterializeService;
  readonly inventory: AssetInventoryPort;
  readonly locks: LockService;
  readonly ledger: MigratedAssetLedger;
  readonly migrations: MigrationStore;
  readonly impacts: ImpactStore;
  readonly idempotency: OperationIdempotencyStore;
  /**
   * M4C's planner. Absent in a Host that has no history capability, and then the restore
   * arm stays closed — the M4A red light, kept.
   */
  readonly planner?: RestorePlanner | undefined;
  /** Injected so TTL is a decision, not a side effect of the machine's speed. */
  readonly clock: () => Date;
  readonly correlationId: () => string;
  /**
   * Test-only seam for the race matrix. Fired at named boundaries so a check can be proved
   * to happen *after* a premise was read and *before* the row is written, which is the only
   * way to show that such a change leaves no active impact behind.
   */
  readonly fault?: (point: string) => Promise<void> | void;
}

export interface CreateImpactResult {
  readonly status: 201;
  readonly spec: ImpactSpecV1;
  readonly replayed: boolean;
}

/**
 * The digest an idempotency key is bound to.
 *
 * Computed over the request with `idempotency_key` removed: the key names the request, so
 * including it would make the digest trivially unique per key and the comparison between a
 * replay and a new request would prove nothing.
 */
export function impactRequestDigest(request: ImpactRequestV1): string {
  const { idempotency_key, ...rest } = request;
  void idempotency_key;
  return createHash("sha256").update("narralens-impact-request-v1\n")
    .update(canonicalJson(rest)).digest("hex");
}

export class ImpactService {
  readonly #deps: ImpactServiceDeps;

  constructor(deps: ImpactServiceDeps) { this.#deps = deps; }

  /**
   * `POST /api/migration/v1/projects/:id/impact`.
   *
   * Returns 201 both when it computed a fresh spec and when it replayed one, because the
   * client's request — "give me the authorization for this intent at this base" — has the
   * same answer either way. What differs is that a replay never extends the window: the
   * original expiry is returned unchanged, so an expired authorization cannot be revived by
   * asking again with the same key.
   */
  async create(projectId: string, request: ImpactRequestV1): Promise<CreateImpactResult> {
    const requestDigest = impactRequestDigest(request);
    const operationKind = ImpactStore.operationKindFor(request.intent.op);
    const now = this.#deps.clock();
    const correlationId = this.#deps.correlationId();

    return await this.#deps.operations.run(projectId, async () => {
      // ── 1. the project, resolved from durable facts ──────────────────────────────────
      const view = await this.#deps.resolver.resolveActivated(projectId);

      // ── 2. idempotency: replay or conflict, decided before any side effect ──────────
      const remembered = this.#deps.idempotency.recall(projectId, operationKind, request.idempotency_key);
      if (remembered !== undefined) {
        this.#deps.idempotency.assertSameRequest(remembered, requestDigest, operationKind,
          projectId, correlationId);
        const spec = await this.#replay(JSON.parse(remembered.response_json) as ImpactSpecV1, now);
        return { status: 201, spec, replayed: true };
      }

      // ── 3. the client's three revision fields are compared, never trusted ────────────
      if (request.base_revision !== view.revision) {
        throw new HttpError(409, "REVISION_CONFLICT", "The project has moved since this request was prepared",
          { expected: view.revision, supplied: request.base_revision }, projectId);
      }
      if (request.expected_source_digest !== view.source_digest) {
        throw new HttpError(409, "SOURCE_CHANGED", "The source has changed since this request was prepared",
          undefined, projectId);
      }
      if (request.control_revision !== view.control_revision) {
        throw new HttpError(409, "REVISION_CONFLICT", "The control revision has moved since this request was prepared",
          { expected: view.control_revision, supplied: request.control_revision }, projectId);
      }

      // The id is allocated before the spec is hashed, so the hash covers the id the client
      // will echo back. Allocating it afterwards would make the stored hash describe a
      // different spec than the one returned.
      const impactId = `imp_${randomUUID().replaceAll("-", "")}`;
      const spec = await this.#compute(projectId, view, request, impactId, correlationId, now);

      // ── 4. one transaction: the impact row and its idempotent response ───────────────
      const created = this.#deps.impacts.create({
        impactId, projectId, operation: request.intent.op,
        referenceId: this.#referenceOf(request), requestDigest, spec, now,
      }, (stored) => {
        this.#deps.idempotency.record({
          projectId, operationKind, idempotencyKey: request.idempotency_key,
          requestDigest, response: stored, transactionId: impactId, now,
        });
      });
      return { status: 201, spec: created.response, replayed: false };
    });
  }

  #referenceOf(request: ImpactRequestV1): string {
    return request.intent.op === "adopt_materialization"
      ? request.intent.materialization_id
      : request.intent.target_snapshot_id;
  }

  /**
   * A replay is still a use, so it still has to pass every gate the original passed.
   *
   * Re-verifying here is what stops "the row says active" from being a reason to trust it:
   * the spec's hash is recomputed, its TTL checked against the injected clock, and the
   * project's current facts re-read. Anything that moved produces 428, not a fresh
   * authorization, and never a renewed window.
   */
  async #replay(spec: ImpactSpecV1, now: Date): Promise<ImpactSpecV1> {
    // The impact row's own state gates the replay. The spec above came from the *idempotency*
    // response, which is a different column from the impact row's canonical bytes, and a row
    // that has gone stale or — in M4B — consumed moves no revision and no source. Without
    // this check a spent authorization replays as fresh, which is the one thing an
    // authorization must never do.
    const row = this.#deps.impacts.require(spec.impact_id);
    if (row.state !== "active") {
      throw new HttpError(428, "IMPACT_STALE",
        `The impact is ${row.state} and can no longer authorise a write`,
        { impact_id: spec.impact_id, state: row.state }, spec.project_id);
    }
    if (!verifyImpactHash(spec)) {
      throw new HttpError(428, "IMPACT_STALE", "The stored impact does not match its own hash",
        { impact_id: spec.impact_id });
    }
    if (isExpired(spec.expires_at, now)) {
      // The row's own state is corrected here rather than merely reported, so the next
      // reader sees an expired impact rather than an active one with a past deadline.
      this.#deps.impacts.markExpired(spec.impact_id, now);
      throw new HttpError(428, "IMPACT_STALE", "The impact has expired; request a new one with a new key",
        { impact_id: spec.impact_id });
    }
    const current = await this.#deps.resolver.resolveActivated(spec.project_id);
    try {
      await this.#assertSpecStillCurrent(spec, current, now);
    } catch (error) {
      if (error instanceof HttpError && error.code === "IMPACT_STALE") {
        this.#deps.impacts.markStale(spec.impact_id, now);
      }
      throw error;
    }
    return spec;
  }

  /**
   * Build the spec from facts read now.
   *
   * The `engine_upstream_sha` and every revision come from `ActivatedProjectView`, never
   * from the projection. The projection's `snapshot_id` is a digest-derived value and its
   * two revision fields are compatibility zeros; treating either as Host authority would
   * make an impact computable against a project that has moved.
   */
  async #compute(projectId: string, view: ActivatedProjectView, request: ImpactRequestV1,
    impactId: string, correlationId: string, now: Date): Promise<ImpactSpecV1> {
    if (request.intent.op === "restore_snapshot") {
      return await this.#computeRestore(projectId, view, request, impactId, correlationId, now);
    }

    // ── the committed projection, rebuilt from durable facts ──────────────────────────
    // `layoutFor` also hands the rebuilt layout to the adapter, so the projection below is
    // the Host's own view of the committed target rather than a test-registered one.
    await this.#deps.projections.layoutFor(view, correlationId);
    const resolved = this.#deps.engines.resolve(projectId);
    const ctx = { correlationId, projectId, signal: AbortSignal.timeout(20_000) };
    const projection = await resolved.port.inspect({
      project_id: projectId, engine: "openfilm", source_digest: view.source_digest,
    }, ctx);
    await this.#deps.fault?.("after_inspect");

    // ── the materialization, re-verified rather than trusted ──────────────────────────
    const row = await this.#readMaterialization(projectId, request.intent.materialization_id);
    if (row.state !== "ready_for_adoption") {
      throw new HttpError(422, "INVALID_REQUEST",
        "Only a materialization that is ready for adoption can be assessed for impact",
        { materialization_id: row.materialization_id, state: row.state }, projectId);
    }
    if (row.native_plan === null) {
      throw new HttpError(422, "INVALID_REQUEST", "The materialization has no native plan",
        undefined, projectId);
    }
    if (row.base_revision !== view.revision || row.source_digest !== view.source_digest
      || row.control_revision !== view.control_revision) {
      throw new HttpError(409, "REVISION_CONFLICT",
        "The materialization was prepared against different project facts", undefined, projectId);
    }

    // ── assets, rights and bytes, re-read from the ledger ─────────────────────────────
    const inventory = await this.#deps.inventory.inventory(projectId);
    if (inventory.inventory_sha256 !== row.asset_inventory_sha256) {
      throw new HttpError(409, "REVISION_CONFLICT",
        "The project's assets or rights have changed since the materialization was prepared",
        undefined, projectId);
    }

    // ── the consumer graph ────────────────────────────────────────────────────────────
    const plan = this.#deps.migrations.plan(view.migration_id);
    if (plan === undefined) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "The migration plan is missing",
        undefined, projectId);
    }
    const graph = buildConsumerGraph({
      projection,
      plan: row.native_plan,
      ledgerAssets: this.#ledgerAssets(projectId),
      narrationTargetPath: this.#narrationTargetPath(plan, projectId),
      frameCount: view.frame_count,
    }, projectId);
    await this.#deps.fault?.("after_graph");

    // ── locks: the real change, computed by the Host ─────────────────────────────────
    const activeLocks = this.#deps.locks.activeLocks(projectId);
    if (activeLocks.length > MAX_LOCKS_CHECKED) {
      throw new HttpError(422, "INVALID_REQUEST",
        "The project has more active locks than an impact can record",
        { active_lock_count: activeLocks.length, ceiling: MAX_LOCKS_CHECKED }, projectId);
    }
    // Throws 423 on a real conflict. No row has been written and none will be.
    this.#deps.locks.assertUnlocked(projectId, graph.affected_locks);
    await this.#deps.fault?.("after_locks");

    // ── second currentness: nothing may have moved while the graph was built ──────────
    // The last point at which a premise can change. It fires *before* the final re-read, so
    // the re-read that follows sees the change: a fault fired after this line would be
    // asserting that a check already completed catches something that happened afterwards,
    // which is not a claim any of these checks can make.
    await this.#deps.fault?.("before_insert");
    const second = await this.#deps.resolver.resolveActivated(projectId);
    if (second.revision !== view.revision || second.source_digest !== view.source_digest
      || second.control_revision !== view.control_revision || second.snapshot_id !== view.snapshot_id) {
      throw new HttpError(409, "REVISION_CONFLICT",
        "The project changed while the impact was being computed", undefined, projectId);
    }
    // The database reading the *same row twice* cannot detect anything that happens on disk.
    // `view.source_digest` is the digest the active commit recorded; a file edited after that
    // commit leaves both readings identical, so without re-deriving it from the source the
    // final check is a tautology for exactly the change ADR §5 names first. The projection is
    // recomputed from the committed snapshot, which is the only thing here that touches the
    // bytes.
    const recheck = await resolved.port.inspect({
      project_id: projectId, engine: "openfilm", source_digest: view.source_digest,
    }, { correlationId, projectId, signal: AbortSignal.timeout(20_000) });
    if (recheck.source_digest !== view.source_digest) {
      throw new HttpError(409, "SOURCE_CHANGED",
        "The migrated source changed while the impact was being computed", undefined, projectId);
    }
    // And the materialization's proven facts are re-read through the public service, not
    // carried or fetched from the raw store. The public read revalidates the project's live
    // asset/rights ledger and marks the materialization stale when those facts moved. A raw
    // row read here used to miss a rights change injected after the first inventory check,
    // issue a 201, and leave an active impact whose rights digest was already false.
    let finalMaterialization: MaterializationV1;
    try {
      finalMaterialization = await this.#readMaterialization(projectId, row.materialization_id);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        throw new HttpError(428, "IMPACT_STALE",
          "The materialization disappeared while the impact was being computed",
          { materialization_id: row.materialization_id }, projectId);
      }
      throw error;
    }
    if (finalMaterialization.state !== "ready_for_adoption") {
      throw new HttpError(428, "IMPACT_STALE",
        "The materialization is no longer ready for adoption",
        { materialization_id: row.materialization_id, state: finalMaterialization.state }, projectId);
    }
    if (finalMaterialization.rights_digest !== row.rights_digest
      || finalMaterialization.native_plan?.plan_sha256 !== row.native_plan.plan_sha256) {
      throw new HttpError(409, "REVISION_CONFLICT",
        "The materialization's proven facts changed while the impact was being computed",
        undefined, projectId);
    }
    // Locks are re-read and re-asserted here, not only at the first check. `locks_checked` is
    // part of the spec the client is about to be handed, so a lock that appeared during the
    // computation makes that spec wrong — and the first assertion, made before the graph
    // finished, is exactly the one that can go stale while the graph is being built.
    const finalLocks = this.#deps.locks.activeLocks(projectId);
    if (finalLocks.length > MAX_LOCKS_CHECKED) {
      throw new HttpError(422, "INVALID_REQUEST",
        "The project has more active locks than an impact can record",
        { active_lock_count: finalLocks.length, ceiling: MAX_LOCKS_CHECKED }, projectId);
    }
    this.#deps.locks.assertUnlocked(projectId, graph.affected_locks);

    // The *final* set, not the first read: the spec must record the locks this impact was
    // actually checked against, and that is the set the check just used.
    const locksChecked: LockChecked[] = [...finalLocks]
      .map((lock) => ({ lock_id: lock.lock_id, control_revision: lock.control_revision }))
      .sort((left, right) => (left.lock_id < right.lock_id ? -1 : left.lock_id > right.lock_id ? 1 : 0));

    const unsigned: Omit<ImpactSpecV1, "impact_hash"> = sortImpactArrays({
      format: "narralens.impact@1.0",
      impact_id: impactId,
      project_id: projectId,
      operation: request.intent.op,
      materialization_id: row.materialization_id,
      target_snapshot_id: null,
      base_revision: view.revision,
      source_digest: view.source_digest,
      control_revision: view.control_revision,
      engine: "openfilm",
      engine_upstream_sha: view.engine_upstream_sha,
      affected_ranges: graph.affected_ranges,
      affected_consumers: graph.affected_consumers,
      locks_checked: locksChecked,
      rights_digest: row.rights_digest,
      native_plan_sha256: row.native_plan.plan_sha256,
      // Fixed in M4A. It corresponds to M4B's local session `approval.confirmed` and is
      // explicitly not an authorisation to spend money or send anything anywhere.
      approvals_required: ["human_confirmation"],
      expires_at: impactExpiry(now),
    });
    return { ...unsigned, impact_hash: computeImpactHash(unsigned) };
  }

  /**
   * The restore arm.
   *
   * M4C made this computable, and the only thing that changed is *where the difference
   * comes from*: the target's own bytes, read by the pinned upstream, rather than the
   * active source. Everything else — the read barrier, the idempotent replay, the
   * base/source/control comparison, the lock check, the second currentness check — is the
   * same machinery the adoption arm uses, because it is the same question: "what would this
   * write touch, and is it still true?"
   *
   * The plan's own hash is what the spec carries as `native_plan_sha256`. It is not a
   * placeholder and not the plan's *id*: it is the hash over the plan's canonical bytes, so
   * the restore can rebuild the plan and compare the two hashes and know that it is
   * restoring the difference the client was shown.
   */
  async #computeRestore(projectId: string, view: ActivatedProjectView, request: ImpactRequestV1,
    impactId: string, correlationId: string, now: Date): Promise<ImpactSpecV1> {
    if (request.intent.op !== "restore_snapshot") {
      throw new HttpError(422, "INVALID_REQUEST",
        "The restore arm needs a restore intent", undefined, projectId);
    }
    const planner = this.#deps.planner;
    if (planner === undefined) {
      // M4A has no independent read path for an immutable historical snapshot: a
      // `SnapshotRef` carries only a source digest, so there is no root or layout to
      // resolve. Refusing is the honest answer; using the *current* source to stand in for
      // an old snapshot would be the one substitution this whole module exists to prevent.
      throw new HttpError(422, "CAPABILITY_NOT_ENABLED",
        "Restoring an immutable historical snapshot is not computable from the active source",
        { target_snapshot_id: request.intent.target_snapshot_id }, projectId);
    }
    const context = await planner.plan(projectId, request.intent.target_snapshot_id, correlationId);
    if (context.view.revision !== view.revision || context.view.source_digest !== view.source_digest
      || context.view.control_revision !== view.control_revision) {
      throw new HttpError(409, "REVISION_CONFLICT",
        "The project changed while the restore was being planned", undefined, projectId);
    }
    // The locks: the real change, computed by the Host from the plan.
    const activeLocks = this.#deps.locks.activeLocks(projectId);
    if (activeLocks.length > MAX_LOCKS_CHECKED) {
      throw new HttpError(422, "INVALID_REQUEST",
        "The project has more active locks than an impact can record",
        { active_lock_count: activeLocks.length, ceiling: MAX_LOCKS_CHECKED }, projectId);
    }
    // Throws 423 on a real conflict. No row has been written and none will be.
    this.#deps.locks.assertUnlocked(projectId, context.plan.required_locks);
    await this.#deps.fault?.("after_locks");

    // Second currentness: nothing may have moved while the plan was built.
    await this.#deps.fault?.("before_insert");
    const second = await this.#deps.resolver.resolveActivated(projectId);
    if (second.revision !== view.revision || second.source_digest !== view.source_digest
      || second.control_revision !== view.control_revision || second.snapshot_id !== view.snapshot_id) {
      throw new HttpError(409, "REVISION_CONFLICT",
        "The project changed while the impact was being computed", undefined, projectId);
    }
    // And the bytes are re-read, not trusted: the database reading the same row twice
    // cannot detect a file that changed on disk.
    const resolved = this.#deps.engines.resolve(projectId);
    const recheck = await resolved.port.inspect({
      project_id: projectId, engine: "openfilm", source_digest: view.source_digest,
    }, { correlationId, projectId, signal: AbortSignal.timeout(20_000) });
    if (recheck.source_digest !== view.source_digest) {
      throw new HttpError(409, "SOURCE_CHANGED",
        "The source changed while the impact was being computed", undefined, projectId);
    }
    const finalLocks = this.#deps.locks.activeLocks(projectId);
    if (finalLocks.length > MAX_LOCKS_CHECKED) {
      throw new HttpError(422, "INVALID_REQUEST",
        "The project has more active locks than an impact can record",
        { active_lock_count: finalLocks.length, ceiling: MAX_LOCKS_CHECKED }, projectId);
    }
    this.#deps.locks.assertUnlocked(projectId, context.plan.required_locks);
    const locksChecked: LockChecked[] = [...finalLocks]
      .map((lock) => ({ lock_id: lock.lock_id, control_revision: lock.control_revision }))
      .sort((left, right) => (left.lock_id < right.lock_id ? -1 : left.lock_id > right.lock_id ? 1 : 0));

    const unsigned: Omit<ImpactSpecV1, "impact_hash"> = sortImpactArrays({
      format: "narralens.impact@1.0",
      impact_id: impactId,
      project_id: projectId,
      operation: "restore_snapshot",
      materialization_id: null,
      target_snapshot_id: context.target.snapshot_id,
      base_revision: view.revision,
      source_digest: view.source_digest,
      control_revision: view.control_revision,
      engine: "openfilm",
      engine_upstream_sha: view.engine_upstream_sha,
      // A restore whose difference is narration-only touches no visual range at all. The
      // consumers below still name what it touches, so the authorization is not empty.
      affected_ranges: context.affected_ranges,
      affected_consumers: context.plan.consumers,
      locks_checked: locksChecked,
      rights_digest: context.rights.rights_digest,
      // The restore plan's own hash. The restore rebuilds the plan and compares this value,
      // so it has to be the hash over the plan's canonical bytes.
      native_plan_sha256: context.plan.plan_sha256,
      approvals_required: ["human_confirmation"],
      expires_at: impactExpiry(now),
    });
    return { ...unsigned, impact_hash: computeImpactHash(unsigned) };
  }

  #ledgerAssets(projectId: string): readonly MigratedAssetRecord[] {
    return this.#deps.ledger.assets(projectId);
  }

  /**
   * Which target path is the narration.
   *
   * Decided by the stored plan rather than by a filename convention, because "narration" is
   * the word the migration recorded and a clip that merely happens to be named that is not
   * the same fact.
   */
  #narrationTargetPath(plan: MigrationPlanV1, projectId: string): string | null {
    return plan.narration === null ? null : plan.narration.target_path;
  }

  /**
   * Re-read through `MaterializeService.read`, which is the same re-verification the GET
   * route performs — so a row that drifted between the check and here is marked stale by
   * the existing code rather than by a second implementation of the same rule.
   */
  async #readMaterialization(projectId: string, materializationId: string): Promise<MaterializationV1> {
    // Ownership is settled first, from one cheap row, before anything is re-verified.
    // Re-verifying first meant a row belonging to another project failed inside
    // `MaterializeService.read` — which tries to resolve *that* row's project — and answered
    // 503, so the "not yours" answer never actually existed and the two cases were not the
    // same answer to a client at all.
    const owned = this.#deps.materializations.find(materializationId);
    if (owned === undefined || owned.project_id !== projectId) {
      // Deliberately the same answer for "no such materialization" and "not yours": the
      // second would otherwise disclose that the id exists.
      throw new HttpError(404, "NOT_FOUND", "Materialization not found", undefined, projectId);
    }
    let row: MaterializationV1;
    try {
      row = await this.#deps.materialize.read(materializationId);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        throw new HttpError(404, "NOT_FOUND", "Materialization not found", undefined, projectId);
      }
      throw error;
    }
    if (row.state === "stale") {
      throw new HttpError(428, "IMPACT_STALE",
        "The materialization is stale and can no longer back an authorization",
        { materialization_id: materializationId, state: row.state }, projectId);
    }
    return row;
  }

  /**
   * The stored spec, read without re-verifying the project's current facts.
   *
   * The lock check needs the *scope* an impact claims — which ranges it says it touches —
   * before it can decide whether a held lock conflicts. Requiring full currentness first
   * would answer every lock conflict as a stale impact, because acquiring a lock moves the
   * control revision and the control revision is one of the facts currentness re-reads. A
   * held visual lock is a more specific and more actionable answer than "your impact is
   * stale", so the caller checks the locks first and the facts second.
   *
   * The row's own state, hash and TTL are still checked: this is not a way to read a spent
   * authorization.
   */
  async read(impactId: string): Promise<ImpactSpecV1> {
    return this.#deps.impacts.requireActive(impactId, this.#deps.clock());
  }

  /**
   * The scope an impact claims, read without its wall-clock TTL.
   *
   * The recovery path has to see which ranges an impact covered even after the wall clock
   * has passed: the rule is that an impact that was prepared *before* its deadline may still
   * back a recovery, and `requireActive` would refuse it on the TTL alone. The row's state
   * and hash are still checked, so this is not a way to read a spent authorization.
   */
  async readScope(impactId: string): Promise<ImpactSpecV1> {
    const row = this.#deps.impacts.require(impactId);
    return this.#deps.impacts.requireActive(impactId, new Date(Date.parse(row.expires_at) - 1));
  }

  /**
   * `requireCurrent` for M4B/M4C (ADR-W2.0-004 §4, §5).
   *
   * This is the function that makes an inserted impact honest afterwards. SQLite cannot
   * un-publish bytes that change on disk after a commit, so the detection has to happen on
   * the way *out* — at every replay and at every future consumption. It never trusts the
   * stored state: the row is read, its hash recomputed, its TTL checked and the project's
   * facts re-read, and any drift CASes the row to `stale` before answering 428.
   */
  async requireCurrent(impactId: string, now = this.#deps.clock()): Promise<ImpactSpecV1> {
    let spec: ImpactSpecV1;
    try {
      spec = this.#deps.impacts.requireActive(impactId, now);
    } catch (error) {
      // A row that is still `active` but is dead must be marked, not merely reported.
      if (error instanceof HttpError && error.code === "IMPACT_STALE") {
        const row = this.#deps.impacts.get(impactId);
        if (row !== undefined && isExpired(row.expires_at, now)) {
          this.#deps.impacts.markExpired(impactId, now);
        } else {
          this.#deps.impacts.markStale(impactId, now);
        }
      }
      throw error;
    }
    const view = await this.#deps.resolver.resolveActivated(spec.project_id);
    try {
      await this.#assertSpecStillCurrent(spec, view, now);
    } catch (error) {
      if (error instanceof HttpError && error.code === "IMPACT_STALE") {
        this.#deps.impacts.markStale(impactId, now);
      }
      throw error;
    }
    return spec;
  }

  /**
   * Recovery-only authorization check after the source publication point.
   *
   * The ordinary check must reject the new source bytes because the database pointer still
   * names the before snapshot. Here the immutable adoption fact proves publication happened
   * before expiry; every database/materialization premise is still re-read, while the caller
   * independently proves the active bytes equal the recorded after closure.
   */
  async requirePreparedRecoveryCurrent(transactionId: string, impactId: string, impactHash: string,
    publishIntentCreatedAt: string): Promise<ImpactSpecV1> {
    const row = this.#deps.impacts.require(impactId);
    const intentAt = new Date(publishIntentCreatedAt);
    const expiresAt = new Date(row.expires_at);
    if (!Number.isFinite(intentAt.getTime()) || intentAt.getTime() >= expiresAt.getTime()
      || row.state !== "active" || row.impact_hash !== impactHash) {
      throw new HttpError(428, "IMPACT_STALE", "Prepared adoption no longer has a recoverable impact",
        { transaction_id: transactionId, impact_id: impactId });
    }
    const spec = this.#deps.impacts.requireActive(impactId, new Date(expiresAt.getTime() - 1));
    const view = await this.#deps.resolver.resolveActivated(spec.project_id);
    if (view.revision !== spec.base_revision || view.source_digest !== spec.source_digest
      || view.control_revision !== spec.control_revision) {
      throw new HttpError(428, "IMPACT_STALE", "The prepared controlled write's database premises moved",
        { transaction_id: transactionId, impact_id: impactId });
    }
    // A restore names no materialization — there is nothing to re-read, and its plan and
    // rights are re-proved by the caller against the immutable fact. An adoption does name
    // one, and its proven facts must still hold.
    if (spec.materialization_id !== null) {
      const materialization = await this.#deps.materialize.read(spec.materialization_id);
      if (materialization.state !== "ready_for_adoption"
        || materialization.rights_digest !== spec.rights_digest
        || materialization.native_plan?.plan_sha256 !== spec.native_plan_sha256) {
        throw new HttpError(428, "IMPACT_STALE", "Prepared adoption materialization premises moved",
          { transaction_id: transactionId, impact_id: impactId });
      }
    }
    return spec;
  }

  /** Everything an authorization was computed against, re-read. */
  async #assertSpecStillCurrent(spec: ImpactSpecV1, view: ActivatedProjectView, now: Date): Promise<void> {
    const stale = (why: string): never => {
      throw new HttpError(428, "IMPACT_STALE", `The impact is no longer current: ${why}`,
        { impact_id: spec.impact_id, reason: why }, spec.project_id);
    };
    if (isExpired(spec.expires_at, now)) stale("expired");
    if (!verifyImpactHash(spec)) stale("hash mismatch");
    if (view.revision !== spec.base_revision) stale("the project revision moved");
    if (view.source_digest !== spec.source_digest) stale("the source changed");
    if (view.control_revision !== spec.control_revision) stale("the control revision moved");

    const correlationId = this.#deps.correlationId();
    await this.#deps.projections.layoutFor(view, correlationId);
    const resolved = this.#deps.engines.resolve(spec.project_id);
    try {
      const projection = await resolved.port.inspect({
        project_id: spec.project_id, engine: "openfilm", source_digest: spec.source_digest,
      }, {
        correlationId, projectId: spec.project_id,
        signal: AbortSignal.timeout(20_000),
      });
      if (projection.source_digest !== spec.source_digest) stale("the source bytes changed");
    } catch (error) {
      if (error instanceof HttpError && error.code === "SOURCE_CHANGED") {
        stale("the source bytes changed");
      }
      throw error;
    }

    if (spec.materialization_id !== null) {
      // `find`, not `require`: a materialization that has been removed is *drift*, and
      // drift is 428. `require` would raise 404 out of a check whose whole purpose is to say
      // "this authorization is no longer usable", which is a different message to the caller
      // and the wrong one.
      let row: MaterializationV1;
      try {
        row = await this.#deps.materialize.read(spec.materialization_id);
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) stale("the materialization is gone");
        throw error;
      }
      if (row.state !== "ready_for_adoption") stale("the materialization is no longer ready for adoption");
      else if (row.rights_digest !== spec.rights_digest) stale("the rights digest moved");
      else if (row.native_plan === null || row.native_plan.plan_sha256 !== spec.native_plan_sha256) {
        stale("the native plan changed");
      }
    }
  }
}
