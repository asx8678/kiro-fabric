import { describe, expect, it } from "vitest";
import { normalizeFabricPowerConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import type { FabricProvider } from "../src/protocol.js";
import {
  FABRIC_APPROVAL_TIMEOUT_MS,
  FABRIC_COMPILER_TIMEOUT_MS,
  FABRIC_PROVIDER_TIMEOUT_GRACE_MS,
  FabricExecutionService,
  effectiveFabricTimeout,
  exactActionTimeoutFloor,
  exactHostActionReference,
} from "../src/execution-service.js";
import {
  KIRO_MCP_DEADLINE_GRACE_MS,
  kiroMcpOuterDeadlineMs,
} from "../src/kiro/deadlines.js";

describe("deadline policy", () => {
  it("implements the configured maximum formula", () => {
    expect(effectiveFabricTimeout(900, 100, 400, 250)).toBe(400);
    expect(effectiveFabricTimeout(300, 100, 400, 250)).toBe(300);
    expect(effectiveFabricTimeout(900, 100, 0, 250)).toBe(250);
  });

  it("uses exact direct and tools.call action references rather than broad matching", () => {
    expect(exactActionTimeoutFloor("mcp.$call", 120_000)).toBe(
      120_000 + FABRIC_APPROVAL_TIMEOUT_MS * 2 + FABRIC_PROVIDER_TIMEOUT_GRACE_MS,
    );
    expect(exactActionTimeoutFloor("mcp.$call.extra", 120_000)).toBe(0);
    expect(exactActionTimeoutFloor("other.$call", 120_000)).toBe(0);
    expect(exactHostActionReference("mcp.$call", {})).toBe("mcp.$call");
    expect(exactHostActionReference("fabric.call", { ref: "mcp.$call", args: {} })).toBe("mcp.$call");
    expect(exactHostActionReference("fabric.call", { ref: "mcp.$call.extra" })).toBe("mcp.$call.extra");
    expect(exactHostActionReference("fabric.call", {})).toBeUndefined();
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
    const config = normalizeFabricPowerConfig({
      executor: { timeoutMs: 1_000, maxTimeoutMs: 100_000 },
      mcp: { callTimeoutMs: 1_000 },
    });
    const result = await new FabricExecutionService(registry, config, "/workspace").execute({
      code: "await tools.call({ ref: 'mcp.$call', args: {} }); await tools.providers(); return true;",
      approver: { async approve() {} },
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.effectiveTimeoutMs).toBe(
      1_000 + FABRIC_APPROVAL_TIMEOUT_MS * 2 + FABRIC_PROVIDER_TIMEOUT_GRACE_MS,
    );
  });

  it("keeps the outer MCP envelope beyond compilation and the maximum guest deadline", () => {
    const guestMaximum = 900_000;
    expect(KIRO_MCP_DEADLINE_GRACE_MS).toBeGreaterThan(0);
    expect(kiroMcpOuterDeadlineMs(guestMaximum, FABRIC_COMPILER_TIMEOUT_MS)).toBe(
      guestMaximum + FABRIC_COMPILER_TIMEOUT_MS + KIRO_MCP_DEADLINE_GRACE_MS,
    );
  });
});
