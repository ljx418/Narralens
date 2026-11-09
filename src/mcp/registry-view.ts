/**
 * A typed, checked view over the frozen CP-A0 registry (BRIDGE / E07).
 *
 * The MCP façade is a *protocol* surface: it exposes exactly what the frozen
 * registry says exists, and nothing else. That means the registry — not this module,
 * not a hand-written tool list — is the single source of truth for:
 *
 * - which tools exist (a route with a `tool` name),
 * - which routes deliberately have **no** tool (the trusted-UI and native-bridge
 *   routes: a client that could call `intake.confirm` or `review.decide` would be
 *   able to forge a human approval),
 * - which resources exist and which route each one projects from,
 * - the HTTP status each error code maps to.
 *
 * The view is built with runtime checks rather than casts. If the registry drifts —
 * a new route, a renamed tool, a path parameter this module does not know how to
 * bind — the module throws at load time instead of silently exposing a tool whose
 * input cannot be routed, or quietly dropping a route.
 */

import registry from "../../contracts/agent-driven-a.registry.json" with { type: "json" };
import contractSchema from "../../contracts/agent-driven-a.schema.json" with { type: "json" };
import type { ApplicationPorts } from "../contracts/agent-driven-types.js";

const CONTRACT_DEFINITIONS = (contractSchema as unknown as {
  $defs: Record<string, { properties?: Record<string, unknown> }>;
}).$defs;

/** The route ids of the frozen registry. */
export type AgentRouteId = keyof ApplicationPorts;

/** The number of routes the contract freezes. */
export const AGENT_ROUTE_COUNT = 31;

export interface AgentRouteView {
  readonly id: AgentRouteId;
  readonly method: "GET" | "POST";
  readonly path: string;
  /** The MCP tool name, or `null` when the route is deliberately not exposed. */
  readonly tool: string | null;
  /** The contract definition of the input, or `null` for routes without input. */
  readonly input: string | null;
  readonly output: string;
  readonly scope: string;
  readonly owner: string;
  readonly authChannel: string;
  readonly gatePolicy: string;
}

/** The route ids of the frozen contract, spelled out so drift is caught at load. */
const ROUTE_ID_SET: ReadonlySet<string> = new Set([
  "instance",
  "intake.put",
  "intake.confirm",
  "project.create",
  "context.read",
  "artifact.put",
  "task.prepare",
  "job.read",
  "job.cancel",
  "change.prepare",
  "change.approve",
  "change.apply",
  "events.snapshot",
  "health.read",
  "delivery.read",
  "workflow.read",
  "intake.read",
  "question.put",
  "question.answer",
  "question.answer.ui",
  "content.relay",
  "workflow.run.prepare",
  "workflow.run.authorize",
  "workflow.run.read",
  "workflow.run.start",
  "workflow.run.pause",
  "workflow.run.resume",
  "workflow.run.cancel",
  "review.read",
  "review.decide",
  "editor.native.ack",
]);

/**
 * How each path placeholder is filled from the route's input.
 *
 * The registry's paths use `:name` placeholders; the inputs use different field
 * names (`project_id`, not `id`). This table is the explicit, auditable bridge
 * between them. It is checked against the registry at load time: every placeholder
 * in every path must appear here, and every route that needs bindings must have
 * them.
 */
export const ROUTE_PATH_BINDINGS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  "intake.confirm": { id: "intake_id" },
  "context.read": { id: "project_id" },
  "artifact.put": { id: "project_id" },
  "task.prepare": { id: "project_id" },
  "job.read": { id: "project_id", job: "job_id" },
  "job.cancel": { id: "project_id", job: "job_id" },
  "change.prepare": { id: "project_id" },
  "change.approve": { id: "project_id", impact: "impact_id" },
  "change.apply": { id: "project_id" },
  "events.snapshot": { id: "project_id" },
  "delivery.read": { id: "project_id", job: "job_id" },
  "workflow.read": { id: "project_id" },
  "intake.read": { id: "intake_id" },
  "question.put": { id: "intake_id" },
  "question.answer": { id: "intake_id", question: "question_id" },
  "question.answer.ui": { id: "intake_id", question: "question_id" },
  "workflow.run.prepare": { id: "project_id" },
  "workflow.run.authorize": { id: "project_id", run: "run_id" },
  "workflow.run.read": { id: "project_id", run: "run_id" },
  "workflow.run.start": { id: "project_id", run: "run_id" },
  "workflow.run.pause": { id: "project_id", run: "run_id" },
  "workflow.run.resume": { id: "project_id", run: "run_id" },
  "workflow.run.cancel": { id: "project_id", run: "run_id" },
  "review.read": { id: "project_id", run: "run_id", package: "package_id" },
  "review.decide": { id: "project_id", run: "run_id", package: "package_id" },
  "editor.native.ack": { id: "ack.project_id" },
});

/** The placeholders in a registry path. */
export function pathPlaceholders(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1] as string);
}

function assertRegistryShape(): void {
  if (registry.routes.length !== AGENT_ROUTE_COUNT) {
    throw new Error(`agent_registry_route_count_changed:${registry.routes.length}`);
  }
  const seenIds = new Set<string>();
  const seenTools = new Set<string>();
  for (const route of registry.routes) {
    if (!ROUTE_ID_SET.has(route.id)) {
      throw new Error(`agent_registry_unknown_route:${route.id}`);
    }
    if (seenIds.has(route.id)) {
      throw new Error(`agent_registry_duplicate_route:${route.id}`);
    }
    seenIds.add(route.id);
    if (route.method !== "GET" && route.method !== "POST") {
      throw new Error(`agent_registry_unknown_method:${route.id}`);
    }
    if (route.tool !== null && seenTools.has(route.tool)) {
      throw new Error(`agent_registry_duplicate_tool:${route.tool}`);
    }
    if (route.tool !== null) seenTools.add(route.tool);
    if (route.registrationOwner !== "MAIN" || route.protocolOwner !== "BRIDGE") {
      throw new Error(`agent_registry_ownership_changed:${route.id}`);
    }
    const bindings = ROUTE_PATH_BINDINGS[route.id];
    const placeholders = pathPlaceholders(route.path);
    if (placeholders.length === 0) {
      if (bindings !== undefined) {
        throw new Error(`agent_registry_unexpected_path_bindings:${route.id}`);
      }
      continue;
    }
    if (bindings === undefined) {
      throw new Error(`agent_registry_missing_path_bindings:${route.id}`);
    }
    for (const placeholder of placeholders) {
      const field = bindings[placeholder];
      if (field === undefined) {
        throw new Error(`agent_registry_unbound_path_placeholder:${route.id}:${placeholder}`);
      }
      if (route.input !== null) {
        // The bound field has to exist in the route's input definition, otherwise the
        // path could never be filled from a validated payload.
        const definition = CONTRACT_DEFINITIONS[route.input];
        const root = field.includes(".") ? field.slice(0, field.indexOf(".")) : field;
        if (definition?.properties === undefined || definition.properties[root] === undefined) {
          throw new Error(`agent_registry_unknown_bound_field:${route.id}:${field}`);
        }
      }
    }
  }
}

assertRegistryShape();

/** Every route, in registry order, checked against the frozen shape. */
export const AGENT_ROUTES: readonly AgentRouteView[] = Object.freeze(
  registry.routes.map((route) => ({
    id: route.id as AgentRouteId,
    method: route.method as "GET" | "POST",
    path: route.path,
    tool: route.tool,
    input: route.input,
    output: route.output,
    scope: route.scope,
    owner: route.owner,
    authChannel: route.authChannel,
    gatePolicy: route.gatePolicy,
  })),
);

/** Every route id, in registry order. */
export const AGENT_ROUTE_IDS: readonly AgentRouteId[] = Object.freeze(AGENT_ROUTES.map((route) => route.id));

const ROUTES_BY_ID = new Map<AgentRouteId, AgentRouteView>(
  AGENT_ROUTES.map((route): [AgentRouteId, AgentRouteView] => [route.id, route]),
);

/** The route with this id. */
export function routeById(id: AgentRouteId): AgentRouteView {
  const route = ROUTES_BY_ID.get(id);
  if (route === undefined) throw new Error(`unknown_agent_route:${id}`);
  return route;
}

/**
 * The routes that are exposed as MCP tools.
 *
 * A route without a `tool` name is deliberately not exposed. That covers the
 * trusted-UI routes (`intake.confirm`, `change.approve`, `question.answer.ui`,
 * `workflow.run.authorize`, `review.decide`) and the native-bridge route
 * (`editor.native.ack`): an MCP client must not be able to speak as the human or as
 * the native editor.
 */
export function exposedToolRoutes(): readonly AgentRouteView[] {
  return AGENT_ROUTES.filter((route) => route.tool !== null);
}

/** The tool names, in registry order. */
export function exposedToolNames(): readonly string[] {
  return exposedToolRoutes().map((route) => route.tool as string);
}

/** The route behind a tool name. */
export function routeByToolName(tool: string): AgentRouteView | null {
  return exposedToolRoutes().find((route) => route.tool === tool) ?? null;
}

export interface AgentResourceView {
  readonly uri: string;
  readonly output: string;
  /** The route id the resource is projected from. */
  readonly source: AgentRouteId;
  /** A human-readable note about the projection, or `null`. */
  readonly projection: string | null;
}

/** Every resource the contract registers. */
export const AGENT_RESOURCES: readonly AgentResourceView[] = Object.freeze(
  registry.resources.map((resource) => {
    if (!ROUTE_ID_SET.has(resource.source)) {
      throw new Error(`agent_registry_unknown_resource_source:${resource.source}`);
    }
    return {
      uri: resource.uri,
      output: resource.output,
      source: resource.source as AgentRouteId,
      projection: resource.projection,
    };
  }),
);

function resourceUriPattern(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withCapture = escaped.replace(/\\\{[A-Za-z0-9_]+\\\}/g, "([^/]+)");
  return new RegExp(`^${withCapture}$`);
}

/**
 * Match a resource URI against the registered templates.
 *
 * The templates use RFC 6570 style `{id}` placeholders. Every registered template
 * binds its placeholder to the `project_id` field of the source route's input, which
 * is why the substitution is a table and not a heuristic. A resource without a
 * placeholder (`narralens://services/health`) matches literally and carries no
 * project id.
 */
export function matchResourceUri(uri: string): { resource: AgentResourceView; projectId: string | null } | null {
  for (const resource of AGENT_RESOURCES) {
    const match = resourceUriPattern(resource.uri).exec(uri);
    if (match === null) continue;
    const captured = match[1];
    return {
      resource,
      projectId: captured === undefined ? null : decodeURIComponent(captured),
    };
  }
  return null;
}

/** True when a registered resource URI is a template rather than a concrete URI. */
export function isResourceTemplate(uri: string): boolean {
  return uri.includes("{");
}

/** The error codes the contract defines, with their HTTP status. */
export const AGENT_ERROR_STATUS = new Map<string, number>(
  registry.errorMapping.map((entry) => [entry.code, entry.http_status] as [string, number]),
);

/** The error codes of the contract, as a set, for membership checks. */
export const AGENT_ERROR_CODES: ReadonlySet<string> = new Set(registry.errorMapping.map((entry) => entry.code));

/**
 * The HTTP status for an error code, and the reverse.
 *
 * The reverse map is ambiguous — several codes share 409 — so it is only used as a
 * fallback when the Host's response body carries no code of its own.
 */
export function statusForErrorCode(code: string): number | undefined {
  return AGENT_ERROR_STATUS.get(code);
}

/** The most specific code for a status, used only when the body carries no code. */
export function errorCodeForStatus(status: number): string {
  switch (status) {
    case 400: return "INVALID_REQUEST";
    case 401: return "UNAUTHORIZED";
    case 403: return "ORIGIN_REJECTED";
    case 404: return "NOT_FOUND";
    case 409: return "REVISION_CONFLICT";
    case 410: return "CURSOR_EXPIRED";
    case 413: return "PAYLOAD_TOO_LARGE";
    case 423: return "TARGET_LOCKED";
    case 428: return "IMPACT_REQUIRED";
    case 500: return "INTERNAL_ERROR";
    case 503: return "CAPABILITY_UNAVAILABLE";
    default: return "INTERNAL_ERROR";
  }
}
