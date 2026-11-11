import {it,expect,describe} from 'vitest';
import {createHash} from 'node:crypto';
import {connect, type Socket} from 'node:net';
import {
  GATEWAY_UI_ALIASES,
  GATEWAY_UI_EXPOSURE_COUNTING,
  OpenFilmStudioGateway,
  type GatewayUiRuntimeRegistry,
  type StudioHostService,
} from '../../../src/host/m5/openfilm-studio-gateway.js';
import type {
  NativeStudioGrant,
  NativeStudioUiGrantV1,
  NativeStudioUiInvokeInput,
} from '../../../src/host/m5/controlled-studio-access.js';

/**
 * The independent workbench UI transport (CR-R1-001 §1–§3).
 *
 * These cases exercise the *transport*: the two closed Gateway aliases, the independent
 * cookie and proof, the closed registry, and the reader's lifetime. They say nothing
 * about a business approval, an adoption or a delivered film: the Host's real dispatcher
 * and the real prepared media are BRIDGE's and MEDIA's producers, and the delegate here
 * is a fixture, not a producer.
 *
 * The Studio dependency is a stub on purpose: this file never starts the pinned Studio,
 * never renders a browser and never touches real media.
 */

const REGISTRY: GatewayUiRuntimeRegistry = Object.freeze({
  format: "narralens.gateway-ui-runtime-registry@1",
  operations: Object.freeze({
    "agent.v1": Object.freeze(["context.read", "workflow.read", "review.read", "health.read"]),
    "local-assets.v1": Object.freeze(["local-source-files.read"]),
    "workbench.v1": Object.freeze(["native.reopen", "review.part.describe"]),
  }),
});

const MEDIA_BYTES = Buffer.alloc(3 * 1024 * 1024, 0x37);
const MEDIA_SHA = createHash("sha256").update(MEDIA_BYTES).digest("hex");

interface Recorder {
  readonly calls: NativeStudioUiInvokeInput[];
  readonly opens: string[];
  readonly reads: number[];
  closes: number;
}

interface Harness {
  readonly origin: string;
  readonly recorder: Recorder;
  readonly exchange: (grant: NativeStudioGrant) => Promise<{
    readonly csrf: string;
    readonly nativeCookie: string;
    readonly uiCookie: string | null;
    readonly ui: { readonly format: string; readonly csrf: string; readonly expires_at: number } | null;
  }>;
  readonly close: () => Promise<void>;
}

async function harness(options: {
  readonly registry?: GatewayUiRuntimeRegistry | null;
} = {}): Promise<Harness> {
  const recorder: Recorder = { calls: [], opens: [], reads: [], closes: 0 };
  const services: StudioHostService = {
    call: async () => ({ status: 503, body: { code: "CAPABILITY_UNAVAILABLE" } }),
    nativeWrite: async () => ({ status: 503, body: { code: "CAPABILITY_UNAVAILABLE" } }),
  };
  const studio = {
    origin: "http://127.0.0.1:9",
    filmOrigin: "http://127.0.0.1:9",
    port: 9,
    key: "fixture-key",
    close: async () => undefined,
    isAlive: () => true,
  };
  const gateway = new OpenFilmStudioGateway({
    studio,
    controlled: true,
    services,
    uiRegistry: options.registry === undefined ? REGISTRY : options.registry,
  });
  const origin = await gateway.start();

  const exchange = async (grant: NativeStudioGrant) => {
    const issued = gateway.issueNativeEntry(grant);
    const ticket = new URL(issued.url).hash.slice("#native_ticket=".length);
    const response = await fetch(`${origin}/narralens/session/exchange`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      csrf: string;
      ui?: { format: string; csrf: string; expires_at: number };
    };
    const cookies = readSetCookies(response);
    // The cookie *name* carries a random suffix; the value follows the first `=`.
    const native = cookies.find((value) => /^narralens_native_[0-9a-f]+=/.test(value));
    const uiCookie = cookies.find((value) => /^narralens_ui_[0-9a-f]+=/.test(value));
    expect(native).toBeDefined();
    return {
      csrf: body.csrf,
      nativeCookie: native!.split(";")[0]!,
      uiCookie: uiCookie === undefined ? null : uiCookie.split(";")[0]!,
      ui: body.ui ?? null,
    };
  };

  return { origin, recorder, exchange, close: async () => { await gateway.close(); expect(gateway.isListening).toBe(false); } };
}

/**
 * The fixture UI delegate.
 *
 * It records what the transport forwarded, and it opens a fixture object whose bytes are
 * a known buffer — never a path, never a file, never a real medium.
 */
function fixtureUi(recorder: Recorder, isCurrent: () => boolean = () => true): NativeStudioUiGrantV1 {
  return {
    project_id: "project_ui",
    owner_session_ref: "owner_ui",
    instance_generation: 1,
    expires_at: Date.now() + 3_600_000,
    isCurrent,
    invoke: async (input: NativeStudioUiInvokeInput) => {
      recorder.calls.push(input);
      return { status: 200, body: { ok: true, surface: input.surface, operation: input.operation } };
    },
    openReviewMedia: async ({ ref }: { readonly ref: string }) => {
      recorder.opens.push(ref);
      return {
        content_type: "video/mp4",
        bytes: MEDIA_BYTES.length,
        sha256: MEDIA_SHA,
        etag: `"${MEDIA_SHA}"`,
        read: async ({ offset, length }: { readonly offset: number; readonly length: number }) => {
          recorder.reads.push(length);
          return new Uint8Array(MEDIA_BYTES.subarray(offset, offset + length));
        },
        close: async () => { recorder.closes += 1; },
      };
    },
  };
}

/** A grant bound to the fixture project. `null` means: a native-only grant. */
function grantFor(h: Harness, ui?: NativeStudioUiGrantV1 | null): NativeStudioGrant {
  const delegate = ui === undefined ? fixtureUi(h.recorder) : ui;
  return {
    project_id: "project_ui",
    native_project_id: "native_ui",
    owner_session_ref: "owner_ui",
    instance_generation: 1,
    revision: 1,
    snapshot_id: "a".repeat(64),
    source_digest: "b".repeat(64),
    isCurrent: () => true,
    readWorkbench: async () => { throw new Error("Not part of this transport test"); },
    ...(delegate === null ? {} : { ui: delegate }),
  };
}

async function uiCall(
  h: Harness,
  session: { readonly uiCookie: string | null; readonly ui: { readonly csrf: string } | null },
  body: unknown,
  overrides: { readonly origin?: string; readonly cookie?: string | null; readonly proof?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Origin: overrides.origin ?? h.origin,
    "Content-Type": "application/json",
  };
  const cookie = overrides.cookie === undefined ? session.uiCookie : overrides.cookie;
  if (cookie !== null) headers.Cookie = cookie;
  const proof = overrides.proof === undefined ? session.ui?.csrf ?? null : overrides.proof;
  if (proof !== null) headers["X-Narralens-Workbench-CSRF"] = proof;
  return fetch(`${h.origin}/narralens/api/ui/call`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("the two workbench UI aliases", () => {
  it("adds exactly two Gateway aliases and states the exposure count", () => {
    expect(GATEWAY_UI_ALIASES.map((alias) => `${alias.method} ${alias.path}`)).toEqual([
      "POST /narralens/api/ui/call",
      "GET /narralens/api/ui/review-media/:ref",
    ]);
    expect(GATEWAY_UI_EXPOSURE_COUNTING).toBe(
      "31 frozen Host + 5 reviewed adjunct Host + 2 explicitly additional Gateway HTTP",
    );
  });
});

describe("the independent UI credential", () => {
  it("mints a separate cookie and proof for a grant that carries a UI delegate", async () => {
    const h = await harness();
    try {
      const session = await h.exchange(grantFor(h));
      expect(session.ui).not.toBeNull();
      expect(session.ui!.format).toBe("narralens.gateway-ui-session@1");
      expect(session.ui!.csrf).not.toBe(session.csrf);
      expect(session.uiCookie).not.toBe(session.nativeCookie);
      expect(session.uiCookie).toMatch(/^narralens_ui_[0-9a-f]+=/);
    } finally { await h.close(); }
  });

  it("gives a native-only grant no UI credential at all", async () => {
    const h = await harness();
    try {
      const session = await h.exchange(grantFor(h, null));
      expect(session.ui).toBeNull();
      expect(session.uiCookie).toBeNull();
      // The native proof cannot stand in for the UI one.
      const response = await uiCall(h, session, { surface: "agent.v1", operation: "workflow.read", input: {} },
        { cookie: session.nativeCookie, proof: session.csrf });
      expect(response.status).toBe(401);
    } finally { await h.close(); }
  });

  it("refuses the native cookie with the UI proof, and the UI cookie with the native proof", async () => {
    const h = await harness();
    try {
      const session = await h.exchange(grantFor(h));
      const body = { surface: "agent.v1", operation: "workflow.read", input: {} };
      expect((await uiCall(h, session, body, { cookie: session.nativeCookie })).status).toBe(401);
      expect((await uiCall(h, session, body, { proof: session.csrf })).status).toBe(401);
    } finally { await h.close(); }
  });

  it("refuses a duplicated UI proof header", async () => {
    const h = await harness();
    try {
      const session = await h.exchange(grantFor(h));
      // `fetch` folds a repeated header into one value, so the duplicate is sent over a
      // raw client: the Gateway has to see two header lines, not one joined value.
      const answer = await rawPost(h.origin, "/narralens/api/ui/call", [
        `Origin: ${h.origin}`,
        "Content-Type: application/json",
        `Cookie: ${session.uiCookie!}`,
        `X-Narralens-Workbench-CSRF: ${session.ui!.csrf}`,
        `X-Narralens-Workbench-CSRF: ${session.ui!.csrf}`,
      ], JSON.stringify({ surface: "agent.v1", operation: "workflow.read", input: {} }));
      expect(answer.status).toBe(403);
      expect(h.recorder.calls).toHaveLength(0);
    } finally { await h.close(); }
  });

  it("refuses another origin before it reaches the Host", async () => {
    const h = await harness();
    try {
      const session = await h.exchange(grantFor(h));
      const response = await uiCall(h, session,
        { surface: "agent.v1", operation: "workflow.read", input: {} },
        { origin: "http://127.0.0.1:1" });
      expect(response.status).toBe(403);
      expect(h.recorder.calls).toHaveLength(0);
    } finally { await h.close(); }
  });

  it("mints nothing when the UI delegate is already revoked", async () => {
    const h = await harness();
    try {
      // The native grant is live, so the exchange happens — but the UI delegate is not,
      // so no UI credential is minted: a native-only entry, honestly reported.
      const session = await h.exchange(grantFor(h, fixtureUi(h.recorder, () => false)));
      expect(session.ui).toBeNull();
      expect(session.uiCookie).toBeNull();
      const response = await uiCall(h, session,
        { surface: "agent.v1", operation: "workflow.read", input: {} },
        { cookie: session.nativeCookie, proof: session.csrf });
      expect(response.status).toBe(401);
    } finally { await h.close(); }
  });

  it("keeps a live UI delegate when the native session has gone stale", async () => {
    let nativeLive = true;
    const h = await harness();
    try {
      const session = await h.exchange({ ...grantFor(h), isCurrent: () => nativeLive });
      // The native view went stale — the editor is still showing the old revision.
      nativeLive = false;
      const response = await uiCall(h, session,
        { surface: "agent.v1", operation: "context.read", input: { project_id: "project_ui" } });
      expect(response.status).toBe(200);
      expect(h.recorder.calls).toHaveLength(1);
    } finally { await h.close(); }
  });

  it("stops the UI delegate when its own parent is revoked", async () => {
    const state = { live: true };
    const h = await harness();
    try {
      const session = await h.exchange(grantFor(h, fixtureUi(h.recorder, () => state.live)));
      state.live = false;
      const response = await uiCall(h, session,
        { surface: "agent.v1", operation: "context.read", input: {} });
      expect(response.status).toBe(409);
      expect(h.recorder.calls).toHaveLength(0);
    } finally { await h.close(); }
  });
});

describe("the closed UI call", () => {
  it("passes the Host's own status and body through", async () => {
    const h = await harness();
    try {
      const session = await h.exchange(grantFor(h));
      const response = await uiCall(h, session,
        { surface: "agent.v1", operation: "workflow.read", input: { project_id: "project_ui" } });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, surface: "agent.v1", operation: "workflow.read" });
    } finally { await h.close(); }
  });

  it("rejects an envelope that is not exactly surface, operation and input", async () => {
    const h = await harness();
    try {
      const session = await h.exchange(grantFor(h));
      const missing = await uiCall(h, session, { surface: "agent.v1", operation: "workflow.read" });
      expect(missing.status).toBe(400);
      const extra = await uiCall(h, session,
        { surface: "agent.v1", operation: "workflow.read", input: {}, actor: "someone" });
      expect(extra.status).toBe(400);
      expect(h.recorder.calls).toHaveLength(0);
    } finally { await h.close(); }
  });

  it("refuses an unknown surface or an unknown operation", async () => {
    const h = await harness();
    try {
      const session = await h.exchange(grantFor(h));
      expect((await uiCall(h, session, { surface: "nope.v1", operation: "workflow.read", input: {} })).status).toBe(400);
      expect((await uiCall(h, session, { surface: "agent.v1", operation: "nope.read", input: {} })).status).toBe(400);
      // A combination that the closed registry does not list is refused as well.
      expect((await uiCall(h, session, { surface: "local-assets.v1", operation: "workflow.read", input: {} })).status).toBe(400);
      expect(h.recorder.calls).toHaveLength(0);
    } finally { await h.close(); }
  });

  it("refuses a body that names another project, before the Host sees it", async () => {
    const h = await harness();
    try {
      const session = await h.exchange(grantFor(h));
      const response = await uiCall(h, session,
        { surface: "agent.v1", operation: "context.read", input: { project_id: "another_project" } });
      expect(response.status).toBe(403);
      expect(h.recorder.calls).toHaveLength(0);
    } finally { await h.close(); }
  });

  it("answers 503 when the runtime registry is absent, and calls nothing", async () => {
    const h = await harness({ registry: null });
    try {
      const session = await h.exchange(grantFor(h));
      const response = await uiCall(h, session,
        { surface: "agent.v1", operation: "workflow.read", input: {} });
      expect(response.status).toBe(503);
      expect(h.recorder.calls).toHaveLength(0);
    } finally { await h.close(); }
  });

  it("hands native.reopen an exactly empty input", async () => {
    const h = await harness();
    try {
      const session = await h.exchange(grantFor(h));
      const response = await uiCall(h, session,
        { surface: "workbench.v1", operation: "native.reopen", input: {} });
      expect(response.status).toBe(200);
      expect(h.recorder.calls[0]!.surface).toBe("workbench.v1");
      expect(h.recorder.calls[0]!.operation).toBe("native.reopen");
      expect(h.recorder.calls[0]!.input).toEqual({});
    } finally { await h.close(); }
  });

  it("hands review.part.describe its exact input, unchanged", async () => {
    const h = await harness();
    try {
      const session = await h.exchange(grantFor(h));
      const input = {
        run_id: "run-1",
        package_id: "package-1",
        package_version: 2,
        part_kind: "preview",
        artifact_ref: { id: "artifact-1", version: 1, sha256: "c".repeat(64) },
      };
      const response = await uiCall(h, session,
        { surface: "workbench.v1", operation: "review.part.describe", input });
      expect(response.status).toBe(200);
      expect(h.recorder.calls[0]!.input).toEqual(input);
    } finally { await h.close(); }
  });
});

describe("the review media alias", () => {
  it("serves the bytes with the object's own ETag and closes the reader once", async () => {
    const h = await harness();
    try {
      const session = await h.exchange(grantFor(h));
      const response = await fetch(`${h.origin}/narralens/api/ui/review-media/ref_1`, {
        headers: { Origin: h.origin, Cookie: session.uiCookie!, "X-Narralens-Workbench-CSRF": session.ui!.csrf },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBe(`"${MEDIA_SHA}"`);
      expect(response.headers.get("content-length")).toBe(String(MEDIA_BYTES.length));
      const body = Buffer.from(await response.arrayBuffer());
      expect(createHash("sha256").update(body).digest("hex")).toBe(MEDIA_SHA);
      expect(h.recorder.reads.every((length) => length <= 1024 * 1024)).toBe(true);
      expect(h.recorder.closes).toBe(1);
    } finally { await h.close(); }
  });

  it("serves a range larger than one read, in bounded reads", async () => {
    const h = await harness();
    try {
      const session = await h.exchange(grantFor(h));
      const response = await fetch(`${h.origin}/narralens/api/ui/review-media/ref_1`, {
        headers: {
          Origin: h.origin,
          Cookie: session.uiCookie!,
          "X-Narralens-Workbench-CSRF": session.ui!.csrf,
          Range: "bytes=0-2097151",
        },
      });
      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe(`bytes 0-2097151/${MEDIA_BYTES.length}`);
      expect(response.headers.get("content-length")).toBe("2097152");
      const body = Buffer.from(await response.arrayBuffer());
      expect(body.length).toBe(2097152);
      expect(h.recorder.reads).toEqual([1024 * 1024, 1024 * 1024]);
      expect(h.recorder.closes).toBe(1);
    } finally { await h.close(); }
  });

  it("refuses a range it cannot satisfy", async () => {
    const h = await harness();
    try {
      const session = await h.exchange(grantFor(h));
      const response = await fetch(`${h.origin}/narralens/api/ui/review-media/ref_1`, {
        headers: {
          Origin: h.origin,
          Cookie: session.uiCookie!,
          "X-Narralens-Workbench-CSRF": session.ui!.csrf,
          Range: "bytes=99999999-",
        },
      });
      expect(response.status).toBe(416);
      expect(h.recorder.closes).toBe(1);
    } finally { await h.close(); }
  });

  it("refuses the media alias without the independent UI credential", async () => {
    const h = await harness();
    try {
      const session = await h.exchange(grantFor(h));
      const response = await fetch(`${h.origin}/narralens/api/ui/review-media/ref_1`, {
        headers: { Origin: h.origin, Cookie: session.nativeCookie, "X-Narralens-Native-CSRF": session.csrf },
      });
      expect(response.status).toBe(401);
      expect(h.recorder.opens).toHaveLength(0);
    } finally { await h.close(); }
  });

  it("closes the reader exactly once when the parent is revoked while it is opening", async () => {
    const state = { live: true };
    const h = await harness();
    try {
      const ui: NativeStudioUiGrantV1 = {
        project_id: "project_ui",
        owner_session_ref: "owner_ui",
        instance_generation: 1,
        expires_at: Date.now() + 3_600_000,
        isCurrent: () => state.live,
        invoke: async () => ({ status: 200, body: {} }),
        openReviewMedia: async () => {
          // The parent is revoked while the object is being opened.
          state.live = false;
          return {
            content_type: "video/mp4",
            bytes: MEDIA_BYTES.length,
            sha256: MEDIA_SHA,
            etag: `"${MEDIA_SHA}"`,
            read: async () => new Uint8Array(),
            close: async () => { h.recorder.closes += 1; },
          };
        },
      };
      const session = await h.exchange(grantFor(h, ui));
      const response = await fetch(`${h.origin}/narralens/api/ui/review-media/ref_1`, {
        headers: { Origin: h.origin, Cookie: session.uiCookie!, "X-Narralens-Workbench-CSRF": session.ui!.csrf },
      });
      expect(response.status).toBe(409);
      // The reader the caller never received was closed all the same, and only once.
      expect(h.recorder.closes).toBe(1);
    } finally { await h.close(); }
  });
});

/** Every `Set-Cookie` the answer carried, however the client exposes them. */
function readSetCookies(response: Response): string[] {
  const withGetter = response.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === "function") return withGetter.getSetCookie();
  const raw = response.headers.get("set-cookie");
  return raw === null ? [] : [raw];
}

/**
 * One POST over a raw socket.
 *
 * `fetch` folds a repeated header into a single joined value, and the HTTP client
 * replaces a repeated header name; the duplicate the Gateway must refuse needs two real
 * header lines, so the request is written on the wire.
 */
async function rawPost(
  origin: string,
  path: string,
  headerLines: readonly string[],
  body: string,
): Promise<{ readonly status: number; readonly body: string }> {
  const url = new URL(origin);
  const socket = await new Promise<Socket>((resolve, reject) => {
    const connection = connect({ host: url.hostname, port: Number(url.port) }, () => resolve(connection));
    connection.on("error", reject);
  });
  try {
    const request = [
      `POST ${path} HTTP/1.1`,
      `Host: ${url.host}`,
      ...headerLines,
      `Content-Length: ${Buffer.byteLength(body)}`,
      "Connection: close",
      "",
      body,
    ].join("\r\n");
    socket.write(request);
    const chunks: Buffer[] = [];
    for await (const chunk of socket) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    const separator = text.indexOf("\r\n\r\n");
    return {
      status: Number(/^HTTP\/1\.1 (\d{3})/u.exec(text)?.[1] ?? 0),
      body: separator === -1 ? "" : text.slice(separator + 4),
    };
  } finally {
    socket.destroy();
  }
}


function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function mediaHeaders(h: Harness, session: Awaited<ReturnType<Harness["exchange"]>>) {
  return { Origin: h.origin, Cookie: session.uiCookie!, "X-Narralens-Workbench-CSRF": session.ui!.csrf };
}

describe("MAIN transport lifecycle regressions", () => {
  it("rechecks UI revocation after a pending read before sending any bytes", async () => {
    const h = await harness();
    let live = true;
    const ui = fixtureUi(h.recorder, () => live);
    const closed = deferred<void>();
    try {
      const session = await h.exchange(grantFor(h, { ...ui, openReviewMedia: async () => ({
        content_type: "video/mp4", bytes: MEDIA_BYTES.length, sha256: MEDIA_SHA, etag: `"${MEDIA_SHA}"`,
        read: async ({ offset, length }) => {
          h.recorder.reads.push(length);
          await Promise.resolve();
          live = false;
          return MEDIA_BYTES.subarray(offset, offset + length);
        },
        close: async () => { h.recorder.closes++; closed.resolve(); },
      }) }));
      const response = await fetch(`${h.origin}/narralens/api/ui/review-media/ref_1`, { headers: mediaHeaders(h, session) });
      expect(response.status).toBe(409);
      await closed.promise;
      expect(h.recorder.reads).toHaveLength(1);
      expect(h.recorder.closes).toBe(1);
    } finally { await h.close(); }
  });

  it("cuts an already-started response on later revocation instead of completing it", async () => {
    const h = await harness();
    let live = true;
    const ui = fixtureUi(h.recorder, () => live);
    const secondRead = deferred<void>(), release = deferred<void>(), closed = deferred<void>();
    try {
      const session = await h.exchange(grantFor(h, { ...ui, openReviewMedia: async () => ({
        content_type: "video/mp4", bytes: MEDIA_BYTES.length, sha256: MEDIA_SHA, etag: `"${MEDIA_SHA}"`,
        read: async ({ offset, length }) => {
          h.recorder.reads.push(length);
          if (offset > 0) { secondRead.resolve(); await release.promise; live = false; }
          return MEDIA_BYTES.subarray(offset, offset + length);
        },
        close: async () => { h.recorder.closes++; closed.resolve(); },
      }) }));
      const responsePromise = fetch(`${h.origin}/narralens/api/ui/review-media/ref_1`, { headers: mediaHeaders(h, session) });
      await secondRead.promise;
      const response = await responsePromise;
      expect(response.status).toBe(200);
      const body = response.arrayBuffer();
      const rejected = expect(body).rejects.toThrow();
      release.resolve();
      await rejected;
      await closed.promise;
      expect(h.recorder.reads).toHaveLength(2);
      expect(h.recorder.closes).toBe(1);
    } finally { release.resolve(); await h.close(); }
  });

  it("forwards cancellation and closes a reader whose open finishes after disconnect", async () => {
    const h = await harness(), opened = deferred<void>(), release = deferred<void>(), closed = deferred<void>();
    const client = new AbortController();
    let hostSignal: AbortSignal | undefined;
    const ui = fixtureUi(h.recorder);
    try {
      const session = await h.exchange(grantFor(h, { ...ui, openReviewMedia: async ({ signal }) => {
        hostSignal = signal; opened.resolve(); await release.promise;
        return {
          content_type: "video/mp4", bytes: MEDIA_BYTES.length, sha256: MEDIA_SHA, etag: `"${MEDIA_SHA}"`,
          read: async () => { throw new Error("late reader must not be read"); },
          close: async () => { h.recorder.closes++; closed.resolve(); },
        };
      } }));
      const pending = fetch(`${h.origin}/narralens/api/ui/review-media/ref_1`, { headers: mediaHeaders(h, session), signal: client.signal });
      const rejected = expect(pending).rejects.toThrow();
      await opened.promise;
      expect(hostSignal).toBeDefined();
      const cancelled = new Promise<void>((done) => { hostSignal!.addEventListener("abort", () => done(), { once: true }); });
      client.abort(); await rejected; await cancelled;
      expect(hostSignal!.aborted).toBe(true);
      release.resolve(); await closed.promise;
      expect(h.recorder.closes).toBe(1);
    } finally { release.resolve(); await h.close(); }
  });

  it("closes on disconnect while a read is still pending, without waiting for that read", async () => {
    const h = await harness(), reading = deferred<void>(), release = deferred<void>(), closed = deferred<void>();
    const client = new AbortController();
    const ui = fixtureUi(h.recorder);
    try {
      const session = await h.exchange(grantFor(h, { ...ui, openReviewMedia: async () => ({
        content_type: "video/mp4", bytes: MEDIA_BYTES.length, sha256: MEDIA_SHA, etag: `"${MEDIA_SHA}"`,
        read: async ({ offset, length }) => { reading.resolve(); await release.promise; return MEDIA_BYTES.subarray(offset, offset + length); },
        close: async () => { h.recorder.closes++; closed.resolve(); },
      }) }));
      const pending = fetch(`${h.origin}/narralens/api/ui/review-media/ref_1`, { headers: mediaHeaders(h, session), signal: client.signal });
      const rejected = expect(pending).rejects.toThrow();
      await reading.promise; client.abort(); await rejected;
      await closed.promise;
      expect(h.recorder.closes).toBe(1);
      release.resolve();
    } finally { release.resolve(); await h.close(); }
  });

  it("shutdown cancels a pending reader and actually closes both Gateway listeners", async () => {
    const h = await harness(), reading = deferred<void>(), release = deferred<void>(), closed = deferred<void>();
    const ui = fixtureUi(h.recorder);
    try {
      const session = await h.exchange(grantFor(h, { ...ui, openReviewMedia: async () => ({
        content_type: "video/mp4", bytes: MEDIA_BYTES.length, sha256: MEDIA_SHA, etag: `"${MEDIA_SHA}"`,
        read: async ({ offset, length }) => { reading.resolve(); await release.promise; return MEDIA_BYTES.subarray(offset, offset + length); },
        close: async () => { h.recorder.closes++; closed.resolve(); },
      }) }));
      const pending = fetch(`${h.origin}/narralens/api/ui/review-media/ref_1`, { headers: mediaHeaders(h, session) });
      // The request may receive the final 503 before socket shutdown, or be disconnected.
      const outcome = pending.then(response => response.status, () => 0);
      await reading.promise; await h.close(); await closed.promise;
      expect([0, 503]).toContain(await outcome);
      expect(h.recorder.closes).toBe(1);
      const endpoint = new URL(h.origin);
      await new Promise<void>((done, fail) => {
        const probe = connect({ host: endpoint.hostname, port: Number(endpoint.port) });
        probe.once("connect", () => { probe.destroy(); fail(new Error("closed Gateway is still accepting connections")); });
        probe.once("error", error => { expect((error as NodeJS.ErrnoException).code).toBe("ECONNREFUSED"); done(); });
      });
    } finally { release.resolve(); await h.close(); }
  });

  it("HEAD returns metadata without reading and releases the opened handle", async () => {
    const h = await harness();
    try {
      const session = await h.exchange(grantFor(h));
      const response = await fetch(`${h.origin}/narralens/api/ui/review-media/ref_1`, {
        method: "HEAD", headers: { ...mediaHeaders(h, session), Range: "bytes=-17" },
      });
      expect(response.status).toBe(206);
      expect(response.headers.get("content-length")).toBe("17");
      expect(h.recorder.reads).toEqual([]);
      expect(h.recorder.closes).toBe(1);
    } finally { await h.close(); }
  });

  it("delivers the first chunk before reading an entire virtual video and stops on disconnect", async () => {
    const h = await harness(), closed = deferred<void>();
    const totalChunks = 64, chunk = Buffer.alloc(1024 * 1024, 0x47);
    const ui = fixtureUi(h.recorder);
    let socket: Socket | undefined;
    try {
      const session = await h.exchange(grantFor(h, { ...ui, openReviewMedia: async () => ({
        content_type: "video/mp4", bytes: totalChunks * chunk.length, sha256: MEDIA_SHA, etag: `"${MEDIA_SHA}"`,
        // Virtual diagnostic object: tests transport flow only, not content-integrity proof.
        read: async ({ length }) => { h.recorder.reads.push(length); return chunk.subarray(0, length); },
        close: async () => { h.recorder.closes++; closed.resolve(); },
      }) }));
      const endpoint = new URL(h.origin);
      socket = connect({ host: endpoint.hostname, port: Number(endpoint.port) });
      const first = new Promise<Buffer>((done, fail) => { socket!.once("data", done); socket!.once("error", fail); });
      socket.write([
        "GET /narralens/api/ui/review-media/ref_1 HTTP/1.1", `Host: ${endpoint.host}`,
        `Origin: ${h.origin}`, `Cookie: ${session.uiCookie!}`, `X-Narralens-Workbench-CSRF: ${session.ui!.csrf}`,
        "Connection: close", "", "",
      ].join("\r\n"));
      const bytes = await first;
      expect(bytes.toString("utf8")).toContain("HTTP/1.1 200");
      expect(h.recorder.reads.length).toBeLessThan(totalChunks);
      socket.destroy(); await closed.promise;
      const readsAtClose = h.recorder.reads.length;
      await Promise.resolve();
      expect(h.recorder.reads.length).toBe(readsAtClose);
      expect(h.recorder.closes).toBe(1);
    } finally { socket?.destroy(); await h.close(); }
  });
});
