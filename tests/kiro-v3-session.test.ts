import { describe, expect, it } from "vitest";
import type { KiroProfileDocument } from "../src/kiro/profile.js";
import {
  assertKiroV3AgentModeAvailable,
  buildKiroV3SessionParams,
} from "../src/kiro/v3-session.js";

const profile = (): KiroProfileDocument => ({
  name: "kiro-fabric",
  description: "Fabric v3 test",
  prompt: "Use the Fabric tool.",
  includeMcpJson: false,
  includePowers: false,
  tools: ["@fabric/fabric_exec"],
  allowedTools: ["@fabric/fabric_exec"],
  resources: ["skill://.kiro/skills/fabric-*/SKILL.md"],
  permissions: {
    rules: [{ capability: "mcp", match: ["fabric/fabric_exec"], effect: "ask" }],
  },
  mcpServers: {
    fabric: {
      command: "/usr/bin/node",
      args: ["/pkg/mcp-entry.js"],
      env: { Z_LAST: "z", A_FIRST: "a" },
      requestTimeout: 1234,
    },
  },
});
describe("Kiro v3 session projection", () => {
  it("injects one custom agent and one ACP-shaped Fabric MCP server", () => {
    expect(buildKiroV3SessionParams(profile(), "/workspace")).toEqual({
      cwd: "/workspace",
      mcpServers: [{
        name: "fabric",
        command: "/usr/bin/node",
        args: ["/pkg/mcp-entry.js"],
        env: [
          { name: "A_FIRST", value: "a" },
          { name: "Z_LAST", value: "z" },
        ],
        requestTimeout: 1234,
      }],
      _meta: {
        kiro: {
          customAgents: [{
            id: "kiro-fabric",
            description: "Fabric v3 test",
            prompt: "Use the Fabric tool.",
            tools: ["@fabric/fabric_exec"],
            allowedTools: ["@fabric/fabric_exec"],
            includeMcpJson: false,
            includePowers: false,
            resources: ["skill://.kiro/skills/fabric-*/SKILL.md"],
            permissions: {
              rules: [{ capability: "mcp", match: ["fabric/fabric_exec"], effect: "ask" }],
            },
          }],
        },
      },
    });
  });

  it("projects every security-relevant agent field unchanged (wire/disk parity)", () => {
    const disk = profile();
    const wire = buildKiroV3SessionParams(disk, "/workspace")._meta.kiro.customAgents[0]!;
    for (const field of [
      "tools",
      "allowedTools",
      "includeMcpJson",
      "includePowers",
      "resources",
      "permissions",
    ] as const) {
      expect(wire[field]).toEqual(disk[field]);
    }
  });

  it("projects the exact permission policy onto the wire", () => {
    const trusted = profile();
    trusted.permissions.rules[0]!.effect = "allow";
    expect(
      buildKiroV3SessionParams(trusted, "/workspace")._meta.kiro.customAgents[0]
        ?.permissions,
    ).toEqual(trusted.permissions);
  });

  it("fails closed unless KAS advertises the injected agent mode", () => {
    expect(() => assertKiroV3AgentModeAvailable({
      modes: { availableModes: [{ id: "vibe" }, { id: "kiro-fabric" }] },
    })).not.toThrow();
    expect(() => assertKiroV3AgentModeAvailable({
      modes: { availableModes: [{ id: "vibe" }] },
    })).toThrow(/broader default mode/);
    expect(() => assertKiroV3AgentModeAvailable({})).toThrow(/did not advertise/);
  });
});
