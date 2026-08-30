import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Agent Plugins 1.0.0 package", () => {
  it("keeps manifests and exact npm launcher synchronized", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const plugin = JSON.parse(fs.readFileSync("plugin.json", "utf8"));
    const mcp = JSON.parse(fs.readFileSync("mcp.json", "utf8"));
    expect(plugin.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
    expect(mcp.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
    expect(plugin.version).toBe(pkg.version);
    expect(mcp.mcpServers.fabric).toMatchObject({ type: "stdio", command: "npx", cwd: "${PLUGIN_ROOT}", env: { KIRO_FABRIC_INTEGRATION: "power" } });
    expect(mcp.mcpServers.fabric.args).toContain(`${pkg.name}@${pkg.version}`);
    expect(mcp.mcpServers.fabric.args.join(" ")).not.toContain("@latest");
  });

  it("passes deterministic package-boundary validation", () => {
    const output = execFileSync(process.execPath, ["scripts/validate-power-package.mjs", "."], { encoding: "utf8" });
    expect(JSON.parse(output)).toMatchObject({ ok: true, version: "0.63.0", skills: 2 });
  });
});
