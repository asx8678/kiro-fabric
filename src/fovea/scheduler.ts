interface Job<T> { run(): Promise<T>; signal: AbortSignal; resolve(value: T): void; reject(error: unknown): void; cancel(): void }
/** Independent analysis queue: never holds a local write reservation. Queued
 * cancellation removes admission immediately; active jobs settle their worker. */
export class FoveaScheduler {
  readonly #queue: Job<unknown>[] = [];
  #active = false;
  #closed = false;
  get busy(): boolean { return this.#active || this.#queue.length > 0 || this.#closed; }
  run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (this.#closed || this.#queue.length >= 16) return Promise.reject(new Error("Fovea analysis queue unavailable/full"));
    return new Promise<T>((resolve, reject) => {
      const job: Job<unknown> = { signal, run: operation, resolve: value => resolve(value as T), reject, cancel: () => {
        const index = this.#queue.indexOf(job); if (index < 0) return;
        this.#queue.splice(index, 1); signal.removeEventListener("abort", job.cancel); reject(signal.reason ?? new Error("Fovea queued request cancelled"));
      } };
      this.#queue.push(job); signal.addEventListener("abort", job.cancel, { once: true }); this.#pump();
    });
  }
  close(): void { this.#closed = true; for (const job of this.#queue.splice(0)) { job.signal.removeEventListener("abort", job.cancel); job.reject(new Error("Fovea host closed")); } }
  #pump(): void {
    if (this.#active) return;
    const job = this.#queue.shift(); if (!job) return;
    job.signal.removeEventListener("abort", job.cancel); this.#active = true;
    void (async () => { job.signal.throwIfAborted(); return job.run(); })().then(job.resolve, job.reject).finally(() => { this.#active = false; this.#pump(); });
  }
}
