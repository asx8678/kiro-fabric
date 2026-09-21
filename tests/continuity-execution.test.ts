import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeFabricConfig } from "../src/config.js";
import type { FabricExecutionApprover } from "../src/execution-service.js";
import { createKiroRuntime, type KiroRuntime } from "../src/kiro/runtime.js";
import type { ContinuityHandle } from "../src/continuity/store.js";

// P3 acceptance ledger: independent host IDs with tracing off; admission-ordered,
// settled prefixes (including cleanup), never the checkpoint itself or later calls;
// declared/observed provenance separation; command exit status != bridge success;
// no raw command/argument/output/error retention; no implicit persistence;
// deduplicated execution/operation identities and read-before-retry publication;
// bounded recorder failure must reject capture, not change ordinary tool outcomes.
// Extend this suite with races, denial, cancellation, commit acknowledgements,
// quota/fault injection and versioned declaration-only compatibility as P3 lands.
const roots: string[] = [], runtimes: KiroRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true });
});
const allow: FabricExecutionApprover = { approve: async () => {}, prepareApproval: () => ({ decision: "allow" }) };
function fixture(enabled = true) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "continuity-execution-"))); roots.push(root);
  const workspace = path.join(root, "workspace"); fs.mkdirSync(workspace, { mode: 0o700 });
  const continuityRoot = path.join(root, "continuity");
  const runtime = createKiroRuntime({
    cwd: workspace, workspaceRoot: workspace, localLockRoot: path.join(root, "locks"), continuityRoot,
    configFile: path.join(root, "config.json"), mcpConfigPath: path.join(root, "mcp.json"), artifactsRoot: path.join(root, "artifacts"),
    config: normalizeFabricConfig({ mcp: { enabled: false }, tracing: { enabled: false }, continuity: { enabled } }),
  });
  runtimes.push(runtime);
  const run = (code: string, payloads?: Record<string, string>) => runtime.service.execute({ code, ...(payloads ? { payloads } : {}), approver: allow, workspaceBound: true });
  const expand = async (saved: ContinuityHandle): Promise<Record<string, unknown>[]> => {
    const result = await run(`return await continuity.expand({taskId:${JSON.stringify(saved.taskId)},expectedRevision:${saved.revision},hash:${JSON.stringify(saved.hash)},limit:64});`);
    expect(result.success, result.error).toBe(true);
    return (result.value as { records: Record<string, unknown>[] }).records;
  };
  return { root, workspace, continuityRoot, runtime, run, expand };
}

describe("explicit host-observed continuity capture", () => {
  it("captures typed local outcomes with tracing disabled and without persisting sensitive bodies", async () => {
    const f = fixture();
    const result = await f.run(`
      const task = await continuity.create({objective:"Capture selected local work"});
      await local.write({path:"captured.txt",content:payloads.body});
      await local.shell({command:payloads.command,settle:true});
      return await continuity.checkpoint({taskId:task.taskId,expectedRevision:task.revision,requestId:"capture-1",facts:[{kind:"next-step",text:"Investigate the nonzero command"}],captureCurrentExecution:true});
    `, { body: "PRIVATE_FILE_BODY_8735", command: "printf PRIVATE_COMMAND_OUTPUT_5821; exit 7" });
    expect(result.success, result.error).toBe(true);
    const saved = result.value as ContinuityHandle, records = await f.expand(saved);
    const observed = records.filter(record => record.provenance === "host-observed");
    expect(observed.length).toBeGreaterThanOrEqual(2);
    const shell = observed.find(record => JSON.stringify(record).includes('"ref":"local.shell"'));
    expect(shell).toBeDefined();
    expect(JSON.stringify(shell)).toContain('"exitCode":7');
    expect(JSON.stringify(observed)).toContain('"ref":"local.write"');
    const persisted = fs.readFileSync(path.join(f.continuityRoot, "state.json"), "utf8");
    expect(persisted).not.toContain("PRIVATE_FILE_BODY_8735");
    expect(persisted).not.toContain("PRIVATE_COMMAND_OUTPUT_5821");
    expect(persisted).not.toContain("printf ");
    expect(fs.readFileSync(path.join(f.workspace, "captured.txt"), "utf8")).toBe("PRIVATE_FILE_BODY_8735");
    const read = await f.run(`return await continuity.read({taskId:${JSON.stringify(saved.taskId)}});`);
    expect(read.success, read.error).toBe(true);
    expect((read.value as { coverage: { operations: string } }).coverage.operations).not.toBe("not-captured");
    expect((read.value as { summary: string }).summary).toContain("local.shell");
    const again = await f.run(`return await continuity.read({taskId:${JSON.stringify(saved.taskId)}});`);
    expect(again.success, again.error).toBe(true); expect(again.value).toEqual(read.value);
  });

  it("does not duplicate a host operation across successive captures in the same execution", async () => {
    const f = fixture();
    const result = await f.run(`
      const task = await continuity.create({objective:"Repeated capture"});
      await local.write({path:"once.txt",content:"one effect"});
      const first = await continuity.checkpoint({taskId:task.taskId,expectedRevision:task.revision,requestId:"prefix-1",facts:[{kind:"decision",text:"First capture"}],captureCurrentExecution:true});
      return await continuity.checkpoint({taskId:task.taskId,expectedRevision:first.revision,requestId:"prefix-2",facts:[{kind:"next-step",text:"Second capture"}],captureCurrentExecution:true});
    `);
    expect(result.success, result.error).toBe(true);
    const records = await f.expand(result.value as ContinuityHandle);
    const writes = records.filter(record => record.provenance === "host-observed" && JSON.stringify(record).includes('"ref":"local.write"'));
    expect(writes).toHaveLength(1);
  });

  it("does not persist an execution without explicit capture or allocate disabled storage", async () => {
    for (const enabled of [true, false]) {
      const f = fixture(enabled);
      const result = await f.run('return await local.write({path:"ordinary.txt",content:"ordinary effect"});');
      expect(result.success, result.error).toBe(true);
      expect(fs.readFileSync(path.join(f.workspace, "ordinary.txt"), "utf8")).toBe("ordinary effect");
      expect(fs.existsSync(path.join(f.continuityRoot, "state.json"))).toBe(false);
      if (!enabled) expect(fs.existsSync(f.continuityRoot)).toBe(false);
    }
  });
});
