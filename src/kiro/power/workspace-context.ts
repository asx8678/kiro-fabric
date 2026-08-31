export interface KiroWorkspaceRoot {
  uri: string;
  name?: string | undefined;
}

export type KiroWorkspaceContextStatus =
  | "verified"
  | "explicitly-empty"
  | "temporarily-unavailable";

export interface KiroWorkspaceSnapshot {
  revision: number;
  status: KiroWorkspaceContextStatus;
  roots: readonly KiroWorkspaceRoot[];
  observedAt: number;
  error?: string;
}

export interface WorkspaceContextProvider {
  current(options?: { force?: boolean }): Promise<KiroWorkspaceSnapshot>;
  invalidate(): void;
  subscribe(listener: (snapshot: KiroWorkspaceSnapshot) => void): { dispose(): void };
}

export interface WorkspaceContextSource {
  supported(): boolean;
  load(): Promise<readonly KiroWorkspaceRoot[]>;
}

/**
 * Conservative cached adapter around MCP roots. A failed refresh never means
 * that the client explicitly removed its roots: the last verified root set is
 * retained and callers receive a temporarily-unavailable snapshot instead.
 */
export class CachedWorkspaceContextProvider implements WorkspaceContextProvider {
  readonly #source: WorkspaceContextSource;
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #listeners = new Set<(snapshot: KiroWorkspaceSnapshot) => void>();
  #snapshot: KiroWorkspaceSnapshot | undefined;
  #stale = true;
  #refresh: Promise<KiroWorkspaceSnapshot> | undefined;
  #refreshGeneration = -1;
  #invalidationGeneration = 0;
  #revision = 0;

  constructor(
    source: WorkspaceContextSource,
    options: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.#source = source;
    this.#ttlMs = options.ttlMs ?? 30_000;
    this.#now = options.now ?? Date.now;
  }

  invalidate(): void {
    this.#stale = true;
    this.#invalidationGeneration++;
  }

  subscribe(listener: (snapshot: KiroWorkspaceSnapshot) => void): { dispose(): void } {
    this.#listeners.add(listener);
    return { dispose: () => { this.#listeners.delete(listener); } };
  }

  async current(options: { force?: boolean } = {}): Promise<KiroWorkspaceSnapshot> {
    const now = this.#now();
    if (
      !options.force && !this.#stale && this.#snapshot &&
      now - this.#snapshot.observedAt < this.#ttlMs
    ) {
      return this.#snapshot;
    }
    if (this.#refresh) {
      if (!options.force || this.#refreshGeneration === this.#invalidationGeneration) {
        return this.#refresh;
      }
      // A roots-changed notification arrived during discovery. Serialize a
      // second load after the old one so its late result cannot consume the
      // invalidation or overwrite fresher roots.
      return this.#refresh.then(() => this.current({ force: true }));
    }
    const generation = this.#invalidationGeneration;
    this.#refreshGeneration = generation;
    this.#refresh = this.#load(now, generation).finally(() => { this.#refresh = undefined; });
    return this.#refresh;
  }

  async #load(observedAt: number, generation: number): Promise<KiroWorkspaceSnapshot> {
    try {
      const roots = this.#source.supported() ? [...await this.#source.load()] : [];
      const snapshot: KiroWorkspaceSnapshot = {
        revision: ++this.#revision,
        status: roots.length === 0 ? "explicitly-empty" : "verified",
        roots,
        observedAt,
      };
      this.#stale = generation !== this.#invalidationGeneration;
      this.#publish(snapshot);
      return snapshot;
    } catch (error) {
      const previousRoots = this.#snapshot?.roots ?? [];
      const snapshot: KiroWorkspaceSnapshot = {
        revision: ++this.#revision,
        status: "temporarily-unavailable",
        roots: previousRoots,
        observedAt,
        error: error instanceof Error ? error.message : String(error),
      };
      // Keep retrying on the next request rather than caching a transport
      // failure for the full healthy-snapshot TTL.
      this.#stale = true;
      this.#publish(snapshot);
      return snapshot;
    }
  }

  #publish(snapshot: KiroWorkspaceSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) {
      try { listener(snapshot); } catch { /* observers cannot break discovery */ }
    }
  }
}
