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
import { BUNDLED_GUIDANCE } from "../src/kiro/generated-guidance.js";
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

const skill = readFileSync(new URL("../skills/fabric-exec/SKILL.md", import.meta.url), "utf8");

// Task/safety obligations remain standing, even without optional steering.
// Former inline API mechanics are mapped below to canonical AND delivered help.
const promptContracts: Array<[string, RegExp]> = [
  ["strict one-tool Code Mode", /strict\s+always-on\s+Code Mode/i],
  ["no native fallback", /no native tools?[^.]*\bfallback/i],
  ["conversation without dummy calls", /conversation[^.]*(?:without|no)[^.]*empty tool calls/i],
  ["discovery before reads without a presumed README", /discover paths before reads; never assume README[.]md exists/i],
  ["search before bounded reads", /search[^.]*before reading[^.]*located ranges/i],
  ["independent batching and dependent sequencing", /batch independent[^.]*(?:sequence|sequential)[^.]*dependent[^.]*search\/read\/edit\/verify/i],
  ["awaited compact output", /await calls[^.]*return compact results/i],
  ["named edit payloads", /payloads for edit content/i],
  ["single verified root auto-binding", /single verified roots?[^.]*auto(?:matically|-binds?)/i],
  ["separate workspace selection", /fabric\.workspace\(\{action:\s*["']select["'],\s*rootId\}\)[^.]*separate execution[^.]*workspace effects/i],
  ["selection commits only on success", /pending selection[^.]*commits? only[^.]*successful (?:execution|settlement)/i],
  ["no cwd substitution", /never[^.]*process cwd[^.]*workspace/i],
  ["unavailable external capabilities stay unavailable", /lsp\/delegation[^.]*explicitly configured available MCP capability[^.]*otherwise report unavailable/i],
  ["on-demand browser grounding", /use web[.]search.*web[.]open.*ground facts/i],
  ["web still requires consent", /browser-harness-js.*normal network approval/i],
  ["nested approval is independent", /outer tool (?:allowance|permission)[^.]*(?:never|does not) approve[^.]*nested effects[^.]*each (?:nested )?action[^.]*Fabric approval policy/i],
  ["settle cannot swallow denial or cleanup failures", /denial[^.]*timeout[^.]*cancellation[^.]*uncertain cleanup[^.]*fail[^.]*settle\s*:\s*true/i],
  ["partial-effect recovery, not automatic replay", /propagate failures[^.]*inspect partial (?:effects|progress)[^.]*before retrying[^.]*never[^.]*replay[^.]*effectful program/i],
  ["verified completion", /verif(?:y|ication)[^.]*before[^.]*claim(?:ing)? completion/i],
  ["Kiro compaction and resume ownership", /Kiro owns[^.]*history[^.]*automatic(?:\/| and )manual[^.]*compaction[^.]*chat resume/i],
  ["continue Fabric after compaction", /after compaction[^.]*(?:keep|continue) using Fabric[^.]*(?:do not|never)[^.]*start[^.]*reconnect[^.]*replace/i],
  ["workspace state shared across chats", /Fabric memory\/state[^.]*workspace-scoped[^.]*shared[^.]*concurrent Kiro chats/i],
  ["intentional non-secret persistence only", /store only[^.]*intentional[^.]*non-secret[^.]*durable facts(?:\/| or )task state/i],
  ["no conversation mirroring", /never mirror[^.]*(?:whole|entire) conversation/i],
];
const mechanicsContracts: Array<[string, RegExp]> = [
  ["closed shallow-list interface", /local[.]list`? only when direct children are needed: path\/limit only, no depth/i],
  ["local workspace namespace", /local\s+(?:handles|holds)[^.]*workspace files\/search\/shell/i],
  ["configured MCP namespace", /mcp\s+(?:handles|calls)[^.]*explicitly configured external capabilities/i],
  ["durable workspace memory role", /\|\s*`memory`\s*\|[^\n]*durable[^|\n]*facts[^\n]*workspace-shared[^\n]*survives restart/i],
  ["revisioned workspace state role", /\|\s*`state`\s*\|[^\n]*structured values[^\n]*revision checks[^\n]*workspace-shared[^\n]*survives restart/i],
  ["create-only write default", /write[^.]*create-only unless\s+overwrite\s*:\s*true/i],
  ["exact unique edit anchor", /edit[^.]*exact nonempty unique anchor unless\s+all\s*:\s*true/i],
  ["no background guarantee", /no background job guarantee/i],
];

describe("Kiro Agent profile generation", () => {
  it.each(promptContracts)("keeps the standing contract: %s", (_name, rule) => {
    expect(AGENT_PROMPT).toMatch(rule);
  });

  it.each(mechanicsContracts)("keeps execution mechanics in canonical and delivered help: %s", (_name, rule) => {
    expect(skill).toMatch(rule);
    expect(BUNDLED_GUIDANCE.skill).toMatch(rule);
  });

  it("sets explicit task boundaries and proportional private planning without widening scope", () => {
    for (const rule of [/answer explains; plan proposes work; review investigates and reports; implement makes authorized changes and verifies them/i,
      /answer, plan and review do not authorize implementation/i,
      /necessary dependencies and checks are in scope, optional cleanup is not/i,
      /do not invent a broad audit for a focused task/i,
      /plan privately in proportion to uncertainty and risk/i,
      /requested outcome, key uncertainty, simplest credible method, evidence needed for acceptance/i,
      /straightforward work may need only one check, not a formal plan/i,
      /acceptance ledger in context, not unrequested reports/i]) expect(AGENT_PROMPT).toMatch(rule);
  });

  it("resumes unresolved checks, replans on evidence and stops at acceptance or honest blockers", () => {
    for (const rule of [/next unresolved check/i, /resume at that check after interruptions or compaction, not from the beginning/i,
      /replan only when new evidence or changed scope invalidates the approach/i,
      /adds no evidence, change the hypothesis or method rather than repeat it/i,
      /repeat unchanged passing checks only for a concrete reason/i,
      /changed dependencies or invalidated evidence/i,
      /specific missing evidence, prerequisite or permission and continue independent work/i,
      /when acceptance is satisfied, stop and deliver/i,
      /otherwise report the unresolved checks and exact blockers, not success/i]) expect(AGENT_PROMPT).toMatch(rule);
  });

  it("avoids ritual discovery and preserves complete requested output and evidence", () => {
    expect(AGENT_PROMPT).toContain("For workspace work only");
    expect(AGENT_PROMPT).toContain("if tools are forbidden, use none");
    expect(AGENT_PROMPT).toContain("General explanations need no workspace inspection");
    expect(AGENT_PROMPT).toMatch(/known task paths[^.]*skip[^.]*listing\/help/i);
    expect(AGENT_PROMPT).toMatch(/otherwise discover paths before reads/i);
    expect(AGENT_PROMPT).toContain("no arbitrary word target");
    expect(AGENT_PROMPT).toContain("no prose/fences around JSON");
    expect(AGENT_PROMPT).toMatch(/explicit requests[^.]*complete[^.]*override/i);
    expect(AGENT_PROMPT).toMatch(/verification[^.]*blockers/i);
    expect(AGENT_PROMPT).toMatch(/never hide failures[^.]*skip required checks/i);
    expect(AGENT_PROMPT).toMatch(/one execution/i);
    expect(AGENT_PROMPT).toMatch(/do not copy[^.]*data[^.]*model/i);
  });

  it("keeps completion and effort requirements always on without optional resource activation", () => {
    const profile = generateAgentProfile(options);
    expect(profile.resources).toHaveLength(1);
    expect(profile.prompt).toContain("Complete every requested outcome; minimize redundant instructions, repeated reads, intermediate output and avoidable tool exchanges");
    expect(profile.prompt).toContain("while a required outcome has a productive next step");
    expect(profile.prompt).toContain("Never label a request complete while a required outcome remains blocked");
    expect(profile.prompt).not.toMatch(/(?:<=|at most)\s*\d+\s*words/i);
    expect(profile.prompt).toContain("Match requested format exactly");
    expect(profile.prompt).toContain("no prose/fences around JSON");
    expect(profile.prompt).toMatch(/do not copy raw data through the model/i);
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
    expect(AGENT_PROMPT).toContain("Match requested format exactly");
    expect(AGENT_PROMPT).toContain("inside one valid JSON value");
    expect(AGENT_PROMPT).toContain("verification and blockers");
    expect(AGENT_PROMPT.trim().endsWith("recheck the requested format without tools.")).toBe(true);
    expect(AGENT_PROMPT).toContain("reconcile each finding headline with its evidence and consequence");
    expect(AGENT_PROMPT).toContain("remove self-disproved defects");
    expect(AGENT_PROMPT).toContain("missing runtime/configuration evidence means unverified");
    expect(AGENT_PROMPT).toContain("separate maintenance concerns");
  });

  it("suppresses inter-tool commentary for JSON-only Kiro finalText", () => {
    expect(AGENT_PROMPT).toContain("JSON-only: omit visible commentary before/between tools");
    expect(AGENT_PROMPT).toContain("Kiro concatenates it into finalText");
  });

  it("makes review coverage mandatory without a findings quota or a brevity cutoff", () => {
    for (const clause of ["Complete every requested outcome", "productive next step", "no arbitrary word target", "Review help is optional, not a required bootstrap", "coverage ledger", "local.readMany", "Trace callers", "Try to disprove", "unreviewed scope", "conditional risks", "zero matches is not whole-repo absence"]) expect(AGENT_PROMPT).toContain(clause);
    expect(AGENT_PROMPT).toMatch(/an initial sample is not a coverage limit/i);
    for (const clause of ["hidden:true", "totalLines"]) expect(skill).toContain(clause);
    for (const clause of ["success/failure/non-default scenarios", "caller through configuration/guards and consumer to consequence",
      "Fetched is not traced", "structural checks and green builds do not establish semantic correctness",
      "Complete every requested review area with evidence or an explicit blocker", "expected contract", "proof and counterexample verdict"])
      expect(AGENT_PROMPT).toContain(clause);
    expect(typeCheckFabricCode('return await local.find({pattern:"**/*",hidden:true,limit:200});', fabricGuestDeclarations).errors).toEqual([]);
  });

  it("keeps complete acceptance checks and useful progress always on", () => {
    const prompt = generateAgentProfile(options).prompt;
    for (const rule of [/acceptance ledger/i, /trace[^.]*before editing/i, /public symbols, registrations and configuration/i,
      /targeted tests and behavioral probes/i, /build alone is not completion/i, /failures or cross-cutting risk/i,
      /unchanged passing checks/i, /explicitly blocked/i, /progress only for milestones, plan changes or blockers/i,
      /No tool narration\/repeated recap/i, /decisions, evidence and truncation flags, not logs/i, /inspect failures/i]) {
      expect(prompt).toMatch(rule);
    }
  });

  it("type-checks every documented local recipe", () => {
    const skill = readFileSync(new URL("../skills/fabric-exec/references/recipes.md", import.meta.url), "utf8");
    const recipes = [...skill.matchAll(/```ts\n(\/\/ Recipe:[\s\S]*?)\n```/g)].map(match => match[1]!);
    expect(recipes.length).toBeGreaterThanOrEqual(8);
    for (const name of ["snapshot-bound same-file edits", "validator diagnostics then source"]) expect(recipes.some(code => code.includes('// Recipe: ' + name))).toBe(true);
    for (const code of recipes) expect(typeCheckFabricCode(code, fabricGuestDeclarations).errors, code).toEqual([]);
  });

  it("aligns discovery, causal-chain batching and native-free bootstrap examples", () => {
    const discovery = 'local.find({pattern:"**/*",hidden:true,limit:200})';
    const skill = readFileSync(new URL("../skills/fabric-exec/SKILL.md", import.meta.url), "utf8");
    const api = readFileSync(new URL("../skills/fabric-exec/references/api.md", import.meta.url), "utf8");
    const workflow = readFileSync(new URL("../skills/fabric-exec/references/workflow.md", import.meta.url), "utf8");
    // Policy stays standing; the exact discovery/transform recipes now live in help.
    expect(AGENT_PROMPT).toMatch(/compose mechanical dependencies in one exec/i);
    expect(AGENT_PROMPT).toContain("yield only for model judgment, safety/authorization, budget limits or recovery");
    expect(AGENT_PROMPT).toMatch(/batch independent calls, sequence dependent search\/read\/edit\/verify with sequential awaits/i);
    for (const text of [skill, api, workflow]) {
      expect(text).toContain("discovery -> bounded observed starter reads in the same exec");
      expect(text).toContain("standing execution/yield policy");
    }
    for (const clause of ["Batch causal chains with sequential awaits", "known-schema transform -> authorized write -> verification",
      "Fewer nested operations do not imply fewer model round trips"]) expect(skill).toContain(clause);
    for (const text of [AGENT_PROMPT, api, workflow]) expect(text).not.toContain("Fewer nested operations do not imply fewer model round trips");
    for (const text of [AGENT_PROMPT, skill, api, workflow]) {
      expect(text).toContain("aggregate output headroom");
      expect(text).toContain("continuation metadata");
      expect(text).not.toMatch(/(?:at most|no more than)\s+\d+\s+(?:tool |nested |exec )?calls/i);
    }
    for (const text of [skill, api]) {
      expect(text).toContain(discovery);
      expect(text).toMatch(/only when direct children are needed/);
      expect(text).not.toContain("begin inspection with `local.list");
    }
    expect(skill).toContain("Known task paths bypass discovery");
    expect(api).toContain("Use supplied/observed task paths directly");
    expect(workflow).toContain("Known task paths bypass discovery");
    const firstPrompt = readFileSync(new URL("../src/kiro/first-prompt-guidance.ts", import.meta.url), "utf8");
    expect(firstPrompt).not.toContain("batch related inspections and mechanical checks");
    expect(typeCheckFabricCode(`return await ${discovery};`, fabricGuestDeclarations).errors).toEqual([]);
    const bootstrap = AGENT_PROMPT.match(/return await fabric\.(?:info|help|workspace)\([^)]*\)/g) ?? [];
    expect(bootstrap).toHaveLength(0);
    expect(AGENT_PROMPT).toContain("no preliminary status/info/list call");
    expect(AGENT_PROMPT).toContain("Review help is optional, not a required bootstrap");
    expect(AGENT_PROMPT).not.toContain("load unknown fabric.help({topic:\"review\"})");
    expect(typeCheckFabricCode('return await fabric.help({topic:"review"});', fabricGuestDeclarations).errors).toEqual([]);
    for (const call of bootstrap) expect(typeCheckFabricCode(call, fabricGuestDeclarations).errors, call).toEqual([]);
    expect(AGENT_PROMPT).toMatch(/fabric\.workspace\(\{action:\s*"list"\}\)/);
    expect(AGENT_PROMPT).toMatch(/tools\.search\b[^.]*tools\.describe\b/);
    expect(AGENT_PROMPT).toMatch(/help[^.]*no native read/i);
    expect(AGENT_PROMPT).toContain("overview/api/skill/guide/recipes/workflow");
    expect(AGENT_PROMPT.match(/@fabric\/\w+/g)).toEqual(["@fabric/fabric_exec"]);
  });

  it("keeps line versus character offsets and a shell deadline with outer cleanup headroom in help", () => {
    for (const text of [skill, BUNDLED_GUIDANCE.skill]) {
      expect(text).toMatch(/local\.read offsets[^.]*one-based lines/i);
      expect(text).toMatch(/help uses zero-based UTF-16 offset\/limit paging/i);
      expect(text).toMatch(/shell[^.]*host \/bin\/sh/i);
      const maximum = Number(text.match(/timeoutMs\s*<=\s*(\d+)/)?.[1]);
      const shell = Number(text.match(/local\.shell\([^)]*timeoutMs:\s*(\d+)/)?.[1]);
      const outer = Number(text.match(/outer timeoutMs:\s*(\d+)/)?.[1]);
      expect(maximum).toBe(FABRIC_MAX_GUEST_TIMEOUT_MS);
      expect(shell).toBeGreaterThan(0);
      expect(outer).toBeLessThanOrEqual(maximum);
      expect(outer).toBeGreaterThan(shell + FABRIC_COMPILER_TIMEOUT_MS + KIRO_MCP_DEADLINE_GRACE_MS);
      expect(text).toMatch(/outer timeoutMs[^.]*overhead and cleanup/i);
    }
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
      expect(page.text.length).toBeLessThanOrEqual(16000);
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
      hooks: [{ name: "Fabric initial investigation", trigger: "UserPromptSubmit", action: { type: "command", command: `'${options.nodePath}' '${path.join(options.runtimeRoot, "kiro", "mcp-entry.js")}' '--first-prompt-hook' '${options.dataRoot}'` }, timeout: 5 }],
      mcpServers: {
        fabric: {
          command: options.nodePath,
          args: [path.join(options.runtimeRoot, "kiro", "mcp-entry.js")],
          env: {
            KIRO_FABRIC_LAUNCH_WORKSPACE: "${KIRO_FABRIC_LAUNCH_WORKSPACE}",
            KIRO_FABRIC_RUN_DECLARATION: "${KIRO_FABRIC_RUN_DECLARATION}",
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
