// W2 source regressions. All transports/workers are inert; fixtures are retained.
import assert from "node:assert/strict";
import { loadLifecycleApi } from "./lifecycle-fixture.mjs";

/** @typedef {{root:string, fixturesRoot:string}} CaseContext */
/** @typedef {{id:string, title:string, effects:string, deadlineMs?:number, run:(context:CaseContext)=>Promise<object>}} ShutdownCase */

function deferred() {
  /** @type {(value?:any)=>void} */ let resolve;
  /** @type {(reason?:any)=>void} */ let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  // Rejections may precede consumption; never leave a task-owned rejection naked.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
/** @param {Promise<any>} promise */
function observe(promise) {
  const state = { settled: false, failed: false, error: /** @type {any} */ (undefined) };
  const done = promise.then(() => { state.settled = true; }, error => {
    state.settled = true; state.failed = true; state.error = error;
  });
  return { promise, state, done };
}
/** @param {unknown} error @returns {unknown[]} */
function leaves(error) {
  return error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
}
/** @param {ReturnType<typeof observe>} operation @param {Error[]} errors */
async function failedWith(operation, errors) {
  await operation.done;
  assert.equal(operation.state.failed, true, "shutdown must reject");
  assert.ok(operation.state.error instanceof AggregateError, "shutdown must aggregate failures");
  const actual = leaves(operation.state.error);
  assert.equal(actual.length, errors.length, "no earlier failure may be masked");
  errors.forEach((error, index) => assert.equal(actual[index], error, "retain original rejection identity"));
}
/** @param {string} name @param {()=>any} close */
function provider(name, close) {
  const descriptor = { name: "read", description: "inert read", risk: "read", inputSchema: { type: "object", additionalProperties: false } };
  return { name, description: "inert lifecycle provider", list: async () => [descriptor],
    describe: async () => descriptor, invoke: async () => ({ ok: true }), close };
}
/** @param {CaseContext} context */
function invocation(context) {
  return { cwd: context.fixturesRoot, maxResultChars: 8192, maxAuditEntries: 32,
    maxAuditBytes: 32768, audits: [], approve: async () => {} };
}
// A turn of the event loop is an ordering barrier, not a wall-clock delay.
const eventBarrier = () => new Promise(resolve => setImmediate(resolve));

/** @returns {ShutdownCase[]} */
export function createShutdownCases() {
  return [
    {
      id: "LC07", title: "registry attempts every close and retains all synchronous/asynchronous failures",
      effects: "bundles source in retained fixture; inert providers and in-memory gates only",
      run: async context => {
        const { ActionRegistry } = await loadLifecycleApi(context);
        const evidence = [];
        for (const mixed of [false, true]) {
          const registry = new ActionRegistry();
          const first = new Error("async cleanup failed");
          const second = new Error("sync cleanup failed");
          const gate = deferred();
          const calls = [];
          registry.register(provider("first", () => { calls.push("first"); return Promise.reject(first); }));
          if (mixed) registry.register(provider("second", () => { calls.push("second"); throw second; }));
          registry.register(provider("last", () => { calls.push("last"); return gate.promise; }));
          const closing = observe(registry.close());
          try {
            await eventBarrier();
            assert.deepEqual(calls, mixed ? ["first", "second", "last"] : ["first", "last"]);
            assert.equal(closing.state.settled, false, "must await later cleanup even after a failure");
            gate.resolve();
            await failedWith(closing, mixed ? [first, second] : [first]);
            assert.equal(registry.has("first"), true, "retain failed provider ownership");
            const retained = registry.providers().find(item => item.name === "first");
            assert.equal(retained.available, false, "retained failed owner is not advertised as usable");
            assert.match(retained.reason, /shutdown failed/u);
            if (mixed) assert.equal(registry.has("second"), true);
            assert.throws(() => registry.register(provider("first", async () => {})), /closed/u);
            const repeat = observe(registry.close());
            await repeat.done;
            assert.equal(repeat.promise, closing.promise);
            assert.equal(repeat.state.error, closing.state.error);
            assert.equal(calls.length, mixed ? 3 : 2, "close is never replayed");
            evidence.push({ mixed, attempts: [...calls], failures: leaves(closing.state.error).length });
          } finally {
            gate.resolve();
            await closing.done;
          }
        }
        return { variants: evidence, retainedFailedOwnership: true };
      },
    },
    {
      id: "LC08", title: "concurrent and reentrant registry callers join a preinstalled close promise",
      effects: "bundles source in retained fixture; reentrant inert callback and deferred cleanup only",
      run: async context => {
        const { ActionRegistry } = await loadLifecycleApi(context);
        const registry = new ActionRegistry();
        const gate = deferred();
        let calls = 0;
        /** @type {ReturnType<typeof observe>|undefined} */ let reentrant;
        registry.register(provider("joining", () => {
          calls++;
          if (calls === 1) reentrant = observe(registry.close());
          return gate.promise;
        }));
        const first = observe(registry.close());
        const concurrent = observe(registry.close());
        try {
          await eventBarrier();
          assert.ok(reentrant, "provider reentered close");
          assert.equal(first.promise, concurrent.promise, "concurrent caller must join exact operation");
          assert.equal(first.promise, reentrant.promise, "operation must exist before extension callback");
          assert.equal(calls, 1);
          assert.equal(first.state.settled || concurrent.state.settled || reentrant.state.settled, false);
          gate.resolve();
          await Promise.all([first.done, concurrent.done, reentrant.done]);
          assert.equal(first.state.failed, false);
          assert.equal(registry.close(), first.promise, "successful close remains memoized");
          return { callbackAttempts: calls, sharedPromise: true, joinedBeforeSettlement: true };
        } finally {
          gate.resolve();
          await Promise.all([first.done, concurrent.done, reentrant?.done]);
        }
      },
    },
    {
      id: "LC09", title: "registry close is immediately terminal without releasing active approval reservations early",
      effects: "bundles source in retained fixture; inert discovery, approval and close barriers only",
      run: async context => {
        const { ActionRegistry } = await loadLifecycleApi(context);
        const registry = new ActionRegistry();
        const approval = deferred(), entered = deferred(), cleanup = deferred();
        let dispatches = 0, releases = 0, closes = 0;
        registry.register({ ...provider("terminal", () => { closes++; return cleanup.promise; }),
          reserveInvocation: async () => () => { releases++; },
          invoke: async () => { dispatches++; return "unexpected"; } });
        const active = observe(registry.invoke("terminal.read", {}, { ...invocation(context),
          approve: async () => { entered.resolve(); await approval.promise; } }));
        /** @type {ReturnType<typeof observe>|undefined} */ let closing;
        try {
          await entered.promise;
          closing = observe(registry.close());
          const status = registry.providers().find(item => item.name === "terminal");
          assert.equal(status.available, false, "terminal admission is reflected in diagnostics immediately");
          assert.match(status.reason, /shutdown closing/u);
          assert.throws(() => registry.register(provider("late", async () => {})), /closed/u);
          assert.throws(() => registry.catalogDependencies(), /closed/u);
          await assert.rejects(registry.list(), /closed/u);
          await assert.rejects(registry.describe("terminal.read"), /closed/u);
          await assert.rejects(registry.invoke("terminal.read", {}, invocation(context)), /closed/u);
          assert.equal(releases, 0, "close must not prematurely release approval ownership");
          assert.equal(active.state.settled, false);
          approval.resolve();
          await active.done;
          assert.equal(active.state.failed, true);
          assert.match(String(active.state.error), /closed/u);
          assert.equal(dispatches, 0);
          assert.equal(releases, 1);
          cleanup.resolve();
          await closing.done;
          assert.equal(closing.state.failed, false);
          await assert.rejects(registry.invoke("terminal.read", {}, invocation(context)), /closed/u);
          return { immediateTerminalAdmission: true, dispatches, releases, closes };
        } finally {
          approval.resolve(); cleanup.resolve();
          await Promise.all([active.done, closing?.done]);
        }
      },
    },
    {
      id: "LC10", title: "service drain and Kiro runtime cleanup preserve every failure and shared close ownership",
      effects: "bundles source in retained fixture; compiler/VM prototypes mocked before use, rootless artifacts and inert MCP runtime",
      run: async context => {
        const api = await loadLifecycleApi(context);
        const { ActionRegistry, FabricExecutionService, createKiroRuntime, KiroMcpProvider,
          FabricCompilerPool, QuickJsRuntime, normalizeFabricConfig } = api;
        assert.ok(FabricCompilerPool && QuickJsRuntime, "fixture must export worker classes for inert mocks");
        const cp = FabricCompilerPool.prototype, vm = QuickJsRuntime.prototype;
        const saved = { check: cp.check, compilerClose: cp.close, execute: vm.execute, runtimeClose: vm.close };
        const checked = deferred(), entered = deferred();
        const compilerError = new Error("compiler close failed"), vmError = new Error("VM close failed");
        const registryError = new Error("registry extension close failed"), mcpError = new Error("MCP runtime close failed");
        const artifactError = new Error("artifact close failed");
        const calls = [];
        /** @type {any} */ let service;
        /** @type {ReturnType<typeof observe>|undefined} */ let execution, serviceClose;
        /** @type {any} */ let runtime;
        /** @type {ReturnType<typeof observe>|undefined} */ let runtimeClose;
        /** @type {{service?:ReturnType<typeof observe>, runtime?:ReturnType<typeof observe>}} */
        const reentries = {};
        let compilerCalls = 0, artifactCalls = 0;
        let testRuntime = false;
        cp.check = async () => { entered.resolve(); return await checked.promise; };
        cp.close = () => {
          calls.push("compiler"); compilerCalls++;
          if (!testRuntime && compilerCalls === 1) reentries.service = observe(service.close());
          throw compilerError;
        };
        vm.execute = async () => { throw new Error("native VM must not execute in shutdown case"); };
        vm.close = () => { calls.push("vm"); return Promise.reject(vmError); };
        const config = normalizeFabricConfig({ mcp: { enabled: false }, continuity: { enabled: false } });
        try {
          const registry = new ActionRegistry();
          registry.register(provider("extension", () => { calls.push("registry"); throw registryError; }));
          const mcp = new KiroMcpProvider(context.fixturesRoot, normalizeFabricConfig({}).mcp, async () => ({
            listServers: () => [], close: async () => { calls.push("mcp"); throw mcpError; },
          }));
          registry.register(mcp);
          await registry.invoke("mcp.$servers", {}, invocation(context));
          service = new FabricExecutionService(registry, config, context.fixturesRoot);
          execution = observe(service.execute({ code: "return 1", approver: { approve: async () => {} } }));
          await entered.promise;
          serviceClose = observe(service.close());
          const concurrent = observe(service.close());
          await eventBarrier();
          assert.deepEqual(calls, ["compiler"], "compiler failure must not bypass actual execution drain");
          assert.equal(serviceClose.state.settled, false);
          assert.equal(serviceClose.promise, concurrent.promise);
          assert.equal(serviceClose.promise, reentries.service?.promise, "compiler reentry must join");
          const denied = await service.execute({ code: "return 2", approver: { approve: async () => {} } });
          assert.equal(denied.success, false); assert.match(denied.error, /closed/u);
          checked.reject(new Error("inert compilation cancelled after drain barrier"));
          await execution.done;
          await failedWith(serviceClose, [compilerError, vmError, registryError, mcpError]);
          await concurrent.done;
          assert.deepEqual(calls, ["compiler", "vm", "registry", "mcp"]);
          assert.equal(registry.has("extension"), true); assert.equal(registry.has("mcp"), true);
          assert.equal(service.close(), serviceClose.promise);
          testRuntime = true;
          // An empty artifact root selects the audited in-memory store. Never run
          // disk-backed artifact cleanup, constructor residue reclamation, or native workers.
          runtime = createKiroRuntime({ cwd: context.fixturesRoot, configFile: "unused", mcpConfigPath: "",
            artifactsRoot: "", config });
          runtime.registry.register(provider("runtime_failure", () => { throw registryError; }));
          runtime.artifacts.close = () => {
            artifactCalls++;
            if (artifactCalls === 1) reentries.runtime = observe(runtime.close());
            throw artifactError;
          };
          runtimeClose = observe(runtime.close());
          const joined = observe(runtime.close());
          const runtimeDenied = await runtime.service.execute({ code: "return 3", approver: { approve: async () => {} } });
          assert.equal(runtimeDenied.success, false); assert.match(runtimeDenied.error, /closed/u);
          await failedWith(runtimeClose, [compilerError, vmError, registryError, artifactError]);
          await joined.done;
          assert.equal(runtimeClose.promise, joined.promise);
          assert.equal(runtimeClose.promise, reentries.runtime?.promise);
          assert.equal(artifactCalls, 1);
          assert.equal(runtime.registry.has("runtime_failure"), true);
          return { drainedBeforeLaterCleanup: true, serviceFailures: 4, runtimeFailures: 4,
            artifactAttempts: artifactCalls, nativeWorkers: 0, sharedOperations: true };
        } finally {
          checked.reject(new Error("fixture finalization"));
          await Promise.all([execution?.done, serviceClose?.done, reentries.service?.done, runtimeClose?.done, reentries.runtime?.done]);
          if (service) await observe(service.close()).done;
          if (runtime) await observe(runtime.close()).done;
          cp.check = saved.check; cp.close = saved.compilerClose;
          vm.execute = saved.execute; vm.close = saved.runtimeClose;
        }
      },
    },
    {
      id: "LC11", title: "failed host retirement remains non-admissible, reserves capacity and joins reentrant cleanup",
      effects: "bundles source in retained fixture; host sessions and rejecting cleanup callbacks are entirely in memory",
      run: async context => {
        const { KiroHostSessionAdapter } = await loadLifecycleApi(context);
        const adapter = new KiroHostSessionAdapter();
        const workspaceContext = { current: async () => ({ status: "explicitly-empty", roots: [] }), invalidate() {} };
        const failedOwner = { conversationId: "failed", conversationEpoch: 0, workspaceContext };
        const first = adapter.openSession(failedOwner);
        const turn = adapter.beginTurn(first);
        adapter.associateRequest("old-request", turn);
        const failure = new Error("retirement failed");
        const another = new Error("another retirement failed");
        const gate = deferred();
        /** @type {ReturnType<typeof observe>|undefined} */ let reentrant, closing;
        /** @type {{close?:ReturnType<typeof observe>}} */ const reentries = {};
        const counts = new Map();
        let closeEntered = false;
        adapter.attach(session => {
          const count = (counts.get(session.conversationId) ?? 0) + 1;
          counts.set(session.conversationId, count);
          if (session === first) {
            if (count === 1) reentrant = observe(adapter.retireSession(first));
            return gate.promise;
          }
          if (session.conversationId === "other_0") {
            if (!closeEntered) { closeEntered = true; reentries.close = observe(adapter.close()); }
            throw another;
          }
          return Promise.resolve();
        });
        const retirement = observe(adapter.retireSession(first));
        try {
          assert.equal(first.signal.aborted, true); assert.equal(turn.signal.aborted, true);
          assert.throws(() => adapter.beginTurn(first), /retired/u);
          assert.throws(() => adapter.takeRequest("old-request"), /association/u);
          gate.reject(failure);
          await retirement.done;
          assert.equal(retirement.state.error, failure);
          assert.throws(() => adapter.openSession(failedOwner), /active or retiring/u);
          for (let i = 0; i < 31; i++) adapter.openSession({ conversationId: `other_${i}`, conversationEpoch: 0, workspaceContext });
          assert.throws(() => adapter.openSession({ conversationId: "overflow", conversationEpoch: 0, workspaceContext }), /capacity/u);
          assert.equal(retirement.promise, adapter.retireSession(first));
          assert.equal(retirement.promise, reentrant?.promise, "retirement installs promise before host callback");
          assert.equal(counts.get("failed"), 1);
          closing = observe(adapter.close());
          assert.throws(() => adapter.openSession({ conversationId: "late", conversationEpoch: 0, workspaceContext }), /closed/u);
          await failedWith(closing, [failure, another]);
          assert.equal(closing.promise, reentries.close?.promise, "adapter close installs promise before host callback");
          assert.equal(adapter.close(), closing.promise);
          assert.equal(counts.size, 32);
          assert.ok([...counts.values()].every(count => count === 1));
          return { reservedAfterFailure: true, capacity: 32, retirementAttempts: counts.size,
            aggregateFailures: 2, staleTurnRevoked: true, sharedOperations: true };
        } finally {
          gate.reject(failure);
          await Promise.all([retirement.done, reentrant?.done, closing?.done, reentries.close?.done]);
          await observe(adapter.close()).done;
        }
      },
    },
  ];
}
