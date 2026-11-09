# MAIN integration request 003 — idempotency scope and route ownership

Status: PRODUCT lane, session `4548ddcb-e870-405b-863f-a17a4a7ed683`. Base/contract
`ca5b67a8285b130c79055317c6202f73cfbb99c8`, manifest
`532cd43c963a1c94de5f8ce34f3c6eb7281fded80047f74dc5dbe1a70aa65170`.

Companions: `requests/001-repository-and-mounts.md`,
`requests/002-exact-record-mapping.md`, `INTEGRATION.md`.

Three things need MAIN's answer. The first is a concrete adapter decision; the second is
an ownership conflict between the frozen registry and the A release assignment; the third
is a set of storage decisions that are already implemented but that MAIN may want to
change.

---

## 1. The pre-project idempotency scope (a concrete proposal)

The frozen `operation_idempotency` table is
`PRIMARY KEY (project_id, operation_kind, idempotency_key)` and has **no foreign key on
`project_id`** — MAIN confirmed this. That is what makes it usable for the pre-project
creative writes:

- `intake.put`
- `question.put`
- `question.answer` / `question.answer.ui`
- `content.relay`
- `intake.confirm`

None of them has a project yet: the intake id is minted by the first write and the
project only exists after `project.create`. `cp_a0_bootstrap_command` cannot carry them
either — its `operation` is CHECK-constrained to `project.create`.

**Proposal.** MAIN namespaces the pre-project scope inside the existing table, using a
reserved `project_id` value that cannot collide with a real project id:

```
operation_idempotency.project_id = 'principal:' || <principal_id>
```

`principal_id` comes from the authenticated session, so the namespace is stable per
principal and the key stays
`(principal_id, operation_kind, idempotency_key)` — the same triple `cp_a0_bootstrap_command`
already uses for its pre-project receipt. The lane never writes the row; it calls
`tx.recallIdempotency({ kind: "principal", principal_id }, operation, key)` and
`tx.recordIdempotency(...)`, and MAIN's adapter decides the namespace string.

**What the lane needs from MAIN.**

- [ ] Confirm that `principal:<principal_id>` is an acceptable namespace, or name the one
      MAIN prefers. The lane does not care about the string; it only needs the scope to be
      stable and to be a function of the principal.
- [ ] Confirm that the project-scoped operations use the plain `project_id`, so a real
      project and a principal namespace can never collide.
- [ ] Confirm that MAIN is willing to write the pre-project receipts into the existing
      `operation_idempotency` table rather than adding a second ledger. The lane's
      assumption is "no second command authority", and this is the part that makes it true
      for the pre-project writes as well.

**Why the receipt has to store the response.** The lane returns the *stored* response on a
replay, so a replayed answer keeps its original `recorded_at` instead of minting a new
one. `operation_idempotency.response_json` already holds that.

**Why the digest excludes `meta`.** `meta` carries the idempotency key and the correlation
id. Neither is content. The lane's `contentDigest` hashes the request body without
`meta`, so two requests that differ only in their correlation id hash the same and do not
raise a spurious `IDEMPOTENCY_CONFLICT`. The same key with a different *content* digest is
still a conflict.

---

## 2. Route ownership: the registry and the release assignment disagree

`contracts/agent-driven-a.registry.json` names MAIN as the `businessProducer` for five
routes that the A release assignment asks the PRODUCT lane to implement:

| Route | Registry `owner` / `businessProducer` | A release assignment |
| --- | --- | --- |
| `intake.confirm` | main / MAIN | "CreativeService for intake put/read/confirm" |
| `workflow.run.authorize` | main / MAIN | "FixedWorkflowService for frozen A prepare/authorize/start/pause/resume/cancel/read" |
| `workflow.run.start` | main / MAIN | same |
| `workflow.run.pause` | main / MAIN | same |
| `workflow.run.resume` | main / MAIN | same |
| `workflow.run.cancel` | main / MAIN | same |
| `review.decide` | main / MAIN | "real review package publication/read/decision" |

**What the lane did.** It implemented the business logic of all seven in the PRODUCT
services, and it did not register a route, change the registry, or touch the server. The
lane's services are pure: they take a validated input plus an out-of-band caller context
and return a validated output. MAIN keeps the transport, the authentication, the trusted
channel and the route registration.

The one place where the lane genuinely needs MAIN is the trusted evidence:
`workflow.run.authorize` and `review.decide` cannot produce a trusted confirmation or a
limited approval by themselves, so they call the injected `TrustedAdoptionAuthority`,
which writes those rows inside the lane's transaction. `intake.confirm` writes
`cp_a0_intake_confirmation` itself, because the trusted UI caller context *is* the
evidence there.

**What MAIN has to decide.**

- [ ] Confirm that the business logic staying in the PRODUCT lane while MAIN registers the
      routes is acceptable, and that the registry's `businessProducer` column should stay
      as it is or be corrected. The lane did not change the frozen registry.
- [ ] Or move the five MAIN-owned calls into MAIN's own composition. In that case the
      PRODUCT services would keep `intake.put`, `intake.read`, `question.*`, `content.relay`,
      `artifact.put`, `workflow.run.prepare`, `workflow.run.read` and `review.read`, and
      MAIN's service would call into the lane's helpers for the parts it needs. The lane
      asks for a decision before wiring anything, because the split changes what MAIN has
      to inject.

The lane's recommendation is the first option: the business logic is content and workflow
knowledge, and keeping it in one place is what keeps the gate rules and the digest rules
in one place too.

---

## 3. Storage decisions that are already implemented

These are listed in `requests/002-exact-record-mapping.md` §7 and repeated here because
they are the ones that would be expensive to change later.

1. **The wire `RunGate` objects live in `cp_a0_run.checkpoint_json`.** The frozen schema
   has no `cp_a0_run_gate` table, and the gates are the facts that decide whether a
   downstream step may be dispatched. They are re-read on every `workflow.run.read` and
   every `workflow.read`.
2. **The review package body lives in `cp_a0_artifact_version.content_json`.** The frozen
   schema has no review-package table; `cp_a0_review_request` points at the artifact
   through `artifact_id` / `artifact_version`.
3. **The wire `Approval.plan_sha256` maps to `cp_a0_approval.action_digest`.** The lane
   keeps `facts_digest` internal.
4. **The pre-project receipt is addressed by
   `UNIQUE(principal_id, operation, idempotency_key)`** rather than by `command_id` — see
   §1.
5. **Intake-scoped and project-scoped events reach the outbox but not `cp_a0_event`.**
   `cp_a0_event.run_id` is a mandatory foreign key onto `cp_a0_run`.

---

## 4. What the lane has not been able to check

Everything in this lane is **source only**. The MAIN resource reservation was RUNNING
throughout, so there was no install, no `tsc`, no test run, no browser and no ffmpeg. The
lane's own tests exist and are written against the frozen schema, but they have never
been executed, and this document does not claim that they pass.

The digest algorithm was checked against the frozen golden vectors
(`docs/agent-driven-v1/cp-a0/canonical-vectors.json`) with a standalone script outside
the project build: the canonical text and the SHA-256 matched the frozen `brief`,
`initialAnswer`, `changedAnswer`, `runScope` and `fixedPlan` vectors. That is a check of
the algorithm, not a run of the lane's test suite.
