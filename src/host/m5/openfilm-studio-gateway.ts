import {ControlledStudioAccess,StudioAccessError,UI_MAX_READ_BYTES,type NativeStudioGrant,type NativeStudioSession,type NativeStudioUiReviewMedia} from './controlled-studio-access.js';
import {CONTROLLED_NATIVE_ENTRY_HTML,CONTROLLED_NATIVE_TRANSPORT_SCRIPT} from './controlled-studio-browser.js';
import {parseNativeObservationBody} from './native-observation.js';
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
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
  /** A-mode owner-scoped access; legacy remains unchanged when omitted. */
  readonly controlled?: boolean;
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
  /**
   * The runtime UI registry: the closed surface/operation allowlist.
   *
   * It is BRIDGE's file (`contracts/agent-workbench-ui-v1.registry.json`) and it is
   * injected by the Host composition. When it is absent the Gateway refuses the UI
   * aliases with 503 rather than guessing an allowlist of its own.
   */
  readonly uiRegistry?: GatewayUiRuntimeRegistry | null | undefined;
}

/**
 * The runtime UI registry (CR-R1-001 §3).
 *
 * It is a closed set of surfaces and operations. The Gateway consults it before every
 * call; the Host's dispatcher remains the authority for the answer.
 */
export interface GatewayUiRuntimeRegistry {
  readonly format: string;
  readonly operations: Readonly<Record<string, readonly string[]>>;
}

/** Where BRIDGE's runtime registry lives, relative to the repository root. */
export const GATEWAY_UI_REGISTRY_RELATIVE_PATH = "contracts/agent-workbench-ui-v1.registry.json";

/** The repository root, from this module's own location. */
export function gatewayUiRegistryRoot(): string {
  return resolve(fileURLToPath(new URL("../../../", import.meta.url)));
}

/**
 * Read BRIDGE's runtime registry.
 *
 * It returns `null` when the file is absent or malformed: the Gateway then refuses the
 * UI aliases with 503. It never falls back to a registry of its own — a second allowlist
 * would be a second protocol.
 */
export async function loadGatewayUiRegistry(root: string = gatewayUiRegistryRoot()): Promise<GatewayUiRuntimeRegistry | null> {
  const raw = await readFile(resolve(root, GATEWAY_UI_REGISTRY_RELATIVE_PATH), "utf8").catch(() => null);
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as { format?: unknown; operations?: unknown; operation_allowlist?: unknown };
  const source = record.operations ?? record.operation_allowlist;
  if (source === null || typeof source !== "object" || Array.isArray(source)) return null;
  const operations: Record<string, readonly string[]> = Object.create(null);
  for (const [surface, list] of Object.entries(source as Record<string, unknown>)) {
    if (!Array.isArray(list)) return null;
    for (const item of list) if (typeof item !== "string") return null;
    operations[surface] = Object.freeze([...(list as string[])]);
  }
  return Object.freeze({
    format: typeof record.format === "string" ? record.format : "narralens.gateway-ui-runtime-registry@1",
    operations: Object.freeze(operations),
  });
}

/**
 * The two Gateway aliases this ticket adds (CR-R1-001 §1).
 *
 * They are counted separately from the Host routes: 31 frozen Host + 5 reviewed adjunct
 * Host + 2 explicitly additional Gateway HTTP. The count is never "still 31+5".
 */
/**
 * The one additional Gateway route (A-R2, L05).
 *
 * It is counted separately from the frozen Host routes, from the reviewed adjuncts
 * and from the two UI aliases, and it is the only route the native observation uses.
 */
export const NATIVE_OBSERVATION_ROUTE = "/narralens/native/observation";

export const GATEWAY_UI_ALIASES: readonly { readonly method: "POST" | "GET"; readonly path: string }[] = Object.freeze([
  Object.freeze({ method: "POST", path: "/narralens/api/ui/call" }),
  Object.freeze({ method: "GET", path: "/narralens/api/ui/review-media/:ref" }),
]);

/** The exposure counting, stated exactly. */
export const GATEWAY_UI_EXPOSURE_COUNTING =
  "31 frozen Host + 5 reviewed adjunct Host + 2 explicitly additional Gateway HTTP";

/** The three closed surfaces the UI RPC may name. */
const UI_SURFACES = ["agent.v1", "local-assets.v1", "workbench.v1"] as const;


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
  readonly #access:ControlledStudioAccess|undefined;
  #server: Server | undefined;
  #filmServer: Server | undefined;
  #origin = "";
  #filmGatewayOrigin = "";
  #filmOrigin = "";
  readonly #sockets = new Set<Duplex>();
  readonly #uiMediaRequests = new Set<AbortController>();

  constructor(deps: OpenFilmStudioGatewayDeps) {
    this.#deps = deps;
    this.#access=deps.controlled?new ControlledStudioAccess(()=>this.#origin):undefined;
  }

  get origin(): string { return this.#origin; }
  get isListening(){return this.#server?.listening===true||this.#filmServer?.listening===true;}
  issueNativeEntry(grant:NativeStudioGrant){
    if(!this.#access||this.#deps.studio.isAlive?.()!==true)throw new StudioAccessError(503,'CAPABILITY_UNAVAILABLE');
    return this.#access.issue({...grant,isCurrent:()=>this.#deps.studio.isAlive?.()===true&&grant.isCurrent()});
  }
  #accessFailure(response:ServerResponse,error:unknown){
    if(response.destroyed||response.writableEnded)return;
    if(response.headersSent){response.destroy();return;}
    const failure=error instanceof StudioAccessError?error:new StudioAccessError(503,'CAPABILITY_UNAVAILABLE');
    const message=failure.code==='RANGE_NOT_SATISFIABLE'?'请求的范围无法满足。'
      :failure.code==='INVALID_REQUEST'?'请求无效，未被转交。'
      :failure.code==='CAPABILITY_UNAVAILABLE'?'该能力当前不可用，未伪造可用。'
      :'原生工程会话不可用，请从工作台重新打开。';
    response.writeHead(failure.status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify({code:failure.code,message}));
  }
  #filmPrefix(session:NativeStudioSession){return '/p/'+createHmac('sha256',this.#deps.studio.key).update('film origin\0'+session.grant.native_project_id).digest().subarray(0,18).toString('base64url')+'/';}


  async start(): Promise<string> {
    if (this.#server !== undefined) return this.#origin;
    // With `port: 0` the pinned Studio selects two free ports and reports both. The film
    // server is not required to be editor-port+1 in that mode, so deriving it points the
    // proxy at a listener that may not exist and fails to rewrite the real `localhost`
    // URL returned by the API/event stream.
    this.#filmOrigin = this.#deps.studio.filmOrigin;
    const server = createServer((request, response) => { void this.#handle(request, response).catch(error=>this.#accessFailure(response,error)); });
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
    const filmServer = createServer((request, response) => { void this.#handleFilm(request, response).catch(error=>this.#accessFailure(response,error)); });
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
    this.#access?.close();
    for (const controller of this.#uiMediaRequests) controller.abort();
    this.#uiMediaRequests.clear();
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
    if (!this.#hostHeaderAllowed(request, this.#filmGatewayOrigin)||url.origin!==this.#filmGatewayOrigin) {
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
    if(this.#access){
      const match=url.pathname.match(/^\/s\/([A-Za-z0-9_-]{43})(\/film\/.*)$/);
      if(!match)throw new StudioAccessError(401,'UNAUTHORIZED');
      const session=this.#access.readSession(match[1]);
      const filmPath=match[2]!.slice('/film'.length);
      if(!filmPath.startsWith(this.#filmPrefix(session)))throw new StudioAccessError(403,'ORIGIN_REJECTED');
      await this.#proxyFilm(filmPath,url,request,response,session);return;
    }
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
    if (!this.#hostHeaderAllowed(request, this.#origin)||url.origin!==this.#origin) {
      response.writeHead(421, { "content-type": "text/plain" });
      response.end("misdirected request\n");
      return;
    }
    this.#securityHeaders(response, path);

    if(this.#access&&path==='/narralens/entry'){
      if(request.method!=='GET'||url.search)throw new StudioAccessError(400,'INVALID_REQUEST');
      response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(CONTROLLED_NATIVE_ENTRY_HTML);return;
    }
    if(this.#access&&path==='/narralens/session/exchange'){
      if(url.search)throw new StudioAccessError(400,'INVALID_REQUEST');
      await this.#access.exchange(request,response);return;
    }
    if (path === "/narralens/studio-host.js") {
      const script = (this.#access?CONTROLLED_NATIVE_TRANSPORT_SCRIPT:"")+(this.#deps.bridgeScript ?? "");
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

    // The native observation ingress (A-R2, L05). It is exactly one additional Gateway
    // HTTP route, counted separately, and it is dispatched before the native write
    // catch-all so it can never be mistaken for a write. It opens no write surface, it
    // joins no MCP tool set, and it replaces no UI alias.
    if (path === NATIVE_OBSERVATION_ROUTE) {
      await this.#nativeObservation(request, response);
      return;
    }

    // The native writes are addressed by their registry entry id, never as a raw upstream
    // operation. They are the Gateway's own surface, so they are routed before the
    // catch-all below.
    if (path.startsWith("/narralens/native/")) {
      await this.#nativeWrite(request, response, path);
      return;
    }

    // The workbench UI aliases (CR-R1-001 §1). They are a second purpose: they carry
    // the independent UI cookie and proof, and the native proof never stands in for them.
    if (path.startsWith("/narralens/api/ui/")) {
      await this.#uiRoute(request, response, path);
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
      if(this.#access){this.#access.authenticate(request);throw new StudioAccessError(503,'CAPABILITY_UNAVAILABLE');}
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

  // ── the workbench UI aliases ─────────────────────────────────────────────────────────

  /**
   * The two UI aliases.
   *
   * The order is the contract's: the independent cookie and proof first, then the
   * closed registry, then the Host's own dispatcher. A missing producer answers 503 —
   * the Gateway never claims a capability it does not have, and it never falls back to
   * the native session.
   */
  async #uiRoute(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
    if (this.#access === undefined) throw new StudioAccessError(503, "CAPABILITY_UNAVAILABLE");
    const method = (request.method ?? "GET").toUpperCase();
    if (method === "POST" && path === "/narralens/api/ui/call") {
      await this.#uiCall(request, response);
      return;
    }
    const media = /^\/narralens\/api\/ui\/review-media\/([A-Za-z0-9_-]{1,200})$/.exec(path);
    if ((method === "GET" || method === "HEAD") && media !== null) {
      await this.#uiReviewMedia(request, response, media[1]!);
      return;
    }
    throw new StudioAccessError(404, "NOT_FOUND");
  }

  /**
   * One closed UI call.
   *
   * The envelope has exactly three fields, and the input is passed on untouched: the
   * Host's own DTO validators must see exactly what the caller sent, and an unknown
   * field must not be dropped before they do.
   */
  async #uiCall(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const session = this.#access!.authenticateUi(request);
    const envelope = await readJsonBody(request);
    if (envelope === undefined || envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
      throw new StudioAccessError(400, "INVALID_REQUEST");
    }
    const keys = Object.keys(envelope);
    if (keys.length !== 3 || !keys.includes("surface") || !keys.includes("operation") || !keys.includes("input")) {
      throw new StudioAccessError(400, "INVALID_REQUEST");
    }
    const surface = (envelope as { surface: unknown }).surface;
    const operation = (envelope as { operation: unknown }).operation;
    const input = (envelope as { input: unknown }).input;
    if (typeof surface !== "string" || !(UI_SURFACES as readonly string[]).includes(surface)) {
      throw new StudioAccessError(400, "INVALID_REQUEST");
    }
    if (typeof operation !== "string" || operation === "") throw new StudioAccessError(400, "INVALID_REQUEST");
    // `null` means the composition has no registry at all; `undefined` means "read the
    // runtime registry". Either way the Gateway never invents an allowlist.
    const registry = this.#deps.uiRegistry === undefined ? await loadGatewayUiRegistry() : this.#deps.uiRegistry;
    if (registry === null) throw new StudioAccessError(503, "CAPABILITY_UNAVAILABLE");
    const allowed = registry.operations[surface];
    if (allowed === undefined || !allowed.includes(operation)) throw new StudioAccessError(400, "INVALID_REQUEST");
    const result = await this.#access!.invokeUi(session, { surface, operation, input, correlation_id: randomUUID() });
    response.writeHead(result.status, { "content-type": "application/json" });
    response.end(result.body === undefined ? "" : JSON.stringify(result.body));
  }

  /**
   * One prepared review medium.
   *
   * The bytes come from the authorised reader, in bounded reads, and the reader is
   * closed on every path — success, short read, cancel or error. The ETag is the
   * object's own digest, so the caller can check the bytes it received against the
   * descriptor it was given.
   */
  async #uiReviewMedia(request: IncomingMessage, response: ServerResponse, ref: string): Promise<void> {
    const session = this.#access!.authenticateUi(request);
    const method = (request.method ?? "GET").toUpperCase();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const disconnected = () => { if (!response.writableFinished) cancel(); };
    request.once("aborted", cancel);
    response.once("close", disconnected);
    this.#uiMediaRequests.add(controller);
    let media: NativeStudioUiReviewMedia | undefined;
    try {
      if (request.aborted || response.destroyed) controller.abort();
      media = await this.#access!.openUiMedia(session, ref, undefined, controller.signal);
      const current = () => {
        controller.signal.throwIfAborted();
        this.#access!.recheckUi(session);
      };
      current();
      if (!Number.isSafeInteger(media.bytes) || media.bytes < 0
        || !/^[a-f0-9]{64}$/.test(media.sha256) || media.etag !== `"${media.sha256}"`) {
        throw new StudioAccessError(503, "CAPABILITY_UNAVAILABLE");
      }
      const headers: Record<string, string> = {
        "content-type": media.content_type,
        "cache-control": "no-store",
        "accept-ranges": "bytes",
        "etag": media.etag,
        "x-content-type-options": "nosniff",
      };
      const window = resolveByteRange(request.headers.range, media.bytes);
      const length = window === undefined ? media.bytes : window.end - window.start + 1;
      const status = window === undefined ? 200 : 206;
      headers["content-length"] = String(length);
      if (window !== undefined) headers["content-range"] = `bytes ${window.start}-${window.end}/${media.bytes}`;
      if (method === "HEAD") {
        current();
        response.writeHead(status, headers);
        response.end();
        return;
      }
      let offset = window === undefined ? 0 : window.start;
      let remaining = length;
      // Only one reader chunk is retained. Await the socket's backpressure before
      // fetching another chunk; never concatenate the complete video into memory.
      while (remaining > 0) {
        current();
        const size = Math.min(remaining, UI_MAX_READ_BYTES);
        const chunk = await media.read({ offset, length: size });
        current();
        if (chunk.byteLength !== size) throw new StudioAccessError(503, "CAPABILITY_UNAVAILABLE");
        if (!response.headersSent) response.writeHead(status, headers);
        if (!response.write(Buffer.from(chunk))) await awaitResponseDrain(response, controller.signal);
        offset += size;
        remaining -= size;
      }
      current();
      if (!response.headersSent) response.writeHead(status, headers);
      response.end();
    } finally {
      request.removeListener("aborted", cancel);
      response.removeListener("close", disconnected);
      this.#uiMediaRequests.delete(controller);
      if (media !== undefined) {
        try { await media.close(); } catch { /* preserve the original request outcome */ }
      }
    }
  }

  #hostHeaderAllowed(request: IncomingMessage, origin: string): boolean {    const host = request.headers.host;
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
    if(this.#access){
      const media=/^\/api\/projects\/([A-Za-z0-9_-]+)\/(media|poster)$/.exec(path);
      const session=media&&url.searchParams.has('native_read')?this.#access.readSession(url.searchParams.get('native_read')):this.#access.authenticate(request);
      const project=/^\/api\/projects\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(path);
      if(project)this.#access.assertNative(session,project[1]!);
      if(method!=='GET'&&method!=='HEAD')throw new StudioAccessError(403,'ORIGIN_REJECTED');
      if(url.searchParams.has('native_read')&&!media)throw new StudioAccessError(403,'ORIGIN_REJECTED');
      url.searchParams.delete('native_read');
      const allowed=ALLOWED_READS.some(entry=>(entry.method===method||method==='HEAD'&&entry.method==='GET')&&entry.pattern.test(path))
        || /^\/api\/projects\/[A-Za-z0-9_-]+\/(settings|markers|subtitles)$/.test(path)
        || path==='/api/prefs'||path==='/api/health';
      if(!allowed)throw new StudioAccessError(403,'ORIGIN_REJECTED');
      // Version reads must never trigger npm/update checks or accept arbitrary query knobs.
      if(path==='/api/version'&&url.search)throw new StudioAccessError(400,'INVALID_REQUEST');
      await this.#relay(request,response,`${this.#deps.studio.origin}${path}${url.search}`,true,session,path==='/api/projects');return;
    }

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
   * The native observation ingress (A-R2, L05).
   *
   * The order is the contract's: the native cookie and the native CSRF proof of a live
   * controlled session first, then the Host-created session binding, then the closed
   * envelope, and only then the producer. A UI cookie, a read token, another origin, a
   * missing cookie, a retired session or a body that carries an identity of its own is
   * refused before anything is believed.
   */
  async #nativeObservation(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (this.#access === undefined) throw new StudioAccessError(503, "CAPABILITY_UNAVAILABLE");
    const method = (request.method ?? "GET").toUpperCase();
    if (method !== "POST") {
      this.#refuse(response, 405, "the Gateway accepts only a native observation by POST");
      return;
    }
    const session = this.#access.authenticate(request);
    const binding = session.observation;
    const port = session.grant.nativeObservation?.port;
    if (binding === undefined || port === undefined) {
      throw new StudioAccessError(503, "CAPABILITY_UNAVAILABLE");
    }
    const body = await this.#observationBody(request);
    const envelope = parseNativeObservationBody(body);
    if (!envelope.ok) {
      this.#refuse(response, 400, `the native observation is not a closed envelope: ${envelope.reason}`);
      return;
    }
    const outcome = await port.observe(binding, envelope.value);
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({
      format: "narralens.native-observation-outcome@1",
      accepted: outcome.accepted,
      reason: outcome.reason,
      sequence: outcome.sequence,
    }));
  }

  /**
   * The bounded body of one observation.
   *
   * It is JSON, it is not encoded, and it is small: an observation is a state report,
   * never a payload.
   */
  async #observationBody(request: IncomingMessage): Promise<string> {
    if (request.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") {
      throw new StudioAccessError(400, "INVALID_REQUEST");
    }
    if (request.headers["content-encoding"] && request.headers["content-encoding"] !== "identity") {
      throw new StudioAccessError(400, "INVALID_REQUEST");
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      const data = Buffer.from(chunk);
      bytes += data.length;
      if (bytes > 65536) throw new StudioAccessError(400, "INVALID_REQUEST");
      chunks.push(data);
    }
    return Buffer.concat(chunks).toString("utf8");
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
    if(this.#access){this.#access.authenticate(request);throw new StudioAccessError(403,'ORIGIN_REJECTED');}
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
    if(this.#access){
      const session=this.#access.authenticate(request);
      const projects=url.searchParams.getAll('project_id');
      if(projects.length!==1||[...url.searchParams.keys()].some(k=>k!=='project_id'))throw new StudioAccessError(400,'INVALID_REQUEST');
      this.#access.assertProject(session,projects[0]!);
      if(method!=='GET'||path!=='/narralens/api/workbench')throw new StudioAccessError(503,'CAPABILITY_UNAVAILABLE');
      const result=await session.grant.readWorkbench();this.#access.recheck(session);
      if(result.project_id!==session.grant.project_id||result.revision!==session.grant.revision||result.active_snapshot_id!==session.grant.snapshot_id||result.source_digest!==session.grant.source_digest)throw new StudioAccessError(409,'NATIVE_SESSION_STALE');
      response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(result));return;
    }
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
    if(!this.#access)this.#issueSession(response);
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

  async #proxyFilm(path: string, url: URL, request: IncomingMessage, response: ServerResponse, session?:NativeStudioSession): Promise<void> {
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
      method, headers: requestHeaders,...(session?{signal:AbortSignal.timeout(30000)}:{}),
    });
    if(session&&!upstream.ok){await upstream.arrayBuffer();this.#access!.recheck(session);throw new StudioAccessError(upstream.status>=400&&upstream.status<500?upstream.status:503,upstream.status===404?'NOT_FOUND':'INVALID_REQUEST');}
    const contentType = upstream.headers.get("content-type") ?? "";
    const headers: Record<string, string> = { "content-type": contentType };
    for (const name of ["content-range", "accept-ranges"] as const) {
      const value = upstream.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    const bytes=method==='HEAD'?null:contentType.includes('text/html')||contentType.includes('javascript')
      ?rewriteFilmDocument(await upstream.text(),this.#deps.studio.origin,this.#origin):Buffer.from(await upstream.arrayBuffer());
    if(session)this.#access!.recheck(session);
    response.writeHead(upstream.status,headers);response.end(bytes);
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
  async #relay(request: IncomingMessage, response: ServerResponse, target: string, sanitize: boolean, session?:NativeStudioSession, projectList=false): Promise<void> {
    const upstream = await fetch(target, {
      method: request.method ?? "GET",
      headers: { "x-studio-key": this.#deps.studio.key, accept: request.headers.accept ?? "*/*" },
      ...(session?{signal:AbortSignal.timeout(30000)}:{}),
    });
    if(session&&!upstream.ok){await upstream.arrayBuffer();this.#access!.recheck(session);throw new StudioAccessError(upstream.status>=400&&upstream.status<500?upstream.status:503,upstream.status===404?'NOT_FOUND':upstream.status>=500?'CAPABILITY_UNAVAILABLE':'INVALID_REQUEST');}
    const contentType = upstream.headers.get("content-type") ?? "";
    const headers: Record<string, string> = { "content-type": contentType };
    if (contentType.includes("application/json")) {
      let text = await upstream.text();
      if(session){
        this.#access!.recheck(session);
        if(projectList){const data=JSON.parse(text) as {projects?:{id?:unknown}[]};if(!Array.isArray(data.projects))throw new StudioAccessError(503,'CAPABILITY_UNAVAILABLE');text=JSON.stringify({...data,projects:data.projects.filter(project=>project.id===session.grant.native_project_id)});}
      }
      response.writeHead(upstream.status, headers);
      response.end(sanitize ? this.#sanitize(text,session) : text);
      return;
    }
    const bytes=Buffer.from(await upstream.arrayBuffer());if(session)this.#access!.recheck(session);
    response.writeHead(upstream.status, headers);response.end(bytes);
  }

  /** Strip the machine's layout out of a JSON answer and point it back at the Gateway. */
  #sanitize(text: string,session?:NativeStudioSession): string {
    let value: unknown;
    try { value = JSON.parse(text); } catch { return text; }
    const rewritten = rewriteValue(value, this.#filmOrigin, this.#filmGatewayOrigin+(session?'/s/'+session.read_token:''));
    return JSON.stringify(rewritten);
  }

  // ── the live event stream ───────────────────────────────────────────────────────────

  #upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? "/", this.#origin);
    const path = url.pathname;
    const key = request.headers["sec-websocket-key"];
    if(this.#access){
      try{
        if(typeof key!=='string'||!key||!this.#hostHeaderAllowed(request,this.#origin)||!ALLOWED_SOCKETS.some(pattern=>pattern.test(path)))throw new StudioAccessError(401,'UNAUTHORIZED');
        const session=this.#access.streamSession(request),project=/^\/api\/projects\/([A-Za-z0-9_-]+)\/events$/.exec(path);
        if(project)this.#access.assertNative(session,project[1]!);
        // The root Studio stream includes other projects' open events. Both native
        // listeners read only the delegated project's actual event stream here.
        url.pathname='/api/projects/'+session.grant.native_project_id+'/events';url.search='';
        this.#sockets.add(socket);
        void this.#relaySocket(url,socket,head,key,session).catch(()=>{if(!socket.destroyed)socket.destroy();});
      }catch{socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');}
      return;
    }
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

  async #relaySocket(url: URL, browser: Duplex, head: Buffer, browserKey: string,session?:NativeStudioSession): Promise<void> {
    const upstream = await openUpstreamSocket(
      `${this.#deps.studio.origin}${url.pathname}${url.search}`, this.#deps.studio.key);
    if (browser.destroyed) { upstream.destroy(); return; }
    try{if(session)this.#access!.recheck(session);}catch(error){upstream.destroy();throw error;}
    writeHandshake(browser,browserKey,session?{'Sec-WebSocket-Protocol':'narralens.read.v1'}:{});
    const check=()=>{try{if(session)this.#access!.recheck(session);return true;}catch{browser.destroy();upstream.destroy();return false;}};
    const heartbeat=session?setInterval(check,1000):undefined;heartbeat?.unref();
    const dispose=()=>{if(heartbeat)clearInterval(heartbeat);};browser.once('close',dispose);upstream.once('close',dispose);
    if (head.length > 0) browser.unshift(head);
    let browserPending = Buffer.alloc(0);
    let upstreamPending = Buffer.alloc(0);
    browser.on("data", (chunk: Buffer) => {
      browserPending = Buffer.concat([browserPending, chunk]);
      const decoded = decodeFrames(browserPending); browserPending = Buffer.from(decoded.rest);
      for (const frame of decoded.frames) {
        if(!check())return;
        if(session&&frame.opcode===OPCODE.text){
          try{const body=JSON.parse(frame.payload.toString('utf8')) as unknown;if(frame.payload.length>256||!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!('visible' in body)||typeof body.visible!=='boolean'){browser.destroy();upstream.destroy();return;}}
          catch{browser.destroy();upstream.destroy();return;}
        }
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
        if(!check())return;
        if (frame.opcode === OPCODE.close) { browser.end(encodeFrame(OPCODE.close, frame.payload.subarray(0, 2))); return; }
        if (frame.opcode === OPCODE.ping) { upstream.write(encodeClientFrame(OPCODE.pong, frame.payload)); continue; }
        if (frame.opcode === OPCODE.pong) continue;
        const payload = frame.opcode === OPCODE.text
          ? Buffer.from(this.#sanitize(frame.payload.toString("utf8"),session), "utf8") : frame.payload;
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

/**
 * The byte window a `Range` header asks for.
 *
 * The window may be any size: the one-mebyte bound belongs to a single *read*, not to
 * the response. A range that cannot be satisfied is refused with 416, never silently
 * widened.
 */
function resolveByteRange(header: string | undefined, total: number): { start: number; end: number } | undefined {
  if (header === undefined) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (match === null) throw new StudioAccessError(416, "RANGE_NOT_SATISFIABLE");
  const rawStart = match[1]!;
  const rawEnd = match[2]!;
  if (rawStart === "" && rawEnd === "") throw new StudioAccessError(416, "RANGE_NOT_SATISFIABLE");
  if (total <= 0) throw new StudioAccessError(416, "RANGE_NOT_SATISFIABLE");
  let start: number;
  let end: number;
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new StudioAccessError(416, "RANGE_NOT_SATISFIABLE");
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(rawStart);
    if (!Number.isSafeInteger(start)) throw new StudioAccessError(416, "RANGE_NOT_SATISFIABLE");
    end = rawEnd === "" ? total - 1 : Math.min(Number(rawEnd), total - 1);
    if (!Number.isSafeInteger(end)) throw new StudioAccessError(416, "RANGE_NOT_SATISFIABLE");
  }
  if (start >= total || start > end) throw new StudioAccessError(416, "RANGE_NOT_SATISFIABLE");
  return { start, end };
}

/** Wait for actual socket capacity, or cancel immediately on disconnect/shutdown. */
function awaitResponseDrain(response: ServerResponse, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      response.removeListener("drain", drained);
      response.removeListener("error", failed);
      signal.removeEventListener("abort", aborted);
    };
    const drained = () => { cleanup(); resolve(); };
    const failed = (error: Error) => { cleanup(); reject(error); };
    const aborted = () => { cleanup(); reject(signal.reason ?? new DOMException("Review media cancelled", "AbortError")); };
    response.once("drain", drained);
    response.once("error", failed);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}
