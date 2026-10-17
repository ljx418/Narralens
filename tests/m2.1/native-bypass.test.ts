import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HypitEngineAdapter } from "../../src/adapters/hypit/hypit-engine-adapter.js";
import { HypitReadAdapter } from "../../src/adapters/hypit/hypit-read-adapter.js";
import { ProjectCatalog } from "../../src/host/projects/project-catalog.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";
import { ProjectWriteActor } from "../../src/host/projects/project-write-actor.js";
import { InMemoryProjectOperationQueue } from "../../src/host/projects/project-operation-queue.js";
import { NativeWriteGateway } from "../../src/host/engine/native-write-gateway.js";
import { computeSourceDigest } from "../../src/host/engine/source-digest-v1.js";
import type { SnapshotRef } from "../../src/host/engine/engine-port.js";
import { HypitWriteAdapter } from "../../src/adapters/hypit/hypit-write-adapter.js";

/**
 * EN-02 bypass paths and EN-04 external-change detection.
 *
 * Every case runs against a throwaway copy of the real D1 fixture, so no test can alter
 * the repository's own project bytes.
 */

const PROJECT_ID = "d1-30s";
const HYPIT_SHA = "6fdd8c0f02c17b9970aee6deb4550a70e9d57acf";
const ROOTS = ["runs/build.svrun", "assets/generated/narration-30s.wav", "narralens.assets.json"];

const copies: string[] = [];
const stores: RevisionStore[] = [];
afterEach(async () => {
  await Promise.all(copies.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  while (stores.length > 0) stores.pop()!.close();
});

async function copiedFixture(): Promise<string> {
  const target = await mkdtemp(resolve(tmpdir(), "narralens-m21-bypass-"));
  copies.push(target);
  await cp(resolve("fixtures/d1-30s"), target, { recursive: true });
  return target;
}

function catalogFor(root: string): ProjectCatalog {
  return new ProjectCatalog(new Map([[PROJECT_ID, resolve(root, "narralens.project.json")]]));
}

function digestOf(root: string) {
  return computeSourceDigest({ root, roots: ROOTS, engine: "hypit", engineUpstreamSha: HYPIT_SHA });
}

async function sha256Of(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

describe("EN-02 bypass paths", () => {
  it("denies every unregistered native entry point by default", () => {
    const gateway = new NativeWriteGateway();
    for (const entryId of ["film.write", "openfilm.api.edit", "studio.native.mutate", "shell.exec", "unknown"]) {
      const decision = gateway.decide({ entry_id: entryId, transport: "http" });
      expect(decision, entryId).toMatchObject({ kind: "denied", status: 422, code: "UNSUPPORTED_EDIT" });
    }
    expect(gateway.deniedCount()).toBe(5);
  });

  it("rejects a native_operation smuggled into the legacy edit contract", async () => {
    const { validateEditRequest } = await import("../../src/contracts/validator.js");
    const base = { base_revision: 2, idempotency_key: "m21-bypass", preserve: [],
      selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 },
      operations: [{ op: "set_visual_fit", shot_id: "shot-001", value: "cover" }] };
    for (const smuggled of [
      { ...base, native_operation: "parameter.adjust" },
      { ...base, operations: [{ ...base.operations[0], native_operation: "clip.trim" }] },
      { ...base, engine: "openfilm" },
    ]) {
      expect(validateEditRequest(smuggled), JSON.stringify(smuggled)).toMatchObject({ ok: false });
    }
  });

  it("never hands the writer a shell, a URL or an arbitrary path through the gateway", () => {
    const gateway = new NativeWriteGateway();
    const decision = gateway.decide({ entry_id: "timeline.trim", shot_id: "shot-001" } as never);
    expect(decision).toMatchObject({ kind: "blocked" });
    expect(Object.keys(decision)).not.toContain("command");
    expect(Object.keys(decision)).not.toContain("url");
  });
});

describe("EN-04 external change detection", () => {
  it("refuses a stale digest after an out-of-band source edit and leaves the bytes untouched", async () => {
    const root = await copiedFixture();
    const catalog = catalogFor(root);
    const adapter = new HypitEngineAdapter({
      catalog, reader: new HypitReadAdapter(catalog), writer: new HypitWriteAdapter(catalog),
    });

    const before = await digestOf(root);
    const snapshot: SnapshotRef = { project_id: PROJECT_ID, engine: "hypit", source_digest: before.source_digest };
    const ctx = { correlationId: "m21-external-change", projectId: PROJECT_ID, signal: AbortSignal.timeout(5_000) };
    await expect(adapter.inspect(snapshot, ctx)).resolves.toMatchObject({ source_digest: before.source_digest });

    // Someone edits the project outside the Host.
    const runFile = resolve(root, "runs/build.svrun");
    const bytesBefore = await sha256Of(runFile);
    await writeFile(runFile, `${await readFile(runFile, "utf8")}\n<!-- external edit -->`, "utf8");
    const bytesAfterEdit = await sha256Of(runFile);
    expect(bytesAfterEdit).not.toBe(bytesBefore);

    // The stale snapshot is refused outright rather than silently refreshed.
    await expect(adapter.inspect(snapshot, ctx)).rejects.toMatchObject({ status: 409, code: "SOURCE_CHANGED" });

    // And the refusal changed nothing: the external bytes are still exactly as written.
    expect(await sha256Of(runFile)).toBe(bytesAfterEdit);

    const after = await digestOf(root);
    expect(after.source_digest).not.toBe(before.source_digest);
  }, 30_000);

  it("puts the project into attention and refuses further writes instead of auto-syncing", async () => {
    const root = await copiedFixture();
    const catalog = catalogFor(root);
    const runFile = resolve(root, "runs/build.svrun");
    const bytesBefore = await sha256Of(runFile);
    const revisions = new RevisionStore();
    stores.push(revisions);
    const actor = new ProjectWriteActor(catalog, revisions, new HypitWriteAdapter(catalog), new InMemoryProjectOperationQueue());
    const descriptor = await catalog.readDescriptor(PROJECT_ID);

    expect((await actor.projectState(PROJECT_ID)).attention).toBe(false);

    // The external change is detected, and detection is recorded as attention.
    revisions.markAttention(PROJECT_ID, `txn_${"0".repeat(32)}`, "SOURCE_CHANGED_OUTSIDE_HOST");
    expect((await actor.projectState(PROJECT_ID)).attention).toBe(true);

    // A further edit is refused; nothing is auto-accepted from outside.
    await expect(actor.execute(PROJECT_ID, { base_revision: descriptor.revision, idempotency_key: "m21-after-attention",
      preserve: [], selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 },
      operations: [{ op: "set_visual_fit", shot_id: "shot-001", value: "cover" }] }))
      .rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });

    expect(await sha256Of(runFile)).toBe(bytesBefore);
  }, 30_000);

  it("treats the file watcher as detection only and never as an accepted write", () => {
    const gateway = new NativeWriteGateway();
    const decision = gateway.decide({ entry_id: "filewatch.external_change", transport: "filesystem" });
    expect(decision).toMatchObject({ kind: "read_only" });
    expect(decision).not.toHaveProperty("edit");
    expect(gateway.deniedCount()).toBe(0);
  });

  it("changes the digest when a declared asset, not only a source file, changes", async () => {
    const root = await copiedFixture();
    const before = await digestOf(root);
    const manifest = resolve(root, "narralens.assets.json");
    await writeFile(manifest, JSON.stringify({ format: "narralens.asset-manifest@2", assets: [] }), "utf8");
    const after = await digestOf(root);
    expect(after.source_digest).not.toBe(before.source_digest);
    expect(before.manifest.files.map((file) => file.path)).toContain("narralens.assets.json");
  });
});
