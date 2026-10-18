import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HypitEngineAdapter } from "../../src/adapters/hypit/hypit-engine-adapter.js";
import { HypitReadAdapter } from "../../src/adapters/hypit/hypit-read-adapter.js";
import { ProjectCatalog } from "../../src/host/projects/project-catalog.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";
import { ProjectWriteActor } from "../../src/host/projects/project-write-actor.js";
import { InMemoryProjectOperationQueue } from "../../src/host/projects/project-operation-queue.js";
import { NativeWriteGateway } from "../../src/host/engine/native-write-gateway.js";
import { hypitCapabilityMap } from "../../src/host/engine/engine-capabilities.js";
import { computeSourceDigest } from "../../src/host/engine/source-digest-v1.js";
import type { SnapshotRef } from "../../src/host/engine/engine-port.js";
import { HypitWriteAdapter } from "../../src/adapters/hypit/hypit-write-adapter.js";
import { NarralensHost } from "../../src/host/server.js";

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

/**
 * The D1 fixture is 135 MB, almost all of it the Hypit runtime cache (`.hypit/results`)
 * and rendered output. No assertion here reads either: the source digest closure covers the
 * Run, the narration, the asset manifest and the assets it references. Copying only what the
 * closure needs keeps the same assertions while removing the per-test copy cost that made
 * the parallel suite time out intermittently.
 */
const EXCLUDED_FROM_COPY = new Set([".hypit", "output"]);

async function copiedFixture(): Promise<string> {
  const target = await mkdtemp(resolve(tmpdir(), "narralens-m21-bypass-"));
  copies.push(target);
  await cp(resolve("fixtures/d1-30s"), target, {
    recursive: true,
    filter: (source) => !EXCLUDED_FROM_COPY.has(basename(source)),
  });
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
    const descriptor = await catalog.readDescriptor(PROJECT_ID);
    const adapter = new HypitEngineAdapter({
      catalog, reader: new HypitReadAdapter(catalog), writer: new HypitWriteAdapter(catalog),
    });

    // Use the adapter's own digest: it is the single definition of this project's closure.
    const before = await adapter.sourceDigestFor(PROJECT_ID, descriptor);
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

    const after = await adapter.sourceDigestFor(PROJECT_ID, descriptor);
    expect(after.source_digest).not.toBe(before.source_digest);
  }, 30_000);

  it("treats the file watcher as detection only and never as an accepted write", () => {
    const gateway = new NativeWriteGateway();
    const decision = gateway.decide({ entry_id: "filewatch.external_change", transport: "filesystem" }, hypitCapabilityMap());
    expect(decision).toMatchObject({ kind: "read_only" });
    expect(decision).not.toHaveProperty("edit");
    expect(gateway.deniedCount()).toBe(0);
  });

  it("changes the digest when a declared asset, not only a source file, changes", async () => {
    const root = await copiedFixture();
    const catalog = catalogFor(root);
    const descriptor = await catalog.readDescriptor(PROJECT_ID);
    const adapter = new HypitEngineAdapter({
      catalog, reader: new HypitReadAdapter(catalog), writer: new HypitWriteAdapter(catalog),
    });
    const before = await adapter.sourceDigestFor(PROJECT_ID, descriptor);
    expect(before.manifest.assets.map((asset) => asset.path)).toContain("assets/generated/visual-10s.mp4");
    const manifest = resolve(root, "narralens.assets.json");
    await writeFile(manifest, JSON.stringify({ format: "narralens.asset-manifest@2", assets: [] }), "utf8");
    const after = await adapter.sourceDigestFor(PROJECT_ID, descriptor);
    expect(after.source_digest).not.toBe(before.source_digest);
  });
});

/**
 * B-01 (external review): an external source change must be DETECTED by the production
 * Host path and raise persistent attention on its own.
 *
 * The earlier version of this suite proved only that `markAttention()` works when called by
 * hand and that the actor refuses an attention project. That is a false closure: nothing
 * connected detection to attention. This suite drives the real Host over real HTTP and
 * never calls `markAttention` itself.
 */
describe("B-01 external source change reaches attention through the production path", () => {
  const hosts: NarralensHost[] = [];

  async function hostFor(root: string): Promise<NarralensHost> {
    const catalog = new ProjectCatalog(new Map([[PROJECT_ID, resolve(root, "narralens.project.json")]]));
    const host = new NarralensHost({ catalog });
    hosts.push(host);
    const port = await host.listen(0);
    origin = `http://127.0.0.1:${port}`;
    const session = await (await fetch(`${origin}/api/session`, { headers: { origin } })).json() as { token: string };
    token = session.token;
    return host;
  }

  let host: NarralensHost | undefined;
  let origin = "";
  let token = "";

  afterEach(async () => {
    await Promise.all(hosts.splice(0).map(async (entry: NarralensHost) => { await entry.close(); }));
    host = undefined;
  });

  it("409, then attention=true, then the next typed edit is 423, without touching the edited bytes", async () => {
    const root = await copiedFixture();
    host = await hostFor(root);

    // First read establishes the committed baseline.
    const first = await fetch(`${origin}/api/migration/v1/projects/${PROJECT_ID}/engine`,
      { headers: { origin, authorization: `Bearer ${token}` } });
    expect(first.status).toBe(200);
    expect((await host.writes.projectState(PROJECT_ID)).attention).toBe(false);

    // Somebody edits the project outside the Host.
    const runFile = resolve(root, "runs/build.svrun");
    await writeFile(runFile, `${await readFile(runFile, "utf8")}\n<!-- external edit -->`, "utf8");
    const bytesAfterEdit = await sha256Of(runFile);

    // The real Host path detects the mismatch on its own and refuses.
    const stale = await fetch(`${origin}/api/migration/v1/projects/${PROJECT_ID}/engine`,
      { headers: { origin, authorization: `Bearer ${token}` } });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "SOURCE_CHANGED" });

    // The refusal raised persistent attention on its own.
    expect((await host.writes.projectState(PROJECT_ID)).attention).toBe(true);

    // A typed edit is now refused, and the external bytes are still exactly as written.
    const edit = await fetch(`${origin}/api/projects/${PROJECT_ID}/edits`, {
      method: "POST",
      headers: { origin, authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ base_revision: 2, idempotency_key: "m21-b01-attention", preserve: ["narration", "duration"],
        selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 },
        operations: [{ op: "set_visual_fit", shot_id: "shot-001", value: "cover" }] }),
    });
    expect(edit.status).toBe(423);
    expect(await edit.json()).toMatchObject({ code: "PROJECT_ATTENTION_REQUIRED" });
    expect(await sha256Of(runFile)).toBe(bytesAfterEdit);
  }, 60_000);

  it("never re-samples the committed baseline: reading again stays 409 and attention stays set", async () => {
    const root = await copiedFixture();
    host = await hostFor(root);
    await fetch(`${origin}/api/migration/v1/projects/${PROJECT_ID}/engine`,
      { headers: { origin, authorization: `Bearer ${token}` } });
    const runFile = resolve(root, "runs/build.svrun");
    await writeFile(runFile, `${await readFile(runFile, "utf8")}\n<!-- again -->`, "utf8");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${origin}/api/migration/v1/projects/${PROJECT_ID}/engine`,
        { headers: { origin, authorization: `Bearer ${token}` } });
      expect(response.status, `attempt ${attempt}`).toBe(409);
    }
    expect((await host.writes.projectState(PROJECT_ID)).attention).toBe(true);
  }, 60_000);
});

/**
 * B-02 (external review): the digest must cover the assets the project actually references.
 *
 * The reproduction the external review ran: append one byte to a referenced visual asset
 * while leaving the manifest untouched, and the digest stayed identical. A recorded hash in
 * a manifest is a claim; the closure has to hash the bytes that are actually on disk.
 */
describe("B-02 referenced Hypit asset bytes are inside the source digest", () => {
  async function adapterFor(root: string) {
    const catalog = catalogFor(root);
    const descriptor = await catalog.readDescriptor(PROJECT_ID);
    return {
      descriptor,
      adapter: new HypitEngineAdapter({
        catalog, reader: new HypitReadAdapter(catalog), writer: new HypitWriteAdapter(catalog),
      }),
    };
  }

  it("covers both referenced visual assets in the closure", async () => {
    const root = await copiedFixture();
    const { adapter, descriptor } = await adapterFor(root);
    const before = await adapter.sourceDigestFor(PROJECT_ID, descriptor);
    expect(before.manifest.assets.map((asset) => asset.path)).toEqual(expect.arrayContaining([
      "assets/generated/visual-10s.mp4", "assets/generated/visual-alt-10s.mp4",
    ]));
    // Narration, the Run and the manifest are declared roots; the two visual assets are
    // discovered from the manifest. All four kinds are inside the closure.
    expect(before.manifest.files.map((file) => file.path)).toEqual(expect.arrayContaining([
      "runs/build.svrun", "narralens.assets.json",
    ]));
    expect(before.manifest.assets.map((asset) => asset.path)).toContain("assets/generated/narration-30s.wav");
  }, 30_000);

  it("changes the digest when a referenced asset is legitimately re-imported (bytes and manifest together)", async () => {
    const root = await copiedFixture();
    const { adapter, descriptor } = await adapterFor(root);
    const before = await adapter.sourceDigestFor(PROJECT_ID, descriptor);

    // This is what AssetImportService does: install the bytes, then publish the manifest.
    const visual = resolve(root, "assets/generated/visual-10s.mp4");
    const replacement = Buffer.concat([await readFile(visual), Buffer.from([0x00])]);
    await writeFile(visual, replacement);
    const manifestFile = resolve(root, "narralens.assets.json");
    const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as {
      assets: Array<{ project_path: string; sha256: string }>;
    };
    for (const entry of manifest.assets) {
      if (entry.project_path === "assets/generated/visual-10s.mp4") {
        entry.sha256 = createHash("sha256").update(replacement).digest("hex");
      }
    }
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2), "utf8");

    const after = await adapter.sourceDigestFor(PROJECT_ID, descriptor);
    expect(after.source_digest).not.toBe(before.source_digest);
  }, 30_000);

  it("never digests a source whose bytes disagree with its manifest", async () => {
    const root = await copiedFixture();
    const { adapter, descriptor } = await adapterFor(root);
    const manifestFile = resolve(root, "narralens.assets.json");
    const manifestBefore = await sha256Of(manifestFile);
    const alt = resolve(root, "assets/generated/visual-alt-10s.mp4");
    await writeFile(alt, Buffer.concat([await readFile(alt), Buffer.from([0x01])]));

    // The manifest is byte-identical to before, yet the source cannot be trusted.
    expect(await sha256Of(manifestFile)).toBe(manifestBefore);
    await expect(adapter.sourceDigestFor(PROJECT_ID, descriptor))
      .rejects.toMatchObject({ code: "SOURCE_CHANGED", message: expect.stringContaining("SOURCE_MANIFEST_MISMATCH") });
  }, 30_000);

  it("fails closed when a referenced asset is missing or its path escapes the project", async () => {
    const missing = await copiedFixture();
    const { adapter: missingAdapter, descriptor: missingDescriptor } = await adapterFor(missing);
    await rm(resolve(missing, "assets/generated/visual-10s.mp4"));
    await expect(missingAdapter.sourceDigestFor(PROJECT_ID, missingDescriptor))
      .rejects.toMatchObject({ details: undefined, message: expect.stringContaining("SOURCE_REFERENCE_UNRESOLVED") });

    const escaping = await copiedFixture();
    const { adapter: escapingAdapter, descriptor: escapingDescriptor } = await adapterFor(escaping);
    await writeFile(resolve(escaping, "narralens.assets.json"), JSON.stringify({
      format: "narralens.asset-manifest@1",
      assets: [{ asset_id: "asset_evil", project_path: "../../../etc/passwd", sha256: "" }],
    }), "utf8");
    await expect(escapingAdapter.sourceDigestFor(PROJECT_ID, escapingDescriptor))
      .rejects.toMatchObject({ message: expect.stringContaining("SOURCE_PATH_ESCAPE") });
  }, 30_000);

  it("fails closed when a manifest hash no longer matches the bytes it describes", async () => {
    const root = await copiedFixture();
    const { adapter, descriptor } = await adapterFor(root);
    const visual = resolve(root, "assets/generated/visual-10s.mp4");
    await writeFile(visual, Buffer.concat([await readFile(visual), Buffer.from([0x02])]));
    await expect(adapter.sourceDigestFor(PROJECT_ID, descriptor))
      .rejects.toMatchObject({ code: "SOURCE_CHANGED", message: expect.stringContaining("SOURCE_MANIFEST_MISMATCH") });
  }, 30_000);
});
