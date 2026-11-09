# PRODUCT lane — integration guide for MAIN

Lane: PRODUCT. Session `4548ddcb-e870-405b-863f-a17a4a7ed683`.
Base/contract `ca5b67a8285b130c79055317c6202f73cfbb99c8`, manifest
`532cd43c963a1c94de5f8ce34f3c6eb7281fded80047f74dc5dbe1a70aa65170`.

Current internal validation: tsc exit0 and 5 files/100 tests passed under MAIN PRODUCT-light admission. Codex implemented the final corrections; independent review REVIEW_PENDING. Original first failures retained; production Host/browser/media/human acceptance NOT_RUN. See verification-codex.json.

This is the document MAIN needs to wire the lane in. It states what MAIN implements, what
MAIN injects, which route maps to which service call, and the exact commands.

**Nothing in this lane has been compiled or executed.** The PRODUCT light slot was
released to MAIN while the lane was written: no install, no `tsc`, no test run, no browser,
no ffmpeg. Every test below is `NOT_RUN`. The first acceptance's failure logs are kept
unchanged in `logs/`, and the repair record is
`logs/2026-11-09-source-repair-batch1.md`.

---

## 1. What MAIN implements

### 1.1 The repository adapter

One adapter: `ProductRepository` from `src/host/creative/product-repository.ts`.

```ts
interface ProductRepository {
  transaction<T>(work: (tx: ProductTransaction) => T): Promise<T>;
}
```

The callback is **synchronous**. MAIN holds one `BEGIN IMMEDIATE` across the records, the
idempotency receipt and the outbox event, so a failure anywhere rolls all of it back
together. The `ProductTransaction` methods are typed down to one collection each
(`get`/`list`/`put`/`compareAndSet`), so the adapter cannot be a generic key/value store.

The closed collection union, the per-collection record DTOs and the exact column mapping
are in `requests/002-exact-record-mapping.md`. The machine-readable version is:

```sh
pnpm exec tsx tools/agent-driven/product/record-mapping.ts
```

#### The write rules MAIN's adapter has to implement

| Collection kind | Collections | `put` | `compareAndSet` |
| --- | --- | --- | --- |
| `immutable_version` | intake, question, answer, template, artifact, plan versions | insert; an identical existing row is a replay, a different one is `IDEMPOTENCY_CONFLICT` | — |
| `append_only` | intake content decision, intake confirmation, review decision, trusted confirmation, prepared authorization, bootstrap command, project origin, native ack | same as above | — |
| `head` | intake, question, answer, template, artifact heads | rejected — a head only moves through compare-and-set | compare the version column; `expectedVersion = 0` means "no row yet"; a mismatch is `REVISION_CONFLICT` |
| `mutable_state` | run, review request, execution grant, step attempt, approval | replace the mutable columns; refuse a change to the immutable binding columns with `REVISION_CONFLICT` | — |

`list` filters on the **row's own columns**, not on the key: the intake confirmation is
addressed by `intake_id` even though its primary key is the confirmation id.

#### Events

`tx.emit(event)` appends to MAIN's existing `outbox` and returns the assigned `event_id`.
For a `run`-scoped event MAIN also writes the `cp_a0_event` mirror row; for `project` and
`intake` scopes it does not, because `cp_a0_event.run_id` is a mandatory foreign key onto
`cp_a0_run`. See request 002 §5.

#### Idempotency

`tx.recallIdempotency(scope, operation, key)` and `tx.recordIdempotency(...)` map onto
MAIN's existing `operation_idempotency` table. There is **no second command ledger**.

MAIN's decisions (final, `requests/003`):

- `project_id = 'principal:' + <authenticated principal>` before the project exists, the
  real `project_id` afterwards;
- `operation_kind = 'agent.v1:' + <operation>`;
- the receipt and the original response are stored in the same transaction;
- the lane's scope argument is `{ kind: "principal", principal_id }` or
  `{ kind: "project", project_id }` — MAIN decides the namespace string.

The digest covers the request body **without** `meta`: the idempotency key and the
correlation id are transport metadata, so two requests that differ only in their
correlation id hash the same and do not raise a spurious `IDEMPOTENCY_CONFLICT`.

### 1.2 The trusted adoption authority

```ts
interface TrustedAdoptionAuthority {
  registerConfirmation(tx: ProductTransaction, input: TrustedConfirmationInput): TrustedConfirmationRecord;
  registerApproval(tx: ProductTransaction, input: TrustedApprovalInput): ApprovalRecord | null;
}
```

Both methods receive the lane's transaction and must write inside it. A `null` from
`registerApproval` makes `accept_and_adopt` fail closed with `APPROVAL_REQUIRED`.

The lane **checks** what the authority returns: the same project, run, purpose, actor,
action digest and window. A confirmation that says otherwise is refused rather than
recorded.

### 1.3 The project fact port

```ts
interface ProductFactPort {
  readProjectFacts(projectId: string): Promise<ProductProjectFacts>;
}
```

Defined in `src/host/creative/product-facts.ts`, requested in
`requests/004-project-fact-port.md`. It is read-only and **mandatory**: the lane cannot
verify the project's existence, the material rights or the registered capability on its
own, and without the port a run cannot be prepared (`CAPABILITY_UNAVAILABLE`).

---

## 2. How MAIN composes the lane

```ts
const repository = new ProductRepositoryAdapter(revisionStore);   // MAIN
const adoption = new TrustedAdoptionAuthorityAdapter(...);        // MAIN
const facts = new ProductFactPortAdapter(...);                    // MAIN

const creative = new CreativeService({ repository });
const workflow = new FixedWorkflowService({ repository, adoption, facts });
```

### 2.1 The execution guard — MAIN's call before every actual side effect

```ts
await guardExecutionInTransaction(
  repository,
  binding,                                        // the ExecutionBinding MAIN would dispatch with
  { kind: "action", action: "clip.prepare", stage_id: "sample" },
  principalId,                                    // the authenticated principal
  { project_id },                                 // the project the effect belongs to
);
```

`guardExecutionInTransaction` opens the transaction, reads the run, the grant, the attempt
and the gates from the lane's own records, and then guards the effect against what it just
read. It **fails closed**: without the facts it authorizes nothing.

The pure form is `guardExecution(binding, effect, facts)` for a caller that already holds
the facts. `facts` is a required argument — there is no path that returns success without
them.

A safe control — `pause` or `cancel` — checks the identity only, so it stays available
when the grant is gone or a gate is open:

```ts
await guardExecutionInTransaction(
  repository, binding, { kind: "safe_control", control: "pause" }, principalId, { project_id },
);
```

### 2.2 Recording a real attempt

MAIN calls this from a genuine job event. The lane records what MAIN observed; it never
manufactures an attempt, a job or a progress step of its own.

```ts
await workflow.recordStepAttempt({
  project_id, run_id, plan_version: 1,
  step_id: "sample", attempt: 1,
  grant_id, input_digest,
  state: "running",                    // pending | running | waiting_user | succeeded | failed | cancelled | stale | unknown
  job_id: "job-42",
  observed_at: "2026-11-09T12:00:00.000Z",
}, callerContext);
```

The attempt row is the durable fact the guard later checks. The workflow nodes the
workbench shows are built from these rows, so a stage that never ran stays `pending` with
attempt 0.

---

## 3. Routes

The route ids, paths, tools, channels and gate policies are the frozen
`contracts/agent-driven-a.registry.json`. The lane implements the business logic; MAIN
registers the routes and owns the transport, the authentication and the trusted channel.

MAIN's decision (final): the **seven sensitive `businessProducer` entries stay MAIN's** —
`intake.confirm`, `workflow.run.authorize`, `workflow.run.start`, `workflow.run.pause`,
`workflow.run.resume`, `workflow.run.cancel` and `review.decide`. MAIN verifies the trusted
session, the principal and the currentness, calls the pure domain helpers, and injects the
authority inside the same transaction. The Coordinator consumes the adoption approval in
the final commit; the lane never consumes one.

| Route | Registry owner | Lane call | Channel |
| --- | --- | --- | --- |
| `intake.put` | product | `creative.putIntake` | authenticated |
| `intake.read` | product | `creative.readIntake` | authenticated |
| `intake.confirm` | main | `creative.confirmIntake` | trusted_ui |
| `question.put` | product | `creative.putQuestion` | authenticated |
| `question.answer` | product | `creative.answerQuestion` | authenticated |
| `question.answer.ui` | product | `creative.answerQuestionFromUi` | trusted_ui |
| `content.relay` | product | `creative.relayContentDecision` | authenticated |
| `artifact.put` | product | `creative.putArtifact` | authenticated |
| `workflow.run.prepare` | product | `workflow.prepareRun` | authenticated |
| `workflow.run.authorize` | main | `workflow.authorizeRun` | trusted_ui |
| `workflow.run.read` | product | `workflow.readRun` | authenticated |
| `workflow.run.start` | main | `workflow.startRun` | authenticated |
| `workflow.run.pause` | main | `workflow.pauseRun` | authenticated (safe control) |
| `workflow.run.resume` | main | `workflow.resumeRun` | authenticated |
| `workflow.run.cancel` | main | `workflow.cancelRun` | authenticated (safe control) |
| `review.read` | product | `workflow.readReview` | authenticated |
| `review.decide` | main | `workflow.decideReview` | trusted_ui |
| `workflow.read` | product | `workflow.readWorkflow` | authenticated |

`workflow.run.publish` (the review package publication) is not a registry route in this
round: the media lane produces the package and the lane publishes it through
`FixedWorkflowService.publishReviewPackage`. MAIN registers it when the route exists.

### 3.1 The caller context

Every lane call takes a `TrustedCallerContext` as its second argument. It is minted by
MAIN's dispatcher with `createTrustedCallerContext(...)` after the session, the origin and
the project permission were verified. The context carries a runtime brand, so a value that
came from a request body is refused with `UNAUTHORIZED` even if it type-checks.

---

## 4. Frontend

MAIN mounts three components inside the original shell. There is no second application
root, no timeline and no player.

```tsx
import { WorkflowTopBar, CreativeReviewPanel } from "./app/observation/index.js";
import { SystemControlPanel } from "./app/system/index.js";
import "./app/observation/observation.css";
import "./app/system/system.css";
```

| Component | Props | Notes |
| --- | --- | --- |
| `WorkflowTopBar` | `workflow`, optional `title`/`status`/`observedAt`/`connection`/`expanded`/`onExpandedChange`/`onLocate` | Collapsed by default; horizontal stages with their creative names; the task dialog shows the real attempt, job, inputs and outputs and the internal identifier; the focus stays inside the dialog, `Escape` closes it and the focus returns to the stage; closing has no control effect. |
| `SystemControlPanel` | `health`, `nowMs`, `open`, optional `onClose`/`actions`/`impact` | A non-modal `aside`: no backdrop, no focus trap, it never takes the focus. `Escape` closes it and the focus returns to whatever opened it. A sample that is stale, in the future, unreadable or past its own expiry is shown as unknown, and a metric without a value stays unknown. A shared service offers no control. There is no model load, warm or unload control in this round. |
| `CreativeReviewPanel` | `package`, optional `brief`/`script`/`storyboard`, the four decision callbacks and `onOpenPart` | The chapter bundle is one package; the cover is its own review; close is not a decision. `确认并采用` is only offered when the package allows it and carries an impact. The panel has no player: `onOpenPart` asks the host to open the part in the workbench's own player, which keeps the original selection and clock. |

`nativeSyncState(context)` in `src/app/observation/content-views.tsx` is the only thing
that says the editor is loaded: it needs `context.native_sync === "loaded"` **and** an
acknowledgement whose revision, snapshot, source digest and selection all match the
context. A succeeded job or a committed film never produces that statement.

---

## 5. Commands

All of these are `NOT_RUN` — the PRODUCT light slot is released to MAIN.

```sh
# The lane's own tests.
pnpm exec vitest run --config vitest.config.ts tests/agent-driven/product --maxWorkers=1

# The type check (the whole project, because the lane's files are part of it).
pnpm exec tsc --noEmit

# The machine-readable collection mapping.
pnpm exec tsx tools/agent-driven/product/record-mapping.ts
```

The lane's tests are:

| File | What it covers |
| --- | --- |
| `tests/agent-driven/product/digest.test.ts` | The canonicalization against the frozen golden vectors; the fixed plan digest; the metadata-free request digest; the values the canonicalization refuses. |
| `tests/agent-driven/product/creative-service.test.ts` | The brief compare-and-set; the unchanged brief that does not advance the version; the owner check; the material strategy and the style digest; the idempotent replay and the same-key conflict; the question and answer bindings; a stale answer; the changed-answer invalidation; the relay channel rules; the forged caller context; the artifact compare-and-set; the error code and status. |
| `tests/agent-driven/product/fixed-workflow-service.test.ts` | The fixed scope and the accepted definition gate; the missing fact port; a decision that did not accept; the authorization and the principal; the safe controls; the sample-before-first-chapter and first-chapter-before-chapter gates; the audio package that satisfies no gate; the missing chapter parts; a package from a stale or cancelled attempt; the safe replay of a publication; a reuse with another quality; the independent cover; a stale decision; a choice the package does not allow; the plain review without an approval; the adoption that fails closed; an expired and a foreign impact; the approval against the real attempt; a trusted confirmation that does not match; the transaction-bound guard; the workflow nodes. |
| `tests/agent-driven/product/execution-guard.test.ts` | The missing facts; the accepted prerequisites; the sample gate; the scope digest; the scope's allowed actions; an action outside the step; an unknown step; a paid scope; a revoked and an expired grant; a foreign principal; a stale and a finished attempt; a paused, cancelled, blocked and waiting run; the safe controls; the malformed binding; that the guard never accepts a gate. |
| `tests/agent-driven/product/observation-ui.test.tsx` | The collapsed bar; the creative stage names; the real attempt and references in the dialog; Escape and the focus return; that closing has no control effect; the disconnected state; that closing the review is not deciding; that the adoption is not offered without an impact; that the panel delegates playback; that the cover is independent; the non-modal aside; Escape and the focus return in the system panel; a stale, future and unreadable sample; an unmeasured metric; no control for a shared service and no model mutation; the native sync against the revision, the selection and a missing acknowledgement. |

`tests/agent-driven/product/support/memory-repository.ts` is a **test-only** implementation
of the seam. It enforces the foreign keys the frozen SQL declares between the lane's own
tables, the trusted-evidence triggers, the one-active-attempt index and the immutable
binding columns, so a negative case fails for the reason the SQL would fail. The foreign
keys that point at MAIN's tables are **not** enforced, and the file says so. It is never
imported by `src/`, and the production composition always injects MAIN's adapter.

---

## 6. The formulas the lane owns

### 6.1 The style digest

The frozen contract says the style digest is recomputed rather than trusted, but it does
not fix the formula. The lane's formula — which MAIN's brief writer has to match — is:

```
style_digest = SHA-256(canonicalJson({
  style_id, version, visual_direction, voice_direction, subtitle_direction
}))
```

The canonical JSON is the restricted JCS of `src/host/creative/digest.ts`: ASCII object
keys sorted by UTF-16 code unit, no whitespace, UTF-8, arrays in order, safe integers
only. A brief whose style digest does not match is refused with `INVALID_REQUEST`.

### 6.2 The capability fingerprint

```
capability_fingerprint = SHA-256(canonicalJson(FIXED_PLAN.capabilities))
```

with the capabilities in the fixed order of the golden plan.

---

## 7. What the lane did not do

- It did not write `operation_idempotency`, `project_state`, `snapshot`, `active_commit`,
  `project_transaction`, `job` or `outbox` directly.
- It did not create a second bootstrap, a second commit path or a second event queue.
- It did not add a stability authorization, a free capability graph, a model write or a
  runtime mutation. The fixed plan has `stability_skip: false`, `dynamic_patch: false`,
  `paid: false`, `external_write: false` and `runtime_mutation: false`.
- It did not touch the server, the contracts, the configuration, the M5 bundle or the
  project-creation service.
- It did not consume an adoption approval: the Coordinator does that in the final commit.
- It did not run anything.

## Stable Codex integration clarifications
`RunPrepare.style_ref` resolves only to the immutable project `kind=brief` carrier MAIN creates during bootstrap/confirmed new Brief. Ref SHA is the entire Brief document hash; the embedded style must match selected intake style fields/version/recomputed digest. Script/storyboard cannot substitute for style carrier. Script refs resolve script payloads; ordinary refs resolve validated Brief/Script/Storyboard immutable documents in the same project.

Principal is the authenticated user across MCP and UI transports, not the CLI process identity. Draft intake reads and mutations require that principal's ownership. MAIN dispatcher remains the authority for session, Origin, project access and trusted operations.

`guardExecution` requires durable facts and exact stage/step/latest plan attempt; action checks run/grant state/expiry/owner/full scope and predecessor gates. `change.prepare/apply` are scoped to sample/first_chapter/chapters/cover; MAIN still validates impact/finite approval/currentbase/source/rights/locks and Coordinator consumes approval atomically. Call `readGuardFacts` and `guardExecution` inside MAIN's actual serialized side-effect boundary; the standalone transaction-check wrapper must not be mistaken for atomic dispatch/apply. Committed snapshot render stays bound to its snapshot despite later project revisions.

MAIN fingerprint seam resolved in request005: facts.capability_fingerprint is required lowercase64hex, supplied by MAIN actual registered catalog and stored directly in RunScope; missing/invalid values fail closed. PRODUCT never constructs production descriptor provenance. MAIN still verifies descriptor/config scope at authorization and actual serialized effect. No boolean/project-only fact pre-read substitutes for action/ref/rights/snapshot checks.
