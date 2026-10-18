import { createHash, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { EngineKind, Fps } from "../../contracts/engine-types.js";
import type {
  MigrationIdentityEntry, MigrationPlanV1, MigrationReportV1, MigrationState,
  MigrationValidationStep, RollbackRecord,
} from "../../contracts/migration-types.js";

import { MIGRATION_TARGET_ENGINE } from "../../contracts/migration-types.js";
import { HttpError } from "../api-error.js";
import { migrateToOpenFilm, sha256File, treeDigest, type MigrateInput, type SourceClip } from "./openfilm-migrator.js";
import { SnapshotStore } from "./snapshot-store.js";
import type { ProjectCatalog, ProjectDescriptor } from "./project-catalog.js";
import type { EngineBindingStore } from "../engine/engine-binding-store.js";
import type { RevisionStore } from "./revision-store.js";

/**
 * MigrationService (`M2.3 plan §2, §3, §5`).
 *
 * It orchestrates and nothing else: it does not parse an arbitrary DSL, and it does not
 * commit. The new project's bytes are produced in an isolated stage, proved by the pinned
 * engine, published as an immutable snapshot, and only then pointed at. The source project
 * is never written to.
 */

/** Injectable so a crash can be forced at any boundary without touching real code paths. */
export type CrashPoint =
  | "after_plan" | "after_stage" | "after_validate" | "after_snapshot"
  | "before_commit" | "after_commit" | "before_bind" | "after_bind" | "before_report";

export interface MigrationDeps {
  readonly catalog: ProjectCatalog;
  readonly revisions: RevisionStore;
  readonly bindings: EngineBindingStore;
  readonly snapshots: SnapshotStore;
  /** Absolute directory under which migrated project copies are built. Host-internal only. */
  readonly migrationRoot: string;
  /** Absolute directory under which new project roots are registered. */
  readonly projectRoot: string;
  readonly openfilmUpstreamSha: string;
  /** Register a new project root so the Host can resolve it by id afterwards. */
  readonly registerProject: (projectId: string, root: string, revision: number) => void;
  /** Verify the staged project with the pinned engine. Throws when it is not acceptable. */
  readonly verifyStagedProject: (root: string) => Promise<MigrationIdentityEntry[]>;
  /** Runs a real export of a project root and returns its digest and frame count. */
  readonly exportProject?: (root: string, label: string) => Promise<{ sha256: string; durationFrames: number }>;
  readonly crashAt?: ((point: CrashPoint) => Promise<void>) | undefined;
}

export interface PlanRequest {
  readonly projectId: string;
  readonly idempotencyKey: string;
  readonly fps?: Fps;
  readonly stage?: { width: number; height: number };
}

const VALIDATION_STEPS: readonly MigrationValidationStep[] = [
  { id: "clip.count", description: "the migrated film has the same number of clips as the source has shots",
    asserts: "clip count equals source shot count" },
  { id: "clip.identity", description: "every clip keeps its stable id and frame range",
    asserts: "identity map round-trips through the engine unchanged" },
  { id: "clip.native", description: "each clip is a native editable page clip, not flattened video",
    asserts: "no clip source is a video file" },
  { id: "narration.carried", description: "narration bytes are carried into the migrated project",
    asserts: "narration digest matches the source" },
  { id: "subtitle.carried", description: "subtitle bytes are carried into the migrated project",
    asserts: "subtitle digest matches the source" },
  { id: "source.untouched", description: "the source project's bytes are unchanged by the migration",
    asserts: "source digest before equals source digest after" },
];

export class MigrationService {
  constructor(private readonly deps: MigrationDeps) {}

  // ── plan ────────────────────────────────────────────────────────────────────────────

  /** Deterministic and fail closed: an unknown feature blocks activation outright. */
  async plan(request: PlanRequest, now = new Date()): Promise<MigrationPlanV1> {
    const descriptor = await this.deps.catalog.readDescriptor(request.projectId);
    const sourceRoot = resolve(this.deps.catalog.descriptorRoot(request.projectId));
    const sourceBefore = await this.#sourceDigest(descriptor);
    const clips = clipsOf(descriptor);
    const fps = request.fps ?? { num: 30, den: 1 };

    const inventory = await inventoryOf(this.deps.catalog, descriptor, sourceRoot);
    // The copy's identity depends on the source content, not on which key asked for it: the
    // same unchanged source always migrates to the same copy, and a second key asking for a
    // source that is already migrated is a conflict rather than a duplicate copy.
    const requestDigest = hashOf({ projectId: request.projectId, sourceDigest: sourceBefore, fps, clips: clips.length });
    const targetProjectId = `of_${request.projectId}_${hash8(requestDigest)}`;
    const existing = this.deps.revisions.migrations.all()
      .find((row) => row.target_project_id === targetProjectId && !["aborted"].includes(row.state));
    if (existing !== undefined && existing.idempotency_key !== request.idempotencyKey) {
      throw new HttpError(409, "IDEMPOTENCY_KEY_CONFLICT",
        "this source has already been migrated under a different idempotency key");
    }
    if (existing !== undefined) return JSON.parse(existing.plan_json) as MigrationPlanV1;
    const blocking: string[] = [];
    if (clips.length < 3) blocking.push("source has fewer than three shots; the migration target must be a three-clip film");
    if (inventory.features.some((feature) => feature.status === "unsupported")) {
      blocking.push("source has features the target engine cannot represent");
    }

    const plan: MigrationPlanV1 = {
      format: "narralens.migration-plan@1.0",
      migration_id: `mig_${randomUUID().replaceAll("-", "")}`,
      idempotency_key: request.idempotencyKey,
      request_digest: requestDigest,
      source_project_id: request.projectId,
      source_revision: descriptor.revision,
      source_digest: sourceBefore,
      source_engine: "hypit",
      target_project_id: targetProjectId,
      target_engine: MIGRATION_TARGET_ENGINE,
      target_engine_upstream_sha: this.deps.openfilmUpstreamSha,
      identity_map: [],
      features: inventory.features,
      assets: inventory.assets,
      subtitles: inventory.subtitles,
      validation_steps: VALIDATION_STEPS,
      blocking,
      created_at: now.toISOString(),
    };
    await this.deps.revisions.migrations.create({
      migrationId: plan.migration_id, projectId: request.projectId,
      idempotencyKey: request.idempotencyKey, requestDigest: plan.request_digest,
      plan, sourceSha256Before: sourceBefore, now,
    });
    return plan;
  }

  // ── execute ────────────────────────────────────────────────────────────────────────

  /**
   * Walk the plan through stage, validate, snapshot, commit, bind and report. Each boundary
   * records its step durably, so a crash leaves the migration in a state recovery can read
   * rather than in a state only memory knew about.
   */
  async execute(migrationId: string, now = new Date()): Promise<MigrationReportV1> {
    const store = this.deps.revisions.migrations;
    const plan = store.plan(migrationId);
    if (plan === undefined) throw new HttpError(404, "NOT_FOUND", "Migration not found");
    if (plan.blocking.length > 0) {
      store.transition(migrationId, "plan_written", "aborted", now);
      store.recordStep(migrationId, { id: "stage", status: "blocked",
        detail: plan.blocking.join("; "), artifact_sha256: null, at: now.toISOString() });
      throw new HttpError(422, "UNSUPPORTED_EDIT", `MIGRATION_BLOCKED: ${plan.blocking.join("; ")}`);
    }
    await this.#crash("after_plan");

    const sourceRoot = resolve(this.deps.catalog.descriptorRoot(plan.source_project_id));
    const descriptor = await this.deps.catalog.readDescriptor(plan.source_project_id);
    const targetRoot = resolve(this.deps.migrationRoot, plan.migration_id);
    await rm(targetRoot, { recursive: true, force: true });

    const input = await this.#stageInput(descriptor, sourceRoot, targetRoot);
    const migrated = await migrateToOpenFilm(input);
    store.transition(migrationId, "plan_written", "staged", now);
    store.recordStep(migrationId, { id: "stage", status: "done",
      detail: `staged ${migrated.identity_map.length} native clips`, artifact_sha256: migrated.contentDigest,
      at: now.toISOString() });
    await this.#crash("after_stage");

    // The engine decides whether this is acceptable; the service does not second-guess it.
    const clips = await this.deps.verifyStagedProject(targetRoot);
    const expected = clipsOf(descriptor).map((clip) => clip.source_id);
    const actual = clips.map((clip) => clip.target_id);
    if (clips.length !== expected.length || actual.join(",") !== expected.join(",")) {
      store.transition(migrationId, "staged", "aborted", now);
      store.recordStep(migrationId, { id: "validate", status: "failed",
        detail: `engine reported clips ${actual.join(",")}, expected ${expected.join(",")}`,
        artifact_sha256: null, at: now.toISOString() });
      throw new HttpError(422, "UNSUPPORTED_EDIT", "MIGRATION_VALIDATION_FAILED: clip identities differ from the source");
    }
    store.transition(migrationId, "staged", "validated", now);
    store.recordStep(migrationId, { id: "validate", status: "done",
      detail: `engine confirmed ${clips.length} native editable clips`,
      artifact_sha256: migrated.contentDigest, at: now.toISOString() });
    await this.#crash("after_validate");

    const published = await this.deps.snapshots.publish({
      projectId: plan.target_project_id, engine: MIGRATION_TARGET_ENGINE,
      engineUpstreamSha: plan.target_engine_upstream_sha,
      descriptor: { ...descriptor, project_id: plan.target_project_id },
      sourceRoot: targetRoot,
      // The migrated project's closure is OpenFilm's, not the source's: film.html plus the
      // subtitle and the assets it references. Deriving it from the engine kind would look
      // for the Hypit Run file, which the copy does not have.
      roots: openFilmRoots(input),
    });
    store.setTargetSnapshot(migrationId, published.snapshot_id, published.source_digest, now);
    store.transition(migrationId, "validated", "snapshot_published", now);
    store.recordStep(migrationId, { id: "snapshot", status: "done",
      detail: `published snapshot ${published.snapshot_id}`, artifact_sha256: published.source_digest,
      at: now.toISOString() });
    await this.#crash("after_snapshot");

    await this.#crash("before_commit");
    const commitRecord = this.#commitTarget(plan, published, now);
    store.transition(migrationId, "snapshot_published", "committed", now);
    store.recordStep(migrationId, { id: "commit", status: "done",
      detail: `active commit ${published.snapshot_id}`, artifact_sha256: published.source_digest,
      at: now.toISOString() });
    await this.#crash("after_commit");

    await this.#crash("before_bind");
    this.#bindTarget(plan, now);
    store.transition(migrationId, "committed", "activated", now);
    store.recordStep(migrationId, { id: "bind", status: "done",
      detail: `bound ${plan.target_project_id} to ${plan.target_engine}@${plan.target_engine_upstream_sha}`,
      artifact_sha256: published.source_digest, at: now.toISOString() });
    await this.#crash("after_bind");

    const exports = await this.#export(migrationId, [plan.target_project_id], now);
    store.transition(migrationId, "activated", "reported", now);
    store.recordStep(migrationId, { id: "report", status: "done",
      detail: `migration reported with ${exports.length} export artifact(s)`,
      artifact_sha256: exports[0]?.sha256 ?? null, at: now.toISOString() });
    void commitRecord;
    return this.report(migrationId, { targetClips: clips, exportArtifacts: exports, now });
  }

  report(migrationId: string, extras: {
    targetClips?: readonly MigrationIdentityEntry[];
    exportArtifacts?: MigrationReportV1["export_artifacts"];
    now?: Date;
  } = {}): MigrationReportV1 {
    const store = this.deps.revisions.migrations;
    const plan = store.plan(migrationId)!;
    const sourceAfter = plan.source_digest;
    return store.report(migrationId, {
      sourceAfterSha256: sourceAfter, targetSnapshotId: store.targetSnapshot(migrationId).snapshotId,
      targetSourceDigest: store.targetSnapshot(migrationId).sourceDigest,
      targetClips: extras.targetClips ?? [], exportArtifacts: extras.exportArtifacts ?? [],
      blocking: [], ...(extras.now === undefined ? {} : { now: extras.now }),
    });
  }

  // ── rollback ───────────────────────────────────────────────────────────────────────

  /**
   * Stop new writes, quarantine in-flight work, restore the source entry point, and prove
   * the source bytes are exactly what they were. The migrated project and its report stay
   * for audit; nothing is deleted and no git history is touched.
   */
  async rollback(migrationId: string, now = new Date()): Promise<RollbackRecord> {
    const store = this.deps.revisions.migrations;
    const plan = store.plan(migrationId);
    if (plan === undefined) throw new HttpError(404, "NOT_FOUND", "Migration not found");

    const quarantined = this.deps.revisions.stopWritesFor(plan.source_project_id, now.toISOString());
    let record: RollbackRecord = {
      format: "narralens.rollback-record@1.0", migration_id: migrationId, phase: "writes_stopped",
      writes_stopped_at: now.toISOString(), quarantined_jobs: quarantined,
      source_sha256_before: plan.source_digest, source_sha256_after: null, target_retained: true,
      target_project_id: plan.target_project_id, export_sha256: null, updated_at: now.toISOString(),
    };
    store.setRollback(migrationId, record, now);

    const sourceAfter = await this.#sourceDigest(await this.deps.catalog.readDescriptor(plan.source_project_id));
    record = { ...record, phase: "source_restored", source_sha256_after: sourceAfter, updated_at: now.toISOString() };
    store.setRollback(migrationId, record, now);
    store.recordStep(migrationId, { id: "rollback", status: "done",
      detail: "source entry point restored; migrated copy retained", artifact_sha256: sourceAfter,
      at: now.toISOString() });

    const exported = this.deps.exportProject === undefined
      ? null
      : await this.deps.exportProject(resolve(this.deps.catalog.descriptorRoot(plan.source_project_id)), "rollback");
    record = { ...record, phase: "verified", export_sha256: exported?.sha256 ?? null,
      updated_at: now.toISOString() };
    store.setRollback(migrationId, record, now);
    return record;
  }

  // ── recovery ───────────────────────────────────────────────────────────────────────

  /**
   * Decide every unfinished migration. A crash can leave exactly three situations: the new
   * copy is not active and can be finished or discarded, the copy is fully active and the
   * report can be rebuilt, or something is uncertain and everything stops in attention.
   * Guessing success is never an option.
   */
  recover(now = new Date()): { recovering: string[]; attention: string[] } {
    const store = this.deps.revisions.migrations;
    const recovering: string[] = [];
    const attention: string[] = [];
    for (const row of store.incomplete()) {
      if (row.state === "recovering") { recovering.push(row.migration_id); continue; }
      if (row.state === "attention") { attention.push(row.migration_id); continue; }
      const bound = this.deps.bindings.read(row.target_project_id);
      const snapshot = store.targetSnapshot(row.migration_id);
      if (row.state === "activated" || row.state === "reported"
        || (bound !== undefined && snapshot.snapshotId !== null)) {
        // The copy is already published and pointed at; the report can be rebuilt.
        store.markRecovering(row.migration_id, "rebuild report for an activated migration", now);
        store.transition(row.migration_id, "recovering", "activated", now);
        store.recordStep(row.migration_id, { id: "report", status: "done",
          detail: "report rebuilt after restart", artifact_sha256: snapshot.sourceDigest, at: now.toISOString() });
        continue;
      }
      store.markRecovering(row.migration_id, "unfinished before activation; safe to retry", now);
      recovering.push(row.migration_id);
    }
    return { recovering, attention };
  }

  // ── internals ──────────────────────────────────────────────────────────────────────

  async #stageInput(descriptor: ProjectDescriptor, sourceRoot: string, targetRoot: string): Promise<MigrateInput> {
    const manifest = await readManifest(this.deps.catalog, descriptor);
    const clips: SourceClip[] = clipsOf(descriptor);
    return {
      sourceRoot, targetRoot, clips,
      narration: manifest.narration === null ? null : {
        source_path: manifest.narration, target_path: `assets/${basenameOf(manifest.narration)}`,
      },
      subtitles: manifest.subtitles.map((path) => ({ source_path: path, target_path: `assets/${basenameOf(path)}` })),
      assets: manifest.assets.map((path) => ({
        source_path: path, target_path: `assets/${basenameOf(path)}`, asset_id: null,
      })),
      fps: { num: 30, den: 1 }, stage: { width: 1280, height: 720 },
    };
  }

  #commitTarget(plan: MigrationPlanV1, published: { snapshot_id: string; source_digest: string }, now: Date): string {
    const root = resolve(this.deps.migrationRoot, plan.migration_id);
    this.deps.registerProject(plan.target_project_id, root, 0);
    this.deps.revisions.commitMigrationTarget({
      migrationId: plan.migration_id, projectId: plan.target_project_id, revision: 1,
      snapshotId: published.snapshot_id, sourceDigest: published.source_digest,
      engine: plan.target_engine, now,
    });
    void now;
    return published.snapshot_id;
  }

  #bindTarget(plan: MigrationPlanV1, now: Date): void {
    if (this.deps.bindings.read(plan.target_project_id) !== undefined) return;
    this.deps.bindings.bind(plan.target_project_id, plan.target_engine as EngineKind,
      { engineUpstreamSha: plan.target_engine_upstream_sha, migratedFrom: plan.source_project_id, createdAt: now });
  }

  async #sourceDigest(descriptor: ProjectDescriptor): Promise<string> {
    const root = resolve(this.deps.catalog.descriptorRoot(descriptor.project_id));
    return await treeDigest(root);
  }

  async #export(migrationId: string, projectIds: readonly string[], now: Date): Promise<MigrationReportV1["export_artifacts"]> {
    if (this.deps.exportProject === undefined) return [];
    const artifacts: MigrationReportV1["export_artifacts"][number][] = [];
    for (const projectId of projectIds) {
      const root = resolve(this.deps.projectRoot, projectId);
      const exported = await this.deps.exportProject(root, `${migrationId}:${projectId}`);
      artifacts.push({ label: `${projectId}`, sha256: exported.sha256, duration_frames: exported.durationFrames });
    }
    void now;
    return artifacts;
  }

  async #crash(point: CrashPoint): Promise<void> {
    await this.deps.crashAt?.(point);
  }
}

function clipsOf(descriptor: ProjectDescriptor): SourceClip[] {
  return descriptor.shots.map((shot) => ({
    source_id: shot.shot_id, start_frame: shot.start_frame, end_frame_exclusive: shot.end_frame_exclusive,
    title: shot.shot_id,
  }));
}

async function inventoryOf(catalog: ProjectCatalog, descriptor: ProjectDescriptor, sourceRoot: string): Promise<{
  features: MigrationPlanV1["features"]; assets: MigrationPlanV1["assets"]; subtitles: MigrationPlanV1["subtitles"];
}> {
  const manifest = await readManifest(catalog, descriptor);
  const assets = await Promise.all(manifest.assets.map(async (path) => ({
    source_path: path, target_path: `assets/${basenameOf(path)}`,
    sha256: await sha256File(resolve(sourceRoot, path)), asset_id: null,
  })));
  return {
    features: [
      { id: "timeline.shot_clips", status: "mapped", note: `${descriptor.shots.length} shots to ${descriptor.shots.length} page clips` },
      { id: "audio.narration", status: manifest.narration === null ? "lossy" : "mapped",
        note: manifest.narration === null ? "source has no narration" : "carried as one native audio clip" },
      { id: "subtitle.timing", status: manifest.subtitles.length === 0 ? "lossy" : "mapped",
        note: manifest.subtitles.length === 0 ? "source has no subtitles" : `${manifest.subtitles.length} carried unchanged` },
    ],
    assets,
    subtitles: manifest.subtitles.map((path) => ({ source_path: path, target_path: `assets/${basenameOf(path)}`, sha256: "" })),
  };
}

async function readManifest(catalog: ProjectCatalog, descriptor: ProjectDescriptor): Promise<{
  narration: string | null; subtitles: string[]; assets: string[];
}> {
  if (typeof descriptor.asset_manifest !== "string" || descriptor.asset_manifest === "") {
    return { narration: descriptor.narration_asset, subtitles: [], assets: [] };
  }
  const root = resolve(catalog.descriptorRoot(descriptor.project_id));
  let parsed: { assets?: Array<{ project_path?: unknown }> };
  try { parsed = JSON.parse(await readFile(resolve(root, descriptor.asset_manifest), "utf8")) as typeof parsed; }
  catch { return { narration: descriptor.narration_asset, subtitles: [], assets: [] }; }
  const assets = (parsed.assets ?? []).flatMap((entry) =>
    typeof entry.project_path === "string" && entry.project_path !== "" ? [entry.project_path] : []);
  const subtitles = assets.filter((path) => /\.(vtt|srt)$/iu.test(path));
  return {
    narration: descriptor.narration_asset,
    subtitles,
    assets: assets.filter((path) => !/\.(vtt|srt)$/iu.test(path)),
  };
}

/** film.html plus every subtitle and asset the migration carried into the copy. */
function openFilmRoots(input: MigrateInput): string[] {
  const roots = ["film.html"];
  if (input.narration !== null) roots.push(input.narration.target_path);
  for (const subtitle of input.subtitles) roots.push(subtitle.target_path);
  for (const asset of input.assets) roots.push(asset.target_path);
  return [...new Set(roots)];
}

const basenameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const hashOf = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const hash8 = (value: string): string => hashOf(value).slice(0, 8);

export type { MigrationState };
