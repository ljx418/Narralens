# SOURCE REPAIR batch 1 — record

Lane: PRODUCT. Session `4548ddcb-e870-405b-863f-a17a4a7ed683`. Candidate under repair:
`7e4f8b0a4ea318f0c607ed72bcfc4f4e521306f6`. Main's decision record: `22cc663a`.

**Nothing was executed during this repair.** The PRODUCT light slot is released to MAIN;
there was no install, no `tsc`, no `vitest`, no browser, no Host and no ffmpeg. Every
change below is a source change, and every test is still `NOT_RUN`. The first failure logs
(`logs/install-first.log`, `logs/tsc-first.log`, `logs/vitest-first.log`) are unchanged.

The first acceptance was: install exit 0, `tsc` exit 2 with 8 errors, `vitest` exit 1 with
37 passed / 15 failed / 52.

---

## 1. The eight `tsc` errors, one by one

| Error | Cause | Fix |
| --- | --- | --- |
| `WorkflowTopBar.tsx(62)`: `HTMLElement` is not `HTMLButtonElement` | the trigger was remembered as a button, but the focused element is any `HTMLElement` | the ref is `HTMLElement \| null` and the focus is restored on that element |
| `execution-guard.ts(61)`: `"chapters"` is not a `RunGate["kind"]` | the gate vocabulary and the stage vocabulary were mixed: `chapters` is a stage, `chapter_pack` is a gate | the stage→gate map is `chapters → chapter_pack`; the guard now looks the gate up by the *gate* vocabulary and the stage requirements are a separate table |
| `fixed-workflow-service.ts(368)`: `RunAuthorize` not found | the type was used but not imported | imported from the frozen DTOs |
| `fixed-workflow-service.ts(882,889)`: `change_id` does not exist on `Change` | the adoption invented a wire field | the frozen `Change` has `materialization_id`; the approval's `change_id` is that field, and no new wire field was added |
| `fixed-workflow-service.ts(1045)`: stage id used to index a gate record | the stage→gate lookup was inverted | `GATE_STAGE` maps a gate to its stage, and the node lookup uses the stage vocabulary |
| `execution-guard.test.ts(95)`: `true` is not `false` | the test asserted a status that the frozen schema does not have | the error map is copied verbatim from the frozen schema; the test asserts the frozen status |
| `execution-guard.test.ts(117)`: missing `run_scope_digest` | the test built the old context | the context now carries the durable facts, and the test was rewritten |

## 2. The fifteen test failures

Six were **false failures**: the UI tests never cleaned the DOM between the cases, so
every query found the panels of the earlier cases as well. `afterEach(cleanup)` is now in
the UI test file, and the queries were tightened at the same time.

The other nine were real:

| Failure | Cause | Fix |
| --- | --- | --- |
| `confirms a brief only in a trusted session` | the test repository's `list` matched the *key* of a row, but the intake confirmation is addressed by `intake_id` while its primary key is the confirmation id | `list` filters on the row's own columns, the way a SQL `WHERE` does |
| `authorizes a run … and then starts it` | the test repository treated `mutable_state` rows as append-only, so a run whose state advanced raised an idempotency conflict | a mutable-state row is updated in place and only its frozen binding columns are protected |
| `keeps pause and cancel available …` | same cause | same fix |
| `keeps the cover an independent package` | same cause | same fix |
| `refuses a decision that is bound to another package version` | same cause | same fix |
| `records a plain review without granting any approval` | same cause | same fix |
| `fails the adoption closed when MAIN cannot register the approval` | same cause | same fix |
| `records the limited approval in the same transaction as the decision` | same cause | same fix |
| `refuses an action the scope does not allow` | the guard checked the gates before the scope, and the test's action was in fact allowed by the scope | the scope is checked before the gates, and the test uses a scope that really does not allow the action |

The test repository was not patched to be laxer. It now enforces the foreign keys the
frozen SQL declares **between the lane's own tables**, the trusted-evidence triggers, the
one-active-attempt index and the immutable binding columns, so a negative case fails for
the reason the SQL would fail and not because the stub was permissive. The foreign keys
that point at MAIN's tables (`project_state`, `job`, `snapshot`, `project_transaction`,
`outbox`) are **not** enforced, and the file says so: pretending to enforce them would
make the stub claim a guarantee it cannot keep.

## 3. The consolidated review, case by case

### 3.1 The types have to match the frozen DTOs

`Change` has `materialization_id` and no `change_id` — the adoption now uses
`materialization_id` and invents nothing. `RunScope.allowed_actions` never contains an
undefined value: the scope is built from the frozen action union.

### 3.2 The execution guard has to fail closed

The guard was optional: `guardExecution(binding, action)` without a context returned
success, and the context's `stage_id` was optional too. Both are now impossible to omit.

`guardExecution(binding, effect, facts)` takes the durable facts and refuses the call
without them. `guardExecutionInTransaction(repository, binding, effect, principal, { project_id })`
reads the run, the grant, the attempt and the gates from the lane's own records inside one
transaction and then guards against what it just read — that is the call MAIN makes before
every actual side effect.

The facts are checked against each other, not against the caller: the scope is the run
row's scope and its digest is **recomputed** here, the grant is the run's authorization
row, the attempt is the durable attempt row, and the principal is the authenticated one.
A scope flag or a digest in a request body is not authority.

| Case | Result |
| --- | --- |
| no facts at all | `RUN_SCOPE_REQUIRED` |
| unknown step | `CAPABILITY_UNAVAILABLE` |
| an action that does not belong to the step | `CAPABILITY_UNAVAILABLE` |
| an action the scope does not allow | `RUN_SCOPE_REQUIRED` |
| a revoked grant | `RUN_SCOPE_REQUIRED` |
| an expired grant | `RUN_SCOPE_REQUIRED` |
| a foreign principal | `UNAUTHORIZED` |
| a stale attempt (not the current one) | `RUN_PLAN_STALE` |
| an attempt that is over | `RUN_PLAN_STALE` |
| a paused, cancelled, blocked or waiting run | `RUN_PLAN_STALE` |
| a scope whose digest does not match its own content | `RUN_PLAN_STALE` |
| a paid / external / runtime scope | `CAPABILITY_UNAVAILABLE` |
| the sample gate not accepted | `RUN_GATE_BLOCKED` |
| a safe control (pause, cancel) | allowed without a grant and without an attempt |

The gate requirements are now non-circular: a stage depends on the review gates of its
*predecessor* stages, and `delivery.package` additionally depends on the `qc` gate, which
the delivery stage itself produces. The `adoption` gate is not a dispatch prerequisite —
the adoption is the approval, and it is consumed by MAIN's Coordinator in the final
commit.

The guard still never accepts a gate, never advances a step and never creates an artifact.

### 3.3 Creative compare-and-set

- A brief that did not change does **not** advance the version. Writing the same brief
  again used to make every question, answer and decision that binds the old digest stale
  for no reason.
- The brief's owner is checked: another principal cannot rewrite it.
- The material strategy has to agree with the brief: the same asset list and the same
  narration.
- The style digest is recomputed from the style's own five fields and compared with the
  one the client sent. The formula is in `INTEGRATION.md`; it is lane-owned and MAIN's
  brief writer has to use the same one.

### 3.4 Run preparation

- Only an `accept_content` decision starts a run. A `revise_content` or `reject_content`
  decision is refused.
- The decision has to be about the **current** intake head version.
- The closure has to be the current one, recomputed from the durable question and answer
  rows.
- A mandatory question that has not been answered — or that was skipped although it may
  not be skipped — blocks the run.
- Every reference has to resolve to an immutable artifact of the project, with a matching
  digest. A ref that names nothing is refused.
- The facts the lane cannot own — does the project exist, is the material licensed, is the
  capability available — come from a **mandatory** read-only port. Without the port the
  preparation fails closed with `CAPABILITY_UNAVAILABLE`.
- The **definition gate starts accepted** and is bound to the content decision, so no gate
  is left pending with no way to complete it. The other six gates start pending and each
  has a completion path.
- A new run never inherits another run's gates: the checkpoint is per run.

### 3.5 Review

- A `chapter_pack` needs the **sample and the first chapter** accepted, not just the
  sample.
- An `audio` package satisfies **no** gate. It is a supplementary review of one part of a
  chapter, and letting it stand in for the chapter would let a chapter pass its gate
  without a picture.
- A reuse has to name a package of the same run, the same chapter and the same input,
  output and quality. A different quality is refused.
- Publishing the same package again is a **safe replay**: the stored package is returned
  and no state is reset. Publishing the same id with different content is refused.
- A package has to name a real, current attempt of its step. An attempt that was cancelled
  or that is not the current one cannot advance a gate.
- A decision has to be one of the package's `allowed_choices`, has to bind the current
  package version and all three digests, and is refused when the run was cancelled or when
  the package belongs to another scope.
- An adoption validates the impact: the same project, the `active` state, not expired, and
  the same plan digest. It names the **real** step and attempt that produced the package,
  and the approval carries the frozen `materialization_id`.
- The trusted confirmation MAIN returns is **checked**: the same run, the same purpose, the
  same actor, the same action and the same window. A confirmation that says otherwise is
  refused rather than recorded.
- A pure review never asks for an approval, and the authority is mandatory for every
  decision — a decision without trusted evidence is not recorded.

### 3.6 Workflow projection

- The run the observation shows is chosen deterministically: the live one, and among the
  live ones the last by creation time and then by run id.
- `observed_at` is the time the checkpoint was last written, not the clock at read time. A
  read no longer pretends that something was observed now.
- The attempts come from the durable attempt rows. There is a new
  `FixedWorkflowService.recordStepAttempt(...)` that MAIN calls from a genuine job event:
  it records what MAIN observed and never manufactures an attempt, a job or a progress
  step of its own.

### 3.7 The R4 surfaces

- The rail shows the creative names (明确目标, 样片, 首章, 整章制作, 封面, 交付); the
  internal identifiers are only in the task detail.
- The collapsed bar says what it observed and when, and it says plainly when the
  connection is broken.
- The task dialog keeps the focus inside it, closes on `Escape` and returns the focus to
  the stage it was opened from.
- The system panel closes on `Escape` and returns the focus to whatever opened it. It has
  no backdrop and no focus trap.
- A health sample that is stale, that is from the future, that cannot be read or that has
  passed its own expiry is shown as **unknown**. A metric without a value is shown as
  unknown, not as zero.
- The native sync is only claimed when the acknowledgement matches the revision, the
  snapshot, the source digest **and** the selection. The `native_sync` flag alone is never
  enough.
- The review panel has no player and no timeline: `onOpenPart` asks the host to open the
  part in the workbench's own player, which keeps the original selection and clock.

## 4. What is still open for MAIN

`requests/003` records MAIN's decisions as final; they are no longer questions. The one
new thing is in `requests/004-project-fact-port.md`: MAIN has to implement the mandatory
read-only project fact port, because the lane cannot verify the project, the material
rights or the registered capability on its own.

## 5. What this repair does **not** claim

- No test was run. The 15 failures are addressed in the source, not demonstrated green.
- The eight `tsc` errors are addressed in the source, not demonstrated compiled.
- The lane does not claim that the A round or the module is ready. Only a fresh `tsc` and
  `vitest` run on a new light slot can say that, and Codex has to run it.
