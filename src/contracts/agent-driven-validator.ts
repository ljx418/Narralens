import Ajv2020, { type ValidateFunction, type ErrorObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '../../contracts/agent-driven-a.schema.json' with { type: 'json' };
import registry from '../../contracts/agent-driven-a.registry.json' with { type: 'json' };
import type { ApplicationPorts } from './agent-driven-types.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(schema);
const validators = new Map<string, ValidateFunction>();
export const agentContractVersion = 'cp-a0-r4' as const;
export const agentRoutes = registry.routes;
export type AgentRouteId = keyof ApplicationPorts;
export class AgentContractError extends Error {
  readonly code = 'INVALID_REQUEST';
  constructor(readonly definition: string, readonly violations: readonly ErrorObject[]) {
    super(`Invalid ${definition}`);
  }
}
/** Validate before dispatch and before exposing responses. Never strip unknown fields. */
export function validateAgentDefinition<T = unknown>(definition: string, value: unknown): T {
  let validate = validators.get(definition);
  if (!validate) {
    if (!Object.hasOwn(schema.$defs, definition)) throw new Error('Unknown contract definition');
    validate = ajv.compile({ $ref: `${schema.$id}#/$defs/${definition}` });
    validators.set(definition, validate);
  }
  if (!validate(value)) throw new AgentContractError(definition, [...(validate.errors ?? [])]);
  return value as T;
}
export function validateAgentRouteInput<K extends AgentRouteId>(id: K, value: unknown): Parameters<ApplicationPorts[K]>[0] {
  const route = agentRoutes.find(r => r.id === id);
  if (!route) throw new Error('Unknown Agent route');
  if (route.input === null) {
    if (value !== undefined) throw new AgentContractError('no-input', []);
    return undefined as Parameters<ApplicationPorts[K]>[0];
  }
  return validateAgentDefinition<Parameters<ApplicationPorts[K]>[0]>(route.input, value);
}
export function validateAgentRouteOutput<K extends AgentRouteId>(id: K, value: unknown): Awaited<ReturnType<ApplicationPorts[K]>> {
  const route = agentRoutes.find(r => r.id === id);
  if (!route) throw new Error('Unknown Agent route');
  return validateAgentDefinition<Awaited<ReturnType<ApplicationPorts[K]>>>(route.output, value);
}
