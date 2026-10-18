import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HypitCapture, MutationResult } from "../../src/adapters/hypit/hypit-write-adapter.js";
import { HypitWriteAdapter } from "../../src/adapters/hypit/hypit-write-adapter.js";
import { HypitReadAdapter } from "../../src/adapters/hypit/hypit-read-adapter.js";
import { HypitEngineAdapter } from "../../src/adapters/hypit/hypit-engine-adapter.js";
import { EngineBindingStore } from "../../src/host/engine/engine-binding-store.js";
import { EngineRegistry } from "../../src/host/engine/engine-registry.js";
import { InMemoryProjectOperationQueue } from "../../src/host/projects/project-operation-queue.js";
import { ProjectCatalog, type ProjectDescriptor } from "../../src/host/projects/project-catalog.js";
import { ProjectWriteActor } from "../../src/host/projects/project-write-actor.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";
import { NarralensHost } from "../../src/host/server.js";
import { PersistentJobStore } from "../../src/host/persistent-job-store.js";

const hosts: NarralensHost[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

class NoOpHypit {
  constructor(private readonly descriptor: ProjectDescriptor) {}
  async inspect(_projectId: string, shotId: string): Promise<HypitCapture> {
    const shot = this.descriptor.shots.find((candidate) => candidate.shot_id === shotId)!;
    const text = `<visual:Clip id="${shot.authoring_id}" fit="cover"/>`;
    const start = text.indexOf("cover");
    const item = { id: "opaque", authoredId: shot.authoring_id, startFrame: shot.start_frame,
      endFrameExclusive: shot.end_frame_exclusive,
      inspector: [{ id: "fit", control: "select", value: "cover" as const, options: ["contain", "cover"],
        edit: { source: { path: "authors/main.svml", range: { start, end: start + 5 }, preimage: "cover" } } }] };
    return { descriptor: this.descriptor, snapshot: { revision: 1,
      source: { path: "authors/main.svml", text }, timeline: { frameCount: 900 },
      tracks: [{ binding: { facet: "visual" }, items: [item] }] }, target: item,
      fitField: item.inspector[0]!, fit: "cover", source_sha256: sha(text), run_sha256: sha("run"),
      narration_sha256: sha("voice"), semantic: [
        { authored_id: "narration", start_frame: 0, end_frame_exclusive: 900 },
        ...this.descriptor.shots.map((candidate) => ({ authored_id: candidate.authoring_id,
          start_frame: candidate.start_frame, end_frame_exclusive: candidate.end_frame_exclusive,
          fit: "cover" as const })),
      ] };
  }
  predictedSource(capture: HypitCapture): string { return capture.snapshot.source.text; }
  async sourceText(): Promise<string> { throw new Error("no-op must not read source text"); }
  async mutate(): Promise<MutationResult> { throw new Error("no-op must not mutate"); }
}

describe("M2.2 production Host composition", () => {
  it("reaps an expired persistent lease before opening the HTTP listener", async () => {
    const revisions = new RevisionStore();
    revisions.ensureProject("d1-30s", 2);
    const jobs = new PersistentJobStore(revisions);
    const job = jobs.create({ projectId: "d1-30s", kind: "proposal_comparison", payload: {} }, new Date(0));
    expect(jobs.acquireLease(job.job_id, { owner: "dead-worker", leaseMs: 1, now: new Date(0) })).toBe(true);
    const host = new NarralensHost({ revisionStore: revisions, jobs }); hosts.push(host);
    await host.listen(0);
    expect(jobs.record(job.job_id)).toMatchObject({ state: "attention", lease_owner: null, attempt: 1 });
  });

  it("routes repeated HTTP edits through Coordinator and publishes the complete snapshot closure", async () => {
    const base = await mkdtemp(resolve(tmpdir(), "narralens-m22-host-")); dirs.push(base);
    const projectRoot = resolve(base, "project");
    const snapshotsRoot = resolve(base, "snapshots");
    await cp("tests/fixtures/m2.1/snapshot-project", projectRoot, { recursive: true });
    const catalog = new ProjectCatalog(new Map([["d1-30s", resolve(projectRoot, "narralens.project.json")]]));
    const descriptor = await catalog.readDescriptor("d1-30s");
    const revisions = new RevisionStore();
    const queue = new InMemoryProjectOperationQueue();
    const fake = new NoOpHypit(descriptor) as unknown as HypitWriteAdapter;
    const writes = new ProjectWriteActor(catalog, revisions, fake, queue);
    const bindings = new EngineBindingStore(revisions);
    bindings.bind("d1-30s", "hypit", { createdAt: new Date(0) });
    const engines = new EngineRegistry(bindings, { hypit: new HypitEngineAdapter({
      catalog, reader: new HypitReadAdapter(catalog), writer: fake,
    }) });
    const host = new NarralensHost({ catalog, revisionStore: revisions, operationQueue: queue,
      writes, engines, snapshotsRoot });
    hosts.push(host);
    const port = await host.listen(0);
    const origin = `http://127.0.0.1:${port}`;
    const token = (await (await fetch(`${origin}/api/session`, { headers: { origin } })).json() as { token: string }).token;
    const request = (key: string) => ({ base_revision: 2, idempotency_key: key,
      selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 },
      preserve: ["narration", "duration"],
      operations: [{ op: "set_visual_fit", shot_id: "shot-001", value: "cover" }] });
    for (const key of ["host-coordinator-1", "host-coordinator-2"]) {
      const response = await fetch(`${origin}/api/projects/d1-30s/edits`, { method: "POST",
        headers: { origin, authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(request(key)) });
      expect(response.status, `${key}: ${JSON.stringify(await response.clone().json())}`).toBe(200);
      expect(await response.json()).toMatchObject({ status: "unchanged", new_revision: 2 });
    }
    const replay = await fetch(`${origin}/api/projects/d1-30s/edits`, { method: "POST",
      headers: { origin, authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(request("host-coordinator-1")) });
    expect(replay.status).toBe(200);
    expect(revisions.projectTransactions("d1-30s")).toHaveLength(2);
    const commit = revisions.activeCommit("d1-30s")!;
    expect(commit.source_digest).toBe(revisions.sourceBaseline("d1-30s").committed);
    expect(await readFile(resolve(snapshotsRoot, "d1-30s", commit.snapshot_id,
      "source/assets/generated/visual-10s.mp4"))).toEqual(await readFile(resolve(projectRoot,
      "assets/generated/visual-10s.mp4")));
    expect(host.diagnostics.write_actor_execute_count).toBe(3);
  });
});
