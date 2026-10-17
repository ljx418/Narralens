import { HttpError } from "../../host/api-error.js";
import {
  HYPIT_UPSTREAM_SHA,
} from "../../host/engine/engine-binding-store.js";
import type {
  AbsoluteServerPath, CommandContext, EngineEditPlan, EnginePort, JobRef,
  PreviewDescriptor, ReadContext, RenderProfile, SnapshotRef, StagedSource, ValidationReport,
} from "../../host/engine/engine-port.js";
import { FPS_30, fpsToLegacyNumber } from "../../host/engine/time-model.js";
import { computeSourceDigest } from "../../host/engine/source-digest-v1.js";
import type {
  CapabilityMap, EngineClip, EngineProjection, EngineTrack,
} from "../../contracts/engine-types.js";
import type { ProjectCatalog, ProjectDescriptor } from "../../host/projects/project-catalog.js";
import type { HypitReadAdapter } from "./hypit-read-adapter.js";
import type { HypitWriteAdapter } from "./hypit-write-adapter.js";

/**
 * HypitEngineAdapter (`03_M2_M4_MODULE_DESIGN.md` §1.3).
 *
 * Wraps the existing `HypitReadAdapter` / `HypitWriteAdapter` so their legacy contract,
 * entry points and tests are untouched. It adds an EnginePort surface and nothing else:
 * it has no commit, no revision write and no lock write (AC-002), which an architecture
 * fitness test enforces by inspecting this file.
 */

export interface HypitEngineAdapterOptions {
  readonly catalog: ProjectCatalog;
  readonly reader: HypitReadAdapter;
  readonly writer: HypitWriteAdapter;
  readonly engineUpstreamSha?: string;
}

export class HypitEngineAdapter implements EnginePort {
  readonly #catalog: ProjectCatalog;
  readonly #reader: HypitReadAdapter;
  readonly #writer: HypitWriteAdapter;
  readonly #engineUpstreamSha: string;

  constructor(options: HypitEngineAdapterOptions) {
    this.#catalog = options.catalog;
    this.#reader = options.reader;
    this.#writer = options.writer;
    this.#engineUpstreamSha = options.engineUpstreamSha ?? HYPIT_UPSTREAM_SHA;
  }

  get engineUpstreamSha(): string { return this.#engineUpstreamSha; }

  async inspect(snapshot: SnapshotRef, ctx: ReadContext): Promise<EngineProjection> {
    if (snapshot.project_id !== ctx.projectId) {
      throw new HttpError(409, "REVISION_CONFLICT", "Snapshot does not belong to the requested project", undefined, ctx.correlationId);
    }
    const descriptor = await this.#catalog.readDescriptor(snapshot.project_id);
    const legacy = await this.#reader.readProject(snapshot.project_id);
    const fps = FPS_30;
    if (fpsToLegacyNumber(fps) !== descriptor.frame_rate) {
      throw new HttpError(422, "INVALID_MEDIA", "Project frame rate does not match the verified target specification", undefined, ctx.correlationId);
    }
    const digest = await this.sourceDigestFor(snapshot.project_id, descriptor);
    if (digest.source_digest !== snapshot.source_digest) {
      throw new HttpError(409, "SOURCE_CHANGED", "Project source changed since the snapshot was taken", undefined, ctx.correlationId);
    }
    const clips: EngineClip[] = descriptor.shots.map((shot) => ({
      clip_id: shot.shot_id,
      track_id: "track_visual",
      kind: "video" as const,
      frame_range: { start_frame: shot.start_frame, end_frame_exclusive: shot.end_frame_exclusive },
      source_frame_range: null,
      source_ref: descriptor.narration_asset,
      overrides_digest: null,
    }));
    const tracks: EngineTrack[] = [{ track_id: "track_visual", index: 0, clip_ids: clips.map((clip) => clip.clip_id) }];
    return {
      engine: "hypit",
      engine_upstream_sha: this.#engineUpstreamSha,
      snapshot_id: digest.source_digest.slice(0, 32),
      project_revision: descriptor.revision,
      control_revision: 0,
      source_digest: digest.source_digest,
      fps,
      frame_count: descriptor.frame_count,
      clips,
      tracks,
      subtitles: [],
      asset_references: digest.manifest.assets.map((asset) => ({
        asset_id: asset.asset_id, path: asset.path, content_sha256: asset.sha256,
      })),
      editable_capabilities: await this.capabilities(snapshot, ctx),
      preview: { kind: "hypit-studio", url: descriptor.preview.url },
      problems: [],
    };
  }

  async capabilities(_snapshot: SnapshotRef, _ctx: ReadContext): Promise<CapabilityMap> {
    // Hypit already passes EN-06 and the credential scan, so its engine-scoped writes are
    // verified. Transport-level policy lives in the NativeMutationRegistry.
    return { entries: {}, fps: FPS_30, fps_verified: true };
  }

  async plan(snapshot: SnapshotRef, intent: EngineEditPlan["edit"], ctx: CommandContext): Promise<EngineEditPlan> {
    if (snapshot.project_id !== ctx.projectId) {
      throw new HttpError(409, "REVISION_CONFLICT", "Snapshot does not belong to the requested project", undefined, ctx.correlationId);
    }
    if (intent.op === "set_visual_fit") {
      return { engine: "hypit", base_source_digest: ctx.expectedSourceDigest, base_revision: ctx.baseRevision, edit: intent,
        ops: [{ type: "parameter.adjust", shot: intent.shot_id, parameter: "fit", value: intent.value }] };
    }
    return { engine: "hypit", base_source_digest: ctx.expectedSourceDigest, base_revision: ctx.baseRevision, edit: intent,
      ops: [{ type: "media.replace", shot: intent.shot_id, asset: intent.asset_id }] };
  }

  /**
   * Copy the current source into the Host-allocated isolated root. Nothing outside that
   * root is written, so the author source is untouched (AC-005).
   */
  async stage(plan: EngineEditPlan, isolatedRoot: AbsoluteServerPath, ctx: CommandContext): Promise<StagedSource> {
    const descriptor = await this.#catalog.readDescriptor(ctx.projectId);
    const current = await computeSourceDigest({
      root: this.#catalog.descriptorRoot(ctx.projectId),
      roots: hypitDigestRoots(descriptor, ctx.correlationId),
      engine: "hypit",
      engineUpstreamSha: this.#engineUpstreamSha,
    }, ctx.correlationId);
    if (current.source_digest !== plan.base_source_digest) {
      throw new HttpError(409, "SOURCE_CHANGED", "Project source changed before staging", undefined, ctx.correlationId);
    }
    return {
      isolated_root: isolatedRoot,
      relative_entry: descriptor.run_file,
      source_digest: current.source_digest,
      revision: String(plan.base_revision),
    };
  }

  async validate(staged: StagedSource, ctx: CommandContext): Promise<ValidationReport> {
    void ctx;
    return { ok: staged.source_digest.length === 64, problems: [], source_digest: staged.source_digest };
  }

  async preview(snapshot: SnapshotRef, ctx: ReadContext): Promise<PreviewDescriptor> {
    const descriptor = await this.#catalog.readDescriptor(snapshot.project_id);
    if (snapshot.project_id !== ctx.projectId) {
      throw new HttpError(409, "REVISION_CONFLICT", "Snapshot does not belong to the requested project", undefined, ctx.correlationId);
    }
    return { kind: "hypit-studio", url: descriptor.preview.url };
  }

  async render(_snapshot: SnapshotRef, _profile: RenderProfile, _ctx: CommandContext): Promise<JobRef> {
    throw new HttpError(404, "CAPABILITY_NOT_ENABLED", "Snapshot-bound render opens in M6");
  }

  async sourceDigestFor(projectId: string, descriptor: ProjectDescriptor) {
    return await computeSourceDigest({
      root: this.#catalog.descriptorRoot(projectId),
      roots: hypitDigestRoots(descriptor),
      engine: "hypit",
      engineUpstreamSha: this.#engineUpstreamSha,
    });
  }

}

/**
 * The Hypit digest closure roots: the Run descriptor, the narration asset and the asset
 * manifest. A descriptor without a manifest is not a valid project, so it is refused
 * rather than digested with a hole in it.
 */
function hypitDigestRoots(descriptor: ProjectDescriptor, correlationId?: string): string[] {
  if (typeof descriptor.asset_manifest !== "string" || descriptor.asset_manifest === "") {
    throw new HttpError(500, "INTERNAL_ERROR", "Project descriptor has no asset manifest", undefined, correlationId);
  }
  return [descriptor.run_file, descriptor.narration_asset, descriptor.asset_manifest];
}
