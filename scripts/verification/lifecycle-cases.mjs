// Focused W0-W3 regressions, not full behavioral or release qualification.
// Source cases use inert runtime factories; all generated fixtures are retained.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { validateCaseRegistry, incompleteCaseResult } from "./case-contract.mjs";
import { createFixtureRoot } from "./runner.mjs";
import { createRpcCases } from "./lifecycle-rpc-cases.mjs";
import { createShutdownCases } from "./lifecycle-shutdown-cases.mjs";
import { createHandlerCases } from "./lifecycle-handler-cases.mjs";
import { createArtifactCases } from "./lifecycle-artifact-cases.mjs";
import { createFoveaCleanupCases } from "./lifecycle-fovea-cleanup-cases.mjs";
import { createFoveaProcessCases } from "./lifecycle-fovea-process-cases.mjs";
import { createFoveaBuiltCases } from "./lifecycle-fovea-built.mjs";
import { createArtifactBuiltCases } from "./lifecycle-artifact-built.mjs";

export const requiredIds = ["LC01", "LC02", "LC03", "LC04", "LC05", "LC06", "LC07", "LC08", "LC09", "LC10", "LC11", "LC12", "LC13", "LC14", "LC15", "LC16", "LC17", "LC18", "LC19", "LC20", "LC21", "LC22", "LC23", "LC24", "LC25", "LC26", "LC27", "LC28", "LC29", "LC30"];

/** @returns {any[]} */
export function createCases() {
  return [
    ...createRpcCases(),
    ...createShutdownCases(),
    {
      id: "LC12", title: "lifecycle completeness fails closed and fixture roots are retained",
      effects: "validates case metadata; writes retained private fixture markers, including .git metadata; no removal",
      run: async context => {
        const cases = createCases();
        assert.deepEqual(validateCaseRegistry("lifecycle", cases, requiredIds).problems, []);
        const rejects = (entries, ids = requiredIds) => assert.ok(validateCaseRegistry("lifecycle", entries, ids).problems.length > 0);
        rejects([], []);
        rejects(cases.slice(1));
        rejects(cases, requiredIds.slice(1));
        rejects([...cases, cases[0]]);
        rejects(cases.map((entry, i) => i ? entry : { ...entry, id: "LC-UNKNOWN" }));
        rejects(cases.map((entry, i) => i ? entry : { ...entry, run: undefined }));
        rejects(cases.map((entry, i) => i ? entry : { ...entry, deadlineMs: 0 }));
        for (const facts of [undefined, null, [], { status: "partial" }, { coverageGaps: ["missing probe"] }]) {
          assert.ok(incompleteCaseResult(facts));
        }
        assert.equal(incompleteCaseResult({ status: "passed", coverageGaps: [] }), null);
        const retained = createFixtureRoot(context.fixturesRoot, "lifecycle-retention");
        const metadata = path.join(retained, ".git");
        fs.mkdirSync(metadata, { mode: 0o700 });
        const marker = path.join(metadata, "fixture-marker");
        fs.writeFileSync(marker, "retain this task-owned metadata\n", { flag: "wx", mode: 0o600 });
        const next = createFixtureRoot(context.fixturesRoot, "lifecycle-retention");
        assert.notEqual(retained, next);
        assert.equal(fs.readFileSync(marker, "utf8"), "retain this task-owned metadata\n");
        return { requiredCases: requiredIds.length, rejectedRegistries: 7, rejectedPartialResults: 5,
          retainedMetadata: marker, fixturePolicy: "retain; no automatic deletion" };
      },
    },
    {
      id: "LC13", title: "rebuilt public API joins failed close and closure matches lifecycle source",
      effects: "reads built exports/declarations/manifest; inert registry/runtime; intercepted SDK transport; parser-free idle host; retained fixture files",
      run: async context => {
        const api = await import(pathToFileURL(path.join(context.root, "dist/index.js")).href);
        const declarations = fs.readFileSync(path.join(context.root, "dist/index.d.ts"), "utf8");
        const symbols = ["ActionRegistry", "createKiroRuntime", "KiroHostSessionAdapter", "createKiroMcpServer"];
        for (const symbol of symbols) { assert.equal(typeof api[symbol], "function"); assert.ok(declarations.includes(symbol)); }
        const manifest = JSON.parse(fs.readFileSync(path.join(context.root, "dist/kiro-agent-closure/closure-manifest.json"), "utf8"));
        const sources = ["src/kiro/mcp-provider.ts", "src/core/action-registry.ts", "src/execution-service.ts", "src/kiro/runtime.ts", "src/kiro/host-session-adapter.ts", "src/kiro/mcp-server.ts", "src/kiro/mcp-session.ts", "src/kiro/mcp-session-lifecycle.ts", "src/kiro/mcp-execution.ts", "src/kiro/mcp-workspace.ts", "src/kiro/mcp-response.ts"];
        for (const source of sources) {
          const recorded = manifest.buildInputs.files.find(entry => entry.path === source);
          assert.ok(recorded, "lifecycle build input missing: " + source);
          assert.equal(recorded.sha256, createHash("sha256").update(fs.readFileSync(path.join(context.root, source))).digest("hex"), "stale built closure: " + source);
        }
        const registry = new api.ActionRegistry();
        const failure = new Error("owned built provider close failed");
        /** @type {(reason:unknown)=>void} */ let rejectClose = () => {};
        const gate = new Promise((_, reject) => { rejectClose = reject; });
        void gate.catch(() => {});
        let calls = 0, otherCalls = 0;
        registry.register({ name: "slow", description: "inert lifecycle fixture", list: async () => [],
          invoke: async () => null, close: () => { calls++; return gate; } });
        registry.register({ name: "other", description: "inert lifecycle fixture", list: async () => [],
          invoke: async () => null, close: async () => { otherCalls++; } });
        const first = registry.close(), second = registry.close();
        const outcomes = Promise.allSettled([first, second]);
        try {
          assert.equal(first, second, "close callers must join the same operation");
          assert.throws(() => registry.register({ name: "late" }), /closed/);
        } finally { rejectClose(failure); }
        const settled = await outcomes;
        assert.equal(calls, 1); assert.equal(otherCalls, 1);
        for (const outcome of settled) {
          assert.equal(outcome.status, "rejected");
          if (outcome.status === "rejected") {
            assert.ok(outcome.reason instanceof AggregateError);
            assert.ok(outcome.reason.errors.includes(failure));
          }
        }
        assert.equal(registry.close(), first, "failed cleanup must not be silently retried");
        // Exercise the actual built handler API too. The SDK transport never
        // connects, runtime workers are inert, and no parser child is configured.
        const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
        const saved = { connect: Server.prototype.connect, close: Server.prototype.close };
        const runtimeError = new Error("built handler runtime close failed"), transportError = new Error("built handler transport close failed");
        let connections = 0, runtimeCloses = 0, transportCloses = 0;
        Server.prototype.connect = async function () { connections++; };
        Server.prototype.close = async function () { transportCloses++; throw transportError; };
        const directory = path.join(context.fixturesRoot, "built-handler");
        const runtimeRoot = path.join(directory, "runtime"), dataRoot = path.join(directory, "data");
        fs.mkdirSync(directory, { mode: 0o700 });
        for (const child of [runtimeRoot, dataRoot]) fs.mkdirSync(child, { mode: 0o700 });
        let server;
        try {
          server = await api.createKiroMcpServer({ runtimeRoot, dataRoot, version: "0.0.0-fixture",
            runtime: { service: { invalidateCatalogs() {} }, close() { runtimeCloses++; throw runtimeError; } } });
          const first = server.close(), second = server.close();
          const outcomes = await Promise.allSettled([first, second]);
          assert.equal(first, second, "built server close is shared");
          assert.equal(connections, 1); assert.equal(runtimeCloses, 1); assert.equal(transportCloses, 1);
          /** @param {unknown} error @returns {unknown[]} */
          const leaves = error => error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
          for (const outcome of outcomes) {
            assert.equal(outcome.status, "rejected");
            if (outcome.status === "rejected") {
              assert.ok(leaves(outcome.reason).includes(runtimeError), "built handler preserves runtime failure");
              assert.ok(leaves(outcome.reason).includes(transportError), "built handler preserves transport failure");
            }
          }
          assert.equal(server.close(), first, "built failed close is never retried");
        } finally {
          if (server) await Promise.allSettled([server.close()]);
          Server.prototype.connect = saved.connect; Server.prototype.close = saved.close;
        }
        return { publicSymbols: symbols, verifiedSourceInputs: sources, closeAttempts: calls + otherCalls,
          failedCloseShared: true, builtHandler: { connections, runtimeCloses, transportCloses, originalErrors: 2 }, qualification: false };
      },
    },
    ...createHandlerCases(),
    ...createArtifactCases(),
    ...createArtifactBuiltCases(),
    ...createFoveaCleanupCases(),
    ...createFoveaProcessCases(),
    ...createFoveaBuiltCases(),
  ];
}
