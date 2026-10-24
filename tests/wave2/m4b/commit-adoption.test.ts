import { describe, expect, it } from "vitest";
import { AdoptionStore } from "../../../src/host/adoption/adoption-store.js";
import { ImpactStore } from "../../../src/host/impact/impact-store.js";
import { OperationIdempotencyStore } from "../../../src/host/projects/operation-idempotency-store.js";
import { RevisionStore } from "../../../src/host/projects/revision-store.js";

const s = (char: string) => char.repeat(64);

function harness() {
  const revisions = new RevisionStore();
  const operations = revisions.compose((db) => new OperationIdempotencyStore(db));
  new ImpactStore(revisions, operations);
  new AdoptionStore(revisions);
  revisions.ensureProject("target", 4);
  const db = revisions.compose((value) => value);
  db.prepare("UPDATE project_state SET source_digest=?, control_revision=2 WHERE project_id='target'").run(s("a"));
  db.prepare(`INSERT INTO snapshot VALUES('snap_before','target',?,'openfilm',?)`).run(s("a"), new Date(0).toISOString());
  db.prepare(`INSERT INTO active_commit VALUES('target',4,'snap_before',?,'openfilm','txn_old',?)`).run(s("a"), new Date(0).toISOString());
  db.prepare(`INSERT INTO impact VALUES('impact_1','target','adopt_materialization','mat_1',4,?,2,?,?,?,?,?,'active',?,?,?)`)
    .run(s("a"), s("b"), s("c"), s("d"), "{}", s("e"), new Date(Date.now() + 60_000).toISOString(),
      new Date(0).toISOString(), new Date(0).toISOString());
  revisions.beginTransaction({ transaction_id: "txn_adopt", project_id: "target", kind: "edit",
    correlation_id: "corr", request_json: "{}", request_hash: s("f"), base_revision: 4 });
  revisions.transition("txn_adopt", "received", "preconditions_checked", { source_digest_before: s("a") });
  revisions.transition("txn_adopt", "preconditions_checked", "staged");
  revisions.transition("txn_adopt", "staged", "validated");
  new AdoptionStore(revisions).prepare({ transaction_id: "txn_adopt", source_before_sha256: s("1"),
    source_after_sha256: s("2"), staged_source_digest: s("3"), snapshot_id: "snap_after",
    installed_assets: [], film_temp_token: ".narralens-txn/film.html",
    publish_intent_created_at: new Date(0).toISOString() });
  return { revisions, operations, db };
}

const input = () => ({ transactionId: "txn_adopt", projectId: "target", previousRevision: 4,
  expectedSourceDigest: s("a"), expectedControlRevision: 2, snapshotId: "snap_after",
  sourceDigestAfter: s("3"), impactId: "impact_1", impactHash: s("e"),
  idempotencyKey: "key_1", requestDigest: s("f"), projection: {
    migration_id: "migration_1", engine_upstream_sha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
    roots_json: '["film.html"]', subtitles_json: "[]", frame_count: 900,
  }, ledgerRows: [] });

describe("M4B RevisionStore.commitAdoption", () => {
  it("commits revision, pointer, impact, projection, outbox and replay response exactly once", () => {
    const { revisions, operations, db } = harness();
    // A preceding outbox row, so the committed event's id is *not* 1. Asserting `1` would be
    // satisfied by a constant, and by a post-hoc lookup — and gate §6 requires the id to be
    // the row number of the insert that happened inside this very transaction.
    db.prepare("INSERT INTO outbox(topic, project_id, payload_json, created_at) VALUES('other','target','{}','2026-01-01T00:00:00.000Z')").run();
    const response = revisions.commitAdoption(input());
    expect(response).toMatchObject({ previous_revision: 4, new_revision: 5, status: "committed" });
    // The id is the row that carries this transaction's committed event, and no other.
    const committed = db.prepare("SELECT event_id FROM outbox WHERE payload_json LIKE ?")
      .get(`%"transaction_id":"txn_adopt"%`) as { event_id?: number } | undefined;
    expect(response.outbox_event_id).toBe(Number(committed?.event_id));
    expect(response.outbox_event_id).toBeGreaterThan(1);
    expect(revisions.state("target", 0).revision).toBe(5);
    expect(revisions.activeCommit("target")).toMatchObject({ revision: 5, snapshot_id: "snap_after", source_digest: s("3") });
    expect(revisions.projectTransaction("txn_adopt")?.state).toBe("committed");
    expect(operations.recall("target", "controlled_write.adopt_materialization", "key_1")?.response_json)
      .toBe(JSON.stringify(response));
    expect((db.prepare("SELECT state FROM impact WHERE impact_id='impact_1'").get() as { state: string }).state).toBe("consumed");
  });

  it.each([
    ["revision", { previousRevision: 3 }],
    ["source", { expectedSourceDigest: s("9") }],
    ["control", { expectedControlRevision: 3 }],
    ["impact", { impactHash: s("9") }],
  ])("rolls every business fact back when %s CAS fails", (_name, patch) => {
    const { revisions, operations, db } = harness();
    expect(() => revisions.commitAdoption({ ...input(), ...patch })).toThrow();
    expect(revisions.state("target", 0).revision).toBe(4);
    expect(revisions.activeCommit("target")?.snapshot_id).toBe("snap_before");
    expect(revisions.projectTransaction("txn_adopt")?.state).toBe("prepared");
    expect(operations.recall("target", "controlled_write.adopt_materialization", "key_1")).toBeUndefined();
    expect((db.prepare("SELECT state FROM impact WHERE impact_id='impact_1'").get() as { state: string }).state).toBe("active");
    expect(revisions.pendingOutboxCount()).toBe(0);
  });
});
