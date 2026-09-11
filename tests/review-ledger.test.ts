import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import type { FabricInvocationContext } from "../src/protocol.js";
import { FabricDeadline } from "../src/runtime/deadline.js";
import { validateSchemaValue } from "../src/schema-validation.js";
import { ReviewProvider } from "../src/providers/review-provider.js";
import { REVIEW_GUEST_DECLARATIONS } from "../src/providers/review-contract.js";
import type {
  ReviewBeginResult, ReviewEvidenceInput, ReviewFinding, ReviewFindingArguments,
  ReviewMutationResult, ReviewObligation, ReviewProviderOptions,
  ReviewReconcileResult, ReviewStatusResult, ReviewUpdateArguments,
} from "../src/providers/review-contract.js";

// Acceptance ledger: scope/instance isolation; default role/scenario/failure matrix;
// non-semantic admission (incl. actual negative counterexample); trusted hashes and
// stale reconciliation; bounded/atomic lifecycle; registration approval and guest types.
// Fixtures are injected in memory; these tests create/delete no filesystem fixtures.
const root = realpathSync(process.cwd());
const context: FabricInvocationContext = { cwd: root };
const providers: ReviewProvider[] = [];
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const make = (options: Partial<ReviewProviderOptions> = {}) => {
  const files: Record<string, string> = { "service.ts": "validate(input);\nsave(input);\nreturn receipt;\n", "caller.ts": "return service(input);\n" };
  const reader = vi.fn((file: string) => {
    if (!Object.hasOwn(files, file)) throw new Error("not found");
    return files[file]!;
  });
  const provider = new ReviewProvider({ root, now: () => 0, sourceSnapshot: reader, ...options });
  providers.push(provider);
  return { provider, files, reader };
};
const call = <T>(provider: ReviewProvider, name: string, args: object, ctx = context): Promise<T> => provider.invoke(name, args as Record<string, unknown>, ctx) as Promise<T>;
const begin = (provider: ReviewProvider, paths = ["submit-order"]) => call<ReviewBeginResult>(provider, "begin", { objective: "Trace order submission and failure visibility", paths });
const status = (provider: ReviewProvider, taskId: string) => call<ReviewStatusResult>(provider, "status", { taskId, limit: 50 });
const entries = async (provider: ReviewProvider, taskId: string) => {
  const all: ReviewStatusResult["entries"] = [];
  let offset: number | null = 0;
  do {
    const page: ReviewStatusResult = await call(provider, "status", { taskId, offset, limit: 50 });
    all.push(...page.entries); offset = page.nextOffset;
  } while (offset !== null);
  return all;
};
const proof = (file = "service.ts", kind: ReviewEvidenceInput["kind"] = "static-proof"): ReviewEvidenceInput => ({ path: file, startLine: 1, endLine: 1, kind, rationale: "The cited branch establishes ordering before persistence." });
const finding = (taskId: string): ReviewFindingArguments => ({
  taskId, title: "Receipt is lost after persistence", requestedStatus: "confirmed", severity: "high", confidence: "low",
  caller: "submitOrder in caller.ts invokes service", trigger: "receipt delivery throws after save returns", expectedContract: "a durable order remains discoverable by request ID", actualAction: "the caller retries without the request ID", consequence: "retry can duplicate the durable order",
  evidence: [proof()], counterexample: { verdict: "survived", method: "static-proof", description: "No deduplication branch on the traced retry path", evidence: [proof("caller.ts")] }, unresolvedAssumptions: [],
});
const update = (provider: ReviewProvider, taskId: string, obligationId: string, changes: Partial<ReviewUpdateArguments> = {}) => call<ReviewMutationResult>(provider, "update", { taskId, obligationId, status: "verified", note: "caller invokes service before downstream publication", contract: "publish only after persistence acknowledgement", evidence: [proof()], ...changes });
afterEach(async () => { await Promise.all(providers.splice(0).map(provider => provider.close())); vi.useRealTimers(); });

describe("review ledger coverage and isolation", () => {
  it("creates per-execution-path defaults independently from filenames and never reads during begin/status", async () => {
    const { provider, reader } = make();
    const { taskId, obligationCount } = await begin(provider, ["submit-order", "resume-checkout"]);
    expect(taskId).toMatch(/^task_[0-9a-f-]{36}$/);
    expect(obligationCount).toBe(44);
    const all = (await entries(provider, taskId)) as ReviewObligation[];
    for (const pathId of ["submit-order", "resume-checkout"]) {
      const own = all.filter(item => item.pathId === pathId);
      expect(own.filter(item => item.kind === "scenario").map(item => item.scenario)).toEqual(["normal", "repeated", "malformed", "partial-failure"]);
      expect(own.filter(item => item.kind === "role").map(item => item.role)).toEqual(["entry", "model-validation", "service", "dependency", "persistence", "consumer"]);
      expect(own.filter(item => item.kind === "edge")).toHaveLength(5);
      expect(own.filter(item => item.kind === "partial-failure").map(item => item.failureCheck)).toEqual(["before-effect", "after-effect", "retry-idempotency", "compensation", "acknowledgement", "consumer-visibility"]);
      expect(own.every(item => item.status === "unknown" && item.contract === null)).toBe(true);
    }
    expect(await status(provider, taskId)).toMatchObject({ ready: false, advisory: true, semanticValidation: false, freshness: "unreconciled", unresolvedCount: 44 });
    expect(reader).not.toHaveBeenCalled();
  });

  it("isolates tasks and provider instances and does not restore ended tasks", async () => {
    const { provider } = make(); const other = make().provider;
    const a = await begin(provider); const b = await begin(provider);
    const obligation = (await entries(provider, a.taskId))[0]!;
    await expect(update(provider, b.taskId, obligation.id)).rejects.toThrow("Unknown review obligation");
    await expect(status(other, a.taskId)).rejects.toThrow("Unknown or expired");
    const record = await call<ReviewMutationResult>(provider, "finding", finding(a.taskId));
    await expect(call(provider, "finding", { ...finding(b.taskId), findingId: record.id })).rejects.toThrow("Unknown review finding");
    await update(provider, a.taskId, obligation.id);
    expect((await status(provider, b.taskId)).coverage.verified).toBe(0);
    const visible = await status(provider, a.taskId);
    visible.entries[0]!.id = "tampered";
    expect((await status(provider, a.taskId)).entries[0]!.id).toBe(obligation.id);
    await call(provider, "end", { taskId: a.taskId });
    await expect(status(provider, a.taskId)).rejects.toThrow("Unknown or expired");
    expect((await status(provider, b.taskId)).revision).toBe(1);
    expect(provider.effectResources()).not.toEqual(other.effectResources());
  });

  it("separates retrieved/traced/verified/blocked and keeps missing contracts unresolved", async () => {
    const { provider } = make(); const { taskId } = await begin(provider);
    const all = await entries(provider, taskId); const target = all[0]!.id;
    await update(provider, taskId, target, { status: "retrieved", evidence: [proof("service.ts", "source")] });
    expect((await status(provider, taskId)).coverage).toMatchObject({ retrieved: 1, verified: 0 });
    await update(provider, taskId, target, { status: "traced" });
    expect((await status(provider, taskId)).coverage.traced).toBe(1);
    const before = (await status(provider, taskId)).revision;
    await expect(call(provider, "update", { taskId, obligationId: target, status: "verified", note: "traced", evidence: [proof()] })).rejects.toThrow("expected contract");
    await expect(update(provider, taskId, target, { evidence: [proof("service.ts", "source")] })).rejects.toThrow("requires static-proof");
    await expect(call(provider, "update", { taskId, obligationId: target, status: "blocked" })).rejects.toThrow("blocker");
    expect((await status(provider, taskId)).revision).toBe(before);
    await update(provider, taskId, target, { status: "blocked", evidence: [], blocker: { reason: "dependency unavailable", nextAction: "inspect dependency receipt contract" } });
    expect((await status(provider, taskId)).entries[0]).toMatchObject({ status: "blocked", blocker: { nextAction: "inspect dependency receipt contract" } });
    const reconciled = await call<ReviewReconcileResult>(provider, "reconcile", { taskId, limit: 50 });
    expect(reconciled.ready).toBe(false); expect(reconciled.unresolvedObligations).toContain(target);
    expect(reconciled.unresolvedCount).toBe(all.length);
  });

  it("requires every scope obligation including partial failure before advisory readiness", async () => {
    const { provider } = make(); const { taskId } = await begin(provider);
    const all = await entries(provider, taskId);
    const failure = all.find(item => item.type === "obligation" && item.failureCheck === "after-effect")!;
    for (const item of all.filter(item => item.id !== failure.id)) await update(provider, taskId, item.id);
    const partial = await call<ReviewReconcileResult>(provider, "reconcile", { taskId });
    expect(partial).toMatchObject({ ready: false, unresolvedCount: 1, unresolvedObligations: [failure.id] });
    await update(provider, taskId, failure.id);
    expect((await status(provider, taskId)).ready).toBe(false); // mutation invalidates last reconciliation
    expect(await call(provider, "reconcile", { taskId })).toMatchObject({ ready: true, advisory: true, semanticValidation: false });
    await call(provider, "end", { taskId }); // advisory never forces a final answer
  });
});

describe("structured finding admission is not a semantic judge", () => {
  it("admits supported static proof without inflating confidence or requiring tool execution", async () => {
    const { provider } = make(); const { taskId } = await begin(provider);
    const result = await call<ReviewMutationResult>(provider, "finding", finding(taskId));
    expect(result).toMatchObject({ status: "confirmed", admissionReasons: [] });
    const stored = (await entries(provider, taskId)).find(item => item.id === result.id) as ReviewFinding;
    expect(stored).toMatchObject({ severity: "high", confidence: "low", status: "confirmed" });
    expect(stored.evidence[0]!.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await status(provider, taskId)).semanticValidation).toBe(false);
  });

  it.each(["caller", "trigger", "expectedContract", "actualAction", "consequence", "title"])("rejects empty %s without storing a finding", async field => {
    const { provider } = make(); const { taskId } = await begin(provider);
    await expect(call(provider, "finding", { ...finding(taskId), [field]: " \n " })).rejects.toThrow("empty");
    expect((await entries(provider, taskId)).filter(item => item.type === "finding")).toHaveLength(0);
  });

  it("does not admit missing proofs, untested counterexamples, conditional claims or assumptions", async () => {
    const { provider } = make(); const { taskId } = await begin(provider); const base = finding(taskId);
    for (const [changes, expected] of [
      [{ evidence: [] }, "candidate"],
      [{ counterexample: { ...base.counterexample, verdict: "not-checked" } }, "candidate"],
      [{ counterexample: { ...base.counterexample, evidence: [] } }, "candidate"],
      [{ counterexample: { ...base.counterexample, method: "test" } }, "candidate"],
      [{ counterexample: { ...base.counterexample, verdict: "conditional" } }, "conditional"],
      [{ unresolvedAssumptions: ["depends on undocumented remote deduplication"] }, "conditional"],
      [{ requestedStatus: "conditional" }, "conditional"],
    ] as const) {
      expect(await call(provider, "finding", { ...base, ...changes })).toMatchObject({ status: expected });
    }
    const result = await call<ReviewReconcileResult>(provider, "reconcile", { taskId, offset: 22, limit: 50 });
    expect(result.findingsNeedingDowngrade).toHaveLength(7);
    expect(result.ready).toBe(false);
  });

  it("records a real negative counterexample: a failed save cannot reach publish", async () => {
    const publish = vi.fn();
    const saveThenPublish = (save: () => void, emit: () => void): void => { save(); emit(); };
    expect(() => saveThenPublish(() => { throw new Error("save failed"); }, publish)).toThrow("save failed");
    expect(publish).not.toHaveBeenCalled();
    const { provider } = make({ sourceSnapshot: () => saveThenPublish.toString() });
    const { taskId } = await begin(provider); const base = finding(taskId);
    const result = await call<ReviewMutationResult>(provider, "finding", {
      ...base, title: "Publish allegedly runs after failed save", caller: "saveThenPublish", trigger: "save throws",
      expectedContract: "publish never runs when save throws", actualAction: "claim: publish still runs", consequence: "claim: phantom downstream event",
      counterexample: { verdict: "disproved", method: "test", description: "Executed save throwing save failed; publish spy received zero calls", evidence: [proof("negative-fixture.ts", "test")] },
    });
    expect(result.status).toBe("disproved");
    expect(result.admissionReasons).toContain("counterexample verdict: disproved");
    expect((await entries(provider, taskId)).find(item => item.id === result.id)).not.toMatchObject({ status: "confirmed" });
  });
});

describe("host-read evidence and explicit stale reconciliation", () => {
  it("computes source/range hashes itself, rejects forgery and invalid ranges atomically", async () => {
    const { provider, files } = make(); const { taskId } = await begin(provider); const target = (await entries(provider, taskId))[0]!.id;
    await update(provider, taskId, target, { evidence: [{ ...proof(), expectedSha256: digest(files["service.ts"]!) }] });
    const item = (await status(provider, taskId)).entries[0] as ReviewObligation;
    expect(item.evidence[0]).toMatchObject({ sha256: digest(files["service.ts"]!), rangeSha256: digest("validate(input);") });
    const revision = (await status(provider, taskId)).revision;
    for (const evidence of [{ ...proof(), expectedSha256: "0".repeat(64) }, { ...proof(), endLine: 4 }, { ...proof(), startLine: 2, endLine: 1 }, { ...proof(), sha256: digest(files["service.ts"]!) }]) {
      await expect(update(provider, taskId, target, { evidence: [evidence] })).rejects.toThrow();
      expect((await status(provider, taskId)).revision).toBe(revision);
    }
  });

  it("status never rereads or claims current freshness; reconciliation downgrades whole-file drift", async () => {
    const { provider, reader, files } = make(); const { taskId } = await begin(provider); const target = (await entries(provider, taskId))[0]!.id;
    await update(provider, taskId, target);
    const f = await call<ReviewMutationResult>(provider, "finding", finding(taskId));
    await call(provider, "reconcile", { taskId });
    const before = await status(provider, taskId); reader.mockClear();
    files["service.ts"] += "// change outside cited line\n";
    expect(await status(provider, taskId)).toEqual(before);
    expect(reader).not.toHaveBeenCalled();
    const result = await call<ReviewReconcileResult>(provider, "reconcile", { taskId, limit: 50 });
    expect(result.unresolvedObligations).toContain(target);
    expect(result.findingsNeedingDowngrade).toContain(f.id);
    const all = await entries(provider, taskId);
    expect(all.find(item => item.id === target)).toMatchObject({ status: "unknown", stale: true });
    expect(all.find(item => item.id === f.id)).toMatchObject({ status: "candidate", needsDowngrade: true });
    await call(provider, "finding", { ...finding(taskId), findingId: f.id });
    expect((await entries(provider, taskId)).find(item => item.id === f.id)).toMatchObject({ status: "confirmed", needsDowngrade: false });
  });

  it("invalidates unreadable evidence without losing unrelated successful coverage", async () => {
    const { provider, reader } = make(); const { taskId } = await begin(provider); const all = await entries(provider, taskId);
    await update(provider, taskId, all[0]!.id);
    await update(provider, taskId, all[1]!.id, { evidence: [proof("caller.ts")] });
    reader.mockImplementation(file => { if (file === "service.ts") throw new Error("unreadable"); return "return service(input);\n"; });
    await call(provider, "reconcile", { taskId });
    expect((await status(provider, taskId)).entries.slice(0, 2)).toMatchObject([{ status: "unknown", stale: true }, { status: "verified", stale: false }]);
  });

  it("uses real LocalPaths reads by default without writing source", async () => {
    const provider = new ReviewProvider({ root }); providers.push(provider);
    const { taskId } = await begin(provider); const target = (await entries(provider, taskId))[0]!.id;
    await update(provider, taskId, target, { evidence: [proof("src/providers/review-contract.ts")] });
    expect((await status(provider, taskId)).entries[0]).toMatchObject({ status: "verified", evidence: [{ path: "src/providers/review-contract.ts" }] });
    await call(provider, "reconcile", { taskId });
    expect((await status(provider, taskId)).coverage.verified).toBe(1);
    for (const file of ["../outside.ts", "/etc/passwd", "a/../service.ts", "./service.ts", "a\\service.ts", "service.ts\0"]) {
      await expect(update(provider, taskId, target, { evidence: [proof(file)] })).rejects.toThrow(/path/);
    }
  });
});

describe("review quotas, deadlines and close", () => {
  it("bounds exact keys, identifiers, inputs and options", async () => {
    const { provider } = make(); const { taskId } = await begin(provider); const target = (await entries(provider, taskId))[0]!.id;
    for (const args of [{ objective: "x", paths: [] }, { objective: "x", paths: ["a", " a "] }, { objective: "x", paths: Array.from({ length: 9 }, (_, i) => `p${i}`) }, { objective: "x", paths: ["a"], scenarios: ["x", "x"] }, { objective: "x", paths: ["a"], code: "throw new Error()" }, { objective: "x".repeat(70_000), paths: ["a"] }]) {
      await expect(call(provider, "begin", args)).rejects.toThrow();
    }
    await expect(call(provider, "begin", { objective: "x", paths: ["flow"], hidden: undefined })).rejects.toThrow();
    await expect(call(provider, "status", { taskId: "../forged" })).rejects.toThrow("ID");
    await expect(call(provider, "status", { taskId, limit: 51 })).rejects.toThrow("Invalid review arguments");
    await expect(call(provider, "status", { taskId, offset: 999 })).rejects.toThrow("offset");
    await expect(call(provider, "update", { taskId, obligationId: target, status: "blocked", blocker: { reason: "x", nextAction: "y", execute: "z" } })).rejects.toThrow("Invalid review arguments");
    await expect(call(provider, "arbitrary", {})).rejects.toThrow("Unknown review action");
    for (const options of [{ maxTasks: 0 }, { maxResultChars: NaN }, { taskTtlMs: 0 }, { sessionTtlMs: Infinity }, { root: "relative" }, { hidden: true }]) {
      expect(() => make(options)).toThrow();
    }
  });

  it("bounds task/finding/session memory and count without partial commits", async () => {
    const { provider } = make({ maxTasks: 1 }); const { taskId } = await begin(provider);
    await expect(begin(provider)).rejects.toThrow("count quota");
    for (let index = 0; index < 32; index++) await call(provider, "finding", { ...finding(taskId), requestedStatus: "candidate", evidence: [], counterexample: { ...finding(taskId).counterexample, evidence: [] } });
    const revision = (await status(provider, taskId)).revision;
    await expect(call(provider, "finding", finding(taskId))).rejects.toThrow("finding quota");
    expect((await status(provider, taskId)).revision).toBe(revision);
    await call(provider, "end", { taskId }); await begin(provider);
    const smallTask = make({ maxTaskChars: 4_096 }).provider;
    await expect(begin(smallTask)).rejects.toThrow("task memory quota");
    const smallSession = make({ maxSessionChars: 4_096 }).provider;
    await expect(begin(smallSession)).rejects.toThrow("session memory quota");
  });

  it("paginates bounded status/reconcile outputs and rejects too-small mutation acknowledgements before commit", async () => {
    const { provider } = make({ maxResultChars: 1_500 }); const { taskId } = await begin(provider, ["one", "two"]);
    const all = await entries(provider, taskId); expect(all).toHaveLength(44);
    const page = await call<ReviewStatusResult>(provider, "status", { taskId, limit: 50 });
    expect(JSON.stringify(page).length).toBeLessThanOrEqual(1_500); expect(page.nextOffset).not.toBeNull();
    let offset: number | null = 0; const ids: string[] = [];
    do {
      const result: ReviewReconcileResult = await call(provider, "reconcile", { taskId, offset, limit: 50 });
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(1_500);
      ids.push(...result.unresolvedObligations); offset = result.nextOffset;
    } while (offset !== null);
    expect(ids).toEqual(all.map(item => item.id));
    const before = (await status(provider, taskId)).revision;
    await expect(call(provider, "end", { taskId }, { ...context, maxResultChars: 1 })).rejects.toThrow("budget");
    expect((await status(provider, taskId)).revision).toBe(before);
    await expect(update(provider, taskId, all[0]!.id, { note: "x".repeat(2_000) })).rejects.toThrow("budget");
    expect((await status(provider, taskId)).revision).toBe(before);
  });

  it("accepts the parent runtime result budget while capping review output", async () => {
    const { provider } = make({ maxResultChars: 2_000_000 });
    const { taskId } = await begin(provider, Array.from({ length: 8 }, (_, index) => `flow-${index}`));
    const page = await call<ReviewStatusResult>(provider, "status", { taskId, limit: 50 }, { ...context, maxResultChars: 2_000_000 });
    expect(JSON.stringify(page).length).toBeLessThanOrEqual(32_000);
    expect(page.nextOffset).not.toBeNull();
    const low = make({ maxResultChars: 1_000 }).provider;
    const started = await call<ReviewBeginResult>(low, "begin", { objective: "x", paths: ["flow"] });
    expect(JSON.stringify(await status(low, started.taskId)).length).toBeLessThanOrEqual(1_000);
  });

  it("enforces fixed task/session TTL and clears lifecycle timers on close", async () => {
    vi.useFakeTimers(); let now = 0;
    const { provider } = make({ now: () => now, taskTtlMs: 100, sessionTtlMs: 200, maxTasks: 1 });
    const { taskId } = await begin(provider);
    now = 99; await status(provider, taskId); // status must not extend TTL
    now = 100; await expect(status(provider, taskId)).rejects.toThrow("expired");
    await vi.advanceTimersByTimeAsync(100);
    const next = await begin(provider); expect(next.taskId).not.toBe(taskId);
    now = 200; await vi.advanceTimersByTimeAsync(100);
    await expect(status(provider, next.taskId)).rejects.toThrow("closed or expired");
    await provider.close(); await provider.close();
    expect(vi.getTimerCount()).toBe(0);
    await expect(provider.list()).rejects.toThrow("closed");
  });

  it.each(["abort", "deadline", "close"] as const)("prevents a post-read %s from committing", async mode => {
    const controller = new AbortController(); let now = 0;
    const deadline = new FabricDeadline(10, 10, () => now);
    const { provider, reader } = make(); const { taskId } = await begin(provider); const target = (await entries(provider, taskId))[0]!.id;
    reader.mockImplementation(() => { if (mode === "abort") controller.abort(new Error("stop")); else if (mode === "deadline") now = 11; else void provider.close(); return "valid\n"; });
    await expect(call(provider, "update", { taskId, obligationId: target, status: "retrieved", evidence: [proof()] }, { ...context, signal: controller.signal, deadline })).rejects.toThrow();
    if (mode !== "close") expect((await status(provider, taskId)).revision).toBe(1);
    else await expect(status(provider, taskId)).rejects.toThrow("closed");
  });

  it("aborted reconciliation leaves prior records unchanged and never swallows cancellation as staleness", async () => {
    const controller = new AbortController(); const { provider, reader } = make(); const { taskId } = await begin(provider); const target = (await entries(provider, taskId))[0]!.id;
    await update(provider, taskId, target); const before = await status(provider, taskId);
    reader.mockImplementation(() => { controller.abort(new Error("stop")); throw new Error("source stopped"); });
    await expect(call(provider, "reconcile", { taskId }, { ...context, signal: controller.signal })).rejects.toThrow("stop");
    expect(await status(provider, taskId)).toEqual(before);
  });

  it("bounds source text, evidence ranges and reconciliation work", async () => {
    const { provider, reader } = make(); const { taskId } = await begin(provider, ["one", "two"]); const all = await entries(provider, taskId);
    for (const text of ["\0", "\ud800", "x".repeat(2 * 1024 * 1024 + 1)]) {
      reader.mockReturnValue(text);
      await expect(update(provider, taskId, all[0]!.id)).rejects.toThrow("bounded valid UTF-8");
    }
    reader.mockReturnValue("x\n".repeat(2_001));
    await expect(update(provider, taskId, all[0]!.id, { evidence: [{ ...proof(), endLine: 2_001 }] })).rejects.toThrow("2000 lines");
    reader.mockReturnValue("x\n");
    for (let index = 0; index < 33; index++) await update(provider, taskId, all[index]!.id, { evidence: [proof(`file${index}.ts`)] });
    const revision = (await status(provider, taskId)).revision;
    await expect(call(provider, "reconcile", { taskId })).rejects.toThrow("snapshot count quota");
    expect((await status(provider, taskId)).revision).toBe(revision);
  });
});

describe("review public registration and typed guest contract", () => {
  it("exposes exact tree schemas and correct risk/effect descriptors through the real registry", async () => {
    const { provider, reader } = make(); const registry = new ActionRegistry(); registry.register(provider);
    expect(registry.providers()).toMatchObject([{ name: "review", available: true }]);
    const actions = await registry.list();
    expect(actions.map(action => action.ref)).toEqual(["review.begin", "review.end", "review.finding", "review.reconcile", "review.status", "review.update"]);
    const samples: Record<string, object> = { begin: { objective: "x", paths: ["flow"] }, end: { taskId: "task_x" }, status: { taskId: "task_x" }, reconcile: { taskId: "task_x" }, update: { taskId: "task_x", obligationId: "obl_x", status: "unknown" }, finding: finding("task_x") };
    for (const action of actions) {
      expect(action.risk).toBe(action.name === "status" ? "read" : "write");
      expect(action.effect?.kind).toBe(action.name === "status" ? "none" : "write");
      expect(validateSchemaValue(action.inputSchema, samples[action.name])).toEqual({ status: "valid" });
      expect(validateSchemaValue(action.inputSchema, { ...samples[action.name], extra: true }).status).toBe("invalid");
      expect(action.descriptorDigest).toBeTruthy();
    }
    const descriptors = await provider.list(); descriptors[0]!.inputSchema.additionalProperties = true;
    expect((await provider.describe("begin"))!.inputSchema.additionalProperties).toBe(false);
    expect(await provider.describe("run")).toBeUndefined();
    const approve = vi.fn(async () => { throw new Error("approval denied"); });
    const ctx = { ...context, audits: [], maxResultChars: 16_000, approve };
    await expect(registry.invoke("review.begin", { objective: "x", paths: ["flow"] }, ctx)).rejects.toThrow("approval denied");
    expect(reader).not.toHaveBeenCalled(); expect(approve).toHaveBeenCalledOnce();
    approve.mockClear();
    await expect(registry.invoke("review.begin", { objective: "x", paths: ["flow"], hidden: "run" }, ctx)).rejects.toThrow();
    expect(approve).not.toHaveBeenCalled();
    const admitted = await registry.invoke("review.begin", { objective: "x", paths: ["flow"] }, { ...ctx, approve: async () => {} }) as ReviewBeginResult;
    const before = await status(provider, admitted.taskId);
    await expect(registry.invoke("review.reconcile", { taskId: admitted.taskId }, ctx)).rejects.toThrow("approval denied");
    expect(await status(provider, admitted.taskId)).toEqual(before);
    await registry.close();
  });

  it("typechecks all six guest methods and rejects extra keys and wrong status values", () => {
    const file = path.join(root, "review-guest-contract-probe.ts");
    const source = `${REVIEW_GUEST_DECLARATIONS}\nasync function probeReview() {
      const task = await review.begin({ objective: "x", paths: ["submit-order"] });
      const page = await review.status({ taskId: task.taskId });
      const evidence: ReviewEvidenceInput = { path: "a.ts", startLine: 1, endLine: 1, kind: "static-proof", rationale: "caller ordering" };
      await review.update({ taskId: task.taskId, obligationId: "obl_x", status: "traced", note: "x", evidence: [evidence] });
      const record: ReviewFindingArguments = ${JSON.stringify(finding("task_x"))};
      const admitted = await review.finding(record);
      const hostRecord: import("./src/providers/review-contract.js").ReviewFindingArguments = record;
      const guestRecord: ReviewFindingArguments = hostRecord;
      const hostPage: import("./src/providers/review-contract.js").ReviewStatusResult = page;
      const guestPage: ReviewStatusResult = hostPage;
      const reconciled = await review.reconcile({ taskId: task.taskId, limit: 20 });
      const ended = await review.end({ taskId: task.taskId });
      // @ts-expect-error exact public input keys
      await review.begin({ objective: "x", paths: ["flow"], execute: "code" });
      // @ts-expect-error coverage is a separate enum
      await review.update({ taskId: task.taskId, obligationId: "x", status: "confirmed" });
      // @ts-expect-error no hidden execution API
      await review.run({ code: "x" });
      return { admitted, guestRecord, guestPage, reconciled, ended };
    }`;
    const options: ts.CompilerOptions = { noEmit: true, strict: true, skipLibCheck: true, types: ["node"], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
    const host = ts.createCompilerHost(options); const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => name === file ? ts.createSourceFile(file, source, languageVersion, true) : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
    const program = ts.createProgram([file], options, host);
    expect(ts.getPreEmitDiagnostics(program).map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n"))).toEqual([]);
  });
});
