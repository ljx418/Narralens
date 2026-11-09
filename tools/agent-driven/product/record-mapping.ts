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
  PRODUCT_COLLECTIONS,
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

lines.push("");
lines.push(`collections: ${collections.length}`);
lines.push(`fixed plan execution digest: ${FIXED_PLAN_EXECUTION_DIGEST}`);
lines.push(`fixed plan digest matches: ${assertFixedPlanDigest()}`);

process.stdout.write(`${lines.join("\n")}\n`);
