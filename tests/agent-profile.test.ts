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
  NATIVE_AUTO_APPROVED_TOOLS,
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

  it("requires one model tool with useful first-call guidance and no native fallback", () => {
    expect(AGENT_PROMPT).toContain("strict always-on Code Mode");
    expect(AGENT_PROMPT).toContain("No native tools or fallback exist");
    expect(AGENT_PROMPT).toContain('return await local.read({path:"README.md",limit:80});');
    for (const name of ["info", "help", "workspace"]) expect(AGENT_PROMPT).toContain(`fabric.${name}(`);
    expect(AGENT_PROMPT).toContain("do not make ritual or empty tool calls");
    expect(AGENT_PROMPT).toContain("timeoutMs:180000");
    expect(AGENT_PROMPT).not.toContain("@fabric/fabric_info");
    expect(AGENT_PROMPT).not.toContain("@fabric/fabric_workspace");
  });

  it("documents bounded coding workflow and namespace roles", () => {
    for (const text of ["Search before reading", "Batch independent", "steps sequential", "local handles", "mcp calls", "memory stores", "state stores", "one-based lines", "zero-based character paging", "900000", "no background job guarantee"]) expect(AGENT_PROMPT).toContain(text);
  });

  it("generates the global installed profile without optional steering", () => {
    const profile = generateAgentProfile(options);
    expect(profile).toEqual({
      name: "kiro-fabric",
      description: "Kiro Fabric coding agent with strict always-on checked-TypeScript Code Mode.",
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
            KIRO_FABRIC_EXPECTED_NODE: options.nodePath,
          },
          requestTimeout: FABRIC_MCP_REQUEST_TIMEOUT_MS,
        },
      },
      tools: AGENT_TOOLS,
      allowedTools: ["@fabric/fabric_exec"],
      permissions: {
        rules: [{
          capability: "mcp",
          match: ["fabric/fabric_exec"],
          effect: "allow",
        }],
      },
    });
    expect(NATIVE_AUTO_APPROVED_TOOLS).toEqual([]);
    expect(AGENT_TOOLS).toEqual(["@fabric/fabric_exec"]);
    expect(FABRIC_TOOLS).toEqual(["fabric_info", "fabric_workspace", "fabric_exec"]);
    expect(profile).not.toHaveProperty("disableInheritingDefaultResources");
    expect(NATIVE_AUTO_APPROVED_TOOLS).not.toContain("fs_write");
    expect(NATIVE_AUTO_APPROVED_TOOLS).not.toContain("execute_bash");
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
