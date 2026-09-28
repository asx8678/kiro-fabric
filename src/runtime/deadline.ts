import { performance } from "node:perf_hooks";

/** Host-only monotonic deadline shared by the sandbox and every provider call. */
export class FabricDeadline {
  readonly startedAt: number;
  readonly maximumAt: number;
  #expiresAt: number;

  constructor(timeoutMs: number, maximumMs: number, readonly now: () => number = () => performance.now(), private readonly sharedState?: BigInt64Array) {
    const sharedExpiry = sharedState === undefined ? 0n : Atomics.load(sharedState, 1);
    this.startedAt = sharedState === undefined ? now() : sharedExpiry === 0n ? Math.floor(now() * 1_000) / 1_000 : Number(Atomics.load(sharedState, 0)) / 1_000;
    const maximum = Math.max(1, Math.floor(maximumMs));
    this.maximumAt = this.startedAt + maximum;
    this.#expiresAt = this.startedAt + Math.min(maximum, Math.max(1, Math.floor(timeoutMs)));
    if (sharedState !== undefined && sharedExpiry === 0n) {
      Atomics.store(sharedState, 0, BigInt(Math.round(this.startedAt * 1_000)));
      Atomics.store(sharedState, 1, BigInt(Math.round(this.#expiresAt * 1_000)));
    }
  }

  get expiresAt(): number { return this.sharedState === undefined ? this.#expiresAt : Number(Atomics.load(this.sharedState, 1)) / 1_000; }
  get effectiveTimeoutMs(): number { return Math.round(this.expiresAt - this.startedAt); }
  get expired(): boolean { return this.now() >= this.expiresAt; }
  remainingMs(): number { return Math.max(0, this.expiresAt - this.now()); }

  extendTo(timeoutMs: number): number {
    if (this.expired || !Number.isFinite(timeoutMs)) return this.effectiveTimeoutMs;
    const requested = this.startedAt + Math.max(1, Math.floor(timeoutMs));
    if (this.sharedState !== undefined) {
      for (;;) {
        const previous = Atomics.load(this.sharedState, 1);
        const expiresAt = Number(previous) / 1_000;
        if (this.now() >= expiresAt) return this.effectiveTimeoutMs;
        const next = BigInt(Math.round(Math.min(this.maximumAt, Math.max(expiresAt, requested)) * 1_000));
        if (next <= previous || Atomics.compareExchange(this.sharedState, 1, previous, next) === previous) return this.effectiveTimeoutMs;
      }
    }
    this.#expiresAt = Math.min(this.maximumAt, Math.max(this.#expiresAt, requested));
    return this.effectiveTimeoutMs;
  }

  throwIfExpired(): void {
    if (this.expired) throw new Error(`Execution timed out after ${this.effectiveTimeoutMs}ms`);
  }

  /** Force the deadline to have passed, without touching the clock.
   *
   * The VM runs on its own thread and cannot observe a host clock the host
   * itself controls (for example a clock the embedder has replaced). When the
   * authoritative host side reports the deadline as passed, the VM must reach
   * the same conclusion instead of completing on a clock that disagrees. */
  expireNow(): void {
    this.#expiresAt = this.startedAt;
    if (this.sharedState !== undefined) Atomics.store(this.sharedState, 1, BigInt(Math.round(this.startedAt * 1_000)) || -1n);
  }
}
