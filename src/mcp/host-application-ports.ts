/**
 * The typed local Host HTTP client (BRIDGE / E07).
 *
 * This is the only way the MCP façade reaches the Host. It implements the frozen
 * `ApplicationPorts` interface — the same interface MAIN's production composition
 * implements in-process — so the façade's behaviour does not change whether it is
 * talking to an in-process Host or to one over HTTP.
 *
 * The client is deliberately thin. It does not know any business rule: it validates
 * the input, routes it to the route's path, sends it, and validates what comes back
 * against the route's output definition. Everything it *does* decide is transport
 * shaped, and every one of those decisions is a refusal:
 *
 * - **The input is validated before anything is sent.** A payload the contract does
 *   not describe never reaches the network, so it can never have an effect.
 * - **The base URL must be a local Host.** It has to be an `http` loopback literal
 *   (`127.0.0.1` or `[::1]`); a name such as `localhost` is only allowed when the
 *   caller injects a resolution policy that resolves it to a loopback literal. No
 *   userinfo, no query, no fragment, no base path, no other origin.
 * - **Redirects are refused, not followed.** The credentials this client holds are
 *   for one Host; following a redirect would hand them to whoever the redirect
 *   names.
 * - **The response body is bounded.** A Host that answers with an unbounded body
 *   cannot exhaust this process.
 * - **A write whose outcome is unknown is not a failure and not a success.** A
 *   timeout, an unreadable body or an off-contract answer to a write may or may not
 *   have been applied, and the client says so instead of guessing. It is not
 *   retryable, and it never proposes a new idempotency key.
 */

import { randomUUID } from "node:crypto";
import type { ApplicationPorts, Error as AgentError } from "../contracts/agent-driven-types.js";
import { validateAgentRouteInput, validateAgentRouteOutput } from "../contracts/agent-driven-validator.js";
import {
  AGENT_ROUTES,
  ROUTE_PATH_BINDINGS,
  type AgentRouteView,
} from "./registry-view.js";
import {
  errorFromHostResponse,
  errorFromInvalidRequest,
  errorFromTransportFailure,
  errorFromUnknownOutcome,
} from "./host-error-mapping.js";

/**
 * A failed Host call, carrying the contract error envelope.
 *
 * The façade turns this into the tool result. The envelope is the contract's
 * `Error`; nothing else about the failure crosses the boundary.
 */
export class HostCallError extends Error {
  constructor(readonly envelope: AgentError) {
    super(envelope.message);
    this.name = "HostCallError";
  }
}

/**
 * The base URL violates the endpoint policy.
 *
 * This is a configuration fault and it is raised when the client is built, not on
 * the first request: a client that is pointed at the wrong place must not be able to
 * make a single request before anybody notices.
 */
export class HostEndpointPolicyError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = "HostEndpointPolicyError";
  }
}

/** A client option is outside the bounds the client can honour. */
export class HostConfigurationError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = "HostConfigurationError";
  }
}

/** The response body was larger than the client is willing to read. */
export class HostResponseTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`The host response exceeded ${limitBytes} bytes.`);
    this.name = "HostResponseTooLargeError";
  }
}

export interface HostClientOptions {
  /** The Host's base URL, e.g. `http://127.0.0.1:4173`. */
  readonly baseUrl: string;
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Request timeout in milliseconds. */
  readonly timeoutMs?: number;
  /**
   * Injected credentials and headers.
   *
   * MAIN owns authentication. This is a provider so the token can be refreshed
   * without rebuilding the client, and so the client itself never holds a secret.
   */
  readonly headers?: () => Record<string, string>;
  /** Injected correlation id provider. */
  readonly correlationId?: () => string;
  /** The largest response body the client will read. */
  readonly maxResponseBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** The only hosts this client will talk to. */
const LOOPBACK_LITERALS: ReadonlySet<string> = new Set(["127.0.0.1", "::1"]);
/** Connection failures that prove the request never reached a server. */
const NEVER_DELIVERED_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a field from the input.
 *
 * A binding may name a nested field (`ack.project_id`) when the route's identifier
 * lives inside the payload rather than beside it.
 */
function readField(fields: Record<string, unknown>, path: string): unknown {
  if (!path.includes(".")) return fields[path];
  let current: unknown = fields;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/** The root field a (possibly nested) binding consumes. */
function rootField(path: string): string {
  const separator = path.indexOf(".");
  return separator === -1 ? path : path.slice(0, separator);
}

/**
 * The host of a URL, without the brackets an IPv6 literal carries.
 *
 * `new URL("http://[::1]:4173").hostname` is `"[::1]"`, brackets included, so the
 * literal has to be unwrapped before it can be compared with an address.
 */
export function normalizeHost(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/**
 * Check the base URL against the endpoint policy and return its normalised form.
 *
 * The policy is deliberately narrow. This client holds credentials for one local
 * Host, and the address that is checked has to be the address that is fetched:
 *
 * - the scheme is `http`,
 * - the host is an **address literal** — `127.0.0.1` or `[::1]`. A *name* is
 *   refused outright: a name is resolved again on every connection, so a name that
 *   was checked once can point somewhere else by the time the request is made.
 *   There is no resolver hook that could close that window, because the fetch would
 *   still use the name,
 * - no userinfo, no query, no fragment, no path prefix.
 */
export function assertEndpointPolicy(options: HostClientOptions): string {
  let url: URL;
  try {
    url = new URL(options.baseUrl);
  } catch {
    throw new HostEndpointPolicyError("base_url_unparsable", "The host base URL could not be parsed.");
  }
  if (url.protocol !== "http:") {
    throw new HostEndpointPolicyError("base_url_scheme_refused", "The host base URL must use the http scheme.");
  }
  if (url.username !== "" || url.password !== "") {
    throw new HostEndpointPolicyError("base_url_userinfo_refused", "The host base URL must not carry credentials.");
  }
  if (url.search !== "") {
    throw new HostEndpointPolicyError("base_url_query_refused", "The host base URL must not carry a query.");
  }
  if (url.hash !== "") {
    throw new HostEndpointPolicyError("base_url_fragment_refused", "The host base URL must not carry a fragment.");
  }
  if (url.pathname !== "" && url.pathname !== "/") {
    throw new HostEndpointPolicyError("base_url_path_refused", "The host base URL must not carry a path prefix.");
  }
  if (!LOOPBACK_LITERALS.has(normalizeHost(url.hostname))) {
    throw new HostEndpointPolicyError(
      "base_url_not_loopback",
      "The host base URL must address a loopback address literal; a host name is refused.",
    );
  }
  const base = options.baseUrl.endsWith("/") ? options.baseUrl.slice(0, -1) : options.baseUrl;
  return base;
}

/** Check that a duration or size the client honours is a positive, finite bound. */
export function assertBoundedOption(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new HostConfigurationError(
      `invalid_${label}`,
      `The ${label} must be a positive, finite number.`,
    );
  }
}

interface BuiltRequest {
  readonly url: string;
  readonly body: string | undefined;
}

/**
 * Fill the path placeholders and decide what is left over.
 *
 * A placeholder whose field is missing or null is a client error: the route cannot
 * be addressed. The façade never guesses a default for an identifier.
 */
export function buildRequest(
  route: AgentRouteView,
  input: unknown,
  baseUrl: string,
): BuiltRequest {
  const bindings = ROUTE_PATH_BINDINGS[route.id] ?? {};
  const fields = isRecord(input) ? input : {};
  let path = route.path;
  const consumed = new Set<string>();
  for (const [placeholder, field] of Object.entries(bindings)) {
    const value = readField(fields, field);
    if (typeof value !== "string" || value.length === 0) {
      throw new HostCallError({
        schema_version: "agent.v1",
        correlation_id: "unknown",
        code: "INVALID_REQUEST",
        http_status: 400,
        message: `The route ${route.id} requires ${field}.`,
        retryable: false,
        next_actions: ["fix_request_payload"],
      });
    }
    consumed.add(rootField(field));
    path = path.replace(`:${placeholder}`, encodeURIComponent(value));
  }
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  if (route.method === "GET") {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) {
      if (consumed.has(key)) continue;
      if (value === null || value === undefined) continue;
      query.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    const suffix = query.toString();
    return { url: `${base}${path}${suffix.length > 0 ? `?${suffix}` : ""}`, body: undefined };
  }
  return { url: `${base}${path}`, body: JSON.stringify(input ?? {}) };
}

/**
 * True when the request provably never reached a server.
 *
 * Only these failures are certain: the connection was refused, the name did not
 * resolve, or the network was unreachable. Anything else — a timeout, a reset after
 * the request was written — may have been delivered, and a write in that state has
 * an unknown outcome.
 */
function isNeverDelivered(error: unknown): boolean {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  const code = typeof cause?.code === "string" ? cause.code : undefined;
  if (code === undefined) return false;
  return NEVER_DELIVERED_CODES.has(code);
}

/**
 * Read the response body, refusing to buffer more than the limit.
 *
 * A Host that answers with an endless body must not be able to exhaust this
 * process, so the read is bounded and the stream is cancelled as soon as the limit
 * is passed.
 */
export async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (body === null) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value = chunk.value;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new HostResponseTooLargeError(maxBytes);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return text;
}

/**
 * Build a client for the Host.
 *
 * The returned object has exactly the frozen `ApplicationPorts` surface: one method
 * per registry route, no more and no less. A route that is added to the contract
 * without an implementation here fails the route-count check in `registry-view.ts`
 * rather than being silently absent at runtime.
 */
export function createHostApplicationPorts(options: HostClientOptions): ApplicationPorts {
  const baseUrl = assertEndpointPolicy(options);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  assertBoundedOption(timeoutMs, "timeout");
  assertBoundedOption(maxResponseBytes, "maximum response size");
  const correlationId = options.correlationId ?? (() => randomUUID());

  async function callRoute(route: AgentRouteView, input: unknown): Promise<unknown> {
    const id = correlationId();
    const isWrite = route.method === "POST";

    // The input is validated before anything is sent: a payload the contract does
    // not describe must never reach the Host.
    try {
      validateAgentRouteInput(route.id, input);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "the payload was rejected";
      throw new HostCallError(errorFromInvalidRequest(
        `The input for ${route.id} does not match the contract (${detail}).`,
        id,
      ));
    }

    let request: BuiltRequest;
    try {
      request = buildRequest(route, input, baseUrl);
    } catch (error) {
      if (error instanceof HostCallError) {
        throw new HostCallError({ ...error.envelope, correlation_id: id });
      }
      throw error;
    }

    const headers: Record<string, string> = {
      accept: "application/json",
      "x-correlation-id": id,
      ...(options.headers?.() ?? {}),
    };
    // Node's fetch does not add Origin. Bind it to the already validated loopback
    // endpoint, including when injected headers use a differently cased key. Origin
    // is a transport boundary, never a substitute for the scoped bearer credential.
    for (const key of Object.keys(headers)) if (key.toLowerCase() === "origin") delete headers[key];
    headers.origin = new URL(baseUrl).origin;
    if (request.body !== undefined) headers["content-type"] = "application/json";

    let response: Response;
    try {
      response = await fetchImpl(request.url, {
        method: route.method,
        headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: AbortSignal.timeout(timeoutMs),
        // The redirect is refused rather than followed: the credentials in `headers`
        // are for this Host, and a redirect would hand them to somebody else.
        redirect: "manual",
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      const reason = timedOut
        ? "The host did not answer within the request timeout."
        : "The host could not be reached.";
      if (isWrite && !isNeverDelivered(error)) {
        // The request may have reached the Host. Nothing here can tell, so the
        // outcome is unknown — and an unknown outcome is not retryable.
        throw new HostCallError(errorFromUnknownOutcome(
          "The write was sent but no answer arrived, so its outcome is unknown.",
          id,
        ));
      }
      throw new HostCallError(errorFromTransportFailure(reason, id));
    }

    if (response.status >= 300 && response.status < 400) {
      // Not followed, and the credentials are not forwarded.
      throw new HostCallError(isWrite
        ? errorFromUnknownOutcome(
          "The host answered with a redirect after the write was sent, so its outcome is unknown.",
          id,
        )
        : {
          schema_version: "agent.v1",
          correlation_id: id,
          code: "INTERNAL_ERROR",
          http_status: 500,
          message: "The host answered with a redirect; the request was not followed.",
          retryable: false,
          next_actions: ["check_facade_configuration"],
        });
    }

    let text: string;
    try {
      text = await readBoundedBody(response, maxResponseBytes);
    } catch (error) {
      const tooLarge = error instanceof HostResponseTooLargeError;
      const reason = tooLarge
        ? "The host response was too large to read."
        : "The host response could not be read.";
      throw new HostCallError(isWrite
        ? errorFromUnknownOutcome(
          "The write was sent but its response could not be read, so its outcome is unknown.",
          id,
        )
        : errorFromTransportFailure(reason, id));
    }

    let payload: unknown = null;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      // The Host answered: this is a known outcome and its envelope is kept as it is.
      throw new HostCallError(errorFromHostResponse(response.status, payload, id));
    }

    try {
      return validateAgentRouteOutput(route.id, payload);
    } catch {
      // The Host answered with something that is not the contract's output for this
      // route. For a write, the request may still have been applied, so the outcome
      // is unknown rather than failed.
      throw new HostCallError(isWrite
        ? errorFromUnknownOutcome(
          `The host answered ${route.id} with something that is not the ${route.output} contract, so the write's outcome is unknown.`,
          id,
        )
        : {
          schema_version: "agent.v1",
          correlation_id: id,
          code: "INTERNAL_ERROR",
          http_status: 500,
          message: `The host response for ${route.id} did not match the ${route.output} contract.`,
          retryable: false,
          next_actions: ["check_host_logs"],
        });
    }
  }

  const ports: Record<string, unknown> = {};
  for (const route of AGENT_ROUTES) {
    ports[route.id] = (input: unknown) => callRoute(route, input);
  }
  return ports as unknown as ApplicationPorts;
}
