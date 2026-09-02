import { performance } from "node:perf_hooks";

/** Host-only monotonic deadline shared by the sandbox and every provider call. */
export class FabricDeadline {
  readonly startedAt: number;
  readonly maximumAt: number;
  #expiresAt: number;

  constructor(timeoutMs: number, maximumMs: number, readonly now: () => number = () => performance.now()) {
    this.startedAt = now();
    const maximum = Math.max(1, Math.floor(maximumMs));
    this.maximumAt = this.startedAt + maximum;
    this.#expiresAt = this.startedAt + Math.min(maximum, Math.max(1, Math.floor(timeoutMs)));
  }

  get expiresAt(): number { return this.#expiresAt; }
  get effectiveTimeoutMs(): number { return Math.round(this.#expiresAt - this.startedAt); }
  get expired(): boolean { return this.now() >= this.#expiresAt; }
  remainingMs(): number { return Math.max(0, this.#expiresAt - this.now()); }

  extendTo(timeoutMs: number): number {
    if (this.expired || !Number.isFinite(timeoutMs)) return this.effectiveTimeoutMs;
    const requested = this.startedAt + Math.max(1, Math.floor(timeoutMs));
    this.#expiresAt = Math.min(this.maximumAt, Math.max(this.#expiresAt, requested));
    return this.effectiveTimeoutMs;
  }

  throwIfExpired(): void {
    if (this.expired) throw new Error(`Execution timed out after ${this.effectiveTimeoutMs}ms`);
  }
}
