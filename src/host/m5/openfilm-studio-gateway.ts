import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { openFilmCapabilityMap } from "../engine/engine-capabilities.js";
import { NATIVE_MUTATION_REGISTRY } from "../engine/native-mutation-registry.js";
import type { StartedStudio } from "./openfilm-studio-supervisor.js";
import { OPCODE, decodeFrames, encodeClientFrame, encodeFrame, writeHandshake } from "./websocket-relay.js";

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
  /**
   * The media the panel may play, by name.
   *
   * The allowlist is exact: a name that is not in this map is not served, so the Gateway
   * can never become a way to read a directory.
   */
  readonly mediaFiles?: Readonly<Record<string, string>> | undefined;
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

/** The composed editor is top-level; only its own proxied film may be framed by it. */
export function gatewayFramePolicy(path: string): {
  readonly frameAncestors: "self" | "none"; readonly xFrameOptions: "SAMEORIGIN" | "DENY";
} {
  void path;
  return { frameAncestors: "none", xFrameOptions: "DENY" };
}

/**
 * The pinned Studio reports its media server as `localhost` even though its listening
 * origin is normalised to `127.0.0.1`. They are different browser origins. Accept only
 * those two exact loopback spellings on the already-known media port and project the URL
 * back through the Gateway; never rewrite another hostname or port.
 */
export function gatewayFilmUrl(value: string, filmOrigin: string, gatewayOrigin: string): string | null {
  let candidate: URL;
  let expected: URL;
  try { candidate = new URL(value); expected = new URL(filmOrigin); }
  catch { return null; }
  const loopback = (host: string): boolean => host === "localhost" || host === "127.0.0.1";
  if (candidate.protocol !== "http:" || expected.protocol !== "http:"
    || !loopback(candidate.hostname) || !loopback(expected.hostname)
    || candidate.port !== expected.port) return null;
  return `${gatewayOrigin}/film${candidate.pathname}${candidate.search}${candidate.hash}`;
}

/** Point the film host bridge at the composed parent document, never the hidden upstream. */
export function rewriteFilmDocument(source: string, studioOrigin: string, gatewayOrigin: string): string {
  return source.replaceAll(studioOrigin, gatewayOrigin);
}

export class OpenFilmStudioGateway {
  readonly #deps: OpenFilmStudioGatewayDeps;
  readonly #sessions = new Set<string>();
  #server: Server | undefined;
  #filmServer: Server | undefined;
  #origin = "";
  #filmGatewayOrigin = "";
  #filmOrigin = "";
  readonly #sockets = new Set<Duplex>();

  constructor(deps: OpenFilmStudioGatewayDeps) {
    this.#deps = deps;
  }

  get origin(): string { return this.#origin; }

  async start(): Promise<string> {
    if (this.#server !== undefined) return this.#origin;
    // With `port: 0` the pinned Studio selects two free ports and reports both. The film
    // server is not required to be editor-port+1 in that mode, so deriving it points the
    // proxy at a listener that may not exist and fails to rewrite the real `localhost`
    // URL returned by the API/event stream.
    this.#filmOrigin = this.#deps.studio.filmOrigin;
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

    // Film code is intentionally a different browser origin from the editor. It can
    // render and postMessage to the editor, but it cannot read the panel DOM, its cookie
    // or its API. This second server is still a read-only, Host-checked Gateway — never
    // the upstream origin and never a filesystem server.
    const filmServer = createServer((request, response) => { void this.#handleFilm(request, response); });
    await new Promise<void>((done, fail) => {
      filmServer.once("error", fail);
      filmServer.listen(0, "127.0.0.1", () => { filmServer.removeListener("error", fail); done(); });
    });
    const filmAddress = filmServer.address();
    if (filmAddress === null || typeof filmAddress === "string") {
      await new Promise<void>((done) => server.close(() => done()));
      this.#server = undefined;
      throw new Error("THE_FILM_GATEWAY_HAS_NO_ADDRESS");
    }
    this.#filmGatewayOrigin = `http://127.0.0.1:${filmAddress.port}`;
    this.#filmServer = filmServer;
    return this.#origin;
  }

  async close(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
    const server = this.#server;
    const filmServer = this.#filmServer;
    this.#server = undefined;
    this.#filmServer = undefined;
    await Promise.all([
      server === undefined ? Promise.resolve() : new Promise<void>((done) => { server.close(() => done()); }),
      filmServer === undefined ? Promise.resolve() : new Promise<void>((done) => { filmServer.close(() => done()); }),
    ]);
  }

  async #handleFilm(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", this.#filmGatewayOrigin);
    if (!this.#hostHeaderAllowed(request, this.#filmGatewayOrigin)) {
      response.writeHead(421, { "content-type": "text/plain" });
      response.end("misdirected request\n");
      return;
    }
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy",
      `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; `
      + `img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; `
      + `frame-ancestors 'self' ${this.#origin}; base-uri 'none'; form-action 'none'`);
    // The editor, and only the editor, may read film assets. This one-way CORS grant is
    // required by the pinned player: it fetches narration bytes before handing them to
    // WebAudio. It does not give film code access to the editor origin, its cookie or API.
    response.setHeader("Access-Control-Allow-Origin", this.#origin);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    if (!url.pathname.startsWith("/film/")) {
      response.writeHead(404, { "content-type": "text/plain" }); response.end("not found\n"); return;
    }
    await this.#proxyFilm(url.pathname.slice("/film".length), url, request, response);
  }

  // ── request handling ────────────────────────────────────────────────────────────────

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", this.#origin);
    const path = url.pathname;

    // The Host header check comes first: a name pointed at this machine (DNS rebinding)
    // gets nothing at all, not even a 404 that describes the Gateway.
    if (!this.#hostHeaderAllowed(request, this.#origin)) {
      response.writeHead(421, { "content-type": "text/plain" });
      response.end("misdirected request\n");
      return;
    }
    this.#securityHeaders(response, path);

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

    // The media the panel may play. The allowlist is exact: a name that is not in it is
    // not served, and the Gateway never becomes a way to read a directory.
    if (path.startsWith("/narralens/media/")) {
      await this.#media(response, path.slice("/narralens/media/".length));
      return;
    }

    // The bridge and the panel are the only things the Gateway serves itself.
    if (path.startsWith("/narralens/")) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "no such narralens resource" }));
      return;
    }

    if (path.startsWith("/api/")) {
      await this.#proxyApi(request, response, path, url);
      return;
    }

    // The Studio's own pages, with the bridge injected into the same document.
    await this.#proxyEditor(request, response, path, url);
  }

  #hostHeaderAllowed(request: IncomingMessage, origin: string): boolean {
    const host = request.headers.host;
    if (typeof host !== "string" || host === "") return false;
    const expected = new URL(origin).host;
    if (host === expected) return true;
    // `127.0.0.1` without the port is not this Gateway: a rebound name usually arrives
    // with a port of its own, and the port is part of the origin.
    return false;
  }

  #securityHeaders(response: ServerResponse, path: string): void {
    // The editor page itself must never be framed. Film pages are not served here: the
    // dedicated read-only Film Gateway gives them a separate browser origin.
    const framePolicy = gatewayFramePolicy(path);
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
      + `img-src 'self' data: blob: ${this.#filmGatewayOrigin}; media-src 'self' blob: ${this.#filmGatewayOrigin}; `
      + `connect-src 'self' ${this.#filmGatewayOrigin} ws: wss:; `
      + `frame-src ${this.#filmGatewayOrigin}; frame-ancestors '${framePolicy.frameAncestors}'; base-uri 'none'; form-action 'none'`);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", framePolicy.xFrameOptions);
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
    // The project id is the Gateway's own addressing, not part of the request the Host
    // validates: the frozen request contracts forbid an extra field, and `project_id` is
    // not one of them.
    const { project_id: _addressing, ...payload } = body as Record<string, unknown>;
    const result = await this.#deps.services.nativeWrite({
      entry_id: entryId, project_id: projectId, body: payload, correlation_id: correlationId,
    });
    response.writeHead(result.status, { "content-type": "application/json" });
    response.end(JSON.stringify(result.body));
  }

  #refuse(response: ServerResponse, status: number, message: string): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: message }));
  }

  /** Serve one allowlisted media file. */
  async #media(response: ServerResponse, name: string): Promise<void> {
    const files = this.#deps.mediaFiles;
    const file = files?.[name];
    if (file === undefined) {
      this.#refuse(response, 404, "no such media file");
      return;
    }
    const bytes = await readFile(file).catch(() => undefined);
    if (bytes === undefined) {
      this.#refuse(response, 404, "no such media file");
      return;
    }
    response.writeHead(200, {
      "content-type": name.endsWith(".mp4") ? "video/mp4" : "application/octet-stream",
      "content-length": String(bytes.length),
      "accept-ranges": "none",
    });
    response.end(bytes);
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

  async #proxyFilm(path: string, url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = (request.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      this.#refuse(response, 422, "the film's files are read-only through the Gateway");
      return;
    }
    // `timeline.mjs` re-reads film.html with `?film-host=0` to obtain the author's source
    // without OpenFilm's injected host scripts and with the original iframe `src`
    // attributes. Dropping this query makes the parser read its own injected runtime and
    // turns every page clip into a false "missing src" error.
    const requestHeaders: Record<string, string> = { accept: request.headers.accept ?? "*/*" };
    if (typeof request.headers.range === "string") requestHeaders.range = request.headers.range;
    const upstream = await fetch(`${this.#filmOrigin}${path}${url.search}`, {
      method, headers: requestHeaders,
    });
    const contentType = upstream.headers.get("content-type") ?? "";
    const headers: Record<string, string> = { "content-type": contentType };
    for (const name of ["content-range", "accept-ranges"] as const) {
      const value = upstream.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    response.writeHead(upstream.status, headers);
    if (method === "HEAD") { response.end(); return; }
    if (contentType.includes("text/html") || contentType.includes("javascript")) {
      response.end(rewriteFilmDocument(await upstream.text(), this.#deps.studio.origin, this.#origin));
      return;
    }
    response.end(Buffer.from(await upstream.arrayBuffer()));
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
    const rewritten = rewriteValue(value, this.#filmOrigin, this.#filmGatewayOrigin);
    return JSON.stringify(rewritten);
  }

  // ── the live event stream ───────────────────────────────────────────────────────────

  #upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? "/", this.#origin);
    const path = url.pathname;
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string" || key === ""
      || !this.#hostHeaderAllowed(request, this.#origin)
      || !this.#sessionValid(request)
      || !ALLOWED_SOCKETS.some((pattern) => pattern.test(path))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    this.#sockets.add(socket);
    void this.#relaySocket(url, socket, head, key).catch(() => {
      if (!socket.destroyed) socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    });
  }

  async #relaySocket(url: URL, browser: Duplex, head: Buffer, browserKey: string): Promise<void> {
    const upstream = await openUpstreamSocket(
      `${this.#deps.studio.origin}${url.pathname}${url.search}`, this.#deps.studio.key);
    if (browser.destroyed) { upstream.destroy(); return; }
    writeHandshake(browser, browserKey);
    if (head.length > 0) browser.unshift(head);
    let browserPending = Buffer.alloc(0);
    let upstreamPending = Buffer.alloc(0);
    browser.on("data", (chunk: Buffer) => {
      browserPending = Buffer.concat([browserPending, chunk]);
      const decoded = decodeFrames(browserPending); browserPending = Buffer.from(decoded.rest);
      for (const frame of decoded.frames) {
        if (frame.opcode === OPCODE.close) {
          upstream.write(encodeClientFrame(OPCODE.close, frame.payload.subarray(0, 2))); browser.end(); return;
        }
        if (frame.opcode === OPCODE.ping) { browser.write(encodeFrame(OPCODE.pong, frame.payload)); continue; }
        if (frame.opcode === OPCODE.pong) continue;
        upstream.write(encodeClientFrame(frame.opcode, frame.payload));
      }
    });
    upstream.on("data", (chunk: Buffer) => {
      upstreamPending = Buffer.concat([upstreamPending, chunk]);
      const decoded = decodeFrames(upstreamPending); upstreamPending = Buffer.from(decoded.rest);
      for (const frame of decoded.frames) {
        if (frame.opcode === OPCODE.close) { browser.end(encodeFrame(OPCODE.close, frame.payload.subarray(0, 2))); return; }
        if (frame.opcode === OPCODE.ping) { upstream.write(encodeClientFrame(OPCODE.pong, frame.payload)); continue; }
        if (frame.opcode === OPCODE.pong) continue;
        const payload = frame.opcode === OPCODE.text
          ? Buffer.from(this.#sanitize(frame.payload.toString("utf8")), "utf8") : frame.payload;
        browser.write(encodeFrame(frame.opcode, payload));
      }
    });
    const close = (): void => { this.#sockets.delete(browser); browser.destroy(); upstream.destroy(); };
    browser.on("error", close); browser.on("close", close);
    upstream.on("error", close); upstream.on("close", close);
  }
}

/** Open an authenticated upstream WebSocket without exposing the Studio key in a URL. */
function openUpstreamSocket(target: string, studioKey: string): Promise<Duplex> {
  return new Promise((done, fail) => {
    const request = httpRequest(target, { headers: {
      connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13",
      "sec-websocket-key": randomBytes(16).toString("base64"), "x-studio-key": studioKey,
    } });
    request.once("upgrade", (_response, socket, head) => {
      if (head.length > 0) socket.unshift(head); done(socket);
    });
    request.once("response", (response) => fail(new Error(`UPSTREAM_SOCKET_REFUSED:${response.statusCode ?? 0}`)));
    request.once("error", fail); request.end();
  });
}

/**
 * Remove the machine's layout from a JSON value, and point the film's origin at the
 * Gateway.
 */
function rewriteValue(value: unknown, filmOrigin: string, gatewayOrigin: string): unknown {
  if (typeof value === "string") {
    const filmUrl = gatewayFilmUrl(value, filmOrigin, gatewayOrigin);
    if (filmUrl !== null) return filmUrl;
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
