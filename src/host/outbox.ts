import type { RevisionStore } from "./projects/revision-store.js";

/**
 * Outbox (`03_M2_M4_MODULE_DESIGN.md` §2.5).
 *
 * A commit and its outbox row are written in one transaction. Delivery is at least once
 * from the store's point of view and at most once from the consumer's: a consumer that
 * already acknowledged an event is skipped before its handler runs, and an event is marked
 * delivered only once every registered consumer has acknowledged it.
 *
 * Replaying an outbox never re-runs a commit. The commit already happened; the outbox only
 * tells consumers something they had not seen yet.
 */

export const MAX_OUTBOX_ATTEMPTS = 20;

export type OutboxHandler = (eventId: number, payload: unknown) => Promise<void> | void;

export interface OutboxDeliveryReport {
  readonly considered: number;
  readonly delivered: number;
  readonly skipped: number;
  readonly failed: number;
  readonly abandoned: ReadonlyArray<{ event_id: number; topic: string; consumer: string }>;
}

interface Registration { consumer: string; handler: OutboxHandler }

export class Outbox {
  readonly #store: RevisionStore;
  readonly #registrations = new Map<string, Registration[]>();

  constructor(store: RevisionStore) { this.#store = store; }

  /** Composition-time registration. Nothing here comes from a request or from the database. */
  register(topic: string, consumer: string, handler: OutboxHandler): void {
    const existing = this.#registrations.get(topic) ?? [];
    if (existing.some((entry) => entry.consumer === consumer)) {
      throw new Error(`OUTBOX_CONSUMER_ALREADY_REGISTERED:${topic}:${consumer}`);
    }
    existing.push({ consumer, handler });
    this.#registrations.set(topic, existing);
  }

  consumers(topic: string): string[] {
    return (this.#registrations.get(topic) ?? []).map((entry) => entry.consumer);
  }

  /**
   * Deliver everything undelivered, oldest event first. A consumer that already
   * acknowledged an event is skipped before its handler runs, so a retry after a partial
   * failure does not repeat the work it already did.
   */
  async replay(now = new Date()): Promise<OutboxDeliveryReport> {
    let delivered = 0;
    let skipped = 0;
    let failed = 0;
    let considered = 0;
    const abandoned: Array<{ event_id: number; topic: string; consumer: string }> = [];

    for (const event of this.#store.undeliveredOutbox()) {
      const registrations = this.#registrations.get(event.topic) ?? [];
      if (registrations.length === 0) continue;
      considered += 1;
      let payload: unknown;
      try { payload = JSON.parse(event.payload_json) as unknown; } catch { payload = event.payload_json; }

      for (const registration of registrations) {
        if (this.#store.consumerAlreadySaw(event.event_id, registration.consumer)) {
          skipped += 1;
          continue;
        }
        try {
          await registration.handler(event.event_id, payload);
          this.#store.recordDelivery(event.event_id, registration.consumer, registrations.length, now);
          delivered += 1;
        } catch {
          // The delivery is NOT recorded, so the next pass tries again. `attempts` is the
          // observable signal; the ceiling is what eventually stops the retrying, and it
          // raises attention rather than dropping the event silently.
          failed += 1;
          this.#store.countOutboxAttempt(event.event_id);
          if (this.#store.outboxAttempts(event.event_id) >= MAX_OUTBOX_ATTEMPTS) {
            this.#store.abandonOutbox(event.event_id,
              `${event.topic}/${registration.consumer} exceeded ${MAX_OUTBOX_ATTEMPTS} attempts`, now);
            abandoned.push({ event_id: event.event_id, topic: event.topic, consumer: registration.consumer });
          }
        }
      }
    }
    return { considered, delivered, skipped, failed, abandoned };
  }

  /** Replay is driven by a timer; the interval is injectable so tests need not wait. */
  start(intervalMs: number): () => void {
    const timer = setInterval(() => { void this.replay(); }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }
}
