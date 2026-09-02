#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SUPPORTED_KIRO = "2.20.1";
const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ERROR_DIAGNOSTIC = /^\s*(?:error|fatal|invalid)\s*[:\[]/imu;
const fail = (message) => { throw new Error(`development agent validation failed: ${message}`); };
const sameStrings = (actual, expected) =>
  Array.isArray(actual) && actual.length === expected.length &&
  actual.every((value, index) => value === expected[index]);

export const validateDevelopmentProfile = (root = SCRIPT_ROOT) => {
  const canonicalRoot = fs.realpathSync(path.resolve(root));
  const profilePath = path.join(canonicalRoot, ".kiro", "agents", "kiro-fabric-dev.json");
  let profile;
  try {
    profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  } catch (error) {
    fail(`cannot read ${profilePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (profile.name !== "kiro-fabric-dev" || profile.name === "kiro-fabric") {
    fail("profile name must be kiro-fabric-dev and must not collide with installer-owned kiro-fabric");
  }
  if (profile.includeMcpJson !== false || profile.includePowers !== false) {
    fail("includeMcpJson and includePowers must both be false to block ambient capabilities");
  }
  const resources = [
    "file://.kiro/steering/tech.md",
    "file://.kiro/steering/structure.md",
    "skill://.kiro/skills/**/SKILL.md",
  ];
  if (!sameStrings(profile.resources, resources)) {
    fail("resources must bind only compact universal steering plus lazy repository skills");
  }
  const server = profile.mcpServers?.fabric;
  if (!server || server.command !== "node" || !sameStrings(server.args, ["scripts/run-kiro-fabric-dev.mjs"])) {
    fail("fabric MCP must run the confined repository development launcher");
  }
  if (server.env?.KIRO_FABRIC_HOST !== "kiro-v3" ||
      server.env?.KIRO_FABRIC_PROFILE_KIND !== "managed-main" ||
      Object.hasOwn(server.env ?? {}, "KIRO_FABRIC_INTEGRATION")) {
    fail("fabric MCP environment must select managed-main, never Power");
  }
  const onlyTool = ["@fabric/fabric_exec"];
  if (!sameStrings(profile.tools, onlyTool) || !sameStrings(profile.allowedTools, onlyTool)) {
    fail("code mode requires @fabric/fabric_exec to be the only visible and allowed tool");
  }
  if (!/code mode is mandatory/iu.test(profile.prompt ?? "") ||
      !/every repository operation/iu.test(profile.prompt ?? "") ||
      !/including a single read/iu.test(profile.prompt ?? "") ||
      !/never invoke native repository tools/iu.test(profile.prompt ?? "")) {
    fail("profile prompt must require Fabric code mode for every repository operation");
  }
  const rules = profile.permissions?.rules;
  const rule = Array.isArray(rules) && rules.length === 1 ? rules[0] : undefined;
  if (!rule || rule.capability !== "mcp" || rule.effect !== "ask" ||
      !sameStrings(rule.match, ["fabric/fabric_exec"]) ||
      Object.keys(rule).some((key) => !["capability", "match", "effect"].includes(key))) {
    fail("code mode must retain one exact approval rule for fabric/fabric_exec");
  }
  return { root: canonicalRoot, profilePath, profile, server };
};

export const runKiroAgentValidator = (command, profilePath) => {
  const completed = spawnSync(command.command, [...(command.args ?? []), "agent", "validate", "--path", profilePath], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (completed.error) throw completed.error;
  const output = `${completed.stdout ?? ""}\n${completed.stderr ?? ""}`;
  if (completed.status !== 0 || ERROR_DIAGNOSTIC.test(output)) {
    fail(`kiro-cli agent validate rejected ${profilePath}: ${output.trim().slice(0, 2000) || `exit ${completed.status}`}`);
  }
  return output.trim();
};

export const validateWithInstalledKiro = (profilePath, binary = "kiro-cli", required = false) => {
  const version = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 10_000 });
  if (version.error && version.error.code === "ENOENT") {
    if (required) fail(`supported kiro-cli ${SUPPORTED_KIRO} is missing (${binary})`);
    return { status: "unavailable", reason: `supported kiro-cli ${SUPPORTED_KIRO} is not installed` };
  }
  if (version.error || version.status !== 0) {
    fail(`cannot execute ${binary} --version: ${version.error?.message ?? version.stderr ?? version.stdout}`);
  }
  const combined = `${version.stdout ?? ""}\n${version.stderr ?? ""}`;
  const observed = combined.match(/\bkiro-cli\s+(\d+\.\d+\.\d+)\b/u)?.[1];
  if (observed !== SUPPORTED_KIRO) {
    fail(`missing supported Kiro CLI: expected ${SUPPORTED_KIRO}, observed ${observed ?? "unparseable output"}`);
  }
  const output = runKiroAgentValidator({ command: binary }, profilePath);
  return { status: "passed", version: observed, output };
};

export const smokeDevelopmentMcp = async (root = SCRIPT_ROOT) => {
  const validated = validateDevelopmentProfile(root);
  const current = fs.realpathSync(process.cwd());
  if (current !== validated.root) {
    fail(`invalid working directory ${current}; run from repository root ${validated.root}`);
  }
  const launcher = path.join(validated.root, validated.server.args[0]);
  const builtEntry = path.join(validated.root, "dist", "kiro", "mcp-entry.js");
  for (const [label, file] of [["development launcher", launcher], ["built MCP entry", builtEntry]]) {
    let stats;
    try {
      stats = fs.lstatSync(file);
    } catch {
      fail(`missing ${label} ${file}; run pnpm run build first`);
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      fail(`${label} must be a regular non-symlink file: ${file}`);
    }
  }
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-dev-agent-"));
  const inherited = Object.fromEntries(Object.entries(process.env)
    .filter(([, value]) => typeof value === "string"));
  const transport = new StdioClientTransport({
    command: validated.server.command,
    args: validated.server.args,
    cwd: validated.root,
    env: {
      ...inherited,
      ...validated.server.env,
      // The launcher must replace conflicting ambient mode/grant variables
      // with its exact code-only, checkout-confined development contract.
      KIRO_FABRIC_INTEGRATION: "power",
      KIRO_FABRIC_ENABLE_SUBAGENTS: "1",
      KIRO_FABRIC_ALLOW_TOOLS: "1",
      PI_CODING_AGENT_DIR: path.join(isolated, "pi-agent"),
      KIRO_HOME: path.join(isolated, "kiro-home"),
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "kiro-fabric-dev-validator", version: "1.0.0" }, { capabilities: {} });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    if (listed.tools.length !== 1 || listed.tools[0]?.name !== "fabric_exec") {
      fail(`unexpected MCP tool boundary: ${listed.tools.map((tool) => tool.name).join(", ") || "(empty)"}`);
    }
    const result = await client.callTool({
      name: "fabric_exec",
      arguments: { code: "return 6 * 7;" },
    });
    const output = result.content
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n") ?? "";
    if (result.isError || output.trim() !== "42") {
      fail(`pure fabric_exec smoke failed: ${output || "no text result"}`);
    }
    const repository = await client.callTool({
      name: "fabric_exec",
      arguments: {
        code: [
          'const source = await k.read({ path: "package.json", offset: 1, limit: 8 });',
          'const shell = await k.bash({ command: "printf code-mode-shell" });',
          'return { read: source.includes(\'"name": "kiro-fabric"\'), shell: shell.output };',
        ].join("\n"),
        resultFormat: "json",
      },
    });
    const repositoryOutput = repository.content
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n") ?? "";
    let repositoryResult;
    try {
      repositoryResult = JSON.parse(repositoryOutput);
    } catch {
      fail(`code-mode repository smoke returned invalid JSON: ${repositoryOutput || "no text result"}`);
    }
    if (repository.isError || repositoryResult?.read !== true || repositoryResult?.shell !== "code-mode-shell") {
      fail(`code-mode repository smoke failed: ${repositoryOutput || "no text result"}`);
    }
    return { tools: listed.tools.map((tool) => tool.name), result: output.trim() };
  } finally {
    await client.close().catch(() => undefined);
    fs.rmSync(isolated, { recursive: true, force: true });
  }
};

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) {
  try {
    const required = process.argv.includes("--require-kiro");
    const binaryArg = process.argv.find((value) => value.startsWith("--kiro-binary="));
    const binary = binaryArg?.slice("--kiro-binary=".length) || process.env.KIRO_BINARY || "kiro-cli";
    const validated = validateDevelopmentProfile();
    const kiro = validateWithInstalledKiro(validated.profilePath, binary, required);
    const mcp = await smokeDevelopmentMcp();
    process.stdout.write(`${JSON.stringify({ ok: true, profile: validated.profilePath, kiro, mcp })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
