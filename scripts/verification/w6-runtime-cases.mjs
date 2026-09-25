// W6 runtime boundary regressions. Production-backed: built dist for public
// runtime/catalog/packaging cases, real source StateProvider for persistence,
// and the real QuickJsRuntime class with an injected Worker/timer for pool logic.
// Every write stays under the case fixture root; nothing is deleted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadRuntimeSource, loadRuntimeMock, fakeClock } from "./w6-runtime-fixture.mjs";
import { loadArtifactFixture } from "./lifecycle-artifact-fixture.mjs";
import { assertStateReleaseRegression } from "./w6-state-release-regression.mjs";

export const requiredIds = ["SB03", "SB04", "SB07", "SB08"];

const loadBuiltApi = (root) => import(pathToFileURL(path.join(root, "dist/index.js")).href);

function runtimeOptions(api, context, overrides = {}) {
  const workspace = path.join(context.fixturesRoot, "workspace");
  fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
  const locks = path.join(context.fixturesRoot, "locks");
  fs.mkdirSync(locks, { recursive: true, mode: 0o700 });
  return {
    cwd: workspace,
    workspaceRoot: workspace,
    configFile: path.join(context.fixturesRoot, "config.json"),
    mcpConfigPath: path.join(context.fixturesRoot, "mcp.json"),
    artifactsRoot: path.join(context.fixturesRoot, "artifacts"),
    localLockRoot: locks,
    memoryRoot: path.join(context.fixturesRoot, "memory"),
    stateRoot: path.join(context.fixturesRoot, "state"),
    continuityRoot: path.join(context.fixturesRoot, "continuity"),
    config: api.normalizeFabricConfig({ mcp: { enabled: false }, continuity: { enabled: false }, executor: { maxNestedResultChars: 4000 } }),
    ...overrides,
  };
}

async function execute(runtime, code) {
  return runtime.service.execute({ code, approver: { approve: async () => {} }, timeoutMs: 30000 });
}

function succeeded(result) {
  assert.equal(result.success, true, JSON.stringify({ error: result.error, typeErrors: result.typeErrors }));
  return result.value;
}

/** @param {any} fixture @param {string} name @param {any} args */
const callTool = (fixture, name, args) => fixture.call(name, args);

export function createRuntimeBoundaryCases() {
  return [
    {
      id: "SB03",
      title: "catalog binding rejects changed identity and old/foreign cursors; direct MCP tool revokes and drains before committing a changed workspace binding",
      effects: "starts built compiler/sandbox workers; bundles the source handler fixture; writes retained fixture roots",
      deadlineMs: 180000,
      run: async (context) => {
        const api = await loadBuiltApi(context.root);
        const ws = path.join(context.fixturesRoot, "workspace");
        fs.mkdirSync(ws, { recursive: true, mode: 0o700 });
        const binding = { clientSession: "session-a", workspace: ws, device: "1", inode: "2", authorizationEpoch: "1" };
        const runtime = api.createKiroRuntime({ ...runtimeOptions(api, context), catalogBinding: binding });
        let changedIdentityRejected = false;
        let replayedIdentityRejected = false;
        try {
          const descriptors = Array.from({ length: 40 }, (_, index) => ({
            name: "w6.fixture.act" + index,
            description: "W6 catalog fixture action " + "x".repeat(180),
            risk: "read",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
          }));
          runtime.registry.register({ name: "w6fixture", description: "W6 catalog paging fixture", list: async () => descriptors, invoke: async () => null });
          const page = succeeded(await execute(runtime, "return await tools.listPage({limit:1});"));
          const cursor = page && page.nextCursor;
          assert.ok(typeof cursor === "string" && cursor.length > 0, "an oversized catalog page must issue a cursor");
          assert.ok(page.total >= 40 && page.returned >= 1, "catalog page totals: " + JSON.stringify(page));
          runtime.service.invalidateCatalogs();
          const old = await execute(runtime, `return await tools.listPage({cursor:${JSON.stringify(cursor)}});`);
          assert.equal(old.success, false);
          assert.match(String(old.error), /Catalog cursor unavailable/u);
          try { runtime.service.bindCatalog(binding); } catch { replayedIdentityRejected = true; }
          assert.equal(replayedIdentityRejected, true, "rebinding after revocation must be refused");
          const runtimeB = api.createKiroRuntime({ ...runtimeOptions(api, context, { artifactsRoot: path.join(context.fixturesRoot, "artifacts-b") }), catalogBinding: { ...binding, clientSession: "session-b" } });
          try {
            const foreign = await execute(runtimeB, `return await tools.listPage({cursor:${JSON.stringify(cursor)}});`);
            assert.equal(foreign.success, false);
            assert.match(String(foreign.error), /Catalog cursor unavailable/u);
          } finally { await runtimeB.close(); }
          try { runtime.service.bindCatalog({ ...binding, clientSession: "session-b" }); }
          catch (error) { changedIdentityRejected = /already bound or revoked/u.test(String(error.message)); }
          assert.equal(changedIdentityRejected, true, "a changed catalog identity must be refused");

          // --- Direct MCP ordering: the old runtime is revoked and drained
          // BEFORE the replacement binding is published. The source handler is
          // bundled from src/ (never a stale built handler).
          const order = await loadArtifactFixture(context, "w6-sb03-order");
          const orderServer = await order.api.createKiroMcpServer(order.options);
          const orderCommit = order.api.KiroPowerWorkspaceBinding.prototype.commitMutation;
          let orderEvents = [];
          let orderTransition;
          let orderOriginalInvalidate;
          const orderSha256 = order.sourceSha256;
          try {
            order.setRoots(["workspace", "other-workspace"], "verified");
            const info = await callTool(order, "fabric_info", {});
            assert.notEqual(info.isError, true, JSON.stringify(info).slice(0, 600));
            const service = order.runtimes.at(-1).service;
            orderOriginalInvalidate = service.invalidateCatalogs;
            service.invalidateCatalogs = () => { order.api.events.push("runtime.invalidate"); return orderOriginalInvalidate.call(service); };
            order.api.KiroPowerWorkspaceBinding.prototype.commitMutation = function (mutation) {
              order.api.events.push("binding.commit");
              return orderCommit.call(this, mutation);
            };
            const listResponse = await callTool(order, "fabric_workspace", { action: "list" });
            const listed = JSON.parse(listResponse.content[0].text);
            const target = (listed.roots || []).find((entry) => entry.name === "other-workspace");
            assert.ok(target, "other-workspace must be listed: " + listResponse.content[0].text);
            const selectResponse = await callTool(order, "fabric_workspace", { action: "select", rootId: target.rootId });
            orderTransition = selectResponse.structuredContent && selectResponse.structuredContent.workspaceTransition;
            assert.equal(orderTransition && orderTransition.committed, true, JSON.stringify(selectResponse).slice(0, 600));
            orderEvents = [...order.api.events];
          } finally {
            order.api.KiroPowerWorkspaceBinding.prototype.commitMutation = orderCommit;
            const activeService = order.runtimes.at(-1) && order.runtimes.at(-1).service;
            if (activeService && orderOriginalInvalidate) activeService.invalidateCatalogs = orderOriginalInvalidate;
            await orderServer.close();
          }
          const commitAt = orderEvents.indexOf("binding.commit");
          const invalidateAt = orderEvents.indexOf("runtime.invalidate");
          assert.ok(invalidateAt >= 0, "the old runtime catalogs must be revoked: " + JSON.stringify(orderEvents));
          assert.ok(commitAt >= 0, "the changed binding must be committed: " + JSON.stringify(orderEvents));
          assert.ok(invalidateAt < commitAt,
            "direct MCP workspace must revoke and drain the old runtime BEFORE publishing a changed binding: " + JSON.stringify(orderEvents));

          // --- Same rootId is not proof of the same inode. A genuine directory
          // identity swap between prepareMutation and commitMutation must still
          // revoke first; the commit then rejects and leaves the old binding.
          const swap = await loadArtifactFixture(context, "w6-sb03-swap");
          const swapServer = await swap.api.createKiroMcpServer(swap.options);
          const swapPrepare = swap.api.KiroPowerWorkspaceBinding.prototype.prepareMutation;
          const swapCommit = swap.api.KiroPowerWorkspaceBinding.prototype.commitMutation;
          let swapEvents = [];
          let swapTransition;
          let swapOriginalInvalidate;
          /** @type {any} */
          let swapBinding;
          let swapIdentityBefore;
          let swapIdentityAfter;
          let swapSwapped = false;
          let swapRuntimesBefore = 0;
          try {
            swap.setRoots(["workspace"], "verified");
            const info = await callTool(swap, "fabric_info", {});
            assert.notEqual(info.isError, true, JSON.stringify(info).slice(0, 600));
            swapRuntimesBefore = swap.runtimes.length;
            const service = swap.runtimes.at(-1).service;
            swapOriginalInvalidate = service.invalidateCatalogs;
            service.invalidateCatalogs = () => { swap.api.events.push("runtime.invalidate"); return swapOriginalInvalidate.call(service); };
            const workspacePath = swap.roots.workspace;
            const displaced = path.join(swap.directory, "workspace-displaced");
            swap.api.KiroPowerWorkspaceBinding.prototype.prepareMutation = async function (...args) {
              const mutation = await swapPrepare.apply(this, args);
              if (!swapSwapped) {
                swapSwapped = true;
                swapBinding = this;
                swapIdentityBefore = this.bindingIdentity();
                fs.renameSync(workspacePath, displaced);
                fs.mkdirSync(workspacePath, { mode: 0o700 });
              }
              return mutation;
            };
            swap.api.KiroPowerWorkspaceBinding.prototype.commitMutation = function (mutation) {
              swap.api.events.push("binding.commit");
              return swapCommit.call(this, mutation);
            };
            const listResponse = await callTool(swap, "fabric_workspace", { action: "list" });
            const listed = JSON.parse(listResponse.content[0].text);
            const target = (listed.roots || []).find((entry) => entry.name === "workspace");
            assert.ok(target, "workspace must be listed: " + listResponse.content[0].text);
            const selectResponse = await callTool(swap, "fabric_workspace", { action: "select", rootId: target.rootId });
            swapTransition = selectResponse.structuredContent && selectResponse.structuredContent.workspaceTransition;
            swapEvents = [...swap.api.events];
            swapIdentityAfter = swapBinding.bindingIdentity();
          } finally {
            swap.api.KiroPowerWorkspaceBinding.prototype.prepareMutation = swapPrepare;
            swap.api.KiroPowerWorkspaceBinding.prototype.commitMutation = swapCommit;
            const activeService = swap.runtimes.at(-1) && swap.runtimes.at(-1).service;
            if (activeService && swapOriginalInvalidate) activeService.invalidateCatalogs = swapOriginalInvalidate;
            await swapServer.close();
          }
          assert.equal(swapSwapped, true, "the fixture must swap the bound directory inode");
          assert.ok(swapBinding, "prepareMutation must expose the session binding");
          assert.equal(swapIdentityAfter, swapIdentityBefore, "a rejected commit must leave the old binding identity in place");
          assert.equal(swapTransition && swapTransition.committed, null, "an attempted-but-rejected commit is uncertain, never falsely committed: " + JSON.stringify(swapTransition));
          assert.match(String(swapTransition && swapTransition.error), /identity changed/u);
          const swapInvalidateAt = swapEvents.indexOf("runtime.invalidate");
          const swapCommitAt = swapEvents.indexOf("binding.commit");
          assert.ok(swapInvalidateAt >= 0 && swapCommitAt >= 0 && swapInvalidateAt < swapCommitAt,
            "a same-rootId inode swap must revoke before the commit attempt: " + JSON.stringify(swapEvents));
          assert.equal(swap.runtimes.length, swapRuntimesBefore, "a rejected commit must not publish a new runtime");

          // --- Failed pre-commit cleanup reports committed:false, retains the
          // old binding, never publishes a new runtime, and keeps sticky authority.
          const clean = await loadArtifactFixture(context, "w6-sb03-cleanup");
          const cleanServer = await clean.api.createKiroMcpServer(clean.options);
          const cleanPrepare = clean.api.KiroPowerWorkspaceBinding.prototype.prepareMutation;
          let cleanTransition;
          let cleanOriginalInvalidate;
          /** @type {any} */
          let cleanBinding;
          let cleanRuntimesBefore = 0;
          let cleanError = "";
          let stickyBlocked = false;
          try {
            clean.setRoots(["workspace"], "verified");
            const info = await callTool(clean, "fabric_info", {});
            assert.notEqual(info.isError, true, JSON.stringify(info).slice(0, 600));
            cleanRuntimesBefore = clean.runtimes.length;
            const service = clean.runtimes.at(-1).service;
            cleanOriginalInvalidate = service.invalidateCatalogs;
            clean.api.KiroPowerWorkspaceBinding.prototype.prepareMutation = async function (...args) {
              cleanBinding = this;
              return cleanPrepare.apply(this, args);
            };
            service.invalidateCatalogs = () => { throw new Error("injected pre-commit revoke failure"); };
            clean.setRoots(["workspace", "other-workspace"], "verified");
            const listResponse = await callTool(clean, "fabric_workspace", { action: "list" });
            const listed = JSON.parse(listResponse.content[0].text);
            const target = (listed.roots || []).find((entry) => entry.name === "other-workspace");
            assert.ok(target, "other-workspace must be listed: " + listResponse.content[0].text);
            const selectResponse = await callTool(clean, "fabric_workspace", { action: "select", rootId: target.rootId });
            cleanTransition = selectResponse.structuredContent && selectResponse.structuredContent.workspaceTransition;
            cleanError = selectResponse.isError === true ? selectResponse.content[0].text : "";
            assert.equal(cleanTransition && cleanTransition.committed, false, "failed pre-commit cleanup must not report a commit: " + JSON.stringify(selectResponse).slice(0, 600));
            assert.equal(cleanTransition && cleanTransition.status, "failed");
            assert.match(String(cleanTransition && cleanTransition.error), /cleanup/u);
            assert.equal(clean.runtimes.length, cleanRuntimesBefore, "failed pre-commit cleanup must not publish a new runtime");
            assert.ok(cleanBinding, "prepareMutation must expose the session binding");
            const retained = cleanBinding.status();
            assert.equal(retained.status, "bound", "the old binding must remain after a failed pre-commit cleanup");
            const blocked = await callTool(clean, "fabric_workspace", { action: "status" });
            stickyBlocked = blocked.isError === true && /cleanup failed|restart required/u.test(blocked.content[0].text);
          } finally {
            clean.api.KiroPowerWorkspaceBinding.prototype.prepareMutation = cleanPrepare;
            const activeService = clean.runtimes.at(-1) && clean.runtimes.at(-1).service;
            if (activeService && cleanOriginalInvalidate) activeService.invalidateCatalogs = cleanOriginalInvalidate;
            await cleanServer.close().catch(() => {});
          }
          assert.equal(stickyBlocked, true, "a failed cleanup must retain sticky authority and refuse new effects: " + cleanError);

          return {
            status: "passed",
            variants: { changedIdentityRejected, replayedIdentityRejected, oldCursorRejected: true, foreignCursorRejected: true,
              directMcpRevokeBeforeCommit: true, sameRootIdInodeSwapRevoked: true, failedPrecommitCleanupCommittedFalse: true, stickyCleanupAuthority: true },
            catalogDescriptors: descriptors.length,
            observedOrdering: { commitAt, invalidateAt, events: orderEvents },
            sourceSha256: orderSha256,
            coverageGaps: [],
          };
        } finally { await runtime.close(); }
      },
    },
    {
      id: "SB04",
      title: "worker stale replies, cancellation retirement, fault replacement, exact idle retirement and fresh real guest state",
      effects: "bundles real QuickJsRuntime with an injected Worker; starts the built runtime for a real isolated worker",
      deadlineMs: 180000,
      run: async (context) => {
        const mock = await loadRuntimeMock(context);
        const base = { timeoutMs: 1000, maxTimeoutMs: 1000, memoryLimitBytes: 1024 * 1024 };
        const reply = (value, executionId) => ({ type: "result", executionId, result: { value, logs: [], terminationReason: "completed", effectiveTimeoutMs: 1000 } });

        mock.resetWorkers();
        mock.runHooks.current = (worker, message) => {
          worker.reply(reply("stale", "stale-execution-id"));
          worker.reply(reply("fresh", message.executionId));
        };
        const staleRuntime = new mock.QuickJsRuntime();
        const staleOutcome = await staleRuntime.execute("return 1", async () => {}, base);
        assert.equal(staleOutcome.value, "fresh", "a wrong-execution-id reply must be ignored");
        assert.equal(staleOutcome.terminationReason, "completed");
        await staleRuntime.close();

        mock.resetWorkers();
        let calls = 0;
        mock.runHooks.current = (worker, message) => {
          calls += 1;
          if (calls === 1) worker.crash("contained worker fault");
          else worker.reply(reply("after-fault", message.executionId));
        };
        const faultRuntime = new mock.QuickJsRuntime();
        const faulted = await faultRuntime.execute("return 1", async () => {}, base);
        assert.equal(faulted.terminationReason, "runtime_error");
        assert.match(String(faulted.error), /Virtual machine fault/u);
        const replaced = await faultRuntime.execute("return 2", async () => {}, base);
        assert.equal(replaced.value, "after-fault", "a faulted worker must be replaced");
        assert.ok(mock.workers.length >= 2, "a new worker must be spawned after a fault");
        assert.equal(mock.workers[0].terminated, true, "the faulted worker must be terminated");
        await faultRuntime.close();

        // --- Cancellation replaces the worker: a cancellation that outlives its
        // cleanup grace retires the in-flight worker at the unchanged 1000ms
        // production backstop, a late reply is ignored, and the next run must
        // acquire a fresh worker. The 10000ms idle window stays untouched.
        mock.resetWorkers();
        let cancelledExecutionId = "";
        mock.runHooks.current = (_worker, message) => { if (message && message.type === "run") cancelledExecutionId = message.executionId; };
        const cancelRuntime = new mock.QuickJsRuntime();
        const cancelClock = fakeClock();
        let cancellation = {};
        try {
          const controller = new AbortController();
          const pending = cancelRuntime.execute("return 1", async () => {}, { ...base, cleanupGraceMs: 0, signal: controller.signal });
          controller.abort(new Error("w6 cancel"));
          const backstopDelays = cancelClock.delays();
          assert.ok(backstopDelays.includes(1000), "cancellation must retain the production 1000ms worker backstop, saw " + JSON.stringify(backstopDelays));
          cancelClock.fireDelay(1000);
          const cancelled = await pending;
          assert.equal(cancelled.terminationReason, "aborted");
          assert.equal(String(cancelled.error), "Execution cancelled");
          const cancelledWorker = mock.workers.at(-1);
          assert.equal(cancelledWorker.terminated, true, "an unresponsive cancelled worker must be terminated");
          cancelledWorker.reply(reply("late-after-cancel", cancelledExecutionId));
          mock.runHooks.current = (worker, message) => worker.reply(reply("after-cancel", message.executionId));
          const workersBefore = mock.workers.length;
          const next = await cancelRuntime.execute("return 2", async () => {}, base);
          assert.equal(next.value, "after-cancel", "the pool must keep serving after a cancellation");
          assert.ok(mock.workers.length > workersBefore, "a cancelled worker must not be reused");
          const freshWorker = mock.workers.at(-1);
          assert.notEqual(freshWorker, cancelledWorker);
          assert.equal(freshWorker.terminated, false);
          cancellation = { backstopMs: 1000, cancelledTerminated: true, lateReplyIgnored: true, replacedWorker: true };
        } finally { cancelClock.restore(); await cancelRuntime.close(); }

        mock.resetWorkers();
        mock.runHooks.current = (worker, message) => worker.reply(reply("idle", message.executionId));
        const idleRuntime = new mock.QuickJsRuntime();
        const clock = fakeClock();
        let idle = {};
        try {
          const out = await idleRuntime.execute("return 3", async () => {}, base);
          assert.equal(out.value, "idle");
          const worker = mock.workers.at(-1);
          assert.equal(worker.terminated, false);
          const delays = clock.delays();
          assert.ok(delays.includes(10000), "expected the exact 10000ms idle timer, saw " + JSON.stringify(delays));
          assert.equal(clock.fireDelay(10000), 1, "exactly one 10000ms idle timer");
          await new Promise((resolve) => setImmediate(resolve));
          assert.equal(worker.terminated, true, "idle retirement must terminate the worker at 10000ms");
          idle = { delayMs: 10000, terminated: worker.terminated };
        } finally { clock.restore(); await idleRuntime.close(); }

        const api = await loadBuiltApi(context.root);
        const realWorkspace = path.join(context.fixturesRoot, "real-workspace");
        fs.mkdirSync(realWorkspace, { recursive: true, mode: 0o700 });
        const runtime = api.createKiroRuntime(runtimeOptions(api, context, { cwd: realWorkspace, workspaceRoot: realWorkspace }));
        let realFresh;
        try {
          const first = succeeded(await execute(runtime, "(globalThis as any).__w6Leak = 123; return typeof (globalThis as any).__w6Leak;"));
          const second = succeeded(await execute(runtime, "return typeof (globalThis as any).__w6Leak;"));
          assert.equal(first, "number");
          assert.equal(second, "undefined", "a reused real worker must expose fresh guest state");
          realFresh = { first, second };
        } finally { await runtime.close(); }
        return { status: "passed", variants: { staleReplyRejected: true, cancellationRetiresWorker: true, faultReplacement: true, idleRetirement10000: true, realIsolatedWorkerFreshState: true }, cancellation, idle, realFresh, coverageGaps: [] };
      },
    },
    {
      id: "SB07",
      title: "state CAS, committed acknowledgement durability and held-lock loss ownership",
      effects: "uses the real StateProvider on retained fixture roots; injects only fsync/rename test seams",
      deadlineMs: 60000,
      run: async (context) => {
        const api = await loadRuntimeSource(context);
        const { StateProvider, FabricDeadline, FABRIC_COMMIT_ACKNOWLEDGEMENT } = api;
        const invocation = { signal: new AbortController().signal, deadline: new FabricDeadline(30000, 30000) };
        // Every fs seam is installed inside this guard and restored in a finally,
        // so a failing assertion still returns node:fs to real behavior.
        const patchedFs = async (seams, body) => {
          const saved = {};
          for (const key of Object.keys(seams)) { saved[key] = fs[key]; fs[key] = seams[key]; }
          try { return await body(); }
          finally { for (const key of Object.keys(seams)) fs[key] = saved[key]; }
        };
        const newProvider = (label) => {
          const root = path.join(context.fixturesRoot, label);
          fs.mkdirSync(root, { mode: 0o700 });
          return { root, provider: new StateProvider(root, {}) };
        };
        const lockPathOf = (root) => path.join(root, ".state-mutation.lock");
        const readRevision = (root) => JSON.parse(fs.readFileSync(path.join(root, "state.json"), "utf8")).revision;
        const realFsync = fs.fsyncSync;
        const realRename = fs.renameSync;

        // --- A. CAS, stale conflict, ordinary release and committed-vs-durable truth.
        const a = newProvider("state-cas");
        const committed = await a.provider.invoke("set", { key: "cas", value: { n: 1 }, expectedRevision: 0 }, invocation);
        assert.equal(committed.revision, 1);
        let conflict = false;
        try { await a.provider.invoke("set", { key: "cas", value: { n: 2 }, expectedRevision: 0 }, invocation); }
        catch (error) { conflict = /revision conflict/u.test(String(error.message)); }
        assert.equal(conflict, true, "a stale expectedRevision must conflict");
        const casRead = await a.provider.invoke("get", { key: "cas" }, invocation);
        assert.deepEqual(casRead.value, { n: 1 });

        let directoryFsyncs = 0;
        /** @type {any} */
        let durabilityError;
        await patchedFs({ fsyncSync: (descriptor) => {
          let stat;
          try { stat = fs.fstatSync(descriptor); } catch { return realFsync(descriptor); }
          if (stat.isDirectory()) { directoryFsyncs += 1; throw new Error("injected post-rename directory fsync failure"); }
          return realFsync(descriptor);
        } }, async () => {
          try { await a.provider.invoke("set", { key: "durable", value: { v: 1 }, expectedRevision: 0 }, invocation); }
          catch (error) { durabilityError = error; }
        });
        assert.ok(directoryFsyncs >= 1, "the directory barrier must run after the rename");
        assert.equal(durabilityError && durabilityError.name, "StateCommitAcknowledgementError");
        assert.equal(durabilityError.committed, true);
        assert.equal(durabilityError.durability, "unconfirmed");
        assert.equal(durabilityError.lockCleanup, "confirmed", "the lock released normally behind an unconfirmed publication");
        assert.equal(durabilityError[FABRIC_COMMIT_ACKNOWLEDGEMENT] && durabilityError[FABRIC_COMMIT_ACKNOWLEDGEMENT].operation, "set");
        const durableRead = await a.provider.invoke("get", { key: "durable" }, invocation);
        assert.deepEqual(durableRead.value, { v: 1 }, "published bytes stay visible without the durability barrier");
        assert.equal(a.provider.directoryBarrier, process.platform === "win32" ? "unconfirmed" : "fsync");
        const ordinary = await a.provider.invoke("set", { key: "ordinary", value: { ok: true }, expectedRevision: 0 }, invocation);
        assert.equal(ordinary.revision, 3, "ordinary releases keep committing revisions");
        assert.equal(fs.existsSync(lockPathOf(a.root)), false, "an ordinary release must remove the lock");

        // --- B. Foreign same-bytes inode replacement preserved, then normal retry.
        const b = newProvider("state-foreign");
        let foreignSwaps = 0;
        let originalInode;
        let replacementInode;
        /** @type {any} */
        let lockError;
        await patchedFs({ renameSync: (from, to) => {
          const mapped = realRename(from, to);
          if (String(to) === path.join(b.root, "state.json")) {
            const lockPath = lockPathOf(b.root);
            const bytes = fs.readFileSync(lockPath);
            originalInode = fs.lstatSync(lockPath).ino;
            fs.renameSync(lockPath, lockPath + ".original");
            fs.writeFileSync(lockPath, bytes, { mode: 0o600, flag: "wx" });
            replacementInode = fs.lstatSync(lockPath).ino;
            foreignSwaps += 1;
          }
          return mapped;
        } }, async () => {
          try { await b.provider.invoke("set", { key: "locked", value: { v: 2 }, expectedRevision: 0 }, invocation); }
          catch (error) { lockError = error; }
        });
        assert.equal(foreignSwaps, 1);
        assert.equal(lockError && lockError.name, "StateCommitAcknowledgementError");
        assert.equal(lockError.committed, true, "the foreign swap happens after publication");
        assert.equal(lockError.lockCleanup, "unresolved", "a foreign replacement leaves cleanup ownership unresolved");
        assert.notEqual(originalInode, replacementInode, "the replacement must be a distinct inode");
        const preserved = fs.readFileSync(lockPathOf(b.root));
        assert.deepEqual(preserved, fs.readFileSync(lockPathOf(b.root) + ".original"), "the foreign replacement must carry the same bytes");
        assert.match(String(preserved), /"schemaVersion":2/u, "the replacement lock payload must be preserved, never deleted");
        const publishedForeign = await b.provider.invoke("get", { key: "locked" }, invocation);
        assert.deepEqual(publishedForeign.value, { v: 2 });
        // Normal retry: restore our original lock; the deferred cleanup removes
        // only that inode, and the provider keeps working afterwards.
        fs.renameSync(lockPathOf(b.root), lockPathOf(b.root) + ".replacement-preserved");
        fs.renameSync(lockPathOf(b.root) + ".original", lockPathOf(b.root));
        const retried = await b.provider.invoke("set", { key: "retried", value: { v: 3 }, expectedRevision: 0 }, invocation);
        assert.equal(retried.revision, 2, "the deferred release retry must let the mutation proceed");
        assert.equal(fs.existsSync(lockPathOf(b.root)), false, "the deferred release retry must remove the original lock");
        const again = await b.provider.invoke("set", { key: "retried-again", value: { v: 4 }, expectedRevision: 0 }, invocation);
        assert.equal(again.revision, 3, "ordinary mutations must continue after deferred cleanup succeeds");

        // --- C. Lost lock after commit: committed acknowledgement, no rollback.
        const c = newProvider("state-lost-after-commit");
        await c.provider.invoke("set", { key: "before", value: { v: 0 }, expectedRevision: 0 }, invocation);
        /** @type {any} */
        let lostAfter;
        await patchedFs({ renameSync: (from, to) => {
          const mapped = realRename(from, to);
          if (String(to) === path.join(c.root, "state.json")) { try { fs.renameSync(lockPathOf(c.root), lockPathOf(c.root) + ".lost"); } catch { /* fixture swap */ } }
          return mapped;
        } }, async () => {
          try { await c.provider.invoke("set", { key: "lost", value: { v: 3 }, expectedRevision: 0 }, invocation); }
          catch (error) { lostAfter = error; }
        });
        assert.equal(lostAfter && lostAfter.name, "StateCommitAcknowledgementError", "post-publication lock loss must surface the committed acknowledgement error");
        assert.equal(lostAfter.committed, true, "published data is committed, never rolled back");
        assert.equal(lostAfter.durability, "confirmed", "durability truth is independent of the later lock loss");
        assert.equal(lostAfter.lockCleanup, "unresolved", "a missing held lock leaves cleanup ownership unresolved");
        const lostRead = await c.provider.invoke("get", { key: "lost" }, invocation);
        assert.deepEqual(lostRead.value, { v: 3 }, "the published mutation stays visible");
        assert.equal(fs.existsSync(lockPathOf(c.root)), false, "the lost lock must not be recreated");
        assert.equal(fs.existsSync(lockPathOf(c.root) + ".lost"), true, "the moved lock is retained as evidence");
        let blockedAfter = false;
        try { await c.provider.invoke("set", { key: "unsafe", value: { v: 9 }, expectedRevision: 0 }, invocation); }
        catch (error) { blockedAfter = /uncertain state lock ownership/u.test(String(error.message)); }
        assert.equal(blockedAfter, true, "unresolved lock ownership must refuse new effects");
        const readStillWorks = await c.provider.invoke("get", { key: "before" }, invocation);
        assert.deepEqual(readStillWorks.value, { v: 0 }, "reads stay available while effects are blocked");

        // --- D. Lost lock before commit: zero publication.
        const d = newProvider("state-lost-before-commit");
        await d.provider.invoke("set", { key: "base", value: { v: 1 }, expectedRevision: 0 }, invocation);
        const revisionBefore = readRevision(d.root);
        let fileFsyncs = 0;
        /** @type {any} */
        let lostBefore;
        await patchedFs({ fsyncSync: (descriptor) => {
          let stat;
          try { stat = fs.fstatSync(descriptor); } catch { return realFsync(descriptor); }
          if (stat.isDirectory()) return realFsync(descriptor);
          fileFsyncs += 1;
          // The first file fsync initializes the held lock; losing it on the
          // next (state temp) fsync lands before the commit boundary.
          if (fileFsyncs >= 2) { try { fs.rmSync(lockPathOf(d.root)); } catch { /* fixture loss */ } }
          return realFsync(descriptor);
        } }, async () => {
          try { await d.provider.invoke("set", { key: "lost-before", value: { v: 4 }, expectedRevision: 0 }, invocation); }
          catch (error) { lostBefore = error; }
        });
        assert.ok(lostBefore, "losing the held lock before publication must fail the mutation");
        assert.equal(lostBefore[FABRIC_COMMIT_ACKNOWLEDGEMENT], undefined, "nothing was published, so no commit acknowledgement is valid");
        assert.notEqual(lostBefore.name, "StateCommitAcknowledgementError", "a pre-publication lock loss is not a commit acknowledgement");
        assert.ok(fileFsyncs >= 2, "the state temp fsync must have run to reach the pre-commit loss");
        assert.equal(readRevision(d.root), revisionBefore, "the state document must not advance");
        const base = await d.provider.invoke("get", { key: "base" }, invocation);
        assert.deepEqual(base.value, { v: 1 });
        const missing = await d.provider.invoke("get", { key: "lost-before" }, invocation);
        assert.equal(missing.found, false, "the aborted key must never appear");
        let blockedBefore = false;
        try { await d.provider.invoke("set", { key: "unsafe", value: { v: 9 }, expectedRevision: 0 }, invocation); }
        catch (error) { blockedBefore = /uncertain state lock ownership/u.test(String(error.message)); }
        assert.equal(blockedBefore, true, "pre-commit lock loss must also refuse new effects");

        const stateRelease = await assertStateReleaseRegression(api, context);
        return {
          status: "passed",
          variants: {
            casCommitted: true, staleRevisionConflict: true, ordinaryRelease: true,
            postRenameFsyncUnconfirmed: true, committedDurableTruth: true,
            sameBytesReplacementPreserved: true, pendingCleanupRetrySucceeds: true,
            ordinaryWriteAfterDeferredCleanupRetry: true, stateReleaseLossFailsClosed: true,
            lostLockAfterCommitCommitted: true, lostLockBeforeCommitZeroPublication: true,
            lockedEffectsBlockedAfterLoss: true,
          },
          stateRelease,
          durability: { directoryFsyncs, durability: durabilityError.durability, committed: durabilityError.committed, lockCleanup: durabilityError.lockCleanup },
          foreignReplacement: { foreignSwaps, originalInode, replacementInode, preserved: true, retryRemoved: true },
          lostAfterCommit: { name: lostAfter.name, committed: lostAfter.committed, durability: lostAfter.durability, lockCleanup: lostAfter.lockCleanup, blocked: blockedAfter, retainedLock: true },
          lostBeforeCommit: { name: lostBefore.name, committedAcknowledged: false, revisionBefore, revisionAfter: readRevision(d.root), blocked: blockedBefore },
          coverageGaps: [],
        };
      },
    },
    {
      id: "SB08",
      title: "built public exports, declarations, runtimeAssets entrypoints and closure input hashes",
      effects: "reads built dist and source manifests only",
      deadlineMs: 60000,
      run: async (context) => {
        const root = context.root;
        const api = await loadBuiltApi(root);
        const required = ["createKiroMcpServer", "createKiroRuntime", "KiroHostSessionAdapter", "ActionRegistry", "LocalCodingProvider", "FoveaProvider", "ProbeProvider", "ReviewProvider", "ContinuityProvider", "normalizeFabricConfig", "loadFabricConfig", "FabricRepairError", "remoteRef", "parseRemoteRef", "formatLocalEvidence", "ContinuityConversationArchive", "ContinuityRotationJournal", "buildRunProvenance"];
        const missing = required.filter((name) => typeof api[name] === "undefined");
        assert.deepEqual(missing, [], "missing public exports");
        const declarations = fs.readFileSync(path.join(root, "dist/index.d.ts"), "utf8");
        const undeclared = required.filter((name) => !declarations.includes(name));
        assert.deepEqual(undeclared, [], "missing declaration entries");

        const product = JSON.parse(fs.readFileSync(path.join(root, "agent-product.json"), "utf8"));
        const runtimeAssets = product.runtimeAssets;
        const outputs = { compilerWorker: "dist/runtime/compiler-worker-entry.js", sandboxWorker: "dist/runtime/sandbox-worker-entry.js", foveaEngine: "dist/fovea/engine-entry.js", foveaHook: "dist/kiro/fovea-hook.js" };
        assert.deepEqual(Object.keys(runtimeAssets).sort(), Object.keys(outputs).sort(), "runtime asset inventory must match the declared built outputs");
        const assetChecks = [];
        for (const [key, source] of Object.entries(runtimeAssets)) {
          assert.ok(source.startsWith("src/"), "runtime asset must be a source path: " + key + "=" + source);
          assert.notEqual(source, outputs[key], "a source path must not be used as the output path: " + key);
          assert.equal(fs.existsSync(path.join(root, source)), true, "missing runtime asset source: " + source);
          assert.equal(fs.existsSync(path.join(root, outputs[key])), true, "missing built runtime asset: " + outputs[key]);
          assetChecks.push({ key, source, output: outputs[key] });
        }

        const closureDir = path.join(root, "dist/kiro-agent-closure");
        const manifest = JSON.parse(fs.readFileSync(path.join(closureDir, "closure-manifest.json"), "utf8"));
        const outputPaths = new Set(manifest.files.map((file) => file.path));
        const sourceInputs = new Set(manifest.sourceInputs);
        assert.deepEqual([...outputPaths].filter((entry) => sourceInputs.has(entry)), [], "closure source inputs and output paths must be disjoint");
        assert.deepEqual(Object.values(runtimeAssets).filter((entry) => !sourceInputs.has(entry)), [], "runtime asset sources missing from closure sourceInputs");
        for (const [key, relative] of Object.entries({ compilerWorker: manifest.compilerWorker, sandboxWorker: manifest.sandboxWorker, foveaEngine: manifest.foveaEngine, foveaHook: manifest.foveaHook })) {
          assert.equal(outputs[key], "dist/" + relative, "declared built asset must be the dist output of the closure artifact: " + key);
          assert.equal(outputPaths.has(relative), true, "closure output missing: " + key + "=" + String(relative));
          assert.equal(fs.existsSync(path.join(closureDir, relative)), true, "closure output file missing: " + String(relative));
        }
        for (const key of ["compilerWorker", "sandboxWorker"]) {
          assert.equal(sourceInputs.has(runtimeAssets[key]), true, "worker source must be a closure input: " + key);
          assert.equal(outputPaths.has(runtimeAssets[key]), false, "worker source must not be a closure output: " + key);
          assert.equal(sourceInputs.has(outputs[key]), false, "a built worker output must not be a closure source input: " + key);
        }
        let hashMismatches = 0;
        let byteMismatches = 0;
        const digest = createHash("sha256");
        for (const file of manifest.files) {
          const content = fs.readFileSync(path.join(closureDir, file.path));
          if (createHash("sha256").update(content).digest("hex") !== file.sha256) hashMismatches += 1;
          if (content.length !== file.bytes) byteMismatches += 1;
          digest.update(file.path).update("\0").update(content);
        }
        assert.equal(hashMismatches, 0, "closure output hashes must match retained bytes");
        assert.equal(byteMismatches, 0);
        assert.equal(digest.digest("hex"), manifest.contentDigest, "closure contentDigest must match retained output bytes");
        let buildInputMismatches = 0;
        for (const input of manifest.buildInputs.files) {
          const target = path.join(root, input.path);
          if (!fs.existsSync(target) || createHash("sha256").update(fs.readFileSync(target)).digest("hex") !== input.sha256) buildInputMismatches += 1;
        }
        assert.equal(buildInputMismatches, 0, "closure buildInputs must match every current source; a stale dist fails until Main rebuilds");
        const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
        assert.equal(packageJson.main, "./dist/index.js", "package main must be the built entry");
        assert.equal(packageJson.types, "./dist/index.d.ts", "package types must be the built declarations");
        assert.equal(packageJson.exports && packageJson.exports["."] && packageJson.exports["."].types, "./dist/index.d.ts", "package exports[\".\"].types must be the built declarations");
        assert.equal(packageJson.exports && packageJson.exports["."] && packageJson.exports["."].import, "./dist/index.js", "package exports[\".\"].import must be the built entry");
        for (const entry of ["dist/runtime/compiler-worker-entry.js", "dist/runtime/sandbox-worker-entry.js"]) assert.ok(packageJson.files.includes(entry), "package files must list " + entry);
        return {
          status: "passed",
          variants: { publicExports: required.length, declaredEntries: required.length, runtimeAssets: assetChecks, closureOutputs: 4, sourceOutputDisjoint: true, closureHashMismatches: hashMismatches, packageEntrypoints: true, workerSourceOutputIdentity: true, buildInputsStrict: true },
          closure: { files: manifest.files.length, sourceInputs: manifest.sourceInputs.length, contentDigestMatched: true, buildInputMismatches },
          coverageGaps: [],
        };
      },
    },
  ];
}
