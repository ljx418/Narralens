import Ajv2020, { type ValidateFunction, type ErrorObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '../../contracts/agent-local-assets-v1.schema.json' with { type: 'json' };
import {
  LOCAL_ASSET_CONTRACT_ID,
  LOCAL_ASSET_DEFINITIONS,
  type LocalAssetDefinition,
} from './agent-local-assets-types.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(schema);
const validators = new Map<string, ValidateFunction>();

export class LocalAssetContractError extends Error {
  readonly code = 'INVALID_REQUEST';
  constructor(readonly definition: string, readonly violations: readonly ErrorObject[]) {
    super(`Invalid ${definition}`);
  }
}

/**
 * Validate an adjunct payload before it reaches the Host and before it leaves it.
 *
 * Unknown fields are rejected rather than stripped: a payload the contract does not
 * describe must never reach the registry, and a response the contract does not describe
 * must never reach a consumer.
 */
export function validateLocalAssetDefinition<T = unknown>(
  definition: LocalAssetDefinition,
  value: unknown,
): T {
  if (!LOCAL_ASSET_DEFINITIONS.includes(definition)) throw new Error('Unknown adjunct definition');
  let validate = validators.get(definition);
  if (!validate) {
    validate = ajv.compile({ $ref: `${LOCAL_ASSET_CONTRACT_ID}#/$defs/${definition}` });
    validators.set(definition, validate);
  }
  if (!validate(value)) throw new LocalAssetContractError(definition, [...(validate.errors ?? [])]);
  return value as T;
}
