import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HttpError } from "../../host/api-error.js";
import { OPENFILM_UPSTREAM_SHA } from "../../host/engine/engine-binding-store.js";
import {
  absoluteServerPath, type AbsoluteServerPath, type CommandContext, type EngineEditPlan, type EnginePort, type JobRef,
  PreviewDescriptor, ReadContext, RenderProfile, SnapshotRef, StagedSource, ValidationReport,
} from "../../host/engine/engine-port.js";
import { FPS_30, rationalFromNumber, secondsToFrame } from "../../host/engine/time-model.js";
import { computeSourceDigest, type DeclaredAsset } from "../../host/engine/source-digest-v1.js";
import { openFilmCapabilityMap } from "../../host/engine/engine-capabilities.js";
import type {
  CapabilityMap, EngineAssetReference, EngineClip, EngineClipKind, EngineProjection,
  EngineSubtitle, EngineTrack, HalfOpenFrameRange,
} from "../../contracts/engine-types.js";
import type { OpenFilmOp, OpenFilmUpstream } from "./openfilm-upstream.js";

/**
 * OpenFilmEngineAdapter (`03_M2_M4_MODULE_DESIGN.md` §1.3).
 *
 * Uses only the M1B-verified upstream seam and never parses `film.html` itself: the
 * projection is mapped from the document the upstream already parsed, so there is no
 * second HTML dialect to keep in sync.
 *
 * In M2.1 this adapter is read-only. It has no reachable translated write path: the
 * NativeMutationRegistry marks every OpenFilm entry blocked or read_only, and the adapter
 * refuses to stage anything whose base does not match the strict Narralens precondition
 * (AC-004). A native `rebased: true` is never treated as success.
 */

export interface OpenFilmProjectLayout {
  /** Directory holding `film.html`. */
  readonly root: string;
  /** Declared digest roots. `film.html` first; subtitles and settings follow. */
  readonly roots: readonly string[];
  readonly declaredAssets?: readonly DeclaredAsset[];
  readonly fps?: typeof FPS_30;
  /** Subtitles the project declares beside its film. */
  readonly subtitles?: readonly { subtitle_id: string; path: string }[];
}

interface UpstreamDoc {
  stage?: { w?: unknown; h?: unknown };
  tracks?: Array<{ clips?: UpstreamClip[]; attrs?: Record<string, string> }>;
}

interface UpstreamClip {
  id?: unknown;
  src?: unknown;
  at?: unknown;
  time?: unknown;
  overrides?: unknown;
}

const PAGE_EXTENSIONS = /\.html?$/iu;
const STILL_EXTENSIONS = /\.(png|jpe?g|webp|gif|avif)$/iu;
const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|avi|ogv)$/iu;
const SOUND_EXTENSIONS = /\.(mp3|m4a|wav|aac|ogg|oga|opus|flac|aif|aiff|weba)$/iu;

function clipKind(sourceRef: string): EngineClipKind | null {
  if (PAGE_EXTENSIONS.test(sourceRef)) return "page";
  if (STILL_EXTENSIONS.test(sourceRef)) return "still";
  if (VIDEO_EXTENSIONS.test(sourceRef)) return "video";
  if (SOUND_EXTENSIONS.test(sourceRef)) return "sound";
  return null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRange(value: unknown): HalfOpenFrameRange | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const start = finite(value[0]);
  const end = finite(value[1]);
  if (start === null || end === null || end <= start || start < 0) return null;
  const from = secondsToFrame(rationalFromNumber(start), FPS_30, "floor");
  const to = secondsToFrame(rationalFromNumber(end), FPS_30, "ceil");
  return to > from ? { start_frame: from, end_frame_exclusive: to } : null;
}

export class OpenFilmEngineAdapter implements EnginePort {
  readonly #upstream: OpenFilmUpstream;
  readonly #layouts = new Map<string, OpenFilmProjectLayout>();

  constructor(upstream: OpenFilmUpstream) {
    this.#upstream = upstream;
  }

  get engineUpstreamSha(): string { return OPENFILM_UPSTREAM_SHA; }

  /** The Host registers where a bound project's source lives; a project id is never a path. */
  registerLayout(projectId: string, layout: OpenFilmProjectLayout): void {
    this.#layouts.set(projectId, layout);
  }

  async inspect(snapshot: SnapshotRef, ctx: ReadContext): Promise<EngineProjection> {
    const layout = this.#layout(snapshot.project_id, ctx.correlationId);
    const root = await realpath(layout.root);
    const read = await this.#upstream.readProjectFilm(root);
    if (read.problems.length > 0) {
      throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm reports the project film does not read",
        { problem_count: read.problems.length }, ctx.correlationId);
    }
    const digest = await computeSourceDigest({
      root,
      roots: layout.roots,
      engine: "openfilm",
      engineUpstreamSha: OPENFILM_UPSTREAM_SHA,
      declaredAssets: layout.declaredAssets,
    }, ctx.correlationId);
    if (snapshot.source_digest !== "" && digest.source_digest !== snapshot.source_digest) {
      throw new HttpError(409, "SOURCE_CHANGED", "OpenFilm source changed since the snapshot was taken", undefined, ctx.correlationId);
    }

    const doc = (read.doc ?? {}) as UpstreamDoc;
    const tracks: EngineTrack[] = [];
    const clips: EngineClip[] = [];
    let frameCount = 0;
    (doc.tracks ?? []).forEach((track, index) => {
      const trackId = `track_${index}`;
      const clipIds: string[] = [];
      for (const clip of track.clips ?? []) {
        const sourceRef = typeof clip.src === "string" ? clip.src : "";
        const kind = sourceRef === "" ? null : clipKind(sourceRef.split("#")[0] ?? "");
        if (typeof clip.id !== "string" || clip.id === "" || kind === null) continue;
        // The upstream omits `at` for a clip that starts at the beginning of its track.
        const start = finite(clip.at) ?? 0;
        const startFrame = secondsToFrame(rationalFromNumber(start), FPS_30, "floor");
        // `time` is the trim inside the clip's own source, not its timeline position, so
        // the timeline length is the source span laid out from `at`.
        const sourceRange = asRange(clip.time);
        const duration = sourceRange ? sourceRange.end_frame_exclusive - sourceRange.start_frame : 1;
        const frameRange: HalfOpenFrameRange = { start_frame: startFrame, end_frame_exclusive: startFrame + Math.max(duration, 1) };
        frameCount = Math.max(frameCount, frameRange.end_frame_exclusive);
        clipIds.push(clip.id);
        clips.push({
          clip_id: clip.id,
          track_id: trackId,
          kind,
          frame_range: frameRange,
          source_frame_range: sourceRange,
          source_ref: sourceRef.split("#")[0] ?? "",
          overrides_digest: Array.isArray(clip.overrides) && clip.overrides.length > 0
            ? createHash("sha256").update(JSON.stringify(clip.overrides)).digest("hex")
            : null,
        });
      }
      tracks.push({ track_id: trackId, index, clip_ids: clipIds });
    });

    const subtitles: EngineSubtitle[] = [];
    for (const subtitle of layout.subtitles ?? []) {
      const bytes = await readFile(resolve(root, subtitle.path));
      subtitles.push({ subtitle_id: subtitle.subtitle_id, source_ref: subtitle.path,
        content_sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    const assetReferences: EngineAssetReference[] = digest.manifest.assets.map((asset) => ({
      asset_id: asset.asset_id, path: asset.path, content_sha256: asset.sha256,
    }));

    return {
      engine: "openfilm",
      engine_upstream_sha: OPENFILM_UPSTREAM_SHA,
      snapshot_id: digest.source_digest.slice(0, 32),
      // Narralens revision tracking is M2.2; M2.1 reports 0 rather than inventing one.
      project_revision: 0,
      control_revision: 0,
      source_digest: digest.source_digest,
      fps: FPS_30,
      frame_count: frameCount,
      clips,
      tracks,
      subtitles,
      asset_references: assetReferences,
      editable_capabilities: await this.capabilities(snapshot, ctx),
      preview: { kind: "openfilm-studio", url: `file://${join(root, "film.html")}` },
      problems: [],
    };
  }

  /**
   * M2.1 exposes no OpenFilm write capability. The map is still complete: every registered
   * operation gets an explicit state, so a caller cannot read an absent entry as permission
   * and inherit Hypit's translated policy (M-01).
   */
  async capabilities(_snapshot: SnapshotRef, _ctx: ReadContext): Promise<CapabilityMap> {
    return openFilmCapabilityMap();
  }

  async plan(snapshot: SnapshotRef, _edit: EngineEditPlan["edit"], ctx: CommandContext): Promise<EngineEditPlan> {
    if (snapshot.project_id !== ctx.projectId) {
      throw new HttpError(409, "REVISION_CONFLICT", "Snapshot does not belong to the requested project", undefined, ctx.correlationId);
    }
    // M2.1 opens no OpenFilm edit semantics; the two typed edits are Hypit's. This refuses
    // rather than inventing an operation, so nothing can reach `editProjectFilm` from here.
    throw new HttpError(422, "UNSUPPORTED_EDIT",
      "OpenFilm has no translated write path in M2.1", undefined, ctx.correlationId);
  }

  /**
   * Copy the project into the Host-allocated isolated root and apply ops there only.
   * The base check happens before the upstream is touched, so a stale base can never be
   * silently rebased (AC-004).
   */
  async stage(plan: EngineEditPlan, isolatedRoot: AbsoluteServerPath, ctx: CommandContext): Promise<StagedSource> {
    const layout = this.#layout(ctx.projectId, ctx.correlationId);
    const sourceRoot = await realpath(layout.root);
    const stagedRoot = await mkdtemp(join(isolatedRoot.value, "openfilm-"));
    await cp(sourceRoot, stagedRoot, { recursive: true });

    const before = await this.#upstream.readProjectFilm(sourceRoot);
    if (before.problems.length > 0) {
      throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm reports the project film does not read", undefined, ctx.correlationId);
    }
    const currentDigest = await computeSourceDigest({
      root: sourceRoot, roots: layout.roots, engine: "openfilm", engineUpstreamSha: OPENFILM_UPSTREAM_SHA,
      declaredAssets: layout.declaredAssets,
    }, ctx.correlationId);
    if (plan.base_source_digest !== currentDigest.source_digest) {
      await rm(stagedRoot, { recursive: true, force: true });
      throw new HttpError(409, "SOURCE_CHANGED", "OpenFilm source changed before staging", undefined, ctx.correlationId);
    }
    const ops = plan.ops as readonly OpenFilmOp[];
    const edited = await this.#upstream.editProjectFilm(stagedRoot, before.rev, ops);
    if (edited.rebased) {
      // Upstream replayed onto a newer file. Narralens never adopts that as success.
      await rm(stagedRoot, { recursive: true, force: true });
      throw new HttpError(409, "SOURCE_CHANGED",
        "OpenFilm rebased the edit onto a newer film; Narralens does not accept a rebased write",
        undefined, ctx.correlationId);
    }
    const stagedDigest = await computeSourceDigest({
      root: stagedRoot, roots: layout.roots, engine: "openfilm", engineUpstreamSha: OPENFILM_UPSTREAM_SHA,
      declaredAssets: layout.declaredAssets,
    }, ctx.correlationId);
    return {
      isolated_root: absoluteServerPath(stagedRoot),
      relative_entry: "film.html",
      source_digest: stagedDigest.source_digest,
      revision: edited.rev,
    };
  }

  async validate(staged: StagedSource, _ctx: CommandContext): Promise<ValidationReport> {
    const stagedRoot = staged.isolated_root.value;
    const read = await this.#upstream.readProjectFilm(stagedRoot);
    if (read.problems.length > 0) {
      return { ok: false, problems: ["staged film does not read upstream"], source_digest: null };
    }
    return { ok: read.rev.length > 0, problems: [], source_digest: staged.source_digest };
  }

  async preview(_snapshot: SnapshotRef, _ctx: ReadContext): Promise<PreviewDescriptor> {
    throw new HttpError(404, "CAPABILITY_NOT_ENABLED", "OpenFilm Studio preview opens with the Studio integration in M5");
  }

  async render(_snapshot: SnapshotRef, _profile: RenderProfile, _ctx: CommandContext): Promise<JobRef> {
    throw new HttpError(404, "CAPABILITY_NOT_ENABLED", "Snapshot-bound OpenFilm render opens in M6");
  }

  /** Exposed for the fixture and probe only; never reachable from a Host route. */
  get upstream(): OpenFilmUpstream { return this.#upstream; }

  #layout(projectId: string, correlationId?: string): OpenFilmProjectLayout {
    const layout = this.#layouts.get(projectId);
    if (!layout) {
      throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm project layout is not registered", undefined, correlationId);
    }
    return layout;
  }
}
