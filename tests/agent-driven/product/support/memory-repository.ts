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
 * - a transaction that throws leaves nothing behind.
 */

import { canonicalJson } from "../../../../src/host/creative/digest.js";
import type {
  ProductCollection,
  ProductEvent,
  ProductEventReceipt,
  ProductIdempotencyEntry,
  ProductIdempotencyReceipt,
  ProductIdempotencyScope,
  ProductRecordKeys,
  ProductRecordScopes,
  ProductHeadCollection,
  ProductRecords,
  ProductRepository,
  ProductTransaction,
  ProductWriteOutcome,
} from "../../../../src/host/creative/product-repository.js";
import { ProductError } from "../../../../src/host/creative/trusted-context.js";

type Row = { readonly key: string; readonly value: unknown };

const IMMUTABLE_BINDINGS: Partial<Record<ProductCollection, readonly string[]>> = {
  run: ["project_id", "run_id", "run_scope_digest", "scope_json", "template_id", "template_version", "current_plan_version"],
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

const HEAD_VERSION_COLUMN: Partial<Record<ProductCollection, string>> = {
  intake_head: "current_version",
  question_head: "current_question_version",
  answer_head: "current_answer_version",
  template_head: "draft_version",
  artifact_head: "draft_version",
};

interface Store {
  readonly rows: Map<ProductCollection, Map<string, Row>>;
  readonly idempotency: Map<string, ProductIdempotencyEntry>;
  readonly events: ProductEvent[];
  eventCounter: number;
}

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
    const keyOf = (collection: ProductCollection, key: object): string =>
      canonicalJson(
        Object.fromEntries(
          Object.entries(key as unknown as Record<string, unknown>).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        ),
      );

    const tx: ProductTransaction = {
      get<K extends ProductCollection>(
        collection: K,
        key: ProductRecordKeys[K],
      ): ProductRecords[K] | null {
        const row = rowsOf(collection).get(keyOf(collection, key));
        return row === undefined ? null : (row.value as ProductRecords[K]);
      },

      list<K extends ProductCollection>(
        collection: K,
        scope: ProductRecordScopes[K],
      ): ProductRecords[K][] {
        const wanted = Object.entries(scope as unknown as Record<string, unknown>)
          .filter(([, value]) => value !== undefined)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
        const result: ProductRecords[K][] = [];
        for (const row of rowsOf(collection).values()) {
          const stored = JSON.parse(row.key) as Record<string, unknown>;
          const matches = wanted.every(([name, value]) => stored[name] === value);
          if (matches) result.push(row.value as ProductRecords[K]);
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
        const entries = rowsOf(collection);
        const keyString = keyOf(collection, key);
        const existing = entries.get(keyString);
        if (existing !== undefined) {
          if (canonicalJson(existing.value) === canonicalJson(value)) {
            return { record: existing.value as ProductRecords[K], replayed: true };
          }
          throw new ProductError(
            "IDEMPOTENCY_CONFLICT",
            "This key was already used with different content",
          );
        }
        if (spec.kind === "mutable_state") {
          const bindings = IMMUTABLE_BINDINGS[collection] ?? [];
          const previous = [...entries.values()].find((row) => samePrimaryKey(row.key, keyString));
          if (previous !== undefined) {
            const before = previous.value as Record<string, unknown>;
            const after = value as unknown as Record<string, unknown>;
            for (const column of bindings) {
              if (canonicalJson(before[column]) !== canonicalJson(after[column])) {
                throw new ProductError(
                  "REVISION_CONFLICT",
                  "The binding columns of this row are immutable",
                  { details: { column } },
                );
              }
            }
          }
        }
        entries.set(keyString, { key: keyString, value });
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
        const keyString = keyOf(collection, key);
        const existing = entries.get(keyString);
        const current = existing === undefined
          ? 0
          : Number((existing.value as Record<string, unknown>)[versionColumn]);
        if (current !== expectedVersion) {
          throw new ProductError("REVISION_CONFLICT", "The head moved since it was read", {
            details: { expected: expectedVersion, actual: current },
          });
        }
        entries.set(keyString, { key: keyString, value });
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

/**
 * True when two keys address the same row.
 *
 * The key is the canonical JSON of the primary key columns, so the comparison has to be
 * on the parsed object rather than on the text: the two may order their columns
 * differently.
 */
function samePrimaryKey(left: string, right: string): boolean {
  return canonicalJson(JSON.parse(left)) === canonicalJson(JSON.parse(right));
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
