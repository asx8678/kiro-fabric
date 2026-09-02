import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

const frontmatter = (content: string): Record<string, unknown> => {
  const match = content.match(/^---\n([\s\S]*?)\n---/u);
  if (!match) throw new Error("missing YAML frontmatter");
  return parseYaml(match[1]!) as Record<string, unknown>;
};

const activationRoute = (prompt: string): string | null => {
  const normalized = prompt.toLowerCase();
  const strictExcluded = /without (?:touching|changing) (?:the )?managed strict/u.test(normalized);
  const strict = !strictExcluded && /strict\/skills|managed strict|skill attestation|progressive reference/u.test(normalized);
  const power = /plugin\.json|public power|power skill|power closure|power guidance/u.test(normalized);
  if (strict) return "strict-skill-maintenance";
  if (power) return "fabric-power-maintenance";
  return null;
};

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
    expect(profile.resources).toEqual([
      "file://.kiro/steering/tech.md",
      "file://.kiro/steering/structure.md",
      "skill://.kiro/skills/**/SKILL.md",
    ]);
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
    expect(profile.tools.join(" ")).not.toMatch(/web|http|network|browser/i);
    expect(profile.permissions.rules).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: expect.stringMatching(/web|http|network/i), effect: "allow" }),
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

  it("keeps directly loaded repository context under 1,500 estimated tokens", () => {
    const profile = JSON.parse(fs.readFileSync(".kiro/agents/kiro-fabric-dev.json", "utf8")) as {
      prompt: string;
      resources: string[];
    };
    const direct = profile.resources
      .filter((resource) => resource.startsWith("file://"))
      .map((resource) => resource.slice("file://".length));
    const skillFiles = fs.readdirSync(".kiro/skills", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(".kiro/skills", entry.name, "SKILL.md"));
    const metadataBytes = skillFiles.reduce((total, file) => {
      const metadata = frontmatter(fs.readFileSync(file, "utf8"));
      return total + Buffer.byteLength(`${metadata.name}\n${metadata.description}\n`);
    }, 0);
    const bytes = Buffer.byteLength(profile.prompt) + metadataBytes + direct.reduce(
      (total, file) => total + fs.statSync(file).size,
      0,
    );
    expect(Math.ceil(bytes / 4)).toBeLessThanOrEqual(1_500);
  });

  it("loads valid, non-overlapping repository skills on demand", () => {
    for (const entry of fs.readdirSync(".kiro/skills", { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metadata = frontmatter(fs.readFileSync(path.join(".kiro/skills", entry.name, "SKILL.md"), "utf8"));
      expect(metadata.name).toBe(entry.name);
      expect(entry.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
      expect(metadata.description).toEqual(expect.stringMatching(/\bUse when\b/u));
      expect(metadata.description).toEqual(expect.stringMatching(/\bDo not use\b/u));
    }
    const fixture = JSON.parse(fs.readFileSync("tests/fixtures/kiro/dev-skill-activation.json", "utf8")) as {
      cases: Array<{ prompt: string; expected: string | null; notPreferred?: string }>;
    };
    for (const sample of fixture.cases) {
      const selected = activationRoute(sample.prompt);
      expect(selected, sample.prompt).toBe(sample.expected);
      if (sample.notPreferred) expect(selected, sample.prompt).not.toBe(sample.notPreferred);
    }
  });
});
