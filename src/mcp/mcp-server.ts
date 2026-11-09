/**
 * The MCP façade (BRIDGE / E07, case A-MCP).
 *
 * A stdio MCP server that exposes the frozen CP-A0 registry and nothing else. It is
 * a *protocol* surface over the Host's application ports: it does not implement a
 * single business rule, it validates, routes and reports.
 *
 * What the façade guarantees:
 *
 * - **An exact tool allowlist.** The tool list is derived from the registry: a route
 *   with a `tool` name becomes a tool, a route without one does not. The trusted-UI
 *   and native-bridge routes have no tool, so no MCP client can call
 *   `review.decide` or `editor.native.ack` and pretend to be the human or the
 *   editor.
 * - **A contract handshake before the first dispatch.** Before the façade asks the
 *   Host for anything except the instance itself, it verifies the Host's
 *   `api_version` and `contract_version` against the frozen contract. A Host that
 *   speaks a different contract is refused *before* a write is sent, not after.
 *   The handshake is a real read of the Host's own instance; the façade does not
 *   invent capabilities or a registration.
 * - **Strict inputs and outputs, on both surfaces.** Every tool call and every
 *   resource read validates its input against the route's contract definition
 *   before the port is called, and validates the port's output against the route's
 *   output definition before the client sees it. Unknown fields are rejected, not
 *   stripped. An off-contract value becomes an internal error rather than a fact the
 *   client acts on.
 * - **Contract errors.** A failure is reported with the contract's `Error`
 *   envelope — the same code, status, retryability and next actions the Host would
 *   have used — so a client can tell "resynchronise" from "retry" from "this will
 *   never work".
 *
 * `tools/list` is protocol-only: it is answered by the façade alone and never
 * touches the Host. Everything that dispatches to the Host performs the handshake
 * first.
 */

import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  CallToolResult,
  ListResourceTemplatesResult,
  ListResourcesResult,
  ListToolsResult,
  ReadResourceResult,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { ApplicationPorts, Context, Error as AgentError, Instance } from "../contracts/agent-driven-types.js";
import {
  AgentContractError,
  validateAgentDefinition,
  validateAgentRouteInput,
  validateAgentRouteOutput,
} from "../contracts/agent-driven-validator.js";
import { HostCallError } from "./host-application-ports.js";
import {
  buildAgentError,
  errorFromConfiguration,
  errorFromInvalidRequest,
} from "./host-error-mapping.js";
import {
  AGENT_RESOURCES,
  exposedToolRoutes,
  isResourceTemplate,
  matchResourceUri,
  routeById,
  routeByToolName,
  type AgentRouteView,
} from "./registry-view.js";
import { toolDescription, toolInputSchema } from "./tool-schemas.js";

/** The name the façade reports to a client. */
export const MCP_SERVER_NAME = "narralens";
/** The façade's own version. It is not the contract version; see `instance`. */
export const MCP_SERVER_VERSION = "1.0.0";

/** The contract version this façade speaks. */
export const FACADE_CONTRACT_VERSION = "cp-a0-r4";
/** The API version this façade speaks. */
export const FACADE_API_VERSION = "agent.v1";

/**
 * The Host answered, but it speaks a different contract.
 *
 * This is refused before any write is sent: sending a `cp-a0-r4` payload to a Host
 * that expects something else is how a request ends up half-understood.
 */
export class HandshakeMismatchError extends Error {
  constructor(readonly apiVersion: string, readonly contractVersion: string) {
    super("The host speaks a different contract version.");
    this.name = "HandshakeMismatchError";
  }
}

/** The façade was asked for something it has not been configured to serve. */
export class FacadeConfigurationError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = "FacadeConfigurationError";
  }
}

export interface McpFacadeOptions {
  /** The Host's application ports. */
  readonly ports: ApplicationPorts;
  /**
   * An explicit, already-verified handshake.
   *
   * MAIN may inject this when it has already verified the instance (for example
   * during composition) instead of letting the façade read the `instance` route.
   * The injected value is verified against the same rules either way: the frozen
   * `Instance` schema, the API version and the contract version.
   */
  readonly handshake?: () => Promise<Instance>;
  /**
   * The filter digest the events-snapshot resource uses when its URI carries none.
   *
   * This is MAIN's policy, and it is required for that one resource only: the
   * digest identifies the filter a client's view is built on, and the façade does
   * not get to invent one. Without it the snapshot resource answers with a
   * configuration failure, while the discovery and read tools keep working.
   */
  readonly filterDigest?: string;
  readonly serverName?: string;
  readonly serverVersion?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The tool definitions the façade advertises, in registry order. */
export function buildToolDefinitions(): Tool[] {
  return exposedToolRoutes().map((route) => ({
    name: route.tool as string,
    description: toolDescription(route),
    inputSchema: toolInputSchema(route) as unknown as Tool["inputSchema"],
  }));
}

/** A compact, safe description of why a payload was rejected. */
function describeValidationFailure(route: AgentRouteView, error: unknown): string {
  if (error instanceof AgentContractError) {
    if (error.violations.length === 0) {
      return `The route ${route.id} does not accept arguments.`;
    }
    const details = error.violations
      .slice(0, 8)
      .map((violation) => `${violation.instancePath === "" ? "/" : violation.instancePath}:${violation.keyword}`)
      .join(", ");
    return `The input for ${route.id} does not match the ${route.input} contract (${details}).`;
  }
  return `The input for ${route.id} could not be validated.`;
}

/**
 * Check that an envelope really is a contract error before it crosses the protocol.
 *
 * The façade receives envelopes from two places — the Host client and its own
 * refusals — and both are supposed to produce contract errors. One that does not is
 * a fault, and it is reported as an internal error rather than passed on as
 * something the client would try to interpret.
 */
function checkedEnvelope(envelope: AgentError, correlationId: string): AgentError {
  try {
    return validateAgentDefinition<AgentError>("Error", envelope);
  } catch {
    return buildAgentError({
      code: "INTERNAL_ERROR",
      message: "The failure could not be expressed as a contract error.",
      correlation_id: correlationId,
    });
  }
}

function errorResult(envelope: AgentError, correlationId: string): CallToolResult {
  const checked = checkedEnvelope(envelope, correlationId);
  return {
    content: [{ type: "text", text: checked.message }],
    structuredContent: checked as unknown as Record<string, unknown>,
    isError: true,
  };
}

/**
 * Project a route output into the payload a resource read returns.
 *
 * The registry states the projection for the jobs resource explicitly: "active_jobs
 * plus context identity; not a bare array". A bare array would lose the project the
 * jobs belong to, and a client that re-reads it cannot tell which project it is
 * looking at.
 */
export function projectResourcePayload(resourceUri: string, output: unknown): unknown {
  if (resourceUri.endsWith("/jobs")) {
    const context = output as Context;
    return {
      project_id: context.project_id,
      project_revision: context.project_revision,
      snapshot_id: context.snapshot_id,
      source_digest: context.source_digest,
      active_jobs: context.active_jobs,
    };
  }
  return output;
}

/** The query parameters the events-snapshot resource accepts. */
const SNAPSHOT_QUERY_PARAMETERS: ReadonlySet<string> = new Set([
  "filter_digest",
  "cursor",
  "last_event_id",
]);

/**
 * Build the MCP server.
 *
 * The server is returned unconnected; the caller attaches the transport. That keeps
 * the stdio wiring in one place and lets the tests drive the same server over an
 * in-memory transport.
 */
export function createMcpServer(options: McpFacadeOptions): Server {
  const ports = options.ports as unknown as Record<string, (input: unknown) => Promise<unknown>>;
  let handshake: Promise<Instance> | undefined;

  /**
   * Verify the Host's contract version, once, before the first dispatch.
   *
   * A successful handshake is remembered: the contract version of a running Host
   * does not change under the façade. A failed one is *not* remembered, because a
   * Host that was starting up may answer a moment later.
   */
  async function ensureHandshake(): Promise<void> {
    if (handshake !== undefined) {
      await handshake;
      return;
    }
    const attempt = (async () => {
      const raw = options.handshake !== undefined
        ? await options.handshake()
        : await ports["instance"]!(undefined);
      // The versions are read before the schema is applied, so a Host that speaks
      // another contract is refused as a version mismatch rather than as a malformed
      // instance: the two need different answers.
      const apiVersion = isRecord(raw) && typeof raw["api_version"] === "string" ? raw["api_version"] : "unknown";
      const contractVersion = isRecord(raw) && typeof raw["contract_version"] === "string"
        ? raw["contract_version"]
        : "unknown";
      if (apiVersion !== FACADE_API_VERSION || contractVersion !== FACADE_CONTRACT_VERSION) {
        throw new HandshakeMismatchError(apiVersion, contractVersion);
      }
      return validateAgentRouteOutput("instance", raw);
    })();
    handshake = attempt;
    try {
      await attempt;
    } catch (error) {
      handshake = undefined;
      throw error;
    }
  }

  /** The envelope for a failure that happened before or outside a dispatch. */
  function envelopeForUnexpected(error: unknown, correlationId: string, context: string): AgentError {
    if (error instanceof HandshakeMismatchError) {
      return buildAgentError({
        code: "CAPABILITY_UNAVAILABLE",
        message: "The host speaks a different contract version than this facade.",
        correlation_id: correlationId,
        retryable: false,
        next_actions: ["check_host_contract_version"],
      });
    }
    if (error instanceof FacadeConfigurationError) {
      return errorFromConfiguration(error.message, correlationId);
    }
    if (error instanceof HostCallError) {
      return error.envelope;
    }
    return buildAgentError({
      code: "INTERNAL_ERROR",
      message: context,
      correlation_id: correlationId,
    });
  }

  const server = new Server(
    {
      name: options.serverName ?? MCP_SERVER_NAME,
      version: options.serverVersion ?? MCP_SERVER_VERSION,
    },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: [
        "Narralens exposes the frozen agent.v1 registry over MCP.",
        "Tools are exactly the registry's routes that carry a tool name; the trusted-UI",
        "and native-bridge routes are not exposed and must be completed in the workbench.",
        "The facade verifies the host's contract version before it dispatches anything.",
        "Every error is the contract's Error envelope: read its code and next_actions",
        "before retrying. CURSOR_EXPIRED means resynchronise, not retry.",
        "PROVIDER_RESULT_UNKNOWN means a write may or may not have been applied:",
        "read the facts back under the original idempotency key before doing anything.",
      ].join(" "),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => ({
    tools: buildToolDefinitions(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const correlationId = randomUUID();
    const name = request.params.name;
    const route = routeByToolName(name);
    if (route === null) {
      return errorResult(buildAgentError({
        code: "INVALID_REQUEST",
        message: `Unknown tool ${name}.`,
        correlation_id: correlationId,
      }), correlationId);
    }
    const args = request.params.arguments;

    let input: unknown;
    try {
      if (route.input === null) {
        // A route without input accepts nothing. An empty argument object is the
        // same as no arguments, because that is what MCP clients send; anything
        // else is a contract violation.
        if (args !== undefined && Object.keys(args).length > 0) {
          throw new AgentContractError("no-input", []);
        }
        input = undefined;
      } else {
        input = validateAgentRouteInput(route.id, args ?? {});
      }
    } catch (error) {
      return errorResult(buildAgentError({
        code: "INVALID_REQUEST",
        message: describeValidationFailure(route, error),
        correlation_id: correlationId,
      }), correlationId);
    }

    // The handshake covers every dispatch except the instance route itself.
    if (route.id !== "instance") {
      try {
        await ensureHandshake();
      } catch (error) {
        return errorResult(envelopeForUnexpected(
          error,
          correlationId,
          `The host contract could not be verified before ${route.id}.`,
        ), correlationId);
      }
    }

    try {
      const output = await ports[route.id]!(input);
      // The output is validated here as well as in the HTTP client, so the guarantee
      // holds for an in-process port too: a client never receives a value that is
      // not the contract's output for this route.
      const validated = validateAgentRouteOutput(route.id, output);
      const structured = validated as unknown as Record<string, unknown>;
      return {
        content: [{ type: "text", text: JSON.stringify(structured) }],
        structuredContent: structured,
      };
    } catch (error) {
      return errorResult(envelopeForUnexpected(
        error,
        correlationId,
        `The tool ${name} failed unexpectedly.`,
      ), correlationId);
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async (): Promise<ListResourcesResult> => ({
    resources: AGENT_RESOURCES
      .filter((resource) => !isResourceTemplate(resource.uri))
      .map((resource) => ({
        uri: resource.uri,
        name: resource.uri,
        description: `Narralens ${resource.output} for ${resource.source}.`,
        mimeType: "application/json",
      })),
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (): Promise<ListResourceTemplatesResult> => ({
    resourceTemplates: AGENT_RESOURCES
      .filter((resource) => isResourceTemplate(resource.uri))
      .map((resource) => ({
        uriTemplate: resource.uri,
        name: resource.uri,
        description: [
          `Narralens ${resource.output} for ${resource.source}.`,
          resource.projection === null ? "" : `Projection: ${resource.projection}.`,
        ].filter((part) => part.length > 0).join(" "),
        mimeType: "application/json",
      })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request): Promise<ReadResourceResult> => {
    const correlationId = randomUUID();
    const rawUri = request.params.uri;
    const [uriPath = rawUri, query = ""] = rawUri.split("?");
    const match = matchResourceUri(uriPath);
    if (match === null) {
      return {
        contents: [{
          uri: rawUri,
          mimeType: "application/json",
          text: JSON.stringify(errorFromInvalidRequest(`Unknown resource ${uriPath}.`, correlationId)),
        }],
      };
    }
    const route = routeById(match.resource.source);

    // A percent-decode failure is a client error, not a crash: the URI is what the
    // client sent, and refusing it is an answer.
    let projectId: string;
    try {
      projectId = match.projectId === null ? "" : decodeURIComponent(match.projectId);
    } catch {
      return {
        contents: [{
          uri: rawUri,
          mimeType: "application/json",
          text: JSON.stringify(errorFromInvalidRequest(
            "The resource URI could not be decoded.",
            correlationId,
          )),
        }],
      };
    }

    const parameters = new URLSearchParams(query);
    const allowed = route.id === "events.snapshot" ? SNAPSHOT_QUERY_PARAMETERS : new Set<string>();
    for (const key of parameters.keys()) {
      if (!allowed.has(key)) {
        return {
          contents: [{
            uri: rawUri,
            mimeType: "application/json",
            text: JSON.stringify(errorFromInvalidRequest(
              `The resource ${uriPath} does not accept the query parameter ${key}.`,
              correlationId,
            )),
          }],
        };
      }
    }

    let input: unknown;
    try {
      if (route.input === null) {
        input = undefined;
      } else if (route.id === "events.snapshot") {
        const provided = parameters.get("filter_digest");
        if (provided !== null && provided.length === 0) {
          // The client sent an empty digest. That is a malformed value, not a
          // missing policy, and the two are answered differently.
          throw new AgentContractError("CursorRead", []);
        }
        const filterDigest = provided ?? options.filterDigest;
        if (filterDigest === undefined || filterDigest.length === 0) {
          // The digest identifies the filter the snapshot is built on. The façade
          // will not invent one, so this is a configuration failure — and it is a
          // failure of one resource, not of the whole façade.
          throw new FacadeConfigurationError(
            "filter_digest_not_configured",
            "The events-snapshot resource needs a filter digest, and none is configured.",
          );
        }
        input = {
          project_id: projectId,
          filter_digest: filterDigest,
          cursor: parameters.get("cursor"),
          last_event_id: parameters.get("last_event_id"),
        };
      } else {
        input = { project_id: projectId };
      }
      // The input is validated before the port is called: a malformed project id or
      // a malformed cursor must never reach the Host.
      input = validateAgentRouteInput(route.id, input);
    } catch (error) {
      const envelope = error instanceof FacadeConfigurationError
        ? errorFromConfiguration(error.message, correlationId)
        : buildAgentError({
          code: "INVALID_REQUEST",
          message: describeValidationFailure(route, error),
          correlation_id: correlationId,
        });
      return {
        contents: [{
          uri: rawUri,
          mimeType: "application/json",
          text: JSON.stringify(envelope),
        }],
      };
    }

    try {
      await ensureHandshake();
    } catch (error) {
      return {
        contents: [{
          uri: rawUri,
          mimeType: "application/json",
          text: JSON.stringify(envelopeForUnexpected(
            error,
            correlationId,
            `The host contract could not be verified before reading ${uriPath}.`,
          )),
        }],
      };
    }

    try {
      const output = validateAgentRouteOutput(route.id, await ports[route.id]!(input));
      return {
        contents: [{
          uri: rawUri,
          mimeType: "application/json",
          text: JSON.stringify(projectResourcePayload(uriPath, output)),
        }],
      };
    } catch (error) {
      return {
        contents: [{
          uri: rawUri,
          mimeType: "application/json",
          text: JSON.stringify(envelopeForUnexpected(
            error,
            correlationId,
            `The resource ${uriPath} could not be read.`,
          )),
        }],
      };
    }
  });

  return server;
}

/** True when a value looks like the contract's error envelope. */
export function isAgentErrorEnvelope(value: unknown): value is AgentError {
  return isRecord(value) && value["schema_version"] === "agent.v1" && typeof value["code"] === "string";
}
