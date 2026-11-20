import type { ApplicationPorts } from '../../contracts/agent-driven-types.js';
import type { AgentRouteId } from '../../contracts/agent-driven-validator.js';
import type { CreativeService } from '../creative/creative-service.js';
import type { FixedWorkflowService } from '../creative/fixed-workflow-service.js';
import { createTrustedCallerContext } from '../creative/trusted-context.js';
import type { AgentPrincipal } from './scoped-auth.js';
import { AgentRouteError,type AgentDispatcher } from './agent-http-router.js';

export type AgentHandlers = {
 [K in AgentRouteId]?: (input:Parameters<ApplicationPorts[K]>[0],principal:AgentPrincipal)=>Promise<Awaited<ReturnType<ApplicationPorts[K]>>>;
};
/** Explicitly supplied handlers only. Missing producer is unavailable, never a fake success. */
export class ApplicationDispatcher implements AgentDispatcher {
 constructor(private readonly handlers:AgentHandlers){}
 async invoke<K extends AgentRouteId>(id:K,input:Parameters<ApplicationPorts[K]>[0],principal:AgentPrincipal):Promise<Awaited<ReturnType<ApplicationPorts[K]>>> {
  const handler=this.handlers[id];
  if(!handler)throw new AgentRouteError('CAPABILITY_UNAVAILABLE');
  return handler(input,principal);
 }
}
function caller(principal:AgentPrincipal){
 if(principal.channel==='native_bridge')throw new AgentRouteError('ORIGIN_REJECTED');
 return createTrustedCallerContext({principal_id:principal.principal_id,channel:principal.channel,source:principal.channel==='trusted_ui'?'trusted_ui':'driver_relay',session_ref:principal.session_ref});
}
/** Domain helpers consume server-authenticated identities; no actor/channel fields are read from DTOs. */
export function creativeHandlers(service:CreativeService):AgentHandlers {
 return {
  'intake.put':(v,p)=>service.putIntake(v,caller(p)),
  'intake.read':(v,p)=>service.readIntake(v,caller(p)),
  'intake.confirm':(v,p)=>service.confirmIntake(v,caller(p)),
  'question.put':(v,p)=>service.putQuestion(v,caller(p)),
  'question.answer':(v,p)=>service.answerQuestion(v,caller(p)),
  'question.answer.ui':(v,p)=>service.answerQuestionFromUi(v,caller(p)),
  'content.relay':(v,p)=>service.relayContentDecision(v,caller(p)),
  'artifact.put':(v,p)=>service.putArtifact(v,caller(p)),
 };
}
/** MAIN still owns route registration, trusted authority injection and all actual side-effect dispatch. */
export function workflowHandlers(service:FixedWorkflowService):AgentHandlers {
 return {
  'workflow.run.prepare':(v,p)=>service.prepareRun(v,caller(p)),
  'workflow.run.authorize':(v,p)=>service.authorizeRun(v,caller(p)),
  'workflow.run.read':(v,p)=>service.readRun(v,caller(p)),
  'workflow.run.start':(v,p)=>service.startRun(v,caller(p)),
  'workflow.run.pause':(v,p)=>service.pauseRun(v,caller(p)),
  'workflow.run.resume':(v,p)=>service.resumeRun(v,caller(p)),
  'workflow.run.cancel':(v,p)=>service.cancelRun(v,caller(p)),
  'workflow.read':(v,p)=>service.readWorkflow(v.project_id,caller(p)),
  'review.read':(v,p)=>service.readReview(v,caller(p)),
  'review.decide':(v,p)=>service.decideReview(v,caller(p)),
 };
}
