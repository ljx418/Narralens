/**
 * Public surface of the MCP façade (BRIDGE / E07).
 *
 * MAIN imports from here to register the façade and to compose it with the Host's
 * application ports.
 *
 * **Policy injection.** Three values in this façade are policies rather than
 * mechanics, and MAIN supplies them:
 *
 * - the Host's address and credentials (`NARRALENS_HOST_URL`, `NARRALENS_HOST_TOKEN`,
 *   or `createHostApplicationPorts`'s options),
 * - the filter digest the events-snapshot resource uses
 *   (`NARRALENS_FILTER_DIGEST`, or `McpFacadeOptions.filterDigest`),
 * - the handshake, when MAIN has already verified the instance
 *   (`McpFacadeOptions.handshake`).
 *
 * None of them has a default invented here.
 */

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
  pathPlaceholders,
  ROUTE_PATH_BINDINGS,
  routeById,
  routeByToolName,
  statusForErrorCode,
  type AgentResourceView,
  type AgentRouteId,
  type AgentRouteView,
} from "./registry-view.js";
export {
  contractDefinitionSchema,
  NO_INPUT_SCHEMA,
  toolDescription,
  toolInputSchema,
} from "./tool-schemas.js";
export {
  buildAgentError,
  errorFromConfiguration,
  errorFromHostResponse,
  errorFromInvalidRequest,
  errorFromTransportFailure,
  errorFromUnknownOutcome,
  sanitizeMessage,
} from "./host-error-mapping.js";
export {
  assertEndpointPolicy,
  buildRequest,
  createHostApplicationPorts,
  HostCallError,
  HostEndpointPolicyError,
  HostResponseTooLargeError,
  readBoundedBody,
  type HostAddressResolver,
  type HostClientOptions,
} from "./host-application-ports.js";
export {
  buildToolDefinitions,
  createMcpServer,
  FacadeConfigurationError,
  FACADE_API_VERSION,
  FACADE_CONTRACT_VERSION,
  HandshakeMismatchError,
  isAgentErrorEnvelope,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  projectResourcePayload,
  type McpFacadeOptions,
} from "./mcp-server.js";
