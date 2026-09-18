import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadFabricConfig, normalizeFabricConfig } from "../src/config.js";
import { createKiroRuntime, type KiroRuntime } from "../src/kiro/runtime.js";
import type { FabricExecutionApprover } from "../src/execution-service.js";
import { ContinuityProvider } from "../src/providers/continuity-provider.js";
import { CONTINUITY_ACTION_DESCRIPTORS } from "../src/providers/continuity-contract.js";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";
import { validateSchemaValue } from "../src/schema-validation.js";
import type { ContinuityHandle } from "../src/continuity/store.js";
import type { ContinuityReadResult } from "../src/continuity/render.js";
import type { ContinuityRecord } from "../src/continuity/records.js";

const roots: string[] = [], runtimes: KiroRuntime[] = [];
afterEach(async () => { for (const runtime of runtimes.splice(0)) await runtime.close(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const allow: FabricExecutionApprover = { approve: async () => {}, prepareApproval: () => ({ decision: "allow" }) };
const deny: FabricExecutionApprover = { approve: async () => { throw new Error("denied"); }, prepareApproval: action => action.risk === "read" ? { decision: "allow" } : { decision: "deny", reason: "test denial" } };
function fixture(enabled = true, bound = true, maxOutputChars = 50000) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-continuity-runtime-"))); roots.push(root);
  const configFile = path.join(root, "config.json"), continuityRoot = path.join(root, "continuity");
  const runtime = createKiroRuntime({ cwd: root, ...(bound ? { workspaceRoot: root } : {}), continuityRoot,
    stateRoot: path.join(root, "public-state"), configFile, mcpConfigPath: path.join(root, "mcp.json"), artifactsRoot: path.join(root, "artifacts"),
    config: normalizeFabricConfig({ mcp: { enabled: false }, continuity: { enabled }, executor: { maxOutputChars } }),
  }); runtimes.push(runtime);
  const run = (code: string, approver = allow, workspaceBound = bound) => runtime.service.execute({ code, approver, workspaceBound });
  return { root, configFile, continuityRoot, runtime, run };
}
const defaults = { maxTasks: 32, maxTaskBytes: 131072, maxTotalBytes: 4194304, maxSummaryBytes: 8192 };
describe("continuity provider and checked integration", () => {
  it("registers exactly seven schema-validated actions with correct risks and checked guest types", async () => {
    const f = fixture(), descriptors = (await f.runtime.registry.list()).filter(action => action.provider === "continuity");
    expect(descriptors.map(action => action.name).sort()).toEqual(["checkpoint", "create", "delete", "expand", "list", "read", "recall"]);
    for (const action of descriptors) expect(action.risk).toBe(["create", "checkpoint", "delete"].includes(action.name) ? "write" : "read");
    for (const action of CONTINUITY_ACTION_DESCRIPTORS) expect(validateSchemaValue(action.inputSchema, {}).status).not.toBe("unavailable");
    for (const code of [
      'return await continuity.create({objective:"goal"});',
      'return await continuity.checkpoint({taskId:"id",expectedRevision:1,requestId:"r",facts:[{kind:"decision",text:"choice"}]});',
      'return await continuity.checkpoint({taskId:"id",expectedRevision:1,requestId:"r",captureCurrentExecution:true});',
      'return await continuity.read({taskId:"id"});', 'return await continuity.list();',
      'return await continuity.read({taskId:"id",view:"task"});',
      'return await continuity.recall({taskId:"id",query:"failed"});',
      'return await continuity.checkpoint({taskId:"id",expectedRevision:1,requestId:"r",checks:[{id:"test",text:"regression",status:"open"}]});',
      'return await continuity.expand({taskId:"id",expectedRevision:1,hash:"hash"});',
      'return await continuity.delete({taskId:"id",expectedRevision:1});',
    ]) expect(typeCheckFabricCode(code, fabricGuestDeclarations).errors, code).toEqual([]);
    expect(typeCheckFabricCode('return await continuity.checkpoint({taskId:"id",facts:[]});', fabricGuestDeclarations).errors.length).toBeGreaterThan(0);
  });
  it("uses direct and dynamic guest calls for the full explicit lifecycle", async () => {
    const f = fixture();
    const created = await f.run('return await continuity.create({objective:"Goal",constraints:["No native compaction override"]});');
    expect(created.success, created.error).toBe(true); const task = created.value as ContinuityHandle;
    const checkpoint = await f.run(`return await continuity.checkpoint({taskId:${JSON.stringify(task.taskId)},expectedRevision:${task.revision},requestId:"p1",facts:[{kind:"open-check",text:"Tests still needed"}]});`);
    expect(checkpoint.success, checkpoint.error).toBe(true);
    const saved = checkpoint.value as ContinuityHandle;
    const read = await f.run(`return await tools.call({ref:"continuity.read",args:{taskId:${JSON.stringify(task.taskId)}}});`);
    expect(read.success, read.error).toBe(true); const summary = read.value as ContinuityReadResult;
    expect(summary.coverage).toMatchObject({ admittedRecords: 3, operations: "not-captured" });
    const expanded = await f.run(`return await continuity.expand({taskId:${JSON.stringify(task.taskId)},expectedRevision:${saved.revision},hash:${JSON.stringify(saved.hash)}});`);
    expect(expanded.success, expanded.error).toBe(true);
    expect((expanded.value as { records: ContinuityRecord[] }).records.map(record => record.text)).toEqual(["Goal", "No native compaction override", "Tests still needed"]);
    const listed = await f.run('return await continuity.list();'); expect(listed.success, listed.error).toBe(true);
    expect(listed.value).toMatchObject({ total: 1, nextOffset: null });
    // Public arbitrary state is a separate store and cannot overwrite the provider-owned task.
    await f.run(`return await state.set({key:${JSON.stringify(task.taskId)},value:{summary:"POISON",provenance:"host-observed"}});`);
    const again = await f.run(`return await continuity.read({taskId:${JSON.stringify(task.taskId)}});`);
    expect(again.value).toEqual(summary);
    const deleted = await f.run(`return await continuity.delete({taskId:${JSON.stringify(task.taskId)},expectedRevision:${saved.revision}});`);
    expect(deleted.success, deleted.error).toBe(true); expect(deleted.value).toEqual({ taskId: task.taskId, deleted: true });
  });
  it("does not initialize disabled/unbound storage and honors execution binding and write denial", async () => {
    for (const [enabled, bound] of [[false, true], [true, false]]) {
      const f = fixture(enabled, bound);
      expect(f.runtime.providers().find(provider => provider.name === "continuity")?.available).toBe(false);
      expect(fs.existsSync(f.continuityRoot)).toBe(false);
      expect((await f.run('return await continuity.create({objective:"no"});')).success).toBe(false);
      expect(fs.existsSync(f.continuityRoot)).toBe(false);
    }
    const f = fixture();
    const denied = await f.run('return await continuity.create({objective:"denied"});', deny);
    expect(denied.success).toBe(false); expect(denied.error).toContain("test denial");
    const unbound = await f.run('return await continuity.create({objective:"unbound"});', allow, false);
    expect(unbound.error).toContain("workspace binding");
    expect(fs.existsSync(path.join(f.continuityRoot, "state.json"))).toBe(false);
  });
  it("rejects unsupported capture, forged provenance and extra keys through the dynamic bridge", async () => {
    const f = fixture();
    for (const args of [
      { objective: "goal", verified: true }, { objective: "goal", captureCurrentExecution: true },
    ]) expect((await f.run(`return await tools.call({ref:"continuity.create",args:${JSON.stringify(args)}});`)).success).toBe(false);
    const create = await f.run('return await continuity.create({objective:"goal"});');
    expect(create.success, create.error).toBe(true); const task = create.value as ContinuityHandle;
    const args = { taskId: task.taskId, expectedRevision: task.revision, requestId: "forged", facts: [{ kind: "decision", text: "passed", provenance: "host-observed" }] };
    const forged = await f.run(`return await tools.call({ref:"continuity.checkpoint",args:${JSON.stringify(args)}});`);
    expect(forged.success).toBe(false);
    expect(forged.audits.some(audit => audit.ref === "continuity.checkpoint" && audit.success === true)).toBe(false);
  });
  it("pages escaped exact records and metadata within a small envelope with stale-pointer checks", async () => {
    const f = fixture(), provider = new ContinuityProvider(f.continuityRoot, { ...defaults, maxResultBytes: 1000 });
    const context = { cwd: f.root };
    const created = await provider.invoke("create", { objective: "Goal", constraints: Array.from({ length: 12 }, (_, index) => `item ${index}: ${'"\\\n'.repeat(15)}`) }, context) as ContinuityHandle;
    let fromSequence = 1; const all: ContinuityRecord[] = [];
    for (;;) {
      const page = await provider.invoke("expand", { taskId: created.taskId, expectedRevision: created.revision, hash: created.hash, fromSequence, limit: 64 }, context) as { records: ContinuityRecord[]; nextSequence: number | null };
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(1000); all.push(...page.records);
      if (page.nextSequence === null) break; expect(page.nextSequence).toBeGreaterThan(fromSequence); fromSequence = page.nextSequence;
    }
    expect(all.map(record => record.sequence)).toEqual(Array.from({ length: 13 }, (_, index) => index + 1));
    for (let index = 0; index < 12; index++) await provider.invoke("create", { objective: `Task ${index}` }, context);
    let offset = 0; const ids: string[] = []; let indexRevision = 0;
    for (;;) {
      const page = await provider.invoke("list", { offset, limit: 32, ...(offset ? { expectedIndexRevision: indexRevision } : {}) }, context) as { indexRevision: number; tasks: { taskId: string }[]; nextOffset: number | null };
      indexRevision = page.indexRevision; expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(1000); ids.push(...page.tasks.map(task => task.taskId));
      if (page.nextOffset === null) break; offset = page.nextOffset;
    }
    expect(new Set(ids).size).toBe(13);
    await provider.invoke("create", { objective: "New" }, context);
    await expect(provider.invoke("list", { offset: 0, expectedIndexRevision: indexRevision }, context)).rejects.toThrow("index changed");
    await expect(provider.invoke("read", { taskId: created.taskId, maxSummaryBytes: 1 }, context)).rejects.toThrow("budget too small");
  });
  it("loads opt-in configuration strictly without rewriting or enabling legacy configs", () => {
    const f = fixture(false);
    fs.writeFileSync(f.configFile, JSON.stringify({ continuity: { enabled: true, maxTasks: 4 } }), { mode: 0o600 });
    expect(loadFabricConfig(f.configFile).continuity).toMatchObject({ enabled: true, maxTasks: 4, maxSummaryBytes: 8192 });
    for (const continuity of [{ enabled: "yes" }, { maxTaskBytes: 1 }, { unknown: true }]) {
      fs.writeFileSync(f.configFile, JSON.stringify({ continuity })); expect(() => loadFabricConfig(f.configFile)).toThrow();
    }
    fs.writeFileSync(f.configFile, "{}"); expect(loadFabricConfig(f.configFile).continuity.enabled).toBe(false);
  });
});
