import {created as validate,legacy as validateLegacy} from './native-workbench-validators.mjs';
import type {WorkbenchProjectionV1} from './wave3-types.js';
/** Independent UI read contract, not a new CP-A0 tool or a second timeline. */
export interface CreatedWorkbenchProjection extends Omit<WorkbenchProjectionV1,'format'|'migration_id'|'source_project_id'|'history'|'preview'> {
 readonly format:'narralens.created-workbench@1.0';
 readonly origin:'created';
 readonly migration_id:null;
 readonly source_project_id:null;
 readonly preview:null;
 /** No actual loaded-document observation producer is registered yet. */
 readonly native_sync:'unknown';
 readonly history:readonly {revision:number;snapshot_id:string;kind:'edit'|'asset_import'|'lock'|'history'|'snapshot_publish';transaction_id:string}[];
}
export function validateCreatedWorkbench(value:unknown):CreatedWorkbenchProjection {
 if(!validate(value))throw new Error('INVALID_CREATED_WORKBENCH_PROJECTION');
 return value;
}

export type NativeWorkbenchProjection=WorkbenchProjectionV1|CreatedWorkbenchProjection;
export function validateNativeWorkbench(value:unknown):NativeWorkbenchProjection {
 if(value&&typeof value==='object'&&'format' in value&&value.format==='narralens.created-workbench@1.0')return validateCreatedWorkbench(value);
 if(!validateLegacy(value))throw new Error('INVALID_NATIVE_WORKBENCH_PROJECTION');
 return value;
}
