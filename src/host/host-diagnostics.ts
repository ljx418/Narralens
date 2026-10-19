import { createHash } from "node:crypto";

/**
 * Host-side diagnostics for failures a client must not see (INFRA-RISK-W2-001).
 *
 * `normalizeError` deliberately turns every unexpected failure into a bare
 * `500 INTERNAL_ERROR` so no path, command line or credential can leak. That is the right
 * behaviour for a response body and the wrong one for diagnosing a test: an intermittent
 * Host 500 during a parallel run was unattributable, because by the time anyone looked at
 * the failure the only record was "Internal host error".
 *
 * So this is a bounded ring on the Host, not a response field. It records what a responder
 * can act on — the correlation id the client already holds, the stage that was running, the
 * error's class and a digest of its message — and deliberately *not* the message itself,
 * the stack, or any path. A digest is enough to tell "the same failure twice" from "a
 * different one", which is the question a flaky run actually raises, without reproducing
 * the sensitive text.
 *
 * It is not a log and not an audit trail. It is bounded, in memory, and gone when the Host
 * exits.
 */

export interface FailureDiagnostic {
  readonly correlation_id: string;
  /** Coarse stage label, e.g. `route`, `migration.execute`, `listen`. Never a path. */
  readonly stage: string;
  /** The error constructor name, e.g. `RangeError`, `HttpError`. */
  readonly kind: string;
  /** SHA-256 of the message. Same digest means the same underlying failure. */
  readonly message_sha256: string;
  /** Length of the message, so "empty" and "huge" are distinguishable. */
  readonly message_length: number;
  readonly at: string;
}

export class HostDiagnostics {
  readonly #entries: FailureDiagnostic[] = [];
  readonly #limit: number;

  constructor(limit = 64) {
    this.#limit = limit;
  }

  /** Records a failure. Never throws: a diagnostic failure must not become the failure. */
  record(input: { correlationId: string; stage: string; error: unknown; now?: Date }): void {
    try {
      const error = input.error;
      const message = error instanceof Error ? error.message : String(error);
      const kind = error instanceof Error ? error.constructor.name : typeof error;
      this.#entries.push({
        correlation_id: input.correlationId,
        stage: input.stage,
        kind,
        message_sha256: createHash("sha256").update(message).digest("hex"),
        message_length: message.length,
        at: (input.now ?? new Date()).toISOString(),
      });
      while (this.#entries.length > this.#limit) this.#entries.shift();
    } catch { /* a diagnostic must never mask the failure it describes */ }
  }

  /** Newest first. */
  recent(limit = this.#entries.length): readonly FailureDiagnostic[] {
    return this.#entries.slice(-Math.max(0, limit)).reverse();
  }

  /** The most recent failure matching a correlation id the client was given. */
  byCorrelationId(correlationId: string): FailureDiagnostic | undefined {
    return this.#entries.find((entry) => entry.correlation_id === correlationId);
  }

  clear(): void { this.#entries.length = 0; }
}
