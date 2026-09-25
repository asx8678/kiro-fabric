import { createHash } from "node:crypto";
import { FoveaOutbox, type FoveaDeliveryClaim } from "./delivery.js";

const FOVEA_CALL_COLD_MS = 6_000;
export const FOVEA_CALL_WARM_MS = 750;
// Leave room for the worker's bounded cancellation cleanup and mandatory output.
export const FOVEA_CALL_RESERVE_MS = 2_000;
// Admission/setup headroom: a deadline capped at cold + reserve immediately
// falls below the cold floor as time elapses. Worker limits remain unchanged.
export const FOVEA_CALL_COLLECTION_MS = FOVEA_CALL_COLD_MS + FOVEA_CALL_RESERVE_MS + 1_000;
const RETRY_MS = 60_000;
const MAX_ROOTS = 128;
const MAX_EMITTED_KEYS = 128;

/** Optional same-call context has no native-sync baseline or replay queue.
 * Retain only bounded deduplication hashes, never notices from earlier calls.
 * Dropping a disposable hint does not assert model-input acknowledgment. */
export class FoveaCallContexts {
  readonly #roots = new Map<string, { generation: number; retryAfter: number }>();
  readonly #emitted = new Map<string, string>();
  constructor(private readonly now: () => number = Date.now) {}
  budget(rootId: string, generation: number, remainingMs: number): number {
    const state = this.#roots.get(rootId);
    if (!Number.isFinite(remainingMs) || (state && state.retryAfter > this.now())) return 0;
    const available = Math.floor(remainingMs - FOVEA_CALL_RESERVE_MS);
    const warm = state?.generation === generation;
    if (available < (warm ? 100 : FOVEA_CALL_COLD_MS)) return 0;
    return Math.min(available, warm ? FOVEA_CALL_WARM_MS : FOVEA_CALL_COLD_MS);
  }
  analyzed(rootId: string, generation: number): void { this.#remember(rootId, { generation, retryAfter: 0 }); }
  failed(rootId: string): void { this.#remember(rootId, { generation: -1, retryAfter: this.now() + RETRY_MS }); }
  #remember(rootId: string, state: { generation: number; retryAfter: number }): void {
    this.#roots.delete(rootId); this.#roots.set(rootId, state);
    while (this.#roots.size > MAX_ROOTS) this.#roots.delete(this.#roots.keys().next().value!);
  }
  claim(rootId: string, epoch: number, semanticKey: string, text: string, maxChars: number,
    signal: AbortSignal, check: () => void): FoveaDeliveryClaim | undefined {
    signal.throwIfAborted(); check();
    const key = createHash("sha256").update(JSON.stringify([rootId, epoch, semanticKey, text])).digest("hex");
    if (this.#emitted.has(key)) return undefined;
    // An invocation owns this entire outbox. Neither cancel nor uncertain
    // transport can make its contents eligible for a later invocation.
    const outbox = new FoveaOutbox();
    const id = outbox.prepare(rootId, epoch, text, "own");
    const claim = outbox.claim(rootId, epoch, maxChars);
    if (!claim) return undefined;
    let active = true;
    const current = (): boolean => {
      if (!active || signal.aborted) return false;
      try { check(); return claim.isCurrent(); } catch { return false; }
    };
    const settle = (emitted: boolean): void => {
      if (!active) return;
      if (emitted && current()) {
        this.#emitted.delete(key); this.#emitted.set(key, rootId);
        while (this.#emitted.size > MAX_EMITTED_KEYS) this.#emitted.delete(this.#emitted.keys().next().value!);
      }
      active = false; signal.removeEventListener("abort", cancel);
      outbox.remove(id);
    };
    const cancel = (): void => settle(false);
    signal.addEventListener("abort", cancel, { once: true });
    return { notices: claim.notices, isCurrent: current, emitted: () => settle(true), uncertain: cancel, cancel };
  }
  revoke(rootId: string): void {
    this.#roots.delete(rootId);
    for (const [key, owner] of this.#emitted) if (owner === rootId) this.#emitted.delete(key);
  }
  clear(): void { this.#roots.clear(); this.#emitted.clear(); }
}
