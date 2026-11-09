/**
 * Tool schemas for the MCP façade (BRIDGE / E07).
 *
 * The input schema of a tool is the *frozen contract's* schema for that route's input,
 * not a hand-written approximation of it. The contract schema uses local `$ref`s into
 * its own `$defs`, and an MCP client receives a self-contained JSON Schema, so the
 * references are inlined here.
 *
 * The definitions are a finite, acyclic graph (the contract's own generator produced
 * them that way), and the inliner refuses to recurse into a cycle rather than
 * looping forever. If the contract ever grows a cycle, the module throws instead of
 * hanging the process that imports it.
 *
 * No field is stripped, renamed or loosened. The contract rejects unknown fields, and
 * so does the schema the client is handed — a client cannot discover a hidden
 * parameter by reading the tool description.
 */

import contractSchema from "../../contracts/agent-driven-a.schema.json" with { type: "json" };
import type { AgentRouteView } from "./registry-view.js";

const DEFINITIONS = (contractSchema as unknown as { $defs: Record<string, unknown> }).$defs;

const REF_PREFIX = "#/$defs/";

/**
 * Inline every local `$ref` in a schema fragment.
 *
 * `stack` carries the definitions currently being expanded, so a cycle is detected
 * instead of recursed into.
 */
function inlineRefs(node: unknown, stack: readonly string[]): unknown {
  if (Array.isArray(node)) return node.map((entry) => inlineRefs(entry, stack));
  if (node === null || typeof node !== "object") return node;
  const ref = (node as { $ref?: unknown }).$ref;
  if (typeof ref === "string" && ref.startsWith(REF_PREFIX)) {
    const name = ref.slice(REF_PREFIX.length);
    if (stack.includes(name)) {
      throw new Error(`agent_contract_schema_cycle:${name}`);
    }
    const target = DEFINITIONS[name];
    if (target === undefined) {
      throw new Error(`agent_contract_definition_missing:${name}`);
    }
    return inlineRefs(target, [...stack, name]);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out[key] = inlineRefs(value, stack);
  }
  return out;
}

/** The self-contained JSON Schema of a contract definition. */
export function contractDefinitionSchema(definition: string): Record<string, unknown> {
  const target = DEFINITIONS[definition];
  if (target === undefined) {
    throw new Error(`agent_contract_definition_missing:${definition}`);
  }
  const inlined = inlineRefs(target, []);
  if (inlined === null || typeof inlined !== "object" || Array.isArray(inlined)) {
    throw new Error(`agent_contract_definition_not_object:${definition}`);
  }
  return inlined as Record<string, unknown>;
}

/** The schema of a route that takes no input: an object with no properties. */
export const NO_INPUT_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false,
});

/**
 * The input schema of a tool.
 *
 * Routes without input get an empty, closed object. An MCP client that sends
 * arguments to such a tool gets them rejected, which is the same answer the Host
 * gives for a no-input route.
 */
export function toolInputSchema(route: AgentRouteView): Record<string, unknown> {
  if (route.input === null) return { ...NO_INPUT_SCHEMA };
  const schema = contractDefinitionSchema(route.input);
  if (schema["type"] !== "object") {
    throw new Error(`agent_contract_input_not_object:${route.id}`);
  }
  return schema;
}

/**
 * A stable description for a tool.
 *
 * It names the contract definition the output follows, the route it maps to and the
 * gate policy that applies. The gate policy is in the description on purpose: it is
 * the difference between "this call prepares something" and "this call is a
 * confirmed human decision", and a client that cannot see it will guess wrong.
 */
export function toolDescription(route: AgentRouteView): string {
  const parts = [
    `${route.id} — returns the ${route.output} contract definition.`,
    `Maps to ${route.method} ${route.path}.`,
    `Scope: ${route.scope}.`,
    `Business producer: ${route.owner}.`,
    `Authentication channel: ${route.authChannel}.`,
    `Gate policy: ${route.gatePolicy}.`,
  ];
  if (route.input === null) {
    parts.push("This route takes no input.");
  } else {
    parts.push(`Input follows the ${route.input} contract definition; unknown fields are rejected.`);
  }
  return parts.join(" ");
}
