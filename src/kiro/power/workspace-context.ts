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

const MAX_WORKSPACE_ROOTS = 128;
const MAX_WORKSPACE_URI_CHARS = 8_192;
const MAX_WORKSPACE_NAME_CHARS = 256;

const boundedRoots = (value: readonly KiroWorkspaceRoot[]): KiroWorkspaceRoot[] => {
  if (value.length > MAX_WORKSPACE_ROOTS) throw new Error("workspace root count exceeds 128");
  return value.map((root) => {
    if (!root || typeof root.uri !== "string" || root.uri.length < 1 || root.uri.length > MAX_WORKSPACE_URI_CHARS) {
      throw new Error("workspace root URI is outside configured bounds");
    }
    if (root.name !== undefined && (typeof root.name !== "string" || root.name.length > MAX_WORKSPACE_NAME_CHARS)) {
      throw new Error("workspace root name is outside configured bounds");
    }
    return { uri: root.uri, ...(root.name === undefined ? {} : { name: root.name }) };
  });
};

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
    if (this.#refresh) return this.#refresh;

    // One refresh owns all invalidations that arrive while it is in flight.
    // Superseded observations are neither published nor returned: consumers
    // and subscribers only see a snapshot from the newest generation.
    this.#refresh = (async () => {
      while (true) {
        const generation = this.#invalidationGeneration;
        const snapshot = await this.#load(this.#now());
        if (generation !== this.#invalidationGeneration) continue;
        snapshot.revision = ++this.#revision;
        this.#stale = snapshot.status === "temporarily-unavailable";
        this.#publish(snapshot);
        return snapshot;
      }
    })().finally(() => { this.#refresh = undefined; });
    return this.#refresh;
  }

  async #load(observedAt: number): Promise<KiroWorkspaceSnapshot> {
    try {
      const roots = this.#source.supported()
        ? boundedRoots(await this.#source.load())
        : [];
      return {
        revision: 0,
        status: roots.length === 0 ? "explicitly-empty" : "verified",
        roots,
        observedAt,
      };
    } catch (error) {
      return {
        revision: 0,
        status: "temporarily-unavailable",
        roots: this.#snapshot?.roots ?? [],
        observedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  #publish(snapshot: KiroWorkspaceSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) {
      try { listener(snapshot); } catch { /* observers cannot break discovery */ }
    }
  }
}
