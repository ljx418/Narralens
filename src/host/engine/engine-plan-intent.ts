import type { NativePlanV1 } from "../../contracts/wave2-types.js";
import type { AdoptMaterializationEditOperation, RestoreSnapshotEditOperation } from "../../contracts/types.js";
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
 * The restore intent (ADR-W2.0-006 D-08, §4).
 *
 * Server-only, like `AdoptEnginePlanIntent`: it exists on the Host→adapter memory
 * boundary and nowhere else. It is not an HTTP shape, not a schema, and never an error
 * detail — the target film's text is content, and content does not belong in a diagnostic.
 *
 * The one op it carries is `restore_film`. There is no other: a restore is not a
 * translation of the film into a set of edits, it is the replacement of the film with a
 * specific earlier one. Modelling it as nine `set` ops would let the adapter *derive* a
 * film and then discover it differs from the target; modelling it as a byte-exact restore
 * means the adapter proves the bytes it staged are the bytes that were asked for.
 */
export interface RestoreEnginePlanIntent {
  readonly edit: RestoreSnapshotEditOperation;
  readonly target_snapshot_id: string;
  /** The target film's SHA-256, proved by the adapter before anything is staged. */
  readonly target_film_sha256: Sha256;
  /** The target film's text. Used only to write the isolated staging copy. */
  readonly target_film_text: string;
  /**
   * Content-addressed assets the target references and the active root does not have.
   *
   * They travel with the intent because the staged tree must contain them: the publisher
   * installs assets from the staged tree, and a tree without them cannot produce the target
   * film's closure. Each one's bytes are proved against its own address before it is
   * written.
   */
  readonly missing_assets: readonly { readonly token: string; readonly sha256: Sha256; readonly bytes: Uint8Array }[];
  /**
   * The target snapshot's own digest roots.
   *
   * The staged tree is the current source with the target's film in it, so the only way it
   * can reproduce the *target's* closure is by being measured over the target's roots. The
   * staged digest is therefore taken over this list, and it matches only if the staged tree
   * really is the target.
   */
  readonly target_roots: readonly string[];
  /** The restore plan's hash, so the adapter can refuse an intent that is not the plan's. */
  readonly restore_plan_sha256: Sha256;
  readonly impact_hash: Sha256;
}

export type EnginePlanIntent = TypedEdit | AdoptEnginePlanIntent | RestoreEnginePlanIntent;

export function isRestoreEnginePlanIntent(value: EnginePlanIntent): value is RestoreEnginePlanIntent {
  if (value === null || typeof value !== "object" || !("edit" in value)) return false;
  const candidate = value as Partial<RestoreEnginePlanIntent>;
  return candidate.edit?.op === "restore_snapshot"
    && typeof candidate.target_snapshot_id === "string" && candidate.target_snapshot_id !== ""
    && typeof candidate.target_film_sha256 === "string"
    && typeof candidate.target_film_text === "string"
    && typeof candidate.restore_plan_sha256 === "string"
    && Array.isArray(candidate.target_roots)
    && Array.isArray(candidate.missing_assets);
}

export function isAdoptEnginePlanIntent(value: EnginePlanIntent): value is AdoptEnginePlanIntent {
  if (value === null || typeof value !== "object" || !("edit" in value)) return false;
  const candidate = value as Partial<AdoptEnginePlanIntent>;
  return candidate.edit?.op === "adopt_materialization"
    && candidate.materialization_id === candidate.edit.materialization_id
    && candidate.impact_hash === candidate.edit.impact_hash
    && candidate.native_plan?.format === "narralens.native-plan@1.0"
    && typeof candidate.rights_digest === "string";
}
