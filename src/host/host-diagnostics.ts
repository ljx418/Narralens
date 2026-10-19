import { createHash } from "node:crypto";

/**
 * Host-side diagnostics for failures a client must not see (INFRA-RISK-W2-001).
 *
 * `normalizeError` deliberately turns every unexpected failure into a bare
 * `500 INTERNAL_ERROR` so no path, command line or credential can leak. That is the right
 * behaviour for a response body and the wrong one for diagnosing a test.
 *
 * INFRA-RISK-W2-001 is what this exists for. The intermittent Host 500 during a parallel
 * full run was unattributable: the only record was "Internal host error". With a digest
 * alone it was still unattributable — the digest proved *which* failure but not *what* it
 * was, and identifying it by re-running until it recurred is the re-rolling this channel
 * exists to stop. Redaction closed it on the third reproduction:
 * `stage=route kind=Error message=ENOMEM: not enough memory, read`.
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
  /**
   * The message with paths, URLs, tokens and command lines replaced by placeholders.
   *
   * A digest alone was not enough: it tells two failures apart and nothing else. An
   * intermittent `500` whose only record was `kind=Error message_sha256=3623d37b…` could
   * not be attributed to anything, so attributing it meant re-running until it recurred —
   * precisely the re-rolling this channel exists to stop. Redaction keeps the sentence that
   * identifies the failure while refusing to store what must not be kept.
   */
  readonly message_redacted: string;
  /**
   * Structured facts about the failure, when the caller has them.
   *
   * A reason without the row it happened to is not actionable: "the materialization went
   * stale" says nothing about *which* one, on which attempt, under which lease, and at
   * which boundary. These are identifiers and short labels, never payloads.
   */
  readonly context?: Readonly<Record<string, string>>;
  readonly at: string;
}

/** A path with at least two segments, so `/tmp` alone is not noisy but `/a/b` is. */
const ABSOLUTE_PATH = /(?:[A-Za-z]:[\\/]|\/)[^\s'"`,;:()\[\]]*[^\s'"`,;:()\[\]\s]/gu;
const URL_LIKE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`]+/giu;
/** Long opaque runs: API keys, tokens, digests pasted into a message. */
const OPAQUE_TOKEN = /\b[A-Za-z0-9_-]{24,}\b/gu;
const CONTROLLED_TOKEN = /\b(?:sk|pk)-[A-Za-z0-9_-]{8,}\b/gu;
const REDACTED_MESSAGE_LIMIT = 400;

/**
 * Removes what must not be stored, keeps what identifies the failure.
 *
 * Order matters: URLs are removed before paths so a URL's `//host/path` is not left half
 * rewritten, and long opaque runs last so a path that survived as `<path>/deep/...` has its
 * remaining segments collapsed too.
 */
export function redact(message: string): string {
  const withoutUrls = message.replace(URL_LIKE, "<url>");
  const withoutPaths = withoutUrls.replace(ABSOLUTE_PATH, "<path>");
  const withoutTokens = withoutPaths
    .replace(CONTROLLED_TOKEN, "<redacted>")
    .replace(OPAQUE_TOKEN, "<redacted>");
  return withoutTokens.length > REDACTED_MESSAGE_LIMIT
    ? `${withoutTokens.slice(0, REDACTED_MESSAGE_LIMIT)}…`
    : withoutTokens;
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
        message_redacted: redact(message),
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
