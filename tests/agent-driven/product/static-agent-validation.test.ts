import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {validateAgentDefinition as browserValidate} from '../../../src/contracts/agent-workbench-validator.js';
import {validateAgentDefinition as hostValidate} from '../../../src/contracts/agent-driven-validator.js';
const definitions=new Set(['Context','Workflow','ReviewPackage','ReviewDecision','HealthRead']);
const vectors=JSON.parse(readFileSync('docs/agent-driven-v1/cp-a0/contract-vectors.json','utf8')).vectors as Array<{id:string;schema:string;value:unknown;valid:boolean}>;
const cases=vectors.filter(v=>v.id.startsWith('definition:')&&definitions.has(v.schema));
const accepts=(validate:typeof browserValidate,definition:string,value:unknown)=>{try{validate(definition,value);return true;}catch{return false;}};
it.each(cases)('static browser validator agrees with frozen vector and Host: $id',vector=>{
 expect(accepts(browserValidate,vector.schema,vector.value)).toBe(vector.valid);
 expect(accepts(browserValidate,vector.schema,vector.value)).toBe(accepts(hostValidate,vector.schema,vector.value));
});
it('refuses unknown and inherited definition names, and generated code has no runtime compilation',()=>{
 for(const definition of ['Intake','toString','__proto__','constructor'])expect(()=>browserValidate(definition,{})).toThrow();
 const generated=readFileSync('src/contracts/native-workbench-validators.mjs','utf8');
 expect(generated).not.toMatch(/\brequire\s*\(|\bnew\s+Function\s*\(|\beval\s*\(/);
});
