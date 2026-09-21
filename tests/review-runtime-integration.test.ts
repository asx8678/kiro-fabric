import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createKiroRuntime, type KiroRuntime } from "../src/kiro/runtime.js";
import { normalizeFabricConfig } from "../src/config.js";
import type { FabricExecutionApprover } from "../src/execution-service.js";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";

const roots: string[] = [], runtimes: KiroRuntime[] = [];
afterEach(async () => { for (const runtime of runtimes.splice(0)) await runtime.close(); for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
function fixture(maxNestedResultChars = 2_000_000) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-review-runtime-"))); roots.push(base);
  const root = path.join(base, "workspace"), probesRoot = path.join(base, "probes"); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "source.ts"), "export const enabled = false;\n");
  const runtime = createKiroRuntime({ cwd: root, workspaceRoot: root, localLockRoot: path.join(base, "locks"), probesRoot,
    configFile: path.join(base, "config.json"), mcpConfigPath: path.join(base, "mcp.json"), artifactsRoot: path.join(base, "artifacts"),
    config: normalizeFabricConfig({ mcp: { enabled: false }, executor: { timeoutMs: 10000, maxNestedResultChars } }),
  }); runtimes.push(runtime);
  const approve: FabricExecutionApprover = { approve: async () => {}, prepareApproval: () => ({ decision: "allow" }) };
  const run = (code: string, payloads?: Record<string, string>, approver = approve, workspaceBound = true) => runtime.service.execute({ code, ...(payloads ? { payloads } : {}), approver, workspaceBound });
  return { base, root, probesRoot, runtime, run, approve };
}
describe("checked review improvements runtime integration", () => {
  it("supports direct JSON returns for every new API without weakening the guest contract", () => {
    for (const code of [
      'return await local.readEvidence({windows:[{path:"x"}]});',
      'return await review.begin({objective:"audit",paths:["http"]});',
      'return await review.status({taskId:"id"});',
      'return await review.reconcile({taskId:"id"});',
      'return await review.update({taskId:"id",obligationId:"id",status:"unknown"});',
      'return await review.end({taskId:"id"});',
      'return await probe.discover({executables:["dotnet"]});',
      'return await probe.create({kind:"illustrative"});',
      'return await probe.write({id:"id",path:"x",content:"x"});',
      'return await probe.run({id:"id",executable:"node",args:["--version"]});',
    ]) expect(typeCheckFabricCode(code, fabricGuestDeclarations).errors, code).toEqual([]);
    expect(typeCheckFabricCode('return await probe.run({id:"id",script:"true",executable:"node"});', fabricGuestDeclarations).errors.length).toBeGreaterThan(0);
  });
  it("registers discoverable providers and returns bounded evidence through the checked bridge", async () => {
    const f = fixture();
    const descriptors = await f.runtime.registry.list();
    for (const ref of ["local.readEvidence", "review.begin", "review.reconcile", "probe.discover", "probe.create", "probe.run"]) expect(descriptors.some(d => d.ref === ref), ref).toBe(true);
    const result = await f.run('return await local.readEvidence({windows:[{path:"source.ts"}],maxChars:2000});');
    expect(result.success, result.error).toBe(true);
    const packet = result.value as string; expect(packet).toContain("KIRO_LOCAL_EVIDENCE/1");
    const metadata = JSON.parse(packet.slice(packet.lastIndexOf("\nMETA ") + 6));
    expect(metadata.complete).toBe(true); expect(metadata.scope).toContain("not proof of inspection");
    expect(metadata.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("keeps retrieved coverage incomplete across executions and invalidates changed source", async () => {
    const f = fixture();
    const begun = await f.run('return await review.begin({objective:"HTTP behavior",paths:["http"]});');
    expect(begun.success, begun.error).toBe(true); const taskId = (begun.value as { taskId: string }).taskId;
    const update = await f.run('const p=await review.status({taskId:payloads.id}); const entry=p.entries.find(e=>e.type==="obligation"); if(!entry) throw new Error("missing obligation"); return await review.update({taskId:payloads.id,obligationId:entry.id,status:"retrieved",evidence:[{path:"source.ts",startLine:1,endLine:1,kind:"source",rationale:"source available"}]});', { id: taskId });
    expect(update.success, update.error).toBe(true);
    const status = await f.run('return await review.status({taskId:payloads.id});', { id: taskId });
    expect(status.value).toMatchObject({ ready: false, semanticValidation: false, coverage: { retrieved: 1 } });
    fs.writeFileSync(path.join(f.root, "source.ts"), "export const enabled = true;\n");
    const reconciled = await f.run('return await review.reconcile({taskId:payloads.id});', { id: taskId });
    expect(reconciled.success, reconciled.error).toBe(true); expect(reconciled.value).toMatchObject({ ready: false, coverage: { retrieved: 0 } });
    const other = fixture(); expect((await other.run('return await review.status({taskId:payloads.id});', { id: taskId })).success).toBe(false);
  });
  it("denies ledger/probe mutations before effects and gates all workspace-dependent APIs", async () => {
    const f = fixture();
    const deny: FabricExecutionApprover = { approve: async () => { throw new Error("denied"); }, prepareApproval: action => action.risk === "read" ? { decision: "allow" } : { decision: "deny", reason: "denied by test policy" } };
    for (const code of ['return await review.begin({objective:"audit",paths:["http"]});', 'return await probe.create({kind:"illustrative"});']) {
      const denied = await f.run(code, undefined, deny); expect(denied.success).toBe(false); expect(denied.error).toContain("denied");
    }
    expect(fs.existsSync(f.probesRoot)).toBe(false);
    for (const code of ['return await review.begin({objective:"audit",paths:["http"]});', 'return await probe.discover({executables:["node"]});']) {
      const result = await f.run(code, undefined, f.approve, false); expect(result.success).toBe(false); expect(result.error).toContain("workspace binding");
    }
  });
  it("keeps unrelated local reads working at the minimum configured nested budget", async () => {
    const f = fixture(1000);
    const result = await f.run('return await local.read({path:"source.ts"});');
    expect(result.success, result.error).toBe(true); expect(result.value).toMatchObject({ text: "export const enabled = false;\n" });
  });
  it("exposes only trusted probe diagnostics and stops queued effects after failure", async () => {
    const f = fixture(); const created = await f.run('return await probe.create({kind:"illustrative"});');
    expect(created.success, created.error).toBe(true); const id = (created.value as { id: string }).id;
    const failure = await f.run('try { await probe.run({id:payloads.id,script:"printf actual; exit 9"}); } catch (error) { return (error as {result:JsonValue}).result; } return null;', { id });
    expect(failure.success, failure.error).toBe(true); expect(failure.value).toMatchObject({ exitCode: 9, stdout: "actual", productionProof: false });
    expect(failure.lastShellFailure).toBeUndefined(); // Successful guest recovery returns its explicitly chosen evidence.
    const queued = await f.run('try { await probe.run({id:payloads.id,script:"exit 8"}); } catch {} return await local.write({path:"must-not-exist",content:"unsafe continuation"});', { id });
    expect(queued.success).toBe(false); expect(queued.error).toContain("queue stopped");
    expect(queued.lastShellFailure).toMatchObject({ exitCode: 8 });
    expect(fs.existsSync(path.join(f.root, "must-not-exist"))).toBe(false);
  });

  it("retains an actual nonzero probe result and never upgrades its provenance", async () => {
    const f = fixture();
    const created = await f.run('return await probe.create({kind:"illustrative",files:[{path:"run.cjs",content:payloads.source}]});', { source: 'process.stdout.write("executed"); process.exit(7);' });
    expect(created.success, created.error).toBe(true); const handle = created.value as { id: string; cwd: string; manifestPath: string };
    const result = await f.run('return await probe.run({id:payloads.id,executable:payloads.node,args:["run.cjs"],settle:true});', { id: handle.id, node: process.execPath });
    expect(result.success, result.error).toBe(true); expect(result.value).toMatchObject({ ok: false, exitCode: 7, stdout: "executed", kind: "illustrative", productionProof: false });
    expect(fs.existsSync((result.value as { recordPath: string }).recordPath)).toBe(true);
    expect(fs.existsSync(handle.manifestPath)).toBe(true); expect(handle.cwd.startsWith(f.root + path.sep)).toBe(false);
    expect(fs.readdirSync(f.root)).toEqual(["source.ts"]);
  });
});
