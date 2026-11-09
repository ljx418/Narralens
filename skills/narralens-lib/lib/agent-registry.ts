/**
 * The registry view, for skill scripts.
 *
 * This is a re-export of the production registry view (`src/mcp/registry-view.ts`)
 * rather than a second copy of it. A copy would be able to describe a tool list the
 * façade does not expose, which is exactly the kind of drift an agent would then
 * act on.
 *
 * The re-export is what makes the skill library usable from a script that runs with
 * `tsx`; a plain Markdown reader does not need it.
 */

import {
  AGENT_ROUTES,
  exposedToolRoutes,
  routeByToolName,
} from "../../../src/mcp/registry-view.js";

export {
  AGENT_ERROR_CODES,
  AGENT_ERROR_STATUS,
  AGENT_RESOURCES,
  AGENT_ROUTE_COUNT,
  AGENT_ROUTE_IDS,
  AGENT_ROUTES,
  errorCodeForStatus,
  exposedToolNames,
  exposedToolRoutes,
  isResourceTemplate,
  matchResourceUri,
  routeById,
  routeByToolName,
  statusForErrorCode,
  type AgentResourceView,
  type AgentRouteId,
  type AgentRouteView,
} from "../../../src/mcp/registry-view.js";

/**
 * A one-line description of a tool, for a script that has to explain what it is
 * about to call.
 */
export function describeTool(name: string): string {
  const route = routeByToolName(name);
  if (route === null) return `${name}: not an exposed tool.`;
  return `${name} → ${route.id} → ${route.method} ${route.path} → ${route.output} (scope ${route.scope}, gate ${route.gatePolicy}).`;
}

/**
 * The routes that have no MCP tool, and why.
 *
 * These are the trusted-UI and native-bridge routes. A script that wants to act on
 * one of them has to ask a human in the workbench, not call a tool.
 */
export function unexposedRoutes(): { id: string; scope: string; reason: string }[] {
  return AGENT_ROUTES.filter((route) => route.tool === null).map((route) => ({
    id: route.id,
    scope: route.scope,
    reason: route.scope === "trusted_ui"
      ? "requires a trusted human confirmation channel"
      : route.scope === "native_bridge"
        ? "requires the native editor bridge session"
        : "not exposed as an MCP tool",
  }));
}

/** The tools a script may call, with their route metadata. */
export function callableTools(): { name: string; route: string; output: string; scope: string }[] {
  return exposedToolRoutes().map((route) => ({
    name: route.tool as string,
    route: route.id,
    output: route.output,
    scope: route.scope,
  }));
}
