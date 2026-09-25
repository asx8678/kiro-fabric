interface Job<T> { maintenance: boolean; run(): Promise<T>; signal: AbortSignal; resolve(value: T): void; reject(error: unknown): void; cancel(): void }
/** Independent analysis queue: never holds a local write reservation. Queued
 * cancellation removes admission immediately; active jobs settle their worker. */
export class FoveaScheduler {
  readonly #queue: Job<unknown>[] = [];
  #active = false;
  #closed = false;
  get busy(): boolean { return this.#active || this.#queue.length > 0 || this.#closed; }
  run<T>(signal: AbortSignal, operation: () => Promise<T>, maintenance = false): Promise<T> {
    signal.throwIfAborted();
    // Reserve bounded lifecycle admission: a full analysis queue cannot prevent revocation cleanup.
    if (this.#closed || this.#queue.filter(job => job.maintenance === maintenance).length >= (maintenance ? 128 : 16)) return Promise.reject(new Error("Navigator analysis queue unavailable/full"));
    return new Promise<T>((resolve, reject) => {
      const job: Job<unknown> = { maintenance, signal, run: operation, resolve: value => resolve(value as T), reject, cancel: () => {
        const index = this.#queue.indexOf(job); if (index < 0) return;
        this.#queue.splice(index, 1); signal.removeEventListener("abort", job.cancel); reject(signal.reason ?? new Error("Navigator queued request cancelled"));
      } };
      this.#queue.push(job); signal.addEventListener("abort", job.cancel, { once: true }); this.#pump();
    });
  }
  close(): void { this.#closed = true; for (const job of this.#queue.splice(0)) { job.signal.removeEventListener("abort", job.cancel); job.reject(new Error("Navigator host closed")); } }
  #pump(): void {
    if (this.#active) return;
    const job = this.#queue.shift(); if (!job) return;
    job.signal.removeEventListener("abort", job.cancel); this.#active = true;
    void (async () => { job.signal.throwIfAborted(); return job.run(); })().then(job.resolve, job.reject).finally(() => { this.#active = false; this.#pump(); });
  }
}
