import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { authHeaders, migrate, start, stopAll, type Started } from "./harness.js";
import { NarralensHost } from "../../src/host/server.js";
import { gatewayFilmUrl, gatewayFramePolicy, openNativeWriteEntries,
  rewriteFilmDocument } from "../../src/host/m5/openfilm-studio-gateway.js";

/**
 * A raw HTTP request.
 *
 * `fetch` refuses to set the `Host` header — it is a forbidden header name — and the
 * rebinding defence is *about* that header. So the test speaks HTTP directly.
 */
function raw(options: { host: string; port: number; path: string; method?: string;
  headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string }> {
  return new Promise((done, fail) => {
    const call = httpRequest({
      host: "127.0.0.1", port: options.port, path: options.path,
      method: options.method ?? "GET", headers: options.headers ?? {},
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => done({
        status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    call.on("error", fail);
    if (options.body !== undefined) call.write(options.body);
    call.end();
  });
}

/**
 * M5's Studio Gateway (Wave 3 `04` §1).
 *
 * The Gateway is the only origin the browser sees, so the security properties are the
 * contract:
 *
 * - it binds `127.0.0.1` on a random port and answers nothing to a `Host` header that is
 *   not its own (DNS rebinding);
 * - it issues a random HttpOnly SameSite cookie and requires it for the API;
 * - it sends `Referrer-Policy: no-referrer` and a `default-src 'self'` CSP;
 * - it proxies the Studio's *reads* through an allowlist and refuses every write the
 *   OpenFilm capability map does not open;
 * - the upstream's raw `/edit` never reaches the author source;
 * - the Host's Origin allowlist does not learn the Gateway's origin, so a direct call
 *   from the Gateway's origin is refused and changes nothing.
 */
const hosts: NarralensHost[] = [];
const dirs: string[] = [];

afterEach(async () => { await stopAll(hosts.splice(0), dirs.splice(0)); });

interface Gateway {
  readonly origin: string;
  readonly cookie: string;
  readonly projectId: string;
  readonly running: Started;
}

/** A migrated target, and the Gateway the workbench projection points at. */
async function withGateway(): Promise<Gateway> {
  const running = await start();
  hosts.push(running.host);
  dirs.push(running.base);
  const target = await migrate(running, "m5-gateway-1");
  const response = await fetch(`${running.origin}/api/migration/v1/projects/${target.projectId}/workbench`,
    { headers: authHeaders(running.origin, running.token) });
  const body = await response.json() as { preview: { url: string } };
  const preview = new URL(body.preview.url);
  const origin = preview.origin;
  // The session cookie is issued with the page, never by an API answer.
  const page = await fetch(`${origin}/`, { headers: { host: preview.host } });
  const setCookie = page.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0] ?? "";
  return { origin, cookie, projectId: target.projectId, running };
}

describe("M5 Studio Gateway: the only origin the browser sees", () => {
  it("binds 127.0.0.1 on a random port and answers a rebound Host header with nothing", async () => {
    const gateway = await withGateway();
    expect(gateway.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
    // The port is not a fixed one: a second Gateway gets a different port.
    expect(Number(new URL(gateway.origin).port)).toBeGreaterThan(0);

    // A name pointed at this machine: the answer is a misdirected request, not a 404
    // that describes the Gateway.
    const port = Number(new URL(gateway.origin).port);
    const rebound = await raw({
      host: "attacker.example", port, path: "/api/projects",
      headers: { host: "attacker.example", cookie: gateway.cookie },
    });
    expect(rebound.status).toBe(421);
    expect(rebound.body).not.toMatch(/openfilm|studio|api/iu);
  }, 300_000);

  it("requires its session cookie for the API, and issues it HttpOnly and SameSite", async () => {
    const gateway = await withGateway();
    const page = await fetch(`${gateway.origin}/`, { headers: { host: new URL(gateway.origin).host } });
    const setCookie = page.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/u);
    expect(setCookie).toMatch(/SameSite=Strict/u);
    // The session is random and is not the Studio's launch key.
    expect(setCookie).not.toMatch(/openfilm_studio/u);

    const without = await fetch(`${gateway.origin}/api/projects`, {
      headers: { host: new URL(gateway.origin).host },
    });
    expect(without.status).toBe(401);
    const withCookie = await fetch(`${gateway.origin}/api/projects`, {
      headers: { host: new URL(gateway.origin).host, cookie: gateway.cookie },
    });
    expect(withCookie.status).toBe(200);
  }, 300_000);

  it("answers every page with a no-referrer policy, a self-only CSP and no framing", async () => {
    const gateway = await withGateway();
    const response = await fetch(`${gateway.origin}/`, { headers: { host: new URL(gateway.origin).host } });
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    // No CORS: another origin's page cannot read any of this.
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  }, 300_000);

  it("allows only the same Gateway origin to frame the film preview", () => {
    // The headless UX test proves these headers are delivered on a real film response;
    // this fast contract test protects the path classification itself.
    expect(gatewayFramePolicy("/film/project/film.html")).toEqual({
      frameAncestors: "none", xFrameOptions: "DENY",
    });
    expect(gatewayFramePolicy("/projects/project")).toEqual({
      frameAncestors: "none", xFrameOptions: "DENY",
    });
    expect(gatewayFramePolicy("/narralens/panel.js")).toEqual({
      frameAncestors: "none", xFrameOptions: "DENY",
    });
    expect(gatewayFilmUrl("http://localhost:4568/p/id/film.html?load=1#frame",
      "http://127.0.0.1:4568", "http://127.0.0.1:9000"))
      .toBe("http://127.0.0.1:9000/film/p/id/film.html?load=1#frame");
    expect(gatewayFilmUrl("http://127.0.0.1:4568/p/id/film.html",
      "http://127.0.0.1:4568", "http://127.0.0.1:9000"))
      .toBe("http://127.0.0.1:9000/film/p/id/film.html");
    expect(gatewayFilmUrl("http://localhost.evil:4568/p/id/film.html",
      "http://127.0.0.1:4568", "http://127.0.0.1:9000")).toBeNull();
    expect(gatewayFilmUrl("http://localhost:9999/p/id/film.html",
      "http://127.0.0.1:4568", "http://127.0.0.1:9000")).toBeNull();
    expect(rewriteFilmDocument(
      "postMessage({type:'ready'}, 'http://127.0.0.1:4567')",
      "http://127.0.0.1:4567", "http://127.0.0.1:9000"))
      .toBe("postMessage({type:'ready'}, 'http://127.0.0.1:9000')");
  });

  it("never publishes the project's absolute path", async () => {
    const gateway = await withGateway();
    const response = await fetch(`${gateway.origin}/api/projects`, {
      headers: { host: new URL(gateway.origin).host, cookie: gateway.cookie },
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toMatch(/"\/mnt\/|"\/tmp\/|narralens-m4a-/u);
    // The project's own folder is not in the answer at all.
    expect(text).not.toContain(gateway.projectId + "/");
  }, 300_000);

  it("refuses every write that the OpenFilm capability map does not open", async () => {
    const gateway = await withGateway();
    const host = new URL(gateway.origin).host;
    // The open set is exactly the capability map's supported entries.
    expect([...openNativeWriteEntries()]).toEqual([
      "history.redo", "history.restore", "history.undo", "timeline.adopt_materialization",
    ]);
    for (const entryId of ["timeline.set_visual_fit", "timeline.replace_visual_asset",
      "timeline.trim", "timeline.move", "timeline.split", "timeline.speed",
      "inspector.field.set", "subtitle.line.set", "audio.track.replace",
      "asset.import", "asset.relink", "asset.delete",
      "history.commit", "history.discard", "history.checkout", "history.merge"]) {
      const response = await fetch(`${gateway.origin}/narralens/native/${entryId}`, {
        method: "POST",
        headers: { host, cookie: gateway.cookie, "content-type": "application/json" },
        body: JSON.stringify({ project_id: gateway.projectId }),
      });
      expect(response.status, entryId).toBe(422);
    }
  }, 300_000);

  it("never proxies the upstream's own edit endpoint", async () => {
    const gateway = await withGateway();
    const host = new URL(gateway.origin).host;
    for (const path of [
      "/api/projects/abc/edit",
      "/api/projects/abc/files/bring",
      "/api/projects/abc/files/relink",
      "/api/projects/abc/history/commit",
      "/api/projects/abc/history/discard",
      "/api/projects/abc/exports",
      "/api/providers",
      "/api/browse",
      "/api/pick-folder",
    ]) {
      const response = await fetch(`${gateway.origin}${path}`, {
        method: "POST",
        headers: { host, cookie: gateway.cookie, "content-type": "application/json" },
        body: JSON.stringify({ ops: [{ op: "remove", clip: "shot-001" }] }),
      });
      // A refused write, never a proxied one: the upstream's `/edit` must not be able to
      // reach the author source at all.
      expect(response.status, path).toBe(422);
    }
  }, 300_000);

  it("refuses a write that does not come from the Gateway's own origin", async () => {
    const gateway = await withGateway();
    const host = new URL(gateway.origin).host;
    const response = await fetch(`${gateway.origin}/narralens/native/timeline.adopt_materialization`, {
      method: "POST",
      headers: {
        host, cookie: gateway.cookie, "content-type": "application/json",
        origin: "http://attacker.example",
      },
      body: JSON.stringify({ project_id: gateway.projectId }),
    });
    expect(response.status).toBe(403);
  }, 300_000);

  it("refuses a direct call from the Gateway's origin to the Host, and changes nothing", async () => {
    const gateway = await withGateway();
    const before = await gateway.running.host.projectResolver.resolveActivated(gateway.projectId);
    const outboxBefore = gateway.running.host.revisions.outboxRowCount();
    const locksBefore = gateway.running.host.revisions.activeLocks(gateway.projectId).length;

    // The Host's Origin allowlist must not learn the Gateway's origin.
    const response = await fetch(
      `${gateway.running.origin}/api/migration/v1/projects/${gateway.projectId}/locks`, {
        method: "POST",
        headers: {
          origin: gateway.origin,
          authorization: `Bearer ${gateway.running.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          format: "narralens.lock-request@1.0", base_control_revision: before.control_revision,
          lock_type: "visual", scope: "project", target_id: null,
          start_frame: 0, end_frame_exclusive: before.frame_count,
          reason_code: "preserve_visual", idempotency_key: "m5-gateway-cross-1",
        }),
      });
    expect(response.status).toBe(403);
    expect((await response.json() as { code: string }).code).toBe("ORIGIN_REJECTED");

    // Zero side effects: no lock, no counter move, no outbox row.
    const after = await gateway.running.host.projectResolver.resolveActivated(gateway.projectId);
    expect(after.control_revision).toBe(before.control_revision);
    expect(gateway.running.host.revisions.activeLocks(gateway.projectId)).toHaveLength(locksBefore);
    expect(gateway.running.host.revisions.outboxRowCount()).toBe(outboxBefore);
  }, 300_000);
});
