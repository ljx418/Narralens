import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NarralensHost } from "../../src/host/server.js";

/**
 * The Wave 2 route set, stage by stage.
 *
 * W2.0 froze all five as 404. M3.3 opened two — materialize and the materialization read.
 * M4A opens impact; M4B opens versioned edits; history restore belongs to M4C and stays
 * closed. The point of this file is the route that remains closed, not
 * the three that opened: a route that answers 501, 503 or a plausible-looking body before
 * its Gate would let a client integrate against a capability that does not exist, which is
 * the failure the frozen plan's stop rule exists to prevent.
 *
 * The still-closed list is deleted, not weakened, when M4B/M4C open them.
 */

const REPO = resolve(import.meta.dirname, "../..");

/** Opened by M3.3, with the status each must answer. */
export const OPENED_BY_M3: readonly { method: string; path: string; status: number }[] = [
  { method: "POST", path: "/api/migration/v1/projects/d1-30s/proposals/proposal_1/materialize", status: 202 },
  { method: "GET", path: "/api/migration/v1/materializations/mat_1", status: 404 },
];

/**
 * Opened by M4A.
 *
 * The status recorded here is what a *bodyless* POST gets, and 400 is the interesting answer:
 * it means the route is mounted and parsed its body, rather than being unmounted and 404ing.
 * Impact is served for an activated migrated project; `d1-30s` is still a legacy catalog
 * project, so a well-formed request for it is 404 — asserted in the test below, not here.
 */
export const OPENED_BY_M4A: readonly { method: string; path: string; status: number }[] = [
  { method: "POST", path: "/api/migration/v1/projects/d1-30s/impact", status: 400 },
];

/**
 * Still closed until M4B and M4C open them. M4A deliberately does not: an impact is an
 * authorization, and the writes it authorizes are the next module.
 *
 * **M4C opened the last one.** The list is empty, and it is *deleted* rather than
 * weakened: a route that is closed must be closed by name, and there is no Wave 2 route
 * left in this set that is.
 */
const WAVE2_ROUTES: readonly { method: string; path: string }[] = [];

const hosts: NarralensHost[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map((host) => host.close())); });

/** A running Host with a session, for the route-level checks. */
async function started(): Promise<{ host: NarralensHost; origin: string; token: string }> {
  const host = new NarralensHost();
  hosts.push(host);
  const port = await host.listen(0);
  const origin = `http://127.0.0.1:${port}`;
  const session = await fetch(`${origin}/api/session`, { headers: { origin } });
  return { host, origin, token: (await session.json() as { token: string }).token };
}

function headers(origin: string, token: string): Record<string, string> {
  return { origin, authorization: `Bearer ${token}`, "content-type": "application/json" };
}

describe("W2.0 fitness: the unopened Wave 2 routes stay closed", () => {
  it("answers 404 for every still-closed Wave 2 path, with no body that looks like a contract", async () => {
    const host = new NarralensHost();
    hosts.push(host);
    const port = await host.listen(0);
    const origin = `http://127.0.0.1:${port}`;
    const session = await fetch(`${origin}/api/session`, { headers: { origin } });
    const token = (await session.json() as { token: string }).token;

    for (const route of WAVE2_ROUTES) {
      const init: RequestInit = {
        method: route.method,
        headers: { origin, authorization: `Bearer ${token}`, "content-type": "application/json" },
      };
      if (route.method === "POST") init.body = JSON.stringify({ format: "narralens.probe@1.0" });
      const response = await fetch(`${origin}${route.path}`, init);
      expect(response.status, `${route.method} ${route.path}`).toBe(404);
      const text = await response.text();
      // A 404 that returned `{"format":"narralens.materialization@1.0"}` would be worse than
      // a 500: a client would bind to a shape the Host has not committed to.
      expect(text, route.path).not.toMatch(/narralens\.(materialization|materialize-request|impact|adopt-request|restore-request|controlled-write-response)@/u);
    }
  });

  it("keeps the Wave 1 migration routes answering, so 404 means unmounted and not broken", async () => {
    const host = new NarralensHost();
    hosts.push(host);
    const port = await host.listen(0);
    const origin = `http://127.0.0.1:${port}`;
    const session = await fetch(`${origin}/api/session`, { headers: { origin } });
    const token = (await session.json() as { token: string }).token;

    expect((await fetch(`${origin}/api/projects/d1-30s`, { headers: { origin, authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await fetch(`${origin}/api/migration/v1/projects/d1-30s/engine`, { headers: { origin, authorization: `Bearer ${token}` } })).status).toBe(200);
  });

  it("keeps the EnginePort at exactly seven methods while Wave 2 work is in progress", () => {
    const port = readFileSync(resolve(REPO, "src/host/engine/engine-port.ts"), "utf8");
    const body = port.slice(port.indexOf("export interface EnginePort"), port.indexOf("export interface EnginePort") + 6000);
    const end = body.indexOf("\n}");
    const methods = [...(end > 0 ? body.slice(0, end) : body).matchAll(/^\s{2}(inspect|capabilities|plan|stage|validate|preview|render)\s*\(/gmu)]
      .map((match) => match[1]!);
    expect(methods).toEqual(["inspect", "capabilities", "plan", "stage", "validate", "preview", "render"]);
    // A new commit-shaped method is the one change that would silently give an adapter
    // write authority, so assert the total method count rather than trusting the list.
    expect((body.slice(0, end).match(/^\s{2}\w+\s*\(/gmu) ?? []).length).toBe(7);
  });

  it("keeps the /api/migration/v1 route set at exactly the stage-approved routes", () => {
    const server = readFileSync(resolve(REPO, "src/host/server.ts"), "utf8");
    const routes = [...server.matchAll(/\^\\\/api\\\/migration\\\/v1\\\/([^$]*)\$/gu)].map((match) => match[1]!);
    expect(routes).toEqual([
      "projects\\/([A-Za-z0-9_-]+)\\/engine",
      "projects\\/([A-Za-z0-9_-]+)\\/migrate-copy",
      "projects\\/([A-Za-z0-9_-]+)\\/proposals\\/([A-Za-z0-9_-]+)\\/materialize",
      "projects\\/([A-Za-z0-9_-]+)\\/impact",
      "projects\\/([A-Za-z0-9_-]+)\\/edits",
      "projects\\/([A-Za-z0-9_-]+)\\/history",
      "projects\\/([A-Za-z0-9_-]+)\\/history\\/restore",
      "projects\\/([A-Za-z0-9_-]+)\\/history\\/undo",
      "projects\\/([A-Za-z0-9_-]+)\\/history\\/redo",
      "materializations\\/([A-Za-z0-9_-]+)",
      "migrations\\/([A-Za-z0-9_-]+)",
      "migrations\\/([A-Za-z0-9_-]+)\\/rollback",
    ]);
  });

  it("mounts the M4B edits and the M4C history routes, and refuses their inputs on merit", async () => {
    const { origin, token } = await started();
    const edits = await fetch(`${origin}/api/migration/v1/projects/d1-30s/edits`,
      { method: "POST", headers: headers(origin, token), body: "{}" });
    expect(edits.status).toBe(428);
    expect(await edits.json()).toMatchObject({ code: "IMPACT_REQUIRED" });
    // The M4C restore route answers the same way: mounted, and refusing the request on its
    // merits rather than 404ing because it is not there.
    const restore = await fetch(`${origin}/api/migration/v1/projects/d1-30s/history/restore`,
      { method: "POST", headers: headers(origin, token), body: "{}" });
    expect(restore.status).toBe(428);
    expect(await restore.json()).toMatchObject({ code: "IMPACT_REQUIRED" });
    // The history read model is a read: an unmounted route would 404, and this one answers
    // with its own contract shape.
    const history = await fetch(`${origin}/api/migration/v1/projects/d1-30s/history`,
      { method: "GET", headers: headers(origin, token) });
    expect(history.status).toBe(404);
    expect(await history.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("answers what OPENED_BY_M3 and OPENED_BY_M4A record, so those lists are assertions", async () => {
    // Both lists were exported and imported by nobody, which reads like a claim while
    // asserting nothing. Iterated here so the recorded statuses are checked rather than
    // merely written down.
    const { origin, token } = await started();
    // Only the bodyless entries can be checked this way: `OPENED_BY_M3` records 202 for a
    // *well-formed* materialize, and a POST with no body is 400 for it. So the loop covers the
    // reads and M4A's own entry, and the materialize POST is asserted where it belongs.
    const bodyless = [...OPENED_BY_M3, ...OPENED_BY_M4A]
      .filter((route) => route.method === "GET" || route.path.endsWith("/impact"));
    for (const route of bodyless) {
      const response = await fetch(`${origin}${route.path}`, {
        method: route.method, headers: headers(origin, token),
      });
      expect(response.status, `${route.method} ${route.path}`).toBe(route.status);
    }
    expect(bodyless.map((route) => route.path)).toEqual(OPENED_BY_M3.filter((r) => r.method === "GET").map((r) => r.path)
      .concat(OPENED_BY_M4A.map((r) => r.path)));
  });

  it("mounts the impact route and refuses its inputs on merit, not with 404", async () => {
    const { origin, token } = await started();
    // A route that exists answers 400 for a body it can parse and reject. A 404 here would
    // mean the route is still closed, and this gate would be passing for the wrong reason.
    for (const body of [{}, { format: "narralens.impact-request@1.0" }, { idempotency_key: "k" }]) {
      const post = await fetch(`${origin}/api/migration/v1/projects/d1-30s/impact`,
        { method: "POST", headers: headers(origin, token), body: JSON.stringify(body) });
      expect(post.status, JSON.stringify(body)).toBe(400);
      expect(await post.json()).toMatchObject({ code: "INVALID_REQUEST" });
    }
  });

  it("mounts the two M3 routes and refuses their inputs on merit, not with 404", async () => {
    const { origin, token } = await started();
    // A route that exists answers 400/422 for a bad body. A 404 here would mean the route
    // is still closed and the gate would be reporting success for the wrong reason.
    const post = await fetch(
      `${origin}/api/migration/v1/projects/d1-30s/proposals/proposal_1/materialize`,
      { method: "POST", headers: headers(origin, token), body: "{}" },
    );
    expect([400, 404]).toContain(post.status);
    expect(post.status).not.toBe(404);
    const get = await fetch(`${origin}/api/migration/v1/materializations/mat_1`,
      { method: "GET", headers: headers(origin, token) });
    expect(get.status).toBe(404);
    expect(await get.json()).toMatchObject({ code: "NOT_FOUND" });
  });
});
