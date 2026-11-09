/**
 * A test-only in-memory implementation of the PRODUCT repository seam.
 *
 * It exists **only** so the lane's own tests can exercise the services without a
 * database. It is not a production fallback: it lives under `tests/`, it is never
 * imported by `src/`, and the production composition always injects MAIN's adapter.
 *
 * It implements the seam's write semantics faithfully, because the tests are about those
 * semantics:
 *
 * - an append-only row that already exists with identical content is a replay;
 * - an append-only row that exists with different content is an idempotency conflict;
 * - a head only moves through compare-and-set;
 * - a mutable-state row may not change its immutable binding columns;
 * - the foreign keys the frozen SQL declares inside the lane's own tables are enforced,
 *   so a negative case fails for the reason the SQL would fail and not because the
 *   stub was lax;
 * - the trusted-evidence triggers are enforced: a grant needs a `run.authorize`
 *   confirmation for the same actor and scope, and an approval needs a `change.approve`
 *   confirmation for the same input and action;
 * - at most one attempt of a step may be active;
 * - a transaction that throws leaves nothing behind.
 *
 * The foreign keys that point at MAIN's own tables (`project_state`, `job`, `snapshot`,
 * `project_transaction`, `outbox`) are **not** enforced here: those tables are not in the
 * lane's repository, and pretending to enforce them would make the stub claim a
 * guarantee it cannot keep.
 */

import { canonicalJson } from "../../../../src/host/creative/digest.js";
import type {
  ProductCollection,
  ProductEvent,
  ProductEventReceipt,
  ProductHeadCollection,
  ProductIdempotencyEntry,
  ProductIdempotencyReceipt,
  ProductIdempotencyScope,
  ProductRecordKeys,
  ProductRecordScopes,
  ProductRecords,
  ProductRepository,
  ProductTransaction,
  ProductWriteOutcome,
} from "../../../../src/host/creative/product-repository.js";
import { ProductError } from "../../../../src/host/creative/trusted-context.js";

type Row = { readonly key: string; readonly value: Record<string, unknown> };

interface Store {
  readonly rows: Map<ProductCollection, Map<string, Row>>;
  readonly idempotency: Map<string, ProductIdempotencyEntry>;
  readonly events: ProductEvent[];
  eventCounter: number;
}

/**
 * The immutable columns of the mutable-state collections.
 *
 * They are the columns the frozen `cp_a0_*_binding_immutable` triggers protect.
 */
const IMMUTABLE_BINDINGS: Partial<Record<ProductCollection, readonly string[]>> = {
  run: [
    "project_id",
    "run_id",
    "run_scope_digest",
    "scope_json",
    "template_id",
    "template_version",
    "current_plan_version",
  ],
  review_request: [
    "project_id",
    "run_id",
    "review_id",
    "plan_version",
    "run_scope_digest",
    "gate",
    "artifact_id",
    "artifact_version",
    "input_digest",
    "package_digest",
    "reuse_review_id",
    "created_at",
  ],
  execution_grant: [
    "project_id",
    "run_id",
    "grant_id",
    "run_scope_digest",
    "confirmation_id",
    "principal_id",
    "action",
    "capability_id",
    "capability_version",
    "allow_paid",
    "allow_external",
    "expires_at",
  ],
  step_attempt: [
    "project_id",
    "run_id",
    "plan_version",
    "step_id",
    "attempt",
    "run_scope_digest",
    "grant_id",
    "input_digest",
    "dependencies_json",
  ],
  approval: [
    "project_id",
    "run_id",
    "approval_id",
    "run_scope_digest",
    "confirmation_id",
    "plan_version",
    "step_id",
    "attempt",
    "input_digest",
    "change_id",
    "impact_id",
    "base_revision",
    "control_revision",
    "action_digest",
    "facts_digest",
    "expires_at",
  ],
};

/** The CAS column of each head collection. */
const HEAD_VERSION_COLUMN: Partial<Record<ProductCollection, string>> = {
  intake_head: "current_version",
  question_head: "current_question_version",
  answer_head: "current_answer_version",
  template_head: "draft_version",
  artifact_head: "draft_version",
};

/**
 * The foreign keys the lane's own tables declare.
 *
 * Each rule names the parent collection and how the child's key is projected onto the
 * parent's primary key.
 */
const FOREIGN_KEYS: Partial<
  Record<ProductCollection, ReadonlyArray<{ parent: ProductCollection; project: (value: Record<string, unknown>) => Record<string, unknown> }>>
> = {
  intake_head: [{ parent: "intake_version", project: (v) => ({ intake_id: v.intake_id, version: v.current_version }) }],
  intake_content_decision: [{ parent: "intake_version", project: (v) => ({ intake_id: v.intake_id, version: v.intake_version }) }],
  intake_confirmation: [{ parent: "intake_version", project: (v) => ({ intake_id: v.intake_id, version: v.intake_version }) }],
  question_version: [{ parent: "intake_version", project: (v) => ({ intake_id: v.intake_id, version: v.intake_version }) }],
  question_head: [{ parent: "question_version", project: (v) => ({ intake_id: v.intake_id, intake_version: v.intake_version, question_id: v.question_id, question_version: v.current_question_version }) }],
  answer_version: [{ parent: "question_version", project: (v) => ({ intake_id: v.intake_id, intake_version: v.intake_version, question_id: v.question_id, question_version: v.question_version }) }],
  answer_head: [{ parent: "answer_version", project: (v) => ({ intake_id: v.intake_id, intake_version: v.intake_version, question_id: v.question_id, question_version: v.question_version, answer_version: v.current_answer_version }) }],
  template_head: [{ parent: "template_version", project: (v) => ({ template_id: v.template_id, version: v.draft_version }) }],
  artifact_head: [{ parent: "artifact_version", project: (v) => ({ project_id: v.project_id, artifact_id: v.artifact_id, version: v.draft_version }) }],
  run: [{ parent: "template_version", project: (v) => ({ template_id: v.template_id, version: v.template_version }) }],
  plan_version: [{ parent: "run", project: (v) => ({ project_id: v.project_id, run_id: v.run_id, run_scope_digest: v.run_scope_digest }) }],
  review_request: [
    { parent: "plan_version", project: (v) => ({ project_id: v.project_id, run_id: v.run_id, plan_version: v.plan_version, run_scope_digest: v.run_scope_digest }) },
    { parent: "artifact_version", project: (v) => ({ project_id: v.project_id, artifact_id: v.artifact_id, version: v.artifact_version }) },
  ],
  content_decision: [{ parent: "review_request", project: (v) => ({ project_id: v.project_id, run_id: v.run_id, review_id: v.review_id, input_digest: v.input_digest }) }],
  execution_grant: [
    { parent: "run", project: (v) => ({ project_id: v.project_id, run_id: v.run_id, run_scope_digest: v.run_scope_digest }) },
    { parent: "trusted_confirmation", project: (v) => ({ project_id: v.project_id, run_id: v.run_id, confirmation_id: v.confirmation_id }) },
  ],
  step_attempt: [
    { parent: "plan_version", project: (v) => ({ project_id: v.project_id, run_id: v.run_id, plan_version: v.plan_version, run_scope_digest: v.run_scope_digest }) },
    { parent: "execution_grant", project: (v) => ({ project_id: v.project_id, run_id: v.run_id, grant_id: v.grant_id, run_scope_digest: v.run_scope_digest }) },
  ],
  approval: [
    { parent: "run", project: (v) => ({ project_id: v.project_id, run_id: v.run_id, run_scope_digest: v.run_scope_digest }) },
    { parent: "trusted_confirmation", project: (v) => ({ project_id: v.project_id, run_id: v.run_id, confirmation_id: v.confirmation_id }) },
    { parent: "step_attempt", project: (v) => ({ project_id: v.project_id, run_id: v.run_id, plan_version: v.plan_version, step_id: v.step_id, attempt: v.attempt, input_digest: v.input_digest }) },
  ],
};

/** The attempt states the frozen unique index counts as active. */
const ACTIVE_ATTEMPT_STATES = ["pending", "running", "waiting_user", "unknown"];

/** A test-only repository. */
export class MemoryProductRepository implements ProductRepository {
  readonly #store: Store = {
    rows: new Map(),
    idempotency: new Map(),
    events: [],
    eventCounter: 0,
  };

  /** The events the lane emitted, in order. */
  get events(): readonly ProductEvent[] {
    return this.#store.events;
  }

  async transaction<T>(work: (tx: ProductTransaction) => T): Promise<T> {
    const snapshot = this.#snapshot();
    const tx = this.#transaction();
    try {
      return work(tx);
    } catch (error) {
      this.#restore(snapshot);
      throw error;
    }
  }

  #snapshot(): Store {
    const rows = new Map<ProductCollection, Map<string, Row>>();
    for (const [collection, entries] of this.#store.rows) {
      rows.set(collection, new Map(entries));
    }
    return {
      rows,
      idempotency: new Map(this.#store.idempotency),
      events: [...this.#store.events],
      eventCounter: this.#store.eventCounter,
    };
  }

  #restore(snapshot: Store): void {
    this.#store.rows.clear();
    for (const [collection, entries] of snapshot.rows) this.#store.rows.set(collection, entries);
    this.#store.idempotency.clear();
    for (const [key, entry] of snapshot.idempotency) this.#store.idempotency.set(key, entry);
    this.#store.events.length = 0;
    this.#store.events.push(...snapshot.events);
    this.#store.eventCounter = snapshot.eventCounter;
  }

  #transaction(): ProductTransaction {
    const store = this.#store;

    const rowsOf = (collection: ProductCollection): Map<string, Row> => {
      let entries = store.rows.get(collection);
      if (entries === undefined) {
        entries = new Map();
        store.rows.set(collection, entries);
      }
      return entries;
    };

    const keyOf = (key: object): string =>
      canonicalJson(
        Object.fromEntries(
          Object.entries(key as unknown as Record<string, unknown>).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        ),
      );

    const findBy = <K extends ProductCollection>(
      collection: K,
      key: Record<string, unknown>,
    ): Row | undefined => rowsOf(collection).get(keyOf(key));

    /**
     * Finds a row by its own fields, the way a SQL `WHERE` would.
     *
     * A foreign key may point at a unique index rather than at the primary key — the
     * frozen SQL does that for `cp_a0_plan_version` and `cp_a0_step_attempt` — so the
     * lookup matches the fields and not the row's key.
     */
    const findByFields = <K extends ProductCollection>(
      collection: K,
      fields: Record<string, unknown>,
    ): Row | undefined => {
      const wanted = Object.entries(fields).filter(([, value]) => value !== undefined);
      for (const row of rowsOf(collection).values()) {
        if (wanted.every(([name, value]) => row.value[name] === value)) return row;
      }
      return undefined;
    };

    const assertForeignKeys = (collection: ProductCollection, value: Record<string, unknown>): void => {
      for (const rule of FOREIGN_KEYS[collection] ?? []) {
        const parent = findByFields(rule.parent, rule.project(value));
        if (parent === undefined) {
          throw new ProductError(
            "REVISION_CONFLICT",
            `The row references a ${rule.parent} row that does not exist`,
            { details: { collection, parent: rule.parent } },
          );
        }
      }
    };

    const assertTriggers = (collection: ProductCollection, value: Record<string, unknown>): void => {
      if (collection === "answer_version") {
        const question = findByFields("question_version", {
          intake_id: value.intake_id,
          intake_version: value.intake_version,
          question_id: value.question_id,
          question_version: value.question_version,
        });
        if (question === undefined) {
          throw new ProductError("REVISION_CONFLICT", "The answer references a question that does not exist");
        }
        if (question.value.input_digest !== value.input_digest) {
          throw new ProductError("REVISION_CONFLICT", "The answer does not match the brief it names");
        }
        if (value.skipped === 1 && question.value.skip_allowed !== 1) {
          throw new ProductError("INVALID_REQUEST", "That question cannot be skipped");
        }
      }
      if (collection === "execution_grant") {
        const confirmation = findByFields("trusted_confirmation", {
          project_id: value.project_id,
          run_id: value.run_id,
          confirmation_id: value.confirmation_id,
        });
        if (confirmation === undefined) {
          throw new ProductError("REVISION_CONFLICT", "The grant references a confirmation that does not exist");
        }
        if (confirmation.value.purpose !== "run.authorize") {
          throw new ProductError("REVISION_CONFLICT", "A run grant needs a run.authorize confirmation");
        }
        if (confirmation.value.authenticated_actor !== value.principal_id) {
          throw new ProductError("REVISION_CONFLICT", "The grant actor is not the confirmed actor");
        }
        if (confirmation.value.action_digest !== value.run_scope_digest) {
          throw new ProductError("REVISION_CONFLICT", "The grant scope is not the confirmed scope");
        }
        const expiresAt = Number(value.expires_at);
        if (expiresAt > Number(confirmation.value.expires_at) || expiresAt <= Number(confirmation.value.issued_at)) {
          throw new ProductError("REVISION_CONFLICT", "The grant outlives the confirmation it names");
        }
      }
      if (collection === "approval") {
        const confirmation = findByFields("trusted_confirmation", {
          project_id: value.project_id,
          run_id: value.run_id,
          confirmation_id: value.confirmation_id,
        });
        if (confirmation === undefined) {
          throw new ProductError("REVISION_CONFLICT", "The approval references a confirmation that does not exist");
        }
        if (confirmation.value.purpose !== "change.approve") {
          throw new ProductError("REVISION_CONFLICT", "An approval needs a change.approve confirmation");
        }
        if (confirmation.value.input_digest !== value.input_digest) {
          throw new ProductError("REVISION_CONFLICT", "The approval input is not the confirmed input");
        }
        if (confirmation.value.action_digest !== value.action_digest) {
          throw new ProductError("REVISION_CONFLICT", "The approval action is not the confirmed action");
        }
        const expiresAt = Number(value.expires_at);
        if (expiresAt > Number(confirmation.value.expires_at) || expiresAt <= Number(confirmation.value.issued_at)) {
          throw new ProductError("REVISION_CONFLICT", "The approval outlives the confirmation it names");
        }
      }
      if (collection === "step_attempt") {
        const active = rowsOf("step_attempt").values().filter((row) =>
          row.value.project_id === value.project_id &&
          row.value.run_id === value.run_id &&
          row.value.plan_version === value.plan_version &&
          row.value.step_id === value.step_id &&
          row.value.attempt !== value.attempt &&
          ACTIVE_ATTEMPT_STATES.includes(String(row.value.state)),
        );
        if (active.length > 0) {
          throw new ProductError("REVISION_CONFLICT", "Another attempt of this step is still active");
        }
      }
    };

    const tx: ProductTransaction = {
      get<K extends ProductCollection>(
        collection: K,
        key: ProductRecordKeys[K],
      ): ProductRecords[K] | null {
        const row = findBy(collection, key as unknown as Record<string, unknown>);
        return row === undefined ? null : (row.value as unknown as ProductRecords[K]);
      },

      /**
       * Lists the rows whose own fields match the scope.
       *
       * The scope is a set of table columns, not a key prefix: the intake confirmation
       * is addressed by `intake_id` even though its primary key is the confirmation id.
       */
      list<K extends ProductCollection>(
        collection: K,
        scope: ProductRecordScopes[K],
      ): ProductRecords[K][] {
        const wanted = Object.entries(scope as unknown as Record<string, unknown>)
          .filter(([, value]) => value !== undefined)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
        const result: ProductRecords[K][] = [];
        for (const row of rowsOf(collection).values()) {
          const matches = wanted.every(([name, value]) => row.value[name] === value);
          if (matches) result.push(row.value as unknown as ProductRecords[K]);
        }
        return result;
      },

      put<K extends ProductCollection>(
        collection: K,
        key: ProductRecordKeys[K],
        value: ProductRecords[K],
      ): ProductWriteOutcome<K> {
        const spec = SPECS[collection];
        if (spec.kind === "head") {
          throw new ProductError("INVALID_REQUEST", "A head is advanced by compare-and-set");
        }
        if (!spec.writable) {
          throw new ProductError("INVALID_REQUEST", "This collection is read-only for the lane");
        }
        const record = value as unknown as Record<string, unknown>;
        const entries = rowsOf(collection);
        const keyString = keyOf(key as unknown as object);
        const existing = entries.get(keyString);

        if (existing !== undefined) {
          if (spec.kind === "mutable_state") {
            // A mutable-state row is updated in place; only its binding columns are
            // frozen. An update that changes one of them is a conflict, not a silent
            // rewrite.
            const bindings = IMMUTABLE_BINDINGS[collection] ?? [];
            for (const column of bindings) {
              if (canonicalJson(existing.value[column]) !== canonicalJson(record[column])) {
                throw new ProductError(
                  "REVISION_CONFLICT",
                  "The binding columns of this row are immutable",
                  { details: { column } },
                );
              }
            }
            assertForeignKeys(collection, record);
            assertTriggers(collection, record);
            entries.set(keyString, { key: keyString, value: record });
            return { record: value, replayed: canonicalJson(existing.value) === canonicalJson(record) };
          }
          if (canonicalJson(existing.value) === canonicalJson(record)) {
            return { record: existing.value as unknown as ProductRecords[K], replayed: true };
          }
          throw new ProductError(
            "IDEMPOTENCY_CONFLICT",
            "This key was already used with different content",
          );
        }

        assertForeignKeys(collection, record);
        assertTriggers(collection, record);
        entries.set(keyString, { key: keyString, value: record });
        return { record: value, replayed: false };
      },

      compareAndSet<K extends ProductHeadCollection>(
        collection: K,
        key: ProductRecordKeys[K],
        expectedVersion: number,
        value: ProductRecords[K],
      ): ProductWriteOutcome<K> {
        const versionColumn = HEAD_VERSION_COLUMN[collection];
        if (versionColumn === undefined) {
          throw new ProductError("INVALID_REQUEST", "This collection has no version column");
        }
        const entries = rowsOf(collection);
        const keyString = keyOf(key as unknown as object);
        const existing = entries.get(keyString);
        const current = existing === undefined
          ? 0
          : Number(existing.value[versionColumn]);
        if (current !== expectedVersion) {
          throw new ProductError("REVISION_CONFLICT", "The head moved since it was read", {
            details: { expected: expectedVersion, actual: current },
          });
        }
        const record = value as unknown as Record<string, unknown>;
        assertForeignKeys(collection, record);
        entries.set(keyString, { key: keyString, value: record });
        return { record: value, replayed: false };
      },

      recallIdempotency(
        scope: ProductIdempotencyScope,
        operation: string,
        idempotencyKey: string,
      ): ProductIdempotencyEntry | null {
        return store.idempotency.get(idempotencyKeyOf(scope, operation, idempotencyKey)) ?? null;
      },

      recordIdempotency(
        scope: ProductIdempotencyScope,
        operation: string,
        idempotencyKey: string,
        receipt: ProductIdempotencyReceipt,
        response: unknown,
      ): void {
        store.idempotency.set(idempotencyKeyOf(scope, operation, idempotencyKey), { receipt, response });
      },

      emit(event: ProductEvent): ProductEventReceipt {
        store.eventCounter += 1;
        store.events.push(event);
        return { event_id: store.eventCounter, topic: event.topic, observed_at: event.observed_at };
      },
    };
    return tx;
  }
}

function idempotencyKeyOf(
  scope: ProductIdempotencyScope,
  operation: string,
  idempotencyKey: string,
): string {
  const scopePart = scope.kind === "project"
    ? `project:${scope.project_id}`
    : `principal:${scope.principal_id}`;
  return `${scopePart}|${operation}|${idempotencyKey}`;
}

/** The collection specs, mirrored so the test repository does not import the runtime map. */
const SPECS: Record<ProductCollection, { kind: string; writable: boolean }> = {
  intake_version: { kind: "immutable_version", writable: true },
  intake_head: { kind: "head", writable: true },
  intake_content_decision: { kind: "append_only", writable: true },
  intake_confirmation: { kind: "append_only", writable: true },
  question_version: { kind: "immutable_version", writable: true },
  question_head: { kind: "head", writable: true },
  answer_version: { kind: "immutable_version", writable: true },
  answer_head: { kind: "head", writable: true },
  template_version: { kind: "immutable_version", writable: true },
  template_head: { kind: "head", writable: true },
  artifact_version: { kind: "immutable_version", writable: true },
  artifact_head: { kind: "head", writable: true },
  run: { kind: "mutable_state", writable: true },
  plan_version: { kind: "immutable_version", writable: true },
  review_request: { kind: "mutable_state", writable: true },
  content_decision: { kind: "append_only", writable: true },
  trusted_confirmation: { kind: "append_only", writable: true },
  execution_grant: { kind: "mutable_state", writable: true },
  step_attempt: { kind: "mutable_state", writable: true },
  approval: { kind: "mutable_state", writable: true },
  prepared_authorization: { kind: "append_only", writable: true },
  bootstrap_command: { kind: "append_only", writable: true },
  project_origin: { kind: "append_only", writable: true },
  native_ack: { kind: "append_only", writable: true },
  event: { kind: "append_only", writable: false },
};
