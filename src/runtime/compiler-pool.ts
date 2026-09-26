import { FabricCompilerTimeoutError } from "../core/repair-error.js";
import { Worker } from "node:worker_threads";

export interface FabricTypeError {
  line: number;
  column: number;
  message: string;
  code?: number;
  hint?: string;
}

export interface FabricTypeCheckResult {
  /** Pool-observed cache outcome; custom workers/oversized inputs bypass lookup. Absent for synchronous checks. */
  compileCache?: "hit" | "miss" | "bypass";
  /** Worker used on a miss/bypass: retained idle (warm), fresh (cold), or caller-supplied URL. Absent on a hit. */
  compileWorker?: "cold" | "warm" | "custom";
  errors: FabricTypeError[];
  javascript?: string;
  sourceMap?: string;
}

export interface FabricCompilerRequest {
  code: string;
  declarations: string;
}

export type FabricCompilerWorkerResponse =
  | { id: number; ok: true; result: FabricTypeCheckResult }
  | { id: number; ok: false; error: string };

const DEFAULT_COMPILER_TIMEOUT_MS = 10_000;
const COMPILER_MEMORY_MB = 128;

export interface FabricCompilerWorkerOptions { signal?: AbortSignal; timeoutMs?: number; workerUrl?: URL }

/** Reuse is safe because the compiler host, not worker freshness, constrains
 * inputs. Each execution service owns its pool; no service closes another's
 * active compiler. Admission rejects rather than retaining an unbounded queue. */
const COMPILER_WORKER_IDLE_MS = 30_000;
const COMPILER_WORKER_MAX_USES = 250;
// Per-owner, in-memory compiler output only. Count keys, emitted JS and maps;
// at most ~4 MiB of UTF-16 text plus bounded entry overhead, with no payloads.
const MAX_COMPILER_CACHE_ENTRIES = 32;
const MAX_COMPILER_CACHE_CHARS = 2 * 1024 * 1024;
interface CachedFabricCompilation { result: FabricTypeCheckResult; chars: number }

interface FabricCompilerWorkerState {
  worker: Worker;
  uses: number;
  poolable: boolean;
  idleTimer: NodeJS.Timeout | undefined;
  pending: { id: number; finish: (error?: Error, result?: FabricTypeCheckResult) => void } | undefined;
  termination?: Promise<void>;
}

const defaultCompilerWorkerUrl = (): URL => import.meta.url.endsWith(".ts")
  ? new URL("../../dist/runtime/compiler-worker-entry.js", import.meta.url)
  : new URL("../runtime/compiler-worker-entry.js", import.meta.url);

export class FabricCompilerPool {
  readonly #workers = new Set<FabricCompilerWorkerState>();
  /** Workers whose termination has begun. They no longer hold pool capacity,
   * but shutdown still awaits them so retirement remains complete. */
  readonly #retiring = new Set<Promise<void>>();
  #idle: FabricCompilerWorkerState | undefined;
  readonly #cache = new Map<string, CachedFabricCompilation>();
  #cachedChars = 0;
  #nextId = 0;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(readonly maxWorkers = 4) {
    if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > 64) throw new Error("Invalid Fabric compiler worker limit");
  }

  #remember(key: string | undefined, result: FabricTypeCheckResult): void {
    if (key === undefined || result.errors.length > 0 || result.javascript === undefined) return;
    const chars = key.length + result.javascript.length + (result.sourceMap?.length ?? 0);
    if (chars > MAX_COMPILER_CACHE_CHARS) return;
    const previous = this.#cache.get(key);
    if (previous) { this.#cache.delete(key); this.#cachedChars -= previous.chars; }
    // Never expose the cached object or its mutable errors array to callers.
    this.#cache.set(key, { chars, result: {
      errors: [], javascript: result.javascript,
      ...(result.sourceMap === undefined ? {} : { sourceMap: result.sourceMap }),
    } });
    this.#cachedChars += chars;
    while (this.#cache.size > MAX_COMPILER_CACHE_ENTRIES || this.#cachedChars > MAX_COMPILER_CACHE_CHARS) {
      const oldest = this.#cache.keys().next().value!;
      this.#cachedChars -= this.#cache.get(oldest)!.chars;
      this.#cache.delete(oldest);
    }
  }

  #detachIdle(state: FabricCompilerWorkerState): void {
    if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = undefined; }
    if (this.#idle === state) this.#idle = undefined;
  }

  #terminate(state: FabricCompilerWorkerState): Promise<void> {
    this.#detachIdle(state);
    if (state.termination) return state.termination;
    // Release capacity synchronously. Retiring workers used to hold their slot
    // until termination settled, so a request arriving during idle retirement
    // was rejected with a concurrency error even though the pool was idle.
    this.#workers.delete(state);
    const termination = state.worker.terminate().catch(() => undefined).then(() => undefined);
    state.termination = termination;
    this.#retiring.add(termination);
    void termination.then(
      () => this.#retiring.delete(termination),
      () => this.#retiring.delete(termination),
    );
    return termination;
  }

  #acquire(workerUrl?: URL): FabricCompilerWorkerState {
    if (workerUrl === undefined && this.#idle) {
      const state = this.#idle;
      this.#detachIdle(state);
      return state;
    }
    if (this.#workers.size >= this.maxWorkers) throw new Error("Fabric compiler concurrency limit reached");
    const state: FabricCompilerWorkerState = {
      worker: new Worker(workerUrl ?? defaultCompilerWorkerUrl(), { resourceLimits: { maxOldGenerationSizeMb: COMPILER_MEMORY_MB, stackSizeMb: 4 } }),
      uses: 0, poolable: workerUrl === undefined, idleTimer: undefined, pending: undefined,
    };
    this.#workers.add(state);
    state.worker.unref();
    state.worker.on("message", (response: FabricCompilerWorkerResponse) => {
      const pending = state.pending;
      if (!pending || pending.id !== response.id) return;
      if (response.ok) pending.finish(undefined, response.result);
      else pending.finish(new Error(`Fabric compiler failed: ${response.error}`));
    });
    state.worker.on("error", (error: unknown) => {
      state.pending?.finish(new Error(`Fabric compiler worker failed: ${error instanceof Error ? error.message : String(error)}`));
      void this.#terminate(state);
    });
    state.worker.on("exit", (code: number) => {
      this.#detachIdle(state);
      state.pending?.finish(new Error(`Fabric compiler worker exited before replying (${code})`));
      this.#workers.delete(state);
    });
    return state;
  }

  check(request: FabricCompilerRequest, options: FabricCompilerWorkerOptions = {}): Promise<FabricTypeCheckResult> {
    return new Promise((resolve, reject) => {
      if (this.#closed) { reject(new Error("Fabric compiler pool is closed")); return; }
      if (options.signal?.aborted) { reject(options.signal.reason ?? new Error("Fabric compiler aborted")); return; }
      const { code, declarations } = request;
      // Length framing preserves exact UTF-16 source/declarations without hash
      // collisions or delimiter ambiguity. Custom workers never read/write it.
      const cacheKey = options.workerUrl === undefined && code.length + declarations.length <= MAX_COMPILER_CACHE_CHARS
        ? `${declarations.length}:${declarations}${code}` : undefined;
      const cached = cacheKey === undefined ? undefined : this.#cache.get(cacheKey);
      if (cached) {
        this.#cache.delete(cacheKey!); this.#cache.set(cacheKey!, cached);
        const hit: FabricTypeCheckResult = { ...cached.result, errors: [], compileCache: "hit" };
        // The recorded worker class belongs to the original miss, not this hit.
        delete hit.compileWorker;
        resolve(hit);
        return;
      }
      const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? DEFAULT_COMPILER_TIMEOUT_MS, 60_000));
      // Classify the worker before acquisition in this same tick: a retained
      // idle worker already paid startup, a fresh one has not.
      const compileWorker: "cold" | "warm" | "custom" = options.workerUrl !== undefined ? "custom" : this.#idle ? "warm" : "cold";
      const state = this.#acquire(options.workerUrl);
      const id = ++this.#nextId;
      let settled = false;
      const finish = (error?: Error, result?: FabricTypeCheckResult): void => {
        if (settled) return;
        settled = true;
        state.pending = undefined;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        const complete = (): void => { if (error) reject(error); else resolve({ ...result!, compileCache: cacheKey === undefined ? "bypass" : "miss", compileWorker }); };
        if (error) { void this.#terminate(state).then(complete); return; }
        this.#remember(cacheKey, result!);
        state.uses += 1;
        // Retain at most one warm idle worker; concurrent completions cannot
        // overwrite an owned worker and lose its shutdown handle.
        if (!this.#closed && !this.#idle && state.poolable && state.uses < COMPILER_WORKER_MAX_USES) {
          this.#idle = state;
          state.idleTimer = setTimeout(() => { void this.#terminate(state); }, COMPILER_WORKER_IDLE_MS);
          state.idleTimer.unref();
          complete();
        } else { void this.#terminate(state).then(complete); }
      };
      const onAbort = (): void => finish(options.signal?.reason instanceof Error ? options.signal.reason : new Error("Fabric compiler aborted"));
      const timer = setTimeout(() => finish(new FabricCompilerTimeoutError(timeoutMs)), timeoutMs);
      state.pending = { id, finish };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
      if (!settled) {
        try { state.worker.postMessage({ id, code, declarations }); }
        catch (error) { finish(error instanceof Error ? error : new Error("Fabric compiler dispatch failed")); }
      }
    });
  }

  close(): Promise<void> {
    this.#closed = true;
    this.#cache.clear(); this.#cachedChars = 0;
    return this.#closing ??= (async () => {
      for (const state of [...this.#workers]) {
        state.pending?.finish(new Error("Fabric compiler pool is closed"));
        void this.#terminate(state);
      }
      // Retirement may still be settling for workers that released capacity
      // before this call. Await every generation so close stays complete.
      while (this.#retiring.size > 0) await Promise.all([...this.#retiring]);
    })();
  }
}