import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
globalThis.__filename = __fileURLToPath(import.meta.url);
globalThis.__dirname = __dirnameOf(globalThis.__filename);
const require = __createRequire(import.meta.url);

import {
  fabricFailureMetadata
} from "./chunk-ODEJLNJ5.js";
import {
  MAX_FABRIC_JSON_CHARS,
  assertFabricJsonBudget,
  fabricJsonText
} from "./chunk-WZ4PGM3F.js";
import {
  QuickJSEmscriptenModuleError,
  debugLog
} from "./chunk-NWYPLJ5N.js";

// src/trace/tracer.ts
import { randomUUID } from "node:crypto";

// src/trace/trace-writer.ts
import fs from "node:fs";
import path from "node:path";
var DEFAULT_MAX_BUFFER_LINES = 4096;
var DEFAULT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
var DEFAULT_FLUSH_INTERVAL_MS = 250;
var DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
var DEFAULT_MAX_LINE_BYTES = 8 * 1024;
var MAX_BUFFER_LINES = 1048576;
var MAX_BUFFER_BYTES = 256 * 1024 * 1024;
var MAX_FILE_BYTES = 1024 * 1024 * 1024;
var MAX_LINE_BYTES = 1024 * 1024;
var MAX_FLUSH_INTERVAL_MS = 6e4;
var MIN_MAX_LINE_BYTES = 2;
var boundedOption = (name, value, fallback, minimum, maximum) => {
  if (value === void 0) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`trace writer ${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
};
var LineRing = class {
  constructor(capacity, maxBytes) {
    this.capacity = capacity;
    this.maxBytes = maxBytes;
    this.#slots = new Array(capacity);
  }
  capacity;
  maxBytes;
  #slots;
  #start = 0;
  #size = 0;
  #bytes = 0;
  /** Returns how many lines were discarded: evicted oldest lines plus, when the
   * line cannot fit the byte budget at all, the rejected line itself. */
  push(line) {
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (lineBytes > this.maxBytes) return 1;
    let dropped = 0;
    while (this.#size > 0 && (this.#size >= this.capacity || this.#bytes + lineBytes > this.maxBytes)) {
      const index = this.#start;
      this.#bytes -= Buffer.byteLength(this.#slots[index], "utf8");
      this.#slots[index] = void 0;
      this.#start = (this.#start + 1) % this.capacity;
      this.#size -= 1;
      dropped += 1;
    }
    this.#slots[(this.#start + this.#size) % this.capacity] = line;
    this.#size += 1;
    this.#bytes += lineBytes;
    return dropped;
  }
  drain() {
    const out = [];
    for (let index = 0; index < this.#size; index += 1) {
      out.push(this.#slots[(this.#start + index) % this.capacity]);
    }
    this.#slots.fill(void 0);
    this.#start = 0;
    this.#size = 0;
    this.#bytes = 0;
    return out;
  }
  get size() {
    return this.#size;
  }
};
var BufferedTraceWriter = class {
  file;
  #fd;
  #ring;
  #maxFileBytes;
  #maxLineBytes;
  #timer;
  #onExit = () => {
    this.#flushSync(true);
  };
  #writtenBytes = 0;
  #dropped = 0;
  #disabled = false;
  #closed = false;
  constructor(options) {
    if (!path.isAbsolute(options.file)) throw new Error("trace file must be an absolute path");
    const maxBufferLines = boundedOption("maxBufferLines", options.maxBufferLines, DEFAULT_MAX_BUFFER_LINES, 1, MAX_BUFFER_LINES);
    const maxBufferBytes = boundedOption("maxBufferBytes", options.maxBufferBytes, DEFAULT_MAX_BUFFER_BYTES, 1, MAX_BUFFER_BYTES);
    const maxFileBytes = boundedOption("maxFileBytes", options.maxFileBytes, DEFAULT_MAX_FILE_BYTES, 1, MAX_FILE_BYTES);
    const maxLineBytes = boundedOption("maxLineBytes", options.maxLineBytes, DEFAULT_MAX_LINE_BYTES, MIN_MAX_LINE_BYTES, MAX_LINE_BYTES);
    const flushIntervalMs = boundedOption("flushIntervalMs", options.flushIntervalMs, DEFAULT_FLUSH_INTERVAL_MS, 1, MAX_FLUSH_INTERVAL_MS);
    this.file = options.file;
    const ring = new LineRing(maxBufferLines, maxBufferBytes);
    this.#maxFileBytes = maxFileBytes;
    this.#maxLineBytes = maxLineBytes;
    fs.mkdirSync(path.dirname(options.file), { recursive: true, mode: 448 });
    const descriptor = fs.openSync(options.file, "wx", 384);
    try {
      this.#fd = descriptor;
      this.#ring = ring;
      this.#timer = setInterval(() => {
        this.#flushSync(true);
      }, flushIntervalMs);
      this.#timer.unref();
      process.once("exit", this.#onExit);
    } catch (error) {
      try {
        fs.closeSync(descriptor);
      } catch {
      }
      try {
        fs.rmSync(options.file, { force: true });
      } catch {
      }
      throw error;
    }
  }
  get dropped() {
    return this.#dropped;
  }
  get disabled() {
    return this.#disabled;
  }
  write(line) {
    if (this.#disabled || this.#closed) return;
    const raw = `${line}
`;
    const bounded = Buffer.byteLength(raw, "utf8") <= this.#maxLineBytes ? raw : this.#truncatedLine(raw);
    if (bounded === null) {
      this.#dropped += 1;
      return;
    }
    this.#dropped += this.#ring.push(bounded);
  }
  /** Largest well-formed replacement that fits the per-line cap, newline
   * included; null when no candidate fits at all. */
  #truncatedLine(raw) {
    const bytes = Buffer.byteLength(raw, "utf8");
    const candidates = [
      JSON.stringify({ v: 1, ev: "line.truncated", data: { bytes } }),
      '{"line.truncated":true}',
      '{"t":1}',
      "{}"
    ];
    for (const candidate of candidates) {
      const line = `${candidate}
`;
      if (Buffer.byteLength(line, "utf8") <= this.#maxLineBytes) return line;
    }
    return null;
  }
  #flushSync(fsync) {
    if (this.#closed || this.#ring.size === 0) return;
    const chunk = this.#ring.drain().join("");
    const chunkBytes = Buffer.byteLength(chunk, "utf8");
    try {
      if (this.#writtenBytes + chunkBytes > this.#maxFileBytes) {
        const marker = JSON.stringify({ v: 1, cat: "teardown", ev: "trace.truncated", data: { maxFileBytes: this.#maxFileBytes } });
        const room = this.#maxFileBytes - this.#writtenBytes;
        if (room > Buffer.byteLength(marker, "utf8") + 1) fs.writeSync(this.#fd, `${marker}
`);
        this.#disabled = true;
        return;
      }
      fs.writeSync(this.#fd, chunk);
      this.#writtenBytes += chunkBytes;
      if (fsync) fs.fsyncSync(this.#fd);
    } catch {
      this.#disabled = true;
    }
  }
  flush() {
    this.#flushSync(true);
  }
  close() {
    if (this.#closed) return;
    this.#flushSync(true);
    this.#closed = true;
    clearInterval(this.#timer);
    process.removeListener("exit", this.#onExit);
    try {
      fs.closeSync(this.#fd);
    } catch {
    }
  }
};
var createTraceWriter = (options) => new BufferedTraceWriter(options);

// src/trace/tracer.ts
var traceFailureMetadata = (errorKind) => ({ errorKind });
var MAX_EVENT_CHARS = 6e3;
var NOOP_SPAN = Object.freeze({ id: "", end: () => void 0 });
var DISABLED_TRACER = Object.freeze({
  enabled: false,
  file: void 0,
  newExecutionId: () => "",
  span: () => NOOP_SPAN,
  event: () => void 0,
  flush: () => void 0,
  close: () => void 0
});
var monotonicUs = () => Number(process.hrtime.bigint() / 1000n);
var ActiveFabricTracer = class {
  enabled = true;
  file;
  #writer;
  #closed = false;
  #reportedDrops = 0;
  #seq = 0;
  #spanSeq = 0;
  constructor(writer) {
    this.#writer = writer;
    this.file = writer.file;
  }
  newExecutionId() {
    return `exec_${randomUUID()}`;
  }
  #emit(event) {
    if (this.#closed) return;
    const sequenced = { ...event, seq: ++this.#seq };
    let line;
    try {
      line = fabricJsonText(sequenced, MAX_EVENT_CHARS);
    } catch {
      const fallback = { v: 1, ts: event.ts, monoUs: event.monoUs, seq: sequenced.seq, cat: event.cat, ev: event.ev, ...event.execId ? { execId: event.execId } : {}, ...event.spanId ? { spanId: event.spanId } : {}, ...event.parentId ? { parentId: event.parentId } : {}, ...event.durUs !== void 0 ? { durUs: event.durUs } : {}, data: { traceDataError: true } };
      line = fabricJsonText(fallback, MAX_EVENT_CHARS);
    }
    this.#writer.write(line);
  }
  span(cat, ev, execId, data, parentId) {
    const id = `span_${++this.#spanSeq}`;
    const startedUs = monotonicUs();
    let ended = false;
    return {
      id,
      end: (endData) => {
        if (ended) return;
        ended = true;
        this.#emit({
          v: 1,
          ts: (/* @__PURE__ */ new Date()).toISOString(),
          monoUs: startedUs,
          cat,
          ev,
          ...execId ? { execId } : {},
          spanId: id,
          ...parentId ? { parentId } : {},
          durUs: Math.max(0, monotonicUs() - startedUs),
          ...data || endData ? { data: { ...data ?? {}, ...endData ?? {} } } : {}
        });
      }
    };
  }
  event(cat, ev, execId, data) {
    this.#emit({
      v: 1,
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      monoUs: monotonicUs(),
      cat,
      ev,
      ...execId ? { execId } : {},
      ...data ? { data } : {}
    });
  }
  flush() {
    this.#writer.flush();
    const dropped = this.#writer.dropped;
    if (dropped > this.#reportedDrops) {
      const lost = dropped - this.#reportedDrops;
      this.#reportedDrops = dropped;
      this.event("teardown", "trace.dropped", void 0, { lost, total: dropped });
      this.#writer.flush();
    }
  }
  close() {
    if (this.#closed) return;
    this.flush();
    this.#closed = true;
    this.#writer.close();
  }
};
var resolveTraceEnabled = (envValue, configured) => {
  const normalized = envValue?.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  return configured;
};
var createFabricTracer = (options) => new ActiveFabricTracer(options.writer ?? createTraceWriter(options));

// src/providers/local-shell.ts
import { spawn } from "node:child_process";

// src/providers/local-process-group.ts
import { execFile } from "node:child_process";
import { opendir, readFile } from "node:fs/promises";
import { promisify } from "node:util";
var uncertain = () => new Error("Local shell cleanup uncertain");
var PROC_BATCH = 8;
var PROC_ENTRY_LIMIT = 32768;
async function localProcessGroupAlive(pid, end) {
  try {
    process.kill(-pid, 0);
  } catch (error) {
    const code = error.code;
    if (code === "ESRCH") return false;
    if (process.platform !== "darwin" || code !== "EPERM") throw uncertain();
  }
  const probeEnd = Math.min(end, performance.now() + 200);
  const remaining = probeEnd - performance.now();
  if (remaining <= 0) throw uncertain();
  const controller = new AbortController();
  const check = () => {
    if (controller.signal.aborted || performance.now() >= probeEnd) throw uncertain();
  };
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(uncertain());
    }, remaining);
  });
  const observe = async () => {
    if (process.platform === "darwin") {
      const { stdout } = await promisify(execFile)("/bin/ps", ["-axo", "pgid=,stat="], {
        encoding: "utf8",
        env: { LC_ALL: "C" },
        timeout: Math.max(1, Math.floor(remaining)),
        signal: controller.signal,
        maxBuffer: 4 * 1024 * 1024
      });
      check();
      if (!stdout.trim()) throw uncertain();
      for (const line of stdout.trim().split("\n")) {
        check();
        const match = /^\s*(\d+)\s+([A-Za-z+<>0-9-]+)\s*$/.exec(line);
        if (!match) throw uncertain();
        if (Number(match[1]) === pid && !match[2].startsWith("Z")) return true;
      }
      return false;
    }
    if (process.platform !== "linux") throw uncertain();
    const live = async (entry) => {
      check();
      let stat;
      try {
        stat = await readFile(`/proc/${entry}/stat`, { encoding: "utf8", signal: controller.signal });
      } catch (error) {
        if (["ENOENT", "ESRCH"].includes(error.code ?? "")) return false;
        throw uncertain();
      }
      check();
      const close = stat.lastIndexOf(")");
      const fields = stat.slice(close + 2).trim().split(/\s+/u);
      if (!stat.startsWith(`${entry} (`) || close < 0 || !/^[A-Za-z]$/u.test(fields[0] ?? "") || !/^\d+$/u.test(fields[1] ?? "") || !/^\d+$/u.test(fields[2] ?? "")) throw uncertain();
      return Number(fields[2]) === pid && !["Z", "X", "x"].includes(fields[0]);
    };
    if (await live(String(pid))) return true;
    check();
    const directory = await opendir("/proc");
    let count = 0;
    let batch = [];
    for await (const entry of directory) {
      check();
      if (++count > PROC_ENTRY_LIMIT) throw uncertain();
      if (!/^\d+$/u.test(entry.name) || entry.name === String(pid)) continue;
      batch.push(entry.name);
      if (batch.length === PROC_BATCH) {
        if ((await Promise.all(batch.map(live))).some(Boolean)) return true;
        batch = [];
      }
    }
    check();
    return (await Promise.all(batch.map(live))).some(Boolean);
  };
  try {
    return await Promise.race([observe(), timeout]);
  } catch {
    throw uncertain();
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// src/providers/local-shell.ts
import { setTimeout as delay } from "node:timers/promises";

// src/async-settlement.ts
var abortError = (signal) => {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  return new Error(typeof reason === "string" && reason ? reason : "Operation aborted");
};
var throwIfAborted = (signal) => {
  if (signal?.aborted) throw abortError(signal);
};
var throwIfAbortedOrExpired = (signal, deadline) => {
  throwIfAborted(signal);
  deadline?.throwIfExpired();
};
var raceWithAbort = (operation, signal) => {
  if (!signal) return Promise.resolve(operation);
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(abortError(signal)));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(operation).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    );
  });
};
var runAbortable = (signal, operation) => {
  try {
    throwIfAborted(signal);
    return raceWithAbort(Promise.resolve(operation()), signal);
  } catch (error) {
    return Promise.reject(error);
  }
};
var settleWithin = async (operations, timeoutMs) => {
  const pending = [...operations].map((operation) => Promise.resolve(operation));
  if (pending.length === 0) return true;
  let timer;
  try {
    return await Promise.race([
      Promise.allSettled(pending).then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

// src/providers/local-shell.ts
var LocalShellExitError = class extends Error {
  result;
  constructor(result) {
    super(`Local shell exited with code ${result.exitCode}`);
    this.name = "LocalShellExitError";
    this.result = result;
    Object.defineProperty(this, "result", { enumerable: false });
  }
};
function shellEnvironment(source = process.env) {
  const env = {};
  for (const key of ["HOME", "PATH", "TMPDIR", "LANG", "TERM", "TZ", "USER", "LOGNAME", ...Object.keys(source).filter((key2) => /^LC_[A-Z_]+$/.test(key2)).sort()]) {
    if (source[key] !== void 0) env[key] = source[key];
  }
  return env;
}
async function sendGroup(pid, signal, end) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    const code = error.code;
    if (code === "ESRCH") return;
    if (process.platform === "darwin" && code === "EPERM" && !await localProcessGroupAlive(pid, end)) return;
    throw new Error("Local shell cleanup uncertain");
  }
}
async function runLocalShell(options) {
  if (process.platform !== "linux" && process.platform !== "darwin") throw new Error("Local shell requires Linux or macOS");
  const timeout = options.timeoutMs ?? 3e4;
  const budget = options.maxOutputChars ?? 24e3;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 9e5) throw new Error("Local shell timeoutMs must be 1..900000");
  if (!Number.isSafeInteger(budget) || budget < 256) throw new Error("Local shell maxOutputChars must be an integer >=256");
  const check = () => {
    try {
      throwIfAbortedOrExpired(options.signal, options.deadline);
    } catch {
      throw new Error("Local shell cancelled or deadline expired");
    }
  };
  check();
  const result = { ok: false, exitCode: null, signal: null, stdout: "", stderr: "", truncated: false, stdoutTruncated: false, stderrTruncated: false };
  const streamLimit = Math.floor((budget - 256) / 12);
  let child;
  try {
    const isScript = typeof options.script === "string";
    const executable = isScript && options.interpreter === "bash" ? "bash" : "/bin/sh";
    const args = isScript ? [...executable === "bash" ? ["--noprofile", "--norc"] : [], "-c", options.script, "fabric-script", ...options.args ?? []] : ["-c", options.command];
    child = spawn(executable, args, {
      cwd: options.cwd,
      env: shellEnvironment(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch {
    throw new Error("Local shell spawn failed");
  }
  let exited = false;
  let closed = false;
  let failure;
  child.on("error", () => {
    failure = "Local shell spawn failed";
  });
  child.on("exit", (code, signal) => {
    exited = true;
    result.exitCode = code;
    result.signal = signal;
  });
  child.on("close", () => {
    closed = true;
  });
  for (const name of ["stdout", "stderr"]) {
    let head = "";
    let tail = "";
    let total = 0;
    const headLimit = Math.ceil(streamLimit / 2);
    const tailLimit = streamLimit - headLimit;
    child[name].setEncoding("utf8");
    child[name].on("error", () => {
      failure = "Local shell stream failed";
    });
    child[name].on("data", (data) => {
      total += data.length;
      const take = Math.min(headLimit - head.length, data.length);
      head += data.slice(0, take);
      if (tailLimit > 0) tail = (tail + data.slice(take)).slice(-tailLimit);
      const truncated = total > streamLimit;
      const marker = "\n\u2026 truncated \u2026\n";
      if (!truncated) result[name] = head + tail;
      else {
        const room = Math.max(0, streamLimit - marker.length);
        const prefix = Math.ceil(room / 2);
        const suffix = room - prefix;
        result[name] = streamLimit >= marker.length ? head.slice(0, prefix) + marker + (suffix ? tail.slice(-suffix) : "") : head + tail;
        result[`${name}Truncated`] = true;
        result.truncated = true;
      }
    });
  }
  const started = performance.now();
  try {
    while (!exited && !failure) {
      check();
      if (performance.now() - started >= timeout) throw new Error("Local shell timed out");
      await delay(Math.min(10, timeout));
    }
  } catch (error) {
    failure = error.message;
  }
  try {
    if (child.pid !== void 0) {
      let alive = true;
      const termEnd = performance.now() + 200;
      try {
        await sendGroup(child.pid, "SIGTERM", termEnd);
        while (performance.now() < termEnd) {
          alive = await localProcessGroupAlive(child.pid, termEnd);
          if (!alive) break;
          await delay(Math.min(10, Math.max(0, termEnd - performance.now())));
        }
      } catch {
        alive = true;
      }
      if (alive) {
        const killEnd = performance.now() + 500;
        await sendGroup(child.pid, "SIGKILL", killEnd);
        while (performance.now() < killEnd) {
          alive = await localProcessGroupAlive(child.pid, killEnd);
          if (!alive) break;
          await delay(Math.min(10, Math.max(0, killEnd - performance.now())));
        }
        if (alive) failure = "Local shell cleanup uncertain";
      }
    }
    const closeEnd = performance.now() + 500;
    while (!closed && performance.now() < closeEnd) await delay(10);
    if (!closed) failure = "Local shell stream closure uncertain";
  } catch {
    failure = "Local shell cleanup uncertain";
  } finally {
    child.stdout.destroy();
    child.stderr.destroy();
  }
  if (failure) throw new Error(failure);
  check();
  if (result.signal !== null || result.exitCode === null) throw new Error("Local shell terminated abnormally");
  result.ok = result.exitCode === 0;
  if (!result.ok && !options.settle) {
    throw new LocalShellExitError(result);
  }
  return result;
}

// src/protocol.ts
var FABRIC_COMMIT_ACKNOWLEDGEMENT = /* @__PURE__ */ Symbol("fabric.commitAcknowledgement");
var fabricCommitAcknowledgement = (error) => {
  if (!(error instanceof Error)) return void 0;
  const marker = error[FABRIC_COMMIT_ACKNOWLEDGEMENT];
  return marker?.version === 1 && ["set", "delete", "write", "edit"].includes(marker.operation) ? marker : void 0;
};

// src/runtime/deadline.ts
import { performance as performance2 } from "node:perf_hooks";
var FabricDeadline = class {
  constructor(timeoutMs, maximumMs, now = () => performance2.now()) {
    this.now = now;
    this.startedAt = now();
    const maximum = Math.max(1, Math.floor(maximumMs));
    this.maximumAt = this.startedAt + maximum;
    this.#expiresAt = this.startedAt + Math.min(maximum, Math.max(1, Math.floor(timeoutMs)));
  }
  now;
  startedAt;
  maximumAt;
  #expiresAt;
  get expiresAt() {
    return this.#expiresAt;
  }
  get effectiveTimeoutMs() {
    return Math.round(this.#expiresAt - this.startedAt);
  }
  get expired() {
    return this.now() >= this.#expiresAt;
  }
  remainingMs() {
    return Math.max(0, this.#expiresAt - this.now());
  }
  extendTo(timeoutMs) {
    if (this.expired || !Number.isFinite(timeoutMs)) return this.effectiveTimeoutMs;
    const requested = this.startedAt + Math.max(1, Math.floor(timeoutMs));
    this.#expiresAt = Math.min(this.maximumAt, Math.max(this.#expiresAt, requested));
    return this.effectiveTimeoutMs;
  }
  throwIfExpired() {
    if (this.expired) throw new Error(`Execution timed out after ${this.effectiveTimeoutMs}ms`);
  }
  /** Force the deadline to have passed, without touching the clock.
   *
   * The VM runs on its own thread and cannot observe a host clock the host
   * itself controls (for example a clock the embedder has replaced). When the
   * authoritative host side reports the deadline as passed, the VM must reach
   * the same conclusion instead of completing on a clock that disagrees. */
  expireNow() {
    this.#expiresAt = this.startedAt;
  }
};

// src/runtime/quickjs-runtime.ts
import { performance as performance3 } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { randomUUID as randomUUID2 } from "node:crypto";

// node_modules/.pnpm/@jitl+quickjs-singlefile-mjs-release-sync@0.32.0/node_modules/@jitl/quickjs-singlefile-mjs-release-sync/dist/index.mjs
var variant = { type: "sync", importFFI: () => import("./ffi-2CFDPMEQ.js").then((mod) => mod.QuickJSFFI), importModuleLoader: () => import("./emscripten-module-Q67P5WYC-K2EI3T2U.js").then((mod) => mod.default) };
var src_default = variant;

// node_modules/.pnpm/quickjs-emscripten-core@0.32.0/node_modules/quickjs-emscripten-core/dist/index.mjs
async function newQuickJSWASMModuleFromVariant(variantOrPromise) {
  let variant2 = smartUnwrap(await variantOrPromise), [wasmModuleLoader, QuickJSFFI, { QuickJSWASMModule: QuickJSWASMModule2 }] = await Promise.all([variant2.importModuleLoader().then(smartUnwrap), variant2.importFFI(), import("./module-ES6BEMUI-NDJYL2FJ.js").then(smartUnwrap)]), wasmModule = await wasmModuleLoader();
  wasmModule.type = "sync";
  let ffi = new QuickJSFFI(wasmModule);
  return new QuickJSWASMModule2(wasmModule, ffi);
}
function smartUnwrap(val) {
  return val && "default" in val && val.default ? val.default && "default" in val.default && val.default.default ? val.default.default : val.default : val;
}
function newVariant(baseVariant, options) {
  return { ...baseVariant, async importModuleLoader() {
    let moduleLoader = smartUnwrap(await baseVariant.importModuleLoader());
    return async function() {
      let moduleLoaderArg = options.emscriptenModule ? { ...options.emscriptenModule } : {}, log = options.log ?? ((...args) => debugLog("newVariant moduleLoader:", ...args)), tapValue = (message, val) => (log(...message, val), val), force = (val) => typeof val == "function" ? val() : val;
      (options.wasmLocation || options.wasmSourceMapLocation || options.locateFile) && (moduleLoaderArg.locateFile = (fileName, relativeTo) => {
        let args = { fileName, relativeTo };
        if (fileName.endsWith(".wasm") && options.wasmLocation !== void 0) return tapValue(["locateFile .wasm: provide wasmLocation", args], options.wasmLocation);
        if (fileName.endsWith(".map")) {
          if (options.wasmSourceMapLocation !== void 0) return tapValue(["locateFile .map: provide wasmSourceMapLocation", args], options.wasmSourceMapLocation);
          if (options.wasmLocation && !options.locateFile) return tapValue(["locateFile .map: infer from wasmLocation", args], options.wasmLocation + ".map");
        }
        return options.locateFile ? tapValue(["locateFile: use provided fn", args], options.locateFile(fileName, relativeTo)) : tapValue(["locateFile: unhandled, passthrough", args], fileName);
      }), options.wasmBinary && (moduleLoaderArg.wasmBinary = await force(options.wasmBinary)), options.wasmMemory && (moduleLoaderArg.wasmMemory = await force(options.wasmMemory));
      let optionsWasmModule = options.wasmModule, modulePromise;
      optionsWasmModule && (moduleLoaderArg.instantiateWasm = async (imports, onSuccess) => {
        modulePromise ?? (modulePromise = Promise.resolve(force(optionsWasmModule)));
        let wasmModule = await modulePromise;
        if (!wasmModule) throw new QuickJSEmscriptenModuleError(`options.wasmModule returned ${String(wasmModule)}`);
        let instance = await WebAssembly.instantiate(wasmModule, imports);
        return onSuccess(instance), instance.exports;
      }), moduleLoaderArg.monitorRunDependencies = (left) => {
        log("monitorRunDependencies:", left);
      }, moduleLoaderArg.quickjsEmscriptenInit = () => newMockExtensions(log);
      let resultPromise = moduleLoader(moduleLoaderArg), extensions = moduleLoaderArg.quickjsEmscriptenInit?.(log);
      if (optionsWasmModule && extensions?.receiveWasmOffsetConverter && !extensions.existingWasmOffsetConverter) {
        let wasmBinary = await force(options.wasmBinary) ?? new ArrayBuffer(0);
        modulePromise ?? (modulePromise = Promise.resolve(force(optionsWasmModule)));
        let wasmModule = await modulePromise;
        if (!wasmModule) throw new QuickJSEmscriptenModuleError(`options.wasmModule returned ${String(wasmModule)}`);
        extensions.receiveWasmOffsetConverter(wasmBinary, wasmModule);
      }
      if (extensions?.receiveSourceMapJSON) {
        let loadedSourceMapData = await force(options.wasmSourceMapData);
        typeof loadedSourceMapData == "string" ? extensions.receiveSourceMapJSON(JSON.parse(loadedSourceMapData)) : loadedSourceMapData ? extensions.receiveSourceMapJSON(loadedSourceMapData) : extensions.receiveSourceMapJSON({ version: 3, names: [], sources: [], mappings: "" });
      }
      return resultPromise;
    };
  } };
}
function newMockExtensions(log) {
  let mockMessage = "mock called, emscripten module may not be initialized yet";
  return { mock: true, removeRunDependency(name) {
    log(`${mockMessage}: removeRunDependency called:`, name);
  }, receiveSourceMapJSON(data) {
    log(`${mockMessage}: receiveSourceMapJSON called:`, data);
  }, WasmOffsetConverter: void 0, receiveWasmOffsetConverter(bytes, mod) {
    log(`${mockMessage}: receiveWasmOffsetConverter called:`, bytes, mod);
  } };
}

// src/runtime/guest-stack-map.ts
var BASE64_VALUES = (() => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const table = /* @__PURE__ */ new Map();
  for (let index = 0; index < alphabet.length; index += 1) {
    table.set(alphabet[index], index);
  }
  return table;
})();
var decodeVlqSegment = (segment) => {
  const values = [];
  let index = 0;
  while (index < segment.length) {
    let value = 0;
    let shift = 0;
    let continuation = true;
    while (continuation) {
      const digit = BASE64_VALUES.get(segment[index]);
      if (digit === void 0) return values;
      index += 1;
      continuation = (digit & 32) !== 0;
      value += (digit & 31) * 2 ** shift;
      shift += 5;
    }
    values.push((value & 1) === 1 ? -(value >> 1) : value >> 1);
  }
  return values;
};
var decodeMappings = (mappings) => {
  const lines = [];
  let sourceLine = 0;
  let sourceColumn = 0;
  for (const line of mappings.split(";")) {
    const segments = [];
    let generatedColumn = 0;
    for (const rawSegment of line.split(",")) {
      if (!rawSegment) continue;
      const values = decodeVlqSegment(rawSegment);
      if (values.length < 4) continue;
      generatedColumn += values[0];
      sourceLine += values[2];
      sourceColumn += values[3];
      segments.push({ generatedColumn, sourceLine, sourceColumn });
    }
    lines.push(segments);
  }
  return lines;
};
var createGuestStackMap = (sourceMapText) => {
  if (!sourceMapText) return void 0;
  let mappings;
  try {
    const parsed = JSON.parse(sourceMapText);
    if (typeof parsed.mappings !== "string") return void 0;
    mappings = parsed.mappings;
  } catch {
    return void 0;
  }
  let decoded;
  return {
    lookup(line, column) {
      decoded ??= decodeMappings(mappings);
      const segments = decoded[line - 1];
      if (!segments) return void 0;
      const target = column - 1;
      let best;
      for (const segment of segments) {
        if (segment.generatedColumn > target) break;
        best = segment;
      }
      best ??= segments[0];
      if (!best) return void 0;
      return { line: best.sourceLine, column: best.sourceColumn + 1 };
    }
  };
};
var GUEST_FRAME_PATTERN = /kiro-fabric-guest\.js:(\d+):(\d+)/g;
var remapGuestErrorText = (text, stackMap, guestLineCount) => {
  if (!stackMap || !text.includes("kiro-fabric-guest.js:")) return text;
  return text.replace(GUEST_FRAME_PATTERN, (match, lineText, columnText) => {
    const line = Number(lineText);
    const mapped = stackMap.lookup(line, Number(columnText));
    if (mapped) return `guest code:${mapped.line}:${mapped.column}`;
    if (guestLineCount !== void 0 && line > guestLineCount) return "fabric driver";
    return match;
  });
};

// src/runtime/source-limit.ts
import { Buffer as Buffer2 } from "node:buffer";
var DEFAULT_EXECUTOR_SOURCE_BYTES = 256 * 1024;
var MIN_EXECUTOR_SOURCE_BYTES = 1024;
var MAX_EXECUTOR_SOURCE_BYTES = 2 * 1024 * 1024;
var MAX_FABRIC_PAYLOAD_KEYS = 128;
var MAX_FABRIC_PAYLOAD_KEY_BYTES = 1024;
var effectiveFabricSourceLimit = (value) => Number.isSafeInteger(value) ? Math.max(MIN_EXECUTOR_SOURCE_BYTES, Math.min(MAX_EXECUTOR_SOURCE_BYTES, value)) : DEFAULT_EXECUTOR_SOURCE_BYTES;
var fabricSourceLimitError = (code, maximum) => {
  const bytes = Buffer2.byteLength(code, "utf8");
  return bytes > maximum ? `Fabric source exceeds ${maximum} bytes: received ${bytes}` : void 0;
};
var fabricPayloadsLimitError = (payloads, maximum) => {
  if (payloads === void 0) return void 0;
  const keys = Object.keys(payloads);
  if (keys.length > MAX_FABRIC_PAYLOAD_KEYS) return `Fabric payloads exceed ${MAX_FABRIC_PAYLOAD_KEYS} keys`;
  let total = 0;
  for (const key of keys) {
    if (Buffer2.byteLength(key, "utf8") > MAX_FABRIC_PAYLOAD_KEY_BYTES) return "Fabric payload key is too large";
    const value = payloads[key];
    if (typeof value !== "string") return "Fabric payload values must be strings";
    total += Buffer2.byteLength(key, "utf8") + Buffer2.byteLength(value, "utf8");
    if (total > maximum) return `Fabric payloads exceed ${maximum} bytes: received ${total}`;
  }
  return void 0;
};
var fabricTranspiledLimitError = (code) => {
  const maximum = MAX_EXECUTOR_SOURCE_BYTES * 4;
  const bytes = Buffer2.byteLength(code, "utf8");
  return bytes > maximum ? `Transpiled guest source exceeds ${maximum} bytes: received ${bytes}` : void 0;
};

// src/runtime/guest-bootstrap.ts
var GUEST_SETUP = `
(() => {
  'use strict';
  const bridge = globalThis.__fabricHostCall;
  const prepareHostCall = globalThis.__fabricPrepareHostCall;
  delete globalThis.__fabricHostCall;
  delete globalThis.__fabricPrepareHostCall;

  // Capture every validator/promise primordial before guest code can mutate it.
  const apply = Reflect.apply;
  const ownKeys = Reflect.ownKeys;
  const objectGetPrototypeOf = Object.getPrototypeOf;
  const objectPrototype = Object.prototype;
  const arrayPrototype = Array.prototype;
  const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
  const objectHasOwn = Object.hasOwn;
  const objectKeys = Object.keys;
  const objectCreate = Object.create;
  const objectDefineProperty = Object.defineProperty;
  const objectFreeze = Object.freeze;
  const arrayIsArray = Array.isArray;
  const numberIsFinite = Number.isFinite;
  const stringCharCodeAt = String.prototype.charCodeAt;
  const jsonParse = JSON.parse;
  const jsonStringify = JSON.stringify;
  const weakHas = WeakSet.prototype.has;
  const weakAdd = WeakSet.prototype.add;
  const weakDelete = WeakSet.prototype.delete;
  const promiseThenMethod = Promise.prototype.then;
  const promiseResolveMethod = Promise.resolve;
  const promiseRaceMethod = Promise.race;
  const promiseAllMethod = Promise.all;
  const SafePromise = Promise;
  const SafeArray = Array;
  const SafeWeakSet = WeakSet;
  const SafeTypeError = TypeError;
  const SafeRangeError = RangeError;
  const SafeError = Error;
  const mathFloor = Math.floor;
  const mathMin = Math.min;
  const promiseThen = (promise, fulfilled, rejected) => apply(promiseThenMethod, promise, [fulfilled, rejected]);
  const promiseResolve = (value) => apply(promiseResolveMethod, SafePromise, [value]);
  const promiseRace = (values) => apply(promiseRaceMethod, SafePromise, [values]);
  const promiseAll = (values) => apply(promiseAllMethod, SafePromise, [values]);
  const configuredParallelLimit = globalThis.__fabricMaxParallelConcurrency;
  delete globalThis.__fabricMaxParallelConcurrency;
  if (typeof configuredParallelLimit !== 'number' || !numberIsFinite(configuredParallelLimit) || configuredParallelLimit < 1) {
    throw new SafeTypeError('Fabric parallel limit is invalid');
  }
  const maxParallelConcurrency = mathFloor(configuredParallelLimit);

  const codeGenerationDenied = function () { throw new SafeTypeError('Dynamic code generation is disabled'); };
  const constructors = [
    Function,
    objectGetPrototypeOf(function* () {}).constructor,
    objectGetPrototypeOf(async function () {}).constructor,
    objectGetPrototypeOf(async function* () {}).constructor,
  ];
  for (const constructor of constructors) {
    objectDefineProperty(constructor.prototype, 'constructor', {
      value: codeGenerationDenied, writable: false, configurable: false,
    });
  }
  objectDefineProperty(globalThis, 'eval', { value: codeGenerationDenied, writable: false, configurable: false });
  objectDefineProperty(globalThis, 'Function', { value: codeGenerationDenied, writable: false, configurable: false });

  // ECMAScript array indices stop at 2^32-2 (the maximum is 2^32-2, not 2^32-1).
  // A larger all-digit key is an ordinary property that JSON serialization drops
  // from the element list, so accepting it would let the guest return a value the
  // host-side validator rejects and hide data from the caller.
  const MAX_ARRAY_INDEX = '4294967294';
  const arrayIndex = (key) => {
    if (key === '0') return true;
    if (!key || key[0] === '0') return false;
    for (let index = 0; index < key.length; index++) {
      const code = apply(stringCharCodeAt, key, [index]);
      if (code < 48 || code > 57) return false;
    }
    return key.length < MAX_ARRAY_INDEX.length
      || (key.length === MAX_ARRAY_INDEX.length && key <= MAX_ARRAY_INDEX);
  };
  const strictJsonText = (root) => {
    const seen = new SafeWeakSet();
    let nodes = 0;
    const visit = (value, depth) => {
      if (++nodes > 100000 || depth > 64) throw new SafeTypeError('Result exceeds strict JSON structural limits');
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
      if (typeof value === 'number') {
        if (!numberIsFinite(value)) throw new SafeTypeError('Result contains a non-finite number');
        return value;
      }
      if (typeof value !== 'object') throw new SafeTypeError('Result contains a non-JSON value');
      if (apply(weakHas, seen, [value])) throw new SafeTypeError('Result contains a cycle');
      const prototype = objectGetPrototypeOf(value);
      if (prototype !== objectPrototype && prototype !== arrayPrototype && prototype !== null) {
        throw new SafeTypeError('Result contains an unsupported exotic object');
      }
      apply(weakAdd, seen, [value]);
      const descriptors = objectGetOwnPropertyDescriptors(value);
      for (const key of ownKeys(descriptors)) if (typeof key === 'symbol') throw new SafeTypeError('Result contains a symbol key');
      let copy;
      if (arrayIsArray(value)) {
        copy = [];
        for (const key of objectKeys(descriptors)) {
          if (key !== 'length' && !arrayIndex(key)) throw new SafeTypeError('Result contains a non-index array property');
        }
        for (let index = 0; index < value.length; index++) {
          const descriptor = descriptors[index];
          if (!descriptor || !objectHasOwn(descriptor, 'value')) throw new SafeTypeError('Result contains an accessor or sparse array');
          objectDefineProperty(copy, index, { value: visit(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
        }
      } else {
        copy = objectCreate(null);
        for (const key of objectKeys(descriptors)) {
          const descriptor = descriptors[key];
          if (!objectHasOwn(descriptor, 'value')) throw new SafeTypeError('Result contains an accessor');
          objectDefineProperty(copy, key, { value: visit(descriptor.value, depth + 1), enumerable: true });
        }
      }
      apply(weakDelete, seen, [value]);
      return copy;
    };
    const text = apply(jsonStringify, JSON, [visit(root, 0)]);
    if (typeof text !== 'string' || text.length > 8000000) throw new SafeTypeError('Result exceeds strict JSON byte limit');
    return text;
  };
  const parseStrict = (text) => apply(jsonParse, JSON, [text]);
  // Bounded print formatting runs inside the VM: an over-cap string is sliced
  // here so the host never copies the whole value across the bridge. Mirrors the
  // host formatter's JSON shape for non-strings and never throws.
  const boundLog = (value, maxChars) => {
    if (typeof maxChars !== 'number' || !numberIsFinite(maxChars) || maxChars <= 0) return '';
    if (typeof value === 'string') return value.length <= maxChars ? value : value.slice(0, maxChars);
    let text;
    try { text = strictJsonText(value); }
    catch { text = '[value outside bounded JSON]'; }
    return text.length <= maxChars ? text : text.slice(0, maxChars);
  };
  // One execution-wide semaphore covers friendly APIs, tools.call, direct
  // Promise.all fan-out, and nested parallel helpers alike. This queues excess
  // bridge work before it reaches the host's fail-closed concurrency quota.
  const hostCallWaiters = objectCreate(null);
  let activeHostCalls = 0;
  let hostWaiterHead = 0;
  let hostWaiterTail = 0;
  let hostCallsStopped = false;
  let hostCallsStopReason;
  const acquireHostCall = () => {
    if (hostCallsStopped) {
      return new SafePromise((_resolve, reject) => reject(hostCallsStopReason));
    }
    if (activeHostCalls < maxParallelConcurrency) {
      activeHostCalls += 1;
      return promiseResolve();
    }
    return new SafePromise((resolve, reject) => {
      hostCallWaiters[hostWaiterTail++] = { resolve, reject };
    });
  };
  const releaseHostCall = () => {
    if (!hostCallsStopped && hostWaiterHead < hostWaiterTail) {
      const waiter = hostCallWaiters[hostWaiterHead];
      delete hostCallWaiters[hostWaiterHead++];
      waiter.resolve();
      return;
    }
    activeHostCalls -= 1;
  };
  const stopQueuedHostCalls = (reason) => {
    if (hostCallsStopped) return;
    hostCallsStopped = true;
    hostCallsStopReason = reason;
    while (hostWaiterHead < hostWaiterTail) {
      const waiter = hostCallWaiters[hostWaiterHead];
      delete hostCallWaiters[hostWaiterHead++];
      waiter.reject(reason);
    }
  };
  const call = (ref, args = {}) => {
    // Snapshot and validate at API invocation, before a saturated semaphore
    // can defer the bridge. Later guest mutation must not change exact args.
    const argsText = strictJsonText(args);
    prepareHostCall(ref, argsText);
    return promiseThen(acquireHostCall(), () => {
      let operation;
      try {
        operation = promiseThen(bridge(ref, argsText), parseStrict);
      } catch (error) {
        releaseHostCall();
        throw error;
      }
      return promiseThen(operation, (value) => {
        releaseHostCall();
        return value;
      }, (error) => {
        releaseHostCall();
        throw error;
      });
    });
  };
  const parallel = async (items, mapperOrOptions, maybeOptions) => {
    if (!arrayIsArray(items)) throw new SafeTypeError('parallel expects an array');
    const mapped = typeof mapperOrOptions === 'function';
    if (!mapped) {
      for (let index = 0; index < items.length; index++) {
        if (typeof items[index] !== 'function') {
          throw new SafeTypeError('parallel expects functions or an item mapper');
        }
      }
    }
    const itemCount = items.length;
    if (itemCount === 0) return [];
    const options = mapped ? maybeOptions : mapperOrOptions;
    const requested = typeof options === 'number'
      ? options
      : options && typeof options === 'object' && options.concurrency !== undefined
        ? options.concurrency
        : maxParallelConcurrency;
    if (typeof requested !== 'number' || !numberIsFinite(requested) || requested < 1) {
      throw new SafeRangeError('parallel concurrency must be a positive finite number');
    }
    const concurrency = mathMin(itemCount, maxParallelConcurrency, mathFloor(requested));
    const results = new SafeArray(itemCount);
    const workers = new SafeArray(concurrency);
    let cursor = 0;
    let stopped = false;
    for (let worker = 0; worker < concurrency; worker++) {
      workers[worker] = (async () => {
        while (!stopped && cursor < itemCount) {
          const index = cursor++;
          try {
            results[index] = mapped
              ? await apply(mapperOrOptions, undefined, [items[index], index])
              : await apply(items[index], undefined, []);
          } catch (error) {
            stopped = true;
            throw error;
          }
        }
      })();
    }
    await promiseAll(workers);
    return results;
  };
  let rejectExecution;
  const executionGate = new SafePromise((_resolve, reject) => { rejectExecution = reject; });
  const cancel = (message) => {
    const reason = new SafeError(message);
    stopQueuedHostCalls(reason);
    rejectExecution(reason);
  };
  const run = (main) => promiseThen(promiseRace([promiseThen(promiseResolve(), main), executionGate]), strictJsonText);
  globalThis.tools = objectFreeze({
    providers: () => call("fabric.providers"),
    list: () => call("fabric.list"),
    listPage: (args = {}) => call("fabric.listPage", args),
    searchPage: (args) => call("fabric.searchPage", args),
    describePage: (args) => call("fabric.describePage", args),
    search: (input) => call("fabric.search", typeof input === "string" ? { query: input } : input),
    describe: (input) => call("fabric.describe", typeof input === "string" ? { ref: input } : input),
    call: (input) => call("fabric.call", input),
  });
  globalThis.fabric = objectFreeze({
    info: () => call("fabric.info"), help: (args) => call("fabric.help", args),
    workspace: (args) => call("fabric.workspace", args),
  });
  // Guest composition only: both calls retain registry validation, read approvals,
  // quotas and cancellation. Never auto-drain search pages or read continuations.
  const searchRead = async (input) => {
    const args = parseStrict(strictJsonText(input));
    if (!args || typeof args !== 'object' || arrayIsArray(args)) throw new SafeTypeError('local.searchRead expects an object');
    const { contextLines = 3, maxWindows = 8, maxChars, ...query } = args;
    const integerInRange = (value, min, max) => typeof value === 'number' && numberIsFinite(value) && mathFloor(value) === value && value >= min && value <= max;
    if (!integerInRange(contextLines, 0, 50)) throw new SafeRangeError('local.searchRead contextLines must be an integer in 0..50');
    if (!integerInRange(maxWindows, 1, 32)) throw new SafeRangeError('local.searchRead maxWindows must be an integer in 1..32');
    if (maxChars !== undefined && !integerInRange(maxChars, 1000, 40000)) throw new SafeRangeError('local.searchRead maxChars must be an integer in 1000..40000');
    if (objectHasOwn(query, 'paginate') || objectHasOwn(query, 'cursor') || objectHasOwn(query, 'snapshotScope')) throw new SafeTypeError('local.searchRead does not paginate; use local.grep for search pages');
    const search = await call('local.grep', query);
    const byPath = objectCreate(null);
    for (const match of search.matches) {
      if (!objectHasOwn(byPath, match.path)) byPath[match.path] = [];
      byPath[match.path].push(match.line);
    }
    const windows = [];
    const append = (path, start, end) => {
      for (let offset = start; offset <= end; offset += 2000) {
        windows.push({ path, offset, limit: mathMin(2000, end - offset + 1) });
      }
    };
    for (const path of objectKeys(byPath).sort()) {
      const lines = byPath[path].sort((left, right) => left - right);
      let start = 0, end = 0;
      for (const line of lines) {
        const from = line > contextLines ? line - contextLines : 1, to = line + contextLines;
        if (start && from <= end + 1) { if (to > end) end = to; continue; }
        if (start) append(path, start, end);
        start = from; end = to;
      }
      if (start) append(path, start, end);
    }
    const selected = windows.slice(0, maxWindows), deferred = windows.slice(maxWindows);
    const read = selected.length
      ? await call('local.readMany', { windows: selected, ...(maxChars === undefined ? {} : { maxChars }) })
      : { files: [], remaining: [], complete: true, unreadTails: [] };
    // Preserve observed snapshots for later windows on already-read files.
    const hashes = objectCreate(null);
    for (const file of read.files) hashes[file.path] = file.sha256;
    for (const window of deferred) if (objectHasOwn(hashes, window.path)) window.expectedSha256 = hashes[window.path];
    // Unlike a single readMany response, this backlog may exceed 32 windows.
    // Return all of it; callers continue in <=32-window chunks, never by re-searching.
    return { ...search, ...read, remaining: [...read.remaining, ...deferred], complete: read.complete && deferred.length === 0 };
  };
  globalThis.local = objectFreeze({
    read: (args) => call("local.read", args), grep: (args) => call("local.grep", args),
    readMany: (args) => call("local.readMany", args),
    readEvidence: (args) => call("local.readEvidence", args),
    find: (args) => call("local.find", args), list: (args = {}) => call("local.list", args),
    write: (args) => call("local.write", args), edit: (args) => call("local.edit", args),
    shell: (args) => call("local.shell", args), searchRead,
  });
  const focusRead = async (input) => {
    const args = parseStrict(strictJsonText(input));
    if (!args || typeof args !== 'object' || arrayIsArray(args)) throw new SafeTypeError('repo.focusRead expects an object');
    const { maxWindows = 4, maxChars = 14000, partial = true, ...query } = args;
    const integerInRange = (value, min, max) => typeof value === 'number' && numberIsFinite(value) && mathFloor(value) === value && value >= min && value <= max;
    if (!integerInRange(maxWindows, 1, 32) || !integerInRange(maxChars, 1000, 40000) || typeof partial !== 'boolean') throw new SafeRangeError('Invalid repo.focusRead read budget');
    const navigation = await call('repo.focus', query);
    // The snapshot hash is mandatory when supplied. Never remove a stale hash
    // and reread old line numbers; return the reader failure and refresh focus.
    const windows = navigation.reads.slice(0, maxWindows);
    const sources = windows.length ? await call('local.readMany', { windows, maxChars, partial }) : null;
    return { navigation, sources, deferredReads: navigation.reads.slice(maxWindows) };
  };
  const repoGrep = async (input) => {
    const args = parseStrict(strictJsonText(input));
    if (!args || typeof args !== 'object' || arrayIsArray(args) || typeof args.pattern !== 'string') throw new SafeTypeError('repo.grep expects a search object');
    // Local contracts validate every option. Keep exact matching separate from
    // hints, and never reinterpret native regex/glob/cursor semantics.
    const settings = await call('repo.settings', {});
    const mode = settings.config.tools.grepMode;
    const symbolLike = /^[A-Za-z_$][A-Za-z0-9_$]*(?:[.#:][A-Za-z_$][A-Za-z0-9_$]*)*$/.test(args.pattern) || /^(?:[.][/]|[/])?[A-Za-z0-9_@.-]+(?:[/][A-Za-z0-9_@.{}:$-]+)+$/.test(args.pattern);
    const bare = objectKeys(args).length === 1;
    let advisory = null, diagnostic;
    const hint = async () => {
      try { const value = await call('repo.augment', { query: args.pattern, ...(args.path === undefined ? {} : {path: args.path}), maxTokens: settings.config.tools.grepAugmentBudget }); return value.status === 'ok' ? value : null; }
      catch (_) { diagnostic = 'Graph hint unavailable; exact native search remains authoritative.'; return null; }
    };
    if (mode === 'replace' && bare && symbolLike) {
      advisory = await hint();
      if (advisory) return { native: null, advisory, replacement: true };
    }
    const native = await call('local.grep', args);
    if (mode === 'augment' && symbolLike) advisory = await hint();
    return { native, advisory, replacement: false, ...(diagnostic ? { diagnostic } : {}) };
  };
  globalThis.repo = objectFreeze({
    status: (args = {}) => call('repo.status', args), sketch: (args = {}) => call('repo.sketch', args),
    focus: (args) => call('repo.focus', args), augment: (args) => call('repo.augment', args), grep: repoGrep, dwell: (args = {}) => call('repo.dwell', args),
    impact: (args = {}) => call('repo.impact', args), result: (args) => call('repo.result', args),
    searchResult: (args) => call('repo.searchResult', args), anchors: (args = {}) => call('repo.anchors', args),
    rules: (args = {}) => call('repo.rules', args), adoptRules: (args) => call('repo.adoptRules', args),
    settings: (args = {}) => call('repo.settings', args), configure: (args) => call('repo.configure', args),
    reset: (args = {}) => call('repo.reset', args), reload: (args = {}) => call('repo.reload', args),
    sync: (args = {}) => call('repo.sync', args), focusRead,
  });
  globalThis.artifacts = objectFreeze({ read: (args) => call("artifacts.read", args), checkpoint: (args) => call("artifacts.checkpoint", args) });
  globalThis.state = objectFreeze({
    get: (args) => call("state.get", args), set: (args) => call("state.set", args),
    list: (args = {}) => call("state.list", args), search: (args) => call("state.search", args),
    delete: (args) => call("state.delete", args),
  });
  globalThis.mcp = objectFreeze({
    servers: (args = {}) => call("mcp.$servers", args),
    tools: (args) => call("mcp.$tools", args),
    toolsPage: (args) => call("mcp.$toolsPage", args),
    describePage: (args) => call("mcp.$describePage", args),
    describe: (args) => call("mcp.$describe", args),
    call: (args) => call("mcp.$call", args),
  });
  objectDefineProperty(globalThis, 'parallel', { value: parallel, writable: false, configurable: false });
  objectFreeze(globalThis.payloads);
  return objectFreeze({ run, cancel, boundLog });
})()
`;

// src/runtime/quickjs-runtime.ts
var QUICKJS_WASM_PAGE_BYTES = 65536;
var QUICKJS_WASM_FLOOR_BYTES = 16 * 1024 * 1024;
var quickJsHeapCeilingBytes = (memoryLimitBytes) => Math.max(
  QUICKJS_WASM_FLOOR_BYTES,
  Math.ceil(memoryLimitBytes / QUICKJS_WASM_PAGE_BYTES) * QUICKJS_WASM_PAGE_BYTES
);
var createQuickJsModule = (heapCeilingBytes) => newQuickJSWASMModuleFromVariant(newVariant(src_default, {
  wasmMemory: new WebAssembly.Memory({
    initial: QUICKJS_WASM_FLOOR_BYTES / QUICKJS_WASM_PAGE_BYTES,
    maximum: heapCeilingBytes / QUICKJS_WASM_PAGE_BYTES
  })
}));
var formatValue = (value, maxChars = 1e5) => {
  if (typeof value === "string") return value.slice(0, maxChars);
  try {
    return fabricJsonText(value, Math.max(1, maxChars));
  } catch {
    return "[value outside bounded JSON]";
  }
};
var formatGuestFailure = (value) => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const { result: _diagnostic, failure: _failure, ...error } = value;
    if (typeof error.message === "string") {
      const name = typeof error.name === "string" && error.name ? error.name : "Error";
      const frames = typeof error.stack === "string" ? error.stack.split("\n").map((line) => line.trim()).filter((line) => line.includes("kiro-fabric-guest.js:")).slice(0, 5) : [];
      return formatValue(`${name}: ${error.message}${frames.length ? `
${frames.join("\n")}` : ""}`);
    }
    return formatValue(error);
  }
  return formatValue(value);
};
var jsonHandle = (context, jsonObject, jsonParse, value, maxChars) => {
  if (value === void 0 || value === null) return context.null;
  if (typeof value === "string") {
    assertFabricJsonBudget(value, maxChars);
    return context.newString(value);
  }
  if (typeof value === "boolean") return value ? context.true : context.false;
  if (typeof value === "number") {
    assertFabricJsonBudget(value, maxChars);
    return context.newNumber(value);
  }
  const serialized = context.newString(fabricJsonText(value, maxChars));
  try {
    return context.unwrapResult(context.callFunction(jsonParse, jsonObject, serialized));
  } finally {
    serialized.dispose();
  }
};
var QUICKJS_MAX_STACK_SIZE_BYTES = 256 * 1024;
var runQuickJsSandbox = async (code, hostCall, options, cancellationFlag) => {
  const isCancelled = () => options.signal?.aborted === true || cancellationFlag !== void 0 && Atomics.load(cancellationFlag, 0) !== 0;
  const maximum = Math.max(1, Math.floor(options.maxTimeoutMs));
  const requestedTimeoutMs = Math.min(maximum, Math.max(1, Math.floor(options.timeoutMs)));
  if (isCancelled()) return { value: void 0, logs: [], terminationReason: "aborted", error: "Execution cancelled", effectiveTimeoutMs: requestedTimeoutMs };
  const sourceLimit = effectiveFabricSourceLimit(options.maxSourceBytes);
  const inputLimit = effectiveFabricSourceLimit(options.maxInputBytes ?? options.maxSourceBytes);
  const inputError = fabricSourceLimitError(code, sourceLimit) ?? fabricPayloadsLimitError(options.payloads, inputLimit);
  if (inputError) return { value: void 0, logs: [], terminationReason: "runtime_error", error: inputError, effectiveTimeoutMs: requestedTimeoutMs };
  if (!Number.isSafeInteger(options.memoryLimitBytes) || options.memoryLimitBytes < 1 || options.memoryLimitBytes > 4294967295) {
    return { value: void 0, logs: [], terminationReason: "runtime_error", error: "QuickJS memory limit is outside the WASM32 range", effectiveTimeoutMs: requestedTimeoutMs };
  }
  const bundle = options.transpiledCode === void 0 ? (await import("./type-checker-C3TBVMY2.js")).transpileFabricCodeWithSourceMap(code) : { code: options.transpiledCode, sourceMap: options.transpiledSourceMap };
  const transpiledError = fabricTranspiledLimitError(bundle.code);
  if (transpiledError) {
    return { value: void 0, logs: [], terminationReason: "runtime_error", error: transpiledError, effectiveTimeoutMs: requestedTimeoutMs };
  }
  const stackMap = createGuestStackMap(bundle.sourceMap);
  const guestLineCount = bundle.code.split("\n").length;
  const tracer = options.tracer ?? DISABLED_TRACER;
  const execId = options.execId;
  const parentSpanId = options.parentSpanId;
  const heapCeilingBytes = quickJsHeapCeilingBytes(options.memoryLimitBytes);
  const moduleSpan = tracer.enabled ? tracer.span("init", "quickjs.module.acquire", execId, { shared: false, heapCeilingBytes }, parentSpanId) : void 0;
  const module = await createQuickJsModule(heapCeilingBytes);
  moduleSpan?.end();
  if (isCancelled()) {
    return { value: void 0, logs: [], terminationReason: "aborted", error: "Execution cancelled", effectiveTimeoutMs: requestedTimeoutMs };
  }
  const contextSpan = tracer.enabled ? tracer.span("init", "quickjs.context.create", execId, void 0, parentSpanId) : void 0;
  const context = module.newContext();
  const runtime = context.runtime;
  contextSpan?.end({ memoryLimitBytes: options.memoryLimitBytes, stackSizeBytes: QUICKJS_MAX_STACK_SIZE_BYTES });
  const jsonObject = context.getProp(context.global, "JSON");
  const jsonParse = context.getProp(jsonObject, "parse");
  runtime.setMemoryLimit(options.memoryLimitBytes);
  runtime.setMaxStackSize(QUICKJS_MAX_STACK_SIZE_BYTES);
  const deadline = new FabricDeadline(requestedTimeoutMs, maximum);
  let interrupted = false;
  let timedOut = false;
  let closing = false;
  let teardownCutoff;
  runtime.setInterruptHandler(() => {
    if (isCancelled()) return true;
    if (teardownCutoff !== void 0 && performance3.now() >= teardownCutoff) return true;
    if (!deadline.expired) return false;
    interrupted = true;
    return true;
  });
  const logs = [];
  const maxLogChars = Math.max(0, options.maxLogChars ?? 1e5);
  let logChars = 0;
  const hostController = new AbortController();
  const bridgeTasks = /* @__PURE__ */ new Set();
  const pendingPromises = /* @__PURE__ */ new Set();
  let deadlineTimer;
  let rejectDeadline;
  let abortListener;
  let activeHandle;
  let runExecution;
  let cancelExecution;
  let logFormatter;
  const rejectGuestGraph = (reason) => {
    if (cancelExecution && cancelExecution.alive !== false) {
      const message = context.newString(reason.message.slice(0, 4096));
      const called = context.callFunction(cancelExecution, context.global, message);
      message.dispose();
      if (called.error) called.error.dispose();
      else called.value.dispose();
    }
    for (const promise of pendingPromises) {
      if (promise.alive === false) continue;
      const handle = context.newError(reason.message.slice(0, 4096));
      promise.reject(handle);
      handle.dispose();
    }
    for (let index = 0; index < 1024; index++) {
      if (teardownCutoff !== void 0 && performance3.now() >= teardownCutoff) break;
      const jobs = runtime.executePendingJobs();
      if (jobs.error) {
        jobs.error.dispose();
        break;
      }
      if (jobs.value === 0) break;
    }
  };
  const abortHost = (reason) => {
    if (!hostController.signal.aborted) hostController.abort(reason);
    rejectGuestGraph(reason);
  };
  const issuedFailures = /* @__PURE__ */ new Map();
  const timeoutMessage = () => `Execution timed out after ${deadline.effectiveTimeoutMs}ms`;
  const expire = () => {
    if (closing || timedOut) return;
    if (!deadline.expired) {
      schedule();
      return;
    }
    timedOut = true;
    const error = new Error(timeoutMessage());
    abortHost(error);
    rejectDeadline?.(error);
  };
  const schedule = () => {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    deadlineTimer = setTimeout(expire, Math.max(0, deadline.remainingMs()));
  };
  const extendForExactAction = (ref, args) => {
    options.onPrepareHostCall?.(ref, args, deadline);
    const floor = options.minimumTimeoutMsForHostCall?.(ref, args);
    if (typeof floor !== "number" || !Number.isFinite(floor)) return;
    const before = deadline.effectiveTimeoutMs;
    const next = deadline.extendTo(floor);
    if (next > before) schedule();
  };
  try {
    const hostFunction = context.newFunction("__fabricHostCall", (refHandle, argsHandle) => {
      const ref = context.getString(refHandle);
      const argsText = context.getString(argsHandle);
      const parsed = JSON.parse(argsText);
      const args = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
      assertFabricJsonBudget(args);
      extendForExactAction(ref, args);
      const promise = context.newPromise();
      pendingPromises.add(promise);
      void promise.settled.then(
        () => pendingPromises.delete(promise),
        () => pendingPromises.delete(promise)
      );
      const rejectGuestPromise = (error) => {
        if (closing || promise.alive === false) return;
        const raw2 = error instanceof Error ? error.message : String(error);
        const handle = context.newError(raw2.slice(0, 4096));
        try {
          if (error instanceof LocalShellExitError) {
            const diagnostic = jsonHandle(context, jsonObject, jsonParse, error.result, options.maxNestedResultChars);
            try {
              context.setProp(handle, "result", diagnostic);
            } finally {
              diagnostic.dispose();
            }
          }
          const failure = fabricFailureMetadata(error);
          if (failure) {
            const text = JSON.stringify(failure);
            if (issuedFailures.size >= 128) issuedFailures.delete(issuedFailures.keys().next().value);
            issuedFailures.set(text, failure);
            const diagnostic = jsonHandle(context, jsonObject, jsonParse, failure, 32e3);
            try {
              context.setProp(handle, "failure", diagnostic);
            } finally {
              diagnostic.dispose();
            }
          }
          promise.reject(handle);
        } finally {
          handle.dispose();
        }
      };
      const raw = Promise.resolve().then(() => {
        deadline.throwIfExpired();
        return hostCall(ref, args, hostController.signal, deadline);
      });
      void raw.catch(() => void 0);
      const task = runAbortable(hostController.signal, () => raw).then((value2) => {
        if (closing || promise.alive === false) return;
        try {
          deadline.throwIfExpired();
          const handle = context.newString(fabricJsonText(value2, options.maxNestedResultChars));
          promise.resolve(handle);
          handle.dispose();
        } catch (error) {
          rejectGuestPromise(error);
        }
      }, rejectGuestPromise).then(() => {
        if (!closing) runtime.executePendingJobs();
      }, () => {
      });
      bridgeTasks.add(task);
      void task.then(
        () => bridgeTasks.delete(task),
        () => bridgeTasks.delete(task)
      );
      return promise.handle;
    });
    context.setProp(context.global, "__fabricHostCall", hostFunction);
    hostFunction.dispose();
    const prepareHostFunction = context.newFunction("__fabricPrepareHostCall", (refHandle, argsHandle) => {
      const ref = context.getString(refHandle);
      const parsed = JSON.parse(context.getString(argsHandle));
      const args = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
      assertFabricJsonBudget(args);
      extendForExactAction(ref, args);
    });
    context.setProp(context.global, "__fabricPrepareHostCall", prepareHostFunction);
    prepareHostFunction.dispose();
    const renderLogValue = (handle, maxChars) => {
      const limit = Math.max(0, Math.floor(maxChars));
      if (limit === 0) return "";
      if (logFormatter && logFormatter.alive !== false) {
        const budget = context.newNumber(limit);
        try {
          const formatted = context.callFunction(logFormatter, context.undefined, handle, budget);
          if (!formatted.error) {
            try {
              const text = context.getString(formatted.value);
              return text.length > limit ? text.slice(0, limit) : text;
            } finally {
              formatted.value.dispose();
            }
          }
          formatted.error.dispose();
        } catch {
        } finally {
          budget.dispose();
        }
      }
      return formatValue(context.dump(handle), limit).slice(0, limit);
    };
    const printFunction = context.newFunction("print", (...handles) => {
      let remaining = maxLogChars - logChars;
      if (remaining <= 0) return;
      const parts = [];
      for (const handle of handles) {
        const separator = parts.length > 0 ? " " : "";
        if (remaining <= separator.length) break;
        const rendered = renderLogValue(handle, remaining - separator.length);
        parts.push(`${separator}${rendered}`);
        remaining -= separator.length + rendered.length;
      }
      const line = parts.join("");
      if (line) logs.push(line);
      logChars += line.length;
    });
    context.setProp(context.global, "print", printFunction);
    printFunction.dispose();
    const payloadHandle = jsonHandle(
      context,
      jsonObject,
      jsonParse,
      options.payloads ?? {},
      MAX_FABRIC_JSON_CHARS
    );
    context.setProp(context.global, "payloads", payloadHandle);
    payloadHandle.dispose();
    const parallelLimitHandle = context.newNumber(Math.max(1, Math.min(64, Math.floor(options.maxConcurrentHostCalls ?? 1))));
    context.setProp(context.global, "__fabricMaxParallelConcurrency", parallelLimitHandle);
    parallelLimitHandle.dispose();
    const setupSpan = tracer.enabled ? tracer.span("eval", "quickjs.eval.setup", execId, { sourceBytes: GUEST_SETUP.length }, parentSpanId) : void 0;
    const setup = context.evalCode(GUEST_SETUP, "kiro-fabric-setup.js");
    setupSpan?.end();
    if (setup.error) {
      const error = formatValue(context.dump(setup.error));
      setup.error.dispose();
      return { value: void 0, logs, terminationReason: "runtime_error", error, effectiveTimeoutMs: deadline.effectiveTimeoutMs };
    }
    runExecution = context.getProp(setup.value, "run");
    cancelExecution = context.getProp(setup.value, "cancel");
    logFormatter = context.getProp(setup.value, "boundLog");
    setup.value.dispose();
    const guestEvalSpan = tracer.enabled ? tracer.span("eval", "quickjs.eval.guest", execId, { sourceBytes: Buffer.byteLength(bundle.code, "utf8") }, parentSpanId) : void 0;
    const evaluation = context.evalCode(bundle.code, "kiro-fabric-guest.js");
    runtime.executePendingJobs();
    guestEvalSpan?.end();
    if (evaluation.error) {
      const deadlineExceeded = interrupted || deadline.expired;
      const error = isCancelled() ? "Execution cancelled" : deadlineExceeded ? timeoutMessage() : remapGuestErrorText(formatValue(context.dump(evaluation.error)), stackMap, guestLineCount);
      evaluation.error.dispose();
      abortHost(new Error(error));
      return { value: void 0, logs, terminationReason: isCancelled() ? "aborted" : deadlineExceeded ? "timed_out" : "runtime_error", error, effectiveTimeoutMs: deadline.effectiveTimeoutMs };
    }
    evaluation.value.dispose();
    const main = context.getProp(context.global, "__kiroFabricMain");
    context.setProp(context.global, "__kiroFabricMain", context.undefined);
    const invoked = context.callFunction(runExecution, context.undefined, main);
    main.dispose();
    if (invoked.error) {
      const error = remapGuestErrorText(formatValue(context.dump(invoked.error)), stackMap, guestLineCount);
      invoked.error.dispose();
      return { value: void 0, logs, terminationReason: isCancelled() ? "aborted" : deadline.expired ? "timed_out" : "runtime_error", error: isCancelled() ? "Execution cancelled" : deadline.expired ? timeoutMessage() : error, effectiveTimeoutMs: deadline.effectiveTimeoutMs };
    }
    activeHandle = invoked.value;
    const resolution = context.resolvePromise(activeHandle);
    runtime.executePendingJobs();
    const deadlineRace = new Promise((_resolve, reject) => {
      rejectDeadline = reject;
      schedule();
    });
    const cancellation = new Promise((_resolve, reject) => {
      abortListener = () => {
        const error = new Error("Execution cancelled");
        abortHost(error);
        reject(error);
      };
      if (isCancelled()) abortListener();
      else options.signal?.addEventListener("abort", abortListener, { once: true });
    });
    const runSpan = tracer.enabled ? tracer.span("eval", "quickjs.run", execId, void 0, parentSpanId) : void 0;
    const settled = await Promise.race([resolution, deadlineRace, cancellation]);
    activeHandle.dispose();
    activeHandle = void 0;
    runSpan?.end();
    if (settled.error) {
      const deadlineExceeded = timedOut || interrupted || deadline.expired;
      const error = isCancelled() ? "Execution cancelled" : deadlineExceeded ? timeoutMessage() : remapGuestErrorText(formatGuestFailure(context.dump(settled.error)), stackMap, guestLineCount);
      const failureHandle = context.getProp(settled.error, "failure");
      let failure;
      try {
        failure = issuedFailures.get(JSON.stringify(context.dump(failureHandle)));
      } finally {
        failureHandle.dispose();
      }
      settled.error.dispose();
      abortHost(new Error(error));
      return { value: void 0, logs, terminationReason: isCancelled() ? "aborted" : deadlineExceeded || failure?.code === "timeout" ? "timed_out" : "runtime_error", error, ...failure ? { failure } : {}, effectiveTimeoutMs: deadline.effectiveTimeoutMs };
    }
    const serialized = context.getString(settled.value);
    settled.value.dispose();
    const value = JSON.parse(serialized);
    assertFabricJsonBudget(value, MAX_FABRIC_JSON_CHARS);
    if (isCancelled()) throw new Error("Execution cancelled");
    deadline.throwIfExpired();
    return { value, logs, terminationReason: "completed", effectiveTimeoutMs: deadline.effectiveTimeoutMs };
  } catch (error) {
    const deadlineExceeded = timedOut || interrupted || deadline.expired;
    const message = isCancelled() ? "Execution cancelled" : deadlineExceeded ? timeoutMessage() : error instanceof Error ? error.message : String(error);
    abortHost(new Error(message));
    return { value: void 0, logs, terminationReason: isCancelled() ? "aborted" : deadlineExceeded ? "timed_out" : "runtime_error", error: message, effectiveTimeoutMs: deadline.effectiveTimeoutMs };
  } finally {
    if (tracer.enabled) {
      try {
        const usageHandle = runtime.computeMemoryUsage();
        try {
          const raw = context.dump(usageHandle);
          const usage = {};
          for (const [key, entry] of Object.entries(raw)) if (typeof entry === "number" && Number.isFinite(entry)) usage[key] = entry;
          tracer.event("eval", "quickjs.memory", execId, { usage, hostRssBytes: process.memoryUsage().rss });
        } finally {
          usageHandle.dispose();
        }
      } catch {
      }
    }
    const teardownSpan = tracer.enabled ? tracer.span("teardown", "quickjs.teardown", execId, void 0, parentSpanId) : void 0;
    closing = true;
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (abortListener) options.signal?.removeEventListener("abort", abortListener);
    teardownCutoff = performance3.now() + Math.max(0, options.cleanupGraceMs ?? 100);
    abortHost(new Error("Execution request ended"));
    await settleWithin(bridgeTasks, Math.max(0, options.cleanupGraceMs ?? 100));
    for (let index = 0; index < 1024; index++) {
      if (performance3.now() >= teardownCutoff) break;
      const jobs = runtime.executePendingJobs();
      if (jobs.error) {
        jobs.error.dispose();
        break;
      }
      if (jobs.value === 0) break;
    }
    if (activeHandle?.alive !== false) activeHandle?.dispose();
    for (const promise of pendingPromises) if (promise.alive !== false) promise.dispose();
    if (cancelExecution && cancelExecution.alive !== false) cancelExecution.dispose();
    if (runExecution && runExecution.alive !== false) runExecution.dispose();
    if (logFormatter && logFormatter.alive !== false) logFormatter.dispose();
    jsonParse.dispose();
    jsonObject.dispose();
    context.dispose();
    teardownSpan?.end();
  }
};
var SANDBOX_WORKER_IDLE_MS = 6e4;
var SANDBOX_WORKER_BACKSTOP_MS = 1e3;
var SANDBOX_WORKER_MEMORY_MB = 256;
var sandboxWorkerUrl = () => import.meta.url.endsWith(".ts") ? new URL("../../dist/runtime/sandbox-worker-entry.js", import.meta.url) : new URL("../runtime/sandbox-worker-entry.js", import.meta.url);
var transferredHostFailure = (error) => {
  const failure = fabricFailureMetadata(error);
  const shellKind = error instanceof LocalShellExitError ? "shell" : void 0;
  const acknowledgement = error?.[FABRIC_COMMIT_ACKNOWLEDGEMENT];
  const committed = acknowledgement && typeof acknowledgement === "object" && acknowledgement.version === 1 && typeof acknowledgement.operation === "string" ? { version: 1, operation: acknowledgement.operation } : void 0;
  return {
    error: (error instanceof Error ? error.message : String(error)).slice(0, 4096),
    ...failure ? { failure } : {},
    ...shellKind ? { shellKind } : {},
    ...shellKind ? { shellResult: error.result } : {},
    ...committed ? { committed } : {}
  };
};
var sandboxCancelledResult = (effectiveTimeoutMs) => ({
  value: void 0,
  logs: [],
  terminationReason: "aborted",
  error: "Execution cancelled",
  effectiveTimeoutMs
});
var QuickJsRuntime = class {
  #slots = /* @__PURE__ */ new Set();
  #terminations = /* @__PURE__ */ new Set();
  #idle;
  #closed = false;
  #spawn() {
    const worker = new Worker(sandboxWorkerUrl(), {
      resourceLimits: { maxOldGenerationSizeMb: SANDBOX_WORKER_MEMORY_MB, stackSizeMb: 4 }
    });
    const slot = { worker, busy: false, idleTimer: void 0, handler: void 0, fault: void 0 };
    worker.unref();
    worker.on("message", (message) => slot.handler?.(message));
    worker.on("error", (error) => {
      this.#drop(slot);
      slot.fault?.(error instanceof Error ? error.message : String(error));
    });
    worker.on("exit", (code) => {
      this.#drop(slot);
      slot.fault?.(`Sandbox worker exited before replying (${code})`);
    });
    this.#slots.add(slot);
    return slot;
  }
  #drop(slot) {
    if (slot.idleTimer) {
      clearTimeout(slot.idleTimer);
      slot.idleTimer = void 0;
    }
    if (this.#idle === slot) this.#idle = void 0;
    this.#slots.delete(slot);
  }
  #terminate(slot) {
    if (slot.termination) return slot.termination;
    this.#drop(slot);
    const termination = slot.worker.terminate().then(() => void 0);
    slot.termination = termination;
    this.#terminations.add(termination);
    void termination.then(() => this.#terminations.delete(termination), () => {
      this.#closed = true;
    });
    return termination;
  }
  #acquire() {
    const idle = this.#idle;
    if (idle && !idle.busy) {
      this.#idle = void 0;
      if (idle.idleTimer) {
        clearTimeout(idle.idleTimer);
        idle.idleTimer = void 0;
      }
      return idle;
    }
    return this.#spawn();
  }
  /** Retain at most one warm worker: concurrent completions must not accumulate
   * idle threads, and a retired worker must not linger. */
  #release(slot) {
    slot.busy = false;
    slot.handler = void 0;
    slot.fault = void 0;
    if (this.#closed || !this.#slots.has(slot) || this.#idle !== void 0) {
      void this.#terminate(slot);
      return;
    }
    this.#idle = slot;
    slot.idleTimer = setTimeout(() => {
      void this.#terminate(slot);
    }, SANDBOX_WORKER_IDLE_MS);
    slot.idleTimer.unref();
  }
  /** Containment boundary. A worker fault, a WebAssembly-level abort, or an
   * unresponsive thread must surface as a controlled result rather than
   * rejecting the caller's execution or escaping into the host service. */
  async execute(code, hostCall, options) {
    const maximum = Math.max(1, Math.floor(options.maxTimeoutMs));
    const requestedTimeoutMs = Math.min(maximum, Math.max(1, Math.floor(options.timeoutMs)));
    if (options.signal?.aborted) return sandboxCancelledResult(requestedTimeoutMs);
    const sourceLimit = effectiveFabricSourceLimit(options.maxSourceBytes);
    const inputLimit = effectiveFabricSourceLimit(options.maxInputBytes ?? options.maxSourceBytes);
    const inputError = fabricSourceLimitError(code, sourceLimit) ?? fabricPayloadsLimitError(options.payloads, inputLimit);
    if (inputError) return { value: void 0, logs: [], terminationReason: "runtime_error", error: inputError, effectiveTimeoutMs: requestedTimeoutMs };
    if (!Number.isSafeInteger(options.memoryLimitBytes) || options.memoryLimitBytes < 1 || options.memoryLimitBytes > 4294967295) {
      return { value: void 0, logs: [], terminationReason: "runtime_error", error: "QuickJS memory limit is outside the WASM32 range", effectiveTimeoutMs: requestedTimeoutMs };
    }
    if (this.#closed) return { value: void 0, logs: [], terminationReason: "runtime_error", error: "Sandbox runtime is closed", effectiveTimeoutMs: requestedTimeoutMs };
    try {
      return await this.#runInWorker(code, hostCall, options, requestedTimeoutMs, maximum);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const tracer = options.tracer ?? DISABLED_TRACER;
      if (tracer.enabled) tracer.event("teardown", "quickjs.fault", options.execId, { contained: true });
      return {
        value: void 0,
        logs: [],
        terminationReason: "runtime_error",
        error: `Virtual machine fault: ${detail}`.slice(0, 4096),
        effectiveTimeoutMs: requestedTimeoutMs
      };
    }
  }
  async #runInWorker(code, hostCall, options, requestedTimeoutMs, maximum) {
    const slot = this.#acquire();
    slot.busy = true;
    const tracer = options.tracer ?? DISABLED_TRACER;
    const controller = new AbortController();
    const executionId = randomUUID2();
    const hostCalls = /* @__PURE__ */ new Set();
    const startedAt = performance3.now();
    let mirror;
    const hostDeadline = () => mirror ??= new FabricDeadline(requestedTimeoutMs, maximum);
    const cleanupGraceMs = Math.max(0, options.cleanupGraceMs ?? 100);
    const spans = /* @__PURE__ */ new Map();
    let settled = false;
    let backstop;
    let cancellationBackstop;
    const cancellation = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    let cancelUnresponsive;
    const onAbort = () => {
      if (settled) return;
      Atomics.store(cancellation, 0, 1);
      cancellationBackstop ??= setTimeout(() => cancelUnresponsive?.(), cleanupGraceMs + SANDBOX_WORKER_BACKSTOP_MS);
      const reason = options.signal?.reason instanceof Error ? options.signal.reason : new Error("Execution cancelled");
      if (!controller.signal.aborted) controller.abort(reason);
      try {
        slot.worker.postMessage({ type: "abort", executionId, message: reason.message.slice(0, 4096) });
      } catch (error) {
        slot.fault?.(error instanceof Error ? error.message : String(error));
      }
    };
    try {
      return await new Promise((resolve, reject) => {
        const detach = () => {
          if (backstop) clearTimeout(backstop);
          if (cancellationBackstop) clearTimeout(cancellationBackstop);
          options.signal?.removeEventListener("abort", onAbort);
          slot.handler = void 0;
          slot.fault = void 0;
        };
        const finish = (result, error, terminate = false) => {
          if (settled) return;
          settled = true;
          detach();
          if (!controller.signal.aborted) controller.abort(error ?? new Error(result?.error ?? "Execution finished"));
          terminate ||= options.signal?.aborted === true;
          const termination = terminate ? this.#terminate(slot) : Promise.resolve();
          void Promise.all([termination, settleWithin(hostCalls, cleanupGraceMs)]).then(async () => {
            if (!terminate && options.signal?.aborted) {
              terminate = true;
              await this.#terminate(slot);
            }
            if (!terminate) this.#release(slot);
            if (options.signal?.aborted) resolve({ ...result, ...sandboxCancelledResult(result?.effectiveTimeoutMs ?? mirror?.effectiveTimeoutMs ?? requestedTimeoutMs), logs: result?.logs ?? [] });
            else if (error) reject(error);
            else resolve(result);
          }).catch(reject);
        };
        cancelUnresponsive = () => finish(sandboxCancelledResult(mirror?.effectiveTimeoutMs ?? requestedTimeoutMs), void 0, true);
        const fault = (message) => finish(void 0, new Error(message), true);
        const scheduleBackstop = () => {
          if (backstop) clearTimeout(backstop);
          const expiresAt = mirror?.expiresAt ?? startedAt + requestedTimeoutMs;
          backstop = setTimeout(() => {
            const effectiveTimeoutMs = mirror?.effectiveTimeoutMs ?? requestedTimeoutMs;
            finish(options.signal?.aborted ? sandboxCancelledResult(effectiveTimeoutMs) : { value: void 0, logs: [], terminationReason: "timed_out", error: `Execution timed out after ${effectiveTimeoutMs}ms`, effectiveTimeoutMs }, void 0, true);
          }, Math.max(0, expiresAt + cleanupGraceMs + SANDBOX_WORKER_BACKSTOP_MS - performance3.now()));
          backstop.unref();
        };
        slot.fault = fault;
        const handle = (message) => {
          if (settled || message.executionId !== executionId) return;
          if (message.type === "prepare" || message.type === "hostCall") {
            const deadline = hostDeadline();
            const floor = options.minimumTimeoutMsForHostCall?.(message.ref, message.args);
            if (typeof floor === "number" && Number.isFinite(floor)) {
              const accepted = deadline.extendTo(floor);
              scheduleBackstop();
              slot.worker.postMessage({ type: "extend", executionId, floorMs: accepted, ...message.type === "hostCall" ? { id: message.id } : {} });
            }
            if (message.type === "prepare") return;
          }
          if (message.type === "hostCall") {
            const call = Promise.resolve().then(() => {
              if (settled || controller.signal.aborted) throw new Error("Execution ended before provider dispatch");
              const deadline = hostDeadline();
              try {
                deadline.throwIfExpired();
              } catch (error) {
                slot.worker.postMessage({ type: "expire", executionId });
                throw error;
              }
              return hostCall(message.ref, message.args, controller.signal, deadline);
            });
            hostCalls.add(call);
            void call.then(() => hostCalls.delete(call), () => hostCalls.delete(call));
            void call.then(
              (value) => {
                if (!settled) slot.worker.postMessage({ type: "hostResult", executionId, id: message.id, ok: true, value });
              },
              (error) => {
                if (settled) return;
                if (hostDeadline().expired) slot.worker.postMessage({ type: "expire", executionId });
                slot.worker.postMessage({ type: "hostResult", executionId, id: message.id, ok: false, ...transferredHostFailure(error) });
              }
            ).catch((error) => fault(error instanceof Error ? error.message : String(error)));
            return;
          }
          if (message.type === "spanStart") {
            spans.set(message.token, tracer.span(message.cat, message.ev, message.execId, message.data, message.parentId));
            return;
          }
          if (message.type === "spanEnd") {
            const span = spans.get(message.token);
            spans.delete(message.token);
            span?.end(message.data);
            return;
          }
          if (message.type === "event") {
            tracer.event(message.cat, message.ev, message.execId, message.data);
            return;
          }
          if (message.type === "hostAbort") {
            if (!controller.signal.aborted) controller.abort(new Error(message.message));
            return;
          }
          if (message.type === "flush") {
            tracer.flush();
            return;
          }
          if (message.type === "result") {
            finish(message.result);
            return;
          }
          fault(message.message);
        };
        slot.handler = (message) => {
          try {
            handle(message);
          } catch (error) {
            fault(error instanceof Error ? error.message : String(error));
          }
        };
        scheduleBackstop();
        options.signal?.addEventListener("abort", onAbort, { once: true });
        if (options.signal?.aborted) onAbort();
        try {
          slot.worker.postMessage({
            type: "run",
            executionId,
            code,
            cancellationBuffer: cancellation.buffer,
            options: {
              timeoutMs: options.timeoutMs,
              maxTimeoutMs: options.maxTimeoutMs,
              memoryLimitBytes: options.memoryLimitBytes,
              ...options.maxSourceBytes === void 0 ? {} : { maxSourceBytes: options.maxSourceBytes },
              ...options.maxInputBytes === void 0 ? {} : { maxInputBytes: options.maxInputBytes },
              ...options.maxLogChars === void 0 ? {} : { maxLogChars: options.maxLogChars },
              ...options.maxNestedResultChars === void 0 ? {} : { maxNestedResultChars: options.maxNestedResultChars },
              ...options.maxConcurrentHostCalls === void 0 ? {} : { maxConcurrentHostCalls: options.maxConcurrentHostCalls },
              ...options.payloads === void 0 ? {} : { payloads: options.payloads },
              ...options.transpiledCode === void 0 ? {} : { transpiledCode: options.transpiledCode },
              ...options.transpiledSourceMap === void 0 ? {} : { transpiledSourceMap: options.transpiledSourceMap },
              ...options.cleanupGraceMs === void 0 ? {} : { cleanupGraceMs: options.cleanupGraceMs },
              tracerEnabled: tracer.enabled,
              ...options.execId === void 0 ? {} : { execId: options.execId },
              ...options.parentSpanId === void 0 ? {} : { parentSpanId: options.parentSpanId }
            }
          });
        } catch (error) {
          fault(error instanceof Error ? error.message : String(error));
        }
      });
    } catch (error) {
      await this.#terminate(slot);
      throw error;
    }
  }
  /** Terminates every pooled thread. Callers that stop serving must close, or
   * idle workers wait out their window before retiring. */
  close() {
    this.#closed = true;
    const slots = [...this.#slots];
    this.#idle = void 0;
    for (const slot of slots) {
      slot.fault?.("Sandbox runtime is closed");
      void this.#terminate(slot);
    }
    return Promise.all([...this.#terminations]).then(() => void 0);
  }
};

export {
  DEFAULT_EXECUTOR_SOURCE_BYTES,
  MIN_EXECUTOR_SOURCE_BYTES,
  MAX_EXECUTOR_SOURCE_BYTES,
  fabricSourceLimitError,
  fabricPayloadsLimitError,
  localProcessGroupAlive,
  traceFailureMetadata,
  DISABLED_TRACER,
  resolveTraceEnabled,
  createFabricTracer,
  throwIfAbortedOrExpired,
  runAbortable,
  settleWithin,
  LocalShellExitError,
  runLocalShell,
  FABRIC_COMMIT_ACKNOWLEDGEMENT,
  fabricCommitAcknowledgement,
  FabricDeadline,
  runQuickJsSandbox,
  QuickJsRuntime
};
