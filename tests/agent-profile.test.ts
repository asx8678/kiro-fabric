import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FABRIC_TOOLS, generateAgentProfile } from "../scripts/agent-profile.mjs";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";
import { FABRIC_COMPILER_TIMEOUT_MS } from "../src/execution-service.js";
import { FIRST_PROMPT_GUIDANCE } from "../src/kiro/first-prompt-guidance.js";
import { kiroMcpOuterDeadlineMs } from "../src/kiro/deadlines.js";

const options = {
  nodePath: path.resolve("/runtime/node"),
  runtimeRoot: path.resolve("/install/runtime"),
  dataRoot: path.resolve("/install/data"),
  skillPath: path.resolve("/install/skills/fabric-exec/SKILL.md"),
};

// Independent test bounds for the private production constants (core-port pattern).
// The product maximum stays a literal so the bound is verified, not restated; the
// client-response margin is the independent positive bound; internal/request
// envelopes are derived through the public deadline formula.
const FABRIC_MAX_GUEST_TIMEOUT_MS = 900_000;
const FABRIC_MCP_CLIENT_RESPONSE_MARGIN_MS = 5_000;
const FABRIC_MCP_INTERNAL_DEADLINE_MS = kiroMcpOuterDeadlineMs(FABRIC_MAX_GUEST_TIMEOUT_MS, FABRIC_COMPILER_TIMEOUT_MS);
const FABRIC_MCP_REQUEST_TIMEOUT_MS = FABRIC_MCP_INTERNAL_DEADLINE_MS + FABRIC_MCP_CLIENT_RESPONSE_MARGIN_MS;
const KIRO_MCP_DEADLINE_GRACE_MS = FABRIC_MCP_INTERNAL_DEADLINE_MS - FABRIC_MAX_GUEST_TIMEOUT_MS - FABRIC_COMPILER_TIMEOUT_MS;

const skill = readFileSync(new URL("../skills/fabric-exec/SKILL.md", import.meta.url), "utf8");

// Prompt wording is reviewed as prose; tests own generated configuration and executable examples.
describe("Kiro Agent profile generation", () => {
  it("type-checks every documented local recipe", () => {
    const skill = readFileSync(new URL("../skills/fabric-exec/references/recipes.md", import.meta.url), "utf8");
    const recipes = [...skill.matchAll(/```ts\n(\/\/ Recipe:[\s\S]*?)\n```/g)].map(match => match[1]!);
    expect(recipes.length).toBeGreaterThanOrEqual(8);
    for (const name of ["snapshot-bound same-file edits", "validator diagnostics then source"]) expect(recipes.some(code => code.includes('// Recipe: ' + name))).toBe(true);
    for (const code of recipes) expect(typeCheckFabricCode(code, fabricGuestDeclarations).errors, code).toEqual([]);
  });

  it("documents a shell deadline with outer cleanup headroom", () => {
    const maximum = Number(skill.match(/timeoutMs\s*<=\s*(\d+)/)?.[1]);
    const shell = Number(skill.match(/local\.shell\([^)]*timeoutMs:\s*(\d+)/)?.[1]);
    const outer = Number(skill.match(/outer timeoutMs:\s*(\d+)/)?.[1]);
    expect(maximum).toBe(FABRIC_MAX_GUEST_TIMEOUT_MS);
    expect(shell).toBeGreaterThan(0);
    expect(outer).toBeLessThanOrEqual(maximum);
    expect(outer).toBeGreaterThan(shell + FABRIC_COMPILER_TIMEOUT_MS + KIRO_MCP_DEADLINE_GRACE_MS);
  });

  it("generates the global installed profile without optional steering", () => {
    const expectedPrompt = generateAgentProfile(options).prompt;
    const profile = generateAgentProfile(options);
    expect(profile.prompt).toBe(expectedPrompt);
    expect(profile).toEqual({
      name: "kiro-fabric",
      description: "Kiro Fabric coding agent with strict always-on checked-TypeScript Code Mode.",
      prompt: expectedPrompt,
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
            KIRO_FABRIC_FOVEA_CALL_CONTEXT: "1",
            KIRO_FABRIC_RUNTIME_ROOT: options.runtimeRoot,
            KIRO_FABRIC_DATA_ROOT: options.dataRoot,
            KIRO_FABRIC_EXPECTED_NODE: options.nodePath,
          },
          waitForReady: true,
          requestTimeout: FABRIC_MCP_REQUEST_TIMEOUT_MS,
        },
      },
      tools: ["@fabric/fabric_exec"],
      allowedTools: ["@fabric/fabric_exec"],
      permissions: {
        rules: [{
          capability: "mcp",
          match: ["fabric/fabric_exec"],
          effect: "allow",
        }],
      },
    });
    expect(profile.tools).toEqual(["@fabric/fabric_exec"]);
    expect(profile.allowedTools).toEqual(["@fabric/fabric_exec"]);
    expect(FABRIC_TOOLS).toEqual(["fabric_info", "fabric_workspace", "fabric_exec"]);
    expect(profile).not.toHaveProperty("disableInheritingDefaultResources");
    // No native tool is auto-approved: every advertised tool is a Fabric tool.
    expect(profile.tools.every((tool: string) => tool.startsWith("@fabric/"))).toBe(true);
    expect(JSON.stringify(profile)).not.toMatch(/fs_write|execute_bash/);
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

  it("bounds the standing prompt, first-turn hook and attached skill", () => {
    // Count configured source text, including the full skill when activated.
    // These guard against bloat; they do not measure delivery, tokens or quality.
    const prompt = generateAgentProfile(options).prompt;
    expect(prompt.length).toBeLessThanOrEqual(8_600);
    expect(FIRST_PROMPT_GUIDANCE.length).toBeLessThanOrEqual(1_000);
    expect(skill.length).toBeLessThanOrEqual(8_500);
    expect(prompt.length + FIRST_PROMPT_GUIDANCE.length).toBeLessThanOrEqual(9_600);
    expect(prompt.length + FIRST_PROMPT_GUIDANCE.length + skill.length).toBeLessThanOrEqual(18_000);
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
