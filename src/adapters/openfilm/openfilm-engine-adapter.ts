import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { HttpError } from "../../host/api-error.js";
import { OPENFILM_UPSTREAM_SHA } from "../../host/engine/engine-binding-store.js";
import type {
  AbsoluteServerPath, CommandContext, EngineEditPlan, EnginePort, JobRef,
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
import { isAdoptEnginePlanIntent, type AdoptEnginePlanIntent } from "../../host/engine/engine-plan-intent.js";
import type { NativePlanV1 } from "../../contracts/wave2-types.js";

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

export interface M4BOpenFilmSetOp {
  readonly op: "set";
  readonly clip: string;
  readonly field: "src" | "time" | "overrides";
  readonly value: string | readonly [number, number] | null;
}

interface AdoptionValidationProof {
  readonly kind: "m4b-adoption";
  readonly native_plan: NativePlanV1;
  readonly roots: readonly string[];
  readonly non_visual_sha256: string;
}

const PAGE_EXTENSIONS = /\.html?$/iu;
const STILL_EXTENSIONS = /\.(png|jpe?g|webp|gif|avif)$/iu;
const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|avi|ogv)$/iu;
const SOUND_EXTENSIONS = /\.(mp3|m4a|wav|aac|ogg|oga|opus|flac|aif|aiff|weba)$/iu;

/**
 * Every clip attribute this projection models. A new upstream attribute is therefore a
 * deliberate decision to model or to report, never something that is quietly ignored.
 */
const MODELLED_CLIP_FIELDS: ReadonlySet<string> = new Set(["id", "src", "at", "time", "overrides"]);

/**
 * Track kinds the consumer graph can classify. `data-track` outside this set is a hint the
 * graph cannot act on, so it is reported instead of being treated as "some track".
 */
const KNOWN_TRACK_KINDS: ReadonlySet<string> = new Set([
  "picture", "video", "still", "narration", "subtitle", "audio", "sound",
]);

/** Prefix on every completeness problem, so a consumer can recognise one without a parser. */
export const OPENFILM_PROJECTION_PROBLEM_PREFIX = "OPENFILM_PROJECTION:";
const PROBLEM_PREFIX = OPENFILM_PROJECTION_PROBLEM_PREFIX;

const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
const assetToken = (digest: string): string => `assets/${digest}/source.mp4`;
const secondsAtMillisecondPrecision = (frame: number): number => Math.round((frame / 30) * 1_000) / 1_000;

function nonVisualDigest(doc: UpstreamDoc): string {
  const preserved = (doc.tracks ?? []).flatMap((track, trackIndex) => (track.clips ?? [])
    .filter((clip) => typeof clip.src === "string" && SOUND_EXTENSIONS.test(clip.src.split("#")[0] ?? ""))
    .map((clip) => ({ track: trackIndex, clip })));
  return sha256(JSON.stringify(preserved));
}

function isClosedAdoptionOps(value: readonly unknown[], plan: NativePlanV1): value is readonly M4BOpenFilmSetOp[] {
  if (value.length !== plan.clips.length * 3 || plan.clips.length !== 3) return false;
  return plan.clips.every((clip, index) => {
    const group = value.slice(index * 3, index * 3 + 3) as Array<Partial<M4BOpenFilmSetOp>>;
    const allowed = new Set(["op", "clip", "field", "value"]);
    if (group.some((op) => Object.keys(op).some((key) => !allowed.has(key)))) return false;
    return group[0]?.op === "set" && group[0].clip === clip.clip_id && group[0].field === "src"
      && group[0].value === assetToken(clip.asset_sha256)
      && group[1]?.op === "set" && group[1].clip === clip.clip_id && group[1].field === "time"
      && Array.isArray(group[1].value) && group[1].value.length === 2
      && group[2]?.op === "set" && group[2].clip === clip.clip_id && group[2].field === "overrides"
      && group[2].value === null;
  });
}

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
    // Recompute the byte-level source identity before interpreting the document. If a
    // previously committed film becomes malformed, that is still a deterministic source
    // change and must be reported as such; parsing first used to turn it into a transient
    // 503 and leave an authorization active indefinitely.
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

    const read = await this.#upstream.readProjectFilm(root);
    if (read.problems.length > 0) {
      throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm reports the project film does not read",
        { problem_count: read.problems.length }, ctx.correlationId);
    }

    const doc = (read.doc ?? {}) as UpstreamDoc;
    const tracks: EngineTrack[] = [];
    const clips: EngineClip[] = [];
    // M4A-0 projection completeness. Every reason a node failed to reach the projection is
    // recorded instead of being skipped, because "the projection does not mention it" is not
    // evidence that the upstream film does not contain it — it is exactly what a silent
    // skip looks like. A consumer that trusted this projection would then compute an impact
    // that silently omits a clip, a transition or an override.
    const problems: string[] = [];
    let frameCount = 0;
    const seenClipIds = new Set<string>();
    // `doc` is whatever the upstream returned, cast here. A malformed document must be
    // *reported*, not crashed on: a `null` track or clip used to reach `track.attrs` and
    // throw a TypeError out of the adapter, which is a 500 where the whole point of this
    // block is a `problems[]` entry. Every node is coerced to an object first, so the most
    // malformed document still produces a diagnosable answer.
    for (const [index, rawTrack] of (Array.isArray(doc.tracks) ? doc.tracks : []).entries()) {
      const trackId = `track_${index}`;
      const clipIds: string[] = [];
      if (rawTrack === null || typeof rawTrack !== "object") {
        problems.push(`${PROBLEM_PREFIX}TRACK_UNREADABLE:${trackId}`);
        tracks.push({ track_id: trackId, index, clip_ids: clipIds });
        continue;
      }
      // `attrs` carries `data-track`, which is the only track-level fact this projection
      // models. Anything else is a hint about structure the consumer graph cannot express.
      const attrs = rawTrack.attrs ?? {};
      for (const key of Object.keys(attrs).sort()) {
        if (key !== "data-track") problems.push(`${PROBLEM_PREFIX}TRACK_UNMODELED_ATTR:${trackId}:${key}`);
      }
      const declaredKind = attrs["data-track"];
      if (typeof declaredKind === "string" && !KNOWN_TRACK_KINDS.has(declaredKind)) {
        problems.push(`${PROBLEM_PREFIX}TRACK_UNKNOWN_KIND:${trackId}:${declaredKind}`);
      }
      for (const [clipIndex, rawClip] of (Array.isArray(rawTrack.clips) ? rawTrack.clips : []).entries()) {
        if (rawClip === null || typeof rawClip !== "object") {
          problems.push(`${PROBLEM_PREFIX}CLIP_UNREADABLE:${trackId}#${clipIndex}`);
          continue;
        }
        const clip = rawClip as UpstreamClip;
        for (const field of Object.keys(clip).sort()) {
          if (!MODELLED_CLIP_FIELDS.has(field)) {
            const id = typeof clip.id === "string" && clip.id !== "" ? clip.id : `${trackId}#${clipIndex}`;
            problems.push(`${PROBLEM_PREFIX}CLIP_UNMODELED_FIELD:${id}:${field}`);
          }
        }
        const sourceRef = typeof clip.src === "string" ? clip.src : "";
        const kind = sourceRef === "" ? null : clipKind(sourceRef.split("#")[0] ?? "");
        if (typeof clip.id !== "string" || clip.id === "") {
          problems.push(`${PROBLEM_PREFIX}CLIP_NO_ID:${trackId}`);
          continue;
        }
        if (kind === null) {
          problems.push(`${PROBLEM_PREFIX}CLIP_UNKNOWN_SOURCE:${clip.id}`);
          continue;
        }
        if (seenClipIds.has(clip.id)) {
          problems.push(`${PROBLEM_PREFIX}DUPLICATE_CLIP_ID:${clip.id}`);
          continue;
        }
        seenClipIds.add(clip.id);
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
        // An override is a per-clip rendering change M4A's consumer graph cannot reason
        // about, so its presence is reported rather than reduced to a digest nobody reads.
        if (Array.isArray(clip.overrides) && clip.overrides.length > 0) {
          problems.push(`${PROBLEM_PREFIX}CLIP_OVERRIDES:${clip.id}`);
        }
      }
      tracks.push({ track_id: trackId, index, clip_ids: clipIds });
    }

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
      // Host-relative, never a filesystem path: the Host resolves it against its own
      // loopback origin and token when it answers. Exposing an absolute server path in a
      // projection would disclose the filesystem layout to the client.
      preview: { kind: "openfilm-studio", url: `/api/migration/v1/projects/${snapshot.project_id}/preview` },
      problems,
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

  async plan(snapshot: SnapshotRef, intent: EngineEditPlan["edit"], ctx: CommandContext): Promise<EngineEditPlan> {
    if (snapshot.project_id !== ctx.projectId) {
      throw new HttpError(409, "REVISION_CONFLICT", "Snapshot does not belong to the requested project", undefined, ctx.correlationId);
    }
    if (!isAdoptEnginePlanIntent(intent)) {
      throw new HttpError(422, "UNSUPPORTED_EDIT",
        "OpenFilm accepts only the Host-injected M4B adoption intent", undefined, ctx.correlationId);
    }
    this.#assertAdoptionIntent(intent, ctx.correlationId);
    const projection = await this.inspect(snapshot, ctx);
    if (projection.problems.length > 0) {
      throw new HttpError(422, "UNSUPPORTED_EDIT", "The active OpenFilm projection is incomplete",
        { problem_count: projection.problems.length }, ctx.correlationId);
    }
    const visual = projection.clips.filter((clip) => clip.kind !== "sound");
    if (visual.length !== 3 || visual.some((clip, index) => clip.clip_id !== intent.native_plan.clips[index]?.clip_id)) {
      throw new HttpError(422, "UNSUPPORTED_EDIT",
        "The adoption plan must address the three existing visual clips in stable order", undefined, ctx.correlationId);
    }
    const ops: M4BOpenFilmSetOp[] = intent.native_plan.clips.flatMap((clip) => [
      { op: "set", clip: clip.clip_id, field: "src", value: assetToken(clip.asset_sha256) },
      { op: "set", clip: clip.clip_id, field: "time", value: [
        secondsAtMillisecondPrecision(clip.source.start_frame),
        secondsAtMillisecondPrecision(clip.source.end_frame_exclusive),
      ] as const },
      { op: "set", clip: clip.clip_id, field: "overrides", value: null },
    ]);
    if (!isClosedAdoptionOps(ops, intent.native_plan)) throw new Error("M4B_CLOSED_OP_CONSTRUCTION_FAILED");
    return { engine: "openfilm", base_source_digest: ctx.expectedSourceDigest,
      base_revision: ctx.baseRevision, edit: intent, ops };
  }

  /**
   * Copy the project into the Host-allocated isolated root and apply ops there only.
   * The base check happens before the upstream is touched, so a stale base can never be
   * silently rebased (AC-004).
   */
  async stage(plan: EngineEditPlan, isolatedRoot: AbsoluteServerPath, ctx: CommandContext): Promise<StagedSource> {
    const layout = this.#layout(ctx.projectId, ctx.correlationId);
    const sourceRoot = await realpath(layout.root);

    // The strict base check runs before anything is copied or written, so a stale base
    // costs no I/O, touches no file and can never reach the upstream mutator (AC-004).
    const currentDigest = await computeSourceDigest({
      root: sourceRoot, roots: layout.roots, engine: "openfilm", engineUpstreamSha: OPENFILM_UPSTREAM_SHA,
      declaredAssets: layout.declaredAssets,
    }, ctx.correlationId);
    if (plan.base_source_digest !== currentDigest.source_digest) {
      throw new HttpError(409, "SOURCE_CHANGED", "OpenFilm source changed before staging", undefined, ctx.correlationId);
    }
    const before = await this.#upstream.readProjectFilm(sourceRoot);
    if (before.problems.length > 0) {
      throw new HttpError(503, "ENGINE_UNAVAILABLE", "OpenFilm reports the project film does not read", undefined, ctx.correlationId);
    }

    const stagedRoot = await mkdtemp(join(isolatedRoot.value, "openfilm-"));
    let handedOver = false;
    try {
      await cp(sourceRoot, stagedRoot, { recursive: true });
      if (!isAdoptEnginePlanIntent(plan.edit) || !isClosedAdoptionOps(plan.ops, plan.edit.native_plan)) {
        throw new HttpError(422, "UNSUPPORTED_EDIT", "OpenFilm adoption ops are not the closed nine-op plan", undefined, ctx.correlationId);
      }
      for (const clip of plan.edit.native_plan.clips) {
        const input = join(isolatedRoot.value, "inputs", clip.asset_sha256, "source.mp4");
        const bytes = await readFile(input);
        if (sha256(bytes) !== clip.asset_sha256) {
          throw new HttpError(422, "INVALID_MEDIA", "A staged adoption asset does not match its content address",
            { clip_id: clip.clip_id }, ctx.correlationId);
        }
        const target = join(stagedRoot, assetToken(clip.asset_sha256));
        await mkdir(dirname(target), { recursive: true });
        await copyFile(input, target);
      }
      const edited = await this.#upstream.editProjectFilm(stagedRoot, before.rev, plan.ops as readonly OpenFilmOp[]);
      if (edited.rebased) {
        // Upstream replayed onto a newer file. Narralens never adopts that as success.
        throw new HttpError(409, "SOURCE_CHANGED",
          "OpenFilm rebased the edit onto a newer film; Narralens does not accept a rebased write",
          undefined, ctx.correlationId);
      }
      const roots = [...new Set([...layout.roots, ...plan.edit.native_plan.clips.map((clip) => assetToken(clip.asset_sha256))])].sort();
      const stagedDigest = await computeSourceDigest({
        root: stagedRoot, roots, engine: "openfilm", engineUpstreamSha: OPENFILM_UPSTREAM_SHA,
        declaredAssets: layout.declaredAssets,
      }, ctx.correlationId);
      // Only the directory NAME crosses back: an adapter never hands out a server path.
      handedOver = true;
      return {
        isolated_relative_root: basename(stagedRoot),
        relative_entry: "film.html",
        source_digest: stagedDigest.source_digest,
        revision: edited.rev,
        validation_proof: { kind: "m4b-adoption", native_plan: plan.edit.native_plan,
          roots, non_visual_sha256: nonVisualDigest((before.doc ?? {}) as UpstreamDoc) } satisfies AdoptionValidationProof,
      };
    } finally {
      // Every failure path leaves nothing behind; success transfers ownership to the caller.
      if (!handedOver) await rm(stagedRoot, { recursive: true, force: true });
    }
  }

  async validate(staged: StagedSource, ctx: CommandContext): Promise<ValidationReport> {
    const stagedRoot = join(ctx.isolatedRoot.value, staged.isolated_relative_root);
    const read = await this.#upstream.readProjectFilm(stagedRoot);
    if (read.problems.length > 0) {
      return { ok: false, problems: ["staged film does not read upstream"], source_digest: null };
    }
    const proof = staged.validation_proof as Partial<AdoptionValidationProof> | undefined;
    if (proof?.kind !== "m4b-adoption" || proof.native_plan === undefined || proof.roots === undefined) {
      return { ok: false, problems: ["staged source has no M4B validation proof"], source_digest: null };
    }
    const layout = this.#layout(ctx.projectId, ctx.correlationId);
    const digest = await computeSourceDigest({ root: stagedRoot, roots: proof.roots,
      engine: "openfilm", engineUpstreamSha: OPENFILM_UPSTREAM_SHA, declaredAssets: layout.declaredAssets }, ctx.correlationId);
    const doc = (read.doc ?? {}) as UpstreamDoc;
    const clips = (doc.tracks ?? []).flatMap((track) => track.clips ?? []);
    const problems: string[] = [];
    for (const planned of proof.native_plan.clips) {
      const clip = clips.find((candidate) => candidate.id === planned.clip_id);
      const range = asRange(clip?.time);
      if (clip === undefined || clip.src !== assetToken(planned.asset_sha256)) problems.push(`clip ${planned.clip_id} source mismatch`);
      if (range?.start_frame !== planned.source.start_frame
        || range?.end_frame_exclusive !== planned.source.end_frame_exclusive) problems.push(`clip ${planned.clip_id} frame range mismatch`);
      if (clip?.overrides !== null) problems.push(`clip ${planned.clip_id} overrides were not cleared`);
    }
    if (proof.native_plan.clips.length !== 3) problems.push("adoption does not preserve three visual clips");
    if (proof.non_visual_sha256 !== nonVisualDigest(doc)) problems.push("narration/audio changed during adoption");
    if (digest.source_digest !== staged.source_digest) problems.push("staged source digest was not independently reproduced");
    return { ok: problems.length === 0 && read.rev.length > 0, problems, source_digest: digest.source_digest };
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

  #assertAdoptionIntent(intent: AdoptEnginePlanIntent, correlationId?: string): void {
    const plan = intent.native_plan;
    const validSha = /^[a-f0-9]{64}$/u;
    if (intent.edit.materialization_id !== intent.materialization_id
      || intent.edit.impact_hash !== intent.impact_hash
      || !validSha.test(intent.rights_digest) || !validSha.test(intent.impact_hash)
      || plan.engine !== "openfilm" || plan.fps.num !== 30 || plan.fps.den !== 1
      || plan.narration_policy !== "preserve" || plan.duration_policy !== "preserve"
      || plan.clips.length !== 3 || !validSha.test(plan.plan_sha256)) {
      throw new HttpError(422, "UNSUPPORTED_EDIT", "The Host adoption intent is incomplete or inconsistent", undefined, correlationId);
    }
    let end = 0;
    const ids = new Set<string>();
    for (const clip of plan.clips) {
      const duration = clip.timeline.end_frame_exclusive - clip.timeline.start_frame;
      const sourceDuration = clip.source.end_frame_exclusive - clip.source.start_frame;
      if (ids.has(clip.clip_id) || !validSha.test(clip.asset_sha256)
        || clip.timeline.start_frame !== end || duration <= 0 || sourceDuration !== duration) {
        throw new HttpError(422, "UNSUPPORTED_EDIT", "The native plan is not a closed three-clip replacement", undefined, correlationId);
      }
      ids.add(clip.clip_id);
      end = clip.timeline.end_frame_exclusive;
    }
    if (end !== plan.total_frames) {
      throw new HttpError(422, "UNSUPPORTED_EDIT", "The native plan does not cover its declared duration", undefined, correlationId);
    }
  }
}
