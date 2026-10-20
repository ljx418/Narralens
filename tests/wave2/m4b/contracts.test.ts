import { describe, expect, it } from "vitest";
import { contractIds, validateControlledWriteFailure, validatorFor } from "../../../src/contracts/validator.js";

const failure = {
  format: "narralens.controlled-write-failure@1.0",
  transaction_id: "txn_1",
  project_id: "project_1",
  operation: "adopt_materialization",
  previous_revision: 4,
  new_revision: 4,
  source_digest: "a".repeat(64),
  status: "aborted",
  error: { http_status: 409, code: "SOURCE_CHANGED", message: "source moved" },
} as const;

describe("M4B controlled-write failure contract", () => {
  it("registers and accepts the closed terminal failure shape", () => {
    expect(contractIds.controlledWriteFailure).toBe(
      "https://narralens.local/schemas/controlled-write-failure.schema.json");
    expect(validatorFor(contractIds.controlledWriteFailure)).toBeTypeOf("function");
    expect(validateControlledWriteFailure(failure)).toEqual({ ok: true, value: failure });
  });

  it.each([
    ["extra field", { ...failure, extra: true }],
    ["unsupported status", { ...failure, error: { ...failure.error, http_status: 404 } }],
    ["unknown code", { ...failure, error: { ...failure.error, code: "MADE_UP" } }],
    ["revision changed", { ...failure, new_revision: 5 }],
  ])("rejects %s", (_name, value) => {
    expect(validateControlledWriteFailure(value).ok).toBe(false);
  });
});
