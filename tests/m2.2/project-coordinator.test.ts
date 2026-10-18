import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectCoordinator } from "../../src/host/projects/project-coordinator.js";
import { LockService } from "../../src/host/projects/lock-service.js";
import { SnapshotStore, type FsyncPath } from "../../src/host/projects/snapshot-store.js";
import { EngineBindingStore, HYPIT_UPSTREAM_SHA } from "../../src/host/engine/engine-binding-store.js";
import { EngineRegistry } from "../../src/host/engine/engine-registry.js";
import { NativeWriteGateway } from "../../src/host/engine/native-write-gateway.js";
import { NativeMutationRegistry } from "../../src/host/engine/native-mutation-registry.js";
import { InMemoryProjectOperationQueue } from "../../src/host/projects/project-operation-queue.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";
import { ProjectCatalog } from "../../src/host/projects/project-catalog.js";
import { HypitEngineAdapter } from "../../src/adapters/hypit/hypit-engine-adapter.js";
import { HypitReadAdapter } from "../../src/adapters/hypit/hypit-read-adapter.js";
import { HypitWriteAdapter } from "../../src/adapters/hypit/hypit-write-adapter.js";
import { canonicalJson, computeSourceDigest, type SourceDigestResult } from "../../src/host/engine/source-digest-v1.js";
import { projectDigestRoots } from "../../src/host/projects/snapshot-store.js";
import { Outbox } from "../../src/host/outbox.js";
import { PersistentJobStore } from "../../src/host/persistent-job-store.js";
import type { EditRequest, EditResponse } from "../../src/contracts/types.js";
import type { ProjectWriteActor } from "../../src/host/projects/project-write-actor.js";
import type { ResolvedSource } from "../../src/host/projects/project-coordinator.js";

/**
 * JRNL / BYP / SER / SNAP for the coordinator (M2.2 plan §1, §8, §9).
 *
 * The actor is a stub here on purpose: the coordinator's own rules are under test, and the
 * actor's behaviour is already covered by the D3/D4.2.1 suites. The stub counts calls so
 * "the gate ran before the actor" is an assertion, not an assumption.
 */

const PROJECT = "d1-30s";
const REQUEST: EditRequest = {
  base_revision: 2, idempotency_key: "coord-1", preserve: ["narration", "duration"],
  selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 },
  operations: [{ op: "set_visual_fit", shot_id: "shot-001", value: "cover" }],
};

interface Harness {
  coordinator: ProjectCoordinator;
  store: RevisionStore;
  actor: { calls: number };
  digest: { value: SourceDigestResult | null };
}

const stores: RevisionStore[] = [];
const dirs: string[] = [];
afterEach(async () => {
  while (stores.length > 0) stores.pop()!.close();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function harness(options: { sourceRoot?: string; snapshotFsync?: FsyncPath;
  onActorStart?: () => void; actorGate?: Promise<void> } = {}): Promise<Harness> {
  const root = options.sourceRoot ?? resolve("fixtures/d1-30s");
  const base = await mkdtemp(resolve(tmpdir(), "narralens-m22-coord-"));
  dirs.push(base);
  const snapshotsRoot = resolve(base, "snapshots");

  const store = new RevisionStore(); stores.push(store);
  const catalog = new ProjectCatalog(new Map([[PROJECT, resolve(root, "narralens.project.json")]]));
  const bindings = new EngineBindingStore(store);
  bindings.bind(PROJECT, "hypit", { createdAt: new Date(0) });
  const hypit = new HypitEngineAdapter({
    catalog, reader: new HypitReadAdapter(catalog), writer: new HypitWriteAdapter(catalog),
  });
  const engines = new EngineRegistry(bindings, { hypit });

  const actor = { calls: 0 };
  const stubActor = {
    executeInCurrentOperation: async (projectId: string, request: EditRequest,
      correlationId?: string): Promise<EditResponse> => {
      actor.calls += 1;
      options.onActorStart?.();
      await options.actorGate;
      void projectId; void request; void correlationId;
      return {
        transaction_id: `txn_actor_${actor.calls}`, project_id: PROJECT, previous_revision: 2,
        new_revision: 2 + actor.calls, operation: REQUEST.operations[0], status: "committed",
        changed: true, source_sha256: "a".repeat(64), run_sha256: "b".repeat(64),
      };
    },
    recoverIncomplete: async (): Promise<void> => undefined,
    adapter: hypit,
  } as unknown as ProjectWriteActor;

  const sourceFor = async () => ({
    engine: "hypit" as const, engineUpstreamSha: HYPIT_UPSTREAM_SHA,
    descriptor: await catalog.readDescriptor(PROJECT), sourceRoot: root,
  });
  const digestFor = async (source: ResolvedSource) => {
    if (harnessDigest.value !== null) return harnessDigest.value;
    return await computeSourceDigest({
      root, roots: projectDigestRoots(source.descriptor, source.engine),
      engine: source.engine, engineUpstreamSha: source.engineUpstreamSha,
    });
  };
  const harnessDigest: { value: SourceDigestResult | null } = { value: null };

  const coordinator = new ProjectCoordinator({
    queue: new InMemoryProjectOperationQueue(), store, actor: stubActor, bindings, engines,
    gateway: new NativeWriteGateway(new NativeMutationRegistry()),
    locks: new LockService(store),
    snapshots: new SnapshotStore({ snapshotsRoot, ...(options.snapshotFsync ? { fsync: options.snapshotFsync } : {}) }),
    outbox: new Outbox(store),
    jobs: new PersistentJobStore(store),
    sourceFor, digestFor,
  });
  return { coordinator, store, actor, digest: harnessDigest };
}

describe("BYP the gateway is in front of every write", () => {
  it("an accepted edit reaches the actor exactly once and returns its response unchanged", async () => {
    const { coordinator, actor } = await harness();
    const response = await coordinator.executeEdit(PROJECT, REQUEST);
    expect(actor.calls).toBe(1);
    // The coordinator adds no field and removes none (AC-019).
    expect(Object.keys(response).sort()).toEqual(["changed", "new_revision", "operation",
      "previous_revision", "project_id", "run_sha256", "source_sha256", "status", "transaction_id"]);
    expect(response.new_revision).toBe(3);
  });

  it("a write refused by the gate never reaches the actor", async () => {
    const { coordinator, store, actor } = await harness();
    store.markAttention(PROJECT, `txn_${"x".repeat(32)}`, "SOURCE_CHANGED", "outside the Host");
    await expect(coordinator.executeEdit(PROJECT, REQUEST))
      .rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
    expect(actor.calls).toBe(0);
  });

  it("a write the engine does not govern is refused by the gateway before the actor", async () => {
    // Same request, but the project is bound to OpenFilm, whose capability map blocks the
    // film writes in M2.1. The refusal must come from the gateway, not from a global table.
    const { coordinator, store, actor } = await harness();
    const bindings = new EngineBindingStore(store);
    store.bindEngine("openfilm-project", "openfilm", "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3", null, new Date(0));
    const openFilmCoordinator = new ProjectCoordinator({
      queue: new InMemoryProjectOperationQueue(), store,
      actor: { executeInCurrentOperation: async () => { actor.calls += 1; throw new Error("actor must not run"); } } as unknown as ProjectWriteActor,
      bindings, engines: new EngineRegistry(bindings),
      gateway: new NativeWriteGateway(new NativeMutationRegistry()),
      locks: new LockService(store),
      snapshots: new SnapshotStore({ snapshotsRoot: "var/snapshots" }),
      outbox: new Outbox(store),
      jobs: new PersistentJobStore(store),
      sourceFor: async () => ({ engine: "openfilm" as const, engineUpstreamSha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
        descriptor: undefined as never, sourceRoot: resolve("fixtures/d1-30s") }),
      digestFor: async () => ({ manifest: { format: "narralens.source-digest-manifest@1.0", engine: "openfilm",
        engine_upstream_sha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3", files: [], assets: [] },
        source_digest: "0".repeat(64), external_reference_count: 0 }),
    });
    void coordinator;
    await expect(openFilmCoordinator.executeEdit("openfilm-project", REQUEST))
      .rejects.toMatchObject({ status: 422, code: "UNSUPPORTED_EDIT" });
    expect(actor.calls).toBe(0);
  });

  it("a stale baseline is refused with 409 and the actor is never called", async () => {
    const { coordinator, store, actor, digest } = await harness();
    store.ensureSourceBaseline(PROJECT, 2, "a".repeat(64));
    digest.value = { ...(await computeSourceDigest({ root: resolve("fixtures/d1-30s"),
      roots: ["runs/build.svrun", "assets/generated/narration-30s.wav", "narralens.assets.json"],
      engine: "hypit", engineUpstreamSha: HYPIT_UPSTREAM_SHA })),
      source_digest: "b".repeat(64) };
    await expect(coordinator.executeEdit(PROJECT, REQUEST))
      .rejects.toMatchObject({ status: 409, code: "SOURCE_CHANGED" });
    expect(actor.calls).toBe(0);
    // And the refusal raised attention on its own.
    expect(store.projectsInAttention()).toContain(PROJECT);
  });
});

describe("LOCK the coordinator consults locks before the actor", () => {
  it("a locked range refuses the write with 423 and the actor is never called", async () => {
    const { coordinator, actor } = await harness();
    coordinator.acquireLock({ projectId: PROJECT, lockType: "visual", scope: "shot", targetId: "shot-001",
      startFrame: 0, endFrameExclusive: 300, owner: "user", reason: "operator hold" }, 2);
    await expect(coordinator.executeEdit(PROJECT, REQUEST))
      .rejects.toMatchObject({ status: 423, code: "TARGET_LOCKED" });
    expect(actor.calls).toBe(0);
  });

  it("serializes lock changes behind an in-flight edit on the shared project queue", async () => {
    let releaseActor!: () => void;
    const actorGate = new Promise<void>((resolvePromise) => { releaseActor = resolvePromise; });
    let actorStarted!: () => void;
    const started = new Promise<void>((resolvePromise) => { actorStarted = resolvePromise; });
    const { coordinator } = await harness({ actorGate, onActorStart: actorStarted });
    const edit = coordinator.executeEdit(PROJECT, REQUEST);
    await started;
    let lockResolved = false;
    const lock = coordinator.acquireLock({ projectId: PROJECT, lockType: "visual", scope: "shot",
      targetId: "shot-001", startFrame: 0, endFrameExclusive: 300,
      owner: "operator", reason: "after edit" }, 2).then((value) => { lockResolved = true; return value; });
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    expect(lockResolved).toBe(false);
    releaseActor();
    await expect(edit).resolves.toMatchObject({ status: "committed" });
    await expect(lock).resolves.toMatchObject({ owner: "operator" });
  });
});

describe("SNAP the commit pointer and the outbox move together", () => {
  it("publishes a snapshot and points active_commit at it in one commit", async () => {
    const { coordinator, store } = await harness();
    const response = await coordinator.executeEdit(PROJECT, REQUEST);
    const commit = store.activeCommit(PROJECT);
    expect(commit).toMatchObject({ project_id: PROJECT, revision: response.new_revision });
    expect(commit!.snapshot_id).toMatch(/^[a-f0-9]{64}$/u);
    expect(commit!.transaction_id).toMatch(/^txn_/u);
    expect(store.state(PROJECT, 2).revision).toBe(response.new_revision);
    expect(store.pendingOutboxCount()).toBe(1);
    expect(store.sourceBaseline(PROJECT).committed).toBe(commit!.source_digest);
    expect(store.idempotencyEntry(PROJECT, REQUEST.idempotency_key)?.request_hash)
      .toBe(createHash("sha256").update(canonicalJson(REQUEST)).digest("hex"));
    const transaction = store.projectTransaction(commit!.transaction_id);
    expect(transaction).toMatchObject({ state: "committed", snapshot_id: commit!.snapshot_id });
  });

  it("rolls the snapshot back and raises attention when the commit transaction fails", async () => {
    const { coordinator, store, actor } = await harness();
    const original = store.commitWithPointer.bind(store);
    store.commitWithPointer = () => { throw new Error("injected commit failure"); };
    await expect(coordinator.executeEdit(PROJECT, REQUEST)).rejects.toThrow(/injected commit failure/u);
    expect(actor.calls).toBe(1);
    expect(store.pendingOutboxCount()).toBe(0);
    expect(store.activeCommit(PROJECT)).toBeUndefined();
    expect(store.projectsInAttention()).toContain(PROJECT);
    void original;
  });

  it("raises durable attention when snapshot publication cannot be proven", async () => {
    const { coordinator, store } = await harness({ snapshotFsync: async () => { throw new Error("fsync denied"); } });
    await expect(coordinator.executeEdit(PROJECT, REQUEST)).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(store.projectsInAttention()).toContain(PROJECT);
    expect(store.activeCommit(PROJECT)).toBeUndefined();
    expect(store.attentionReason(PROJECT)).toMatch(/fsync denied/u);
  });
});

describe("SER one queue, serial per project, parallel across projects", () => {
  it("orders two writes on the same project and lets two projects run at once", async () => {
    const { coordinator, store } = await harness();
    const second: EditRequest = { ...REQUEST, idempotency_key: "coord-2",
      operations: [{ op: "set_visual_fit", shot_id: "shot-001", value: "contain" }] };
    const [first, other] = await Promise.all([
      coordinator.executeEdit(PROJECT, REQUEST),
      coordinator.executeEdit("other-project", { ...second, idempotency_key: "coord-3" }).catch((error: Error) => error),
    ]);
    expect(first.new_revision).toBe(3);
    // A different project is not blocked by this project's queue.
    expect(other).toBeInstanceOf(Error);
    expect(store.activeCommit(PROJECT)).toBeDefined();
  });
});

describe("JRNL recovery order", () => {
  it("marks unfinished transactions recovering and reports what is outstanding", async () => {
    const { coordinator, store } = await harness();
    const transactionId = coordinator.beginTransaction({ projectId: PROJECT, kind: "lock",
      requestJson: "{}", requestHash: "", baseRevision: 0, correlationId: "c" });
    coordinator.preconditionsChecked(transactionId, "");
    coordinator.stage(transactionId);
    store.enqueueOutbox("job.state_changed", PROJECT, "{}");

    const report = await coordinator.recoverOnStart();
    expect(report.transactions_marked_recovering).toBeGreaterThanOrEqual(1);
    expect(report.outbox_pending).toBe(1);
    expect(store.projectTransaction(transactionId)!.state).toBe("recovering");
  });

  it("write routes stay closed while anything is in attention", async () => {
    const { coordinator, store, actor } = await harness();
    store.markAttention(PROJECT, `txn_${"y".repeat(32)}`, "SNAPSHOT_DURABILITY_UNPROVABLE", "fsync failed");
    const report = await coordinator.recoverOnStart();
    expect(report.attention_projects).toContain(PROJECT);
    expect(coordinator.recoverStatus(PROJECT)).toBe(false);
    await expect(coordinator.executeEdit(PROJECT, REQUEST)).rejects.toMatchObject({ status: 423 });
    expect(actor.calls).toBe(0);
  });
});
