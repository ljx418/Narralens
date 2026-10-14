import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { FitEditOperation } from "../../contracts/types.js";
import { HttpError } from "../../host/api-error.js";
import type { ProjectCatalog, ProjectDescriptor } from "../../host/projects/project-catalog.js";

interface InspectorField {
  id: string;
  control: string;
  value: unknown;
  options?: unknown[];
  edit?: { source?: { path?: string; range?: { start: number; end: number }; preimage?: string } };
}

interface StudioItem {
  id: string;
  authoredId: string;
  startFrame: number;
  endFrameExclusive: number;
  inspector: InspectorField[];
  mediaAsset?: { assetId: string; sha256: string };
}

interface StudioSnapshot {
  revision: number;
  source: { path: string; text: string };
  timeline: { frameCount: number };
  tracks: Array<{ binding?: { facet?: string }; items: StudioItem[] }>;
}

interface HypitBaseCapture {
  descriptor: ProjectDescriptor;
  snapshot: StudioSnapshot;
  target: StudioItem;
  source_sha256: string;
  run_sha256: string;
  narration_sha256: string;
  semantic: Array<{ authored_id: string; start_frame: number; end_frame_exclusive: number; fit?: unknown; media_asset_id?: string }>;
}

export interface HypitCapture extends HypitBaseCapture { fitField: InspectorField; fit: "contain" | "cover" }
export interface HypitMediaCapture extends HypitBaseCapture { media_asset: { asset_id: string; sha256: string } }

export interface MutationResult { status: number; revision?: number; error?: string }

export class HypitWriteAdapter {
  constructor(private readonly catalog: ProjectCatalog) {}

  async visualFits(projectId: string): Promise<Record<string, "contain" | "cover">> {
    const descriptor = await this.catalog.readDescriptor(projectId);
    const snapshot = await this.#session(descriptor.studio_origin);
    const result: Record<string, "contain" | "cover"> = {};
    for (const shot of descriptor.shots) {
      const items = snapshot.tracks.flatMap((track) => track.binding?.facet === "visual" ? track.items : [])
        .filter((item) => item.authoredId === shot.authoring_id);
      const fields = items[0]?.inspector.filter((field) => field.id.endsWith(":inspector:fit")) ?? [];
      if (items.length === 1 && fields.length === 1 && (fields[0]!.value === "contain" || fields[0]!.value === "cover")) result[shot.shot_id] = fields[0]!.value;
    }
    return result;
  }

  async visualAssets(projectId: string): Promise<Record<string, string>> {
    const descriptor = await this.catalog.readDescriptor(projectId);
    const snapshot = await this.#session(descriptor.studio_origin);
    const result: Record<string, string> = {};
    for (const shot of descriptor.shots) {
      const items = snapshot.tracks.flatMap((track) => track.binding?.facet === "visual" ? track.items : [])
        .filter((item) => item.authoredId === shot.authoring_id);
      if (items.length === 1 && items[0]?.mediaAsset?.assetId) result[shot.shot_id] = items[0].mediaAsset.assetId;
    }
    return result;
  }

  async inspect(projectId: string, shotId: string, targetValue: FitEditOperation["value"]): Promise<HypitCapture> {
    const base = await this.#capture(projectId, shotId);
    const { target } = base;
    const fields = target.inspector.filter((field) => field.id.endsWith(":inspector:fit"));
    if (fields.length !== 1) throw new HttpError(422, "UNSUPPORTED_EDIT", "The target has no unique writable fit parameter");
    const fitField = fields[0]!;
    if (fitField.control !== "select" || typeof fitField.value !== "string" || !fitField.edit
      || !fitField.options?.includes(targetValue) || !["contain", "cover"].includes(fitField.value)) {
      throw new HttpError(422, "UNSUPPORTED_EDIT", "The target fit parameter is not writable by D3");
    }
    return { ...base, fitField, fit: fitField.value as "contain" | "cover" };
  }

  async inspectMedia(projectId: string, shotId: string): Promise<HypitMediaCapture> {
    const base = await this.#capture(projectId, shotId);
    const media = base.target.mediaAsset;
    if (!media || !/^asset_[a-z0-9][a-z0-9_-]{0,63}$/u.test(media.assetId) || !/^[a-f0-9]{64}$/u.test(media.sha256)) {
      throw new HttpError(422, "UNSUPPORTED_EDIT", "The target has no unique registered media asset");
    }
    return { ...base, media_asset: { asset_id: media.assetId, sha256: media.sha256 } };
  }

  async #capture(projectId: string, shotId: string): Promise<HypitBaseCapture> {
    const descriptor = await this.catalog.readDescriptor(projectId);
    const shot = descriptor.shots.find((candidate) => candidate.shot_id === shotId);
    if (!shot) throw new HttpError(422, "UNSUPPORTED_EDIT", "The selected shot is not registered");
    const snapshot = await this.#session(descriptor.studio_origin);
    if (!Number.isSafeInteger(snapshot.revision) || !Number.isSafeInteger(snapshot.timeline?.frameCount)) {
      throw new HttpError(500, "TRANSACTION_FAILED", "Hypit returned an invalid session snapshot");
    }
    const targets = snapshot.tracks.flatMap((track) => track.binding?.facet === "visual" ? track.items : [])
      .filter((item) => item.authoredId === shot.authoring_id);
    if (targets.length !== 1) throw new HttpError(422, "UNSUPPORTED_EDIT", "The authored shot identity is not unique");
    const target = targets[0];
    if (!target || target.startFrame !== shot.start_frame || target.endFrameExclusive !== shot.end_frame_exclusive
      || target.startFrame < 0 || target.endFrameExclusive <= target.startFrame || target.endFrameExclusive > snapshot.timeline.frameCount) {
      throw new HttpError(422, "UNSUPPORTED_EDIT", "The authored shot range does not match the project selection");
    }
    const root = this.catalog.descriptorRoot(projectId);
    const [source_sha256, run_sha256, narration_sha256] = await Promise.all([
      hashRegistered(root, snapshot.source.path), hashRegistered(root, descriptor.run_file), hashRegistered(root, descriptor.narration_asset),
    ]);
    const semantic = snapshot.tracks.flatMap((track) => track.items.map((item) => ({
      authored_id: item.authoredId,
      start_frame: item.startFrame,
      end_frame_exclusive: item.endFrameExclusive,
      ...(item.inspector.find((field) => field.id.endsWith(":inspector:fit")) ? { fit: item.inspector.find((field) => field.id.endsWith(":inspector:fit"))!.value } : {}),
      ...(item.mediaAsset ? { media_asset_id: item.mediaAsset.assetId } : {}),
    }))).sort((left, right) => left.authored_id.localeCompare(right.authored_id));
    return { descriptor, snapshot, target, source_sha256, run_sha256, narration_sha256, semantic };
  }

  async mutate(capture: HypitCapture, value: FitEditOperation["value"]): Promise<MutationResult> {
    const response = await this.#fetch(`${capture.descriptor.studio_origin}/__studio/mutation`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json", origin: capture.descriptor.studio_origin },
      body: JSON.stringify({
        type: "parameter.adjust",
        revision: capture.snapshot.revision,
        owner: { kind: "item", itemId: capture.target.id },
        parameterId: capture.fitField.id,
        value,
      }),
    });
    const body = await boundedJson(response);
    return { status: response.status, ...(typeof body.revision === "number" ? { revision: body.revision } : {}), ...(typeof body.error === "string" ? { error: body.error } : {}) };
  }

  async mutateMedia(capture: HypitMediaCapture, assetId: string, manifestSha256: string): Promise<MutationResult> {
    if (!/^[a-f0-9]{64}$/u.test(manifestSha256)) throw new HttpError(409, "MANIFEST_CHANGED", "The expected asset manifest sha256 is invalid");
    const response = await this.#fetch(`${capture.descriptor.studio_origin}/__studio/mutation`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/json", origin: capture.descriptor.studio_origin },
      body: JSON.stringify({ type: "media.replace", revision: capture.snapshot.revision, itemId: capture.target.id, assetId, manifestSha256 }),
    });
    const body = await boundedJson(response);
    return { status: response.status, ...(typeof body.revision === "number" ? { revision: body.revision } : {}), ...(typeof body.error === "string" ? { error: body.error } : {}) };
  }

  predictedSource(capture: HypitCapture, value: FitEditOperation["value"]): string {
    const source = capture.fitField.edit?.source;
    if (!source?.range || typeof source.preimage !== "string" || source.path !== capture.snapshot.source.path) {
      throw new HttpError(422, "UNSUPPORTED_EDIT", "The fit parameter has no exact Source edit descriptor");
    }
    const { start, end } = source.range;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start
      || capture.snapshot.source.text.slice(start, end) !== source.preimage) {
      throw new HttpError(409, "REVISION_CONFLICT", "The Hypit Source edit preimage has changed");
    }
    return `${capture.snapshot.source.text.slice(0, start)}${value}${capture.snapshot.source.text.slice(end)}`;
  }

  async sourceText(projectId: string, relativePath: string): Promise<string> {
    const root = this.catalog.descriptorRoot(projectId);
    return readFile(await safeRegisteredPath(root, relativePath), "utf8");
  }

  async #session(origin: string): Promise<StudioSnapshot> {
    const response = await this.#fetch(`${origin}/__studio/session`, { redirect: "manual", headers: { origin } });
    if (!response.ok) throw new HttpError(503, "HYPIT_UNAVAILABLE", "Hypit Studio session is unavailable");
    return await boundedJson(response) as unknown as StudioSnapshot;
  }

  async #fetch(url: string, init: RequestInit): Promise<Response> {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
      if (response.status >= 300 && response.status < 400) throw new Error("redirect rejected");
      return response;
    } catch {
      throw new HttpError(503, "HYPIT_UNAVAILABLE", "Hypit Studio is unavailable");
    }
  }
}

async function safeRegisteredPath(root: string, relativePath: string): Promise<string> {
  if (!relativePath || relativePath.startsWith("/") || relativePath.startsWith("\\") || relativePath.split(/[\\/]/u).includes("..")) {
    throw new HttpError(422, "UNSUPPORTED_EDIT", "Hypit referenced an unregistered path");
  }
  const canonicalRoot = await realpath(root);
  const candidate = await realpath(resolve(canonicalRoot, relativePath));
  if (!candidate.startsWith(`${canonicalRoot}${sep}`)) throw new HttpError(422, "UNSUPPORTED_EDIT", "Hypit path escaped the project root");
  return candidate;
}

async function hashRegistered(root: string, relativePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(await safeRegisteredPath(root, relativePath))).digest("hex");
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new HttpError(500, "TRANSACTION_FAILED", "Hypit response exceeded the limit");
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not object");
    return value as Record<string, unknown>;
  } catch { throw new HttpError(500, "TRANSACTION_FAILED", "Hypit returned an invalid JSON response"); }
}
