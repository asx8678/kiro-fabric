// Source HANDLER fixture. Only native/external boundaries are inert; ownership logic is real.
// Every generated file is retained beneath the project's .tmp; there is no teardown deletion.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

/** @typedef {{root:string, fixturesRoot:string, handlerSource?:string}} HandlerContext */

// This virtual module is fresh for every variant, including its hook state. It
// substitutes dependencies, never createKiroMcpServer or any handler function.
const inertBoundaries = `
export let hooks = {};
export const events = [];
export const servers = [];
export function configure(value) { hooks = value; }
function invoke(name, ...args) { events.push(name); return hooks[name]?.(...args); }
export class Server {
  requests = new Map(); notifications = new Map();
  constructor() { servers.push(this); }
  setRequestHandler(schema, fn) { this.requests.set(schema, fn); }
  setNotificationHandler(schema, fn) { this.notifications.set(schema, fn); }
  getClientCapabilities() { return {}; }
  connect(transport) { return invoke('connect', transport); }
  close() { return invoke('server.close'); }
  elicitInput() { throw new Error('fixture forbids interactive elicitation'); }
  listRoots() { throw new Error('fixture requires explicit workspace context'); }
}
export class StdioServerTransport {
  send() { throw new Error('fixture forbids transport I/O'); }
}
export class FoveaHost {
  bind(identity) {
    invoke('bind', identity);
    return { observer: {}, close: () => invoke('client.close', identity) };
  }
  retireConversation(...args) { return invoke('retire', ...args); }
  close() { return invoke('fovea.close'); }
}
export class FoveaResponseDelivery {
  close() { return invoke('delivery.close'); }
  send() { throw new Error('fixture forbids delivery I/O'); }
  track() { throw new Error('fixture has no analysis delivery'); }
}
export function collectFoveaContext() { throw new Error('fixture forbids analysis'); }
export const DISABLED_TRACER = { enabled: false, close: () => invoke('tracer.close') };
export function resolveTraceEnabled() { return false; }
export function createFabricTracer() { throw new Error('fixture forbids trace files/sweeping'); }
export function createKiroRuntime() { throw new Error('fixture requires inert prepareRuntime'); }
`;

/** @param {HandlerContext} context @param {string} label */
export async function loadHandlerFixture(context, label) {
  const temporary = fs.realpathSync(path.join(context.root, ".tmp"));
  const parent = fs.realpathSync(context.fixturesRoot);
  const relative = path.relative(temporary, parent);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "handler fixtures must live under project .tmp");
  const directory = fs.mkdtempSync(path.join(parent, `${label}-`));
  const sourcePath = path.join(context.root, "src/kiro/mcp-server.ts");
  const source = fs.readFileSync(context.handlerSource ?? sourcePath, "utf8");
  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  fs.writeFileSync(path.join(directory, "mcp-server-source.ts"), source, { flag: "wx", mode: 0o600 });
  const replaced = new Set([
    "@modelcontextprotocol/sdk/server/index.js", "@modelcontextprotocol/sdk/server/stdio.js",
    "../fovea/host.js", "./fovea-context.js", "../trace/tracer.js", "./runtime.js",
  ]);
  const entry = [
    `export { createKiroMcpServer } from ${JSON.stringify(sourcePath)};`,
    `export { KiroHostSessionAdapter } from ${JSON.stringify(path.join(context.root, "src/kiro/host-session-adapter.ts"))};`,
    `export { normalizeFabricConfig } from ${JSON.stringify(path.join(context.root, "src/config.ts"))};`,
    `export { KIRO_MCP_DRAIN_TIMEOUT_MS } from ${JSON.stringify(path.join(context.root, "src/kiro/deadlines.ts"))};`,
    'export { CallToolRequestSchema, ListToolsRequestSchema, RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";',
    'export * from "handler-inert-boundaries";',
  ].join("\n");
  const built = await build({ stdin: { contents: entry, resolveDir: context.root }, bundle: true,
    packages: "external", platform: "node", format: "esm", target: "node24", write: false, logLevel: "silent",
    plugins: [{ name: "inert-handler-boundaries", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (args.path === "handler-inert-boundaries" || [sourcePath, path.join(context.root, "src/kiro/mcp-session.ts"), path.join(context.root, "src/kiro/mcp-execution.ts")].includes(args.importer) && replaced.has(args.path)) {
          return { path: "boundaries", namespace: "handler-fixture" };
        }
        return undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: "handler-fixture" }, () => ({ contents: inertBoundaries, loader: "js" }));
      builder.onLoad({ filter: /[/\\]kiro[/\\]mcp-server\.ts$/ }, () => ({ contents: source, loader: "ts", resolveDir: path.dirname(sourcePath) }));
    } }],
  });
  const moduleFile = path.join(directory, "handler-source.mjs");
  fs.writeFileSync(moduleFile, built.outputFiles[0].contents, { flag: "wx", mode: 0o600 });
  const api = await import(pathToFileURL(moduleFile).href);
  const roots = Object.fromEntries(["runtime", "data", "workspace", "other-workspace"].map(name => {
    const file = path.join(directory, name); fs.mkdirSync(file, { mode: 0o700 }); return [name, file];
  }));
  let snapshot = { status: "verified", roots: [{ uri: pathToFileURL(roots.workspace).href }] };
  const workspaceContext = { current: async () => snapshot, invalidate() {} };
  const runtimeOptions = [];
  const runtimes = [];
  /** @type {Record<string, (...args:any[])=>any>} */ const hooks = {};
  api.configure(hooks);
  const config = api.normalizeFabricConfig({ approvals: { read: "allow" } });
  const makeRuntime = (options) => {
    const runtime = {
      service: {
        cwd: options.cwd, config,
        invalidateCatalogs() { api.events.push("invalidate"); return hooks.invalidate?.(runtime); },
        bindCatalog(value) { api.events.push("catalog.bind"); return hooks["catalog.bind"]?.(value); },
        execute(args) { api.events.push("execute"); return hooks.execute?.(args) ?? Promise.resolve(success()); },
      },
      registry: { list: async () => [] }, providers: () => [],
      artifacts: { write() { throw new Error("fixture forbids artifact writes"); } },
      close() { api.events.push("runtime.close"); return hooks["runtime.close"]?.(runtime); },
    };
    runtimes.push(runtime);
    return runtime;
  };
  const options = { runtimeRoot: roots.runtime, dataRoot: roots.data, version: "0.0.0-fixture", workspaceContext,
    prepareRuntime: (options) => { runtimeOptions.push(options); return hooks.factory ? hooks.factory(options, makeRuntime) : makeRuntime(options); },
  };
  let requestId = 0;
  /** @param {string} [name] @param {Record<string,any>} [args] @param {any} [adapter] @param {any} [turn] */
  const call = (name = "fabric_exec", args = { code: "return 1" }, adapter, turn) => {
    const id = ++requestId;
    if (adapter && turn) adapter.associateRequest(id, turn);
    const handler = api.servers[0].requests.get(api.CallToolRequestSchema);
    assert.equal(typeof handler, "function", "dispatch the actual registered handler");
    return handler({ method: "tools/call", params: { name, arguments: args } }, { requestId: id, signal: new AbortController().signal });
  };
  return { api, hooks, options, call, roots, directory, sourceSha256, runtimeOptions, runtimes, makeRuntime, workspaceContext,
    changeWorkspace() { snapshot = { status: "verified", roots: [{ uri: pathToFileURL(roots["other-workspace"]).href }] }; },
    count: name => api.events.filter(event => event === name).length,
    evidence: () => ({ fixture: directory, sourceSha256, events: [...api.events] }),
  };
}

/** A service result, not a fabricated handler outcome: the real handler projects it. */
export function success() { return { success: true, status: "succeeded", value: 1, audits: [], logs: [], durationMs: 0 }; }

export function deferred() {
  /** @type {(value?:any)=>void} */ let resolve;
  /** @type {(error?:any)=>void} */ let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

/** @param {()=>any} operation */
export function observe(operation) {
  const state = { settled: false, failed: false, threw: false, error: /** @type {any} */ (undefined), value: /** @type {any} */ (undefined) };
  let promise;
  try { promise = operation(); } catch (error) { state.threw = true; promise = Promise.reject(error); }
  const done = Promise.resolve(promise).then(value => { state.settled = true; state.value = value; }, error => {
    state.settled = true; state.failed = true; state.error = error;
  });
  return { promise, state, done };
}

/** @param {unknown} error @returns {unknown[]} */
export function errorLeaves(error) { return error instanceof AggregateError ? error.errors.flatMap(errorLeaves) : [error]; }

/** @param {ReturnType<typeof observe>} operation @param {Error[]} expected */
export async function failsWith(operation, expected) {
  await operation.done;
  assert.equal(operation.state.failed, true, "cleanup must reject");
  const leaves = errorLeaves(operation.state.error);
  for (const error of expected) assert.ok(leaves.includes(error), `original error identity lost: ${error.message}`);
}

// Event-loop barrier drains microtasks without sleeping or advancing time.
export const barrier = () => new Promise(resolve => setImmediate(resolve));

// Scope this to a variant's execution window, after esbuild. Real settleWithin
// schedules its real production bound; the test fires that timer, not a replacement
// implementation of settleWithin. Guest execute remains pending across the firing.
export function fakeClock() {
  const saved = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const timers = new Map();
  globalThis.setTimeout = /** @type {any} */ ((callback, delay, ...args) => {
    const timer = { callback: () => callback(...args), delay, unref() { return this; } };
    timers.set(timer, timer); return timer;
  });
  globalThis.clearTimeout = /** @type {any} */ (timer => { timers.delete(timer); });
  return {
    fire(delay) {
      const due = [...timers.values()].filter(timer => timer.delay === delay);
      assert.ok(due.length > 0, `real handler must schedule ${delay}ms drain timer`);
      for (const timer of due) { timers.delete(timer); timer.callback(); }
    },
    restore() { globalThis.setTimeout = saved.setTimeout; globalThis.clearTimeout = saved.clearTimeout; },
  };
}
