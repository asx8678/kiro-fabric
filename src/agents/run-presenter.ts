/** Bounded projection seam for AgentManager's API/UI split. The manager owns
 * transport metadata; this collaborator owns only immutable UI projection. */
export class RunPresenter<T extends object> {
  readonly #project: (record: T) => T;
  #revision = 0;
  #cache: { revision: number; value: readonly T[] } | undefined;
  #stableCache: { revision: number; value: readonly unknown[] } | undefined;
  readonly #listeners = new Set<() => void>();

  constructor(project: (record: T) => T) { this.#project = project; }

  /** Invalidate all projections and notify UI observers without letting an
   * observer failure affect the agent lifecycle. */
  invalidate(): void {
    this.#revision++;
    this.#cache = undefined;
    this.#stableCache = undefined;
    for (const listener of this.#listeners) {
      try { listener(); } catch { /* UI observers are best effort. */ }
    }
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  clearListeners(): void {
    this.#listeners.clear();
  }

  project(record: T): T { return structuredClone(this.#project(record)); }

  list(records: readonly T[]): T[] {
    if (this.#cache?.revision === this.#revision) return structuredClone(this.#cache.value as T[]);
    const value = records.map((record) => this.#project(record));
    this.#cache = { revision: this.#revision, value };
    return structuredClone(value);
  }

  /** Cache an already-composed public UI list. This preserves the historical
   * AgentManager identity contract while keeping cache ownership here. */
  cachedList<V>(build: () => V[]): V[] {
    if (this.#stableCache?.revision === this.#revision) {
      return this.#stableCache.value as V[];
    }
    const value = build();
    this.#stableCache = { revision: this.#revision, value };
    return value;
  }
}
