#!/usr/bin/env node
import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
globalThis.__filename = __fileURLToPath(import.meta.url);
globalThis.__dirname = __dirnameOf(globalThis.__filename);
const require = __createRequire(import.meta.url);

import {
  assertSourceComponent,
  decodeRequest,
  encodeFrame,
  loadManagedSourcePlatform,
  openSourceDirectory,
  projectEngineJson,
  readSourceBounded,
  sourceLimit,
  sourcePlatform,
  validateProvenanceJournal
} from "../chunks/chunk-MFCZZWZZ.js";
import "../chunks/chunk-OLJUXTSO.js";
import "../chunks/chunk-WZ4PGM3F.js";
import "../chunks/chunk-AE4E2KSU.js";

// src/fovea/engine.ts
import { createHash as createHash10, randomUUID as randomUUID2 } from "node:crypto";
import { mkdir as mkdir2, mkdtemp, lstat as lstat4, realpath as realpath2, rename as rename2, rm, writeFile as writeFile3 } from "node:fs/promises";
import { isAbsolute as isAbsolute6, join as join10, resolve as resolve5 } from "node:path";

// src/fovea/core/context.ts
import { AsyncLocalStorage } from "node:async_hooks";
var coreContext = new AsyncLocalStorage();
function context() {
  const value = coreContext.getStore();
  if (!value) throw new Error("Fovea core requires an explicit engine context");
  return value;
}
var privateTmpdir = () => context().storageRoot;
function owned(key, create, session = false) {
  return new Proxy({}, {
    get(_target, property) {
      const store = session ? context().sessionStore : context().store;
      let value = store.get(key);
      if (!value) {
        value = create();
        store.set(key, value);
      }
      const member = Reflect.get(value, property, value);
      return typeof member === "function" ? member.bind(value) : member;
    },
    set(_target, property, next) {
      const store = session ? context().sessionStore : context().store;
      let value = store.get(key);
      if (!value) {
        value = create();
        store.set(key, value);
      }
      return Reflect.set(value, property, next, value);
    }
  });
}
var safeEnvironment = () => ({
  LANG: "C",
  LC_ALL: "C",
  HOME: context().storageRoot,
  TMPDIR: context().storageRoot,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_NO_LAZY_FETCH: "1",
  GIT_ALLOW_PROTOCOL: "",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ATTR_NOSYSTEM: "1"
});

// src/fovea/core/ops.ts
import { createHash as createHash5 } from "node:crypto";
import { join as join5, posix as posix3 } from "node:path";

// src/fovea/core/git.ts
import { execFile } from "node:child_process";
import { posix, join } from "node:path";
import { stat } from "node:fs/promises";

// src/fovea/core/asyncutil.ts
var envInt = (_name, dflt, _min, _max) => dflt;
var SPAWN_CONCURRENCY = envInt("FOVEA_SPAWN_CONCURRENCY", 3, 1, 32);
var IO_CONCURRENCY = envInt("FOVEA_IO_CONCURRENCY", 32, 4, 512);
var OBSERVED_ROOT_LIMIT = envInt("FOVEA_MAX_ROOTS", 32, 1, 32);
var ROOT_CACHE_LIMIT = envInt("FOVEA_CACHE_ROOTS", 2, 1, 32);
var mapLimit = async (items, limit, fn) => {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (; ; ) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }
  );
  await Promise.all(workers);
  return out;
};
async function forEachOrderedBatch(items, limit, prepare, commit) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid ordered batch limit");
  for (let start = 0; start < items.length; start += limit) {
    context().signal.throwIfAborted();
    const batch = items.slice(start, start + limit);
    const results = await Promise.allSettled(batch.map(async (item) => prepare(item)));
    context().signal.throwIfAborted();
    for (const result of results) if (result.status === "rejected") throw result.reason;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled") commit(result.value, batch[i]);
    }
  }
}
var Semaphore = class {
  constructor(limit) {
    this.limit = limit;
  }
  limit;
  active = 0;
  waiters = [];
  async run(fn) {
    if (this.active >= this.limit) {
      await new Promise((resolve6) => this.waiters.push(resolve6));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
};
var spawnGate = owned("spawnGate", () => new Semaphore(SPAWN_CONCURRENCY));
var yieldToLoop = () => new Promise((resolve6, reject) => setImmediate(() => {
  try {
    context().signal.throwIfAborted();
    resolve6();
  } catch (error) {
    reject(error);
  }
}));
var forEachChunked = async (items, batchSize, fn) => {
  for (let i = 0; i < items.length; i++) {
    if (i > 0 && i % batchSize === 0) await yieldToLoop();
    fn(items[i], i);
  }
};

// src/fovea/core/git.ts
var GIT_TIMEOUT = 15e3;
var gitOut = async (root, args, opts = {}) => {
  if (!context().gitPath) {
    context().gitFailures.push("Git executable not configured");
    return void 0;
  }
  context().signal.throwIfAborted();
  return spawnGate.run(
    () => new Promise((resolve6) => {
      execFile(
        context().gitPath,
        ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "diff.external=", "-c", "core.attributesFile=/dev/null", "-c", "protocol.allow=never", "-C", root === context().snapshotRoot ? context().sourceRoot : root, ...args],
        {
          // Local analysis must not run repository hooks or lazily fetch objects.
          env: safeEnvironment(),
          signal: context().signal,
          killSignal: "SIGKILL",
          encoding: "utf8",
          timeout: opts.timeout ?? GIT_TIMEOUT,
          maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024
        },
        (error, stdout) => {
          if (error) {
            context().gitFailures.push(`Git ${args[0] ?? "probe"} failed`);
            resolve6(void 0);
            return;
          }
          resolve6(stdout);
        }
      );
    })
  );
};
var gitHead = async (root) => {
  const out = await gitOut(root, ["rev-parse", "HEAD"]);
  const head = out?.trim();
  return head ? head : void 0;
};
var gitReflogAction = async (root) => {
  const out = await gitOut(root, ["reflog", "-1", "--format=%gs"]);
  const line = out?.trim();
  return line ? line : void 0;
};
var gitPrefixes = owned("git.ts:gitPrefixes", () => /* @__PURE__ */ new Map());
var gitPrefix = async (root) => {
  if (gitPrefixes.has(root)) {
    const hit = gitPrefixes.get(root);
    gitPrefixes.delete(root);
    gitPrefixes.set(root, hit);
    return hit;
  }
  const out = await gitOut(root, ["rev-parse", "--show-prefix"]);
  if (out === void 0) return void 0;
  const prefix = out.trim().replace(/\\/g, "/");
  gitPrefixes.delete(root);
  gitPrefixes.set(root, prefix);
  while (gitPrefixes.size > OBSERVED_ROOT_LIMIT) gitPrefixes.delete(gitPrefixes.keys().next().value);
  return prefix;
};
var gitRelativePath = (path, prefix) => {
  const normalized = path.replace(/\\/g, "/");
  if (!prefix) return normalized;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : void 0;
};
var gitProbe = async (root) => {
  let prefix = await gitPrefix(root);
  if (prefix === void 0) return void 0;
  const marker = await stat(join(root, ".git")).then((info) => info.isFile() || info.isDirectory(), () => false);
  const overridden = false;
  if (prefix === "" !== marker || overridden) {
    gitPrefixes.delete(root);
    prefix = await gitPrefix(root);
    if (prefix === void 0) return void 0;
  }
  const out = await gitOut(root, [
    "-c",
    "core.untrackedCache=false",
    "status",
    "--porcelain=v2",
    "--branch",
    "--no-ahead-behind",
    "-z",
    "--untracked-files=normal",
    "--no-renames",
    ...prefix || !marker || overridden ? ["--", "."] : []
  ]);
  if (out === void 0) return legacyProbe(root, prefix);
  let head;
  let relist = false;
  const changes = [];
  for (const field of out.split("\0")) {
    if (!field) continue;
    if (field.startsWith("# branch.oid ")) {
      const oid = field.slice(13);
      if (oid === "(initial)") head = "";
      else if (/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(oid)) head = oid;
      continue;
    }
    if (field.startsWith("# ")) continue;
    let code, raw;
    if (field.startsWith("? ") || field.startsWith("! ")) {
      code = field[0].repeat(2);
      raw = field.slice(2);
    } else if (field.startsWith("1 ") || field.startsWith("u ")) {
      const parts = field.split(" ");
      code = (parts[1] ?? "").replace(/\./g, " ");
      raw = parts.slice(field[0] === "1" ? 8 : 10).join(" ");
    } else {
      relist = true;
      continue;
    }
    const path = gitRelativePath(raw, prefix);
    if (!path || !/^[ MARCUD?!]{2}$/.test(code)) {
      relist = true;
      continue;
    }
    changes.push({ code, path });
  }
  return head === void 0 ? legacyProbe(root, prefix) : { head, changes, relist };
};
var legacyProbe = async (root, prefix) => {
  const out = await gitOut(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=normal",
    "--no-renames",
    "--",
    "."
  ]);
  if (out === void 0) return void 0;
  const head = await gitHead(root) ?? "";
  const fields = out.split("\0").filter((f) => f.length > 0);
  const changes = [];
  let relist = false;
  for (const field of fields) {
    if (field.length < 4) {
      relist = true;
      continue;
    }
    const code = field.slice(0, 2);
    const path = gitRelativePath(field.slice(3), prefix);
    if (!path) {
      relist = true;
      continue;
    }
    if (!/^[ MARCUD?!]{2}$/.test(code)) relist = true;
    changes.push({ code, path });
  }
  return { head, changes, relist };
};
var uncommittedFiles = async (root) => {
  const prefix = await gitPrefix(root);
  if (prefix === void 0) return [];
  const out = await gitOut(root, ["status", "--porcelain", "-z", "--untracked-files=all", "--no-renames", "--", "."]);
  if (!out) return [];
  return out.split("\0").filter(Boolean).map((entry) => gitRelativePath(entry.slice(3), prefix)).filter((path) => !!path);
};
var impactRange = async (root, base) => {
  if (!base || base.length > 256 || base.startsWith("-") || /[\u0000-\u001f\u007f]/u.test(base)) throw new Error("Invalid impact base revision");
  const commit = (await gitOut(root, ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`], { maxBuffer: 1024 }))?.trim();
  if (!commit || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(commit)) throw new Error("Impact base must resolve to one commit");
  return `${commit}...HEAD`;
};
var prFiles = async (root, base) => {
  const range = await impactRange(root, base);
  const prefix = await gitPrefix(root);
  if (prefix === void 0) return [];
  const out = await gitOut(root, ["diff", "--name-only", "-z", "--no-ext-diff", "--no-textconv", range, "--", "."]);
  return out ? out.split("\0").map((s) => gitRelativePath(s, prefix)).filter((s) => !!s) : [];
};
var MAX_DIFF_HUNKS_PER_FILE = 200;
var DIFF_MAX_BUFFER = 32 * 1024 * 1024;
var decodeGitPath = (raw) => {
  if (!raw.startsWith('"')) return raw;
  if (raw.length < 2 || !raw.endsWith('"')) return void 0;
  const bytes = [];
  const escaped = {
    a: 7,
    b: 8,
    t: 9,
    n: 10,
    v: 11,
    f: 12,
    r: 13,
    e: 27,
    "\\": 92,
    '"': 34
  };
  for (let i = 1; i < raw.length - 1; i++) {
    const ch = raw[i];
    if (ch !== "\\") {
      const cp = raw.codePointAt(i);
      bytes.push(...Buffer.from(String.fromCodePoint(cp)));
      if (cp > 65535) i++;
      continue;
    }
    const next = raw[++i];
    if (next === void 0 || i >= raw.length - 1) return void 0;
    if (/[0-7]/.test(next)) {
      let octal = next;
      while (octal.length < 3 && i + 1 < raw.length - 1 && /[0-7]/.test(raw[i + 1])) {
        octal += raw[++i];
      }
      bytes.push(Number.parseInt(octal, 8));
      continue;
    }
    const value = escaped[next];
    if (value === void 0) return void 0;
    bytes.push(value);
  }
  return Buffer.from(bytes).toString("utf8");
};
var boundedHunkLimit = (requested) => Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : MAX_DIFF_HUNKS_PER_FILE;
var parseZeroContextDiff = (patch, prefix = "", maxHunksPerFile = MAX_DIFF_HUNKS_PER_FILE) => {
  const limit = boundedHunkLimit(maxHunksPerFile);
  const result = /* @__PURE__ */ new Map();
  let pending;
  const relativePath = (raw, side) => {
    const decoded = decodeGitPath(raw);
    if (decoded === void 0 || decoded === "/dev/null") return void 0;
    const repoPath = side && decoded.startsWith(`${side}/`) ? decoded.slice(2) : decoded;
    const relative6 = gitRelativePath(repoPath, prefix);
    return relative6 ? posix.normalize(relative6) : void 0;
  };
  const merge = (path, hunks, fallback) => {
    const previous = result.get(path);
    if (!previous) {
      result.set(path, fallback ? { hunks: [], fallback: true } : { hunks: [...hunks], fallback: false });
      return;
    }
    if (previous.fallback || fallback || previous.hunks.length + hunks.length > limit) {
      result.set(path, { hunks: [], fallback: true });
      return;
    }
    previous.hunks.push(...hunks);
  };
  const flush = () => {
    if (!pending) return;
    const renamed = !!(pending.renameFrom || pending.renameTo || pending.copyFrom || pending.copyTo || pending.oldPath && pending.newPath && pending.oldPath !== pending.newPath);
    const fallback = pending.fallback || pending.newFile || pending.deletedFile || renamed || pending.hunkCount === 0 || pending.hunkCount > limit;
    const primary = pending.newPath ?? pending.renameTo ?? pending.copyTo ?? pending.oldPath ?? pending.renameFrom ?? pending.copyFrom;
    if (primary) merge(primary, pending.hunks, fallback);
    if (renamed) {
      for (const path of [pending.oldPath, pending.renameFrom, pending.copyFrom]) {
        if (path && path !== primary) merge(path, [], true);
      }
    }
    pending = void 0;
  };
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      pending = {
        hunks: [],
        hunkCount: 0,
        fallback: false,
        newFile: false,
        deletedFile: false
      };
      continue;
    }
    if (!pending) continue;
    if (pending.hunkCount === 0) {
      if (line.startsWith("new file mode ")) {
        pending.newFile = true;
        continue;
      }
      if (line.startsWith("deleted file mode ")) {
        pending.deletedFile = true;
        continue;
      }
      if (line.startsWith("rename from ")) {
        pending.renameFrom = relativePath(line.slice("rename from ".length));
        pending.fallback ||= pending.renameFrom === void 0;
        continue;
      }
      if (line.startsWith("rename to ")) {
        pending.renameTo = relativePath(line.slice("rename to ".length));
        pending.fallback ||= pending.renameTo === void 0;
        continue;
      }
      if (line.startsWith("copy from ")) {
        pending.copyFrom = relativePath(line.slice("copy from ".length));
        pending.fallback ||= pending.copyFrom === void 0;
        continue;
      }
      if (line.startsWith("copy to ")) {
        pending.copyTo = relativePath(line.slice("copy to ".length));
        pending.fallback ||= pending.copyTo === void 0;
        continue;
      }
      if (line.startsWith("--- ")) {
        const raw = line.slice(4);
        pending.newFile ||= raw === "/dev/null";
        pending.oldPath = relativePath(raw, "a");
        pending.fallback ||= raw !== "/dev/null" && pending.oldPath === void 0;
        continue;
      }
      if (line.startsWith("+++ ")) {
        const raw = line.slice(4);
        pending.deletedFile ||= raw === "/dev/null";
        pending.newPath = relativePath(raw, "b");
        pending.fallback ||= raw !== "/dev/null" && pending.newPath === void 0;
        continue;
      }
      if (line.startsWith("Binary files ")) {
        const match2 = /^Binary files (.+) and (.+) differ$/.exec(line);
        if (match2) {
          pending.oldPath ??= relativePath(match2[1], "a");
          pending.newPath ??= relativePath(match2[2], "b");
        }
        pending.fallback = true;
        continue;
      }
      if (line === "GIT binary patch") {
        pending.fallback = true;
        continue;
      }
    }
    if (!line.startsWith("@@")) continue;
    pending.hunkCount++;
    if (pending.hunkCount > limit) {
      pending.hunks.length = 0;
      pending.fallback = true;
      continue;
    }
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(line);
    if (!match) {
      pending.hunks.length = 0;
      pending.fallback = true;
      continue;
    }
    const oldStart = Number(match[1]);
    const oldLines = match[2] === void 0 ? 1 : Number(match[2]);
    const newStart = Number(match[3]);
    const newLines = match[4] === void 0 ? 1 : Number(match[4]);
    const valid = [oldStart, oldLines, newStart, newLines].every(Number.isSafeInteger) && oldStart >= 0 && oldLines >= 0 && newStart >= 0 && newLines >= 0 && (newLines === 0 || newStart >= 1) && Number.isSafeInteger(newStart + newLines);
    if (!valid) {
      pending.hunks.length = 0;
      pending.fallback = true;
      continue;
    }
    if (!pending.fallback) pending.hunks.push({ newStart, newLines });
  }
  flush();
  return result;
};
var diffHunks = async (root, base) => {
  const range = base === void 0 ? "HEAD" : await impactRange(root, base);
  const prefix = await gitPrefix(root);
  if (prefix === void 0) return void 0;
  const out = await gitOut(root, [
    "-c",
    "core.quotePath=false",
    "diff",
    "--unified=0",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--find-renames",
    range,
    "--",
    "."
  ], { maxBuffer: DIFF_MAX_BUFFER });
  return out === void 0 ? void 0 : parseZeroContextDiff(out, prefix);
};

// src/fovea/core/heat.ts
var buildCsr = (g) => {
  const n = g.nodes.length;
  const best = /* @__PURE__ */ new Map();
  for (const e of g.edges) {
    if (e.a === e.b) continue;
    const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
    best.set(key, Math.max(best.get(key) ?? 0, e.w));
  }
  const pairs = [];
  for (const [key, w2] of best) {
    const [a, b] = key.split("|").map(Number);
    pairs.push([a, b, w2]);
  }
  pairs.sort((x, y) => x[0] - y[0]);
  const counts = new Uint32Array(n);
  for (const [a, b] of pairs) {
    counts[a]++;
    counts[b]++;
  }
  const rowPtr = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) rowPtr[i + 1] = rowPtr[i] + counts[i];
  const col = new Uint32Array(rowPtr[n]);
  const w = new Float64Array(rowPtr[n]);
  const cursor = new Uint32Array(n);
  for (let i = 0; i < n; i++) cursor[i] = rowPtr[i];
  for (const [a, b, ew] of pairs) {
    col[cursor[a]] = b;
    w[cursor[a]] = ew;
    cursor[a]++;
    col[cursor[b]] = a;
    w[cursor[b]] = ew;
    cursor[b]++;
  }
  const deg = new Float64Array(n);
  for (const [a, b, ew] of pairs) {
    deg[a] += ew;
    deg[b] += ew;
  }
  return { n, rowPtr, col, w, deg };
};
var inverseDegrees = ({ n, deg }) => {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = deg[i] > 0 ? 1 / Math.sqrt(deg[i]) : 0;
  return out;
};
var applyNegP = (csr, x, invSqrt = inverseDegrees(csr)) => {
  const { n, rowPtr, col, w } = csr;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    const s = rowPtr[i];
    const e = rowPtr[i + 1];
    for (let p = s; p < e; p++) acc += w[p] * invSqrt[col[p]] * x[col[p]];
    y[i] = -invSqrt[i] * acc;
  }
  return y;
};
var besselI = (k, t) => {
  if (t === 0) return k === 0 ? 1 : 0;
  if (t < 1e-8) return k === 0 ? 1 : 0;
  const logHalf = Math.log(t / 2);
  let logSum = Number.NEGATIVE_INFINITY;
  const logGamma = gammaLn;
  for (let m = 0; m < 400; m++) {
    const logTerm = (2 * m + k) * logHalf - logGamma(m + 1) - logGamma(m + k + 1);
    if (logTerm < logSum - 40 && m > k) break;
    logSum = logAddExp(logSum, logTerm);
  }
  return Math.exp(logSum);
};
var logAddExp = (a, b) => {
  if (a === Number.NEGATIVE_INFINITY) return b;
  if (b === Number.NEGATIVE_INFINITY) return a;
  const hi = Math.max(a, b);
  return hi + Math.log(Math.exp(a - hi) + Math.exp(b - hi));
};
var gammaLn = (x) => {
  const c = [
    0.9999999999998099,
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9984369578019572e-21,
    15056327351493116e-23
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - gammaLn(1 - x);
  const z = x - 1;
  let acc = c[0];
  for (let i = 1; i < c.length; i++) acc += c[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(acc);
};
var chooseOrder = (t) => Math.min(90, Math.ceil(2.2 * t) + 16);
var heatCoeff = (k, t) => {
  const base = Math.exp(-t) * besselI(k, t);
  if (k === 0) return base;
  return 2 * (k % 2 === 0 ? 1 : -1) * base;
};
var chebyshevVectors = (csr, s, K) => extendChebyshevVectors(csr, [Float64Array.from(s)], K);
var extendChebyshevVectors = (csr, tk, K) => {
  if (!tk.length) throw new Error("Cannot extend an empty Chebyshev basis");
  if (tk.length > K) return tk;
  const invSqrt = inverseDegrees(csr);
  if (tk.length === 1) tk[1] = applyNegP(csr, tk[0], invSqrt);
  for (let k = tk.length; k <= K; k++) {
    const out = applyNegP(csr, tk[k - 1], invSqrt);
    const p2 = tk[k - 2];
    for (let i = 0; i < csr.n; i++) out[i] = 2 * out[i] - p2[i];
    tk[k] = out;
  }
  return tk;
};
var heatField = (tk, t, n) => {
  const K = tk.length - 1;
  const v = new Float64Array(n);
  for (let k = 0; k <= K; k++) {
    const c = heatCoeff(k, t);
    if (Math.abs(c) < 1e-16) continue;
    const vec = tk[k];
    for (let i = 0; i < n; i++) v[i] += c * vec[i];
  }
  return v;
};
var forwardHeat = (csr, a, t) => {
  const seed = new Float64Array(csr.n);
  for (let i = 0; i < csr.n; i++) {
    const d = csr.deg[i];
    if (d > 0) seed[i] = (a[i] ?? 0) / Math.sqrt(d);
  }
  const v = heatField(chebyshevVectors(csr, seed, chooseOrder(t)), t, csr.n);
  const p = new Float64Array(csr.n);
  for (let i = 0; i < csr.n; i++) {
    const d = csr.deg[i];
    p[i] = d > 0 ? Math.sqrt(d) * v[i] : a[i] ?? 0;
  }
  return p;
};

// src/fovea/core/temp-storage.ts
import { randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { lstat, open, opendir, rename, unlink } from "node:fs/promises";
import { join as join2 } from "node:path";
var MiB = 1024 * 1024;
var HOUR = 36e5;
var JOURNAL_TTL_MS = 7 * 24 * HOUR;
var CACHE_FILE_MAX_BYTES = 64 * MiB;
var SPILL_FILE_MAX_BYTES = 8 * MiB;
var INTERVAL = 5 * 6e4;
var policies = {
  cache: { bytes: 128 * MiB, entries: 128, ttl: 7 * 24 * HOUR, grace: INTERVAL },
  spill: { bytes: 32 * MiB, entries: 128, ttl: 24 * HOUR, grace: HOUR }
};
var cacheName = /^pi-fovea-(?:cochange-)?[a-f0-9]{16}\.json$/;
var spillName = /^pi-fovea-(?:focus|dwell|impact|sketch)-[a-f0-9]{8}\.txt$/;
var journalName = /^pi-fovea-provenance-[a-f0-9]{16}-[a-f0-9]{16}\.json$/;
var uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
var partialName = new RegExp(`^(.+)\\.tmp-([1-9][0-9]*)-(${uuid})$`);
var scanName = new RegExp(`^pi-fovea-scan-([1-9][0-9]*)-(${uuid})\\.yml$`);
var active = owned("temp-storage.ts:active", () => /* @__PURE__ */ new Map());
var hold = (path) => {
  active.set(path, (active.get(path) ?? 0) + 1);
  return () => {
    const count = (active.get(path) ?? 1) - 1;
    if (count) active.set(path, count);
    else active.delete(path);
  };
};
var owned2 = (s) => typeof process.getuid === "function" && s.uid === process.getuid() && s.isFile() && s.nlink === 1;
var same = (a, b) => b.isFile() && b.nlink === 1 && a.uid === b.uid && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
var dead = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
};
var removeUnchanged = async (path, snapshot2) => {
  try {
    if (active.has(path) || !same(snapshot2, await lstat(path)) || active.has(path)) return false;
    await unlink(path);
    return true;
  } catch {
    return false;
  }
};
var openTempRead = async (path, maxBytes = CACHE_FILE_MAX_BYTES) => {
  const before = await lstat(path);
  if (!owned2(before) || before.size > maxBytes) throw new Error("Unsafe or oversized temporary file");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!same(before, await handle.stat())) throw new Error("Temporary file changed");
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
};
var readTempText = async (path, maxBytes = CACHE_FILE_MAX_BYTES) => {
  const handle = await openTempRead(path, maxBytes);
  try {
    const before = await handle.stat();
    if (!owned2(before) || before.size > maxBytes) throw new Error("Unsafe or oversized temporary file");
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length !== before.size || !same(before, await handle.stat())) throw new Error("Temporary file changed");
    return bytes.subarray(0, length).toString("utf8");
  } finally {
    await handle.close();
  }
};
var sweep = async (directory, now, dryRun = false) => {
  const removed = [];
  const remove = async (path, stat5) => {
    try {
      const eligible = dryRun ? !active.has(path) && same(stat5, await lstat(path)) && !active.has(path) : await removeUnchanged(path, stat5);
      if (eligible) removed.push(path);
      return eligible;
    } catch {
      return false;
    }
  };
  const groups = { cache: [], spill: [] };
  const dir = await opendir(directory);
  for await (const item of dir) {
    const name = item.name;
    const kind = cacheName.test(name) ? "cache" : spillName.test(name) ? "spill" : void 0;
    const journal = journalName.test(name);
    const partial = partialName.exec(name);
    const scan = scanName.exec(name);
    const pid = scan ? Number(scan[1]) : partial && (cacheName.test(partial[1]) || spillName.test(partial[1]) || journalName.test(partial[1])) ? Number(partial[2]) : void 0;
    if (!kind && !journal && pid === void 0) continue;
    const path = join2(directory, name);
    try {
      const stat5 = await lstat(path);
      if (!owned2(stat5)) continue;
      if (kind) {
        groups[kind].push({ path, stat: stat5 });
        continue;
      }
      if (active.has(path)) continue;
      if (pid !== void 0) {
        if (now - stat5.mtimeMs > HOUR && dead(pid)) await remove(path, stat5);
      } else if (now - stat5.mtimeMs > JOURNAL_TTL_MS) {
        const data = JSON.parse(await readTempText(path));
        if (data.version === 1 && Array.isArray(data.records) && data.records.every((r) => typeof r.at === "number" && Number.isFinite(r.at) && r.at < now - JOURNAL_TTL_MS)) {
          await remove(path, stat5);
        }
      }
    } catch {
    }
  }
  for (const kind of ["cache", "spill"]) {
    const entries = groups[kind].sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const policy = policies[kind];
    let bytes = entries.reduce((n, e) => n + e.stat.size, 0);
    let count = entries.length;
    for (const entry of entries) {
      const age = now - entry.stat.mtimeMs;
      if (age <= policy.grace) continue;
      if (age <= policy.ttl && count <= policy.entries && bytes <= policy.bytes) continue;
      if (await remove(entry.path, entry.stat)) {
        count--;
        bytes -= entry.stat.size;
      }
    }
  }
  return removed;
};
var maintenanceHolder = owned("maintenance", () => ({ value: void 0 }));
var maintainTempStorage = (directory = privateTmpdir(), now = Date.now()) => {
  if (maintenanceHolder.value?.directory === directory) {
    if (maintenanceHolder.value.pending) return maintenanceHolder.value.pending;
    if (now >= maintenanceHolder.value.at && now - maintenanceHolder.value.at < INTERVAL) return Promise.resolve();
  }
  const state = { directory, at: now, pending: void 0 };
  maintenanceHolder.value = state;
  state.pending = sweep(directory, now).then(() => void 0).catch(() => {
  }).finally(() => {
    state.pending = void 0;
  });
  return state.pending;
};
var checkTarget = async (path) => {
  try {
    if (!owned2(await lstat(path))) throw new Error("Unsafe temporary target");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};
var writeAtomicTemp = async (target, content, maxBytes = CACHE_FILE_MAX_BYTES) => {
  if (typeof process.getuid !== "function") throw new Error("Cannot verify temporary-file ownership");
  const release = hold(target);
  void maintainTempStorage();
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  let snapshot2;
  try {
    await checkTarget(target);
    const handle = await open(temporary, "wx", 384);
    try {
      snapshot2 = await handle.stat();
      let bytes = 0;
      for await (const chunk of typeof content === "string" ? [content] : content) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > maxBytes) throw new Error("Temporary file size limit exceeded");
        await handle.writeFile(chunk);
      }
    } finally {
      snapshot2 = await handle.stat().catch(() => snapshot2);
      await handle.close();
    }
    await checkTarget(target);
    await rename(temporary, target);
  } finally {
    if (snapshot2) await removeUnchanged(temporary, snapshot2);
    release();
    void maintainTempStorage();
  }
};
var writeSpill = (target, text) => {
  if (target.startsWith("retained:")) {
    context().signal.throwIfAborted();
    context().spills.set(target, text.slice(0, 2e5));
    return;
  }
  if (typeof process.getuid !== "function") throw new Error("Cannot verify temporary-file ownership");
  void maintainTempStorage();
  if (Buffer.byteLength(text) > SPILL_FILE_MAX_BYTES) throw new Error("Spill size limit exceeded");
  const check = () => {
    try {
      if (!owned2(lstatSync(target))) throw new Error("Unsafe spill target");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  };
  check();
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  const fd = openSync(temporary, "wx", 384);
  let snapshot2;
  try {
    snapshot2 = fstatSync(fd);
    writeFileSync(fd, text);
    check();
    renameSync(temporary, target);
  } finally {
    try {
      snapshot2 = fstatSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      if (snapshot2 && same(snapshot2, lstatSync(temporary))) unlinkSync(temporary);
    } catch {
    }
  }
};
var withScanRuleFile = async (text, run2) => {
  const path = join2(privateTmpdir(), `pi-fovea-scan-${process.pid}-${randomUUID()}.yml`);
  void maintainTempStorage();
  const handle = await open(path, "wx", 384);
  let snapshot2;
  try {
    try {
      snapshot2 = await handle.stat();
      await handle.writeFile(text);
    } finally {
      snapshot2 = await handle.stat().catch(() => snapshot2);
      await handle.close();
    }
    return await run2(path);
  } finally {
    if (snapshot2) await removeUnchanged(path, snapshot2);
  }
};

// src/fovea/core/render.ts
var tokenEstimate = (text) => Math.ceil(text.length / 4);
var HOT_TIER = 0.3;
var WARM_TIER = 0.02;
var HEAT_EPS = 1e-9;
var MAX_UNRELATED_WARM_PER_FILE = 4;
var formatNodeLocation = (node) => {
  if (node.kind === "file" || node.line <= 0) return node.file;
  if (node.lineApproximate) return `${node.file} (member line unavailable)`;
  return `${node.file}:${node.line}`;
};
var RELATION_PRIORITY = {
  contains: 0,
  imports: 2,
  join: 3,
  anchors: 4,
  tests: 5,
  inherits: 6,
  invokes: 7
};
var relationLabel = (edge, seedAtA, candidate) => {
  switch (edge.kind) {
    case "invokes":
      return seedAtA ? "\u2192 callee" : "\u2190 caller";
    case "imports":
      return edge.evidence?.possible ? seedAtA ? "\u2192 possible import" : "\u2190 possible importer" : seedAtA ? "\u2192 import" : "\u2190 importer";
    case "tests":
      return seedAtA ? "\u2192 subject" : "\u2190 test";
    case "inherits":
      return seedAtA ? "\u2192 parent" : "\u2190 subclass";
    case "anchors":
      return seedAtA ? candidate.kind === "file" ? "\u2192 feature file" : "\u2192 handler" : "\u2190 feature";
    case "join":
      return "\u2194 shared literal";
    case "contains":
      return seedAtA ? "\u25C7 member" : "\u25C7 file";
  }
};
var evidenceLabel = (evidence) => {
  if (!evidence) return "";
  const source = evidence.source?.replace(/\s+/g, " ").slice(0, 48);
  const derivation = evidence.rule ? `${evidence.strategy}/${evidence.rule}` : evidence.strategy;
  return ` \xB7 ${derivation}${source ? `:${source}` : ""}`;
};
var directRelations = (g, seeds) => {
  const out = /* @__PURE__ */ new Map();
  for (const edge of g.edges) {
    const aSeed = seeds.has(edge.a);
    const bSeed = seeds.has(edge.b);
    if (aSeed === bSeed) continue;
    const node = aSeed ? edge.b : edge.a;
    const relation = {
      kind: edge.kind,
      label: relationLabel(edge, aSeed, g.nodes[node]),
      priority: RELATION_PRIORITY[edge.kind],
      weight: edge.w,
      seed: aSeed ? edge.a : edge.b,
      evidence: edge.evidence
    };
    const current2 = out.get(node);
    if (!current2 || relation.priority > current2.priority || relation.priority === current2.priority && relation.weight > current2.weight) {
      out.set(node, relation);
    }
  }
  return out;
};
var cmpNodes = (g, field) => (x, y) => {
  const f = field[y] - field[x];
  if (f !== 0) return f;
  const a = g.nodes[x];
  const b = g.nodes[y];
  return a.file === b.file ? a.line - b.line || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.file < b.file ? -1 : 1;
};
var revealFoveated = (g, field, opts) => {
  let vmax = 0;
  for (let i = 0; i < field.length; i++) if (field[i] > vmax) vmax = field[i];
  if (vmax <= 0) {
    return { text: `${opts.header ?? "fovea"}
(nothing matched the current graph)`, tokens: 0, shown: 0, suppressed: 0, litTotal: 0, candidateOmitted: 0, truncated: false, revealedIds: [], revealed: [] };
  }
  const seedSet = new Set(opts.seeds ?? []);
  const relations = directRelations(g, seedSet);
  const candidates = [];
  let suppressed = 0;
  for (let i = 0; i < g.nodes.length; i++) {
    const h = field[i] / vmax;
    const direct = relations.get(i);
    if ((!direct || direct.kind === "contains") && (h < WARM_TIER * 0.1 || field[i] < HEAT_EPS)) continue;
    const id = g.nodes[i].id;
    if (opts.include && !opts.include.has(id)) continue;
    if (opts.exclude?.has(id)) continue;
    const inNucleus = seedSet.has(i) || direct !== void 0 && direct.kind !== "contains";
    if (opts.disclosed?.has(id) && !(opts.repeatNucleus && inNucleus)) {
      suppressed++;
      continue;
    }
    candidates.push(i);
  }
  const byHeat = cmpNodes(g, field);
  candidates.sort((a, b) => {
    const aPriority = seedSet.has(a) ? 2 : relations.get(a)?.kind === "contains" ? 0 : relations.has(a) ? 1 : 0;
    const bPriority = seedSet.has(b) ? 2 : relations.get(b)?.kind === "contains" ? 0 : relations.has(b) ? 1 : 0;
    return bPriority - aPriority || byHeat(a, b);
  });
  const cap = Math.max(0, Math.floor(opts.maxCandidates ?? 400));
  const capped = candidates.slice(0, cap);
  const litTotal = candidates.length;
  const candidateOmitted = litTotal - capped.length;
  const glowCounts = /* @__PURE__ */ new Map();
  const warmPerFile = /* @__PURE__ */ new Map();
  const lines = [];
  const allItems = [];
  const ids = [];
  const revealed = [];
  for (const i of capped) {
    const node = g.nodes[i];
    const h = field[i] / vmax;
    const relation = relations.get(i);
    const semanticRelation = relation && relation.kind !== "contains" ? relation : void 0;
    const displayRelation = relation ? seedSet.size > 1 ? `${relation.label} of ${g.nodes[relation.seed].name}` : relation.label : void 0;
    const provenance = relation?.kind === "contains" ? "" : evidenceLabel(relation?.evidence);
    const context2 = seedSet.has(i) ? "  [focus]" : displayRelation ? `  [${displayRelation}${provenance}]` : "";
    const remember = (role) => {
      ids.push(node.id);
      revealed.push({
        id: node.id,
        name: node.name,
        kind: node.kind,
        language: node.lang,
        file: node.file,
        line: node.line,
        lineApproximate: node.lineApproximate,
        signature: node.sig,
        role,
        relation: displayRelation,
        seedId: relation ? g.nodes[relation.seed].id : void 0,
        evidence: relation?.evidence
      });
    };
    const glowLine = `  \xB7 ${node.name} (${node.kind}) ${formatNodeLocation(node)}`;
    if (h >= HOT_TIER || seedSet.has(i)) {
      const line = node.kind === "file" ? `\u25AA ${node.file}${context2}` : node.kind === "anchor" ? `\u2691 ${node.sig}${context2}` : `\u25B2 ${formatNodeLocation(node)}  ${node.sig}${context2}`;
      lines.push(line);
      allItems.push(line);
      remember(seedSet.has(i) ? "focus" : semanticRelation ? "direct" : "hot");
    } else if (h >= WARM_TIER || semanticRelation) {
      const warmCount = warmPerFile.get(node.file) ?? 0;
      const warmLine = semanticRelation ? `  ${displayRelation}${provenance}  ${node.name} (${node.kind}) ${formatNodeLocation(node)}` : glowLine;
      allItems.push(warmLine);
      if (!semanticRelation && node.kind !== "file" && warmCount >= MAX_UNRELATED_WARM_PER_FILE) {
        glowCounts.set(node.file, (glowCounts.get(node.file) ?? 0) + 1);
        continue;
      }
      if (!semanticRelation && node.kind !== "file") warmPerFile.set(node.file, warmCount + 1);
      lines.push(warmLine);
      remember(semanticRelation ? "direct" : "warm");
    } else {
      allItems.push(glowLine);
      glowCounts.set(node.file, (glowCounts.get(node.file) ?? 0) + 1);
    }
  }
  for (let at = capped.length; at < candidates.length; at++) {
    const node = g.nodes[candidates[at]];
    allItems.push(`  \xB7 ${node.name} (${node.kind}) ${formatNodeLocation(node)}`);
  }
  const glowLines = [...glowCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([file, c]) => `  ~ +${c} more in ${file}`);
  const items = [...lines, ...glowLines];
  const individual = lines.length;
  const header = `${opts.header ?? "fovea"}${suppressed ? ` \xB7 ${suppressed} prior results omitted` : ""}`;
  const collapsed = litTotal - individual;
  const artifactNote = opts.overflowTo ? ` \u2014 full list saved to ${opts.overflowTo}` : "";
  const renderK = (k2, note = artifactNote) => {
    const shownIndiv = Math.min(k2, individual);
    const remaining = collapsed + individual - shownIndiv;
    const footer = remaining > 0 ? `
\u2026 ${remaining} more results collapsed or outside budget${note} \u2014 use fovea_dwell for wider context` : "";
    return header + "\n" + items.slice(0, k2).join("\n") + footer;
  };
  const fits = (k2) => tokenEstimate(renderK(k2)) <= opts.budget;
  let k = items.length;
  if (!fits(k)) {
    let lo = 0;
    let hi = items.length - 1;
    k = 0;
    while (lo <= hi) {
      const mid = lo + hi >> 1;
      if (fits(mid)) {
        k = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (!fits(0)) k = -1;
  }
  let text = k >= 0 ? renderK(k) : header;
  const shown = k >= 0 ? Math.min(k, individual) : 0;
  const truncated = collapsed + individual - shown > 0;
  let overflowPath;
  if (truncated && opts.overflowTo) {
    try {
      writeSpill(opts.overflowTo, `${header}
${allItems.join("\n")}
`);
      overflowPath = opts.overflowTo;
    } catch {
      text = k >= 0 ? renderK(k, "") : header;
    }
  }
  const tokens = tokenEstimate(text);
  return {
    text,
    tokens,
    shown,
    suppressed,
    litTotal,
    candidateOmitted,
    truncated,
    overflowPath,
    revealedIds: ids.slice(0, shown),
    revealed: revealed.slice(0, shown)
  };
};
var revealGroups = (groups, opts) => {
  const ordered = [...groups].sort((a, b) => b.mass - a.mass || (a.label < b.label ? -1 : 1));
  const artifactNote = opts.overflowTo ? ` \u2014 full list saved to ${opts.overflowTo}` : "";
  const renderK = (k, note = artifactNote) => {
    const body = ordered.slice(0, k).map((gl) => `${gl.label.padEnd(2)} ${gl.detail}`);
    const rest = ordered.length - k;
    const footer = rest > 0 ? [`
\u2026 ${rest} more groups omitted${note} \u2014 use fovea_focus for detail`] : [];
    return [opts.header, ...body, ...footer].join("\n");
  };
  let hi = ordered.length;
  let kBest = ordered.length;
  if (tokenEstimate(renderK(hi)) > opts.budget) {
    let lo = 0;
    kBest = 0;
    while (lo <= hi) {
      const mid = lo + hi >> 1;
      if (tokenEstimate(renderK(mid)) <= opts.budget) {
        kBest = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
  }
  let text = renderK(kBest);
  let overflowPath;
  if (kBest < ordered.length && opts.overflowTo) {
    try {
      writeSpill(opts.overflowTo, [opts.header, ...ordered.map((gl) => `${gl.label.padEnd(2)} ${gl.detail}`)].join("\n") + "\n");
      overflowPath = opts.overflowTo;
    } catch {
      text = renderK(kBest, "");
    }
  }
  return {
    text,
    tokens: tokenEstimate(text),
    shown: Math.min(ordered.length, ordered.length),
    suppressed: 0,
    litTotal: ordered.length,
    candidateOmitted: 0,
    truncated: ordered.length > 0 && kBest < ordered.length,
    overflowPath
  };
};

// src/fovea/core/session.ts
import { isAbsolute, relative, resolve, sep } from "node:path";
var FOCUS_T0 = 2;
var sessions = owned("session.ts:sessions", () => /* @__PURE__ */ new Map(), true);
var attention = owned("session.ts:attention", () => /* @__PURE__ */ new Map(), true);
var sessionKey = (root) => `${root}:${context().focusKey}`;
var getSession = (root) => {
  const key = sessionKey(root);
  const scopes = attention.get(root) ?? /* @__PURE__ */ new Set();
  attention.set(root, scopes);
  const hit = sessions.get(key);
  if (hit) {
    hit.syncScopes = scopes;
    sessions.delete(key);
    sessions.set(key, hit);
    return hit;
  }
  const s = {
    root,
    t: FOCUS_T0,
    seeds: [],
    seedNote: "",
    generation: "",
    focusKey: "",
    scope: {},
    disclosed: /* @__PURE__ */ new Set(),
    syncScopes: scopes,
    tk: [],
    tkKey: ""
  };
  sessions.set(key, s);
  while (sessions.size > OBSERVED_ROOT_LIMIT) {
    const oldest = sessions.keys().next().value;
    sessions.delete(oldest);
  }
  return s;
};
var repoRelativePath = (root, input) => {
  const raw = input.startsWith("@") ? input.slice(1) : input;
  const rel = relative(resolve(root), resolve(root, raw));
  if (!rel || rel === "." || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return void 0;
  return rel.split(sep).join("/");
};
var syncScopeForPath = (root, input) => {
  const rel = repoRelativePath(root, input);
  if (!rel) return void 0;
  const slash = rel.indexOf("/");
  return slash < 0 ? rel : rel.slice(0, slash);
};
var observeSessionPaths = (root, paths) => {
  const session = getSession(root);
  for (const path of paths) {
    if (path === ".") {
      session.syncScopes.add(".");
      continue;
    }
    const scope = syncScopeForPath(root, path);
    if (scope) session.syncScopes.add(scope);
  }
  return [...session.syncScopes].sort();
};
var clearSessionFocus = (session) => {
  session.t = FOCUS_T0;
  session.seeds = [];
  session.seedNote = "";
  session.generation = "";
  session.focusKey = "";
  session.scope = {};
  session.disclosed.clear();
  session.tk = [];
  session.tkKey = "";
};
var retainSessionVectors = (root) => {
  const active2 = getSession(root);
  const others = [...sessions.values()].reverse().filter((s) => s !== active2 && s.tk.length);
  for (const session of others.slice(Math.max(0, ROOT_CACHE_LIMIT - 1))) {
    session.tk = [];
    session.tkKey = "";
  }
};

// src/fovea/core/basins.ts
var MAX_BASINS = 12;
var MAX_BASIN_SIZE = 64;
var MIN_BASIN_SIZE = 4;
var detectBasins = (adjacency, conductance, n, eligible, include) => {
  const triScore = (i) => {
    const nbrs = (adjacency.get(i) ?? []).slice(0, 12).map((e) => e.to);
    if (nbrs.length < 2) return 0;
    const sets = nbrs.map((j) => new Set((adjacency.get(j) ?? []).map((e) => e.to)));
    let linked = 0;
    let pairCount = 0;
    for (let a = 0; a < nbrs.length; a++) {
      for (let b2 = a + 1; b2 < nbrs.length; b2++) {
        pairCount++;
        if (sets[a].has(nbrs[b2]) || sets[b2].has(nbrs[a])) linked++;
      }
    }
    return pairCount ? linked / pairCount : 0;
  };
  const candidates = [];
  for (let i = 0; i < n; i++) {
    const deg = (adjacency.get(i) ?? []).length;
    if (deg >= 2 && (conductance[i] ?? 0) > 0 && (!eligible || eligible(i))) {
      const tri = triScore(i);
      if (tri >= 0.08 || deg >= 6) candidates.push([i, (conductance[i] ?? 0) * (0.25 + 0.75 * tri) + deg * 0.02]);
    }
  }
  candidates.sort((a, b2) => b2[1] - a[1]);
  const claimed = /* @__PURE__ */ new Set();
  const basins = [];
  for (const [seed] of candidates) {
    if (basins.length >= MAX_BASINS) break;
    if (claimed.has(seed)) continue;
    const members = /* @__PURE__ */ new Set([seed]);
    const order = [seed];
    let internal = 0;
    const boundary = /* @__PURE__ */ new Map();
    for (const e of adjacency.get(seed) ?? []) {
      if (!include || include(e.to)) boundary.set(e.to, (boundary.get(e.to) ?? 0) + e.w);
    }
    while (order.length < MAX_BASIN_SIZE && boundary.size) {
      let best = -1;
      let bestRatio = -1;
      for (const [j, inW] of boundary) {
        if (claimed.has(j) || members.has(j) || include && !include(j)) continue;
        const total = [...adjacency.get(j) ?? []].reduce((s, e) => s + e.w, 0);
        const ratio = total > 0 ? inW / total : 0;
        if (ratio > bestRatio) {
          bestRatio = ratio;
          best = j;
        }
      }
      if (best < 0 || bestRatio < 0.15) break;
      members.add(best);
      order.push(best);
      internal += boundary.get(best) ?? 0;
      boundary.delete(best);
      for (const e of adjacency.get(best) ?? []) {
        if (members.has(e.to) || include && !include(e.to)) continue;
        boundary.set(e.to, (boundary.get(e.to) ?? 0) + e.w);
      }
      const cut = [...boundary.values()].reduce((a, b2) => a + b2, 0);
      if (cut > 2.6 * Math.max(internal, 1e-3) && order.length >= MIN_BASIN_SIZE) break;
    }
    if (order.length < MIN_BASIN_SIZE) continue;
    if (order.length > Math.max(40, n / 3)) continue;
    for (const m of members) claimed.add(m);
    basins.push({ seed, members: order, mass: 0 });
  }
  return basins;
};

// src/fovea/core/astgrep.ts
import { execFile as execFile2, spawn } from "node:child_process";
var LANG_BY_EXT = {
  ts: "TypeScript",
  tsx: "Tsx",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "Tsx",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  go: "Go",
  rs: "Rust",
  bend: "Bend",
  // Native source reader; never sent to ast-grep patterns.
  // Second tier: symbols via ast-grep outline; name derivation is heuristic.
  ex: "Elixir",
  exs: "Elixir",
  rb: "Ruby",
  c: "C",
  h: "C",
  cc: "C++",
  cpp: "C++",
  cxx: "C++",
  hpp: "C++",
  hh: "C++",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  lua: "Lua",
  php: "Php",
  swift: "Swift",
  scala: "Scala",
  hs: "Haskell",
  sh: "Bash"
};
var BINARY_EXTS = /* @__PURE__ */ new Set(["beam", "pyc", "o", "obj", "so", "a", "d"]);
var isBinaryExt = (file) => BINARY_EXTS.has(file.split(".").pop()?.toLowerCase() ?? "");
var CONFIG_EXTS = /* @__PURE__ */ new Set([
  "yaml",
  "yml",
  "json",
  "toml",
  "env",
  "tf",
  "hcl",
  "md",
  // Parsed by the exact protocol readers; kept out of ast-grep language scans.
  "proto",
  "graphql",
  "gql"
]);
var anonymousVariadics = (pattern) => pattern.replace(/\$\$\$[A-Za-z_][A-Za-z0-9_]*/g, () => "$$$");
var metavarIn = (pattern, key) => {
  for (let i = pattern.indexOf(`$${key}`); i >= 0; i = pattern.indexOf(`$${key}`, i + 1)) {
    if (!/[\w$]/.test(pattern[i + 1 + key.length] ?? "")) return true;
  }
  return false;
};
var liveConstraints = (pattern, constraints) => {
  const out = {};
  for (const [key, constraint] of Object.entries(constraints)) {
    if (metavarIn(pattern, key)) out[key] = constraint;
  }
  return Object.keys(out).length ? out : void 0;
};
var binary = () => context().parserPath;
var FAILURE_TTL_MS = 15e3;
var hasAstGrepAsync = async () => !!binary();
var AST_GREP_CHUNK = envInt("FOVEA_AST_GREP_CHUNK", 160, 32, 2048);
var failures = owned("extractionFailures", () => []);
var recordFailure = (op, files, lang) => {
  failures.push({ op, lang, files });
};
var drainExtractionFailures = () => failures.splice(0, failures.length);
var RUN_TIMEOUT = 12e4;
var RUN_MAX_BUFFER = 16 * 1024 * 1024;
var run = async (args, cwd) => spawnGate.run(
  () => new Promise((resolve6) => {
    execFile2(
      binary(),
      args,
      { cwd, signal: context().signal, killSignal: "SIGKILL", env: safeEnvironment(), encoding: "utf8", timeout: RUN_TIMEOUT, maxBuffer: RUN_MAX_BUFFER },
      (error, stdout, stderr) => {
        if (error && (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || error.code === "E2BIG")) {
          resolve6({ ok: false, stdout: "", split: true });
          return;
        }
        if (error && typeof error.code !== "number") {
          resolve6({ ok: false, stdout: "", split: false });
          return;
        }
        const status = error && typeof error.code === "number" ? error.code : 0;
        if (status !== 0) {
          if ((stderr ?? "").trim()) {
            resolve6({ ok: false, stdout: "", split: false });
            return;
          }
          resolve6({ ok: true, stdout: "", split: false });
          return;
        }
        resolve6({ ok: true, stdout: stdout ?? "", split: false });
      }
    );
  })
);
var langOf = (file) => {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  return LANG_BY_EXT[ext];
};
var isConfigFile = (file) => {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  return CONFIG_EXTS.has(ext);
};
var groupByLang = (files) => {
  const m = /* @__PURE__ */ new Map();
  for (const f of files) {
    const lang = langOf(f);
    if (!lang) continue;
    const arr = m.get(lang) ?? [];
    arr.push(f);
    m.set(lang, arr);
  }
  return m;
};
var runChunked = async (files, chunkArgs, cwd) => {
  const chunks = [];
  for (let i = 0; i < files.length; i += AST_GREP_CHUNK) chunks.push(files.slice(i, i + AST_GREP_CHUNK));
  const adaptive = async (chunk) => {
    const result = await run(chunkArgs(chunk), cwd);
    if (!result.split || chunk.length === 1) return [{ chunk, result }];
    const middle = Math.ceil(chunk.length / 2);
    const halves = await Promise.all([
      adaptive(chunk.slice(0, middle)),
      adaptive(chunk.slice(middle))
    ]);
    return [...halves[0], ...halves[1]];
  };
  const settled = await mapLimit(chunks, SPAWN_CONCURRENCY, adaptive);
  return settled.flat();
};
var outlineStructured = async (files, _lang, cwd) => {
  const out = [];
  const settled = await runChunked(
    files,
    (chunk) => ["outline", "--json=compact", "--view=expanded", "--", ...chunk],
    cwd
  );
  const positions = new Map(files.map((file, i) => [file, i]));
  for (const { result } of settled) {
    if (!result.ok || !result.stdout.trim()) return void 0;
    try {
      const parsed = JSON.parse(result.stdout);
      if (!Array.isArray(parsed)) return void 0;
      if (parsed.some((file) => !positions.has(file.path))) return void 0;
      parsed.sort((a, b) => positions.get(a.path) - positions.get(b.path));
      for (const file of parsed) out.push(file);
    } catch {
      return void 0;
    }
  }
  return out;
};
var outline = async (files, lang, cwd) => {
  let out = "";
  const settled = await runChunked(files, (chunk) => ["outline", "--", ...chunk], cwd);
  for (const { chunk, result } of settled) {
    if (!result.ok) {
      recordFailure("outline", chunk, lang);
      continue;
    }
    out += result.stdout;
  }
  return out;
};
var lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var canonicalMatchKey = (m) => JSON.stringify([
  m.text,
  Object.entries(m.metaVariables?.single ?? {}).sort(([a], [b]) => lexical(a, b)).map(([k, v]) => [k, v.text, v.range?.start.line ?? null]),
  Object.entries(m.metaVariables?.multi ?? {}).sort(([a], [b]) => lexical(a, b)).map(([k, v]) => [k, v.map((x) => [x.text, x.range?.start.line ?? null])])
]);
function orderMatches(matches, files, rules) {
  const paths = new Map(files.map((file, index) => [file, index]));
  const ids = new Map(rules?.map((rule, index) => [rule.id, index]) ?? []);
  if (rules && ids.size !== rules.length) throw new Error("Duplicate parser rule identity");
  const keyed = matches.map((match) => {
    const file = paths.get(match.file);
    const rule = rules ? ids.get(match.ruleId) : 0;
    if (file === void 0 || rule === void 0 || !Number.isSafeInteger(match.range?.start.line) || !Number.isSafeInteger(match.range?.start.column)) throw new Error("Parser match outside declared input");
    return { match, file, rule, key: canonicalMatchKey(match) };
  });
  keyed.sort((a, b) => a.rule - b.rule || a.file - b.file || a.match.range.start.line - b.match.range.start.line || a.match.range.start.column - b.match.range.start.column || b.match.text.length - a.match.text.length || lexical(a.key, b.key));
  return keyed.map((entry) => entry.match);
}
var fromRawMatch = (m) => {
  const single = {};
  const singleLines = {};
  const multi = {};
  for (const [key, value] of Object.entries(m.metaVariables?.single ?? {}).sort(([a], [b]) => lexical(a, b))) {
    single[key] = value.text;
    singleLines[key] = value.range ? value.range.start.line + 1 : 0;
  }
  for (const [key, value] of Object.entries(m.metaVariables?.multi ?? {}).sort(([a], [b]) => lexical(a, b)))
    multi[key] = value.map((item) => ({ text: item.text, line: item.range ? item.range.start.line + 1 : 0 }));
  return { file: m.file, line: m.range.start.line + 1, text: m.text, single, singleLines, multi };
};
var scanSupport = owned("astgrep.ts:scanSupport", () => /* @__PURE__ */ new Map());
var scanSupportInflight = owned("astgrep.ts:scanSupportInflight", () => /* @__PURE__ */ new Map());
var hasRuleScan = () => {
  const bin = binary();
  const hit = scanSupport.get(bin);
  if (hit && (hit.ok || Date.now() - hit.at < FAILURE_TTL_MS)) return Promise.resolve(hit.ok);
  const pending = scanSupportInflight.get(bin);
  if (pending) return pending;
  const probe = spawnGate.run(
    () => new Promise((resolve6) => {
      execFile2(bin, ["scan", "--help"], { signal: context().signal, killSignal: "SIGKILL", env: safeEnvironment(), encoding: "utf8", timeout: 5e3, maxBuffer: 1024 * 1024 }, (error) => {
        resolve6(!error);
      });
    })
  ).then((ok) => {
    scanSupport.set(bin, { ok, at: Date.now() });
    return ok;
  }).finally(() => scanSupportInflight.delete(bin));
  scanSupportInflight.set(bin, probe);
  return probe;
};
var ruleDocuments = (rules) => rules.map(({ id, language, pattern, constraints }) => {
  const live = constraints ? liveConstraints(pattern, constraints) : void 0;
  return JSON.stringify({ id, language, rule: { pattern }, ...live ? { constraints: live } : {} });
}).join("\n---\n");
var scanChunk = (rulePath, files, cwd, rules) => spawnGate.run(
  () => new Promise((resolve6) => {
    const child = spawn(
      binary(),
      ["scan", "--rule", rulePath, "--json=stream", "--", ...files],
      { cwd, signal: context().signal, killSignal: "SIGKILL", env: safeEnvironment(), stdio: ["ignore", "pipe", "pipe"] }
    );
    const matches = [];
    let bytes = 0;
    let carry = "";
    let parseFailed = false;
    let timedOut = false;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve6(value);
    };
    const accept = (line) => {
      if (!line || parseFailed) return;
      try {
        const raw = JSON.parse(line);
        if (!raw.ruleId || !raw.range?.start || typeof raw.file !== "string") {
          parseFailed = true;
          return;
        }
        matches.push(raw);
      } catch {
        parseFailed = true;
      }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > RUN_MAX_BUFFER) {
        parseFailed = true;
        child.kill("SIGKILL");
        return;
      }
      const lines = (carry + chunk).split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) accept(line);
    });
    child.stderr.resume();
    child.on("error", () => {
      parseFailed = true;
    });
    child.on("close", (code) => {
      if (carry.trim()) accept(carry);
      try {
        finish(code === 0 && !timedOut && !parseFailed ? orderMatches(matches, files, rules).map((raw) => ({ ...fromRawMatch(raw), ruleId: raw.ruleId })) : void 0);
      } catch {
        finish(void 0);
      }
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, RUN_TIMEOUT);
    timer.unref?.();
  })
);
var scanRules = async (rules, files, cwd) => {
  if (!rules.length || !files.length) return [];
  if (!await hasRuleScan()) return void 0;
  try {
    return await withScanRuleFile(ruleDocuments(rules), async (rulePath) => {
      const chunks = [];
      for (let i = 0; i < files.length; i += AST_GREP_CHUNK) {
        chunks.push(files.slice(i, i + AST_GREP_CHUNK));
      }
      const settled = await mapLimit(
        chunks,
        SPAWN_CONCURRENCY,
        (chunk) => scanChunk(rulePath, chunk, cwd, rules).catch(() => void 0)
      );
      if (settled.some((matches) => matches === void 0)) return void 0;
      const out = [];
      for (const matches of settled) for (const match of matches) out.push(match);
      return out;
    });
  } catch {
    return void 0;
  }
};
var patternRun = async (pattern, lang, files, cwd) => {
  const out = [];
  const settled = await runChunked(
    files,
    (chunk) => ["run", "--pattern", pattern, "--lang", lang, "--json=compact", "--", ...chunk],
    cwd
  );
  for (const { chunk, result } of settled) {
    if (!result.ok) {
      recordFailure("run", chunk, lang);
      continue;
    }
    if (!result.stdout.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      recordFailure("run", chunk, lang);
      continue;
    }
    if (!Array.isArray(parsed)) {
      recordFailure("run", chunk, lang);
      continue;
    }
    try {
      const ordered = orderMatches(parsed, chunk).map(fromRawMatch);
      for (const match of ordered) out.push(match);
    } catch {
      recordFailure("run", chunk, lang);
    }
  }
  return out;
};
var patternRunAll = async (patterns, lang, files, cwd) => {
  const perPattern = await mapLimit(patterns, patterns.length || 1, (p) => patternRun(p, lang, files, cwd));
  const out = [];
  for (const matches of perPattern) for (const m of matches) out.push(m);
  return out;
};

// src/fovea/core/bend.ts
var NAME = "[A-Za-z_][A-Za-z0-9_.]*";
var DECL = new RegExp(`^(?:@unsafe\\s+)?(def|law|type)\\s+(${NAME})(?=[\\s(<:]|$)`);
var CONSTRUCTOR = new RegExp(`^\\s+(${NAME})\\s*\\{`);
var CALL = new RegExp(`\\b(${NAME})\\s*!?\\s*\\(`, "g");
var CALL_KEYWORDS = /* @__PURE__ */ new Set(["def", "type", "law", "match", "case", "do", "return", "for", "exs", "where", "is", "import", "Type", "Data", "Kind", "Quant"]);
var IMPORT = new RegExp(`^import\\s+(\\S+?)(?:\\s+as\\s+(${NAME}))?\\s*$`);
var extractBend = (file, text) => {
  const facts = { symbols: [], imports: [], calls: [], literals: [] };
  let inType = false;
  let header = false;
  let brackets = [];
  let quote = "";
  let value = "";
  let literalLine = 0;
  const lines = text.split("\n");
  for (let at = 0; at < lines.length; at++) {
    const raw = lines[at];
    const line = at + 1;
    let code = "";
    let visible = "";
    const strings2 = [];
    let start = -1;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (quote) {
        code += " ";
        visible += ch;
        if (ch === "\\" && i + 1 < raw.length) {
          const escaped = raw[++i];
          value += { n: "\n", r: "\r", t: "	", "0": "\0" }[escaped] ?? escaped;
          code += " ";
          visible += escaped;
        } else if (ch === quote) {
          if (quote === '"') {
            strings2.push({ start, text: value });
            if (value.length >= 2 && value.length <= 200) facts.literals.push({ file, line: literalLine, text: value });
          }
          quote = "";
        } else value += ch;
      } else if (ch === "#") {
        break;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        value = "";
        literalLine = line;
        start = i;
        code += " ";
        visible += ch;
      } else {
        code += ch;
        visible += ch;
      }
    }
    if (quote) value += "\n";
    if (!code.trim()) continue;
    const decl = DECL.exec(code);
    if (decl) {
      const kind = decl[1] === "def" ? "function" : decl[1] === "type" ? "type" : "decl";
      const sig = visible.trim();
      facts.symbols.push({ file, line, name: decl[2], kind, sig: sig.length > 140 ? sig.slice(0, 137) + "..." : sig, lang: "Bend" });
      inType = decl[1] === "type";
      header = true;
      brackets = [];
    } else if (!header && /^\S/.test(code)) {
      inType = false;
    }
    if (header) {
      for (let i = 0; i < code.length; i++) {
        const ch = code[i];
        if ("(<{[".includes(ch)) brackets.push(ch);
        else if (")>}]".includes(ch) && !(ch === ">" && code[i - 1] === "-")) {
          if (brackets.at(-1) === { ")": "(", ">": "<", "}": "{", "]": "[" }[ch]) brackets.pop();
        } else if (ch === ":" && brackets.length === 0) {
          header = false;
          code = " ".repeat(i + 1) + code.slice(i + 1);
          break;
        }
      }
      if (header) continue;
    }
    const imp = IMPORT.exec(code);
    if (imp) {
      facts.imports.push({ file, line, spec: imp[1], ...imp[2] ? { alias: imp[2] } : {} });
      continue;
    }
    if (/^\s+import\s+/.test(code)) {
      const path = strings2.find((s) => s.start >= 0 && /^\s+import\s+$/.test(code.slice(0, s.start)));
      if (path) facts.imports.push({ file, line, spec: path.text });
      continue;
    }
    if (inType) {
      const ctor = CONSTRUCTOR.exec(code);
      if (ctor) facts.symbols.push({ file, line, name: ctor[1], kind: "decl", sig: visible.trim().slice(0, 140), lang: "Bend" });
      continue;
    }
    CALL.lastIndex = 0;
    for (const call of code.matchAll(CALL)) {
      if (!CALL_KEYWORDS.has(call[1])) facts.calls.push({ file, line, callee: call[1] });
    }
  }
  const symbols = /* @__PURE__ */ new Map();
  for (const symbol of facts.symbols) {
    if (!symbols.has(symbol.name) || symbol.kind === "function") symbols.set(symbol.name, symbol);
  }
  facts.symbols = [...symbols.values()].sort((a, b) => a.line - b.line);
  return facts;
};

// src/fovea/core/source.ts
import { readFile } from "node:fs/promises";
import { join as join3 } from "node:path";
var makeFileSource = (root, contents) => {
  const inflight2 = /* @__PURE__ */ new Map();
  return {
    read(file) {
      const cached = contents?.get(file);
      if (cached !== void 0) return Promise.resolve(cached);
      const pending = inflight2.get(file);
      if (pending) return pending;
      const p = readFile(join3(root, file), "utf8").then(
        (text) => text,
        () => void 0
      ).finally(() => inflight2.delete(file));
      inflight2.set(file, p);
      return p;
    }
  };
};
var readAll = async (files, source) => {
  const out = /* @__PURE__ */ new Map();
  await mapLimit(files, IO_CONCURRENCY, async (file) => {
    const text = await source.read(file);
    if (text !== void 0) out.set(file, text);
  });
  return out;
};

// src/fovea/core/extract.ts
var RX = (re, kind, parentGroup, nameGroup) => ({ re, kind, parentGroup, nameGroup });
var SIG_RULES = {
  TypeScript: [
    RX(/\bclass\s+([A-Za-z_$][\w$]*)/, "class"),
    RX(/\binterface\s+([A-Za-z_$][\w$]*)/, "interface"),
    RX(/\benum\s+([A-Za-z_$][\w$]*)/, "type"),
    RX(/\btype\s+([A-Za-z_$][\w$]*)/, "type"),
    RX(/\bfunction\s+([A-Za-z_$][\w$]*)/, "function"),
    RX(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, "function")
  ],
  Go: [
    RX(/^func\s*\(\s*\w+\s+\*?([A-Za-z_]\w*)\s*\)\s*([A-Za-z_]\w*)/, "method", 1, 2),
    RX(/^func\s+([A-Za-z_]\w*)/, "function"),
    RX(/^type\s+([A-Za-z_]\w*)\s+struct/, "class"),
    RX(/^type\s+([A-Za-z_]\w*)\s+interface/, "interface"),
    RX(/^type\s+([A-Za-z_]\w*)/, "type")
  ],
  Python: [
    RX(/^\s*class\s+([A-Za-z_]\w*)/, "class"),
    RX(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, "function"),
    RX(/^\s*([A-Za-z_]\w*)\s*=/, "decl")
  ],
  Rust: [
    RX(/\bfn\s+([A-Za-z_]\w*)/, "function"),
    RX(/\bstruct\s+([A-Za-z_]\w*)/, "class"),
    RX(/\b(?:trait|enum|mod)\s+([A-Za-z_]\w*)/, "type")
  ],
  Elixir: [
    RX(/^\s*defmodule\s+([\w.]+)/, "class"),
    RX(/^\s*defprotocol\s+([\w.]+)/, "interface"),
    // Named function heads carry arity (name/2): strip it for stable ids.
    RX(/^\s*def(?:p|macro|macrop)?\s+([a-z_]\w*[!?=]?)/, "function")
  ],
  Ruby: [
    RX(/^\s*(?:class|module)\s+([\w:]+)/, "class"),
    RX(/^\s*def\s+(?:self\.)?([\w!?=]+)/, "function")
  ],
  C: [
    RX(/^[A-Za-z_][\w\s*]*?\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{?/, "function"),
    RX(/^\s*(?:struct|enum|union)\s+([A-Za-z_]\w*)/, "class")
  ],
  Java: [
    RX(/\b(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/, "class")
  ],
  Lua: [RX(/\bfunction\s+([\w.:]+)/, "function")]
};
SIG_RULES["C++"] = SIG_RULES.C;
SIG_RULES.Kotlin = SIG_RULES.Java;
SIG_RULES.JavaScript = SIG_RULES.TypeScript;
SIG_RULES.Tsx = SIG_RULES.TypeScript;
var kindOf = (kind) => kind === "method" ? "method" : kind === "field" ? "field" : "decl";
var cleanSig = (line) => {
  let s = line.trim();
  const brace = s.indexOf("{");
  if (brace > 0 && s.length > 140) s = s.slice(0, brace).trimEnd() + " { ... }";
  if (s.length > 140) s = s.slice(0, 137) + "...";
  return s;
};
var deriveName = (sig, lang, parentHint) => {
  for (const r of SIG_RULES[lang] ?? []) {
    const m = r.re.exec(sig);
    if (!m) continue;
    if (r.parentGroup && m[r.parentGroup] && m[r.nameGroup ?? 1]) {
      return { name: `${m[r.parentGroup]}.${m[r.nameGroup ?? 1]}`, kind: r.kind };
    }
    if (m[1]) return { name: parentHint ? `${parentHint}.${m[1]}` : m[1], kind: r.kind };
  }
  const first = sig.trim().split(/[\s(:={]/)[0] ?? "?";
  return { name: first.replace(/^[*&]+/, "") || "?", kind: "decl" };
};
var OUTLINE_KINDS = {
  class: "class",
  struct: "class",
  object: "class",
  interface: "interface",
  trait: "interface",
  protocol: "interface",
  enum: "type",
  type: "type",
  alias: "type",
  function: "function",
  method: "method",
  field: "field",
  property: "field",
  constant: "decl",
  variable: "decl"
};
var outlineKind = (symbol, lang) => {
  if (symbol.symbolType === "constructor") return "method";
  const mapped = OUTLINE_KINDS[symbol.symbolType];
  if (symbol.role === "member" && mapped) return mapped;
  const derived = deriveName(symbol.signature, lang).kind;
  if (derived !== "decl") return derived;
  return mapped ?? derived;
};
var identifierRe = (name) => new RegExp(`(^|[^A-Za-z0-9_$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_$]|$)`);
var MAX_OUTLINE_NAME = 256;
var OUTLINE_NAME_MALFORMED = /[\s{}]/;
var OUTLINE_NAME_HEAD = /^[A-Za-z_$][A-Za-z0-9_$]*/;
var outlineName = (name) => {
  if (name.length <= MAX_OUTLINE_NAME && !OUTLINE_NAME_MALFORMED.test(name)) return name;
  return OUTLINE_NAME_HEAD.exec(name)?.[0];
};
var topLocation = (item, sourceLines) => {
  let line = item.range.start.line + 1;
  let sig = cleanSig(item.signature || item.name);
  if (item.name && (!identifierRe(item.name).test(sig) || /^@/.test(sig))) {
    const end = Math.min(sourceLines.length - 1, item.range.end?.line ?? item.range.start.line + 12);
    const nameRe = identifierRe(item.name);
    for (let i = item.range.start.line; i <= end; i++) {
      const candidate = sourceLines[i];
      if (candidate && nameRe.test(candidate)) {
        line = i + 1;
        sig = cleanSig(candidate);
        break;
      }
    }
    return { line, sig };
  }
  const startText = (sourceLines[item.range.start.line] ?? "").trim();
  const sigHead = (sig.split("\n")[0] ?? "").trim();
  if (sigHead && startText && !startText.includes(sigHead) && !sigHead.includes(startText)) {
    const end = Math.min(sourceLines.length - 1, item.range.end?.line ?? item.range.start.line + 12);
    for (let i = item.range.start.line; i <= end; i++) {
      const candidate = (sourceLines[i] ?? "").trim();
      if (candidate && (candidate.includes(sigHead) || sigHead.includes(candidate))) {
        line = i + 1;
        sig = cleanSig(sourceLines[i] ?? "");
        break;
      }
    }
  }
  return { line, sig };
};
var parseStructuredOutline = async (files, source) => {
  const out = [];
  for (const record of files) {
    const file = record.path.replace(/^\.\//, "");
    const items = [];
    for (const item of record.items) {
      const name = outlineName(item.name);
      if (name !== void 0) items.push(name === item.name ? item : { ...item, name });
    }
    const sourceLines = (await source.read(file))?.split("\n") ?? [];
    const concreteParents = new Set(
      items.filter((item) => item.symbolType !== "object").map((item) => item.name)
    );
    for (const item of items) {
      const kind = outlineKind(item, record.language);
      let name = item.name;
      if (kind === "method") {
        const derived = deriveName(item.signature, record.language);
        if (derived.kind === "method" && derived.name.includes(".")) name = derived.name;
      }
      if (!(item.symbolType === "object" && concreteParents.has(item.name))) {
        const location = topLocation(item, sourceLines);
        out.push({ name, kind, file, line: location.line, sig: location.sig, lang: record.language });
      }
      for (const member of item.members ?? []) {
        const memberName = outlineName(member.name);
        if (memberName === void 0) continue;
        const memberKind = outlineKind(member, record.language);
        out.push({
          name: `${item.name}.${memberName}`,
          kind: memberKind,
          file,
          line: member.range.start.line + 1,
          sig: cleanSig(member.signature || `${memberKind} ${item.name}.${memberName}`),
          lang: record.language
        });
      }
    }
  }
  return dedupe(out, (symbol) => `${symbol.name}@${symbol.file}`);
};
var parseOutlineText = (text, lang) => {
  const out = [];
  let file = "";
  let top;
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    if (/^\s*@\w/.test(raw)) continue;
    const entry = /^\s*(\d+):\s(.*)$/.exec(raw);
    const child = /^(\s+)(method|field):\s(.+)$/.exec(raw);
    if (entry) {
      const sig = cleanSig(entry[2]);
      if (!sig) continue;
      const named = deriveName(sig, lang);
      top = { name: named.name, kind: named.kind, file, line: Number(entry[1]), sig, lang };
      out.push(top);
      continue;
    }
    if (child && top) {
      for (const part of child[3].split(",")) {
        const name = part.trim();
        if (!name) continue;
        out.push({
          name: `${top.name}.${name}`,
          kind: kindOf(child[2]),
          file,
          line: top.line,
          lineApproximate: true,
          sig: `${kindOf(child[2])} ${top.name}.${name}`,
          lang
        });
      }
      continue;
    }
    file = raw.trim();
    top = void 0;
  }
  return out;
};
var defaultSource = (cwd) => makeFileSource(cwd);
var bendFacts = async (files, source) => mapLimit(files.filter((file) => langOf(file) === "Bend"), SOURCE_SCAN_CONCURRENCY, async (file) => extractBend(file, await source.read(file) ?? ""));
var extractSymbols = async (files, cwd, source = defaultSource(cwd)) => {
  const out = [];
  for (const [lang, langFiles] of groupByLang(files)) {
    if (lang === "Bend") {
      for (const facts of await bendFacts(langFiles, source)) pushAll(out, facts.symbols);
      continue;
    }
    const structured = await outlineStructured(langFiles, lang, cwd);
    if (structured) {
      const parsed = await parseStructuredOutline(structured, source);
      if (parsed.length || structured.some((file) => file.items.length > 0)) {
        pushAll(out, parsed);
        continue;
      }
    }
    const text = await outline(langFiles, lang, cwd);
    if (!text.trim()) continue;
    pushAll(out, parseOutlineText(text, lang));
  }
  return out.filter((symbol) => symbol.file);
};
var IMPORT_PATTERNS = {
  TypeScript: [
    'import $$$I from "$M"',
    "import $$$I from '$M'",
    'import "$M"',
    "import '$M'",
    // ast-grep >= current rejects 'export $$$I from ...' parse-wide; the
    // named and star forms are the valid decomposition of the same intent.
    'export { $$$I } from "$M"',
    "export { $$$I } from '$M'",
    'export * from "$M"',
    "export * from '$M'",
    "require($EXPR)",
    "import($EXPR)"
  ],
  Go: ['import "$M"', "import ( $$$S )"],
  Python: ["import $M", "from $M import $$$I"],
  Rust: ["use $M;"]
};
IMPORT_PATTERNS.JavaScript = IMPORT_PATTERNS.TypeScript;
IMPORT_PATTERNS.Tsx = IMPORT_PATTERNS.TypeScript;
var supportsImportExtraction = (language) => language === "Bend" || !!IMPORT_PATTERNS[language]?.length;
var importExpression = (raw) => {
  const expression = raw.trim();
  const literal = (text) => {
    const match = /^(['"`])([^\\\r\n]*)\1$/.exec(text.trim());
    if (!match || match[2].includes(match[1]) || match[1] === "`" && match[2].includes("${")) return void 0;
    return match[2];
  };
  const value = literal(expression);
  if (value !== void 0) return { spec: value };
  const unknown = { spec: expression, dynamic: {} };
  if (expression.length > 1024) return unknown;
  const identifier = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
  const template = /^`([^`\\$]*)\$\{([^{}]+)\}([^`\\$]*)`$/.exec(expression);
  if (template && identifier.test(template[2].trim())) {
    return { spec: expression, dynamic: { prefix: template[1], suffix: template[3] } };
  }
  const head = /^(['"])([^\\'"\r\n]*)\1\s*\+\s*/.exec(expression);
  if (head) {
    const rest = expression.slice(head[0].length);
    if (identifier.test(rest)) return { spec: expression, dynamic: { prefix: head[2], suffix: "" } };
    const plus = rest.indexOf("+");
    if (plus >= 0 && identifier.test(rest.slice(0, plus).trim())) {
      const suffix = literal(rest.slice(plus + 1));
      if (suffix !== void 0) return { spec: expression, dynamic: { prefix: head[2], suffix } };
    }
  }
  return unknown;
};
var importsFromMatches = (matches) => {
  const out = [];
  for (const m of matches) {
    if (m.single.EXPR !== void 0) {
      out.push({ file: m.file, line: m.line, ...importExpression(m.single.EXPR) });
      continue;
    }
    const spec = m.single.M;
    if (spec) {
      out.push({ file: m.file, spec, line: m.line });
      continue;
    }
    for (const blockText of [m.text, ...(m.multi.S ?? []).map((item) => item.text)]) {
      for (const sm of blockText.matchAll(/"([^"\n]+)"/g)) {
        out.push({ file: m.file, spec: sm[1], line: m.line });
      }
    }
  }
  return dedupe(out, (i) => `${i.file}|${i.spec}|${i.line}`);
};
var extractImports = async (files, cwd, source = defaultSource(cwd)) => {
  const perLang = await Promise.all([...groupByLang(files)].map(
    ([lang, langFiles]) => patternRunAll(IMPORT_PATTERNS[lang] ?? [], lang, langFiles, cwd)
  ));
  const matches = [];
  for (const local of perLang) pushAll(matches, local);
  return [...importsFromMatches(matches), ...(await bendFacts(files, source)).flatMap((facts) => facts.imports)];
};
var CALL_PATTERNS = ["$O.$M($$$A)", "$F($$$A)"];
var CALL_WARDS = /* @__PURE__ */ new Set([
  // generic member-call noise and loggers
  "log",
  "info",
  "warn",
  "debug",
  "trace",
  "close",
  "flush",
  "tostring",
  "valueof",
  "tolowercase",
  "touppercase",
  "printf",
  "sprintf",
  "fprintf",
  "errorf",
  "fatal",
  "fatalf",
  "panic",
  "panicf",
  "println",
  "print",
  // JS/TS runtime + test frameworks
  "require",
  "console",
  "settimeout",
  "setinterval",
  "cleartimeout",
  "clearinterval",
  "queuemicrotask",
  "parseint",
  "parsefloat",
  "isnan",
  "isfinite",
  "it",
  "describe",
  "test",
  "expect",
  "xit",
  "xdescribe",
  "beforeeach",
  "aftereach",
  "beforeall",
  "afterall",
  "jest",
  "vitest",
  "vi",
  "mock",
  "spyon",
  // python builtins
  "str",
  "int",
  "float",
  "bool",
  "bytes",
  "bytearray",
  "list",
  "dict",
  "set",
  "tuple",
  "frozenset",
  "super",
  "isinstance",
  "issubclass",
  "getattr",
  "setattr",
  "hasattr",
  "delattr",
  "open",
  "range",
  "enumerate",
  "zip",
  "sorted",
  "next",
  "all",
  "any",
  "sum",
  "abs",
  "round",
  "format",
  "chr",
  "ord",
  "hex",
  "oct",
  "bin",
  "id",
  "input",
  "vars",
  "dir",
  "callable",
  "hash",
  "object",
  "property",
  "staticmethod",
  "classmethod",
  "memoryview",
  "slice",
  "type",
  "repr",
  "len",
  // go builtins
  "append",
  "cap",
  "clear",
  "delete",
  "make",
  "new",
  "copy",
  "complex",
  "real",
  "imag",
  "recover",
  "min",
  "max",
  // rust std noise
  "unwrap",
  "expect",
  "clone",
  "into",
  "from",
  "collect",
  "iter",
  "eprintln",
  "format",
  "vec",
  "assert",
  "asserteq",
  "assertne",
  "dbg"
]);
var CALL_WARD_PATTERN = `^(?i:${[...CALL_WARDS].join("|")})$`;
var isTestFile = (file) => /(^|\/)(test_|conftest)|\.(test|spec)\.[tj]sx?$|_test\.go$/.test(file);
var callsFromMatches = (matches) => {
  const out = [];
  for (const m of matches) {
    const callee = m.single.M ?? m.single.F;
    if (!callee) continue;
    const name = callee.trim();
    if (CALL_WARDS.has(name.toLowerCase())) continue;
    if (name.length > 1) out.push({ file: m.file, line: m.line, callee: name });
  }
  return out;
};
var extractCalls = async (files, cwd, source = defaultSource(cwd)) => {
  const perLang = await Promise.all([...groupByLang(files)].filter(([lang]) => lang !== "Bend").map(
    ([lang, langFiles]) => patternRunAll(CALL_PATTERNS, lang, langFiles, cwd)
  ));
  const matches = [];
  for (const local of perLang) pushAll(matches, local);
  return [...callsFromMatches(matches), ...(await bendFacts(files, source)).flatMap((facts) => facts.calls)];
};
var STRING_PATTERNS = {
  TypeScript: ['"$S"', "'$S'", "`$S`"],
  Go: ['"$S"', "`$S`"],
  Python: ['"$S"', "'$S'"],
  Rust: ['"$S"']
};
STRING_PATTERNS.JavaScript = STRING_PATTERNS.TypeScript;
STRING_PATTERNS.Tsx = STRING_PATTERNS.TypeScript;
var QUOTED_RE = /"([^"\n]{2,200})"|'([^'\n]{2,200})'/g;
var TEMPLATE_RE = /`([^`\n]{2,200})`/g;
var PATH_TOKEN_RE = /^(?:\/[\w.~+\-{}*:$]+\/?|\/?[\w.~+\-]+(?:\/[\w.~+\-{}*:$]+)+\/?)$/;
var ENV_TOKEN_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
var CONFIG_BARE_RE = /(^|[:=\s])(\/[\w.~+\-{}*]+(?:\/[\w.~+\-{}*]+)+|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(?=$|[:=\s])/g;
var SOURCE_SCAN_CONCURRENCY = 8;
var extractConfigLiterals = async (files, cwd, source = defaultSource(cwd)) => {
  const configs = files.filter(isConfigFile);
  const perFile = await mapLimit(configs, SOURCE_SCAN_CONCURRENCY, async (f) => {
    const local = [];
    const text = await source.read(f);
    if (text === void 0) return local;
    const seenLine = /* @__PURE__ */ new Set();
    text.split("\n").forEach((lineText, i) => {
      QUOTED_RE.lastIndex = 0;
      for (let q; q = QUOTED_RE.exec(lineText); ) {
        const t = q[1] ?? q[2];
        if (t && !seenLine.has(`${i}|${t}`)) {
          seenLine.add(`${i}|${t}`);
          local.push({ file: f, line: i + 1, text: t });
        }
      }
      CONFIG_BARE_RE.lastIndex = 0;
      for (let b; b = CONFIG_BARE_RE.exec(lineText); ) {
        const t = b[2];
        if ((PATH_TOKEN_RE.test(t) || ENV_TOKEN_RE.test(t)) && !seenLine.has(`${i}|${t}`)) {
          seenLine.add(`${i}|${t}`);
          local.push({ file: f, line: i + 1, text: t });
        }
      }
    });
    return local;
  });
  const out = [];
  for (const local of perFile) pushAll(out, local);
  return out;
};
var stripQuotes = (text) => {
  if (text.length >= 2) {
    const a = text[0];
    const b = text[text.length - 1];
    if (a === '"' && b === '"' || a === "'" && b === "'" || a === "`" && b === "`") {
      const inner = text.slice(1, -1).trim();
      return inner.length >= 2 && inner.length <= 200 ? inner : "";
    }
  }
  return "";
};
var literalsFromMatches = (matches) => {
  const out = [];
  for (const m of matches) {
    const text = stripQuotes(m.text);
    if (text) out.push({ file: m.file, line: m.line, text });
  }
  return out;
};
var completeLiterals = async (files, cwd, source, out) => {
  pushAll(out, await extractConfigLiterals(files, cwd, source));
  const codeFiles = files.filter((f) => !isConfigFile(f) && langOf(f) !== "Bend");
  const templateSites = await mapLimit(codeFiles, SOURCE_SCAN_CONCURRENCY, async (f) => {
    const local = [];
    const src = await source.read(f);
    if (src === void 0) return local;
    src.split("\n").forEach((lineText, i) => {
      TEMPLATE_RE.lastIndex = 0;
      for (let m; m = TEMPLATE_RE.exec(lineText); ) {
        const text = m[1].trim();
        if (text.length >= 2) local.push({ file: f, line: i + 1, text });
      }
    });
    return local;
  });
  for (const local of templateSites) pushAll(out, local);
  return dedupe(out, (literal) => `${literal.file}|${literal.line}|${literal.text}`);
};
var extractLiterals = async (files, cwd, source = defaultSource(cwd)) => {
  const perLang = await Promise.all([...groupByLang(files)].map(
    ([lang, langFiles]) => patternRunAll(STRING_PATTERNS[lang] ?? [], lang, langFiles, cwd)
  ));
  const matches = [];
  for (const local of perLang) pushAll(matches, local);
  const native = (await bendFacts(files, source)).flatMap((facts) => facts.literals);
  return completeLiterals(files, cwd, source, [...literalsFromMatches(matches), ...native]);
};
var CORE_IMPORT_PREFIX = "fovea-core-import-";
var CORE_CALL_PREFIX = "fovea-core-call-";
var CORE_LITERAL_PREFIX = "fovea-core-literal-";
var coreScanRules = (files) => {
  const rules = [];
  let ordinal = 0;
  const add = (prefix, language, pattern, constraints) => {
    rules.push({
      id: `${prefix}${ordinal++}`,
      language,
      pattern: anonymousVariadics(pattern),
      ...constraints ? { constraints } : {}
    });
  };
  for (const [language] of groupByLang(files)) {
    if (language === "Bend") continue;
    for (const pattern of IMPORT_PATTERNS[language] ?? []) add(CORE_IMPORT_PREFIX, language, pattern);
    for (const pattern of CALL_PATTERNS) {
      const metavar = pattern.startsWith("$O.") ? "M" : "F";
      add(CORE_CALL_PREFIX, language, pattern, { [metavar]: { not: { regex: CALL_WARD_PATTERN } } });
    }
    for (const pattern of STRING_PATTERNS[language] ?? []) add(CORE_LITERAL_PREFIX, language, pattern);
  }
  return rules;
};
var coreFactsFromScan = async (files, cwd, source, matches) => {
  const imports = [];
  const calls = [];
  const literals = [];
  for (const match of matches) {
    if (match.ruleId.startsWith(CORE_IMPORT_PREFIX)) imports.push(match);
    else if (match.ruleId.startsWith(CORE_CALL_PREFIX)) calls.push(match);
    else if (match.ruleId.startsWith(CORE_LITERAL_PREFIX)) literals.push(match);
  }
  const native = await bendFacts(files, source);
  return {
    imports: [...importsFromMatches(imports), ...native.flatMap((facts) => facts.imports)],
    calls: [...callsFromMatches(calls), ...native.flatMap((facts) => facts.calls)],
    literals: await completeLiterals(files, cwd, source, [...literalsFromMatches(literals), ...native.flatMap((facts) => facts.literals)])
  };
};
var pushAll = (out, more) => {
  for (const x of more) out.push(x);
};
var dedupe = (arr, key) => {
  const seen2 = /* @__PURE__ */ new Set();
  const out = [];
  for (const item of arr) {
    const id = key(item);
    if (seen2.has(id)) continue;
    seen2.add(id);
    out.push(item);
  }
  return out;
};

// src/fovea/core/join.ts
var PLACEHOLDER_SEGMENT = /^(?::[^/]+|\{[^}/]*\}|\$\{[^}/]*\}|\$[A-Za-z_]\w*|<[^/>]+>|\*+)$/;
var WORD_RE = /^[A-Za-z][\w$.\-]{6,63}$/;
var URLISH_RE = /^(?:https?|wss?):\/\/[^/]+/;
var classifyLiteral = (text) => {
  const t = text.trim();
  if (t.length < 3 || t.length > 200) return void 0;
  if (ENV_TOKEN_RE.test(t)) return "env";
  const body = t.replace(URLISH_RE, "");
  if (PATH_TOKEN_RE.test(body)) return "path";
  if (WORD_RE.test(t) && (t.includes(".") || t.includes("::") || t.includes("-") || t.includes("_") || /[A-Z][a-z]/.test(t.slice(1)))) {
    return "word";
  }
  return void 0;
};
var normalizeLiteral = (text, cls) => {
  const t = text.trim();
  if (cls === "env") return t.toUpperCase();
  if (cls === "word") return t;
  const body = t.replace(URLISH_RE, "");
  const segments = body.split("/").map((s) => PLACEHOLDER_SEGMENT.test(s) ? "{*}" : s);
  let joined = segments.join("/");
  if (joined.length > 1 && joined.endsWith("/")) joined = joined.slice(0, -1);
  return joined;
};
var BASE = { path: 1, env: 0.8, word: 0.55 };
var MAX_DF = 48;
var LOOKUP_CAP = 192;
var buildJoinIndex = (sites, resolveOccurrence) => {
  const grouped = /* @__PURE__ */ new Map();
  let total = 0;
  for (const s of sites) {
    const cls = classifyLiteral(s.text);
    if (!cls) continue;
    const node = resolveOccurrence(s.file, s.line);
    if (node === void 0) continue;
    const key = normalizeLiteral(s.text, cls);
    const g = grouped.get(key) ?? { cls, occ: [], seenFiles: /* @__PURE__ */ new Set() };
    grouped.set(key, g);
    if (g.seenFiles.has(s.file)) continue;
    g.seenFiles.add(s.file);
    g.occ.push({ node, line: s.line, file: s.file });
    total++;
  }
  const byKey = /* @__PURE__ */ new Map();
  const edges = [];
  const idfMax = Math.log(Math.max(total, 2));
  const pairBest = /* @__PURE__ */ new Map();
  for (const [key, g] of grouped) {
    const df = g.occ.length;
    const spec = Math.min(1, Math.log(total / Math.max(df, 1)) / idfMax || 0);
    byKey.set(key, { cls: g.cls, spec, occ: g.occ.slice(0, LOOKUP_CAP) });
    if (df < 2 || df > MAX_DF) continue;
    const w = BASE[g.cls] * (0.25 + 0.75 * spec) / Math.max(1, df / 6);
    for (let i = 0; i < g.occ.length; i++) {
      for (let j = i + 1; j < g.occ.length; j++) {
        const a = g.occ[i].node;
        const b = g.occ[j].node;
        if (a === b) continue;
        const pk = a < b ? `${a}|${b}` : `${b}|${a}`;
        const evidence = {
          strategy: "normalized-literal",
          rule: `literal-${g.cls}`,
          source: key,
          candidates: df,
          key
        };
        const previous = pairBest.get(pk);
        if (!previous || w > previous.w || w === previous.w && key < (previous.evidence.key ?? "")) {
          pairBest.set(pk, { w, evidence });
        }
      }
    }
  }
  for (const [pk, best] of pairBest) {
    const [a, b] = pk.split("|").map(Number);
    edges.push({ a, b, w: best.w, evidence: best.evidence });
  }
  return { byKey, edges };
};

// src/fovea/core/cochange.ts
import { createHash } from "node:crypto";
import { readFile as readFile2 } from "node:fs/promises";
import { resolve as resolve2, join as joinPath } from "node:path";
var LOG_COMMITS = 400;
var MAX_FILES_PER_UNIT = 24;
var MIN_SHARED = 2;
var MAX_PAIRS_PER_FILE = 16;
var COCHANGE_CACHE_VERSION = 4;
var EXPECTATION_MIN_SUPPORT = 3;
var WILSON_Z_95 = 1.96;
var DAY_MS = 864e5;
var COCHANGE_HALF_LIFE_DAYS = envInt("FOVEA_COCHANGE_HALF_LIFE_DAYS", 30, 1, 3650);
var recencyFactor = (ageDays) => Math.pow(0.5, ageDays / COCHANGE_HALF_LIFE_DAYS);
var effectiveWeight = (baseW, ageDays) => baseW * recencyFactor(ageDays);
var scorePair = (n, soloA, soloB) => {
  const union = soloA + soloB - n;
  if (union <= 0) return 0;
  const jaccard = n / union;
  return Math.min(0.5, 0.08 + 0.55 * jaccard + 0.1 * Math.min(n / 10, 1));
};
var wilsonLower95 = (successes, trials) => {
  if (trials <= 0 || successes < 0 || successes > trials) return 0;
  const p = successes / trials;
  const z2 = WILSON_Z_95 * WILSON_Z_95;
  const denominator = 1 + z2 / trials;
  const centre = p + z2 / (2 * trials);
  const radius = WILSON_Z_95 * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials);
  return Math.max(0, (centre - radius) / denominator);
};
var pathOrder = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var expectationResiduals = (changedFiles, history, now = Date.now()) => {
  const changed = new Set(changedFiles);
  const totals = /* @__PURE__ */ new Map();
  const sources = [...changed].sort(pathOrder);
  for (const source of sources) {
    const partners = [...history.get(source) ?? []].sort((a, b) => pathOrder(a.partner, b.partner) || (a.n_ij ?? 0) - (b.n_ij ?? 0) || (a.n_i ?? 0) - (b.n_i ?? 0) || (a.n_j ?? 0) - (b.n_j ?? 0) || a.lastTs - b.lastTs);
    for (const p of partners) {
      if (changed.has(p.partner)) continue;
      const nIJ = p.n_ij;
      const nI = p.n_i;
      const nJ = p.n_j;
      const total = p.N;
      if (nIJ === void 0 || nI === void 0 || nJ === void 0 || total === void 0 || !Number.isInteger(nIJ) || !Number.isInteger(nI) || !Number.isInteger(nJ) || !Number.isInteger(total) || nIJ < EXPECTATION_MIN_SUPPORT || nIJ > nI || nIJ > nJ || nI <= 0 || nJ < 0 || total <= 0 || nI > total || nJ > total) continue;
      const q = wilsonLower95(nIJ, nI);
      const baseRate = nJ / total;
      if (q <= baseRate) continue;
      const lift = baseRate > 0 ? q / baseRate : Number.POSITIVE_INFINITY;
      const liftDiscount = Number.isFinite(lift) ? 1 - 1 / lift : 1;
      const ageDays = Math.max(0, (now - p.lastTs) / DAY_MS);
      const contribution = effectiveWeight(q * liftDiscount, ageDays);
      if (!(contribution > 0) || !Number.isFinite(contribution)) continue;
      totals.set(p.partner, (totals.get(p.partner) ?? 0) + contribution);
    }
  }
  const ranked = [...totals].map(([file, weight]) => [file, Math.min(1, weight)]).sort((a, b) => b[1] - a[1] || pathOrder(a[0], b[0]));
  return new Map(ranked);
};
var cachePath = (root) => joinPath(privateTmpdir(), `pi-fovea-cochange-${createHash("sha1").update(root).digest("hex").slice(0, 16)}.json`);
var coChangeHistory = async (root, filesInGraph, now = Date.now()) => {
  const head = await gitHead(root) ?? "";
  if (!head) return /* @__PURE__ */ new Map();
  const prefix = await gitPrefix(root);
  if (prefix === void 0) return /* @__PURE__ */ new Map();
  const shallowPath = await gitOut(root, ["rev-parse", "--git-path", "shallow"]);
  if (shallowPath === void 0) return /* @__PURE__ */ new Map();
  let shallowText = "";
  try {
    const readMetadata = context().readGitMetadata;
    if (readMetadata) {
      const status = await gitOut(root, ["rev-parse", "--is-shallow-repository"]);
      if (status === void 0) return /* @__PURE__ */ new Map();
      if (status.trim() === "true") shallowText = await readMetadata(shallowPath.trim());
    } else shallowText = await readFile2(resolve2(root, shallowPath.trim()), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      context().gitFailures.push("Shallow co-change history unavailable: unsafe or out-of-scope Git metadata");
      return /* @__PURE__ */ new Map();
    }
  }
  const shallow = new Set(shallowText.trim().split(/\s+/));
  const tracked = new Set(filesInGraph);
  const key = createHash("sha1").update(`v${COCHANGE_CACHE_VERSION}\0`).update(shallowText).update(JSON.stringify([...tracked].sort())).digest("hex").slice(0, 12);
  const cp = cachePath(root);
  void maintainTempStorage();
  try {
    const cached = JSON.parse(await readTempText(cp));
    if (cached.v === COCHANGE_CACHE_VERSION && cached.head === head && cached.key === key && Number.isInteger(cached.commits) && Array.isArray(cached.pairs)) return groupPairs(cached.pairs, cached.commits);
  } catch {
  }
  const log = await gitOut(root, [
    "log",
    "--first-parent",
    "--diff-merges=first-parent",
    "--root",
    "--format=%x00FOVEA%x00%H%x00%P%x00%ct%x00%s%x00",
    "--name-status",
    "-z",
    "-n",
    String(LOG_COMMITS),
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    "--no-relative",
    "--no-notes",
    "--no-show-signature",
    "--no-color",
    head,
    "--"
  ], { maxBuffer: 16 * 1024 * 1024 });
  if (log === void 0) return /* @__PURE__ */ new Map();
  const units = [];
  const fields = log.split("\0");
  let cursor = 0;
  while (cursor < fields.length) {
    if (fields[cursor] === "") {
      cursor++;
      continue;
    }
    if (fields[cursor++] !== "FOVEA") return /* @__PURE__ */ new Map();
    const hash = fields[cursor++];
    const parents = fields[cursor++];
    const seconds = Number(fields[cursor++]);
    const subject = fields[cursor++];
    if (!hash || parents === void 0 || subject === void 0 || !Number.isFinite(seconds) || fields[cursor++] !== "") return /* @__PURE__ */ new Map();
    const files = /* @__PURE__ */ new Set();
    let first = true;
    while (cursor < fields.length && fields[cursor] !== "") {
      let status = fields[cursor++];
      if (first) {
        if (!status.startsWith("\n")) return /* @__PURE__ */ new Map();
        status = status.slice(1);
        first = false;
      }
      let file = fields[cursor++];
      if (!/^[AMDTUXB]$/.test(status) || !file) return /* @__PURE__ */ new Map();
      if ((status === "A" || status === "M") && file.startsWith(prefix)) {
        file = file.slice(prefix.length);
        if (tracked.has(file)) files.add(file);
      }
    }
    if (!shallow.has(hash)) units.push({ subject, merge: parents.includes(" "), ts: seconds * 1e3, files });
  }
  const subjects = /* @__PURE__ */ new Map();
  units.forEach((unit, i) => {
    const hits = subjects.get(unit.subject) ?? [];
    hits.push(i);
    subjects.set(unit.subject, hits);
  });
  const consumed = /* @__PURE__ */ new Set();
  units.forEach((unit, i) => {
    if (unit.merge) return;
    const target = /^(?:fixup!|squash!) (.+)$/.exec(unit.subject)?.[1];
    if (!target) return;
    const hits = subjects.get(target);
    if (hits?.length !== 1 || hits[0] <= i) return;
    const parent = units[hits[0]];
    for (const file of unit.files) parent.files.add(file);
    parent.ts = Math.max(parent.ts, unit.ts);
    consumed.add(i);
  });
  const pairCount = /* @__PURE__ */ new Map();
  const pairLast = /* @__PURE__ */ new Map();
  const touchCount = /* @__PURE__ */ new Map();
  let commits = 0;
  units.forEach((unit, index) => {
    if (consumed.has(index)) return;
    commits++;
    const fs = [...unit.files].sort();
    for (const f of fs) touchCount.set(f, (touchCount.get(f) ?? 0) + 1);
    if (fs.length < 2 || fs.length > MAX_FILES_PER_UNIT) return;
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length; j++) {
        const k = JSON.stringify([fs[i], fs[j]]);
        pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
        pairLast.set(k, Math.max(pairLast.get(k) ?? 0, unit.ts));
      }
    }
  });
  const scored = [];
  for (const [k, n] of pairCount) {
    if (n < MIN_SHARED) continue;
    const [a, b] = JSON.parse(k);
    const nA = touchCount.get(a) ?? 0;
    const nB = touchCount.get(b) ?? 0;
    const w = scorePair(n, nA, nB);
    if (w <= 0) continue;
    scored.push([a, b, w, pairLast.get(k) ?? 0, n, nA, nB]);
  }
  const perFile = /* @__PURE__ */ new Map();
  scored.forEach((p, i) => {
    for (const f of [p[0], p[1]]) (perFile.get(f) ?? perFile.set(f, []).get(f)).push(i);
  });
  const eff = (p) => p[2] * recencyFactor(Math.max(0, now - p[3]) / DAY_MS);
  const keep = /* @__PURE__ */ new Set();
  for (const [, idxs] of perFile) {
    idxs.sort((x, y) => eff(scored[y]) - eff(scored[x]));
    for (const i of idxs.slice(0, MAX_PAIRS_PER_FILE)) keep.add(i);
  }
  const pairs = scored.filter((_, i) => keep.has(i));
  try {
    await writeAtomicTemp(cp, JSON.stringify({
      v: COCHANGE_CACHE_VERSION,
      head,
      key,
      commits,
      pairs
    }));
  } catch {
  }
  return groupPairs(pairs, commits);
};
var groupPairs = (pairs, commits) => {
  const out = /* @__PURE__ */ new Map();
  const push = (a, b, w, lastTs, nIJ, nI, nJ) => {
    const partner = { partner: b, w, lastTs, n_ij: nIJ, n_i: nI, n_j: nJ, N: commits };
    const list = out.get(a);
    if (list) list.push(partner);
    else out.set(a, [partner]);
  };
  for (const [a, b, w, lastTs, nIJ, nA, nB] of pairs) {
    push(a, b, w, lastTs, nIJ, nA, nB);
    push(b, a, w, lastTs, nIJ, nB, nA);
  }
  return out;
};

// src/fovea/core/state.ts
import { createHash as createHash4 } from "node:crypto";
import { stat as stat3 } from "node:fs/promises";
import { isAbsolute as isAbsolute2, join as join4, relative as relative2, resolve as resolve3, sep as sep2 } from "node:path";

// src/fovea/core/build.ts
import { createHash as createHash3 } from "node:crypto";
import { lstat as lstat2, readFile as readFile4, readdir, stat as stat2 } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join as joinPath3 } from "node:path";

// src/fovea/core/graph.ts
import { basename, posix as posix2 } from "node:path";
var CODE_EXTS_BY_LANGFAMILY = {
  ts: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
  py: [".py"],
  rs: [".rs"],
  go: []
};
var langFamily = (file) => {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"].includes(ext)) return "ts";
  if (ext === "py") return "py";
  if (ext === "rs") return "rs";
  if (ext === "go") return "go";
  return ext;
};
var pushIndex = (m, key, value) => {
  (m.get(key) ?? m.set(key, []).get(key)).push(value);
};
var buildImportIndex = (files) => {
  const fileSet = new Set(files);
  const filesByDir = /* @__PURE__ */ new Map();
  const goDirsBySuffix = /* @__PURE__ */ new Map();
  const rsByBase = /* @__PURE__ */ new Map();
  const tsByTailStem = /* @__PURE__ */ new Map();
  for (const f of files) {
    const dir = posix2.dirname(f);
    pushIndex(filesByDir, dir, f);
  }
  for (const dir of filesByDir.keys()) {
    const segs = dir.split("/").filter(Boolean);
    for (let k = 1; k <= Math.min(3, segs.length); k++) {
      pushIndex(goDirsBySuffix, segs.slice(-k).join("/"), dir);
    }
  }
  for (const f of files) {
    if (f.endsWith(".rs")) {
      const base = basename(f, ".rs");
      pushIndex(rsByBase, base, f);
      if (base === "mod") {
        const parentBase = basename(posix2.dirname(f));
        pushIndex(rsByBase, parentBase, f);
      }
    }
    if (f.endsWith(".ts")) {
      const base = basename(f, ".ts");
      if (base === "index") pushIndex(tsByTailStem, basename(posix2.dirname(f)), f);
      else pushIndex(tsByTailStem, base, f);
    }
  }
  return { fileSet, filesByDir, goDirsBySuffix, rsByBase, tsByTailStem };
};
var resolveImportToFile = (spec, fromFile, index) => {
  const { fileSet } = index;
  const fam = langFamily(fromFile);
  const exact = (candidates, strategy) => {
    const hits2 = [...new Set(candidates)].filter((candidate) => fileSet.has(candidate));
    return hits2.length ? { file: hits2[0], evidence: { strategy, rule: "import-resolve", source: spec, candidates: hits2.length } } : void 0;
  };
  if (fam === "bend") {
    if (spec === "Base" || /^0x[0-9a-f]+\//i.test(spec) || posix2.isAbsolute(spec)) return void 0;
    const local = posix2.normalize(posix2.join(posix2.dirname(fromFile), spec));
    if (local === ".." || local.startsWith("../")) return void 0;
    return exact([local], "relative-import");
  }
  if (spec.startsWith("./") || spec.startsWith("../")) {
    let base = posix2.normalize(posix2.join(posix2.dirname(fromFile), spec));
    base = base.replace(/\.(?:[cm]?js|jsx)$/, "");
    const candidates = [];
    for (const ext of CODE_EXTS_BY_LANGFAMILY[fam] ?? []) {
      candidates.push(base + ext, `${base}/index${ext}`);
    }
    candidates.push(base);
    return exact(candidates, "relative-import");
  }
  if (fam === "py") {
    const p = spec.replace(/\./g, "/");
    return exact([`${p}.py`, `${p}/__init__.py`], "python-module");
  }
  if (fam === "go") {
    const segs = spec.split("/").filter(Boolean);
    for (let k = 1; k <= Math.min(3, segs.length); k++) {
      const suffix = segs.slice(-k).join("/");
      const matches = (index.goDirsBySuffix.get(suffix) ?? []).filter(
        (directory) => directory === suffix || directory.endsWith(`/${suffix}`)
      );
      if (matches.length === 1) {
        const inDir = index.filesByDir.get(matches[0]) ?? [];
        if (inDir.length) {
          return {
            file: inDir[0],
            evidence: { strategy: "go-module-suffix", rule: "go-package-representative", source: spec, candidates: inDir.length }
          };
        }
      }
    }
    return void 0;
  }
  if (fam === "rs") {
    const modPath = spec.replace(/^crate::|^self::/, "").replace(/::/g, "/");
    const direct = exact([`src/${modPath}.rs`, `${modPath}.rs`], "rust-module");
    if (direct) return direct;
    const baseName = basename(modPath);
    const hits2 = (index.rsByBase.get(baseName) ?? []).filter(
      (file) => file === `${baseName}.rs` || file.endsWith(`/${baseName}.rs`) || file.endsWith(`/${baseName}/mod.rs`)
    );
    return hits2.length === 1 ? { file: hits2[0], evidence: { strategy: "rust-module", rule: "import-resolve", source: spec, candidates: hits2.length } } : void 0;
  }
  const tail = spec.split("/").filter(Boolean).join("/");
  const stem = tail.split("/").pop() ?? tail;
  const hits = (index.tsByTailStem.get(stem) ?? []).filter(
    (file) => file.endsWith(`/${tail}.ts`) || file.endsWith(`/${tail}/index.ts`)
  );
  return hits.length === 1 ? { file: hits[0], evidence: { strategy: "typescript-tail", rule: "import-resolve", source: spec, candidates: hits.length } } : void 0;
};
var importFamilyResolver = (files) => {
  const sorted = [...files].sort();
  const cache = /* @__PURE__ */ new Map();
  return (site) => {
    const bounds = site.dynamic;
    if (langFamily(site.file) !== "ts" || bounds?.prefix === void 0 || bounds.suffix === void 0 || !bounds.prefix.startsWith("./") && !bounds.prefix.startsWith("../")) {
      return { files: [], reason: "computed target is not a bounded relative literal-prefix/suffix expression" };
    }
    const joined = posix2.join(posix2.dirname(site.file), bounds.prefix);
    const prefix = joined === "." || joined === "./" ? "" : joined;
    if (prefix === ".." || prefix.startsWith("../") || posix2.isAbsolute(prefix)) {
      return { files: [], reason: "computed family lies outside the selected root" };
    }
    const key = JSON.stringify([prefix, bounds.suffix]);
    const cached = cache.get(key);
    if (cached) return cached;
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
      const mid = lo + hi >>> 1;
      if (sorted[mid] < prefix) lo = mid + 1;
      else hi = mid;
    }
    const hits = [];
    let examined = 0;
    for (let at = lo; at < sorted.length && sorted[at].startsWith(prefix); at++) {
      if (++examined > 4096) {
        const result2 = { files: [], capped: true, reason: "computed family scan exceeded 4096 files; no possible edges emitted" };
        cache.set(key, result2);
        return result2;
      }
      const file = sorted[at];
      const runtime = file.replace(/\.tsx?$/, ".js").replace(/\.mts$/, ".mjs").replace(/\.cts$/, ".cjs");
      if (!file.endsWith(bounds.suffix) && !runtime.endsWith(bounds.suffix)) continue;
      hits.push(file);
      if (hits.length > 32) {
        const result2 = { files: [], capped: true, reason: "computed family exceeds 32 possible targets; no possible edges emitted" };
        cache.set(key, result2);
        return result2;
      }
    }
    const result = hits.length ? { files: hits } : { files: [], reason: "no matching targets in the selected graph" };
    cache.set(key, result);
    return result;
  };
};
var addNode = (nodes, seen2, rec) => {
  const hit = seen2.get(rec.id);
  if (hit !== void 0) return hit;
  const idx = nodes.length;
  seen2.set(rec.id, idx);
  nodes.push(rec);
  return idx;
};
var assembleGraphWithIndex = async (_root, files, factsMap) => {
  const facts = (file) => factsMap instanceof Map ? factsMap.get(file) : factsMap[file];
  const factValues = () => factsMap instanceof Map ? factsMap.values() : Object.values(factsMap);
  const nodes = [];
  const seen2 = /* @__PURE__ */ new Map();
  const edges = [];
  const byFile = /* @__PURE__ */ new Map();
  const fileIdx = /* @__PURE__ */ new Map();
  const pushEdge = (a, b, kind, w, evidence) => {
    if (a === b) return;
    edges.push({ a, b, kind, w, evidence });
  };
  for (const rel of files) {
    const idx = addNode(nodes, seen2, {
      id: `file:${rel}`,
      name: posix2.basename(rel),
      kind: "file",
      file: rel,
      line: 0,
      sig: rel,
      lang: LANG_BY_EXT[rel.split(".").pop()?.toLowerCase() ?? ""] ?? "config"
    });
    fileIdx.set(rel, idx);
    (byFile.get(rel) ?? byFile.set(rel, []).get(rel)).push(idx);
  }
  const symIdxByFileLine = /* @__PURE__ */ new Map();
  await forEachChunked(files, 512, (rel) => {
    const f = facts(rel);
    if (!f) return;
    for (const s of f.symbols) {
      const idx = addNode(nodes, seen2, { id: `${s.name}@${s.file}`, ...s });
      (byFile.get(rel) ?? byFile.set(rel, []).get(rel)).push(idx);
      pushEdge(fileIdx.get(rel), idx, "contains", 1, { strategy: "file-membership", rule: "symbol-contained-by-file", source: rel });
      const key = `${rel}:${s.line}`;
      if (!symIdxByFileLine.has(key)) symIdxByFileLine.set(key, idx);
    }
  });
  for (const [, arr] of byFile) arr.sort((x, y) => nodes[x].line - nodes[y].line);
  const enclosingIdx = (file, line) => {
    const arr = byFile.get(file) ?? [];
    let best = fileIdx.get(file);
    for (const idx of arr) {
      const n = nodes[idx];
      if (n.kind !== "file" && n.line <= line && nodes[best].line <= n.line) best = idx;
    }
    return best;
  };
  const byName = /* @__PURE__ */ new Map();
  {
    const addKey = (key, idx) => {
      if (!key) return;
      (byName.get(key) ?? byName.set(key, []).get(key)).push(idx);
    };
    nodes.forEach((n, i) => {
      if (n.kind === "file" || n.kind === "anchor") return;
      addKey(n.name.toLowerCase(), i);
      const dot = n.name.indexOf(".");
      if (dot > 0) addKey(n.name.slice(dot + 1).toLowerCase(), i);
    });
  }
  const importIndex = buildImportIndex(files);
  const resolveFamily = importFamilyResolver(files);
  const importCoverage = {
    sites: 0,
    resolved: 0,
    possible: 0,
    unresolved: 0,
    capped: 0,
    unsupportedLanguages: [...new Set(files.map((file) => LANG_BY_EXT[file.split(".").pop()?.toLowerCase() ?? ""]).filter((language) => !!language && !supportsImportExtraction(language)))].sort(),
    examples: [],
    examplesOmitted: 0
  };
  const noteImport = (site, status, reason) => {
    if (importCoverage.examples.length < 20) {
      importCoverage.examples.push({ file: site.file, line: site.line, spec: site.spec.slice(0, 160), status, reason });
    } else importCoverage.examplesOmitted++;
  };
  const importTargets = /* @__PURE__ */ new Map();
  await forEachChunked(files, 512, (rel) => {
    const f = facts(rel);
    if (!f) return;
    for (const imp of f.imports) {
      importCoverage.sites++;
      if (imp.dynamic) {
        const family = resolveFamily(imp);
        if (!family.files.length) {
          importCoverage.unresolved++;
          if (family.capped) importCoverage.capped++;
          noteImport(imp, family.capped ? "capped" : "unresolved", family.reason);
          continue;
        }
        importCoverage.possible++;
        noteImport(imp, "possible", `${family.files.length} literal-prefix/suffix targets; runtime values are not evaluated`);
        for (const file of family.files) {
          pushEdge(fileIdx.get(rel), fileIdx.get(file), "imports", 0.15 / family.files.length, {
            strategy: "computed-import-family",
            rule: "literal-prefix-suffix",
            source: imp.spec,
            candidates: family.files.length,
            possible: true
          });
        }
        continue;
      }
      const target = resolveImportToFile(imp.spec, rel, importIndex);
      if (!target) {
        importCoverage.unresolved++;
        noteImport(imp, "unresolved", "not resolved within the selected graph; may be external or outside the modeled import forms");
        continue;
      }
      importCoverage.resolved++;
      if (target.file === rel) continue;
      pushEdge(fileIdx.get(rel), fileIdx.get(target.file), "imports", 0.3, target.evidence);
      (importTargets.get(rel) ?? importTargets.set(rel, []).get(rel)).push({ ...target, alias: imp.alias });
    }
    if (isTestFile(rel)) {
      for (const target of importTargets.get(rel) ?? []) {
        pushEdge(fileIdx.get(rel), fileIdx.get(target.file), "tests", 0.6, {
          strategy: "test-import",
          rule: "test-subject-import",
          source: target.evidence.source,
          candidates: target.evidence.candidates
        });
      }
    }
  });
  await forEachChunked(files, 256, (rel) => {
    const f = facts(rel);
    if (!f) return;
    const targets = importTargets.get(rel) ?? [];
    const imported = new Set(targets.map((target) => target.file));
    const bend = langFamily(rel) === "bend";
    const aliases = bend ? targets.filter((target) => target.alias).sort((a, b) => b.alias.length - a.alias.length) : [];
    for (const call of f.calls) {
      const alias = aliases.find((target) => call.callee.startsWith(`${target.alias}.`));
      const name = alias ? call.callee.slice(alias.alias.length + 1) : call.callee;
      const cands = (byName.get(name.toLowerCase()) ?? []).filter((i) => !bend || nodes[i].lang === "Bend" && nodes[i].name === name && nodes[i].file === (alias?.file ?? rel));
      if (!cands.length || cands.length > 48) continue;
      let strategy = "same-file-symbol";
      let chosen = cands.filter((i) => nodes[i].file === rel);
      if (!chosen.length) {
        strategy = "imported-symbol";
        chosen = cands.filter((i) => imported.has(nodes[i].file));
      }
      if (!chosen.length && cands.length === 1) {
        strategy = "globally-unique-symbol";
        chosen = cands;
      }
      if (!chosen.length || chosen.length > 3) continue;
      const w = cands.length <= 8 ? 0.7 : cands.length <= 24 ? 0.45 : 0.25;
      const from = enclosingIdx(rel, call.line);
      for (const to of chosen) {
        pushEdge(from, to, "invokes", w, { strategy, rule: "call-target-resolution", source: call.callee, candidates: cands.length });
      }
    }
  });
  nodes.forEach((node, i) => {
    if (node.kind !== "class") return;
    for (const match of node.sig.matchAll(/extends\s+([A-Za-z_$][\w$.]*)/g)) {
      const candidates = byName.get(match[1].toLowerCase()) ?? [];
      for (const to of candidates) {
        pushEdge(i, to, "inherits", 0.9, {
          strategy: "signature-extends",
          rule: "extends-clause",
          source: match[1],
          candidates: candidates.length
        });
      }
    }
    const impl = /implements\s+([A-Za-z_$][\w$.,\s]*)/.exec(node.sig);
    if (impl) {
      for (const raw of impl[1].split(",")) {
        const name = raw.trim();
        const candidates = byName.get(name.toLowerCase()) ?? [];
        for (const to of candidates) {
          pushEdge(i, to, "inherits", 0.9, {
            strategy: "signature-implements",
            rule: "implements-clause",
            source: name,
            candidates: candidates.length
          });
        }
      }
    }
  });
  const allSites = [];
  for (const f of factValues()) for (const literal of f.literals) allSites.push(literal);
  const joinIdx = buildJoinIndex(allSites, (file, line) => enclosingIdx(file, line));
  for (const edge of joinIdx.edges) pushEdge(edge.a, edge.b, "join", edge.w, edge.evidence);
  const drafts = [];
  for (const rel of files) {
    const f = facts(rel);
    if (f) for (const anchor2 of f.anchors) drafts.push(anchor2);
  }
  const draftsByLabel = /* @__PURE__ */ new Map();
  for (const anchor2 of drafts) {
    (draftsByLabel.get(anchor2.id) ?? draftsByLabel.set(anchor2.id, []).get(anchor2.id)).push(anchor2);
  }
  const anchors = [];
  for (const [label, sites] of draftsByLabel) {
    const first = sites[0];
    const filesOf = [...new Set(sites.map((site) => site.file))];
    const sources = [...new Set(sites.map((site) => site.ruleId).filter((source) => !!source))].sort();
    const hubImplicit = sites.every((site) => site.implicit === true);
    anchors.push({
      id: label,
      kind: first.kind,
      label: sites.length > 1 ? `${label} \xB7 ${sites.length} sites` : label,
      nodeId: first.nodeId,
      file: first.file,
      line: first.line,
      ...sources.length ? { sources } : {},
      ...hubImplicit ? { implicit: true } : {}
    });
    const idx = addNode(nodes, seen2, {
      id: `anchor:${label}`,
      name: label,
      kind: "anchor",
      file: first.file,
      line: first.line,
      sig: `${hubImplicit ? "(\u25B3 discovered) " : ""}${sites.length > 1 ? `${label} (${sites.length} sites)` : label}`,
      lang: "anchor"
    });
    (byFile.get(first.file) ?? byFile.set(first.file, []).get(first.file)).push(idx);
    const w = (hubImplicit ? 0.5 : 1) / Math.sqrt(sites.length);
    for (const site of sites) {
      const handler = seen2.get(site.nodeId) ?? fileIdx.get(site.file);
      pushEdge(idx, handler, "anchors", w, {
        strategy: site.implicit ? "discovered-anchor" : "declared-anchor",
        rule: site.ruleId ?? "legacy-anchor",
        source: `${site.file}:${site.line}`,
        candidates: sites.length,
        key: label,
        ...site.implicit ? { implicit: true } : {}
      });
    }
    if (filesOf.length > 1 && filesOf.length <= 12) {
      const fw = 0.35 / Math.sqrt(filesOf.length);
      for (const file of filesOf) {
        pushEdge(idx, fileIdx.get(file), "anchors", fw, {
          strategy: "anchor-membership",
          rule: "feature-file-membership",
          source: file,
          candidates: filesOf.length,
          key: label,
          ...hubImplicit ? { implicit: true } : {}
        });
      }
    }
  }
  return { graph: { nodes, edges, byName, byFile, anchors, files, importCoverage }, joinIndex: joinIdx };
};

// src/fovea/core/anchors.ts
import { createHash as createHash2 } from "node:crypto";
import { readFile as readFile3 } from "node:fs/promises";
import { join as joinPath2 } from "node:path";
var INLINE_I_RE = /^\^\(\?i:([\s\S]*)\)\$$/;
var compileMethods = (methods) => {
  const m = INLINE_I_RE.exec(methods);
  return m ? new RegExp(`^(?:${m[1]})$`, "i") : new RegExp(methods);
};
var HTTP_VERB_RE = /^(?:get|post|put|delete|patch|head|options)$/i;
var VERB_IN_PATH = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/\S*)$/;
var QUOTED_RE2 = /^[rbfuRBFU]{0,3}(["'`])([\s\S]*)\1$/;
var unquote = (s) => {
  const m = QUOTED_RE2.exec(s.trim());
  return m ? m[2] : s.trim();
};
var PLACEHOLDER_ONLY = /^(:[A-Za-z_]\w*|\{[A-Za-z_]\w*\}|\[[A-Za-z_]\w*\])$/;
var METHOD_ALIASES = {
  PATH: "ANY",
  RE_PATH: "ANY",
  URL: "ANY",
  MATCH: "ANY",
  ROOT: "ANY",
  REQUESTMAPPING: "ANY",
  RESOURCES: "ANY",
  FORWARD: "ANY",
  USE: "ANY",
  ROUTE: "ANY",
  GROUP: "ANY",
  FETCH: "GET",
  REDIRECT: "GET",
  RESPONDREDIRECT: "GET",
  REDIRECT_TO: "GET"
};
var deriveVerb = (method) => {
  let up = method.toUpperCase();
  if (up.endsWith("MAPPING")) up = up.slice(0, -"MAPPING".length);
  return METHOD_ALIASES[up] ?? up;
};
var ROUTER_OBJECT_SLOTS = 12;
var routerObjectPatterns = (slots = ROUTER_OBJECT_SLOTS) => {
  const pair = "$P: $R.$M($$$A)";
  const variants = [`$F({ ${pair} })`];
  for (let position = 0; position < slots; position++) {
    const dummies = position ? `${Array.from({ length: position }, (_, index) => `$${String.fromCharCode(65 + index * 2)}: $${String.fromCharCode(66 + index * 2)}`).join(", ")}, ` : "";
    variants.push(`$F({ ${dummies}${pair}, $$$REST })`);
  }
  return variants;
};
var DEFAULT_PACK = [
  {
    // `$P` as an arg NODE, not in-string: binds across double/single quotes,
    // backticks and Python f-strings. Quote chars are stripped by unquote().
    id: "http-route-call",
    langs: ["TypeScript", "Tsx", "JavaScript", "Go"],
    pattern: "$R.$M($P, $$$H)",
    methods: "^(?i:get|post|put|delete|patch|head|options|all|use|any|handle|handlefunc|route|group)$",
    kind: "route"
  },
  {
    // Single-arg verb call: axios.get("/me") — client call sites only become
    // feature hubs when they reference a real path (validated below).
    id: "http-verb-single-arg",
    langs: ["TypeScript", "Tsx", "JavaScript"],
    pattern: "$R.$M($P)",
    methods: "^(?i:get|post|put|delete|patch)$",
    kind: "route"
  },
  {
    id: "http-verb-single-arg-py",
    langs: ["Python"],
    pattern: "$R.$M($P)",
    methods: "^(get|post|put|delete|patch|head|options)$",
    kind: "route"
  },
  {
    id: "python-route-call",
    langs: ["Python"],
    pattern: "$R.$M($P, $$$H)",
    methods: "^(?:add_)?(?:get|post|put|delete|patch|head|options|route)$",
    kind: "route"
  },
  {
    // NestJS / Angular-style decorators; class prefix via @Controller.
    id: "ts-http-decorator",
    langs: ["TypeScript", "Tsx"],
    pattern: "@$M($P)",
    methods: "^(?i:get|post|put|delete|patch|options|head)$",
    kind: "route",
    prefixPattern: ["@Controller($P)"]
  },
  {
    id: "python-decorator-route",
    langs: ["Python"],
    pattern: "@$R.$M($P)",
    methods: "^(get|post|put|delete|patch|route|websocket)$",
    kind: "route"
  },
  {
    // chi r.Method("GET", "/x", h), aiohttp web.route(...)/router.add_route(...).
    id: "verb-as-argument",
    langs: ["Go", "Python", "TypeScript", "Tsx", "JavaScript"],
    pattern: '$R.$M("$V", "$P", $$$H)',
    methods: "^(?i:method|methodfunc|add_route|add_view|route)$",
    kind: "route",
    verbFrom: "V"
  },
  {
    // aiohttp module-level / receiver-free form: route("GET", "/x", h).
    id: "verb-as-argument-norecv",
    langs: ["Python"],
    pattern: '$M("$V", "$P", $$$H)',
    methods: "^route$",
    kind: "route",
    verbFrom: "V"
  },
  {
    // Django urlconf; mounts for every verb, so they anchor as ANY /x.
    id: "django-url",
    langs: ["Python"],
    pattern: '$M("$P", $$$H)',
    methods: "^(path|re_path|url)$",
    kind: "route",
    mountRoot: true
  },
  {
    // Rails routes.rb macros. Bare word form, string content capture.
    id: "rails-route-macro",
    langs: ["Ruby"],
    pattern: '$M "$P", $$$R',
    methods: "^(get|post|put|delete|patch|match|redirect|mount|root|head|options)$",
    kind: "route"
  },
  {
    id: "rails-route-macro-sq",
    langs: ["Ruby"],
    pattern: "$M '$P', $$$R",
    methods: "^(get|post|put|delete|patch|match|redirect|mount|root|head|options)$",
    kind: "route"
  },
  {
    // Phoenix router.ex macros. Scope prefixes are not composed (see README).
    // resources expands to the REST verb set — anchor the mount as ANY,
    // the hub still merges with controller code via literal joins.
    id: "phoenix-route-macro",
    langs: ["Elixir"],
    pattern: '$M "$P", $$$R',
    methods: "^(get|post|put|delete|patch|head|options|forward|resources)$",
    kind: "route"
  },
  {
    id: "phoenix-route-call",
    langs: ["Elixir"],
    pattern: '$M("$P", $$$R)',
    methods: "^(get|post|put|delete|patch|head|options|forward|resources)$",
    kind: "route"
  },
  {
    // Ktor routing DSL: get("/health") { … }
    id: "ktor-routing-dsl",
    langs: ["Kotlin"],
    pattern: '$M("$P") { $$$B }',
    methods: "^(get|post|put|delete|patch|head|options|route)$",
    kind: "route"
  },
  {
    // Spring MVC / WebFlux: class @RequestMapping prefix x method @GetMapping.
    id: "spring-mapping-annotation",
    langs: ["Java", "Kotlin"],
    pattern: '@$M("$P")',
    methods: "^(Get|Post|Put|Delete|Patch)Mapping$",
    kind: "route",
    prefixPattern: ['@RequestMapping("$P")']
  },
  {
    id: "flask-add-url-rule",
    langs: ["Python"],
    pattern: "$R.add_url_rule($P, $$$H)",
    methods: "^add_url_rule$",
    kind: "route"
  },
  {
    // Client fetch with no receiver: fetch("/api/x"). Precision-audited by
    // discovery (~93% path precision in the next.js clone corpus).
    id: "fetch-bare",
    langs: ["TypeScript", "Tsx", "JavaScript"],
    pattern: "$M($P, $$$H)",
    // trailing $$$H absorbs the options bag; zero-arg tail matches fetch("/x") too
    methods: "^fetch$",
    kind: "route"
  },
  {
    // Response-side route linkage: ktor respondRedirect("/myfiles") references
    // an existing route without declaring it. Discovery found it at p̂≈0.81.
    id: "ktor-respond-redirect",
    langs: ["Kotlin"],
    pattern: "$R.$M($P, $$$H)",
    methods: "^respondRedirect$",
    kind: "route"
  },
  {
    id: "rust-router-chain",
    langs: ["Rust"],
    pattern: '$R.route("$P", $$$H)',
    methods: "^route$",
    kind: "route"
  },
  {
    id: "grpc-method-path-first",
    langs: ["TypeScript", "Tsx", "JavaScript", "Python"],
    pattern: "$R.$M($P, $$$H)",
    methods: "^(makeUnaryRequest|makeClientStreamRequest|makeServerStreamRequest|makeBidiStreamRequest|unary_unary|unary_stream|stream_unary|stream_stream)$",
    kind: "rpc",
    labelPrefix: "RPC",
    keyPattern: "^/[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*/[A-Za-z_]\\w*$",
    keyNormalization: "grpc",
    quotedKey: true
  },
  {
    id: "grpc-go-method-path-second",
    langs: ["Go"],
    pattern: "$R.$M($C, $P, $$$H)",
    methods: "^(Invoke|NewStream)$",
    kind: "rpc",
    labelPrefix: "RPC",
    keyPattern: "^/[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*/[A-Za-z_]\\w*$",
    keyNormalization: "grpc",
    quotedKey: true
  },
  {
    id: "trpc-procedure-declaration",
    langs: ["TypeScript", "Tsx", "JavaScript"],
    // Standalone route consts cover routers whose members are plain
    // references (documenso-style split files). The receiver must root at
    // the builder `t` or a *Procedure factory; `trpc.post.list.query()`
    // client proxies fail closed instead of anchoring a nested name.
    patterns: [
      ...routerObjectPatterns(),
      "const $P = $R.$M($$$A)",
      "const $P: $T = $R.$M($$$A)"
    ],
    methods: "^(query|mutation|subscription)$",
    kind: "trpc",
    labelPrefix: "TRPC",
    keyPattern: "^[A-Za-z_$][\\w$]*$",
    receiverPattern: "^(?:t(?:\\.procedure|$)|[A-Za-z_$]*[Pp]rocedure)",
    restKey: "REST"
  },
  {
    id: "trpc-client-call",
    langs: ["TypeScript", "Tsx", "JavaScript"],
    pattern: "trpc.$P.$M($$$A)",
    methods: "^(query|mutate|subscribe)$",
    kind: "trpc",
    labelPrefix: "TRPC",
    keyPattern: "^[A-Za-z_$][\\w$]*$"
  },
  {
    // oRPC procedures: object members of routers or standalone exports, with
    // the receiver chain rooted at the `os` builder. Contract-only `oc.*`
    // shapes and client calls stay unlinked rather than guessed.
    id: "orpc-procedure-declaration",
    langs: ["TypeScript", "Tsx", "JavaScript"],
    patterns: [
      ...routerObjectPatterns(),
      "const $P = $R.$M($$$A)",
      "const $P: $T = $R.$M($$$A)"
    ],
    methods: "^(route|handler)$",
    kind: "orpc",
    labelPrefix: "ORPC",
    keyPattern: "^[A-Za-z_$][\\w$]*$",
    receiverPattern: "^os(?:\\.|$)",
    restKey: "REST"
  },
  {
    // Hono-style app.on("GET", "/path", h). Non-HTTP verbs and array paths
    // fail closed: they anchor nothing rather than guessing.
    id: "http-method-route-on",
    langs: ["TypeScript", "Tsx", "JavaScript"],
    patterns: ['$R.$M("$V", $P, $$$H)', "$R.$M('$V', $P, $$$H)"],
    methods: "^on$",
    kind: "route",
    verbFrom: "V"
  },
  {
    // Hono RPC client: client.posts.$get() — the property is the route
    // stem, so it joins the server-declared hub. Deeper chains, computed
    // segments, and non-`client` receivers stay unanchored.
    id: "hono-rpc-client-call",
    langs: ["TypeScript", "Tsx", "JavaScript"],
    pattern: "$R.$P.$M($$$A)",
    methods: "^\\$(get|post|put|delete|patch|head|options|all)$",
    kind: "route",
    receiverPattern: "^client$",
    labelPrefix: "GET",
    keyFrom: "P",
    keyPattern: "^[A-Za-z_$][\\w$]*$",
    keyPrefix: "/",
    verbFrom: "M"
  },
  {
    id: "message-channel-call",
    langs: ["TypeScript", "Tsx", "JavaScript", "Python", "Go", "Rust"],
    pattern: "$R.$M($P, $$$H)",
    methods: "^(publish|subscribe)$",
    kind: "channel",
    labelPrefix: "CHANNEL",
    keyPattern: "^[A-Za-z0-9_][A-Za-z0-9_.:/-]{0,159}$",
    quotedKey: true
  }
];
var joinRoute = (prefix, child) => {
  const p = prefix.replace(/^\/+|\/+$/g, "");
  const c = child.replace(/^\/+|\/+$/g, "");
  return c ? `/${[p, c].filter(Boolean).join("/")}` : `/${p}`;
};
var REST_PROPERTY_HEAD = /^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)/;
var restProcedure = (text, methods) => {
  const head = REST_PROPERTY_HEAD.exec(text);
  if (!head) return void 0;
  let i = head[0].length;
  for (; ; ) {
    if (text[i] !== ".") return void 0;
    i++;
    const name = /^([A-Za-z_$][\w$]*)/.exec(text.slice(i));
    if (!name) return void 0;
    i += name[0].length;
    const identifier = name[1];
    if (methods.test(identifier)) {
      return text[i] === "(" ? { key: head[1], root: head[2], method: identifier } : void 0;
    }
    if (text[i] === "(") {
      let depth = 0;
      do {
        if (text[i] === "(") depth++;
        else if (text[i] === ")") depth--;
        i++;
      } while (i < text.length && depth > 0);
    }
  }
};
var anchorsFromGroups = (groups, resolveEnclosing) => {
  const out = [];
  for (const { rule, prefixes: prefixMatches, matches } of groups) {
    const methodRe = compileMethods(rule.methods);
    const receiverRe = rule.receiverPattern ? new RegExp(rule.receiverPattern) : void 0;
    const keyRe = rule.keyPattern ? new RegExp(rule.keyPattern) : void 0;
    const roleAware = rule.kind === "channel" || rule.kind === "trpc" || rule.kind === "orpc";
    const prefixes = /* @__PURE__ */ new Map();
    for (const match of prefixMatches) {
      const prefix = match.single.P?.trim();
      if (prefix !== void 0 && !prefixes.has(match.file)) prefixes.set(match.file, unquote(prefix));
    }
    for (const match of matches) {
      if (rule.restKey && rule.labelPrefix) {
        for (const sibling of match.multi[rule.restKey] ?? []) {
          const member = restProcedure(sibling.text, methodRe);
          if (!member) continue;
          if (keyRe && !keyRe.test(member.key)) continue;
          if (receiverRe && !receiverRe.test(member.root)) continue;
          const siblingLine = sibling.line || match.line;
          const restLabel = `${rule.labelPrefix} ${member.key}`;
          out.push({
            id: restLabel,
            kind: rule.kind,
            label: restLabel,
            nodeId: resolveEnclosing(match.file, siblingLine) ?? `file:${match.file}`,
            file: match.file,
            line: siblingLine,
            ruleId: roleAware ? `${rule.id}:${member.method.toLowerCase()}` : rule.id
          });
        }
      }
      const method = match.single.M;
      if (!method || !methodRe.test(method)) continue;
      if (receiverRe && (!match.single.R || !receiverRe.test(match.single.R))) continue;
      let label;
      if (rule.labelPrefix) {
        const captured = match.single[rule.keyFrom ?? "P"];
        if (!captured || rule.quotedKey && !QUOTED_RE2.test(captured.trim())) continue;
        let key = unquote(captured);
        if (keyRe && !keyRe.test(key)) continue;
        if (rule.keyNormalization === "grpc") key = key.replace(/^\/+/, "");
        let prefix = rule.labelPrefix;
        if (rule.verbFrom) {
          const verb = (match.single[rule.verbFrom] ?? "").replace(/^\$/, "");
          if (!verb || !HTTP_VERB_RE.test(verb)) continue;
          prefix = verb.toUpperCase();
        }
        label = `${prefix} ${rule.keyPrefix ?? ""}${key}`;
      } else {
        const pathLike = match.single.P;
        if (!pathLike) continue;
        const prefix = prefixes.get(match.file);
        let raw = prefix !== void 0 && prefix !== "" ? joinRoute(prefix, unquote(pathLike)) : unquote(pathLike);
        if (rule.mountRoot && !raw.startsWith("/")) raw = "/" + raw.replace(/^\/+/, "");
        const verbInPath = VERB_IN_PATH.exec(raw);
        let verbOverride;
        if (verbInPath) {
          verbOverride = verbInPath[1].toUpperCase();
          raw = verbInPath[2];
        }
        if (!PATH_TOKEN_RE.test(raw) && !PLACEHOLDER_ONLY.test(raw)) continue;
        let httpMethod;
        if (rule.verbFrom) {
          const verb = match.single[rule.verbFrom];
          if (!verb || !HTTP_VERB_RE.test(verb)) continue;
          httpMethod = verb.toUpperCase();
        } else {
          httpMethod = verbOverride ?? deriveVerb(method);
        }
        label = `${httpMethod} ${normalizeLiteral(raw, "path")}`;
      }
      const anchorLine = match.singleLines[rule.keyFrom ?? "P"] ?? match.line;
      const enclosing = resolveEnclosing(match.file, anchorLine);
      const nodeId = enclosing ?? `file:${match.file}`;
      out.push({
        id: label,
        kind: rule.kind,
        label,
        nodeId,
        file: match.file,
        line: anchorLine,
        ruleId: roleAware ? `${rule.id}:${method.toLowerCase()}` : rule.id,
        ...rule.implicit ? { implicit: true } : {}
      });
      if (rule.keyNormalization === "grpc") {
        const methodPath = label.slice("RPC ".length);
        const slash = methodPath.lastIndexOf("/");
        if (slash > 0) {
          const serviceLabel = `RPC SERVICE ${methodPath.slice(0, slash)}`;
          out.push({
            id: serviceLabel,
            kind: "rpc-service",
            label: serviceLabel,
            nodeId,
            file: match.file,
            line: match.line,
            ruleId: `${rule.id}:service`
          });
        }
      }
    }
  }
  return dedupeAnchors(out);
};
var anchorScanPlan = (files, pack = DEFAULT_PACK) => {
  const byLang = groupByLang(files);
  const rules = [];
  const groups = [];
  let ordinal = 0;
  for (const rule of pack) {
    for (const language of rule.langs) {
      if (!byLang.get(language)?.length) continue;
      const prefixIds = [];
      const matchIds = [];
      for (const pattern of rule.prefixPattern ?? []) {
        const id = `fovea-anchor-prefix-${ordinal++}`;
        prefixIds.push(id);
        rules.push({ id, language, pattern: anonymousVariadics(pattern) });
      }
      for (const pattern of rule.patterns ?? [rule.pattern]) {
        const id = `fovea-anchor-match-${ordinal++}`;
        matchIds.push(id);
        const scanPattern = rule.restKey ? pattern : anonymousVariadics(pattern);
        const live = liveConstraints(scanPattern, {
          M: { regex: rule.methods },
          ...rule.receiverPattern ? { R: { regex: rule.receiverPattern } } : {}
        });
        rules.push({
          id,
          language,
          pattern: scanPattern,
          ...live ? { constraints: live } : {}
        });
      }
      groups.push({ rule, prefixIds, matchIds });
    }
  }
  return { rules, groups };
};
var anchorsFromScan = (matches, plan, resolveEnclosing) => {
  const byRule = /* @__PURE__ */ new Map();
  for (const match of matches) {
    const bucket = byRule.get(match.ruleId);
    if (bucket) bucket.push(match);
    else byRule.set(match.ruleId, [match]);
  }
  const groups = plan.groups.map(({ rule, prefixIds, matchIds }) => ({
    rule,
    prefixes: prefixIds.flatMap((id) => byRule.get(id) ?? []),
    matches: matchIds.flatMap((id) => byRule.get(id) ?? [])
  }));
  return anchorsFromGroups(groups, resolveEnclosing);
};
var extractAnchors = async (files, cwd, resolveEnclosing, pack = DEFAULT_PACK) => {
  const plan = anchorScanPlan(files, pack);
  const scanned = await scanRules(plan.rules, files, cwd);
  if (scanned !== void 0) return anchorsFromScan(scanned, plan, resolveEnclosing);
  const byLang = groupByLang(files);
  const groups = [];
  for (const rule of pack) {
    for (const language of rule.langs) {
      const langFiles = byLang.get(language);
      if (!langFiles?.length) continue;
      const prefixes = rule.prefixPattern?.length ? await patternRunAll(rule.prefixPattern, language, langFiles, cwd) : [];
      const matches = await patternRunAll(rule.patterns ?? [rule.pattern], language, langFiles, cwd);
      groups.push({ rule, prefixes, matches });
    }
  }
  return anchorsFromGroups(groups, resolveEnclosing);
};
var DEFAULT_FILE_ROUTES = [
  { id: "next-app-route", re: "(?:^|/)app/(.+)/route\\.(?:ts|tsx|js|jsx|mjs)$", verbs: "exports", kind: "route" },
  { id: "next-app-page", re: "(?:^|/)app/(?:(.+)/)?page\\.(?:tsx|jsx|mdx)$", verbs: "suffix", kind: "page" },
  { id: "next-pages-api", re: "(?:^|/)pages/api/(.+)\\.(?:ts|tsx|js|jsx)$", verbs: "suffix", pathPrefix: "/api", kind: "route" },
  { id: "sveltekit-server", re: "(?:^|/)src/routes/(?:(.+)/)?\\+server\\.(?:ts|js)$", verbs: "exports", kind: "route" },
  { id: "sveltekit-page", re: "(?:^|/)src/routes/(?:(.+)/)?\\+page\\.(?:svelte|md)$", verbs: "suffix", kind: "page" },
  { id: "nuxt-server-api", re: "(?:^|/)server/api/(.+)\\.(?:ts|js|mjs)$", verbs: "suffix", pathPrefix: "/api", kind: "route" },
  { id: "astro-endpoint", re: "(?:^|/)src/pages/(.+)\\.(?:ts|js|mjs)$", verbs: "exports", kind: "route" }
];
var EXPORTED_VERB_RE = /\bexport\s+(?:(?:async\s+)?function\s+|const\s+)(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/g;
var SUFFIX_VERB_RE = /\.(get|post|put|delete|patch|head|options)$/i;
var FILE_DYNAMIC_SEG = /^@?\[+(?:\.\.\.)?[^\]]+\]+$/;
var toFileRoutePath = (stem) => {
  if (stem === "") return "/";
  const segs = stem.split("/").flatMap((seg) => {
    if (!seg || /^\(.+\)$/.test(seg)) return [];
    if (FILE_DYNAMIC_SEG.test(seg)) return ["{*}"];
    if (seg === "index") return [];
    return [seg];
  });
  return "/" + segs.filter((s) => s !== "").join("/");
};
var extractFileRoutes = async (files, root, rules = DEFAULT_FILE_ROUTES, source) => {
  const compiled = rules.map((r) => ({ rule: r, re: new RegExp(r.re) }));
  const out = [];
  const verbReaders = [];
  for (const file of files) {
    for (const { rule, re } of compiled) {
      const match = re.exec(file);
      if (match && rule.verbs === "exports") {
        verbReaders.push(file);
        break;
      }
    }
  }
  const texts = source ? await readAll(verbReaders, source) : /* @__PURE__ */ new Map();
  for (const file of files) {
    for (const { rule, re } of compiled) {
      const match = re.exec(file);
      if (!match) continue;
      let stem = match[1] ?? "";
      if (!stem && !rule.pathPrefix) {
      }
      const verbs = /* @__PURE__ */ new Set();
      let suffixVerb;
      const sv = SUFFIX_VERB_RE.exec(stem);
      if (sv) {
        suffixVerb = sv[1].toUpperCase();
        stem = stem.slice(0, -sv[0].length);
      }
      if (rule.verbs === "suffix") {
        if (suffixVerb) verbs.add(suffixVerb);
      } else {
        let content = texts.get(file);
        if (content === void 0) {
          try {
            content = (source ? await source.read(file) : await readFile3(joinPath2(root, file), "utf8")) ?? "";
          } catch {
            content = "";
          }
        }
        for (const vm of content.matchAll(EXPORTED_VERB_RE)) verbs.add(vm[1]);
      }
      if (verbs.size === 0) verbs.add("ANY");
      const rel = (rule.pathPrefix ?? "") + toFileRoutePath(stem);
      const norm = normalizeLiteral(rel, "path");
      for (const verb of verbs) {
        const label = `${verb} ${norm}`;
        out.push({
          id: label,
          kind: rule.kind ?? "route",
          label,
          nodeId: `file:${file}`,
          file,
          line: 0,
          ruleId: rule.id
        });
      }
    }
  }
  return dedupeAnchors(out);
};
var dedupeAnchors = (out) => {
  const seen2 = /* @__PURE__ */ new Set();
  return out.filter((a) => {
    const k = `${a.id}|${a.file}|${a.line}`;
    if (seen2.has(k)) return false;
    seen2.add(k);
    return true;
  });
};
var DEFAULTS_SHA = createHash2("sha1").update(JSON.stringify(DEFAULT_PACK)).update(JSON.stringify(DEFAULT_FILE_ROUTES)).digest("hex");
var loadRepoRules = async (root) => {
  let raw = "";
  try {
    raw = await readFile3(joinPath2(root, ".fovea", "rules.json"), "utf8");
  } catch {
    return { pack: DEFAULT_PACK, fileRoutes: DEFAULT_FILE_ROUTES, sha: DEFAULTS_SHA };
  }
  const sha = createHash2("sha1").update(DEFAULTS_SHA + raw).digest("hex");
  try {
    const parsed = JSON.parse(raw);
    const rules = (parsed.rules ?? []).filter(
      (r) => r && typeof r.pattern === "string" && typeof r.methods === "string" && Array.isArray(r.langs)
    );
    const fileRoutes = (parsed.fileRoutes ?? []).filter((r) => r && typeof r.re === "string" && typeof r.verbs === "string");
    return { pack: [...DEFAULT_PACK, ...rules], fileRoutes: [...DEFAULT_FILE_ROUTES, ...fileRoutes], sha };
  } catch {
    return { pack: DEFAULT_PACK, fileRoutes: DEFAULT_FILE_ROUTES, sha };
  }
};

// src/fovea/core/discover.ts
var CALL_LINE_RE = /(?<at>@)?(?<recv>(?:[A-Za-z_$][\w$]*\.)+)?(?<method>[A-Za-z_$][\w$]*)\s*\((?<args>[^()]*)\)/g;
var STRING_RE = /([rbfuRBFU]{0,3})(["'`])((?:\\.|(?!\2)[^\\])*)\2/g;
var CALLEE_DENY = /* @__PURE__ */ new Set([
  "join",
  "resolve",
  "dirname",
  "basename",
  "expand_path",
  "readFile",
  "readFileSync",
  "existsSync",
  "open",
  "load",
  "loads",
  "import",
  "require",
  // String predicates: membership tests hit the path column at high rate but
  // never refer to routes. (Distinguishing cause from noise is callee-semantic.)
  "startsWith",
  "endsWith",
  "contains",
  "includes",
  "equals",
  "equalsIgnoreCase",
  "matches",
  "matchesPattern",
  "useParams",
  "matchPath"
]);
var harvestFile = (lang, text) => {
  const sigs = {};
  for (const line of text.split("\n")) {
    if (!line.includes("(") || !(line.includes('"') || line.includes("'") || line.includes("`"))) continue;
    CALL_LINE_RE.lastIndex = 0;
    let c;
    while (c = CALL_LINE_RE.exec(line)) {
      const method = c.groups?.method;
      if (!method || CALLEE_DENY.has(method)) continue;
      const shape = c.groups?.at ? "dec" : c.groups?.recv ? "recv" : "bare";
      const argsText = c.groups?.args ?? "";
      if (!argsText) continue;
      const args = argsText.split(",");
      let idx = 0;
      for (const raw of args) {
        STRING_RE.lastIndex = 0;
        const sm = STRING_RE.exec(raw);
        const idxNow = idx++;
        if (!sm) continue;
        const lit = sm[3];
        if (lit === void 0 || lit === "") continue;
        const key = `${lang}|${shape}|${method}|${idxNow}`;
        const rec = sigs[key] ?? [0, 0];
        rec[0]++;
        if (classifyLiteral(lit) === "path") rec[1]++;
        sigs[key] = rec;
      }
    }
  }
  return sigs;
};
var aggregateFiles = (perFile) => {
  const agg = /* @__PURE__ */ new Map();
  for (const sigs of Object.values(perFile)) {
    if (!sigs) continue;
    for (const [key, [n, p]] of Object.entries(sigs)) {
      const stat5 = agg.get(key);
      if (stat5) {
        stat5.n += n;
        stat5.pathN += p;
        stat5.files++;
      } else {
        const [lang, shape, callee, argIdx] = key.split("|");
        agg.set(key, { key, lang, shape, callee, argIdx: Number(argIdx), n, pathN: p, files: 1 });
      }
    }
  }
  return [...agg.values()];
};
var posterior = (pathN, n) => (pathN + 0.5) / (n + 1);
var MIN_SITES = 4;
var MIN_FILES = 2;
var MIN_POSTERIOR = 0.55;
var escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var synthesize = (s) => {
  const slots = [];
  for (let i = 0; i <= s.argIdx; i++) slots.push(i === s.argIdx ? "$P" : `$X${i}`);
  const inner = slots.join(", ");
  let variants;
  switch (s.shape) {
    case "recv":
      variants = [`$R.$M(${inner})`, `$R.$M(${inner}, $$$H)`];
      break;
    case "bare":
      variants = [`$M(${inner})`, `$M(${inner}, $$$H)`];
      break;
    case "dec":
      variants = [`@$M(${inner})`, `@$M(${inner}, $$$H)`];
      break;
  }
  return {
    id: `implicit:${s.lang.toLowerCase()}:${s.shape}:${s.callee}:${s.argIdx}`,
    langs: [s.lang],
    patterns: variants,
    methods: `^(?i:${escapeRe(s.callee)})$`,
    kind: "route",
    implicit: true,
    evidence: { n: s.n, pathN: s.pathN, files: s.files, posterior: posterior(s.pathN, s.n) }
  };
};
var shapeCompatPatterns = {
  recv: /^\$R\.\$M\(/,
  bare: /^\$M[(\s]/,
  dec: /^@\$(R\.)?M\(/
};
var isCovered = (sig, pack) => {
  const mre = (methods, callee) => compileMethods(methods).test(callee);
  return pack.some((r) => {
    if (!r.langs.includes(sig.lang)) return false;
    if (!mre(r.methods, sig.callee)) return false;
    const pats = r.patterns ?? (r.pattern ? [r.pattern] : []);
    return pats.some((p) => shapeCompatPatterns[sig.shape].test(p));
  });
};
var promote = (sigs, pack = []) => {
  const out = [];
  for (const s of sigs) {
    if (s.n < MIN_SITES || s.files < MIN_FILES) continue;
    if (posterior(s.pathN, s.n) < MIN_POSTERIOR) continue;
    if (isCovered(s, pack)) continue;
    const r = synthesize(s);
    if (r) out.push(r);
  }
  return out;
};

// src/fovea/core/protocols.ts
import { extname } from "node:path";
var PROTOCOL_EXTENSIONS = /* @__PURE__ */ new Set([".proto", ".graphql", ".gql"]);
var NAME2 = /[_A-Za-z][_0-9A-Za-z]*/y;
var maskSyntax = (text, hashComments) => {
  const chars = text.split("");
  const blank = (index) => {
    if (chars[index] !== "\n" && chars[index] !== "\r") chars[index] = " ";
  };
  for (let i = 0; i < chars.length; ) {
    if (chars[i] === "/" && chars[i + 1] === "/") {
      while (i < chars.length && chars[i] !== "\n") blank(i++);
      continue;
    }
    if (chars[i] === "/" && chars[i + 1] === "*") {
      blank(i++);
      blank(i++);
      while (i < chars.length && !(chars[i] === "*" && chars[i + 1] === "/")) blank(i++);
      if (i < chars.length) {
        blank(i++);
        blank(i++);
      }
      continue;
    }
    if (hashComments && chars[i] === "#") {
      while (i < chars.length && chars[i] !== "\n") blank(i++);
      continue;
    }
    if (chars[i] === '"' || chars[i] === "'") {
      const quote = chars[i];
      const triple = chars[i + 1] === quote && chars[i + 2] === quote;
      const width = triple ? 3 : 1;
      for (let n = 0; n < width; n++) blank(i++);
      while (i < chars.length) {
        if (!triple && chars[i] === "\\") {
          blank(i++);
          if (i < chars.length) blank(i++);
          continue;
        }
        if (triple && chars[i] === quote && chars[i + 1] === quote && chars[i + 2] === quote) {
          for (let n = 0; n < 3; n++) blank(i++);
          break;
        }
        if (!triple && chars[i] === quote) {
          blank(i++);
          break;
        }
        blank(i++);
      }
      continue;
    }
    i++;
  }
  return chars.join("");
};
var closingBrace = (text, open3) => {
  let depth = 0;
  for (let i = open3; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return void 0;
};
var syntaxBlocks = (text, pattern) => {
  pattern.lastIndex = 0;
  const out = [];
  for (let match; match = pattern.exec(text); ) {
    const open3 = match.index + match[0].lastIndexOf("{");
    const close = closingBrace(text, open3);
    if (close === void 0) continue;
    out.push({ match, open: open3, close });
    pattern.lastIndex = close + 1;
  }
  return out;
};
var declarationBlocks = (text, pattern) => {
  pattern.lastIndex = 0;
  const out = [];
  for (let match; match = pattern.exec(text); ) {
    let parentheses = 0;
    let brackets = 0;
    let open3;
    for (let i = pattern.lastIndex; i < text.length; i++) {
      const char = text[i];
      if ((char === "\n" || char === "\r") && parentheses === 0 && brackets === 0) {
        const nextLine = text.slice(i + 1);
        if (/^\s*(?:(?:extend\s+)?(?:type|interface|input|enum|scalar|union)|schema|query|mutation|subscription|fragment)\b/.test(nextLine)) break;
      }
      if (char === "(") parentheses++;
      else if (char === ")") parentheses = Math.max(0, parentheses - 1);
      else if (char === "[") brackets++;
      else if (char === "]") brackets = Math.max(0, brackets - 1);
      else if (char === "{" && parentheses === 0 && brackets === 0) {
        open3 = i;
        break;
      } else if ((char === "}" || char === ";") && parentheses === 0 && brackets === 0) {
        break;
      }
    }
    if (open3 === void 0) continue;
    const close = closingBrace(text, open3);
    if (close === void 0) continue;
    out.push({ match, open: open3, close });
    pattern.lastIndex = close + 1;
  }
  return out;
};
var lineLookup = (text) => {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return (index) => {
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const middle = low + (high - low >> 1);
      if (starts[middle] <= index) low = middle + 1;
      else high = middle;
    }
    return low;
  };
};
var anchor = (file, line, id, kind, ruleId) => ({
  id,
  kind,
  label: id,
  nodeId: `file:${file}`,
  file,
  line,
  ruleId
});
var PROTO_SCALARS = /* @__PURE__ */ new Set([
  "double",
  "float",
  "int32",
  "int64",
  "uint32",
  "uint64",
  "sint32",
  "sint64",
  "fixed32",
  "fixed64",
  "sfixed32",
  "sfixed64",
  "bool",
  "string",
  "bytes"
]);
var PROTO_STATEMENT_KEYWORDS = /* @__PURE__ */ new Set([
  "option",
  "oneof",
  "reserved",
  "extensions",
  "extend",
  "message",
  "enum",
  "rpc",
  "service",
  "syntax",
  "package",
  "import",
  "stream",
  "group"
]);
var protoAnchors = (file, source) => {
  const masked = maskSyntax(source, false);
  const lineOf = lineLookup(source);
  const packageName = /\bpackage\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/.exec(masked)?.[1];
  const qualify = (name) => {
    const clean = name.replace(/^\./, "");
    return clean.includes(".") || !packageName ? clean : `${packageName}.${clean}`;
  };
  const out = [];
  const addMessage = (name, index, ruleId) => {
    const clean = name.replace(/^\./, "");
    if (PROTO_SCALARS.has(clean)) return;
    out.push(anchor(file, lineOf(index), `RPC MESSAGE ${qualify(clean)}`, "rpc-message", ruleId));
  };
  for (const message of syntaxBlocks(masked, /\bmessage\s+([A-Za-z_]\w*)\s*\{/g)) {
    addMessage(message.match[1], message.match.index, "proto-message-declaration");
    const bodyOffset = message.open + 1;
    const body = masked.slice(bodyOffset, message.close);
    for (const field of body.matchAll(/(?:^|[;{}])\s*(?:(?:repeated|optional|required)\s+)?(\.?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+[A-Za-z_]\w*\s*=/gm)) {
      const type = field[1];
      if (PROTO_STATEMENT_KEYWORDS.has(type)) continue;
      const local = field[0].indexOf(type);
      addMessage(type, bodyOffset + field.index + Math.max(0, local), "proto-message-field-type");
    }
    for (const mapField of body.matchAll(/\bmap\s*<\s*[^,>]+,\s*(\.?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*>/g)) {
      addMessage(mapField[1], bodyOffset + mapField.index, "proto-map-value-type");
    }
  }
  for (const service of syntaxBlocks(masked, /\bservice\s+([A-Za-z_]\w*)\s*\{/g)) {
    const serviceName = service.match[1];
    const qualified = qualify(serviceName);
    out.push(anchor(file, lineOf(service.match.index), `RPC SERVICE ${qualified}`, "rpc-service", "proto-service-declaration"));
    const bodyOffset = service.open + 1;
    const body = masked.slice(bodyOffset, service.close);
    const rpcPattern = /\brpc\s+([A-Za-z_]\w*)\s*\(\s*(?:stream\s+)?(\.?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\)\s*returns\s*\(\s*(?:stream\s+)?(\.?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\)/g;
    for (let rpc; rpc = rpcPattern.exec(body); ) {
      const index = bodyOffset + rpc.index;
      out.push(anchor(file, lineOf(index), `RPC ${qualified}/${rpc[1]}`, "rpc", "proto-rpc-declaration"));
      addMessage(rpc[2], index + rpc[0].indexOf(rpc[2]), "proto-rpc-request-type");
      addMessage(rpc[3], index + rpc[0].lastIndexOf(rpc[3]), "proto-rpc-response-type");
    }
  }
  return out;
};
var graphqlFields = (text, start, end) => {
  const out = [];
  for (let i = start; i < end; ) {
    NAME2.lastIndex = i;
    const match = NAME2.exec(text);
    if (!match) {
      i++;
      continue;
    }
    const name = match[0];
    let cursor = NAME2.lastIndex;
    let resume = NAME2.lastIndex;
    while (cursor < end && /\s/.test(text[cursor])) cursor++;
    if (text[cursor] === "(") {
      let depth = 0;
      do {
        if (text[cursor] === "(") depth++;
        else if (text[cursor] === ")") depth--;
        cursor++;
      } while (cursor < end && depth > 0);
      resume = cursor;
      while (cursor < end && /\s/.test(text[cursor])) cursor++;
    }
    if (text[cursor] === ":") {
      out.push({ name, index: match.index });
      i = cursor + 1;
    } else {
      i = resume;
    }
  }
  return out;
};
var firstOperationField = (text, start, end) => {
  for (let i = start; i < end; ) {
    while (i < end && /[\s,]/.test(text[i])) i++;
    if (text.startsWith("...", i)) {
      i += 3;
      while (i < end && /\s/.test(text[i])) i++;
      NAME2.lastIndex = i;
      const spread = NAME2.exec(text);
      i = spread ? NAME2.lastIndex : i + 1;
      if (spread?.[0] !== "on") continue;
      while (i < end && /\s/.test(text[i])) i++;
      NAME2.lastIndex = i;
      const typeCondition = NAME2.exec(text);
      i = typeCondition ? NAME2.lastIndex : i;
      while (i < end) {
        while (i < end && /\s/.test(text[i])) i++;
        if (text[i] !== "@") break;
        i++;
        NAME2.lastIndex = i;
        const directive = NAME2.exec(text);
        i = directive ? NAME2.lastIndex : i + 1;
        while (i < end && /\s/.test(text[i])) i++;
        if (text[i] === "(") {
          let depth = 0;
          do {
            if (text[i] === "(") depth++;
            else if (text[i] === ")") depth--;
            i++;
          } while (i < end && depth > 0);
        }
      }
      if (text[i] === "{") {
        const close = closingBrace(text, i);
        if (close !== void 0 && close <= end) {
          const nested = firstOperationField(text, i + 1, close);
          if (nested) return nested;
          i = close + 1;
        }
      }
      continue;
    }
    if (text[i] === "@") {
      i++;
      NAME2.lastIndex = i;
      const directive = NAME2.exec(text);
      i = directive ? NAME2.lastIndex : i + 1;
      if (text[i] === "(") {
        let depth = 0;
        do {
          if (text[i] === "(") depth++;
          else if (text[i] === ")") depth--;
          i++;
        } while (i < end && depth > 0);
      }
      continue;
    }
    NAME2.lastIndex = i;
    const match = NAME2.exec(text);
    if (!match) {
      i++;
      continue;
    }
    let name = match[0];
    let index = match.index;
    let cursor = NAME2.lastIndex;
    while (cursor < end && /\s/.test(text[cursor])) cursor++;
    if (text[cursor] === ":") {
      cursor++;
      while (cursor < end && /\s/.test(text[cursor])) cursor++;
      NAME2.lastIndex = cursor;
      const target = NAME2.exec(text);
      if (!target) return void 0;
      name = target[0];
      index = target.index;
    }
    return { name, index };
  }
  return void 0;
};
var GRAPHQL_BUILTINS = /* @__PURE__ */ new Set(["String", "Int", "Float", "Boolean", "ID"]);
var graphqlAnchors = (file, source) => {
  const masked = maskSyntax(source, true);
  const lineOf = lineLookup(source);
  const roots = /* @__PURE__ */ new Map([
    ["Query", "QUERY"],
    ["Mutation", "MUTATION"],
    ["Subscription", "SUBSCRIPTION"]
  ]);
  for (const schema of declarationBlocks(masked, /\bschema\b/g)) {
    const body = masked.slice(schema.open + 1, schema.close);
    for (const mapping of body.matchAll(/\b(query|mutation|subscription)\s*:\s*([_A-Za-z]\w*)/g)) {
      roots.set(mapping[2], mapping[1].toUpperCase());
    }
  }
  const out = [];
  const addType = (name, index, ruleId) => {
    if (GRAPHQL_BUILTINS.has(name)) return;
    out.push(anchor(file, lineOf(index), `GRAPHQL TYPE ${name}`, "graphql-type", ruleId));
  };
  for (const declaration of masked.matchAll(/\b(?:extend\s+)?(type|interface|input|enum|scalar|union)\s+([_A-Za-z]\w*)/g)) {
    addType(declaration[2], declaration.index, `graphql-${declaration[1]}-declaration`);
  }
  for (const union of masked.matchAll(/\b(?:extend\s+)?union\s+([_A-Za-z]\w*)/g)) {
    const unionEnd = union.index + union[0].length;
    const boundary = /(?:[\n\r]\s*(?:(?:extend\s+)?(?:type|interface|input|enum|scalar|union|schema|directive)\b|(?:query|mutation|subscription|fragment)\b)|[{])/.exec(masked.slice(unionEnd));
    const regionEnd = boundary ? unionEnd + boundary.index : masked.length;
    for (const member of masked.slice(unionEnd, regionEnd).matchAll(/[_A-Za-z]\w*/g)) {
      addType(member[0], unionEnd + member.index, "graphql-union-member");
    }
  }
  for (const type of declarationBlocks(masked, /\b(?:extend\s+)?(?:type|interface|input)\s+([_A-Za-z]\w*)/g)) {
    const operation = roots.get(type.match[1]);
    if (operation) {
      for (const field of graphqlFields(masked, type.open + 1, type.close)) {
        out.push(anchor(file, lineOf(field.index), `GRAPHQL ${operation} ${field.name}`, "graphql", "graphql-root-field"));
      }
    }
    const header = masked.slice(type.match.index, type.open);
    const implementsMatch = /implements\s+([_A-Za-z][\w\s&|,]*)/.exec(header);
    if (implementsMatch) {
      const base = type.match.index + implementsMatch.index + implementsMatch[0].indexOf(implementsMatch[1]);
      for (const reference of implementsMatch[1].matchAll(/[_A-Za-z]\w*/g)) {
        addType(reference[0], base + reference.index, "graphql-implements-type");
      }
    }
    const bodyOffset = type.open + 1;
    const body = masked.slice(bodyOffset, type.close);
    for (const reference of body.matchAll(/:\s*[!\[\]\s]*([_A-Za-z]\w*)/g)) {
      addType(reference[1], bodyOffset + reference.index, "graphql-field-type");
    }
  }
  const operationPattern = /(?:^|[\n\r])\s*(query|mutation|subscription)\b(?:\s+([_A-Za-z]\w*))?/g;
  for (const operation of declarationBlocks(masked, operationPattern)) {
    const operationKind = operation.match[1].toUpperCase();
    const operationName = operation.match[2];
    const operationIndex = operation.match.index + operation.match[0].indexOf(operation.match[1]);
    if (operationName) {
      out.push(anchor(file, lineOf(operationIndex), `GRAPHQL OPERATION ${operationKind} ${operationName}`, "graphql-operation", "graphql-operation-declaration"));
    }
    const rootType = [...roots].find(([, kind]) => kind === operationKind)?.[0];
    if (rootType) addType(rootType, operationIndex, "graphql-operation-root");
    const header = masked.slice(operationIndex, operation.open);
    for (const reference of header.matchAll(/\$[_A-Za-z]\w*\s*:\s*[!\[\]\s]*([_A-Za-z]\w*)/g)) {
      addType(reference[1], operationIndex + reference.index, "graphql-variable-type");
    }
    const bodyOffset = operation.open + 1;
    const body = masked.slice(bodyOffset, operation.close);
    for (const inline of body.matchAll(/\.\.\.\s+on\s+([_A-Za-z]\w*)/g)) {
      addType(inline[1], bodyOffset + inline.index, "graphql-inline-fragment-type");
    }
    const field = firstOperationField(masked, bodyOffset, operation.close);
    if (field) {
      out.push(anchor(file, lineOf(field.index), `GRAPHQL ${operationKind} ${field.name}`, "graphql", "graphql-operation"));
    }
  }
  const fragmentPattern = /(?:^|[\n\r])\s*fragment\s+([_A-Za-z]\w*)\s+on\s+([_A-Za-z]\w*)/g;
  for (const fragment of declarationBlocks(masked, fragmentPattern)) {
    const fragmentIndex = fragment.match.index + fragment.match[0].indexOf("fragment");
    out.push(anchor(file, lineOf(fragmentIndex), `GRAPHQL FRAGMENT ${fragment.match[1]}`, "graphql-fragment", "graphql-fragment-declaration"));
    addType(fragment.match[2], fragmentIndex, "graphql-fragment-type");
  }
  return out;
};
var extractProtocolAnchors = async (files, source) => {
  const protocolFiles = files.filter((file) => PROTOCOL_EXTENSIONS.has(extname(file).toLowerCase()));
  const texts = await readAll(protocolFiles, source);
  const out = [];
  for (const file of [...protocolFiles].sort()) {
    const text = texts.get(file);
    if (text === void 0) continue;
    if (file.endsWith(".proto")) out.push(...protoAnchors(file, text));
    else out.push(...graphqlAnchors(file, text));
  }
  out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.line - b.line || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || ((a.ruleId ?? "") < (b.ruleId ?? "") ? -1 : (a.ruleId ?? "") > (b.ruleId ?? "") ? 1 : 0));
  const seen2 = /* @__PURE__ */ new Set();
  return out.filter((item) => {
    const key = `${item.id}|${item.file}|${item.line}`;
    if (seen2.has(key)) return false;
    seen2.add(key);
    return true;
  });
};

// src/fovea/core/build.ts
var CACHE_VERSION = 17;
var IGNORE_DIRS = /* @__PURE__ */ new Set([".git", "node_modules", "dist", "vendor", ".venv", "venv", "target", "coverage", ".next", "build", "__pycache__", ".pi", ".pi-fovea", "deps", "_build", ".tox", "Pods", ".cargo"]);
var MAX_FILES = envInt("FOVEA_MAX_FILES", 8e3, 100, 1e5);
var MAX_FILE_BYTES = envInt("FOVEA_MAX_FILE_BYTES", 1024 * 1024, 64 * 1024, 64 * 1024 * 1024);
var PROTOCOL_MAX_FILE_BYTES = envInt("FOVEA_MAX_PROTO_FILE_BYTES", 8 * 1024 * 1024, 256 * 1024, 64 * 1024 * 1024);
var PROTOCOL_DOC_RE = /\.(?:proto|graphql|gql)$/i;
var maxFileBytes = (file) => PROTOCOL_DOC_RE.test(file) ? PROTOCOL_MAX_FILE_BYTES : MAX_FILE_BYTES;
var MAX_SUBMODULE_DEPTH = envInt("FOVEA_MAX_SUBMODULE_DEPTH", 4, 1, 16);
var LOCKFILE_NAMES = /* @__PURE__ */ new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "pipfile.lock",
  "poetry.lock",
  "cargo.lock",
  "composer.lock",
  "gemfile.lock",
  "go.sum"
]);
var discoveryExclusionReason = (file) => {
  const segments = file.split("/");
  for (const segment of segments) if (IGNORE_DIRS.has(segment)) return `ignored directory ${segment}`;
  const base = segments[segments.length - 1].toLowerCase();
  return LOCKFILE_NAMES.has(base) || base.endsWith(".lock") ? "dependency lockfile" : void 0;
};
var isJunk = (file) => discoveryExclusionReason(file) !== void 0;
var supported = (f, routeRes) => {
  const ext = f.split(".").pop()?.toLowerCase() ?? "";
  if (!isBinaryExt(f) && (ext in LANG_BY_EXT || isConfigFile(f))) return true;
  return routeRes?.some((re) => re.test(f)) ?? false;
};
var MINIFIED_LINE_CHARS = 4e3;
var GENERATED_NAME_RE = /\.(?:min|bundle)\.(?:[cm]?js|[cm]?ts|jsx|tsx|mjs|cjs)$/i;
var isGeneratedSource = (rel, text) => {
  if (GENERATED_NAME_RE.test(rel)) return true;
  if (text.length < MINIFIED_LINE_CHARS) return false;
  for (let i = 0; i < text.length; ) {
    const nl = text.indexOf("\n", i);
    const end = nl === -1 ? text.length : nl;
    if (end - i >= MINIFIED_LINE_CHARS) return true;
    if (nl === -1) break;
    i = nl + 1;
  }
  return false;
};
var isGeneratedSourceBytes = (rel, data) => {
  if (GENERATED_NAME_RE.test(rel)) return true;
  if (data.length < MINIFIED_LINE_CHARS) return false;
  let start = 0;
  for (; ; ) {
    const nl = data.indexOf(10, start);
    const end = nl === -1 ? data.length : nl;
    if (end - start >= MINIFIED_LINE_CHARS) return true;
    if (nl === -1) return false;
    start = nl + 1;
  }
};
var NO_BOUNDARIES = /* @__PURE__ */ new Set();
var expandSubmodules = async (root, prefix, entries, enrolled, depth) => {
  const candidates = entries.filter((entry) => !entry.endsWith("/"));
  const kinds = await mapLimit(
    candidates,
    IO_CONCURRENCY,
    (entry) => lstat2(joinPath3(root, entry)).then(
      (value) => value.isDirectory() ? "directory" : value.isFile() || value.isSymbolicLink() ? "file" : "other",
      () => "unavailable"
    )
  );
  const gitlinks = new Set(candidates.filter((_, index) => kinds[index] === "directory"));
  const files = candidates.filter((_, index) => kinds[index] === "file").map((entry) => prefix + entry);
  const unavailableFiles = candidates.filter((_, index) => kinds[index] === "unavailable" || kinds[index] === "other").map((entry) => prefix + entry);
  const closedBoundaries = [];
  for (const link of gitlinks) {
    const key = prefix + link;
    if (depth <= 0 || !enrolled.has(key)) {
      closedBoundaries.push(key);
      continue;
    }
    const inner = await gitOut(joinPath3(root, link), ["ls-files", "-z", "-co", "--exclude-standard"], { timeout: 3e4 });
    if (inner === void 0) {
      closedBoundaries.push(key);
      continue;
    }
    if (!inner.trim()) {
      closedBoundaries.push(key);
      continue;
    }
    const nested = await expandSubmodules(
      joinPath3(root, link),
      `${key}/`,
      inner.split("\0").filter(Boolean),
      enrolled,
      depth - 1
    );
    files.push(...nested.files);
    closedBoundaries.push(...nested.closedBoundaries);
    unavailableFiles.push(...nested.unavailableFiles);
  }
  return { files, closedBoundaries, unavailableFiles };
};
var excludedPolicies = () => [
  "Git ignore rules for untracked files",
  "nested repositories until enrolled",
  `directories: ${[...IGNORE_DIRS].sort().join(", ")}`,
  "dependency lockfiles"
];
var examples = (values) => [...new Set(values)].sort().slice(0, 20);
var discoverFiles = async (root, routeRes, enrolled = NO_BOUNDARIES, maxFiles = MAX_FILES) => {
  const limit = Math.max(1, Math.floor(maxFiles));
  const gitListing = await gitOut(root, ["ls-files", "-z", "-co", "--exclude-standard"], { timeout: 3e4 });
  if (gitListing !== void 0) {
    const entries = gitListing.split("\0").filter(Boolean);
    const expanded = await expandSubmodules(root, "", entries, enrolled, MAX_SUBMODULE_DEPTH);
    const candidates = [...new Set(expanded.files)].sort();
    const unavailable = [...new Set(expanded.unavailableFiles)].sort();
    const eligible = [];
    const unsupported2 = [];
    const excluded2 = [...expanded.closedBoundaries, ...unavailable];
    for (const file of candidates) {
      if (isJunk(file)) excluded2.push(file);
      else if (supported(file, routeRes)) eligible.push(file);
      else unsupported2.push(file);
    }
    const files2 = eligible.slice(0, limit);
    return {
      files: files2,
      report: {
        source: "git",
        recording: unavailable.length ? "partial" : "complete",
        maxFiles: limit,
        candidateFilesSeen: candidates.length + unavailable.length,
        supportedFilesSeen: eligible.length,
        indexedFiles: files2.length,
        unsupportedFilesSeen: unsupported2.length,
        excludedEntriesSeen: excluded2.length,
        closedBoundariesSeen: expanded.closedBoundaries.length,
        unreadableDirectoriesSeen: 0,
        unavailableFilesSeen: unavailable.length,
        capped: eligible.length > limit,
        omittedSupported: Math.max(0, eligible.length - files2.length),
        unsupportedExamples: examples(unsupported2),
        excludedExamples: examples(excluded2),
        closedBoundaries: examples(expanded.closedBoundaries),
        unreadableDirectories: [],
        unavailableFiles: examples(unavailable),
        excludedPolicies: excludedPolicies()
      }
    };
  }
  const files = [];
  const unsupported = [];
  const excluded = [];
  const closedBoundaries = [];
  const unreadableDirectories = [];
  let candidateFilesSeen = 0;
  let supportedFilesSeen = 0;
  let truncated = false;
  const walk = async (dir, prefix) => {
    if (truncated) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      unreadableDirectories.push(prefix || ".");
      return;
    }
    if (prefix && !enrolled.has(prefix) && entries.some((entry) => entry.name === ".git")) {
      closedBoundaries.push(prefix);
      excluded.push(prefix);
      return;
    }
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      if (truncated) break;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) excluded.push(`${rel}/`);
        else await walk(joinPath3(dir, entry.name), rel);
        continue;
      }
      if (!entry.isFile()) continue;
      candidateFilesSeen++;
      if (isJunk(rel)) {
        excluded.push(rel);
      } else if (!supported(rel, routeRes)) {
        unsupported.push(rel);
      } else {
        supportedFilesSeen++;
        if (files.length < limit) files.push(rel);
        else truncated = true;
      }
    }
  };
  await walk(root, "");
  files.sort();
  return {
    files,
    report: {
      source: "walk",
      recording: truncated ? "truncated" : unreadableDirectories.length ? "partial" : "complete",
      maxFiles: limit,
      candidateFilesSeen,
      supportedFilesSeen,
      indexedFiles: files.length,
      unsupportedFilesSeen: unsupported.length,
      excludedEntriesSeen: excluded.length,
      closedBoundariesSeen: closedBoundaries.length,
      unreadableDirectoriesSeen: unreadableDirectories.length,
      unavailableFilesSeen: 0,
      capped: truncated,
      omittedSupported: truncated ? null : 0,
      unsupportedExamples: examples(unsupported),
      excludedExamples: examples(excluded),
      closedBoundaries: examples(closedBoundaries),
      unreadableDirectories: examples(unreadableDirectories),
      unavailableFiles: [],
      excludedPolicies: excludedPolicies()
    }
  };
};
var statFile = async (root, rel) => {
  try {
    const s = await stat2(joinPath3(root, rel));
    if (!s.isFile()) return void 0;
    return { size: s.size, mtime: s.mtimeMs };
  } catch {
    return void 0;
  }
};
var statMany = async (root, files) => {
  const out = /* @__PURE__ */ new Map();
  await mapLimit(files, IO_CONCURRENCY, async (rel) => {
    const meta = await statFile(root, rel);
    if (meta) out.set(rel, meta);
  });
  return out;
};
var metaEquals = (a, b) => !!a && !!b && a.size === b.size && Math.abs(a.mtime - b.mtime) < 1e-6;
var sha1Of = async (root, rel) => {
  try {
    const buf = await readFile4(joinPath3(root, rel));
    return { sha1: createHash3("sha1").update(buf).digest("hex"), text: buf.toString("utf8") };
  } catch {
    return void 0;
  }
};
var TEXT_RETAIN_TOTAL = 16 * 1024 * 1024;
var TEXT_RETAIN_FILE = 128 * 1024;
var makeTextBudget = () => {
  let used = 0;
  return (rel, text, into) => {
    if (text.length > TEXT_RETAIN_FILE || used + text.length > TEXT_RETAIN_TOTAL) return;
    into.set(rel, text);
    used += text.length;
  };
};
var newFactStore = (root) => ({
  root,
  facts: /* @__PURE__ */ new Map(),
  meta: /* @__PURE__ */ new Map(),
  tainted: /* @__PURE__ */ new Set(),
  failedSha: /* @__PURE__ */ new Map(),
  unreadable: /* @__PURE__ */ new Set(),
  oversized: /* @__PURE__ */ new Set(),
  generated: /* @__PURE__ */ new Set(),
  rulesSha: "",
  enrolled: /* @__PURE__ */ new Set(),
  savedAt: 0
});
var emptyFileFacts = (sha12) => ({
  sha1: sha12,
  symbols: [],
  imports: [],
  calls: [],
  literals: [],
  anchors: []
});
var pendingFileFacts = (file, sha12, text) => {
  const facts = emptyFileFacts(sha12);
  const language = langOf(file);
  if (!language || language === "Bend") return facts;
  const sigs = harvestFile(language, text);
  if (Object.keys(sigs).length) facts.sigs = sigs;
  return facts;
};
var cachePathFor = (root) => joinPath3(privateTmpdir(), `pi-fovea-${createHash3("sha1").update(root).digest("hex").slice(0, 16)}.json`);
var loadDiskStore = async (root) => {
  void maintainTempStorage();
  const handle = await openTempRead(cachePathFor(root)).catch(() => void 0);
  if (!handle) return void 0;
  const stream = handle.createReadStream({ encoding: "utf8", end: CACHE_FILE_MAX_BYTES - 1 });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let store;
  let count = 0;
  try {
    for await (const line of lines) {
      if (!store) {
        let header;
        try {
          header = JSON.parse(line);
        } catch {
          return void 0;
        }
        if (header.fovea !== CACHE_VERSION || header.root !== root) return void 0;
        store = newFactStore(root);
        store.rulesSha = header.rulesSha;
        if (Array.isArray(header.enrolled)) {
          for (const b of header.enrolled) if (typeof b === "string") store.enrolled.add(b);
        }
        continue;
      }
      if (!line) continue;
      try {
        const rec = JSON.parse(line);
        store.meta.set(rec.file, { size: rec.size, mtime: rec.mtime });
        if (rec.generated) store.generated.add(rec.file);
        if (rec.failed) {
          store.tainted.add(rec.file);
          store.failedSha.set(rec.file, rec.sha1);
        } else if (rec.facts) {
          store.facts.set(rec.file, { sha1: rec.sha1, ...rec.facts });
        }
      } catch {
      }
      if (++count % 2e3 === 0) await yieldToLoop();
    }
    return store;
  } catch {
    return void 0;
  } finally {
    lines.close();
    stream.destroy();
  }
};
var persistDebounce = owned("build.ts:persistDebounce", () => /* @__PURE__ */ new Map());
var persistFacts = async (store) => {
  const header = JSON.stringify({
    fovea: CACHE_VERSION,
    root: store.root,
    rulesSha: store.rulesSha,
    enrolled: [...store.enrolled].sort()
  });
  const target = cachePathFor(store.root);
  async function* chunks() {
    let batch = header + "\n";
    let count = 0;
    const files = /* @__PURE__ */ new Set([...store.facts.keys(), ...store.failedSha.keys()]);
    for (const file of files) {
      const facts = store.facts.get(file);
      const meta = store.meta.get(file);
      if (!meta) continue;
      let line;
      if (store.tainted.has(file)) {
        const sha12 = store.failedSha.get(file) ?? facts?.sha1;
        if (sha12) line = { file, sha1: sha12, size: meta.size, mtime: meta.mtime, failed: true };
      } else if (facts) {
        const { sha1: sha12, ...rest } = facts;
        line = { file, sha1: sha12, size: meta.size, mtime: meta.mtime, facts: rest };
      }
      if (!line) continue;
      if (store.generated.has(file)) line.generated = true;
      batch += JSON.stringify(line) + "\n";
      if (batch.length >= 1024 * 1024) {
        yield batch;
        batch = "";
        await yieldToLoop();
      } else if (++count % 2e3 === 0) {
        await yieldToLoop();
      }
    }
    if (batch) yield batch;
  }
  try {
    await writeAtomicTemp(target, chunks());
    store.savedAt = Date.now();
  } catch {
  }
};
var readEnrolledBoundaries = async (root) => {
  void maintainTempStorage();
  const handle = await openTempRead(cachePathFor(root)).catch(() => void 0);
  if (!handle) return [];
  const stream = handle.createReadStream({ encoding: "utf8", end: CACHE_FILE_MAX_BYTES - 1 });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const header = JSON.parse(line);
      if (header.fovea !== CACHE_VERSION || header.root !== root) return [];
      return Array.isArray(header.enrolled) ? header.enrolled.filter((b) => typeof b === "string") : [];
    }
    return [];
  } catch {
    return [];
  } finally {
    lines.close();
    stream.destroy();
  }
};
var clearPersistTimer = (root) => {
  const timer = persistDebounce.get(root);
  if (timer) clearTimeout(timer);
  persistDebounce.delete(root);
};
var filterSupported = (files, routeRes) => files.filter((f) => supported(f, routeRes) && !isJunk(f));
var persistFactsSoon = (_store) => {
};
var EXTRACTION_BATCH = AST_GREP_CHUNK;
var extractInto = async (root, store, files, contents, packRules) => {
  if (!files.length) return;
  const source = makeFileSource(root, contents);
  const putByFile = (arr, pick) => {
    for (const v of arr) {
      const rec = store.facts.get(v.file);
      if (rec) pick(rec).push(v);
    }
  };
  const batches = [];
  for (let start = 0; start < files.length; start += EXTRACTION_BATCH) {
    batches.push(files.slice(start, start + EXTRACTION_BATCH));
  }
  const extracted = await mapLimit(batches, SPAWN_CONCURRENCY, async (batch) => {
    const code = batch.filter((f) => !isConfigFile(f));
    const anchorPlan = anchorScanPlan(code, packRules.pack);
    const rules = [...coreScanRules(code), ...anchorPlan.rules];
    const [symbols, scanned, fileRouteAnchors, protocolAnchors] = await Promise.all([
      extractSymbols(code, root, source),
      scanRules(rules, code, root),
      extractFileRoutes(code, root, packRules.fileRoutes, source),
      extractProtocolAnchors(batch, source)
    ]);
    const symsByFile = /* @__PURE__ */ new Map();
    for (const rel of code) symsByFile.set(rel, []);
    for (const symbol of symbols) symsByFile.get(symbol.file)?.push(symbol);
    const enclosingId = (file, line) => {
      const syms = symsByFile.get(file) ?? [];
      let best;
      for (const symbol of syms) {
        if (symbol.line <= line && (!best || symbol.line > best.line)) best = symbol;
      }
      return best ? `${best.name}@${best.file}` : `file:${file}`;
    };
    let imports;
    let calls;
    let literals;
    let anchors;
    if (scanned !== void 0) {
      const core = await coreFactsFromScan(batch, root, source, scanned);
      imports = core.imports;
      calls = core.calls;
      literals = core.literals;
      anchors = anchorsFromScan(scanned, anchorPlan, enclosingId);
    } else {
      [imports, calls, literals, anchors] = await Promise.all([
        extractImports(code, root, source),
        extractCalls(code, root, source),
        extractLiterals(batch, root, source),
        extractAnchors(code, root, enclosingId, packRules.pack)
      ]);
    }
    return { batch, symbols, imports, calls, literals, anchors, fileRouteAnchors, protocolAnchors };
  });
  for (const result of extracted) {
    for (const f of result.batch) {
      const prev = store.facts.get(f);
      store.facts.set(f, {
        sha1: prev?.sha1 ?? "",
        symbols: [],
        imports: [],
        calls: [],
        literals: [],
        anchors: [],
        ...prev?.sigs ? { sigs: prev.sigs } : {}
      });
    }
    putByFile(result.symbols, (f) => f.symbols);
    putByFile(result.imports, (f) => f.imports);
    putByFile(result.calls, (f) => f.calls);
    putByFile(result.literals, (f) => f.literals);
    putByFile(result.anchors, (f) => f.anchors);
    putByFile(result.fileRouteAnchors, (f) => f.anchors);
    putByFile(result.protocolAnchors, (f) => f.anchors);
    await yieldToLoop();
  }
};
var runAnchorPass = async (root, store, files, packRules, source = makeFileSource(root)) => {
  const batches = [];
  for (let start = 0; start < files.length; start += EXTRACTION_BATCH) {
    const batch = files.slice(start, start + EXTRACTION_BATCH).filter((file) => !isConfigFile(file));
    if (batch.length) batches.push(batch);
  }
  const extracted = await mapLimit(batches, SPAWN_CONCURRENCY, async (anchorFiles) => {
    const symsByFile = /* @__PURE__ */ new Map();
    for (const rel of anchorFiles) symsByFile.set(rel, store.facts.get(rel)?.symbols ?? []);
    const enclosingId = (file, line) => {
      const syms = symsByFile.get(file) ?? [];
      let best;
      for (const symbol of syms) {
        if (symbol.line <= line && (!best || symbol.line > best.line)) best = symbol;
      }
      return best ? `${best.name}@${best.file}` : `file:${file}`;
    };
    const [anchors, fileRouteAnchors] = await Promise.all([
      extractAnchors(anchorFiles, root, enclosingId, packRules.pack),
      extractFileRoutes(anchorFiles, root, packRules.fileRoutes, source)
    ]);
    return { anchorFiles, anchors, fileRouteAnchors };
  });
  for (const result of extracted) {
    for (const file of result.anchorFiles) {
      const previous = store.facts.get(file);
      if (previous?.anchors.length) store.facts.set(file, { ...previous, anchors: [] });
    }
    for (const anchor2 of result.anchors) store.facts.get(anchor2.file)?.anchors.push(anchor2);
    for (const anchor2 of result.fileRouteAnchors) store.facts.get(anchor2.file)?.anchors.push(anchor2);
    await yieldToLoop();
  }
};
var resolveRulePack = (store, base) => {
  const sigsByFile = {};
  for (const [file, facts] of store.facts) sigsByFile[file] = facts.sigs;
  const implicitRules = promote(aggregateFiles(sigsByFile), base.pack);
  const pack = implicitRules.length ? [...base.pack, ...implicitRules] : base.pack;
  const sha = implicitRules.length ? createHash3("sha1").update(base.sha).update(JSON.stringify(implicitRules.map((rule) => rule.id).sort())).digest("hex") : base.sha;
  const previousSha = store.rulesSha;
  store.rulesSha = sha;
  return { pack, fileRoutes: base.fileRoutes, sha, previousSha };
};
var reanchorStaleClean = async (root, store, files, dirty, active2) => {
  if (active2.sha === active2.previousSha) return;
  const dirtySet = new Set(dirty);
  const stale = files.filter(
    (file) => !dirtySet.has(file) && !isConfigFile(file) && !store.generated.has(file) && store.facts.has(file)
  );
  if (stale.length) await runAnchorPass(root, store, stale, active2);
};
var settleTaint = (store, batch) => {
  const failures2 = drainExtractionFailures();
  const failed = new Set(failures2.flatMap((f) => f.files));
  for (const f of failed) {
    if (!batch.has(f)) continue;
    store.tainted.add(f);
    const sha12 = store.facts.get(f)?.sha1;
    if (sha12) store.failedSha.set(f, sha12);
  }
};
var clearTaint = (store, batch) => {
  for (const f of batch) {
    store.tainted.delete(f);
    store.failedSha.delete(f);
  }
};
var loadFacts = async (root, files) => {
  drainExtractionFailures();
  const disk = await loadDiskStore(root);
  const store = disk ?? newFactStore(root);
  let cacheDirty = disk === void 0;
  const fileSet = new Set(files);
  const knownFiles = /* @__PURE__ */ new Set([...store.facts.keys(), ...store.failedSha.keys(), ...store.unreadable, ...store.oversized]);
  for (const f of knownFiles) {
    if (!fileSet.has(f)) {
      store.facts.delete(f);
      store.meta.delete(f);
      store.tainted.delete(f);
      store.failedSha.delete(f);
      store.unreadable.delete(f);
      store.oversized.delete(f);
      store.generated.delete(f);
      cacheDirty = true;
    }
  }
  const stats = await statMany(root, files);
  const needHashed = [];
  const unreadable = [];
  const oversized = [];
  for (const rel of files) {
    const meta = stats.get(rel);
    if (!meta) {
      unreadable.push(rel);
      continue;
    }
    if (meta.size > maxFileBytes(rel)) {
      oversized.push(rel);
      if (store.facts.delete(rel)) cacheDirty = true;
      store.meta.set(rel, meta);
      store.tainted.delete(rel);
      store.failedSha.delete(rel);
      store.unreadable.delete(rel);
      store.generated.delete(rel);
      continue;
    }
    store.oversized.delete(rel);
    const cachedMeta = store.meta.get(rel);
    if (store.failedSha.has(rel) && metaEquals(meta, cachedMeta)) {
      store.meta.set(rel, meta);
      continue;
    }
    if (store.facts.has(rel) && metaEquals(meta, cachedMeta) && !store.tainted.has(rel)) {
      store.meta.set(rel, meta);
      continue;
    }
    needHashed.push(rel);
  }
  const contents = /* @__PURE__ */ new Map();
  const dirty = [];
  const spend = makeTextBudget();
  await forEachOrderedBatch(needHashed, IO_CONCURRENCY, (rel) => sha1Of(root, rel), (got, rel) => {
    const meta = stats.get(rel);
    if (!got) {
      unreadable.push(rel);
      return;
    }
    spend(rel, got.text, contents);
    if (isGeneratedSource(rel, got.text)) {
      store.generated.add(rel);
      store.tainted.delete(rel);
      store.failedSha.delete(rel);
      store.meta.set(rel, meta);
      store.facts.set(rel, emptyFileFacts(got.sha1));
      cacheDirty = true;
      return;
    }
    store.generated.delete(rel);
    const failedSha = store.failedSha.get(rel);
    if (failedSha === got.sha1) {
      store.meta.set(rel, meta);
      cacheDirty = true;
      return;
    }
    const cached = store.facts.get(rel);
    if (cached && cached.sha1 === got.sha1 && !store.tainted.has(rel)) {
      store.meta.set(rel, meta);
      cacheDirty = true;
      return;
    }
    dirty.push(rel);
    cacheDirty = true;
    store.meta.set(rel, meta);
    store.facts.set(rel, pendingFileFacts(rel, got.sha1, got.text));
  });
  const active2 = resolveRulePack(store, await loadRepoRules(root));
  clearTaint(store, dirty);
  await extractInto(root, store, dirty, contents, active2);
  settleTaint(store, new Set(files));
  await reanchorStaleClean(root, store, files, dirty, active2);
  settleTaint(store, new Set(files));
  if (active2.sha !== active2.previousSha) cacheDirty = true;
  for (const f of unreadable) {
    store.unreadable.add(f);
    if (store.facts.delete(f)) cacheDirty = true;
    if (store.meta.delete(f)) cacheDirty = true;
    store.oversized.delete(f);
    store.generated.delete(f);
    store.failedSha.delete(f);
  }
  for (const f of oversized) store.oversized.add(f);
  store.unreadable.forEach((f) => {
    if (!unreadable.includes(f) && files.includes(f)) store.unreadable.delete(f);
  });
  store.oversized.forEach((f) => {
    if (!oversized.includes(f) && files.includes(f)) store.oversized.delete(f);
  });
  if (cacheDirty) await persistFacts(store);
  return {
    store,
    report: {
      failed: [...store.tainted].sort(),
      unreadable: [...new Set(unreadable)].sort(),
      oversized: [...store.oversized].sort(),
      generated: [...store.generated].sort()
    },
    dirty: dirty.sort()
  };
};
var refreshFacts = async (root, store, files, changed, deletedPaths = []) => {
  drainExtractionFailures();
  const fileSet = new Set(files);
  const deleted = [];
  const removeFile = (known) => {
    store.facts.delete(known);
    store.meta.delete(known);
    store.tainted.delete(known);
    store.failedSha.delete(known);
    store.unreadable.delete(known);
    store.oversized.delete(known);
    store.generated.delete(known);
    deleted.push(known);
  };
  const knownFiles = /* @__PURE__ */ new Set([...store.facts.keys(), ...store.failedSha.keys(), ...store.unreadable, ...store.oversized]);
  for (const known of knownFiles) {
    if (!fileSet.has(known)) removeFile(known);
  }
  for (const gone of deletedPaths) {
    if ((store.facts.has(gone) || store.failedSha.has(gone) || store.unreadable.has(gone) || store.oversized.has(gone)) && !deleted.includes(gone)) removeFile(gone);
  }
  const added = files.filter((f) => !knownFiles.has(f));
  const candidates = /* @__PURE__ */ new Set([...changed, ...added]);
  for (const gone of deleted) candidates.delete(gone);
  for (const f of store.tainted) if (fileSet.has(f)) candidates.add(f);
  const stats = await statMany(root, [...candidates]);
  const contents = /* @__PURE__ */ new Map();
  const spend = makeTextBudget();
  const dirty = [];
  const unreadable = [];
  const oversized = [];
  for (const rel of candidates) {
    const meta = stats.get(rel);
    if (!meta) {
      unreadable.push(rel);
      continue;
    }
    const cachedMeta = store.meta.get(rel);
    if (store.failedSha.has(rel) && metaEquals(meta, cachedMeta)) continue;
    store.meta.set(rel, meta);
    if (meta.size > maxFileBytes(rel)) {
      oversized.push(rel);
      store.facts.delete(rel);
      store.tainted.delete(rel);
      store.failedSha.delete(rel);
      store.unreadable.delete(rel);
      store.generated.delete(rel);
      continue;
    }
    store.oversized.delete(rel);
    const got = await sha1Of(root, rel);
    if (!got) {
      unreadable.push(rel);
      continue;
    }
    store.unreadable.delete(rel);
    spend(rel, got.text, contents);
    if (isGeneratedSource(rel, got.text)) {
      store.generated.add(rel);
      store.tainted.delete(rel);
      store.failedSha.delete(rel);
      store.facts.set(rel, emptyFileFacts(got.sha1));
      continue;
    }
    store.generated.delete(rel);
    if (store.failedSha.get(rel) === got.sha1) continue;
    const prev = store.facts.get(rel);
    if (prev && prev.sha1 === got.sha1 && !store.tainted.has(rel)) continue;
    dirty.push(rel);
    store.facts.set(rel, pendingFileFacts(rel, got.sha1, got.text));
  }
  const active2 = resolveRulePack(store, await loadRepoRules(root));
  clearTaint(store, dirty);
  await extractInto(root, store, dirty, contents, active2);
  settleTaint(store, candidates);
  await reanchorStaleClean(root, store, files, dirty, active2);
  settleTaint(store, new Set(files));
  for (const f of unreadable) {
    store.unreadable.add(f);
    store.facts.delete(f);
    store.meta.delete(f);
    store.oversized.delete(f);
    store.generated.delete(f);
    store.failedSha.delete(f);
  }
  for (const f of oversized) store.oversized.add(f);
  persistFactsSoon(store);
  return {
    report: {
      failed: [...store.tainted].sort(),
      unreadable: [...store.unreadable].sort(),
      oversized: [...store.oversized].sort(),
      generated: [...store.generated].sort()
    },
    stats: {
      reExtracted: dirty.sort(),
      deleted: deleted.sort(),
      added: added.filter((f) => !unreadable.includes(f) && !store.oversized.has(f) && !store.generated.has(f) && !store.tainted.has(f)).sort()
    }
  };
};

// src/fovea/core/state.ts
var states = owned("state.ts:states", () => /* @__PURE__ */ new Map());
var inflight = owned("state.ts:inflight", () => /* @__PURE__ */ new Map());
var WALK_GAP_MS = envInt("FOVEA_WALK_GAP_MS", 4e3, 500, 3e5);
var SWEEP_GAP_MS = envInt("FOVEA_SWEEP_GAP_MS", 2e4, 2e3, 6e5);
var touch = (root) => {
  const st = states.get(root);
  if (st) {
    states.delete(root);
    states.set(root, st);
  }
  return st;
};
var evictLru = () => {
  while (states.size > ROOT_CACHE_LIMIT) {
    const oldest = states.keys().next().value;
    states.delete(oldest);
    inflight.delete(oldest);
    clearPersistTimer(oldest);
  }
};
var getState = (root) => touch(root);
var getInflight = (root) => inflight.get(root);
var chain = owned("factChain", () => ({ value: Promise.resolve() }));
var factPass = (job) => {
  const run2 = chain.value.then(job, job);
  chain.value = run2.then(
    () => void 0,
    () => void 0
  );
  return run2;
};
var graphGeneration = (graph) => {
  const hash = createHash4("sha1");
  for (const node of graph.nodes) {
    hash.update(JSON.stringify([node.id, node.kind, node.file, node.line, node.lang, node.sig])).update("\0");
  }
  for (const edge of graph.edges) {
    hash.update(JSON.stringify([edge.a, edge.b, edge.kind, edge.w, edge.evidence])).update("\n");
  }
  return hash.digest("hex").slice(0, 12);
};
var stateVersion = (facts, generation, files, rulesSha, extraction, discovery) => createHash4("sha1").update(Object.entries(facts).map(([file, value]) => `${file}:${value.sha1}`).sort().join("\n")).update("\0").update(files.join("\n")).update("\0").update(rulesSha).update("\0").update(generation).update("\0").update(JSON.stringify(extraction)).update("\0").update(JSON.stringify(discovery)).digest("hex").slice(0, 12);
var assembleState = async (root, files, store, extraction, discovery, gitKind, head, dirty) => {
  const facts = {};
  for (const [k, v] of store.facts) facts[k] = v;
  await yieldToLoop();
  const { graph, joinIndex } = await assembleGraphWithIndex(root, files, store.facts);
  const generation = graphGeneration(graph);
  const version = stateVersion(facts, generation, files, store.rulesSha, extraction, discovery);
  await yieldToLoop();
  const csr = buildCsr(graph);
  await yieldToLoop();
  const adjacency = /* @__PURE__ */ new Map();
  for (const edge of graph.edges) {
    (adjacency.get(edge.a) ?? adjacency.set(edge.a, []).get(edge.a)).push({
      to: edge.b,
      kind: edge.kind,
      w: edge.w,
      evidence: edge.evidence
    });
    (adjacency.get(edge.b) ?? adjacency.set(edge.b, []).get(edge.b)).push({
      to: edge.a,
      kind: edge.kind,
      w: edge.w,
      evidence: edge.evidence
    });
  }
  for (const list of adjacency.values()) {
    list.sort((a, b) => Number(a.kind === "contains") - Number(b.kind === "contains") || b.w - a.w || a.to - b.to);
  }
  const history = await coChangeHistory(root, files);
  const stamp = Date.now();
  return { root, version, generation, graph, csr, joinIndex, facts, extraction, discovery, adjacency, store, files, gitKind, head, dirty, history, probedAt: stamp, walkedAt: stamp, sweptAt: stamp };
};
var requireExtractionBackend = async (files) => {
  const needed = files.some((file) => {
    const language = langOf(file);
    return language !== void 0 && language !== "Bend";
  });
  if (needed && !await hasAstGrepAsync()) {
    throw new Error(
      "fovea: managed parser unavailable"
    );
  }
};
var buildState = async (root) => {
  const { fileRoutes } = await loadRepoRules(root);
  const routeRes = fileRoutes.map((r) => new RegExp(r.re));
  const probe = await gitProbe(root);
  const gitKind = probe ? "git" : "plain";
  const listing = await discoverFiles(root, routeRes, new Set(await readEnrolledBoundaries(root)));
  const files = listing.files;
  await requireExtractionBackend(files);
  const { store, report } = await factPass(() => loadFacts(root, files));
  return assembleState(
    root,
    files,
    store,
    report,
    listing.report,
    gitKind,
    probe?.head,
    new Set(probe ? probe.changes.map((c) => c.path).filter((p) => p && !p.endsWith("/")) : [])
  );
};
var refreshState = async (state, hints = [], force = false) => {
  const now = Date.now();
  const { fileRoutes } = await loadRepoRules(state.root);
  const routeRes = fileRoutes.map((r) => new RegExp(r.re));
  const store = state.store;
  let files = state.files;
  let discovery = state.discovery;
  const changed = [];
  const deleted = [];
  let checkout = false;
  const hinted = [.../* @__PURE__ */ new Set([...filterSupported(hints, routeRes), ...hints.filter((h) => store.facts.has(h))])];
  changed.push(...hinted);
  let disclosureChanged = false;
  for (const boundary of [...store.enrolled]) {
    const exists = await stat3(join4(state.root, boundary, ".git")).then(() => true, () => false);
    if (!exists) {
      store.enrolled.delete(boundary);
      disclosureChanged = true;
    }
  }
  let known;
  for (const h of hinted) {
    let covered = false;
    for (const b of store.enrolled) {
      if (h.startsWith(b + "/")) {
        covered = true;
        break;
      }
    }
    if (!covered) {
      known ??= new Set(state.files);
      covered = known.has(h);
    }
    if (covered) continue;
    let prefix = "";
    for (const seg of h.split("/").slice(0, -1)) {
      prefix = prefix ? `${prefix}/${seg}` : seg;
      if (store.enrolled.has(prefix)) continue;
      const boundary = await stat3(join4(state.root, prefix, ".git")).then(() => true, () => false);
      if (!boundary) continue;
      store.enrolled.add(prefix);
      disclosureChanged = true;
    }
  }
  if (state.gitKind === "git") {
    const probe = await gitProbe(state.root);
    if (probe) {
      const headMoved = probe.head !== state.head;
      state.head = probe.head;
      if (headMoved) {
        checkout = (await gitReflogAction(state.root))?.startsWith("checkout:") ?? false;
      }
      const statusPaths = new Set(probe.changes.map((change) => change.path).filter(Boolean));
      const dirtyPathRemoved = [...state.dirty].some((path) => !statusPaths.has(path));
      const membershipPathAdded = probe.changes.some((change) => !state.dirty.has(change.path) && /[?ADRCT]/.test(change.code));
      const ignoreRulesChanged = probe.changes.some((change) => change.path === ".gitignore" || change.path.endsWith("/.gitignore") || change.path === ".gitmodules");
      let needsList = probe.relist || disclosureChanged || headMoved || dirtyPathRemoved || membershipPathAdded || ignoreRulesChanged || probe.changes.some((change) => change.path.endsWith("/"));
      if (probe.changes.length) {
        const dirFlags = await Promise.all(
          probe.changes.map((c) => !c.path.endsWith("/") && stat3(join4(state.root, c.path)).then((s) => s.isDirectory(), () => false))
        );
        probe.changes.forEach((c, i) => {
          if (!dirFlags[i]) return;
          needsList = true;
          if (!store.enrolled.has(c.path)) {
            store.enrolled.add(c.path);
            disclosureChanged = true;
          }
        });
      }
      if (needsList) {
        const listing = await discoverFiles(state.root, routeRes, store.enrolled);
        files = listing.files;
        discovery = listing.report;
        const listed = new Set(files);
        for (const previous of state.files) if (!listed.has(previous)) deleted.push(previous);
        changed.push(...files);
      } else {
        if (headMoved) changed.push(...state.files);
        for (const c of probe.changes) {
          const p = c.path;
          if (!p || p.endsWith("/")) continue;
          if (c.code.includes("D")) {
            if (store.facts.has(p) || store.failedSha.has(p)) deleted.push(p);
          } else if (store.facts.has(p) || filterSupported([p], routeRes).length) {
            changed.push(p);
          }
        }
      }
      const nowDirty = new Set([...statusPaths].filter((path) => !path.endsWith("/")));
      if (!headMoved && !needsList) {
        for (const p of state.dirty) {
          if (nowDirty.has(p)) continue;
          const onDisk = await stat3(join4(state.root, p)).then((s) => s.isFile(), () => false);
          if (onDisk) changed.push(p);
          else if (store.facts.has(p) || store.failedSha.has(p)) deleted.push(p);
        }
      }
      state.dirty = nowDirty;
    } else {
      state.gitKind = "plain";
    }
  }
  if (state.gitKind === "plain") {
    const walkDue = now - state.walkedAt > WALK_GAP_MS;
    if (force || walkDue || changed.length || disclosureChanged) {
      const listing = await discoverFiles(state.root, routeRes, store.enrolled);
      files = listing.files;
      discovery = listing.report;
      state.walkedAt = now;
      if (force || now - state.sweptAt > SWEEP_GAP_MS) {
        state.sweptAt = now;
        changed.push(...state.files);
      }
    }
  }
  if (!changed.length && !deleted.length && files === state.files) {
    state.probedAt = Date.now();
    return state;
  }
  await requireExtractionBackend(files);
  const { report, stats } = await factPass(
    () => refreshFacts(state.root, store, files, [...new Set(changed)], [...new Set(deleted)])
  );
  const noDelta = !stats.reExtracted.length && !stats.deleted.length && !stats.added.length && files.length === state.files.length;
  if (noDelta) {
    state.probedAt = Date.now();
    state.extraction = report;
    state.discovery = discovery;
    state.files = files;
    state.version = stateVersion(state.facts, state.generation, files, store.rulesSha, report, discovery);
    return state;
  }
  const fresh = await assembleState(state.root, files, store, report, discovery, state.gitKind, state.head, state.dirty);
  if (checkout) fresh.checkout = true;
  states.set(state.root, fresh);
  return fresh;
};
var ensureState = (root, opts = {}) => {
  const pending = inflight.get(root);
  if (pending) return pending;
  const warm = touch(root);
  const p = warm ? refreshState(warm, opts.hints, opts.force) : (async () => {
    const st = await stat3(root).catch(() => void 0);
    if (!st?.isDirectory()) throw new Error(`fovea: root does not exist or is not a directory: ${root}`);
    const state = await buildState(root);
    states.set(root, state);
    evictLru();
    return state;
  })();
  inflight.set(root, p);
  const clear = () => {
    if (inflight.get(root) === p) inflight.delete(root);
  };
  p.then(clear, clear);
  return p;
};
var relativeRequest = (root, input) => {
  const raw = input.startsWith("@") ? input.slice(1) : input;
  const rootPath = resolve3(root);
  const absolute = isAbsolute2(raw) ? resolve3(raw) : resolve3(rootPath, raw);
  const rel = relative2(rootPath, absolute);
  if (!rel || rel === "." || rel === ".." || rel.startsWith(`..${sep2}`) || isAbsolute2(rel)) return void 0;
  return rel.split(sep2).join("/");
};
var explainPathCoverage = async (state, requested) => {
  const { fileRoutes } = await loadRepoRules(state.root);
  const routeRes = fileRoutes.map((rule) => new RegExp(rule.re));
  const indexed = new Set(state.files);
  const failed = new Set(state.extraction.failed);
  const unreadable = new Set(state.extraction.unreadable);
  const oversized = new Set(state.extraction.oversized);
  const generated = new Set(state.extraction.generated);
  const out = [];
  for (const input of requested) {
    const rel = relativeRequest(state.root, input);
    if (!rel) {
      out.push({ requested: input, status: "outside-root", reason: "path does not name a file inside the repository root" });
      continue;
    }
    const closed = state.discovery.closedBoundaries.find((boundary) => rel === boundary || rel.startsWith(`${boundary}/`));
    if (closed) {
      out.push({ requested: input, path: rel, status: "closed-boundary", reason: `nested repository ${closed} is not enrolled or readable` });
      continue;
    }
    const unreadableDirectory = state.discovery.unreadableDirectories.find((directory) => directory === "." || rel === directory || rel.startsWith(`${directory}/`));
    if (unreadableDirectory) {
      out.push({ requested: input, path: rel, status: "unreadable", reason: `discovery could not traverse ${unreadableDirectory}` });
      continue;
    }
    if (state.discovery.unavailableFiles.includes(rel)) {
      out.push({ requested: input, path: rel, status: "unavailable", reason: "Git listed the path but the worktree entry was unavailable" });
      continue;
    }
    const onDisk = await stat3(join4(state.root, rel)).catch(() => void 0);
    if (!onDisk) {
      out.push({ requested: input, path: rel, status: "missing", reason: "path does not exist in this worktree" });
      continue;
    }
    if (!onDisk.isFile()) {
      out.push({ requested: input, path: rel, status: "not-file", reason: "path is not a regular file" });
      continue;
    }
    if (failed.has(rel)) {
      out.push({ requested: input, path: rel, status: "partial", reason: "one or more extraction stages failed for this file" });
      continue;
    }
    if (unreadable.has(rel)) {
      out.push({ requested: input, path: rel, status: "unreadable", reason: "file could not be read during extraction" });
      continue;
    }
    if (oversized.has(rel)) {
      out.push({ requested: input, path: rel, status: "oversized", reason: "file exceeds the byte cap for its type (FOVEA_MAX_FILE_BYTES or FOVEA_MAX_PROTO_FILE_BYTES)" });
      continue;
    }
    if (generated.has(rel)) {
      out.push({ requested: input, path: rel, status: "generated", reason: "file was classified as machine-generated source" });
      continue;
    }
    if (indexed.has(rel)) {
      out.push({ requested: input, path: rel, status: "indexed", reason: "file is present in this graph generation" });
      continue;
    }
    const exclusion = discoveryExclusionReason(rel);
    if (exclusion) {
      out.push({ requested: input, path: rel, status: "excluded", reason: exclusion });
      continue;
    }
    if (!filterSupported([rel], routeRes).length) {
      out.push({ requested: input, path: rel, status: "unsupported", reason: "file type has no structural or protocol extractor" });
      continue;
    }
    let prefix = "";
    let closedBoundary;
    for (const segment of rel.split("/").slice(0, -1)) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      if (state.store.enrolled.has(prefix)) continue;
      const marker = await stat3(join4(state.root, prefix, ".git")).then(() => true, () => false);
      if (marker) {
        closedBoundary = prefix;
        break;
      }
    }
    if (closedBoundary) {
      out.push({ requested: input, path: rel, status: "closed-boundary", reason: `nested repository ${closedBoundary} is not enrolled` });
      continue;
    }
    if (state.gitKind === "git") {
      const ignored = await gitOut(state.root, ["check-ignore", "--", rel]);
      if (ignored?.trim()) {
        out.push({ requested: input, path: rel, status: "excluded", reason: "excluded by Git ignore rules" });
        continue;
      }
    }
    if (state.discovery.capped) {
      const omitted = state.discovery.omittedSupported;
      out.push({
        requested: input,
        path: rel,
        status: "omitted",
        reason: omitted === null ? `discovery stopped at FOVEA_MAX_FILES=${state.discovery.maxFiles}` : `omitted by FOVEA_MAX_FILES=${state.discovery.maxFiles} (${omitted} supported files omitted)`
      });
      continue;
    }
    out.push({ requested: input, path: rel, status: "not-indexed", reason: "file was outside the current discovery snapshot" });
  }
  return out;
};
var ensureStateBackground = (root) => {
  if (states.has(root) || inflight.has(root)) {
    return { started: false, promise: ensureState(root) };
  }
  return { started: true, promise: ensureState(root) };
};

// src/fovea/core/ops.ts
var extractionSuffix = (state) => {
  const parts = [];
  if (state.discovery.capped) {
    const omitted = state.discovery.omittedSupported;
    parts.push(omitted === null ? `!file cap ${state.discovery.maxFiles} reached` : `!file cap omitted ${omitted}`);
  }
  if (state.discovery.unreadableDirectoriesSeen) {
    parts.push(`!${state.discovery.unreadableDirectoriesSeen} directories unreadable`);
  }
  if (state.discovery.closedBoundariesSeen) {
    parts.push(`!${state.discovery.closedBoundariesSeen} nested boundaries closed`);
  }
  if (state.discovery.unavailableFilesSeen) {
    parts.push(`!${state.discovery.unavailableFilesSeen} listed files unavailable`);
  }
  if (state.extraction.failed.length) parts.push(`!${state.extraction.failed.length} files failed extraction`);
  if (state.extraction.unreadable.length) parts.push(`!${state.extraction.unreadable.length} files unreadable`);
  if (state.extraction.oversized.length) parts.push(`!${state.extraction.oversized.length} files over size cap`);
  if (state.extraction.generated.length) parts.push(`!${state.extraction.generated.length} generated files skipped`);
  return parts.length ? ` \xB7 ${parts.join(", ")}` : "";
};
var extractionDetails = (state) => ({
  version: state.version,
  generation: state.generation,
  coverage: {
    ...state.discovery,
    extractedFiles: Object.keys(state.facts).length,
    partialFiles: state.extraction.failed.slice(0, 20),
    unreadableFiles: state.extraction.unreadable,
    oversizedFiles: state.extraction.oversized,
    generatedFiles: state.extraction.generated,
    ...state.graph.importCoverage ? { imports: {
      ...state.graph.importCoverage,
      unsupportedLanguages: [...state.graph.importCoverage.unsupportedLanguages],
      examples: state.graph.importCoverage.examples.map((example) => ({ ...example }))
    } } : {}
  },
  // Legacy flat fields remain additive compatibility for tool consumers.
  extractionFailures: state.extraction.failed.length,
  extractionFailedFiles: state.extraction.failed.slice(0, 20),
  extractionUnreadable: state.extraction.unreadable,
  extractionOversized: state.extraction.oversized,
  extractionGenerated: state.extraction.generated
});
var looksLikeRepoPath = (query) => {
  const value = query.trim();
  return !value.startsWith("/") && (value.startsWith("@") || value.startsWith("./") || value.includes("/") || /\.[A-Za-z0-9]+$/.test(value));
};
var QUERY_STOP_WORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "and",
  "are",
  "do",
  "does",
  "find",
  "for",
  "happen",
  "happens",
  "how",
  "in",
  "is",
  "of",
  "on",
  "please",
  "the",
  "this",
  "to",
  "what",
  "where",
  "which",
  "with"
]);
var stemIdentifier = (term) => {
  if (term.length > 5 && term.endsWith("ing")) return term.slice(0, -3);
  if (term.length > 4 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.length > 4 && /(ches|shes|sses|xes|zes)$/.test(term)) return term.slice(0, -2);
  if (term.length > 3 && term.endsWith("s") && !term.endsWith("ss")) return term.slice(0, -1);
  return term;
};
var identifierTerms = (value) => {
  const split = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 1 && !QUERY_STOP_WORDS.has(term)).map(stemIdentifier).filter((term) => !QUERY_STOP_WORDS.has(term));
  return [...new Set(split)];
};
var shortSymbolName = (name) => name.slice(name.lastIndexOf(".") + 1);
var diceSimilarity = (a, b) => {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const left = /* @__PURE__ */ new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const pair = a.slice(i, i + 2);
    left.set(pair, (left.get(pair) ?? 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const pair = b.slice(i, i + 2);
    const count = left.get(pair) ?? 0;
    if (count > 0) {
      overlap++;
      left.set(pair, count - 1);
    }
  }
  return 2 * overlap / (a.length + b.length - 2);
};
var normalizedNames = owned("ops.ts:normalizedNames", () => /* @__PURE__ */ new WeakMap());
var normalizedName = (node) => {
  let value = normalizedNames.get(node);
  if (!value || value.name !== node.name) {
    const terms = identifierTerms(shortSymbolName(node.name));
    value = { name: node.name, terms, set: new Set(terms) };
    normalizedNames.set(node, value);
  }
  return value;
};
var symbolSimilarity = (queryTerms, node) => {
  const { terms: candidateTerms, set: candidateSet } = normalizedName(node);
  const shared = queryTerms.filter((term) => candidateSet.has(term)).length;
  const coverage = queryTerms.length ? shared / queryTerms.length : 0;
  const precision = candidateTerms.length ? shared / candidateTerms.length : 0;
  const tokenScore = 0.72 * coverage + 0.28 * precision;
  const charScore = diceSimilarity(queryTerms.join(""), candidateTerms.join(""));
  return Math.max(tokenScore, charScore);
};
var sameIdentifierTerms = (queryTerms, node) => {
  const { terms: candidateTerms, set: candidateSet } = normalizedName(node);
  if (!queryTerms.length || queryTerms.length !== candidateTerms.length) return false;
  return queryTerms.every((term) => candidateSet.has(term));
};
var focusScope = (options) => {
  const pathScope = options.path?.replace(/^@/, "").replace(/^\.\//, "").replace(/\/$/, "");
  const language = options.language?.toLowerCase();
  const kind = options.kind;
  return (node) => (!pathScope || node.file === pathScope || node.file.startsWith(`${pathScope}/`)) && (!language || node.lang.toLowerCase() === language) && (!kind || node.kind === kind);
};
var resolveSeeds = (state, query, options = {}) => {
  const g = state.graph;
  const matches = focusScope(options);
  const allows = (idx) => matches(g.nodes[idx]);
  const scored = /* @__PURE__ */ new Map();
  const bump = (idx, s) => {
    if (!allows(idx)) return;
    scored.set(idx, Math.max(scored.get(idx) ?? 0, s));
  };
  const q = query.trim();
  let normalizedQuery;
  const queryTerms = () => normalizedQuery ??= identifierTerms(q);
  const terms = q.split(/\s+/).filter((t) => t.length > 1);
  const featureId = q.toLowerCase();
  const exactFeatures = g.nodes.map((node, index) => node.kind === "anchor" && node.name.toLowerCase() === featureId && allows(index) ? index : -1).filter((index) => index >= 0);
  if (exactFeatures.length) {
    return {
      seeds: exactFeatures,
      note: `${exactFeatures.length} exact feature ${exactFeatures.length === 1 ? "hub" : "hubs"}: ${q}`,
      suggestions: []
    };
  }
  const cls = classifyLiteral(q);
  if (cls) {
    const norm = normalizeLiteral(q, cls);
    for (const occ of state.joinIndex.byKey.get(norm)?.occ ?? []) bump(occ.node, 1);
    if (cls === "path") {
      const under = `${norm}/`;
      for (const [key, bucket] of state.joinIndex.byKey) {
        if (bucket.cls !== "path" || !key.startsWith(under)) continue;
        for (const occ of bucket.occ) bump(occ.node, 0.8);
      }
      state.graph.nodes.forEach((n, i) => {
        if (n.kind !== "anchor") return;
        const route = n.name.slice(n.name.indexOf(" ") + 1);
        if (route === norm || route.startsWith(under)) bump(i, 0.9);
      });
    }
  }
  for (const term of terms) {
    const key = term.toLowerCase();
    for (const idx of g.byName.get(key) ?? []) bump(idx, 1);
  }
  if (scored.size === 0) {
    const hay = [];
    g.nodes.forEach((n, i) => {
      if (n.kind !== "file" && n.kind !== "anchor") hay.push({ i, name: n.name.toLowerCase() });
    });
    for (const term of terms) {
      const key = term.toLowerCase();
      for (const { i, name } of hay) {
        if (name === key) bump(i, 1);
        else if (name.startsWith(key)) bump(i, 0.8);
        else if (name.includes(key)) bump(i, 0.5);
      }
    }
  }
  if (scored.size === 0) {
    g.nodes.forEach((node, i) => {
      if (node.kind !== "file" && node.kind !== "anchor" && sameIdentifierTerms(queryTerms(), node)) {
        bump(i, 0.7);
      }
    });
  }
  for (const f of g.files) {
    if (f === q || f.endsWith(`/${q}`)) {
      const arr = g.byFile.get(f) ?? [];
      if (arr[0] !== void 0) bump(arr[0], 1);
    }
  }
  const ranked = [...scored.entries()].sort((a, b) => b[1] - a[1] || g.nodes[a[0]].file.localeCompare(g.nodes[b[0]].file)).slice(0, 16);
  const seeds = ranked.map(([i]) => i);
  const names = ranked.slice(0, 4).map(([i, score]) => `${g.nodes[i].name}${score < 1 ? " (approximate)" : ""}`);
  const note = seeds.length ? `${seeds.length} match${seeds.length === 1 ? "" : "es"}: ${names.join(", ")}${seeds.length > 4 ? ", \u2026" : ""}` : "no graph match";
  const suggestions = seeds.length ? [] : g.nodes.flatMap((node, index) => {
    if (!allows(index) || node.kind === "file" || node.kind === "anchor") return [];
    const score = symbolSimilarity(queryTerms(), node);
    return score >= 0.34 ? [{ node, index, score }] : [];
  }).sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name) || a.node.file.localeCompare(b.node.file)).slice(0, 5).map(({ node, index, score }) => ({
    index,
    name: node.name,
    file: node.file,
    line: node.line,
    lineApproximate: node.lineApproximate,
    score
  }));
  return { seeds, note, suggestions };
};
var suggestedReads = (nodes) => {
  const out = [];
  for (const node of nodes) {
    if (node.line <= 0 || node.lineApproximate) continue;
    const offset = Math.max(1, node.line - 5);
    const end = offset + 24;
    const existing = out.find((read) => read.path === node.file && offset <= read.offset + read.limit && end + 1 >= read.offset);
    if (existing) {
      const mergedEnd = Math.max(existing.offset + existing.limit - 1, end);
      existing.offset = Math.min(existing.offset, offset);
      existing.limit = mergedEnd - existing.offset + 1;
      if (node.role === "focus") existing.reason = "matched focus";
      continue;
    }
    out.push({
      path: node.file,
      offset,
      limit: 25,
      reason: node.role === "focus" ? "matched focus" : node.relation ?? `${node.role} neighbor`
    });
    if (out.length === 5) break;
  }
  return out;
};
var seedVector = (n, seeds) => {
  const s = new Float64Array(n);
  for (const i of seeds) s[i] = 1;
  return s;
};
var historySeedWeights = (seedFiles, _graph, history, now) => {
  const partners = /* @__PURE__ */ new Map();
  const add = (file, w) => {
    if (seedFiles.has(file)) return;
    partners.set(file, Math.max(partners.get(file) ?? 0, w));
  };
  for (const file of seedFiles) {
    for (const p of history.get(file) ?? []) {
      const ageDays = Math.max(0, (now - p.lastTs) / 864e5);
      const w = effectiveWeight(p.w, ageDays);
      if (w <= 1e-6) continue;
      add(p.partner, w);
    }
  }
  return partners;
};
var clampBudget = (b, dflt) => Math.max(256, Math.min(16e3, b ?? dflt));
var overflowArtifact = (op, key) => context().artifactLabel?.(op, key) ?? join5(privateTmpdir(), `pi-fovea-${op}-${createHash5("sha1").update(key).digest("hex").slice(0, 8)}.txt`);
var isTestScope = (file) => isTestFile(file) || /(^|\/)(tests?|__tests__|fixtures?)(\/|$)/i.test(file);
var sketch = async (root, budget, ensured) => {
  const state = ensured ?? await ensureState(root);
  const g = state.graph;
  const B = clampBudget(budget, 512);
  const conductance = state.csr.deg;
  const closureFor = (i) => [i, ...(state.adjacency.get(i) ?? []).map((edge) => edge.to)];
  const anchorIdx = g.nodes.map((node, i) => node.kind === "anchor" ? i : -1).filter((i) => i >= 0);
  const topologyKinds = /* @__PURE__ */ new Set(["graphql-type", "graphql-fragment", "graphql-operation", "rpc-message"]);
  const anchorKinds = new Map(g.anchors.map((anchor2) => [anchor2.id, anchor2.kind]));
  const mapAnchorIdx = anchorIdx.filter((i) => !topologyKinds.has(anchorKinds.get(g.nodes[i].name) ?? ""));
  const productionAnchorIdx = mapAnchorIdx.filter((i) => closureFor(i).some((j) => !isTestScope(g.nodes[j].file)));
  const productionAnchorSet = new Set(productionAnchorIdx);
  const testAnchorIdx = mapAnchorIdx.filter((i) => !productionAnchorSet.has(i));
  const productionHubIdx = g.nodes.map((_, i) => i).filter((i) => !isTestScope(g.nodes[i].file)).sort((a, b) => conductance[b] - conductance[a]).slice(0, 24);
  const fallbackHubIdx = productionHubIdx.length ? productionHubIdx : g.nodes.map((_, i) => i).sort((a, b) => conductance[b] - conductance[a]).slice(0, 24);
  const seeds = [.../* @__PURE__ */ new Set([...productionAnchorIdx, ...fallbackHubIdx])].slice(0, 64);
  const s = seedVector(g.nodes.length, seeds);
  const t = 16;
  const field = heatField(chebyshevVectors(state.csr, s, chooseOrder(t)), t, g.nodes.length);
  let vmax = 0;
  for (let i = 0; i < field.length; i++) if (field[i] > vmax) vmax = field[i];
  if (vmax <= 0) {
    const text = `fovea sketch: empty graph (no supported files matched)${extractionSuffix(state)}`;
    return { text, tokens: tokenEstimate(text), details: { files: 0, ...extractionDetails(state) } };
  }
  const claimed = /* @__PURE__ */ new Set();
  const groups = [];
  const basins = productionAnchorIdx.length < 6 && g.nodes.length >= 48 ? detectBasins(
    state.adjacency,
    conductance,
    g.nodes.length,
    (i) => g.nodes[i].kind !== "file" && g.nodes[i].kind !== "anchor" && !isTestScope(g.nodes[i].file),
    (i) => !isTestScope(g.nodes[i].file)
  ) : [];
  for (const b of basins) {
    let mass = 0;
    const bfiles = /* @__PURE__ */ new Set();
    for (const j of b.members) {
      mass += field[j] ?? 0;
      bfiles.add(g.nodes[j].file);
    }
    const topName = b.members.map((j) => [field[j] ?? 0, j]).filter(([, j]) => g.nodes[j].kind !== "file").sort((a, b2) => b2[0] - a[0])[0];
    groups.push({
      label: `\u25C8 region ${topName ? g.nodes[topName[1]].name : g.nodes[b.seed].name}`,
      mass,
      detail: `${b.members.length} nodes \xB7 ${bfiles.size} files \xB7 seed ${g.nodes[b.seed].file}`
    });
    for (const j of b.members) claimed.add(j);
  }
  for (const i of productionAnchorIdx) {
    const closure = closureFor(i);
    let mass = 0;
    const filesIn = /* @__PURE__ */ new Set();
    for (const j of closure) {
      mass += field[j];
      filesIn.add(g.nodes[j].file);
      claimed.add(j);
    }
    const handler = g.nodes[i];
    groups.push({
      label: `\u2691 ${g.nodes[i].name}`,
      mass,
      detail: `${closure.length} nodes \xB7 ${filesIn.size} file${filesIn.size === 1 ? "" : "s"} \xB7 ${handler.file}:${handler.line}`
    });
  }
  let testAnchorMass = 0;
  for (const i of testAnchorIdx) {
    for (const j of closureFor(i)) {
      testAnchorMass += field[j] ?? 0;
      claimed.add(j);
    }
  }
  if (testAnchorIdx.length) {
    groups.push({
      label: "tests/fixtures",
      mass: testAnchorMass * 0.05,
      detail: `${testAnchorIdx.length} feature anchors collapsed`
    });
  }
  const dirAgg = /* @__PURE__ */ new Map();
  g.nodes.forEach((n, i) => {
    if (claimed.has(i) || n.kind === "anchor") return;
    const parts = n.file.split("/");
    const dir = parts.length === 1 ? "(root)" : parts.length === 2 ? `${parts[0]}/` : `${parts.slice(0, 2).join("/")}/`;
    const agg = dirAgg.get(dir) ?? { mass: 0, files: /* @__PURE__ */ new Set(), top: [] };
    dirAgg.set(dir, agg);
    agg.mass += field[i];
    agg.files.add(n.file);
    if (n.kind !== "file") agg.top.push([field[i], i]);
  });
  for (const [dir, agg] of dirAgg) {
    agg.top.sort((a, b) => b[0] - a[0]);
    const names = agg.top.slice(0, 3).map(([, i]) => g.nodes[i].name).join(", ");
    const testScope = [...agg.files].every(isTestScope);
    groups.push({
      label: dir,
      mass: agg.mass * (testScope ? 0.1 : 1),
      detail: `${testScope ? "test scope \xB7 " : ""}${agg.files.size} files${names ? ` \xB7 top: ${names}` : ""}`
    });
  }
  const anchorSummary = testAnchorIdx.length ? `${productionAnchorIdx.length} production anchors \xB7 ${testAnchorIdx.length} test/fixture anchors collapsed` : `${productionAnchorIdx.length} anchors`;
  const fit = revealGroups(groups, {
    header: `fovea sketch \xB7 ${g.files.length} files \xB7 ${g.nodes.length} symbols \xB7 ${anchorSummary}${extractionSuffix(state)}`,
    budget: B,
    overflowTo: overflowArtifact("sketch", `${root}|sketch`)
  });
  return {
    text: fit.text,
    tokens: fit.tokens,
    details: {
      files: g.files.length,
      nodes: g.nodes.length,
      anchors: anchorIdx.length,
      productionAnchors: productionAnchorIdx.length,
      testAnchors: testAnchorIdx.length,
      truncated: fit.truncated,
      ...extractionDetails(state)
    }
  };
};
var focus = async (root, query, budget, options = {}, ensured) => {
  const state = ensured ?? await ensureState(root);
  const g = state.graph;
  const session = getSession(root);
  const B = clampBudget(budget, 512);
  const requestedCoverage = looksLikeRepoPath(query) ? await explainPathCoverage(state, [query]) : [];
  const { seeds, note, suggestions } = resolveSeeds(state, query, options);
  if (!seeds.length) {
    const renderMiss = (count) => {
      const nearby = suggestions.slice(0, count).map((suggestion) => {
        const node = g.nodes[suggestion.index];
        return `  ? ${node.name} \u2014 ${formatNodeLocation(node)} \u2014 ${node.sig}`;
      });
      const guidance = suggestions.length ? "Retry fovea_focus with one of these names, a route path (/api/...), or a file path." : "Try a symbol name, a route path (/api/...), or a file path. Run fovea_sketch for the map silhouette first.";
      const coverageGaps = requestedCoverage.filter((entry) => entry.status !== "indexed").map((entry) => `! ${entry.path ?? entry.requested}: ${entry.reason}.`);
      return [
        ...coverageGaps,
        ...state.extraction.failed.length ? [`! ${state.extraction.failed.length} files failed extraction; matches may be incomplete.`] : [],
        `fovea focus "${query}": ${note}.`,
        ...nearby.length ? ["Nearby symbols:", ...nearby] : [],
        guidance
      ].join("\n");
    };
    let shown = suggestions.length;
    let text = renderMiss(shown);
    while (shown > 0 && tokenEstimate(text) > B) text = renderMiss(--shown);
    return {
      text,
      tokens: tokenEstimate(text),
      details: {
        seeds: 0,
        suggestions: suggestions.slice(0, shown).map(({ name, file, line, lineApproximate, score }) => ({
          name,
          file,
          line,
          lineApproximate,
          score: Number(score.toFixed(3))
        })),
        scope: { path: options.path, language: options.language, kind: options.kind },
        requestedCoverage,
        ...extractionDetails(state)
      }
    };
  }
  const scopeKey = [options.path ?? "", options.language?.toLowerCase() ?? "", options.kind ?? ""].join("|");
  const key = `${state.generation}:${[...seeds].sort((a, b) => a - b).join(",")}:${scopeKey}`;
  if (options.fresh || session.generation !== state.generation || session.focusKey !== key) {
    clearSessionFocus(session);
    session.focusKey = key;
    session.scope = { path: options.path, language: options.language, kind: options.kind };
  }
  session.generation = state.generation;
  if (session.tkKey !== key) {
    retainSessionVectors(root);
    session.tk = chebyshevVectors(state.csr, seedVector(g.nodes.length, seeds), chooseOrder(session.t));
    session.tkKey = key;
  }
  session.seeds = seeds;
  session.seedNote = note;
  const t = session.t;
  const field = heatField(session.tk, t, g.nodes.length);
  const scopedIds = options.path || options.language || options.kind ? new Set(g.nodes.filter(focusScope(options)).map((node) => node.id)) : void 0;
  const fit = revealFoveated(g, field, {
    header: `fovea focus "${query}" \xB7 ${note}${extractionSuffix(state)}`,
    include: scopedIds,
    disclosed: session.disclosed,
    seeds,
    repeatNucleus: true,
    budget: B,
    overflowTo: overflowArtifact("focus", `${root}|${query}`)
  });
  for (const id of fit.revealedIds) session.disclosed.add(id);
  observeSessionPaths(root, fit.revealed.map((node) => node.file));
  return {
    text: fit.text,
    tokens: fit.tokens,
    details: {
      seeds: seeds.length,
      lit: fit.litTotal,
      shown: fit.shown,
      suppressed: fit.suppressed,
      candidateOmitted: fit.candidateOmitted,
      truncated: fit.truncated,
      overflowPath: fit.overflowPath,
      t,
      scope: { path: options.path, language: options.language, kind: options.kind },
      requestedCoverage,
      nodes: fit.revealed,
      suggestedReads: suggestedReads(fit.revealed),
      ...extractionDetails(state)
    }
  };
};
var dwell = async (root, factor, budget, ensured) => {
  const state = ensured ?? await ensureState(root);
  const g = state.graph;
  const session = getSession(root);
  const B = clampBudget(budget, 512);
  if (session.seeds.length && (session.generation !== state.generation || session.tk.length > 0 && session.tk[0]?.length !== g.nodes.length)) {
    const previousGeneration = session.generation || "unknown";
    clearSessionFocus(session);
    const text = `fovea dwell: focus expired because the graph changed (${previousGeneration} \u2192 ${state.generation}). Call fovea_focus again; no stale vector was applied.`;
    return {
      text,
      tokens: tokenEstimate(text),
      details: { seeds: 0, staleFocus: true, previousGeneration, ...extractionDetails(state) }
    };
  }
  if (!session.seeds.length) {
    const text = "fovea dwell: no focus yet. Call fovea_focus with a symbol, feature id, route, or file first; dwell then deepens that field.";
    return { text, tokens: tokenEstimate(text), details: { seeds: 0, ...extractionDetails(state) } };
  }
  if (!session.tk.length) {
    retainSessionVectors(root);
    session.tk = chebyshevVectors(state.csr, seedVector(g.nodes.length, session.seeds), chooseOrder(session.t));
    session.tkKey = session.focusKey;
  }
  const from = session.t;
  const to = Math.min(64, from * Math.max(1.2, factor ?? 2));
  session.t = to;
  if (chooseOrder(to) > session.tk.length - 1) {
    extendChebyshevVectors(state.csr, session.tk, chooseOrder(to) + 8);
  }
  const field = heatField(session.tk, to, g.nodes.length);
  const scope = session.scope ?? {};
  const scopedIds = scope.path || scope.language || scope.kind ? new Set(g.nodes.filter(focusScope(scope)).map((node) => node.id)) : void 0;
  const fit = revealFoveated(g, field, {
    header: `fovea dwell \xB7 context widened ${Number((to / from).toFixed(1))}\xD7 \xB7 new results${extractionSuffix(state)}`,
    include: scopedIds,
    disclosed: session.disclosed,
    seeds: session.seeds,
    budget: B,
    overflowTo: overflowArtifact("dwell", root)
  });
  for (const id of fit.revealedIds) session.disclosed.add(id);
  observeSessionPaths(root, fit.revealed.map((node) => node.file));
  return {
    text: fit.text,
    tokens: fit.tokens,
    details: {
      from,
      to,
      lit: fit.litTotal,
      shown: fit.shown,
      suppressed: fit.suppressed,
      candidateOmitted: fit.candidateOmitted,
      truncated: fit.truncated,
      overflowPath: fit.overflowPath,
      scope,
      nodes: fit.revealed,
      suggestedReads: suggestedReads(fit.revealed),
      ...extractionDetails(state)
    }
  };
};
var COCHANGE_REASON = "co-change history";
var impact = async (root, args, ensured) => {
  const state = ensured ?? await ensureState(root);
  const g = state.graph;
  const B = clampBudget(args.budget, 512);
  const requestedCoverage = args.files?.length ? await explainPathCoverage(state, args.files) : [];
  const files = new Set((args.files ?? []).map((file) => file.startsWith("@") ? file.slice(1) : file));
  if (args.base) for (const f of await prFiles(root, args.base)) files.add(f);
  if (args.includeUncommitted !== false && !args.base) for (const f of await uncommittedFiles(root)) files.add(f);
  const useDiffHunks = !!args.base || args.includeUncommitted !== false;
  const hunksByFile = files.size && useDiffHunks ? await diffHunks(root, args.base) : void 0;
  const seedSet = /* @__PURE__ */ new Set();
  const seededFileNodes = /* @__PURE__ */ new Set();
  const s = new Float64Array(g.nodes.length);
  for (const rel of files) {
    const normalized = posix3.normalize(rel);
    const arr = g.byFile.get(rel) ?? g.byFile.get(normalized) ?? [];
    const fileNode = arr.find((i) => g.nodes[i].kind === "file");
    if (fileNode === void 0 || seededFileNodes.has(fileNode)) continue;
    seededFileNodes.add(fileNode);
    const graphFile = g.nodes[fileNode].file;
    const parsed = hunksByFile?.get(graphFile) ?? hunksByFile?.get(normalized) ?? hunksByFile?.get(rel);
    const symbols = [];
    for (const i of arr) {
      const node = g.nodes[i];
      if (node.kind === "file" || node.kind === "anchor" || node.line < 1) continue;
      const previous = symbols[symbols.length - 1];
      if (previous !== void 0 && g.nodes[previous].line === node.line) symbols[symbols.length - 1] = i;
      else symbols.push(i);
    }
    const touched = /* @__PURE__ */ new Map();
    let precise = !!parsed && !parsed.fallback && symbols.length > 0;
    const upperBound = (line) => {
      let lo = 0;
      let hi = symbols.length;
      while (lo < hi) {
        const mid = lo + (hi - lo >> 1);
        if (g.nodes[symbols[mid]].line <= line) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    if (parsed && precise) {
      for (const hunk of parsed.hunks) {
        if (hunk.newLines === 0) continue;
        const end = hunk.newStart + hunk.newLines;
        if (hunk.newStart < 1 || hunk.newLines < 0 || !Number.isSafeInteger(end)) {
          precise = false;
          touched.clear();
          break;
        }
        let cursor = hunk.newStart;
        let at = upperBound(cursor) - 1;
        if (at < 0) {
          at = 0;
          cursor = Math.max(cursor, g.nodes[symbols[0]].line);
        }
        while (cursor < end && at < symbols.length) {
          const node = symbols[at];
          const next = symbols[at + 1];
          const segmentEnd = Math.min(end, next === void 0 ? end : g.nodes[next].line);
          if (segmentEnd > cursor) touched.set(node, (touched.get(node) ?? 0) + segmentEnd - cursor);
          cursor = segmentEnd;
          at++;
        }
      }
    }
    if (!precise || !touched.size) {
      seedSet.add(fileNode);
      s[fileNode] += 1;
      continue;
    }
    const scored = [...touched.entries()].map(([node, lines]) => [node, Math.sqrt(lines)]);
    const scoreTotal = scored.reduce((sum, [, score]) => sum + score, 0);
    seedSet.add(fileNode);
    s[fileNode] += 0.2;
    let assigned = 0.2;
    for (let i = 0; i < scored.length; i++) {
      const [node, score] = scored[i];
      const weight = i === scored.length - 1 ? 1 - assigned : 0.8 * score / scoreTotal;
      seedSet.add(node);
      s[node] += weight;
      assigned += weight;
    }
  }
  for (const sym of args.symbols ?? []) {
    for (const r of resolveSeeds(state, sym).seeds) {
      if (!seedSet.has(r)) s[r] = 1;
      seedSet.add(r);
    }
  }
  if (!seedSet.size) {
    const gaps = requestedCoverage.filter((entry) => entry.status !== "indexed").map((entry) => `
! ${entry.path ?? entry.requested}: ${entry.reason}.`).join("");
    const text = `fovea impact: no seed files (repo clean or paths unknown). Pass files: [...] or symbols: [...] for a what-if cascade.${gaps}`;
    const fit2 = revealGroups([], { header: text, budget: B });
    return {
      text: fit2.text,
      tokens: fit2.tokens,
      details: { seeds: 0, requestedCoverage, ...extractionDetails(state) }
    };
  }
  const seeds = [...seedSet];
  const t = 4;
  const seedFiles = new Set(seeds.map((i) => g.nodes[i].file));
  const now = Date.now();
  const historyFor = historySeedWeights(seedFiles, g, state.history, now);
  const companionResiduals = expectationResiduals([...seedFiles].sort(), state.history, now);
  let historyPartners = 0;
  for (const [file, w] of historyFor) {
    const fileNode = (g.byFile.get(file) ?? []).find((i) => g.nodes[i].kind === "file");
    if (fileNode === void 0) continue;
    s[fileNode] += w;
    historyPartners++;
  }
  const field = heatField(chebyshevVectors(state.csr, s, chooseOrder(t)), t, g.nodes.length);
  const exclude = new Set(seeds.map((i) => g.nodes[i].id));
  const conserved = forwardHeat(state.csr, s, t);
  const conservedByFile = /* @__PURE__ */ new Map();
  g.nodes.forEach((n, i) => {
    if (exclude.has(n.id) || seedFiles.has(n.file)) return;
    const v = conserved[i];
    if (v > 1e-9) conservedByFile.set(n.file, (conservedByFile.get(n.file) ?? 0) + v);
  });
  const fileAgg = /* @__PURE__ */ new Map();
  const fileTop = /* @__PURE__ */ new Map();
  const anchorHits = [];
  let seedMass = 0;
  g.nodes.forEach((n, i) => {
    if (exclude.has(n.id)) return;
    const v = field[i];
    if (v <= 1e-6) return;
    if (seedFiles.has(n.file)) {
      seedMass += v;
      return;
    }
    if (n.kind === "anchor") {
      anchorHits.push({ label: `\u2691 ${n.name}`, mass: v, detail: `${n.file}:${n.line}` });
      return;
    }
    fileAgg.set(n.file, (fileAgg.get(n.file) ?? 0) + v);
    if (n.kind === "file") return;
    const top = fileTop.get(n.file) ?? [];
    fileTop.set(n.file, top);
    top.push([v, i]);
  });
  const reasonByFile = /* @__PURE__ */ new Map();
  const evidenceByFile = /* @__PURE__ */ new Map();
  const noteEvidence = (file, kind, evidence) => {
    if (!evidence) return;
    const list = evidenceByFile.get(file) ?? [];
    const item = { kind, ...evidence };
    const key = JSON.stringify(item);
    if (list.length < 3 && !list.some((existing) => JSON.stringify(existing) === key)) list.push(item);
    evidenceByFile.set(file, list);
  };
  const reasonByNode = /* @__PURE__ */ new Map();
  const noteNode = (node, reasons) => {
    if (!reasonByNode.has(node) && reasons.length) reasonByNode.set(node, reasons);
  };
  const reasonFor = (kind, evidence) => {
    if (kind === "imports" && evidence?.possible) return "possible import target";
    switch (kind) {
      case "invokes":
        return "call dependency";
      case "imports":
        return "import dependency";
      case "tests":
        return "test dependency";
      case "inherits":
        return "inheritance";
      case "join":
        return "shared literal";
      case "anchors":
        return "shared route";
      case "contains":
        return void 0;
    }
  };
  for (const edge of g.edges) {
    const aFile = g.nodes[edge.a].file;
    const bFile = g.nodes[edge.b].file;
    if (aFile === bFile) continue;
    const target = seedFiles.has(aFile) && !seedFiles.has(bFile) ? bFile : seedFiles.has(bFile) && !seedFiles.has(aFile) ? aFile : void 0;
    const reason = reasonFor(edge.kind, edge.evidence);
    if (!reason) continue;
    const farNode = seedFiles.has(aFile) && !seedFiles.has(bFile) ? edge.b : seedFiles.has(bFile) && !seedFiles.has(aFile) ? edge.a : void 0;
    if (farNode !== void 0) noteNode(farNode, [reason]);
    if (!target || !fileAgg.has(target)) continue;
    noteEvidence(target, edge.kind, edge.evidence);
    const reasons = reasonByFile.get(target) ?? /* @__PURE__ */ new Set();
    reasons.add(reason);
    reasonByFile.set(target, reasons);
  }
  const visited = new Set(seeds);
  const queue = seeds.map((node) => ({ node, reasons: [], evidence: [] }));
  for (let head = 0; head < queue.length; head++) {
    const current2 = queue[head];
    for (const edge of state.adjacency.get(current2.node) ?? []) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      const reason = reasonFor(edge.kind, edge.evidence);
      const reasons = reason && !current2.reasons.includes(reason) ? [...current2.reasons, reason] : current2.reasons;
      const evidence = edge.evidence && current2.evidence.length < 3 ? [...current2.evidence, { kind: edge.kind, ...edge.evidence }] : current2.evidence;
      noteNode(edge.to, reasons);
      queue.push({ node: edge.to, reasons, evidence });
      const file = g.nodes[edge.to].file;
      if (fileAgg.has(file) && !seedFiles.has(file) && !reasonByFile.has(file) && reasons.length) {
        reasonByFile.set(file, new Set(reasons.slice(0, 3)));
        for (const item of evidence) noteEvidence(file, item.kind, item);
      }
    }
  }
  for (const file of historyFor.keys()) {
    if (!fileAgg.has(file) || seedFiles.has(file)) continue;
    const merged = /* @__PURE__ */ new Set([COCHANGE_REASON, ...reasonByFile.get(file) ?? []]);
    reasonByFile.set(file, merged);
    for (const i of g.byFile.get(file) ?? []) {
      const existing = reasonByNode.get(i) ?? [];
      if (!existing.includes(COCHANGE_REASON)) reasonByNode.set(i, [COCHANGE_REASON, ...existing]);
    }
  }
  const warmedNodes = {};
  {
    const warmed = [];
    g.nodes.forEach((n, i) => {
      if (exclude.has(n.id) || seedFiles.has(n.file)) return;
      const v = field[i];
      if (v <= 1e-6) return;
      warmed.push([`${n.kind}|${n.id}`, {
        file: n.file,
        m: Number(v.toFixed(6)),
        r: reasonByNode.get(i) ?? []
      }]);
    });
    warmed.sort((a, b) => b[1].m - a[1].m);
    for (const [k, v] of warmed.slice(0, 2e3)) warmedNodes[k] = v;
  }
  const fileEntries = [...fileAgg.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const fileGroups = [];
  for (const [file, mass] of fileEntries) {
    const top = (fileTop.get(file) ?? []).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, i]) => g.nodes[i].name).join(", ");
    const reasons = [...reasonByFile.get(file) ?? /* @__PURE__ */ new Set(["graph path"])];
    fileGroups.push({
      label: file,
      mass,
      detail: `via ${reasons.join(", ")}${top ? ` \xB7 top: ${top}` : ""}`
    });
  }
  const groups = [...anchorHits, ...fileGroups];
  const seedNames = seeds.slice(0, 5).map((i) => g.nodes[i].file).join(", ");
  const fit = revealGroups(groups, {
    header: `fovea impact \xB7 changed: ${seedNames}${seeds.length > 5 ? ", \u2026" : ""} \xB7 likely review order${extractionSuffix(state)}`,
    budget: B,
    overflowTo: overflowArtifact("impact", `${root}|${(args.files ?? []).join(",")}`)
  });
  return {
    text: fit.text,
    tokens: fit.tokens,
    details: {
      seeds: seeds.length,
      historyPartners,
      warmed: anchorHits.length + fileGroups.length,
      truncated: fit.truncated,
      requestedCoverage,
      ...extractionDetails(state),
      // Structured form for consumers (turn-sync): warmed anchors, files,
      // and the strongest direct evidence channel without text re-parsing.
      warmedAnchors: anchorHits.map((h) => h.label.replace(/^⚑\s*/, "")),
      warmedFiles: fileEntries.map(([file]) => file),
      // Heat retained by the seed files themselves — a graph-size-invariant
      // normalizer for warmedMass (per-file warmth as a fraction of the heat
      // the change site keeps).
      seedMass: Number(seedMass.toFixed(6)),
      // Per-file cascade mass (Σ node heat, seeds excluded). Turn-sync gates
      // on these masses; the file list alone cannot rank a drizzle against a
      // real cascade. Rounded so the warm-cache path and the inline path
      // carry bit-identical payloads.
      warmedMass: Object.fromEntries(fileEntries.map(([file, mass]) => [file, Number(mass.toFixed(6))])),
      warmedReasons: Object.fromEntries(fileEntries.map(([file]) => [
        file,
        [...reasonByFile.get(file) ?? /* @__PURE__ */ new Set(["graph path"])]
      ])),
      warmedEvidence: Object.fromEntries(fileEntries.map(([file]) => [file, evidenceByFile.get(file) ?? []])),
      warmedNodes,
      // Deterministic omitted-edit alarm, strongest first, capped.
      expectedButUnchanged: [...companionResiduals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([file, weight]) => ({ file, weight: Number(weight.toFixed(4)) })),
      // Conserved per-file mass (degree-corrected random-walk heat, seeds
      // excluded). A parallel measurement to warmedMass, not yet consumed by
      // sync thresholds.
      conservedMass: Object.fromEntries(
        [...conservedByFile.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([file, mass]) => [file, Number(mass.toFixed(6))])
      )
    }
  };
};

// src/fovea/core/sync.ts
import { createHash as createHash7 } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile as readFile6, stat as stat4 } from "node:fs/promises";
import { join as join7 } from "node:path";

// src/fovea/core/provenance.ts
import { createHash as createHash6 } from "node:crypto";
import { readFile as readFile5, readdir as readdir2 } from "node:fs/promises";
import { isAbsolute as isAbsolute3, join as join6, relative as relative3, resolve as resolve4, sep as sep3 } from "node:path";
var JOURNAL_VERSION = 1;
var sha1 = (value) => createHash6("sha1").update(value).digest("hex");
var ownerFor = (sessionId) => sha1(sessionId).slice(0, 16);
var rootKey = (root) => sha1(resolve4(root)).slice(0, 16);
var prefixFor = (root) => `pi-fovea-provenance-${rootKey(root)}-`;
var provenancePathFor = (root, sessionId) => join6(privateTmpdir(), `${prefixFor(root)}${ownerFor(sessionId)}.json`);
var writeQueues = owned("provenance.ts:writeQueues", () => /* @__PURE__ */ new Map());
var readRecords = async (root, since) => {
  void maintainTempStorage();
  const prefix = prefixFor(root);
  await Promise.all([...writeQueues.entries()].filter(([path]) => path.split(/[/\\]/u).at(-1)?.startsWith(prefix)).map(([, pending]) => pending.catch(() => {
  })));
  const cutoff = Math.max(since, Date.now() - JOURNAL_TTL_MS);
  let names;
  try {
    names = (await readdir2(privateTmpdir())).filter((name) => name.startsWith(prefix) && /^[a-f0-9]{16}\.json$/.test(name.slice(prefix.length)));
  } catch {
    return [];
  }
  const records = [];
  await Promise.all(names.map(async (name) => {
    const path = join6(privateTmpdir(), name);
    try {
      const journal = JSON.parse(await readTempText(path, Infinity));
      if (journal.version !== JOURNAL_VERSION || journal.root !== resolve4(root) || !Array.isArray(journal.records)) return;
      const live = journal.records.filter((record) => record.at >= cutoff);
      records.push(...live);
    } catch {
    }
  }));
  return records.sort((a, b) => a.at - b.at || (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0) || (a.commitOrder ?? Number.MAX_SAFE_INTEGER) - (b.commitOrder ?? Number.MAX_SAFE_INTEGER) || (a.toolCallId < b.toolCallId ? -1 : a.toolCallId > b.toolCallId ? 1 : 0));
};
var kindForOwners = (owners, currentOwner) => {
  if (!owners.size) return "unattributed";
  if (owners.size === 1) return owners.has(currentOwner) ? "current-session" : "other-session";
  return "mixed";
};
var ownersForTransition = (records, beforeSha, afterSha) => {
  const states2 = /* @__PURE__ */ new Map();
  const key = (sha) => sha ?? "\0deleted";
  states2.set(key(beforeSha), /* @__PURE__ */ new Set());
  for (const record of records) {
    const owners = states2.get(key(record.beforeSha));
    if (!owners) continue;
    const nextKey = key(record.afterSha);
    const next = states2.get(nextKey) ?? /* @__PURE__ */ new Set();
    for (const owner of owners) next.add(owner);
    next.add(record.owner);
    states2.set(nextKey, next);
  }
  return states2.get(key(afterSha)) ?? /* @__PURE__ */ new Set();
};
var attributeChanges = async (root, sessionId, since, changes) => {
  const records = await readRecords(root, since);
  const recordsByFile = /* @__PURE__ */ new Map();
  for (const record of records) {
    const matching = recordsByFile.get(record.file) ?? [];
    matching.push(record);
    recordsByFile.set(record.file, matching);
  }
  const currentOwner = ownerFor(sessionId);
  const files = {};
  for (const change of changes) {
    files[change.file] = kindForOwners(
      ownersForTransition(recordsByFile.get(change.file) ?? [], change.beforeSha, change.afterSha),
      currentOwner
    );
  }
  const kinds = new Set(Object.values(files));
  return {
    kind: kinds.size === 0 ? "unattributed" : kinds.size === 1 ? [...kinds][0] : "mixed",
    files
  };
};

// src/fovea/core/sync.ts
var baselines = owned("syncBaselines", () => /* @__PURE__ */ new Map(), true);
var syncBaselineStore = () => baselines;
var getBaseline = (root) => {
  const hit = baselines.get(root);
  if (hit) {
    baselines.delete(root);
    baselines.set(root, hit);
  }
  return hit;
};
var setBaseline = (root, baseline) => {
  baselines.delete(root);
  baselines.set(root, baseline);
  while (baselines.size > OBSERVED_ROOT_LIMIT) baselines.delete(baselines.keys().next().value);
};
var PROBE_TTL_MS = envInt("FOVEA_PROBE_TTL_MS", 1200, 200, 6e4);
var lastProbe = owned("sync.ts:lastProbe", () => /* @__PURE__ */ new Map(), true);
var gitDriftSince = async (root, shas) => {
  const probe = await gitProbe(root);
  if (!probe) return false;
  if (probe.relist) return true;
  for (const change of probe.changes) {
    const rel = change.path;
    if (rel.endsWith("/")) return true;
    const st = await stat4(join7(root, rel)).catch(() => void 0);
    if (st?.isDirectory()) return true;
    try {
      const buf = await readFile6(join7(root, rel));
      const sha = createHash7("sha1").update(buf).digest("hex");
      if (shas.get(rel) !== sha) return true;
    } catch {
      if (shas.has(rel)) return true;
    }
  }
  return false;
};
var CHANNEL_WEIGHT = {
  "call dependency": 1,
  "import dependency": 1,
  "test dependency": 1,
  "inheritance": 1,
  "shared route": 1,
  "co-change history": 0.5,
  "shared literal": 0.35,
  "graph path": 0.5
};
var CHANNEL_UNKNOWN = 0.5;
var MEMORY_HALF_LIFE_HOURS = envInt("FOVEA_MEMORY_HALF_LIFE_HOURS", 48, 1, 8760);
var HALF_LIFE_MS = MEMORY_HALF_LIFE_HOURS * 36e5;
var decayedMass = (entry, nowMs) => entry.m * Math.pow(0.5, Math.max(0, nowMs - entry.t) / HALF_LIFE_MS);
var MEMORY_MAX_NODES = 4096;
var REARM_FRACTION = 0.5;
var round4 = (x) => Math.round(x * 1e4) / 1e4;
var warmCache = owned("sync.ts:warmCache", () => /* @__PURE__ */ new Map(), true);
var filesKey = (files) => [...new Set(files)].sort().join("\n");
var semanticDrift = (state, prev) => {
  const changed = Object.keys(state.facts).filter(
    (file) => prev.shas.get(file) !== state.facts[file].sha1
  );
  return changed.filter(
    (file) => prev.semantics.get(file) !== semanticFacts(state, file) && state.graph.byFile.has(file)
  );
};
var semanticCache = owned("sync.ts:semanticCache", () => /* @__PURE__ */ new WeakMap(), true);
var semanticFacts = (state, file) => {
  const facts = state.facts[file];
  if (!facts) return "";
  const cached = semanticCache.get(facts);
  if (cached !== void 0) return cached;
  const stable = (rows) => rows.map((row) => JSON.stringify(row)).sort();
  const compactSig = (sig) => sig.replace(/\s+/g, " ").trim();
  const value = createHash7("sha1").update(JSON.stringify({
    symbols: stable(facts.symbols.map((symbol) => [symbol.name, symbol.kind, compactSig(symbol.sig), symbol.lang])),
    imports: stable(facts.imports.map((site) => [site.spec, site.alias])),
    calls: stable(facts.calls.map((site) => [site.callee])),
    literals: stable(facts.literals.map((site) => [site.text])),
    anchors: stable(facts.anchors.map((anchor2) => [anchor2.id, anchor2.kind, anchor2.nodeId, anchor2.implicit === true])),
    // Code-unit order keeps the semantic digest locale-independent (a locale
    // or ICU change would otherwise mark every cached fact as drifted).
    sigs: Object.entries(facts.sigs ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  })).digest("hex");
  semanticCache.set(facts, value);
  return value;
};
var coldSweeps = owned("sync.ts:coldSweeps", () => /* @__PURE__ */ new Map(), true);
var boundaryProbes = owned("sync.ts:boundaryProbes", () => /* @__PURE__ */ new Map(), true);
var rememberProbe = (map, root) => {
  map.delete(root);
  map.set(root, Date.now());
  while (map.size > OBSERVED_ROOT_LIMIT) map.delete(map.keys().next().value);
};
var coldManifestDrift = async (root, baseline, routes) => {
  if ((baseline.closed || baseline.enrolled.size) && Date.now() - (boundaryProbes.get(root) ?? 0) >= 4e3) {
    rememberProbe(boundaryProbes, root);
    return true;
  }
  const listing = await discoverFiles(root, routes, baseline.enrolled);
  if (listing.files.length !== baseline.files.length || listing.files.some((file, i) => file !== baseline.files[i])) return true;
  const sweep2 = Date.now() - (coldSweeps.get(root) ?? baseline.capturedAt) >= 2e4;
  const changed = await mapLimit(listing.files, 32, async (file) => {
    try {
      const info = await stat4(join7(root, file)), before = baseline.meta.get(file);
      if (!before || info.size !== before.size || info.mtimeMs !== before.mtime) return true;
      return sweep2 && baseline.shas.has(file) && createHash7("sha1").update(await readFile6(join7(root, file))).digest("hex") !== baseline.shas.get(file);
    } catch {
      return true;
    }
  });
  if (sweep2) rememberProbe(coldSweeps, root);
  return changed.some(Boolean);
};
var coldDrift = async (root, baseline) => {
  const rules = await loadRepoRules(root);
  if (rules.sha !== baseline.rulesSha) return true;
  const routes = rules.fileRoutes.map((rule) => new RegExp(rule.re));
  if (baseline.gitKind !== "git") return coldManifestDrift(root, baseline, routes);
  const probe = await gitProbe(root);
  if (!probe || probe.head !== baseline.head || probe.relist) return true;
  const candidates = /* @__PURE__ */ new Set([...baseline.dirty, ...probe.changes.map((change) => change.path)]);
  for (const file of candidates) {
    const path = join7(root, file), info = await stat4(path).catch(() => void 0);
    if (info?.isDirectory() || file.endsWith("/")) return coldManifestDrift(root, baseline, routes);
    if (!baseline.shas.has(file) && !filterSupported([file], routes).length) continue;
    try {
      if (createHash7("sha1").update(await readFile6(path)).digest("hex") !== baseline.shas.get(file)) return true;
    } catch {
      if (baseline.shas.has(file)) return true;
    }
  }
  return false;
};
var snapshot = async (state) => {
  const anchors = /* @__PURE__ */ new Map();
  await forEachChunked(state.graph.anchors, 256, (anchor2) => anchors.set(anchor2.id, anchor2.file));
  const shas = /* @__PURE__ */ new Map();
  const semantics = /* @__PURE__ */ new Map();
  await forEachChunked(Object.entries(state.facts), 256, ([file, facts]) => {
    shas.set(file, facts.sha1);
    semantics.set(file, semanticFacts(state, file));
  });
  return {
    version: state.version,
    capturedAt: Date.now(),
    anchors,
    shas,
    semantics,
    gitKind: state.gitKind,
    head: state.head,
    dirty: new Set(state.dirty),
    files: [...state.files],
    meta: new Map(state.store.meta),
    enrolled: new Set(state.store.enrolled),
    closed: state.discovery.closedBoundariesSeen > 0,
    rulesSha: state.store.rulesSha
  };
};
var sync = async (root, params, now, opts) => {
  const isCurrent = () => opts?.current?.() !== false;
  const cancelled = () => ({ structural: false, red: false, tokens: 0, details: { cancelled: true } });
  const commitBaseline = (baseline) => {
    if (isCurrent()) setBaseline(root, baseline);
  };
  if (!isCurrent()) return cancelled();
  if (params.sessionId && params.files?.length) observeSessionPaths(root, params.files);
  let state = now;
  if (!state) {
    const warm = getState(root);
    if (!warm) {
      const baseline = getBaseline(root);
      if (opts?.probe === "defer" && baseline) {
        return { structural: false, red: false, tokens: 0, details: { version: baseline.version, cold: true, deferred: true } };
      }
      if (baseline && !params.files?.length && !await coldDrift(root, baseline)) {
        return { structural: false, red: false, tokens: 0, details: { version: baseline.version, cold: true } };
      }
      if (!isCurrent()) return cancelled();
      if (!getInflight(root)) {
        const kick = ensureStateBackground(root);
        if (!baseline && opts?.current) void kick.promise.then(async (built) => {
          const fresh = await snapshot(built);
          if (isCurrent() && !baselines.has(root)) commitBaseline(fresh);
        }).catch(() => {
        });
      }
      return { structural: false, red: false, tokens: 0, details: { indexing: true } };
    }
    if (opts?.probe === "defer") {
      const prev2 = getBaseline(root);
      if (prev2 && prev2.version === warm.version) {
        const due = Date.now() - (lastProbe.get(root) ?? 0) >= PROBE_TTL_MS;
        if (due && await gitDriftSince(root, prev2.shas)) {
          lastProbe.set(root, Date.now());
          return { structural: true, red: false, tokens: 0, details: { version: warm.version, deferred: true } };
        }
        if (due) lastProbe.set(root, Date.now());
        return { structural: false, red: false, tokens: 0, details: { version: warm.version } };
      }
      state = warm;
    } else {
      state = await ensureState(root, { hints: params.files, force: opts?.probe !== "cheap" });
    }
  }
  if (!isCurrent()) return cancelled();
  const prev = getBaseline(root);
  if (prev && prev.version === state.version) {
    return { structural: false, red: false, tokens: 0, details: { version: state.version } };
  }
  if (!prev) {
    commitBaseline(await snapshot(state));
    return {
      structural: true,
      red: false,
      tokens: 0,
      details: { version: state.version, baseline: "established", anchors: state.graph.anchors.length }
    };
  }
  if (state.checkout || prev.gitKind === "git" && prev.head !== state.head && (await gitReflogAction(root))?.startsWith("checkout:")) {
    commitBaseline(await snapshot(state));
    return {
      structural: true,
      red: false,
      tokens: 0,
      details: { version: state.version, checkout: true, baseline: "established", anchors: state.graph.anchors.length }
    };
  }
  const current2 = new Map(state.graph.anchors.map((a) => [a.id, a.implicit === true]));
  const currentCarrier = new Map(state.graph.anchors.map((a) => [a.id, a.file]));
  const currentIds = new Set(current2.keys());
  const allAdded = [...currentIds].filter((id) => !prev.anchors.has(id));
  const allRemoved = [...prev.anchors.keys()].filter((id) => !currentIds.has(id));
  const session = getSession(root);
  const scopedSync = params.scope !== "repository" && params.sessionId !== void 0;
  const attentionScopes = [...session.syncScopes].sort();
  const relevantFile = (file) => {
    if (!scopedSync || session.syncScopes.has(".")) return true;
    if (!file) return false;
    const scope = syncScopeForPath(root, file);
    return scope !== void 0 && session.syncScopes.has(scope);
  };
  const added = allAdded.filter((id) => relevantFile(currentCarrier.get(id)));
  const removed = allRemoved.filter((id) => relevantFile(prev.anchors.get(id)));
  const newlyImplicit = added.filter((id) => current2.get(id));
  const disclosedFiles = /* @__PURE__ */ new Set();
  for (const id of session.disclosed) {
    const at = id.indexOf("@");
    if (at >= 0) disclosedFiles.add(id.slice(at + 1));
  }
  const allChanged = Object.keys(state.facts).filter(
    (file) => prev.shas.get(file) !== state.facts[file].sha1
  );
  const allSemanticChanged = semanticDrift(state, prev);
  const changed = allChanged.filter(relevantFile);
  const semanticChanged = allSemanticChanged.filter(relevantFile);
  const hinted = (params.files ?? []).filter((file) => semanticChanged.includes(file));
  const allDeleted = [...prev.shas.keys()].filter(
    (file) => !(file in state.facts) && !existsSync(join7(state.root, file))
  );
  const deleted = allDeleted.filter(relevantFile);
  const ignoredFiles = [.../* @__PURE__ */ new Set([
    ...allChanged.filter((file) => !relevantFile(file)),
    ...allDeleted.filter((file) => !relevantFile(file))
  ])].sort();
  const files = [.../* @__PURE__ */ new Set([...semanticChanged, ...hinted])];
  const outsideAttentionOnly = scopedSync && ignoredFiles.length > 0 && changed.length === 0 && deleted.length === 0 && added.length === 0 && removed.length === 0;
  if (outsideAttentionOnly) {
    warmCache.delete(root);
    commitBaseline({
      ...await snapshot(state),
      heat: prev.heat,
      warmthArmed: prev.warmthArmed,
      pushed: prev.pushed
    });
    return {
      structural: true,
      red: false,
      tokens: 0,
      details: {
        version: state.version,
        outsideAttention: true,
        attentionScopes,
        ignoredFiles,
        changedFiles: [],
        semanticChangedFiles: [],
        deletedFiles: []
      }
    };
  }
  const provenance = params.sessionId ? await attributeChanges(root, params.sessionId, prev.capturedAt, [
    ...changed.map((file) => ({
      file,
      beforeSha: prev.shas.get(file),
      afterSha: state.facts[file].sha1
    })),
    ...deleted.map((file) => ({ file, beforeSha: prev.shas.get(file), afterSha: void 0 }))
  ]) : void 0;
  let warmReasons = {};
  let warmNodes = {};
  let preparedBaseline;
  if (files.length) {
    const prepared = warmCache.get(root);
    const preparedHit = prepared !== void 0 && prepared.version === state.version && prepared.filesKey === filesKey(files);
    if (preparedHit) {
      warmCache.delete(root);
      preparedBaseline = prepared.snapshot;
      warmReasons = prepared.warmReasons;
      warmNodes = prepared.warmedNodes;
    } else if (opts?.probe === "defer") {
      return { structural: true, red: false, tokens: 0, details: { version: state.version, deferred: true } };
    } else {
      const result = await impact(root, { files, includeUncommitted: false, budget: params.budget });
      warmReasons = result.details.warmedReasons ?? {};
      warmNodes = result.details.warmedNodes ?? {};
    }
  }
  const nowMs = Date.now();
  const nodeMass = (hit) => {
    let prior = 0;
    for (const reason of hit.r) prior = Math.max(prior, CHANNEL_WEIGHT[reason] ?? CHANNEL_UNKNOWN);
    return hit.m * (prior || CHANNEL_UNKNOWN);
  };
  const memory = /* @__PURE__ */ new Map();
  for (const [key, entry] of prev.heat ?? []) {
    const cooled = decayedMass(entry, nowMs);
    if (cooled > 1e-9) memory.set(key, { m: cooled, t: nowMs });
  }
  if (memory.size > MEMORY_MAX_NODES) {
    const ranked = [...memory.entries()].sort((a, b) => a[1].m - b[1].m);
    for (const [key] of ranked.slice(0, memory.size - MEMORY_MAX_NODES)) memory.delete(key);
  }
  const surprise = /* @__PURE__ */ new Map();
  let surpriseTotal = 0;
  for (const [key, hit] of Object.entries(warmNodes)) {
    if (disclosedFiles.has(hit.file) || files.includes(hit.file)) continue;
    const delta = nodeMass(hit) - (memory.get(key)?.m ?? 0);
    if (delta > 1e-9) {
      surprise.set(hit.file, (surprise.get(hit.file) ?? 0) + delta);
      surpriseTotal += delta;
    }
  }
  const pushed = new Set(prev.pushed ?? []);
  const degraded = state.extraction.failed.length > 0;
  const evidence = /* @__PURE__ */ new Set([...changed, ...semanticChanged, ...deleted]);
  const suspectRemoved = removed.filter((id) => !evidence.has(prev.anchors.get(id) ?? ""));
  const suspectAdded = added.filter((id) => !evidence.has(currentCarrier.get(id) ?? ""));
  const evidentialAdded = added.filter((id) => !suspectAdded.includes(id));
  const evidentialRemoved = removed.filter((id) => !suspectRemoved.includes(id));
  const structuralRed = evidentialAdded.length - newlyImplicit.length > 0 || evidentialRemoved.length > 0 && !degraded || deleted.some((file) => !isTestScope(file));
  const prevArmed = prev.warmthArmed !== false;
  const warmthFire = prevArmed && surpriseTotal >= params.steerThreshold;
  const red = structuralRed || warmthFire;
  const warmthArmed = red ? false : prevArmed || surpriseTotal <= params.steerThreshold * REARM_FRACTION;
  if (red) {
    for (const [key, hit] of Object.entries(warmNodes)) {
      if (disclosedFiles.has(hit.file) || files.includes(hit.file)) continue;
      const adjusted = nodeMass(hit);
      if (adjusted > (memory.get(key)?.m ?? 0)) memory.set(key, { m: adjusted, t: nowMs });
    }
  }
  const orderedWarm = [...surprise.entries()].sort((a, b) => b[1] - a[1] || Number(isTestScope(a[0])) - Number(isTestScope(b[0])) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([file]) => file);
  commitBaseline({
    ...preparedBaseline ?? await snapshot(state),
    heat: memory.size ? memory : void 0,
    warmthArmed,
    pushed
  });
  if (!red) {
    return {
      structural: true,
      red: false,
      tokens: 0,
      details: {
        version: state.version,
        anchorsDelta: added.length - removed.length,
        warmNew: orderedWarm.length,
        surprise: round4(surpriseTotal),
        changedFiles: changed,
        semanticChangedFiles: files,
        deletedFiles: deleted,
        ...ignoredFiles.length ? { ignoredFiles, attentionScopes } : {},
        ...provenance ? { provenance } : {},
        ...suspectAdded.length || suspectRemoved.length ? { suspectAnchors: { added: suspectAdded, removed: suspectRemoved } } : {},
        ...degraded ? { extractionDegraded: true } : {}
      }
    };
  }
  const changedSummary = files.length ? `${files.slice(0, 4).join(", ")}${files.length > 4 ? ` (+${files.length - 4} more)` : ""}` : deleted.length ? `deleted ${deleted.slice(0, 4).join(", ")}${deleted.length > 4 ? ` (+${deleted.length - 4} more)` : ""}` : "route structure";
  const origin = provenance?.kind === "current-session" ? "current session" : provenance?.kind === "other-session" ? "another Fovea-enabled session" : provenance?.kind === "mixed" ? "mixed sessions or mutation paths" : "unattributed mutation path";
  const delivery = provenance?.kind === "other-session" ? "next-prompt" : "steer";
  const lines = [
    "Repository structure changed.",
    `Changed: ${changedSummary}`,
    ...provenance ? [`Origin: ${origin}.`] : []
  ];
  for (const id of evidentialAdded.filter((anchor2) => !newlyImplicit.includes(anchor2)).slice(0, 6)) {
    lines.push(`Route added: ${id}`);
  }
  if (!degraded) for (const id of evidentialRemoved.slice(0, 6)) lines.push(`Route removed: ${id}`);
  if (orderedWarm.length) {
    lines.push("Newly relevant files:");
    for (const file of orderedWarm.slice(0, 8)) {
      lines.push(`  ${file} \u2014 ${(warmReasons[file] ?? ["graph path"]).join(", ")}`);
    }
  }
  const focusTarget = evidentialAdded.find((id) => !newlyImplicit.includes(id))?.replace(/^\w+\s+(?=\/)/, "") ?? files[0] ?? orderedWarm[0];
  const pushFocus = params.pushFocus !== false;
  const actionLine = delivery === "next-prompt" ? "Notice: review this concurrent update on the next prompt if it affects the task." : "Steer: account for this update before continuing.";
  let embedded = false;
  if (pushFocus && focusTarget && focusTarget in state.facts && !pushed.has(focusTarget)) {
    const detailBudget = params.budget - Math.ceil([...lines, actionLine].join("\n").length / 4);
    if (detailBudget >= 128) {
      try {
        const detail = await focus(root, focusTarget, detailBudget, void 0, state);
        if (detail.text.trim()) {
          lines.push(...detail.text.split("\n"));
          pushed.add(focusTarget);
          embedded = true;
        }
      } catch {
      }
    }
  }
  if (!embedded && (!pushFocus || focusTarget)) {
    lines.push(focusTarget ? `Next: fovea_focus ${JSON.stringify(focusTarget)} to see what it now connects to.` : "Next: fovea_sketch for the updated silhouette.");
  }
  lines.push(actionLine);
  while (lines.length > 3 && Math.ceil(lines.join("\n").length / 4) > params.budget) {
    lines.splice(lines.length - 2, 1);
  }
  const text = lines.join("\n");
  return {
    structural: true,
    red: true,
    text,
    delivery,
    tokens: Math.ceil(text.length / 4),
    details: {
      version: state.version,
      added,
      removed,
      changedFiles: changed,
      semanticChangedFiles: files,
      warmNew: orderedWarm,
      surprise: round4(surpriseTotal),
      warmReasons,
      deletedFiles: deleted,
      ...ignoredFiles.length ? { ignoredFiles, attentionScopes } : {},
      ...provenance ? { provenance } : {},
      ...embedded ? { pushedFocus: focusTarget } : {},
      ...degraded ? { extractionDegraded: true } : {}
    }
  };
};

// src/fovea/core/result-budget.ts
function boundResultDetails(input, maxChars = 4e5, maxNodes = 18e3) {
  let chars = 2, nodes = 0, omitted = 0;
  const visit = (value, depth) => {
    if (++nodes > maxNodes || depth > 16 || chars >= maxChars) {
      omitted++;
      return void 0;
    }
    if (value === void 0) return void 0;
    if (value === null || typeof value === "boolean" || typeof value === "number") {
      chars += 24;
      return value;
    }
    if (typeof value === "string") {
      const size = JSON.stringify(value).length;
      if (chars + size > maxChars) {
        omitted++;
        return void 0;
      }
      chars += size;
      return value;
    }
    if (Array.isArray(value)) {
      const result2 = [];
      chars += 2;
      for (let i = 0; i < value.length; i++) {
        if (i >= 1e3 || nodes >= maxNodes || chars >= maxChars) {
          omitted += value.length - i;
          break;
        }
        const child = visit(value[i], depth + 1);
        if (child !== void 0) {
          result2.push(child);
          chars++;
        }
      }
      return result2;
    }
    if (typeof value === "object") {
      const result2 = {};
      chars += 2;
      const entries = Object.entries(value);
      for (let i = 0; i < entries.length; i++) {
        if (i >= 1e3 || nodes >= maxNodes || chars >= maxChars) {
          omitted += entries.length - i;
          break;
        }
        const [key, child] = entries[i];
        if (key === "overflowPath" || child === void 0) continue;
        chars += JSON.stringify(key).length + 2;
        const next = visit(child, depth + 1);
        if (next !== void 0) Object.defineProperty(result2, key, { value: next, enumerable: true, configurable: true, writable: true });
      }
      return result2;
    }
    omitted++;
    return void 0;
  };
  const result = visit(input, 0);
  return omitted ? { ...result, detailsTruncated: true, detailsOmitted: omitted } : result;
}

// src/fovea/source-access.ts
import { lstat as lstat3, mkdir, writeFile as writeFile2 } from "node:fs/promises";
import { isAbsolute as isAbsolute5, join as join9, relative as relative5, sep as sep5 } from "node:path";
import { createHash as createHash9 } from "node:crypto";

// src/fovea/parser-executable.ts
import { createHash as createHash8 } from "node:crypto";
import { constants as constants2 } from "node:fs";
import { open as open2, realpath, writeFile, chmod } from "node:fs/promises";
import { isAbsolute as isAbsolute4, relative as relative4, sep as sep4, join as join8 } from "node:path";
import { execFile as execFile3 } from "node:child_process";
var sha256 = (bytes) => createHash8("sha256").update(bytes).digest("hex");
async function readVerifiedExecutable(path, maxBytes = 128 * 1024 * 1024) {
  if (!isAbsolute4(path)) throw new Error("Executable path must be absolute");
  const canonical = await realpath(path);
  if (canonical !== path) throw new Error("Executable path must be canonical and cannot contain symlinks");
  const handle = await open2(path, constants2.O_RDONLY | constants2.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || !(before.mode & 73) || before.mode & 18 || before.size > maxBytes) {
      throw new Error("Unsafe executable permissions, type, or size");
    }
    if (before.uid !== 0 && before.uid !== process.getuid?.()) throw new Error("Untrusted executable owner");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length > maxBytes || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error("Executable changed during verification");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}
async function resolveParserDescriptor(descriptor, storageRoot, signal) {
  if (!/^[a-f0-9]{64}$/i.test(descriptor.sha256) || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(descriptor.version)) {
    throw new Error("Invalid managed parser descriptor");
  }
  if (descriptor.generationRoot) {
    const root = await realpath(descriptor.generationRoot);
    const rel = relative4(root, descriptor.path);
    if (!rel || rel === ".." || rel.startsWith(`..${sep4}`) || isAbsolute4(rel)) throw new Error("Parser is outside its generation");
  }
  signal?.throwIfAborted();
  const bytes = await readVerifiedExecutable(descriptor.path);
  if (sha256(bytes) !== descriptor.sha256.toLowerCase()) throw new Error("Managed parser SHA-256 mismatch");
  const path = join8(storageRoot, "managed-parser");
  await writeFile(path, bytes, { flag: "wx", mode: 320 });
  await chmod(path, 320);
  const version = await new Promise((resolve6, reject) => {
    execFile3(path, ["--version"], {
      signal,
      killSignal: "SIGKILL",
      timeout: 5e3,
      maxBuffer: 4096,
      env: { LANG: "C", LC_ALL: "C", HOME: storageRoot, TMPDIR: storageRoot }
    }, (error, stdout) => error ? reject(error) : resolve6(stdout.trim()));
  });
  signal?.throwIfAborted();
  if (version !== `ast-grep ${descriptor.version}`) throw new Error(`Managed parser version mismatch: ${version}`);
  return { ...descriptor, path };
}

// src/fovea/source-access.ts
function unchangedFile(before, after, length) {
  return after.isFile() && before.nlink === 1 && after.nlink === 1 && before.dev === after.dev && before.ino === after.ino && before.mode === after.mode && before.uid === after.uid && before.gid === after.gid && before.size === length && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}
var SourceAccess = class {
  constructor(platform) {
    this.platform = platform;
  }
  platform;
  /** Exact byte snapshots; destination must be a fresh, host-owned private
   * staging directory (the engine uses mkdtemp). No live-source path reopens.
   * Admitted bytes stream to the staging tree one file at a time, so retained
   * live memory is bounded by one bounded file read rather than the whole
   * admitted tree; unchanged files relative to a pinned previous snapshot
   * are reassembled from that private tree, never from live source paths. */
  async captureSourceSnapshot(root, destination, signal, options = {}) {
    const maxFiles = sourceLimit(options.maxFiles, 8e3, "files");
    const maxFileBytes2 = sourceLimit(options.maxFileBytes, 8 * 1024 * 1024, "file bytes");
    const maxBytes = sourceLimit(options.maxBytes, 128 * 1024 * 1024, "total bytes");
    const trustedRulesSha256 = options.trustedRulesSha256;
    if (trustedRulesSha256 !== void 0 && !/^[a-f0-9]{64}$/.test(trustedRulesSha256)) throw new Error("Invalid trusted project rule hash");
    let routePatterns = [];
    const hashes = /* @__PURE__ */ new Map();
    const staged = /* @__PURE__ */ new Set();
    const capFor = (path) => Math.min(maxFileBytes2, /\.(?:proto|graphql|gql)$/i.test(path) ? 8 * 1024 * 1024 : 1024 * 1024);
    const previousRequested = options.previous ?? null;
    const previousPinned = await this.pinPreviousSnapshot(previousRequested);
    const previousHashOf = (path) => previousPinned === null ? void 0 : previousRequested.hashes.get(path);
    const counts = {};
    const examples2 = {};
    let bytes = 0, entries = 0, capped = false;
    const report = (kind, path) => {
      counts[kind] = (counts[kind] ?? 0) + 1;
      const list = examples2[kind] ?? (examples2[kind] = []);
      if (list.length < 20) list.push(path);
    };
    const excluded = (path) => (options.exclude ?? []).some((value) => path === value || path.startsWith(value + "/"));
    const walk = async (directory, prefix, depth) => {
      signal?.throwIfAborted();
      if (depth > 64) {
        report("depthCap", prefix);
        capped = true;
        return;
      }
      const names = [];
      try {
        for await (const name of this.platform.entries(directory)) {
          signal?.throwIfAborted();
          if (++entries > 1e5 || names.length >= 5e4) {
            capped = true;
            report("entryCap", prefix);
            break;
          }
          assertSourceComponent(name);
          names.push(name);
        }
      } catch (error) {
        signal?.throwIfAborted();
        report("unreadableDirectories", prefix);
        return;
      }
      names.sort((a, b) => a === ".fovea" ? -1 : b === ".fovea" ? 1 : a < b ? -1 : a > b ? 1 : 0);
      for (const name of names) {
        signal?.throwIfAborted();
        if (hashes.size >= maxFiles || bytes >= maxBytes) {
          capped = true;
          return;
        }
        const path = prefix ? `${prefix}/${name}` : name;
        assertSourceComponent(name);
        if (name === ".fovea" && (!trustedRulesSha256 || prefix !== "") || prefix === ".fovea" && name !== "rules.json") {
          report("untrustedProjectRules", path);
          continue;
        }
        if ([".tmp", ".fabric", ".kiro"].includes(name) || excluded(path) || discoveryExclusionReason(path) || /(^|\/)(?:\.env(?:\..*)?|\.ssh|\.aws|\.gnupg|\.npmrc|\.netrc)$/.test(path)) {
          report("excluded", path);
          continue;
        }
        let handle;
        try {
          handle = await this.platform.openChild(directory, name, "entry");
        } catch {
          signal?.throwIfAborted();
          report("unavailableOrSymlink", path);
          continue;
        }
        try {
          const before = await handle.stat();
          if (before.isDirectory()) {
            let boundary = false;
            try {
              const marker = await this.platform.openChild(handle, ".git", "entry");
              await marker.close();
              boundary = true;
            } catch (error) {
              boundary = error.code !== "ENOENT";
            }
            if (boundary) {
              report("closedBoundaries", path);
              continue;
            }
            if (entries >= 1e5) {
              report("entryCap", path);
              capped = true;
              continue;
            }
            await walk(handle, path, depth + 1);
            continue;
          }
          if (!before.isFile()) {
            report("notRegular", path);
            continue;
          }
          if (before.nlink !== 1) {
            report("hardlinks", path);
            continue;
          }
          if (!filterSupported([path], routePatterns).length && !/\.(?:svelte|mdx|astro|vue)$/i.test(path)) {
            report("unsupported", path);
            continue;
          }
          const cap = capFor(path);
          if (before.size > cap) {
            report("oversized", path);
            continue;
          }
          const data = await readSourceBounded(handle, cap, signal);
          if (!data) {
            report("oversized", path);
            continue;
          }
          const after = await handle.stat();
          if (!unchangedFile(before, after, data.length)) {
            report("raced", path);
            continue;
          }
          if (bytes + data.length > maxBytes) {
            capped = true;
            report("byteCap", path);
            continue;
          }
          if (path === ".fovea/rules.json") {
            if (sha256(data) !== trustedRulesSha256) throw new Error("Trusted project rules SHA-256 mismatch");
            const parsed = JSON.parse(data.toString("utf8"));
            if (parsed.fileRoutes !== void 0 && (!Array.isArray(parsed.fileRoutes) || parsed.fileRoutes.length > 256)) throw new Error("Project file-route limit");
            routePatterns = (parsed.fileRoutes ?? []).map((rule) => {
              if (typeof rule.re !== "string" || rule.re.length > 1024) throw new Error("Invalid project file-route regex");
              return new RegExp(rule.re);
            });
          }
          if (isGeneratedSourceBytes(path, data)) report("generated", path);
          const hash = sha256(data);
          if (previousHashOf(path) !== hash) {
            await this.stageFile(destination, path, data, signal);
            staged.add(path);
          }
          hashes.set(path, hash);
          bytes += data.length;
        } finally {
          await handle.close();
        }
      }
    };
    const rootHandle = await openSourceDirectory(this.platform, root, signal);
    try {
      await walk(rootHandle, "", 0);
    } finally {
      await rootHandle.close();
    }
    signal?.throwIfAborted();
    if (trustedRulesSha256 && hashes.get(".fovea/rules.json") !== trustedRulesSha256) throw new Error("Trusted project rules missing or unavailable");
    const digest = createHash9("sha256");
    for (const [path, hash] of hashes) digest.update(JSON.stringify([path, hash])).update("\n");
    const id = digest.digest("hex");
    const coverage = { sourceFiles: hashes.size, sourceBytes: bytes, entriesVisited: entries, capped, maxFiles, maxFileBytes: maxFileBytes2, maxBytes, counts, examples: examples2, projectRules: trustedRulesSha256 ? "host-approved-hash" : "untrusted-skipped", trustedRulesSha256 };
    if (previousPinned !== null && previousRequested.id === id && previousRequested.hashes.size === hashes.size && [...hashes].every(([path, hash]) => previousRequested.hashes.get(path) === hash) && await this.previousSnapshotStillPinned(previousPinned)) {
      return { id, root: previousPinned.root, hashes, coverage: { ...coverage, reusedPreviousSnapshot: true } };
    }
    if (previousPinned !== null) {
      if (!await this.previousSnapshotStillPinned(previousPinned)) {
        throw new Error("Previous snapshot became unavailable during capture; retry without it");
      }
      for (const [path, hash] of hashes) {
        if (staged.has(path)) continue;
        signal?.throwIfAborted();
        const data = await this.readPreviousFile(previousPinned.root, path, capFor(path), hash, signal);
        await this.stageFile(destination, path, data, signal);
      }
    }
    return { id, root: destination, hashes, coverage };
  }
  /** Stream one admitted file into the fresh private staging tree. */
  async stageFile(destination, filePath, data, signal) {
    signal?.throwIfAborted();
    const parent = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
    await mkdir(join9(destination, parent), { recursive: true, mode: 448 });
    await writeFile2(join9(destination, filePath), data, { flag: "wx", mode: 256 });
  }
  /** Pin the previous snapshot: its root must exist as a private directory. */
  async pinPreviousSnapshot(previous) {
    if (!previous) return null;
    try {
      const held = await lstat3(previous.root);
      if (!held.isDirectory() || held.isSymbolicLink()) return null;
      return { root: previous.root, dev: held.dev, ino: held.ino };
    } catch {
      return null;
    }
  }
  /** Re-verify the pinned previous snapshot: same directory identity. */
  async previousSnapshotStillPinned(pinned) {
    try {
      const held = await lstat3(pinned.root);
      return held.isDirectory() && !held.isSymbolicLink() && held.dev === pinned.dev && held.ino === pinned.ino;
    } catch {
      return false;
    }
  }
  /** Bounded, no-follow read of one file from the pinned private previous
   * snapshot; the bytes must hash to the live-observed value or the copy
   * fails closed. Never reads from a live source pathname. */
  async readPreviousFile(root, filePath, cap, expectedHash, signal) {
    const segments = filePath.split("/");
    for (const segment of segments) assertSourceComponent(segment);
    let directory = await openSourceDirectory(this.platform, root, signal);
    try {
      for (const segment of segments.slice(0, -1)) {
        const next = await this.platform.openChild(directory, segment, "directory");
        try {
          await directory.close();
        } catch (error) {
          await next.close();
          throw error;
        }
        directory = next;
      }
      const file = await this.platform.openChild(directory, segments.at(-1), "entry");
      try {
        const observed = await file.stat();
        if (!observed.isFile() || observed.nlink !== 1 || observed.size > cap) throw new Error("Previous snapshot file is missing or unsafe");
        const data = await readSourceBounded(file, cap, signal);
        if (!data || sha256(data) !== expectedHash) throw new Error("Previous snapshot bytes do not match the observed hash");
        return data;
      } finally {
        await file.close();
      }
    } finally {
      await directory.close();
    }
  }
  /** Bounded Git shallow-ledger reader; same ancestor/no-follow boundary as capture. */
  async readScopeSafeFile(root, path, maxBytes) {
    sourceLimit(maxBytes, 128 * 1024 * 1024, "metadata bytes");
    const rel = relative5(root, path);
    if (!rel || rel === ".." || rel.startsWith(`..${sep5}`) || isAbsolute5(rel)) throw new Error("Git metadata is outside authorized scope");
    const segments = rel.split(sep5);
    let directory = await openSourceDirectory(this.platform, root);
    try {
      for (const segment of segments.slice(0, -1)) {
        assertSourceComponent(segment);
        const next = await this.platform.openChild(directory, segment, "directory");
        try {
          await directory.close();
        } catch (error) {
          await next.close();
          throw error;
        }
        directory = next;
      }
      const name = segments.at(-1);
      assertSourceComponent(name);
      const file = await this.platform.openChild(directory, name, "entry");
      try {
        const before = await file.stat();
        if (!before.isFile() || before.nlink !== 1 || before.size > maxBytes) throw new Error("Unsafe Git metadata file");
        const bytes = await readSourceBounded(file, maxBytes);
        const after = await file.stat();
        if (!bytes || !unchangedFile(before, after, bytes.length)) throw new Error("Git metadata changed or exceeded its cap");
        return bytes.toString("utf8");
      } finally {
        await file.close();
      }
    } catch (error) {
      if (error.code === "ENOENT") return void 0;
      throw error;
    } finally {
      await directory.close();
    }
  }
};
function relativeStorageExclusion(root, storageRoot) {
  const rel = relative5(root, storageRoot);
  if (!rel) throw new Error("Storage root cannot be the authorized source root");
  return rel !== ".." && !rel.startsWith(`..${sep5}`) && !isAbsolute5(rel) ? [rel.split(sep5).join("/")] : [];
}

// src/fovea/engine.ts
var object = (value) => !!value && typeof value === "object" && !Array.isArray(value);
function strings(value) {
  if (value === void 0) return void 0;
  if (!Array.isArray(value) || value.length > 1e3 || value.some((v) => typeof v !== "string" || v.length > 4096)) throw new Error("Expected bounded string array");
  return value;
}
function number(value, fallback, min, max) {
  if (value === void 0) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error("Numeric argument out of range");
  return value;
}
function cloneStore(store) {
  return new Map([...store].map(([key, value]) => [key, value instanceof WeakMap ? /* @__PURE__ */ new WeakMap() : structuredClone(value)]));
}
var FoveaEngine = class {
  options;
  lifetime = new AbortController();
  tail = Promise.resolve();
  directory;
  parser;
  source;
  git;
  roots = /* @__PURE__ */ new Map();
  conversations = /* @__PURE__ */ new Map();
  preparedSync = /* @__PURE__ */ new Map();
  closed = false;
  constructor(options) {
    this.options = { ...options, parser: { ...options.parser } };
    if (!isAbsolute6(options.storageRoot)) throw new Error("Fovea storageRoot must be absolute");
  }
  query(request, signal) {
    const input = structuredClone(request);
    const combined = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
    const run2 = this.tail.then(async () => {
      if (this.closed) throw new Error("Fovea engine closed");
      combined.throwIfAborted();
      const result = await this.execute(input, combined);
      combined.throwIfAborted();
      return result;
    });
    this.tail = run2.catch(() => void 0);
    return run2;
  }
  /** Private lifecycle control: no source access, parser initialization or graph
   * invalidation. Serialized with queries so a late query cannot resurrect state. */
  retireConversation(conversationId, conversationEpoch) {
    const run2 = this.tail.then(() => {
      if (this.closed) throw new Error("Fovea engine closed");
      if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(conversationId) || !Number.isSafeInteger(conversationEpoch) || conversationEpoch < 0) throw new Error("Invalid Fovea retirement owner");
      for (const map of [this.conversations, this.preparedSync]) for (const key of map.keys()) {
        const owner = JSON.parse(key);
        if (owner[0] === conversationId && owner[1] === conversationEpoch) map.delete(key);
      }
    });
    this.tail = run2.catch(() => void 0);
    return run2;
  }
  async initialize(signal) {
    if (this.parser) return;
    await mkdir2(this.options.storageRoot, { recursive: true, mode: 448 });
    const info = await lstat4(this.options.storageRoot);
    if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 63 || info.uid !== process.getuid?.() || await realpath2(this.options.storageRoot) !== this.options.storageRoot) {
      throw new Error("Fovea storageRoot must be canonical, private, and owned");
    }
    const directory = await mkdtemp(join10(this.options.storageRoot, "engine-"));
    try {
      const parser = await resolveParserDescriptor(this.options.parser, directory, signal);
      let git;
      if (this.options.gitPath) {
        const bytes = await readVerifiedExecutable(this.options.gitPath);
        git = join10(directory, "git");
        await writeFile3(git, bytes, { flag: "wx", mode: 320 });
      }
      const source = new SourceAccess(process.platform === "darwin" ? await loadManagedSourcePlatform(this.options.parser, directory) : sourcePlatform());
      signal.throwIfAborted();
      this.directory = directory;
      this.parser = parser;
      this.git = git;
      this.source = source;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
  async execute(request, signal) {
    const { operation, args } = request;
    if (!["sketch", "focus", "dwell", "impact", "status", "anchors", "rules", "reset", "reload", "sync"].includes(operation)) throw new Error(`Unsupported Fovea operation: ${operation}`);
    if (!object(args) || !request.conversationId || !request.rootId || !Number.isSafeInteger(request.conversationEpoch) || request.conversationEpoch < 0 || !Number.isSafeInteger(request.authorizationEpoch) || request.authorizationEpoch < 0) throw new Error("Invalid engine request identity");
    const identity = await lstat4(request.root, { bigint: true });
    if (!identity.isDirectory() || identity.isSymbolicLink()) throw new Error("Fovea root must be a physical directory");
    const rootKey2 = JSON.stringify([request.root, String(identity.dev), String(identity.ino)]);
    const conversationKey = JSON.stringify([request.conversationId, request.conversationEpoch, rootKey2]);
    if (operation === "sync" && args.commitPreparationId !== void 0) {
      const prepared = this.preparedSync.get(conversationKey);
      if (!prepared || prepared.id !== args.commitPreparationId) throw new Error("Unknown or superseded sync preparation");
      signal.throwIfAborted();
      const current2 = this.conversations.get(conversationKey);
      const navigation = current2?.store.get("session.ts:sessions");
      if (navigation) prepared.conversation.store.set("session.ts:sessions", navigation);
      if (current2) {
        prepared.conversation.focuses = current2.focuses;
        prepared.conversation.active = current2.active;
      }
      this.conversations.set(conversationKey, prepared.conversation);
      this.preparedSync.delete(conversationKey);
      return { status: "ok", deliveryAccounting: "acknowledged", syncPreparationId: prepared.id };
    }
    if (operation === "status") return {
      status: "ok",
      initialized: !!this.parser,
      roots: this.roots.size,
      hotRoots: [...this.roots.values()].filter((r) => r.hot).length,
      rootLimit: 32,
      hotRootLimit: 2,
      conversationLoaded: this.conversations.has(conversationKey),
      parser: { version: this.options.parser.version, sha256: this.options.parser.sha256, verified: !!this.parser },
      sourceAccess: this.source || process.platform === "linux" ? "descriptor-relative" : "requires-managed-native-binding",
      gitConfigured: !!this.options.gitPath
    };
    if (operation === "reset" || operation === "reload") {
      signal.throwIfAborted();
      this.conversations.delete(conversationKey);
      this.preparedSync.delete(conversationKey);
      if (operation === "reload") this.roots.get(rootKey2)?.store.clear();
      return { status: "ok", operation, reset: "conversation-root", ...operation === "reload" ? { graphInvalidated: true } : {} };
    }
    await this.initialize(signal);
    if (!isAbsolute6(request.root) || await realpath2(request.root) !== request.root) throw new Error("Fovea root must be canonical");
    let root = this.roots.get(rootKey2);
    if (!root) {
      if (this.roots.size >= 32) {
        const oldest = this.roots.keys().next().value;
        await this.retireRoot(oldest, true);
      }
      root = { path: join10(this.directory, `root-${randomUUID2()}`), store: /* @__PURE__ */ new Map(), hot: false, gap: true };
      this.roots.set(rootKey2, root);
    }
    this.roots.delete(rootKey2);
    this.roots.set(rootKey2, root);
    if (!root.hot) {
      const hot = [...this.roots.entries()].filter(([, r]) => r.hot);
      if (hot.length >= 2) await this.retireRoot(hot[0][0], false);
      root.hot = true;
    }
    if (operation === "dwell" && root.gap && !this.conversations.has(conversationKey)) throw new Error("Unknown or expired focusId after root retirement; focus again");
    const original = this.conversations.get(conversationKey) ?? { store: /* @__PURE__ */ new Map(), focuses: /* @__PURE__ */ new Map(), active: "" };
    if (!this.conversations.has(conversationKey) && this.conversations.size >= 128) throw new Error("Fovea conversation capacity reached");
    const conversation = { store: cloneStore(original.store), focuses: new Map(original.focuses), active: original.active };
    const transient = args.transient === true;
    let focusId = typeof args.focusId === "string" ? args.focusId : conversation.active;
    if (typeof args.focusId === "string" && !conversation.focuses.has(args.focusId)) throw new Error("Unknown or expired conversation-owned focusId");
    if (operation === "focus" && (!focusId || args.fresh === true)) focusId = randomUUID2();
    if (!focusId) focusId = "transient";
    const stage = await mkdtemp(join10(this.directory, "snapshot-"));
    const ctx = {
      store: root.store,
      sessionStore: conversation.store,
      parserPath: this.parser.path,
      storageRoot: this.directory,
      sourceRoot: request.root,
      snapshotRoot: root.path,
      gitPath: this.git,
      readGitMetadata: async (path) => {
        signal.throwIfAborted();
        const text = await this.source.readScopeSafeFile(request.root, resolve5(request.root, path), 1024 * 1024);
        if (text === void 0) throw new Error("Git shallow metadata unavailable");
        return text;
      },
      signal,
      gitFailures: [],
      focusKey: focusId,
      spills: /* @__PURE__ */ new Map(),
      artifactLabel: (operation2) => `retained:${operation2}`
    };
    return coreContext.run(ctx, async () => {
      try {
        const snapshot2 = await this.source.captureSourceSnapshot(request.root, stage, signal, {
          exclude: relativeStorageExclusion(request.root, this.options.storageRoot),
          trustedRulesSha256: typeof args.trustedRulesSha256 === "string" ? args.trustedRulesSha256 : void 0,
          ...root.snapshotId && root.snapshotHashes ? { previous: { id: root.snapshotId, root: root.path, hashes: root.snapshotHashes } } : {}
        });
        signal.throwIfAborted();
        const snapshotReused = snapshot2.root === root.path && root.snapshotId === snapshot2.id;
        if (!snapshotReused) {
          await rm(root.path, { recursive: true, force: true });
          await rename2(stage, root.path);
        }
        const head = this.git ? await gitHead(root.path) : void 0;
        const warm = snapshotReused && head === root.head ? getState(root.path) : void 0;
        const state = warm ?? await ensureState(root.path, { force: true, hints: [...snapshot2.hashes.keys()] });
        signal.throwIfAborted();
        root.snapshotId = snapshot2.id;
        root.snapshotHashes = snapshot2.hashes;
        root.head = head;
        signal.throwIfAborted();
        const budget = number(args.maxTokens ?? args.budget, 512, operation === "sync" ? 128 : 256, operation === "sync" ? 8192 : 16e3);
        let result;
        if (operation === "anchors" || operation === "rules") {
          if (args.adopt !== void 0 || args.rules !== void 0 || args.action === "adopt") throw new Error("Rule adoption is not implemented; inspect rules only");
          const offset = Math.floor(number(args.offset, 0, 0, 1e6));
          const limit = Math.floor(number(args.limit, 100, 1, 1e3));
          let value;
          if (operation === "anchors") {
            const filter = typeof args.filter === "string" ? args.filter : "";
            const anchorKey = (anchor2) => `${anchor2.kind}	${anchor2.id}	${anchor2.file}:${anchor2.line}`;
            const rows = state.graph.anchors.map((anchor2) => [anchorKey(anchor2), anchor2]).filter(([key, anchor2]) => (!args.discovered || anchor2.implicit) && (!filter || key.includes(filter))).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0).map(([, anchor2]) => anchor2);
            value = { anchors: rows.slice(offset, offset + limit), total: rows.length, offset, limit, truncated: offset + limit < rows.length };
          } else {
            const sigs = aggregateFiles(Object.fromEntries(Object.entries(state.facts).map(([file, facts]) => [file, facts.sigs])));
            const hypotheses = promote(sigs, DEFAULT_PACK);
            const rows = args.sigs === true ? sigs.filter((s) => s.pathN > 0).sort((a, b) => posterior(b.pathN, b.n) - posterior(a.pathN, a.n)) : hypotheses;
            const pack = await loadRepoRules(root.path);
            value = {
              rules: rows.slice(offset, offset + limit),
              total: rows.length,
              offset,
              limit,
              truncated: offset + limit < rows.length,
              inventory: { rules: pack.pack.slice(offset, offset + limit), totalRules: pack.pack.length, fileRoutes: pack.fileRoutes.slice(offset, offset + limit), totalFileRoutes: pack.fileRoutes.length, offset, limit, truncated: offset + limit < Math.max(pack.pack.length, pack.fileRoutes.length) },
              rulePackSha: pack.sha,
              readOnly: true,
              trust: args.trustedRulesSha256 ? "host-approved-hash" : "built-in-only",
              hypotheses: true
            };
          }
          signal.throwIfAborted();
          return { status: "ok", ...boundResultDetails(value), sourceSnapshotId: snapshot2.id, graphGeneration: state.generation, coverage: snapshot2.coverage };
        }
        if (operation === "sync") {
          const attention2 = strings(args.files);
          if (attention2?.length) observeSessionPaths(root.path, attention2);
          const navigationBeforePush = conversation.store.get("session.ts:sessions");
          const savedNavigation = navigationBeforePush ? structuredClone(navigationBeforePush) : void 0;
          const native = await this.bridgeProvenance(request, root, conversation, snapshot2.hashes, state.facts, String(identity.dev), String(identity.ino));
          let outcome;
          try {
            outcome = await sync(root.path, {
              files: strings(args.files),
              budget,
              steerThreshold: number(args.steerThreshold, 0.15, 0, 1e6),
              pushFocus: args.pushFocus !== false,
              scope: args.scope === "repository" ? "repository" : "session",
              sessionId: native.origin
            }, state, { current: () => !signal.aborted });
          } finally {
            await Promise.all(native.paths.map((p) => rm(p, { force: true })));
          }
          conversation.store.set("native:provenance", { hashes: new Map(snapshot2.hashes), sequence: native.sequence });
          signal.throwIfAborted();
          if (savedNavigation) conversation.store.set("session.ts:sessions", savedNavigation);
          else conversation.store.delete("session.ts:sessions");
          const observationGap = native.gap || root.gap;
          let syncPreparationId;
          if (!transient && outcome.red) {
            syncPreparationId = randomUUID2();
            this.preparedSync.set(conversationKey, { id: syncPreparationId, conversation });
            while (this.preparedSync.size > 128) this.preparedSync.delete(this.preparedSync.keys().next().value);
          } else if (!transient) {
            root.gap = false;
            this.conversations.set(conversationKey, conversation);
            this.preparedSync.delete(conversationKey);
          }
          return {
            observationGap,
            syncPreparationId,
            deliveryAccounting: outcome.red ? "prepared" : "silent-baseline",
            status: "ok",
            ...outcome,
            details: boundResultDetails(outcome.details),
            text: this.cleanText(outcome.text ?? ""),
            estimatedTokens: outcome.tokens,
            sourceSnapshotId: snapshot2.id,
            graphGeneration: state.generation,
            coverage: { ...snapshot2.coverage, gitFailures: [...new Set(ctx.gitFailures)].slice(0, 10) }
          };
        }
        if (operation === "sketch") result = await sketch(root.path, budget, state);
        else if (operation === "focus") {
          if (typeof args.query !== "string" || !args.query.trim() || args.query.length > 4096) throw new Error("focus requires a bounded query");
          const options = {};
          if (typeof args.path === "string") options.path = args.path;
          if (typeof args.language === "string") options.language = args.language;
          if (typeof args.kind === "string") options.kind = args.kind;
          if (args.fresh === true) options.fresh = true;
          result = await focus(root.path, args.query, budget, options, state);
        } else if (operation === "dwell") result = await dwell(root.path, number(args.factor, 2, 1, 64), budget, state);
        else {
          if ((args.base !== void 0 || args.includeUncommitted !== false) && !this.git) throw new Error("Git-backed impact requires an explicit verified gitPath; use includeUncommitted:false for what-if analysis");
          result = await impact(root.path, {
            files: strings(args.files),
            symbols: strings(args.symbols),
            includeUncommitted: args.includeUncommitted !== false,
            ...typeof args.base === "string" ? { base: args.base } : {},
            budget
          }, state);
        }
        signal.throwIfAborted();
        const details = { ...result.details };
        delete details.overflowPath;
        const retained = [...ctx.spills.values()];
        if (retained.length) {
          details.fullText = retained.join("\n").slice(0, 2e5);
          details.retentionCapped = retained.some((text) => text.length >= 2e5);
        }
        const reads = [];
        const deferredReads = [];
        if (Array.isArray(details.suggestedReads)) for (const read of details.suggestedReads) {
          if (object(read) && typeof read.path === "string" && typeof read.offset === "number" && typeof read.limit === "number") {
            const hash = snapshot2.hashes.get(read.path);
            if (hash && Number.isSafeInteger(read.offset) && read.offset > 0 && Number.isSafeInteger(read.limit) && read.limit > 0) {
              for (let offset = read.offset, remaining = read.limit; remaining > 0; offset += 2e3, remaining -= 2e3) {
                const window = { path: read.path, offset, limit: Math.min(2e3, remaining), expectedSha256: hash };
                if (reads.length < 64) reads.push(window);
                else if (deferredReads.length < 960) deferredReads.push(window);
                else {
                  details.readWindowRetentionCapped = true;
                  break;
                }
              }
            }
          }
        }
        details.suggestedReads = reads;
        if (deferredReads.length) {
          details.readsDeferred = true;
          details.deferredReads = deferredReads;
        }
        details.snapshotReused = snapshotReused;
        details.observationGap = root.gap;
        const boundedDetails = boundResultDetails(details);
        const packet = {
          text: this.cleanText(result.text),
          estimatedTokens: Math.ceil(this.cleanText(result.text).length / 4),
          details: boundedDetails,
          reads,
          coverage: boundResultDetails({ ...object(details.coverage) ? details.coverage : {}, source: snapshot2.coverage, gitFailures: [...new Set(ctx.gitFailures)].slice(0, 10) }, 1e5, 4e3),
          sourceSnapshotId: snapshot2.id,
          graphGeneration: state.generation,
          status: details.seeds === 0 ? "no-match" : "ok",
          truncated: details.truncated === true || boundedDetails.detailsTruncated === true
        };
        if ((operation === "focus" || operation === "dwell") && packet.status === "ok" && !transient) {
          const revision = (conversation.focuses.get(focusId) ?? 0) + 1;
          conversation.focuses.set(focusId, revision);
          conversation.active = focusId;
          while (conversation.focuses.size > 32) conversation.focuses.delete(conversation.focuses.keys().next().value);
          packet.focusId = focusId;
          packet.focusRevision = revision;
        }
        signal.throwIfAborted();
        if (!transient) this.conversations.set(conversationKey, conversation);
        return packet;
      } catch (error) {
        root.store.clear();
        delete root.snapshotId;
        delete root.snapshotHashes;
        throw error;
      } finally {
        await rm(stage, { recursive: true, force: true });
        if (signal.aborted) {
          root.store.clear();
          delete root.snapshotId;
          delete root.snapshotHashes;
          this.preparedSync.delete(conversationKey);
          if (original.active || original.store.size) this.conversations.set(conversationKey, original);
          else this.conversations.delete(conversationKey);
          signal.throwIfAborted();
        }
      }
    });
  }
  async retireRoot(key, remove) {
    const root = this.roots.get(key);
    if (!root) return;
    const timers = root.store.get("build.ts:persistDebounce");
    if (timers instanceof Map) for (const timer of timers.values()) clearTimeout(timer);
    root.store.clear();
    root.hot = false;
    root.gap = true;
    delete root.snapshotId;
    delete root.snapshotHashes;
    delete root.head;
    for (const conversationKey of this.conversations.keys()) if (JSON.parse(conversationKey)[2] === key) this.conversations.delete(conversationKey);
    for (const conversationKey of this.preparedSync.keys()) if (JSON.parse(conversationKey)[2] === key) this.preparedSync.delete(conversationKey);
    await rm(root.path, { recursive: true, force: true });
    if (remove) this.roots.delete(key);
  }
  /** Adapt only exact captured SHA-256 endpoints to core's SHA-1 fact IDs.
   * Intermediate identities are tagged SHA-256 tokens, never claimed as SHA-1.
   * Core v1 journal records are engine-private, ephemeral inputs to the unchanged
   * native core chain classifier. Only the host journal is shared across hosts. */
  async bridgeProvenance(request, root, conversation, hashes, facts, dev, ino) {
    const input = request.args.nativeProvenance;
    const origin = object(input) && typeof input.origin === "string" && /^[a-f0-9]{64}$/u.test(input.origin) ? input.origin : "unobserved";
    const result = { paths: [], origin, sequence: 0, gap: origin === "unobserved" || !object(input) || input.gap === true };
    if (!object(input) || !object(input.journal)) return result;
    const worktree = createHash10("sha256").update(`${request.root}\0${dev}\0${ino}`).digest("hex");
    let journal;
    try {
      journal = validateProvenanceJournal(input.journal, worktree);
    } catch {
      result.gap = true;
      return result;
    }
    result.sequence = journal.sequence;
    const previous = conversation.store.get("native:provenance");
    const baseline = syncBaselineStore().get(root.path);
    if (!previous || !baseline) return result;
    if (previous.sequence > journal.sequence || previous.sequence < journal.sequence - journal.records.length) {
      result.gap = true;
      return result;
    }
    if (result.gap) return result;
    const mapHash = (file, hash) => {
      if (hash === null) return void 0;
      if (hash === previous.hashes.get(file) && baseline.shas.has(file)) return baseline.shas.get(file);
      if (hash === hashes.get(file) && facts[file]) return facts[file].sha1;
      return `sha256:${hash}`;
    };
    const byOwner = /* @__PURE__ */ new Map();
    const at = Date.now();
    for (const r of journal.records) {
      if (r.sequence <= previous.sequence) continue;
      const owner = createHash10("sha1").update(r.origin).digest("hex").slice(0, 16);
      const rows = byOwner.get(r.origin) ?? [];
      rows.push({
        file: r.path,
        beforeSha: mapHash(r.path, r.beforeSha256),
        afterSha: mapHash(r.path, r.afterSha256),
        owner,
        toolCallId: String(r.sequence),
        commitOrder: r.sequence,
        at: at + (r.sequence - previous.sequence) / 1e3
      });
      byOwner.set(r.origin, rows);
    }
    try {
      for (const [ownerOrigin, records] of byOwner) {
        const target = provenancePathFor(root.path, ownerOrigin);
        result.paths.push(target);
        await writeAtomicTemp(target, JSON.stringify({ version: 1, root: root.path, owner: createHash10("sha1").update(ownerOrigin).digest("hex").slice(0, 16), records }), 128e3);
      }
    } catch {
      await Promise.all(result.paths.map((p) => rm(p, { force: true })));
      result.paths = [];
      result.gap = true;
    }
    return result;
  }
  cleanText(text) {
    return text.replace(/full list saved to retained:[a-z]+/g, "full list retained in result");
  }
  async close() {
    if (!this.closed) {
      this.closed = true;
      this.lifetime.abort(new Error("Fovea engine closed"));
    }
    await this.tail;
    for (const key of [...this.roots.keys()]) await this.retireRoot(key, true);
    this.roots.clear();
    this.conversations.clear();
    this.preparedSync.clear();
    if (this.directory) await rm(this.directory, { recursive: true, force: true });
  }
};

// src/fovea/engine-entry.ts
var engine;
var current;
var closing = false;
var seen = /* @__PURE__ */ new Set();
var send = (response) => {
  if (process.connected) process.send?.(encodeFrame(response));
};
var safeError = (error) => (error instanceof Error ? error.message : "Fovea engine failure").replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 800);
var shutdown = async () => {
  if (closing) return;
  closing = true;
  current?.controller.abort();
  await engine?.close();
  process.exit(0);
};
process.once("disconnect", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
process.on("message", (raw) => {
  void (async () => {
    const message = decodeRequest(raw);
    if (message.type === "cancel") {
      if (message.id === current?.id) current.controller.abort(new Error("Fovea request cancelled"));
      return;
    }
    if (message.type === "shutdown") {
      await shutdown();
      return;
    }
    if (closing || seen.has(message.id) || current) throw new Error("Fovea replay or concurrent request rejected");
    seen.add(message.id);
    if (seen.size > 1024) seen.delete(seen.values().next().value);
    if (message.type === "initialize") {
      if (engine) throw new Error("Fovea already initialized");
      engine = new FoveaEngine(message.options);
      send({ version: 1, id: message.id, ok: true, value: { initialized: true, ipcVersion: 1 } });
      return;
    }
    if (!engine) throw new Error("Fovea not initialized");
    if (message.type === "retireConversation") {
      current = { id: message.id, controller: new AbortController() };
      try {
        await engine.retireConversation(message.conversationId, message.conversationEpoch);
        send({ version: 1, id: message.id, ok: true, value: { retired: true } });
      } finally {
        current = void 0;
      }
      return;
    }
    const controller = new AbortController();
    current = { id: message.id, controller };
    const timer = setTimeout(() => controller.abort(new Error("Fovea worker deadline expired")), message.remainingMs);
    try {
      const value = projectEngineJson(await engine.query(message.request, controller.signal));
      controller.signal.throwIfAborted();
      send({ version: 1, id: message.id, ok: true, value });
    } catch (error) {
      send({ version: 1, id: message.id, ok: false, error: safeError(error) });
    } finally {
      clearTimeout(timer);
      current = void 0;
    }
  })().catch(() => {
    void shutdown();
  });
});
