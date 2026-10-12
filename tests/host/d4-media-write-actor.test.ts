import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { HypitMediaCapture, MutationResult } from "../../src/adapters/hypit/hypit-write-adapter.js";
import type { EditRequest } from "../../src/contracts/types.js";
import type { ProjectCatalog, ProjectDescriptor } from "../../src/host/projects/project-catalog.js";
import { ProjectWriteActor } from "../../src/host/projects/project-write-actor.js";
import { RevisionStore, type JournalRecord } from "../../src/host/projects/revision-store.js";

const baseline = "asset_visual_baseline";
const alternate = "asset_visual_d4_alt";
const hashes: Record<string, string> = { [baseline]: "1".repeat(64), [alternate]: "2".repeat(64) };
const manifest = "3".repeat(64);
const descriptor: ProjectDescriptor = {
  project_id: "d1-30s", revision: 2, frame_rate: 30, frame_count: 900,
  shots: [
    { shot_id: "shot-001", authoring_id: "shot-1", start_frame: 0, end_frame_exclusive: 300 },
    { shot_id: "shot-002", authoring_id: "shot-2", start_frame: 300, end_frame_exclusive: 600 },
    { shot_id: "shot-003", authoring_id: "shot-3", start_frame: 600, end_frame_exclusive: 900 },
  ], preview: { kind: "hypit-studio", url: "http://127.0.0.1:4174/" }, studio_origin: "http://127.0.0.1:4174",
  run_file: "runs/build.svrun", narration_asset: "assets/narration.wav", asset_manifest: "narralens.assets.json",
};

const request = (key = "media-key", revision = 2, assetId = alternate): EditRequest => ({
  base_revision: revision, idempotency_key: key,
  selection: { shot_id: "shot-002", start_frame: 300, end_frame_exclusive: 600 }, preserve: ["narration", "duration"],
  operations: [{ op: "replace_visual_asset", shot_id: "shot-002", asset_id: assetId }],
});

class FakeMediaHypit {
  asset = baseline;
  otherAsset = baseline;
  mutations = 0;
  status = 200;
  error: string | undefined;
  injectDrift = false;
  rejectCompensation = false;
  throwAfter = false;

  capture(): HypitMediaCapture {
    const source = `shot-1=${this.otherAsset};shot-2=${this.asset};shot-3=${baseline}`;
    const target = { id: "opaque-shot-2", authoredId: "shot-2", startFrame: 300, endFrameExclusive: 600,
      inspector: [], mediaAsset: { assetId: this.asset, sha256: hashes[this.asset]! } };
    return { descriptor, snapshot: { revision: this.mutations + 1, source: { path: "authors/main.svml", text: source },
      timeline: { frameCount: 900 }, tracks: [{ binding: { facet: "visual" }, items: [target] }] }, target,
      media_asset: { asset_id: this.asset, sha256: hashes[this.asset]! }, source_sha256: hash(source), run_sha256: hash("run"),
      narration_sha256: hash("voice"), semantic: [
        { authored_id: "shot-1", start_frame: 0, end_frame_exclusive: 300, media_asset_id: this.otherAsset },
        { authored_id: "shot-2", start_frame: 300, end_frame_exclusive: 600, media_asset_id: this.asset },
        { authored_id: "shot-3", start_frame: 600, end_frame_exclusive: 900, media_asset_id: baseline },
      ] };
  }

  async inspectMedia(): Promise<HypitMediaCapture> { return this.capture(); }
  async mutateMedia(_capture: HypitMediaCapture, assetId: string): Promise<MutationResult> {
    this.mutations += 1;
    if (this.rejectCompensation && this.mutations > 1) return { status: 500 };
    if (this.status !== 200) return { status: this.status, ...(this.error ? { error: this.error } : {}) };
    this.asset = assetId;
    if (this.injectDrift) this.otherAsset = assetId === alternate ? alternate : baseline;
    if (this.throwAfter) throw new Error("response lost");
    return { status: 200, revision: this.mutations + 1 };
  }
}

function setup(fake = new FakeMediaHypit()): { actor: ProjectWriteActor; fake: FakeMediaHypit; store: RevisionStore } {
  const catalog = { readDescriptor: async () => descriptor } as unknown as ProjectCatalog;
  const store = new RevisionStore();
  const actor = new ProjectWriteActor(catalog, store, fake as never);
  actor.assets.resolve = async (_projectId, assetId) => ({ asset_id: assetId, sha256: hashes[assetId]!, duration_frames: 300,
    media_type: "video/mp4", manifest_sha256: manifest, source_label: "generated", license_label: "cleared" });
  return { actor, fake, store };
}

describe("D4 media ProjectWriteActor", () => {
  it("commits once, advances one revision and deduplicates replay", async () => {
    const value = setup();
    const first = await value.actor.execute("d1-30s", request());
    const replay = await value.actor.execute("d1-30s", request());
    expect(first).toMatchObject({ previous_revision: 2, new_revision: 3, changed: true, operation: { op: "replace_visual_asset", asset_id: alternate } });
    expect(replay).toEqual(first);
    expect(value.fake.mutations).toBe(1);
  });

  it("rejects a media edit under the visual lock before any mutation", async () => {
    const value = setup();
    value.actor.setVisualLock("d1-30s", 2, true);
    await expect(value.actor.execute("d1-30s", request("locked-media"))).rejects.toMatchObject({ status: 423, code: "TARGET_LOCKED" });
    expect(value.fake.mutations).toBe(0);
  });

  it("compensates target and non-target drift without advancing metadata", async () => {
    const value = setup();
    value.fake.injectDrift = true;
    await expect(value.actor.execute("d1-30s", request("media-drift"))).rejects.toMatchObject({ status: 500, code: "TRANSACTION_FAILED" });
    expect(value.fake.asset).toBe(baseline);
    expect(value.fake.otherAsset).toBe(baseline);
    expect(value.store.state("d1-30s", 2)).toMatchObject({ revision: 2, attention: false });
  });

  it("locks the project when a changed response is lost or compensation cannot be proved", async () => {
    const uncertain = setup();
    uncertain.fake.throwAfter = true;
    await expect(uncertain.actor.execute("d1-30s", request("media-lost"))).rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
    expect(uncertain.store.state("d1-30s", 2).attention).toBe(true);

    const compensation = setup();
    compensation.fake.injectDrift = true;
    compensation.fake.rejectCompensation = true;
    await expect(compensation.actor.execute("d1-30s", request("media-compensation"))).rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
    expect(compensation.store.state("d1-30s", 2).attention).toBe(true);
  });

  it("requires evidence-based recovery when the manifest changes after prepare", async () => {
    const value = setup();
    value.fake.status = 409;
    value.fake.error = "Asset manifest changed outside Studio.";
    await expect(value.actor.execute("d1-30s", request("manifest-changed"))).rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
    expect(value.fake.asset).toBe(baseline);
    expect(value.store.state("d1-30s", 2).attention).toBe(true);
  });

  it("enters attention when asset authorization changes after a successful mutation", async () => {
    const value = setup();
    let calls = 0;
    value.actor.assets.resolve = async (_projectId, assetId) => {
      calls += 1;
      return { asset_id: assetId, sha256: hashes[assetId]!, duration_frames: 300, media_type: "video/mp4",
        manifest_sha256: calls > 2 ? "4".repeat(64) : manifest, source_label: "generated", license_label: "cleared" };
    };
    await expect(value.actor.execute("d1-30s", request("authorization-race"))).rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
    expect(value.fake.asset).toBe(alternate);
    expect(value.store.state("d1-30s", 2).attention).toBe(true);
  });

  it("finalizes an incomplete target-state journal after restart", async () => {
    const value = setup();
    const before = value.fake.capture();
    const req = request("media-recover");
    const record: JournalRecord = { transaction_id: "txn_media_recover", project_id: "d1-30s", correlation_id: "media-recover",
      state: "prepared", request_json: JSON.stringify(req), request_hash: "media-recovery-hash", base_revision: 2, authoring_id: "shot-2",
      before_fit: baseline, target_fit: alternate, source_before: before.source_sha256, run_before: before.run_sha256,
      narration_before: before.narration_sha256, semantic_before: canonical(before.semantic), source_path: "authors/main.svml",
      source_expected: "", studio_revision_before: 1, compensation_attempt: 0, manifest_sha: manifest };
    value.store.prepare(record, req.idempotency_key, 2);
    await value.fake.mutateMedia(before, alternate);
    await value.actor.recoverIncomplete();
    expect(value.store.state("d1-30s", 2)).toMatchObject({ revision: 3, attention: false });
    expect(value.store.journal(record.transaction_id)?.state).toBe("metadata_committed");
  });
});

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
