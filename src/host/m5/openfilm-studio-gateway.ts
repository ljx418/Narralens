import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { openFilmCapabilityMap } from "../engine/engine-capabilities.js";
import { NATIVE_MUTATION_REGISTRY } from "../engine/native-mutation-registry.js";
import type { StartedStudio } from "./openfilm-studio-supervisor.js";
import { OPCODE, decodeFrames, encodeFrame, relayFrames, writeHandshake } from "./websocket-relay.js";

/**
 * `OpenFilmStudioGateway` (Wave 3 `04` §1).
 *
 * The Gateway is the only origin the browser sees. It:
 *
 * - binds `127.0.0.1` on a random port and never another host name;
 * - checks the `Host` header, so a name pointed at this machine (DNS rebinding) gets
 *   nothing;
 * - issues a random HttpOnly SameSite cookie, and requires it for the API;
 * - sends `Referrer-Policy: no-referrer` and a `default-src 'self'` CSP on every answer;
 * - serves no CORS headers, so a page on another origin cannot read a response;
 * - proxies the Studio's *read* endpoints through an explicit allowlist, and refuses
 *   every write that the OpenFilm capability map does not report as supported;
 * - never lets the Studio's launch key, its origin or the project's absolute path reach
 *   the browser: the key is added server-side, the paths are stripped, and the film's
 *   own origin is rewritten to the Gateway's.
 *
 * The browser holds no Narralens Host bearer. The Gateway calls the Host's services
 * server-side, through the restricted interface below.
 */
/**
 * The operations the panel may ask the Host for.
 *
 * The Gateway names an *operation*, never a URL and never a path: the set is closed, it
 * is the M5 surface and nothing else, and the Host implements each one by calling its
 * own service. A request for anything not in this union cannot be expressed.
 */
export type StudioOperation =
  | "workbench"
  | "comparison.replay"
  | "lock.create"
  | "lock.release"
  | "inventory"
  | "materialize"
  | "materialization.read"
  | "impact"
  | "history.read"
  | "history.undo"
  | "history.redo"
  | "history.restore";

export interface StudioHostService {
  /**
   * One operation, one project, one body.
   *
   * The Host answers with the status and the body it would have answered over its own
   * HTTP surface — so the panel sees the same codes, the same messages and the same
   * contract-checked shapes — but the request never carries a Host bearer, because it
   * never leaves the Host's process.
   */
  call(input: {
    operation: StudioOperation; project_id: string; body?: unknown; correlation_id: string;
  }): Promise<{ status: number; body: unknown }>;
  /**
   * A native write, addressed by its registry entry id.
   *
   * The Gateway refuses anything the OpenFilm capability map does not report as
   * supported, and the service re-checks the policy itself: the Gateway's allowlist is a
   * convenience, not the authority.
   */
  nativeWrite(input: {
    entry_id: string; project_id: string; body: unknown; correlation_id: string;
  }): Promise<{ status: number; body: unknown }>;
}

export interface OpenFilmStudioGatewayDeps {
  readonly studio: StartedStudio;
  readonly services: StudioHostService;
  /** The panel bridge the page loads. Served as a classic script, before the Studio's modules. */
  readonly bridgeScript?: string | undefined;
  /** The built M5 panel, when the build has produced one. */
  readonly panelAssets?: { readonly script: string; readonly styles: string } | undefined;
}

interface AllowedRead {
  readonly method: "GET" | "HEAD";
  readonly pattern: RegExp;
  readonly what: string;
}

/**
 * The read allowlist.
 *
 * Only the endpoints M5's own experience needs are registered, one by one. A path that
 * is not here is not proxied — in particular nothing that lists or opens an arbitrary
 * folder, and nothing that exports, imports, deletes or transcribes.
 */
const ALLOWED_READS: readonly AllowedRead[] = [
  { method: "GET", pattern: /^\/api\/version$/u, what: "the Studio's version" },
  { method: "GET", pattern: /^\/api\/projects$/u, what: "the project list" },
  { method: "GET", pattern: /^\/api\/projects\/[A-Za-z0-9_-]+$/u, what: "one project and its film" },
  { method: "GET", pattern: /^\/api\/projects\/[A-Za-z0-9_-]+\/files$/u, what: "the project's file list" },
  { method: "GET", pattern: /^\/api\/projects\/[A-Za-z0-9_-]+\/fonts$/u, what: "the project's fonts" },
  { method: "GET", pattern: /^\/api\/projects\/[A-Za-z0-9_-]+\/media$/u, what: "derived media facts" },
  { method: "GET", pattern: /^\/api\/projects\/[A-Za-z0-9_-]+\/poster$/u, what: "the project's poster" },
  { method: "GET", pattern: /^\/api\/projects\/[A-Za-z0-9_-]+\/history$/u, what: "the project's version history" },
  { method: "GET", pattern: /^\/api\/projects\/[A-Za-z0-9_-]+\/history\/files$/u, what: "the project's history files" },
];

/** The endpoints the browser may open as a WebSocket. */
const ALLOWED_SOCKETS: readonly RegExp[] = [
  /^\/api\/events$/u,
  /^\/api\/projects\/[A-Za-z0-9_-]+\/events$/u,
];

/** The native writes M5 opens: exactly the OpenFilm capability map's supported entries. */
export function openNativeWriteEntries(): readonly string[] {
  return Object.entries(openFilmCapabilityMap().entries)
    .filter(([, entry]) => entry.state === "supported")
    .map(([entryId]) => entryId)
    .sort();
}

const SESSION_COOKIE = "narralens_studio_session";

export class OpenFilmStudioGateway {
  readonly #deps: OpenFilmStudioGatewayDeps;
  readonly #sessions = new Set<string>();
  #server: Server | undefined;
  #origin = "";
  #filmOrigin = "";
  readonly #sockets = new Set<Duplex>();

  constructor(deps: OpenFilmStudioGatewayDeps) {
    this.#deps = deps;
  }

  get origin(): string { return this.#origin; }

  async start(): Promise<string> {
    if (this.#server !== undefined) return this.#origin;
    this.#filmOrigin = this.#filmOriginOf(this.#deps.studio.origin);
    const server = createServer((request, response) => { void this.#handle(request, response); });
    server.on("upgrade", (request, socket, head) => { this.#upgrade(request, socket, head); });
    await new Promise<void>((done, fail) => {
      server.once("error", fail);
      // The port is 0: the operating system picks a free one, and the address is read
      // back from the socket. The host is fixed to 127.0.0.1 — never `localhost`, never
      // an IPv6 name, so the origin the browser sees is one name.
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", fail);
        done();
      });
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("THE_GATEWAY_HAS_NO_ADDRESS");
    }
    this.#origin = `http://127.0.0.1:${address.port}`;
    this.#server = server;
    return this.#origin;
  }

  async close(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
    const server = this.#server;
    this.#server = undefined;
    if (server === undefined) return;
    await new Promise<void>((done) => { server.close(() => done()); });
  }

  /** The film's own origin: the Studio serves the project's media from the next port. */
  #filmOriginOf(studioOrigin: string): string {
    const port = Number(new URL(studioOrigin).port);
    return `http://127.0.0.1:${port + 1}`;
  }

  // ── request handling ────────────────────────────────────────────────────────────────

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", this.#origin);
    const path = url.pathname;

    // The Host header check comes first: a name pointed at this machine (DNS rebinding)
    // gets nothing at all, not even a 404 that describes the Gateway.
    if (!this.#hostHeaderAllowed(request)) {
      response.writeHead(421, { "content-type": "text/plain" });
      response.end("misdirected request\n");
      return;
    }
    this.#securityHeaders(response);

    if (path === "/narralens/studio-host.js") {
      const script = this.#deps.bridgeScript ?? "";
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(script);
      return;
    }

    if (path === "/narralens/panel.js") {
      const assets = this.#deps.panelAssets;
      if (assets === undefined) {
        this.#refuse(response, 404, "the M5 panel has not been built");
        return;
      }
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(assets.script);
      return;
    }

    if (path === "/narralens/panel.css") {
      const assets = this.#deps.panelAssets;
      if (assets === undefined) {
        this.#refuse(response, 404, "the M5 panel has not been built");
        return;
      }
      response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
      response.end(assets.styles);
      return;
    }

    // The native writes are addressed by their registry entry id, never as a raw upstream
    // operation. They are the Gateway's own surface, so they are routed before the
    // catch-all below.
    if (path.startsWith("/narralens/native/")) {
      await this.#nativeWrite(request, response, path);
      return;
    }

    // The Narralens service surface: the operations the panel may ask the Host for.
    if (path.startsWith("/narralens/api/")) {
      await this.#narralensOperation(request, response, path, url);
      return;
    }

    // The bridge and the panel are the only things the Gateway serves itself.
    if (path.startsWith("/narralens/")) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "no such narralens resource" }));
      return;
    }

    if (path.startsWith("/film/")) {
      await this.#proxyFilm(path.slice("/film".length), request, response);
      return;
    }

    if (path.startsWith("/api/")) {
      await this.#proxyApi(request, response, path, url);
      return;
    }

    // The Studio's own pages, with the bridge injected into the same document.
    await this.#proxyEditor(request, response, path, url);
  }

  #hostHeaderAllowed(request: IncomingMessage): boolean {
    const host = request.headers.host;
    if (typeof host !== "string" || host === "") return false;
    const expected = new URL(this.#origin).host;
    if (host === expected) return true;
    // `127.0.0.1` without the port is not this Gateway: a rebound name usually arrives
    // with a port of its own, and the port is part of the origin.
    return false;
  }

  #securityHeaders(response: ServerResponse): void {
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
      + "img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; "
      + "frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Cache-Control", "no-store");
  }

  #sessionValid(request: IncomingMessage): boolean {
    const cookie = request.headers.cookie;
    if (typeof cookie !== "string") return false;
    for (const part of cookie.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === SESSION_COOKIE && this.#sessions.has(rest.join("="))) return true;
    }
    return false;
  }

  #issueSession(response: ServerResponse): void {
    const value = randomBytes(24).toString("base64url");
    this.#sessions.add(value);
    response.setHeader("Set-Cookie",
      `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict`);
  }

  // ── the Studio's API ────────────────────────────────────────────────────────────────

  async #proxyApi(request: IncomingMessage, response: ServerResponse, path: string, url: URL): Promise<void> {
    const method = (request.method ?? "GET").toUpperCase();

    if (method === "GET" || method === "HEAD") {
      const allowed = ALLOWED_READS.find((entry) => entry.method === method && entry.pattern.test(path));
      if (allowed === undefined) {
        this.#refuse(response, 422, `the Gateway does not proxy ${path}`);
        return;
      }
      if (!this.#sessionValid(request)) {
        this.#refuse(response, 401, "the Gateway's session cookie is missing or stale");
        return;
      }
      await this.#relay(request, response, `${this.#deps.studio.origin}${path}${url.search}`, true);
      return;
    }

    if (method === "POST") {
      await this.#nativeWrite(request, response, path);
      return;
    }

    this.#refuse(response, 422, `the Gateway does not proxy ${method} ${path}`);
  }

  /**
   * The write path.
   *
   * Everything is denied by default. The only accepted writes are the native entries the
   * OpenFilm capability map reports as supported, and they are addressed by their
   * registry id — never as a raw upstream operation, so the upstream's own `/edit` can
   * never reach the author's source.
   */
  async #nativeWrite(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
    const match = /^\/narralens\/native\/([A-Za-z0-9_.]+)$/u.exec(path);
    if (match === null) {
      this.#refuse(response, 422, "the Gateway accepts only the registered native write entries");
      return;
    }
    const entryId = match[1]!;
    if (!this.#sessionValid(request)) {
      this.#refuse(response, 401, "the Gateway's session cookie is missing or stale");
      return;
    }
    if (!openNativeWriteEntries().includes(entryId)) {
      const entry = NATIVE_MUTATION_REGISTRY.find((candidate) => candidate.entry_id === entryId);
      this.#refuse(response, 422,
        `${entryId} is not open on OpenFilm: ${entry?.reason ?? "it is not a registered native entry"}`);
      return;
    }
    // A write must come from the Gateway's own origin, so a page on another origin cannot
    // make the browser perform one.
    const origin = request.headers.origin;
    if (typeof origin === "string" && origin !== "" && origin !== this.#origin) {
      this.#refuse(response, 403, "the write did not come from the Gateway's own origin");
      return;
    }
    const body = await readJsonBody(request);
    if (body === undefined) {
      this.#refuse(response, 400, "the request body is not JSON");
      return;
    }
    const projectId = typeof (body as { project_id?: unknown }).project_id === "string"
      ? (body as { project_id: string }).project_id : "";
    const correlationId = randomUUID();
    const result = await this.#deps.services.nativeWrite({
      entry_id: entryId, project_id: projectId, body, correlation_id: correlationId,
    });
    response.writeHead(result.status, { "content-type": "application/json" });
    response.end(JSON.stringify(result.body));
  }

  #refuse(response: ServerResponse, status: number, message: string): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: message }));
  }

  /**
   * The Narralens service surface.
   *
   * The Gateway names an operation from a closed set and the Host runs it. The request
   * never carries a Host bearer — it never leaves the Host's process — and the answer is
   * the Host's own: the same status, the same code and the same contract-checked body the
   * Host's own route would have produced.
   */
  async #narralensOperation(request: IncomingMessage, response: ServerResponse,
    path: string, url: URL): Promise<void> {
    const method = (request.method ?? "GET").toUpperCase();
    if (!this.#sessionValid(request)) {
      this.#refuse(response, 401, "the Gateway's session cookie is missing or stale");
      return;
    }
    const rest = path.slice("/narralens/api".length);
    const projectId = url.searchParams.get("project_id") ?? "";

    let operation: StudioOperation | undefined;
    if (method === "GET" && rest === "/workbench") operation = "workbench";
    else if (method === "GET" && rest === "/history") operation = "history.read";
    else if (method === "GET" && rest === "/inventory") operation = "inventory";
    else if (method === "GET" && rest.startsWith("/materializations/")) operation = "materialization.read";
    else if (method === "POST" && rest === "/comparisons/replay") operation = "comparison.replay";
    else if (method === "POST" && rest === "/locks") operation = "lock.create";
    else if (method === "DELETE" && rest.startsWith("/locks/")) operation = "lock.release";
    else if (method === "POST" && rest === "/materialize") operation = "materialize";
    else if (method === "POST" && rest === "/impact") operation = "impact";
    else if (method === "POST" && rest === "/history/undo") operation = "history.undo";
    else if (method === "POST" && rest === "/history/redo") operation = "history.redo";
    else if (method === "POST" && rest === "/history/restore") operation = "history.restore";

    if (operation === undefined) {
      this.#refuse(response, 422, `the Gateway does not expose ${method} ${path}`);
      return;
    }
    const body = method === "GET" ? undefined : await readJsonBody(request);
    if (method !== "GET" && body === undefined) {
      this.#refuse(response, 400, "the request body is not JSON");
      return;
    }
    const result = await this.#deps.services.call({
      operation, project_id: projectId, body, correlation_id: randomUUID(),
    });
    response.writeHead(result.status, { "content-type": "application/json" });
    response.end(JSON.stringify(result.body));
  }

  // ── the editor's pages ─────────────────────────────────────────────────────────────

  async #proxyEditor(request: IncomingMessage, response: ServerResponse, path: string, url: URL): Promise<void> {
    if ((request.method ?? "GET").toUpperCase() !== "GET") {
      this.#refuse(response, 422, "the Gateway does not proxy this method");
      return;
    }
    const upstream = await fetch(`${this.#deps.studio.origin}${path}${url.search}`, {
      headers: { "x-studio-key": this.#deps.studio.key, accept: "text/html,*/*" },
    });
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      // The editor's assets are served as they are; the key is not in them.
      response.writeHead(upstream.status, { "content-type": contentType });
      response.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    const html = await upstream.text();
    this.#issueSession(response);
    response.writeHead(upstream.status, { "content-type": "text/html; charset=utf-8" });
    response.end(this.#injectBridge(html));
  }

  /**
   * Put the Narralens panel in the Studio's own document.
   *
   * The bridge is a *classic* script placed at the end of the body: it runs while the
   * document is still being parsed, which is before the Studio's deferred modules — and
   * the Studio reads `globalThis.openfilmHost` when its modules load. A module script
   * would be too late, and the seam would silently be absent.
   */
  #injectBridge(html: string): string {
    const script = `<script src="/narralens/studio-host.js"></script>`;
    if (html.includes("</body>")) return html.replace("</body>", `${script}</body>`);
    return `${html}${script}`;
  }

  // ── the film's own origin ──────────────────────────────────────────────────────────

  async #proxyFilm(path: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = (request.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      this.#refuse(response, 422, "the film's files are read-only through the Gateway");
      return;
    }
    await this.#relay(request, response, `${this.#filmOrigin}${path}`, false);
  }

  // ── relaying ────────────────────────────────────────────────────────────────────────

  /**
   * Relay one request upstream, with the launch key added server-side.
   *
   * The response is rewritten twice: the film's own origin becomes the Gateway's, so the
   * browser never opens a second origin, and the studio's own CORS answer becomes the
   * Gateway's. Absolute paths are stripped from JSON answers: the project list carries
   * the folder on disk, and the browser has no business knowing it.
   */
  async #relay(request: IncomingMessage, response: ServerResponse, target: string, sanitize: boolean): Promise<void> {
    const upstream = await fetch(target, {
      method: request.method ?? "GET",
      headers: { "x-studio-key": this.#deps.studio.key, accept: request.headers.accept ?? "*/*" },
    });
    const contentType = upstream.headers.get("content-type") ?? "";
    const headers: Record<string, string> = { "content-type": contentType };
    if (contentType.includes("application/json")) {
      const text = await upstream.text();
      response.writeHead(upstream.status, headers);
      response.end(sanitize ? this.#sanitize(text) : text);
      return;
    }
    response.writeHead(upstream.status, headers);
    response.end(Buffer.from(await upstream.arrayBuffer()));
  }

  /** Strip the machine's layout out of a JSON answer and point it back at the Gateway. */
  #sanitize(text: string): string {
    let value: unknown;
    try { value = JSON.parse(text); } catch { return text; }
    const rewritten = rewriteValue(value, this.#filmOrigin, this.#origin);
    return JSON.stringify(rewritten);
  }

  // ── the live event stream ───────────────────────────────────────────────────────────

  #upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? "/", this.#origin);
    const path = url.pathname;
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string" || key === ""
      || !this.#hostHeaderAllowed(request)
      || !this.#sessionValid(request)
      || !ALLOWED_SOCKETS.some((pattern) => pattern.test(path))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const upstream = new WebSocket(`${this.#deps.studio.origin}${path}?key=${encodeURIComponent(this.#deps.studio.key)}`);
    this.#sockets.add(socket);
    writeHandshake(socket, key);
    if (head.length > 0) socket.unshift(head);

    let pending: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      const { frames, rest } = decodeFrames(pending);
      pending = rest;
      for (const frame of frames) {
        if (frame.opcode === OPCODE.close) { socket.end(); return; }
        if (frame.opcode === OPCODE.ping) { socket.write(encodeFrame(OPCODE.pong, frame.payload)); continue; }
        if (frame.opcode === OPCODE.pong) continue;
        if (upstream.readyState === WebSocket.OPEN) upstream.send(frame.payload.toString("utf8"));
      }
    });
    socket.on("error", () => { socket.destroy(); });
    socket.on("close", () => { this.#sockets.delete(socket); try { upstream.close(); } catch { /* already closed */ } });

    relayFrames(upstreamMessages(upstream), (frame) => {
      if (socket.destroyed) return;
      socket.write(encodeFrame(frame.opcode, frame.payload));
    }, () => { if (!socket.destroyed) socket.end(); });
  }
}

/** The upstream's messages, as an async iterable. */
async function* upstreamMessages(socket: WebSocket): AsyncGenerator<string> {
  await new Promise<void>((done, fail) => {
    socket.addEventListener("open", () => done(), { once: true });
    socket.addEventListener("error", () => fail(new Error("UPSTREAM_SOCKET_FAILED")), { once: true });
  });
  const queue: string[] = [];
  let notify: (() => void) | undefined;
  socket.addEventListener("message", (event: MessageEvent) => {
    queue.push(typeof event.data === "string" ? event.data : "");
    notify?.();
  });
  for (;;) {
    while (queue.length > 0) yield queue.shift()!;
    await new Promise<void>((done) => {
      notify = () => { notify = undefined; done(); };
      if (queue.length > 0) { notify = undefined; done(); }
    });
  }
}

/**
 * Remove the machine's layout from a JSON value, and point the film's origin at the
 * Gateway.
 */
function rewriteValue(value: unknown, filmOrigin: string, gatewayOrigin: string): unknown {
  if (typeof value === "string") {
    if (value.startsWith(filmOrigin)) return `${gatewayOrigin}/film${value.slice(filmOrigin.length)}`;
    // An absolute path on this machine is a directory listing, and the browser has no
    // business having one.
    if (value.startsWith("/") && value.length > 1 && !value.startsWith("//")) return "";
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => rewriteValue(item, filmOrigin, gatewayOrigin));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      // The key names a file, and the value is its absolute path.
      if (key === "path" && typeof item === "string" && item.startsWith("/")) { out[key] = ""; continue; }
      out[key] = rewriteValue(item, filmOrigin, gatewayOrigin);
    }
    return out;
  }
  return value;
}

/** Read a JSON body, or `undefined` when it is not JSON. */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 65_536) return undefined;
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { return undefined; }
}
