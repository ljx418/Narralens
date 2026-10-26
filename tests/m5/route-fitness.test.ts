import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NarralensHost } from "../../src/host/server.js";
import { MIGRATION_ROUTE_WHITELIST, migrationRouteGate } from "../architecture/migration-route-gate.js";

/**
 * M5's route fitness extension (Wave 3 `04` §6).
 *
 * M5A is allowed exactly one change to an old gate: the `/api/migration/v1` whitelist
 * grows from twelve to sixteen, with four new routes. The gate itself must not have
 * softened — a `contains` check would pass for a server that grew a route nobody
 * approved, which is the failure the fitness rule exists to catch.
 *
 * So the gate is *mutated* here rather than merely re-read: every authorised route is
 * removed in turn, and an unauthorised route is added, and the gate has to go red each
 * time. A gate that cannot be made red is not a gate.
 */
const REPO = resolve(import.meta.dirname, "../..");
const serverPath = resolve(REPO, "src/host/server.ts");

const hosts: NarralensHost[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map((host) => host.close())); });

/** The source with the line that mounts a route removed. */
function withoutRoute(source: string, route: string): string {
  const lines = source.split("\n");
  // The whitelist already carries the escaped form the source uses.
  const index = lines.findIndex((line) => line.includes(route));
  if (index < 0) throw new Error(`THE_ROUTE_IS_NOT_IN_THE_SOURCE:${route}`);
  return [...lines.slice(0, index), ...lines.slice(index + 1)].join("\n");
}

describe("M5 route fitness: the whitelist grew by four and did not soften", () => {
  it("holds exactly the sixteen authorised routes", () => {
    const source = readFileSync(serverPath, "utf8");
    const gate = migrationRouteGate(source);
    expect(gate.missing).toEqual([]);
    expect(gate.unexpected).toEqual([]);
    expect(gate.actual).toHaveLength(16);
    expect(gate.actual).toEqual([...MIGRATION_ROUTE_WHITELIST]);
  });

  it("goes red when any one authorised route is removed", () => {
    const source = readFileSync(serverPath, "utf8");
    for (const route of MIGRATION_ROUTE_WHITELIST) {
      const mutated = withoutRoute(source, route);
      const gate = migrationRouteGate(mutated);
      expect(gate.ok, `removing ${route} must make the gate red`).toBe(false);
      expect(gate.missing, `removing ${route}`).toContain(route);
    }
  });

  it("goes red when a route nobody authorised is added", () => {
    const source = readFileSync(serverPath, "utf8");
    const unauthorised = "      match = url.pathname.match(/^\\/api\\/migration\\/v1\\/projects\\/([A-Za-z0-9_-]+)\\/unauthorised$/);\n";
    const mutated = source.replace("      let match = url.pathname.match", unauthorised + "      let match = url.pathname.match");
    expect(mutated).not.toBe(source);
    const gate = migrationRouteGate(mutated);
    expect(gate.ok).toBe(false);
    expect(gate.unexpected).toHaveLength(1);
    expect(gate.unexpected[0]).toContain("unauthorised");
    // The gate is not `contains`: the sixteen authorised routes are still there, and the
    // seventeenth still makes it red.
    expect(gate.missing).toEqual([]);
  });

  it("mounts the four M5 routes and refuses their inputs on merit, not with 404", async () => {
    const host = new NarralensHost();
    hosts.push(host);
    const port = await host.listen(0);
    const origin = `http://127.0.0.1:${port}`;
    const token = (await (await fetch(`${origin}/api/session`, { headers: { origin } })).json() as
      { token: string }).token;
    const headers = { origin, authorization: `Bearer ${token}`, "content-type": "application/json" };

    // The workbench is a read: an unmounted route would 404, and this one answers with
    // its own contract shape (a 404 with a NOT_FOUND code, because the project is not a
    // migrated target).
    const workbench = await fetch(`${origin}/api/migration/v1/projects/d1-30s/workbench`, { headers });
    expect(workbench.status).toBe(404);
    expect(await workbench.json()).toMatchObject({ code: "NOT_FOUND" });

    // The two lock routes and the replay refuse a body they can parse and reject.
    for (const path of ["/locks", "/comparisons/replay"]) {
      const post = await fetch(`${origin}/api/migration/v1/projects/d1-30s${path}`, {
        method: "POST", headers, body: "{}",
      });
      expect(post.status, path).toBe(400);
      expect(await post.json(), path).toMatchObject({ code: "INVALID_REQUEST" });
    }
    const release = await fetch(`${origin}/api/migration/v1/projects/d1-30s/locks/lock_1`, {
      method: "DELETE", headers,
    });
    expect(release.status).toBe(400);
    expect(await release.json()).toMatchObject({ code: "INVALID_REQUEST" });
  }, 300_000);
});
