import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ControlledAgentRunner, type RunnerInput } from "../adapters/openmontage/controlled-agent-runner.js";
import { ProposalAdapter } from "../adapters/openmontage/proposal-adapter.js";
import { validateEditRequest, validateProposalRequest } from "../contracts/validator.js";
import type { ApiError, ProjectResponse, ProposalRequest } from "../contracts/types.js";
import { HttpError, normalizeError } from "./api-error.js";
import { JobStore } from "./job-store.js";
import { ProjectCatalog } from "./projects/project-catalog.js";
import { ProjectWriteActor } from "./projects/project-write-actor.js";
import { RevisionStore } from "./projects/revision-store.js";
import { isAllowedBrowserRequest, tokenMatches } from "./security.js";

const bodyLimit = 65_536;
const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

interface HostDependencies {
  catalog?: ProjectCatalog;
  jobs?: JobStore;
  runner?: ControlledAgentRunner;
  proposals?: ProposalAdapter;
  writes?: ProjectWriteActor;
  revisionStore?: RevisionStore;
  sessionTtlMs?: number;
}

export class NarralensHost {
  readonly catalog: ProjectCatalog;
  readonly jobs: JobStore;
  readonly runner: ControlledAgentRunner;
  readonly proposals: ProposalAdapter;
  readonly revisions: RevisionStore;
  readonly writes: ProjectWriteActor;
  readonly sessionToken = randomBytes(32).toString("base64url");
  readonly sessionExpiresAt: Date;
  readonly #controllers = new Map<string, AbortController>();
  #server: Server | undefined;

  constructor(dependencies: HostDependencies = {}) {
    this.catalog = dependencies.catalog ?? new ProjectCatalog();
    this.jobs = dependencies.jobs ?? new JobStore();
    this.runner = dependencies.runner ?? new ControlledAgentRunner({ cwd: projectRoot });
    this.proposals = dependencies.proposals ?? new ProposalAdapter(resolve(projectRoot, "var/proposals"));
    this.revisions = dependencies.revisionStore ?? new RevisionStore();
    this.writes = dependencies.writes ?? new ProjectWriteActor(this.catalog, this.revisions);
    this.sessionExpiresAt = new Date(Date.now() + (dependencies.sessionTtlMs ?? 3_600_000));
  }

  async listen(port = 4173): Promise<number> {
    if (this.#server) throw new Error("HOST_ALREADY_LISTENING");
    await this.writes.recoverIncomplete();
    this.#server = createServer((request, response) => { void this.#handle(request, response); });
    await new Promise<void>((resolvePromise, reject) => {
      this.#server!.once("error", reject);
      this.#server!.listen(port, "127.0.0.1", () => resolvePromise());
    });
    const address = this.#server.address();
    if (!address || typeof address === "string") throw new Error("HOST_ADDRESS_UNAVAILABLE");
    return address.port;
  }

  async close(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    if (!server) return;
    await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
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
      let match = url.pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]+)$/);
      if (request.method === "GET" && match?.[1]) return json(response, 200, await this.#project(match[1]));
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
      throw new HttpError(404, "NOT_FOUND", "Route not found");
    } catch (error) {
      const normalized = normalizeError(error);
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
    const result = validateProposalRequest(body);
    if (!result.ok) throw new HttpError(400, "INVALID_REQUEST", "Proposal request is invalid", { errors: result.errors });
    if (result.value.base_revision !== project.revision) throw new HttpError(409, "REVISION_CONFLICT", "Project revision has changed");
    if (!project.shots.some((shot) => shot.shot_id === result.value.selection.shot_id && shot.start_frame === result.value.selection.start_frame && shot.end_frame_exclusive === result.value.selection.end_frame_exclusive)) {
      throw new HttpError(400, "INVALID_REQUEST", "Selection is not a registered project shot");
    }
    const job = this.jobs.create(projectId);
    const controller = new AbortController();
    this.#controllers.set(job.job_id, controller);
    queueMicrotask(() => { void this.#runJob(job.job_id, project, result.value, controller); });
    json(response, 202, job);
  }

  async #createEdit(projectId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJson(request);
    const result = validateEditRequest(body);
    if (!result.ok) throw new HttpError(422, "UNSUPPORTED_EDIT", "Edit request is invalid", { errors: result.errors });
    json(response, 200, await this.writes.execute(projectId, result.value));
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

  async #runJob(jobId: string, project: Awaited<ReturnType<ProjectCatalog["read"]>>, request: ProposalRequest, controller: AbortController): Promise<void> {
    try {
      this.jobs.transition(jobId, "running", { message: "Provider request started" });
      const input: RunnerInput = { project: { project_id: project.project_id, revision: project.revision, frame_rate: project.frame_rate, frame_count: project.frame_count }, request,
        fixed_context: { product: "Narralens", output_contract: "narralens.proposal_bundle@1.0", upstream: "OpenMontage", pipeline: "proposal-only" } };
      const output = await this.runner.run(input, controller.signal);
      const proposal = this.proposals.validate(output.value, project.project_id, request);
      await this.proposals.save(proposal);
      const current = this.jobs.get(jobId);
      this.jobs.transition(jobId, current?.state === "cancel_requested" ? "completed_after_cancel" : "succeeded", {
        proposal_id: proposal.proposal_id,
        message: `Proposal validated; runner stdout sha256 ${output.raw_sha256}`,
      });
    } catch (error) {
      const current = this.jobs.get(jobId);
      if (current?.state === "cancel_requested" && controller.signal.aborted && error instanceof HttpError && error.code === "RUNNER_TIMEOUT") {
        this.jobs.transition(jobId, "cancelled", { message: "Runner stopped after cancellation request" });
      } else {
        const normalized = normalizeError(error);
        this.jobs.transition(jobId, "failed", { error: normalized.body(), message: normalized.message });
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
    const write = (event: ReturnType<JobStore["eventsAfter"]>[number]): void => { response.write(`id: ${event.event_id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); };
    for (const event of this.jobs.eventsAfter(jobId, after)) write(event);
    const terminal = new Set(["cancelled", "succeeded", "failed", "completed_after_cancel"]);
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
    const state = job.state === "cancelled" || job.state === "completed_after_cancel" ? job.state : "cancel_requested";
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
