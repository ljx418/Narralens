import { describe, expect, it } from "vitest";
import { AdoptionStore } from "../../../src/host/adoption/adoption-store.js";
import { RevisionStore } from "../../../src/host/projects/revision-store.js";

const sha = (character: string) => character.repeat(64);

function preparedStore() {
  const revisions = new RevisionStore();
  const adoption = new AdoptionStore(revisions);
  revisions.beginTransaction({
    transaction_id: "txn_adopt", project_id: "target", kind: "edit", correlation_id: "corr",
    request_json: "{}", request_hash: sha("1"), base_revision: 4,
  });
  revisions.transition("txn_adopt", "received", "preconditions_checked", { source_digest_before: sha("a") });
  revisions.transition("txn_adopt", "preconditions_checked", "staged");
  revisions.transition("txn_adopt", "staged", "validated");
  return { revisions, adoption };
}

describe("M4B adoption durable facts", () => {
  it("atomically inserts the immutable fact and advances to prepared", () => {
    const { revisions, adoption } = preparedStore();
    adoption.prepare({
      transaction_id: "txn_adopt", source_before_sha256: sha("a"), source_after_sha256: sha("b"),
      staged_source_digest: sha("c"), snapshot_id: "snapshot_after",
      installed_assets: [{ token: "assets/abc/source.mp4", sha256: sha("d") }],
      film_temp_token: ".narralens-txn/txn_adopt/film.html", publish_intent_created_at: new Date(0).toISOString(),
    });
    expect(revisions.projectTransaction("txn_adopt")).toMatchObject({
      state: "prepared", snapshot_id: "snapshot_after", source_digest_after: sha("c"),
    });
    expect(adoption.adoptionFact("txn_adopt")?.installed_assets).toEqual([
      { token: "assets/abc/source.mp4", sha256: sha("d") },
    ]);
  });

  it("rolls the fact back when the predecessor is not validated", () => {
    const { revisions, adoption } = preparedStore();
    revisions.transition("txn_adopt", "validated", "aborted");
    expect(() => adoption.prepare({
      transaction_id: "txn_adopt", source_before_sha256: sha("a"), source_after_sha256: sha("b"),
      staged_source_digest: sha("c"), snapshot_id: "snapshot_after", installed_assets: [],
      film_temp_token: ".narralens-txn/txn_adopt/film.html", publish_intent_created_at: new Date(0).toISOString(),
    })).toThrow("INVALID_TRANSITION");
    expect(adoption.adoptionFact("txn_adopt")).toBeUndefined();
  });

  it("rejects equal before/after facts and unsafe tokens", () => {
    const { adoption } = preparedStore();
    const base = {
      transaction_id: "txn_adopt", source_before_sha256: sha("a"), source_after_sha256: sha("a"),
      staged_source_digest: sha("c"), snapshot_id: "snapshot_after", installed_assets: [],
      film_temp_token: ".narralens-txn/txn_adopt/film.html", publish_intent_created_at: new Date(0).toISOString(),
    };
    expect(() => adoption.prepare(base)).toThrow();
    expect(() => adoption.prepare({ ...base, source_after_sha256: sha("b"), film_temp_token: "../film.html" })).toThrow("INVALID_FILM_TEMP_TOKEN");
  });

  it("stores a closed immutable post-adoption projection fact", () => {
    const { revisions, adoption } = preparedStore();
    adoption.prepare({
      transaction_id: "txn_adopt", source_before_sha256: sha("a"), source_after_sha256: sha("b"),
      staged_source_digest: sha("c"), snapshot_id: "snapshot_after", installed_assets: [],
      film_temp_token: ".narralens-txn/txn_adopt/film.html", publish_intent_created_at: new Date(0).toISOString(),
    });
    adoption.insertProjectionFact({
      project_id: "target", snapshot_id: "snapshot_after", migration_id: "migration_1",
      source_digest: sha("c"), engine_upstream_sha: sha("e"), roots: ["film.html", "assets/abc/source.mp4"],
      subtitles: [{ subtitle_id: "sub_1", path: "captions.vtt" }], frame_count: 900,
      transaction_id: "txn_adopt",
    });
    expect(adoption.projectionFact("snapshot_after")).toMatchObject({ frame_count: 900, roots: ["film.html", "assets/abc/source.mp4"] });
    expect(() => revisions.compose((db) => db.prepare(
      "UPDATE openfilm_projection_fact SET frame_count=901 WHERE snapshot_id='snapshot_after'",
    ).run())).toThrow("IMMUTABLE_PROJECTION_FACT");
  });
});
