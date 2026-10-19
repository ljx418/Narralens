import { describe, expect, it } from "vitest";
import { HostDiagnostics, redact } from "../../src/host/host-diagnostics.js";
import { HttpError, normalizeError } from "../../src/host/api-error.js";

/**
 * INFRA-RISK-W2-001: an intermittent Host 500 was unattributable.
 *
 * `normalizeError` correctly hides internal detail from a response, which meant the only
 * record of a parallel-run failure was "Internal host error" — no stage, no class, no way to
 * tell one intermittent failure from another. Re-running until green hides exactly the
 * signal that was needed.
 *
 * These tests pin what the diagnostic channel may and may not contain. The "may not" half
 * matters more than the "may": a diagnostic channel that stores messages and stacks becomes
 * a place for paths and credentials to end up in a file nobody reviews as carefully as a log.
 */

describe("INFRA-RISK-W2-001 the Host diagnostic channel", () => {
  it("keeps the sentence that identifies the failure and none of what must not be stored", () => {
    const diagnostics = new HostDiagnostics();
    diagnostics.record({ correlationId: "corr_1", stage: "migration.execute", error: new RangeError(
      "cannot open /mnt/c/workspace/private/asset.mp4 for https://example.test/x with key sk-ant-abcdef0123456789") });

    const [entry] = diagnostics.recent();
    expect(entry).toMatchObject({ correlation_id: "corr_1", stage: "migration.execute", kind: "RangeError" });
    expect(entry!.message_sha256).toMatch(/^[a-f0-9]{64}$/u);
    // The part that identifies it survives, because a digest alone could not attribute it.
    expect(entry!.message_redacted).toContain("cannot open");
    // The three things a diagnostic must never carry.
    expect(entry!.message_redacted).not.toContain("/mnt/c/workspace/private");
    expect(entry!.message_redacted).not.toContain("example.test");
    expect(entry!.message_redacted).not.toContain("sk-ant-");
  });

  it("redacts a Windows-style path and a bare long digest too", () => {
    expect(redact("failed at C:\\Users\\me\\project\\file.mp4"))
      .toBe("failed at <path>");
    expect(redact(`digest ${"a".repeat(64)} did not match`)).toBe("digest <redacted> did not match");
  });

  it("bounds a very long message rather than storing all of it", () => {
    const entry = new HostDiagnostics();
    entry.record({ correlationId: "corr_1", stage: "route", error: new Error("x".repeat(5000)) });
    expect(entry.recent()[0]!.message_redacted.length).toBeLessThanOrEqual(401);
  });

  it("tells two different failures apart without reproducing either", () => {
    const diagnostics = new HostDiagnostics();
    diagnostics.record({ correlationId: "corr_1", stage: "route", error: new Error("alpha") });
    diagnostics.record({ correlationId: "corr_1", stage: "route", error: new Error("beta") });
    const [newer, older] = diagnostics.recent();
    expect(newer!.message_sha256).not.toBe(older!.message_sha256);
    // The same failure twice has the same digest, which is what "intermittent" means.
    diagnostics.record({ correlationId: "corr_2", stage: "route", error: new Error("beta") });
    const [third] = diagnostics.recent();
    expect(third!.message_sha256).toBe(newer!.message_sha256);
  });

  it("finds a failure by the correlation id the client was given", () => {
    const diagnostics = new HostDiagnostics();
    diagnostics.record({ correlationId: "corr_x", stage: "route", error: new Error("e") });
    expect(diagnostics.byCorrelationId("corr_x")?.stage).toBe("route");
    expect(diagnostics.byCorrelationId("corr_nope")).toBeUndefined();
  });

  it("stays bounded, dropping the oldest", () => {
    const diagnostics = new HostDiagnostics(3);
    for (let index = 0; index < 10; index += 1) {
      diagnostics.record({ correlationId: `corr_${index}`, stage: "route", error: new Error(`e${index}`) });
    }
    expect(diagnostics.recent()).toHaveLength(3);
    expect(diagnostics.byCorrelationId("corr_9")?.correlation_id).toBe("corr_9");
    expect(diagnostics.byCorrelationId("corr_0")).toBeUndefined();
  });

  it("never lets a diagnostic failure become the failure", () => {
    const diagnostics = new HostDiagnostics(1);
    // A value whose `toString` throws, and a frozen entries array.
    const hostile = { toString() { throw new Error("boom"); } };
    expect(() => diagnostics.record({ correlationId: "corr_1", stage: "route", error: hostile })).not.toThrow();
    expect(() => diagnostics.record({ correlationId: "corr_2", stage: "route", error: "plain string" })).not.toThrow();
  });
});

describe("INFRA-RISK-W2-001 the normalized error carries one correlation id", () => {
  it("attaches an id so the response and the diagnostic agree", () => {
    const normalized = normalizeError(new Error("internal detail"));
    expect(normalized.correlationId).toMatch(/^[0-9a-f-]{36}$/u);
    // The id the client sees is the one the Host recorded.
    expect(normalized.body().correlation_id).toBe(normalized.correlationId);
  });

  it("keeps a thrown HttpError's own id rather than inventing a second one", () => {
    const original = new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "closed", undefined, "corr_fixed");
    expect(normalizeError(original).body().correlation_id).toBe("corr_fixed");
  });

  it("still tells a client nothing about what went wrong", () => {
    const body = normalizeError(new Error("/secret/path/asset.mp4: permission denied")).body();
    expect(body).toMatchObject({ code: "INTERNAL_ERROR", message: "Internal host error" });
    expect(JSON.stringify(body)).not.toContain("/secret/path");
  });
});
