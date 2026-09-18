import { describe, expect, it, vi } from "vitest";
import { normalizeFabricConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService, type FabricExecutionApprover } from "../src/execution-service.js";

// Exercise the controller through both production entry points, not an exported test seam.
describe("per-execution approval controller", () => {
  it("shares provider-owned and registry prompt usage, releases failed pending slots, and resets on the next execution", async () => {
    const registry = new ActionRegistry();
    const ownedPrompt = vi.fn(async () => { throw new Error("owned prompt failed"); });
    const registryPrompt = vi.fn(async () => {});
    const invoke = vi.fn(async () => true);
    registry.register({
      name: "fixture", description: "shared approval budget",
      async list() { return []; },
      async describe(name) { return { name, description: name, risk: "read", inputSchema: { type: "object" } }; },
      async invoke(name, _args, context) {
        if (name === "owned") await context.chargeApproval!(ownedPrompt);
        return invoke();
      },
    });
    const approver: FabricExecutionApprover = {
      async approve() { throw new Error("prepared policy must not fall back"); },
      prepareApproval(action) {
        return action.name === "owned" ? { decision: "allow" } : { decision: "ask", prompt: registryPrompt };
      },
    };
    const service = new FabricExecutionService(registry, normalizeFabricConfig({
      executor: { maxApprovalRequests: 2, maxPendingApprovals: 1 },
    }), "/workspace");
    try {
      const result = await service.execute({ approver, code: `
        const outcomes = [];
        for (const name of ['owned', 'registry', 'owned', 'registry']) {
          try { await tools.call({ ref: 'fixture.' + name }); outcomes.push('ok'); }
          catch (error) { outcomes.push(String(error)); }
        }
        return outcomes;
      ` });
      expect(result.success, result.error).toBe(true);
      expect(result.value).toEqual([
        expect.stringContaining("owned prompt failed"), "ok",
        expect.stringContaining("approval request quota exceeded"),
        expect.stringContaining("approval request quota exceeded"),
      ]);
      expect(ownedPrompt).toHaveBeenCalledTimes(1);
      expect(registryPrompt).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(result.audits.map(audit => audit.success)).toEqual([false, true, false, false]);
      const next = await service.execute({ approver, code: "return await tools.call({ ref: 'fixture.registry' });" });
      expect(next.success, next.error).toBe(true);
      expect(registryPrompt).toHaveBeenCalledTimes(2);
    } finally { await service.close(); }
  });
});
