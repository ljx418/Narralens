import type {CreatedWorkbenchProjection} from './created-workbench.js';
import type {WorkbenchProjectionV1} from './wave3-types.js';
export function created(value:unknown):value is CreatedWorkbenchProjection;
export function legacy(value:unknown):value is WorkbenchProjectionV1;
