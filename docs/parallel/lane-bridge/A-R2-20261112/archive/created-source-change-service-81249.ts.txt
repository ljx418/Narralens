import { randomUUID } from 'node:crypto';
import type { Change, PrepareChange } from '../../contracts/agent-driven-types.js';
import { ProductError } from '../creative/trusted-context.js';
import { canonicalDigest, contentDigest } from '../creative/digest.js';
import { OperationIdempotencyStore } from '../projects/operation-idempotency-store.js';
import { RevisionStore } from '../projects/revision-store.js';
import { snapshotIdFor } from '../projects/snapshot-store.js';
import { CreatedPreparedSourceStore } from './created-prepared-source-store.js';
import { CreatedSourceImpactStore, CREATED_IMPACT_OPERATION } from './created-source-impact-store.js';
import {
  PREPARED_ADOPTION_IMPACT_TTL_SECONDS,
  PREPARED_ADOPTION_PLAN_DOMAIN,
  PREPARED_ADOPTION_PLAN_VERSION,
  PREPARED_ADOPTION_SOURCE_KIND,
  assertPreparedAdoptionPlan,
  preparedAdoptionPlanDigest,
  type PreparedAdoptionPlanV1,
  type PreparedSourceConsumerFact,
  type PreparedSourceLockFact,
  type PreparedSourceNativePlanFact,
  type PreparedSourceRangeFact,
  type PreparedSourceRightsFact,
} from './created-source-ports.js';

/** The operation kind of a prepared change under the shared idempotency ledger. */
export const CREATED_CHANGE_OPERATION = 'agent.v1:change.prepare';

/** The prefix of the identifier of a prepared source mapping. */
const PREPARED_SOURCE_PREFIX = 'ps_';

/**
 * The facts of a prepared source that only the Host can tell.
 *
 * Everything here comes from the real records of the project: the authoritative
 * selection, the native plan that the prepared source has to satisfy, the consumer
 * graph it feeds, the three lock scopes that were checked, the affected ranges, and
 * the rights of the current brief. A missing producer is not a set of defaults; it
 * means the change cannot be prepared.
 */
export interface CreatedSourceFacts {
  /** The Host's authoritative selection version of the project. */
  readonly selection_version: number;
  readonly native_plan: PreparedSourceNativePlanFact;
  readonly consumer: PreparedSourceConsumerFact;
  readonly locks_checked: readonly PreparedSourceLockFact[];
  readonly affected_ranges: readonly PreparedSourceRangeFact[];
  /** Every rights reference the prepared source depends on. */
  readonly rights: readonly PreparedSourceRightsFact[];
  readonly rights_digest: string;
  /** Whether every declared rights reference resolved to a real row of this project. */
  readonly rights_authorized: boolean;
  /** The fixed upstream the project is bound to. */
  readonly engine_upstream_sha: string;
}

/** The producer of the prepared source facts. */
export interface CreatedSourceFactsPort {
  read(input: {
    readonly project_id: string;
    readonly prepared_source_id: string;
    readonly files: readonly { readonly relative_path: string; readonly bytes: number; readonly sha256: string }[];
    readonly roots: readonly string[];
    readonly frame_count: number;
    readonly fps_numerator: number;
    readonly fps_denominator: number;
  }): Promise<CreatedSourceFacts>;
}

/** The ports of the change service. */
export interface CreatedSourceChangePorts {
  /** The owner authority of the project. */
  readonly assertOwner: (project_id: string, principal_id: string) => void;
  /**
   * The legacy migration path.
   *
   * A materialization that is not a `ps_` mapping is a migrated materialization, and it
   * belongs to the M4A/M4B branch that already exists. That branch is not rewritten
   * here; it is called.
   */
  readonly legacyPrepare?: (input: PrepareChange, principal_id: string) => Promise<Change>;
}

/**
 * The constructor of a prepared change.
 *
 * It is the only thing that builds the `Change` of a created source, and it builds it
 * from the real records: the current committed base, the current control revision, the
 * authoritative selection, the D02 mapping, and the Host's own facts about the
 * prepared closure. The client supplies a base and a source digest; those are compared
 * against the world, never believed.
 *
 * The plan it produces has one digest, and that digest is the change's `plan_sha256`
 * and — later — the prepared approval's `facts_digest`. There is no shorter summary
 * of the same plan.
 */
export class CreatedSourceChangeService {
  readonly #revisions: RevisionStore;
  readonly #prepared: CreatedPreparedSourceStore;
  readonly #impacts: CreatedSourceImpactStore;
  readonly #commands: OperationIdempotencyStore;
  readonly #facts: CreatedSourceFactsPort;
  readonly #ports: CreatedSourceChangePorts;
  readonly #now: () => Date;

  constructor(options: {
    readonly revisions: RevisionStore;
    readonly prepared: CreatedPreparedSourceStore;
    readonly impacts: CreatedSourceImpactStore;
    readonly facts: CreatedSourceFactsPort;
    readonly ports: CreatedSourceChangePorts;
    readonly now?: () => Date;
  }) {
    this.#revisions = options.revisions;
    this.#prepared = options.prepared;
    this.#impacts = options.impacts;
    this.#facts = options.facts;
    this.#ports = options.ports;
    this.#now = options.now ?? (() => new Date());
    this.#commands = new OperationIdempotencyStore(this.#revisions.compose((db) => db));
  }

  /**
   * Prepare a change for a prepared source.
   *
   * A materialization that is not a `ps_` identifier is dispatched to the legacy
   * migration branch. A `ps_` identifier that names nothing is not found, and a
   * materialization of another project never resolves.
   */
  async prepare(input: PrepareChange, principalId: string): Promise<Change> {
    this.#ports.assertOwner(input.project_id, principalId);
    if (!input.materialization_id.startsWith(PREPARED_SOURCE_PREFIX)) {
      const legacy = this.#ports.legacyPrepare;
      if (legacy === undefined) {
        throw new ProductError('CAPABILITY_UNAVAILABLE', 'The legacy migration path is not registered');
      }
      return legacy(input, principalId);
    }
    const mapping = this.#prepared.read(input.materialization_id);
    if (mapping === undefined) {
      throw new ProductError('NOT_FOUND', 'No such prepared source');
    }
    if (mapping.project_id !== input.project_id) {
      throw new ProductError('NOT_FOUND', 'No such prepared source');
    }

    const requestDigest = contentDigest(input);
    const remembered = this.#commands.recall(input.project_id, CREATED_CHANGE_OPERATION, input.meta.idempotency_key);
    if (remembered !== undefined) {
      this.#commands.assertSameRequest(remembered, requestDigest, CREATED_CHANGE_OPERATION, input.project_id, input.meta.correlation_id);
      return JSON.parse(remembered.response_json) as Change;
    }

    // The world's own facts, read now.
    const commit = this.#revisions.activeCommit(input.project_id);
    if (commit === undefined) {
      throw new ProductError('REVISION_CONFLICT', 'The project has no committed base');
    }
    if (commit.revision !== input.base_revision) {
      throw new ProductError('REVISION_CONFLICT', 'The project has moved since this request was prepared', {
        details: { expected: commit.revision, received: input.base_revision },
      });
    }
    if (commit.source_digest !== input.source_digest) {
      throw new ProductError('REVISION_CONFLICT', 'The source has changed since this request was prepared', {
        details: { expected: commit.source_digest, received: input.source_digest },
      });
    }
    if (mapping.base_revision !== commit.revision || mapping.source_digest !== commit.source_digest) {
      throw new ProductError('REVISION_CONFLICT', 'The prepared source was prepared against another base');
    }
    if (mapping.execution.run_id !== input.execution.run_id ||
      mapping.execution.plan_version !== input.execution.plan_version ||
      mapping.execution.step_id !== input.execution.step_id ||
      mapping.execution.attempt !== input.execution.attempt ||
      mapping.execution.input_digest !== input.execution.input_digest ||
      mapping.execution.run_scope_digest !== input.execution.run_scope_digest ||
      mapping.execution.authorization_id !== input.execution.authorization_id) {
      throw new ProductError('REVISION_CONFLICT', 'The prepared source belongs to another execution');
    }
    const controlRevision = this.#revisions.controlRevision(input.project_id, commit.revision);

    const facts = await this.#facts.read({
      project_id: input.project_id,
      prepared_source_id: mapping.prepared_source_id,
      files: mapping.files,
      roots: mapping.roots,
      frame_count: mapping.frame_count,
      fps_numerator: mapping.fps_numerator,
      fps_denominator: mapping.fps_denominator,
    });
    if (facts.rights_authorized !== true) {
      throw new ProductError('APPROVAL_REQUIRED', 'The declared rights of this project are not authorized');
    }
    if (facts.consumer.project_id !== input.project_id) {
      throw new ProductError('REVISION_CONFLICT', 'The consumer graph belongs to another project');
    }

    const now = this.#now();
    const expiresAt = new Date(now.getTime() + PREPARED_ADOPTION_IMPACT_TTL_SECONDS * 1000).toISOString();
    const targetSnapshotId = snapshotIdFor(input.project_id, mapping.source_digest);
    const plan: PreparedAdoptionPlanV1 = {
      format: PREPARED_ADOPTION_PLAN_DOMAIN,
      version: PREPARED_ADOPTION_PLAN_VERSION,
      source_kind: PREPARED_ADOPTION_SOURCE_KIND,
      project_id: input.project_id,
      base_revision: commit.revision,
      base_source_digest: commit.source_digest,
      control_revision: controlRevision,
      selection_version: facts.selection_version,
      materialization_id: mapping.prepared_source_id,
      prepared_fact_digest: mapping.fact_digest,
      request_digest: input.execution.input_digest,
      producer_execution: mapping.execution,
      target_source_digest: mapping.source_digest,
      target_snapshot_id: targetSnapshotId,
      roots: mapping.roots,
      files: mapping.files,
      rights: facts.rights,
      consumer: facts.consumer,
      native_plan: facts.native_plan,
      frame_count: mapping.frame_count,
      fps_numerator: mapping.fps_numerator,
      fps_denominator: mapping.fps_denominator,
      affected_ranges: facts.affected_ranges,
      locks_checked: facts.locks_checked,
      engine_upstream_sha: facts.engine_upstream_sha,
      expires_at: expiresAt,
    };
    assertPreparedAdoptionPlan(plan);
    const planDigest = preparedAdoptionPlanDigest(plan);

    const impactId = `imp_${randomUUID().replaceAll('-', '')}`;
    const impact = this.#impacts.create({
      impact_id: impactId,
      project_id: input.project_id,
      materialization_id: mapping.prepared_source_id,
      target_snapshot_id: targetSnapshotId,
      base_revision: commit.revision,
      source_digest: commit.source_digest,
      control_revision: controlRevision,
      engine_upstream_sha: facts.engine_upstream_sha,
      affected_ranges: facts.affected_ranges,
      affected_consumers: [{ kind: 'native', id: facts.consumer.consumer_id, action: 'observe' }],
      locks_checked: facts.locks_checked,
      rights_digest: facts.rights_digest,
      native_plan_sha256: planDigest,
      approvals_required: ['change.approve'],
      request_digest: requestDigest,
      plan,
      now,
    });

    const change: Change = {
      impact_id: impact.impact_id,
      project_id: input.project_id,
      materialization_id: mapping.prepared_source_id,
      base_revision: commit.revision,
      control_revision: controlRevision,
      source_digest: commit.source_digest,
      selection_version: facts.selection_version,
      plan_sha256: planDigest,
      target_snapshot_id: targetSnapshotId,
      expires_at: impact.expires_at,
      state: 'active',
      summary: `Prepared adoption of ${mapping.prepared_source_id}`,
    };
    this.#commands.record({
      projectId: input.project_id,
      operationKind: CREATED_CHANGE_OPERATION,
      idempotencyKey: input.meta.idempotency_key,
      requestDigest,
      response: change,
      transactionId: impact.impact_id,
      now,
    });
    return change;
  }

  /** The digest of a change request, for the callers that bind one. */
  static requestDigestOf(input: PrepareChange): string {
    return canonicalDigest(contentDigest(input));
  }

  /** The operation a created impact carries. It is never the legacy one. */
  static get impactOperation(): typeof CREATED_IMPACT_OPERATION {
    return CREATED_IMPACT_OPERATION;
  }
}
