import type {ProductTransaction,RunRecord,ExecutionGrantRecord,TrustedConfirmationRecord} from './product-repository.js';
/** One provenance/time rule for observers and the actual side-effect facts reader.
 * Expired records remain readable; future or mismatched confirmations are never usable.
 */
export function trustedGrantConfirmation(tx:ProductTransaction,run:RunRecord,grant:ExecutionGrantRecord,now:number):TrustedConfirmationRecord|null {
 const confirmation=tx.get('trusted_confirmation',{project_id:run.project_id,run_id:run.run_id,confirmation_id:grant.confirmation_id});
 if(!confirmation||confirmation.purpose!=='run.authorize'||confirmation.channel!=='trusted_ui'||
  confirmation.authenticated_actor!==grant.principal_id||confirmation.action_digest!==run.run_scope_digest||
  confirmation.input_digest!==run.scope_json.input_digest||confirmation.expires_at!==grant.expires_at||
  !Number.isSafeInteger(confirmation.issued_at)||!Number.isSafeInteger(confirmation.expires_at)||!Number.isSafeInteger(now)||
  confirmation.issued_at>now||confirmation.issued_at>=confirmation.expires_at||grant.run_scope_digest!==run.run_scope_digest)return null;
 return confirmation;
}
