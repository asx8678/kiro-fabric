/** Terminal arbitration and transport-exit coordination extracted from the
 * manager's monitor. A single latch makes result publication and cleanup
 * exactly-once even when stop, timeout, and transport observers race. */
export class RunReconciler<T> {
  readonly #settled = new Set<string>();

  isSettled(id: string): boolean { return this.#settled.has(id); }

  settleOnce(id: string, value: T, commit: (value: T) => void): boolean {
    if (this.#settled.has(id)) return false;
    this.#settled.add(id);
    commit(value);
    return true;
  }

  /** Wait for a transport to become dead without owning the transport or
   * deciding the terminal result. Keeping this polling here ensures stop,
   * timeout, and monitor paths use one bounded exit policy. */
  async waitForTransportExit(
    isAlive: () => Promise<boolean>,
    pollIntervalMs: number,
    maxWaitMs: number,
  ): Promise<void> {
    const deadline = Date.now() + Math.max(0, maxWaitMs);
    while (Date.now() < deadline && (await isAlive())) {
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(1, pollIntervalMs)));
    }
  }

  reset(id: string): void { this.#settled.delete(id); }
}
