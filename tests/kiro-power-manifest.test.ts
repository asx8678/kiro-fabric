import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Agent Plugins 1.0.0 package", () => {
  it("keeps manifests and the bundled closure launcher synchronized", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const plugin = JSON.parse(fs.readFileSync("plugin.json", "utf8"));
    const mcp = JSON.parse(fs.readFileSync("mcp.json", "utf8"));
    expect(plugin.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
    expect(mcp.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
    expect(plugin.version).toBe(pkg.version);
    expect(mcp.mcpServers.fabric).toMatchObject({
      type: "stdio",
      command: "node",
      args: ["${PLUGIN_ROOT}/dist/kiro-power-closure/kiro/mcp-entry.js"],
      cwd: "${PLUGIN_ROOT}",
      env: { KIRO_FABRIC_INTEGRATION: "power" },
    });
    expect(mcp.mcpServers.fabric.args.join(" ")).not.toMatch(/npx|@latest/);
  });

  it("passes deterministic package-boundary validation", () => {
    const output = execFileSync(process.execPath, ["scripts/validate-power-package.mjs", "."], { encoding: "utf8" });
    expect(JSON.parse(output)).toMatchObject({ ok: true, version: "0.63.0", skills: 2 });
  });

  it("does not advertise the unavailable Power agent provider", () => {
    const plugin = JSON.parse(fs.readFileSync("plugin.json", "utf8")) as {
      description: string;
      keywords: string[];
    };
    const orchestration = fs.readFileSync("skills/fabric-orchestration/SKILL.md", "utf8");
    const agentReference = fs.readFileSync("skills/fabric-exec/references/agents.md", "utf8");
    expect([plugin.description, ...plugin.keywords].join(" ")).not.toMatch(/multi-agent|agent fan-out|ACP orchestration/i);
    expect(orchestration).not.toContain("agents.run({");
    expect(orchestration).toMatch(/current Power release does not\s+mount `agents\.\*`/i);
    expect(agentReference).toMatch(/does not mount `agents\.\*`/i);
  });
});
