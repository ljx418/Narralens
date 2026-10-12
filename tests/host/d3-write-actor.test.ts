import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { HypitCapture, MutationResult } from "../../src/adapters/hypit/hypit-write-adapter.js";
import { HypitWriteAdapter } from "../../src/adapters/hypit/hypit-write-adapter.js";
import type { EditRequest } from "../../src/contracts/types.js";
import type { ProjectCatalog, ProjectDescriptor } from "../../src/host/projects/project-catalog.js";
import { ProjectWriteActor } from "../../src/host/projects/project-write-actor.js";
import { RevisionStore, type JournalRecord } from "../../src/host/projects/revision-store.js";

const descriptor: ProjectDescriptor = {
  project_id: "d1-30s", revision: 2, frame_rate: 30, frame_count: 900,
  shots: [
    { shot_id: "shot-001", authoring_id: "shot-1", start_frame: 0, end_frame_exclusive: 300 },
    { shot_id: "shot-002", authoring_id: "shot-2", start_frame: 300, end_frame_exclusive: 600 },
    { shot_id: "shot-003", authoring_id: "shot-3", start_frame: 600, end_frame_exclusive: 900 },
  ],
  preview: { kind: "hypit-studio", url: "http://127.0.0.1:4174/" }, studio_origin: "http://127.0.0.1:4174",
  run_file: "runs/build.svrun", narration_asset: "assets/narration.wav",
};

const request = (key = "edit-key-001", revision = 2, value: "contain" | "cover" = "contain"): EditRequest => ({
  base_revision: revision, idempotency_key: key,
  selection: { shot_id: "shot-002", start_frame: 300, end_frame_exclusive: 600 },
  preserve: ["narration", "duration"], operations: [{ op: "set_visual_fit", shot_id: "shot-002", value }],
});

class FakeHypit {
  fit: "contain" | "cover" = "cover";
  source = '<visual:Clip id="shot-2" fit="cover"/>';
  mutations = 0;
  status = 200;
  otherFit: "contain" | "cover" = "cover";
  injectPostWriteDrift = false;
  rejectCompensation = false;
  throwMutation: "none" | "before" | "after" = "none";

  capture(): HypitCapture {
    const start = this.source.indexOf(this.fit);
    const text = this.source;
    const item = { id: "opaque-item", authoredId: "shot-2", startFrame: 300, endFrameExclusive: 600,
      inspector: [{ id: "opaque:inspector:fit", control: "select", value: this.fit, options: ["contain", "cover"],
        edit: { source: { path: "authors/main.svml", range: { start, end: start + this.fit.length }, preimage: this.fit } } }] };
    return { descriptor, snapshot: { revision: this.mutations + 1, source: { path: "authors/main.svml", text },
      timeline: { frameCount: 900 }, tracks: [{ binding: { facet: "visual" }, items: [item] }] }, target: item,
      fitField: item.inspector[0]!, fit: this.fit, source_sha256: hash(text), run_sha256: hash("run"), narration_sha256: hash("voice"),
      semantic: [
        { authored_id: "narration", start_frame: 0, end_frame_exclusive: 900 },
        { authored_id: "shot-1", start_frame: 0, end_frame_exclusive: 300, fit: this.otherFit },
        { authored_id: "shot-2", start_frame: 300, end_frame_exclusive: 600, fit: this.fit },
        { authored_id: "shot-3", start_frame: 600, end_frame_exclusive: 900, fit: "cover" },
      ],
    };
  }

  async inspect(): Promise<HypitCapture> { return this.capture(); }
  predictedSource(capture: HypitCapture, value: "contain" | "cover"): string {
    const { start, end } = capture.fitField.edit!.source!.range!;
    return `${capture.snapshot.source.text.slice(0, start)}${value}${capture.snapshot.source.text.slice(end)}`;
  }
  async sourceText(): Promise<string> { return this.source; }
  async mutate(_capture: HypitCapture, value: "contain" | "cover"): Promise<MutationResult> {
    this.mutations += 1;
    if (this.throwMutation === "before") throw new Error("connection lost before write");
    if (this.rejectCompensation && this.mutations > 1) return { status: 500 };
    if (this.status !== 200) return { status: this.status };
    this.source = this.source.replace(`fit="${this.fit}"`, `fit="${value}"`);
    this.fit = value;
    if (this.injectPostWriteDrift) this.otherFit = value === "contain" ? "contain" : "cover";
    if (this.throwMutation === "after") throw new Error("response lost after write");
    return { status: 200, revision: this.mutations + 1 };
  }
}

function actor(fake = new FakeHypit(), store = new RevisionStore()): { actor: ProjectWriteActor; fake: FakeHypit; store: RevisionStore } {
  const catalog = { readDescriptor: async () => descriptor } as unknown as ProjectCatalog;
  return { actor: new ProjectWriteActor(catalog, store, fake as unknown as HypitWriteAdapter), fake, store };
}

describe("D3 ProjectWriteActor", () => {
  it("commits one typed visual edit and deduplicates the same idempotency key", async () => {
    const value = actor();
    const first = await value.actor.execute("d1-30s", request());
    const replay = await value.actor.execute("d1-30s", request());
    expect(first).toMatchObject({ previous_revision: 2, new_revision: 3, changed: true, status: "committed" });
    expect(replay).toEqual(first);
    expect(value.fake.fit).toBe("contain");
    expect(value.fake.mutations).toBe(1);
    expect(value.store.journal(first.transaction_id)?.state).toBe("metadata_committed");
  });

  it("rejects stale revisions, key conflicts and a service-side visual lock before mutation", async () => {
    const value = actor();
    await expect(value.actor.execute("d1-30s", request("stale-key", 1))).rejects.toMatchObject({ status: 409, code: "REVISION_CONFLICT" });
    value.actor.setVisualLock("d1-30s", 2, true);
    await expect(value.actor.execute("d1-30s", request("locked-key"))).rejects.toMatchObject({ status: 423, code: "TARGET_LOCKED" });
    expect(value.fake.mutations).toBe(0);
    value.actor.setVisualLock("d1-30s", 2, false);
    await value.actor.execute("d1-30s", request("same-key"));
    await expect(value.actor.execute("d1-30s", request("same-key", 3, "cover"))).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_KEY_CONFLICT" });
  });

  it("does not increment revision for a verified no-op", async () => {
    const value = actor();
    const response = await value.actor.execute("d1-30s", request("noop-key", 2, "cover"));
    expect(response).toMatchObject({ previous_revision: 2, new_revision: 2, changed: false, status: "unchanged" });
    expect(value.fake.mutations).toBe(0);
  });

  it("maps a verified Hypit 409 without changing project state", async () => {
    const value = actor();
    value.fake.status = 409;
    await expect(value.actor.execute("d1-30s", request("hypit-stale"))).rejects.toMatchObject({ status: 409, code: "REVISION_CONFLICT" });
    expect(value.store.state("d1-30s", 2).revision).toBe(2);
    expect(value.fake.fit).toBe("cover");
  });

  it("maps a verified Hypit 422 without changing project state", async () => {
    const value = actor();
    value.fake.status = 422;
    await expect(value.actor.execute("d1-30s", request("hypit-rejected"))).rejects.toMatchObject({ status: 422, code: "UNSUPPORTED_EDIT" });
    expect(value.store.state("d1-30s", 2).revision).toBe(2);
  });

  it("compensates a post-write invariant failure and does not create a revision", async () => {
    const value = actor();
    value.fake.injectPostWriteDrift = true;
    await expect(value.actor.execute("d1-30s", request("drift-key"))).rejects.toMatchObject({ status: 500, code: "TRANSACTION_FAILED" });
    expect(value.fake.fit).toBe("cover");
    expect(value.fake.otherFit).toBe("cover");
    expect(value.store.state("d1-30s", 2).revision).toBe(2);
    expect(value.store.incomplete()).toHaveLength(0);
  });

  it("deterministically finalizes a target-state journal after restart", async () => {
    const value = actor();
    const before = value.fake.capture();
    const req = request("recover-key");
    const requestJson = JSON.stringify(req);
    const expected = value.fake.predictedSource(before, "contain");
    const record: JournalRecord = { transaction_id: "txn_recovery", project_id: "d1-30s", correlation_id: "correlation-recovery",
      state: "prepared", request_json: requestJson, request_hash: "recovery-hash", base_revision: 2, authoring_id: "shot-2",
      before_fit: "cover", target_fit: "contain", source_before: before.source_sha256, run_before: before.run_sha256,
      narration_before: before.narration_sha256, semantic_before: canonical(before.semantic), source_path: "authors/main.svml",
      source_expected: hash(expected), studio_revision_before: 1, compensation_attempt: 0 };
    value.store.prepare(record, req.idempotency_key, 2);
    await value.fake.mutate(before, "contain");
    await value.actor.recoverIncomplete();
    expect(value.store.state("d1-30s", 2)).toMatchObject({ revision: 3, attention: false });
    expect(value.store.journal(record.transaction_id)?.state).toBe("metadata_committed");
  });

  it("deterministically aborts a prepared journal when Source is still at before state", async () => {
    const value = actor();
    const before = value.fake.capture();
    const req = request("recover-before");
    const record: JournalRecord = { transaction_id: "txn_recovery_before", project_id: "d1-30s", correlation_id: "correlation-before",
      state: "prepared", request_json: JSON.stringify(req), request_hash: "recovery-before-hash", base_revision: 2, authoring_id: "shot-2",
      before_fit: "cover", target_fit: "contain", source_before: before.source_sha256, run_before: before.run_sha256,
      narration_before: before.narration_sha256, semantic_before: canonical(before.semantic), source_path: "authors/main.svml",
      source_expected: hash(value.fake.predictedSource(before, "contain")), studio_revision_before: 1, compensation_attempt: 0 };
    value.store.prepare(record, req.idempotency_key, 2);
    await value.actor.recoverIncomplete();
    expect(value.store.journal(record.transaction_id)?.state).toBe("aborted");
    expect(value.store.state("d1-30s", 2).revision).toBe(2);
  });

  it("enters attention and blocks later writes when compensation is uncertain", async () => {
    const value = actor();
    value.fake.injectPostWriteDrift = true;
    value.fake.rejectCompensation = true;
    await expect(value.actor.execute("d1-30s", request("attention-key"))).rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
    expect(value.store.state("d1-30s", 2).attention).toBe(true);
    await expect(value.actor.execute("d1-30s", request("blocked-key"))).rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
  });

  it("aborts a thrown mutation only when a reread proves Source is unchanged", async () => {
    const value = actor();
    value.fake.throwMutation = "before";
    await expect(value.actor.execute("d1-30s", request("throw-before"))).rejects.toMatchObject({ status: 500, code: "TRANSACTION_FAILED" });
    expect(value.store.incomplete()).toHaveLength(0);
    value.fake.throwMutation = "none";
    await expect(value.actor.execute("d1-30s", request("after-abort"))).resolves.toMatchObject({ new_revision: 3 });
  });

  it("enters attention when the mutation response is lost after Source changed", async () => {
    const value = actor();
    value.fake.throwMutation = "after";
    await expect(value.actor.execute("d1-30s", request("throw-after"))).rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
    expect(value.store.state("d1-30s", 2).attention).toBe(true);
  });

  it("reconciles a duplicate incomplete journal with the same committed idempotency result", async () => {
    const directory = await mkdtemp(join(tmpdir(), "narralens-d3-"));
    const path = join(directory, "state.sqlite");
    try {
      const fake = new FakeHypit();
      const first = actor(fake, new RevisionStore(path));
      const response = await first.actor.execute("d1-30s", request("duplicate-recovery"));
      first.store.close();
      const database = new DatabaseSync(path);
      database.prepare("UPDATE edit_journal SET state='prepared' WHERE transaction_id=?").run(response.transaction_id);
      database.close();
      const restarted = actor(fake, new RevisionStore(path));
      await restarted.actor.recoverIncomplete();
      expect(restarted.store.journal(response.transaction_id)?.state).toBe("metadata_committed");
      expect(restarted.store.state("d1-30s", 2)).toMatchObject({ revision: 3, attention: false });
      restarted.store.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
