// W6 boundaries 1, 2, 5, 6 admission regressions. Source-level; only external
// effects are inert. Every generated fixture is retained. No native qualification.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadAdmissionApi, deepClone, createInertHost, errorLeaves, readEngineLedger, waitForEngineSettlement } from "./w6-admission-fixture.mjs";

export const requiredIds = ["SB01", "SB02", "SB05", "SB06"];

const descriptor = (name, risk) => ({ name, description: "inert " + name, inputSchema: { type: "object", additionalProperties: true }, risk });

function provider(name, actions, invoke, options = /** @type {any} */ ({})) {
  return {
    name, description: "inert " + name,
    list: async () => actions.map(action => descriptor(action.name, action.risk)),
    describe: async actionName => {
      const action = actions.find(entry => entry.name === actionName);
      return action ? descriptor(action.name, action.risk) : undefined;
    },
    ...(options.prepareArguments ? { prepareArguments: options.prepareArguments } : {}),
    ...(options.reserveInvocation ? { reserveInvocation: options.reserveInvocation } : {}),
    effectResources: options.effectResources ?? ((actionName) => ["inert:" + name + "/" + actionName]),
    invoke: (actionName, args, context) => invoke(actionName, args, context),
  };
}

function continuityObserver(capture) {
  return { resolve() {}, prepare(args) { capture(args); }, dispatch() {}, result() {}, acknowledge() {}, settle() {}, invalidate() {} };
}

function makeService(api, registry, context, overrides) {
  const config = api.normalizeFabricConfig({ mcp: { enabled: false }, continuity: { enabled: false }, ...overrides });
  return new api.FabricExecutionService(registry, config, context.fixturesRoot);
}

const allow = { approve: async () => {}, prepareApproval: () => ({ decision: "allow" }) };
const CALL_HELPER = `const call = (ref: string, args: any) => tools.call({ ref, args });`;

// --------------------------------------------------------------------------
// SB01: canonical prepare/approve/dispatch identity.
// --------------------------------------------------------------------------
async function registryCanonicalIdentity(context) {
  const { api } = await loadAdmissionApi(context, "sb01-registry");
  const registry = new api.ActionRegistry();
  const observed = { reserve: undefined, approve: undefined, invoke: undefined, releaseCalls: 0 };
  /** @type {any} */ let canonical;
  /** @type {any} */ let canonicalSnapshot;
  registry.register({
    name: "demo", description: "inert demo",
    list: async () => [{ name: "work", description: "inert work", inputSchema: { type: "object", additionalProperties: true }, risk: "write" }],
    describe: async actionName => actionName === "work" ? { name: "work", description: "inert work", inputSchema: { type: "object", additionalProperties: true }, risk: "write" } : undefined,
    prepareArguments: async () => ({ value: 1, nested: { level: 2 }, list: [1, 2] }),
    reserveInvocation: async (_actionName, args) => {
      observed.reserve = deepClone(args);
      args.value = 999; args.nested.level = 999; args.list.push(3); args.injected = "reserve";
      return () => { observed.releaseCalls += 1; };
    },
    effectResources: () => ["inert:res"],
    invoke: async (actionName, args) => {
      observed.invoke = { name: actionName, args: deepClone(args) };
      canonicalSnapshot = canonical;
      return { ok: true };
    },
  });
  const invocation = {
    cwd: context.fixturesRoot,
    maxResultChars: 8192,
    audits: [],
    operationObserver: continuityObserver(args => { canonical = args; }),
    approve: async (action, args) => {
      observed.approve = { name: action.name, value: args.value, level: args.nested.level, length: args.list.length, injected: args.injected };
      action.name = "hacked";
      args.value = -1; args.nested.level = -1; args.list.push(99); args.injected = "approve";
    },
  };
  const result = await registry.invoke("demo.work", { seed: true }, invocation);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(observed.reserve, { value: 1, nested: { level: 2 }, list: [1, 2] });
  assert.deepEqual(observed.approve, { name: "work", value: 1, level: 2, length: 2, injected: undefined });
  assert.deepEqual(observed.invoke, { name: "work", args: { value: 1, nested: { level: 2 }, list: [1, 2] } }, "dispatch must carry the canonical action name and arguments");
  assert.equal(observed.releaseCalls, 1);
  assert.equal(Object.isFrozen(canonical), true);
  assert.equal(Object.isFrozen(canonical.nested), true);
  assert.equal(Object.isFrozen(canonical.list), true);
  assert.equal(canonical.value, 1); assert.equal(canonical.nested.level, 2); assert.equal(canonical.list.length, 2);
  assert.equal(canonicalSnapshot, canonical);
  return { reservePristine: true, approvePristine: true, invokePristine: true, canonicalDeepFrozen: true, reservationMutationsContained: true, approverMutationsContained: true };
}

async function serviceApprovalOnceAndQuota(context) {
  const { api } = await loadAdmissionApi(context, "sb01-service");
  const variants = [];
  for (const mode of ["allow", "pending-release", "total-quota"]) {
    const registry = new api.ActionRegistry();
    const dispatched = [];
    registry.register(provider("demo", [{ name: "work", risk: "read" }], async (actionName, args) => { dispatched.push({ name: actionName, args: deepClone(args) }); return { ok: true }; }));
    let prepareCalls = 0, promptCalls = 0;
    const seen = [];
    const approver = {
      approve: async () => {},
      prepareApproval: (_action, args) => {
        prepareCalls += 1;
        seen.push(deepClone(args));
        args.n = -7; args.injected = "approver";
        if (mode === "allow") return { decision: "allow" };
        return { decision: "ask", prompt: async () => {
          promptCalls += 1;
          if (mode === "pending-release" && promptCalls === 2) return;
          throw new Error("inert prompt declined");
        } };
      },
    };
    const overrides = mode === "allow"
      ? { executor: { maxApprovalRequests: 4, maxPendingApprovals: 4 } }
      : mode === "pending-release"
        ? { executor: { maxApprovalRequests: 4, maxPendingApprovals: 1 } }
        : { executor: { maxApprovalRequests: 1, maxPendingApprovals: 2 } };
    const service = makeService(api, registry, context, overrides);
    try {
      const second = mode === "allow" ? "" : `facts.b = await call("demo.work", { n: 2 }).then(v => ({ ok: true, v }), e => ({ ok: false, message: String(e && e.message ? e.message : e), code: e && e.failure ? e.failure.code : undefined }));`;
      const code = CALL_HELPER + `
const facts: Record<string, any> = {};
facts.a = await call("demo.work", { n: 1 }).then(v => ({ ok: true, v }), e => ({ ok: false, message: String(e && e.message ? e.message : e), code: e && e.failure ? e.failure.code : undefined }));
` + second + `
return facts;`;
      const result = await service.execute({ code, approver, timeoutMs: 30000, workspaceBound: true });
      assert.equal(result.success, true, JSON.stringify({ error: result.error, typeErrors: result.typeErrors }));
      const facts = result.value;
      assert.equal(prepareCalls, mode === "allow" ? 1 : 2, "prepareApproval must be captured exactly once per call");
      assert.deepEqual(seen[0], { n: 1 }, "prepareApproval must receive exact canonical arguments");
      if (mode === "allow") {
        assert.equal(facts.a.ok, true);
        assert.equal(dispatched.length, 1);
        assert.deepEqual(dispatched[0], { name: "work", args: { n: 1 } }, "service dispatch must carry the canonical action name and arguments");
        const audit = result.audits.find(entry => entry.ref === "demo.work");
        assert.ok(audit && audit.success === true);
      } else if (mode === "pending-release") {
        assert.deepEqual(seen[1], { n: 2 }, "second canonical arguments must be exact");
        assert.equal(facts.a.ok, false); assert.equal(facts.a.code, "approval_denied");
        assert.equal(facts.b.ok, true, "a failed prompt must release pending capacity so the next admitted prompt dispatches");
        assert.equal(promptCalls, 2, "each admitted prompt runs exactly once");
        assert.equal(dispatched.length, 1);
        assert.deepEqual(dispatched[0], { name: "work", args: { n: 2 } }, "only the admitted call dispatches, with canonical arguments");
      } else {
        assert.equal(facts.a.ok, false); assert.equal(facts.a.code, "approval_denied");
        assert.equal(facts.b.ok, false); assert.equal(facts.b.code, "quota_exceeded");
        assert.match(facts.b.message, /approval request quota/u);
        assert.doesNotMatch(facts.b.message, /pending approval quota/u, "total request quota is the binding limit, not pending capacity");
        assert.equal(promptCalls, 1, "prompt failure is never retried and the second call is rejected before prompting");
        assert.equal(dispatched.length, 0, "no dispatch after approval rejection");
      }
      variants.push({ mode, prepareCalls, promptCalls, invokes: dispatched.length, dispatched, facts });
    } finally { await service.close(); }
  }
  return { variants, approvalCapturedOncePerCall: true, dispatchedArgumentsCaptured: true, failedPromptReleasesPending: variants.find(v => v.mode === "pending-release")?.facts.b.ok === true, totalQuotaSeparate: variants.find(v => v.mode === "total-quota")?.facts.b.code === "quota_exceeded" };
}



// --------------------------------------------------------------------------
// SB02: local-effect failure latching and truthful cleanup.
// --------------------------------------------------------------------------
async function localEffectFailureLatching(context) {
  const { api } = await loadAdmissionApi(context, "sb02");
  const variants = [];
  const workspace = fs.mkdtempSync(path.join(context.fixturesRoot, "sb02-workspace-"));
  const localFileProvider = state => provider("local", [{ name: "write", risk: "write" }], async (actionName, args) => {
    state.dispatched.push({ name: actionName, args: deepClone(args) });
    if (args.fail === true) throw new Error("inert local write failure");
    const target = path.join(state.workspace, args.path);
    fs.writeFileSync(target, args.content, "utf8");
    state.committed.push(args.path);
    return { changed: true, path: args.path, bytes: Buffer.byteLength(args.content) };
  }, {
    prepareArguments: async (_actionName, args) => deepClone(args),
    reserveInvocation: async (_actionName, args) => {
      state.reservations.push(deepClone(args));
      return () => {
        state.releases += 1;
        if (args.cleanupFail === true) throw new Error("inert local reservation cleanup failed");
      };
    },
  });
  const probeProvider = state => provider("probe", [{ name: "run", risk: "execute" }], async () => { state.probe += 1; throw new Error("inert probe run failure"); });
  const reviewProvider = state => provider("review", [{ name: "begin", risk: "write" }], async () => { state.review += 1; return { ok: true }; });
  const demoProvider = state => provider("demo", [{ name: "read", risk: "read" }], async () => { state.demo += 1; return { ok: true }; });
  const registerAll = (registry, state) => {
    registry.register(localFileProvider(state)); registry.register(probeProvider(state)); registry.register(reviewProvider(state)); registry.register(demoProvider(state));
  };
  async function runVariant(name, code, inspect) {
    const registry = new api.ActionRegistry();
    const state = { workspace, dispatched: [], committed: [], reservations: [], releases: 0, probe: 0, review: 0, demo: 0 };
    registerAll(registry, state);
    const service = makeService(api, registry, context, {});
    try {
      const result = await service.execute({ code, approver: allow, timeoutMs: 30000, workspaceBound: true });
      inspect(result, state);
      variants.push({ name, success: result.success, status: result.status, dispatched: state.dispatched, committed: state.committed, releases: state.releases, probe: state.probe, review: state.review, demo: state.demo, audits: result.audits.map(entry => ({ ref: entry.ref, success: entry.success, effectOutcome: entry.effectOutcome, acknowledgement: entry.commitAcknowledgement })) });
    } finally { await service.close(); }
  }

  await runVariant("committed-bytes-survive-caught-failure", CALL_HELPER + `
const facts: Record<string, any> = {};
facts.first = await call("local.write", { path: "a.txt", content: "alpha" }).then(v => ({ ok: true, v }), e => ({ ok: false, message: String(e && e.message ? e.message : e) }));
facts.second = await call("local.write", { path: "b.txt", content: "bravo", fail: true }).then(v => ({ ok: true, v }), e => ({ ok: false, message: String(e && e.message ? e.message : e) }));
facts.third = await call("local.write", { path: "c.txt", content: "charlie" }).then(v => ({ ok: true, v }), e => ({ ok: false, message: String(e && e.message ? e.message : e) }));
facts.nonLocal = await call("demo.read", {}).then(v => ({ ok: true, v }), e => ({ ok: false, message: String(e) }));
return facts;`, (result, state) => {
      assert.equal(result.success, true, JSON.stringify({ error: result.error, typeErrors: result.typeErrors }));
      assert.equal(fs.readFileSync(path.join(workspace, "a.txt"), "utf8"), "alpha", "prior committed bytes must survive a caught later effect failure");
      assert.equal(fs.existsSync(path.join(workspace, "b.txt")), false, "failed effect must not publish bytes");
      assert.equal(fs.existsSync(path.join(workspace, "c.txt")), false, "blocked queued effect must not publish bytes");
      assert.deepEqual(state.committed, ["a.txt"], "committed effect must not be replayed");
      assert.deepEqual(state.dispatched.map(entry => entry.args.path), ["a.txt", "b.txt"], "only first and failing effect dispatch; blocked queued effect never reaches the provider");
      assert.equal(result.value.third.ok, false); assert.match(result.value.third.message, /Local effect queue stopped/u);
      assert.equal(state.demo, 1, "non-local effects remain available");
      assert.equal(result.value.nonLocal.ok, true);
      const writes = result.audits.filter(entry => entry.ref === "local.write");
      assert.equal(writes.length, 2, "blocked queued call never reaches registry dispatch");
      assert.equal(writes[0].success, true); assert.equal(writes[1].success, false);
    });

  await runVariant("committed-bytes-survive-uncertain-cleanup", CALL_HELPER + `
const facts: Record<string, any> = {};
facts.first = await call("local.write", { path: "d.txt", content: "delta", cleanupFail: true }).then(v => ({ ok: true, v }), e => ({ ok: false, message: String(e && e.message ? e.message : e) }));
facts.second = await call("local.write", { path: "e.txt", content: "echo" }).then(v => ({ ok: true, v }), e => ({ ok: false, message: String(e && e.message ? e.message : e) }));
facts.nonLocal = await call("demo.read", {}).then(v => ({ ok: true, v }), e => ({ ok: false, message: String(e) }));
return facts;`, (result, state) => {
      assert.equal(result.success, true, "guest catch keeps the program outcome truthful");
      assert.equal(fs.readFileSync(path.join(workspace, "d.txt"), "utf8"), "delta", "committed bytes must remain after uncertain cleanup");
      assert.equal(fs.existsSync(path.join(workspace, "e.txt")), false, "queued local effect must not dispatch after uncertain cleanup");
      assert.deepEqual(state.committed, ["d.txt"], "no replay of the committed effect");
      assert.deepEqual(state.dispatched.map(entry => entry.args.path), ["d.txt"]);
      assert.equal(result.value.second.ok, false); assert.match(result.value.second.message, /Local effect queue stopped/u);
      assert.equal(result.value.first.ok, false); assert.match(result.value.first.message, /cleanup failed|inspect state/u);
      assert.equal(result.value.nonLocal.ok, true);
      const write = result.audits.find(entry => entry.ref === "local.write");
      assert.ok(write, "committed effect is preserved in the audit");
      assert.equal(write.success, false);
      assert.deepEqual(write.commitAcknowledgement, { version: 1, operation: "write" }, "commit acknowledgement survives cleanup failure");
      assert.equal(state.releases, 1);
    });

  await runVariant("mixed-probe-review-share-conservative-fifo", CALL_HELPER + `
const facts: Record<string, any> = {};
facts.probe = await call("probe.run", { id: 1 }).then(v => ({ ok: true, v }), e => ({ ok: false, message: String(e && e.message ? e.message : e) }));
facts.review = await call("review.begin", { id: 2 }).then(v => ({ ok: true, v }), e => ({ ok: false, message: String(e && e.message ? e.message : e) }));
return facts;`, (result, state) => {
      assert.equal(result.success, true);
      assert.equal(state.probe, 1);
      assert.equal(state.review, 0, "mixed probe/review queue is one conservative FIFO, not independent names");
      assert.equal(result.value.review.ok, false);
      assert.match(result.value.review.message, /Local effect queue stopped|probe/u);
    });
  return { variants, noWholeProgramReplay: true, conservativeFifoAcrossNames: true, realFileBytes: true };
}



// --------------------------------------------------------------------------
// SB05: session/turn owner isolation, stale/foreign request and receipt rejection.
// --------------------------------------------------------------------------
function openAdapter(api) {
  const adapter = new api.KiroHostSessionAdapter();
  adapter.attach(async () => {});
  const workspaceContext = { current: async () => ({ status: "verified", roots: [] }), invalidate() {} };
  return { adapter, workspaceContext };
}
function makeClaim(api, rootId, epoch, text, semanticKey) {
  const outbox = new api.FoveaOutbox(() => Date.now());
  const noticeId = outbox.prepare(rootId, epoch, text, "own", semanticKey);
  const claim = outbox.claim(rootId, epoch, 4096, true);
  return { outbox, noticeId, claim };
}
async function requestAndReceiptIsolation(context) {
  const { api } = await loadAdmissionApi(context, "sb05");
  const variants = [];
  {
    const { adapter, workspaceContext } = openAdapter(api);
    const a = adapter.openSession({ conversationId: "owner_a", conversationEpoch: 0, workspaceContext });
    const turn = adapter.beginTurn(a);
    adapter.associateRequest("req_one", turn);
    assert.equal(adapter.takeRequest("req_one"), turn, "associated request resolves once");
    assert.throws(() => adapter.takeRequest("req_one"), /association|trusted host session/u, "request identities are single-use");
    assert.throws(() => adapter.takeRequest("req_missing"), /association/u, "unknown request fails closed");
    adapter.associateRequest("req_two", turn);
    assert.throws(() => adapter.associateRequest("req_two", turn), /ambiguous/u, "duplicate live request ID is ambiguous");
    adapter.endTurn(turn);
    assert.throws(() => adapter.takeRequest("req_two"), /association/u, "ended turn's routing is forgotten");
    variants.push({ name: "single-use-stale-request", singleUse: true, staleForgotten: true });
  }
  {
    const { adapter, workspaceContext } = openAdapter(api);
    const a = adapter.openSession({ conversationId: "receipt_a", conversationEpoch: 0, workspaceContext });
    const b = adapter.openSession({ conversationId: "receipt_b", conversationEpoch: 0, workspaceContext });
    const turnA = adapter.beginTurn(a), turnB = adapter.beginTurn(b);
    const { noticeId, claim } = makeClaim(api, "root_receipt", 0, "receipt notice", "key_receipt");
    {
      const epochOutbox = new api.FoveaOutbox(() => Date.now());
      const epochNotice = epochOutbox.prepare("root_epoch", 0, "epoch notice", "own", "key_epoch");
      assert.equal(epochOutbox.claim("root_epoch", 1, 4096, true), undefined, "receipt claims are epoch scoped");
      assert.equal(epochOutbox.claim("root_epoch", 0, 4096, true).notices[0].noticeId, epochNotice, "matching epoch claims the prepared notice");
    }
    let acknowledgements = 0;
    const bound = adapter.bindDelivery(turnA, claim, async () => { acknowledgements += 1; });
    assert.ok(bound, "claim binds to its owner turn");
    assert.equal(await adapter.acknowledgeModelInput(turnB, noticeId), false, "foreign turn cannot consume this receipt");
    assert.equal(await adapter.acknowledgeModelInput(turnA, "notice_unknown"), false, "unknown notice is not acknowledged");
    assert.equal(await adapter.acknowledgeModelInput(turnA, noticeId), false, "prepared receipt is not model-input acknowledgement");
    bound.emitted();
    assert.equal(await adapter.acknowledgeModelInput(turnA, noticeId), true, "emitted receipt acknowledges exactly once");
    assert.equal(await adapter.acknowledgeModelInput(turnA, noticeId), false, "duplicate receipt cannot advance the baseline again");
    assert.equal(acknowledgements, 1);
    const staleTurn = adapter.beginTurn(b); adapter.endTurn(staleTurn);
    const { claim: foreignClaim } = makeClaim(api, "root_foreign", 0, "stale notice", "key_foreign");
    assert.equal(adapter.bindDelivery(staleTurn, foreignClaim, async () => {}), undefined, "binding to a stale turn cancels the claim");
    assert.equal(foreignClaim.isCurrent(), false);
    variants.push({ name: "receipt-rejection-and-single-ack", foreignRejected: true, duplicateRejected: true, receiptEpochScoped: true });
  }
  return { variants, foreignRejected: true };
}
async function retirementIsolation(context) {
  const { api } = await loadAdmissionApi(context, "sb05-retire");
  const { adapter, workspaceContext } = openAdapter(api);
  const a = adapter.openSession({ conversationId: "retire_a", conversationEpoch: 0, workspaceContext });
  const b = adapter.openSession({ conversationId: "retire_b", conversationEpoch: 0, workspaceContext });
  const turnA = adapter.beginTurn(a), turnB = adapter.beginTurn(b);
  adapter.associateRequest("a_req", turnA); adapter.associateRequest("b_req", turnB);
  await adapter.retireSession(a);
  assert.throws(() => adapter.beginTurn(a), /retired|stale/u);
  assert.throws(() => adapter.takeRequest("a_req"), /association/u, "retired owner's routing is dropped");
  assert.equal(adapter.takeRequest("b_req"), turnB, "retiring A must not revoke B");
  const { noticeId, claim } = makeClaim(api, "root_b", 0, "b notice", "key_b");
  let acked = 0;
  const bound = adapter.bindDelivery(turnB, claim, async () => { acked += 1; });
  assert.ok(bound);
  bound.emitted();
  assert.equal(await adapter.acknowledgeModelInput(turnB, noticeId), true, "B remains fully usable after A retired");
  await adapter.retireSession(b);
  await adapter.close();
  return { variants: [{ name: "retire-a-not-revoke-b", acked }], isolatedRetirement: true };
}
async function failedCleanupRetainsCapacity(context) {
  const { api } = await loadAdmissionApi(context, "sb05-capacity");
  const adapter = new api.KiroHostSessionAdapter();
  adapter.attach(async () => { throw new Error("inert ownership cleanup failed"); });
  const workspaceContext = { current: async () => ({ status: "verified", roots: [] }), invalidate() {} };
  const sessions = [];
  for (let i = 0; i < 32; i++) sessions.push(adapter.openSession({ conversationId: "capacity_" + i, conversationEpoch: 0, workspaceContext }));
  await assert.rejects(adapter.retireSession(sessions[0]), /inert ownership cleanup failed/u);
  assert.throws(() => adapter.openSession({ conversationId: "capacity_0", conversationEpoch: 0, workspaceContext }), /capacity/u, "failed cleanup must not allow same-owner regrant");
  assert.throws(() => adapter.openSession({ conversationId: "capacity_new", conversationEpoch: 0, workspaceContext }), /capacity/u, "failed cleanup retains the capacity reservation");
  await assert.rejects(adapter.close());
  return { variants: [{ name: "failed-ownership-cleanup-retains-capacity", sessions: sessions.length }], retainedCapacity: true };
}

async function sameWorkspaceHostRouting(context) {
  const { api } = await loadAdmissionApi(context, "sb05-host");
  const { root, host, client, authority } = await createInertHost(api, context, "sb05-host", { failCommit: true });
  const other = host.bind({ ...authority, conversationId: "sb05_other" });
  const adapter = new api.KiroHostSessionAdapter();
  adapter.attach(async session => host.retireConversation(session.conversationId, session.conversationEpoch));
  const workspaceContext = { current: async () => ({ status: "verified", roots: [{ uri: pathToFileURL(authority.canonicalPath).href }] }), invalidate() {} };
  const sessionA = adapter.openSession({ conversationId: authority.conversationId, conversationEpoch: 0, workspaceContext });
  const sessionB = adapter.openSession({ conversationId: "sb05_other", conversationEpoch: 0, workspaceContext });
  const turnA = adapter.beginTurn(sessionA), turnB = adapter.beginTurn(sessionB);
  const delivery = new api.FoveaResponseDelivery();
  const invocation = { cwd: authority.canonicalPath };
  const observations = {};
  const closeFailures = [];
  try {
    adapter.associateRequest("a", turnA); adapter.associateRequest("b", turnB);
    assert.equal(adapter.takeRequest("a"), turnA); assert.equal(adapter.takeRequest("b"), turnB);
    assert.throws(() => adapter.takeRequest("a"), /association|trusted host session/u, "request identities are single-use");
    assert.throws(() => adapter.associateRequest("forged", { session: sessionA, signal: turnA.signal }), /Foreign|stale/u, "foreign request association is rejected");
    client.observer.observe({ phase: "access", paths: ["example.ts"] });
    const claim = await client.collectContext(invocation, 4096);
    assert.ok(claim, "real FoveaHost must produce a delivery claim");
    const noticeId = claim.notices[0].noticeId;
    const bound = adapter.bindDelivery(turnA, claim, n => client.acknowledgeDelivery(n, invocation));
    assert.ok(bound);
    assert.equal(await adapter.acknowledgeModelInput(turnB, noticeId), false, "foreign turn cannot consume this receipt");
    assert.equal(await adapter.acknowledgeModelInput(turnA, noticeId), false, "prepared receipt is not model-input acknowledgement");
    await assert.rejects(other.acknowledgeDelivery(noticeId, invocation), /Unknown delivery preparation/u, "foreign same-workspace client cannot consume this receipt");
    assert.equal(delivery.track(1, bound, turnA.signal, "original"), true);
    let writes = 0;
    await delivery.send({ id: 1, result: { content: [{ type: "text", text: "original plus advisory" }] } }, async message => { writes += 1; assert.equal(message.id, 1); });
    assert.equal(writes, 1);
    assert.equal(readEngineLedger(root).filter(entry => entry.event.startsWith("commit")).length, 0, "emission must not commit the baseline");
    const emitted = await client.invoke("status", {}, invocation); assert.equal(emitted.notices.emitted, 1);
    await assert.rejects(adapter.acknowledgeModelInput(turnA, noticeId), /inert engine commit failure/u);
    assert.equal(readEngineLedger(root).filter(entry => entry.event === "commit-ok").length, 0, "failed ack must not commit the baseline");
    const failed = await client.invoke("status", {}, invocation); assert.equal(failed.notices.emitted, 1, "failed ack retains the notice");
    assert.equal(await adapter.acknowledgeModelInput(turnA, noticeId), false, "failed acknowledgement is not retried automatically");
    await client.acknowledgeDelivery(noticeId, invocation);
    await assert.rejects(client.acknowledgeDelivery(noticeId, invocation), /Unknown delivery preparation/u, "retry commits exactly once and advances the baseline");
    assert.equal(readEngineLedger(root).filter(entry => entry.event === "commit-ok").length, 1, "exactly one explicit retry commits");
    const committed = await client.invoke("status", {}, invocation); assert.equal(committed.notices.emitted, 0);
    other.observer.observe({ phase: "access", paths: ["example.ts"] });
    const claimB = await other.collectContext(invocation, 4096);
    assert.ok(claimB);
    const boundB = adapter.bindDelivery(turnB, claimB, n => other.acknowledgeDelivery(n, invocation));
    assert.ok(boundB);
    adapter.associateRequest("b-after", turnB);
    await adapter.retireSession(sessionA);
    assert.equal(adapter.takeRequest("b-after"), turnB, "retiring A must not revoke B");
    await assert.rejects(adapter.acknowledgeModelInput(turnA, noticeId), /retired|stale/u);
    boundB.emitted();
    assert.equal(await adapter.acknowledgeModelInput(turnB, claimB.notices[0].noticeId), true, "B remains routable after A retires");
    observations.sameWorkspaceDistinctRoots = client.rootId !== other.rootId;
    assert.equal(observations.sameWorkspaceDistinctRoots, true, "same filesystem root must still yield distinct client roots");
    observations.foreignAndStaleRejected = true;
    observations.retirementIsolated = true;
    observations.emissionNoCommit = true;
    observations.explicitRetryCommitsOnce = true;
  } finally {
    try { delivery.close(); } catch (error) { closeFailures.push(...errorLeaves(error)); }
    try { await client.close(); } catch (error) { closeFailures.push(...errorLeaves(error)); }
    try { await other.close(); } catch (error) { closeFailures.push(...errorLeaves(error)); }
    try { await adapter.close(); } catch (error) { closeFailures.push(...errorLeaves(error)); }
    try { await host.close(); } catch (error) { closeFailures.push(...errorLeaves(error)); }
  }
  if (closeFailures.length) throw new AggregateError(closeFailures, "SB05 host/runtime close failed");
  const settlement = await waitForEngineSettlement(root, 5000);
  assert.ok(settlement && settlement.alive === false, "SB05 inert engine must settle after close");
  observations.engineSettlement = settlement;
  return { variants: [{ name: "same-workspace-two-client-routing", ...observations }], sameWorkspaceDistinctRoots: observations.sameWorkspaceDistinctRoots };
}

// --------------------------------------------------------------------------
// SB06: emission vs acknowledgement and receipt-failure baseline preservation.
// --------------------------------------------------------------------------
async function deliveryAcknowledgement(context) {
  const { api } = await loadAdmissionApi(context, "sb06");
  const variants = [];
  async function runVariant(name, failCommit, exercise) {
    const { root, host, client, authority } = await createInertHost(api, context, name, { failCommit });
    const controller = new AbortController();
    const invocation = { cwd: authority.canonicalPath, signal: controller.signal };
    const workspaceContext = { current: async () => ({ status: "verified", roots: [] }), invalidate() {} };
    const adapter = new api.KiroHostSessionAdapter();
    adapter.attach(async () => {});
    const delivery = new api.FoveaResponseDelivery();
    const closeFailures = [];
    let facts;
    try {
      client.observer.observe({ phase: "access", paths: ["src/example.ts"] });
      const claim = await client.collectContext(invocation, 4096);
      assert.ok(claim, "inert engine must produce a prepared delivery claim");
      const noticeId = claim.notices[0].noticeId;
      const session = adapter.openSession({ conversationId: "w6", conversationEpoch: 0, workspaceContext });
      const turn = adapter.beginTurn(session);
      let acknowledgeCalls = 0;
      const bound = adapter.bindDelivery(turn, claim, async id => { acknowledgeCalls += 1; return client.acknowledgeDelivery(id, invocation); });
      assert.ok(bound);
      delivery.track(11, bound, turn.signal, "original output");
      let writes = 0;
      await delivery.send({ id: 11, result: { content: [{ type: "text", text: "original output" }] } }, async () => { writes += 1; });
      const commits = () => readEngineLedger(root).filter(entry => entry.event.startsWith("commit"));
      facts = await exercise({ adapter, client, turn, noticeId, invocation, acknowledgeCalls: () => acknowledgeCalls, commits });
      variants.push({ name, failCommit, writes, ledger: commits(), ...facts });
    } finally {
      try { delivery.close(); } catch (error) { closeFailures.push(...errorLeaves(error)); }
      try { await client.close(); } catch (error) { closeFailures.push(...errorLeaves(error)); }
      try { await adapter.close(); } catch (error) { closeFailures.push(...errorLeaves(error)); }
      try { await host.close(); } catch (error) { closeFailures.push(...errorLeaves(error)); }
    }
    if (closeFailures.length) throw new AggregateError(closeFailures, "admission host/runtime close failed");
    const settlement = await waitForEngineSettlement(root, 5000);
    assert.ok(settlement && settlement.alive === false, "inert engine must settle after close");
    const last = variants[variants.length - 1];
    if (last && last.name === name) last.engineSettlement = settlement;
  }
  await runVariant("transport-emission-is-not-acknowledgement", false, async ({ adapter, client, turn, noticeId, invocation, acknowledgeCalls, commits }) => {
    assert.equal(commits().length, 0, "transport emission must not commit the baseline");
    const emitted = await client.invoke("status", {}, invocation); assert.equal(emitted.notices.emitted, 1, "emission alone must not advance the baseline");
    const acknowledged = await adapter.acknowledgeModelInput(turn, noticeId);
    assert.equal(acknowledged, true, "acknowledgement is separate from and after transport emission");
    assert.equal(commits().filter(entry => entry.event === "commit-ok").length, 1, "exactly one successful commit after acknowledgement");
    assert.equal(await adapter.acknowledgeModelInput(turn, noticeId), false, "no duplicate acknowledgement");
    assert.equal(acknowledgeCalls(), 1);
    assert.equal(commits().filter(entry => entry.event === "commit-attempt").length, 1, "no duplicate commit attempt");
    await assert.rejects(client.acknowledgeDelivery(noticeId, invocation), /Unknown delivery preparation/u, "successful acknowledgement removes the preparation");
    const after = await client.invoke("status", {}, invocation); assert.equal(after.notices.emitted, 0, "successful acknowledgement advances the baseline");
    return { acknowledged, acknowledgeCalls: acknowledgeCalls(), duplicateRejected: true, baselineAdvanced: true };
  });
  await runVariant("acknowledgement-failure-retains-and-single-retry", true, async ({ adapter, client, turn, noticeId, invocation, acknowledgeCalls, commits }) => {
    assert.equal(commits().length, 0, "transport emission must not commit the baseline");
    await assert.rejects(adapter.acknowledgeModelInput(turn, noticeId), /inert engine commit failure/u, "acknowledgement callback failure surfaces");
    assert.equal(commits().filter(entry => entry.event === "commit-attempt").length, 1, "failed ack reaches the engine exactly once");
    assert.equal(commits().filter(entry => entry.event === "commit-ok").length, 0, "failed ack commits no baseline");
    assert.equal(commits().filter(entry => entry.event === "commit-fail").length, 1);
    const retained = await client.invoke("status", {}, invocation); assert.equal(retained.notices.emitted, 1, "failed acknowledgement retains the notice");
    assert.equal(await adapter.acknowledgeModelInput(turn, noticeId), false, "failed acknowledgement is not retried automatically");
    assert.equal(commits().filter(entry => entry.event === "commit-attempt").length, 1, "no automatic retry reaches the engine");
    await client.acknowledgeDelivery(noticeId, invocation);
    assert.equal(commits().filter(entry => entry.event === "commit-attempt").length, 2, "explicit retry contacts the engine again");
    assert.equal(commits().filter(entry => entry.event === "commit-ok").length, 1, "exactly one successful explicit retry commits the baseline");
    const committed = await client.invoke("status", {}, invocation); assert.equal(committed.notices.emitted, 0, "successful retry advances the baseline");
    await assert.rejects(client.acknowledgeDelivery(noticeId, invocation), /Unknown delivery preparation/u, "retry commits exactly once and advances the baseline");
    assert.equal(commits().filter(entry => entry.event === "commit-attempt").length, 2, "no duplicate retry reaches the engine");
    assert.equal(commits().filter(entry => entry.event === "commit-ok").length, 1);
    return { ackFailed: true, explicitRetryCommitted: true, secondCommitBlocked: true, acknowledgeCalls: acknowledgeCalls(), commitAttempts: 2, successfulCommits: 1 };
  });
  return { variants, realFoveaHost: true, inertEngine: true, realOutbox: true, realTransport: true, closeFailuresPropagate: true, engineSettlementCaptured: true };
}



// --------------------------------------------------------------------------
export function createAdmissionCases() {
  const effects = "source-level real boundaries; inert providers/engine/transport only; retained fixture files";
  return [
    { id: "SB01", title: "canonical prepare/approve/dispatch identity and single approval capture", effects, deadlineMs: 120000,
      run: async context => ({ ...(await registryCanonicalIdentity(context)), ...(await serviceApprovalOnceAndQuota(context)) }) },
    { id: "SB02", title: "local-effect failure latching preserves committed work and conservatively blocks the queue", effects, deadlineMs: 120000,
      run: context => localEffectFailureLatching(context) },
    { id: "SB05", title: "session/turn owner isolation, stale/foreign rejection and retained capacity", effects, deadlineMs: 120000,
      run: async context => {
        const isolation = await requestAndReceiptIsolation(context);
        const retirement = await retirementIsolation(context);
        const capacity = await failedCleanupRetainsCapacity(context);
        const hostRouting = await sameWorkspaceHostRouting(context);
        const variants = [...isolation.variants, ...retirement.variants, ...capacity.variants, ...hostRouting.variants];
        assert.ok(variants.length >= 5, "all SB05 variants must be retained: " + JSON.stringify(variants.map(entry => entry.name)));
        return { variants, foreignRejected: isolation.foreignRejected, isolatedRetirement: retirement.isolatedRetirement, retainedCapacity: capacity.retainedCapacity, sameWorkspaceDistinctRoots: hostRouting.sameWorkspaceDistinctRoots };
      } },
    { id: "SB06", title: "emission vs acknowledgement, receipt failure and no duplicate commit", effects, deadlineMs: 120000,
      run: context => deliveryAcknowledgement(context) },
  ];
}
