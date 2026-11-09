/**
 * A-MCP (module level): the exact tool allowlist, the tool schemas, the request
 * builder, the error mapping, the contract handshake and the resource surface.
 *
 * The façade's contract with a client is precise: exactly the registry's tools, each
 * with the contract's own input schema, a verified contract version before
 * anything is dispatched, and failures reported as the contract's `Error` envelope.
 * These cases check that surface without a process or a socket. The real subprocess
 * handshake is in `mcp-stdio-client.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ApplicationPorts, Context, EventSnapshot, Instance } from "../../../src/contracts/agent-driven-types.js";
import {
  AGENT_RESOURCES,
  AGENT_ROUTES,
  buildRequest,
  createMcpServer,
  errorFromHostResponse,
  errorFromTransportFailure,
  errorFromUnknownOutcome,
  exposedToolNames,
  exposedToolRoutes,
  HostCallError,
  matchResourceUri,
  routeByToolName,
  toolInputSchema,
  type McpFacadeOptions,
} from "../../../src/mcp/index.js";
import { contractDefinitionSchema } from "../../../src/mcp/tool-schemas.js";

const registry = JSON.parse(readFileSync("contracts/agent-driven-a.registry.json", "utf8")) as {
  routes: { id: string; tool: string | null; scope: string }[];
};
const contractSchema = JSON.parse(readFileSync("contracts/agent-driven-a.schema.json", "utf8")) as {
  $defs: Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
};

const INSTANCE = {
  instance_id: "narralens-a",
  generation: 1,
  api_version: "agent.v1",
  contract_version: "cp-a0-r4",
  capabilities: [{ id: "narralens_capabilities", version: 1, state: "available", reason: "registered" }],
  health: "ready",
} satisfies Instance;

const FOREIGN_INSTANCE = {
  ...INSTANCE,
  contract_version: "cp-a0-r3",
} as unknown as Instance;

const CONTEXT = {
  project_id: "p1",
  origin: "created",
  project_revision: 1,
  control_revision: 1,
  snapshot_id: "snap1",
  source_digest: "a".repeat(64),
  workflow_revision: 1,
  selection_version: 0,
  current_selection: null,
  active_jobs: [],
  artifacts: [],
  capabilities: [],
  next_actions: [],
  active_run: null,
  native_ack: null,
  native_sync: "unknown",
} satisfies Context;

const SNAPSHOT = {
  context: CONTEXT,
  cursor: `c${"a".repeat(16)}_${"b".repeat(43)}`,
  oldest_retained_event_id: 10,
  snapshot_event_id: 40,
  filter_digest: "b".repeat(64),
  instance_generation: 3,
} satisfies EventSnapshot;

/**
 * The text of a resource read.
 *
 * The SDK types a resource content as text *or* blob, so the text has to be read
 * through a narrowing cast rather than assumed.
 */
function resourceText(result: { contents: unknown[] }): string {
  const first = result.contents[0] as { text?: string } | undefined;
  return first?.text ?? "{}";
}

interface FakePorts {
  readonly ports: ApplicationPorts;
  /** The routes the façade actually called, in order. */
  readonly calls: string[];
}

function fakePorts(responses: Record<string, unknown>): FakePorts {
  const calls: string[] = [];
  const ports = new Proxy({}, {
    get(_target: object, property: string | symbol) {
      const routeId = String(property);
      return async () => {
        calls.push(routeId);
        const response = responses[routeId];
        if (response === undefined) {
          throw new HostCallError({
            schema_version: "agent.v1",
            correlation_id: "test",
            code: "NOT_FOUND",
            http_status: 404,
            message: `No response configured for ${routeId}.`,
            retryable: false,
            next_actions: ["check_identifier"],
          });
        }
        return response;
      };
    },
  }) as unknown as ApplicationPorts;
  return { ports, calls };
}

async function connect(
  ports: ApplicationPorts,
  options: Partial<McpFacadeOptions> = {},
): Promise<Client> {
  const server = createMcpServer({ ports, ...options });
  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe("A-MCP tool allowlist", () => {
  it("exposes exactly the registry's routes that carry a tool name", () => {
    const registryTools = registry.routes
      .filter((route) => route.tool !== null)
      .map((route) => route.tool as string)
      .sort();
    expect(exposedToolNames().slice().sort()).toEqual(registryTools);
    expect(exposedToolNames()).toHaveLength(24);
  });

  it("exposes no trusted-UI or native-bridge route", () => {
    const exposed = new Set(exposedToolNames());
    for (const route of registry.routes) {
      if (route.scope === "trusted_ui" || route.scope === "native_bridge") {
        expect(route.tool, route.id).toBeNull();
        expect(exposed.has(route.id)).toBe(false);
      }
    }
    expect(routeByToolName("narralens_review_decide")).toBeNull();
    expect(routeByToolName("narralens_editor_native_ack")).toBeNull();
    expect(routeByToolName("narralens_change_approve")).toBeNull();
  });

  it("covers all 31 routes and keeps every path placeholder bound", () => {
    expect(AGENT_ROUTES).toHaveLength(31);
    for (const route of AGENT_ROUTES) {
      const placeholders = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
      expect(placeholders.length, route.id).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives every tool the contract's own input schema", () => {
    for (const route of exposedToolRoutes()) {
      const schema = toolInputSchema(route);
      expect(schema["type"], route.id).toBe("object");
      if (route.input === null) {
        expect(schema["properties"], route.id).toEqual({});
        expect(schema["additionalProperties"], route.id).toBe(false);
        continue;
      }
      const definition = contractSchema.$defs[route.input];
      expect(definition, route.id).toBeDefined();
      expect(Object.keys((schema["properties"] ?? {}) as Record<string, unknown>), route.id)
        .toEqual(Object.keys(definition?.properties ?? {}));
      expect(schema["required"], route.id).toEqual(definition?.required);
      expect(schema["additionalProperties"], route.id).toBe(false);
    }
  });

  it("inlines the contract's local references into a self-contained schema", () => {
    const schema = toolInputSchema(exposedToolRoutes().find((route) => route.id === "artifact.put")!);
    expect(JSON.stringify(schema)).not.toContain("#/$defs/");
    expect(schema).toEqual(contractDefinitionSchema("ArtifactPut"));
  });
});

describe("A-MCP request building", () => {
  const base = "http://127.0.0.1:4173";

  it("fills path placeholders from the audited bindings", () => {
    const request = buildRequest(
      AGENT_ROUTES.find((route) => route.id === "context.read")!,
      { project_id: "p1" },
      base,
    );
    expect(request.url).toBe("http://127.0.0.1:4173/api/agent/v1/projects/p1/context");
    expect(request.body).toBeUndefined();
  });

  it("sends the fields the path did not consume as query parameters", () => {
    const request = buildRequest(
      AGENT_ROUTES.find((route) => route.id === "events.snapshot")!,
      {
        project_id: "p1",
        filter_digest: "b".repeat(64),
        cursor: "c1_abc",
        last_event_id: null,
      },
      base,
    );
    expect(request.url).toContain("/api/agent/v1/projects/p1/events-snapshot?");
    expect(request.url).toContain("filter_digest=");
    expect(request.url).toContain("cursor=c1_abc");
    expect(request.url).not.toContain("last_event_id");
  });

  it("sends the whole input as the body of a write route", () => {
    const request = buildRequest(
      AGENT_ROUTES.find((route) => route.id === "artifact.put")!,
      {
        meta: { idempotency_key: "k1", correlation_id: "c1" },
        project_id: "p1",
        artifact_id: null,
        base_version: 0,
        input_digest: "c".repeat(64),
        content: { kind: "script", paragraphs: [] },
        input_refs: [],
      },
      base,
    );
    expect(request.url).toBe("http://127.0.0.1:4173/api/agent/v1/projects/p1/artifacts");
    expect(request.body).toContain("\"project_id\":\"p1\"");
  });

  it("refuses to address a route whose identifier is missing", () => {
    expect(() => buildRequest(
      AGENT_ROUTES.find((route) => route.id === "job.read")!,
      { project_id: "p1" },
      base,
    )).toThrow(HostCallError);
  });
});

describe("A-MCP error mapping", () => {
  it("keeps the host's code and status when they match the contract", () => {
    const envelope = errorFromHostResponse(409, { code: "REVISION_CONFLICT", message: "stale base" }, "cid");
    expect(envelope.code).toBe("REVISION_CONFLICT");
    expect(envelope.http_status).toBe(409);
    expect(envelope.correlation_id).toBe("cid");
    expect(envelope.retryable).toBe(false);
  });

  it("keeps the host's own retryability and next actions", () => {
    const envelope = errorFromHostResponse(
      503,
      { code: "HOST_RESOURCE_EXHAUSTED", message: "busy", retryable: false, next_actions: ["wait"] },
      "cid",
    );
    expect(envelope.retryable).toBe(false);
    expect(envelope.next_actions).toEqual(["wait"]);
  });

  it("falls back to the status when the body carries no contract code", () => {
    const envelope = errorFromHostResponse(410, { message: "gone" }, "cid");
    expect(envelope.code).toBe("CURSOR_EXPIRED");
    expect(envelope.http_status).toBe(410);
    expect(envelope.next_actions).toContain("resync_snapshot");
  });

  it("refuses a code and status the contract does not pair", () => {
    const envelope = errorFromHostResponse(400, { code: "NOT_FOUND", message: "impossible" }, "cid");
    expect(envelope.code).toBe("INTERNAL_ERROR");
    expect(envelope.http_status).toBe(500);
  });

  it("reports an unreachable host as a retryable capability failure", () => {
    const envelope = errorFromTransportFailure("The host could not be reached.", "cid");
    expect(envelope.code).toBe("CAPABILITY_UNAVAILABLE");
    expect(envelope.http_status).toBe(503);
    expect(envelope.retryable).toBe(true);
  });

  it("reports an unknown write outcome as non-retryable and asks for reconciliation", () => {
    const envelope = errorFromUnknownOutcome("The write was sent but no answer arrived.", "cid");
    expect(envelope.code).toBe("PROVIDER_RESULT_UNKNOWN");
    expect(envelope.http_status).toBe(428);
    expect(envelope.retryable).toBe(false);
    expect(envelope.next_actions).toContain("reconcile_by_idempotency_key");
  });

  it("never echoes a local path", () => {
    const envelope = errorFromHostResponse(500, { code: "INTERNAL_ERROR", message: "failed at /home/user/secret/file.json" }, "cid");
    expect(envelope.message).not.toContain("/home/user");
    expect(envelope.message).toContain("<path>");
  });
});

describe("A-MCP contract handshake", () => {
  it("verifies the host's contract version before the first dispatch", async () => {
    const { ports, calls } = fakePorts({ instance: INSTANCE, "context.read": CONTEXT });
    const client = await connect(ports);
    const result = await client.callTool({
      name: "narralens_context_read",
      arguments: { project_id: "p1" },
    });

    expect(result.isError).toBeFalsy();
    expect(calls).toEqual(["instance", "context.read"]);
    await client.close();
  });

  it("refuses a host that speaks another contract, before any write is sent", async () => {
    const { ports, calls } = fakePorts({ instance: FOREIGN_INSTANCE, "context.read": CONTEXT });
    const client = await connect(ports);
    const result = await client.callTool({
      name: "narralens_context_read",
      arguments: { project_id: "p1" },
    });

    expect(result.isError).toBe(true);
    const envelope = result.structuredContent as { code: string; retryable: boolean };
    expect(envelope.code).toBe("CAPABILITY_UNAVAILABLE");
    expect(envelope.retryable).toBe(false);
    // The handshake was refused, so the route was never dispatched.
    expect(calls).toEqual(["instance"]);
    await client.close();
  });

  it("accepts an explicitly injected, verified handshake", async () => {
    const { ports, calls } = fakePorts({ "context.read": CONTEXT });
    const client = await connect(ports, { handshake: async () => INSTANCE });
    const result = await client.callTool({
      name: "narralens_context_read",
      arguments: { project_id: "p1" },
    });

    expect(result.isError).toBeFalsy();
    expect(calls).toEqual(["context.read"]);
    await client.close();
  });
});

describe("A-MCP façade behaviour", () => {
  it("advertises exactly the allowlist and the registered resource templates", async () => {
    const { ports } = fakePorts({ instance: INSTANCE });
    const client = await connect(ports);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(exposedToolNames().slice().sort());

    const templates = await client.listResourceTemplates();
    // Four of the five registered resources are templates; the health resource is
    // concrete and is listed as a resource.
    expect(templates.resourceTemplates).toHaveLength(4);
    expect(templates.resourceTemplates.map((template) => template.uriTemplate).sort())
      .toEqual(AGENT_RESOURCES.filter((resource) => resource.uri.includes("{")).map((resource) => resource.uri).sort());

    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toEqual(["narralens://services/health"]);
    await client.close();
  });

  it("returns the contract output for a valid call", async () => {
    const { ports } = fakePorts({ instance: INSTANCE });
    const client = await connect(ports);
    const result = await client.callTool({ name: "narralens_capabilities" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(INSTANCE);
    await client.close();
  });

  it("rejects an unknown tool without reaching the host", async () => {
    const { ports, calls } = fakePorts({ instance: INSTANCE });
    const client = await connect(ports);
    const result = await client.callTool({ name: "narralens_not_a_tool" });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code: string }).code).toBe("INVALID_REQUEST");
    expect(calls).toEqual([]);
    await client.close();
  });

  it("rejects an unknown field before reaching the host", async () => {
    const { ports, calls } = fakePorts({ instance: INSTANCE });
    const client = await connect(ports);
    const result = await client.callTool({
      name: "narralens_context_read",
      arguments: { project_id: "p1", not_a_field: true },
    });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code: string }).code).toBe("INVALID_REQUEST");
    expect(calls).toEqual([]);
    await client.close();
  });

  it("refuses an injected output that is not the route's contract", async () => {
    const { ports } = fakePorts({ instance: INSTANCE, "context.read": { project_id: "p1" } });
    const client = await connect(ports);
    const result = await client.callTool({
      name: "narralens_context_read",
      arguments: { project_id: "p1" },
    });
    expect(result.isError).toBe(true);
    const envelope = result.structuredContent as { code: string; http_status: number };
    expect(envelope.code).toBe("INTERNAL_ERROR");
    expect(envelope.http_status).toBe(500);
    await client.close();
  });

  it("reports the host's error envelope unchanged", async () => {
    const { ports } = fakePorts({ instance: INSTANCE });
    const client = await connect(ports);
    const result = await client.callTool({ name: "narralens_context_read", arguments: { project_id: "p1" } });
    expect(result.isError).toBe(true);
    const envelope = result.structuredContent as { code: string; http_status: number };
    expect(envelope.code).toBe("NOT_FOUND");
    expect(envelope.http_status).toBe(404);
    await client.close();
  });
});

describe("A-MCP resource reads", () => {
  it("reads a project resource as the projection the registry describes", async () => {
    const { ports } = fakePorts({ instance: INSTANCE, "context.read": CONTEXT });
    const client = await connect(ports);
    const result = await client.readResource({ uri: "narralens://projects/p1/context" });
    const payload = JSON.parse(resourceText(result));
    expect(payload.project_id).toBe("p1");
    expect(payload.source_digest).toBe("a".repeat(64));
    await client.close();
  });

  it("projects the jobs resource as an object, not a bare array", async () => {
    const { ports } = fakePorts({ instance: INSTANCE, "context.read": CONTEXT });
    const client = await connect(ports);
    const result = await client.readResource({ uri: "narralens://projects/p1/jobs" });
    const payload = JSON.parse(resourceText(result));
    expect(Array.isArray(payload)).toBe(false);
    expect(payload.project_id).toBe("p1");
    expect(payload.active_jobs).toEqual([]);
    await client.close();
  });

  it("refuses a malformed project id without calling the port", async () => {
    const { ports, calls } = fakePorts({ instance: INSTANCE, "context.read": CONTEXT });
    const client = await connect(ports);
    const result = await client.readResource({ uri: "narralens://projects/bad%20id!/context" });
    const payload = JSON.parse(resourceText(result));
    expect(payload.code).toBe("INVALID_REQUEST");
    expect(calls).not.toContain("context.read");
    await client.close();
  });

  it("refuses a query parameter the resource does not accept", async () => {
    const { ports, calls } = fakePorts({ instance: INSTANCE, "context.read": CONTEXT });
    const client = await connect(ports);
    const result = await client.readResource({ uri: "narralens://projects/p1/context?unexpected=1" });
    const payload = JSON.parse(resourceText(result));
    expect(payload.code).toBe("INVALID_REQUEST");
    expect(calls).not.toContain("context.read");
    await client.close();
  });

  it("answers the snapshot resource with a configuration failure when no digest is configured", async () => {
    const { ports, calls } = fakePorts({ instance: INSTANCE, "events.snapshot": SNAPSHOT });
    const client = await connect(ports);
    const result = await client.readResource({ uri: "narralens://projects/p1/events-snapshot" });
    const payload = JSON.parse(resourceText(result));
    expect(payload.code).toBe("INTERNAL_ERROR");
    expect(payload.message).toContain("filter digest");
    expect(calls).not.toContain("events.snapshot");
    await client.close();
  });

  it("uses the configured digest for the snapshot resource", async () => {
    const { ports, calls } = fakePorts({ instance: INSTANCE, "events.snapshot": SNAPSHOT });
    const client = await connect(ports, { filterDigest: "b".repeat(64) });
    const result = await client.readResource({ uri: "narralens://projects/p1/events-snapshot" });
    const payload = JSON.parse(resourceText(result));
    expect(payload.code).toBeUndefined();
    expect(payload.snapshot_event_id).toBe(40);
    expect(calls).toContain("events.snapshot");
    await client.close();
  });

  it("refuses a URI that cannot be percent-decoded", async () => {
    const { ports, calls } = fakePorts({ instance: INSTANCE, "context.read": CONTEXT });
    const client = await connect(ports);
    const result = await client.readResource({ uri: "narralens://projects/bad%ZZ/context" });
    const payload = JSON.parse(resourceText(result));
    expect(payload.code).toBe("INVALID_REQUEST");
    expect(calls).not.toContain("context.read");
    await client.close();
  });

  it("matches the registered resource URIs", () => {
    expect(matchResourceUri("narralens://services/health")).toEqual({
      resource: expect.objectContaining({ uri: "narralens://services/health" }),
      projectId: null,
    });
    expect(matchResourceUri("narralens://projects/p1/workflow")?.projectId).toBe("p1");
    expect(matchResourceUri("narralens://not/a/resource")).toBeNull();
  });
});
