import { describe, expect, it } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import type { FabricProvider, ResolvedFabricAction } from "../src/protocol.js";

const provider = (invoke: FabricProvider["invoke"]): FabricProvider => ({
  name: "state",
  description: "test state",
  async list() { return [{ name: "set", description: "set", inputSchema: { type: "object", properties: { key: { type: "string" }, value: {} }, required: ["key", "value"], additionalProperties: false }, risk: "write", effect: { kind: "write" } }]; },
  async describe(name) { return name === "set" ? (await this.list())[0] : undefined; },
  effectResources(_name, args) { return [`state:${String(args.key)}`]; },
  invoke,
});
const context = (approve: (action: ResolvedFabricAction, args: Record<string, unknown>) => Promise<void>) => ({
  cwd: "/workspace", audits: [], maxResultChars: 10_000, approve,
});

describe("ActionRegistry security boundaries", () => {
  it("returns complete digest-bound descriptors and deterministically ranks discovery fields", async () => {
    const registry = new ActionRegistry();
    registry.register({
      name: "catalog",
      description: "remote document operations",
      async list() {
        return [
          {
            name: "write",
            description: "store a document",
            inputSchema: { type: "object", properties: { body: { type: "string" } } },
            outputSchema: { type: "object", properties: { saved: { type: "boolean" } } },
            risk: "write",
            namespace: "documents",
            effect: { kind: "write", resources: ["document:*"] },
          },
          {
            name: "read",
            description: "retrieve content",
            inputSchema: { type: "object", properties: { documentId: { type: "string" } } },
            risk: "read",
            namespace: "documents",
          },
        ];
      },
      async describe(name) { return (await this.list()).find((entry) => entry.name === name); },
      async invoke() { return true; },
    });

    const descriptor = await registry.describe("catalog.write");
    expect(descriptor).toMatchObject({
      namespace: "documents",
      outputSchema: { type: "object" },
      effect: { kind: "write", resources: ["document:*"] },
    });
    expect(descriptor.descriptorDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect((await registry.describe("catalog.write")).descriptorDigest).toBe(descriptor.descriptorDigest);
    expect((await registry.search("catalog write")).map((entry) => entry.ref)).toEqual([
      "catalog.write",
      "catalog.read",
    ]);
    expect((await registry.search("documentId")).map((entry) => entry.ref)).toEqual(["catalog.read"]);
    expect((await registry.search("remote document")).map((entry) => entry.ref)).toEqual([
      "catalog.write",
      "catalog.read",
    ]);
  });

  it("bounds search queries and action references before provider work", async () => {
    const registry = new ActionRegistry();
    await expect(registry.search("x".repeat(2_001))).rejects.toThrow("query exceeds");
    await expect(registry.describe("x".repeat(513))).rejects.toThrow("reference exceeds");
  });

  it("fails before invocation when approval is denied", async () => {
    let invoked = false;
    const registry = new ActionRegistry();
    registry.register(provider(async () => { invoked = true; return true; }));
    await expect(registry.invoke("state.set", { key: "a", value: 1 }, context(async () => { throw new Error("denied"); }))).rejects.toThrow("denied");
    expect(invoked).toBe(false);
  });

  it("binds approval to exact copied action and argument snapshots", async () => {
    let approved: unknown; let invoked: unknown; let invokedAction = "";
    const registry = new ActionRegistry();
    registry.register(provider(async (name, args) => { invokedAction = name; invoked = args; return true; }));
    const args = { key: "a", value: { safe: true } };
    await registry.invoke("state.set", args, context(async (action, exact) => {
      approved = structuredClone(exact);
      args.value.safe = false;
      action.name = "different";
      action.ref = "state.different";
      (exact.value as { safe: boolean }).safe = false;
    }));
    expect(approved).toEqual({ key: "a", value: { safe: true } });
    expect(invokedAction).toBe("set");
    expect(invoked).toEqual(approved);
  });

  it("awaits cooperative provider cancellation cleanup before settling", async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    let cleaned = false;
    const controller = new AbortController();
    const registry = new ActionRegistry();
    registry.register(provider(async (_name, _args, invocation) => {
      started();
      return new Promise((_resolve, reject) => {
        invocation.signal?.addEventListener("abort", () => {
          setTimeout(() => {
            cleaned = true;
            reject(invocation.signal?.reason);
          }, 20);
        }, { once: true });
      });
    }));
    const invocation = registry.invoke(
      "state.set",
      { key: "a", value: 1 },
      { ...context(async () => {}), signal: controller.signal },
    );
    await ready;
    controller.abort(new Error("cancelled"));
    await expect(invocation).rejects.toThrow("cancelled");
    expect(cleaned).toBe(true);
  });

  it("reserves write intent before approval to prevent prompt floods", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let prompts = 0;
    const registry = new ActionRegistry();
    registry.register(provider(async () => true));
    const first = registry.invoke("state.set", { key: "a", value: 1 }, context(async () => { prompts += 1; await blocked; }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(registry.invoke("state.set", { key: "a", value: 2 }, context(async () => { prompts += 1; }))).rejects.toThrow("Overlapping write rejected");
    expect(prompts).toBe(1);
    release();
    await expect(first).resolves.toBe(true);
  });

  it("rejects overlapping writes while allowing distinct resources", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const registry = new ActionRegistry();
    registry.register(provider(async (_name, args) => { if (args.key === "a") await blocked; return args.key; }));
    const first = registry.invoke("state.set", { key: "a", value: 1 }, context(async () => {}));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(registry.invoke("state.set", { key: "a", value: 2 }, context(async () => {}))).rejects.toThrow("Overlapping write rejected");
    await expect(registry.invoke("state.set", { key: "b", value: 2 }, context(async () => {}))).resolves.toBe("b");
    release();
    await expect(first).resolves.toBe("a");
  });
});
