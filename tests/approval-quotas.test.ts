import type { Runtime, ServerDefinition } from "mcporter";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeFabricConfig, type FabricConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService, type FabricApprovalPlan } from "../src/execution-service.js";
import { QuickJsRuntime } from "../src/runtime/quickjs-runtime.js";
import { KiroMcpProvider } from "../src/kiro/mcp-provider.js";
import { DISABLED_TRACER, type FabricTracer } from "../src/trace/tracer.js";
import { KiroPowerApprover, KiroPowerFabricApprover, type KiroPowerElicitationAdapter } from "../src/kiro/power/approver.js";
import type { FabricActionDescriptor } from "../src/protocol.js";

const services: FabricExecutionService[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.close())); });

const fixture = (options: {
  executor?: Partial<FabricConfig["executor"]>;
  approvals?: Partial<FabricConfig["approvals"]>;
  request?: KiroPowerElicitationAdapter["request"];
  supported?: () => boolean;
} = {}) => {
  const config = normalizeFabricConfig({
    // Isolate approval/provider quotas from the independent 2,048-byte audit reservations.
    executor: { maxAuditBytes: 200_000, ...options.executor },
    // Interactive quota tests explicitly opt into prompts, independently of product defaults.
    approvals: { read: "allow", write: "ask", execute: "ask", network: "ask", ...options.approvals },
  });
  const registry = new ActionRegistry();
  const actions: FabricActionDescriptor[] = ["read", "write", "execute", "network"].map((risk) => ({
    name: risk, description: risk, risk: risk as FabricActionDescriptor["risk"],
    inputSchema: { type: "object", additionalProperties: true },
  }));
  const invoke = vi.fn(async (_name: string, args: Record<string, unknown>) => args);
  registry.register({
    name: "fixture", description: "approval quota fixture",
    async list() { return actions; },
    async describe(name) { return actions.find((action) => action.name === name); },
    effectResources(_name, args) { return [String(args.key ?? "one")]; },
    invoke,
  });
  const request = vi.fn<KiroPowerElicitationAdapter["request"]>(options.request ?? (async () => ({ action: "accept", approved: true })));
  const approver = new KiroPowerFabricApprover(config.approvals, new KiroPowerApprover({ supported: options.supported ?? (() => true), request }), "/workspace");
  const service = new FabricExecutionService(registry, config, "/workspace");
  services.push(service);
  return { service, approver, request, invoke, registry, config };
};
const registerMcp = (registry: ActionRegistry, config: FabricConfig, kind: "stdio" | "oauth") => {
  const server: ServerDefinition = {
    name: "configured",
    command: kind === "stdio"
      ? { kind: "stdio", command: process.execPath, args: [], cwd: process.cwd() }
      : { kind: "http", url: new URL("https://example.invalid/mcp") },
  };
  const callTool = vi.fn(async () => true);
  const connect = vi.fn(async () => ({
    client: { async listTools() { return { tools: [{ name: "echo", inputSchema: { type: "object" } }] }; } },
    transport: { async close() {} }, definition: server,
  }));
  // All transport contact is in-memory; no process, account, or network access.
  const runtime = {
    listServers: () => [server.name], getDefinitions: () => [server], getDefinition: () => server,
    registerDefinition() {}, connect, callTool, async close() {},
  } as unknown as Runtime;
  registry.register(new KiroMcpProvider(process.cwd(), { ...config.mcp, disableOAuth: kind !== "oauth" }, async () => runtime));
  return { connect, callTool };
};
const mcpCall = `tools.call({ ref: 'mcp.$call', args: { server: 'configured', tool: 'echo', args: { value: 'exact' } } })`;

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
const call = (risk = "read", key = "one") => `tools.call({ ref: 'fixture.${risk}', args: { key: '${key}' } })`;
const sequential = (count: number, risk = "read") => `for (let i = 0; i < ${count}; i++) await ${call(risk)}; return ${count};`;
const concurrent = (count: number, risk = "read") => `return await Promise.all([${Array.from({ length: count }, (_, index) => call(risk, String(index))).join(",")}]);`;

describe("interactive approval quotas", () => {
  it.each(["stdio", "oauth"] as const)("shares total prompt budget with real MCP %s approval stages before contact", async (kind) => {
    const { service, approver, request, registry, config } = fixture({ executor: { maxApprovalRequests: 1, maxPendingApprovals: 1 } });
    const { connect, callTool } = registerMcp(registry, config, kind);
    const prepare = vi.spyOn(approver, "prepareApproval");
    const result = await service.execute({ approver, code: `return await ${mcpCall};` });
    expect(result.error).toContain("approval request quota exceeded");
    expect(prepare.mock.calls.map(([action]) => action.risk)).toEqual(["network", "execute"]);
    expect(prepare.mock.calls[0]?.[1]).toMatchObject({ args: { value: "exact" }, transportSnapshot: { kind: kind === "stdio" ? "stdio" : "http" } });
    expect(prepare.mock.calls[1]?.[1]).toEqual(prepare.mock.calls[0]?.[1].transportSnapshot);
    expect(request).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
    expect(result.audits[0]?.success).toBe(false);
  });

  it.each(["allow", "ask", "deny"] as const)("applies nested MCP %s policy without spending silent-stage prompt slots", async (mode) => {
    const { service, approver, request, registry, config } = fixture({
      executor: { maxApprovalRequests: mode === "allow" ? 0 : 2, maxPendingApprovals: 1 },
      approvals: { network: mode === "ask" ? "ask" : "allow", execute: mode },
    });
    const { connect, callTool } = registerMcp(registry, config, "oauth");
    const result = await service.execute({ approver, code: `return await ${mcpCall};` });
    if (mode === "deny") {
      expect(result.error).toContain("denied by Fabric policy");
      expect(request).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
      expect(callTool).not.toHaveBeenCalled();
    } else {
      expect(result.success, JSON.stringify(result)).toBe(true);
      expect(request).toHaveBeenCalledTimes(mode === "ask" ? 2 : 0);
      expect(callTool).toHaveBeenCalledTimes(1);
    }
  });

  it("shares pending slots across simultaneous nested MCP transport prompts", async () => {
    const gate = deferred();
    const { service, approver, request, registry, config } = fixture({
      executor: { maxApprovalRequests: 2, maxPendingApprovals: 1 }, approvals: { network: "allow" },
      request: async () => { await gate.promise; return { action: "accept", approved: true }; },
    });
    const { callTool } = registerMcp(registry, config, "oauth");
    const execution = service.execute({ approver, code: `
      const results = (await Promise.allSettled([${mcpCall}, ${mcpCall}])).map((result) => result.status);
      await ${mcpCall}; return results;
    ` });
    try {
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      expect(callTool).not.toHaveBeenCalled();
      gate.resolve();
      const result = await execution;
      expect(result.success, JSON.stringify(result)).toBe(true);
      expect(result.value).toEqual(["fulfilled", "rejected"]);
      expect(result.audits[1]?.error).toContain("pending approval quota exceeded");
      expect(request).toHaveBeenCalledTimes(2);
      expect(callTool).toHaveBeenCalledTimes(2);
    } finally { gate.resolve(); await execution; }
  });

  it("plans the registry-prepared exact snapshot once and traces only deferred waits", async () => {
    const { service, approver, request, registry } = fixture({ approvals: { execute: "deny" } });
    const canonical = { nested: { value: "prepared" }, review: 'exact write' };
    const invoke = vi.fn(async (_name: string, args: Record<string, unknown>) => args);
    registry.register({
      name: "canonical", description: "canonical fixture",
      async list() { return []; },
      async describe() { return { name: "write", description: "write", risk: "write", inputSchema: { type: "object" } }; },
      async prepareArguments() { return canonical; }, invoke,
    });
    const prepare = vi.spyOn(approver, "prepareApproval");
    const legacy = vi.spyOn(approver, "approve");
    const spans: Array<{ event: string; data: Record<string, unknown> | undefined; end: ReturnType<typeof vi.fn> }> = [];
    const tracer: FabricTracer = {
      ...DISABLED_TRACER, enabled: true,
      span(_category, event, _id, data) {
        const end = vi.fn(); spans.push({ event, data, end }); return { id: String(spans.length), end };
      },
    };
    const result = await service.execute({ approver, tracer, execId: "approval-quota-test", code: `
      await ${call()};
      try { await ${call("execute")}; } catch {}
      return await tools.call({ ref: 'canonical.write', args: { raw: 'not canonical' } });
    ` });
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.value).toEqual(canonical);
    expect(prepare).toHaveBeenCalledTimes(3);
    expect(prepare.mock.calls[2]?.[1]).toEqual(canonical);
    expect(invoke.mock.calls[0]?.[1]).toEqual(canonical);
    expect(legacy).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    const waits = spans.filter((span) => span.event === "approval.wait");
    expect(waits).toHaveLength(1);
    expect(waits[0]?.data).toEqual({ ref: "canonical.write", risk: "write" });
    expect(waits[0]?.end).toHaveBeenCalledWith({ approved: true });
  });

  it("charges only asks in mixed allow/ask/deny traffic, including after budget exhaustion", async () => {
    const { service, approver, request, invoke } = fixture({
      executor: { maxApprovalRequests: 2 }, approvals: { execute: "deny", network: "allow" },
    });
    const result = await service.execute({ approver, code: `
      const results = [];
      for (const risk of ['read', 'write', 'execute', 'network', 'write', 'write', 'read', 'execute']) {
        try { await tools.call({ ref: 'fixture.' + risk }); results.push('ok'); }
        catch (error) { results.push(String(error)); }
      }
      return results;
    ` });
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.value).toEqual([
      "ok", "ok", expect.stringContaining("denied by Fabric policy"), "ok", "ok",
      expect.stringContaining("approval request quota exceeded"), "ok", expect.stringContaining("denied by Fabric policy"),
    ]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledTimes(5);
    expect(invoke.mock.calls.map(([name]) => name)).not.toContain("execute");
    expect(result.audits.map((audit) => audit.success)).toEqual([true, true, false, true, true, false, true, false]);
  });

  it("reserves pending slots before prompting; silent decisions bypass them and rejected admission spends no total slot", async () => {
    const gate = deferred();
    const { service, approver, request, invoke } = fixture({
      executor: { maxApprovalRequests: 3 }, approvals: { execute: "deny" },
      request: async () => { await gate.promise; return { action: "accept", approved: true }; },
    });
    const execution = service.execute({ approver, code: `
      const results = (await Promise.allSettled([${call("write", "a")}, ${call("write", "b")}, ${call("write", "c")}, ${call()}, ${call("execute")}])).map((result) => result.status);
      await ${call("write", "d")};
      try { await ${call("write", "e")}; } catch (error) { return { results, error: String(error) }; }
      return { results, error: 'missing quota' };
    ` });
    try {
      await vi.waitFor(() => {
        expect(request).toHaveBeenCalledTimes(2);
        expect(invoke).toHaveBeenCalledTimes(1);
      });
      expect(invoke.mock.calls[0]?.[0]).toBe("read");
      gate.resolve();
      const result = await execution;
      expect(result.success, JSON.stringify(result)).toBe(true);
      expect(result.value).toMatchObject({
        results: ["fulfilled", "fulfilled", "rejected", "fulfilled", "rejected"],
        error: expect.stringContaining("approval request quota exceeded"),
      });
      expect(result.audits.find((audit) => audit.error?.includes("pending approval quota exceeded"))).toBeDefined();
      expect(result.audits.find((audit) => audit.error?.includes("denied by Fabric policy"))).toBeDefined();
      expect(request).toHaveBeenCalledTimes(3);
      expect(invoke).toHaveBeenCalledTimes(4);
    } finally { gate.resolve(); await execution; }
  });

  it("allows explicitly allowed effects with zero prompt budget but still denies reads", async () => {
    const { service, approver, request, invoke } = fixture({
      executor: { maxApprovalRequests: 0 }, approvals: { read: "deny", write: "allow" },
    });
    const result = await service.execute({ approver, code: `await ${call("write")}; return await ${call()};` });
    expect(result.error).toContain("denied by Fabric policy");
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(["write"]);
    expect(request).not.toHaveBeenCalled();
  });

  it("still caps 17 read-risk prompts at 16 without inferring allow from risk", async () => {
    const { service, approver, request, invoke } = fixture({ approvals: { read: "ask" } });
    const result = await service.execute({ approver, code: sequential(17) });
    expect(result.error).toContain("approval request quota exceeded");
    expect(request).toHaveBeenCalledTimes(16);
    expect(invoke).toHaveBeenCalledTimes(16);
  });

  it.each(["decline", "cancel", "exception", "missing"] as const)("releases prompt/write reservations after %s, retaining total attempt usage", async (failure) => {
    let supported = failure !== "missing";
    let attempts = 0;
    const { service, approver, request, invoke } = fixture({
      executor: { maxApprovalRequests: 2, maxPendingApprovals: 1 },
      supported: () => { const result = supported; supported = true; return result; },
      request: async () => {
        if (attempts++ === 0 && failure !== "missing") {
          if (failure === "exception") throw new Error("elicitation failed");
          return { action: failure === "decline" ? "decline" : "cancel" };
        }
        return { action: "accept", approved: true };
      },
    });
    const result = await service.execute({ approver, code: `
      const results = [];
      for (let i = 0; i < 3; i++) {
        try { await ${call("write")}; results.push('ok'); }
        catch (error) { results.push(String(error)); }
      }
      return results;
    ` });
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.value).toEqual([
      expect.stringContaining("denied or unavailable"), "ok", expect.stringContaining("approval request quota exceeded"),
    ]);
    expect(request).toHaveBeenCalledTimes(failure === "missing" ? 1 : 2);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.audits.map((audit) => audit.success)).toEqual([false, true, false]);
  });

  it.each(["throw", "cancel", "timeout"] as const)("holds effect reservations through %s cleanup and never invokes a late effect", async (failure) => {
    const controller = new AbortController();
    const entered = deferred();
    const cleanup = deferred();
    const { service, approver, request, invoke, registry } = fixture({
      executor: { maxApprovalRequests: 1, maxPendingApprovals: 1, ...(failure === "timeout" ? { timeoutMs: 1_000, maxTimeoutMs: 1_000 } : {}) },
      request: async ({ signal }) => {
        entered.resolve();
        if (failure === "timeout") await new Promise<void>((resolve) => signal!.addEventListener("abort", () => resolve(), { once: true }));
        await cleanup.promise;
        if (failure === "throw") throw new Error("failed after cleanup");
        return { action: "accept", approved: true };
      },
    });
    const release = vi.fn();
    // A local-named fixture uses the production service's local settlement lease.
    const write: FabricActionDescriptor = { name: "write", description: "lease", risk: "write", inputSchema: { type: "object" } };
    registry.register({
      name: "local", description: "reservation fixture",
      async list() { return [write]; }, async describe() { return write; },
      async reserveInvocation() { return release; }, invoke,
    });
    const execution = service.execute({ approver, signal: controller.signal, code: `return await tools.call({ ref: 'local.write', args: { review: 'exact review' } });` });
    try {
      await entered.promise;
      if (failure === "cancel") controller.abort(new Error("cancelled by test"));
      if (failure === "timeout") await vi.waitFor(() => expect(request.mock.calls[0]?.[0].signal?.aborted).toBe(true), { timeout: 2_000 });
      expect(release).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
      cleanup.resolve();
      const result = await execution;
      expect(result.status).toBe(failure === "cancel" ? "aborted" : failure === "timeout" ? "timed_out" : "failed");
      expect(release).toHaveBeenCalledTimes(1);
      expect(invoke).not.toHaveBeenCalled();
      expect(result.audits[0]?.success).toBe(false);
      // New execution receives fresh quotas and the write reservation was freed.
      request.mockResolvedValue({ action: "accept", approved: true });
      const next = await service.execute({ approver, code: `return await tools.call({ ref: 'local.write', args: { review: 'exact review' } });` });
      expect(next.success, JSON.stringify(next)).toBe(true);
      expect(release).toHaveBeenCalledTimes(2);
      expect(invoke).toHaveBeenCalledTimes(1);
    } finally { cleanup.resolve(); controller.abort(); await execution; }
  });

  it.each([null, undefined, {}, { decision: "maybe" }, { decision: "ask" }, { decision: "ask", prompt: true }, { decision: "deny" }])("rejects malformed host plans %j without falling back or invoking a provider", async (plan) => {
    const { service, invoke } = fixture();
    const approve = vi.fn(async () => {});
    const result = await service.execute({ code: `return await ${call()};`, approver: {
      approve, prepareApproval: () => plan as unknown as FabricApprovalPlan,
    } });
    expect(result.error).toContain("Invalid Fabric approval plan");
    expect(approve).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(result.audits[0]?.success).toBe(false);
  });

  it("releases write intent after preparation throws without charging prompt budget", async () => {
    const { service, invoke } = fixture({ executor: { maxApprovalRequests: 1, maxPendingApprovals: 1 } });
    let preparations = 0;
    const prompt = vi.fn(async () => {});
    const approve = vi.fn(async () => {});
    const result = await service.execute({
      code: `const results = []; for (let i = 0; i < 3; i++) {
        try { await ${call("write")}; results.push('ok'); }
        catch (error) { results.push(String(error)); }
      } return results;`,
      approver: {
        approve,
        prepareApproval() {
          if (++preparations === 1) throw new Error("preparation failed");
          return { decision: "ask", prompt };
        },
      },
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.value).toEqual([expect.stringContaining("preparation failed"), "ok", expect.stringContaining("approval request quota exceeded")]);
    expect(preparations).toBe(3);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(approve).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("preserves total caps for legacy approve-only custom approvers", async () => {
    const { service, invoke } = fixture();
    const approve = vi.fn(async () => {});
    const result = await service.execute({ code: sequential(17), approver: { approve } });
    expect(result.error).toContain("approval request quota exceeded");
    expect(approve).toHaveBeenCalledTimes(16);
    expect(invoke).toHaveBeenCalledTimes(16);
  });

  it("preserves pending caps and exception cleanup for legacy approve-only custom approvers", async () => {
    const { service, invoke } = fixture();
    const gate = deferred();
    const approve = vi.fn(async () => { await gate.promise; throw new Error("legacy denied"); });
    const execution = service.execute({ approver: { approve }, code: `
      await Promise.allSettled([${call()}, ${call()}, ${call()}]);
      try { await ${call()}; } catch (error) { return String(error); }
      return 'unexpected';
    ` });
    try {
      await vi.waitFor(() => expect(approve).toHaveBeenCalledTimes(2));
      gate.resolve();
      const result = await execution;
      expect(result.value).toContain("legacy denied");
      expect(approve).toHaveBeenCalledTimes(3);
      expect(invoke).not.toHaveBeenCalled();
      expect(result.audits.some((audit) => audit.error?.includes("pending approval quota exceeded"))).toBe(true);
    } finally { gate.resolve(); await execution; }
  });

  it.each([17, 64])("permits %i sequential explicitly preallowed reads with the production Kiro approver", async (count) => {
    const { service, approver, request, invoke } = fixture();
    const result = await service.execute({ code: sequential(count), approver });
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.value).toBe(count);
    expect(invoke).toHaveBeenCalledTimes(count);
    expect(request).not.toHaveBeenCalled();
    expect(result.audits).toHaveLength(count);
    expect(result.audits.every((audit) => audit.success)).toBe(true);
  });

  it.each([3, 8])("permits %i concurrent explicitly preallowed reads with the production Kiro approver", async (count) => {
    const { service, approver, request, invoke } = fixture();
    const result = await service.execute({ code: concurrent(count), approver });
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(count);
    expect(request).not.toHaveBeenCalled();
  });

  it("still rejects the 65th provider call", async () => {
    const { service, approver, request, invoke } = fixture();
    const result = await service.execute({ code: sequential(65), approver });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Fabric provider call quota exceeded");
    expect(invoke).toHaveBeenCalledTimes(64);
    expect(request).not.toHaveBeenCalled();
  });

  it("queues a ninth guest call without exceeding eight concurrent providers", async () => {
    const { service, approver, request, invoke } = fixture();
    const gate = deferred();
    invoke.mockImplementation(async (_name, args) => { await gate.promise; return args; });
    const execution = service.execute({ code: concurrent(9), approver });
    try {
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(8));
      gate.resolve();
      const result = await execution;
      expect(result.success, JSON.stringify(result)).toBe(true);
      expect(invoke).toHaveBeenCalledTimes(9);
      expect(request).not.toHaveBeenCalled();
    } finally { gate.resolve(); await execution; }
  });

  it("rejects a ninth host call even if the guest semaphore is bypassed", async () => {
    const original = QuickJsRuntime.prototype.execute;
    vi.spyOn(QuickJsRuntime.prototype, "execute").mockImplementation(function (this: QuickJsRuntime, code, bridge, options) {
      return original.call(this, code, bridge, { ...options, maxConcurrentHostCalls: 9 });
    });
    const { service, approver, request, invoke } = fixture();
    const gate = deferred();
    invoke.mockImplementation(async (_name, args) => { await gate.promise; return args; });
    try {
      const result = await service.execute({ code: concurrent(9), approver });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Fabric concurrent provider call quota exceeded");
      expect(invoke.mock.calls.length).toBeLessThanOrEqual(8);
      expect(request).not.toHaveBeenCalled();
    } finally { gate.resolve(); }
  });
});
