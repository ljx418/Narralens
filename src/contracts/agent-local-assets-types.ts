/**
 * The runtime types of the adjunct local-material protocol (asset-inventory@1).
 *
 * They are a one-to-one runtime mapping of the reviewed design contract
 * `urn:narralens:design:asset-inventory-v1`; the frozen cp-a0 schema and registry
 * bytes are untouched. Nothing here is a business decision: every value is a fact the
 * Host read from the original registry and the original rows.
 */

export type LocalAssetMediaKind = 'video' | 'audio';

export type LocalAssetMediaExtension = 'mp4' | 'wav' | 'm4a' | 'mp3' | 'flac' | 'ogg';

export interface LocalAssetMediaFacts {
  readonly kind: LocalAssetMediaKind;
  readonly media_type: string;
  readonly extension: LocalAssetMediaExtension;
  readonly duration_frames: number;
  readonly duration_ms: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly sample_rate: number | null;
  readonly channels: number | null;
  readonly codec: string;
}

export interface LocalAssetLicense {
  readonly status: 'cleared' | 'restricted' | 'unknown';
  readonly label: string;
  readonly commercial_use: boolean;
}

/** The rights reference of a registration. Its shape is never a permission: the Host
 * resolves it against the same project row, the current bytes and the licence. */
export interface LocalAssetRightsRef {
  readonly id: string;
  readonly version: 1;
  readonly sha256: string;
}

export interface LocalAssetInventoryItem {
  readonly asset_id: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly registration_digest: string;
  readonly media: LocalAssetMediaFacts;
  readonly rights_ref: LocalAssetRightsRef;
  readonly source_label: string;
  readonly license: LocalAssetLicense;
  readonly recording_origin: 'human_recording' | 'synthetic' | 'unknown' | null;
}

export interface LocalAssetInventory {
  readonly format: 'narralens.asset-inventory@1';
  readonly project_id: string;
  readonly items: readonly LocalAssetInventoryItem[];
  readonly cursor_next: string | null;
}

export interface LocalSourceFileItem {
  readonly candidate_id: string;
  readonly display_name: string;
  readonly kind: LocalAssetMediaKind;
  readonly bytes: number;
  readonly expires_at: string;
}

export interface LocalSourceFileListing {
  readonly format: 'narralens.local-source-files@1';
  readonly project_id: string;
  readonly items: readonly LocalSourceFileItem[];
  readonly cursor_next: string | null;
}

export type LocalAssetDeclarationSource =
  | { readonly kind: 'owned' | 'generated' | 'licensed'; readonly label: string; readonly uri: string | null }
  | { readonly kind: 'derived'; readonly label: string; readonly lineage: readonly string[] };

export interface LocalAssetRegistrationRequest {
  readonly meta: { readonly idempotency_key: string; readonly correlation_id: string };
  readonly project_id: string;
  readonly candidate_id: string;
  readonly source: LocalAssetDeclarationSource;
  readonly license: LocalAssetLicense;
  readonly recording_origin: 'human_recording' | 'synthetic' | 'unknown' | null;
}

/** The adjunct protocol's own definitions. The frozen agent contract has none of them. */
export type LocalAssetDefinition =
  | 'Inventory'
  | 'InventoryItem'
  | 'SourceFileListing'
  | 'RegistrationRequest';

export const LOCAL_ASSET_CONTRACT_ID = 'urn:narralens:runtime:agent-local-assets-v1';

export const LOCAL_ASSET_DEFINITIONS: readonly LocalAssetDefinition[] = Object.freeze([
  'Inventory',
  'InventoryItem',
  'SourceFileListing',
  'RegistrationRequest',
]);
