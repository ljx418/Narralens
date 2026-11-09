import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assertFixedPlanDigest,
  canonicalDigest,
  canonicalJson,
  contentDigest,
  FIXED_PLAN,
  FIXED_PLAN_EXECUTION_DIGEST,
} from "../../../src/host/creative/digest.js";

const golden = JSON.parse(
  readFileSync("docs/agent-driven-v1/cp-a0/canonical-vectors.json", "utf8"),
) as {
  referenceVectors: {
    fixedPlan: { value: unknown; canonical: string; sha256: string };
    runScope: { value: unknown; canonical: string; sha256: string };
    creativeInput: {
      brief: { value: unknown; canonical: string; sha256: string };
      initialAnswer: { value: unknown; canonical: string; sha256: string };
      changedAnswer: { value: unknown; canonical: string; sha256: string };
    };
  };
};

describe("the PRODUCT canonicalization", () => {
  it("reproduces the frozen brief, closure and scope vectors byte for byte", () => {
    const vectors = golden.referenceVectors;
    const cases = [
      vectors.creativeInput.brief,
      vectors.creativeInput.initialAnswer,
      vectors.creativeInput.changedAnswer,
      vectors.runScope,
    ];
    for (const vector of cases) {
      expect(canonicalJson(vector.value)).toBe(vector.canonical);
      expect(canonicalDigest(vector.value)).toBe(vector.sha256);
    }
  });

  it("keeps the fixed plan on the published execution digest", () => {
    expect(canonicalJson(FIXED_PLAN)).toBe(golden.referenceVectors.fixedPlan.canonical);
    expect(canonicalDigest(FIXED_PLAN)).toBe(FIXED_PLAN_EXECUTION_DIGEST);
    expect(assertFixedPlanDigest()).toBe(true);
  });

  it("produces a different closure digest for a changed answer on the same brief", () => {
    const initial = golden.referenceVectors.creativeInput.initialAnswer;
    const changed = golden.referenceVectors.creativeInput.changedAnswer;
    expect(canonicalDigest(initial.value)).not.toBe(canonicalDigest(changed.value));
  });

  it("ignores the transport metadata when it digests a request body", () => {
    const first = { meta: { idempotency_key: "key-1", correlation_id: "corr-1" }, value: 7 };
    const second = { meta: { idempotency_key: "key-1", correlation_id: "corr-2" }, value: 7 };
    expect(contentDigest(first)).toBe(contentDigest(second));
    expect(contentDigest({ ...first, value: 8 })).not.toBe(contentDigest(first));
  });

  it("refuses values the restricted canonicalization does not allow", () => {
    expect(() => canonicalJson({ value: 1.5 })).toThrow();
    expect(() => canonicalJson({ value: Number.NaN })).toThrow();
    expect(() => canonicalJson({ value: -0 })).toThrow();
    expect(() => canonicalJson({ value: undefined })).toThrow();
    expect(() => canonicalJson({ "键": 1 })).toThrow();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => canonicalJson(circular)).toThrow();
  });
});
