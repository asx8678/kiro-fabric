// W2 HANDLER regressions: invoke the real registered tools/call handler, not a
// hand-written approximation of its lifecycle. All native boundaries are inert.
import assert from "node:assert/strict";
import { loadHandlerFixture, deferred, observe, failsWith, errorLeaves, barrier, fakeClock, success } from "./lifecycle-handler-fixture.mjs";

/** @typedef {import('./lifecycle-handler-fixture.mjs').HandlerContext} HandlerContext */
/** @typedef {Awaited<ReturnType<typeof loadHandlerFixture>>} Fixture */
/** @typedef {{id:string,title:string,effects:string,deadlineMs:number,run:(context:HandlerContext)=>Promise<object>}} HandlerCase */

/** @param {Fixture} fixture @param {string} name @param {Error} error @param {boolean} asynchronous */
function fault(fixture, name, error, asynchronous) {
  fixture.hooks[name] = () => { if (asynchronous) return rejected(error); throw error; };
}
/** @param {Error} error */
function rejected(error) { const task = Promise.reject(error); void task.catch(() => {}); return task; }
/** @param {any} response */
function denied(response) { assert.equal(response?.isError, true, "retired/uncertain owner must reject admission"); }
/** @param {HandlerContext} context @param {string} id @param {[string,(f:Fixture)=>Promise<object>][]} variants */
async function runVariants(context, id, variants) {
  const facts = [];
  const failures = [];
  for (const [name, test] of variants) {
    const fixture = await loadHandlerFixture(context, `${id}-${name}`);
    try { facts.push({ name, ...await test(fixture), ...fixture.evidence() }); }
    catch (error) {
      failures.push(Object.assign(new Error(`${id}/${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }), fixture.evidence()));
    }
  }
  if (failures.length) throw new AggregateError(failures, `${id}: ${failures.length} handler variant(s) failed`);
  assert.ok(facts.length > 0);
  return { variants: facts, sourceLevelHandler: true, nativeWorkers: 0, retained: true };
}

/** @param {Fixture} f @param {boolean} asynchronous */
async function boundDrain(f, asynchronous) {
  assert.equal(f.api.KIRO_MCP_DRAIN_TIMEOUT_MS, 3000, "production drain bound is not a test-controlled value");
  const failure = new Error("bound Fovea client cleanup failed");
  const runtimeFailure = new Error("bound runtime cleanup failed");
  const entered = deferred(), execution = deferred();
  /** @type {AbortSignal|undefined} */ let signal;
  f.hooks.execute = args => { signal = args.signal; entered.resolve(); return execution.promise; };
  fault(f, "client.close", failure, asynchronous);
  fault(f, "runtime.close", runtimeFailure, !asynchronous);
  const server = await f.api.createKiroMcpServer(f.options);
  const clock = fakeClock();
  const running = observe(() => f.call());
  let replacement, closing;
  try {
    await barrier();
    assert.equal(f.runtimeOptions.length, 1, "request reached the inert runtime factory");
    assert.equal(f.count("bind"), 1, "exercise bound-client cleanup, not unbound runtime");
    f.changeWorkspace();
    replacement = observe(() => f.call());
    await barrier();
    assert.equal(signal.aborted, true, "Fovea close failure must not skip abort/drain");
    clock.fire(f.api.KIRO_MCP_DRAIN_TIMEOUT_MS);
    await barrier();
    assert.equal(running.state.settled, false, "execute ignores abort until explicit release");
    assert.equal(f.count("runtime.close"), 0, "bounded drain timeout does not prove physical quiescence");
    assert.equal(replacement.state.settled, false, "replacement cannot settle ahead of actual drain");
    execution.resolve(success());
    await Promise.all([running.done, replacement.done]);
    denied(replacement.state.value);
    assert.equal(f.count("runtime.close"), 1, "runtime cleanup still attempted after client failure");
    closing = observe(() => server.close());
    await failsWith(closing, [failure, runtimeFailure]);
    assert.equal(f.count("client.close"), 1, "failed cleanup is sticky rather than retried");
    assert.equal(f.count("runtime.close"), 1);
    assert.equal(f.runtimeOptions.length, 1);
    return { aborted: true, waitedBeyondBound: f.api.KIRO_MCP_DRAIN_TIMEOUT_MS, cleanupErrors: 2 };
  } finally {
    execution.resolve(success()); entered.resolve();
    await Promise.all([running.done, replacement?.done]);
    await (closing ?? observe(() => server.close())).done;
    clock.restore();
  }
}

/** @param {Fixture} f @param {string} failingBoundary @param {boolean} sameIdentity */
async function stickyReplacement(f, failingBoundary, sameIdentity = false) {
  const failure = new Error(`${failingBoundary} uncertain owner`);
  const server = await f.api.createKiroMcpServer(f.options);
  let closing;
  try {
    const first = await f.call(); assert.notEqual(first.isError, true);
    fault(f, failingBoundary, failure, true);
    if (sameIdentity) f.hooks.execute = async args => {
      await args.bootstrap.workspace({ action: "detach" });
      return success();
    };
    else f.changeWorkspace();
    denied(await f.call());
    const executions = f.count("execute"), factories = f.runtimeOptions.length;
    // A retry that happens to succeed must not silently reopen a failed owner.
    delete f.hooks[failingBoundary];
    delete f.hooks.execute;
    denied(await f.call());
    denied(await f.call("fabric_workspace", { action: "detach" }));
    denied(await f.call());
    assert.equal(f.count("execute"), executions, "no readmission or replay after uncertain cleanup");
    assert.equal(f.runtimeOptions.length, factories, "failed owner prevents replacement factory");
    closing = observe(() => server.close());
    await failsWith(closing, [failure]);
    assert.equal(f.count(failingBoundary), 1, "failed close is never retried");
    return { failedBoundary: failingBoundary, sameIdentity, replacementBlocked: true, readmissionBlocked: true };
  } finally { await (closing ?? observe(() => server.close())).done; }
}

/** @param {Fixture} f @param {boolean} asynchronous */
async function sessionRetirement(f, asynchronous) {
  assert.equal(f.api.KIRO_MCP_DRAIN_TIMEOUT_MS, 3000, "production drain bound stays exact");
  const retirementError = new Error("conversation retirement failed"), runtimeError = new Error("session runtime failed");
  const adapter = new f.api.KiroHostSessionAdapter();
  const attach = adapter.attach.bind(adapter);
  let retire;
  adapter.attach = callback => { retire = callback; attach(callback); };
  const owner = adapter.openSession({ conversationId: "handler", conversationEpoch: 0, workspaceContext: f.workspaceContext });
  const turn = adapter.beginTurn(owner);
  const entered = deferred(), execution = deferred();
  /** @type {AbortSignal|undefined} */ let signal;
  /** @type {ReturnType<typeof observe>|undefined} */ let reentrant;
  let reentered = false;
  f.hooks.execute = args => { signal = args.signal; entered.resolve(); return execution.promise; };
  f.hooks.retire = () => {
    if (!reentered) { reentered = true; reentrant = observe(() => retire(owner)); }
    if (asynchronous) return rejected(retirementError);
    throw retirementError;
  };
  fault(f, "runtime.close", runtimeError, !asynchronous);
  const server = await f.api.createKiroMcpServer({ ...f.options, hostSessions: adapter });
  const clock = fakeClock();
  const running = observe(() => f.call("fabric_exec", { code: "return 1" }, adapter, turn));
  let retirement, concurrent, late;
  try {
    await barrier();
    assert.equal(f.runtimeOptions.length, 1, "request reached the inert runtime factory");
    // Invoke the genuine registered host callback directly to isolate session
    // revocation from the real adapter's independent owner.signal abort.
    retirement = observe(() => retire(owner));
    concurrent = observe(() => retire(owner));
    assert.equal(retirement.state.threw, false, "session close returns a promise even on synchronous retirement throw");
    assert.equal(signal.aborted, true, "terminal close aborts active execution synchronously");
    late = observe(() => f.call("fabric_exec", { code: "return 1" }, adapter, turn));
    await barrier();
    assert.equal(f.count("execute"), 1, "session close immediately blocks new work");
    assert.equal(f.count("retire"), 1, "session installs shared close before reentrant retirement callback");
    assert.equal(retirement.state.settled, false); assert.equal(concurrent.state.settled, false);
    assert.equal(reentrant.state.settled, false);
    clock.fire(f.api.KIRO_MCP_DRAIN_TIMEOUT_MS);
    await barrier();
    assert.equal(f.count("runtime.close"), 0);
    execution.resolve(success());
    await Promise.all([running.done, late.done]);
    denied(late.state.value);
    await failsWith(retirement, [retirementError, runtimeError]);
    await failsWith(concurrent, [retirementError, runtimeError]);
    await failsWith(reentrant, [retirementError, runtimeError]);
    assert.equal(retirement.state.error, concurrent.state.error, "all callback wrappers share the session close rejection");
    assert.equal(retirement.state.error, reentrant.state.error);
    assert.equal(f.count("execute"), 1); assert.equal(f.count("runtime.close"), 1);
    return { synchronousAbort: true, reentrantJoined: true, originalErrors: 2 };
  } finally {
    execution.resolve(success()); entered.resolve();
    await Promise.all([running.done, retirement?.done, concurrent?.done, reentrant?.done, late?.done]);
    await observe(() => server.close()).done;
    clock.restore();
  }
}

/** @param {Fixture} f @param {boolean} asynchronous */
async function outerClose(f, asynchronous) {
  const names = ["retire", "client.close", "runtime.close", "delivery.close", "fovea.close", "server.close", "tracer.close"];
  const errors = names.map(name => new Error(`${name} outer cleanup failed`));
  const gate = deferred();
  /** @type {ReturnType<typeof observe>|undefined} */ let reentrant;
  let reentered = false;
  const server = await f.api.createKiroMcpServer(f.options);
  await f.call();
  for (let i = 0; i < names.length; i++) fault(f, names[i], errors[i], asynchronous);
  f.hooks.retire = () => {
    if (!reentered) { reentered = true; reentrant = observe(() => server.close()); }
    if (asynchronous) return rejected(errors[0]);
    throw errors[0];
  };
  f.hooks["tracer.close"] = () => gate.promise;
  const first = observe(() => server.close());
  const concurrent = observe(() => server.close());
  try {
    assert.equal(first.state.threw, false);
    assert.equal(first.promise, concurrent.promise, "concurrent server callers share exact close promise");
    await barrier();
    assert.equal(first.promise, reentrant?.promise, "reentrant server caller joins preinstalled close promise");
    assert.equal(first.state.settled, false, "outer close must wait for all cleanup callbacks, including tracer");
    for (const name of names) assert.equal(f.count(name), 1, `${name} must be attempted exactly once`);
    gate.reject(errors.at(-1));
    await failsWith(first, errors);
    await Promise.all([concurrent.done, reentrant.done]);
    assert.equal(first.state.error, concurrent.state.error); assert.equal(first.state.error, reentrant.state.error);
    const again = observe(() => server.close()); await again.done;
    assert.equal(again.promise, first.promise); assert.equal(again.state.error, first.state.error);
    for (const name of names) assert.equal(f.count(name), 1);
    denied(await f.call());
    await assert.rejects(f.api.servers[0].requests.get(f.api.ListToolsRequestSchema)(), /shutting down/u);
    await assert.rejects(f.api.servers[0].notifications.get(f.api.RootsListChangedNotificationSchema)(), /shutting down/u);
    assert.equal(f.count("execute"), 1);
    return { allOwnedCleanupAttempted: names, failures: errors.length, exactPromiseJoined: true, terminalRoutes: ["call", "list", "roots notification"] };
  } finally {
    gate.reject(errors.at(-1));
    await Promise.all([first.done, concurrent.done, reentrant?.done]);
  }
}

/** @param {Fixture} f @param {'attach'|'connect'} stage @param {boolean} asynchronous */
async function startupFailure(f, stage, asynchronous) {
  const primary = new Error(`${stage} startup failed`);
  const names = ["delivery.close", "fovea.close", "server.close", "tracer.close"];
  const errors = names.map(name => new Error(`${stage}: ${name} cleanup failed`));
  names.forEach((name, i) => fault(f, name, errors[i], asynchronous));
  const adapter = new f.api.KiroHostSessionAdapter();
  const adapterClose = adapter.close.bind(adapter);
  let adapterCloses = 0;
  adapter.close = () => { adapterCloses++; return adapterClose(); };
  const borrowedOwner = adapter.openSession({ conversationId: "borrowed", conversationEpoch: 0, workspaceContext: f.workspaceContext });
  if (stage === "attach") {
    // A pre-existing bridge is borrowed, not owned by a failed second attach.
    adapter.attach(async () => {});
    const attach = adapter.attach.bind(adapter);
    adapter.attach = callback => {
      assert.throws(() => attach(callback), /attached/u);
      throw primary;
    };
  }
  else fault(f, "connect", primary, asynchronous);
  const starting = observe(() => f.api.createKiroMcpServer({ ...f.options, hostSessions: adapter }));
  await starting.done;
  assert.equal(adapterCloses, stage === "attach" ? 0 : 1, "failed attach must not close a borrowed adapter");
  if (stage === "attach") {
    const turn = adapter.beginTurn(borrowedOwner);
    adapter.associateRequest("still-owned", turn);
    assert.equal(adapter.takeRequest("still-owned"), turn, "existing borrowed routing remains usable");
  }
  for (const name of names) assert.equal(f.count(name), 1, `${stage} failure must still attempt ${name}`);
  await failsWith(starting, [primary, ...errors]);
  assert.equal(f.count("connect"), stage === "attach" ? 0 : 1);
  assert.equal(f.runtimeOptions.length, 0, "startup failure never starts a runtime");
  return { stage, originalPrimaryIdentity: true, attempted: names, failures: errors.length + 1 };
}

/** @param {Fixture} f */
async function connectAfterAcquisition(f) {
  const primary = new Error("connect failed after handler runtime acquisition");
  const clientError = new Error("startup acquired binding close failed"), runtimeError = new Error("startup acquired runtime close failed");
  fault(f, "client.close", clientError, true); fault(f, "runtime.close", runtimeError, false);
  f.hooks.connect = async () => {
    assert.notEqual((await f.call()).isError, true);
    throw primary;
  };
  const starting = observe(() => f.api.createKiroMcpServer(f.options));
  await failsWith(starting, [primary, clientError, runtimeError]);
  for (const name of ["connect", "bind", "execute", "client.close", "runtime.close", "delivery.close", "fovea.close", "server.close", "tracer.close"]) assert.equal(f.count(name), 1);
  denied(await f.call()); assert.equal(f.count("execute"), 1);
  return { acquiredRuntimeCleaned: true, originalStartupAndCleanupErrors: 3, terminalAfterFailedStartup: true };
}

/** @param {Fixture} f @param {'factory-reject'|'factory-reject-live'|'late-created'|'publication'} schedule @param {boolean} asynchronous */
async function lateRuntime(f, schedule, asynchronous) {
  const factoryError = new Error("factory primary failure");
  const clientError = new Error("late client cleanup failed");
  const runtimeError = new Error("late runtime cleanup failed");
  const entered = deferred(), factory = deferred();
  const adapter = new f.api.KiroHostSessionAdapter();
  const owner = adapter.openSession({ conversationId: "late", conversationEpoch: 0, workspaceContext: f.workspaceContext });
  const turn = adapter.beginTurn(owner);
  const factoryRejects = schedule.startsWith("factory-reject");
  let retirement;
  // Retirement at publication is scheduled by a thenable: the factory's await
  // continuation runs first, then retirement, then runtimeForIdentity resumes.
  f.hooks.factory = options => {
    entered.resolve();
    if (schedule === "publication") return {
      then(resolve) {
        resolve(f.makeRuntime(options));
        queueMicrotask(() => { retirement = observe(() => adapter.retireSession(owner)); });
      },
    };
    return factory.promise;
  };
  fault(f, "client.close", clientError, asynchronous);
  fault(f, "runtime.close", runtimeError, !asynchronous);
  const server = await f.api.createKiroMcpServer({ ...f.options, hostSessions: adapter });
  const call = observe(() => f.call("fabric_exec", { code: "return 1" }, adapter, turn));
  try {
    await barrier();
    assert.equal(f.runtimeOptions.length, 1, "request reached the inert runtime factory");
    if (schedule !== "publication") {
      if (schedule !== "factory-reject-live") retirement = observe(() => adapter.retireSession(owner));
      if (factoryRejects) factory.reject(factoryError);
      else factory.resolve(f.makeRuntime(f.runtimeOptions[0]));
    }
    await call.done;
    await retirement?.done;
    denied(call.state.value);
    if (schedule === "factory-reject-live") {
      // Without owner retirement to provide a separate admission guard, failed
      // client disposal still latches the session. A fresh factory would succeed.
      delete f.hooks.factory;
      denied(await f.call("fabric_exec", { code: "return 1" }, adapter, turn));
      assert.equal(f.runtimeOptions.length, 1, "failed factory cleanup blocks retry/replacement on live owner");
    }
    assert.equal(f.count("client.close"), 1, "late client disposed exactly once");
    assert.equal(f.count("runtime.close"), factoryRejects ? 0 : 1, "created late runtime disposed even when client cleanup rejects");
    assert.equal(f.count("catalog.bind"), 0, "late runtime cannot publish catalog authorization");
    assert.equal(f.count("execute"), 0, "late runtime cannot execute or replay guest work");
    // Tool responses intentionally serialize errors; cleanup identity must also
    // remain reachable by the owning retirement/server close operation.
    const closing = observe(() => server.close());
    await failsWith(closing, factoryRejects ? [factoryError, clientError] : [clientError, runtimeError]);
    const leaves = errorLeaves(closing.state.error);
    if (!factoryRejects) assert.ok(leaves.some(error => error instanceof Error && /retired.*runtime|runtime.*retir/iu.test(error.message)), "retain retirement primary as well as cleanup failures");
    assert.throws(() => adapter.beginTurn(owner), /retired|stale/u);
    denied(await f.call());
    assert.equal(f.runtimeOptions.length, 1);
    return { schedule, noPublication: true, noReplay: true, originalCleanupIdentities: true };
  } finally {
    factory.reject(factoryError); entered.resolve();
    await call.done; await retirement?.done;
    await observe(() => server.close()).done;
  }
}

/** @param {Fixture} f @param {boolean} reentry */
async function catalogBoundary(f, reentry) {
  const primary = new Error("catalog publication failed");
  const clientError = new Error("catalog client cleanup failed"), runtimeError = new Error("catalog runtime cleanup failed");
  fault(f, "client.close", clientError, true);
  fault(f, "runtime.close", runtimeError, false);
  const server = await f.api.createKiroMcpServer(f.options);
  let closing;
  f.hooks["catalog.bind"] = () => {
    if (reentry) closing = observe(() => server.close());
    else throw primary;
  };
  try {
    denied(await f.call());
    assert.equal(f.count("execute"), 0, "catalog throw/close reentry must not admit a new active execution lease");
    delete f.hooks["catalog.bind"];
    denied(await f.call());
    assert.equal(f.count("execute"), 0, "publication failure cannot reopen the same runtime identity");
    closing ??= observe(() => server.close());
    await failsWith(closing, reentry ? [clientError, runtimeError] : [primary, clientError, runtimeError]);
    assert.equal(f.count("client.close"), 1); assert.equal(f.count("runtime.close"), 1);
    assert.equal(f.runtimeOptions.length, 1);
    return { reentry, noLeaseAfterClose: true, failedPublicationRetained: true };
  } finally { await (closing ?? observe(() => server.close())).done; }
}

/** @param {Fixture} f */
async function invalidationReentry(f) {
  const failure = new Error("synchronous catalog revocation failed");
  const execution = deferred();
  /** @type {AbortSignal|undefined} */ let signal;
  /** @type {ReturnType<typeof observe>|undefined} */ let reentrant;
  f.hooks.execute = args => { signal = args.signal; return execution.promise; };
  const server = await f.api.createKiroMcpServer(f.options);
  const clock = fakeClock();
  const running = observe(() => f.call());
  let closing;
  try {
    await barrier(); assert.equal(f.count("execute"), 1);
    f.hooks.invalidate = () => { reentrant ??= observe(() => server.close()); throw failure; };
    closing = observe(() => server.close());
    assert.equal(closing.state.threw, false);
    assert.equal(closing.promise, reentrant.promise, "revocation callback joins the preinstalled server close");
    assert.equal(signal.aborted, true, "revocation failure must not skip synchronous cancellation");
    denied(await f.call());
    await barrier(); clock.fire(3000); await barrier();
    assert.equal(f.count("runtime.close"), 0, "revocation failure cannot release the active lease");
    execution.resolve(success()); await running.done;
    await failsWith(closing, [failure]); await reentrant.done;
    for (const name of ["retire", "client.close", "runtime.close", "delivery.close", "fovea.close", "server.close", "tracer.close"]) assert.equal(f.count(name), 1);
    return { synchronousRevocationFailure: true, reentrantJoined: true, actualDrainPreserved: true };
  } finally {
    execution.resolve(success()); await running.done;
    await (closing ?? observe(() => server.close())).done;
    await reentrant?.done; clock.restore();
  }
}

/** @param {Fixture} f */
async function duplicateSessionRuntime(f) {
  const adapter = new f.api.KiroHostSessionAdapter();
  const firstOwner = adapter.openSession({ conversationId: "first", conversationEpoch: 0, workspaceContext: f.workspaceContext });
  const otherOwner = adapter.openSession({ conversationId: "other", conversationEpoch: 0, workspaceContext: f.workspaceContext });
  const firstTurn = adapter.beginTurn(firstOwner), otherTurn = adapter.beginTurn(otherOwner);
  const server = await f.api.createKiroMcpServer({ ...f.options, hostSessions: adapter });
  try {
    assert.notEqual((await f.call("fabric_exec", { code: "return 1" }, adapter, firstTurn)).isError, true);
    f.hooks.factory = () => f.runtimes[0];
    denied(await f.call("fabric_exec", { code: "return 1" }, adapter, otherTurn));
    assert.equal(f.count("client.close"), 1, "only the second session's fresh binding is disposed");
    assert.equal(f.count("runtime.close"), 0, "another session's runtime is never ours to close");
    assert.notEqual((await f.call("fabric_exec", { code: "return 1" }, adapter, firstTurn)).isError, true);
    assert.equal(f.count("execute"), 2); assert.equal(f.runtimeOptions.length, 2);
    await server.close();
    assert.equal(f.count("runtime.close"), 1); assert.equal(f.count("client.close"), 2);
    return { foreignRuntimePreserved: true, originalOwnerStillUsable: true, closedOnceByOwner: true };
  } finally { await observe(() => server.close()).done; }
}

/** @param {Fixture} f @param {boolean} cleanupFails */
async function legacyRuntimeReuse(f, cleanupFails) {
  const bindingError = new Error("reused legacy runtime fresh binding cleanup failed");
  const server = await f.api.createKiroMcpServer(f.options);
  let closing;
  try {
    assert.notEqual((await f.call()).isError, true);
    const original = f.runtimes[0];
    f.changeWorkspace();
    // Losing the old root does not auto-authorize its replacement. Select the
    // new advertised root through the real handler before expecting a binding.
    const listed = await f.call("fabric_workspace", { action: "list" });
    assert.notEqual(listed.isError, true);
    const roots = JSON.parse(listed.content[0].text).roots;
    assert.equal(roots.length, 1);
    const selected = await f.call("fabric_workspace", { action: "select", rootId: roots[0].rootId });
    assert.notEqual(selected.isError, true);
    f.hooks.factory = () => original;
    // A real disposed Fabric service also refuses catalog rebinding. Its new
    // binding belongs to this attempt, not the memoized successful old cleanup.
    f.hooks["catalog.bind"] = () => { throw new Error("disposed service cannot bind a catalog"); };
    f.hooks["client.close"] = () => {
      if (cleanupFails && f.count("client.close") === 2) throw bindingError;
    };
    denied(await f.call());
    assert.equal(f.count("bind"), 2, "both factory attempts acquired a real workspace binding");
    assert.equal(f.count("client.close"), 2, "rejecting runtime reuse must dispose the fresh binding");
    assert.equal(f.count("runtime.close"), 1, "retired runtime cleanup must not be replayed");
    assert.equal(f.count("catalog.bind"), 1, "reject retired instance before granting another catalog");
    delete f.hooks.factory; delete f.hooks["catalog.bind"]; delete f.hooks["client.close"];
    if (cleanupFails) {
      denied(await f.call());
      assert.equal(f.runtimeOptions.length, 2, "uncertain fresh binding prevents replacement");
      closing = observe(() => server.close());
      await failsWith(closing, [bindingError]);
      assert.equal(f.count("client.close"), 2);
    } else {
      assert.notEqual((await f.call()).isError, true, "successful cleanup allows an explicit new request with a fresh runtime");
      assert.equal(f.runtimeOptions.length, 3); assert.equal(f.count("execute"), 2);
      closing = observe(() => server.close()); await closing.done;
      assert.equal(closing.state.failed, false);
      assert.equal(f.count("runtime.close"), 2); assert.equal(f.count("client.close"), 3);
    }
    return { cleanupFails, freshBindingDisposed: true, oldCleanupNotReplayed: true };
  } finally { await (closing ?? observe(() => server.close())).done; }
}

/** @returns {HandlerCase[]} */
export function createHandlerCases() {
  const effects = "fresh source bundle; inert external/native boundaries; retained isolated project .tmp files; no network";
  return [
    { id: "LC14", title: "bound cleanup drains real execution and failed workspace owners stay non-admissible", effects, deadlineMs: 60000,
      run: context => runVariants(context, "LC14", [
        ["client-sync-drain", f => boundDrain(f, false)], ["client-async-drain", f => boundDrain(f, true)],
        ["sticky-client", f => stickyReplacement(f, "client.close")], ["sticky-runtime", f => stickyReplacement(f, "runtime.close")],
        ["same-identity-client", f => stickyReplacement(f, "client.close", true)], ["same-identity-runtime", f => stickyReplacement(f, "runtime.close", true)],
      ]) },
    { id: "LC15", title: "session retirement revokes synchronously, joins reentry and retains all errors", effects, deadlineMs: 60000,
      run: context => runVariants(context, "LC15", [["retire-sync", f => sessionRetirement(f, false)], ["retire-async", f => sessionRetirement(f, true)]]) },
    { id: "LC16", title: "outer close joins concurrent and reentrant callers and attempts every owned cleanup", effects, deadlineMs: 60000,
      run: context => runVariants(context, "LC16", [["sync-cleanup", f => outerClose(f, false)], ["async-cleanup", f => outerClose(f, true)], ["invalidation-reentry", invalidationReentry]]) },
    { id: "LC17", title: "attach/connect startup errors retain primary identity and every cleanup failure", effects, deadlineMs: 60000,
      run: context => runVariants(context, "LC17", [["attach-sync", f => startupFailure(f, "attach", false)], ["attach-async-cleanup", f => startupFailure(f, "attach", true)],
        ["connect-sync", f => startupFailure(f, "connect", false)], ["connect-async", f => startupFailure(f, "connect", true)], ["connect-after-acquisition", connectAfterAcquisition]]) },
    { id: "LC18", title: "late factory/publication retirement disposes ownership without masking or replay", effects, deadlineMs: 60000,
      run: context => runVariants(context, "LC18", [
        ["factory-sync-cleanup", f => lateRuntime(f, "factory-reject", false)], ["factory-async-cleanup", f => lateRuntime(f, "factory-reject", true)],
        ["factory-live-owner", f => lateRuntime(f, "factory-reject-live", true)],
        ["late-created-sync", f => lateRuntime(f, "late-created", false)], ["late-created-async", f => lateRuntime(f, "late-created", true)],
        ["publication-sync", f => lateRuntime(f, "publication", false)], ["publication-async", f => lateRuntime(f, "publication", true)],
        ["catalog-throw", f => catalogBoundary(f, false)], ["catalog-reentry", f => catalogBoundary(f, true)],
        ["legacy-runtime-reuse", f => legacyRuntimeReuse(f, false)], ["legacy-reuse-binding-fails", f => legacyRuntimeReuse(f, true)],
        ["duplicate-session-runtime", duplicateSessionRuntime],
      ]) },
  ];
}
