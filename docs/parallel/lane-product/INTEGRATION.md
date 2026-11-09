# PRODUCT lane — integration guide for MAIN

Lane: PRODUCT. Session `4548ddcb-e870-405b-863f-a17a4a7ed683`.
Base/contract `ca5b67a8285b130c79055317c6202f73cfbb99c8`, manifest
`532cd43c963a1c94de5f8ce34f3c6eb7281fded80047f74dc5dbe1a70aa65170`.

This is the document MAIN needs to wire the lane in. It states what MAIN implements, what
MAIN injects, which route maps to which service call, and the exact commands.

**Nothing in this lane has been compiled or executed.** The MAIN resource reservation was
still RUNNING while this was written: no install, no `tsc`, no test run, no browser, no
ffmpeg. Every test below is `NOT_RUN`.

---

## 1. What MAIN implements

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

### The write rules MAIN's adapter has to implement

| Collection kind | Collections | `put` | `compareAndSet` |
| --- | --- | --- | --- |
| `immutable_version` | intake, question, answer, template, artifact, plan versions | insert; an identical existing row is a replay, a different one is `IDEMPOTENCY_CONFLICT` | — |
| `append_only` | intake content decision, intake confirmation, review decision, trusted confirmation, prepared authorization, bootstrap command, project origin, native ack | same as above | — |
| `head` | intake, question, answer, template, artifact heads | rejected — a head only moves through compare-and-set | compare the version column; `expectedVersion = 0` means "no row yet"; a mismatch is `REVISION_CONFLICT` |
| `mutable_state` | run, review request, execution grant, step attempt, approval | replace the mutable columns; refuse a change to the immutable binding columns with `REVISION_CONFLICT` | — |

The immutable binding columns per `mutable_state` collection are the ones the frozen
`cp_a0_*_binding_immutable` triggers protect; the list is in request 002 §3.

### Events

`tx.emit(event)` appends to MAIN's existing `outbox` and returns the assigned `event_id`.
For a `run`-scoped event MAIN also writes the `cp_a0_event` mirror row; for `project` and
`intake` scopes it does not, because `cp_a0_event.run_id` is a mandatory foreign key onto
`cp_a0_run`. See request 002 §5.

### Idempotency

`tx.recallIdempotency(scope, operation, key)` and `tx.recordIdempotency(...)` map onto
MAIN's existing `operation_idempotency` table. The lane computes the request digest and
hands MAIN the receipt; MAIN stores it. There is **no second command ledger**.

Two scopes:

- `{ kind: "project", project_id }` → `operation_idempotency(project_id, operation_kind, idempotency_key)`.
- `{ kind: "principal", principal_id }` → the pre-project case. `cp_a0_bootstrap_command`
  is only for `project.create`, so it cannot carry intake, question or relay commands. MAIN
  has to namespace this scope itself; the concrete proposal is in `requests/003`.

The digest covers the request body **without** `meta`: the idempotency key and the
correlation id are transport metadata, so two requests that differ only in their
correlation id hash the same and do not raise a spurious conflict.

---

## 2. What MAIN injects

```ts
const repository = new ProductRepositoryAdapter(revisionStore);   // MAIN
const adoption = new TrustedAdoptionAuthorityAdapter(...);        // MAIN

const creative = new CreativeService({ repository });
const workflow = new FixedWorkflowService({ repository, adoption });
```

`TrustedAdoptionAuthority` has two methods and both receive the lane's transaction:

- `registerConfirmation(tx, input)` — writes `cp_a0_trusted_confirmation`.
- `registerApproval(tx, input)` — writes `cp_a0_approval`, or returns `null` when MAIN
  cannot join the review transaction.

A `null` return makes `accept_and_adopt` fail closed with `APPROVAL_REQUIRED`. The lane
never records an approval on its own, and never after the fact.

`guardExecution(binding, action, context)` is exported for MAIN to call before every
actual side effect — job dispatch, change preparation, change application, runtime work.
It checks the binding, the scope and the gates, and it never accepts a gate or marks
progress.

---

## 3. Routes

The route ids, paths, tools, channels and gate policies are the frozen
`contracts/agent-driven-a.registry.json`. The lane implements the business logic; MAIN
registers the routes and owns the transport, the authentication and the trusted channel.

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

### The caller context

Every lane call takes a `TrustedCallerContext` as its second argument. It is minted by
MAIN's dispatcher with `createTrustedCallerContext(...)` after the session, the origin and
the project permission were verified. The context carries a runtime brand, so a value
that came from a request body is refused with `UNAUTHORIZED` even if it type-checks.

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
| `WorkflowTopBar` | `workflow`, optional `title`/`status`/`expanded`/`onExpandedChange`/`onLocate` | Collapsed by default; horizontal stages; the task dialog shows the real attempt, job, inputs and outputs; Escape closes it and the focus returns to the stage; closing has no control effect. |
| `SystemControlPanel` | `health`, `nowMs`, `open`, optional `onClose`/`actions`/`impact` | A non-modal `aside`: no backdrop, no focus trap, it never takes the focus. A sample older than `stale_after_ms` is shown as unknown. A shared service offers no control. There is no model load, warm or unload control in this round. |
| `CreativeReviewPanel` | `package`, optional `brief`/`script`/`storyboard` and the four decision callbacks | The chapter bundle is one package; the cover is its own review; close is not a decision. `确认并采用` is only offered when the package allows it and carries an impact. |

`nativeSyncState(context)` in `src/app/observation/content-views.tsx` is the only thing
that says the editor is loaded: it needs `context.native_sync === "loaded"` **and** an
acknowledgement whose revision, snapshot and source digest match the context. A succeeded
job or a committed film never produces that statement.

---

## 5. Commands

All of these are `NOT_RUN` — the resource reservation was RUNNING when this was written.

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
| `tests/agent-driven/product/creative-service.test.ts` | The brief compare-and-set; the idempotent replay and the same-key conflict; the question and answer bindings; a stale answer; the changed-answer invalidation; the relay channel rules; the forged caller context; the artifact compare-and-set; the error code and status. |
| `tests/agent-driven/product/fixed-workflow-service.test.ts` | The fixed scope; the authorization; the safe controls; the sample-before-first-chapter gate; the chapter part bundle; the independent cover; the stale review decision; the plain review without an approval; the adoption that fails closed; the adoption that records the approval; the workflow nodes. |
| `tests/agent-driven/product/execution-guard.test.ts` | The sample gate; the scope mismatch; the action outside the scope; the paid scope; the malformed binding; that the guard never accepts a gate. |
| `tests/agent-driven/product/observation-ui.test.tsx` | The collapsed bar; the horizontal stages; the real attempt and references in the dialog; Escape and the focus return; that closing has no control effect; that closing the review is not deciding; that the adoption is not offered without an impact; that the cover is independent; that a stale sample is unknown; that a shared service offers no control; that there is no model mutation; that the native sync is not claimed from a job or a commit. |

`tests/agent-driven/product/support/memory-repository.ts` is a **test-only** implementation
of the seam. It exists so the lane's own tests can run without a database. It is never
imported by `src/`, and the production composition always injects MAIN's adapter.

---

## 6. What the lane did not do

- It did not write `operation_idempotency`, `project_state`, `snapshot`, `active_commit`,
  `project_transaction`, `job` or `outbox` directly.
- It did not create a second bootstrap, a second commit path or a second event queue.
- It did not add a stability authorization, a free capability graph, a model write or a
  runtime mutation. The fixed plan has `stability_skip: false`, `dynamic_patch: false`,
  `paid: false`, `external_write: false` and `runtime_mutation: false`.
- It did not touch the server, the contracts, the configuration, the M5 bundle or the
  project-creation service.
- It did not run anything.
