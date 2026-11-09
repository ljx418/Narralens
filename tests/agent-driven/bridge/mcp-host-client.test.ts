/**
 * A-MCP: the local Host client — what it refuses to do before a request leaves.
 *
 * The client holds credentials for one local Host. These cases pin the refusals
 * that keep it that way: a payload the contract does not describe never reaches
 * the network, a base URL that points anywhere but a loopback is refused when the
 * client is built, a redirect is refused rather than followed (so the credentials
 * are never handed to whoever the redirect names), and a response body cannot be
 * unbounded.
 *
 * The two failure shapes that are easy to confuse are pinned as well: a *read*
 * that could not be delivered is a retryable capability failure, while a *write*
 * that may or may not have been applied is an unknown outcome that must not be
 * retried and must not be re-keyed.
 */

import { describe, expect, it } from "vitest";
import {
  createHostApplicationPorts,
  HostCallError,
  HostEndpointPolicyError,
} from "../../../src/mcp/index.js";

interface Recorded {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function recordingFetch(
  responder: (recorded: Recorded) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const recorded: Recorded = { url: String(input), init };
    calls.push(recorded);
    return responder(recorded);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const PROJECT_READ = { project_id: "p1" };

const CREATE_PROJECT = {
  meta: { idempotency_key: "key-1", correlation_id: "corr-1" },
  intake_id: "intake-1",
  intake_version: 1,
  decision_id: "decision-1",
};

function clientWith(
  fetchImpl: typeof fetch,
  overrides: Partial<{ baseUrl: string; resolveHost: (host: string) => readonly string[]; maxResponseBytes: number }> = {},
) {
  return createHostApplicationPorts({
    baseUrl: overrides.baseUrl ?? "http://127.0.0.1:4173",
    fetchImpl,
    ...(overrides.resolveHost === undefined ? {} : { resolveHost: overrides.resolveHost }),
    ...(overrides.maxResponseBytes === undefined ? {} : { maxResponseBytes: overrides.maxResponseBytes }),
  });
}

async function envelopeOf(failure: unknown): Promise<{ code: string; http_status: number; retryable: boolean; next_actions: string[] }> {
  if (!(failure instanceof HostCallError)) throw failure;
  return failure.envelope;
}

describe("A-MCP Host client refuses what must not leave", () => {
  it("never sends an input the contract does not describe", async () => {
    const { fetchImpl, calls } = recordingFetch(() => new Response("{}", { status: 200 }));
    const ports = clientWith(fetchImpl) as unknown as Record<string, (input: unknown) => Promise<unknown>>;

    await expect(ports["context.read"]!({ project_id: "not a valid id" })).rejects.toThrow(HostCallError);
    expect(calls).toHaveLength(0);
  });

  it("never sends a write whose input the contract does not describe", async () => {
    const { fetchImpl, calls } = recordingFetch(() => new Response("{}", { status: 200 }));
    const ports = clientWith(fetchImpl) as unknown as Record<string, (input: unknown) => Promise<unknown>>;

    await expect(ports["project.create"]!({ ...CREATE_PROJECT, extra: true })).rejects.toThrow(HostCallError);
    expect(calls).toHaveLength(0);
  });

  it("refuses a base URL that is not a loopback literal", () => {
    const { fetchImpl } = recordingFetch(() => new Response("{}", { status: 200 }));
    expect(() => clientWith(fetchImpl, { baseUrl: "http://example.com:4173" }))
      .toThrow(HostEndpointPolicyError);
    expect(() => clientWith(fetchImpl, { baseUrl: "http://10.0.0.5:4173" }))
      .toThrow(HostEndpointPolicyError);
  });

  it("refuses a base URL that carries credentials, a query, a fragment or a path", () => {
    const { fetchImpl } = recordingFetch(() => new Response("{}", { status: 200 }));
    expect(() => clientWith(fetchImpl, { baseUrl: "http://user:pass@127.0.0.1:4173" }))
      .toThrow(HostEndpointPolicyError);
    expect(() => clientWith(fetchImpl, { baseUrl: "http://127.0.0.1:4173?x=1" }))
      .toThrow(HostEndpointPolicyError);
    expect(() => clientWith(fetchImpl, { baseUrl: "http://127.0.0.1:4173#frag" }))
      .toThrow(HostEndpointPolicyError);
    expect(() => clientWith(fetchImpl, { baseUrl: "http://127.0.0.1:4173/agent" }))
      .toThrow(HostEndpointPolicyError);
    expect(() => clientWith(fetchImpl, { baseUrl: "https://127.0.0.1:4173" }))
      .toThrow(HostEndpointPolicyError);
  });

  it("refuses a host name unless a resolution policy restricts it to loopback", () => {
    const { fetchImpl } = recordingFetch(() => new Response("{}", { status: 200 }));
    expect(() => clientWith(fetchImpl, { baseUrl: "http://localhost:4173" }))
      .toThrow(HostEndpointPolicyError);
    expect(() => clientWith(fetchImpl, {
      baseUrl: "http://localhost:4173",
      resolveHost: () => ["203.0.113.7"],
    })).toThrow(HostEndpointPolicyError);
    expect(() => clientWith(fetchImpl, {
      baseUrl: "http://localhost:4173",
      resolveHost: () => [],
    })).toThrow(HostEndpointPolicyError);
  });

  it("accepts a host name that the policy resolves to loopback", () => {
    const { fetchImpl } = recordingFetch(() => new Response("{}", { status: 200 }));
    expect(() => clientWith(fetchImpl, {
      baseUrl: "http://localhost:4173",
      resolveHost: () => ["127.0.0.1"],
    })).not.toThrow();
  });
});

describe("A-MCP Host client transport refusals", () => {
  it("refuses a redirect instead of following it", async () => {
    const { fetchImpl, calls } = recordingFetch(() => new Response("", {
      status: 302,
      headers: { location: "http://example.com/elsewhere" },
    }));
    const ports = clientWith(fetchImpl, {
      baseUrl: "http://127.0.0.1:4173",
    }) as unknown as Record<string, (input: unknown) => Promise<unknown>>;

    const failure = await ports["context.read"]!(PROJECT_READ).then(() => null, (error: unknown) => error);
    const envelope = await envelopeOf(failure);
    expect(envelope.code).toBe("INTERNAL_ERROR");
    // The redirect was not followed: there is exactly one request, and it went to the
    // Host we were pointed at.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("127.0.0.1:4173");
    expect(calls[0]?.init?.redirect).toBe("manual");
  });

  it("refuses a response body that is larger than the limit", async () => {
    const { fetchImpl } = recordingFetch(() => new Response("x".repeat(4096), { status: 200 }));
    const ports = clientWith(fetchImpl, { maxResponseBytes: 128 }) as unknown as Record<
      string,
      (input: unknown) => Promise<unknown>
    >;

    const failure = await ports["context.read"]!(PROJECT_READ).then(() => null, (error: unknown) => error);
    const envelope = await envelopeOf(failure);
    expect(envelope.code).toBe("CAPABILITY_UNAVAILABLE");
    expect(envelope.retryable).toBe(true);
  });
});

describe("A-MCP Host client failure shapes", () => {
  it("reports an unreachable host on a read as a retryable capability failure", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const ports = clientWith(fetchImpl) as unknown as Record<string, (input: unknown) => Promise<unknown>>;

    const failure = await ports["context.read"]!(PROJECT_READ).then(() => null, (error: unknown) => error);
    const envelope = await envelopeOf(failure);
    expect(envelope.code).toBe("CAPABILITY_UNAVAILABLE");
    expect(envelope.http_status).toBe(503);
    expect(envelope.retryable).toBe(true);
  });

  it("reports a write that may or may not have been applied as an unknown outcome", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const ports = clientWith(fetchImpl) as unknown as Record<string, (input: unknown) => Promise<unknown>>;

    const failure = await ports["project.create"]!(CREATE_PROJECT).then(() => null, (error: unknown) => error);
    const envelope = await envelopeOf(failure);
    expect(envelope.code).toBe("PROVIDER_RESULT_UNKNOWN");
    expect(envelope.http_status).toBe(428);
    // Never retryable: replaying it under a new key would apply it twice.
    expect(envelope.retryable).toBe(false);
    expect(envelope.next_actions).toContain("reconcile_by_idempotency_key");
  });

  it("reports a write that provably never left the process as a retryable failure", async () => {
    // A refused connection proves the request was never delivered, so the write
    // certainly did not happen and may be sent again.
    const refusal = new TypeError("fetch failed");
    (refusal as { cause?: unknown }).cause = { code: "ECONNREFUSED" };
    const fetchImpl = (async () => {
      throw refusal;
    }) as unknown as typeof fetch;
    const ports = clientWith(fetchImpl) as unknown as Record<string, (input: unknown) => Promise<unknown>>;

    const failure = await ports["project.create"]!(CREATE_PROJECT).then(() => null, (error: unknown) => error);
    const envelope = await envelopeOf(failure);
    expect(envelope.code).toBe("CAPABILITY_UNAVAILABLE");
    expect(envelope.retryable).toBe(true);
  });

  it("reports a write whose answer is off-contract as an unknown outcome", async () => {
    const { fetchImpl } = recordingFetch(() => new Response(JSON.stringify({ job_id: "j1" }), { status: 200 }));
    const ports = clientWith(fetchImpl) as unknown as Record<string, (input: unknown) => Promise<unknown>>;

    const failure = await ports["project.create"]!(CREATE_PROJECT).then(() => null, (error: unknown) => error);
    const envelope = await envelopeOf(failure);
    expect(envelope.code).toBe("PROVIDER_RESULT_UNKNOWN");
    expect(envelope.retryable).toBe(false);
  });

  it("keeps the host's own error envelope for a write that was refused", async () => {
    const { fetchImpl } = recordingFetch(() => new Response(JSON.stringify({
      schema_version: "agent.v1",
      correlation_id: "corr-1",
      code: "REVISION_CONFLICT",
      http_status: 409,
      message: "the base is stale",
      retryable: false,
      next_actions: ["reload_current_state"],
    }), { status: 409 }));
    const ports = clientWith(fetchImpl) as unknown as Record<string, (input: unknown) => Promise<unknown>>;

    const failure = await ports["project.create"]!(CREATE_PROJECT).then(() => null, (error: unknown) => error);
    const envelope = await envelopeOf(failure);
    // A refusal is a known outcome: the write did not happen, and the Host's own
    // semantics are kept.
    expect(envelope.code).toBe("REVISION_CONFLICT");
    expect(envelope.http_status).toBe(409);
    expect(envelope.retryable).toBe(false);
    expect(envelope.next_actions).toEqual(["reload_current_state"]);
  });
});
