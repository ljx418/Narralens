import type {
  Context,
  HealthRead,
  Meta,
  ReviewDecision,
  ReviewPackage,
  ReviewPart,
  Workflow,
} from "../contracts/agent-driven-types.js";
// The frozen agent contract's own validator. The app does not keep a second copy of the
// DTO rules: it asks the contract, and an answer that does not satisfy the contract is
// refused instead of being cast into the shape the panel would like.
import { validateAgentDefinition } from "../contracts/agent-driven-validator.js";
// MEDIA owns the preview receipt, the media facts and the descriptor. They are consumed
// here as they are: this client does not define a second copy of that protocol.
import { GatewayApiError } from "./m5/GatewayApiClient.js";

/**
 * The workbench's client for the agent surface (CR-R1-001 §3).
 *
 * It speaks the *closed* workbench RPC: a surface, an operation and the original input
 * DTO. It never invents a request, never drops a field before the Host's own validator
 * sees it, and never treats a missing producer as an available one.
 *
 * Four rules shape it:
 *
 * - **The project is fixed.** Every call is made for one project, and the Host's own
 *   delegate checks it again. A body that names another project is refused before it
 *   leaves, and a package that names another project is refused before it is sent.
 * - **An answer is checked, not cast.** Every read is validated by the frozen contract's
 *   own validator (`validateAgentDefinition`), and the identity of the answer — project,
 *   run, package, version — is checked against what was asked for.
 * - **An unknown result stays unknown.** A 503 is a missing producer, not a failure and
 *   not a success, and the caller keeps its request key so it can reconcile the same
 *   key instead of issuing a new one.
 * - **A shape this app does not know is refused.** The adjunct asset protocol is read in
 *   its reviewed shape only; no alternative spelling is guessed.
 *
 * The local-asset runtime DTO and its validator belong to BRIDGE; this client sends the
 * registration fields exactly and returns what the Host answered, without copying that
 * protocol into a second one here.
 */

/** The three closed surfaces. */
export type AgentWorkbenchSurface = "agent.v1" | "local-assets.v1" | "workbench.v1";

/** The transport this client speaks over: one closed call. */
export interface WorkbenchUiTransport {
  call(surface: string, operation: string, input: unknown, signal?: AbortSignal): Promise<unknown>;
}

/** The frozen source kinds that carry a URI. */
export type LocalAssetSourceKind = "owned" | "generated" | "licensed";

/** The frozen licence statuses. */
export type LocalAssetLicenseStatus = "cleared" | "restricted" | "unknown";

/**
 * The frozen recording origins.
 *
 * `null` is one of the values: the operator may decline to declare an origin, and the
 * Host records that fact. A free-text origin is not one of the values and is refused.
 */
export type LocalAssetRecordingOrigin = "human_recording" | "synthetic" | "unknown" | null;

/** A source that names where the bytes came from. */
export interface LocalAssetUriSource {
  readonly kind: LocalAssetSourceKind;
  readonly label: string;
  readonly uri: string | null;
}

/** A source that names the assets it was derived from. */
export interface LocalAssetDerivedSource {
  readonly kind: "derived";
  readonly label: string;
  readonly lineage: readonly string[];
}

/** The frozen source union. */
export type LocalAssetSource = LocalAssetUriSource | LocalAssetDerivedSource;

export interface LocalAssetLicense {
  readonly status: LocalAssetLicenseStatus;
  readonly label: string;
  readonly commercial_use: boolean;
}

/**
 * The declaration one local asset is registered with.
 *
 * Exactly the declaration: the project, the candidate, the source, the licence and the
 * recording origin. No relative path, no expected digest, no attestation reference —
 * and no request key either: the key is bound to this declaration by the client, so the
 * operator cannot accidentally send the same key for a different declaration.
 */
export interface LocalAssetRegistrationRequest {
  readonly project_id: string;
  readonly candidate_id: string;
  readonly source: LocalAssetSource;
  readonly license: LocalAssetLicense;
  readonly recording_origin: LocalAssetRecordingOrigin;
}

/** The five part kinds of a review package: the frozen contract's own union. */
export type ReviewPartKind = ReviewPart["kind"];

/** The exact input of `workbench.v1/review.part.describe`. */
export interface ReviewPartDescribeInput {
  readonly run_id: string;
  readonly package_id: string;
  readonly package_version: number;
  readonly part_kind: ReviewPartKind;
  readonly artifact_ref: { readonly id: string; readonly version: number; readonly sha256: string };
}

/* -------------------------------------------------------------------------------------- */
/* The preview descriptor, as this app sees it on the wire                                    */
/* -------------------------------------------------------------------------------------- */

/**
 * The measured facts of one prepared product.
 *
 * MEDIA owns these facts. The shape below is the *consumer's* view of the wire format
 * that CR-R1-001 §8 froze, and every field of it is checked before the app believes it.
 *
 * The app may not import MEDIA's own module: `src/app` may not depend on `src/host`
 * (the frozen dependency-direction rule of `tests/architecture/m2.1-fitness.test.ts`,
 * fitness 1). MAIN has therefore decided (msg `6bd5210f9a44` and CR-R1-002) that a
 * *public* module `src/contracts/prepared-preview.ts` will carry the authoritative
 * descriptor, timeline, fact and receipt types, and that `assembly-ports` will
 * re-export them.
 *
 * These local declarations are therefore **temporary**: they are the app's stand-in
 * until the parent has integrated that module, and they must be replaced by an import
 * of it as soon as it is there. They are a consumer's check, not a second protocol.
 */
export type PreparedPreviewMediaFactsV1 =
  | {
    readonly kind: "video";
    readonly fps: { readonly num: number; readonly den: number };
    readonly frame_count: number;
  }
  | {
    readonly kind: "audio";
    readonly sample_rate: number;
    readonly sample_count: number;
    readonly channels: number;
  }
  | { readonly kind: "text" }
  | { readonly kind: "json" };

/** The timeline a prepared product belongs to. It is measured, never defaulted. */
export interface PreparedPreviewTimelineV1 {
  readonly fps: { readonly num: number; readonly den: number };
  readonly frame_count: number;
}

/**
 * The descriptor of one prepared artifact (CR-R1-001 §8).
 *
 * It is the only thing that may authorize a preview: the bytes are checked against it
 * before anything is shown, and a descriptor whose body does not satisfy the frozen
 * shape is refused rather than cast.
 */
export interface PreviewMediaDescriptorV1 {
  readonly format: "narralens.review-media-descriptor@1";
  readonly project_id: string;
  readonly run_id: string;
  readonly package_id: string;
  readonly package_version: number;
  readonly package_digest: string;
  readonly part: ReviewPart;
  readonly receipt_digest: string;
  readonly object_id: string;
  readonly content_type: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly timeline: PreparedPreviewTimelineV1;
  readonly media_facts: PreparedPreviewMediaFactsV1;
}

/** A failure that is not a failure of the call, but a missing producer. */
export function isUnavailable(reason: unknown): boolean {
  return reason instanceof GatewayApiError && reason.status === 503;
}

/** The reason a call could not be made, told truthfully. */
export function unavailableReason(reason: unknown): string {
  if (reason instanceof GatewayApiError) return reason.message;
  if (reason instanceof Error) return reason.message;
  return "工作台观察暂不可用。";
}

/* -------------------------------------------------------------------------------------- */
/* The adjunct asset-inventory protocol, in its reviewed shape only                          */
/* -------------------------------------------------------------------------------------- */

/**
 * The adjunct `asset-inventory@1` protocol.
 *
 * The runtime DTO and its validator belong to BRIDGE (`contracts/agent-workbench-ui-v1.registry.json`
 * and the Host's own dispatcher) and they are not in this checkout. So what follows
 * checks the *reviewed* adjunct schema
 * (`docs/execution/A/relaunch-20261111/contracts/asset-inventory-v1.schema.json`) exactly:
 * the field names are `items` for both listings, the candidate carries `display_name`,
 * the inventory item carries `source_label` and `license`, and no alternative spelling
 * is accepted.
 *
 * A shape that is not the reviewed one is a refusal — never an empty list that would
 * look like "there is nothing there".
 */

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
/** A media type: a bounded, printable string. The schema does not narrow it further. */
const MEDIA_TYPE_PATTERN = /^[^\u0000-\u001F]{1,128}$/;
const CURSOR_PATTERN = /^[\S\s]{1,2048}$/;
const MEDIA_EXTENSIONS = ["mp4", "wav", "m4a", "mp3", "flac", "ogg"] as const;
const RECORDING_ORIGINS = ["human_recording", "synthetic", "unknown"] as const;
const LICENSE_STATUSES = ["cleared", "restricted", "unknown"] as const;

/**
 * The read input of the adjunct listing routes (CR-R1-002).
 *
 * The input has exactly three optional keys and no others: the project (which must be
 * the delegate's own project), the page size and the cursor. There is no filter, no
 * path, no root and no extra field: a request that carries anything else is refused by
 * the Host's own validator.
 */
export interface LocalAssetsPageRequest {
  /** The cursor of the page to read. Without one, the first page is read. */
  readonly cursor?: string | null;
  /** How many items the page may hold: 1 to 64. The Host's own default is 32. */
  readonly limit?: number;
}

/** One controlled candidate the panel may offer. */
export interface LocalAssetCandidate {
  readonly candidate_id: string;
  readonly display_name: string;
  readonly kind: "video" | "audio";
  readonly bytes: number;
  readonly expires_at: string;
}

/** The reviewed `SourceFileListing`. */
export interface SourceFileListing {
  readonly project_id: string;
  readonly candidates: readonly LocalAssetCandidate[];
  readonly cursor_next: string | null;
}

/** The measured media facts of one registered asset. */
export interface LocalAssetMediaFacts {
  readonly kind: "video" | "audio";
  readonly media_type: string;
  readonly extension: string;
  readonly duration_frames: number;
  readonly duration_ms: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly sample_rate: number | null;
  readonly channels: number | null;
  readonly codec: string;
}

/** One registered asset, in the reviewed `InventoryItem` shape. */
export interface LocalAssetInventoryItem {
  readonly asset_id: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly registration_digest: string;
  readonly media: LocalAssetMediaFacts;
  readonly rights_ref: { readonly id: string; readonly version: number; readonly sha256: string };
  readonly source_label: string;
  readonly license: LocalAssetLicense;
  readonly recording_origin: LocalAssetRecordingOrigin;
}

/** The reviewed `Inventory`. */
export interface AssetInventory {
  readonly project_id: string;
  readonly items: readonly LocalAssetInventoryItem[];
  readonly cursor_next: string | null;
}

/**
 * The controlled candidates, in the reviewed `SourceFileListing` shape.
 *
 * The listing carries `items`, not `candidates` and not `files`, and a candidate is
 * named by `display_name`. A listing in any other shape is refused: a wrong shape must
 * not look like an empty shelf.
 */
export function readSourceFileListing(value: unknown): SourceFileListing {
  const record = requireRecord(value, "INVALID_SOURCE_FILE_LISTING");
  requireExactKeys(record, ["format", "project_id", "items", "cursor_next"], "INVALID_SOURCE_FILE_LISTING");
  if (record.format !== "narralens.local-source-files@1") throw new Error("INVALID_SOURCE_FILE_LISTING");
  if (typeof record.project_id !== "string" || !ID_PATTERN.test(record.project_id)) {
    throw new Error("INVALID_SOURCE_FILE_LISTING");
  }
  const items = requireArray(record.items, "INVALID_SOURCE_FILE_LISTING");
  if (items.length > 64) throw new Error("INVALID_SOURCE_FILE_LISTING");
  const candidates = items.map((item) => readSourceCandidate(item));
  return { project_id: record.project_id, candidates, cursor_next: readCursor(record.cursor_next) };
}

/** The registered assets, in the reviewed `Inventory` shape. */
export function readAssetInventory(value: unknown): AssetInventory {
  const record = requireRecord(value, "INVALID_ASSET_INVENTORY");
  requireExactKeys(record, ["format", "project_id", "items", "cursor_next"], "INVALID_ASSET_INVENTORY");
  if (record.format !== "narralens.asset-inventory@1") throw new Error("INVALID_ASSET_INVENTORY");
  if (typeof record.project_id !== "string" || !ID_PATTERN.test(record.project_id)) {
    throw new Error("INVALID_ASSET_INVENTORY");
  }
  const items = requireArray(record.items, "INVALID_ASSET_INVENTORY");
  if (items.length > 64) throw new Error("INVALID_ASSET_INVENTORY");
  return {
    project_id: record.project_id,
    items: items.map((item) => readInventoryItem(item)),
    cursor_next: readCursor(record.cursor_next),
  };
}

/**
 * The candidates of one listing.
 *
 * A thin wrapper over {@link readSourceFileListing}, kept because the panel only needs
 * the candidates themselves.
 */
export function readCandidates(value: unknown): readonly LocalAssetCandidate[] {
  return readSourceFileListing(value).candidates;
}

/**
 * The items of one inventory.
 *
 * A thin wrapper over {@link readAssetInventory}, kept because the panel only needs the
 * items themselves.
 */
export function readInventoryItems(value: unknown): readonly LocalAssetInventoryItem[] {
  return readAssetInventory(value).items;
}

function readSourceCandidate(value: unknown): LocalAssetCandidate {
  const record = requireRecord(value, "INVALID_SOURCE_FILE_LISTING");
  requireExactKeys(record, ["candidate_id", "display_name", "kind", "bytes", "expires_at"], "INVALID_SOURCE_FILE_LISTING");
  if (typeof record.candidate_id !== "string" || !ID_PATTERN.test(record.candidate_id)) {
    throw new Error("INVALID_SOURCE_FILE_LISTING");
  }
  if (typeof record.display_name !== "string" || record.display_name.length < 1 || record.display_name.length > 256) {
    throw new Error("INVALID_SOURCE_FILE_LISTING");
  }
  if (record.kind !== "video" && record.kind !== "audio") throw new Error("INVALID_SOURCE_FILE_LISTING");
  if (!Number.isSafeInteger(record.bytes) || (record.bytes as number) < 0) throw new Error("INVALID_SOURCE_FILE_LISTING");
  if (typeof record.expires_at !== "string" || !isDateTime(record.expires_at)) {
    throw new Error("INVALID_SOURCE_FILE_LISTING");
  }
  return {
    candidate_id: record.candidate_id,
    display_name: record.display_name,
    kind: record.kind,
    bytes: record.bytes as number,
    expires_at: record.expires_at,
  };
}

function readInventoryItem(value: unknown): LocalAssetInventoryItem {
  const record = requireRecord(value, "INVALID_ASSET_INVENTORY");
  requireExactKeys(record, [
    "asset_id", "sha256", "bytes", "registration_digest", "media", "rights_ref",
    "source_label", "license", "recording_origin",
  ], "INVALID_ASSET_INVENTORY");
  if (typeof record.asset_id !== "string" || !ID_PATTERN.test(record.asset_id)) throw new Error("INVALID_ASSET_INVENTORY");
  if (typeof record.sha256 !== "string" || !SHA256_PATTERN.test(record.sha256)) throw new Error("INVALID_ASSET_INVENTORY");
  if (!Number.isSafeInteger(record.bytes) || (record.bytes as number) < 0) throw new Error("INVALID_ASSET_INVENTORY");
  if (typeof record.registration_digest !== "string" || !SHA256_PATTERN.test(record.registration_digest)) {
    throw new Error("INVALID_ASSET_INVENTORY");
  }
  if (typeof record.source_label !== "string" || record.source_label.length > 2000) {
    throw new Error("INVALID_ASSET_INVENTORY");
  }
  const license = requireRecord(record.license, "INVALID_ASSET_INVENTORY");
  requireExactKeys(license, ["status", "label", "commercial_use"], "INVALID_ASSET_INVENTORY");
  if (typeof license.status !== "string" || !(LICENSE_STATUSES as readonly string[]).includes(license.status)) {
    throw new Error("INVALID_ASSET_INVENTORY");
  }
  if (typeof license.label !== "string" || license.label.length < 1 || license.label.length > 2000) {
    throw new Error("INVALID_ASSET_INVENTORY");
  }
  if (typeof license.commercial_use !== "boolean") throw new Error("INVALID_ASSET_INVENTORY");
  const origin = record.recording_origin;
  if (origin !== null && !(typeof origin === "string" && (RECORDING_ORIGINS as readonly string[]).includes(origin))) {
    throw new Error("INVALID_ASSET_INVENTORY");
  }
  const rights = requireRecord(record.rights_ref, "INVALID_ASSET_INVENTORY");
  requireExactKeys(rights, ["id", "version", "sha256"], "INVALID_ASSET_INVENTORY");
  if (typeof rights.id !== "string" || !ID_PATTERN.test(rights.id)) throw new Error("INVALID_ASSET_INVENTORY");
  if (rights.version !== 1) throw new Error("INVALID_ASSET_INVENTORY");
  if (typeof rights.sha256 !== "string" || !SHA256_PATTERN.test(rights.sha256)) throw new Error("INVALID_ASSET_INVENTORY");
  return {
    asset_id: record.asset_id,
    sha256: record.sha256,
    bytes: record.bytes as number,
    registration_digest: record.registration_digest,
    media: readMediaFacts(record.media),
    rights_ref: { id: rights.id, version: 1, sha256: rights.sha256 },
    source_label: record.source_label,
    license: {
      status: license.status as LocalAssetLicenseStatus,
      label: license.label,
      commercial_use: license.commercial_use,
    },
    recording_origin: origin as LocalAssetRecordingOrigin,
  };
}

function readMediaFacts(value: unknown): LocalAssetMediaFacts {
  const record = requireRecord(value, "INVALID_ASSET_INVENTORY");
  requireExactKeys(record, [
    "kind", "media_type", "extension", "duration_frames", "duration_ms",
    "width", "height", "sample_rate", "channels", "codec",
  ], "INVALID_ASSET_INVENTORY");
  if (record.kind !== "video" && record.kind !== "audio") throw new Error("INVALID_ASSET_INVENTORY");
  if (typeof record.media_type !== "string" || !MEDIA_TYPE_PATTERN.test(record.media_type)) {
    throw new Error("INVALID_ASSET_INVENTORY");
  }
  if (typeof record.extension !== "string" || !(MEDIA_EXTENSIONS as readonly string[]).includes(record.extension)) {
    throw new Error("INVALID_ASSET_INVENTORY");
  }
  for (const key of ["duration_frames", "duration_ms"] as const) {
    if (!Number.isSafeInteger(record[key]) || (record[key] as number) < 0) throw new Error("INVALID_ASSET_INVENTORY");
  }
  for (const key of ["width", "height", "sample_rate", "channels"] as const) {
    const entry = record[key];
    if (entry !== null && (!Number.isSafeInteger(entry) || (entry as number) < 0)) {
      throw new Error("INVALID_ASSET_INVENTORY");
    }
  }
  if (typeof record.codec !== "string" || record.codec.length > 128) throw new Error("INVALID_ASSET_INVENTORY");
  return {
    kind: record.kind,
    media_type: record.media_type,
    extension: record.extension,
    duration_frames: record.duration_frames as number,
    duration_ms: record.duration_ms as number,
    width: record.width as number | null,
    height: record.height as number | null,
    sample_rate: record.sample_rate as number | null,
    channels: record.channels as number | null,
    codec: record.codec,
  };
}

function readCursor(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !CURSOR_PATTERN.test(value)) throw new Error("INVALID_CURSOR");
  return value;
}

function requireRecord(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, code: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(code);
  return value;
}

/** The reviewed shapes do not carry unknown fields: an extra field is a refusal. */
function requireExactKeys(record: Record<string, unknown>, keys: readonly string[], code: string): void {
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) throw new Error(code);
  }
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) throw new Error(code);
  }
}

function isDateTime(value: string): boolean {
  return value.length > 0 && !Number.isNaN(Date.parse(value));
}

/* -------------------------------------------------------------------------------------- */
/* The preview descriptor, in the shape CR-R1-001 §8 froze                                     */
/* -------------------------------------------------------------------------------------- */

/**
 * The preview descriptor, checked field by field.
 *
 * CR-R1-001 §8 froze the descriptor's fields exactly, and the media facts are a
 * discriminated union: a video carries its measured frame rate and frame count, an audio
 * carries its sample facts, and a text or JSON product carries neither. An answer whose
 * `format` matches but whose body does not is refused — the format alone proves
 * nothing.
 */
export function readPreviewMediaDescriptor(value: unknown): PreviewMediaDescriptorV1 {
  const record = requireRecord(value, "INVALID_MEDIA_DESCRIPTOR");
  requireExactKeys(record, [
    "format", "project_id", "run_id", "package_id", "package_version", "package_digest",
    "part", "receipt_digest", "object_id", "content_type", "bytes", "sha256", "timeline",
    "media_facts",
  ], "INVALID_MEDIA_DESCRIPTOR");
  if (record.format !== "narralens.review-media-descriptor@1") throw new Error("INVALID_MEDIA_DESCRIPTOR");
  for (const key of ["project_id", "run_id", "package_id"] as const) {
    if (typeof record[key] !== "string" || !ID_PATTERN.test(record[key] as string)) {
      throw new Error("INVALID_MEDIA_DESCRIPTOR");
    }
  }
  if (!Number.isSafeInteger(record.package_version) || (record.package_version as number) < 1) {
    throw new Error("INVALID_MEDIA_DESCRIPTOR");
  }
  for (const key of ["package_digest", "receipt_digest", "sha256"] as const) {
    if (typeof record[key] !== "string" || !SHA256_PATTERN.test(record[key] as string)) {
      throw new Error("INVALID_MEDIA_DESCRIPTOR");
    }
  }
  if (typeof record.object_id !== "string" || !ID_PATTERN.test(record.object_id)) {
    throw new Error("INVALID_MEDIA_DESCRIPTOR");
  }
  if (typeof record.content_type !== "string" || !MEDIA_TYPE_PATTERN.test(record.content_type)) {
    throw new Error("INVALID_MEDIA_DESCRIPTOR");
  }
  if (!Number.isSafeInteger(record.bytes) || (record.bytes as number) < 0) throw new Error("INVALID_MEDIA_DESCRIPTOR");
  const part = readDescriptorPart(record.part);
  const timeline = readTimeline(record.timeline);
  const facts = readMediaFactsUnion(record.media_facts);
  return {
    format: "narralens.review-media-descriptor@1",
    project_id: record.project_id as string,
    run_id: record.run_id as string,
    package_id: record.package_id as string,
    package_version: record.package_version as number,
    package_digest: record.package_digest as string,
    part,
    receipt_digest: record.receipt_digest as string,
    object_id: record.object_id as string,
    content_type: record.content_type as string,
    bytes: record.bytes as number,
    sha256: record.sha256 as string,
    timeline,
    media_facts: facts,
  };
}

function readDescriptorPart(value: unknown): ReviewPart {
  const record = requireRecord(value, "INVALID_MEDIA_DESCRIPTOR");
  requireExactKeys(record, ["kind", "artifact_ref", "download_ref"], "INVALID_MEDIA_DESCRIPTOR");
  const kinds = ["preview", "narration", "subtitles", "shot_summary", "rights_quality"];
  if (typeof record.kind !== "string" || !kinds.includes(record.kind)) throw new Error("INVALID_MEDIA_DESCRIPTOR");
  const ref = requireRecord(record.artifact_ref, "INVALID_MEDIA_DESCRIPTOR");
  requireExactKeys(ref, ["id", "version", "sha256"], "INVALID_MEDIA_DESCRIPTOR");
  if (typeof ref.id !== "string" || !ID_PATTERN.test(ref.id)) throw new Error("INVALID_MEDIA_DESCRIPTOR");
  if (!Number.isSafeInteger(ref.version) || (ref.version as number) < 1) throw new Error("INVALID_MEDIA_DESCRIPTOR");
  if (typeof ref.sha256 !== "string" || !SHA256_PATTERN.test(ref.sha256)) throw new Error("INVALID_MEDIA_DESCRIPTOR");
  const download = record.download_ref;
  if (download !== null && (typeof download !== "string" || !ID_PATTERN.test(download))) {
    throw new Error("INVALID_MEDIA_DESCRIPTOR");
  }
  return {
    kind: record.kind as ReviewPart["kind"],
    artifact_ref: { id: ref.id, version: ref.version as number, sha256: ref.sha256 },
    download_ref: download as string | null,
  };
}

function readTimeline(value: unknown): { readonly fps: { readonly num: number; readonly den: number }; readonly frame_count: number } {
  const record = requireRecord(value, "INVALID_MEDIA_DESCRIPTOR");
  requireExactKeys(record, ["fps", "frame_count"], "INVALID_MEDIA_DESCRIPTOR");
  const fps = requireRecord(record.fps, "INVALID_MEDIA_DESCRIPTOR");
  requireExactKeys(fps, ["num", "den"], "INVALID_MEDIA_DESCRIPTOR");
  for (const key of ["num", "den"] as const) {
    if (!Number.isSafeInteger(fps[key]) || (fps[key] as number) <= 0) throw new Error("INVALID_MEDIA_DESCRIPTOR");
  }
  if (!Number.isSafeInteger(record.frame_count) || (record.frame_count as number) < 0) {
    throw new Error("INVALID_MEDIA_DESCRIPTOR");
  }
  return { fps: { num: fps.num as number, den: fps.den as number }, frame_count: record.frame_count as number };
}

function readMediaFactsUnion(value: unknown): PreparedPreviewMediaFactsV1 {
  const record = requireRecord(value, "INVALID_MEDIA_DESCRIPTOR");
  if (record.kind === "video") {
    requireExactKeys(record, ["kind", "fps", "frame_count"], "INVALID_MEDIA_DESCRIPTOR");
    const fps = requireRecord(record.fps, "INVALID_MEDIA_DESCRIPTOR");
    requireExactKeys(fps, ["num", "den"], "INVALID_MEDIA_DESCRIPTOR");
    for (const key of ["num", "den"] as const) {
      if (!Number.isSafeInteger(fps[key]) || (fps[key] as number) <= 0) throw new Error("INVALID_MEDIA_DESCRIPTOR");
    }
    if (!Number.isSafeInteger(record.frame_count) || (record.frame_count as number) <= 0) {
      throw new Error("INVALID_MEDIA_DESCRIPTOR");
    }
    return { kind: "video", fps: { num: fps.num as number, den: fps.den as number }, frame_count: record.frame_count as number };
  }
  if (record.kind === "audio") {
    requireExactKeys(record, ["kind", "sample_rate", "sample_count", "channels"], "INVALID_MEDIA_DESCRIPTOR");
    for (const key of ["sample_rate", "sample_count", "channels"] as const) {
      if (!Number.isSafeInteger(record[key]) || (record[key] as number) <= 0) throw new Error("INVALID_MEDIA_DESCRIPTOR");
    }
    return {
      kind: "audio",
      sample_rate: record.sample_rate as number,
      sample_count: record.sample_count as number,
      channels: record.channels as number,
    };
  }
  if (record.kind === "text") {
    requireExactKeys(record, ["kind"], "INVALID_MEDIA_DESCRIPTOR");
    return { kind: "text" };
  }
  if (record.kind === "json") {
    requireExactKeys(record, ["kind"], "INVALID_MEDIA_DESCRIPTOR");
    return { kind: "json" };
  }
  throw new Error("INVALID_MEDIA_DESCRIPTOR");
}

/* -------------------------------------------------------------------------------------- */
/* The client                                                                                */
/* -------------------------------------------------------------------------------------- */

export class AgentWorkbenchClient {
  /**
   * The request keys of the local-asset declarations this client has sent.
   *
   * A key is bound to the *complete* declaration: the same declaration always reuses
   * the same key — so an unknown result is reconciled with the same key — and a changed
   * declaration is a different request and gets a different key.
   */
  readonly #registrationKeys = new Map<string, string>();

  constructor(private readonly transport: WorkbenchUiTransport, readonly projectId: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(projectId)) throw new Error("INVALID_PROJECT_ID");
  }

  async #call<T>(
    surface: AgentWorkbenchSurface,
    operation: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const body = await this.transport.call(surface, operation, input, signal);
    return body as T;
  }

  /** The project's current context. */
  async readContext(signal?: AbortSignal): Promise<Context> {
    const value = await this.#call<unknown>("agent.v1", "context.read", { project_id: this.projectId }, signal);
    const context = validateDefinition<Context>("Context", value, "INVALID_CONTEXT");
    if (context.project_id !== this.projectId) throw new Error("INVALID_CONTEXT");
    return context;
  }

  /** The project's workflow. */
  async readWorkflow(signal?: AbortSignal): Promise<Workflow> {
    const value = await this.#call<unknown>("agent.v1", "workflow.read", { project_id: this.projectId }, signal);
    const workflow = validateDefinition<Workflow>("Workflow", value, "INVALID_WORKFLOW");
    if (workflow.project_id !== this.projectId) throw new Error("INVALID_WORKFLOW");
    return workflow;
  }

  /**
   * One review package of the project's current run.
   *
   * The package is checked against the run and the package that were asked for: an
   * answer that names another run, another package or another project is refused.
   */
  async readReview(runId: string, packageId: string, signal?: AbortSignal): Promise<ReviewPackage> {
    const value = await this.#call<unknown>("agent.v1", "review.read", {
      project_id: this.projectId, run_id: runId, package_id: packageId,
    }, signal);
    const document_ = validateDefinition<ReviewPackage>("ReviewPackage", value, "INVALID_REVIEW_PACKAGE");
    if (document_.project_id !== this.projectId) throw new Error("INVALID_REVIEW_PACKAGE");
    if (document_.run_id !== runId) throw new Error("INVALID_REVIEW_PACKAGE");
    if (document_.package_id !== packageId) throw new Error("INVALID_REVIEW_PACKAGE");
    return document_;
  }

  /**
   * Record one decision about a package.
   *
   * The decision is a *decision*. It is not a commit and not a native acknowledgement:
   * the answer says the decision was recorded, and nothing more.
   *
   * The package decides the project: a package that belongs to another project is
   * refused here, before the call is made, so a decision can never be recorded against
   * a foreign project.
   */
  async decideReview(input: {
    readonly meta: Meta;
    readonly package: ReviewPackage;
    readonly choice: "accept" | "changes_requested" | "reject" | "accept_and_adopt";
    readonly impact_id?: string | null;
    readonly plan_sha256?: string | null;
  }): Promise<ReviewDecision> {
    const document = input.package;
    if (document.project_id !== this.projectId) throw new Error("PROJECT_MISMATCH");
    if (!isMeta(input.meta)) throw new Error("INVALID_META");
    const value = await this.#call<unknown>("agent.v1", "review.decide", {
      meta: input.meta,
      project_id: this.projectId,
      run_id: document.run_id,
      package_id: document.package_id,
      package_version: document.version,
      plan_version: document.plan_version,
      input_digest: document.input_digest,
      output_digest: document.output_digest,
      quality_digest: document.quality_digest,
      choice: input.choice,
      impact_id: input.impact_id ?? document.impact?.impact_id ?? null,
      plan_sha256: input.plan_sha256 ?? document.impact?.plan_sha256 ?? null,
    });
    const decision = validateDefinition<ReviewDecision>("ReviewDecision", value, "INVALID_REVIEW_DECISION");
    if (decision.project_id !== this.projectId) throw new Error("INVALID_REVIEW_DECISION");
    if (decision.package_id !== document.package_id) throw new Error("INVALID_REVIEW_DECISION");
    if (decision.package_version !== document.version) throw new Error("INVALID_REVIEW_DECISION");
    if (decision.run_id !== document.run_id) throw new Error("INVALID_REVIEW_DECISION");
    return decision;
  }

  /** The service health. A stale or missing sample is unknown, not ready. */
  async readHealth(signal?: AbortSignal): Promise<HealthRead> {
    const value = await this.#call<unknown>("agent.v1", "health.read", null, signal);
    return validateDefinition<HealthRead>("HealthRead", value, "INVALID_HEALTH");
  }

  /** The controlled local-source candidates the operator may declare. */
  async readLocalSourceFiles(
    request: LocalAssetsPageRequest = {},
    signal?: AbortSignal,
  ): Promise<SourceFileListing> {
    const value = await this.#call<unknown>(
      "local-assets.v1", "local-source-files.read", pageInput(this.projectId, request), signal,
    );
    const listing = readSourceFileListing(value);
    // A listing of another project is not this project's shelf.
    if (listing.project_id !== this.projectId) throw new Error("PROJECT_MISMATCH");
    return listing;
  }

  /**
   * Register one declared local asset.
   *
   * The request carries exactly the declaration — plus the request key that is bound to
   * that declaration. It never carries a relative path, an expected digest or an
   * attestation reference: the Host owns those.
   */
  async importLocalAsset(request: LocalAssetRegistrationRequest): Promise<LocalAssetInventoryItem> {
    if (request.project_id !== this.projectId) throw new Error("PROJECT_MISMATCH");
    if (!ID_PATTERN.test(request.candidate_id)) throw new Error("INVALID_CANDIDATE_ID");
    if (!isSourceDeclaration(request.source)) throw new Error("INVALID_SOURCE");
    if (!isLicense(request.license)) throw new Error("INVALID_LICENSE");
    if (!isRecordingOrigin(request.recording_origin)) throw new Error("INVALID_RECORDING_ORIGIN");
    const declaration = canonicalDeclaration(request);
    const meta = this.#registrationMeta(declaration);
    const value = await this.#call<unknown>("local-assets.v1", "local-assets.import", {
      meta,
      project_id: request.project_id,
      candidate_id: request.candidate_id,
      source: request.source,
      license: {
        status: request.license.status,
        label: request.license.label,
        commercial_use: request.license.commercial_use,
      },
      recording_origin: request.recording_origin,
    });
    return readInventoryItem(value);
  }

  /**
   * The request key of a declaration, when this client has sent it.
   *
   * It is the key to reconcile an unknown result with: the same declaration reuses it,
   * and a changed declaration is a different request with a different key.
   */
  registrationKeyFor(request: LocalAssetRegistrationRequest): string | undefined {
    return this.#registrationKeys.get(canonicalDeclaration(request));
  }

  /** The registered local assets of this project. */
  async readLocalAssets(
    request: LocalAssetsPageRequest = {},
    signal?: AbortSignal,
  ): Promise<AssetInventory> {
    const value = await this.#call<unknown>(
      "local-assets.v1", "local-assets.read.ui", pageInput(this.projectId, request), signal,
    );
    const inventory = readAssetInventory(value);
    if (inventory.project_id !== this.projectId) throw new Error("PROJECT_MISMATCH");
    return inventory;
  }

  /** The asset inventory the Agent sees — the same inventory, read by id. */
  async readAssetInventory(
    request: LocalAssetsPageRequest = {},
    signal?: AbortSignal,
  ): Promise<AssetInventory> {
    const value = await this.#call<unknown>(
      "local-assets.v1", "asset-inventory.read", pageInput(this.projectId, request), signal,
    );
    const inventory = readAssetInventory(value);
    if (inventory.project_id !== this.projectId) throw new Error("PROJECT_MISMATCH");
    return inventory;
  }

  /**
   * Re-open the native view for this project.
   *
   * The input is exactly empty: the project comes from the delegate, and the call
   * returns the Host's own validated native entry. It grants no native write.
   */
  async reopenNative(signal?: AbortSignal): Promise<unknown> {
    return await this.#call<unknown>("workbench.v1", "native.reopen", {}, signal);
  }

  /**
   * Describe one prepared part.
   *
   * The input is exact, and the answer is the descriptor that may authorize a preview.
   * The descriptor is checked field by field: its format alone authorizes nothing.
   */
  async describePart(input: ReviewPartDescribeInput, signal?: AbortSignal): Promise<PreviewMediaDescriptorV1> {
    const value = await this.#call<unknown>("workbench.v1", "review.part.describe", {
      run_id: input.run_id,
      package_id: input.package_id,
      package_version: input.package_version,
      part_kind: input.part_kind,
      artifact_ref: {
        id: input.artifact_ref.id,
        version: input.artifact_ref.version,
        sha256: input.artifact_ref.sha256,
      },
    }, signal);
    return readPreviewMediaDescriptor(value);
  }

  /** The request key of a declaration, and the key is bound to the whole declaration. */
  #registrationMeta(declaration: string): Meta {
    const existing = this.#registrationKeys.get(declaration);
    const idempotency_key = existing ?? `nl-${crypto.randomUUID()}`;
    this.#registrationKeys.set(declaration, idempotency_key);
    return { idempotency_key, correlation_id: crypto.randomUUID() };
  }
}

/**
 * The read input of a listing route (CR-R1-002).
 *
 * Exactly the three optional keys the approved contract names, and nothing else: the
 * project, the page size and the cursor. A cursor that is not a string, or a page size
 * that is not between 1 and 64, is refused here rather than sent.
 */
function pageInput(projectId: string, request: LocalAssetsPageRequest): Record<string, unknown> {
  if (request.limit !== undefined
    && (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 64)) {
    throw new Error("INVALID_PAGE_LIMIT");
  }
  if (request.cursor !== undefined && request.cursor !== null && typeof request.cursor !== "string") {
    throw new Error("INVALID_CURSOR");
  }
  return {
    project_id: projectId,
    ...(request.limit === undefined ? {} : { limit: request.limit }),
    ...(request.cursor === undefined || request.cursor === null ? {} : { cursor: request.cursor }),
  };
}

/**
 * The canonical text of a declaration.
 *
 * The key is bound to *all* of it: the project, the candidate, the source, the licence
 * and the recording origin. Changing the source therefore changes the declaration, and
 * a changed declaration is a new request — never the same key with different content.
 */
function canonicalDeclaration(request: LocalAssetRegistrationRequest): string {
  return JSON.stringify([
    request.project_id,
    request.candidate_id,
    request.source.kind,
    request.source.kind === "derived" ? request.source.lineage : request.source.uri,
    request.source.label,
    request.license.status,
    request.license.label,
    request.license.commercial_use,
    request.recording_origin,
  ]);
}

function validateDefinition<T>(definition: string, value: unknown, code: string): T {
  try {
    return validateAgentDefinition<T>(definition, value);
  } catch (reason) {
    throw new Error(code, { cause: reason });
  }
}

function isMeta(value: unknown): value is Meta {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.idempotency_key === "string" && ID_PATTERN.test(record.idempotency_key)
    && typeof record.correlation_id === "string" && ID_PATTERN.test(record.correlation_id);
}

/** The recording origin is one of the reviewed values, or `null`. Never free text. */
function isRecordingOrigin(value: unknown): value is LocalAssetRecordingOrigin {
  if (value === null) return true;
  return typeof value === "string" && (RECORDING_ORIGINS as readonly string[]).includes(value);
}

/** The licence is the reviewed triple. */
function isLicense(value: unknown): value is LocalAssetLicense {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.status === "string" && (LICENSE_STATUSES as readonly string[]).includes(record.status)
    && typeof record.label === "string" && record.label.length >= 1 && record.label.length <= 2000
    && typeof record.commercial_use === "boolean";
}

/** The source is one of the two reviewed variants. */
function isSourceDeclaration(value: unknown): value is LocalAssetSource {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.kind !== "string" || typeof record.label !== "string") return false;
  if (record.label.length < 1 || record.label.length > 2000) return false;
  if (record.kind === "derived") {
    return Array.isArray(record.lineage) && record.lineage.length >= 1 && record.lineage.length <= 256
      && record.lineage.every((entry) => typeof entry === "string" && ID_PATTERN.test(entry));
  }
  if (record.kind !== "owned" && record.kind !== "generated" && record.kind !== "licensed") return false;
  return record.uri === null || (typeof record.uri === "string" && record.uri.length <= 2048);
}
