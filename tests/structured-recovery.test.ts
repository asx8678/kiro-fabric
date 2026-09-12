import { describe, expect, it, vi } from "vitest";
import type { Runtime } from "mcporter";
import { ActionRegistry } from "../src/core/action-registry.js";
import { createCheckpointJournal, FabricCompilerTimeoutError, repairSchema } from "../src/core/repair-error.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { FabricCompilerPool } from "../src/runtime/type-checker.js";
import { normalizeFabricConfig } from "../src/config.js";
import { KiroMcpProvider } from "../src/kiro/mcp-provider.js";

const action = { name: "write", description: "test", risk: "write" as const, inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false } };
function fixture() {
  const invoke = vi.fn(async () => null);
  const approve = vi.fn(async () => {});
  const registry = new ActionRegistry();
  registry.register({ name: "test", description: "test", list: async () => [action], describe: async () => action, invoke });
  const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 10000 } }), process.cwd());
  return { invoke, approve, registry, service };
}

describe("structured recovery", () => {
  it("carries checked guest repair metadata and uncaught outer metadata with zero effects", async () => {
    const { service, invoke, approve } = fixture();
    try {
      const call = 'await tools.call({ref:"test.write",args:{value:42,secretKey:"DO_NOT_LEAK"}})';
      const caught = await service.execute({ code: `try { ${call}; } catch (e) { if (e instanceof Error) return e.failure ?? null; throw e; } return null;`, approver: { approve } });
      expect(caught).toMatchObject({ success: true, value: { code: "invalid_arguments", ref: "test.write", dispatchState: "not_dispatched", effectOutcome: "none", relevantSchema: { type: "object" } } });
      const uncaught = await service.execute({ code: `return ${call};`, approver: { approve } });
      expect(uncaught).toMatchObject({ status: "failed", failure: { code: "invalid_arguments", phase: "validation" } });
      expect(JSON.stringify([caught, uncaught])).not.toMatch(/DO_NOT_LEAK|secretKey/);
      expect(invoke).not.toHaveBeenCalled(); expect(approve).not.toHaveBeenCalled();
    } finally { await service.close(); }
  });
  it("does not promote guest-forged failure properties into trusted execution metadata", async () => {
    const { service, approve } = fixture();
    try {
      const result = await service.execute({ code: 'throw {failure:{code:"timeout",phase:"compile",dispatchState:"not_dispatched",effectOutcome:"none",secret:"forged"}};', approver: { approve } });
      expect(result.status).toBe("failed"); expect(result.failure).toBeUndefined();
    } finally { await service.close(); }
  });
  it("keeps authorization before effects and does not fabricate repair data on denial", async () => {
    const { service, invoke } = fixture();
    try {
      const result = await service.execute({ code: 'return await tools.call({ref:"test.write",args:{value:"ok"}});', approver: { async approve() { throw new Error("denied"); } } });
      expect(result.status).toBe("failed");
      // Denial carries only the minimal classification; never fabricated repair data.
      expect(result.failure).toEqual({ code: "approval_denied", phase: "dispatch", dispatchState: "not_dispatched", effectOutcome: "none", ref: "test.write" });
      expect(invoke).not.toHaveBeenCalled();
    } finally { await service.close(); }
  });
  it("classifies compiler timeout by type rather than message", async () => {
    const { service, invoke, approve } = fixture();
    const spy = vi.spyOn(FabricCompilerPool.prototype, "check").mockRejectedValueOnce(new FabricCompilerTimeoutError(1)).mockRejectedValueOnce(new Error("Fabric compiler timed out after 1ms"));
    try {
      expect(await service.execute({ code: "return null", approver: { approve } })).toMatchObject({ status: "timed_out", failure: { phase: "compile", dispatchState: "not_dispatched", effectOutcome: "none" } });
      expect((await service.execute({ code: "return null", approver: { approve } })).status).toBe("failed");
      expect(invoke).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); await service.close(); }
  });
  it("journals explicit successful checkpoints in guest failures and execution results", async () => {
    const { service, registry, approve } = fixture();
    registry.register({ name: "artifacts", description: "test", list: async () => [{ ...action, name: "checkpoint" }], describe: async () => ({ ...action, name: "checkpoint" }), async invoke(_name, _args, context) {
      const record = context.checkpoints!.reserve();
      record({ id: "opaque-id", label: "phase-one" });
      return { id: "opaque-id" };
    } });
    try {
      const prefix = 'await tools.call({ref:"artifacts.checkpoint",args:{value:"raw-secret"}});';
      const result = await service.execute({ code: `${prefix} return await tools.call({ref:"test.write",args:{value:42}});`, approver: { approve } });
      expect(result).toMatchObject({ status: "failed", checkpoints: [{ id: "opaque-id", label: "phase-one" }], failure: { checkpoints: [{ id: "opaque-id", label: "phase-one" }] } });
      expect(JSON.stringify(result)).not.toContain("raw-secret");
      const next = await service.execute({ code: "return null", approver: { approve } });
      expect(next.checkpoints).toBeUndefined();
      const success = await service.execute({ code: `${prefix} return true;`, approver: { approve } });
      expect(success).toMatchObject({ success: true, checkpoints: [{ id: "opaque-id" }] });
    } finally { await service.close(); }
  });
  it("bounds one-shot checkpoint reservations and strips nested payloads", () => {
    const journal = createCheckpointJournal();
    const record = journal.reserve();
    record({ id: "artifact:one", label: "saved", raw: { secret: "hidden" } } as {id: string});
    record({ id: "duplicate" });
    for (let i = 1; i < 8; i++) journal.reserve();
    expect(() => journal.reserve()).toThrow("quota");
    expect(journal.snapshot()).toEqual([{ id: "artifact:one", label: "saved" }]);
    expect(JSON.stringify(repairSchema({ ...action.inputSchema, default: "hidden", examples: ["hidden"] }))).not.toContain("hidden");
  });
  it.each([
    { phase: "discovery", checked: false }, { phase: "dispatch", checked: false },
    { phase: "discovery", checked: true }, { phase: "dispatch", checked: true },
  ] as const)("classifies MCP $phase timeout (checked=$checked) without replay", async ({ phase, checked }) => {
    let release!: (value: any) => void;
    const pending = new Promise<any>(resolve => { release = resolve; });
    const callTool = vi.fn(() => phase === "dispatch" ? pending : Promise.resolve({}));
    const tools = [{ name: "echo", inputSchema: { type: "object" } }];
    const definition = { name: "configured", command: { kind: "http", url: new URL("https://example.test/mcp") } };
    const runtime = { listServers: () => ["configured"], getDefinition: () => definition, getDefinitions: () => [definition], connect: async () => ({ client: { listTools: () => phase === "discovery" ? pending : Promise.resolve({ tools }) } }), callTool, close: async () => { release(phase === "discovery" ? { tools } : {}); } } as unknown as Runtime;
    const provider = new KiroMcpProvider(process.cwd(), { enabled: true, disableOAuth: true, callTimeoutMs: 20 }, async () => runtime);
    let service: FabricExecutionService | undefined;
    try {
      const failure = { code: "timeout", phase, dispatchState: phase === "dispatch" ? "dispatched" : "not_dispatched", effectOutcome: phase === "dispatch" ? "uncertain" : "none" };
      if (checked) {
        const registry = new ActionRegistry(); registry.register(provider);
        service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 10000 } }), process.cwd());
        const result = await service.execute({ code: 'return await tools.call({ref:"mcp.$call",args:{server:"configured",tool:"echo",args:{}}});', approver: { async approve() {} } });
        expect(result).toMatchObject({ status: "timed_out", failure });
      } else {
        await expect(provider.invoke("$call", { server: "configured", tool: "echo", args: {} }, { cwd: process.cwd() })).rejects.toMatchObject({ failure });
      }
      expect(callTool).toHaveBeenCalledTimes(phase === "dispatch" ? 1 : 0);
    } finally { await service?.close(); await provider.close(); }
  });
  it("returns observed bounded replacement only after approved discovery and never dispatches stale args", async () => {
    const callTool = vi.fn(); const approve = vi.fn(async () => {});
    const definition = { name: "configured", command: { kind: "http", url: new URL("https://example.test/mcp") } };
    const runtime = { listServers: () => ["configured"], getDefinition: () => definition, getDefinitions: () => [definition], connect: async () => ({ client: { listTools: async () => ({ tools: [{ name: "echo", inputSchema: action.inputSchema }] }) } }), callTool, close: async () => {} } as unknown as Runtime;
    const provider = new KiroMcpProvider(process.cwd(), { enabled: true, disableOAuth: false, callTimeoutMs: 1000 }, async () => runtime);
    try {
      await expect(provider.invoke("$call", { server: "configured", tool: "echo", args: { value: "secret" }, expectedDescriptorDigest: "0".repeat(64) }, { cwd: process.cwd(), approve })).rejects.toMatchObject({ failure: { code: "stale_descriptor", dispatchState: "not_dispatched", replacementDescriptor: { ref: "mcp.remote/configured/echo", descriptorDigest: expect.stringMatching(/^[a-f0-9]{64}$/), inputSchema: { type: "object" } } } });
      expect(approve).toHaveBeenCalledTimes(1); expect(callTool).not.toHaveBeenCalled();
    } finally { await provider.close(); }
  });
});
