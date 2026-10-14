import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { contractIds, validatorFor } from "../../contracts/validator.js";
import type { AssetBlockingReason, AssetInventoryResponse, AssetLicense, AssetManifest, AssetManifestEntry, AssetSource } from "../../contracts/types.js";
import { HttpError } from "../api-error.js";
import type { ProjectCatalog } from "./project-catalog.js";

const execute = promisify(execFile);

export interface RegisteredAsset {
  asset_id: string;
  sha256: string;
  duration_frames: number;
  media_type: "video/mp4";
  manifest_sha256: string;
  source_label: string;
  license_label: string;
}

export type PublicAsset = Pick<RegisteredAsset, "asset_id" | "duration_frames" | "source_label" | "license_label">;

export interface AssetManifestSnapshot {
  root: string;
  path: string;
  bytes: Uint8Array;
  sha256: string;
  manifest: AssetManifest;
}

export interface AssetManifestAppendPlan {
  before: AssetManifestSnapshot;
  after: AssetManifest;
  after_bytes: Uint8Array;
  after_sha256: string;
  created: boolean;
  migrated_from_v1: boolean;
}

export class AssetManifestPublishUncertain extends Error {
  constructor(readonly publishedSha256: string, cause: unknown) {
    super("Asset manifest replacement may have been published but durability could not be proved", { cause });
  }
}

export class AssetRegistry {
  constructor(private readonly catalog: ProjectCatalog) {}

  async readManifest(projectId: string): Promise<AssetManifestSnapshot> {
    const descriptor = await this.catalog.readDescriptor(projectId);
    if (descriptor.asset_manifest === undefined) throw new HttpError(422, "MISSING_ASSET", "Project has no registered asset manifest");
    const root = await realpath(this.catalog.descriptorRoot(projectId));
    const path = await containedPath(root, descriptor.asset_manifest);
    const bytes = await readFile(path);
    if (bytes.byteLength > 1024 * 1024) throw new HttpError(422, "MISSING_ASSET", "Asset manifest exceeds the allowed size");
    let value: unknown;
    try { value = JSON.parse(bytes.toString("utf8")); }
    catch { throw new HttpError(422, "MISSING_ASSET", "Asset manifest is invalid"); }
    if (!validatorFor(contractIds.assetManifest)(value)) throw new HttpError(422, "MISSING_ASSET", "Asset manifest does not satisfy the contract");
    const manifest = value as AssetManifest;
    assertManifestSemantics(manifest);
    return { root, path, bytes, sha256: sha256(bytes), manifest };
  }

  async planAppend(projectId: string, entry: AssetManifestEntry): Promise<AssetManifestAppendPlan> {
    const before = await this.readManifest(projectId);
    const existing = before.manifest.assets.find((asset) => asset.asset_id === entry.asset_id);
    if (existing !== undefined) {
      if (canonicalJson(existing) !== canonicalJson(entry)) {
        throw new HttpError(409, "MANIFEST_CHANGED", "Asset identity already maps to different manifest facts");
      }
      return { before, after: before.manifest, after_bytes: before.bytes, after_sha256: before.sha256,
        created: false, migrated_from_v1: false };
    }
    if (entry.asset_id !== assetIdentity(entry.sha256, entry.source, entry.license)
      || entry.project_path !== `media/${entry.sha256}/source.mp4`) {
      throw new HttpError(409, "MANIFEST_CHANGED", "New asset identity or content-addressed path is inconsistent");
    }
    if (before.manifest.assets.length >= 256) throw new HttpError(409, "MANIFEST_CHANGED", "Asset manifest has reached its capacity");
    const after: AssetManifest = { format: "narralens.asset-manifest@2", assets: [...before.manifest.assets, entry] };
    assertManifestContract(after);
    const afterBytes = Buffer.from(`${canonicalJson(after)}\n`, "utf8");
    if (afterBytes.byteLength > 1024 * 1024) throw new HttpError(409, "MANIFEST_CHANGED", "Asset manifest exceeds the allowed size");
    return { before, after, after_bytes: afterBytes, after_sha256: sha256(afterBytes), created: true,
      migrated_from_v1: before.manifest.format === "narralens.asset-manifest@1" };
  }

  async publish(projectId: string, expectedSha256: string, bytes: Uint8Array): Promise<AssetManifestSnapshot> {
    const current = await this.readManifest(projectId);
    if (current.sha256 !== expectedSha256) throw new HttpError(409, "MANIFEST_CHANGED", "Asset manifest changed before publish");
    assertManifestBytes(bytes);
    const replacementSha = sha256(bytes);
    await atomicReplace(current.path, bytes, replacementSha);
    try {
      const published = await this.readManifest(projectId);
      if (published.sha256 !== replacementSha) throw new Error("published manifest hash mismatch");
      return published;
    } catch (error) {
      throw new AssetManifestPublishUncertain(replacementSha, error);
    }
  }

  async restore(projectId: string, expectedCurrentSha256: string, bytes: Uint8Array): Promise<AssetManifestSnapshot> {
    return await this.publish(projectId, expectedCurrentSha256, bytes);
  }

  async resolve(projectId: string, assetId: string): Promise<RegisteredAsset> {
    const snapshot = await this.readManifest(projectId);
    const matches = snapshot.manifest.assets.filter((item) => item.asset_id === assetId);
    if (matches.length !== 1) throw new HttpError(422, "MISSING_ASSET", "Asset identity is missing or ambiguous");
    const asset = matches[0]!;
    if (asset.license.status !== "cleared" || !asset.license.commercial_use) {
      throw new HttpError(422, "MISSING_ASSET", "Asset license is not cleared for D4.0");
    }
    const path = await containedPath(snapshot.root, asset.project_path);
    let mediaHash: string;
    let verifiedHash: string;
    let frames: number;
    try { mediaHash = await hashFile(path); frames = await videoFrames(path); verifiedHash = await hashFile(path); }
    catch { throw new HttpError(422, "MISSING_ASSET", "Registered asset could not be inspected"); }
    if (mediaHash !== asset.sha256 || verifiedHash !== asset.sha256) {
      throw new HttpError(422, "MISSING_ASSET", "Asset bytes do not match the manifest");
    }
    if (frames !== asset.duration_frames) throw new HttpError(422, "MISSING_ASSET", "Asset duration does not match the manifest");
    return { asset_id: asset.asset_id, sha256: asset.sha256, duration_frames: asset.duration_frames,
      media_type: asset.media_type, manifest_sha256: snapshot.sha256, source_label: asset.source.label, license_label: asset.license.label };
  }

  async list(projectId: string): Promise<PublicAsset[]> {
    const snapshot = await this.readManifest(projectId);
    const manifest = snapshot.manifest;
    const eligible = manifest.assets.filter((asset) => asset.kind === "video" && asset.media_type === "video/mp4"
      && asset.license.status === "cleared" && asset.license.commercial_use);
    const assets = await Promise.all(eligible.map(async (asset) => {
      const resolved = await this.resolve(projectId, asset.asset_id);
      return { asset_id: resolved.asset_id, duration_frames: resolved.duration_frames,
        source_label: resolved.source_label, license_label: resolved.license_label };
    }));
    return assets;
  }

  async inventory(projectId: string): Promise<AssetInventoryResponse> {
    const [snapshot, descriptor] = await Promise.all([this.readManifest(projectId), this.catalog.readDescriptor(projectId)]);
    const assets = await mapConcurrent(snapshot.manifest.assets, 2, async (asset) => {
      let availability: "available" | "unavailable" = "available";
      const blockingReasons: AssetBlockingReason[] = [];
      if (asset.license.status !== "cleared") blockingReasons.push("LICENSE_NOT_CLEARED");
      if (!asset.license.commercial_use) blockingReasons.push("COMMERCIAL_USE_NOT_ALLOWED");
      try {
        const path = await containedPath(snapshot.root, asset.project_path);
        const firstHash = await hashFile(path);
        if (firstHash !== asset.sha256) {
          availability = "unavailable";
          blockingReasons.push("HASH_MISMATCH");
        } else {
          const frames = await videoFrames(path, descriptor.frame_rate);
          if (frames !== asset.duration_frames) {
            availability = "unavailable";
            blockingReasons.push("MEDIA_INVALID");
          } else if (await hashFile(path) !== asset.sha256) {
            availability = "unavailable";
            blockingReasons.push("HASH_MISMATCH");
          }
        }
      } catch (error) {
        availability = "unavailable";
        blockingReasons.push(error instanceof AssetMediaInvalid ? "MEDIA_INVALID" : "BYTES_UNAVAILABLE");
      }
      return {
        asset_id: asset.asset_id,
        sha256: asset.sha256,
        media_type: asset.media_type,
        duration_frames: asset.duration_frames,
        source: asset.source,
        license: asset.license,
        availability,
        eligible: availability === "available" && asset.license.status === "cleared" && asset.license.commercial_use,
        blocking_reasons: [...new Set(blockingReasons)],
      };
    });
    const response: AssetInventoryResponse = { format: "narralens.asset-inventory@1.0",
      manifest_format: snapshot.manifest.format, manifest_sha256: snapshot.sha256, assets };
    if (!validatorFor(contractIds.assetInventoryResponse)(response)) {
      throw new HttpError(500, "INTERNAL_ERROR", "Asset inventory response does not satisfy the contract");
    }
    return response;
  }
}

function assertManifestBytes(bytes: Uint8Array): void {
  if (bytes.byteLength > 1024 * 1024) throw new HttpError(409, "MANIFEST_CHANGED", "Asset manifest exceeds the allowed size");
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); }
  catch { throw new HttpError(409, "MANIFEST_CHANGED", "Replacement asset manifest is invalid JSON"); }
  assertManifestContract(value);
}

function assertManifestContract(value: unknown): asserts value is AssetManifest {
  if (!validatorFor(contractIds.assetManifest)(value)) throw new HttpError(409, "MANIFEST_CHANGED", "Asset manifest does not satisfy the contract");
  assertManifestSemantics(value as AssetManifest);
}

function assertManifestSemantics(manifest: AssetManifest): void {
  const ids = new Set<string>();
  const paths = new Map<string, string>();
  for (const asset of manifest.assets) {
    if (ids.has(asset.asset_id)) throw new HttpError(422, "MISSING_ASSET", "Asset manifest contains duplicate identities");
    ids.add(asset.asset_id);
    const previousSha = paths.get(asset.project_path);
    if (previousSha !== undefined && previousSha !== asset.sha256) {
      throw new HttpError(422, "MISSING_ASSET", "One asset path maps to contradictory byte identities");
    }
    paths.set(asset.project_path, asset.sha256);
  }
}

async function atomicReplace(path: string, bytes: Uint8Array, replacementSha: string): Promise<void> {
  const directory = dirname(path);
  const temporary = resolve(directory, `.${basename(path)}.narralens-${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let renamed = false;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    renamed = true;
    const parent = await open(directory, "r");
    try { await parent.sync(); } finally { await parent.close(); }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    if (renamed) throw new AssetManifestPublishUncertain(replacementSha, error);
    throw error;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function assetIdentity(bytesSha256: string, source: AssetSource, license: AssetLicense): string {
  return `asset_${createHash("sha256").update(canonicalJson({ bytes_sha256: bytesSha256, source, license })).digest("hex")}`;
}

async function containedPath(root: string, relativePath: string): Promise<string> {
  if (!relativePath || relativePath.startsWith("/") || relativePath.startsWith("\\") || relativePath.split(/[\\/]/u).includes("..")) {
    throw new HttpError(422, "MISSING_ASSET", "Asset path is not a contained project path");
  }
  let candidate: string;
  try { candidate = await realpath(resolve(root, relativePath)); }
  catch { throw new HttpError(422, "MISSING_ASSET", "Registered asset is unavailable"); }
  if (!candidate.startsWith(`${root}${sep}`)) throw new HttpError(422, "MISSING_ASSET", "Registered asset escaped the project root");
  return candidate;
}

async function videoFrames(path: string, expectedFrameRate?: number): Promise<number> {
  try {
    const { stdout } = await execute("ffprobe", ["-v", "error", "-count_frames",
      "-show_entries", "format=format_name:stream=codec_type,nb_read_frames,avg_frame_rate,r_frame_rate", "-of", "json", path],
    { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true });
    const probe = JSON.parse(stdout) as { format?: { format_name?: unknown }; streams?: Array<{ codec_type?: unknown; nb_read_frames?: unknown;
      avg_frame_rate?: unknown; r_frame_rate?: unknown }> };
    const names = typeof probe.format?.format_name === "string" ? probe.format.format_name.split(",") : [];
    const videos = probe.streams?.filter((stream) => stream.codec_type === "video") ?? [];
    const video = videos[0];
    const frames = Number(video?.nb_read_frames);
    if (!names.includes("mp4") || videos.length !== 1 || !Number.isSafeInteger(frames) || frames < 1
      || (expectedFrameRate !== undefined && (!sameRate(video?.avg_frame_rate, expectedFrameRate)
        || !sameRate(video?.r_frame_rate, expectedFrameRate) || video?.avg_frame_rate !== video?.r_frame_rate))) {
      throw new Error("invalid MP4 video");
    }
    return frames;
  } catch { throw new AssetMediaInvalid(); }
}

function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }

async function hashFile(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer);
  return digest.digest("hex");
}

function sameRate(value: unknown, expected: number): boolean {
  if (typeof value !== "string") return false;
  const match = /^(\d+)\/(\d+)$/u.exec(value);
  if (match === null) return false;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  return Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator) && denominator > 0
    && numerator === expected * denominator;
}

async function mapConcurrent<T, R>(values: T[], limit: number, operation: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      output[index] = await operation(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return output;
}

class AssetMediaInvalid extends Error {}
