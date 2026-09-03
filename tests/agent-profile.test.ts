import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_PROMPT,
  AGENT_TOOLS,
  FABRIC_MAX_GUEST_TIMEOUT_MS,
  FABRIC_MCP_CLIENT_RESPONSE_MARGIN_MS,
  FABRIC_MCP_INTERNAL_DEADLINE_MS,
  FABRIC_MCP_REQUEST_TIMEOUT_MS,
  FABRIC_TOOLS,
  generateAgentProfile,
} from "../scripts/agent-profile.mjs";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { FABRIC_COMPILER_TIMEOUT_MS } from "../src/execution-service.js";
import {
  KIRO_MCP_DEADLINE_GRACE_MS,
  kiroMcpOuterDeadlineMs,
} from "../src/kiro/deadlines.js";

const options = {
  nodePath: path.resolve("/runtime/node"),
  runtimeRoot: path.resolve("/install/runtime"),
  dataRoot: path.resolve("/install/data"),
  skillPath: path.resolve("/install/skills/fabric-exec/SKILL.md"),
};

describe("Kiro Agent profile generation", () => {
  it("keeps Kiro conversation compaction separate from Fabric durable state", () => {
    expect(AGENT_PROMPT).toContain("Kiro owns conversation history, automatic and manual context compaction, and chat resume.");
    expect(AGENT_PROMPT).toContain("compaction is not a reason to start, reconnect, or replace Fabric");
    expect(AGENT_PROMPT).toContain("never mirror the whole conversation");
    expect(AGENT_PROMPT).toContain("Fabric memory/state is workspace-scoped and may be shared by concurrent Kiro chats");
  });

  it("generates the global installed profile without optional steering", () => {
    const profile = generateAgentProfile(options);
    expect(profile).toEqual({
      name: "kiro-fabric",
      description: "Kiro Fabric coding agent with native Kiro tools and a bounded checked-TypeScript composition backend.",
      prompt: AGENT_PROMPT,
      includePowers: false,
      includeMcpJson: false,
      resources: [`skill://${options.skillPath}`],
      mcpServers: {
        fabric: {
          command: options.nodePath,
          args: [path.join(options.runtimeRoot, "kiro", "mcp-entry.js")],
          env: {
            KIRO_FABRIC_RUNTIME_ROOT: options.runtimeRoot,
            KIRO_FABRIC_DATA_ROOT: options.dataRoot,
          },
          requestTimeout: FABRIC_MCP_REQUEST_TIMEOUT_MS,
        },
      },
      tools: AGENT_TOOLS,
      allowedTools: FABRIC_TOOLS.map((name) => `@fabric/${name}`),
      permissions: {
        rules: [{
          capability: "mcp",
          match: FABRIC_TOOLS.map((name) => `fabric/${name}`),
          effect: "allow",
        }],
      },
    });
    expect(profile).not.toHaveProperty("model");
    expect(profile).not.toHaveProperty("chat");
  });

  it("adds absolute optional steering after the skill resource", () => {
    const steeringPath = path.resolve("/install/steering/fabric.md");
    expect(generateAgentProfile({ ...options, steeringPath }).resources).toEqual([
      `skill://${options.skillPath}`,
      `file://${steeringPath}`,
    ]);
  });

  it("rejects relative executable and resource paths", () => {
    for (const key of ["nodePath", "runtimeRoot", "dataRoot", "skillPath"] as const) {
      expect(() => generateAgentProfile({ ...options, [key]: "relative/path" })).toThrow(`${key} must be absolute`);
    }
    expect(() => generateAgentProfile({ ...options, steeringPath: "relative/steering.md" })).toThrow("steeringPath must be absolute");
  });

  it("keeps Kiro's per-call timeout beyond Fabric's maximum request envelope", () => {
    expect(KIRO_MCP_DEADLINE_GRACE_MS).toBeGreaterThan(0);
    expect(FABRIC_MCP_CLIENT_RESPONSE_MARGIN_MS).toBeGreaterThan(0);
    expect(FABRIC_MAX_GUEST_TIMEOUT_MS).toBe(DEFAULT_FABRIC_CONFIG.executor.maxTimeoutMs);
    const fabricOuterDeadline = kiroMcpOuterDeadlineMs(
      DEFAULT_FABRIC_CONFIG.executor.maxTimeoutMs,
      FABRIC_COMPILER_TIMEOUT_MS,
    );
    expect(FABRIC_MCP_INTERNAL_DEADLINE_MS).toBe(fabricOuterDeadline);
    expect(FABRIC_MCP_REQUEST_TIMEOUT_MS).toBe(fabricOuterDeadline + FABRIC_MCP_CLIENT_RESPONSE_MARGIN_MS);
    expect(FABRIC_MCP_REQUEST_TIMEOUT_MS).toBeGreaterThan(fabricOuterDeadline);
  });
});
