import { describe, expect, it, vi } from "vitest";
import { normalizeFabricConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import type { FabricProvider } from "../src/protocol.js";
import {
  FABRIC_APPROVAL_TIMEOUT_MS,
  FABRIC_COMPILER_TIMEOUT_MS,
  FabricExecutionService,
  effectiveFabricTimeout,
} from "../src/execution-service.js";
import { kiroMcpOuterDeadlineMs } from "../src/kiro/deadlines.js";
import { generateAgentProfile } from "../scripts/agent-profile.mjs";

// Independently specified contractual grace; the production constant is private.
const FABRIC_PROVIDER_TIMEOUT_GRACE_MS = 2_000;

describe("deadline policy", () => {
  it("implements the configured maximum formula", () => {
    expect(effectiveFabricTimeout(900, 100, 400, 250)).toBe(400);
    expect(effectiveFabricTimeout(300, 100, 400, 250)).toBe(300);
    expect(effectiveFabricTimeout(900, 100, 0, 250)).toBe(250);
  });

  it("uses exact direct and tools.call action references rather than broad matching", async () => {
    const registry = new ActionRegistry();
    const call = { name: "$call", description: "fixture call", inputSchema: { type: "object", additionalProperties: true }, risk: "read" as const };
    const extra = { ...call, name: "$call.extra" };
    for (const name of ["mcp", "other"]) registry.register({
      name,
      description: "deadline fixture",
      async list() { return [call, extra]; },
      async describe(actionName) { return actionName === "$call" ? call : actionName === "$call.extra" ? extra : undefined; },
      async invoke() { return "ok"; },
    });
    const config = normalizeFabricConfig({ executor: { timeoutMs: 1_000, maxTimeoutMs: 100_000 }, mcp: { callTimeoutMs: 1_000 } });
    const service = new FabricExecutionService(registry, config, "/workspace");
    const approver = { async approve() {} };
    const floor = 1_000 + FABRIC_APPROVAL_TIMEOUT_MS * 2 + FABRIC_PROVIDER_TIMEOUT_GRACE_MS;
    const measure = async (code: string) => {
      const observed: number[] = [];
      const result = await service.execute({ code, approver, onEffectiveTimeoutChange: value => { observed.push(value); } });
      return { result, observed };
    };
    try {
      // Prime the compiler once; each measured execution retains its own guest budget.
      const ready = await service.execute({ code: "return true;", timeoutMs: 5_000, approver });
      expect(ready.success, JSON.stringify(ready)).toBe(true);

      const direct = await measure("await mcp.call({server:'fixture',tool:'x'}); return true;");
      expect(direct.result.success, JSON.stringify(direct.result)).toBe(true);
      expect(direct.result.effectiveTimeoutMs).toBe(floor);
      expect(direct.observed).toEqual([1_000, floor]);

      const nested = await measure("await tools.call({ref:'mcp.$call',args:{}}); return true;");
      expect(nested.result.success, JSON.stringify(nested.result)).toBe(true);
      expect(nested.result.effectiveTimeoutMs).toBe(floor);
      expect(nested.observed).toEqual([1_000, floor]);

      for (const ref of ["mcp.$call.extra", "other.$call"]) {
        const nearby = await measure(`await tools.call({ref:${JSON.stringify(ref)},args:{}}); return true;`);
        expect(nearby.result.success, JSON.stringify(nearby.result)).toBe(true);
        expect(nearby.result.effectiveTimeoutMs).toBe(1_000);
        expect(nearby.observed).toEqual([1_000]);
      }

      const missing = await measure("return await tools.call({args:{}});");
      expect(missing.result.success).toBe(false);
      expect(missing.result.effectiveTimeoutMs).toBe(1_000);
      expect(missing.observed).toEqual([1_000]);
    } finally { await service.close(); }
  });

  it("reports the largest floor observed through tools.call", async () => {
    const registry = new ActionRegistry();
    const action = {
      name: "$call",
      description: "fixture call",
      inputSchema: { type: "object", additionalProperties: true },
      risk: "read" as const,
    };
    const provider: FabricProvider = {
      name: "mcp",
      description: "deadline fixture",
      async list() { return [action]; },
      async describe(name) { return name === "$call" ? action : undefined; },
      async invoke() { return "ok"; },
    };
    registry.register(provider);
    const config = normalizeFabricConfig({
      executor: { timeoutMs: 1_000, maxTimeoutMs: 100_000 },
      mcp: { callTimeoutMs: 1_000 },
    });
    const service = new FabricExecutionService(registry, config, "/workspace");
    const approver = { async approve() {} };
    try {
      // This tests dynamic action floors, not cold compiler startup. Prime the
      // worker with a separate harness budget; the measured call stays at 1000ms.
      const ready = await service.execute({ code: "return true;", timeoutMs: 5_000, approver });
      expect(ready.success, JSON.stringify(ready)).toBe(true);
      expect(ready.audits).toEqual([]);
      const observedTimeouts: number[] = [];
      const result = await service.execute({
        code: "await tools.call({ ref: 'mcp.$call', args: {} }); await tools.providers(); return true;",
        approver, onEffectiveTimeoutChange: value => { observedTimeouts.push(value); },
      });
      expect(result.success, JSON.stringify(result)).toBe(true);
      const floor = 1_000 + FABRIC_APPROVAL_TIMEOUT_MS * 2 + FABRIC_PROVIDER_TIMEOUT_GRACE_MS;
      expect(result.effectiveTimeoutMs).toBe(floor);
      expect(observedTimeouts).toEqual([1_000, floor]);
    } finally { await service.close(); }
  });

  it("enforces total, concurrent, and approval quotas deterministically", async () => {
    const registry = new ActionRegistry();
    const action = {
      name: "set",
      description: "quota fixture",
      inputSchema: { type: "object", properties: { key: { type: "string" }, value: {} }, required: ["key", "value"], additionalProperties: false },
      risk: "write" as const,
      effect: { kind: "write" as const },
    };
    registry.register({
      name: "state",
      description: "quota fixture",
      async list() { return [action]; },
      async describe(name) { return name === "set" ? action : undefined; },
      effectResources(_name, args) { return [`state:${String(args.key)}`]; },
      async invoke() { return true; },
    });
    const totalConfig = normalizeFabricConfig({ executor: { maxProviderCalls: 2, maxConcurrentProviderCalls: 8 } });
    const total = await new FabricExecutionService(registry, totalConfig, "/workspace").execute({
      code: "return await Promise.all([tools.providers(), tools.providers(), tools.providers()])",
      approver: { async approve() {} },
    });
    expect(total.success).toBe(false);
    expect(total.error).toContain("provider call quota exceeded");

    const approvalConfig = normalizeFabricConfig({ executor: { maxApprovalRequests: 2, maxPendingApprovals: 2 } });
    let prompts = 0;
    const approval = await new FabricExecutionService(registry, approvalConfig, "/workspace").execute({
      code: "return await Promise.all([state.set({ key: 'a', value: 1 }), state.set({ key: 'b', value: 2 }), state.set({ key: 'c', value: 3 })])",
      approver: { async approve() { prompts += 1; } },
    });
    expect(approval.success).toBe(false);
    expect(approval.error).toMatch(/approval request quota exceeded|pending approval quota exceeded/u);
    expect(prompts).toBeLessThanOrEqual(2);
  });

  it.each(["cancel", "timeout"] as const)("never starts a deferred prompt after %s during approval preparation", async (mode) => {
    const registry = new ActionRegistry();
    const invoke = vi.fn(async () => true);
    registry.register({
      name: "local", description: "approval deadline fixture",
      async list() { return []; },
      async describe() { return { name: "read", description: "read", risk: "read", inputSchema: { type: "object" } }; },
      invoke,
    });
    const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 1_000, maxTimeoutMs: 1_000 } }), "/workspace");
    const controller = new AbortController();
    const prompt = vi.fn(async () => {});
    const approve = vi.fn(async () => {});
    try {
      const result = await service.execute({
        code: "return await tools.call({ ref: 'local.read' });", signal: controller.signal,
        approver: {
          approve,
          async prepareApproval(_action, _args, signal) {
            const aborted = new Promise<void>((resolve) => signal!.addEventListener("abort", () => resolve(), { once: true }));
            if (mode === "cancel") controller.abort(new Error("cancelled during preparation"));
            await aborted;
            return { decision: "ask", prompt };
          },
        },
      });
      expect(result.status).toBe(mode === "cancel" ? "aborted" : "timed_out");
      expect(prompt).not.toHaveBeenCalled();
      expect(approve).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
      expect(result.audits[0]?.success).toBe(false);
    } finally { controller.abort(); await service.close(); }
  });

  it("keeps the outer MCP envelope beyond compilation and the maximum guest deadline", () => {
    const guestMaximum = 900_000;
    const outer = kiroMcpOuterDeadlineMs(guestMaximum, FABRIC_COMPILER_TIMEOUT_MS);
    expect(outer).toBe(912_000);
    expect(outer).toBeGreaterThan(guestMaximum + FABRIC_COMPILER_TIMEOUT_MS);
    const profile = generateAgentProfile({
      nodePath: "/runtime/node", runtimeRoot: "/runtime/app", dataRoot: "/runtime/data",
      skillPath: "/runtime/skills/SKILL.md",
    });
    const requestTimeout = profile.mcpServers.fabric.requestTimeout;
    expect(requestTimeout).toBe(917_000);
    expect(requestTimeout).toBeGreaterThan(outer);
  });
});
