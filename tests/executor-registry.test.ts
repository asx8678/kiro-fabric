import { describe, expect, it } from "vitest";
import { ExecutorRegistry } from "../src/agents/executor-registry.js";
import type { AgentTransportAdapter } from "../src/agents/types.js";
import type { FabricAgentTransport } from "../src/config.js";

const fakeAdapter = (
  kind: FabricAgentTransport,
  available: boolean,
): AgentTransportAdapter => ({
  kind,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  available: async () => available,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transport: "process" as any,
  resolveExecutable: async () => "/bin/true",
  // Only the surface exercised here; remaining members are no-ops.
} as unknown as AgentTransportAdapter);

describe("ExecutorRegistry", () => {
  it("resolves an explicit available adapter", async () => {
    const reg = new ExecutorRegistry([fakeAdapter("screen", true), fakeAdapter("process", true)]);
    const adapter = await reg.resolve("screen");
    expect(adapter.kind).toBe("screen");
  });

  it("throws the exact error for an explicit unavailable adapter", async () => {
    const reg = new ExecutorRegistry([fakeAdapter("tmux", false)]);
    await expect(reg.resolve("tmux")).rejects.toThrow("Fabric agent transport is unavailable: tmux");
  });

  it("auto-selects the first available adapter in priority order", async () => {
    const reg = new ExecutorRegistry([
      fakeAdapter("process", true),
      fakeAdapter("localterm", true),
      fakeAdapter("herdr", true),
    ]);
    const adapter = await reg.resolve("auto");
    // Priority order is herdr, localterm, tmux, screen, process.
    expect(adapter.kind).toBe("herdr");
  });

  it("throws when auto has no available adapter", async () => {
    const reg = new ExecutorRegistry([
      fakeAdapter("process", false),
      fakeAdapter("herdr", false),
      fakeAdapter("localterm", false),
      fakeAdapter("tmux", false),
      fakeAdapter("screen", false),
    ]);
    await expect(reg.resolve("auto")).rejects.toThrow("No Fabric agent transport is available");
  });

  it("exposes registered kinds via adapterFor", () => {
    const reg = new ExecutorRegistry([fakeAdapter("process", true)]);
    expect(reg.adapterFor("process")?.kind).toBe("process");
    expect(reg.adapterFor("tmux")).toBeUndefined();
    expect(reg.availableKinds).toEqual(["process"]);
  });
});