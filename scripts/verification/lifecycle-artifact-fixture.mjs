// W3 source-handler fixture. No production DI; only SDK/Fovea/tracer boundaries
// are inert. The real runtime is constructed, but its execute method is gated.
// Fixture directories/evidence stay under project .tmp; no teardown removes them.
// Standalone runtime stores are rootless. Owner-store expiry/close may remove only
// the task-owned ka_* files created by the production store under these fixtures.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const boundaries = `
export const hooks = {}, events = [], servers = [];
function invoke(name, ...args) { events.push(name); return hooks[name]?.(...args); }
export class Server {
  requests = new Map(); notifications = new Map();
  constructor() { servers.push(this); }
  setRequestHandler(schema, fn) { this.requests.set(schema, fn); }
  setNotificationHandler(schema, fn) { this.notifications.set(schema, fn); }
  getClientCapabilities() { return { elicitation: { form: {} } }; }
  connect() { return invoke('connect'); }
  close() { return invoke('server.close'); }
  elicitInput(...args) { return invoke('elicitInput', ...args); }
  listRoots() { throw new Error('fixture uses explicit workspace context'); }
}
export class StdioServerTransport { send() { throw new Error('no transport I/O'); } }
export class FoveaHost {
  bind(identity) { invoke('bind', identity); return { observer: {}, close: () => invoke('client.close', identity) }; }
  retireConversation(...args) { return invoke('retire', ...args); }
  close() { return invoke('fovea.close'); }
}
export class FoveaResponseDelivery {
  close() { return invoke('delivery.close'); }
  send() { throw new Error('no delivery I/O'); }
  track() { throw new Error('no analysis delivery'); }
}
export function collectFoveaContext(...args) { if (!hooks.collect) throw new Error('no analysis'); return invoke('collect', ...args); }
export const DISABLED_TRACER = { enabled: false, close: () => invoke('tracer.close') };
export function resolveTraceEnabled() { return false; }
export function createFabricTracer() { throw new Error('no trace files'); }
`;

/** @param {unknown} [value] @param {Record<string,unknown>} [extra] */
export const succeeded = (value = 1, extra = {}) => ({ success: true, status: "succeeded", value, audits: [], logs: [], durationMs: 0, ...extra });
export const failed = (error, extra = {}) => ({ success: false, status: "failed", error: String(error), audits: [], logs: [], durationMs: 0, ...extra });
export const text = response => response.content?.filter(item => item.type === "text").map(item => item.text).join("\n") ?? "";
export function value(response) { assert.notEqual(response.isError, true, text(response)); return JSON.parse(text(response)); }
export function deferred() {
  /** @type {(value?:any)=>void} */ let resolve = () => {};
  /** @type {(error?:any)=>void} */ let reject = () => {};
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

/** Real handler, binding, adapter, runtime, store, artifact provider and projection. */
export async function loadArtifactFixture(context, label, patch = {}) {
  const temporary = fs.realpathSync(path.join(context.root, ".tmp"));
  const parent = fs.realpathSync(context.fixturesRoot);
  const relative = path.relative(temporary, parent);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "fixtures must be below project .tmp");
  const directory = fs.mkdtempSync(path.join(parent, `${label}-`));
  const sourcePath = path.join(context.root, "src/kiro/mcp-server.ts");
  const source = fs.readFileSync(context.handlerSource ?? sourcePath, "utf8");
  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  fs.writeFileSync(path.join(directory, "mcp-server-source.ts"), source, { flag: "wx", mode: 0o600 });
  const entries = [
    ["createKiroMcpServer", "src/kiro/mcp-server.ts"], ["createKiroRuntime", "src/kiro/runtime.ts"],
    ["KiroHostSessionAdapter", "src/kiro/host-session-adapter.ts"], ["normalizeFabricConfig", "src/config.ts"],
    ["createKiroArtifactStore", "src/kiro/artifacts.ts"], ["KiroPowerArtifactsProvider", "src/kiro/power/artifacts-provider.ts"],
    ["FabricDeadline", "src/runtime/deadline.ts"],
    ["KiroPowerWorkspaceBinding", "src/kiro/power/workspace-binding.ts"],
    ["createKiroArtifactOwner", "src/kiro/artifact-owner.ts"],
    ["FabricCompilerPool", "src/runtime/type-checker.ts"], ["QuickJsRuntime", "src/runtime/quickjs-runtime.ts"],
  ];
  const replaced = new Set(["@modelcontextprotocol/sdk/server/index.js", "@modelcontextprotocol/sdk/server/stdio.js", "../fovea/host.js", "./fovea-context.js", "../trace/tracer.js"]);
  const contents = entries.map(([name, file]) => `export { ${name} } from ${JSON.stringify(path.join(context.root, file))};`).concat(
    'export { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";', 'export * from "artifact-inert-boundaries";').join("\n");
  const result = await build({ stdin: { contents, resolveDir: context.root }, bundle: true, packages: "external", platform: "node", format: "esm", target: "node24", write: false, logLevel: "silent", metafile: true,
    plugins: [{ name: "artifact-boundaries", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.path === "artifact-inert-boundaries" || [sourcePath, path.join(context.root, "src/kiro/mcp-session.ts"), path.join(context.root, "src/kiro/mcp-execution.ts")].includes(args.importer) && replaced.has(args.path) ? { path: "boundaries", namespace: "artifact-fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "artifact-fixture" }, () => ({ contents: boundaries, loader: "js" }));
      builder.onLoad({ filter: /[/\\]kiro[/\\]mcp-server\.ts$/ }, () => ({ contents: source, loader: "ts", resolveDir: path.dirname(sourcePath) }));
    } }],
  });
  // The bundle retains actual transitive source imports. The standalone .ts is
  // only a handler snapshot, not a claim to a historical whole-repository tree.
  const moduleFile = path.join(directory, "artifact-source.mjs");
  fs.writeFileSync(moduleFile, result.outputFiles[0].contents, { flag: "wx", mode: 0o600 });
  fs.writeFileSync(path.join(directory, "bundle-inputs.json"), JSON.stringify(result.metafile.inputs, null, 2), { flag: "wx", mode: 0o600 });
  const api = await import(pathToFileURL(moduleFile).href);
  let forbiddenExecutionAttempts = 0;
  const forbidExecution = () => { forbiddenExecutionAttempts++; throw new Error("artifact fixture forbids compiler/VM execution; use the execute gate"); };
  api.FabricCompilerPool.prototype.check = forbidExecution;
  api.QuickJsRuntime.prototype.execute = forbidExecution;
  const roots = Object.fromEntries(["runtime", "data", "workspace", "other-workspace"].map(name => {
    const file = path.join(directory, name); fs.mkdirSync(file, { mode: 0o700 }); return [name, file];
  }));
  let snapshot = { revision: 1, observedAt: Date.now(), status: "verified", roots: [{ uri: pathToFileURL(roots.workspace).href }] };
  const workspaceContext = { current: async () => snapshot, invalidate() {}, subscribe() { return { dispose() {} }; } };
  const config = api.normalizeFabricConfig({ approvals: { read: "allow", write: "allow" }, executor: { maxOutputChars: 2000 }, mcp: { enabled: false }, memory: { enabled: false }, state: { enabled: false }, continuity: { enabled: false }, ...patch });
  fs.mkdirSync(path.join(roots.data, "fabric/config"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(roots.data, "fabric/config/config.json"), JSON.stringify(config), { mode: 0o600 });
  const runtimes = [], runtimeOptions = [], calls = [], reads = [], capabilities = [];
  const hooks = api.hooks;
  hooks.elicitInput = async (request, options) => {
    assert.equal(request.mode, "form");
    assert.deepEqual(request.requestedSchema, { type: "object", properties: { approved: { type: "boolean", title: "Approve once", default: false } }, required: ["approved"] });
    assert.ok(request.message.includes("Canonical workspace:"));
    assert.ok(options.timeout > 0);
    return { action: "accept", content: { approved: true } };
  };
  const invocation = args => ({ cwd: roots.workspace, signal: args.signal ?? new AbortController().signal, deadline: new api.FabricDeadline(60000, 60000), maxResultChars: 1600, ...(args.artifactAccess ? { artifactAccess: args.artifactAccess } : {}) });
  const options = { runtimeRoot: roots.runtime, dataRoot: roots.data, version: "0.0.0-fixture", workspaceContext,
    prepareRuntime(runtimeOptionsValue) {
      runtimeOptions.push(runtimeOptionsValue);
      const runtime = api.createKiroRuntime({ ...runtimeOptionsValue, artifactsRoot: "", config });
      // Use the real provider with the real runtime store. This explicit gate
      // forwards host capability, NOT evidence that core execute forwards it.
      const provider = new api.KiroPowerArtifactsProvider(runtime.artifacts, config.artifacts);
      const close = runtime.close.bind(runtime);
      runtime.close = async () => { api.events.push("runtime.close"); await provider.close(); await close(); await hooks["runtime.close"]?.(runtime); };
      runtime.service.execute = async args => {
        calls.push(args); if (args.artifactAccess) capabilities.push(args.artifactAccess);
        const invoke = async (action, input) => {
          const result = await provider.invoke(action, input, invocation(args));
          if (action === "read") reads.push(result);
          return result;
        };
        try { return await (hooks.execute?.(args, { runtime, provider, invoke }) ?? succeeded()); }
        catch (error) { return failed(error); }
      };
      runtimes.push(runtime); return runtime;
    },
  };
  let requestId = 0;
  const responses = [];
  const call = async (name = "fabric_exec", args = { code: "return 1" }, route = {}) => {
    const id = ++requestId;
    if (route.adapter && route.turn) route.adapter.associateRequest(id, route.turn);
    const handler = api.servers[0].requests.get(api.CallToolRequestSchema);
    assert.equal(typeof handler, "function");
    const response = await handler({ method: "tools/call", params: { name, arguments: args, ...(route.meta ? { _meta: route.meta } : {}) } }, { requestId: id, signal: route.signal ?? new AbortController().signal });
    responses.push(response);
    fs.writeFileSync(path.join(directory, "responses.json"), JSON.stringify(responses, null, 2), { mode: 0o600 });
    return response;
  };
  const read = async (id, route = {}, offset = 0, limit = 512) => {
    hooks.execute = async (_args, gate) => succeeded(await gate.invoke("read", { id, offset, limit }));
    return call("fabric_exec", { code: "return await artifacts.read(JSON.parse(payloads.request))", payloads: { request: JSON.stringify({ id, offset, limit }) } }, route);
  };
  return { api, hooks, options, call, read, invocation, roots, directory, sourceSha256, config, runtimes, runtimeOptions, calls, reads, capabilities, workspaceContext,
    setRoots(names = ["workspace"], status = "verified") { snapshot = { revision: snapshot.revision + 1, observedAt: Date.now(), status, roots: names.map(name => ({ uri: pathToFileURL(roots[name]).href })) }; },
    evidence: () => ({ fixture: directory, sourceSha256, executions: calls.length, runtimeCount: runtimes.length, providerReads: reads.length, forbiddenExecutionAttempts, events: [...api.events] }),
  };
}
