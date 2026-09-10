import { readFileSync } from "node:fs";
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
import { FabricBootstrapProvider } from "../src/kiro/bootstrap-provider.js";
import { LOCAL_GUEST_DECLARATIONS } from "../src/providers/local-contract.js";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";
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

const steering = readFileSync(new URL("../resources/steering/fabric.md", import.meta.url), "utf8");

// Budget explicit standing text, not task-loaded help, tokens or billing.
// The former 3500-character ceiling did not include the user's repository rules.
// Keep detailed procedures/recipes off the hot path and measure the input trade-off.
const MAX_STANDING_CHARS = 6400;

// Contract clauses, not whole sentences: tolerate punctuation and connective
// prose changes while keeping obligations in the prompt even without steering.
const promptContracts: Array<[string, RegExp]> = [
  ["strict one-tool Code Mode", /strict\s+always-on\s+Code Mode/i],
  ["no native fallback", /no native tools?[^.]*\bfallback/i],
  ["conversation without dummy calls", /conversation[^.]*(?:without|no)[^.]*empty tool calls/i],
  ["discovery before reads without a presumed README", /discover paths before reads; never assume README[.]md exists/i],
  ["closed shallow-list interface", /local[.]list accepts only path\/limit: direct children, no depth/i],
  ["search before bounded reads", /search[^.]*before reading[^.]*located ranges/i],
  ["independent batching and dependent sequencing", /batch independent[^.]*(?:sequence|sequential)[^.]*dependent[^.]*search\/read\/edit\/verify/i],
  ["awaited compact output", /await calls[^.]*return compact results/i],
  ["named edit payloads", /payloads for edit content/i],
  ["local workspace namespace", /local\s+(?:handles|holds)[^.]*workspace files\/search\/shell/i],
  ["configured MCP namespace", /mcp\s+(?:handles|calls)[^.]*explicitly configured external capabilities/i],
  ["durable memory and revisioned state roles", /memory\s+(?:holds|stores)[^.]*durable facts[^.]*state\s+(?:holds|stores)[^.]*revisioned task progress/i],
  ["create-only write default", /write[^.]*create-only unless\s+overwrite\s*:\s*true/i],
  ["exact unique edit anchor", /edit[^.]*exact nonempty unique anchor unless\s+all\s*:\s*true/i],
  ["single verified root auto-binding", /single verified root[^.]*auto(?:matically|-binds)/i],
  ["separate workspace selection", /fabric\.workspace\(\{action:\s*["']select["'],\s*rootId\}\)[^.]*separate execution[^.]*workspace effects/i],
  ["selection commits only on success", /pending selection[^.]*commits? only[^.]*successful (?:execution|settlement)/i],
  ["no cwd substitution", /never[^.]*process cwd[^.]*workspace/i],
  ["unavailable external capabilities stay unavailable", /web\/lsp\/delegation[^.]*explicitly configured available MCP capability[^.]*otherwise report unavailable/i],
  ["nested approval is independent", /outer tool (?:allowance|permission)[^.]*(?:never|does not) approve[^.]*nested effects[^.]*each (?:nested )?action[^.]*Fabric approval policy/i],
  ["no background guarantee", /no background job guarantee/i],
  ["settle cannot swallow denial or cleanup failures", /denial[^.]*timeout[^.]*cancellation[^.]*uncertain cleanup[^.]*fail[^.]*settle\s*:\s*true/i],
  ["partial-effect recovery, not automatic replay", /propagate failures[^.]*inspect partial (?:effects|progress)[^.]*before retrying[^.]*never[^.]*replay[^.]*effectful program/i],
  ["verified completion", /verif(?:y|ication)[^.]*before[^.]*claim(?:ing)? completion/i],
  ["Kiro compaction and resume ownership", /Kiro owns[^.]*history[^.]*automatic(?:\/| and )manual[^.]*compaction[^.]*chat resume/i],
  ["continue Fabric after compaction", /after compaction[^.]*(?:keep|continue) using Fabric[^.]*(?:do not|never)[^.]*start[^.]*reconnect[^.]*replace/i],
  ["workspace state shared across chats", /Fabric memory\/state[^.]*workspace-scoped[^.]*shared[^.]*concurrent Kiro chats/i],
  ["intentional non-secret persistence only", /store only[^.]*intentional[^.]*non-secret[^.]*durable facts(?:\/| or )task state/i],
  ["no conversation mirroring", /never mirror[^.]*(?:whole|entire) conversation/i],
];

describe("Kiro Agent profile generation", () => {
  it.each(promptContracts)("keeps the standing contract: %s", (_name, rule) => {
    expect(AGENT_PROMPT).toMatch(rule);
  });

  it("avoids ritual discovery and steers concise answers without sacrificing requested output or evidence", () => {
    expect(AGENT_PROMPT).toContain("For workspace work only");
    expect(AGENT_PROMPT).toContain("if tools are forbidden, use none");
    expect(AGENT_PROMPT).toContain("General explanations need no workspace inspection");
    expect(AGENT_PROMPT).toMatch(/known task paths[^.]*skip[^.]*listing\/help/i);
    expect(AGENT_PROMPT).toMatch(/otherwise discover paths before reads/i);
    expect(AGENT_PROMPT).toMatch(/120 words/i);
    expect(AGENT_PROMPT).toContain("no prose/fences around JSON");
    expect(AGENT_PROMPT).toMatch(/explicit requests[^.]*complete[^.]*override/i);
    expect(AGENT_PROMPT).toMatch(/verification[^.]*blockers/i);
    expect(AGENT_PROMPT).toMatch(/never hide failures[^.]*skip required checks/i);
    expect(AGENT_PROMPT).toMatch(/one execution/i);
    expect(AGENT_PROMPT).toMatch(/do not copy[^.]*data[^.]*model/i);
  });

  it("keeps efficiency steering always on even without optional resource activation", () => {
    const profile = generateAgentProfile(options);
    expect(profile.resources).toHaveLength(1);
    expect(profile.prompt).toContain("<=120 words");
    expect(profile.prompt).toContain("Match requested format exactly");
    expect(profile.prompt).toContain("no prose/fences around JSON");
    expect(profile.prompt).toContain("do not copy raw data through the model");
  });

  it("resolves tool bans before workflow advice, including pure computations", () => {
    const ban = AGENT_PROMPT.indexOf("if tools are forbidden, use none");
    const pipeline = AGENT_PROMPT.indexOf("Only when tools are allowed and needed:");
    expect(ban).toBeGreaterThanOrEqual(0);
    expect(pipeline).toBeGreaterThan(ban);
    expect(AGENT_PROMPT).toContain("User tool/output constraints override workflow advice");
    expect(AGENT_PROMPT).toContain("including pure computation, formatting or verification");
    expect(AGENT_PROMPT).not.toMatch(/^Read\/compute\/write\/verify/m);
  });

  it("keeps verification inside requested JSON and rechecks format without a tool", () => {
    expect(AGENT_PROMPT).toContain("Default only if unspecified");
    expect(AGENT_PROMPT).toContain("inside one valid JSON value");
    expect(AGENT_PROMPT).toContain("verification and blockers");
    expect(AGENT_PROMPT.trim().endsWith("Before sending, recheck the requested format without tools.")).toBe(true);
  });

  it("suppresses inter-tool commentary for JSON-only Kiro finalText", () => {
    expect(AGENT_PROMPT).toContain("JSON-only: omit visible commentary before/between tools");
    expect(AGENT_PROMPT).toContain("Kiro concatenates it into finalText");
  });

  it("makes review coverage mandatory without a findings quota or a brevity cutoff", () => {
    for (const clause of ["Correctness and coverage before speed", "do not stop early to save calls", "reviews/audits are exempt", 'fabric.help({topic:"review"})', "coverage ledger", "local.readMany", "Trace callers", "Try to disprove", "unreviewed scope", "conditional risks", "hidden:true", "totalLines", "zero matches is not whole-repo absence"]) expect(AGENT_PROMPT).toContain(clause);
    expect(typeCheckFabricCode('return await local.find({pattern:"**/*",hidden:true,limit:200});', fabricGuestDeclarations).errors).toEqual([]);
  });

  it("keeps proportional quality gates and quiet progress always on", () => {
    const prompt = generateAgentProfile(options).prompt;
    for (const rule of [/acceptance ledger/i, /trace[^.]*before editing/i, /public symbols, registrations and configuration/i,
      /targeted tests and behavioral probes/i, /build alone is not completion/i, /failures or cross-cutting risk/i,
      /unchanged passing checks/i, /explicitly blocked/i, /progress only for milestones, plan changes or blockers/i,
      /No tool narration\/repeated recap/i, /decisions, evidence and truncation flags, not logs/i, /inspect failures/i]) {
      expect(prompt).toMatch(rule);
    }
  });

  it("budgets the activated skill separately from standing text and on-demand help", () => {
    const skill = readFileSync(new URL("../skills/fabric-exec/SKILL.md", import.meta.url), "utf8");
    // Character budgets are input-growth guards, not token, billing or model-quality measurements.
    expect(skill.length).toBeLessThanOrEqual(10400);
    expect(AGENT_PROMPT.length + steering.length + skill.length).toBeLessThanOrEqual(MAX_STANDING_CHARS + 10400);
  });

  it("type-checks every documented local recipe", () => {
    const skill = readFileSync(new URL("../skills/fabric-exec/references/recipes.md", import.meta.url), "utf8");
    const recipes = [...skill.matchAll(/```ts\n(\/\/ Recipe:[\s\S]*?)\n```/g)].map(match => match[1]!);
    expect(recipes).toHaveLength(7);
    for (const code of recipes) expect(typeCheckFabricCode(code, fabricGuestDeclarations).errors, code).toEqual([]);
  });

  it("bounds standing guidance including the requested working rules", () => {
    expect(AGENT_PROMPT.length).toBeGreaterThan(0);
    expect(steering.length).toBeGreaterThan(0);
    expect(AGENT_PROMPT.length + steering.length).toBeLessThanOrEqual(MAX_STANDING_CHARS);
  });

  it("keeps a type-checked first-list input and native-free bootstrap examples", () => {
    const code = AGENT_PROMPT.match(/\{\s*code:\s*'([^']+)'\s*\}/)?.[1];
    expect(code).toBeDefined();
    expect(code).toMatch(/return\s+await\s+local\.list\(/);
    expect(code).toMatch(/path:\s*"\."/);
    expect(code).toMatch(/limit:\s*\d+/);
    expect(code).not.toMatch(/local[.]read|depth|README/);
    const skill = readFileSync(new URL("../skills/fabric-exec/SKILL.md", import.meta.url), "utf8");
    expect(skill).toContain(code!);
    expect(skill).not.toContain("For a first read:");
    expect(typeCheckFabricCode(code!, fabricGuestDeclarations).errors).toEqual([]);
    const bootstrap = AGENT_PROMPT.match(/return await fabric\.(?:info|help|workspace)\([^)]*\)/g) ?? [];
    expect(bootstrap).toHaveLength(3);
    expect(typeCheckFabricCode('return await fabric.help({topic:"review"});', fabricGuestDeclarations).errors).toEqual([]);
    for (const call of bootstrap) expect(typeCheckFabricCode(call, fabricGuestDeclarations).errors, call).toEqual([]);
    expect(AGENT_PROMPT).toMatch(/fabric\.workspace\(\{action:\s*"list"\}\)/);
    expect(AGENT_PROMPT).toMatch(/tools\.search\b[^.]*tools\.describe\b/);
    expect(AGENT_PROMPT).toMatch(/help[^.]*no native read/i);
    expect(AGENT_PROMPT).toContain("overview/api/skill/guide/recipes/workflow");
    expect(AGENT_PROMPT.match(/@fabric\/\w+/g)).toEqual(["@fabric/fabric_exec"]);
  });

  it("keeps line versus character offsets and a shell deadline with outer cleanup headroom", () => {
    expect(AGENT_PROMPT).toMatch(/local\.read offsets[^.]*one-based lines/i);
    expect(AGENT_PROMPT).toMatch(/overview\/api[^.]*zero-based character offset\/limit paging/i);
    expect(AGENT_PROMPT).toMatch(/shell[^.]*host \/bin\/sh/i);
    const maximum = Number(AGENT_PROMPT.match(/timeoutMs\s*<=\s*(\d+)/)?.[1]);
    const shell = Number(AGENT_PROMPT.match(/local\.shell\([^)]*timeoutMs:\s*(\d+)/)?.[1]);
    const outer = Number(AGENT_PROMPT.match(/outer timeoutMs:\s*(\d+)/)?.[1]);
    expect(maximum).toBe(FABRIC_MAX_GUEST_TIMEOUT_MS);
    expect(shell).toBeGreaterThan(0);
    expect(outer).toBeLessThanOrEqual(maximum);
    expect(outer).toBeGreaterThan(shell + FABRIC_COMPILER_TIMEOUT_MS + KIRO_MCP_DEADLINE_GRACE_MS);
    expect(AGENT_PROMPT).toMatch(/outer timeoutMs[^.]*overhead and cleanup/i);
  });

  it("retains nonduplicated installation and host-authority boundaries in steering", () => {
    expect(steering).toMatch(/code, tools and resources[^.]*session's generation/i);
    expect(steering).toMatch(/restart Kiro[^.]*update[^.]*not for compaction/i);
    expect(steering).toMatch(/installation directory[^.]*not the coding workspace/i);
    expect(steering).toMatch(/checked TypeScript[^.]*QuickJS/i);
    expect(steering).toMatch(/approved shell[^.]*host authority[^.]*not filesystem confinement/i);
  });

  it("serves optional bounded API pages from expanded declarations, including local APIs", async () => {
    // AUD-031: source-template/reference-file lengths are not runtime payloads.
    const provider = new FabricBootstrapProvider();
    expect(fabricGuestDeclarations).toContain(LOCAL_GUEST_DECLARATIONS);
    expect(LOCAL_GUEST_DECLARATIONS.length).toBeGreaterThan(0);
    expect(fabricGuestDeclarations.length).toBeGreaterThan(LOCAL_GUEST_DECLARATIONS.length);
    let offset = 0;
    let reconstructed = "";
    do {
      const page = await provider.invoke("help", { topic: "api", offset }, { cwd: "/not-a-workspace" }) as {
        topic: string; text: string; truncated: boolean; nextOffset?: number;
      };
      expect(page.topic).toBe("api");
      expect(page.text.length).toBeGreaterThan(0);
      expect(page.text.length).toBeLessThanOrEqual(8000);
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(provider.maxResultChars);
      expect(page.text).toBe(fabricGuestDeclarations.slice(offset, offset + page.text.length));
      reconstructed += page.text;
      offset += page.text.length;
      expect(page.truncated).toBe(offset < fabricGuestDeclarations.length);
      expect(page.nextOffset).toBe(page.truncated ? offset : undefined);
    } while (offset < fabricGuestDeclarations.length);
    expect(reconstructed).toBe(fabricGuestDeclarations);
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
            KIRO_FABRIC_LAUNCH_WORKSPACE: "${KIRO_FABRIC_LAUNCH_WORKSPACE}",
            KIRO_FABRIC_WORKSPACE_SOURCE: "launch-cwd",
            KIRO_FABRIC_RUNTIME_ROOT: options.runtimeRoot,
            KIRO_FABRIC_DATA_ROOT: options.dataRoot,
            KIRO_FABRIC_EXPECTED_NODE: options.nodePath,
          },
          waitForReady: true,
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

  it("binds executable, runtime and unchanged resource URIs to one complete generation", () => {
    const bundleRoot = path.resolve("/install/generations/fixture");
    const complete = {
      ...options, bundleRoot,
      nodePath: path.join(bundleRoot, "tools", "node"),
      rgPath: path.join(bundleRoot, "tools", "rg"),
      runtimeRoot: path.join(bundleRoot, "app"),
      skillPath: path.join(bundleRoot, "resources", "skills", "fabric-exec", "SKILL.md"),
      steeringPath: path.join(bundleRoot, "resources", "steering", "fabric.md"),
    };
    const profile = generateAgentProfile(complete);
    expect(profile.resources).toEqual([`skill://${complete.skillPath}`, `file://${complete.steeringPath}`]);
    // The first headless prompt must wait for the sole tool, including in complete bundles.
    expect(profile.mcpServers.fabric.waitForReady).toBe(true);
    expect(profile.mcpServers.fabric.env).toMatchObject({
      KIRO_FABRIC_BUNDLE_ROOT: bundleRoot,
      KIRO_FABRIC_RG: complete.rgPath,
      KIRO_FABRIC_EXPECTED_NODE: complete.nodePath,
      KIRO_FABRIC_RUNTIME_ROOT: complete.runtimeRoot,
    });
    for (const key of ["nodePath", "rgPath", "runtimeRoot", "skillPath", "steeringPath", "bundleRoot"] as const) {
      expect(() => generateAgentProfile({ ...complete, [key]: path.resolve("/other-generation") })).toThrow(/complete generation/);
    }
    for (const key of ["steeringPath", "rgPath", "bundleRoot"] as const) {
      const incomplete: Parameters<typeof generateAgentProfile>[0] = { ...complete };
      delete incomplete[key];
      expect(() => generateAgentProfile(incomplete)).toThrow(/complete generation/);
    }
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
