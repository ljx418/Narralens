import type {Error as WireError} from '../../contracts/agent-driven-types.js';
import registry from '../../../contracts/agent-driven-a.registry.json' with {type:'json'};
import {asHostResourceError} from '../api-error.js';
const publicCodes=new Set(registry.errorMapping.map(row=>row.code));
/** Closed semantic bridge from preserved Host engines to the frozen agent.v1 error set. */
const legacy:Readonly<Record<string,WireError['code']>>=Object.freeze({
 SOURCE_CHANGED:'REVISION_CONFLICT',MANIFEST_CHANGED:'REVISION_CONFLICT',
 ENGINE_UNAVAILABLE:'CAPABILITY_UNAVAILABLE',HYPIT_UNAVAILABLE:'CAPABILITY_UNAVAILABLE',
 CAPABILITY_NOT_ENABLED:'CAPABILITY_UNAVAILABLE',MEDIA_TOOL_UNAVAILABLE:'CAPABILITY_UNAVAILABLE',
 // Attention cannot honestly be labelled an active user lock. This read capability is unavailable.
 PROJECT_ATTENTION_REQUIRED:'CAPABILITY_UNAVAILABLE',
});
export function agentErrorCode(error:unknown):WireError['code'] {
 if(asHostResourceError(error))return 'HOST_RESOURCE_EXHAUSTED';
 const details=error&&typeof error==='object'&&'details' in error?error.details:undefined;
 if(details&&typeof details==='object'&&'source_error' in details&&['SOURCE_PATH_ESCAPE','SOURCE_REFERENCE_UNRESOLVED','SOURCE_REFERENCE_UNSUPPORTED','SOURCE_FILE_ROLE_UNKNOWN'].includes(String(details.source_error)))return 'CAPABILITY_UNAVAILABLE';
 const code=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'?error.code:'INTERNAL_ERROR';
 if(publicCodes.has(code))return code as WireError['code'];
 return Object.hasOwn(legacy,code)?legacy[code]!:'INTERNAL_ERROR';
}
