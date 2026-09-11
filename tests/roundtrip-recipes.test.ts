import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeFabricConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { LocalCodingProvider } from "../src/providers/local-provider.js";
import { FabricBootstrapProvider } from "../src/kiro/bootstrap-provider.js";
import { BUNDLED_GUIDANCE } from "../src/kiro/generated-guidance.js";

const fixtures: { root: string; service: FabricExecutionService }[] = [];
afterEach(async () => {
  for (const { root, service } of fixtures.splice(0)) {
    await service.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function fixture(helpBudget = 20000) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-roundtrip-")));
  const workspace = path.join(root, "workspace"); fs.mkdirSync(workspace);
  const registry = new ActionRegistry();
  registry.register(new FabricBootstrapProvider(helpBudget));
  registry.register(new LocalCodingProvider({ root: workspace, lockRoot: path.join(root, "locks") }));
  const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 10000 } }), workspace);
  fixtures.push({ root, service });
  return { workspace, service };
}
const approver = { prepareApproval: () => ({ decision: "allow" as const }), async approve() {} };
function recipe(name: string, topic = "review") {
  const guide = fs.readFileSync(new URL("../skills/fabric-exec/references/" + topic + ".md", import.meta.url), "utf8");
  const code = [...guide.matchAll(/```ts\n([\s\S]*?)\n```/g)].map(m => m[1]!).find(c => c.startsWith("// Recipe: " + name + "\n"));
  expect(code).toBeDefined();
  return code!;
}

describe("composed review execution boundaries", () => {
  it("delivers review help and observed source in one execution, skipping only already-known help", async () => {
    const { workspace, service } = fixture();
    fs.writeFileSync(path.join(workspace, "check.mjs"), "export const value = 1;\n");
    const code = recipe("initial review evidence");
    const cold = await service.execute({ code, approver });
    expect(cold.success, cold.error).toBe(true);
    expect(cold.value).toMatchObject({ help: { topic: "review", text: BUNDLED_GUIDANCE.review, truncated: false }, packets: [{ evidence: { files: [{ path: "check.mjs", source: "1: export const value = 1;" }] } }] });
    expect(cold.audits.map(a => a.ref).sort()).toEqual(["fabric.help", "local.find", "local.readMany"]);
    expect(JSON.stringify(cold.value).length).toBeLessThan(40000);
    const warm = await service.execute({ code, approver, payloads: { reviewKnown: "true" } });
    expect(warm.success, warm.error).toBe(true);
    expect(warm.value).toMatchObject({ help: null });
    expect(warm.audits.map(a => a.ref)).toEqual(["local.find", "local.readMany"]);
  });

  it("returns a truncated help continuation rather than a false loaded flag or premature source reads", async () => {
    const { workspace, service } = fixture(1000);
    fs.writeFileSync(path.join(workspace, "check.mjs"), "export const value = 1;\n");
    const result = await service.execute({ code: recipe("initial review evidence"), approver });
    expect(result.success, result.error).toBe(true);
    expect(result.value).toMatchObject({ helpIncomplete: true, help: { topic: "review", truncated: true, nextOffset: expect.any(Number) } });
    expect(result.audits.map(a => a.ref).sort()).toEqual(["fabric.help", "local.find"]);
  });


  it("delivers identical caller evidence in one outer execution instead of two", async () => {
    const { workspace, service } = fixture();
    fs.mkdirSync(path.join(workspace, ".ci"));
    fs.writeFileSync(path.join(workspace, ".ci/check.yml"), "run: dispatch(record)\nretry: dispatch(failed)\n");
    const code = recipe("review callers");
    const split = code.indexOf("const matches =");
    expect(split).toBeGreaterThan(0);
    let outerExecutions = 0;
    const run = (program: string, payloads: Record<string, string>) => {
      outerExecutions++;
      return service.execute({ code: program, payloads, approver });
    };
    const search = await run(code.slice(0, split) + "return hits;", { symbol: "dispatch" });
    expect(search.success, search.error).toBe(true);
    const baseline = await run("const hits = JSON.parse(payloads.hits) as LocalGrepResult;\n" + code.slice(split), { hits: JSON.stringify(search.value) });
    expect(baseline.success, baseline.error).toBe(true);
    expect(outerExecutions).toBe(2);
    outerExecutions = 0;
    const candidate = await run(code, { symbol: "dispatch" });
    expect(candidate.success, candidate.error).toBe(true);
    expect(outerExecutions).toBe(1);
    expect(candidate.value).toEqual(baseline.value);
    expect(candidate.audits.map(a => a.ref)).toEqual([...search.audits, ...baseline.audits].map(a => a.ref));
    expect(candidate.audits.map(a => a.ref)).toEqual(["local.grep", "local.readMany"]);
    // This measures execution composition, not actual model requests, quality or elapsed-time savings.
  });

  it("checks prerequisites once and executes only available probes in the same execution", async () => {
    const { workspace, service } = fixture();
    const missing = "fabric-missing-runtime-82914";
    const result = await service.execute({ code: recipe("review verification batch"), approver, payloads: { checks: JSON.stringify([
      { name: "missing", requires: [missing], script: "touch must-not-run" },
      { name: "present", requires: ["sh", "sh"], script: "printf checked; printf warning >&2" },
    ]) } });
    expect(result.success, result.error).toBe(true);
    expect(result.audits.map(a => a.ref)).toEqual(["local.shell", "local.shell"]);
    expect(result.value).toMatchObject({ complete: true, remaining: [], results: [
      { name: "missing", status: "unavailable", missing: [missing] },
      { name: "present", status: "executed", ok: true, stdout: "checked", stderr: "warning", truncated: false },
    ] });
    expect(fs.readdirSync(workspace)).toEqual([]);
  });

  it("validates every check before any effects, including deferred inputs", async () => {
    const { workspace, service } = fixture();
    const good = { name: "valid", script: "touch must-not-run" };
    const invalid: unknown[] = [null, {}, [good, null], [good, { ...good, args: [42] }],
      [good, { ...good, requires: ["$(touch bad)"] }], [good, { ...good, unknown: true }],
      [good, good, good, { ...good, script: "bad\0script" }], [good, { ...good, timeoutMs: 0 }],
      [good, { ...good, timeoutMs: 20001 }], Array.from({ length: 33 }, () => good)];
    for (const checks of invalid) {
      const result = await service.execute({ code: recipe("review verification batch"), approver, payloads: { checks: JSON.stringify(checks) } });
      expect(result).toMatchObject({ success: false, audits: [] });
      expect(result.error).toContain("valid named literal checks");
    }
    expect(fs.readdirSync(workspace)).toEqual([]);
  });

  it("bounds one execution and returns exact pending identities without replaying completed checks", async () => {
    const { workspace, service } = fixture();
    const checks = Array.from({ length: 4 }, (_, i) => ({ name: "check-" + i, script: i === 3 ? "touch deferred" : "printf checked" }));
    const result = await service.execute({ code: recipe("review verification batch"), approver, payloads: { checks: JSON.stringify(checks) } });
    expect(result.success, result.error).toBe(true);
    expect(result.audits).toHaveLength(3);
    expect(result.value).toMatchObject({ complete: false, remaining: [{ index: 3, name: "check-3" }], results: checks.slice(0, 3).map(c => ({ name: c.name, ok: true })) });
    expect(fs.readdirSync(workspace)).toEqual([]);
    const empty = await service.execute({ code: recipe("review verification batch"), approver, payloads: { checks: "[]" } });
    expect(empty).toMatchObject({ success: true, audits: [], value: { complete: true, remaining: [], results: [] } });
  });

  it("packs more known short probes without a fixed three-check yield", async () => {
    const { service } = fixture();
    const checks = Array.from({ length: 6 }, (_, i) => ({ name: "short-" + i, script: "printf checked", timeoutMs: 1000 }));
    const result = await service.execute({ code: recipe("review verification batch"), approver, payloads: { checks: JSON.stringify(checks) } });
    expect(result.success, result.error).toBe(true);
    expect(result.audits).toHaveLength(6);
    expect(result.value).toMatchObject({ complete: true, remaining: [], results: checks.map(c => ({ name: c.name, ok: true })) });
  });

  it("bounds escaped diagnostic output while preserving success warnings and ordinary failures", async () => {
    const { service } = fixture();
    const checks = [
      { name: "noisy", script: 'i=0; while [ "$i" -lt 5000 ]; do printf "\\001"; printf "\\002" >&2; i=$((i+1)); done' },
      { name: "failure", script: "printf original-error >&2; exit 7" },
    ];
    const result = await service.execute({ code: recipe("review verification batch"), approver, payloads: { checks: JSON.stringify(checks) } });
    expect(result.success, result.error).toBe(true);
    expect(result.value).toMatchObject({ complete: true, remaining: [], results: [
      { name: "noisy", ok: true, truncated: true, stdoutTruncated: true, stderrTruncated: true },
      { name: "failure", ok: false, exitCode: 7, stderr: "original-error", truncated: false },
    ] });
    const rows = (result.value as { results: { stdout: string; stderr: string }[] }).results;
    expect(rows[0]!.stdout.length).toBeGreaterThan(0);
    expect(rows[0]!.stderr.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows[0]!.stdout).length).toBeLessThanOrEqual(1602);
    expect(JSON.stringify(rows[0]!.stderr).length).toBeLessThanOrEqual(1602);
    expect(JSON.stringify(result.value).length).toBeLessThan(5000);
  });

  it("returns machine-readable validator diagnostics and source despite noisy logs in one execution", async () => {
    const { workspace, service } = fixture();
    fs.writeFileSync(path.join(workspace, "source.ts"), "const value = 1;\nuse(value);\n");
    const report = { diagnostics: [{ path: "source.ts", line: 2, message: "original failure", extra: "DO-NOT-COPY" }], truncated: false };
    const result = await service.execute({ code: recipe("validator diagnostics then source", "recipes"), approver, payloads: {
      script: 'printf "%s" "$1"; printf "%40000s" "" >&2; exit 1', args: JSON.stringify([JSON.stringify(report)]),
    } });
    expect(result.success, result.error).toBe(true);
    expect(result.audits.map(a => a.ref)).toEqual(["local.shell", "local.readMany"]);
    expect(result.value).toMatchObject({ check: { ok: false, exitCode: 1, stderrTruncated: true },
      diagnostics: [{ path: "source.ts", line: 2, message: "original failure" }], diagnosticsTruncated: false,
      evidence: { complete: true, files: [{ path: "source.ts", source: "1: const value = 1;\n2: use(value);" }] } });
    expect(JSON.stringify(result.value)).not.toContain("DO-NOT-COPY");
  });

  it("refuses unsafe diagnostic paths before source reads and retains diagnostics on missing source", async () => {
    const { service } = fixture();
    const code = recipe("validator diagnostics then source", "recipes");
    for (const unsafe of ["../outside", "/etc/passwd", "C:\\outside", "source\\other", "bad\0path"]) {
      const report = { diagnostics: [{ path: unsafe, line: 1, message: "error" }], truncated: false };
      const result = await service.execute({ code, approver, payloads: { script: 'printf "%s" "$1"', args: JSON.stringify([JSON.stringify(report)]) } });
      expect(result.success, result.error).toBe(true);
      expect(result.audits.map(a => a.ref)).toEqual(["local.shell"]);
      expect(result.value).toMatchObject({ evidenceUnavailable: "invalid diagnostic schema or unsafe path; no source reads attempted" });
    }
    const result = await service.execute({ code, approver, payloads: { script: 'printf "%s" "$1"; exit 1', args: JSON.stringify([JSON.stringify({ diagnostics: [{ path: "missing.ts", line: 1, message: "retained" }], truncated: false })]) } });
    expect(result.success, result.error).toBe(true);
    expect(result.value).toMatchObject({ check: { exitCode: 1 }, diagnostics: [{ message: "retained" }], readError: expect.any(String), unread: [{ path: "missing.ts" }] });
  });

  it("preserves validator failure through noisy output and literal filenames/arguments", async () => {
    const { workspace, service } = fixture();
    fs.writeFileSync(path.join(workspace, "input file.json"), "{invalid");
    const result = await service.execute({ code: recipe("status-preserving validator", "recipes"), approver, payloads: { check: JSON.stringify({
      name: "json", tool: "node", requiredFiles: ["input file.json"], args: ["-e", 'const fs=require("node:fs"); if(process.argv[2]!=="$(touch injected)") process.exit(99); process.stdout.write("noise".repeat(10000)); try { JSON.parse(fs.readFileSync(process.argv[1],"utf8")); } catch { console.error("invalid JSON"); process.exitCode=7; }', "input file.json", "$(touch injected)"]
    }) } });
    expect(result.success, result.error).toBe(true);
    expect(result.audits.map(a => a.ref)).toEqual(["local.shell", "local.shell"]);
    expect(result.value).toMatchObject({ check: "json", status: "failed", available: true, exitCode: 7, stderr: "invalid JSON\n", truncated: true });
    expect(fs.existsSync(path.join(workspace, "injected"))).toBe(false);
    expect(JSON.stringify(result.value).length).toBeLessThan(2500);
  });

  it("separates blocked tooling/inputs from passed checks and real exit 127 failures", async () => {
    const { service } = fixture();
    for (const [check, expected, calls] of [
      [{ name: "missing-tool", tool: "fabric-missing-validator-92483", args: [] }, { status: "blocked", available: false, exitCode: null }, 1],
      [{ name: "missing-values", tool: "node", args: ["-e", "process.exit(99)"], requiredFiles: ["absent values.json"] }, { status: "blocked", available: true, exitCode: null }, 1],
      [{ name: "real-failure", tool: "node", args: ["-e", "process.exit(127)"] }, { status: "failed", available: true, exitCode: 127 }, 2],
      [{ name: "warning", tool: "node", args: ["-e", 'console.error("warning: limited inputs")'] }, { status: "passed", available: true, exitCode: 0, stderr: "warning: limited inputs\n" }, 2],
    ] as const) {
      const result = await service.execute({ code: recipe("status-preserving validator", "recipes"), approver, payloads: { check: JSON.stringify(check) } });
      expect(result.success, result.error).toBe(true);
      expect(result.value).toMatchObject(expected);
      expect(result.audits).toHaveLength(calls);
    }
  });

  it("rejects malformed validator plans before effects and propagates approval denial", async () => {
    const { service } = fixture();
    const code = recipe("status-preserving validator", "recipes");
    for (const check of [null, { name: "bad", tool: "node;touch bad", args: [] }, { name: "bad", tool: "node", args: [42] }, { name: "bad", tool: "node", args: [], requiredFiles: ["../outside"] }]) {
      const result = await service.execute({ code, approver, payloads: { check: JSON.stringify(check) } });
      expect(result).toMatchObject({ success: false, audits: [] });
    }
    const result = await service.execute({ code, payloads: { check: JSON.stringify({ name: "denied", tool: "node", args: [] }) }, approver: { async approve() { throw new Error("denied validator"); } } });
    expect(result.success).toBe(false);
    expect(result.error).toContain("denied validator");
  });

  it("stops on approval failure instead of running later checks", async () => {
    const { workspace, service } = fixture();
    let approvals = 0;
    const result = await service.execute({ code: recipe("review verification batch"),
      approver: { prepareApproval() { if (++approvals === 2) throw new Error("denied fixture approval"); return { decision: "allow" as const }; }, async approve() {} },
      payloads: { checks: JSON.stringify([
        { name: "first", script: "printf checked" },
        { name: "denied", script: "touch denied" },
        { name: "later", script: "touch later" },
      ]) },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("denied fixture approval");
    expect(approvals).toBe(2);
    expect(fs.readdirSync(workspace)).toEqual([]);
  });
});
