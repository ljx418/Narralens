import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NarralensHost } from "../../src/host/server.js";
import { contractIds, validateEngineResponse } from "../../src/contracts/validator.js";
import type { EngineResponse } from "../../src/contracts/engine-types.js";

/** Route activation table for M2.1: only the read-only engine surface opens. */

const hosts: NarralensHost[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map(async (host) => { await host.close(); })); });

async function started(): Promise<{ host: NarralensHost; origin: string; token: string; call: (path: string, init?: RequestInit) => Promise<Response> }> {
  const host = new NarralensHost();
  hosts.push(host);
  const port = await host.listen(0);
  const origin = `http://127.0.0.1:${port}`;
  const token = (await (await fetch(`${origin}/api/session`, { headers: { origin } })).json() as { token: string }).token;
  const call = async (path: string, init: RequestInit = {}): Promise<Response> =>
    await fetch(`${origin}${path}`, { ...init, headers: { origin, authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  return { host, origin, token, call };
}

describe("M2.1 route activation", () => {
  it("EN-01 opens GET /api/migration/v1/projects/:id/engine as a read-only projection", async () => {
    const { call } = await started();
    const response = await call("/api/migration/v1/projects/d1-30s/engine");
    expect(response.status).toBe(200);
    const body = await response.json() as unknown;
    const validated = validateEngineResponse(body);
    expect(validated.ok, JSON.stringify(body)).toBe(true);
    if (!validated.ok) return;
    expect(validated.value.binding).toMatchObject({ project_id: "d1-30s", engine: "hypit",
      engine_upstream_sha: "6fdd8c0f02c17b9970aee6deb4550a70e9d57acf", binding_version: 1 });
    expect(validated.value.projection.fps).toEqual({ num: 30, den: 1 });
    expect(validated.value.projection.frame_count).toBe(900);
    expect(validated.value.projection.clips.map((clip) => clip.clip_id)).toEqual(["shot-001", "shot-002", "shot-003"]);
    expect(validated.value.projection.clips.map((clip) => clip.frame_range)).toEqual([
      { start_frame: 0, end_frame_exclusive: 300 },
      { start_frame: 300, end_frame_exclusive: 600 },
      { start_frame: 600, end_frame_exclusive: 900 },
    ]);
    expect(validated.value.projection.source_digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(validated.value.projection.problems).toEqual([]);
    // Read-only: no filesystem path and no write handle is exposed.
    expect(JSON.stringify(validated.value)).not.toContain("project_path");
    expect(JSON.stringify(validated.value)).not.toContain("/mnt/");
  }, 30_000);

  it("requires the same-origin session like every other route", async () => {
    const { origin } = await started();
    expect((await fetch(`${origin}/api/migration/v1/projects/d1-30s/engine`, { headers: { origin } })).status).toBe(401);
    expect((await fetch(`${origin}/api/migration/v1/projects/d1-30s/engine`, { headers: { origin: "http://localhost:1" } })).status).toBe(403);
  });

  it("returns 404 for a project with no engine binding rather than guessing one", async () => {
    const { call } = await started();
    const response = await call("/api/migration/v1/projects/unknown-project/engine");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("mounts the M4C history restore while impact and controlled adoption are mounted", async () => {
    const { call } = await started();
    // **M4C opened the history routes.** A bodyless restore is refused on its merits — it
    // needs an impact and an approval — so the answer is 428, not the 404 a closed route
    // would give. The order matters: the authorization is checked before the project is
    // looked up, so a client cannot use the answer to probe which projects exist.
    const history = await call("/api/migration/v1/projects/d1-30s/history/restore",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(history.status).toBe(428);
    expect(await history.json()).toMatchObject({ code: "IMPACT_REQUIRED" });
    // M4B mounts controlled adoption, and rejects missing authorization before project lookup.
    const adopt = await call("/api/migration/v1/projects/d1-30s/edits",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(adopt.status).toBe(428);
    expect(await adopt.json()).toMatchObject({ code: "IMPACT_REQUIRED" });
    // M4A mounted impact, so a malformed body is a 400 about the body — not a 404 for a route
    // that does not exist. A 404 here would mean the gate was reporting the wrong thing.
    const impact = await call("/api/migration/v1/projects/d1-30s/impact",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(impact.status).toBe(400);
    expect(await impact.json()).toMatchObject({ code: "INVALID_REQUEST" });
    // And the paths that were never real stay 404.
    for (const path of [
      "/api/projects/d1-30s/proposals/proposal_x/materialize",
      "/api/migration/v1/projects/d1-30s/materializations/mat_1",
    ]) {
      const response = await call(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect([404, 405], path).toContain(response.status);
    }
    const read = await call("/api/migration/v1/materializations/mat_1");
    expect(read.status).toBe(404);
  });

  it("keeps a fictional operation rejected with 422 and changes no project bytes", async () => {
    const { host, call } = await started();
    const runFile = resolve("fixtures/d1-30s/runs/build.svrun");
    const before = await readFile(runFile);
    const response = await call("/api/projects/d1-30s/edits", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ base_revision: 2, idempotency_key: "m21-fictional", preserve: [],
        selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 },
        operations: [{ op: "adopt_materialized_proposal", shot_id: "shot-001", materialization_id: "mat_1" }] }) });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "UNSUPPORTED_EDIT" });
    expect(await readFile(runFile)).toEqual(before);
    expect(host.diagnostics.write_actor_execute_count).toBe(0);
  });

  it("AC-019 leaves every legacy route in place", async () => {
    const { call } = await started();
    expect((await call("/api/projects/d1-30s")).status).toBe(200);
    expect((await call("/api/projects/d1-30s/assets")).status).toBe(200);
    expect((await call("/api/jobs/job_missing")).status).toBe(404);
    expect((await call("/api/migration/v1/projects/d1-30s")).status).toBe(404);
  }, 30_000);

  it("registers the engine and digest contracts alongside the legacy ones", () => {
    expect(contractIds.engineResponse).toBe("https://narralens.local/schemas/engine-response.schema.json");
    expect(contractIds.sourceDigestManifest).toBe("https://narralens.local/schemas/source-digest-manifest.schema.json");
  });
});

describe("M2.1 projection leaks no server path", () => {
  it("returns a Host loopback preview and no filesystem path", async () => {
    const { call } = await started();
    const response = await call("/api/migration/v1/projects/d1-30s/engine");
    expect(response.status).toBe(200);
    const body = await response.json() as EngineResponse;
    expect(body.projection.preview.kind).toBe("hypit-studio");
    expect(body.projection.preview.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/migration\/v1\/projects\/d1-30s\/preview$/u);
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("file://");
    expect(serialised).not.toContain("/mnt/");
    expect(serialised).not.toContain("C:\\\\");
    expect(serialised).not.toContain("project_path");
  }, 30_000);
});
