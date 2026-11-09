import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '../../contracts/created-workbench.schema.json' with {type:'json'};
import publicLock from '../../contracts/public-lock.schema.json' with {type:'json'};
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
const ajv=new Ajv2020({strict:true,allErrors:true});addFormats(ajv);ajv.addSchema(publicLock);
const validate=ajv.compile<CreatedWorkbenchProjection>(schema);
export function validateCreatedWorkbench(value:unknown):CreatedWorkbenchProjection {
 if(!validate(value))throw new Error('INVALID_CREATED_WORKBENCH_PROJECTION');
 return value;
}
