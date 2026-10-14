import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HypitReadAdapter } from "../../src/adapters/hypit/hypit-read-adapter.js";
import { ControlledAgentRunner, type ComparisonRunnerInput, type RunnerOutput } from "../../src/adapters/openmontage/controlled-agent-runner.js";
import { NarralensHost } from "../../src/host/server.js";

const hosts: NarralensHost[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map((host) => host.close())); });

class CountingRunner extends ControlledAgentRunner {
  calls = 0;
  override async runComparison(input: ComparisonRunnerInput, signal?: AbortSignal): Promise<RunnerOutput> { this.calls += 1; return await super.runComparison(input, signal); }
}

async function started(runner: ControlledAgentRunner = new ControlledAgentRunner({ executable: process.execPath, prefixArgs: [resolve("tests/fixtures/fake-runner.mjs")] })): Promise<{ host: NarralensHost; origin: string; token: string }> {
  const host = new NarralensHost({ runner });
  hosts.push(host);
  const port = await host.listen(0);
  const origin = `http://127.0.0.1:${port}`;
  const response = await fetch(`${origin}/api/session`, { headers: { origin } });
  return { host, origin, token: (await response.json() as { token: string }).token };
}

function headers(origin: string, token: string): HeadersInit { return { origin, authorization: `Bearer ${token}` }; }

describe("D2 Host HTTP", () => {
  it("enforces same-origin session and auth without leaking a token", async () => {
    const { origin, token } = await started();
    const rejected = await fetch(`${origin}/api/session`, { headers: { origin: "http://localhost:1" } });
    expect(rejected.status).toBe(403);
    expect(JSON.stringify(await rejected.json())).not.toContain(token);
    expect((await fetch(`${origin}/api/projects/d1-30s`, { headers: { origin } })).status).toBe(401);
    expect((await fetch(`${origin}/api/projects/d1-30s`, { headers: { referer: `${origin}/`, "sec-fetch-site": "same-origin", authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await fetch(`${origin}/api/projects/..%2Fsecret`, { headers: headers(origin, token) })).status).toBe(404);
  });

  it("rejects an oversized JSON body before contract parsing", async () => {
    const { origin, token } = await started();
    const response = await fetch(`${origin}/api/projects/d1-30s/proposals`, { method: "POST", headers: { ...headers(origin, token), "content-type": "application/json" }, body: JSON.stringify({ padding: "x".repeat(70_000) }) });
    expect(response.status).toBe(413);
  });

  it("reads the real D1 descriptor and leaves Source unchanged", async () => {
    const source = resolve("fixtures/d1-30s/authors/main.svml");
    const before = createHash("sha256").update(await readFile(source)).digest("hex");
    const { host, origin, token } = await started();
    const response = await fetch(`${origin}/api/projects/d1-30s`, { headers: headers(origin, token) });
    expect(response.status).toBe(200);
    const project = await response.json() as { frame_count: number; frame_rate: number; shots: unknown[] };
    expect(project).toMatchObject({ frame_count: 900, frame_rate: 30 });
    expect(project.shots).toHaveLength(3);
    const read = await new HypitReadAdapter(host.catalog).readProject("d1-30s");
    expect(read.run_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(createHash("sha256").update(await readFile(source)).digest("hex")).toBe(before);
  });

  it("returns the complete current asset inventory without leaking project paths", async () => {
    const { origin, token } = await started();
    const response = await fetch(`${origin}/api/projects/d1-30s/assets`, { headers: headers(origin, token) });
    expect(response.status).toBe(200);
    const inventory = await response.json() as { manifest_format: string; assets: Array<{ asset_id: string; availability: string; eligible: boolean }> };
    expect(inventory.manifest_format).toBe("narralens.asset-manifest@1");
    expect(inventory.assets).toEqual([
      expect.objectContaining({ asset_id: "asset_visual_baseline", availability: "available", eligible: true }),
      expect.objectContaining({ asset_id: "asset_visual_d4_alt", availability: "available", eligible: true }),
    ]);
    expect(JSON.stringify(inventory)).not.toContain("project_path");
    expect(JSON.stringify(inventory)).not.toContain("/mnt/");
  }, 30_000);

  it("runs an asynchronous proposal job and replays monotonic SSE events", async () => {
    const { host, origin, token } = await started();
    const request = { base_revision: 2, selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 }, intent: "强化因果关系", preserve: ["narration"], proposal_count: 3 };
    const created = await fetch(`${origin}/api/projects/d1-30s/proposals`, { method: "POST", headers: { ...headers(origin, token), "content-type": "application/json" }, body: JSON.stringify(request) });
    expect(created.status).toBe(202);
    const jobId = (await created.json() as { job_id: string }).job_id;
    let state = "queued";
    for (let index = 0; index < 50 && !["succeeded", "failed"].includes(state); index += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      state = (await (await fetch(`${origin}/api/jobs/${jobId}`, { headers: headers(origin, token) })).json() as { state: string }).state;
    }
    expect(state).toBe("succeeded");
    const snapshot = host.jobs.get(jobId)!;
    const events = await (await fetch(`${origin}/api/jobs/${jobId}/events?after=1`, { headers: headers(origin, token) })).text();
    expect(events).toContain("id: 2");
    expect(events).toContain("event: succeeded");
    const comparison = await fetch(`${origin}/api/proposal-comparisons/${snapshot.comparison_id!}`, { headers: headers(origin, token) });
    expect(comparison.status).toBe(200);
    expect((await comparison.json() as { base_revision: number; proposals: unknown[] })).toMatchObject({ base_revision: 2, proposals: expect.any(Array) });
    expect(host.diagnostics.write_actor_execute_count).toBe(0);
  });

  it("accepts a registered selection independent of JSON property order", async () => {
    const { origin, token } = await started();
    const selection = { end_frame_exclusive: 300, shot_id: "shot-001", start_frame: 0 };
    const response = await fetch(`${origin}/api/projects/d1-30s/proposals`, { method: "POST", headers: { ...headers(origin, token), "content-type": "application/json" }, body: JSON.stringify({ base_revision: 2, selection, intent: "字段顺序不影响选区身份", preserve: [], proposal_count: 3 }) });
    expect(response.status).toBe(202);
  });

  it("rejects an unsupported D3 edit before contacting Studio", async () => {
    const { origin, token } = await started();
    const response = await fetch(`${origin}/api/projects/d1-30s/edits`, { method: "POST",
      headers: { ...headers(origin, token), "content-type": "application/json" },
      body: JSON.stringify({ base_revision: 2, idempotency_key: "invalid-edit", selection: { shot_id: "shot-002", start_frame: 300, end_frame_exclusive: 600 },
        preserve: ["narration", "duration"], operations: [{ op: "set_visual_fit", shot_id: "shot-002", value: "stretch" }] }) });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "UNSUPPORTED_EDIT" });
  });

  it("rejects invalid D4.1 counts, reverse ranges and extra fields before Runner", async () => {
    const runner = new CountingRunner({ executable: process.execPath, prefixArgs: [resolve("tests/fixtures/fake-runner.mjs")] });
    const { origin, token } = await started(runner);
    const base = { base_revision: 2, selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 }, intent: "比较", preserve: [], proposal_count: 3 };
    for (const body of [{ ...base, proposal_count: 2 }, { ...base, proposal_count: 7 }, { ...base, selection: { ...base.selection, end_frame_exclusive: 0 } }, { ...base, injected: true }]) {
      const response = await fetch(`${origin}/api/projects/d1-30s/proposals`, { method: "POST", headers: { ...headers(origin, token), "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(response.status).toBe(400);
    }
    expect(runner.calls).toBe(0);
  });

  it("maps a comparison provider 529 after exactly one invocation", async () => {
    const runner = new CountingRunner({ executable: process.execPath, prefixArgs: [resolve("tests/fixtures/fake-runner.mjs")] });
    const { host, origin, token } = await started(runner);
    const request = { base_revision: 2, selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 }, intent: "provider-529", preserve: [], proposal_count: 3 };
    const created = await fetch(`${origin}/api/projects/d1-30s/proposals`, { method: "POST", headers: { ...headers(origin, token), "content-type": "application/json" }, body: JSON.stringify(request) });
    const jobId = (await created.json() as { job_id: string }).job_id;
    for (let index = 0; index < 50 && host.jobs.get(jobId)?.state !== "failed"; index += 1) await new Promise((done) => setTimeout(done, 20));
    expect(host.jobs.get(jobId)).toMatchObject({ state: "failed", error: { code: "PROVIDER_OVERLOADED" } });
    expect(runner.calls).toBe(1); expect(host.diagnostics.write_actor_execute_count).toBe(0);
  });

  it("rejects a malformed comparison route identifier at the storage boundary", async () => {
    const { origin, token } = await started();
    const response = await fetch(`${origin}/api/proposal-comparisons/not-a-comparison`, { headers: headers(origin, token) });
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });
});
