import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContinuityProvider } from "../src/providers/continuity-provider.js";
import { ContinuityExecution } from "../src/continuity/execution.js";
import { localHash } from "../src/providers/local-path.js";
import { normalizeFabricConfig, loadFabricConfig } from "../src/config.js";
import { createKiroRuntime, type KiroRuntime } from "../src/kiro/runtime.js";
import type { ContinuityHandle } from "../src/continuity/store.js";
import type { ContinuityRecord } from "../src/continuity/records.js";
import type { ContinuityTaskView } from "../src/continuity/task-view.js";
import type { ContinuityRecallResult } from "../src/continuity/recall.js";

const roots: string[] = [], runtimes: KiroRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true });
});
const limits = { maxTasks: 32, maxTaskBytes: 131072, maxTotalBytes: 4194304, maxSummaryBytes: 8192 };
function fixture(maxResultBytes = 24000) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "continuity-task-"))); roots.push(base);
  const root = path.join(base, "workspace"); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "input.txt"), "original\n");
  const store = path.join(base, "continuity"), context = { cwd: root };
  const provider = new ContinuityProvider(store, { ...limits, maxResultBytes, workspaceRoot: root });
  const call = (name: string, args: Record<string, unknown>) => provider.invoke(name, args, context);
  const create = async () => await call("create", { objective: "Fix the retry bug", constraints: ["Do not change public behavior"] }) as ContinuityHandle;
  const view = async (task: ContinuityHandle, maxSummaryBytes = 4096) => await call("read", { taskId: task.taskId, view: "task", maxSummaryBytes }) as ContinuityTaskView;
  const expand = async (task: ContinuityHandle) => (await call("expand", { taskId: task.taskId, expectedRevision: task.revision, hash: task.hash, limit: 64 }) as { records: ContinuityRecord[] }).records;
  return { root, store, provider, context, call, create, view, expand };
}
async function captured(f: ReturnType<typeof fixture>, options: { ok?: boolean; output?: boolean; overlap?: boolean; batch?: boolean; partial?: boolean } = {}) {
  const task = await f.create(), recorder = new ContinuityExecution(undefined, undefined, options.output ?? false);
  const ref = options.batch ? "local.readMany" : "local.read";
  const read = recorder.admit(ref).observer;
  read.resolve(ref, "read"); read.dispatch();
  const finishRead = () => {
    const file = { path: "input.txt", sha256: localHash("original\n") };
    read.result(options.batch ? { files: [file], complete: !options.partial, failures: options.partial ? [{}] : [] } : file);
    read.settle(true);
  };
  if (!options.overlap) finishRead();
  const command = recorder.admit("local.shell").observer;
  command.resolve("local.shell", "execute"); command.dispatch();
  if (options.overlap) finishRead();
  command.result({ ok: options.ok !== false, exitCode: options.ok === false ? 7 : 0, signal: null,
    stderr: options.ok === false ? "retry failed: " + "😀".repeat(200) : "", stdout: "", truncated: false });
  command.settle(true);
  const context = { ...f.context, continuityCapture: recorder.admit("continuity.checkpoint").capture };
  const args = { taskId: task.taskId, expectedRevision: task.revision, requestId: "result", captureCurrentExecution: true,
    checks: [{ id: "regression", text: "Retry regression", status: "passed", evidence: "captured" }] };
  const saved = await f.provider.invoke("checkpoint", args, context) as ContinuityHandle;
  return { task, saved, context, args };
}

describe("task-specific evidence and recall", () => {
  it("links checks to observed inputs/commands and survives reopening without rerunning work", async () => {
    const f = fixture(), { saved, args } = await captured(f);
    const view = await f.view(saved);
    expect(view.checks).toEqual([expect.objectContaining({ id: "regression", commandOutcome: "passed", freshness: "unchanged", inputBinding: "observed-before-command", needsAttention: false })]);
    expect(view.coverage).toMatchObject({ semanticValidation: false, sourceScope: "linked-files-only", conversation: "not-captured" });
    const reopened = new ContinuityProvider(f.store, { ...limits, workspaceRoot: f.root });
    expect(await reopened.invoke("read", { taskId: saved.taskId, view: "task" }, f.context)).toEqual(view);
    const retry = await reopened.invoke("checkpoint", args, { ...f.context, continuityCapture: () => { throw new Error("must not recapture"); } });
    expect(retry).toMatchObject({ ...saved, alreadyPublished: true });
    const bytes = fs.readFileSync(path.join(f.store, "state.json"), "utf8");
    await expect(reopened.invoke("checkpoint", { ...args, checks: [{ id: "regression", text: "Different claim", status: "passed" }] }, f.context)).rejects.toThrow("request ID conflict");
    expect(fs.readFileSync(path.join(f.store, "state.json"), "utf8")).toBe(bytes);
  });
  it("does not mistake an admitted but unfinished source read for a pre-command observation", async () => {
    const f = fixture(), { saved } = await captured(f, { overlap: true });
    expect((await f.view(saved)).checks[0]).toMatchObject({ inputBinding: "unbound", needsAttention: true });
  });
  it("invalidates changed, missing and symlinked sources, not unrelated files", async () => {
    const f = fixture(), { saved } = await captured(f);
    fs.writeFileSync(path.join(f.root, "unrelated"), "changed");
    expect((await f.view(saved)).checks[0]!.freshness).toBe("unchanged");
    fs.writeFileSync(path.join(f.root, "input.txt"), "changed");
    expect((await f.view(saved)).checks[0]).toMatchObject({ freshness: "stale", needsAttention: true });
    fs.unlinkSync(path.join(f.root, "input.txt"));
    expect((await f.view(saved)).checks[0]!.freshness).toBe("unavailable");
    fs.symlinkSync("unrelated", path.join(f.root, "input.txt"));
    expect((await f.view(saved)).checks[0]!.freshness).toBe("unavailable");
  });
  it("retains batch source hashes but does not certify partial batches", async () => {
    for (const partial of [false, true]) {
      const f = fixture(), { saved } = await captured(f, { batch: true, partial });
      expect((await f.view(saved)).checks[0]).toMatchObject({ freshness: "unchanged", needsAttention: partial });
      const recalled = await f.call("recall", { taskId: saved.taskId, path: "input.txt", ref: "local.readMany" }) as ContinuityRecallResult;
      expect(recalled.hits.length).toBeGreaterThan(0);
    }
  });
  it("distinguishes nonzero command results from successful transport and retains only opt-in bounded diagnostics", async () => {
    for (const output of [false, true]) {
      const f = fixture(), { saved } = await captured(f, { ok: false, output });
      expect((await f.view(saved)).checks[0]).toMatchObject({ declaredStatus: "passed", commandOutcome: "failed", needsAttention: true });
      const receipt = (await f.expand(saved)).find(record => record.kind === "operation" && record.command);
      expect(receipt).toMatchObject({ outcome: "succeeded", command: { ok: false, exitCode: 7 } });
      if (receipt?.kind !== "operation") throw new Error("missing receipt");
      if (output) {
        expect(receipt.diagnostic?.text).toContain("retry failed");
        expect(Buffer.byteLength(receipt.diagnostic!.text)).toBeLessThanOrEqual(512);
        expect(receipt.diagnostic?.truncated).toBe(true);
        expect(receipt.diagnostic!.text).not.toContain("�");
      } else expect(receipt.diagnostic).toBeUndefined();
      const result = await f.call("recall", { taskId: saved.taskId, ref: "local.shell", outcome: "failed" }) as ContinuityRecallResult;
      expect(result.hits.some(hit => hit.kind === "operation")).toBe(true);
      const diagnostic = await f.call("recall", { taskId: saved.taskId, query: "retry failed" }) as ContinuityRecallResult;
      expect(diagnostic.total > 0).toBe(output);
    }
  });
  it("rejects forged/missing links and preserves the previous checkpoint on failure", async () => {
    const f = fixture(), task = await f.create(), before = fs.readFileSync(path.join(f.store, "state.json"), "utf8");
    for (const evidence of [[1], [500], [1, 1], "invalid!", "captured"]) {
      await expect(f.call("checkpoint", { taskId: task.taskId, expectedRevision: task.revision, requestId: "bad", checks: [{ id: "bad", text: "claim", status: "passed", evidence }] })).rejects.toThrow();
      expect(fs.readFileSync(path.join(f.store, "state.json"), "utf8")).toBe(before);
    }
    await expect(f.call("checkpoint", { taskId: task.taskId, expectedRevision: task.revision, requestId: "bad", checks: [{ id: "bad", text: "claim", status: "passed", provenance: "host-observed" }] })).rejects.toThrow();
  });
  it("keeps selected review notes as durable declared claims and only the latest check active", async () => {
    const f = fixture(), task = await f.create();
    const first = await f.call("checkpoint", { taskId: task.taskId, expectedRevision: task.revision, requestId: "review", checks: [{ id: "review", text: "Conditional finding", status: "blocked", note: "Needs a counterexample check", review: { taskId: "review-task", revision: 2, findingId: "finding-1", status: "conditional", scope: "retry path" } }] }) as ContinuityHandle;
    const final = await f.call("checkpoint", { taskId: task.taskId, expectedRevision: first.revision, requestId: "claim", checks: [{ id: "review", text: "Declared complete", status: "passed" }] }) as ContinuityHandle;
    const view = await f.view(final);
    expect(view.checks).toHaveLength(1); expect(view.checks[0]).toMatchObject({ commandOutcome: "unobserved", freshness: "unbound", needsAttention: true });
    const result = await f.call("recall", { taskId: final.taskId, checkId: "review", query: "conditional" }) as ContinuityRecallResult;
    const exact = await f.call("expand", result.hits[0]!.follow.args) as { records: ContinuityRecord[] };
    expect(exact.records[0]).toMatchObject({ kind: "check", provenance: "declared", review: { status: "conditional", scope: "retry path" } });
  });
  it("pins objective/constraints, prioritizes unresolved checks and discloses all omissions", async () => {
    const f = fixture(), task = await f.create();
    const saved = await f.call("checkpoint", { taskId: task.taskId, expectedRevision: task.revision, requestId: "noise", facts: Array.from({ length: 30 }, (_, i) => ({ kind: "decision", text: `routine ${i} ${"x".repeat(100)}` })), checks: [{ id: "urgent", text: "Fix outstanding regression", status: "blocked" }] }) as ContinuityHandle;
    const view = await f.view(saved, 1500);
    expect(Buffer.byteLength(view.summary)).toBeLessThanOrEqual(1500);
    expect(view.summary).toContain("Fix the retry bug"); expect(view.summary).toContain("Do not change public behavior"); expect(view.summary).toContain("Fix outstanding regression");
    expect(view.coverage.omittedRecords).toBeGreaterThan(0);
    expect(view.omittedRanges.reduce((n, range) => n + range.throughSequence - range.fromSequence + 1, 0)).toBe(view.coverage.omittedRecords);
    expect(view.coverage.shownRecords + view.coverage.omittedRecords).toBe(saved.admittedRecords);
    await expect(f.view(saved, 1)).rejects.toThrow("budget too small");
  });
  it("provides bounded AND search, stable paging and exact expansion; stale pointers reject", async () => {
    const f = fixture(2000), task = await f.create();
    const saved = await f.call("checkpoint", { taskId: task.taskId, expectedRevision: task.revision, requestId: "rows", facts: Array.from({ length: 15 }, (_, i) => ({ kind: "decision", text: `needle ${i} ${"😀\\\"".repeat(30)}` })) }) as ContinuityHandle;
    let result = await f.call("recall", { taskId: saved.taskId, query: "needle", limit: 3, snippetChars: 80 }) as ContinuityRecallResult;
    const pointer = result.hits[0]!.follow, seen: number[] = [];
    for (;;) {
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(2000);
      seen.push(...result.hits.map(hit => hit.sequence));
      for (const hit of result.hits) {
        expect(Array.from(hit.snippet).length).toBeLessThanOrEqual(80);
        const exact = await f.call("expand", hit.follow.args) as { records: ContinuityRecord[] };
        expect(exact.records[0]!.sequence).toBe(hit.sequence);
      }
      if (!result.next) break;
      result = await f.call("recall", { ...result.next.args }) as ContinuityRecallResult;
    }
    expect(new Set(seen).size).toBe(15);
    expect(await f.call("recall", { taskId: saved.taskId, query: "needle absent" })).toMatchObject({ total: 0, hits: [], coverage: { scope: "retained-task-records", freshness: "historical-not-reconciled" } });
    await expect(f.call("recall", { taskId: saved.taskId, offset: 1 })).rejects.toThrow("revision and hash");
    await f.call("checkpoint", { taskId: saved.taskId, expectedRevision: saved.revision, requestId: "next", facts: [{ kind: "next-step", text: "changed" }] });
    await expect(f.call("expand", pointer.args)).rejects.toThrow("revision conflict");
    await expect(f.call("recall", { taskId: saved.taskId, expectedRevision: saved.revision, hash: saved.hash })).rejects.toThrow("revision conflict");
  });
  it("defaults failure output off and rejects non-boolean file configuration", () => {
    expect(normalizeFabricConfig(undefined).continuity.captureFailureOutput).toBe(false);
    const f = fixture(), config = path.join(f.root, "config.json");
    fs.writeFileSync(config, JSON.stringify({ continuity: { captureFailureOutput: "true" } }));
    expect(() => loadFabricConfig(config)).toThrow();
  });
});

it.each(["readMany", "readEvidence"])("runs the new workflow through the checked guest with %s, failure recall and cold recovery", async (method) => {
  const f = fixture();
  const options = { cwd: f.root, workspaceRoot: f.root, localLockRoot: path.join(path.dirname(f.store), "locks"), continuityRoot: f.store,
    configFile: path.join(f.root, "config.json"), mcpConfigPath: path.join(f.root, "mcp.json"), artifactsRoot: path.join(f.root, "artifacts"),
    config: normalizeFabricConfig({ continuity: { enabled: true, captureFailureOutput: true }, mcp: { enabled: false }, tracing: { enabled: false } }) };
  const runtime = createKiroRuntime(options); runtimes.push(runtime);
  const approver = { async approve() {}, prepareApproval: () => ({ decision: "allow" as const }) };
  const result = await runtime.service.execute({ workspaceBound: true, approver, code: `
    const task = await continuity.create({objective:"Guest task"});
    await local.${method}({windows:[{path:"input.txt",limit:1}]});
    const test = await local.shell({command:"printf once >> count; printf regression_failure >&2; exit 7",settle:true});
    const saved = await continuity.checkpoint({taskId:task.taskId,expectedRevision:task.revision,requestId:"check",captureCurrentExecution:true,checks:[{id:"regression",text:"Regression check",status:test.ok?"passed":"failed",evidence:"captured"}]});
    const view = await continuity.read({taskId:saved.taskId,view:"task"});
    const hits = await continuity.recall({taskId:saved.taskId,query:"regression_failure",outcome:"failed"});
    return {saved,view,hits};` });
  expect(result.success, result.error + JSON.stringify(result.typeErrors)).toBe(true);
  const value = result.value as { saved: ContinuityHandle; view: ContinuityTaskView; hits: ContinuityRecallResult };
  expect(value.view.checks[0]).toMatchObject({ commandOutcome: "failed", freshness: "unchanged", inputBinding: "observed-before-command" });
  expect(value.hits.hits).toHaveLength(1);
  await runtime.close();
  const recovered = createKiroRuntime(options); runtimes.push(recovered);
  const read = await recovered.service.execute({ workspaceBound: true, approver, code: `return await continuity.read({taskId:${JSON.stringify(value.saved.taskId)},view:"task"});` });
  expect(read.success, read.error).toBe(true); expect(read.value).toEqual(value.view);
  expect(fs.readFileSync(path.join(f.root, "count"), "utf8")).toBe("once");
});
