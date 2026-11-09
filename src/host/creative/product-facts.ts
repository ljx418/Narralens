/**
 * The MAIN-owned facts the lane cannot own.
 *
 * Some of the questions a run has to answer are not the lane's to answer: whether the
 * project exists, whether the local material strategy is actually licensed, whether the
 * registered capability is available. The lane does not guess and it does not accept the
 * client's word for them — it asks MAIN through a read-only port, and when the port is
 * absent it **fails closed**.
 *
 * The port is deliberately read-only and deliberately mandatory. An optional port would
 * turn "the facts are unknown" into "the facts are fine", which is the failure the
 * contract keeps naming: a check that silently passes when it knows nothing.
 */

import { ProductError } from "./trusted-context.js";

/** What MAIN knows about a project that the lane needs before it prepares a run. */
export interface ProductProjectFacts {
  readonly project_id: string;
  /** Whether the project exists in MAIN's authoritative store. */
  readonly exists: boolean;
  readonly project_revision: number;
  readonly control_revision: number;
  /** The SHA-256 of the project's current source. */
  readonly source_digest: string;
  /** The project's current committed snapshot. */
  readonly snapshot_id: string;
  /**
   * Whether the brief's local material strategy is actually licensed for this project.
   *
   * Writing `rights_refs` into a brief does not make the material authorized.
   */
  readonly rights_authorized: boolean;
  /** Why the rights are or are not authorized. Shown to the operator. */
  readonly rights_reason: string;
  /** Whether the capability fingerprint the run asks for is registered and available. */
  readonly capability_available: boolean;
  readonly capability_reason: string;
}

/**
 * The read-only port MAIN injects.
 *
 * It is a port and not a callback per fact, so the lane reads the facts once, in one
 * consistent read, and so MAIN can answer them from one authoritative snapshot.
 */
export interface ProductFactPort {
  readProjectFacts(projectId: string): Promise<ProductProjectFacts>;
}

/**
 * Returns the port or fails closed.
 *
 * The failure code is `CAPABILITY_UNAVAILABLE`: the lane cannot verify the facts, so it
 * cannot authorize the run. It is not a conflict and not a bad request — the request may
 * be perfectly good, but the Host is not in a state to answer it.
 */
export function requireFactPort(port: ProductFactPort | undefined): ProductFactPort {
  if (port === undefined || port === null) {
    throw new ProductError(
      "CAPABILITY_UNAVAILABLE",
      "No project fact port is registered; the project facts cannot be verified",
    );
  }
  return port;
}

/**
 * Checks the facts a run preparation depends on.
 *
 * Every one of them is a hard requirement: an unknown project, an unlicensed material
 * strategy or an unavailable capability stops the run from being prepared.
 */
export function assertProjectFacts(facts: ProductProjectFacts, projectId: string): void {
  if (facts.project_id !== projectId) {
    throw new ProductError("RUN_SCOPE_REQUIRED", "The facts are about another project", {
      details: { expected: projectId, received: facts.project_id },
    });
  }
  if (!facts.exists) {
    throw new ProductError("NOT_FOUND", "The project does not exist", { details: { project_id: projectId } });
  }
  if (!facts.rights_authorized) {
    throw new ProductError("IMPACT_STALE", "The local material strategy is not authorized", {
      details: { reason: facts.rights_reason },
    });
  }
  if (!facts.capability_available) {
    throw new ProductError("CAPABILITY_UNAVAILABLE", "The registered capability is not available", {
      details: { reason: facts.capability_reason },
    });
  }
}
