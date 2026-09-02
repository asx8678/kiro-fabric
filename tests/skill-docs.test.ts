import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatSkillsForPrompt, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { guestTypeDeclarations } from "../src/runtime/guest-types.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";

const EXPECTED_SKILLS = ["fabric-exec"] as const;
const EXPECTED_REFERENCES = [
  "agents.md",
  "guide.md",
  "mcp.md",
  "review.md",
  "workflow.md",
] as const;
const REMOVED_SKILLS = [
  "fabric-advisor",
  "fabric-ambient",
  "fabric-fusion",
  "fabric-guide",
  "fabric-review",
  "fabric-schema",
  "fabric-spec",
  "fabric-supervisor",
  "fabric-workflow",
] as const;
const KIRO_DECLARATIONS = guestTypeDeclarations(true, {
  coreToolNamespace: "k",
  agentBackedOrchestration: false,
  excludeGlobals: ["extensions", "mesh", "state", "schema", "components", "compact"],
});

const skillFiles = (): string[] => fs.readdirSync("strict/skills", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join("strict/skills", entry.name, "SKILL.md"))
  .filter((file) => fs.existsSync(file));

describe("managed Kiro skill contract", () => {
  it("ships exactly the supported Kiro-native skills", () => {
    expect(skillFiles().map((file) => path.basename(path.dirname(file))).sort())
      .toEqual([...EXPECTED_SKILLS]);
    const loaded = loadSkillsFromDir({ dir: "strict/skills", source: "test" });
    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.skills.map((skill) => skill.name).sort()).toEqual([...EXPECTED_SKILLS]);
    expect(loaded.skills.map((skill) => skill.name)).toEqual(["fabric-exec"]);
    const prompt = formatSkillsForPrompt(loaded.skills);
    expect(prompt).toContain("<name>fabric-exec</name>");
    for (const removed of REMOVED_SKILLS) {
      expect(prompt).not.toContain(`<name>${removed}</name>`);
    }
    expect(fs.readFileSync("strict/skills/fabric-exec/SKILL.md", "utf8"))
      .not.toContain("disable-model-invocation");
  });

  it("type-checks every executable example against the Kiro capability view", () => {
    const files = [
      ...skillFiles(),
      ...EXPECTED_REFERENCES.map((name) =>
        `strict/skills/fabric-exec/references/${name}`),
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
    const exec = fs.readFileSync("strict/skills/fabric-exec/SKILL.md", "utf8");
    // These anchors are deliberate public compatibility text: they encode the
    // sole repository namespace, unavailable global agent path, and explicit
    // nonzero-shell control-flow opt-in shown to managed Kiro.
    for (const anchor of [
      "`k` is the built-in",
      "global `agent()` helper are unavailable",
      "settle: true",
    ]) expect(exec).toContain(anchor);
    expect(exec).not.toContain("pi.read(");
    const skillDirRefs = [...exec.matchAll(/`<skill-dir>\/([^`]+\.md)`/g)];
    expect(skillDirRefs.length).toBeGreaterThan(0);
    for (const match of skillDirRefs) {
      expect(fs.existsSync(path.resolve("strict/skills/fabric-exec", match[1]!))).toBe(true);
    }

    const agents = fs.readFileSync("strict/skills/fabric-exec/references/agents.md", "utf8");
    expect(agents).toMatch(/at most four non-recursive/iu);
    expect(agents).toMatch(/no (?:Pi\/Claude\/Veda|recursive|durable)/iu);
    expect(agents).toMatch(/runner:\s*"kiro"/u);
    expect(agents).not.toContain("agents.create(");

    const mcp = fs.readFileSync("strict/skills/fabric-exec/references/mcp.md", "utf8");
    expect(mcp).toMatch(/mcp\.call\(\{server, tool, args\?\}\)/u);
    expect(mcp).toMatch(/does not expose dynamic .* proxies/iu);
    expect(mcp).not.toContain("mcp.register(");
  });

  it("keeps orchestration references bounded and direct-agent only", () => {
    const workflow = fs.readFileSync("strict/skills/fabric-exec/references/workflow.md", "utf8");
    expect(workflow).toMatch(/await agents\.run\(/u);
    // Public routing/partial-failure anchors intentionally remain exact.
    expect(workflow).toContain("1-4 non-empty independent items");
    expect(workflow).toContain("never rerun a successful partition");
    expect(workflow).toMatch(/"(?:completed|partial|failed)"/u);
    expect(workflow).toMatch(/acceptance.*(?:closed|fail)/isu);
    expect(workflow).toMatch(/no automatic\s+retries/iu);
    expect(workflow).not.toMatch(/\bagent\s*\(/);
    expect(workflow).not.toContain("worktree:");

    const review = fs.readFileSync("strict/skills/fabric-exec/references/review.md", "utf8");
    expect(review).toMatch(/correctness.*security/iu);
    expect(review).toMatch(/maintainability/iu);
    expect(review).toMatch(/observed[\s\S]*inferred/iu);
    expect(review).toMatch(/await agents\.run\(/u);
    expect(review).toMatch(/additionalProperties:\s*false/u);
    expect(review).toMatch(/schema-invalid.*lane/iu);
    expect(review).toMatch(/never fall back to\s+unvalidated `result\.text`/iu);

    const guide = fs.readFileSync("strict/skills/fabric-exec/references/guide.md", "utf8");
    expect(guide).toMatch(/smallest sufficient path/iu);
    expect(guide).toMatch(/references\/(?:workflow|review)\.md/u);
    expect(guide).not.toContain("/skill:fabric-schema");
  });

  it("packs no removed skills and includes every required Kiro reference", () => {
    const packed = JSON.parse(execFileSync(
      process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "pnpm",
      process.platform === "win32"
        ? ["/d", "/s", "/c", "pnpm", "pack", "--dry-run", "--json", "--config.ignore-scripts=true"]
        : ["pack", "--dry-run", "--json", "--config.ignore-scripts=true"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, npm_config_cache: path.join(os.tmpdir(), "kiro-fabric-npm-cache") },
      },
    ));
    const entries = Array.isArray(packed) ? packed : [packed];
    const files = new Set((entries as Array<{ files: Array<{ path: string }> }>)
      .flatMap((entry) => entry.files).map((entry) => entry.path));
    for (const name of EXPECTED_SKILLS) expect(files).toContain(`strict/skills/${name}/SKILL.md`);
    for (const name of REMOVED_SKILLS) expect(files).not.toContain(`strict/skills/${name}/SKILL.md`);
    for (const name of EXPECTED_REFERENCES) {
      expect(files).toContain(`strict/skills/fabric-exec/references/${name}`);
    }
    expect(files).not.toContain("strict/skills/fabric-exec/references/mesh.md");
    expect(files).toContain("skills/fabric-orchestration/SKILL.md");
    expect(files).toContain("skills/fabric-exec/references/troubleshooting.md");
    expect(files).toContain("plugin.json");
    expect(files).toContain("mcp.json");
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
