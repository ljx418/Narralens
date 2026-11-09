import type {OwnedProjectsPage,NativeEntryResponse} from './owned-projects.js';
import type {CreatedWorkbenchProjection} from './created-workbench.js';
import type {WorkbenchProjectionV1} from './wave3-types.js';
export function created(value:unknown):value is CreatedWorkbenchProjection;
export function legacy(value:unknown):value is WorkbenchProjectionV1;

export function owned(value:unknown):value is OwnedProjectsPage;
export function nativeEntry(value:unknown):value is NativeEntryResponse;
