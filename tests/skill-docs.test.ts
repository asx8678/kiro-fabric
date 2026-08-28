import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { formatSkillsForPrompt, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { guestTypeDeclarations } from "../src/runtime/guest-types.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";

const EXPECTED_SKILLS = [
  "fabric-exec",
  "fabric-guide",
  "fabric-review",
  "fabric-workflow",
] as const;
const REMOVED_SKILLS = [
  "fabric-advisor",
  "fabric-ambient",
  "fabric-fusion",
  "fabric-schema",
  "fabric-spec",
  "fabric-supervisor",
] as const;
const KIRO_DECLARATIONS = guestTypeDeclarations(true, {
  coreToolNamespace: "k",
  agentBackedOrchestration: false,
  excludeGlobals: ["extensions", "mesh", "state", "schema", "components", "compact"],
});

const skillFiles = (): string[] => fs.readdirSync("skills", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join("skills", entry.name, "SKILL.md"))
  .filter((file) => fs.existsSync(file));

describe("managed Kiro skill contract", () => {
  it("ships exactly the supported Kiro-native skills", () => {
    expect(skillFiles().map((file) => path.basename(path.dirname(file))).sort())
      .toEqual([...EXPECTED_SKILLS]);
    const loaded = loadSkillsFromDir({ dir: "skills", source: "test" });
    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.skills.map((skill) => skill.name).sort()).toEqual([...EXPECTED_SKILLS]);
    expect(loaded.skills.filter((skill) => !skill.disableModelInvocation)
      .map((skill) => skill.name)).toEqual(["fabric-exec"]);
    const prompt = formatSkillsForPrompt(loaded.skills);
    expect(prompt).toContain("<name>fabric-exec</name>");
    for (const hidden of EXPECTED_SKILLS.filter((name) => name !== "fabric-exec")) {
      expect(prompt).not.toContain(`<name>${hidden}</name>`);
    }
  });

  it("type-checks every executable example against the Kiro capability view", () => {
    const files = [
      ...skillFiles(),
      "skills/fabric-exec/references/agents.md",
      "skills/fabric-exec/references/mcp.md",
    ];
    for (const file of files) {
      const markdown = fs.readFileSync(file, "utf8");
      const blocks = [...markdown.matchAll(/```ts\n([\s\S]*?)\n```/g)];
      for (const [index, match] of blocks.entries()) {
        const code = match[1]!;
        expect(typeCheckFabricCode(code, KIRO_DECLARATIONS).errors,
          `${file} TypeScript block ${index + 1}`).toEqual([]);
        expect(code).not.toMatch(/\b(?:pi|state|schema|mesh|components|compact|extensions)\s*\./);
        expect(code).not.toMatch(/\bagent\s*\(/);
        for (const key of code.matchAll(/π\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
          expect(markdown, `${file} does not document strings.${key[1]}`)
            .toContain(`strings.${key[1]}`);
        }
      }
    }
  });

  it("advertises only Kiro operations and resolves progressive references", () => {
    const exec = fs.readFileSync("skills/fabric-exec/SKILL.md", "utf8");
    expect(exec).toContain("`k` is the built-in");
    expect(exec).toContain("global `agent()` helper are unavailable");
    expect(exec).toContain("read, describe,\nretry");
    expect(exec).toContain("settle: true");
    expect(exec).not.toContain("pi.read(");
    for (const match of exec.matchAll(/`<skill-dir>\/([^`]+\.md)`/g)) {
      expect(fs.existsSync(path.resolve("skills/fabric-exec", match[1]!))).toBe(true);
    }

    const agents = fs.readFileSync("skills/fabric-exec/references/agents.md", "utf8");
    expect(agents).toContain("at most four non-recursive");
    expect(agents).toContain("There are no Pi/Claude/Veda runners");
    expect(agents).not.toContain("agents.create(");

    const mcp = fs.readFileSync("skills/fabric-exec/references/mcp.md", "utf8");
    expect(mcp).toContain("mcp.call({server, tool, args?})");
    expect(mcp).toContain("does not expose dynamic `mcp.server.tool` proxies");
    expect(mcp).not.toContain("mcp.register(");
  });

  it("keeps orchestration user-invoked, bounded, and direct-agent only", () => {
    const workflow = fs.readFileSync("skills/fabric-workflow/SKILL.md", "utf8");
    expect(workflow).toContain("disable-model-invocation: true");
    expect(workflow).toContain("agents.run({");
    expect(workflow).toContain("1-4 non-empty independent items");
    expect(workflow).toContain('"partial"');
    expect(workflow).toContain("never rerun a successful partition");
    expect(workflow).toContain("strings.checks");
    expect(workflow).toContain("k.bash({ command, timeout: 120 })");
    expect(workflow).toContain("only after child\nfan-out settles");
    expect(workflow).toContain("never from child\ntext or values");
    expect(workflow).toContain("fails acceptance closed while preserving every child result");
    expect(workflow).toContain("there are no automatic\nretries");
    expect(workflow).not.toMatch(/\bagent\s*\(/);
    expect(workflow).not.toContain("worktree:");

    const review = fs.readFileSync("skills/fabric-review/SKILL.md", "utf8");
    expect(review).toContain("Correctness & security");
    expect(review).toContain("Maintainability");
    expect(review).toContain("advisory");
    expect(review).toContain("deduplicate");
    expect(review).toContain("concise, risk-first evidence packet");
    expect(review).toContain("exactly one shared, falsifiable safety invariant");
    expect(review).toContain("proof grade");
    expect(review).toContain("**Observed**");
    expect(review).toContain("**Inferred**");
    expect(review).toContain("old/new trace only when");
    expect(review).toContain("at most eight numbered steps per side");

    const guide = fs.readFileSync("skills/fabric-guide/SKILL.md", "utf8");
    expect(guide).toContain("smallest sufficient path");
    expect(guide).toContain("/skill:fabric-workflow");
    expect(guide).toContain("/skill:fabric-review");
    expect(guide).not.toContain("/skill:fabric-schema");
  });

  it("packs no removed skills and includes every required Kiro reference", () => {
    const packed = JSON.parse(execFileSync(
      process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "npm",
      process.platform === "win32"
        ? ["/d", "/s", "/c", "npm", "pack", "--ignore-scripts", "--dry-run", "--json"]
        : ["pack", "--ignore-scripts", "--dry-run", "--json"],
      { cwd: process.cwd(), encoding: "utf8" },
    ));
    const entries = Array.isArray(packed) ? packed : Object.values(packed);
    const files = new Set((entries as Array<{ files: Array<{ path: string }> }>)
      .flatMap((entry) => entry.files).map((entry) => entry.path));
    for (const name of EXPECTED_SKILLS) expect(files).toContain(`skills/${name}/SKILL.md`);
    for (const name of REMOVED_SKILLS) expect(files).not.toContain(`skills/${name}/SKILL.md`);
    expect(files).toContain("skills/fabric-exec/references/agents.md");
    expect(files).toContain("skills/fabric-exec/references/mcp.md");
    expect(files).not.toContain("skills/fabric-exec/references/mesh.md");
    expect(files).toContain("docs/skills.md");
  }, 30_000);

  it("omits unsupported globals from Kiro guest declarations", () => {
    for (const name of ["pi", "state", "schema", "mesh", "components", "compact", "extensions"]) {
      expect(KIRO_DECLARATIONS).not.toContain(`declare const ${name}:`);
    }
    expect(KIRO_DECLARATIONS).not.toContain("declare function agent<");
    expect(KIRO_DECLARATIONS).toContain("declare const k: KiroToolsApi");
    expect(KIRO_DECLARATIONS).toContain("declare const agents: KiroFabricAgentsApi");
    const kiroAgents = KIRO_DECLARATIONS.slice(
      KIRO_DECLARATIONS.indexOf("interface KiroFabricAgentsApi"),
      KIRO_DECLARATIONS.indexOf("interface KiroToolsApi"),
    );
    expect(kiroAgents).toContain("run(args: KiroFabricAgentRequest)");
    expect(kiroAgents).not.toContain("actors(");
    expect(kiroAgents).not.toContain("handoff(");
  });
});
