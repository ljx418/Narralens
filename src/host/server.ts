import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ControlledAgentRunner, type ComparisonRunnerInput } from "../adapters/openmontage/controlled-agent-runner.js";
import { ProposalAdapter } from "../adapters/openmontage/proposal-adapter.js";
import { ProposalComparisonAdapter } from "../adapters/openmontage/proposal-comparison-adapter.js";
import { validateEditRequest, validateEngineResponse, validateProposalComparisonRequest } from "../contracts/validator.js";
import type { EngineResponse } from "../contracts/engine-types.js";
import type { ApiError, JobEvent, ProjectResponse, ProposalComparisonRequest } from "../contracts/types.js";
import { HttpError, normalizeError } from "./api-error.js";
import { HostDiagnostics } from "./host-diagnostics.js";
import { AssetImportService } from "./assets/asset-import-service.js";
import { JobStore } from "./job-store.js";
import { PersistentJobStore } from "./persistent-job-store.js";
import { Outbox } from "./outbox.js";
import { MigrationService } from "./projects/migration-service.js";
import type { MigrationReportV1, RollbackRecord } from "../contracts/migration-types.js";
import { createPinnedOpenFilmUpstream } from "../adapters/openfilm/openfilm-upstream.js";
import { NativeMutationRegistry } from "./engine/native-mutation-registry.js";
import { NativeWriteGateway } from "./engine/native-write-gateway.js";
import { LockService } from "./projects/lock-service.js";
import { ProjectCoordinator, type ResolvedSource } from "./projects/project-coordinator.js";
import { SnapshotStore } from "./projects/snapshot-store.js";
import { ProjectCatalog, type ProjectDescriptor } from "./projects/project-catalog.js";
import { ProjectWriteActor } from "./projects/project-write-actor.js";
import { InMemoryProjectOperationQueue, type ProjectOperationQueue } from "./projects/project-operation-queue.js";
import { RevisionStore } from "./projects/revision-store.js";
import { isAllowedBrowserRequest, tokenMatches } from "./security.js";
import { EngineBindingStore, OPENFILM_UPSTREAM_SHA, upstreamShaFor } from "./engine/engine-binding-store.js";
import { EngineRegistry } from "./engine/engine-registry.js";
import { composeOpenFilmPort, type OpenFilmComposition } from "./engine/openfilm-composition.js";
import { AssetInventoryPort } from "./projects/asset-inventory-port.js";
import { MigratedAssetLedger } from "./projects/migrated-asset-ledger.js";
import { ProjectResolver } from "./projects/project-resolver.js";
import { HypitEngineAdapter } from "../adapters/hypit/hypit-engine-adapter.js";
import { HypitReadAdapter } from "../adapters/hypit/hypit-read-adapter.js";

const bodyLimit = 65_536;

/** Where the pinned OpenFilm checkout lives. Composition-time only, never a request field. */
function openfilmVendorRoot(): string {
  return resolve(process.env.NARRALENS_OPENFILM_VENDOR ?? projectRoot, "vendor/openfilm");
}
const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

interface HostDependencies {
  catalog?: ProjectCatalog;
  runner?: ControlledAgentRunner;
  proposals?: ProposalAdapter;
  comparisons?: ProposalComparisonAdapter;
  writes?: ProjectWriteActor;
  revisionStore?: RevisionStore;
  operationQueue?: ProjectOperationQueue;
  imports?: AssetImportService;
  engines?: EngineRegistry;
  jobs?: PersistentJobStore | JobStore;
  snapshotsRoot?: string;
  /** Overrides for tests and for a Host whose working directory is not the repository. */
  migrationsRoot?: string;
  dbPath?: string;
  leaseReapIntervalMs?: number;
  outboxReplayIntervalMs?: number;
  sessionTtlMs?: number;
}

export class NarralensHost {
  readonly catalog: ProjectCatalog;
  /** M2.2: durable by default; the in-memory JobStore stays as the legacy implementation. */
  readonly jobs: PersistentJobStore | JobStore;
  readonly outbox: Outbox;
  readonly runner: ControlledAgentRunner;
  readonly proposals: ProposalAdapter;
  readonly comparisons: ProposalComparisonAdapter;
  readonly revisions: RevisionStore;
  readonly writes: ProjectWriteActor;
  readonly operations: ProjectOperationQueue;
  readonly imports: AssetImportService;
  readonly engines: EngineRegistry;
  readonly coordinator: ProjectCoordinator;
  readonly migrations: MigrationService;
  /**
   * What the pinned OpenFilm composition decided, recorded so a failed capability is
   * diagnosable without re-running verification by hand.
   */
  openFilmComposition: OpenFilmComposition | null = null;
  /**
   * Why composition could not even be attempted, when the failure was something other than
   * "the checkout did not verify". Null means the path was not reached or did not fail.
   */
  openFilmCompositionFailure: string | null = null;
  /** Where migrated copies are built. Composition-time only, never a request field. */
  readonly migrationRoot: string;
  /**
   * W2.0 activation layer (blocker 4).
   *
   * These three exist so a later Wave 2 route has exactly one project authority to bind
   * to. They are composed here, over the *same* `RevisionStore`, `ProjectCatalog` and
   * `migrationRoot` the rest of the Host uses — a second catalog, a second connection or
   * an in-memory map would be a second authority, which is what C-05 rules out.
   */
  readonly projectResolver: ProjectResolver;
  readonly assetLedger: MigratedAssetLedger;
  readonly assetInventory: AssetInventoryPort;
  readonly sessionToken = randomBytes(32).toString("base64url");
  /** Loopback origin once `listen` has bound, used to bind preview descriptors. */
  origin = "";
  readonly sessionExpiresAt: Date;
  readonly diagnostics = { write_actor_execute_count: 0 };
  /**
   * Bounded, Host-side record of failures a client was not allowed to see.
   *
   * See `INFRA-RISK-W2-001`: `normalizeError` correctly hides internal detail from a
   * response, which made an intermittent Host 500 impossible to attribute after the fact.
   * This carries the correlation id, the stage, the error class and a digest of the
   * message — never the message, a path or a stack.
   */
  readonly failures = new HostDiagnostics();
  readonly #controllers = new Map<string, AbortController>();
  readonly #leaseReapIntervalMs: number;
  readonly #outboxReplayIntervalMs: number;
  #stopOutbox: (() => void) | undefined;
  #leaseReaper: ReturnType<typeof setInterval> | undefined;
  #server: Server | undefined;

  constructor(dependencies: HostDependencies = {}) {
    this.catalog = dependencies.catalog ?? new ProjectCatalog();
    this.runner = dependencies.runner ?? new ControlledAgentRunner({ cwd: projectRoot });
    this.proposals = dependencies.proposals ?? new ProposalAdapter(resolve(projectRoot, "var/proposals"));
    this.comparisons = dependencies.comparisons ?? new ProposalComparisonAdapter(resolve(projectRoot, "var/proposal-comparisons"));
    this.revisions = dependencies.revisionStore ?? new RevisionStore(dependencies.dbPath ?? ":memory:");
    this.operations = dependencies.operationQueue ?? dependencies.writes?.operations ?? new InMemoryProjectOperationQueue();
    if (dependencies.writes !== undefined && dependencies.operationQueue !== undefined
      && dependencies.writes.operations !== dependencies.operationQueue) throw new Error("HOST_OPERATION_QUEUE_MISMATCH");
    this.writes = dependencies.writes ?? new ProjectWriteActor(this.catalog, this.revisions, undefined, this.operations);
    if (dependencies.imports !== undefined && (dependencies.imports.catalog !== this.catalog
      || dependencies.imports.revisions !== this.revisions || dependencies.imports.operations !== this.operations
      || dependencies.imports.registry !== this.writes.assets)) throw new Error("HOST_IMPORT_DEPENDENCY_MISMATCH");
    this.jobs = dependencies.jobs ?? new PersistentJobStore(this.revisions);
    this.outbox = new Outbox(this.revisions);
    this.imports = dependencies.imports ?? new AssetImportService(this.catalog, this.writes.assets, this.revisions, this.operations);
    this.engines = dependencies.engines ?? defaultEngineRegistry(this);
    for (const [topic, consumer] of [
      ["project.committed", "commit-audit"], ["job.state_changed", "job-sse"],
      ["lock.changed", "lock-audit"], ["recovery.attention", "recovery-audit"],
    ] as const) this.outbox.register(topic, consumer, (_eventId, _payload) => undefined);
    const locks = new LockService(this.revisions);
    this.coordinator = new ProjectCoordinator({
      queue: this.operations, store: this.revisions, actor: this.writes,
      bindings: this.engines.bindings, engines: this.engines,
      gateway: new NativeWriteGateway(new NativeMutationRegistry()), locks,
      snapshots: new SnapshotStore({ snapshotsRoot: dependencies.snapshotsRoot ?? resolve(projectRoot, "var/snapshots") }),
      outbox: this.outbox,
      jobs: this.jobs instanceof PersistentJobStore ? this.jobs : new PersistentJobStore(this.revisions),
      sourceFor: async (projectId) => {
        const resolved = this.engines.resolve(projectId);
        const descriptor = await this.catalog.readDescriptor(projectId);
        return { engine: resolved.engine, engineUpstreamSha: resolved.binding.engine_upstream_sha,
          descriptor, sourceRoot: this.catalog.descriptorRoot(projectId) };
      },
      digestFor: async (source: ResolvedSource) => {
        const resolved = this.engines.resolve(source.descriptor.project_id);
        if (!(resolved.port instanceof HypitEngineAdapter)) {
          throw new HttpError(422, "UNSUPPORTED_EDIT", "Writable snapshot closure is not enabled for this engine");
        }
        return await resolved.port.sourceDigestFor(source.descriptor.project_id, source.descriptor);
      },
    });
    this.migrationRoot = dependencies.migrationsRoot ?? resolve(projectRoot, "var/migrations");
    this.projectResolver = new ProjectResolver({
      catalog: this.catalog, revisions: this.revisions, migrationRoot: this.migrationRoot,
    });
    this.assetLedger = MigratedAssetLedger.create({
      revisions: this.revisions,
      registry: this.imports.registry,
      catalog: this.catalog,
      migrationRoot: this.migrationRoot,
    });
    this.assetInventory = new AssetInventoryPort({
      resolver: this.projectResolver, registry: this.imports.registry, ledger: this.assetLedger,
    });
    this.migrations = new MigrationService({
      catalog: this.catalog, revisions: this.revisions, bindings: this.engines.bindings,
      // The same ledger instance the Host exposes, so a migration seeds the ledger the
      // asset inventory will later re-verify. Two instances over one connection would be
      // two authorities reading one table.
      ledger: this.assetLedger,
      snapshots: new SnapshotStore({ snapshotsRoot: dependencies.snapshotsRoot ?? resolve(projectRoot, "var/snapshots") }),
      migrationRoot: this.migrationRoot,
      projectRoot: resolve(projectRoot, "var/projects"),
      openfilmUpstreamSha: OPENFILM_UPSTREAM_SHA,
      // Resolution of a migrated copy is `ProjectResolver`'s job, and it derives the root
      // from the migration record rather than being told one. This callback therefore
      // records nothing: W2.0 replaced the old `migratedRoots` map, which was written on
      // every migration and read by nothing, while its own comment claimed it was what kept
      // migrated projects resolvable across a restart. A write-only map whose comment
      // contradicts it is a trap for the next person.
      registerProject: () => undefined,
      verifyStagedProject: async (root) => {
        const upstream = await createPinnedOpenFilmUpstream(openfilmVendorRoot());
        const film = await upstream.readProjectFilm(root);
        if (film.problems.length > 0) {
          throw new HttpError(422, "UNSUPPORTED_EDIT", "MIGRATION_VALIDATION_FAILED: the engine cannot read the staged film");
        }
        const tracks = (film.doc as { tracks?: Array<{ clips?: Array<{ id?: unknown; src?: unknown }> }> }).tracks ?? [];
        const clips = tracks.flatMap((track) => track.clips ?? []);
        // A flattened video clip is not a native editable clip and must not pass. Checked
        // across every track, because that is where such a clip would hide.
        for (const clip of clips) {
          const source = typeof clip.src === "string" ? clip.src : "";
          if (/\.(mp4|mov|webm|mkv)$/iu.test(source)) {
            throw new HttpError(422, "UNSUPPORTED_EDIT", "MIGRATION_VALIDATION_FAILED: flattened video clip");
          }
        }
        // `target_clips` means *visual* shots, one per source shot. The migrated film also
        // carries a narration audio clip, and counting it made the real route abort at
        // validation with "engine reported clips shot-001,shot-002,shot-003,narration". The
        // Wave 1 suite missed this because its harness supplied its own verifier that
        // filtered to the picture track; the production verifier did not.
        //
        // Identity comes from `src`: a picture clip references a page, so it is identified as
        // the clip whose source is not an audio media file. Ordering is the engine's.
        const pictureClips = clips.filter((clip) => {
          const source = typeof clip.src === "string" ? clip.src : "";
          return !/\.(wav|mp3|m4a|aac|flac|ogg)$/iu.test(source);
        });
        const ids = pictureClips.flatMap((clip) => typeof clip.id === "string" ? [clip.id] : []);
        if (ids.length === 0) {
          throw new HttpError(422, "UNSUPPORTED_EDIT", "MIGRATION_VALIDATION_FAILED: no picture clips");
        }
        return ids.map((id, index) => ({
          source_id: id, target_id: id, start_frame: index * 300, end_frame_exclusive: (index + 1) * 300,
        }));
      },
    });
    this.#leaseReapIntervalMs = dependencies.leaseReapIntervalMs ?? 1_000;
    this.#outboxReplayIntervalMs = dependencies.outboxReplayIntervalMs ?? 250;
    this.sessionExpiresAt = new Date(Date.now() + (dependencies.sessionTtlMs ?? 3_600_000));
  }

  async listen(port = 4173): Promise<number> {
    if (this.#server) throw new Error("HOST_ALREADY_LISTENING");
    await this.imports.recoverIncomplete();
    await this.writes.recoverIncomplete();
    await this.comparisons.cleanupStaleTemporaryFiles();
    await this.coordinator.recoverOnStart();
    // A migration interrupted by a crash is decided here, in production, not only in tests:
    // it either completes, stays retryable, or lands in attention. Nothing is guessed.
    // Composed *before* recovery, and the failure is contained.
    //
    // The upstream checkout is the one thing in startup that can fail for reasons outside
    // this process — a missing vendor directory, a drifted commit, a hung `git status`. If
    // it were verified after recovery had already advanced migrations, a throw would leave
    // durable state changed with no listening server and no retry path, and the next start
    // would run recovery against rows it has already moved.
    //
    // Composing first means the worst case is a Host that starts without the OpenFilm
    // capability — which is exactly what `CAPABILITY_NOT_ENABLED` and `ENGINE_UNAVAILABLE`
    // already describe — rather than a Host wedged half-recovered.
    try {
      this.openFilmComposition = await composeOpenFilmPort({
        registry: this.engines, vendorRoot: openfilmVendorRoot(),
      });
    } catch (error) {
      this.openFilmComposition = null;
      this.openFilmCompositionFailure = error instanceof Error ? error.message : String(error);
    }
    await this.migrations.recover();
    // A migrated copy survives a restart because `ProjectResolver` re-derives it from the
    // migration record on every call. There is nothing to re-seed, and a cache here would be
    // a second authority that could disagree with the record it claims to mirror.
    this.#stopOutbox = this.outbox.start(this.#outboxReplayIntervalMs);
    if (this.jobs instanceof PersistentJobStore) {
      this.#leaseReaper = setInterval(() => this.jobs instanceof PersistentJobStore
        && this.jobs.reapExpiredLeases(), this.#leaseReapIntervalMs);
      this.#leaseReaper.unref?.();
    }
    this.#server = createServer((request, response) => { void this.#handle(request, response); });
    await new Promise<void>((resolvePromise, reject) => {
      this.#server!.once("error", reject);
      this.#server!.listen(port, "127.0.0.1", () => resolvePromise());
    });
    const address = this.#server.address();
    if (!address || typeof address === "string") throw new Error("HOST_ADDRESS_UNAVAILABLE");
    this.origin = `http://127.0.0.1:${address.port}`;
    return address.port;
  }

  async close(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    // Stop in-flight jobs before the store goes away, so a durable job never touches a
    // closed database while it is still running.
    for (const controller of this.#controllers.values()) controller.abort();
    this.#controllers.clear();
    this.#stopOutbox?.();
    this.#stopOutbox = undefined;
    if (this.#leaseReaper !== undefined) clearInterval(this.#leaseReaper);
    this.#leaseReaper = undefined;
    if (!server) { this.revisions.close(); return; }
    await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    this.revisions.close();
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const host = request.headers.host;
      if (request.method === "GET" && request.url && !request.url.startsWith("/api/")) {
        return await serveStatic(request.url, response);
      }
      const origin = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin;
      const referer = Array.isArray(request.headers.referer) ? request.headers.referer[0] : request.headers.referer;
      const secFetchSite = Array.isArray(request.headers["sec-fetch-site"]) ? request.headers["sec-fetch-site"][0] : request.headers["sec-fetch-site"];
      if (!isAllowedBrowserRequest({ ...(origin ? { origin } : {}), ...(host ? { host } : {}), ...(referer ? { referer } : {}), ...(secFetchSite ? { secFetchSite } : {}) })) {
        throw new HttpError(403, "ORIGIN_REJECTED", "Only same-origin loopback requests are allowed");
      }
      const url = new URL(request.url ?? "/", `http://${host}`);
      if (request.method === "GET" && url.pathname === "/api/session") {
        return json(response, 200, { token: this.sessionToken, expires_at: this.sessionExpiresAt.toISOString() });
      }
      this.#authenticate(request);
      let match = url.pathname.match(/^\/api\/migration\/v1\/projects\/([A-Za-z0-9_-]+)\/engine$/);
      if (request.method === "GET" && match?.[1]) return json(response, 200, await this.#engine(match[1]));
      match = url.pathname.match(/^\/api\/migration\/v1\/projects\/([A-Za-z0-9_-]+)\/migrate-copy$/);
      if (request.method === "POST" && match?.[1]) return await this.#migrateCopy(match[1], request, response);
      match = url.pathname.match(/^\/api\/migration\/v1\/migrations\/([A-Za-z0-9_-]+)$/);
      if (request.method === "GET" && match?.[1]) return json(response, 200, this.#migrationReport(match[1]));
      match = url.pathname.match(/^\/api\/migration\/v1\/migrations\/([A-Za-z0-9_-]+)\/rollback$/);
      if (request.method === "POST" && match?.[1]) return json(response, 200, await this.#rollbackMigration(match[1]));
      match = url.pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]+)$/);
      if (request.method === "GET" && match?.[1]) return json(response, 200, await this.#project(match[1]));
      match = url.pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]+)\/assets$/);
      if (request.method === "GET" && match?.[1]) return json(response, 200, await this.writes.assets.inventory(match[1]));
      match = url.pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]+)\/assets\/import$/);
      if (request.method === "POST" && match?.[1]) return await this.#importAsset(match[1], request, response);
      match = url.pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]+)\/proposals$/);
      if (request.method === "POST" && match?.[1]) return await this.#createProposal(match[1], request, response);
      match = url.pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]+)\/edits$/);
      if (request.method === "POST" && match?.[1]) return await this.#createEdit(match[1], request, response);
      match = url.pathname.match(/^\/api\/jobs\/(job_[A-Za-z0-9_-]+)$/);
      if (request.method === "GET" && match?.[1]) {
        const job = this.jobs.get(match[1]);
        if (!job) throw new HttpError(404, "NOT_FOUND", "Job not found");
        return json(response, 200, job);
      }
      match = url.pathname.match(/^\/api\/jobs\/(job_[A-Za-z0-9_-]+)\/events$/);
      if (request.method === "GET" && match?.[1]) return this.#events(match[1], url, request, response);
      match = url.pathname.match(/^\/api\/jobs\/(job_[A-Za-z0-9_-]+)\/cancel$/);
      if (request.method === "POST" && match?.[1]) return this.#cancel(match[1], response);
      match = url.pathname.match(/^\/api\/proposals\/([A-Za-z0-9_-]+)$/);
      if (request.method === "GET" && match?.[1]) return json(response, 200, await this.proposals.read(match[1]));
      match = url.pathname.match(/^\/api\/proposal-comparisons\/([^/]+)$/);
      if (request.method === "GET" && match?.[1]) {
        const comparison = await this.comparisons.read(match[1]);
        const current = await this.writes.projectState(comparison.project_id);
        if (current.revision !== comparison.base_revision) throw new HttpError(409, "REVISION_CONFLICT", "Project revision has changed");
        return json(response, 200, comparison);
      }
      throw new HttpError(404, "NOT_FOUND", "Route not found");
    } catch (error) {
      const normalized = normalizeError(error);
      const correlationId = normalized.correlationId ?? "unknown";
      // Only unexpected failures are worth a diagnostic. An `HttpError` is an answer the
      // Host meant to give, and recording those would bury the ones that are not.
      if (normalized.status >= 500) {
        this.failures.record({ correlationId, stage: "route", error });
      }
      json(response, normalized.status, normalized.body());
    }
  }

  #authenticate(request: IncomingMessage): void {
    if (Date.now() >= this.sessionExpiresAt.getTime()) throw new HttpError(401, "INVALID_SESSION", "Session expired");
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!tokenMatches(token, this.sessionToken)) throw new HttpError(401, "INVALID_SESSION", "Session token is invalid");
  }

  async #createProposal(projectId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const project = await this.#project(projectId);
    const body = await readJson(request);
    const result = validateProposalComparisonRequest(body);
    if (!result.ok) throw new HttpError(400, "INVALID_REQUEST", "Proposal request is invalid", { errors: result.errors });
    if (result.value.base_revision !== project.revision) throw new HttpError(409, "REVISION_CONFLICT", "Project revision has changed");
    if (!project.shots.some((shot) => shot.shot_id === result.value.selection.shot_id && shot.start_frame === result.value.selection.start_frame && shot.end_frame_exclusive === result.value.selection.end_frame_exclusive)) {
      throw new HttpError(400, "INVALID_REQUEST", "Selection is not a registered project shot");
    }
    const job = this.jobs instanceof PersistentJobStore
      ? this.jobs.create({ projectId, kind: "proposal_comparison", payload: result.value })
      : this.jobs.create(projectId);
    const controller = new AbortController();
    this.#controllers.set(job.job_id, controller);
    let lease: { owner: string; attempt: number } | undefined;
    if (this.jobs instanceof PersistentJobStore) {
      const owner = `host_${randomBytes(12).toString("hex")}`;
      if (!this.jobs.acquireLease(job.job_id, { owner })) {
        throw new HttpError(500, "TRANSACTION_FAILED", "Created job could not acquire its worker lease");
      }
      lease = { owner, attempt: this.jobs.record(job.job_id)!.attempt };
    }
    queueMicrotask(() => { void this.#runJob(job.job_id, project, result.value, controller, lease); });
    json(response, 202, job);
  }

  async #createEdit(projectId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJson(request);
    const result = validateEditRequest(body);
    if (!result.ok) throw new HttpError(422, "UNSUPPORTED_EDIT", "Edit request is invalid", { errors: result.errors });
    this.diagnostics.write_actor_execute_count += 1;
    json(response, 200, await this.coordinator.executeEdit(projectId, result.value));
  }

  async #importAsset(projectId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const controller = new AbortController();
    const onClose = (): void => { if (!response.writableEnded) controller.abort(); };
    response.once("close", onClose);
    try {
      const result = await this.imports.importRequest(projectId, request, controller.signal);
      json(response, result.status, result.response);
    } finally { response.off("close", onClose); }
  }


  /**
   * Read-only engine surface opened by M2.1 (`05_API_INTERFACE_SPEC.md` §5).
   * It returns the project's single binding, its capability map and a read-only projection.
   * It never migrates, never writes, and never opens materialize, adopt or impact.
   */
  async #engine(projectId: string): Promise<EngineResponse> {
    const descriptor = await this.catalog.readDescriptor(projectId);
    const resolved = this.engines.resolve(projectId);
    const binding = resolved.binding;
    const expectedSha = upstreamShaFor(resolved.engine);
    if (binding.engine_upstream_sha !== expectedSha) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "Engine binding does not match its pinned upstream");
    }
    const state = await this.writes.projectState(projectId);
    const ctx = { correlationId: randomBytes(8).toString("hex"), projectId, signal: AbortSignal.timeout(10_000) };

    // The comparison baseline is the digest the Host committed, not the digest this request
    // happens to observe. Recomputing the current value and passing it as its own baseline
    // would make an external change undetectable, which is the closure the external review
    // rejected as B-01. Detection and the attention it raises run inside the existing
    // per-project serial boundary, so they cannot interleave with a project write.
    const { projection, capabilities } = await this.operations.run(projectId, async () => {
      const committed = this.revisions.sourceBaseline(projectId).committed;
      const snapshot = { project_id: projectId, engine: resolved.engine, source_digest: committed };
      let read: Awaited<ReturnType<typeof resolved.port.inspect>>;
      try {
        read = await resolved.port.inspect(snapshot, ctx);
      } catch (error) {
        throw this.#externalChange(projectId, descriptor, error);
      }
      const baseline = this.revisions.ensureSourceBaseline(projectId, descriptor.revision, read.source_digest);
      if (baseline !== read.source_digest) {
        // The source moved between reading the baseline and reading the projection.
        throw this.#externalChange(projectId, descriptor,
          new HttpError(409, "SOURCE_CHANGED", "Project source changed while it was being read"));
      }
      return { projection: read, capabilities: await resolved.port.capabilities(snapshot, ctx) };
    });
    // A projection never carries a server filesystem path; the Host binds the preview to
    // its own loopback origin so the client only ever sees a Host address it can call.
    const preview = { ...projection.preview, url: `${this.origin}/api/migration/v1/projects/${projectId}/preview` };
    const response: EngineResponse = {
      format: "narralens.engine-response@1.0",
      project_id: projectId,
      binding,
      capabilities,
      projection: { ...projection, preview, project_revision: state.revision },
    };
    const validated = validateEngineResponse(response);
    if (!validated.ok) throw new HttpError(500, "INTERNAL_ERROR", "Engine response does not satisfy its contract");
    return validated.value;
  }

  /**
   * Turn an adapter's refusal into a durable, visible condition. Attention is raised on the
   * project's own serial boundary; the external bytes are never rewritten and the baseline
   * is never re-sampled, so the condition stays visible until an explicit recovery.
   */
  #externalChange(projectId: string, descriptor: ProjectDescriptor, error: unknown): unknown {
    if (!(error instanceof HttpError) || error.code !== "SOURCE_CHANGED") return error;
    this.revisions.recordExternalSourceChange(projectId, "", descriptor.revision);
    return error;
  }

  /**
   * M2.3 `migrate-copy`: create the migration, run it, and answer with its report.
   * No server path ever crosses this boundary; the only input is an idempotency key.
   */
  async #migrateCopy(projectId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJson(request) as { idempotency_key?: unknown };
    const idempotencyKey = typeof body?.idempotency_key === "string" ? body.idempotency_key : "";
    if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw new HttpError(400, "INVALID_REQUEST", "idempotency_key must be 8 to 128 characters");
    }
    const plan = await this.migrations.plan({ projectId, idempotencyKey });
    let report;
    try { report = await this.migrations.execute(plan.migration_id); }
    catch (error) {
      // A blocked or crashed migration still has a report worth reading.
      const failed = this.#migrationReport(plan.migration_id);
      if (failed.state === "aborted" || failed.state === "attention" || failed.state === "recovering") {
        json(response, 409, failed);
        return;
      }
      throw error;
    }
    json(response, report.complete ? 200 : 409, report);
  }

  #migrationReport(migrationId: string): MigrationReportV1 {
    if (this.revisions.migrations.get(migrationId) === undefined) {
      throw new HttpError(404, "NOT_FOUND", "Migration not found");
    }
    return this.migrations.report(migrationId);
  }

  async #rollbackMigration(migrationId: string): Promise<RollbackRecord> {
    const existing = this.revisions.migrations.rollback(migrationId);
    // Rollback is idempotent: asking twice returns the same record, never a second action.
    if (existing !== undefined && existing.phase === "verified") return existing;
    return await this.migrations.rollback(migrationId);
  }

  async #project(projectId: string): Promise<ProjectResponse> {
    const project = await this.catalog.read(projectId);
    const state = await this.writes.projectState(projectId);
    let visualFits: ProjectResponse["visual_fits"];
    let visualAssets: ProjectResponse["visual_assets"];
    let availableAssets: ProjectResponse["available_visual_assets"];
    try { visualFits = await this.writes.adapter.visualFits(projectId); } catch { visualFits = undefined; }
    try { visualAssets = await this.writes.adapter.visualAssets(projectId); } catch { visualAssets = undefined; }
    try { availableAssets = await this.writes.assets.list(projectId); } catch { availableAssets = undefined; }
    return { ...project, revision: state.revision, locks: { visual: state.visual_locked },
      ...(visualFits ? { visual_fits: visualFits } : {}), ...(visualAssets ? { visual_assets: visualAssets } : {}),
      ...(availableAssets ? { available_visual_assets: availableAssets } : {}) };
  }

  async #runJob(jobId: string, project: ProjectResponse, request: ProposalComparisonRequest,
    controller: AbortController, lease?: { owner: string; attempt: number }): Promise<void> {
    try {
      if (!(this.jobs instanceof PersistentJobStore)) {
        this.jobs.transition(jobId, "running", { message: "Provider request started" });
      }
      const input: ComparisonRunnerInput = { project: { project_id: project.project_id, revision: project.revision, frame_rate: project.frame_rate, frame_count: project.frame_count }, request,
        fixed_context: { product: "Narralens", output_contract: "narralens.proposal_comparison_draft@1.0", upstream: "OpenMontage", pipeline: "proposal-comparison-only", allowed_source_refs: [] } };
      const output = await this.runner.runComparison(input, controller.signal);
      const comparison = this.comparisons.build(output.value, project.project_id, request, output.audit);
      const currentRevision = (await this.writes.projectState(project.project_id)).revision;
      if (currentRevision !== request.base_revision) throw new HttpError(409, "REVISION_CONFLICT", "Project revision has changed");
      await this.comparisons.save(comparison);
      const current = this.jobs.get(jobId);
      if (current?.state === "cancel_requested") {
        // The work finished after cancellation. M2.2 never writes
        // `completed_after_cancel` again: the job is cancelled and the result is quarantined
        // so nothing downstream can treat it as adoptable.
        if (this.jobs instanceof PersistentJobStore) {
          this.jobs.recordCallback(jobId, lease!, { state: "cancelled",
            providerReceipt: { comparison_id: comparison.comparison_id },
            artifact: { comparison_id: comparison.comparison_id },
            message: "Comparison finished after cancellation" });
        } else {
          this.jobs.transition(jobId, "completed_after_cancel", {
            comparison_id: comparison.comparison_id,
            message: "Comparison finished after cancellation",
          });
        }
      } else {
        if (this.jobs instanceof PersistentJobStore) {
          this.jobs.recordCallback(jobId, lease!, { state: "succeeded", costStatus: "unknown",
            providerReceipt: { comparison_id: comparison.comparison_id },
            comparisonId: comparison.comparison_id,
            message: `Proposal comparison validated; runner stdout sha256 ${output.raw_sha256}` });
        } else {
          this.jobs.transition(jobId, "succeeded", {
            comparison_id: comparison.comparison_id,
            message: `Proposal comparison validated; runner stdout sha256 ${output.raw_sha256}`,
          });
        }
      }
    } catch (error) {
      const current = this.jobs.get(jobId);
      if (current?.state === "cancel_requested" && controller.signal.aborted && error instanceof HttpError && error.code === "RUNNER_TIMEOUT") {
        if (this.jobs instanceof PersistentJobStore) {
          this.jobs.recordCallback(jobId, lease!, { state: "cancelled",
            message: "Runner stopped after cancellation request" });
        } else this.jobs.transition(jobId, "cancelled", { message: "Runner stopped after cancellation request" });
      } else {
        const normalized = normalizeError(error);
        if (normalized.status >= 500) {
          this.failures.record({
            correlationId: normalized.correlationId ?? jobId, stage: "job.worker", error,
          });
        }
        if (this.jobs instanceof PersistentJobStore) {
          this.jobs.recordCallback(jobId, lease!, { state: "failed", error: normalized.body(),
            message: normalized.message });
        } else this.jobs.transition(jobId, "failed", { error: normalized.body(), message: normalized.message });
      }
    } finally { this.#controllers.delete(jobId); }
  }

  #events(jobId: string, url: URL, request: IncomingMessage, response: ServerResponse): void {
    const snapshot = this.jobs.get(jobId);
    if (!snapshot) throw new HttpError(404, "NOT_FOUND", "Job not found");
    const afterValue = url.searchParams.get("after") ?? "0";
    const after = Number.parseInt(afterValue, 10);
    if (!Number.isSafeInteger(after) || after < 0) throw new HttpError(400, "INVALID_REQUEST", "Invalid event cursor");
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "close" });
    const write = (event: JobEvent): void => { response.write(`id: ${event.event_id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); };
    for (const event of this.jobs.eventsAfter(jobId, after)) write(event);
    const terminal = new Set(["cancelled", "succeeded", "failed", "attention", "completed_after_cancel"]);
    if (terminal.has(snapshot.state)) { response.end(); return; }
    let unsubscribe = (): void => {};
    const close = (): void => { clearInterval(heartbeat); unsubscribe(); if (!response.writableEnded) response.end(); };
    unsubscribe = this.jobs.subscribe(jobId, (event) => { write(event); if (terminal.has(event.type)) close(); });
    const heartbeat = setInterval(() => { if (!response.writableEnded) response.write(": heartbeat\n\n"); }, 15_000);
    request.once("close", close);
  }

  #cancel(jobId: string, response: ServerResponse): void {
    const current = this.jobs.get(jobId);
    if (!current) throw new HttpError(404, "NOT_FOUND", "Job not found");
    const job = this.jobs.requestCancel(jobId);
    this.#controllers.get(jobId)?.abort();
    const state = job.state === "cancelled" || job.state === "attention" || job.state === "completed_after_cancel"
      ? job.state : "cancel_requested";
    json(response, 200, { job_id: jobId, state });
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > bodyLimit) throw new HttpError(413, "INVALID_REQUEST", "JSON body exceeds 64 KiB");
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "INVALID_REQUEST", "Request body is not valid JSON"); }
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  const root = resolve(projectRoot, "dist");
  const url = new URL(pathname, "http://127.0.0.1");
  const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const file = resolve(root, requested);
  if (file !== root && !file.startsWith(`${root}${sep}`)) throw new HttpError(404, "NOT_FOUND", "Asset not found");
  try {
    if (!(await stat(file)).isFile()) throw new Error("not file");
  } catch { throw new HttpError(404, "NOT_FOUND", "Asset not found; run the UI build first"); }
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
  response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": extname(file) === ".html" ? "no-store" : "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" });
  createReadStream(file).pipe(response);
}

function json(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(`${JSON.stringify(value)}\n`);
}

/**
 * Default Host composition: one Hypit engine port and the bindings it serves.
 * An OpenFilm port is only present once a pinned upstream checkout is supplied, so a
 * project can never resolve to two engines (AC-001).
 */
function defaultEngineRegistry(host: NarralensHost): EngineRegistry {
  const bindings = new EngineBindingStore(host.revisions);
  // Seeding is idempotent on purpose. The binding is a durable fact with a primary key, and
  // an unconditional `bind` makes a file-backed Host impossible to restart: the second start
  // hits ENGINE_BINDING_ALREADY_EXISTS. That never showed with the in-memory default, which
  // is precisely how a restart bug survives a green suite.
  //
  // Re-binding is still refused: if the row says something else, that is a contradiction to
  // investigate, not something to overwrite.
  const existing = bindings.read("d1-30s");
  if (existing === undefined) {
    bindings.bind("d1-30s", "hypit", { createdAt: "1970-01-01T00:00:00.000Z" });
  } else if (existing.engine !== "hypit") {
    throw new HttpError(500, "TRANSACTION_FAILED", "ENGINE_BINDING_CONTRADICTS_SEED");
  }
  const hypit = new HypitEngineAdapter({
    catalog: host.catalog,
    reader: new HypitReadAdapter(host.catalog),
    writer: host.writes.adapter,
  });
  return new EngineRegistry(bindings, { hypit });
}
