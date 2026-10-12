import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";

import { contractIds, validatorFor } from "../../contracts/validator.js";
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

type AssetManifest = {
  format: "narralens.asset-manifest@1";
  assets: Array<{
    asset_id: string; project_path: string; sha256: string; media_type: "video/mp4"; kind: "video"; duration_frames: number;
    source: { kind: "owned" | "generated" | "licensed"; label: string; uri?: string };
    license: { status: "cleared" | "restricted" | "unknown"; label: string; commercial_use: boolean };
  }>;
};

export class AssetRegistry {
  readonly #publicLists = new Map<string, { manifestSha: string; assets: PublicAsset[] }>();
  constructor(private readonly catalog: ProjectCatalog) {}

  async resolve(projectId: string, assetId: string): Promise<RegisteredAsset> {
    const descriptor = await this.catalog.readDescriptor(projectId);
    if (descriptor.asset_manifest === undefined) throw new HttpError(422, "MISSING_ASSET", "Project has no registered asset manifest");
    const root = await realpath(this.catalog.descriptorRoot(projectId));
    const manifestPath = await containedPath(root, descriptor.asset_manifest);
    const bytes = await readFile(manifestPath);
    if (bytes.byteLength > 1024 * 1024) throw new HttpError(422, "MISSING_ASSET", "Asset manifest exceeds the allowed size");
    let value: unknown;
    try { value = JSON.parse(bytes.toString("utf8")); }
    catch { throw new HttpError(422, "MISSING_ASSET", "Asset manifest is invalid"); }
    if (!validatorFor(contractIds.assetManifest)(value)) throw new HttpError(422, "MISSING_ASSET", "Asset manifest does not satisfy the contract");
    const manifest = value as AssetManifest;
    const matches = manifest.assets.filter((item) => item.asset_id === assetId);
    if (matches.length !== 1) throw new HttpError(422, "MISSING_ASSET", "Asset identity is missing or ambiguous");
    const asset = matches[0]!;
    if (asset.license.status !== "cleared" || !asset.license.commercial_use) {
      throw new HttpError(422, "MISSING_ASSET", "Asset license is not cleared for D4.0");
    }
    const path = await containedPath(root, asset.project_path);
    const media = await readFile(path);
    if (sha256(media) !== asset.sha256) throw new HttpError(422, "MISSING_ASSET", "Asset bytes do not match the manifest");
    const frames = await videoFrames(path);
    if (frames !== asset.duration_frames) throw new HttpError(422, "MISSING_ASSET", "Asset duration does not match the manifest");
    return { asset_id: asset.asset_id, sha256: asset.sha256, duration_frames: asset.duration_frames,
      media_type: asset.media_type, manifest_sha256: sha256(bytes), source_label: asset.source.label, license_label: asset.license.label };
  }

  async list(projectId: string): Promise<PublicAsset[]> {
    const descriptor = await this.catalog.readDescriptor(projectId);
    if (descriptor.asset_manifest === undefined) return [];
    const root = await realpath(this.catalog.descriptorRoot(projectId));
    const manifestPath = await containedPath(root, descriptor.asset_manifest);
    const bytes = await readFile(manifestPath);
    if (bytes.byteLength > 1024 * 1024) throw new HttpError(422, "MISSING_ASSET", "Asset manifest exceeds the allowed size");
    let value: unknown;
    try { value = JSON.parse(bytes.toString("utf8")); }
    catch { throw new HttpError(422, "MISSING_ASSET", "Asset manifest is invalid"); }
    if (!validatorFor(contractIds.assetManifest)(value)) throw new HttpError(422, "MISSING_ASSET", "Asset manifest does not satisfy the contract");
    const manifest = value as AssetManifest;
    const manifestSha = sha256(bytes);
    const cached = this.#publicLists.get(projectId);
    if (cached?.manifestSha === manifestSha) return structuredClone(cached.assets);
    const eligible = manifest.assets.filter((asset) => asset.kind === "video" && asset.media_type === "video/mp4"
      && asset.license.status === "cleared" && asset.license.commercial_use);
    const assets = await Promise.all(eligible.map(async (asset) => {
      const resolved = await this.resolve(projectId, asset.asset_id);
      return { asset_id: resolved.asset_id, duration_frames: resolved.duration_frames,
        source_label: resolved.source_label, license_label: resolved.license_label };
    }));
    this.#publicLists.set(projectId, { manifestSha, assets });
    return structuredClone(assets);
  }
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

async function videoFrames(path: string): Promise<number> {
  try {
    const { stdout } = await execute("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0",
      "-show_entries", "format=format_name:stream=codec_type,nb_read_frames", "-of", "json", path],
    { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true });
    const probe = JSON.parse(stdout) as { format?: { format_name?: unknown }; streams?: Array<{ codec_type?: unknown; nb_read_frames?: unknown }> };
    const names = typeof probe.format?.format_name === "string" ? probe.format.format_name.split(",") : [];
    const video = probe.streams?.[0];
    const frames = Number(video?.nb_read_frames);
    if (!names.includes("mp4") || video?.codec_type !== "video" || !Number.isSafeInteger(frames) || frames < 1) {
      throw new Error("invalid MP4 video");
    }
    return frames;
  } catch { throw new HttpError(422, "MISSING_ASSET", "Registered asset could not be inspected"); }
}

function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
