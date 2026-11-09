import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateAgentDefinition, validateAgentRouteInput, agentRoutes } from '../../../src/contracts/agent-driven-validator.js';

const vectors = JSON.parse(readFileSync('docs/agent-driven-v1/cp-a0/contract-vectors.json', 'utf8')) as {
  vectors: { id: string; schema: string; valid: boolean; value: unknown }[];
};
describe('approved A runtime contracts', () => {
  it('executes every frozen positive and negative wire vector through the production validator', () => {
    expect(vectors.vectors).toHaveLength(1335);
    for (const v of vectors.vectors) {
      let valid = true;
      try { validateAgentDefinition(v.schema, v.value); } catch { valid = false; }
      expect(valid, v.id).toBe(v.valid);
    }
  });
  it('has the complete route set and rejects values for no-input routes', () => {
    expect(agentRoutes).toHaveLength(31);
    expect(validateAgentRouteInput('instance', undefined)).toBeUndefined();
    expect(() => validateAgentRouteInput('instance', {})).toThrow();
    expect(() => validateAgentDefinition('not-a-definition', {})).toThrow();
  });
  it('keeps the runtime wire schema byte-identical to the approved candidate', () => {
    expect(readFileSync('contracts/agent-driven-a.schema.json')).toEqual(readFileSync('docs/agent-driven-v1/cp-a0/contracts.schema.json'));
    expect(readFileSync('contracts/agent-driven-a.registry.json')).toEqual(readFileSync('docs/agent-driven-v1/cp-a0/registry.json'));
  });
});
