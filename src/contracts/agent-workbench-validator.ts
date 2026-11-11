import {agentContext,agentWorkflow,agentReviewPackage,agentReviewDecision,agentHealthRead} from './native-workbench-validators.mjs';

// Build-time Ajv output from the unchanged frozen contract. Browser pages never
// import the dynamic compiler or require unsafe-eval for contract validation.
const validators:Readonly<Record<string,(value:unknown)=>boolean>>=Object.freeze({
 Context:agentContext,Workflow:agentWorkflow,ReviewPackage:agentReviewPackage,
 ReviewDecision:agentReviewDecision,HealthRead:agentHealthRead,
});
export function validateAgentDefinition<T=unknown>(definition:string,value:unknown):T {
 if(!Object.hasOwn(validators,definition))throw new Error('Unknown workbench contract definition');
 if(!validators[definition]!(value))throw new Error('Invalid '+definition);
 return value as T;
}
