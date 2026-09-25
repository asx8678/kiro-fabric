// W6 runtime boundary fixture helpers. Source bundling and worker/time injection
// only; no production module is edited and every generated file stays under the
// case-owned fixture root. QuickJsRuntime itself is the real class from source.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

/** @type {import("esbuild").BuildOptions} */
const COMMON = {
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node24",
  write: false,
  logLevel: "silent",
};

/** Real production classes from source for store/lock boundary cases. */
export async function loadRuntimeSource(context) {
  const entries = [
    ["StateProvider", "src/providers/state-provider.ts"],
    ["FabricDeadline", "src/runtime/deadline.ts"],
    ["FABRIC_COMMIT_ACKNOWLEDGEMENT", "src/protocol.ts"],
    ["normalizeFabricConfig", "src/config.ts"],
  ];
  const contents = entries
    .map(([symbol, file]) => `export { ${symbol} } from ${JSON.stringify(path.join(context.root, file))};`)
    .join("\n");
  const result = await build({ ...COMMON, stdin: { contents, resolveDir: context.root } });
  const file = path.join(context.fixturesRoot, "w6-runtime-source-api.mjs");
  fs.writeFileSync(file, result.outputFiles[0].contents, { flag: "wx", mode: 0o600 });
  return await import(pathToFileURL(file).href);
}

// Virtual worker_threads module. The real QuickJsRuntime class is bundled but
// receives this deterministic Worker, so none of its pool/fault/idle logic is
// replaced. Tests drive replies explicitly.
const WORKER_MOCK = `
class Emitter {
  #listeners = new Map();
  on(type, listener) { const list = this.#listeners.get(type) ?? []; list.push(listener); this.#listeners.set(type, list); return this; }
  once(type, listener) { const wrap = (...args) => { this.removeListener(type, wrap); listener(...args); }; return this.on(type, wrap); }
  removeListener(type, listener) { const list = this.#listeners.get(type); if (!list) return this; const at = list.indexOf(listener); if (at >= 0) list.splice(at, 1); return this; }
  emit(type, ...args) { for (const listener of [...(this.#listeners.get(type) ?? [])]) listener(...args); }
}
const instances = [];
export const runHooks = { current: null };
export class Worker extends Emitter {
  constructor(url, options = {}) { super(); this.url = String(url); this.options = options; this.messages = []; this.terminated = false; this.unrefed = false; this.onRun = undefined; instances.push(this); }
  unref() { this.unrefed = true; }
  postMessage(message) { this.messages.push(message); if (message && message.type === "run") (this.onRun ?? runHooks.current)?.(this, message); }
  terminate() { this.terminated = true; return Promise.resolve(0); }
  reply(message) { this.emit("message", message); }
  crash(message) { this.emit("error", new Error(message)); }
  exit(code = 1) { this.emit("exit", code); }
}
export const workers = instances;
export function resetWorkers() { instances.length = 0; }
`;

/** Bundle the real QuickJsRuntime with an injected, controllable Worker. */
export async function loadRuntimeMock(context) {
  const quickjs = path.join(context.root, "src/runtime/quickjs-runtime.ts");
  const contents = [
    `export { QuickJsRuntime } from ${JSON.stringify(quickjs)};`,
    'export * from "w6-worker-mock";',
  ].join("\n");
  const result = await build({
    ...COMMON,
    stdin: { contents, resolveDir: context.root },
    plugins: [{
      name: "w6-worker-mock",
      setup(builder) {
        const resolve = () => ({ path: "w6-worker-mock", namespace: "w6-worker-mock" });
        builder.onResolve({ filter: /^w6-worker-mock$/ }, resolve);
        builder.onResolve({ filter: /^node:worker_threads$/ }, resolve);
        builder.onLoad({ filter: /.*/, namespace: "w6-worker-mock" }, () => ({ contents: WORKER_MOCK, loader: "js" }));
      },
    }],
  });
  const file = path.join(context.fixturesRoot, "w6-runtime-mock-api.mjs");
  fs.writeFileSync(file, result.outputFiles[0].contents, { flag: "wx", mode: 0o600 });
  return await import(pathToFileURL(file).href);
}

/** Capture-only timer replacement. Microtasks stay real; only setTimeout is
 * intercepted. Returned timers keep the production .unref contract. */
export function fakeClock() {
  const saved = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const timers = new Set();
  /** @type {any} */ (globalThis).setTimeout = (callback, delay = 0, ...args) => {
    const timer = { callback: () => callback(...args), delay, unref() { return this; } };
    timers.add(timer);
    return timer;
  };
  /** @type {any} */ (globalThis).clearTimeout = (timer) => { timers.delete(timer); };
  return {
    delays: () => [...timers].map((timer) => timer.delay).sort((a, b) => a - b),
    fireDelay(delay) {
      const due = [...timers].filter((timer) => timer.delay === delay);
      for (const timer of due) { timers.delete(timer); timer.callback(); }
      return due.length;
    },
    restore() { globalThis.setTimeout = saved.setTimeout; globalThis.clearTimeout = saved.clearTimeout; timers.clear(); },
  };
}
