import { createHash } from 'node:crypto';
import { canonicalDigest, canonicalJson } from '../creative/digest.js';
import { creativeInputClosure } from '../creative/creative-closure.js';
import type { ProductFactPort, ProductProjectFacts } from '../creative/product-facts.js';
import type { RevisionStore } from '../projects/revision-store.js';
import type { ProjectCreationStore } from '../projects/project-creation-store.js';
import { createTrustedCallerContext } from '../creative/trusted-context.js';
import type { ProductSqliteRepository } from './product-sqlite-repository.js';
import type { AssetInventory } from './asset-inventory.js';
import { A_CAPABILITIES, capabilityFingerprint, type RuntimeCapabilityDescriptor } from './capability-fingerprint.js';
import type { Brief } from '../../contracts/agent-driven-types.js';

export interface CreatedRunFactsOptions {
  readonly revisions: RevisionStore;
  readonly creation: ProjectCreationStore;
  readonly repository: ProductSqliteRepository;
  /** The local material authority. Without it a declared rights reference cannot be
   * verified, and an unverifiable reference is not an authorized one. */
  readonly inventory?: AssetInventory;
  /** The real capability manifest MAIN registers. Absent means no capability. */
  readonly capabilities?: () => readonly RuntimeCapabilityDescriptor[];
  /** The real producer readiness MAIN reports. Absent means not available. */
  readonly capabilityReadiness?: () => { readonly available: boolean; readonly reason: string };
}

const EMPTY_DIGEST = createHash('sha256').update(canonicalJson({ schema_version: 1, capabilities: [] })).digest('hex');

interface ClosureFacts {
  readonly brief: Brief | null;
  readonly closure_digest: string | null;
  /** Whether a current run was prepared from exactly this closure. */
  readonly matches_current_run: boolean;
  readonly reason: string;
}

/**
 * The real project facts of a created project.
 *
 * Every answer comes from the original authorities: the active commit and the control
 * revision from the revision store, the rights closure from the CURRENT creative brief
 * closure, and the capability from the registered producer manifest.
 *
 * The port fails closed by construction. A missing capability manifest is not a
 * capability, a malformed manifest is not a capability, an unverifiable rights reference
 * is not an authorized one, and nothing here ever hardcodes `available`.
 */
export class CreatedRunFacts implements ProductFactPort {
  readonly #revisions: RevisionStore;
  readonly #creation: ProjectCreationStore;
  readonly #repository: ProductSqliteRepository;
  readonly #inventory: AssetInventory | undefined;
  readonly #capabilities: (() => readonly RuntimeCapabilityDescriptor[]) | undefined;
  readonly #capabilityReadiness: (() => { readonly available: boolean; readonly reason: string }) | undefined;

  constructor(options: CreatedRunFactsOptions) {
    this.#revisions = options.revisions;
    this.#creation = options.creation;
    this.#repository = options.repository;
    this.#inventory = options.inventory;
    this.#capabilities = options.capabilities;
    this.#capabilityReadiness = options.capabilityReadiness;
  }

  /** The fingerprint of the ACTUAL registered descriptors. It is only the complete
   * capability fingerprint when all four real producers are registered AND the
   * registration itself validates; it is never a constant and it never claims
   * readiness on its own. */
  #fingerprint(descriptors: readonly RuntimeCapabilityDescriptor[]): { readonly digest: string; readonly valid: boolean } {
    if (descriptors.length !== A_CAPABILITIES.length) return { digest: EMPTY_DIGEST, valid: false };
    try {
      // The real validator: a malformed or duplicated manifest is refused here.
      return { digest: capabilityFingerprint(descriptors), valid: true };
    } catch {
      return { digest: EMPTY_DIGEST, valid: false };
    }
  }

  /**
   * The CURRENT creative closure of the project.
   *
   * It is the intake head's current version - not the brief that was captured when the
   * project was created - and its closure digest is the one the workflow service uses.
   * When a current run exists, the closure must be exactly the one that run was
   * prepared from; a brief that moved after the run is a stale closure.
   */
  async #closure(projectId: string): Promise<ClosureFacts> {
    const created = this.#creation.forProject(projectId);
    if (!created) return { brief: null, closure_digest: null, matches_current_run: false, reason: 'the project does not exist' };
    return this.#repository.transaction((tx) => {
      const head = tx.get('intake_head', { intake_id: created.request.intake_id });
      if (!head) return { brief: null, closure_digest: null, matches_current_run: false, reason: 'the current creative closure is unavailable' };
      const version = tx.get('intake_version', { intake_id: created.request.intake_id, version: head.current_version });
      if (!version) return { brief: null, closure_digest: null, matches_current_run: false, reason: 'the current creative closure is unavailable' };
      const brief = version.content_json as unknown as Brief;
      const closure_digest = canonicalDigest(creativeInputClosure(tx, created.request.intake_id, head.current_version));
      const runs = tx.list('run', { project_id: projectId });
      if (runs.length === 0) return { brief, closure_digest, matches_current_run: true, reason: 'no run is prepared for this project yet' };
      const matches = runs.some((run) => {
        const plan = tx.get('plan_version', { project_id: projectId, run_id: run.run_id, plan_version: 1 });
        return plan !== null && plan.input_digest === closure_digest;
      });
      return {
        brief,
        closure_digest,
        matches_current_run: matches,
        reason: matches ? 'the current creative closure matches a current run' : 'the current creative closure moved after the run was prepared',
      };
    });
  }

  /** The rights closure of the current brief: every declared reference must resolve to
   * a real row of this project whose bytes are still the registered bytes. */
  async #rights(projectId: string, principalId: string, closure: ClosureFacts): Promise<{ readonly authorized: boolean; readonly reason: string }> {
    if (!closure.brief) return { authorized: false, reason: closure.reason };
    if (!closure.matches_current_run) return { authorized: false, reason: closure.reason };
    const refs = closure.brief.content_brief.material_strategy.rights_refs ?? [];
    if (refs.length === 0) return { authorized: true, reason: 'the current brief declares no local material reference' };
    if (!this.#inventory) return { authorized: false, reason: 'the local material authority is unavailable' };
    const caller = createTrustedCallerContext({
      principal_id: principalId,
      channel: 'authenticated',
      source: 'driver_relay',
      session_ref: `facts:${projectId}`,
    });
    for (const ref of refs) {
      try {
        await this.#inventory.verifyRightsRef(projectId, ref, caller);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'the reference could not be verified';
        return { authorized: false, reason };
      }
    }
    return { authorized: true, reason: `${refs.length} local material reference(s) verified against the current rows and bytes` };
  }

  async readProjectFacts(projectId: string): Promise<ProductProjectFacts> {
    const created = this.#creation.forProject(projectId);
    const commit = this.#revisions.activeCommit(projectId);
    const control_revision = created ? this.#revisions.controlRevision(projectId, commit?.revision ?? 0) : 0;
    const principalId = created ? this.#creation.ownerOf(projectId) : null;
    const closure = await this.#closure(projectId);
    const rights = principalId
      ? await this.#rights(projectId, principalId, closure)
      : { authorized: false, reason: 'the project has no owner' };
    const descriptors = this.#capabilities?.() ?? [];
    const fingerprint = this.#fingerprint(descriptors);
    const readiness = this.#capabilityReadiness?.();
    // A capability needs a VALID complete registration AND a real readiness report.
    const capability_available = fingerprint.valid && readiness?.available === true;
    const capability_reason = capability_available
      ? 'every registered producer reported itself available'
      : readiness?.available === true
        ? 'the registered capability manifest does not validate'
        : readiness?.reason ?? 'no real capability manifest is registered';
    return {
      project_id: projectId,
      exists: created !== null && commit !== undefined,
      project_revision: commit?.revision ?? 0,
      control_revision,
      source_digest: commit?.source_digest ?? '',
      snapshot_id: commit?.snapshot_id ?? '',
      rights_authorized: rights.authorized,
      rights_reason: rights.reason,
      capability_available,
      capability_fingerprint: fingerprint.digest,
      capability_reason,
    };
  }
}
