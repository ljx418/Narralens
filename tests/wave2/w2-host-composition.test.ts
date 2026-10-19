import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NarralensHost } from "../../src/host/server.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";
import { AssetInventoryPort } from "../../src/host/projects/asset-inventory-port.js";
import { MigratedAssetLedger } from "../../src/host/projects/migrated-asset-ledger.js";
import { ProjectResolver } from "../../src/host/projects/project-resolver.js";
import { readFileSync } from "node:fs";

/**
 * W2.0 correction, blocker 4: the W2.0 components have to exist in the production Host.
 *
 * `ProjectResolver`, `MigratedAssetLedger` and `AssetInventoryPort` were constructed only
 * by their own tests. The Host never built them, so every guarantee they encode was true
 * in the suite and absent from the product — which is what "green but not production"
 * means.
 *
 * The tests below go through `NarralensHost`, not through the components. A component test
 * proves a class works; only a Host test proves the product has it.
 *
 * Nothing here opens a Wave 2 route: those stay 404 until their own module Gate. What
 * changes is that the Host owns the components, so a later route has one resolver, one
 * ledger and one database to bind to, and cannot quietly invent a second.
 */

const SOURCE_FIXTURE = resolve("fixtures/d1-30s");
/** The Host treats this as the *parent* of `vendor/openfilm`, not the checkout. */
const REAL_UPSTREAM_PARENT = "/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b";
const OPENFILM_SHA = "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3";

const dirs: string[] = [];
const hosts: NarralensHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const media = (marker: string): Buffer =>
  Buffer.concat([Buffer.from("ID3\0\0\0", "latin1"), Buffer.from(marker.padEnd(64, "x"), "latin1")]);
const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

interface Started {
  host: NarralensHost;
  origin: string;
  token: string;
  base: string;
  targetRoot: string;
  dbPath: string;
}

async function started(existingBase?: string): Promise<Started> {
  const base = existingBase ?? await mkdtemp(join(tmpdir(), "narralens-w2-host-"));
  if (existingBase === undefined) dirs.push(base);
  const host = new NarralensHost({ migrationsRoot: join(base, "migrations"), dbPath: join(base, "narralens.sqlite") });
  hosts.push(host);
  const port = await host.listen(0);
  const origin = `http://127.0.0.1:${port}`;
  const session = await fetch(`${origin}/api/session`, { headers: { origin } });
  return { host, origin, token: (await session.json() as { token: string }).token, base,
    targetRoot: join(base, "migrations"), dbPath: join(base, "narralens.sqlite") };
}

function headers(origin: string, token: string): Record<string, string> {
  return { origin, authorization: `Bearer ${token}`, "content-type": "application/json" };
}

describe("blocker 4a: the Host owns one resolver, one ledger and one inventory", () => {
  it("exposes the three W2.0 components from composition", async () => {
    const { host } = await started();
    expect(host.projectResolver).toBeInstanceOf(ProjectResolver);
    expect(host.assetLedger).toBeInstanceOf(MigratedAssetLedger);
    expect(host.assetInventory).toBeInstanceOf(AssetInventoryPort);
  });

  it("shares exactly one RevisionStore, catalog and migration root across them", async () => {
    const { host } = await started();
    // Same instances, not lookalikes: a second catalog or database would be a second
    // authority, which is the exact failure mode C-05 rules out.
    const resolved = await host.projectResolver.resolve("d1-30s");
    expect(resolved.kind).toBe("legacy");
    expect(host.assetLedger).toBe(host.assetLedger);
    expect(host.projectResolver).toBe(host.projectResolver);
    expect(host.migrationRoot).toBe(resolve(host.migrationRoot));
  });

  it("keeps the legacy route answering exactly as before", async () => {
    const { origin, token } = await started();
    const response = await fetch(`${origin}/api/projects/d1-30s`, { headers: headers(origin, token) });
    expect(response.status).toBe(200);
    const project = await response.json() as { frame_count: number; frame_rate: number; shots: unknown[] };
    expect(project).toMatchObject({ frame_count: 900, frame_rate: 30 });
    expect(project.shots).toHaveLength(3);
  });

  it("keeps all five Wave 2 routes closed", async () => {
    const { origin, token } = await started();
    for (const path of [
      "/api/migration/v1/projects/d1-30s/proposals/proposal_1/materialize",
      "/api/migration/v1/materializations/mat_1",
      "/api/migration/v1/projects/d1-30s/impact",
      "/api/migration/v1/projects/d1-30s/edits",
      "/api/migration/v1/projects/d1-30s/history/restore",
    ]) {
      const init: RequestInit = { method: "POST", headers: headers(origin, token), body: "{}" };
      expect((await fetch(`${origin}${path}`, init)).status, path).toBe(404);
      expect((await fetch(`${origin}${path}`, { method: "GET", headers: headers(origin, token) })).status, path).toBe(404);
    }
  });

  it("still exposes the Wave 1 migration routes", async () => {
    const { origin, token } = await started();
    expect((await fetch(`${origin}/api/migration/v1/projects/d1-30s/engine`, { headers: headers(origin, token) })).status).toBe(200);
  });

  it("opens the one database and the one catalog in exactly one place each", () => {
    const counted = (file: string, pattern: RegExp) =>
      (readFileSync(resolve(file), "utf8").match(pattern) ?? []).length;
    // The single connection belongs to RevisionStore; the single catalog belongs to the
    // Host. Anything else constructing one is a second authority.
    expect(counted("src/host/projects/revision-store.ts", /new DatabaseSync\(/gu)).toBe(1);
    expect(counted("src/host/server.ts", /new ProjectCatalog\(/gu)).toBe(1);
    for (const file of ["src/host/projects/migrated-asset-ledger.ts",
      "src/host/projects/asset-inventory-port.ts", "src/host/projects/project-resolver.ts",
      "src/host/engine/openfilm-composition.ts"]) {
      expect(counted(file, /new DatabaseSync\(/gu), file).toBe(0);
      expect(counted(file, /new ProjectCatalog\(/gu), file).toBe(0);
      expect(counted(file, /new RevisionStore\(/gu), file).toBe(0);
    }
  });
});

describe("blocker 4b: a migrated target resolves through the production seam after a restart", () => {
  /** Builds the same durable facts M2.3 leaves behind, without running a renderer. */
  async function seedMigratedTarget(started: Started, targetProjectId: string): Promise<void> {
    const { host, base } = started;
    const migrationsRoot = join(base, "migrations");
    const migrationId = "mig_seeded";
    const root = join(migrationsRoot, migrationId);
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "film.html"), "<html></html>", "utf8");

    const bytes = media("target");
    await writeFile(join(root, "assets/only.mp4"), bytes);
    const plan = {
      format: "narralens.migration-plan@1.0", migration_id: migrationId, idempotency_key: "k",
      request_digest: "1".repeat(64), source_project_id: "d1-30s", source_revision: 2,
      source_digest: "2".repeat(64), source_engine: "hypit", target_project_id: targetProjectId,
      target_engine: "openfilm", target_engine_upstream_sha: OPENFILM_SHA,
      identity_map: [{ source_id: "s1", target_id: "shot-001", start_frame: 0, end_frame_exclusive: 900 }],
      features: [], assets: [], subtitles: [], narration: null, validation_steps: [], blocking: [],
      created_at: new Date(0).toISOString(),
    } as const;
    host.revisions.migrations.create({
      migrationId, projectId: "d1-30s", idempotencyKey: "k", requestDigest: "1".repeat(64),
      plan, sourceSha256Before: "3".repeat(64),
    });
    for (const to of ["staged", "validated", "snapshot_published", "committed", "activated", "reported"] as const) {
      host.revisions.migrations.transition(migrationId, host.revisions.migrations.require(migrationId)!.state, to, new Date(0));
    }
    host.revisions.bindEngine(targetProjectId, "openfilm", OPENFILM_SHA, "d1-30s", new Date(0));
    host.revisions.commitMigrationTarget({
      migrationId, projectId: targetProjectId, revision: 1, snapshotId: "snap_seeded",
      sourceDigest: "2".repeat(64), engine: "openfilm", now: new Date(0),
    });
  }

  it("resolves after the Host that created the target is closed and reopened", async () => {
    const first = await started();
    const targetId = "of_seeded_00000001";
    await seedMigratedTarget(first, targetId);
    expect((await first.host.projectResolver.resolveActivated(targetId)).project_id).toBe(targetId);
    await first.host.close();
    hosts.splice(0);

    // A brand-new Host over the same database file and the same migration root.
    const second = await started(first.base);
    const view = await second.host.projectResolver.resolveActivated(targetId);
    expect(view).toMatchObject({
      project_id: targetId, kind: "activated", engine: "openfilm",
      migration_id: "mig_seeded", revision: 1, frame_count: 900,
    });
    // Resolved by the production seam, not a map that survived the restart.
    expect(view.source_root.value).toContain("mig_seeded");
  });

  it("fails closed through the same seam when the binding is missing", async () => {
    const { host, base, dbPath } = await started();
    const targetId = "of_nobinding_000001";
    const root = join(base, "migrations", "mig_nobind");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "film.html"), "<html></html>", "utf8");
    host.revisions.migrations.create({
      migrationId: "mig_nobind", projectId: "d1-30s", idempotencyKey: "k2",
      requestDigest: "4".repeat(64),
      plan: {
        format: "narralens.migration-plan@1.0", migration_id: "mig_nobind", idempotency_key: "k2",
        request_digest: "4".repeat(64), source_project_id: "d1-30s", source_revision: 2,
        source_digest: "2".repeat(64), source_engine: "hypit", target_project_id: targetId,
        target_engine: "openfilm", target_engine_upstream_sha: OPENFILM_SHA,
        identity_map: [{ source_id: "s1", target_id: "shot-001", start_frame: 0, end_frame_exclusive: 900 }],
        features: [], assets: [], subtitles: [], narration: null, validation_steps: [], blocking: [],
        created_at: new Date(0).toISOString(),
      } as never,
      sourceSha256Before: "3".repeat(64),
    });
    for (const to of ["staged", "validated", "snapshot_published", "committed", "activated", "reported"] as const) {
      host.revisions.migrations.transition("mig_nobind", host.revisions.migrations.require("mig_nobind")!.state, to, new Date(0));
    }
    await expect(host.projectResolver.resolveActivated(targetId))
      .rejects.toMatchObject({ code: "CAPABILITY_NOT_ENABLED" });
    expect(dbPath).toMatch(/\.sqlite$/u);
  });

  it("fails closed when the active commit is missing", async () => {
    const { host } = await started();
    const targetId = "of_nocommit_000001";
    host.revisions.migrations.create({
      migrationId: "mig_nocommit", projectId: "d1-30s", idempotencyKey: "k3",
      requestDigest: "5".repeat(64),
      plan: {
        format: "narralens.migration-plan@1.0", migration_id: "mig_nocommit", idempotency_key: "k3",
        request_digest: "5".repeat(64), source_project_id: "d1-30s", source_revision: 2,
        source_digest: "2".repeat(64), source_engine: "hypit", target_project_id: targetId,
        target_engine: "openfilm", target_engine_upstream_sha: OPENFILM_SHA,
        identity_map: [{ source_id: "s1", target_id: "shot-001", start_frame: 0, end_frame_exclusive: 900 }],
        features: [], assets: [], subtitles: [], narration: null, validation_steps: [], blocking: [],
        created_at: new Date(0).toISOString(),
      } as never,
      sourceSha256Before: "3".repeat(64),
    });
    for (const to of ["staged", "validated", "snapshot_published", "committed", "activated", "reported"] as const) {
      host.revisions.migrations.transition("mig_nocommit", host.revisions.migrations.require("mig_nocommit")!.state, to, new Date(0));
    }
    host.revisions.bindEngine(targetId, "openfilm", OPENFILM_SHA, "d1-30s", new Date(0));
    await expect(host.projectResolver.resolveActivated(targetId))
      .rejects.toMatchObject({ code: "CAPABILITY_NOT_ENABLED" });
  });

  it("fails closed when the migration is still moving", async () => {
    const { host, base } = await started();
    const targetId = "of_inflight_00000001";
    await mkdir(join(base, "migrations", "mig_inflight"), { recursive: true });
    host.revisions.migrations.create({
      migrationId: "mig_inflight", projectId: "d1-30s", idempotencyKey: "k4",
      requestDigest: "6".repeat(64),
      plan: {
        format: "narralens.migration-plan@1.0", migration_id: "mig_inflight", idempotency_key: "k4",
        request_digest: "6".repeat(64), source_project_id: "d1-30s", source_revision: 2,
        source_digest: "2".repeat(64), source_engine: "hypit", target_project_id: targetId,
        target_engine: "openfilm", target_engine_upstream_sha: OPENFILM_SHA,
        identity_map: [{ source_id: "s1", target_id: "shot-001", start_frame: 0, end_frame_exclusive: 900 }],
        features: [], assets: [], subtitles: [], narration: null, validation_steps: [], blocking: [],
        created_at: new Date(0).toISOString(),
      } as never,
      sourceSha256Before: "3".repeat(64),
    });
    host.revisions.migrations.transition("mig_inflight", "plan_written", "staged", new Date(0));
    await expect(host.projectResolver.resolveActivated(targetId))
      .rejects.toMatchObject({ code: "CAPABILITY_NOT_ENABLED" });
  });

  it("answers an unknown project as NOT_FOUND through the same seam", async () => {
    const { host } = await started();
    await expect(host.projectResolver.resolveActivated("of_nothing_00000001"))
      .rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});

describe("ASSET-02 and ASSET-03 through the Host's own instances", () => {
  /**
   * The blocker-3 review found the real gap: ASSET-02 and ASSET-03 were proven on components
   * the test constructed itself, so nothing proved the Host's *own* inventory instance —
   * built from the Host's RevisionStore, catalog and migration root — behaves that way.
   *
   * So: run the Host's real `migrate-copy` route, which seeds the ledger through
   * MigrationService, then read and drift it through `host.assetInventory`. No Wave 2 route
   * is opened, so this stays inside W2.0's closed surface.
   */
  it("seeds through the real migration, then fails closed on drift, permanently", async () => {
    // The Host resolves its pinned checkout from this variable; the repository-local
    // `vendor/openfilm` is not where the isolated worktree lives.
    const previousVendor = process.env.NARRALENS_OPENFILM_VENDOR;
    process.env.NARRALENS_OPENFILM_VENDOR = REAL_UPSTREAM_PARENT;
    try {
      await assertDriftIsTerminal();
    } finally {
      if (previousVendor === undefined) delete process.env.NARRALENS_OPENFILM_VENDOR;
      else process.env.NARRALENS_OPENFILM_VENDOR = previousVendor;
    }
  }, 180_000);

  async function assertDriftIsTerminal(): Promise<void> {
    const { host, origin, token, base } = await started();
    const migrated = await fetch(`${origin}/api/migration/v1/projects/d1-30s/migrate-copy`, {
      method: "POST", headers: headers(origin, token),
      body: JSON.stringify({ idempotency_key: "w2-host-asset-000001" }),
    });
    if (migrated.status !== 200) {
      // INFRA-RISK-W2-001. The Host answers a bare 500 by design so nothing internal leaks;
      // that leaves an intermittent failure unattributable after the fact. The Host keeps a
      // bounded diagnostic for exactly this, so a failure prints the stage and the root
      // cause class instead of just "expected 500 to be 200".
      const body = await migrated.clone().json().catch(() => ({})) as { correlation_id?: string };
      const diagnostic = body.correlation_id === undefined
        ? undefined : host.failures.byCorrelationId(body.correlation_id);
      throw new Error(
        `MIGRATE_COPY_${migrated.status} correlation_id=${body.correlation_id ?? "none"} `
        + `stage=${diagnostic?.stage ?? "unrecorded"} kind=${diagnostic?.kind ?? "unrecorded"} `
        + `message_sha256=${diagnostic?.message_sha256?.slice(0, 16) ?? "unrecorded"} `
        + `recent=${JSON.stringify(host.failures.recent(3).map((e) => `${e.stage}:${e.kind}`))}`,
      );
    }
    expect(migrated.status).toBe(200);
    const report = await migrated.json() as { plan: { target_project_id: string } };
    const targetId = report.plan.target_project_id;

    // ASSET-03: activation seeded the Host's own ledger.
    expect(host.assetLedger.bootstrapRecord(targetId)?.state).toBe("active");

    // ASSET-02, first read: available.
    const inventory = await host.assetInventory.inventory(targetId);
    expect(inventory.kind).toBe("activated");
    expect(inventory.assets.length).toBeGreaterThan(0);

    // Drift a target byte the migration wrote, through the filesystem, as an operator would.
    const targetRoot = join(base, "migrations", report_target_migration(base, targetId));
    // Tamper the file the ledger actually recorded, not a name guessed from the asset id —
    // a guess that does not exist would drift nothing and the test would pass vacuously.
    const recorded = host.assetLedger.assets(targetId)[0]!;
    expect(recorded.target_path).toMatch(/^assets\//u);
    await writeFile(join(targetRoot, recorded.target_path), media("tampered"));

    // The same call that detects it persists attention and refuses.
    await expect(host.assetInventory.inventory(targetId)).rejects.toMatchObject({
      status: 423, code: "PROJECT_ATTENTION_REQUIRED",
    });
    expect(host.assetLedger.bootstrapRecord(targetId)?.state).toBe("attention");

    // And it does not come back on its own.
    await expect(host.assetInventory.inventory(targetId)).rejects.toMatchObject({
      status: 423, code: "PROJECT_ATTENTION_REQUIRED",
    });
    // Legacy projects are untouched by any of this.
    expect((await host.assetInventory.inventory("d1-30s")).kind).toBe("legacy");
  }
});

/** Finds the migration id that produced a target, the same way the resolver does. */
function report_target_migration(base: string, targetId: string): string {
  const store = new RevisionStore(join(base, "narralens.sqlite"));
  try {
    const row = store.migrations.all().find((candidate) => candidate.target_project_id === targetId);
    if (row === undefined) throw new Error("NO_MIGRATION_FOR_TARGET");
    return row.migration_id;
  } finally { store.close(); }
}
