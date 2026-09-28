import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
globalThis.__filename = __fileURLToPath(import.meta.url);
globalThis.__dirname = __dirnameOf(globalThis.__filename);
const require = __createRequire(import.meta.url);

import {
  FabricCompilerTimeoutError
} from "./chunk-ODEJLNJ5.js";

// src/runtime/compiler-pool.ts
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
var DEFAULT_COMPILER_TIMEOUT_MS = 1e4;
var COMPILER_MEMORY_MB = 128;
var COMPILER_WORKER_IDLE_MS = 3e4;
var COMPILER_WORKER_MAX_USES = 250;
var MAX_COMPILER_CACHE_ENTRIES = 32;
var MAX_COMPILER_CACHE_CHARS = 2 * 1024 * 1024;
var defaultCompilerWorkerUrl = () => import.meta.url.endsWith(".ts") ? new URL("../../dist/runtime/compiler-worker-entry.js", import.meta.url) : new URL("../runtime/compiler-worker-entry.js", import.meta.url);
var FabricCompilerPool = class {
  constructor(maxWorkers = 4) {
    this.maxWorkers = maxWorkers;
    if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > 64) throw new Error("Invalid Fabric compiler worker limit");
  }
  maxWorkers;
  #workers = /* @__PURE__ */ new Set();
  /** Workers whose termination has begun. They no longer hold pool capacity,
   * but shutdown still awaits them so retirement remains complete. */
  #retiring = /* @__PURE__ */ new Set();
  #idle;
  #cache = /* @__PURE__ */ new Map();
  #cachedChars = 0;
  #lastDeclarations;
  #nextId = 0;
  #closed = false;
  #closing;
  #remember(key, result) {
    if (key === void 0 || result.errors.length > 0 || result.javascript === void 0) return;
    const chars = key.length + result.javascript.length + (result.sourceMap?.length ?? 0);
    if (chars > MAX_COMPILER_CACHE_CHARS) return;
    const previous = this.#cache.get(key);
    if (previous) {
      this.#cache.delete(key);
      this.#cachedChars -= previous.chars;
    }
    this.#cache.set(key, { chars, result: {
      errors: [],
      javascript: result.javascript,
      ...result.sourceMap === void 0 ? {} : { sourceMap: result.sourceMap }
    } });
    this.#cachedChars += chars;
    while (this.#cache.size > MAX_COMPILER_CACHE_ENTRIES || this.#cachedChars > MAX_COMPILER_CACHE_CHARS) {
      const oldest = this.#cache.keys().next().value;
      this.#cachedChars -= this.#cache.get(oldest).chars;
      this.#cache.delete(oldest);
    }
  }
  #declarationsDigest(declarations) {
    if (this.#lastDeclarations?.text !== declarations) {
      this.#lastDeclarations = { text: declarations, digest: createHash("sha256").update(Buffer.from(declarations, "utf16le")).digest("hex") };
    }
    return this.#lastDeclarations.digest;
  }
  #detachIdle(state) {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = void 0;
    }
    if (this.#idle === state) this.#idle = void 0;
  }
  #terminate(state) {
    this.#detachIdle(state);
    if (state.termination) return state.termination;
    this.#workers.delete(state);
    const termination = state.worker.terminate().catch(() => void 0).then(() => void 0);
    state.termination = termination;
    this.#retiring.add(termination);
    void termination.then(
      () => this.#retiring.delete(termination),
      () => this.#retiring.delete(termination)
    );
    return termination;
  }
  #acquire(workerUrl) {
    if (workerUrl === void 0 && this.#idle) {
      const state2 = this.#idle;
      this.#detachIdle(state2);
      return state2;
    }
    if (this.#workers.size >= this.maxWorkers) throw new Error("Fabric compiler concurrency limit reached");
    const state = {
      worker: new Worker(workerUrl ?? defaultCompilerWorkerUrl(), { resourceLimits: { maxOldGenerationSizeMb: COMPILER_MEMORY_MB, stackSizeMb: 4 } }),
      uses: 0,
      poolable: workerUrl === void 0,
      idleTimer: void 0,
      pending: void 0
    };
    this.#workers.add(state);
    state.worker.unref();
    state.worker.on("message", (response) => {
      const pending = state.pending;
      if (!pending || pending.id !== response.id) return;
      if (response.ok) pending.finish(void 0, response.result);
      else pending.finish(new Error(`Fabric compiler failed: ${response.error}`));
    });
    state.worker.on("error", (error) => {
      state.pending?.finish(new Error(`Fabric compiler worker failed: ${error instanceof Error ? error.message : String(error)}`));
      void this.#terminate(state);
    });
    state.worker.on("exit", (code) => {
      this.#detachIdle(state);
      state.pending?.finish(new Error(`Fabric compiler worker exited before replying (${code})`));
      this.#workers.delete(state);
    });
    return state;
  }
  check(request, options = {}) {
    return new Promise((resolve, reject) => {
      if (this.#closed) {
        reject(new Error("Fabric compiler pool is closed"));
        return;
      }
      if (options.signal?.aborted) {
        reject(options.signal.reason ?? new Error("Fabric compiler aborted"));
        return;
      }
      const { code, declarations } = request;
      const cacheKey = options.workerUrl === void 0 && code.length + declarations.length <= MAX_COMPILER_CACHE_CHARS ? `${this.#declarationsDigest(declarations)}:${code}` : void 0;
      const cached = cacheKey === void 0 ? void 0 : this.#cache.get(cacheKey);
      if (cached) {
        this.#cache.delete(cacheKey);
        this.#cache.set(cacheKey, cached);
        const hit = { ...cached.result, errors: [], compileCache: "hit" };
        delete hit.compileWorker;
        resolve(hit);
        return;
      }
      const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? DEFAULT_COMPILER_TIMEOUT_MS, 6e4));
      const compileWorker = options.workerUrl !== void 0 ? "custom" : this.#idle ? "warm" : "cold";
      const state = this.#acquire(options.workerUrl);
      const id = ++this.#nextId;
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        state.pending = void 0;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        const complete = () => {
          if (error) reject(error);
          else resolve({ ...result, compileCache: cacheKey === void 0 ? "bypass" : "miss", compileWorker });
        };
        if (error) {
          void this.#terminate(state).then(complete);
          return;
        }
        this.#remember(cacheKey, result);
        state.uses += 1;
        if (!this.#closed && !this.#idle && state.poolable && state.uses < COMPILER_WORKER_MAX_USES) {
          this.#idle = state;
          state.idleTimer = setTimeout(() => {
            void this.#terminate(state);
          }, COMPILER_WORKER_IDLE_MS);
          state.idleTimer.unref();
          complete();
        } else {
          void this.#terminate(state).then(complete);
        }
      };
      const onAbort = () => finish(options.signal?.reason instanceof Error ? options.signal.reason : new Error("Fabric compiler aborted"));
      const timer = setTimeout(() => finish(new FabricCompilerTimeoutError(timeoutMs)), timeoutMs);
      state.pending = { id, finish };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
      if (!settled) {
        try {
          state.worker.postMessage({ id, code, declarations });
        } catch (error) {
          finish(error instanceof Error ? error : new Error("Fabric compiler dispatch failed"));
        }
      }
    });
  }
  close() {
    this.#closed = true;
    this.#cache.clear();
    this.#cachedChars = 0;
    return this.#closing ??= (async () => {
      for (const state of [...this.#workers]) {
        state.pending?.finish(new Error("Fabric compiler pool is closed"));
        void this.#terminate(state);
      }
      while (this.#retiring.size > 0) await Promise.all([...this.#retiring]);
    })();
  }
};

export {
  FabricCompilerPool
};
