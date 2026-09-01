import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("repository Kiro development agent", () => {
  it("binds steering without shadowing the installer-owned agent", () => {
    const profile = JSON.parse(fs.readFileSync(".kiro/agents/kiro-fabric-dev.json", "utf8")) as {
      name: string;
      includeMcpJson: boolean;
      includePowers: boolean;
      resources: string[];
      mcpServers: { fabric: { args: string[]; env: Record<string, string> } };
      tools: string[];
      allowedTools: string[];
      permissions: { rules: Array<{ capability: string; effect: string }> };
    };

    expect(profile.name).toBe("kiro-fabric-dev");
    expect(profile.name).not.toBe("kiro-fabric");
    expect(profile.includeMcpJson).toBe(false);
    expect(profile.includePowers).toBe(false);
    expect(profile.resources).toEqual(["file://.kiro/steering/**/*.md"]);
    expect(profile.mcpServers.fabric.args).toEqual(["dist/kiro/mcp-entry.js"]);
    expect(profile.mcpServers.fabric.env).not.toHaveProperty("KIRO_FABRIC_INTEGRATION", "power");
    expect(profile.tools).toContain("@fabric/fabric_exec");
    expect(profile.tools).not.toContain("*");
    expect(profile.allowedTools).toEqual(["read", "@fabric/fabric_exec"]);
    expect(profile.permissions.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "fs_write", effect: "ask" }),
      expect.objectContaining({ capability: "shell", effect: "ask" }),
      expect.objectContaining({ capability: "mcp", effect: "ask" }),
    ]));
  });

  it("uses explicit steering inclusion modes", () => {
    const steering = (name: string): string =>
      fs.readFileSync(`.kiro/steering/${name}.md`, "utf8");

    expect(steering("tech")).toMatch(/^---\ninclusion: always\n---/);
    expect(steering("tech")).toContain("pnpm run build");
    expect(steering("structure")).toMatch(/^---\ninclusion: auto\nname: fabric-repository-structure\ndescription:/);
    for (const name of ["api-patterns", "fabric-power", "strict-skills"]) {
      expect(steering(name)).toMatch(/^---\ninclusion: fileMatch\nfileMatchPattern:/);
    }
  });
});
