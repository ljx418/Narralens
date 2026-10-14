export interface ProjectOperationQueue {
  run<T>(projectId: string, operation: () => Promise<T>): Promise<T>;
}

export class InMemoryProjectOperationQueue implements ProjectOperationQueue {
  readonly #tails = new Map<string, Promise<void>>();

  run<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(projectId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(operation);
    const tail = task.then(() => undefined, () => undefined);
    this.#tails.set(projectId, tail);
    void tail.finally(() => {
      if (this.#tails.get(projectId) === tail) this.#tails.delete(projectId);
    });
    return task;
  }
}
