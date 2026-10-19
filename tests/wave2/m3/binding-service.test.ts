import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BindingService, bindingDigest, rightsDigest } from "../../../src/host/materialize/binding-service.js";
import { AssetInventoryPort } from "../../../src/host/projects/asset-inventory-port.js";
import { AssetRegistry } from "../../../src/host/projects/asset-registry.js";
import { MigratedAssetLedger } from "../../../src/host/projects/migrated-asset-ledger.js";
import { ProjectCatalog } from "../../../src/host/projects/project-catalog.js";
import { ProjectResolver } from "../../../src/host/projects/project-resolver.js";
import { RevisionStore } from "../../../src/host/projects/revision-store.js";
import { treeDigest } from "../../../src/host/projects/openfilm-migrator.js";
import { OPENFILM_UPSTREAM_SHA } from "../../../src/host/engine/engine-binding-store.js";
import type { AssetLicense, AssetManifestEntry, AssetSource, ProposalComparison } from "../../../src/contracts/types.js";
import type { MigrationAssetMapping, MigrationPlanV1 } from "../../../src/contracts/migration-types.js";

/**
 * M3.1: binding a target-owned proposal to registered assets.
 *
 * Everything here goes through the production `ProjectResolver` and `AssetInventoryPort`
 * over a real ledger, because the point of this service is that it reads facts rather than
 * trusting a request. A fake inventory would prove only that the arithmetic works.
 */

const SOURCE_ID = "d1-30s";
const TARGET_ID = "of_d1-30s_abcdef12";
const MIGRATION_ID = "mig_0001";
const COMPARISON_ID = "cmp_1";
const PROPOSAL_ID = "proposal_1";

const dirs: string[] = [];
const stores: RevisionStore[] = [];
afterEach(async () => {
  while (stores.length > 0) stores.pop()!.close();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const license = (over: Partial<AssetLicense> = {}): AssetLicense =>
  ({ status: "cleared", label: "自有素材", commercial_use: true, ...over });
const origin = (): AssetSource => ({ kind: "owned", label: "本地素材" });
const media = (marker: string): Buffer =>
  Buffer.concat([Buffer.from("ID3\0\0\0", "latin1"), Buffer.from(marker.padEnd(64, "x"), "latin1")]);
const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

interface Harness {
  service: BindingService;
  revisions: RevisionStore;
  ledger: MigratedAssetLedger;
  inventory: AssetInventoryPort;
  comparisons: Map<string, ProposalComparison>;
  targetRoot: string;
}

async function harness(options: { seed?: boolean | "restricted" } = {}): Promise<Harness> {
  const base = await mkdtemp(join(tmpdir(), "narralens-m31-bind-"));
  dirs.push(base);
  const sourceRoot = join(base, "source");
  const migrationRoot = join(base, "migrations");
  const targetRoot = join(migrationRoot, MIGRATION_ID);
  await mkdir(join(sourceRoot, "media"), { recursive: true });
  await mkdir(join(sourceRoot, "runs"), { recursive: true });
  await mkdir(join(targetRoot, "assets"), { recursive: true });
  await writeFile(join(sourceRoot, "runs/build.svrun"), "<svrun/>", "utf8");
  await writeFile(join(sourceRoot, "narration.wav"), media("narration"), "utf8");

  const entries: AssetManifestEntry[] = [];
  const planned: MigrationAssetMapping[] = [];
  for (const marker of ["a", "b", "c"]) {
    const bytes = media(marker);
    entries.push({
      asset_id: `asset_${marker}`, project_path: `media/${marker}.mp4`, sha256: sha(bytes),
      media_type: "video/mp4", kind: "video", duration_frames: 600, source: origin(),
      license: marker === "b" && options.seed === "restricted" ? license({ status: "restricted", commercial_use: false }) : license(),
    });
    await writeFile(join(sourceRoot, `media/${marker}.mp4`), bytes);
    await writeFile(join(targetRoot, `assets/${marker}.mp4`), bytes);
    planned.push({ source_path: `media/${marker}.mp4`, target_path: `assets/${marker}.mp4`, sha256: sha(bytes), asset_id: null });
  }
  await writeFile(join(sourceRoot, "assets.manifest.json"),
    JSON.stringify({ format: "narralens.asset-manifest@2", assets: entries }), "utf8");
  await writeFile(join(sourceRoot, "narralens.project.json"), JSON.stringify({
    project_id: SOURCE_ID, revision: 3, frame_rate: 30, frame_count: 900,
    shots: [{ shot_id: "shot-001", authoring_id: "shot-1", start_frame: 0, end_frame_exclusive: 900 }],
    preview: { kind: "hypit-studio", url: "http://127.0.0.1:4174/" },
    run_file: "runs/build.svrun", studio_origin: "http://127.0.0.1:4174",
    narration_asset: "narration.wav", asset_manifest: "assets.manifest.json",
  }), "utf8");

  const revisions = new RevisionStore();
  stores.push(revisions);
  const catalog = new ProjectCatalog(new Map([[SOURCE_ID, join(sourceRoot, "narralens.project.json")]]));
  const registry = new AssetRegistry(catalog, { videoFrames: async () => 600 });
  const sourceSha256Before = await treeDigest(sourceRoot);
  const plan: MigrationPlanV1 = {
    format: "narralens.migration-plan@1.0", migration_id: MIGRATION_ID, idempotency_key: "k",
    request_digest: "6".repeat(64), source_project_id: SOURCE_ID, source_revision: 3,
    source_digest: "5".repeat(64), source_engine: "hypit", target_project_id: TARGET_ID,
    target_engine: "openfilm", target_engine_upstream_sha: OPENFILM_UPSTREAM_SHA,
    identity_map: [{ source_id: "s1", target_id: "shot-001", start_frame: 0, end_frame_exclusive: 900 }],
    features: [], assets: planned, subtitles: [], narration: null, validation_steps: [], blocking: [],
    created_at: new Date(0).toISOString(),
  };
  revisions.migrations.create({
    migrationId: MIGRATION_ID, projectId: SOURCE_ID, idempotencyKey: "k",
    requestDigest: "6".repeat(64), plan, sourceSha256Before,
  });
  for (const to of ["staged", "validated", "snapshot_published", "committed", "activated", "reported"] as const) {
    revisions.migrations.transition(MIGRATION_ID, revisions.migrations.require(MIGRATION_ID)!.state, to, new Date(0));
  }
  revisions.bindEngine(TARGET_ID, "openfilm", OPENFILM_UPSTREAM_SHA, SOURCE_ID, new Date(0));
  revisions.commitMigrationTarget({
    migrationId: MIGRATION_ID, projectId: TARGET_ID, revision: 4, snapshotId: "snap_1",
    sourceDigest: "4".repeat(64), engine: "openfilm", now: new Date(0),
  });

  const ledger = MigratedAssetLedger.create({ revisions, registry, catalog, migrationRoot });
  if (options.seed !== false) await ledger.bootstrap({ projectId: TARGET_ID });
  const resolver = new ProjectResolver({ catalog, revisions, migrationRoot });
  const inventory = new AssetInventoryPort({ resolver, registry, ledger });
  const comparisons = new Map<string, ProposalComparison>();
  comparisons.set(COMPARISON_ID, comparison());
  const service = new BindingService({
    resolver, inventory, readComparison: async (id) => {
      const found = comparisons.get(id);
      if (found === undefined) throw Object.assign(new Error("not found"), { status: 404 });
      return found;
    },
  });
  return { service, revisions, ledger, inventory, comparisons, targetRoot };
}

function comparison(over: Partial<ProposalComparison> = {}): ProposalComparison {
  return {
    schema_version: "1.0", kind: "narralens.proposal_comparison", comparison_id: COMPARISON_ID,
    project_id: TARGET_ID, base_revision: 4,
    selection: { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 900 },
    intent_sha256: "a".repeat(64), preserve: ["narration"], proposal_count: 1,
    proposals: [{
      proposal_id: PROPOSAL_ID, title: "三镜", summary: "s",
      strategy: { kind: "chronology", rationale: "r" },
      segments: [
        { segment_id: "seg-1", duration_frames: 300, role: "anchor", intent: "i", asset_requirement_ids: [] },
        { segment_id: "seg-2", duration_frames: 300, role: "context", intent: "i", asset_requirement_ids: [] },
        { segment_id: "seg-3", duration_frames: 300, role: "conclusion", intent: "i", asset_requirement_ids: [] },
      ],
      assets_needed: [], source_refs: [], requires_materialization: true, renderable: false,
      materialization_cost: { status: "unknown", currency: null, amount: null },
    }],
    generation_audit: { stdout_sha256: "b".repeat(64), model_names: [], total_cost_usd: null,
      duration_ms: null, num_turns: null, service_tier: null },
    created_at: new Date(0).toISOString(),
    ...over,
  };
}

const FULL = [
  { segment_id: "seg-1", asset_id: "asset_a", source_start_frame: 0, source_end_frame_exclusive: 300 },
  { segment_id: "seg-2", asset_id: "asset_b", source_start_frame: 0, source_end_frame_exclusive: 300 },
  { segment_id: "seg-3", asset_id: "asset_c", source_start_frame: 0, source_end_frame_exclusive: 300 },
];

async function bind(h: Harness, requested: unknown = FULL, over: Record<string, unknown> = {}) {
  return await h.service.bind({
    projectId: TARGET_ID, comparisonId: COMPARISON_ID, proposalId: PROPOSAL_ID,
    baseRevision: 4, requested: requested as never, ...over,
  });
}

describe("M3.1 a well-formed request binds three segments to three registered assets", () => {
  it("places each segment on the timeline exactly where the proposal says", async () => {
    const h = await harness();
    const result = await bind(h);
    expect(result.bindings).toHaveLength(3);
    expect(result.bindings.map((b) => [b.segment_id, b.target_start_frame, b.target_end_frame_exclusive]))
      .toEqual([["seg-1", 0, 300], ["seg-2", 300, 600], ["seg-3", 600, 900]]);
    expect(result.total_frames).toBe(900);
  });

  it("re-reads the asset facts rather than echoing the request", async () => {
    const h = await harness();
    const result = await bind(h);
    // The spans come from the request; the hashes, frame counts and rights do not.
    expect(result.bindings[0]!.source_end_frame_exclusive).toBe(300);
    expect(result.bindings[0]!.asset_sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.bindings[0]!.duration_frames).toBe(300);
    expect(result.bindings[0]!.license_status).toBe("cleared");
    expect(result.asset_inventory_sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("binds deterministically, so the same request yields the same digests", async () => {
    const h = await harness();
    const first = await bind(h);
    const second = await bind(h);
    expect(second.binding_digest).toBe(first.binding_digest);
    expect(second.rights_digest).toBe(first.rights_digest);
    // Reordering the request must not change what film is described.
    const reordered = await bind(h, [FULL[2]!, FULL[0]!, FULL[1]!]);
    expect(reordered.binding_digest).toBe(first.binding_digest);
  });

  it("cuts a longer asset exactly, never looping or slowing it", async () => {
    const h = await harness();
    const result = await bind(h, [
      { segment_id: "seg-1", asset_id: "asset_a", source_start_frame: 150, source_end_frame_exclusive: 450 },
      FULL[1]!, FULL[2]!,
    ]);
    expect(result.bindings[0]).toMatchObject({
      source_start_frame: 150, source_end_frame_exclusive: 450,
      target_start_frame: 0, target_end_frame_exclusive: 300,
    });
  });
});

describe("M3.1 a comparison from another project cannot be rebound", () => {
  it("refuses a comparison recorded against the source project", async () => {
    const h = await harness();
    h.comparisons.set(COMPARISON_ID, comparison({ project_id: SOURCE_ID }));
    await expect(bind(h)).rejects.toMatchObject({
      status: 409, code: "REVISION_CONFLICT",
      details: { comparison_project_id: SOURCE_ID },
    });
  });

  it("refuses a comparison built against a different base revision", async () => {
    const h = await harness();
    await expect(bind(h, FULL, { baseRevision: 5 })).rejects.toMatchObject({
      status: 409, code: "REVISION_CONFLICT",
    });
  });

  it("refuses a proposal that is not in the comparison", async () => {
    const h = await harness();
    await expect(bind(h, FULL, { proposalId: "proposal_other" }))
      .rejects.toMatchObject({ status: 404 });
  });

  it("refuses a legacy project, which has no comparable target", async () => {
    const h = await harness();
    await expect(h.service.bind({
      projectId: SOURCE_ID, comparisonId: COMPARISON_ID, proposalId: PROPOSAL_ID,
      baseRevision: 4, requested: FULL,
    })).rejects.toMatchObject({ status: 422, code: "UNSUPPORTED_EDIT" });
  });
});

describe("M3.1 one binding per segment, and nothing else", () => {
  it("refuses a missing binding", async () => {
    const h = await harness();
    await expect(bind(h, [FULL[0]!, FULL[1]!]))
      .rejects.toMatchObject({ status: 422, code: "UNSUPPORTED_EDIT" });
  });

  it("refuses a duplicated segment", async () => {
    const h = await harness();
    await expect(bind(h, [FULL[0]!, FULL[0]!, FULL[1]!, FULL[2]!]))
      .rejects.toMatchObject({ status: 422, code: "UNSUPPORTED_EDIT" });
  });

  it("refuses a segment that does not exist in the proposal", async () => {
    const h = await harness();
    await expect(bind(h, [...FULL, { segment_id: "seg-9", asset_id: "asset_a",
      source_start_frame: 0, source_end_frame_exclusive: 300 }]))
      .rejects.toMatchObject({ status: 422, code: "UNSUPPORTED_EDIT" });
  });

  it("refuses an unknown asset", async () => {
    const h = await harness();
    await expect(bind(h, [{ ...FULL[0]!, asset_id: "asset_nope" }, FULL[1]!, FULL[2]!]))
      .rejects.toMatchObject({ status: 422, code: "MISSING_ASSET" });
  });
});

describe("M3.1 a short or out-of-range source span is refused, not worked around", () => {
  it("refuses a span shorter than the segment rather than looping or freezing", async () => {
    const h = await harness();
    await expect(bind(h, [
      { segment_id: "seg-1", asset_id: "asset_a", source_start_frame: 0, source_end_frame_exclusive: 299 },
      FULL[1]!, FULL[2]!,
    ])).rejects.toMatchObject({ status: 422, code: "INVALID_RANGE",
      details: { required_frames: 300, span_frames: 299 } });
  });

  it("refuses a span that runs past the end of the asset", async () => {
    const h = await harness();
    await expect(bind(h, [
      { segment_id: "seg-1", asset_id: "asset_a", source_start_frame: 400, source_end_frame_exclusive: 700 },
      FULL[1]!, FULL[2]!,
    ])).rejects.toMatchObject({ status: 422, code: "INVALID_RANGE" });
  });

  it("refuses an empty, negative or fractional span", async () => {
    const h = await harness();
    for (const span of [
      { source_start_frame: 100, source_end_frame_exclusive: 100 },
      { source_start_frame: -10, source_end_frame_exclusive: 290 },
      { source_start_frame: 0.5, source_end_frame_exclusive: 300.5 },
    ]) {
      await expect(bind(h, [{ ...FULL[0]!, ...span }, FULL[1]!, FULL[2]!]), JSON.stringify(span))
        .rejects.toMatchObject({ status: 422, code: "INVALID_RANGE" });
    }
  });
});

describe("M3.1 rights are read from the ledger, not taken from the request", () => {
  it("refuses a segment bound to an asset whose licence bars it", async () => {
    const h = await harness({ seed: "restricted" });
    await expect(bind(h, [FULL[0]!, FULL[1]!, FULL[2]!]))
      .rejects.toMatchObject({ status: 422, code: "MISSING_ASSET" });
  });

  it("changes the rights digest when the underlying licence facts change", () => {
    const base = [{ segment_id: "seg-1", asset_id: "asset_a", source_start_frame: 0,
      source_end_frame_exclusive: 300, target_start_frame: 0, target_end_frame_exclusive: 300,
      asset_sha256: "a".repeat(64), duration_frames: 300, license_status: "cleared", commercial_use: true }];
    const restricted = base.map((b) => ({ ...b, license_status: "restricted", commercial_use: false }));
    expect(rightsDigest(base, "i".repeat(64))).not.toBe(rightsDigest(restricted, "i".repeat(64)));
    expect(rightsDigest(base, "i".repeat(64))).not.toBe(rightsDigest(base, "j".repeat(64)));
  });

  it("changes the binding digest when a span moves, and not when only the request order does", () => {
    const a = { segment_id: "seg-1", asset_id: "asset_a", source_start_frame: 0,
      source_end_frame_exclusive: 300, target_start_frame: 0, target_end_frame_exclusive: 300,
      asset_sha256: "a".repeat(64), duration_frames: 300, license_status: "cleared", commercial_use: true };
    const b = { ...a, segment_id: "seg-2" };
    expect(bindingDigest([a, b])).toBe(bindingDigest([b, a]));
    expect(bindingDigest([a, b])).not.toBe(bindingDigest([{ ...a, source_start_frame: 1 }, b]));
  });
});

describe("M3.1 the inventory is re-read, so drift blocks binding", () => {
  it("refuses to bind once the target bytes have drifted into attention", async () => {
    const h = await harness();
    await writeFile(join(h.targetRoot, "assets/a.mp4"), media("tampered"));
    await expect(bind(h)).rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
  });

  it("refuses to bind when the target has no established ledger", async () => {
    const h = await harness({ seed: false });
    await expect(bind(h)).rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
  });
});
