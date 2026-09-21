import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { normalizeFabricConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { LocalCodingProvider } from "../src/providers/local-provider.js";
import type { LocalGrepResult, LocalReadManyResult, LocalReadResult } from "../src/providers/local-contract.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";
import { schemaValidationMessage } from "../src/schema-validation.js";

type SearchReadResult = LocalGrepResult & LocalReadManyResult;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const done of cleanup.splice(0)) await done(); });
function fixture(budget = 20000) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "search-read-")));
  const root = path.join(base, "workspace"); fs.mkdirSync(root);
  const provider = new LocalCodingProvider({ root, lockRoot: path.join(base, "locks"), maxResultChars: budget });
  const registry = new ActionRegistry(); registry.register(provider);
  const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 10000 } }), root);
  cleanup.push(async () => { await service.close(); removeFixtureSync(base, { recursive: true, force: true }); });
  const approver = { prepareApproval(action: { risk: string }) { expect(action.risk).toBe("read"); return { decision: "allow" as const }; }, async approve() { throw new Error("Unexpected interactive approval"); } };
  return {
    root, provider, service,
    put: (file: string, text: string) => fs.writeFileSync(path.join(root, file), text),
    run: (code: string) => service.execute({ code, approver }),
    call: async (name: string, args: Record<string, unknown>) => {
      const result = await registry.invoke(`local.${name}`, args, { cwd: root, audits: [], maxResultChars: budget, approve: async () => {} });
      expect(schemaValidationMessage((await provider.describe(name))!.outputSchema!, result as Record<string, unknown>)).toBeUndefined();
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(budget);
      return result;
    },
  };
}

it("merges duplicate-path, overlapping and adjacent windows in deterministic order", async () => {
  const f = fixture();
  f.put("a", Array.from({ length: 20 }, (_, i) => [9, 11, 16].includes(i) ? "needle" : "plain").join("\n"));
  f.put("b", "needle\nplain\n"); f.put("c", "x\nneedle\n");
  const result = await f.run('return await local.searchRead({pattern:"needle",contextLines:2,maxWindows:2});');
  expect(result.success, result.error).toBe(true);
  const value = result.value as SearchReadResult;
  expect(value.matches).toHaveLength(5);
  expect(value.files.map(file => [file.path, file.startLine, file.endLine])).toEqual([["a", 8, 19], ["b", 1, 2]]);
  expect(value).toMatchObject({ complete: false, scopeExhausted: true, truncated: false, remaining: [{ path: "c", offset: 1, limit: 4 }] });
  expect(result.audits.map(audit => audit.ref)).toEqual(["local.grep", "local.readMany"]);
});

it("does no read for zero matches and preserves search clipping independently from read completion", async () => {
  const f = fixture(); f.put("a", "needle\nneedle\n");
  const empty = await f.run('return await local.searchRead({pattern:"absent"});');
  expect(empty.success, empty.error).toBe(true);
  expect(empty.value).toMatchObject({ files: [], remaining: [], unreadTails: [], complete: true, scopeExhausted: true });
  expect(empty.audits.map(audit => audit.ref)).toEqual(["local.grep"]);
  const clipped = await f.run('return await local.searchRead({pattern:"needle",limit:1,contextLines:0});');
  expect(clipped.success, clipped.error).toBe(true);
  expect(clipped.value).toMatchObject({ complete: true, scopeExhausted: false, truncated: true, truncationReasons: ["count"], files: [{ startLine: 1, endLine: 1 }] });
});

it("never drops a backlog over 32 windows and supports explicit chunked continuation", async () => {
  const f = fixture(40000);
  const names = Array.from({ length: 45 }, (_, i) => `f${String(i).padStart(2, "0")}`);
  for (const name of names) f.put(name, "needle\n");
  const result = await f.run('return await local.searchRead({pattern:"needle",maxWindows:1,contextLines:0});');
  expect(result.success, result.error).toBe(true);
  const value = result.value as SearchReadResult;
  expect(value.remaining).toHaveLength(44);
  const files = [...value.files];
  let pending = value.remaining;
  while (pending.length) {
    const page = await f.call("readMany", { windows: pending.slice(0, 32), maxChars: 40000 }) as LocalReadManyResult;
    files.push(...page.files); pending = [...page.remaining, ...pending.slice(32)];
  }
  expect(files.map(file => file.path)).toEqual(names);
});

it("splits long merged windows and pins deferred ranges to the observed read hash", async () => {
  const f = fixture(40000);
  f.put("a", Array.from({ length: 2500 }, (_, i) => i % 50 === 0 ? "needle" : "x").join("\n"));
  const result = await f.run('return await local.searchRead({pattern:"needle",contextLines:50,maxWindows:1,maxChars:40000});');
  expect(result.success, result.error).toBe(true);
  const value = result.value as SearchReadResult;
  expect(value.files).toHaveLength(1);
  expect(value.files[0]).toMatchObject({ startLine: 1, endLine: 2000 });
  expect(value.remaining).toEqual([{ path: "a", offset: 2001, limit: 501, expectedSha256: value.files[0]!.sha256 }]);
  expect(await f.call("readMany", { windows: value.remaining })).toMatchObject({ complete: true, files: [{ startLine: 2001, endLine: 2500 }] });
  f.put("a", "changed\n");
  await expect(f.call("readMany", { windows: value.remaining })).rejects.toThrow(/source changed/);
});

it("retains budget-limited read continuations before deferred windows", async () => {
  const f = fixture(); f.put("a", "needle and context ".repeat(8).concat("\n").repeat(30)); f.put("b", "needle\n");
  const result = await f.run('return await local.searchRead({pattern:"needle",contextLines:0,maxWindows:1,maxChars:1000});');
  expect(result.success, result.error).toBe(true);
  const value = result.value as SearchReadResult;
  expect(value.complete).toBe(false);
  expect(value.remaining).toEqual([
    { path: "a", offset: value.files[0]!.endLine! + 1, limit: 30 - value.files[0]!.endLine!, expectedSha256: value.files[0]!.sha256 },
    { path: "b", offset: 1, limit: 1 },
  ]);
});

it("forwards grep scope/options without expanding hidden or glob scope", async () => {
  const f = fixture(); fs.mkdirSync(path.join(f.root, "src"));
  f.put("src/.a.txt", "NEEDLE.[x]\n"); f.put("src/b.ts", "needle.[x]\n"); f.put("outside.txt", "needle.[x]\n");
  const result = await f.run('return await local.searchRead({pattern:"needle.[x]",path:"src",glob:"*.txt",literal:true,ignoreCase:true,hidden:true,contextLines:0});');
  expect(result.success, result.error).toBe(true);
  expect(result.value).toMatchObject({ scope: { path: "src", glob: "*.txt", hidden: true }, files: [{ path: "src/.a.txt", source: "1: NEEDLE.[x]" }] });
  expect((result.value as SearchReadResult).files).toHaveLength(1);
});

it("validates helper controls before host work and rejects unsupported pagination", async () => {
  const f = fixture();
  for (const args of ['null', '[]', '{pattern:"x",contextLines:-1}', '{pattern:"x",contextLines:51}', '{pattern:"x",maxWindows:33}', '{pattern:"x",maxWindows:0}', '{pattern:"x",maxWindows:1.5}', '{pattern:"x",maxChars:999}', '{pattern:"x",paginate:true}']) {
    const result = await f.run(`return await (local.searchRead as any)(${args});`);
    expect(result.success, args).toBe(false); expect(result.audits, args).toEqual([]);
    expect(result.error).toMatch(/local.searchRead/);
  }
  expect(typeCheckFabricCode('return await local.searchRead({pattern:"x"});', fabricGuestDeclarations).errors).toEqual([]);
  expect(typeCheckFabricCode('return await local.searchRead({pattern:1});', fabricGuestDeclarations).errors.length).toBeGreaterThan(0);
  expect(typeCheckFabricCode('return await local.searchRead({pattern:"x",paginate:true});', fabricGuestDeclarations).errors.length).toBeGreaterThan(0);
  expect((await f.provider.list()).some(action => action.name === "searchRead")).toBe(false);
});

it("preserves invocation arguments across the dependent await", async () => {
  const f = fixture(); f.put("a", "needle\nplain\n");
  const result = await f.run('const args = {pattern:"needle",contextLines:0,maxWindows:1}; const work = local.searchRead(args); args.contextLines = 50; return await work;');
  expect(result.success, result.error).toBe(true);
  expect(result.value).toMatchObject({ files: [{ startLine: 1, endLine: 1 }] });
});

it("does not bypass a denied search or issue a dependent read", async () => {
  const f = fixture(); f.put("a", "needle\n");
  const result = await f.service.execute({ code: 'return await local.searchRead({pattern:"needle"});', approver: { async approve() { throw new Error("denied search"); } } });
  expect(result.success).toBe(false);
  expect(result.audits.some(audit => audit.ref === "local.readMany")).toBe(false);
});

it("reports requested-range delivery independently of file exhaustion, including EOF", async () => {
  const f = fixture(); f.put("a", "one\ntwo\nthree\n"); f.put("empty", "");
  expect(await f.call("read", { path: "a", limit: 1 })).toMatchObject({ requestedRangeDelivered: true, fileExhausted: false, truncated: true, nextOffset: 2 });
  for (const args of [{ path: "a", offset: 2 }, { path: "a", offset: 50 }, { path: "empty" }]) {
    expect(await f.call("read", args)).toMatchObject({ requestedRangeDelivered: true, fileExhausted: true, truncated: false });
  }
  const small = fixture(450); small.put("a", "x".repeat(100).concat("\n").repeat(20));
  const result = await small.call("read", { path: "a", limit: 20 }) as LocalReadResult;
  expect(result).toMatchObject({ requestedRangeDelivered: false, fileExhausted: false, truncated: true });
  expect(result.nextOffset).toBeGreaterThan(1);
});

it("reports search scope completion on ordinary and paginated results without masking clipped text", async () => {
  const f = fixture(); f.put("a", "needle\n"); f.put("b", "needle\n");
  for (const name of ["grep", "find"]) {
    const pattern = name === "grep" ? "needle" : "*";
    expect(await f.call(name, { pattern })).toMatchObject({ truncated: false, scopeExhausted: true });
    expect(await f.call(name, { pattern, limit: 1 })).toMatchObject({ truncated: true, scopeExhausted: false });
    const first = await f.call(name, { pattern, limit: 1, paginate: true }) as LocalGrepResult;
    expect(first.scopeExhausted).toBe(false);
    expect(await f.call(name, { pattern, limit: 1, paginate: true, cursor: first.nextCursor })).toMatchObject({ truncated: false, scopeExhausted: true });
    expect(await f.call(name, { pattern: "absent" })).toMatchObject({ truncated: false, scopeExhausted: true });
  }
  f.put("a", "needle".repeat(100));
  const clipped = await f.call("grep", { pattern: "needle", paginate: true }) as LocalGrepResult;
  expect(clipped).toMatchObject({ truncated: true, scopeExhausted: false, truncationReasons: ["match-text"] });
  expect(clipped.nextCursor).toBeUndefined();
  f.put("big", "x".repeat(2 * 1024 * 1024 + 1));
  expect(await f.call("grep", { pattern: "absent" })).toMatchObject({ scopeExhausted: false, truncationReasons: ["oversized-files"] });
});
