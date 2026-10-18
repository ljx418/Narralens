import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EngineBindingStore, OPENFILM_UPSTREAM_SHA } from "../../src/host/engine/engine-binding-store.js";
import type { MigrationIdentityEntry, MigrationPlanV1, MigrationState } from "../../src/contracts/migration-types.js";
import { ProjectCatalog } from "../../src/host/projects/project-catalog.js";
import { ProjectResolver } from "../../src/host/projects/project-resolver.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";

/**
 * ACT-01 and ACT-02 (W2-G11): the migrated OpenFilm target resolves after a restart, and
 * every way it must not resolve is closed.
 *
 * The thing under test is authority, not convenience. Before the resolver a migrated project
 * was reachable only through `migratedRoots`, an in-process map. C-05 rules that out as an
 * authority, so every assertion below is about what happens when the process that built the
 * map is gone: a fresh `RevisionStore` over the same database must reach the same answer.
 */

const SOURCE_FIXTURE = join(import.meta.dirname, "../fixtures/m2.1/snapshot-project");
const SOURCE_SHA = "d".repeat(64);
const DIGEST = "e".repeat(64);
const TARGET_ID = "of_d1-30s_abcdef12";

const dirs: string[] = [];
const stores: RevisionStore[] = [];
const databasePaths: string[] = [];
afterEach(async () => {
  while (stores.length > 0) stores.pop()!.close();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function plan(migrationId: string, targetProjectId: string, identityMap?: MigrationIdentityEntry[]): MigrationPlanV1 {
  return {
    format: "narralens.migration-plan@1.0", migration_id: migrationId,
    idempotency_key: `${migrationId}-key`, request_digest: "a".repeat(64),
    source_project_id: "d1-30s", source_revision: 3, source_digest: SOURCE_SHA,
    source_engine: "hypit", target_project_id: targetProjectId, target_engine: "openfilm",
    target_engine_upstream_sha: OPENFILM_UPSTREAM_SHA,
    identity_map: identityMap ?? [{ source_id: "s1", target_id: "shot-001", start_frame: 0, end_frame_exclusive: 900 }],
    features: [], assets: [], subtitles: [], narration: null, validation_steps: [], blocking: [],
    created_at: new Date(0).toISOString(),
  };
}

/** Walk a migration forward one legal transition at a time, as production does. */
function advance(revisions: RevisionStore, migrationId: string, upTo: MigrationState): void {
  const forward = ["staged", "validated", "snapshot_published", "committed", "activated", "reported"] as const;
  for (const to of forward) {
    revisions.migrations.transition(migrationId, revisions.migrations.require(migrationId)!.state, to, new Date(0));
    if (to === upTo) return;
  }
  throw new Error(`harness cannot advance to ${upTo}`);
}

interface Options {
  state?: MigrationState;
  bindEngine?: "openfilm" | "hypit" | null;
  commit?: boolean;
  targetExists?: boolean;
  escapeLink?: boolean;
  targetIsSymlink?: boolean;
  bindUpstream?: string;
  emptyIdentityMap?: boolean;
  secondMigration?: boolean;
}

interface Harness {
  resolver: ProjectResolver;
  revisions: RevisionStore;
  migrationRoot: string;
  targetRoot: string;
  dbPath: string;
}

async function harness(options: Options = {}): Promise<Harness> {
  const base = await mkdtemp(join(tmpdir(), "narralens-w2-resolver-"));
  dirs.push(base);
  const migrationRoot = join(base, "migrations");
  const migrationId = "mig_0001";
  const targetRoot = join(migrationRoot, migrationId);
  if (options.targetIsSymlink) {
    // The migration root itself is honest, but the entry for this migration id is a link
    // to a tree outside it. Resolving by realpath and then accepting the result would make
    // "the root is under the migration root" a claim nothing checks.
    const outside = join(base, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "film.html"), "<html></html>", "utf8");
    await mkdir(migrationRoot, { recursive: true });
    await symlink(outside, targetRoot);
  } else {
    await mkdir(targetRoot, { recursive: true });
    await writeFile(join(targetRoot, "film.html"), "<html></html>", "utf8");
  }
  if (options.escapeLink) {
    const outside = join(base, "outside");
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(targetRoot, "escape.html"));
  }
  if (options.targetExists === false) await rm(targetRoot, { recursive: true, force: true });

  const dbPath = join(base, "narralens.sqlite");
  const revisions = new RevisionStore(dbPath);
  stores.push(revisions);
  databasePaths.push(dbPath);
  revisions.migrations.create({
    migrationId, projectId: "d1-30s", idempotencyKey: `${migrationId}-key`,
    requestDigest: "a".repeat(64),
    plan: plan(migrationId, TARGET_ID, options.emptyIdentityMap ? [] : undefined),
    sourceSha256Before: SOURCE_SHA,
  });
  switch (options.state) {
    case undefined: advance(revisions, migrationId, "reported"); break;
    case "aborted": revisions.migrations.transition(migrationId, "plan_written", "aborted", new Date(0)); break;
    case "committed": advance(revisions, migrationId, "committed"); break;
    case "attention": revisions.migrations.transition(migrationId, "plan_written", "attention", new Date(0)); break;
    case "recovering": revisions.migrations.markRecovering(migrationId, "resolver harness", new Date(0)); break;
    default: advance(revisions, migrationId, options.state);
  }
  revisions.migrations.setTargetSnapshot(migrationId, `snap_${migrationId}`, DIGEST, new Date(0));

  if (options.secondMigration) {
    const second = "mig_0002";
    await mkdir(join(migrationRoot, second), { recursive: true });
    revisions.migrations.create({
      migrationId: second, projectId: "d1-30s", idempotencyKey: `${second}-key`,
      requestDigest: "b".repeat(64), plan: plan(second, TARGET_ID), sourceSha256Before: SOURCE_SHA,
    });
    advance(revisions, second, "reported");
    revisions.migrations.setTargetSnapshot(second, `snap_${second}`, DIGEST, new Date(0));
  }

  if (options.bindEngine !== null) {
    revisions.bindEngine(TARGET_ID, options.bindEngine ?? "openfilm",
      options.bindUpstream ?? OPENFILM_UPSTREAM_SHA, "d1-30s", new Date(0));
  }
  if (options.commit !== false) {
    revisions.commitMigrationTarget({
      migrationId, projectId: TARGET_ID, revision: 1, snapshotId: `snap_${migrationId}`,
      sourceDigest: DIGEST, engine: "openfilm", now: new Date(0),
    });
  }

  return {
    resolver: new ProjectResolver({
      catalog: new ProjectCatalog(new Map([["d1-30s", join(SOURCE_FIXTURE, "narralens.project.json")]])),
      revisions, migrationRoot,
    }),
    revisions, migrationRoot, targetRoot, dbPath,
  };
}

describe("ACT-01 a terminal migrated target resolves from durable facts alone", () => {
  it("resolves after the process that migrated it is gone", async () => {
    const { resolver, targetRoot, migrationRoot } = await harness();
    const view = await resolver.resolveActivated(TARGET_ID);
    expect(view).toMatchObject({
      project_id: TARGET_ID, kind: "activated", engine: "openfilm",
      engine_upstream_sha: OPENFILM_UPSTREAM_SHA, migrated_from: "d1-30s",
      migration_id: "mig_0001", revision: 1, snapshot_id: "snap_mig_0001", source_digest: DIGEST,
      frame_count: 900, fps: { num: 30, den: 1 },
    });
    expect(view.source_root.value).toBe(await realpath(targetRoot));
    expect(view.source_root.value.startsWith(await realpath(migrationRoot))).toBe(true);
  });

  it("reaches the same answer through a store reopened on the same database file", async () => {
    const { resolver, revisions, migrationRoot, dbPath } = await harness();
    const before = await resolver.resolveActivated(TARGET_ID);
    revisions.close();
    stores.length = 0;

    const reopened = new RevisionStore(dbPath);
    stores.push(reopened);
    const after = await new ProjectResolver({
      catalog: new ProjectCatalog(new Map([["d1-30s", join(SOURCE_FIXTURE, "narralens.project.json")]])),
      revisions: reopened, migrationRoot,
    }).resolveActivated(TARGET_ID);
    // Compare the projections and the Host-only root; `publicView` is a fresh closure
    // each time, so comparing the views directly would compare two functions.
    expect(after.publicView()).toEqual(before.publicView());
    expect(after.source_root.value).toBe(before.source_root.value);
  });

  it("resolves a legacy catalog project through the same seam, without inventing a migration", async () => {
    const { resolver } = await harness();
    const view = await resolver.resolve("d1-30s");
    expect(view.kind).toBe("legacy");
    if (view.kind === "legacy") {
      expect(view.project.project_id).toBe("d1-30s");
      // A legacy project carries no migration: the resolver must not invent one.
      expect(view.source_root.value.endsWith("snapshot-project")).toBe(true);
    }
  });

  it("carries no path, URL or shell argument in the client-visible projection", async () => {
    const { resolver } = await harness();
    const publicView = (await resolver.resolveActivated(TARGET_ID)).publicView();
    expect(JSON.stringify(publicView)).not.toContain("/");
    expect(JSON.stringify(publicView)).not.toContain("://");
  });
});

describe("ACT-02 every way a migrated target must not resolve is closed", () => {
  it("refuses a migration that has not reached a terminal state", async () => {
    await expect((await harness({ state: "committed" })).resolver.resolveActivated(TARGET_ID))
      .rejects.toMatchObject({ status: 404, code: "CAPABILITY_NOT_ENABLED" });
  });

  it("refuses an aborted migration even though it is terminal", async () => {
    await expect((await harness({ state: "aborted" })).resolver.resolveActivated(TARGET_ID))
      .rejects.toMatchObject({ status: 404, code: "CAPABILITY_NOT_ENABLED" });
  });

  it("refuses a migration in attention, and a recovery-parked one, with 423", async () => {
    await expect((await harness({ state: "attention" })).resolver.resolveActivated(TARGET_ID))
      .rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
    await expect((await harness({ state: "recovering" })).resolver.resolveActivated(TARGET_ID))
      .rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
  });

  it("refuses when the target root does not exist on disk", async () => {
    await expect((await harness({ targetExists: false })).resolver.resolveActivated(TARGET_ID))
      .rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
  });

  it("refuses a migration root entry that is a symlink out of the migration root", async () => {
    await expect((await harness({ targetIsSymlink: true })).resolver.resolveActivated(TARGET_ID))
      .rejects.toMatchObject({ status: 403, code: "ORIGIN_REJECTED" });
  });

  it("never adopts a symlinked path as the target's own tree", async () => {
    const { resolver, targetRoot } = await harness({ escapeLink: true });
    const view = await resolver.resolveActivated(TARGET_ID);
    expect(view.source_root.value).toBe(await realpath(targetRoot));
    expect(view.source_root.value).not.toContain("outside");
  });

  it("refuses a target with no engine binding and one with no active commit", async () => {
    await expect((await harness({ bindEngine: null })).resolver.resolveActivated(TARGET_ID))
      .rejects.toMatchObject({ status: 404, code: "CAPABILITY_NOT_ENABLED" });
    await expect((await harness({ commit: false })).resolver.resolveActivated(TARGET_ID))
      .rejects.toMatchObject({ status: 404, code: "CAPABILITY_NOT_ENABLED" });
  });

  it("refuses a binding to an engine the migration did not target", async () => {
    await expect((await harness({ bindEngine: "hypit" })).resolver.resolveActivated(TARGET_ID))
      .rejects.toMatchObject({ status: 404, code: "CAPABILITY_NOT_ENABLED" });
  });

  it("refuses a binding pinned to an OpenFilm upstream other than the frozen one", async () => {
    await expect((await harness({ bindUpstream: "0".repeat(40) })).resolver.resolveActivated(TARGET_ID))
      .rejects.toMatchObject({ status: 404, code: "CAPABILITY_NOT_ENABLED" });
  });

  it("refuses a migration that placed no content at all", async () => {
    await expect((await harness({ emptyIdentityMap: true })).resolver.resolveActivated(TARGET_ID))
      .rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
  });

  it("refuses an unknown project id the same way whether or not a migration exists", async () => {
    const { resolver } = await harness();
    const unknown = resolver.resolveActivated("of_unknown_00000000");
    await expect(unknown).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    await expect(resolver.resolveActivated(TARGET_ID)).resolves.toBeTruthy();
    await expect(resolver.resolveActivated("of_unknown_00000000"))
      .rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("refuses an ambiguous target that two terminal migrations both claim", async () => {
    await expect((await harness({ secondMigration: true })).resolver.resolveActivated(TARGET_ID))
      .rejects.toMatchObject({ status: 404, code: "CAPABILITY_NOT_ENABLED" });
  });
});
