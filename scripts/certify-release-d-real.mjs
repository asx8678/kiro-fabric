#!/usr/bin/env node
// Opt-in non-billable Release-D Kiro parity gate. Uses the fake Kiro wrapper
// only; never sends a real model turn and refuses outright if the broader
// billable spike flag is enabled.

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REAL_GATE = "KIRO_FABRIC_RELEASE_D_REAL";
const BILLABLE_SPIKE = "KIRO_PHASE0_BILLABLE";
const KIRO_VERSION = "2.20.1";
const AGENT_ENGINE = "v3";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const fakeKiroBinary = join(root, "tests", "fixtures", "kiro", "fake-kiro-worker.mjs");
let work;

const fail = (message) => {
  throw new Error(message);
};

const assert = (condition, message) => {
  if (!condition) fail(message);
};

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: options.timeoutMs,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: String(result.stdout ?? "").slice(-16_384),
    stderr: String(result.stderr ?? "").slice(-16_384),
  };
}

function runJson(command, args, options = {}) {
  const result = runCapture(command, args, options);
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed (${result.status ?? result.signal ?? "unknown"}): ${result.stderr || result.stdout}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail(`expected JSON from ${command} ${args.join(" ")}: ${result.stdout}`);
  }
}

const gateMessage = `refusing to run: set ${REAL_GATE}=1 (non-billable fake-Kiro Release-D parity gate only)`;
let summaryLine = "FAIL: not started";

try {
  if (process.env[REAL_GATE] !== "1") fail(gateMessage);
  if (process.env[BILLABLE_SPIKE] === "1") {
    fail(`refusing to run: ${BILLABLE_SPIKE}=1 is set`);
  }
  if (!existsSync(fakeKiroBinary)) fail(`missing fake Kiro wrapper: ${fakeKiroBinary}`);

  work = mkdtempSync(join(tmpdir(), "kiro-fabric-release-d-real-"));
  const fakeKiroWrapper = join(work, "fake-kiro");
  writeFileSync(
    fakeKiroWrapper,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeKiroBinary)} "$@"\n`,
    { mode: 0o755 },
  );
  chmodSync(fakeKiroWrapper, 0o755);

  const packDir = join(work, "pack");
  mkdirSync(packDir);
  const pack = runCapture("npm", ["pack", "--ignore-scripts", "--pack-destination", packDir], {
    cwd: root,
    env: { ...process.env, NODE_PATH: "" },
    timeoutMs: 120_000,
  });
  if (pack.status !== 0) fail(`npm pack failed: ${pack.stderr || pack.stdout}`);
  const tarball = join(packDir, `${pkg.name}-${pkg.version}.tgz`);

  const consumer = join(work, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "release-d-real", private: true, type: "module" }, null, 2),
  );
  const installDeps = runCapture(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarball,
    ],
    { cwd: consumer, env: { ...process.env, NODE_PATH: "" }, timeoutMs: 180_000 },
  );
  if (installDeps.status !== 0) fail(`consumer install failed: ${installDeps.stderr || installDeps.stdout}`);

  const cli = join(consumer, "node_modules", ".bin", "kiro-fabric");
  const project = join(work, "project");
  mkdirSync(project);
  writeFileSync(join(project, "package.json"), '{"name":"release-d-real-fixture","private":true}\n');

  const installed = runJson(
    process.execPath,
    [cli, "install", "kiro", "--project-root", project, "--kiro-binary", fakeKiroWrapper, "--json"],
    { env: { ...process.env, NODE_PATH: "" }, timeoutMs: 60_000 },
  );
  assert(installed.action === "create", `install failed: ${JSON.stringify(installed)}`);

  // Exercise the installed Kiro profile's actual command path through MCP and
  // fabric_exec. This catches adapter/schema/runtime failures that direct
  // helper imports cannot prove.
  const installedProfile = JSON.parse(readFileSync(installed.profilePath, "utf8"));
  const fabricServer = installedProfile.mcpServers?.fabric;
  assert(fabricServer && typeof fabricServer.command === "string", "installed profile has no Fabric MCP command");
  const isolatedAgentDir = join(work, "pi-agent");
  mkdirSync(isolatedAgentDir);
  const mcpProbePath = join(consumer, "release-d-mcp-probe.mjs");
  writeFileSync(mcpProbePath, [
    'import { Client } from "@modelcontextprotocol/sdk/client/index.js";',
    'import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";',
    `const server = ${JSON.stringify(fabricServer)};`,
    `const cwd = ${JSON.stringify(project)};`,
    `const agentDir = ${JSON.stringify(isolatedAgentDir)};`,
    'const inherited = Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === "string"));',
    'const transport = new StdioClientTransport({',
    '  command: server.command,',
    '  args: server.args,',
    '  cwd,',
    '  env: { ...inherited, ...server.env, PI_CODING_AGENT_DIR: agentDir, KIRO_FABRIC_ALLOW_SHELL: "0" },',
    '  stderr: "pipe",',
    '});',
    'const client = new Client({ name: "release-d-certifier", version: "1.0.0" }, { capabilities: {} });',
    'try {',
    '  await client.connect(transport);',
    '  const listed = await client.listTools();',
    '  if (listed.tools.length !== 1 || listed.tools[0]?.name !== "fabric_exec") throw new Error("unexpected MCP tool catalog");',
    '  const result = await client.callTool({ name: "fabric_exec", arguments: { code: "return \\\"RELEASE_D_MCP_CONFIRMED\\\";" } });',
    '  const text = result.content?.filter((part) => part.type === "text").map((part) => part.text).join("\\n") ?? "";',
    '  if (result.isError || !text.includes("RELEASE_D_MCP_CONFIRMED")) throw new Error("fabric_exec MCP probe failed: " + text);',
    '  process.stdout.write(JSON.stringify({ ok: true, tools: listed.tools.map((tool) => tool.name), text }) + "\\n");',
    '} finally {',
    '  await client.close().catch(() => undefined);',
    '}',
  ].join("\n"));
  const mcpProbe = runJson(process.execPath, [mcpProbePath], {
    cwd: consumer,
    env: { ...process.env, NODE_PATH: "" },
    timeoutMs: 60_000,
  });

  const probePath = join(consumer, "release-d-probe.mjs");
  const probeContent = [
    'import fs from "node:fs";',
    'import os from "node:os";',
    'import path from "node:path";',
    `import { composeKiroSemanticHandoff, handoffFidelityOf, isKiroNode, kiroFeatureDiagnostics, openKiroMemory, recordKiroTopology } from ${JSON.stringify(`${pkg.name}/kiro`)};`,
    '',
    'const fail = (message) => { throw new Error(message); };',
    'const assert = (condition, message) => { if (!condition) fail(message); };',
    '',
    'const diagnostics = kiroFeatureDiagnostics();',
    'assert(diagnostics.length > 0, "expected Release-D diagnostics rows");',
    'for (const row of diagnostics) {',
    '  assert(row.supported === "qualified" || row.supported === "unavailable", "unsupported status for " + row.feature + ": " + row.supported);',
    '  assert(typeof row.diagnostic === "string" && row.diagnostic.length > 0, "missing diagnostic for " + row.feature);',
    '  if (row.supported === "qualified") {',
    '    assert(!/\\b(partial|unsupported|not yet proven)\\b/i.test(row.diagnostic), "qualified row contradicts itself: " + row.feature);',
    '  }',
    '}',
    '',
    'const handoff = composeKiroSemanticHandoff({ runnerSessionId: "release-d-session", lane: "certify-release-d" });',
    'assert(handoff.fidelity === "semantic", "unexpected handoff fidelity field: " + JSON.stringify(handoff));',
    'assert(handoffFidelityOf(handoff) === "semantic", "handoff fidelity helper did not report semantic");',
    'assert(typeof handoff.digest === "string" && handoff.digest.length > 0, "semantic handoff digest missing");',
    '',
    'const topoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-release-d-topology-"));',
    'const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-release-d-memory-"));',
    'try {',
    '  process.env.KIRO_FABRIC_PROJECT_ROOT = topoRoot;',
    '  process.env.KIRO_FABRIC_MESH_ROOT = path.join(topoRoot, "mesh");',
    '  const persisted = await recordKiroTopology({ rootId: "root-release-d", sessionId: "session-1", roles: ["main"] });',
    '  const hostEntry = { value: persisted.host };',
    '  const participantEntry = { value: persisted.participant };',
    '  assert(persisted.participant.runner === "kiro", "topology participant record was not written for the Kiro runner");',
    '  assert(isKiroNode(hostEntry) === true, "host entry did not identify as a Kiro topology node");',
    '  assert(isKiroNode(participantEntry) === true, "participant entry did not identify as a Kiro topology node");',
    '  assert(fs.existsSync(persisted.meshRoot), "topology mesh root was not persisted");',
    '  const persistedPaths = fs.readdirSync(persisted.meshRoot, { recursive: true }).map(String);',
    '  assert(persistedPaths.length > 0, "topology probe wrote no persisted state");',
    '  assert(!persistedPaths.some((entry) => entry.includes("sessions")), "topology probe should not depend on legacy/private session records");',
    '',
    '  const memory = openKiroMemory("release-d", memoryRoot);',
    '  let rejected = false;',
    '  try {',
    '    await memory.get("..");',
    '  } catch (error) {',
    '    rejected = error instanceof Error && error.name === "KiroMemoryScopeError";',
    '  }',
    '  assert(rejected, "memory binding accepted a key outside its namespace");',
    '',
    '  process.stdout.write(JSON.stringify({',
    '    ok: true,',
    '    diagnostics,',
    '    handoff,',
    '    topology: {',
    '      hosts: [persisted.hostKey],',
    '      participants: [persisted.participantKey],',
    '      participantKey: persisted.participantKey,',
    '      hostKey: persisted.hostKey,',
    '      legacySessionReadsRequired: false,',
    '    },',
    '    memory: { namespaceEscapeRejected: true },',
    '  }, null, 2) + "\\n");',
    '} finally {',
    '  delete process.env.KIRO_FABRIC_PROJECT_ROOT;',
    '  delete process.env.KIRO_FABRIC_MESH_ROOT;',
    '  fs.rmSync(topoRoot, { recursive: true, force: true });',
    '  fs.rmSync(memoryRoot, { recursive: true, force: true });',
    '}',
    '',
  ].join("\n");
  writeFileSync(probePath, probeContent);

  const probe = runJson(process.execPath, [probePath], {
    cwd: consumer,
    env: { ...process.env, NODE_PATH: "" },
    timeoutMs: 60_000,
  });

  const removed = runJson(process.execPath, [cli, "uninstall", "kiro", "--project-root", project, "--json"], {
    env: { ...process.env, NODE_PATH: "" },
    timeoutMs: 60_000,
  });
  assert(removed.action === "remove", `uninstall failed: ${JSON.stringify(removed)}`);

  const report = {
    ok: true,
    package: `${pkg.name}@${pkg.version}`,
    tuple: {
      node: pkg.engines?.node ?? ">=24",
      kiroVersion: KIRO_VERSION,
      agentEngine: AGENT_ENGINE,
      nonBillableOnly: true,
    },
    gate: REAL_GATE,
    install: {
      action: installed.action,
      profilePath: installed.profilePath,
    },
    mcpProbe,
    probe,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  summaryLine = "PASS: Release-D installed Kiro profile exercised MCP→fabric_exec plus qualified diagnostics, semantic handoff, topology, and memory refusal";
} catch (error) {
  summaryLine = `FAIL: ${error instanceof Error ? error.message : String(error)}`;
  process.exitCode = 1;
} finally {
  process.stdout.write(`${summaryLine}\n`);
  if (work) rmSync(work, { recursive: true, force: true });
}
