interface SemaphoreWaiter {
  resolve(release: () => void): void;
  reject(error: Error): void;
  signal: AbortSignal | undefined;
  abortHandler: (() => void) | undefined;
  /**
   * Internal fairness lane. Waiters are grouped by lane; admission round-robins
   * between non-empty lanes and is strict FIFO within a lane. The default lane
   * keeps existing callers on the original global-FIFO behaviour. Lane idents
   * are never exposed in agent records or provider schemas.
   */
  lane: string;
}

/**
 * Bounded promise gate with lane-aware fair admission.
 *
 * - `limit` is an absolute bound on concurrently granted permits, regardless of
 *   how many lanes are competing, so this remains a true global `maxConcurrent`.
 * - When capacity frees, the next permit goes to the oldest waiter of the lane
 *   that is currently waiting longest (round-robin over non-empty lanes).
 * - A single caller using only the default lane observes strict FIFO, so the
 *   semantics existing callers relied on are unchanged.
 */
export class Semaphore {
  #active = 0;
  readonly #waiters = new Map<string, SemaphoreWaiter[]>();
  #laneCursor = 0;

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Semaphore limit must be positive");
  }

  acquire(signal?: AbortSignal, lane = "default"): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new Error("Operation aborted"));
    if (this.#active < this.limit) {
      this.#active++;
      return Promise.resolve(this.#releaseFunction());
    }
    return new Promise((resolve, reject) => {
      const waiter: SemaphoreWaiter = {
        resolve,
        reject,
        signal,
        abortHandler: undefined,
        lane,
      };
      if (signal) {
        waiter.abortHandler = () => {
          this.#dropWaiter(waiter);
          reject(new Error("Operation aborted"));
        };
        signal.addEventListener("abort", waiter.abortHandler, { once: true });
      }
      this.#enqueue(waiter);
    });
  }

  #enqueue(waiter: SemaphoreWaiter): void {
    let bucket = this.#waiters.get(waiter.lane);
    if (!bucket) {
      bucket = [];
      this.#waiters.set(waiter.lane, bucket);
    }
    bucket.push(waiter);
  }

  #dropWaiter(waiter: SemaphoreWaiter): void {
    if (waiter.abortHandler && waiter.signal) {
      waiter.signal.removeEventListener("abort", waiter.abortHandler);
      waiter.abortHandler = undefined;
    }
    const bucket = this.#waiters.get(waiter.lane);
    if (!bucket) return;
    const index = bucket.indexOf(waiter);
    if (index >= 0) bucket.splice(index, 1);
    if (bucket.length === 0) this.#waiters.delete(waiter.lane);
  }

  #nextLane(): string | undefined {
    const lanes = Array.from(this.#waiters.keys());
    if (lanes.length === 0) return undefined;
    const index = this.#laneCursor % lanes.length;
    this.#laneCursor = index + 1;
    return lanes[index];
  }

  #releaseFunction(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const lane = this.#nextLane();
      if (lane !== undefined) {
        const bucket = this.#waiters.get(lane);
        if (bucket && bucket.length > 0) {
          const waiter = bucket.shift()!;
          if (bucket.length === 0) this.#waiters.delete(lane);
          if (waiter.abortHandler && waiter.signal) {
            waiter.signal.removeEventListener("abort", waiter.abortHandler);
          }
          waiter.resolve(this.#releaseFunction());
          return;
        }
        // Stale empty lane (shouldn't happen); ignore and re-check.
      }
      this.#active--;
    };
  }
}