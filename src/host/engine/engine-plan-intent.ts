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

export type EnginePlanIntent = TypedEdit | AdoptEnginePlanIntent;

export function isAdoptEnginePlanIntent(value: EnginePlanIntent): value is AdoptEnginePlanIntent {
  if (value === null || typeof value !== "object" || !("edit" in value)) return false;
  const candidate = value as Partial<AdoptEnginePlanIntent>;
  return candidate.edit?.op === "adopt_materialization"
    && candidate.materialization_id === candidate.edit.materialization_id
    && candidate.impact_hash === candidate.edit.impact_hash
    && candidate.native_plan?.format === "narralens.native-plan@1.0"
    && typeof candidate.rights_digest === "string";
}
