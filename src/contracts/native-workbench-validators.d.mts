import type {OwnedProjectsPage,NativeEntryResponse} from './owned-projects.js';
import type {CreatedWorkbenchProjection} from './created-workbench.js';
import type {WorkbenchProjectionV1} from './wave3-types.js';
export function created(value:unknown):value is CreatedWorkbenchProjection;
export function legacy(value:unknown):value is WorkbenchProjectionV1;

export function owned(value:unknown):value is OwnedProjectsPage;
export function nativeEntry(value:unknown):value is NativeEntryResponse;

import type {Context,Workflow,ReviewPackage,ReviewDecision,HealthRead} from './agent-driven-types.js';
export function agentContext(value:unknown):value is Context;
export function agentWorkflow(value:unknown):value is Workflow;
export function agentReviewPackage(value:unknown):value is ReviewPackage;
export function agentReviewDecision(value:unknown):value is ReviewDecision;
export function agentHealthRead(value:unknown):value is HealthRead;
