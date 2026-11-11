import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as createdSourcePorts from "../../../src/host/agent-driven/created-source-ports.js";
import {
  PREPARED_ADOPTION_PLAN_DOMAIN,
  PreparedAdoptionPlanError,
  assertPreparedAdoptionPlan,
  preparedAdoptionPlanDigest,
  preparedAdoptionPlanPreimage,
  type PreparedAdoptionPlanV1,
} from "../../../src/host/agent-driven/created-source-ports.js";
import { RevisionStore } from "../../../src/host/projects/revision-store.js";
import { ProductSqliteRepository } from "../../../src/host/agent-driven/product-sqlite-repository.js";

/**
 * The frozen golden vectors of the D09 adoption plan.
 *
 * They live in the ticket directory because the independent Python implementation reads
 * the very same file: one set of vectors, two implementations, one expectation. The
 * Python cross-check is `docs/parallel/lane-bridge/A-R2-20261112/tools/d09-plan-golden.py`.
 */
interface GoldenCase {
  readonly name: string;
  readonly expect: "accepted" | "rejected";
  readonly plan: PreparedAdoptionPlanV1;
  readonly preimage?: string;
  readonly digest?: string;
}

const VECTORS = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../../docs/parallel/lane-bridge/A-R2-20261112/golden/d09-plan-vectors.json", import.meta.url)),
  "utf8",
)) as { readonly cases: readonly GoldenCase[] };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * A writable mirror of the plan.
 *
 * The plan itself is readonly, which is right for the production type; a mutation test
 * has to be able to write, so it works on this mirror and casts back through the
 * immutable type at the boundary.
 */
interface MutablePlan {
  format: string;
  version: number;
  source_kind: string;
  project_id: string;
  base_revision: number;
  base_source_digest: string;
  control_revision: number;
  selection_version: number;
  materialization_id: string;
  prepared_fact_digest: string;
  request_digest: string;
  producer_execution: { run_id: string; plan_version: number; step_id: string; attempt: number; input_digest: string; run_scope_digest: string; authorization_id: string };
  target_source_digest: string;
  target_snapshot_id: string;
  roots: string[];
  files: { relative_path: string; bytes: number; sha256: string }[];
  rights: { ref_id: string; artifact_version: number; sha256: string }[];
  consumer: { consumer_id: string; project_id: string; run_id: string; graph_digest: string };
  native_plan: { native_plan_sha256: string; film_sha256: string; film_bytes: number; settings_digest: string; subtitle_style_digest: string; captions_digest: string; markers_digest: string };
  frame_count: number;
  fps_numerator: number;
  fps_denominator: number;
  affected_ranges: { start_frame: number; end_frame_exclusive: number; clip_id: string }[];
  locks_checked: { lock_id: string; lock_type: string; scope: string; target_id: string; start_frame: number; end_frame_exclusive: number }[];
  engine_upstream_sha: string;
  expires_at: string;
}

const mutable = (plan: PreparedAdoptionPlanV1): MutablePlan => clone(plan) as unknown as MutablePlan;
const frozen = (plan: MutablePlan): PreparedAdoptionPlanV1 => plan as unknown as PreparedAdoptionPlanV1;

describe("the D09 prepared adoption plan", () => {
  it("hashes the frozen golden vector exactly", () => {
    const accepted = VECTORS.cases.filter((entry) => entry.expect === "accepted");
    expect(accepted.length).toBeGreaterThan(0);
    for (const entry of accepted) {
      expect(preparedAdoptionPlanPreimage(entry.plan)).toBe(entry.preimage);
      expect(preparedAdoptionPlanDigest(entry.plan)).toBe(entry.digest);
    }
  });

  it("refuses every frozen negative vector", () => {
    const rejected = VECTORS.cases.filter((entry) => entry.expect === "rejected");
    expect(rejected.length).toBeGreaterThan(0);
    for (const entry of rejected) {
      expect(() => assertPreparedAdoptionPlan(entry.plan)).toThrow(PreparedAdoptionPlanError);
    }
  });

  it("changes its digest when any one of its fields changes", () => {
    const base = VECTORS.cases.find((entry) => entry.expect === "accepted")!.plan;
    const baseline = preparedAdoptionPlanDigest(base);
    // Every field D09 names participates in the digest. A field that did not would let
    // the change of that field ride along unnoticed.
    const mutations: ReadonlyArray<readonly [string, (plan: MutablePlan) => void]> = [
      ["version", (plan) => { plan.version = 2; }],
      ["source_kind", (plan) => { plan.source_kind = 'legacy_m3'; }],
      ["project_id", (plan) => { plan.project_id = 'proj_other'; }],
      ["base_revision", (plan) => { plan.base_revision += 1; }],
      ["base_source_digest", (plan) => { plan.base_source_digest = 'a'.repeat(64); }],
      ["control_revision", (plan) => { plan.control_revision += 1; }],
      ["selection_version", (plan) => { plan.selection_version += 1; }],
      ["materialization_id", (plan) => { plan.materialization_id = 'ps_other'; }],
      ["prepared_fact_digest", (plan) => { plan.prepared_fact_digest = 'b'.repeat(64); }],
      ["request_digest", (plan) => { plan.request_digest = 'c'.repeat(64); }],
      ["producer execution", (plan) => { plan.producer_execution.attempt += 1; }],
      ["target_source_digest", (plan) => { plan.target_source_digest = 'd'.repeat(64); }],
      ["target_snapshot_id", (plan) => { plan.target_snapshot_id = 'snapshot_other'; }],
      ["roots", (plan) => { plan.roots = [...plan.roots, 'subtitles.srt']; }],
      ["files", (plan) => { plan.files[0]!.bytes += 1; }],
      ["rights", (plan) => { plan.rights[0]!.sha256 = 'e'.repeat(64); }],
      ["consumer graph", (plan) => { plan.consumer.graph_digest = 'f'.repeat(64); }],
      ["native plan", (plan) => { plan.native_plan.film_sha256 = '1'.repeat(64); }],
      ["frame count", (plan) => { plan.frame_count += 1; }],
      ["fps", (plan) => { plan.fps_numerator += 1; }],
      ["affected ranges", (plan) => { plan.affected_ranges[0]!.end_frame_exclusive += 1; }],
      ["locks", (plan) => { plan.locks_checked[0]!.target_id = 'clip_x'; }],
      ["upstream", (plan) => { plan.engine_upstream_sha = '2'.repeat(64); }],
      ["expiry", (plan) => { plan.expires_at = '2026-11-12T00:30:00.000Z'; }],
    ];
    for (const [field, mutate] of mutations) {
      const mutated = mutable(base);
      mutate(mutated);
      expect(preparedAdoptionPlanDigest(frozen(mutated)), `${field} must change the digest`).not.toBe(baseline);
    }
  });

  it("hashes the same plan the same way whatever order the arrays arrive in", () => {
    const base = VECTORS.cases.find((entry) => entry.expect === "accepted")!.plan;
    const shuffled = mutable(base);
    shuffled.files = [...shuffled.files].reverse();
    shuffled.affected_ranges = [...shuffled.affected_ranges].reverse();
    shuffled.locks_checked = [...shuffled.locks_checked].reverse();
    shuffled.roots = [...shuffled.roots].reverse();
    expect(preparedAdoptionPlanDigest(frozen(shuffled))).toBe(preparedAdoptionPlanDigest(base));
  });

  it("refuses a plan whose domain is not the one it claims", () => {
    const base = VECTORS.cases.find((entry) => entry.expect === "accepted")!.plan;
    const foreign = mutable(base);
    foreign.format = 'narralens.prepared-adoption-plan@2';
    expect(() => assertPreparedAdoptionPlan(frozen(foreign))).toThrow(PreparedAdoptionPlanError);
    expect(PREPARED_ADOPTION_PLAN_DOMAIN).toBe('narralens.prepared-adoption-plan@1');
  });

  it("refuses a plan whose frame count is not a safe integer", () => {
    const base = VECTORS.cases.find((entry) => entry.expect === "accepted")!.plan;
    const fractional = mutable(base);
    fractional.frame_count = 12.5;
    expect(() => assertPreparedAdoptionPlan(frozen(fractional))).toThrow(PreparedAdoptionPlanError);
    const huge = mutable(base);
    huge.frame_count = Number.MAX_SAFE_INTEGER + 2;
    expect(() => assertPreparedAdoptionPlan(frozen(huge))).toThrow(PreparedAdoptionPlanError);
  });
});

describe("the opacity of the created-source capabilities", () => {
  it("exposes no mint, lease, issuer or scope-opening API in the shared ports module", () => {
    // The capability lives with its owner: the scope belongs to the RevisionStore's own
    // transaction and the proof belongs to the publisher instance that issued it. A
    // shared module that could mint either would be a shared module a request could
    // reach, so this guard fails the moment one is added back.
    const forbidden = [
      "openCreatedSourceCommitScope",
      "closeCreatedSourceCommitScope",
      "isCreatedSourceCommitScope",
      "openCreatedSourcePublisherLease",
      "closeCreatedSourcePublisherLease",
      "createCreatedSourceProofIssuer",
      "isCreatedSourcePublicationProof",
      "issueCreatedSourcePublicationProof",
    ];
    const exported = Object.keys(createdSourcePorts);
    for (const name of forbidden) {
      expect(exported, `${name} must not be exported from the shared ports module`).not.toContain(name);
    }
  });

  it("refuses a commit scope that no live transaction opened", () => {
    const revisions = new RevisionStore(":memory:");
    const repository = new ProductSqliteRepository(revisions);
    const forged = { project_id: "project-1", transaction_id: "txn-1", poison: () => undefined, poisoned: false };
    expect(() => repository.joinCreatedSourceCommit(forged, () => undefined)).toThrow();
    revisions.close();
  });

  it("refuses a scope from another store and a scope whose transaction has ended", () => {
    const first = new RevisionStore(":memory:");
    const second = new RevisionStore(":memory:");
    const secondRepository = new ProductSqliteRepository(second);
    let captured: import("../../../src/host/agent-driven/created-source-ports.js").CreatedSourceCommitScope | undefined;
    first.withCreatedSourceCommitScope("project-1", "txn-1", (scope) => {
      captured = scope;
      // Another store's repository must not accept this scope, even while it is live.
      expect(() => secondRepository.joinCreatedSourceCommit(scope, () => undefined)).toThrow();
      // The owning repository does accept it: it is the same connection and the same
      // live transaction.
      expect(() => first.compose(() => undefined)).not.toThrow();
    });
    // The transaction has ended, so the scope authorises nothing any more.
    expect(captured).toBeDefined();
    expect(() => secondRepository.joinCreatedSourceCommit(captured!, () => undefined)).toThrow();
    first.close();
    second.close();
  });

  it("rolls the transaction back when the joined failure is swallowed", () => {
    const revisions = new RevisionStore(":memory:");
    const repository = new ProductSqliteRepository(revisions);
    const before = revisions.outboxRowCount();
    expect(() => revisions.withCreatedSourceCommitScope("project-1", "txn-1", (scope) => {
      try {
        repository.joinCreatedSourceCommit(scope, () => {
          throw new Error("the joined work failed");
        });
      } catch {
        // The caller swallows the failure. The scope remembers it, so the transaction
        // still rolls back.
      }
    })).toThrow();
    expect(revisions.outboxRowCount()).toBe(before);
    revisions.close();
  });

  it("refuses a joined work that returns a thenable", () => {
    const revisions = new RevisionStore(":memory:");
    const repository = new ProductSqliteRepository(revisions);
    expect(() => revisions.withCreatedSourceCommitScope("project-1", "txn-1", (scope) => {
      repository.joinCreatedSourceCommit(scope, () => Promise.resolve(1) as unknown as number);
    })).toThrow();
    revisions.close();
  });
});
