/**
 * Prints the PRODUCT repository's closed collection mapping.
 *
 * MAIN's adapter has to write the frozen `cp_a0_*` tables, and the mapping from a
 * collection to its table, primary key and write semantics is the part that is easy to
 * get wrong. This tool prints it from the code itself, so the document and the
 * implementation cannot drift apart.
 *
 * It also re-checks that the fixed plan still hashes to the published execution digest.
 *
 * Run it with:
 *
 *     pnpm exec tsx tools/agent-driven/product/record-mapping.ts
 *
 * It reads nothing and writes nothing.
 */

import {
  PRODUCT_APPEND_ONLY_COLLECTIONS,
  PRODUCT_COLLECTIONS,
  PRODUCT_HEAD_COLLECTIONS,
  type ProductCollection,
} from "../../../src/host/creative/product-repository.js";
import { assertFixedPlanDigest, FIXED_PLAN_EXECUTION_DIGEST } from "../../../src/host/creative/digest.js";

const collections = Object.keys(PRODUCT_COLLECTIONS) as ProductCollection[];

const lines: string[] = [];
lines.push("PRODUCT repository collection mapping");
lines.push("");
lines.push("collection".padEnd(26), "table".padEnd(34), "kind".padEnd(18), "primary key");
for (const collection of collections) {
  const spec = PRODUCT_COLLECTIONS[collection];
  lines.push(
    collection.padEnd(26),
    spec.table.padEnd(34),
    spec.kind.padEnd(18),
    spec.primaryKey.join(", ") + (spec.versionColumn === undefined ? "" : ` (cas: ${spec.versionColumn})`),
  );
}

// The closed lists and the descriptor literal have to agree: a head that is not in the
// head list would make `compareAndSet` unreachable for it, and an append-only row that
// is in neither list would be writable in two ways.
const heads = new Set<string>(PRODUCT_HEAD_COLLECTIONS);
const appendOnly = new Set<string>(PRODUCT_APPEND_ONLY_COLLECTIONS);
for (const collection of collections) {
  const spec = PRODUCT_COLLECTIONS[collection];
  if (!spec.writable) continue;   // `event` is MAIN's mirror; the lane only reads it.
  const kind = spec.kind;
  if (kind === "head" && !heads.has(collection)) {
    throw new Error(`${collection} is a head but is not in PRODUCT_HEAD_COLLECTIONS`);
  }
  if (kind !== "head" && heads.has(collection)) {
    throw new Error(`${collection} is in PRODUCT_HEAD_COLLECTIONS but is not a head`);
  }
  if ((kind === "append_only" || kind === "immutable_version") && !appendOnly.has(collection)) {
    throw new Error(`${collection} is append-only but is not in PRODUCT_APPEND_ONLY_COLLECTIONS`);
  }
  if (kind !== "append_only" && kind !== "immutable_version" && appendOnly.has(collection)) {
    throw new Error(`${collection} is in PRODUCT_APPEND_ONLY_COLLECTIONS but is writable in place`);
  }
}

lines.push("");
lines.push(`collections: ${collections.length}`);
lines.push(`heads: ${PRODUCT_HEAD_COLLECTIONS.length}`);
lines.push(`append-only: ${PRODUCT_APPEND_ONLY_COLLECTIONS.length}`);
lines.push("the closed lists and the descriptor literal agree");
lines.push(`fixed plan execution digest: ${FIXED_PLAN_EXECUTION_DIGEST}`);
lines.push(`fixed plan digest matches: ${assertFixedPlanDigest()}`);

process.stdout.write(`${lines.join("\n")}\n`);
