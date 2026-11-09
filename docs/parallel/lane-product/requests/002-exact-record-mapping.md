# MAIN integration request 002 — exact record mapping for the PRODUCT repository seam

Status: PRODUCT lane, session `4548ddcb-e870-405b-863f-a17a4a7ed683`. Base/contract
`ca5b67a8285b130c79055317c6202f73cfbb99c8`, manifest
`532cd43c963a1c94de5f8ce34f3c6eb7281fded80047f74dc5dbe1a70aa65170`.

Companion file: `src/host/creative/product-repository.ts` (the seam itself),
`src/host/creative/digest.ts` (canonical JSON and digests),
`src/host/creative/trusted-context.ts` (out-of-band caller context and the error
vocabulary).

This request answers MAIN's clarification of the repository seam. It replaces the sketch in
`requests/001-repository-and-mounts.md`: the generic `get<T>(collection, id)` /
`list<T>(collection)` / `put<T>(collection, id, value)` shape is **not** what the lane is
shipping, because it cannot express the frozen primary keys, cannot express head
compare-and-set, and would let an adapter be implemented as a generic key/value store.
The seam below is closed, typed and table-specific.

---

## 1. What changed against request 001

| Request 001 sketch | Shipped seam | Why |
| --- | --- | --- |
| `get<T>(collection: string, id: string): T \| null` | `get<K extends ProductCollection>(collection: K, key: ProductRecordKeys[K]): ProductRecords[K] \| null` | The collection argument selects the record type, so the adapter cannot be a generic KV store. Composite primary keys are typed. |
| `list<T>(collection: string): T[]` | `list<K extends ProductCollection>(collection: K, scope: ProductRecordScopes[K]): ProductRecords[K][]` | A scope is a prefix of the primary key, so a list can never be wider than the table's access path. |
| `put<T>(collection: string, id: string, value: T): void` | `put<K extends ProductCollection>(collection, key, value): ProductWriteOutcome<K>` plus `compareAndSet<K extends ProductHeadCollection>(...)` | Heads are advanced by compare-and-set, not by blind overwrite. Append-only rows return `replayed`, so a replay is distinguishable from a write without a second lookup. |
| — | `tx.emit(event: ProductEvent): ProductEventReceipt` | The event is typed and scoped; MAIN appends it to the authoritative `outbox` in the same transaction and mirrors run-scoped events into `cp_a0_event`. |
| — | `TrustedAdoptionAuthority` | The adoption approval is registered by MAIN inside the same transaction, or the adoption fails closed. |
| — | `guardExecution(binding, action)` in `src/host/creative/execution-guard.ts` | MAIN calls this before every actual side effect. |

**No second command authority.** The lane never writes `operation_idempotency`. It computes
the request digest and hands MAIN an idempotency receipt (`ProductIdempotencyReceipt`);
MAIN stores it in the table it already owns. The pre-project receipt is
`cp_a0_bootstrap_command`, scoped by `(principal_id, operation, idempotency_key)`.

**No workflow commit.** Nothing in the seam touches `project_state`, `snapshot`,
`active_commit` or `project_transaction` except the `prepared_authorization` reference,
which is written by MAIN's Coordinator path, not by the lane.

---

## 2. Closed collection union

`ProductCollection` has exactly 25 members and each maps to exactly one `cp_a0_*` table:

```
intake_version           -> cp_a0_intake_version
intake_head              -> cp_a0_intake_head
intake_content_decision  -> cp_a0_intake_content_decision
intake_confirmation      -> cp_a0_intake_confirmation
question_version         -> cp_a0_question_version
question_head            -> cp_a0_question_head
answer_version           -> cp_a0_answer_version
answer_head              -> cp_a0_answer_head
template_version         -> cp_a0_template_version
template_head            -> cp_a0_template_head
artifact_version         -> cp_a0_artifact_version
artifact_head            -> cp_a0_artifact_head
run                      -> cp_a0_run
plan_version             -> cp_a0_plan_version
review_request           -> cp_a0_review_request
content_decision         -> cp_a0_content_decision
trusted_confirmation     -> cp_a0_trusted_confirmation
execution_grant          -> cp_a0_execution_grant
step_attempt             -> cp_a0_step_attempt
approval                 -> cp_a0_approval
prepared_authorization   -> cp_a0_prepared_authorization
bootstrap_command        -> cp_a0_bootstrap_command
project_origin           -> cp_a0_project_origin
native_ack               -> cp_a0_native_ack
event                    -> cp_a0_event          (read-only for the lane; written by MAIN)
```

The union has three disjoint groups, and the two closed lists are written out rather than
derived from the descriptor kinds:

| Group | List | Write rule |
| --- | --- | --- |
| `PRODUCT_HEAD_COLLECTIONS` | `intake_head`, `question_head`, `answer_head`, `template_head`, `artifact_head` | compare-and-set on the version column |
| `PRODUCT_APPEND_ONLY_COLLECTIONS` | the six immutable version families and the eight append-only fact rows | insert; an identical row is a replay, a different one is a conflict |
| the rest | `run`, `review_request`, `execution_grant`, `step_attempt`, `approval` | the mutable columns move; the binding columns do not |

`cp_a0_event` carries the `append_only` kind but is **not** in the append-only list: MAIN
writes it from the same `outbox` insert, so the lane may only read it. The mapping tool
cross-checks the two closed lists against the descriptor literal and fails when they
disagree.

Deliberately **not** in the union, with the reason:

| Table | Owner | Why it is not here |
| --- | --- | --- |
| `cp_a0_render_attempt` | MEDIA | Render attempts and QC belong to the media lane's own records. |
| `cp_a0_delivery` | MEDIA | Delivery manifests are published by the media lane. |
| `cp_a0_migration` | MAIN | Schema bookkeeping. |
| `project_state`, `snapshot`, `active_commit`, `project_transaction`, `job`, `outbox`, `operation_idempotency` | MAIN | The film pointer, the job table, the event queue and the command authority stay MAIN's. |

`cp_a0_event` is readable but not writable by the lane: MAIN writes it from the same
`outbox` insert, because `cp_a0_event.event_id` is a foreign key onto
`outbox(project_id, event_id)` and the outbox assigns the id.

---

## 3. Column-level mapping

Every DTO field below is the SQL column of the same name, except the `*_json` columns,
which carry the **parsed** document and are serialized to the SQL column as canonical JSON.
MAIN's adapter is expected to write `JSON.stringify` of the canonical form (the canonical
form is defined in `src/host/creative/digest.ts`); storing the parsed document verbatim
would let two logically identical rows differ byte-wise.

### 3.1 `cp_a0_intake_version` — immutable version

| DTO field | SQL column | SQL type | Notes |
| --- | --- | --- | --- |
| `intake_id` | `intake_id` | TEXT | PK part 1 |
| `version` | `version` | INTEGER | PK part 2, `CHECK(version>0)` |
| `principal_id` | `principal_id` | TEXT | The authenticated principal that wrote the brief |
| `input_digest` | `input_digest` | TEXT | SHA-256 of the canonical Brief (`brief_sha256`) |
| `content_json` | `content_json` | TEXT | The wire `Brief`, canonical JSON |
| `created_at` | `created_at` | TEXT | ISO-8601 |

The table also carries `UNIQUE(intake_id, version, input_digest)`; the lane never writes a
second row with the same triple.

### 3.2 `cp_a0_intake_head` — head

| DTO field | SQL column | SQL type | Notes |
| --- | --- | --- | --- |
| `intake_id` | `intake_id` | TEXT | PK |
| `current_version` | `current_version` | INTEGER | **CAS column** |

`compareAndSet("intake_head", { intake_id }, expectedVersion, value)`. `expectedVersion = 0`
means "the head row does not exist yet".

### 3.3 `cp_a0_intake_content_decision` — append-only relay decision

| DTO field | SQL column | SQL type | Notes |
| --- | --- | --- | --- |
| `decision_id` | `decision_id` | TEXT | PK |
| `intake_id` | `intake_id` | TEXT | FK to `cp_a0_intake_version` |
| `intake_version` | `intake_version` | INTEGER | FK part 2 |
| `request_id` | `request_id` | TEXT | The client's request id — the idempotency identity |
| `input_digest` | `input_digest` | TEXT | The **creative input closure** digest, not the brief digest |
| `choice` | `choice` | TEXT | `accept_content` / `revise_content` / `reject_content` |
| `source` | `source` | TEXT | `agent_conversation` / `driver_relay` — never `trusted_ui` |
| `source_message_ref` | `source_message_ref` | TEXT | Must be a real conversation reference |
| `authority` | `authority` | TEXT | Always `content_only`; the lane hard-codes it |
| `recorded_at` | `recorded_at` | TEXT | ISO-8601 |

**Idempotency.** `decision_id` is derived deterministically from
`(intake_id, intake_version, request_id)` — *not* from the digest or the choice. A replay
of the same request therefore lands on the same primary key, and the adapter's
append-only rule applies: identical content is a replay, different content is
`IDEMPOTENCY_CONFLICT`. Deriving the id from the content instead would let the same
request id carry two different decisions, which is exactly the "same key, different
content" case the contract says must be a 409.

### 3.4 `cp_a0_intake_confirmation` — append-only trusted confirmation

| DTO field | SQL column | SQL type | Notes |
| --- | --- | --- | --- |
| `confirmation_id` | `confirmation_id` | TEXT | PK |
| `intake_id` / `intake_version` | same | TEXT / INTEGER | FK to `cp_a0_intake_version` |
| `input_digest` | `input_digest` | TEXT | Brief digest the confirmation is bound to |
| `principal_id` | `principal_id` | TEXT | The authenticated human |
| `channel` | `channel` | TEXT | Always `trusted_ui` |
| `session_ref` | `session_ref` | TEXT | The authenticated session |
| `action` | `action` | TEXT | Always `project.create` |
| `issued_at` / `expires_at` | same | INTEGER | **Epoch seconds**, not ISO strings — the SQL column is INTEGER |

### 3.5 `cp_a0_question_version` — immutable version

| DTO field | SQL column | SQL type | Notes |
| --- | --- | --- | --- |
| `intake_id` / `intake_version` | same | TEXT / INTEGER | PK parts 1–2; FK to `cp_a0_intake_version` |
| `input_digest` | `input_digest` | TEXT | Brief digest the question is bound to; FK part 3 |
| `question_id` | `question_id` | TEXT | PK part 3 |
| `question_version` | `question_version` | INTEGER | PK part 4, `CHECK(>0)` |
| `kind` | `kind` | TEXT | `text` / `choice` |
| `skip_allowed` | `skip_allowed` | INTEGER | `0` / `1` |
| `question_json` | `question_json` | TEXT | The wire `Question`, canonical JSON |
| `created_at` | `created_at` | TEXT | ISO-8601 |

### 3.6 `cp_a0_question_head` — head

PK `(intake_id, intake_version, question_id)`; **CAS column** `current_question_version`.

### 3.7 `cp_a0_answer_version` — immutable version

| DTO field | SQL column | SQL type | Notes |
| --- | --- | --- | --- |
| `intake_id` / `intake_version` / `question_id` / `question_version` | same | TEXT/INTEGER | PK parts 1–4; FK to `cp_a0_question_version` |
| `answer_id` | `answer_id` | TEXT | `UNIQUE(answer_id, answer_version)` |
| `answer_version` | `answer_version` | INTEGER | PK part 5, `CHECK(>0)` |
| `input_digest` | `input_digest` | TEXT | Brief digest; the SQL trigger `cp_a0_answer_input_guard` re-checks it |
| `principal_id` | `principal_id` | TEXT | The authenticated session that supplied the answer |
| `channel` | `channel` | TEXT | `agent_conversation` / `driver_relay` / `trusted_ui` |
| `authority` | `authority` | TEXT | Always `content_only` |
| `skipped` | `skipped` | INTEGER | `1` only for `action = "skip"`; trigger `cp_a0_answer_skip_guard` |
| `answer_json` | `answer_json` | TEXT | The wire `QuestionAnswer`, canonical JSON |
| `recorded_at` | `recorded_at` | TEXT | ISO-8601 |

### 3.8 `cp_a0_answer_head` — head

PK `(intake_id, intake_version, question_id, question_version)`; **CAS column**
`current_answer_version`.

### 3.9 `cp_a0_template_version` / `cp_a0_template_head`

`template_version` is immutable: `template_id` (`'local-short-film'`), `version` (`1`),
`parent_version`, `execution_digest`, `capability_id`, `capability_version` (`'1'`),
`definition_json` (the wire `FixedWorkflowVersion`), `created_at`.
`template_head` has `template_id` PK and the **CAS column** `draft_version`; `published_version`
is nullable.

### 3.10 `cp_a0_artifact_version` — immutable version

| DTO field | SQL column | SQL type | Notes |
| --- | --- | --- | --- |
| `project_id` / `artifact_id` / `version` | same | TEXT / TEXT / INTEGER | PK |
| `kind` | `kind` | TEXT | `brief` / `script` / `storyboard` / `chapter` / `cover` |
| `schema_version` | `schema_version` | INTEGER | Always `1` |
| `input_digest` | `input_digest` | TEXT | The closure digest of the input the artifact was derived from |
| `content_digest` | `content_digest` | TEXT | SHA-256 of the canonical `content_json` |
| `content_json` | `content_json` | TEXT | `Brief`, `Script`, `Storyboard` or `ReviewPackage` (see below) |
| `input_refs_json` | `input_refs_json` | TEXT | The array of `Ref` |
| `created_at` | `created_at` | TEXT | ISO-8601 |

**What lives in `content_json`.** The kind decides the document shape:

| `kind` | `content_json` document |
| --- | --- |
| `brief` | the wire `Brief` |
| `script` | the wire `Script` |
| `storyboard` | the wire `Storyboard` |
| `chapter` | the wire `ReviewPackage` for a `sample`, `first_chapter`, `chapter_pack` or `audio` package |
| `cover` | the wire `ReviewPackage` for a `cover` package |

The review package document lives in the artifact store rather than in a table of its own
because the frozen schema has no `cp_a0_review_package` table, and because the package
body *is* content: it has versions, a digest and immutable inputs, exactly like a script.
`cp_a0_review_request` then points at it through `artifact_id` / `artifact_version`.

### 3.11 `cp_a0_artifact_head` — head

PK `(project_id, artifact_id)`; **CAS column** `draft_version`.

### 3.12 `cp_a0_run` — mutable state with an immutable binding

| DTO field | SQL column | Mutable? | Notes |
| --- | --- | --- | --- |
| `project_id` / `run_id` | same | no | PK |
| `run_scope_digest` | `run_scope_digest` | no | `UNIQUE(project_id, run_id, run_scope_digest)` |
| `template_id` / `template_version` | same | no | FK to `cp_a0_template_version` |
| `current_plan_version` | `current_plan_version` | no | Always `1` in A |
| `state` | `state` | **yes** | The eleven-state vocabulary |
| `scope_json` | `scope_json` | no | The wire `RunScope` |
| `checkpoint_json` | `checkpoint_json` | **yes** | The `RunCheckpoint` document (gates, attempts, packages) |
| `created_at` | `created_at` | no | ISO-8601 |

The trigger `cp_a0_run_binding_immutable` already refuses any update that changes a
binding column. The adapter must additionally refuse such an update rather than let the
trigger abort the transaction, so the lane gets a `REVISION_CONFLICT` instead of a raw
SQLite abort.

**Why the gates live in `checkpoint_json`.** `cp_a0_run_gate` does not exist in the frozen
schema, but `RunGate` is a first-class wire object and the gates are the facts that decide
whether a downstream step may be dispatched. They are therefore stored inside the run's
own checkpoint document, which is the column the schema already provides for the run's
durable step state, and they are re-read on every `workflow.run.read`. The run scope and
the checkpoint are separated by the schema on purpose: the scope is what the authorization
is bound to, the checkpoint is what the run has done.

### 3.13 `cp_a0_plan_version` — immutable version

`project_id`, `run_id`, `plan_version` (always `1`), `run_scope_digest`, `input_digest`,
`plan_json` (the `FixedPlan` document), `created_at`.
`UNIQUE(project_id, run_id, plan_version, run_scope_digest)` and an FK to `cp_a0_run`.

### 3.14 `cp_a0_review_request` — mutable state

| DTO field | SQL column | Mutable? | Notes |
| --- | --- | --- | --- |
| `project_id` / `run_id` / `review_id` | same | no | PK; `review_id` is the wire `package_id` |
| `plan_version` / `run_scope_digest` | same | no | FK to `cp_a0_plan_version` |
| `gate` | `gate` | no | `brief` / `sample` / `first_chapter` / `chapter` / `cover` / `risk` |
| `artifact_id` / `artifact_version` | same | no | FK to `cp_a0_artifact_version` — the package body |
| `input_digest` | `input_digest` | no | FK part of the decision FK |
| `package_digest` | `package_digest` | no | SHA-256 of the canonical package document |
| `state` | `state` | **yes** | `pending` / `accepted` / `changes_requested` / `rejected` / `stale` |
| `reuse_review_id` | `reuse_review_id` | no | Self FK for an explicit review reuse |
| `created_at` | `created_at` | no | ISO-8601 |

**Gate vocabulary mapping.** The wire `ReviewPackage.kind` and the SQL `gate` column do not
use the same words. The mapping is fixed and total:

| `ReviewPackage.kind` | SQL `gate` | SQL artifact `kind` |
| --- | --- | --- |
| `sample` | `sample` | `chapter` |
| `first_chapter` | `first_chapter` | `chapter` |
| `chapter_pack` | `chapter` | `chapter` |
| `audio` | `chapter` | `chapter` |
| `cover` | `cover` | `cover` |

The wire `kind` is recoverable from the stored package document, so nothing is lost.

**`review_id` is the wire `package_id`.** The wire DTO calls it `package_id` and the SQL
column calls it `review_id`; they are the same identifier, so `review.read` and
`review.decide` address the same row. The wire `ReviewPackage.version` is the artifact
version of the package body.

### 3.15 `cp_a0_content_decision` — append-only review decision

| DTO field | SQL column | Notes |
| --- | --- | --- |
| `project_id` / `run_id` / `decision_id` | same | PK |
| `review_id` | `review_id` | FK to `cp_a0_review_request` together with `input_digest` |
| `input_digest` | `input_digest` | FK part 2 |
| `channel` | `channel` | The lane writes `trusted_ui` only for a review decision |
| `actor_id` | `actor_id` | The authenticated principal |
| `choice` | `choice` | `accepted` / `changes_requested` / `rejected` |
| `source_ref` | `source_ref` | The session or request reference |
| `created_at` | `created_at` | ISO-8601 |

This is the *review* decision table. The *pre-project relay* decision lives in
`cp_a0_intake_content_decision` (§3.3). They are different facts in different tables on
purpose, exactly as the frozen SQL says.

### 3.16 `cp_a0_trusted_confirmation` — append-only

`project_id`, `run_id`, `confirmation_id` (PK), `review_id` (nullable), `input_digest`,
`purpose` (`run.authorize` / `review` / `change.approve`), `channel` (always `trusted_ui`),
`authenticated_actor`, `session_ref`, `action_digest`, `issued_at` / `expires_at` (INTEGER
epoch seconds). `CHECK(purpose='run.authorize' OR review_id IS NOT NULL)`.

**The lane does not write this table itself.** It is written by MAIN's
`TrustedAdoptionAuthority.registerConfirmation`, inside the lane's transaction. A
confirmation is the proof that a human in a trusted UI session made a call; only MAIN can
establish that, so the lane asks for it rather than asserting it.

### 3.17 `cp_a0_execution_grant` — mutable state

`project_id`, `run_id`, `grant_id` (PK), `run_scope_digest`, `confirmation_id`,
`principal_id`, `action`, `capability_id`, `capability_version`, `allow_paid` (always
`0`), `allow_external` (always `0`), `state` (mutable), `expires_at` (INTEGER epoch
seconds). The grant row is the `RunAuthorization` wire object: `authorization_id` is
`grant_id`, and `state` is shared verbatim.

### 3.18 `cp_a0_step_attempt` — mutable state

`project_id`, `run_id`, `plan_version`, `step_id`, `attempt` (PK), `run_scope_digest`,
`grant_id`, `input_digest`, `dependencies_json` (array of `Ref`), `state` (mutable),
`job_id` (nullable), `output_artifact_id` / `output_version` (nullable pair),
`updated_at`. The binding columns are immutable; the trigger
`cp_a0_attempt_binding_immutable` enforces that.

### 3.19 `cp_a0_approval` — mutable state

`project_id`, `run_id`, `approval_id` (PK), `run_scope_digest`, `confirmation_id`,
`plan_version`, `step_id`, `attempt`, `input_digest`, `change_id`, `impact_id`,
`base_revision`, `control_revision`, `action_digest`, `facts_digest`, `state` (mutable:
`active` / `consumed` / `rejected` / `revoked`), `expires_at` (INTEGER epoch seconds),
`consumed_transaction_id` (nullable).

**Wire projection.** The wire `Approval` DTO is
`{ approval_id, project_id, impact_id, plan_sha256, expires_at, state }`. The lane
projects it as:

| Wire field | SQL column |
| --- | --- |
| `approval_id` | `approval_id` |
| `project_id` | `project_id` |
| `impact_id` | `impact_id` |
| `plan_sha256` | `action_digest` |
| `expires_at` | `expires_at` (epoch seconds → ISO-8601) |
| `state` | `state` |

`facts_digest`, `change_id`, `base_revision`, `control_revision`, `confirmation_id`,
`step_id`, `attempt` and `input_digest` are internal and stay on the row. The SQL trigger
`cp_a0_approval_confirmation` requires the confirmation's `action_digest` and
`input_digest` to equal the approval's, and `cp_a0_approval_consume` requires a matching
`cp_a0_prepared_authorization` row — so the approval cannot be consumed outside MAIN's
prepared transaction.

### 3.20 `cp_a0_prepared_authorization` — append-only

`transaction_id` (PK), `project_id`, `run_id`, `approval_id`, `facts_digest`.
`UNIQUE(project_id, run_id, approval_id)`. Written by MAIN's Coordinator path when it
prepares a change; the lane only reads it.

### 3.21 `cp_a0_bootstrap_command` — the pre-project receipt

| DTO field | SQL column | Notes |
| --- | --- | --- |
| `command_id` | `command_id` | Table PK |
| `principal_id` | `principal_id` | |
| `operation` | `operation` | Always `project.create` |
| `idempotency_key` | `idempotency_key` | |
| `request_digest` | `request_digest` | SHA-256 of the canonical command body |
| `reserved_project_id` | `reserved_project_id` | `UNIQUE` — one project id per reservation |
| `state` | `state` | `reserved` / `staging` / `committed` / `compensating` / `failed` |
| `response_json` | `response_json` | The stored answer, `NULL` until it exists |

**The seam addresses this table by `UNIQUE(principal_id, operation, idempotency_key)`, not
by `command_id`.** That is the "pre-project receipt scoped principal" rule: a replay is
identified by the principal plus the operation plus the idempotency key, and the project id
it reserved is the answer. `command_id` is an internal row identity.

### 3.22 `cp_a0_project_origin` — append-only

`project_id` (PK), `origin` (always `created`), `command_id` (FK to
`cp_a0_bootstrap_command`), `intake_confirmation_id` (FK to
`cp_a0_intake_confirmation`), `intake_digest`, `initial_snapshot_id` (FK to `snapshot`),
`creation_transaction_id` (FK to `project_transaction`), `root_ref`.

### 3.23 `cp_a0_native_ack` — append-only

`project_id`, `editor_session_id`, `ack_seq` (PK triple, `CHECK(ack_seq>0)`),
`loaded_revision`, `loaded_snapshot_id` (FK to `snapshot`), `source_digest`,
`observed_at`.

### 3.24 `cp_a0_event` — read-only for the lane

`project_id`, `event_id` (PK, FK to `outbox(project_id, event_id)`), `run_id`,
`run_scope_digest` (FK to `cp_a0_run`), `source` (`host` / `worker` / `native`),
`input_digest`, `observed_at`.

---

## 4. Write semantics

| Collection kind | Collections | `put` | `compareAndSet` |
| --- | --- | --- | --- |
| `immutable_version` | `intake_version`, `question_version`, `answer_version`, `template_version`, `artifact_version`, `plan_version` | Insert only. A row that already exists with identical content is a replay (`replayed: true`). A row that exists with different content is `IDEMPOTENCY_CONFLICT`. | — |
| `append_only` | `intake_content_decision`, `intake_confirmation`, `content_decision`, `trusted_confirmation`, `prepared_authorization`, `bootstrap_command`, `project_origin`, `native_ack` | Same as above. `event` is not writable by the lane. | — |
| `head` | `intake_head`, `question_head`, `answer_head`, `template_head`, `artifact_head` | Rejected. A head is only advanced through compare-and-set. | Advances the version column from `expectedVersion` to the value's version column. `expectedVersion = 0` means the row does not exist yet. A mismatch is `REVISION_CONFLICT`. |
| `mutable_state` | `run`, `review_request`, `execution_grant`, `step_attempt`, `approval` | Replaces the mutable columns. The adapter must verify the immutable binding columns are unchanged and raise `REVISION_CONFLICT` if they are — the SQL trigger is the backstop, not the primary check. | — |

The mutable/immutable column split for the four `mutable_state` collections is the
`cp_a0_*_binding_immutable` trigger list in `migration.sql`, restated in §3.

---

## 5. Events

`tx.emit` is the only way the lane produces an event. MAIN's adapter must:

1. append one row to the authoritative `outbox` with `topic = event.topic`,
   `project_id` (the run's project for run scope, the intake id for intake scope),
   `payload_json` = the canonical event document, `created_at = event.observed_at`;
2. use the `event_id` MAIN's outbox assigned;
3. for a **run-scoped** event, insert the `cp_a0_event` mirror row with that `event_id`,
   `run_id`, `run_scope_digest`, `source`, `input_digest` and `observed_at`;
4. for an **intake-scoped** event, write no `cp_a0_event` row — `cp_a0_event` has a
   mandatory `run_id` foreign key onto `cp_a0_run`, and an intake-phase event has no run
   yet. The event still exists in the outbox, which is the authoritative queue.

The scope is a discriminated union, never an inferred field:

```ts
type ProductEventScope =
  | { kind: "run";    project_id: string; run_id: string; run_scope_digest: string; plan_version: 1 }
  | { kind: "intake"; intake_id: string; intake_version: number; brief_sha256: string };
```

The lane emits these topics: `creative.intake.versioned`, `creative.question.versioned`,
`creative.answer.recorded`, `creative.input.invalidated`,
`creative.content.decision.recorded`, `creative.artifact.versioned`,
`workflow.run.prepared`, `workflow.run.authorized`, `workflow.run.state_changed`,
`workflow.gate.changed`, `review.package.published`, `review.decision.recorded`.

`creative.input.invalidated` is emitted in the same transaction as the answer or question
write that invalidated a dependent decision. That is the "题答写入/head CAS、依赖内容决定及
准备产物的失效记录、待办outbox必须在同一DB事务完成" requirement: the invalidation and the
outbox row land together or not at all.

---

## 6. Trusted adoption

```ts
interface TrustedAdoptionAuthority {
  registerConfirmation(tx: ProductTransaction, input: TrustedConfirmationInput): TrustedConfirmationRecord;
  registerApproval(tx: ProductTransaction, input: TrustedApprovalInput): ApprovalRecord | null;
}
```

Both methods receive the lane's transaction. MAIN **must** write inside it — a post-hoc
write would leave the decision row and the approval row in different transactions, which is
the atomicity the contract requires ("同一次可信操作原子登记 ReviewDecision 与有限
Approval").

`registerApproval` returns `null` when MAIN cannot join the review transaction. The lane
then **fails `accept_and_adopt` closed** with `APPROVAL_REQUIRED`; it never reports an
adoption it could not record.

`accept` and `changes_requested` and `reject` do **not** create an approval. A pure review
decision carries `approval: null` on the wire and grants no write authority.

---

## 7. What MAIN still has to decide

These are the points where the lane made a decision that MAIN may want to change. Each is
a small, local change; none of them changes the collection union.

1. **Gate vocabulary.** The wire `ReviewPackage.kind` and the SQL `review_request.gate`
   use different words; §3.14 fixes the mapping. If MAIN prefers a different mapping, the
   `run_checkpoint` and `review_request` writers change, not the schema.
2. **Gates inside `checkpoint_json`.** There is no `cp_a0_run_gate` table in the frozen
   schema, so the wire `RunGate` objects are stored in the run's checkpoint document
   (§3.12). If MAIN wants a dedicated table, that is a schema change and therefore a
   MAIN-side decision outside this lane's allowed prefixes.
3. **The review package body lives in the artifact store** (§3.10), because the frozen
   schema has no review-package table. `review_request.artifact_id` /
   `artifact_version` point at it.
4. **Wire `Approval.plan_sha256` maps to `action_digest`** (§3.19). The lane keeps
   `facts_digest` internal.
5. **The pre-project receipt is addressed by
   `(principal_id, operation, idempotency_key)`** rather than by `command_id` (§3.21).
6. **Intake-scoped events reach the outbox but not `cp_a0_event`** (§5), because
   `cp_a0_event.run_id` is a mandatory foreign key onto `cp_a0_run`.

---

## 8. Integration checklist for MAIN

- [ ] Implement `ProductRepository.transaction` over the existing `RevisionStore` connection,
      inside one `BEGIN IMMEDIATE`; the callback is synchronous, so no `await` inside it.
- [ ] Implement `get` / `list` / `put` / `compareAndSet` per §4, including the
      append-only replay rule (identical row → replay, different row →
      `IDEMPOTENCY_CONFLICT`).
- [ ] Implement `emit` per §5, appending to the existing `outbox` and mirroring run-scoped
      events into `cp_a0_event`.
- [ ] Inject a `TrustedAdoptionAuthority` that writes `cp_a0_trusted_confirmation` and
      `cp_a0_approval` inside the passed transaction, and returns `null` from
      `registerApproval` when it cannot.
- [ ] Keep `operation_idempotency` as the project-command authority; store the lane's
      `ProductIdempotencyReceipt` there. Do not add a second command table.
- [ ] Call `guardExecution(binding, action)` before every actual side effect.
- [ ] Register the PRODUCT routes from `contracts/agent-driven-a.registry.json`; the
      business producer is PRODUCT, the registration owner is MAIN.
