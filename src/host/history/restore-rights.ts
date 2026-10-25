import { createHash } from "node:crypto";
import { HttpError } from "../api-error.js";
import { canonicalJson, compareUtf8 } from "../engine/source-digest-v1.js";
import type { EngineProjection } from "../../contracts/engine-types.js";
import type { AssetInventory } from "../projects/asset-inventory-port.js";
import type { MigratedAssetRecord } from "../projects/migrated-asset-ledger.js";

/**
 * The rights a restore is authorized against (M4C gate §3.2, §5).
 *
 * A restore puts *old* content back into the active source. The content is old, not
 * exempt: whatever the target references still has to be licensed for commercial use
 * *today*, under the project's current rights. That is why the rights digest binds both the
 * target's referenced assets and the project's current inventory digest — so a rights change
 * on any asset moves the digest and invalidates the authorization that was computed against
 * the old one.
 *
 * The narration is the one deliberate exception, and it is an exception of *fact*, not of
 * convenience: the migration keeps the narration track out of the asset ledger, because the
 * narration is a fact of the film's own audio rather than one of the source project's
 * reusable media. Demanding a ledger row for it would refuse every migrated target that has
 * narration — which is every target this fixture produces.
 */

/** Media extensions. A reference to one of these is an asset reference. */
const MEDIA_EXTENSIONS = /\.(png|jpe?g|webp|gif|avif|mp4|m4v|mov|webm|mkv|avi|ogv|mp3|m4a|wav|aac|ogg|oga|opus|flac|aif|aiff|weba)$/iu;

export interface RestoreRightsInput {
  readonly project_id: string;
  readonly target_snapshot_id: string;
  readonly inventory: AssetInventory;
  readonly ledger: readonly MigratedAssetRecord[];
  readonly target_projection: EngineProjection;
  /** The migration's recorded narration target path, or null. */
  readonly narration_target_path: string | null;
}

export interface RestoreRights {
  readonly rights_digest: string;
  /** The asset references that were checked, with the bytes that were proved. */
  readonly checked_assets: readonly { readonly path: string; readonly sha256: string }[];
  /** The narration reference, which is a fact of the film rather than a ledger asset. */
  readonly narration_path: string | null;
}

/**
 * Compute the rights a restore is authorized against, or refuse.
 *
 * Every failure here is a refusal, never a warning: an asset the project does not own, or
 * one whose licence no longer permits commercial use, cannot be put back into the active
 * source.
 */
export function targetRights(input: RestoreRightsInput, correlationId?: string): RestoreRights {
  const ledgerByPath = new Map<string, MigratedAssetRecord>();
  for (const row of input.ledger) {
    if (ledgerByPath.has(row.target_path)) {
      throw new HttpError(422, "INVALID_REQUEST",
        "the asset ledger names the same target path twice", { target_path: row.target_path },
        correlationId ?? input.project_id);
    }
    ledgerByPath.set(row.target_path, row);
  }

  const references = new Set<string>();
  for (const clip of input.target_projection.clips) {
    if (!MEDIA_EXTENSIONS.test(clip.source_ref)) continue;
    references.add(clip.source_ref);
  }

  const checked: Array<{ path: string; sha256: string; license_status: string; commercial_use: boolean }> = [];
  let narrationPath: string | null = null;
  for (const reference of [...references].sort(compareUtf8)) {
    if (input.narration_target_path !== null && reference === input.narration_target_path) {
      narrationPath = reference;
      continue;
    }
    const row = ledgerByPath.get(reference);
    if (row === undefined) {
      throw new HttpError(422, "MISSING_ASSET",
        "The target references media this project does not own",
        { path: reference, target_snapshot_id: input.target_snapshot_id },
        correlationId ?? input.project_id);
    }
    if (row.license.status !== "cleared" || !row.license.commercial_use) {
      throw new HttpError(422, "MISSING_ASSET",
        "The target references media that is not licensed for commercial use",
        { path: reference, license_status: row.license.status },
        correlationId ?? input.project_id);
    }
    checked.push({ path: reference, sha256: row.target_sha256,
      license_status: row.license.status, commercial_use: row.license.commercial_use });
  }

  const rightsDigest = createHash("sha256").update("narralens-restore-rights-v1\n")
    .update(canonicalJson({
      project_id: input.project_id,
      target_snapshot_id: input.target_snapshot_id,
      narration_path: narrationPath,
      assets: checked,
      // The project's *current* rights surface. It moves when any asset's rights move, so
      // an authorization computed against the old surface cannot survive it.
      inventory_sha256: input.inventory.inventory_sha256,
    })).digest("hex");

  return {
    rights_digest: rightsDigest,
    checked_assets: checked.map((entry) => ({ path: entry.path, sha256: entry.sha256 })),
    narration_path: narrationPath,
  };
}
