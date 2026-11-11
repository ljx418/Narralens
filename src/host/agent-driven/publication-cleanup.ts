import {ProductError} from '../creative/trusted-context.js';

/** Private runtime cleanup bookkeeping. This grants no source or commit authority. */
export interface PublicationCleanupResource {
  readonly identity: object;
  readonly close: () => void;
}
interface Action { readonly close: () => void; done: boolean; readonly faults: Set<unknown>; }
interface Entry {
  readonly actions: Map<object, Action>;
  readonly faults: Set<unknown>;
}
export class PublicationCleanupError extends ProductError {
  readonly requires_reconciliation = true;
  readonly errors: readonly unknown[];
  constructor(errors: readonly unknown[]) {
    super('CAPABILITY_UNAVAILABLE', 'Publication resource cleanup requires reconciliation', {retryable:false});
    this.name = 'PublicationCleanupError';
    this.errors = Object.freeze([...errors]);
    Object.defineProperty(this, 'errors', {enumerable:false});
  }
}
/** Retains uncertain failures even if a later idempotent close returns normally.
 * Never retries numeric descriptors; only the original resource object's operation. */
export class PublicationCleanup {
  readonly #entries = new Map<object, Entry>();
  readonly #resources = new WeakMap<object, Action>();
  #entry(owner: object): Entry {
    let entry = this.#entries.get(owner);
    if (!entry) { entry = { actions: new Map(), faults: new Set() }; this.#entries.set(owner, entry); }
    return entry;
  }
  register(owner: object, resources: readonly PublicationCleanupResource[]): void {
    if (!resources.length) return;
    const entry = this.#entry(owner);
    for (const resource of resources) if (!entry.actions.has(resource.identity)) {
      let action = this.#resources.get(resource.identity);
      if (!action) { action = { close: resource.close, done: false, faults: new Set() }; this.#resources.set(resource.identity, action); }
      entry.actions.set(resource.identity, action);
    }
  }
  recordFailure(owner: object, error: unknown): void { this.#entry(owner).faults.add(error); }
  owners(): readonly object[] { return [...this.#entries.keys()]; }
  run(owner: object): void {
    const entry = this.#entries.get(owner);
    if (!entry) return;
    for (const action of entry.actions.values()) {
      if (!action.done) try {
        const result: unknown = action.close();
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          void Promise.resolve(result).catch(() => undefined);
          throw new TypeError('Publication resource cleanup must settle synchronously');
        }
        action.done = true;
      } catch (error) { action.faults.add(error); }
      for (const error of action.faults) entry.faults.add(error);
    }
    if (entry.faults.size) throw new PublicationCleanupError([...entry.faults]);
    this.#entries.delete(owner);
  }
  drain(): void {
    const faults = new Set<unknown>();
    for (const owner of this.owners()) {
      try { this.run(owner); }
      catch (error) {
        if (error instanceof PublicationCleanupError) for (const cause of error.errors) faults.add(cause);
        else faults.add(error);
      }
    }
    if (faults.size) throw new PublicationCleanupError([...faults]);
  }
}
