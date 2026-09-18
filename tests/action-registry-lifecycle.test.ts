import { describe, expect, it, vi } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import type { FabricProvider } from "../src/protocol.js";

const action = { name: "read", description: "read", risk: "read" as const, inputSchema: { type: "object" } };
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const setup = () => {
  const registry = new ActionRegistry();
  const provider = { name: "test", description: "test", list: vi.fn(async () => [action]), describe: vi.fn(async () => action), invoke: vi.fn(async () => true), prepareArguments: vi.fn(async (_name: string, args: Record<string, unknown>) => args), close: vi.fn(async () => {}) } satisfies FabricProvider;
  registry.register(provider);
  return { registry, provider };
};
const context = () => ({ cwd: "/workspace", audits: [], maxResultChars: 1_000, approve: vi.fn(async () => {}) });

// Observe settlement without awaiting a promise the old closed raw queue leaves
// pending forever; all expected settlement here is microtask-only.
const observe = (promise: Promise<unknown>) => {
  const result: { status: string; error?: unknown } = { status: "pending" };
  void promise.then(() => { result.status = "resolved"; }, error => { result.status = "rejected"; result.error = error; });
  return result;
};
const closed = (result: ReturnType<typeof observe>) => {
  expect(result.status).toBe("rejected");
  expect(result.error).toBeInstanceOf(Error);
  expect((result.error as Error).message).toBe("Fabric registry is closed");
};

describe("registry terminal admission", () => {
  it.each(["describe", "invoke", "list", "search", "searchAll"] as const)("rejects %s immediately during and after close without admission", async method => {
    const { registry, provider } = setup();
    const closing = gate();
    provider.close.mockImplementation(() => closing.promise);
    const shutdown = registry.close();
    const call = () => method === "describe" ? registry.describe("test.read") : method === "invoke" ? registry.invoke("test.read", {}, context()) : method === "list" ? registry.list() : registry[method]("");
    const before = registry.discoveryUsage();
    const during = observe(call());
    await flush();
    closed(during);
    expect(registry.discoveryUsage()).toEqual(before);
    expect(provider.describe).not.toHaveBeenCalled();
    expect(provider.list).not.toHaveBeenCalled();
    expect(provider.prepareArguments).not.toHaveBeenCalled();
    expect(provider.invoke).not.toHaveBeenCalled();
    closing.resolve(); await shutdown;
    const after = observe(call()); await flush(); closed(after);
  });

  it("rejects queued exact descriptions on close", async () => {
    const { registry, provider } = setup();
    const waiting = gate();
    provider.describe.mockImplementation(async () => { await waiting.promise; return action; });
    const first = observe(registry.describe("test.one"));
    const second = observe(registry.describe("test.two"));
    const queued = observe(registry.describe("test.three"));
    expect(registry.discoveryUsage().rawQueued).toBe(1);
    await registry.close(); await flush(); closed(queued);
    waiting.resolve(); await flush(); closed(first); closed(second);
    expect(provider.describe).toHaveBeenCalledTimes(2);
    expect(registry.discoveryUsage()).toMatchObject({ rawQueued: 0, rawActive: 0, bytes: 0, nodes: 0, descriptions: 0 });
  });

  it("cannot enqueue a revision retry after close", async () => {
    const { registry, provider } = setup();
    const waiting = gate();
    let revision = "a";
    Object.assign(provider, { discoveryRevision: () => revision });
    provider.list.mockImplementation(async () => { await waiting.promise; return [action]; });
    const result = observe(registry.list());
    await registry.close(); revision = "b"; waiting.resolve();
    await flush(); closed(result);
    expect(provider.list).toHaveBeenCalledTimes(1);
    expect(registry.discoveryUsage()).toMatchObject({ rawQueued: 0, rawActive: 0, bytes: 0, nodes: 0, inflight: 0 });
  });

  it.each(["preparation", "reservation", "approval"])("does not advance provider dispatch after close during %s", async phase => {
    const { registry, provider } = setup();
    const waiting = gate();
    const ready = gate();
    const block = async () => { ready.resolve(); await waiting.promise; };
    const release = vi.fn();
    const reserve = vi.fn(async () => { if (phase === "reservation") await block(); return release; });
    Object.assign(provider, { reserveInvocation: reserve });
    if (phase === "preparation") provider.prepareArguments.mockImplementation(async (_name, args) => { await block(); return args; });
    const ctx = context();
    if (phase === "approval") ctx.approve.mockImplementation(block);
    const result = observe(registry.invoke("test.read", {}, ctx));
    await ready.promise; await registry.close(); waiting.resolve();
    await flush(); closed(result);
    expect(provider.invoke).not.toHaveBeenCalled();
    if (phase === "preparation") expect(reserve).not.toHaveBeenCalled();
    else expect(release).toHaveBeenCalledOnce();
    if (phase !== "approval") expect(ctx.approve).not.toHaveBeenCalled();
  });
});
