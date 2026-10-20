import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeImpactHash, impactHashPreimage, IMPACT_HASH_DOMAIN } from "../../../src/host/impact/impact-canonical.js";
import type { ImpactSpecV1 } from "../../../src/contracts/wave2-types.js";

/**
 * M4A-H01, the frozen half.
 *
 * `impact-hash.vectors.json` is committed evidence, generated once and checked by a second,
 * independently written implementation (`impact-hash.golden.py`, run from the evidence
 * capture). This file is what keeps the TypeScript honest against it: if the canonical rules
 * change, these assertions fail and the vectors file has to be regenerated deliberately,
 * rather than the two sides drifting together because they share a function.
 */

interface Vector {
  readonly name: string;
  readonly spec: Omit<ImpactSpecV1, "impact_hash">;
  readonly impact_hash: string;
  readonly preimage: string;
}

const document = JSON.parse(readFileSync(resolve("tests/wave2/m4a/impact-hash.vectors.json"), "utf8")) as {
  readonly format: string;
  readonly domain: string;
  readonly vectors: readonly Vector[];
};

describe("M4A-H01: the frozen golden vectors", () => {
  it("carries the domain prefix it claims", () => {
    expect(document.format).toBe("narralens.impact-hash-vectors@1");
    // The vector file records the separator escaped, for JSON; the preimage carries it as a
    // real newline. Comparing the two is the check that they are the same prefix.
    expect(document.domain).toBe("narralens-impact-v1\\n");
    expect(IMPACT_HASH_DOMAIN).toBe("narralens-impact-v1\n");
  });

  it("reproduces every vector's hash and preimage byte for byte", () => {
    expect(document.vectors.length).toBeGreaterThanOrEqual(8);
    for (const vector of document.vectors) {
      expect(impactHashPreimage(vector.spec), `${vector.name} preimage`).toBe(vector.preimage);
      expect(computeImpactHash(vector.spec), `${vector.name} hash`).toBe(vector.impact_hash);
      expect(vector.preimage.startsWith(IMPACT_HASH_DOMAIN), vector.name).toBe(true);
    }
  });

  it("records that array order is not part of the identity", () => {
    const base = document.vectors.find((vector) => vector.name === "base")!;
    const reversed = document.vectors.find((vector) => vector.name === "arrays-reversed")!;
    expect(reversed.impact_hash).toBe(base.impact_hash);
    // And the two specs are genuinely different inputs, so this is not a tautology.
    expect(reversed.preimage).toBe(base.preimage);
  });
});
