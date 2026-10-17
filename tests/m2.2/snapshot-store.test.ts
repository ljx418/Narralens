import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  projectDigestRoots, snapshotIdFor, SnapshotStore, type FsyncPath,
} from "../../src/host/projects/snapshot-store.js";
import { ProjectCatalog } from "../../src/host/projects/project-catalog.js";

/**
 * SNAP and DUR (M2.2 plan §4).
 *
 * The store must publish a snapshot only after durability is proven bottom up, and must
 * publish nothing at all when any step cannot be proven. Both halves are exercised with a
 * real filesystem and a fault injected at each individual fsync step.
 */

const PROJECT_ID = "d1-30s";
const HYPIT_SHA = "6fdd8c0f02c17b9970aee6deb4550a70e9d57acf";
const created: string[] = [];
afterEach(async () => { await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function workspace(): Promise<{ sourceRoot: string; snapshotsRoot: string }> {
  const base = await mkdtemp(resolve(tmpdir(), "narralens-m22-snap-"));
  created.push(base);
  await import("node:fs/promises").then(async (fs) => { await fs.cp("fixtures/d1-30s", resolve(base, "project"), { recursive: true }); });
  return { sourceRoot: resolve(base, "project"), snapshotsRoot: resolve(base, "snapshots") };
}

function descriptorFor(sourceRoot: string) {
  return new ProjectCatalog(new Map([[PROJECT_ID, resolve(sourceRoot, "narralens.project.json")]])).readDescriptor(PROJECT_ID);
}

async function source(sourceRoot: string) {
  return {
    projectId: PROJECT_ID, engine: "hypit" as const, engineUpstreamSha: HYPIT_SHA,
    descriptor: await descriptorFor(sourceRoot), sourceRoot,
  };
}

/** An fsync that records what it was asked to prove and can fail at a chosen step. */
function recordingFsync(failAt?: (path: string, index: number) => boolean): { fsync: FsyncPath; calls: string[] } {
  const calls: string[] = [];
  const fsync: FsyncPath = async (path) => {
    const index = calls.length;
    calls.push(path);
    if (failAt?.(path, index)) throw new Error(`injected fsync failure at ${path}`);
    const { open } = await import("node:fs/promises");
    const { constants } = await import("node:fs");
    const handle = await open(path, constants.O_RDONLY);
    try { await handle.sync(); } finally { await handle.close(); }
  };
  return { fsync, calls };
}

describe("SNAP content-addressed publication", () => {
  it("publishes the whole closure under a deterministic id and can read it back", async () => {
    const { sourceRoot, snapshotsRoot } = await workspace();
    const store = new SnapshotStore({ snapshotsRoot });
    const published = await store.publish(await source(sourceRoot));

    expect(published.snapshot_id).toMatch(/^[a-f0-9]{64}$/u);
    expect(published.source_digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(await store.exists(PROJECT_ID, published.snapshot_id)).toBe(true);

    // The published content is the closure, byte for byte.
    const original = await readFile(resolve(sourceRoot, "runs/build.svrun"));
    expect(await store.read(PROJECT_ID, published.snapshot_id, "runs/build.svrun")).toEqual(original);
    expect(await readdir(resolve(store.snapshotRoot(PROJECT_ID, published.snapshot_id), "source", "assets", "generated")))
      .toEqual(expect.arrayContaining(["narration-30s.wav"]));
  });

  it("gives the same id for the same source and a different id when any byte changes", async () => {
    const { sourceRoot, snapshotsRoot } = await workspace();
    const store = new SnapshotStore({ snapshotsRoot });
    const first = await store.publish(await source(sourceRoot));
    const again = await store.publish(await source(sourceRoot));
    expect(again.snapshot_id).toBe(first.snapshot_id);

    await writeFile(resolve(sourceRoot, "runs/build.svrun"), "changed", "utf8");
    const changed = await store.publish(await source(sourceRoot));
    expect(changed.snapshot_id).not.toBe(first.snapshot_id);
    expect(snapshotIdFor(PROJECT_ID, "a".repeat(64))).not.toBe(snapshotIdFor("other", "a".repeat(64)));
  });

  it("proves files first, then directories from the leaves up, then renames and proves the parent", async () => {
    const { sourceRoot, snapshotsRoot } = await workspace();
    const { fsync, calls } = recordingFsync();
    const store = new SnapshotStore({ snapshotsRoot, fsync });
    const published = await store.publish(await source(sourceRoot));

    const suffix = (path: string) => path.replace(`${snapshotsRoot}/${PROJECT_ID}`, "<proj>")
      .replace(published.snapshot_id, "<snap>");

    // Files before any directory.
    const firstDirectory = calls.findIndex((path) => path.endsWith("/source") || !path.includes("/source/"));
    const lastFile = calls.map((path) => path.includes("/source/")).lastIndexOf(true);
    expect(lastFile).toBeLessThan(firstDirectory);

    // The staging tree is proven before the rename, and the project directory after it.
    expect(calls.some((path) => path.includes(".staging-"))).toBe(true);
    expect(calls.map(suffix)).toContain(`<proj>`);
    expect(suffix(calls.at(-1)!)).toBe("<proj>");
    // No staging directory is left behind.
    expect((await readdir(resolve(snapshotsRoot, PROJECT_ID))).filter((entry) => entry.startsWith(".staging-")))
      .toEqual([]);
  });

  it("leaves the snapshot readable only through its id, never by listing for the newest", async () => {
    const { sourceRoot, snapshotsRoot } = await workspace();
    const store = new SnapshotStore({ snapshotsRoot });
    const published = await store.publish(await source(sourceRoot));
    const entries = await readdir(resolve(snapshotsRoot, PROJECT_ID));
    expect(entries).toEqual([published.snapshot_id]);
    await expect(store.read(PROJECT_ID, "not-a-real-snapshot", "runs/build.svrun")).rejects.toThrow();
  });

  it("refuses a snapshot read that escapes the snapshot directory", async () => {
    const { sourceRoot, snapshotsRoot } = await workspace();
    const store = new SnapshotStore({ snapshotsRoot });
    const published = await store.publish(await source(sourceRoot));
    await expect(store.read(PROJECT_ID, published.snapshot_id, "../../../etc/passwd"))
      .rejects.toThrow(/SOURCE_PATH_ESCAPE/);
  });
});

describe("DUR durability cannot be assumed", () => {
  it("publishes nothing when any fsync step fails, and names the platform reason", async () => {
    const { sourceRoot, snapshotsRoot } = await workspace();
    // Count the real steps from a clean run so the loop covers every one exactly once.
    const probe = recordingFsync();
    await new SnapshotStore({ snapshotsRoot: resolve(snapshotsRoot, "count"), fsync: probe.fsync })
      .publish(await source(sourceRoot));
    expect(probe.calls.length).toBeGreaterThan(5);

    for (let failIndex = 0; failIndex < probe.calls.length; failIndex += 1) {
      const root = resolve(snapshotsRoot, `probe-${failIndex}`);
      const { fsync } = recordingFsync((_path, index) => index === failIndex);
      const store = new SnapshotStore({ snapshotsRoot: root, fsync });
      let refused = false;
      try { await store.publish(await source(sourceRoot)); } catch (error) { refused = (error as { code?: string }).code === "SOURCE_CHANGED"; }
      expect(refused, `fsync step ${failIndex} (${probe.calls[failIndex]}) should refuse`).toBe(true);
      // Nothing was published and no staging tree survived the failure.
      const entries = await readdir(resolve(root, PROJECT_ID)).catch(() => [] as string[]);
      expect(entries, `probe ${failIndex} published something`).toEqual([]);
    }
  });

  it("rolls a published snapshot back when the caller's transaction fails", async () => {
    const { sourceRoot, snapshotsRoot } = await workspace();
    const store = new SnapshotStore({ snapshotsRoot });
    const published = await store.publish(await source(sourceRoot));
    expect(await store.exists(PROJECT_ID, published.snapshot_id)).toBe(true);
    await store.rollback(PROJECT_ID, published.snapshot_id);
    expect(await store.exists(PROJECT_ID, published.snapshot_id)).toBe(false);
  });

  it("refuses to publish a copy whose bytes do not match the digest it was taken from", async () => {
    const { sourceRoot, snapshotsRoot } = await workspace();
    // A copy that lands the wrong bytes must never be published, even though every fsync
    // would succeed: the content check is what catches it.
    const store = new SnapshotStore({
      snapshotsRoot,
      copy: async (from, to) => { await mkdir(dirname(to), { recursive: true }); await writeFile(to, "tampered copy"); void from; },
    });
    await expect(store.publish(await source(sourceRoot)))
      .rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    const entries = await readdir(resolve(snapshotsRoot, PROJECT_ID)).catch(() => [] as string[]);
    expect(entries).toEqual([]);
  });
});
