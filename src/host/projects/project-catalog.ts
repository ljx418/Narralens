import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validatorFor, contractIds } from "../../contracts/validator.js";
import type { ProjectResponse } from "../../contracts/types.js";
import { HttpError } from "../api-error.js";
import { assertProjectId } from "../security.js";

export interface DescriptorShot {
  shot_id: string;
  authoring_id: string;
  start_frame: number;
  end_frame_exclusive: number;
}

export interface ProjectDescriptor extends Omit<ProjectResponse, "shots"> {
  shots: DescriptorShot[];
  run_file: string;
  studio_origin: string;
  narration_asset: string;
  asset_manifest?: string;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const registry = new Map([["d1-30s", resolve(repositoryRoot, "fixtures/d1-30s/narralens.project.json")]]);

export class ProjectCatalog {
  constructor(private readonly entries = registry) {}

  async read(projectId: string): Promise<ProjectResponse> {
    const descriptor = await this.readDescriptor(projectId);
    const { run_file: _runFile, studio_origin: _studioOrigin, narration_asset: _narrationAsset, asset_manifest: _assetManifest, ...project } = descriptor;
    return { ...project, shots: descriptor.shots.map(({ authoring_id: _authoringId, ...shot }) => shot) };
  }

  async readDescriptor(projectId: string): Promise<ProjectDescriptor> {
    try { assertProjectId(projectId); } catch { throw new HttpError(400, "INVALID_REQUEST", "Invalid project identifier"); }
    const descriptorPath = this.entries.get(projectId);
    if (!descriptorPath) throw new HttpError(404, "NOT_FOUND", "Project not found");
    const root = await realpath(dirname(descriptorPath));
    const resolved = await realpath(descriptorPath);
    if (!resolved.startsWith(`${root}${sep}`)) throw new HttpError(403, "ORIGIN_REJECTED", "Project registry escaped its root");
    let value: unknown;
    try { value = JSON.parse(await readFile(resolved, "utf8")); }
    catch { throw new HttpError(500, "INTERNAL_ERROR", "Project descriptor is unreadable"); }
    if (!value || typeof value !== "object" || !("run_file" in value) || typeof value.run_file !== "string"
      || !("studio_origin" in value) || typeof value.studio_origin !== "string"
      || !("narration_asset" in value) || typeof value.narration_asset !== "string"
      || !("asset_manifest" in value) || typeof value.asset_manifest !== "string") {
      throw new HttpError(500, "INTERNAL_ERROR", "Project descriptor is invalid");
    }
    const descriptor = value as ProjectDescriptor;
    const { run_file: _runFile, studio_origin: _studioOrigin, narration_asset: _narrationAsset, asset_manifest: _assetManifest, ...project } = descriptor;
    const publicProject = { ...project, shots: descriptor.shots.map(({ authoring_id: _authoringId, ...shot }) => shot) };
    if (!validatorFor(contractIds.projectResponse)(publicProject)
      || !validRelativeFile(descriptor.run_file, ".svrun")
      || !validRelativeFile(descriptor.narration_asset)
      || descriptor.asset_manifest === undefined || !validRelativeFile(descriptor.asset_manifest, ".json")
      || !validStudioOrigin(descriptor.studio_origin)
      || descriptor.preview.url !== `${descriptor.studio_origin}/`
      || descriptor.shots.some((shot) => !/^[A-Za-z0-9_-]+$/.test(shot.authoring_id))) {
      throw new HttpError(500, "INTERNAL_ERROR", "Project descriptor does not satisfy the contract");
    }
    if (publicProject.project_id !== projectId) throw new HttpError(500, "INTERNAL_ERROR", "Project registry identity mismatch");
    return descriptor;
  }

  descriptorRoot(projectId: string): string {
    const descriptor = this.entries.get(projectId);
    if (!descriptor) throw new HttpError(404, "NOT_FOUND", "Project not found");
    return dirname(descriptor);
  }
}

function validRelativeFile(value: string, suffix?: string): boolean {
  return value.length > 0 && !value.startsWith("/") && !value.startsWith("\\") && !value.split(/[\\/]/u).includes("..")
    && (suffix === undefined || value.endsWith(suffix));
}

function validStudioOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1"
      && url.port.length > 0 && url.origin === value && url.pathname === "/";
  } catch { return false; }
}
