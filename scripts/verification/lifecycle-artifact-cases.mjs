// W3 acceptance ledger: LC19 same-owner transitions; LC20 authenticated owners;
// LC21 output/checkpoint/receipt retention and budgets; LC22 truthful settlement;
// LC23 real-store/provider controls and capability authority. Fixture directories
// and repository metadata are retained; production disposal touches only owned files.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadArtifactFixture, succeeded, failed, text, value, deferred } from "./lifecycle-artifact-fixture.mjs";

/** @typedef {{name:string,run:(f:any)=>any,classification?:string,config?:Record<string,unknown>}} ArtifactVariant */

const OUTPUT = "W3-retained-output-".repeat(600);
const idPattern = /^ka_[a-f0-9]{48}$/u;
const metadata = response => response.structuredContent;
function issued(response) {
  assert.equal(metadata(response)?.executionStatus, "succeeded", text(response));
  assert.equal(metadata(response)?.deliveryStatus, "artifact", text(response));
  assert.equal(metadata(response)?.retryProgram, false);
  assert.match(metadata(response)?.artifactId ?? "", idPattern);
  return metadata(response).artifactId;
}
function denied(response) { assert.equal(response.isError, true, "foreign, expired or retired artifact must be denied"); }
async function readable(f, id, route = {}, expected = OUTPUT) {
  const response = await f.read(id, route);
  assert.notEqual(response.isError, true, `same owner must read issued artifact across runtime transition: ${text(response)}`);
  const page = value(response);
  assert.equal(page.id, id);
  assert.ok(page.text.includes(expected.slice(0, 60)), "actual artifact provider returned retained content");
  assert.ok(page.nextOffset > page.offset);
  return page;
}
async function overflow(f, mutation, route = {}) {
  f.hooks.execute = async args => {
    if (mutation) {
      const prepared = await args.bootstrap.workspace(mutation, args.signal);
      assert.equal(prepared.status, "pending"); assert.equal(prepared.committed, false);
    }
    return succeeded(OUTPUT);
  };
  return f.call("fabric_exec", { code: "return payloads.output", payloads: { output: OUTPUT } }, route);
}
async function selected(f, route = {}) {
  f.setRoots(["workspace", "other-workspace"]);
  const listing = value(await f.call("fabric_workspace", { action: "list" }, route));
  assert.equal(listing.roots.length, 2);
  return { action: "select", rootId: listing.roots.find(root => root.name === "other-workspace").rootId };
}
function native(f, conversationId = "w3", conversationEpoch = 0, adapter = new f.api.KiroHostSessionAdapter()) {
  const owner = adapter.openSession({ conversationId, conversationEpoch, workspaceContext: f.workspaceContext });
  return { owner, adapter, turn: adapter.beginTurn(owner) };
}
async function managed(f, test, route) {
  const server = await f.api.createKiroMcpServer({ ...f.options, ...(route ? { hostSessions: route.adapter } : {}) });
  try { return await test(server); }
  finally { await server.close(); }
}

// Each variant is independent, so known reds cannot hide already-green controls.
// Exceptions retain exact evidence on disk even if an outer runner flattens them.
async function runVariants(context, id, variants) {
  const facts = [], failures = [];
  for (const variant of variants) {
    if (context.artifactVariant && context.artifactVariant !== variant.name) continue;
    const f = await loadArtifactFixture(context, `${id}-${variant.name}`, variant.config);
    let record;
    try {
      const details = await variant.run(f);
      assert.equal(f.evidence().forbiddenExecutionAttempts, 0, "no compiler/VM dispatch is permitted in source-handler cases");
      record = { name: variant.name, classification: variant.classification ?? "regression", status: "passed", ...details };
    }
    catch (error) {
      record = { name: variant.name, classification: variant.classification ?? "regression", status: "failed", assertion: error.message, stack: error.stack };
      failures.push(Object.assign(new Error(`${id}/${variant.name}: ${error.message}`, { cause: error }), f.evidence()));
    }
    record = { ...record, ...f.evidence() };
    fs.writeFileSync(path.join(f.directory, "case-evidence.json"), JSON.stringify(record, null, 2), { flag: "wx", mode: 0o600 });
    facts.push(record);
  }
  assert.ok(facts.length, `no matching ${id} variants`);
  if (failures.length) throw Object.assign(new AggregateError(failures, `${id}: ${failures.length}/${facts.length} artifact variants failed`), { facts });
  return { status: "passed", variants: facts, sourceLevelHandler: id !== "LC23", realStore: true, realArtifactProvider: true, gatedExecution: true, realCoreForwardingCertified: false, fixturesRetained: true };
}

/** @type {ArtifactVariant[]} */
const transitionVariants = ["detach", "select", "attach"].map(action => ({
  name: `overflow-deferred-${action}`,
  run: f => managed(f, async () => {
    const mutation = action === "select" ? await selected(f) : action === "attach" ? { action, path: f.roots["other-workspace"] } : { action };
    const result = await overflow(f, mutation);
    const id = issued(result);
    await readable(f, id);
    assert.equal(metadata(result)?.workspaceTransition?.status, "committed");
    assert.equal(metadata(result)?.workspaceTransition?.committed, true);
    assert.equal(metadata(result)?.workspaceTransition?.nextExecutionRequired, true);
    assert.equal(f.runtimes.length, 2, "next handler creates a replacement runtime");
    const state = value(await f.call("fabric_workspace", { action: "status" }));
    assert.equal(state.status, action === "detach" ? "unbound" : "bound");
    if (action === "attach") assert.equal(f.api.events.filter(item => item === "elicitInput").length, 1, "manual attach uses exact SDK form once");
    return { action, id, nextHandlerRead: true };
  }),
}));
transitionVariants.push(...["direct-detach", "direct-select", "direct-attach", "roots-empty", "roots-unavailable"].map(name => ({
  name,
  run: f => managed(f, async () => {
    const id = issued(await overflow(f));
    await readable(f, id);
    if (name.startsWith("direct-")) {
      const action = name.slice(7);
      const mutation = action === "select" ? await selected(f) : action === "attach" ? { action, path: f.roots["other-workspace"] } : { action };
      assert.notEqual((await f.call("fabric_workspace", mutation)).isError, true);
    } else f.setRoots([], name === "roots-empty" ? "explicitly-empty" : "temporarily-unavailable");
    await readable(f, id);
    return { id, sameMcpOwner: true, transition: name };
  }),
})));
transitionVariants.push({ name: "legacy-meta-is-not-chat-identity", classification: "control", run: f => managed(f, async () => {
  const id = issued(await overflow(f));
  await readable(f, id, { meta: { conversationId: "other-chat", conversationEpoch: 99 } });
  return { id, ownership: "legacy-MCP-instance-not-native-chat" };
}) });

/** @type {ArtifactVariant[]} */
const sessionVariants = [
  { name: "foreign-genuine-id-original-owner-success", classification: "control", run: async f => {
    const original = native(f), foreign = native(f, "foreign", 0, original.adapter);
    return managed(f, async () => {
      const id = issued(await overflow(f, undefined, original));
      denied(await f.read(id, foreign));
      await readable(f, id, original);
      assert.equal(f.runtimeOptions[0].artifactsRoot, f.runtimeOptions[1].artifactsRoot, "identical data/workspace roots do not confer authority");
      return { id, deniedForeign: true, originalStillReadable: true, sharedRoot: true };
    }, original);
  } },
  { name: "retire-new-epoch-no-revival", run: async f => {
    const original = native(f);
    return managed(f, async () => {
      const id = issued(await overflow(f, undefined, original));
      await readable(f, id, original);
      const escaped = f.capabilities.at(-1);
      assert.ok(escaped, "handler must pass host-only artifactAccess capability");
      await original.adapter.retireSession(original.owner);
      assert.throws(() => original.adapter.associateRequest(999, original.turn), /retired|stale|Foreign/);
      const acquired = [];
      const saved = Object.fromEntries(["mkdirSync", "openSync", "readdirSync"].map(key => [key, fs[key]]));
      try {
        for (const key of Object.keys(saved)) fs[key] = () => { acquired.push(key); throw new Error("storage acquisition after revocation"); };
        assert.throws(() => escaped.read(id), /closed|retired|revoked|unavailable|shutting down/i);
        assert.throws(() => escaped.checkpoint("late evidence"), /closed|retired|revoked|unavailable|shutting down/i);
      } finally { Object.assign(fs, saved); }
      assert.deepEqual(acquired, [], "revoked owner fails before acquiring storage");
      const next = native(f, "w3", 1, original.adapter);
      denied(await f.read(id, next));
      const own = issued(await overflow(f, undefined, next));
      await readable(f, own, next);
      denied(await f.read(id, next));
      return { id, nextEpochId: own, staleCapabilityRevoked: true, postRevocationAcquisitions: acquired.length };
    }, original);
  } },
  { name: "native-args-meta-cannot-authorize", classification: "control", run: async f => {
    const original = native(f);
    return managed(f, async () => {
      const id = issued(await overflow(f, undefined, original));
      const before = f.calls.length;
      const response = await f.call("fabric_exec", { code: "return 1", payloads: { conversationId: "w3" } }, { meta: { conversationId: "w3", conversationEpoch: 0 } });
      denied(response); assert.equal(f.calls.length, before, "unassociated request must not execute");
      await readable(f, id, original);
      return { id, unassociatedDeniedBeforeExecute: true };
    }, original);
  } },
];

/** @type {ArtifactVariant[]} */
const retentionVariants = [
  { name: "ttl-across-runtime-not-refreshed-by-transition", config: { artifacts: { ttlMs: 1000 } }, run: async f => {
    const saved = Date.now; let now = saved(); Date.now = () => now;
    try { return await managed(f, async () => {
      const id = issued(await overflow(f));
      now += 500;
      await f.call("fabric_workspace", { action: "detach" });
      await readable(f, id);
      now += 1001;
      denied(await f.read(id));
      return { id, ttlMs: 1000, retainedAcrossTransitionThenExpired: true };
    }); } finally { Date.now = saved; }
  } },
  { name: "quota-shared-across-runtime-generations", config: { artifacts: { maxArtifacts: 2 } }, run: async f => {
    const saved = Date.now; let now = saved(); Date.now = () => now;
    try { return await managed(f, async () => {
      const first = issued(await overflow(f)); now += 10;
      await f.call("fabric_workspace", { action: "detach" });
      const second = issued(await overflow(f)); now += 10;
      await readable(f, first); now += 10;
      // Read second more recently so first is the actual LRU victim.
      await readable(f, second); now += 10;
      await f.call("fabric_workspace", await selected(f));
      const third = issued(await overflow(f));
      denied(await f.read(first)); await readable(f, second); await readable(f, third);
      return { ids: [first, second, third], configuredMaxArtifacts: 2, ownerWideLru: true };
    }); } finally { Date.now = saved; }
  } },
  { name: "checkpoint-survives-detach-select-attach", run: f => managed(f, async () => {
    f.hooks.execute = async (_args, gate) => succeeded(await gate.invoke("checkpoint", { value: { evidence: "checkpoint-before-transition" }, label: "W3" }));
    const checkpoint = value(await f.call());
    assert.equal(checkpoint.retrieval.ref, "artifacts.read");
    for (const action of ["detach", "select", "attach"]) {
      const mutation = action === "select" ? await selected(f) : action === "attach" ? { action, path: f.roots.workspace } : { action };
      assert.notEqual((await f.call("fabric_workspace", mutation)).isError, true);
      await readable(f, checkpoint.id, {}, "{\"label\":\"W3\",\"value\":");
    }
    return { id: checkpoint.id, transitions: 3 };
  }) },
  { name: "recovery-receipt-survives-roots-loss", run: f => managed(f, async () => {
    f.hooks.execute = async () => failed("outer failure after issued operation", { audits: [{ ref: "local.write", nestedToolCallId: "w3-receipt", startedAt: 1, endedAt: 2, success: true, effectOutcome: "committed", commitAcknowledgement: { committed: true, operation: "write" } }] });
    const response = await f.call();
    assert.equal(metadata(response)?.executionStatus, "failed");
    assert.equal(metadata(response)?.retryProgram, false);
    const id = metadata(response)?.receiptId; assert.match(id ?? "", idPattern);
    f.setRoots([], "explicitly-empty");
    await readable(f, id, {}, "{\"schemaVersion\":1,\"executionStatus\":\"failed\"");
    return { id, genuineProjectedReceipt: true };
  }) },
];

/** @type {ArtifactVariant[]} */
const faultVariants = [
  { name: "write-failure-commits-without-replay", config: { artifacts: { maxArtifactChars: 1000, maxTotalChars: 1000 } }, run: f => managed(f, async () => {
    const response = await overflow(f, { action: "detach" });
    assert.equal(metadata(response)?.executionStatus, "succeeded");
    assert.equal(metadata(response)?.deliveryStatus, "unavailable");
    assert.equal(metadata(response)?.retryProgram, false);
    assert.equal(metadata(response)?.artifactId, undefined);
    const state = value(await f.call("fabric_workspace", { action: "status" }));
    assert.equal(state.status, "unbound", "successful execution commits pending detach despite delivery failure");
    assert.equal(metadata(response)?.workspaceTransition?.status, "committed");
    assert.equal(metadata(response)?.workspaceTransition?.committed, true);
    assert.equal(f.calls.length, 1, "output retention failure must never replay execution");
    return { executions: 1, delivery: "unavailable", transition: "committed" };
  }) },
  { name: "transition-failure-preserves-success", run: async f => {
    const server = await f.api.createKiroMcpServer(f.options);
    const failure = new Error("W3 controlled runtime close failure");
    f.hooks["runtime.close"] = () => { throw failure; };
    try {
      const response = await overflow(f, { action: "detach" });
      assert.equal(metadata(response)?.executionStatus, "succeeded", "settled guest success must not become opaque adapter_error");
      assert.equal(metadata(response)?.retryProgram, false);
      assert.equal(metadata(response)?.workspaceTransition?.status, "failed");
      assert.equal(metadata(response)?.workspaceTransition?.committed, false);
      assert.ok(["artifact", "unavailable"].includes(metadata(response)?.deliveryStatus));
      assert.equal(f.calls.length, 1);
      return { transition: "failed", execution: "succeeded", replayed: false };
    } finally { await server.close().catch(() => {}); }
  } },
  { name: "cancel-after-success-preserves-success", run: f => managed(f, async () => {
    const controller = new AbortController();
    f.hooks.execute = async args => {
      await args.bootstrap.workspace({ action: "detach" }, args.signal);
      controller.abort(new Error("W3 cancellation after program effects"));
      return succeeded(OUTPUT);
    };
    const response = await f.call("fabric_exec", { code: "return 1" }, { signal: controller.signal });
    assert.equal(metadata(response)?.executionStatus, "succeeded", "successful guest completion survives transition cancellation");
    assert.equal(metadata(response)?.retryProgram, false);
    assert.equal(metadata(response)?.workspaceTransition?.status, "cancelled");
    assert.equal(metadata(response)?.workspaceTransition?.committed, false);
    assert.equal(f.calls.length, 1);
    return { execution: "succeeded", transition: "cancelled" };
  }) },
  { name: "guest-failure-does-not-commit", classification: "control", run: f => managed(f, async () => {
    f.hooks.execute = async args => { await args.bootstrap.workspace({ action: "detach" }, args.signal); return failed("guest failed"); };
    const response = await f.call();
    assert.equal(metadata(response)?.executionStatus, "failed");
    assert.equal(value(await f.call("fabric_workspace", { action: "status" })).status, "bound");
    assert.equal(metadata(response)?.retryProgram, false);
    assert.equal(f.calls.length, 1);
    return { guestFailed: true, bindingPreserved: true };
  }) },
  { name: "expiry-during-transition-no-stale-advertisement", config: { artifacts: { ttlMs: 1000 } }, run: async f => {
    const saved = Date.now; let now = saved(); Date.now = () => now;
    try { return await managed(f, async () => {
      f.hooks["runtime.close"] = () => { now += 1001; };
      const response = await overflow(f, { action: "detach" });
      assert.equal(metadata(response)?.executionStatus, "succeeded");
      if (metadata(response)?.artifactId) await readable(f, metadata(response).artifactId);
      else { assert.equal(metadata(response)?.deliveryStatus, "unavailable"); assert.doesNotMatch(text(response), /ka_[a-f0-9]{48}/u); }
      return { validatedAtReturn: true, serializationMayFollowCommit: true };
    }); } finally { Date.now = saved; }
  } },
  { name: "receipt-evicted-by-output-not-advertised", config: { artifacts: { maxArtifacts: 1 } }, run: f => managed(f, async () => {
    f.hooks.execute = async () => failed(OUTPUT, { audits: [{ ref: "local.write", nestedToolCallId: "w3", startedAt: 1, endedAt: 2, success: true }] });
    const response = await f.call();
    assert.equal(metadata(response)?.executionStatus, "failed");
    const ids = [...new Set(text(response).match(/ka_[a-f0-9]{48}/gu) ?? [])];
    for (const id of [metadata(response)?.receiptId, metadata(response)?.artifactId].filter(Boolean)) assert.ok(ids.includes(id));
    for (const id of ids) assert.notEqual((await f.read(id)).isError, true, "projection must not advertise a receipt evicted by its own output write");
    assert.ok(ids.length > 0);
    return { advertisedHandles: ids, allReadableAtReturn: true };
  }) },
  { name: "retirement-during-success-no-handle", run: async f => {
    const route = native(f), entered = deferred(), release = deferred();
    const server = await f.api.createKiroMcpServer({ ...f.options, hostSessions: route.adapter });
    let running, retirement;
    try {
      f.hooks.execute = async () => { entered.resolve(); await release.promise; return succeeded(OUTPUT); };
      running = f.call("fabric_exec", { code: "return 1" }, route);
      await entered.promise;
      retirement = route.adapter.retireSession(route.owner);
      release.resolve();
      const response = await running;
      await retirement;
      assert.equal(metadata(response)?.executionStatus, "succeeded", "retirement cannot erase settled guest outcome");
      assert.equal(metadata(response)?.deliveryStatus, "unavailable");
      assert.equal(metadata(response)?.retryProgram, false);
      assert.equal(metadata(response)?.artifactId, undefined);
      assert.doesNotMatch(text(response), /ka_[a-f0-9]{48}/u);
      return { ownerRetired: true, noAdvertisedHandle: true };
    } finally { release.resolve(); await Promise.allSettled([running, retirement]); await server.close(); }
  } },
];

/** @type {ArtifactVariant[]} */
const providerVariants = [
  { name: "real-store-ttl-quota-close", classification: "control", run: async f => {
    let now = 0;
    const store = f.api.createKiroArtifactStore({ now: () => now, maxArtifacts: 2, maxArtifactChars: 100, maxTotalChars: 150, ttlMs: 1000 });
    const first = store.write("first"); now++;
    const second = store.write("second"); now++;
    const third = store.write("third");
    assert.throws(() => store.read(first), /unavailable|expired/);
    assert.equal(store.read(second).text, "second");
    assert.equal(store.read(third).text, "third");
    now += 1001; assert.throws(() => store.read(third), /unavailable|expired/);
    store.close(); assert.throws(() => store.write("late"), /closed/); assert.throws(() => store.read(second), /closed/);
    return { quota: 2, ttlMs: 1000, closedRejects: true };
  } },
  { name: "capability-denial-never-falls-back", run: async f => {
    const store = f.api.createKiroArtifactStore();
    const provider = new f.api.KiroPowerArtifactsProvider(store);
    const id = store.write("must not leak from local runtime store");
    const deniedCapability = { read() { throw new Error("artifact is unavailable or expired"); }, checkpoint() { throw new Error("W3 owner retired"); } };
    try {
      const context = f.invocation({ artifactAccess: deniedCapability });
      await assert.rejects(provider.invoke("read", { id }, context), /unavailable or expired/);
      await assert.rejects(provider.invoke("checkpoint", { value: "late" }, context), /W3 owner retired/);
      assert.equal((await provider.invoke("read", { id }, f.invocation({}))).text, "must not leak from local runtime store");
      return { id, capabilityAuthoritative: true, standaloneFallbackControl: true };
    } finally { await provider.close(); store.close(); }
  } },
  { name: "checkpoint-tighter-caps", classification: "control", run: async f => {
    let now = 0;
    const store = f.api.createKiroArtifactStore();
    const provider = new f.api.KiroPowerArtifactsProvider(store, { maxArtifacts: 32, maxArtifactChars: 200000, maxTotalChars: 800000, ttlMs: 3600000, now: () => now });
    const invoke = (action, args) => provider.invoke(action, args, f.invocation({}));
    try {
      const ids = [];
      for (let index = 0; index < 17; index++) { now++; ids.push((await invoke("checkpoint", { value: index })).id); }
      await assert.rejects(invoke("read", { id: ids[0] }), /unavailable|expired/);
      assert.equal(JSON.parse((await invoke("read", { id: ids[16] })).text).value, 16);
      await assert.rejects(invoke("checkpoint", { value: "x".repeat(100001) }));
      now += 900001; await assert.rejects(invoke("read", { id: ids[16] }), /unavailable|expired/);
      return { checkpointMaxArtifacts: 16, checkpointMaxChars: 100000, checkpointTtlMs: 900000 };
    } finally { await provider.close(); store.close(); }
  } },
];

// These owner tests use the internal API only after Main coordinated its shape.
providerVariants.push(
  { name: "lazy-owner-revocation-no-storage-acquisition", run: async f => {
    let loads = 0;
    const owner = f.api.createKiroArtifactOwner(() => { loads++; throw new Error("must not acquire storage"); });
    assert.throws(() => owner.access.read(`ka_${"a".repeat(48)}`), /unavailable/);
    assert.equal(loads, 0, "unknown ID does not create storage");
    owner.revoke();
    assert.throws(() => owner.write("late"), /retired|revoked|closed/);
    assert.throws(() => owner.access.checkpoint("late"), /retired|revoked|closed/);
    assert.equal(owner.has(`ka_${"a".repeat(48)}`), false);
    const closing = owner.close(); assert.equal(owner.close(), closing); await closing;
    assert.equal(loads, 0);
    let reentrant;
    reentrant = f.api.createKiroArtifactOwner(() => { reentrant.revoke(); return { root: path.join(f.directory, "must-not-exist") }; });
    assert.throws(() => reentrant.write("revoked during settings lookup"), /retired|revoked|closed/);
    assert.equal(fs.existsSync(path.join(f.directory, "must-not-exist")), false);
    await reentrant.close();
    return { storageAcquisitions: 0, reentrantRevocationChecked: true, sharedClose: true };
  } },
  { name: "owner-response-total-item-caps-and-nonrenewing-has", run: async f => {
    let now = 0;
    const owner = f.api.createKiroArtifactOwner(() => ({ now: () => now, maxArtifacts: 4, maxArtifactChars: 80, maxTotalChars: 100, ttlMs: 1000 }));
    try {
      const first = owner.write("a".repeat(60)); now++;
      assert.throws(() => owner.write("x".repeat(81)), /bounds|quota/);
      assert.equal(owner.has(first), true, "impossible write does not evict usable output");
      const second = owner.write("b".repeat(60));
      assert.equal(owner.has(first), false, "total character quota applies independently of entry quota");
      assert.equal(owner.has(second), true);
      now += 900; assert.equal(owner.has(second), true);
      now += 101; assert.equal(owner.has(second), false, "publication checks must not renew TTL");
      return { maxItemChars: 80, maxTotalChars: 100, publicationDoesNotRefreshTtl: true };
    } finally { await owner.close(); }
  } },
  { name: "owner-checkpoints-keep-tighter-caps", run: async f => {
    let now = 0;
    const owner = f.api.createKiroArtifactOwner(() => ({ now: () => now, maxArtifacts: 32, maxArtifactChars: 200000, maxTotalChars: 800000, ttlMs: 3600000 }));
    try {
      const response = owner.write("response remains independent");
      const ids = [];
      for (let i = 0; i < 17; i++) { now++; ids.push(owner.access.checkpoint(JSON.stringify({ i }))); }
      assert.equal(owner.has(ids[0]), false); assert.equal(owner.has(ids[16]), true); assert.equal(owner.has(response), true);
      assert.throws(() => owner.access.checkpoint("x".repeat(100001)), /bounds/);
      now += 900001; assert.equal(owner.has(ids[16]), false); assert.equal(owner.has(response), true);
      owner.revoke(); assert.equal(owner.has(response), false);
      assert.throws(() => owner.access.read(response), /retired|closed|revoked/);
      return { checkpointMaxArtifacts: 16, checkpointMaxChars: 100000, checkpointTtlMs: 900000, responseBudgetIndependent: true };
    } finally { await owner.close(); }
  } },
);

transitionVariants.push(...["detach", "select"].map(action => ({
  name: `native-overflow-deferred-${action}`,
  run: async f => {
    const route = native(f);
    return managed(f, async () => {
      const mutation = action === "select" ? await selected(f, route) : { action };
      const id = issued(await overflow(f, mutation, route));
      await readable(f, id, route);
      f.setRoots([], "temporarily-unavailable");
      await readable(f, id, route);
      return { id, authenticatedRoute: true, action, unavailableRead: true };
    }, route);
  },
})));

faultVariants.push({ name: "expired-checkpoint-not-advertised", config: { artifacts: { ttlMs: 1000 } }, run: async f => {
  const saved = Date.now; let now = saved(); Date.now = () => now;
  try { return await managed(f, async () => {
    /** @type {any} */ let checkpoint;
    f.hooks.execute = async (_args, gate) => {
      checkpoint = await gate.invoke("checkpoint", { value: "evidence expired before response" });
      now += 1001;
      return failed("guest failure", { checkpoints: [{ id: checkpoint.id }], failure: { code: "runtime_error", phase: "execute", checkpoints: [{ id: checkpoint.id }] } });
    };
    const response = await f.call();
    assert.equal(metadata(response)?.executionStatus, "failed");
    assert.equal(metadata(response)?.retryProgram, false);
    assert.ok(!text(response).includes(checkpoint.id), "expired host checkpoint must not be advertised in text or failure metadata");
    assert.ok(!JSON.stringify(metadata(response)).includes(checkpoint.id));
    denied(await f.read(checkpoint.id));
    return { expiredId: checkpoint.id, noStaleCheckpointAdvertisement: true };
  }); } finally { Date.now = saved; }
} });

transitionVariants.push({ name: "injected-runtime-keeps-owner-artifacts", run: async f => {
  // Avoid an initial root identity change that legitimately retires an injected runtime.
  f.setRoots([], "explicitly-empty");
  const injected = f.options.prepareRuntime({ cwd: f.roots.workspace, configFile: "", mcpConfigPath: "", artifactsRoot: "" });
  const server = await f.api.createKiroMcpServer({ ...f.options, runtime: injected });
  try {
    const id = issued(await overflow(f, { action: "detach" }));
    assert.equal(f.runtimes.length, 1, "first call actually used the injected runtime");
    await readable(f, id);
    assert.equal(f.runtimes.length, 2);
    return { id, injectedRuntimeCompatible: true, providerNotReplaced: true };
  } finally { await server.close(); }
} });

faultVariants.push(
  { name: "file-write-failure-after-commit-no-replay", run: f => managed(f, async () => {
    await f.call(); // Acquire the workspace/runtime before faulting result storage.
    const before = f.calls.length, directory = path.join(f.roots.data, "fabric", "artifacts");
    const saved = fs.writeFileSync;
    let failures = 0;
    fs.writeFileSync = (file, data, options) => {
      if (typeof file === "number") {
        const descriptor = fs.fstatSync(file);
        const owned = fs.readdirSync(directory).filter(name => idPattern.test(name)).some(name => {
          const stat = fs.lstatSync(path.join(directory, name));
          return stat.dev === descriptor.dev && stat.ino === descriptor.ino;
        });
        if (owned) { failures++; saved(file, "partial write"); throw new Error("controlled task-owned artifact write failure"); }
      }
      return saved(file, data, options);
    };
    let response;
    try { response = await overflow(f, { action: "detach" }); }
    finally { fs.writeFileSync = saved; }
    assert.equal(metadata(response).executionStatus, "succeeded");
    assert.equal(metadata(response).deliveryStatus, "unavailable");
    assert.equal(metadata(response).workspaceTransition.committed, true);
    assert.equal(metadata(response).retryProgram, false);
    assert.equal(f.calls.length, before + 1);
    assert.equal(failures, 2, "complete/canonical retention retries serialization only");
    assert.deepEqual(fs.readdirSync(directory), [], "partial writes leave no artifact or quota entry");
    return { serializationAttempts: failures, guestExecutions: 1, committed: true, partialFilesRemoved: true };
  }) },
  { name: "direct-precommit-cleanup-failure-prevents-binding-change", run: async f => {
    const server = await f.api.createKiroMcpServer(f.options);
    try {
      await overflow(f);
      // The direct tool revokes and drains the old runtime BEFORE committing a
      // changed binding, so a runtime.close failure is a PRE-commit cleanup
      // failure: nothing is published and the transition reports failed/false.
      f.hooks["runtime.close"] = () => { throw new Error("controlled pre-commit close failure"); };
      const response = await f.call("fabric_workspace", { action: "detach" });
      assert.equal(response.isError, true);
      assert.equal(metadata(response).workspaceTransition.committed, false);
      assert.equal(metadata(response).workspaceTransition.status, "failed");
      assert.equal(metadata(response).workspaceTransition.workspaceStatus, undefined);
      assert.equal(metadata(response).retryProgram, false);
      assert.equal(f.calls.length, 1);
      return { precommitCleanupBlocksCommit: true, noGuestReplay: true };
    } finally { await server.close().catch(() => {}); }
  } },
  { name: "owner-file-cleanup-attempts-all-and-stays-revoked", run: async f => {
    const server = await f.api.createKiroMcpServer(f.options);
    const saved = fs.rmSync, failure = new Error("controlled owned artifact unlink failure");
    const removed = [];
    try {
      const first = issued(await overflow(f)), second = issued(await overflow(f));
      const directory = path.join(f.roots.data, "fabric", "artifacts");
      const failedFile = path.join(directory, first), otherFile = path.join(directory, second);
      const capability = f.capabilities.at(-1);
      fs.rmSync = (file, options) => {
        if (file === failedFile || file === otherFile) removed.push(String(file));
        if (file === failedFile) throw failure;
        return saved(file, options);
      };
      const closing = server.close();
      assert.equal(server.close(), closing);
      assert.throws(() => capability.read(first), /shutting down|retired|closed/);
      const leaves = error => error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
      await assert.rejects(closing, error => leaves(error).includes(failure));
      assert.deepEqual(removed, [failedFile, otherFile], "one failed unlink cannot skip another owned file");
      assert.equal(fs.existsSync(failedFile), true, "retain failed ownership evidence");
      assert.equal(fs.existsSync(otherFile), false);
      for (const event of ["delivery.close", "fovea.close", "server.close", "tracer.close"]) assert.equal(f.api.events.filter(item => item === event).length, 1);
      assert.equal(server.close(), closing); assert.equal(removed.length, 2, "failed close is not silently replayed");
      return { cleanupAttempts: removed.length, failureRetained: true, accessRevoked: true, allOuterCleanupAttempted: true };
    } finally { fs.rmSync = saved; await server.close().catch(() => {}); }
  } },
);

providerVariants.push({ name: "owner-close-reentry-attempts-both-stores", run: async f => {
  const raw = f.api.createKiroArtifactStore(), prototype = Object.getPrototypeOf(raw), saved = prototype.close;
  const owner = f.api.createKiroArtifactOwner(() => ({}));
  const id = owner.write("response"), checkpoint = owner.access.checkpoint("checkpoint");
  const failures = [new Error("response close failed"), new Error("checkpoint close failed")];
  let attempts = 0, joined;
  try {
    prototype.close = function () { joined ??= owner.close(); throw failures[attempts++]; };
    const closing = owner.close(); assert.equal(owner.close(), closing);
    assert.throws(() => owner.access.read(id), /retired/);
    assert.equal(owner.has(checkpoint), false);
    await assert.rejects(closing, error => error instanceof AggregateError && failures.every(failure => error.errors.includes(failure)));
    assert.equal(joined, closing); assert.equal(attempts, 2);
    assert.equal(owner.close(), closing);
    return { storeCloseAttempts: attempts, originalErrorsRetained: true, reentrantCloseJoined: true };
  } finally { prototype.close = saved; raw.close(); await owner.close().catch(() => {}); }
} });

faultVariants.push({ name: "transition-error-escaping-respects-output-budget", config: { executor: { maxOutputChars: 1000 } }, run: async f => {
  const server = await f.api.createKiroMcpServer(f.options);
  try {
    const controller = new AbortController();
    f.hooks.execute = async args => {
      await args.bootstrap.workspace({ action: "detach" }, args.signal);
      controller.abort(new Error(String.fromCharCode(0xd800).repeat(1000)));
      return succeeded(OUTPUT);
    };
    const response = await f.call("fabric_exec", { code: "return 1" }, { signal: controller.signal });
    assert.equal(metadata(response).executionStatus, "succeeded");
    assert.equal(metadata(response).workspaceTransition.status, "cancelled");
    assert.ok(metadata(response).workspaceTransition.error.includes(String.fromCharCode(0xd800)), "fault reaches the diagnostic unchanged");
    assert.equal(metadata(response).retryProgram, false);
    assert.ok(text(response).length <= 1000, "JSON escapes in transition diagnostics consume the reserved suffix budget");
    return { maximumChars: 1000, actualChars: text(response).length, hostileDiagnosticBounded: true };
  } finally { await server.close().catch(() => {}); }
} });

faultVariants.push(...["partial-file-cleanup", "uncertain-descriptor-close"].map(mode => ({ name: mode, run: async f => {
  const server = await f.api.createKiroMcpServer(f.options);
  const saved = { write: fs.writeFileSync, remove: fs.rmSync, close: fs.closeSync };
  const writeFailure = new Error("controlled partial write"), cleanupFailure = new Error("controlled uncertain cleanup");
  const directory = path.join(f.roots.data, "fabric", "artifacts");
  const files = new Set(); let writeAttempts = 0, closeAttempts = 0;
  const ownedDescriptor = fd => {
    const descriptor = fs.fstatSync(fd);
    return fs.readdirSync(directory).filter(name => idPattern.test(name)).some(name => {
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      if (stat.dev !== descriptor.dev || stat.ino !== descriptor.ino) return false;
      files.add(file); return true;
    });
  };
  try {
    await f.call();
    if (mode === "partial-file-cleanup") {
      fs.writeFileSync = (file, data, options) => {
        if (typeof file === "number" && ownedDescriptor(file)) { writeAttempts++; saved.write(file, "partial"); throw writeFailure; }
        return saved.write(file, data, options);
      };
      fs.rmSync = (file, options) => { if (files.has(String(file))) throw cleanupFailure; return saved.remove(file, options); };
    } else {
      fs.closeSync = fd => {
        if (ownedDescriptor(fd)) { closeAttempts++; saved.close(fd); throw cleanupFailure; } // No real FD is leaked by the fixture.
        return saved.close(fd);
      };
    }
    const response = await overflow(f, { action: "detach" });
    assert.equal(metadata(response).executionStatus, "succeeded");
    assert.equal(metadata(response).deliveryStatus, "unavailable");
    assert.equal(metadata(response).workspaceTransition.committed, true);
    assert.equal(metadata(response).retryProgram, false);
    const leaves = error => error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
    await assert.rejects(server.close(), error => leaves(error).includes(cleanupFailure), "failed write cleanup must remain owned through retirement");
    assert.equal(files.size, 1, "uncertain storage blocks canonical retry from acquiring another file");
    if (mode === "partial-file-cleanup") { assert.equal(writeAttempts, 1); assert.ok([...files].every(file => fs.existsSync(file))); }
    else assert.equal(closeAttempts, 1, "never retry an uncertain descriptor close");
    return { mode, uncertainCleanupRetained: true, acquiredFiles: files.size, writeAttempts, closeAttempts };
  } finally { fs.writeFileSync = saved.write; fs.rmSync = saved.remove; fs.closeSync = saved.close; await server.close().catch(() => {}); }
} })));

faultVariants.push(...[false, true].map(after => ({ name: `commit-throws-${after ? "after" : "before"}-mutation`, run: async f => {
  const prototype = f.api.KiroPowerWorkspaceBinding.prototype, original = prototype.commitMutation;
  const server = await f.api.createKiroMcpServer(f.options);
  try {
    prototype.commitMutation = function(mutation) { if (after) original.call(this, mutation); throw new Error("controlled commit-call failure"); };
    const response = await overflow(f, { action: "detach" });
    assert.equal(metadata(response).executionStatus, "succeeded");
    assert.equal(metadata(response).workspaceTransition.status, "uncertain");
    assert.equal(metadata(response).workspaceTransition.committed, null);
    assert.equal(metadata(response).retryProgram, false);
    assert.equal(f.calls.length, 1);
    const state = value(await f.call("fabric_workspace", { action: "status" }));
    assert.equal(state.status, after ? "unbound" : "bound", "reconcile state instead of inferring rollback from an exception");
    await readable(f, metadata(response).artifactId);
    return { threwAfterMutation: after, acknowledgement: "uncertain", actualState: state.status };
  } finally { prototype.commitMutation = original; await server.close(); }
} })));

faultVariants.push(...["expiry", "eviction", "retirement"].map(mode => ({ name: `post-projection-analysis-${mode}`, config: { artifacts: { ttlMs: 1000, maxArtifacts: 1 } }, run: async f => {
  const saved = Date.now; let now = saved(); Date.now = () => now;
  const entered = deferred(), release = deferred(); let collected = 0, pending, closing;
  const server = await f.api.createKiroMcpServer({ ...f.options, foveaPostToolContext: { authorizedAnalysis: true, qualifiedVisibleDelivery: true } });
  try {
    f.hooks.collect = async (_client, projection) => { collected++; if (collected === 1) { entered.resolve(); await release.promise; } return { projection }; };
    pending = overflow(f);
    await entered.promise;
    if (mode === "expiry") now += 1001;
    else if (mode === "eviction") issued(await overflow(f));
    else closing = server.close();
    release.resolve();
    const response = await pending;
    assert.equal(metadata(response).executionStatus, "succeeded");
    assert.equal(metadata(response).deliveryStatus, "unavailable");
    assert.equal(metadata(response).retryProgram, false);
    assert.equal(metadata(response).artifactId, undefined);
    assert.doesNotMatch(text(response), /ka_[a-f0-9]{48}/u);
    if (closing) await closing;
    return { mode, realHandlerAnalysisAwait: true, inertAnalysisOnly: true, finalAvailabilityCheck: true };
  } finally { release.resolve(); try { await Promise.allSettled([pending, closing]); await server.close(); } finally { Date.now = saved; } }
} })));

faultVariants.push({ name: "direct-commit-throw-still-retires-changed-runtime", run: async f => {
  const prototype = f.api.KiroPowerWorkspaceBinding.prototype, original = prototype.commitMutation;
  const server = await f.api.createKiroMcpServer(f.options);
  try {
    const id = issued(await overflow(f));
    prototype.commitMutation = function(mutation) { original.call(this, mutation); throw new Error("mutation committed but acknowledgement failed"); };
    const response = await f.call("fabric_workspace", { action: "detach" });
    assert.equal(metadata(response).workspaceTransition.status, "uncertain");
    assert.equal(metadata(response).workspaceTransition.committed, null);
    assert.equal(f.api.events.filter(event => event === "runtime.close").length, 1, "a changed binding must retire the old runtime even when commit acknowledgement throws");
    await readable(f, id);
    assert.equal(value(await f.call("fabric_workspace", { action: "status" })).status, "unbound");
    return { directCommitUncertain: true, changedRuntimeRetired: true, ownerArtifactSurvived: true };
  } finally { prototype.commitMutation = original; await server.close(); }
} });

providerVariants.push({ name: "failed-write-replacement-repository-preserved", run: async f => {
  const directory = path.join(f.directory, "owned-artifacts"), saved = { write: fs.writeFileSync, remove: fs.rmSync };
  const owner = f.api.createKiroArtifactOwner(() => ({ root: directory }));
  let ownedFile;
  try {
    fs.writeFileSync = (file, data, options) => {
      if (typeof file === "number") {
        const descriptor = fs.fstatSync(file);
        ownedFile = fs.readdirSync(directory).map(name => path.join(directory, name)).find(target => {
          const stat = fs.lstatSync(target); return stat.dev === descriptor.dev && stat.ino === descriptor.ino;
        });
        if (ownedFile) { saved.write(file, "partial"); throw new Error("owned partial write failed"); }
      }
      return saved.write(file, data, options);
    };
    fs.rmSync = (file, options) => { if (file === ownedFile) throw new Error("owned partial unlink failed"); return saved.remove(file, options); };
    assert.throws(() => owner.write("evidence"), /cleanup|write/);
  } finally { fs.writeFileSync = saved.write; fs.rmSync = saved.remove; }
  assert.ok(ownedFile);
  const retained = path.join(f.directory, "retained-owned-partial");
  assert.equal(fs.existsSync(retained), false);
  fs.renameSync(ownedFile, retained); // Preserve the exact task-owned generated file.
  fs.mkdirSync(ownedFile, { mode: 0o700 });
  const metadataDirectory = path.join(ownedFile, ".git");
  fs.mkdirSync(metadataDirectory, { mode: 0o700 });
  const marker = path.join(metadataDirectory, "keep");
  fs.writeFileSync(marker, "retain repository metadata", { flag: "wx", mode: 0o600 });
  await assert.rejects(owner.close(), /cleanup/);
  assert.equal(fs.readFileSync(marker, "utf8"), "retain repository metadata");
  assert.equal(fs.readFileSync(retained, "utf8"), "partial");
  assert.equal(owner.has(path.basename(ownedFile)), false);
  return { retainedRepositoryMarker: marker, retainedPartial: retained, replacementPreserved: true, ownerRevoked: true };
} });

export function createArtifactCases() {
  /** @type {[string,string,ArtifactVariant[]][]} */
  const groups = [
    ["LC19", "MCP-owned overflow handles survive deferred/direct binding transitions and roots loss", transitionVariants],
    ["LC20", "Authenticated session owners isolate genuine IDs and revoke without epoch revival", sessionVariants],
    ["LC21", "Output, checkpoint and receipt lifetimes share owner bounds across runtimes", retentionVariants],
    ["LC22", "Execution, transition and delivery outcomes stay truthful without replay or stale handles", faultVariants],
    ["LC23", "Real artifact store/provider enforce bounds, revocation and host-only capability authority", providerVariants],
  ];
  return groups.map(([id, title, variants]) => ({ id, title,
    effects: "retained source bundles and fixture-only config/directories under project .tmp; real handler/runtime/rootless artifact store/provider; inert SDK/Fovea/tracer and gated guest execute; no native workers, installed-agent mutation or teardown",
    deadlineMs: 180000,
    facts: { scope: id === "LC23" ? "store/provider" : "source-handler", variants: variants.map(item => ({ name: item.name, classification: item.classification ?? "regression" })), realCoreForwardingCertified: false },
    run: context => runVariants(context, id, variants),
  }));
}
