import type { NativePlanV1 } from "../../contracts/wave2-types.js";
import type { AdoptMaterializationEditOperation } from "../../contracts/types.js";
import type { Sha256, TypedEdit } from "../../contracts/engine-types.js";

/** Server-only facts injected after public materialization and impact revalidation. */
export interface AdoptEnginePlanIntent {
  readonly edit: AdoptMaterializationEditOperation;
  readonly native_plan: NativePlanV1;
  readonly materialization_id: string;
  readonly rights_digest: Sha256;
  readonly impact_hash: Sha256;
}

/**
 * Server-only facts injected after the restore's target has been resolved and proven.
 *
 * It exists only on the Host→adapter memory boundary. It never enters an HTTP body, a
 * schema, a log line or an evidence file, and it carries **no path**: the adapter is told
 * what the target's bytes are and which roots they belong to, never where they live. The
 * adapter's only job is to prove that what it staged is byte-for-byte the target it was
 * asked to restore.
 */
export interface RestoreEnginePlanIntent {
  readonly op: "restore_snapshot";
  readonly target_snapshot_id: string;
  /** The digest of the target's film document, over its exact bytes. */
  readonly target_film_sha256: Sha256;
  /** The target's film document, for the isolated stage only. Never echoed in evidence. */
  readonly target_film_text: string;
  /** The target's declared roots, relative to its source root. */
  readonly target_roots: readonly string[];
  /** The root the target's digest treats as the entry. */
  readonly target_entry_root: string;
  /** The digest the restored closure must reproduce. */
  readonly target_source_digest: Sha256;
  /** The hash of the restore plan this write is authorized against. */
  readonly restore_plan_sha256: Sha256;
  readonly impact_hash: Sha256;
  readonly rights_digest: Sha256;
}

export type EnginePlanIntent = TypedEdit | AdoptEnginePlanIntent | RestoreEnginePlanIntent;

const SHA256 = /^[a-f0-9]{64}$/u;

export function isAdoptEnginePlanIntent(value: EnginePlanIntent): value is AdoptEnginePlanIntent {
  if (value === null || typeof value !== "object" || !("edit" in value)) return false;
  const candidate = value as Partial<AdoptEnginePlanIntent>;
  return candidate.edit?.op === "adopt_materialization"
    && candidate.materialization_id === candidate.edit.materialization_id
    && candidate.impact_hash === candidate.edit.impact_hash
    && candidate.native_plan?.format === "narralens.native-plan@1.0"
    && typeof candidate.rights_digest === "string";
}

/**
 * Is this the M4C restore intent?
 *
 * The check is by *shape*, not by a tag alone: the gateway's own `restore_snapshot` typed
 * edit carries the same `op`, and mistaking one for the other would let a client-authored
 * edit reach the adapter as a restore. The restore intent is the one that carries the
 * target's bytes.
 */
export function isRestoreEnginePlanIntent(value: EnginePlanIntent): value is RestoreEnginePlanIntent {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<RestoreEnginePlanIntent>;
  return candidate.op === "restore_snapshot"
    && typeof candidate.target_snapshot_id === "string" && candidate.target_snapshot_id !== ""
    && typeof candidate.target_film_text === "string"
    && typeof candidate.target_entry_root === "string" && candidate.target_entry_root !== ""
    && Array.isArray(candidate.target_roots) && candidate.target_roots.length > 0
    && candidate.target_roots.every((root): boolean => typeof root === "string" && root !== "")
    && SHA256.test(candidate.target_film_sha256 ?? "")
    && SHA256.test(candidate.target_source_digest ?? "")
    && SHA256.test(candidate.restore_plan_sha256 ?? "")
    && SHA256.test(candidate.impact_hash ?? "")
    && SHA256.test(candidate.rights_digest ?? "");
}
