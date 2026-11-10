# MAIN integration ports — required, no fallback

The candidate is NOT registered in any production router, app, worker or MCP tool. Only returned task.accepted is a public JobReceipt; task.stage_token/request/principal are private store facts. Never serialize the full internal reservation as a route response. No public absolute path or URL field exists.

## Explicit job policy

reserve requires {job_kind: existing JobKind,max_attempts: positive safe integer}. Main chooses mapping from assemble_draft/render_snapshot to existing CHECK kinds and controls all budgets/retries. Candidate deliberately does not choose this mapping. Same-key replay returns original accepted and preserves original kind/budget, even if current server policy has changed. No state/job kind/schema extension is introduced.

## Same-connection row hooks

TaskTransactionDb is a revoked-after-return positional prepare/get/all/run capability over the same RevisionStore.compose DatabaseSync. This is not raw DatabaseSync identity, a second DB, a ProductTransaction or async API. Main must supply literal synchronous SELECT/INSERT/UPDATE/DELETE SQL and not nested transactions/schema operations. Every SQL failure poisons the hook even if swallowed; thenables roll back and later use of retained methods is rejected. Source tests cover those storage mechanics, not actual Run authorization.

assertAllowed phases are access (before command lookup, mandatory owner/tenant/caller boundary), new_reserve (after a ledger miss, before any new job, full new execution validation), replay (original job_id known, after exact digest/receipt validation), final_reserve (new job_id bound, final fresh-time scope check after all writes). job_id is null for access/new_reserve and real for replay/final_reserve. This prevents treating a previously bound original attempt as an unbound new attempt merely to replay its original receipt. MAIN decides exact replay policy; no authorization is skipped by the store. Main must check actual created owner/commit/base/source/input refs/render spec, original run/plan/scope/grant/step/input digest, and producer eligibility/cost/trusted facts appropriate to each phase. Fields from caller body are references to validate, not proof.

bindStep receives immutable full task/execution, job_id, token and now. It must synchronously bind/update the existing cp_a0_step_attempt plus original Run/checkpoint and correct event mirror within this very transaction. Existing FixedWorkflowService.recordStepAttempt and ProductRepository.transaction are async/nested and cannot be called. Candidate cannot guess their semantic guard; MAIN must factor/provide the existing synchronous implementation. Neither this store nor its new namespace holds a step/job state machine.

assertPrepared is called before and after insertion, with a fresh final lease check after each call. It must idempotently validate (not destructively spend on first call) an opaque MAIN-owned verifier proof, real current stage/token/files/roots/source/plan/rights and authorized immutable input. The fact JSON alone is not proof. Any async FS validation must happen beforehand via MAIN's retained-FD/WeakMap proof producer and be rechecked synchronously at the transaction boundary. Store retains no absolute path; resolve token only beneath MAIN's owned stage domain and preserve input after crash/lease loss as existing policy requires.

## Existing lifecycle / publication

Worker takes/renews/cancels/reaps using existing PersistentJobStore; readPrepared remains only a prepared historical fact. Successful recordPrepared never changes job.state, cp step.state, active_commit or snapshots. Main explicitly calls existing recordCallback with current lease after its producer path, and Coordinator alone publishes project commits. JobRead/Context must compose current existing job state with immutable execution binding, not return original queued accepted forever. Outbox topics created.task.accepted/prepared are private integration topics; MAIN must register intended producer/event projection and avoid claiming them as already wired CP events. Live SSE notifications remain existing composition responsibility.

Candidate errors use code values; MAIN must map them with its approved Agent error alias without leaking private roots/facts. Recovery retains immutable source/input facts, original request and opaque stage token; no filesystem delete/compensation is performed here. No output is committed/adopted by this module.
