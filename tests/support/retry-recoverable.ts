/**
 * Retry only Host failures that explicitly say the machine condition is recoverable.
 *
 * A pinned-checkout verification that could not run is different from one that ran and
 * found modifications. The former may be retried a bounded number of times; the latter
 * must remain a hard failure so a dirty dependency can never be accepted by repetition.
 */
export async function retryRecoverable<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      const code = (error as { code?: string }).code;
      const details = (error as { details?: { recoverable?: boolean } }).details;
      const message = error instanceof Error ? error.message : String(error);
      const unverifiable = code === "ENGINE_UNAVAILABLE"
        && message.includes("cannot verify that the pinned OpenFilm checkout is clean");
      const recoverable = (code === "HOST_RESOURCE_EXHAUSTED" && details?.recoverable !== false)
        || unverifiable;
      if (!recoverable || attempt === attempts - 1) throw error;
      last = error;
      await new Promise((done) => setTimeout(done, 500 * (attempt + 1)));
    }
  }
  throw last;
}
