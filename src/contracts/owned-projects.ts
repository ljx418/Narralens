import {owned as validateList,nativeEntry as validateEntry} from './native-workbench-validators.mjs';
export interface OwnedProjectCard {
 readonly project_id:string;readonly title:string;readonly project_revision:number|null;
 readonly snapshot_id:string|null;readonly saved_at:string|null;readonly frame_count:number|null;
 /** Durable saved facts only; not a fresh readiness/media-quality claim. */
 readonly state:'saved'|'attention';
}
export interface OwnedProjectsPage {
 readonly format:'narralens.owned-projects@1.0';readonly projects:readonly OwnedProjectCard[];
 readonly next_after:string|null;
}
export interface NativeEntryResponse {
 readonly format:'narralens.native-entry@1.0';readonly project_id:string;readonly revision:number;
 readonly snapshot_id:string;readonly native_state:'unconfirmed';readonly url:string;readonly expires_at:number;
}
export function validateOwnedProjects(value:unknown):OwnedProjectsPage {
 if(!validateList(value))throw new Error('INVALID_OWNED_PROJECTS');return value;
}
export function validateNativeEntry(value:unknown):NativeEntryResponse {
 if(!validateEntry(value))throw new Error('INVALID_NATIVE_ENTRY');
 const url=new URL(value.url),port=Number(value.url.match(/^http:\/\/127\.0\.0\.1:(\d+)\//)?.[1]);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:'||port<1||port>65535)throw new Error('INVALID_NATIVE_ENTRY');
 return value;
}
