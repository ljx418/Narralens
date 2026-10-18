import { createHash } from "node:crypto";
import { HttpError } from "../api-error.js";
import type { AssetBlockingReason, AssetLicense, AssetSource } from "../../contracts/types.js";
import type { AssetRegistry } from "./asset-registry.js";
import type { MigratedAssetLedger } from "./migrated-asset-ledger.js";
import type { ProjectResolver } from "./project-resolver.js";
import { sha256File } from "./openfilm-migrator.js";

/**
 * AssetInventoryPort (W2-G12, second half).
 *
 * One read-only answer to "which assets may this project use, and what is each one's
 * licence" for both kinds of project. A legacy Hypit project keeps those facts in
 * `Manifest@2` inside the author source; a migrated OpenFilm target keeps them in
 * `MigratedAssetLedger` inside SQLite. M3 binds segments through this port and never
 * learns which store answered.
 *
 * Two rules make it worth having rather than an `if`:
 *
 * - No cross-project fallback, ever. A project whose own store is empty returns empty.
 *   The tempting shortcut — "the target has no ledger, so read the source's manifest" —
 *   is exactly what the frozen plan forbids, because it makes a missing capability
 *   indistinguishable from a working one.
 * - Bytes are re-read every time. A ledger row records what was proven at bootstrap; it is
 *   a claim, not a cache. If the file changed, the inventory says so.
 *
 * The returned records carry no path. `target_path` and `project_path` exist in the
 * stores; a client, and M3, get an id and a hash.
 */

export interface InventoryAsset {
  readonly asset_id: string;
  readonly sha256: string;
  readonly media_type: string;
  readonly duration_frames: number;
  readonly source: AssetSource;
  readonly license: AssetLicense;
  readonly availability: "available" | "unavailable";
  readonly eligible: boolean;
  readonly blocking_reasons: readonly AssetBlockingReason[];
}

export interface AssetInventory {
  readonly kind: "legacy" | "activated";
  readonly project_id: string;
  readonly store: "asset_manifest" | "migrated_asset_ledger";
  /** Digest of the whole inventory, so an impact spec can bind what it read. */
  readonly inventory_sha256: string;
  readonly assets: readonly InventoryAsset[];
}

export interface AssetInventoryPortDeps {
  readonly resolver: ProjectResolver;
  readonly registry: AssetRegistry;
  readonly ledger: MigratedAssetLedger;
  /** Re-reads a target file the ledger points at; injected so it can be tested. */
  readonly targetHash?: (targetRoot: string, targetPath: string) => Promise<string | null>;
}

export class AssetInventoryPort {
  readonly #resolver: ProjectResolver;
  readonly #registry: AssetRegistry;
  readonly #ledger: MigratedAssetLedger;
  readonly #targetHash: (targetRoot: string, targetPath: string) => Promise<string | null>;

  constructor(deps: AssetInventoryPortDeps) {
    this.#resolver = deps.resolver;
    this.#registry = deps.registry;
    this.#ledger = deps.ledger;
    this.#targetHash = deps.targetHash ?? hashTarget;
  }

  async inventory(projectId: string): Promise<AssetInventory> {
    const view = await this.#resolver.resolve(projectId);
    if (view.kind === "legacy") return await this.#fromManifest(projectId);
    return await this.#fromLedger(projectId, view.source_root.value, view.kind);
  }

  /**
   * The binding M3 uses: one asset, matched by id *and* content hash.
   *
   * Both are required. The id says which registered asset the plan means; the hash says the
   * bytes behind it are the ones that were inventoried. Either alone can be satisfied by
   * the wrong file after a rename or a re-import.
   */
  async resolveAsset(projectId: string, assetId: string, expectedSha256: string): Promise<InventoryAsset> {
    const found = (await this.inventory(projectId)).assets.find((asset) => asset.asset_id === assetId);
    if (found === undefined) {
      throw new HttpError(422, "MISSING_ASSET", "Asset is not registered for this project", undefined, projectId);
    }
    if (found.sha256 !== expectedSha256) {
      throw new HttpError(422, "MISSING_ASSET", "Asset bytes do not match the expected content hash", undefined, projectId);
    }
    if (!found.eligible) {
      throw new HttpError(422, "MISSING_ASSET",
        `Asset is not usable: ${found.blocking_reasons.join(",")}`, undefined, projectId);
    }
    return found;
  }

  async #fromManifest(projectId: string): Promise<AssetInventory> {
    const response = await this.#registry.inventory(projectId);
    const assets: InventoryAsset[] = response.assets.map((asset) => ({
      asset_id: asset.asset_id, sha256: asset.sha256, media_type: asset.media_type,
      duration_frames: asset.duration_frames, source: asset.source, license: asset.license,
      availability: asset.availability, eligible: asset.eligible,
      blocking_reasons: [...asset.blocking_reasons],
    }));
    return {
      kind: "legacy", project_id: projectId, store: "asset_manifest",
      inventory_sha256: response.manifest_sha256, assets,
    };
  }

  async #fromLedger(projectId: string, targetRoot: string, kind: "activated"): Promise<AssetInventory> {
    const bootstrap = this.#ledger.bootstrapRecord(projectId);
    if (bootstrap === undefined) {
      // Not seeded is not the same as empty-but-fine. It is a capability that has not been
      // established, and the caller must be able to see that.
      return { kind, project_id: projectId, store: "migrated_asset_ledger",
        inventory_sha256: inventoryDigest([], ""), assets: [] };
    }
    if (bootstrap.state === "attention") {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        `Migrated asset ledger is in attention: ${bootstrap.attention_reason ?? "unknown"}`,
        undefined, projectId);
    }

    const rows = this.#ledger.assets(projectId);
    const assets: InventoryAsset[] = [];
    for (const row of rows) {
      const blocking: AssetBlockingReason[] = [];
      let availability: "available" | "unavailable" = "available";
      if (row.license.status !== "cleared") blocking.push("LICENSE_NOT_CLEARED");
      if (!row.license.commercial_use) blocking.push("COMMERCIAL_USE_NOT_ALLOWED");
      const hash = await this.#targetHash(targetRoot, row.target_path);
      if (hash === null) {
        availability = "unavailable";
        blocking.push("BYTES_UNAVAILABLE");
      } else if (hash !== row.target_sha256) {
        availability = "unavailable";
        blocking.push("HASH_MISMATCH");
      }
      assets.push({
        asset_id: row.asset_id, sha256: row.target_sha256, media_type: row.media_type,
        duration_frames: row.duration_frames, source: row.source, license: row.license,
        availability, eligible: availability === "available" && blocking.length === 0,
        blocking_reasons: [...new Set(blocking)],
      });
    }
    return {
      kind, project_id: projectId, store: "migrated_asset_ledger",
      inventory_sha256: inventoryDigest(assets, bootstrap.input_digest), assets,
    };
  }
}

async function hashTarget(targetRoot: string, targetPath: string): Promise<string | null> {
  try { return await sha256File(`${targetRoot}/${targetPath}`); }
  catch { return null; }
}

/**
 * A stable digest over what the inventory actually says, so an impact spec can bind the
 * asset facts it was computed against. The ledger's evidence hash is folded in because two
 * inventories with identical rows but different provenance are not the same fact.
 */
function inventoryDigest(assets: readonly InventoryAsset[], provenance: string): string {
  const canonical = assets.map((asset) => ({
    asset_id: asset.asset_id, sha256: asset.sha256, duration_frames: asset.duration_frames,
    media_type: asset.media_type, availability: asset.availability, eligible: asset.eligible,
    blocking_reasons: [...asset.blocking_reasons].sort(),
    license: { status: asset.license.status, commercial_use: asset.license.commercial_use },
    source: { kind: asset.source.kind },
  }));
  return createHash("sha256")
    .update("narralens-asset-inventory-v1\n")
    .update(JSON.stringify({ provenance, assets: canonical }))
    .digest("hex");
}
