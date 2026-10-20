import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  computeImpactHash, impactHashPreimage, sortImpactArrays,
} from "../../../src/host/impact/impact-canonical.js";
import type { ImpactSpecV1 } from "../../../src/contracts/wave2-types.js";

/**
 * Generate `impact-hash.vectors.json` (M4A-H01).
 *
 * The vectors are *frozen* evidence, not a snapshot of whatever the code does today: the
 * file is committed, the Python implementation checks itself against it, and a test asserts
 * the TypeScript still produces the same bytes. A change to the canonical rules therefore
 * has to change this file deliberately, which is what makes the cross-check a check.
 *
 * Run with `pnpm test:wave2:m4a:vectors [output-path]`. The default writes the committed
 * file; the evidence capture passes a temporary path and *diffs* it against the committed
 * one, so the gate detects drift rather than causing it. A generator that overwrote the
 * frozen evidence in place would bake any change to the canonical rules into the very file
 * that is supposed to catch that change.
 */

function unsigned(overrides: Partial<Omit<ImpactSpecV1, "impact_hash">> = {}): Omit<ImpactSpecV1, "impact_hash"> {
  return sortImpactArrays({
    format: "narralens.impact@1.0",
    impact_id: "imp_00000000000000000000000000000000",
    project_id: "of_d1-30s_0123456789abcdef",
    operation: "adopt_materialization",
    materialization_id: "mat_0123456789abcdef",
    target_snapshot_id: null,
    base_revision: 1,
    source_digest: "a".repeat(64),
    control_revision: 0,
    engine: "openfilm",
    engine_upstream_sha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
    affected_ranges: [
      { clip_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 },
      { clip_id: "shot-002", start_frame: 300, end_frame_exclusive: 600 },
      { clip_id: "shot-003", start_frame: 600, end_frame_exclusive: 900 },
    ],
    affected_consumers: [
      { kind: "visual", id: "shot-001", action: "replace" },
      { kind: "visual", id: "shot-002", action: "replace" },
      { kind: "visual", id: "shot-003", action: "replace" },
      { kind: "narration", id: "narration", action: "preserve" },
    ],
    locks_checked: [{ lock_id: "lock_0000000000000000000000000000000a", control_revision: 0 }],
    rights_digest: "b".repeat(64),
    native_plan_sha256: "c".repeat(64),
    approvals_required: ["human_confirmation"],
    expires_at: "2026-10-20T12:15:00.000Z",
    ...overrides,
  });
}

const CASES: ReadonlyArray<readonly [string, Omit<ImpactSpecV1, "impact_hash">]> = [
  ["base", unsigned()],
  // Every array in the opposite order: the hash must not move.
  ["arrays-reversed", {
    ...unsigned(),
    affected_ranges: [...unsigned().affected_ranges].reverse(),
    affected_consumers: [...unsigned().affected_consumers].reverse(),
  }],
  // Adjacent ranges on one clip: merging is a graph concern, the hash sees what it is given.
  ["split-range", unsigned({ affected_ranges: [
    { clip_id: "shot-001", start_frame: 0, end_frame_exclusive: 150 },
    { clip_id: "shot-001", start_frame: 150, end_frame_exclusive: 300 },
  ] })],
  ["no-locks", unsigned({ locks_checked: [] })],
  ["restore-operation", unsigned({
    operation: "restore_snapshot", materialization_id: null, target_snapshot_id: "snap_abc",
  })],
  ["unicode-consumer", unsigned({
    affected_consumers: [
      { kind: "subtitle", id: "字幕-1", action: "preserve" },
      { kind: "visual", id: "shot-001", action: "replace" },
    ],
  })],
  ["later-expiry", unsigned({ expires_at: "2026-10-20T13:15:00.000Z" })],
  ["control-revision", unsigned({ control_revision: 4 })],
];

const document = {
  format: "narralens.impact-hash-vectors@1",
  note: "Frozen M4A-H01 vectors. Regenerate only with a deliberate decision to change the "
    + "canonical rules, and re-run tests/wave2/m4a/impact-hash.golden.py against the result.",
  domain: "narralens-impact-v1\\n",
  vectors: CASES.map(([name, spec]) => ({
    name, spec, impact_hash: computeImpactHash(spec), preimage: impactHashPreimage(spec),
  })),
};

const target = resolve(process.argv[2] ?? "tests/wave2/m4a/impact-hash.vectors.json");
writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
process.stdout.write(`wrote ${document.vectors.length} vectors to ${target}\n`);
