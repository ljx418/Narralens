---
name: narralens
description: Drive the local Narralens Host through its MCP server — read project context, workflow, jobs, health and delivery facts, and run the fixed short-film workflow. Use when a task involves a Narralens project, a film run, a job, a review package or a delivery, and whenever a narralens_* tool is available.
---

# Narralens

Narralens is a local film-production Host. This skill is the **only** sanctioned way
for an agent to reach it. The Host is reached over a stdio MCP server that speaks the
frozen `agent.v1` contract; there is no direct database, no arbitrary path and no
shell access.

## Starting the server

The MCP client spawns the façade itself. Point it at:

```
command: node
args:    ["--import", "tsx/esm", "src/mcp/stdio-main.ts"]
cwd:     <repository root>
env:     NARRALENS_HOST_URL=http://127.0.0.1:4173
         NARRALENS_HOST_TOKEN=<token, if the Host requires one>
         NARRALENS_FILTER_DIGEST=<digest, if the snapshot resource is used>
```

`skills/narralens/bin/narralens-mcp.mjs` is a wrapper that does the same thing and
resolves the repository root for you.

`NARRALENS_HOST_URL` must be a loopback address; the façade refuses to talk to
anything else. `NARRALENS_FILTER_DIGEST` is the filter the snapshot resource reads
under; without it that one resource answers with a configuration failure, and every
other tool keeps working.

**stdout is the protocol channel.** Never print to stdout in anything that runs inside
the server process.

## What you can call

The tool list is exactly the registry's routes that carry a tool name — 24 tools, no
more. `tools/list` is the authority; read it rather than remembering names.

| family | tools |
|---|---|
| discovery | `narralens_capabilities`, `narralens_health_read` |
| intake & questions | `narralens_intake_put`, `narralens_intake_read`, `narralens_question_put`, `narralens_question_answer`, `narralens_content_decision_relay` |
| project & artifacts | `narralens_project_create`, `narralens_context_read`, `narralens_workflow_read`, `narralens_artifact_put` |
| tasks & jobs | `narralens_task_prepare`, `narralens_job_read`, `narralens_job_cancel` |
| changes | `narralens_change_prepare`, `narralens_change_apply` |
| runs | `narralens_workflow_run_prepare`, `narralens_workflow_run_read`, `narralens_workflow_run_start`, `narralens_workflow_run_pause`, `narralens_workflow_run_resume`, `narralens_workflow_run_cancel` |
| review & delivery | `narralens_review_read`, `narralens_delivery_read` |

### What is deliberately *not* callable

`intake.confirm`, `change.approve`, `question.answer.ui`, `workflow.run.authorize`,
`review.decide` and `editor.native.ack` have **no MCP tool**. They are trusted-UI
and native-bridge routes: a human decision in the workbench, or a confirmation from
the native editor.

Do not try to reach them by another route, and do not describe their absence as a
bug. When a task needs a human decision, tell the user which workbench action is
needed and read the result back with the read-only tool once it exists. An agent
answer in a terminal is not a human approval, and `confirmed=true` or `actor=human`
in a payload does not make it one.

## Rules

1. **Read before you write.** `narralens_context_read` and `narralens_workflow_read`
   before any prepare or apply. The Host re-checks everything you send; a stale base
   is rejected, and guessing wastes a round trip.
2. **Never invent an identifier.** Project ids, run ids, job ids, package ids and
   digests come from a read. A digest you make up is a 400.
3. **Do not resend a request that failed for a reason.** Read the error's `code` and
   `next_actions`:
   - `CURSOR_EXPIRED` → take a fresh snapshot and resynchronise. Do not retry.
   - `REVISION_CONFLICT`, `RUN_PLAN_STALE`, `REVIEW_STALE`, `NATIVE_ACK_STALE` →
     re-read the current state; the old value is dead.
   - `IMPACT_REQUIRED`, `APPROVAL_REQUIRED`, `RUN_SCOPE_REQUIRED`, `RUN_GATE_BLOCKED`
     → a human or a trusted channel is needed. Report it; do not work around it.
   - `CAPABILITY_UNAVAILABLE`, `HOST_RESOURCE_EXHAUSTED` → the Host is busy or
     unreachable. Back off and retry; see `skills/narralens-lib/lib/reconnect.md`.
   - `INVALID_REQUEST` → the payload is wrong. Fix the payload; retrying it verbatim
     will fail the same way.
   - `PROVIDER_RESULT_UNKNOWN` → **a write may or may not have been applied.** Do not
     retry it, and above all do not resend it under a new idempotency key: that
     would apply it twice. Read the facts back — the job, the run, the project's
     state — under the **original** idempotency key, and decide from what you read.
4. **Cancelling is safe, but it is not unconditional authority.** The cancel tools
   work even while a gate is pending or a grant has been revoked, and they are the
   right thing to use when the user asks to stop something. They are still a normal
   authenticated call: they carry the same identity, the same project and run
   ownership and the same scope checks as the call they cancel, and the Host
   re-verifies them. "Cancel is safe" means it does not need a fresh approval — it
   does not mean it bypasses authentication, and it never means cancelling
   something you do not own.
5. **A job that succeeded is not a committed film, and a committed film is not a
   loaded editor.** They are separate facts and the Host reports them separately.
6. **Unknown fields are rejected**, not ignored. Do not send extra keys.

## Reading the same facts as resources

Some facts are better read as resources than as tools:

- `narralens://services/health` — the health of every registered service, with the
  5 second sampling interval and the 15 second staleness limit.
- `narralens://projects/{id}/context` — the project context.
- `narralens://projects/{id}/workflow` — the workflow nodes and their states.
- `narralens://projects/{id}/jobs` — the active jobs plus the project's identity.
  This is an object, not a bare array.
- `narralens://projects/{id}/events-snapshot` — the observation snapshot and its
  signed cursor. It accepts `?filter_digest=`, `?cursor=` and `?last_event_id=`; any
  other query parameter is refused rather than ignored.
- `narralens://projects/{id}/local-assets` — the registered local material of the
  project, as the reviewed adjunct transport. It is read only: it never registers,
  never probes and never encodes. It accepts `?limit=` and `?cursor=`; any other
  query parameter is refused rather than ignored. This resource is counted
  separately from the frozen ones above, and it belongs to a project you own.

## Library

Reusable fragments live in `skills/narralens-lib/`:

- `lib/agent-registry.ts` — the typed registry view (tool names, resources, error
  codes) for scripts that need to reason about the façade.
- `lib/errors.md` — the error code table and what each code means.
- `lib/reconnect.md` — the reconnect and backoff runbook.
