import { createHash } from 'node:crypto';
import { canonicalJson } from '../creative/digest.js';
import type { ProductFactPort, ProductProjectFacts } from '../creative/product-facts.js';
import type { RevisionStore } from '../projects/revision-store.js';
import type { ProjectCreationStore } from '../projects/project-creation-store.js';
import { createTrustedCallerContext } from '../creative/trusted-context.js';
import type { AssetInventory } from './asset-inventory.js';
import { A_CAPABILITIES, capabilityFingerprint, type RuntimeCapabilityDescriptor } from './capability-fingerprint.js';

export interface CreatedRunFactsOptions {
  readonly revisions: RevisionStore;
  readonly creation: ProjectCreationStore;
  /** The local material authority. Without it a declared rights reference cannot be
   * verified, and an unverifiable reference is not an authorized one. */
  readonly inventory?: AssetInventory;
  /** The real capability manifest MAIN registers. Absent means no capability. */
  readonly capabilities?: () => readonly RuntimeCapabilityDescriptor[];
  /** The real producer readiness MAIN reports. Absent means not available. */
  readonly capabilityReadiness?: () => { readonly available: boolean; readonly reason: string };
}

const EMPTY_DIGEST = createHash('sha256').update(canonicalJson({ schema_version: 1, capabilities: [] })).digest('hex');

/**
 * The real project facts of a created project.
 *
 * Every answer comes from the original authorities: the active commit and the control
 * revision from the revision store, the rights closure from the local asset rows and
 * their current bytes, and the capability from the registered producer manifest.
 *
 * The port fails closed by construction. A missing capability manifest is not a
 * capability, an unverifiable rights reference is not an authorized one, and nothing
 * here ever hardcodes `available`.
 */
export class CreatedRunFacts implements ProductFactPort {
  readonly #revisions: RevisionStore;
  readonly #creation: ProjectCreationStore;
  readonly #inventory: AssetInventory | undefined;
  readonly #capabilities: (() => readonly RuntimeCapabilityDescriptor[]) | undefined;
  readonly #capabilityReadiness: (() => { readonly available: boolean; readonly reason: string }) | undefined;

  constructor(options: CreatedRunFactsOptions) {
    this.#revisions = options.revisions;
    this.#creation = options.creation;
    this.#inventory = options.inventory;
    this.#capabilities = options.capabilities;
    this.#capabilityReadiness = options.capabilityReadiness;
  }

  /** The fingerprint of the ACTUAL registered descriptors. It is only the complete
   * capability fingerprint when all four real producers are registered; it is never a
   * constant and it never claims readiness on its own. */
  #fingerprint(descriptors: readonly RuntimeCapabilityDescriptor[]): string {
    if (descriptors.length === A_CAPABILITIES.length) {
      try {
        return capabilityFingerprint(descriptors);
      } catch {
        return EMPTY_DIGEST;
      }
    }
    const capabilities = [...descriptors]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((descriptor) => ({
        id: descriptor.id,
        version: descriptor.version,
        implementation_digest: descriptor.implementation_digest,
        configuration_digest: descriptor.configuration_digest,
      }));
    return createHash('sha256').update(canonicalJson({ schema_version: 1, capabilities })).digest('hex');
  }

  /** The rights closure of the brief: every declared reference must resolve to a real
   * row of this project whose bytes are still the registered bytes. */
  async #rights(projectId: string, principalId: string): Promise<{ readonly authorized: boolean; readonly reason: string }> {
    const created = this.#creation.forProject(projectId);
    if (!created) return { authorized: false, reason: 'the project does not exist' };
    const refs = created.brief.content_brief.material_strategy.rights_refs ?? [];
    if (refs.length === 0) return { authorized: true, reason: 'the brief declares no local material reference' };
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
    const rights = principalId
      ? await this.#rights(projectId, principalId)
      : { authorized: false, reason: 'the project has no owner' };
    const descriptors = this.#capabilities?.() ?? [];
    const readiness = this.#capabilityReadiness?.();
    const capability_available = readiness?.available === true && descriptors.length === A_CAPABILITIES.length;
    const capability_reason = capability_available
      ? 'every registered producer reported itself available'
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
      capability_fingerprint: this.#fingerprint(descriptors),
      capability_reason,
    };
  }
}
