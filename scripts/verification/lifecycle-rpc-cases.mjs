// Offline source regressions. No real transports, subprocesses or fixture cleanup.
import assert from "node:assert/strict";
import { mock } from "node:test";
import { loadLifecycleApi } from "./lifecycle-fixture.mjs";

/** @returns {{promise:Promise<any>, resolve:(value?:any)=>void, reject:(error:any)=>void}} */
function deferred() {
  let resolve = /** @type {(value?:any)=>void} */ (() => {});
  let reject = /** @type {(error:any)=>void} */ (() => {});
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  // Every deferred is observed from creation, including failures in finally paths.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

/** @param {Promise<any>} promise */
function observe(promise) {
  const record = { state: "pending", value: /** @type {any} */ (undefined), error: /** @type {any} */ (undefined), done: Promise.resolve() };
  record.done = promise.then(value => { record.state = "fulfilled"; record.value = value; }, error => { record.state = "rejected"; record.error = error; });
  return record;
}

// All admission/approval/mock operations are synchronous or resolved promises.
// A check-phase barrier drains their finite microtask chains; it is NOT a delay
// used to guess when I/O, a production timeout, or a remote server might finish.
const turn = () => new Promise(resolve => setImmediate(resolve));
/** @param {any} operation @param {string} label */
async function fulfilled(operation, label) {
  // At these checkpoints every required fixture gate has been released. Fail
  // blocked microtask-only work rather than waiting for a production RPC timer.
  await turn();
  assert.equal(operation.state, "fulfilled", `${label}: ${String(operation.error)}`);
  await operation.done;
  return operation.value;
}
/** @param {any} operation @param {string} label */
async function rejected(operation, label) {
  await turn();
  assert.equal(operation.state, "rejected", `${label} must reject`);
  await operation.done;
  return operation.error;
}

/** Complete injected runtime; retain the provider's real snapshots and guards.
 * @param {any} api @param {any} context
 * @param {{registry?:boolean, pendingFactory?:boolean, heldClose?:boolean, onFactory?:()=>void}} [options]
 */
function fixture(api, context, options = {}) {
  const config = api.normalizeFabricConfig({ mcp: { enabled: true, disableOAuth: true } });
  const factory = deferred(), factoryEntered = deferred(), fullClose = deferred();
  if (!options.heldClose) fullClose.resolve();
  /** @type {Map<string, ReturnType<typeof deferred>>} */
  const raw = new Map();
  /** @type {Map<string, ReturnType<typeof deferred>>} */
  const entered = new Map();
  /** @type {Array<{kind:string, server?:string, tag?:string}>} */
  const events = [];
  /** @type {ReturnType<typeof observe>[]} */
  const operations = [];
  /** @type {AbortController[]} */
  const controllers = [];
  /** @type {any[]} */
  const approvals = [], audits = [];
  /** @type {AbortSignal[]} */ const signals = [];
  const definitions = new Map(["one", "two"].map(name => [name, {
    name, description: "inert lifecycle fixture", command: { kind: "http", url: new URL(`http://127.0.0.1:1/${name}`) },
  }]));
  /** @param {string} server */
  const definition = server => {
    const result = definitions.get(server);
    assert.ok(result, `unexpected server ${server}`);
    return result;
  };
  const runtime = {
    listServers: () => [...definitions.keys()],
    getDefinition: definition,
    /** @param {string} server @param {any} options */
    connect: async (server, options) => {
      definition(server);
      assert.equal(options.disableOAuth, true);
      assert.ok(options.oauthTimeoutMs > 0);
      events.push({ kind: "connect", server });
      return { client: {
        /** @param {any} params @param {any} requestOptions */
        listTools: async (params, requestOptions) => {
          assert.equal(params, undefined, "single-page mock uses the real SDK listTools signature");
          assert.ok(requestOptions.timeout > 0);
          assert.equal(requestOptions.resetTimeoutOnProgress, true);
          if (requestOptions.signal) signals.push(requestOptions.signal);
          assert.equal(requestOptions.maxTotalTimeout, requestOptions.timeout);
          events.push({ kind: "listTools", server });
          return { tools: [{ name: "work", description: "inert work", inputSchema: { type: "object", properties: { tag: { type: "string" } }, required: ["tag"], additionalProperties: false } }] };
        },
      } };
    },
    /** @param {string} server @param {string} tool @param {any} options */
    callTool: async (server, tool, options) => {
      definition(server);
      assert.equal(tool, "work");
      assert.equal(options.disableOAuth, true);
      assert.ok(options.timeoutMs > 0);
      const tag = options.args.tag;
      events.push({ kind: "callTool", server, tag });
      entered.get(tag)?.resolve();
      const gate = raw.get(tag);
      if (gate) await gate.promise;
      return { content: [{ type: "text", text: tag }], structuredContent: { tag } };
    },
    /** @param {string} [server] */
    close: async server => {
      if (server !== undefined) definition(server);
      events.push(server === undefined ? { kind: "close" } : { kind: "close", server });
      if (server === undefined) await fullClose.promise;
    },
  };
  if (!options.pendingFactory) factory.resolve(runtime);
  const provider = new api.KiroMcpProvider(context.fixturesRoot, config.mcp, async () => {
    factoryEntered.resolve();
    options.onFactory?.();
    return await factory.promise;
  });
  const registry = options.registry ? new api.ActionRegistry() : undefined;
  registry?.register(provider);
  /** @param {Promise<any>} promise */
  const track = promise => { const result = observe(promise); operations.push(result); return result; };
  /** @param {AbortSignal} [signal] */
  const invocationContext = signal => ({ cwd: context.fixturesRoot, signal, audits, maxResultChars: config.executor.maxNestedResultChars,
    maxAuditEntries: config.executor.maxAuditEntries, maxAuditBytes: config.executor.maxAuditBytes,
    /** @param {any} action @param {any} args */
    approve: async (action, args) => { approvals.push({ action, args }); },
  });
  return {
    provider, registry, runtime, events, approvals, audits, signals, factory, factoryEntered, fullClose, track,
    controller() { const controller = new AbortController(); controllers.push(controller); return controller; },
    /** @param {string} tag */
    hold(tag) { const gate = deferred(); raw.set(tag, gate); entered.set(tag, deferred()); return gate; },
    /** @param {string} tag @param {AbortSignal} [signal] @param {string} [server] */
    call(tag, signal, server = "one") {
      const ctx = invocationContext(signal);
      return track(registry ? registry.invoke(`mcp.remote/${server}/work`, { tag }, ctx)
        : provider.invoke("$call", { server, tool: "work", args: { tag } }, ctx));
    },
    servers() { return track(provider.invoke("$servers", {}, invocationContext())); },
    /** @param {string} tag @param {any} operation */
    async started(tag, operation) {
      const barrier = entered.get(tag);
      assert.ok(barrier, `missing start barrier ${tag}`);
      await Promise.race([barrier.promise, operation.done, turn()]);
      assert.ok(events.some(event => event.kind === "callTool" && event.tag === tag), `${tag} failed before raw dispatch: ${String(operation.error)}`);
    },
    /** @param {string} [server] */
    contacts(server = "one") { return events.filter(event => event.server === server && ["connect", "listTools", "callTool"].includes(event.kind)).length; },
    calls() { return events.filter(event => event.kind === "callTool").map(event => event.tag); },
    closes() { return events.filter(event => event.kind === "close" && event.server === undefined).length; },
    close() { return track(provider.close()); },
    async finish() {
      // Release EVERY task-owned gate before awaiting even an assertion-failure
      // path. A cancelled caller is not evidence that its raw operation ended.
      for (const gate of raw.values()) gate.resolve();
      for (const barrier of entered.values()) barrier.resolve();
      factoryEntered.resolve();
      factory.resolve(runtime);
      fullClose.resolve();
      for (const controller of controllers) controller.abort(new Error("fixture finalization"));
      const closing = track(provider.close());
      await Promise.all(operations.map(operation => operation.done));
      await closing.done;
      if (registry) await observe(registry.close()).done;
    },
  };
}

/** @param {any} f @param {string} tag @param {AbortController} controller */
async function cancelWaiter(f, tag, controller) {
  const before = f.contacts();
  const operation = f.call(tag, controller.signal);
  await turn();
  assert.equal(operation.state, "pending", `${tag} must first enter the blocked queue`);
  assert.equal(f.contacts(), before, `${tag} contacted an occupied server`);
  controller.abort(new Error(`cancel ${tag}`));
  await rejected(operation, tag);
  return operation;
}

/** @param {any} context @param {boolean} throughRegistry */
async function ordering(context, throughRegistry) {
  const api = await loadLifecycleApi(context);
  const f = fixture(api, context, { registry: throughRegistry });
  try {
    const rawA = f.hold("A"), abortA = f.controller();
    const a = f.call("A", abortA.signal);
    await f.started("A", a);
    if (throughRegistry) {
      // The stronger reproduction: settle A's cancelled caller while keeping
      // its raw RPC pending. B's registry revocation then cannot mask C's entry.
      abortA.abort(new Error("cancel A with raw RPC pending"));
      await rejected(a, "A");
    }
    await cancelWaiter(f, "B", f.controller());
    const before = f.contacts(), c = f.call("C");
    await turn();
    assert.equal(f.contacts(), before, "C contacted the server before raw A settled");
    assert.equal(c.state, "pending", "C must retain predecessor ownership");
    rawA.resolve();
    if (!throughRegistry) await fulfilled(a, "A");
    await fulfilled(c, "C");
    assert.deepEqual(f.calls(), ["A", "C"], "cancelled work must not dispatch or replay");
    if (throughRegistry) {
      assert.equal(f.approvals.length, 3, "exercise real registry approvals");
      assert.ok(f.approvals.every(entry => entry.args.transportSnapshot.kind === "http" && /^[a-f0-9]{64}$/u.test(entry.args.transportSnapshot.digest)));
      assert.deepEqual(f.audits.map(audit => audit.success), [false, false, true]);
    }
    return { path: throughRegistry ? "ActionRegistry -> KiroMcpProvider" : "KiroMcpProvider", rawDispatches: f.calls(), cancelled: throughRegistry ? ["A", "B"] : ["B"], noEarlyContact: true };
  } finally { await f.finish(); }
}

/** @returns {any[]} */
export function createRpcCases() {
  const effects = "source-only bundle in retained fixture; inert localhost definitions and mocked runtime; no network or cleanup";
  return [
    { id: "LC01", title: "cancelled provider waiter retains active predecessor", effects, deadlineMs: 30000,
      run: async context => ordering(context, false) },
    { id: "LC02", title: "real registry retains cancelled caller's pending raw RPC through a second cancellation", effects, deadlineMs: 30000,
      run: async context => ordering(context, true) },
    { id: "LC03", title: "close retains hidden predecessor, joins callers and immediately ends admission", effects, deadlineMs: 30000,
      run: async context => {
        const api = await loadLifecycleApi(context), f = fixture(api, context, { heldClose: true });
        try {
          const rawA = f.hold("A"), a = f.call("A");
          await f.started("A", a);
          await cancelWaiter(f, "B", f.controller());
          const first = f.close(), second = f.close();
          const late = f.call("late"), servers = f.servers();
          await turn();
          assert.equal(late.state, "rejected", "close must immediately refuse calls");
          assert.equal(servers.state, "rejected", "close must immediately refuse runtime admission");
          assert.equal(f.closes(), 0, "close overlooked A after B's waiter cancellation");
          assert.equal(first.state, "pending");
          assert.equal(second.state, "pending", "concurrent close must join predecessor cleanup");
          rawA.resolve();
          await rejected(a, "close-cancelled A");
          await turn();
          assert.equal(f.closes(), 1);
          assert.equal(first.state, "pending");
          assert.equal(second.state, "pending", "concurrent close must also join full runtime cleanup");
          f.fullClose.resolve();
          await fulfilled(first, "first close");
          await fulfilled(second, "second close");
          await fulfilled(f.close(), "repeated close");
          assert.equal(f.closes(), 1);
          assert.deepEqual(f.calls(), ["A"]);
          return { fullRuntimeCloses: 1, joined: true, predecessorRetained: true, postCloseAdmission: "rejected" };
        } finally { await f.finish(); }
      } },
    { id: "LC04", title: "pre-admission cancellation performs no remote dispatch", effects, deadlineMs: 30000,
      run: async context => {
        const api = await loadLifecycleApi(context), f = fixture(api, context, { registry: true });
        try {
          const controller = f.controller(); controller.abort(new Error("already cancelled"));
          const direct = f.track(f.provider.invoke("$call", { server: "one", tool: "work", args: { tag: "direct" } }, { cwd: context.fixturesRoot, signal: controller.signal }));
          await rejected(direct, "direct pre-admission cancellation");
          await rejected(f.call("registry", controller.signal), "registry pre-admission cancellation");
          assert.equal(f.contacts(), 0);
          assert.deepEqual(f.calls(), []);
          assert.equal(f.approvals.length, 0);
          await fulfilled(f.call("later"), "later admissible call");
          assert.deepEqual(f.calls(), ["later"]);
          return { cancelledDispatches: 0, laterDispatches: 1, approvalsBeforeCancellation: 0 };
        } finally { await f.finish(); }
      } },
    { id: "LC05", title: "multiple cancelled waiters retain per-server ownership without replay or stale blocking", effects, deadlineMs: 30000,
      run: async context => {
        const api = await loadLifecycleApi(context), f = fixture(api, context);
        try {
          const rawA = f.hold("A"), a = f.call("A"); await f.started("A", a);
          const bController = f.controller(), cController = f.controller();
          const before = f.contacts(), b = f.call("B", bController.signal), c = f.call("C", cController.signal);
          await turn();
          assert.equal(b.state, "pending"); assert.equal(c.state, "pending"); assert.equal(f.contacts(), before);
          bController.abort(new Error("cancel B")); await rejected(b, "B");
          cController.abort(new Error("cancel C")); await rejected(c, "C");
          const d = f.call("D"), other = f.call("other", undefined, "two");
          await fulfilled(other, "independent server");
          await turn();
          assert.equal(f.contacts(), before, "D escaped multiple cancelled predecessors");
          assert.equal(d.state, "pending");
          rawA.resolve(); await fulfilled(a, "A"); await fulfilled(d, "D");
          await turn();
          await fulfilled(f.call("fresh-tail"), "eventual queue retirement permits a fresh tail");
          assert.deepEqual(f.calls(), ["A", "other", "D", "fresh-tail"]);
          await fulfilled(f.close(), "drained tail close");
          assert.equal(f.closes(), 1);
          return { rawDispatches: f.calls(), independentServer: true, cancelledDispatches: 0, drainedClose: true };
        } finally { await f.finish(); }
      } },
    { id: "LC06", title: "runtime close failures and late factories have truthful joined outcomes", effects, deadlineMs: 30000,
      run: async context => {
        const api = await loadLifecycleApi(context);
        /** @type {Record<string,string>} */
        const outcomes = {};
        /** @type {Error[]} */
        const failures = [];
        /** @param {string} name @param {()=>Promise<void>} run */
        const check = async (name, run) => {
          try { await run(); outcomes[name] = "passed"; }
          catch (error) { const message = error instanceof Error ? error.message : String(error); outcomes[name] = message; failures.push(new Error(`${name}: ${message}`)); }
        };
        await check("loaded-runtime-rejection", async () => {
          const f = fixture(api, context, { heldClose: true });
          try {
            await fulfilled(f.servers(), "load runtime");
            const first = f.close(), second = f.close();
            await turn();
            const joinedBeforeFailure = first.state === "pending" && second.state === "pending";
            const failure = new Error("fixture full runtime.close failure"); f.fullClose.reject(failure);
            const one = await rejected(first, "first close");
            const two = await rejected(second, "joined close");
            const three = await rejected(f.close(), "repeated failed close");
            assert.equal(one, failure); assert.equal(two, failure); assert.equal(three, failure);
            assert.ok(joinedBeforeFailure, "parallel close returned before cleanup settled");
            assert.equal(f.closes(), 1);
          } finally { await f.finish(); }
        });
        await check("synchronous-factory-reentry", async () => {
          /** @type {ReturnType<typeof observe>|undefined} */ let reentrant;
          const f = fixture(api, context, { pendingFactory: true, heldClose: true,
            onFactory: () => { reentrant = f.close(); } });
          try {
            const request = f.servers(); await f.factoryEntered.promise;
            const joined = f.close(); await turn();
            assert.ok(reentrant, "factory synchronously reentered close");
            assert.equal(reentrant.state, "pending", "factory ownership must precede its callback");
            assert.equal(joined.state, "pending");
            f.factory.resolve(f.runtime); await turn();
            assert.equal(f.closes(), 1);
            assert.equal(reentrant.state, "pending", "reentry must await disposal");
            f.fullClose.resolve();
            await fulfilled(reentrant, "factory reentrant close");
            await fulfilled(joined, "factory joined close");
            await rejected(request, "factory request after reentrant close");
          } finally { await f.finish(); }
        });
        await check("synchronous-abort-listener-reentry", async () => {
          const f = fixture(api, context, { heldClose: true });
          /** @type {ReturnType<typeof observe>|undefined} */ let reentrant;
          try {
            const rawA = f.hold("A"), request = f.call("A"); await f.started("A", request);
            assert.ok(f.signals.length);
            f.signals[0].addEventListener("abort", () => { reentrant = f.close(); }, { once: true });
            const first = f.close();
            assert.ok(reentrant, "abort listener must run synchronously");
            await turn();
            assert.equal(reentrant.state, "pending"); assert.equal(first.state, "pending");
            assert.equal(f.closes(), 0, "abort reentry must not bypass raw ownership");
            rawA.resolve(); await rejected(request, "close-cancelled raw call"); await turn();
            assert.equal(f.closes(), 1);
            f.fullClose.resolve();
            await fulfilled(first, "first abort close"); await fulfilled(reentrant, "reentrant abort close");
          } finally { await f.finish(); }
        });
        for (const throws of [false, true]) await check(throws ? "late-factory-disposal-rejection" : "late-factory-disposal-success", async () => {
          const f = fixture(api, context, { pendingFactory: true, heldClose: true });
          try {
            const request = f.servers(); await f.factoryEntered.promise;
            const first = f.close(), second = f.close();
            await turn();
            const joinedBeforeFactory = first.state === "pending" && second.state === "pending";
            f.factory.resolve(f.runtime);
            await turn();
            assert.equal(f.closes(), 1, "late factory runtime must be disposed exactly once");
            const joinedDuringDisposal = first.state === "pending" && second.state === "pending";
            const failure = new Error("fixture late runtime.close failure");
            if (throws) f.fullClose.reject(failure); else f.fullClose.resolve();
            if (throws) {
              assert.equal(await rejected(first, "late disposal first close"), failure);
              assert.equal(await rejected(second, "late disposal joined close"), failure);
            } else {
              await fulfilled(first, "late disposal first close"); await fulfilled(second, "late disposal joined close");
            }
            await rejected(request, "factory request after close");
            assert.ok(joinedBeforeFactory && joinedDuringDisposal, "parallel close escaped pending factory/disposal");
            assert.equal(f.closes(), 1);
          } finally { await f.finish(); }
        });
        for (const [heldDisposal, lateFailure] of [[false, false], [true, false], [true, true]]) await check(
          lateFailure ? "disposal-rejects-after-grace" : heldDisposal ? "pending-disposal-not-success" : "pending-factory-not-success", async () => {
          const f = fixture(api, context, { pendingFactory: true, heldClose: heldDisposal });
          try {
            const request = f.servers(); await f.factoryEntered.promise;
            // Tick the EXACT existing 1000ms production grace, not a widened
            // deadline or wall-clock sleep. Cleanup uncertainty must reject;
            // expiration is not proof that creation/disposal has completed.
            mock.timers.enable({ apis: ["setTimeout"] });
            const first = f.close(), second = f.close();
            await turn();
            if (heldDisposal) {
              f.factory.resolve(f.runtime); await turn();
              assert.equal(f.closes(), 1);
            }
            mock.timers.tick(999); await turn();
            assert.equal(first.state, "pending", "production close grace must not expire early");
            assert.equal(second.state, "pending", "parallel close escaped its owner's grace");
            mock.timers.tick(1); await turn();
            assert.equal(first.state, "rejected", "pending creation/disposal must reject uncertainty at exact grace");
            assert.equal(second.state, "rejected", "joined close must reject the same uncertainty");
            assert.equal(first.error, second.error, "parallel closes must share the same failure");
            f.factory.resolve(f.runtime);
            if (lateFailure) f.fullClose.reject(new Error("late disposal rejection after uncertainty"));
            else f.fullClose.resolve();
            await turn();
            await rejected(request, "pending factory request after close");
            assert.equal(f.closes(), 1, "late resolution still disposes the runtime after grace failure");
            assert.equal(await rejected(f.close(), "repeated uncertain close"), first.error);
          } finally { mock.timers.reset(); await f.finish(); }
        });
        assert.equal(failures.length, 0, JSON.stringify(outcomes));
        return { checks: outcomes, productionGraceMs: 1000, network: false };
      } },
  ];
}
