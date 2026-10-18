import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NarralensHost } from "../../src/host/server.js";

/**
 * W2.0 exit gate: the five Wave 2 routes stay 404 until their own module Gate passes.
 *
 * The frozen plan says "所有新路由仍 404" for W2.0. A 404 is not a formality here: a route
 * that answers 501, 503 or a JSON error body with a plausible shape would let a client
 * integrate against a capability that does not exist yet, and the plan's stop rule is that
 * no capability opens before its evidence exists.
 *
 * When M3/M4 lands, this file is *deleted*, not weakened — the same way the M1A gate was.
 */

const REPO = resolve(import.meta.dirname, "../..");

const WAVE2_ROUTES = [
  { method: "POST", path: "/api/migration/v1/projects/d1-30s/proposals/proposal_1/materialize" },
  { method: "GET", path: "/api/migration/v1/materializations/mat_1" },
  { method: "POST", path: "/api/migration/v1/projects/d1-30s/impact" },
  { method: "POST", path: "/api/migration/v1/projects/d1-30s/edits" },
  { method: "POST", path: "/api/migration/v1/projects/d1-30s/history/restore" },
] as const;

const hosts: NarralensHost[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map((host) => host.close())); });

describe("W2.0 fitness: no Wave 2 route exists yet", () => {
  it("answers 404 for every Wave 2 path, with no body that looks like a contract", async () => {
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

  it("keeps the /api/migration/v1 route set at exactly the four Wave 1 routes", () => {
    const server = readFileSync(resolve(REPO, "src/host/server.ts"), "utf8");
    const routes = [...server.matchAll(/\^\\\/api\\\/migration\\\/v1\\\/([^$]*)\$/gu)].map((match) => match[1]!);
    expect(routes).toEqual([
      "projects\\/([A-Za-z0-9_-]+)\\/engine",
      "projects\\/([A-Za-z0-9_-]+)\\/migrate-copy",
      "migrations\\/([A-Za-z0-9_-]+)",
      "migrations\\/([A-Za-z0-9_-]+)\\/rollback",
    ]);
  });
});
