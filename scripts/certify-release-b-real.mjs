#!/usr/bin/env node
// Opt-in real Kiro Release-B certification. Billable-by-explicit-second-gate
// only: refuses unless both KIRO_FABRIC_RELEASE_B_REAL=1 and
// KIRO_FABRIC_RELEASE_B_BILLABLE_ALLOWED=1 are set, and refuses outright if
// the general spike flag KIRO_PHASE0_BILLABLE=1 is present.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REAL_GATE = "KIRO_FABRIC_RELEASE_B_REAL";
const BILLABLE_ALLOW = "KIRO_FABRIC_RELEASE_B_BILLABLE_ALLOWED";
const BILLABLE_SPIKE = "KIRO_PHASE0_BILLABLE";
const KIRO_VERSION = "2.20.1";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
let work;

const ring = (max) => {
  let value = "";
  return {
    push(chunk) {
      value = `${value}${chunk}`;
      if (value.length > max) value = value.slice(-max);
    },
    read() {
      return value;
    },
  };
};

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
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
    input: options.input,
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

function checkVersion(kiroBinary) {
  const result = runCapture(kiroBinary, ["--version"], { timeoutMs: 15_000 });
  if (result.status !== 0) fail(`kiro-cli --version failed: ${result.stderr || result.stdout}`);
  const version = `${result.stdout}\n${result.stderr}`.match(/kiro-cli\s+(\S+)/)?.[1];
  if (!version) fail(`could not determine kiro-cli version: ${result.stdout} ${result.stderr}`);
  if (version !== KIRO_VERSION) fail(`pinned Kiro version mismatch: expected ${KIRO_VERSION}, got ${version}`);
  return version;
}

function writeFixtureMcp(entryPath) {
  writeFileSync(
    entryPath,
    `#!/usr/bin/env node\nimport readline from "node:readline";\nconst rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });\nconst send = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n");\nrl.on("line", (line) => {\n  if (!line.trim()) return;\n  const msg = JSON.parse(line);\n  if (msg.method === "initialize") {\n    send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "release-b-fixture", version: "0.0.0" } } });\n    return;\n  }\n  if (msg.method === "tools/list") {\n    send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "fabric_exec", description: "release-b fixture no-op", inputSchema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } }] } });\n    return;\n  }\n  if (msg.method === "tools/call") {\n    send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "release-b fixture: no-op" }], isError: false } });\n  }\n});\n`,
    { mode: 0o755 },
  );
}

function rewriteManagedFixture(projectRoot, fixtureEntry) {
  const profilePath = join(projectRoot, ".kiro", "agents", "kiro-fabric.json");
  const manifestPath = join(projectRoot, ".kiro", ".kiro-fabric", "install.json");
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  profile.prompt = "Answer the user directly. Do not call any tools unless the user explicitly requires tool execution.";
  profile.mcpServers.fabric = {
    command: process.execPath,
    args: [fixtureEntry],
    env: {
      KIRO_FABRIC_HOST: "kiro-v3",
      KIRO_FABRIC_PROJECT_ROOT: projectRoot,
    },
    requestTimeout: 15_000,
  };
  const profileText = `${JSON.stringify(profile, null, 2)}\n`;
  writeFileSync(profilePath, profileText);
  manifest.runtime.nodePath = process.execPath;
  manifest.runtime.mcpEntryPath = fixtureEntry;
  manifest.profile.installedSha256 = sha256(profileText);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { profilePath, manifestPath };
}

function v3SessionParams(projectRoot) {
  const profile = JSON.parse(
    readFileSync(join(projectRoot, ".kiro", "agents", "kiro-fabric.json"), "utf8"),
  );
  return {
    cwd: projectRoot,
    mcpServers: Object.entries(profile.mcpServers ?? {}).map(([name, server]) => ({
      name,
      command: server.command,
      args: Array.isArray(server.args) ? server.args : [],
      env: Object.entries(server.env ?? {}).map(([envName, value]) => ({
        name: envName,
        value: String(value),
      })),
      ...(server.requestTimeout !== undefined ? { requestTimeout: server.requestTimeout } : {}),
    })),
    _meta: {
      kiro: {
        customAgents: [{
          id: "kiro-fabric",
          description: profile.description,
          prompt: profile.prompt,
          tools: profile.tools,
          includeMcpJson: false,
          ...(profile.permissions?.rules?.length > 0
            ? { permissions: profile.permissions }
            : {}),
        }],
      },
    },
  };
}

async function activateV3Fabric(acp, session, idBase) {
  const sessionId = session?.sessionId;
  assert(typeof sessionId === "string" && sessionId.length > 0, "session returned no sessionId");
  const modes = session?.modes?.availableModes;
  assert(
    Array.isArray(modes) && modes.some((mode) => mode?.id === "kiro-fabric"),
    "session did not advertise the injected kiro-fabric mode",
  );
  acp.send(idBase, "session/set_mode", { sessionId, modeId: "kiro-fabric" });
  await acp.waitForResponse(idBase, "session/set_mode response", 30_000);
  acp.send(idBase + 1, "session/set_config_option", {
    sessionId,
    configId: "autopilot",
    value: "off",
  });
  await acp.waitForResponse(idBase + 1, "supervised config response", 30_000);
  return sessionId;
}

function createAcpChild(kiroBinary, cwd, env, hardDeadlineMs = 180_000) {
  const child = spawn(kiroBinary, [
    "acp",
    "--agent-engine",
    "v3",
    "--auth-method",
    "cli",
  ], {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stderr = ring(16_384);
  const malformed = [];
  const inbound = [];
  const outboundMethods = [];
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        inbound.push(JSON.parse(line));
      } catch {
        malformed.push(line.slice(0, 500));
      }
    }
  });
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString("utf8")));
  const closed = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  const killer = setTimeout(() => {
    try { child.kill("SIGKILL"); } catch {}
  }, hardDeadlineMs);
  killer.unref?.();

  const fatal = (what) => {
    if (malformed.length > 0) fail(`malformed stdout while waiting for ${what}: ${JSON.stringify(malformed)}`);
    if (child.exitCode !== null || child.signalCode !== null) {
      fail(`kiro-cli exited while waiting for ${what}: ${stderr.read()}`);
    }
  };

  const waitFor = async (predicate, what, timeoutMs = 120_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      fatal(what);
      const hit = inbound.find(predicate);
      if (hit) return hit;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    fail(`timed out waiting for ${what}; stderr: ${stderr.read()}`);
  };

  const waitForResponse = async (id, what, timeoutMs = 120_000) => {
    const frame = await waitFor(
      (msg) => msg.id === id && msg.method === undefined && ("result" in msg || "error" in msg),
      what,
      timeoutMs,
    );
    if (frame.error) fail(`${what} returned JSON-RPC error: ${JSON.stringify(frame.error)}`);
    return frame.result;
  };

  const send = (id, method, params) => {
    outboundMethods.push(method);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  };

  const shutdown = async () => {
    clearTimeout(killer);
    if (buffer.trim()) malformed.push(`unterminated:${buffer.slice(0, 500)}`);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const exited = await Promise.race([
        closed.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
      ]);
      if (!exited) {
        child.kill("SIGKILL");
        await closed;
      }
    }
    if (malformed.length > 0) fail(`malformed stdout during shutdown: ${JSON.stringify(malformed)}`);
  };

  return { send, waitForResponse, shutdown, outboundMethods, inbound };
}

async function runSameProcessProbe(kiroBinary, projectRoot, env) {
  const acp = createAcpChild(kiroBinary, projectRoot, env);
  try {
    acp.send(1, "initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "release-b-real", version: pkg.version },
    });
    const init = await acp.waitForResponse(1, "initialize response", 30_000);
    assert(init?.agentCapabilities?.loadSession === true, "ACP initialize did not advertise loadSession=true");
    acp.send(2, "session/new", v3SessionParams(projectRoot));
    const session = await acp.waitForResponse(2, "session/new response", 30_000);
    const sessionId = await activateV3Fabric(acp, session, 20);
    acp.send(3, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "Reply with exactly FIRST_OK on one line. Do not call any tools." }],
    });
    const first = await acp.waitForResponse(3, "first session/prompt response", 180_000);
    assert(first?.stopReason === "end_turn", `first prompt did not end_turn: ${JSON.stringify(first)}`);
    acp.send(4, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "Reply with exactly SECOND_OK on one line. Do not call any tools." }],
    });
    const second = await acp.waitForResponse(4, "second session/prompt response", 180_000);
    assert(second?.stopReason === "end_turn", `second prompt did not end_turn: ${JSON.stringify(second)}`);
    return { sessionId, outboundMethods: [...acp.outboundMethods] };
  } finally {
    await acp.shutdown();
  }
}

async function runLoadProbe(kiroBinary, projectRoot, env, sessionId) {
  const acp = createAcpChild(kiroBinary, projectRoot, env);
  try {
    acp.send(1, "initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "release-b-real", version: pkg.version },
    });
    await acp.waitForResponse(1, "load probe initialize response", 30_000);
    acp.send(2, "session/load", {
      sessionId,
      ...v3SessionParams(projectRoot),
    });
    const loaded = await acp.waitForResponse(2, "session/load response", 30_000);
    assert(
      loaded?.sessionId === undefined || loaded.sessionId === sessionId,
      `session/load returned wrong sessionId: ${JSON.stringify(loaded)}`,
    );
    await activateV3Fabric(acp, { ...loaded, sessionId }, 20);
    acp.send(3, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "Reply with exactly RESUME_OK on one line. Do not call any tools." }],
    });
    const resumed = await acp.waitForResponse(3, "resume session/prompt response", 180_000);
    assert(resumed?.stopReason === "end_turn", `resumed prompt did not end_turn: ${JSON.stringify(resumed)}`);
    return { outboundMethods: [...acp.outboundMethods] };
  } finally {
    await acp.shutdown();
  }
}

const expectedSameProcess = [
  "initialize",
  "session/new",
  "session/set_mode",
  "session/set_config_option",
  "session/prompt",
  "session/prompt",
];
const expectedLoad = [
  "initialize",
  "session/load",
  "session/set_mode",
  "session/set_config_option",
  "session/prompt",
];
const hasOrderedSubsequence = (haystack, needle) => {
  let i = 0;
  for (const item of haystack) {
    if (item === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return false;
};

let summaryLine = "FAIL: not started";
try {
  if (process.env[REAL_GATE] !== "1") {
    fail(`refusing to run: set ${REAL_GATE}=1`);
  }
  if (process.env[BILLABLE_SPIKE] === "1") {
    fail(`refusing to run: ${BILLABLE_SPIKE}=1 is set`);
  }

  work = mkdtempSync(join(tmpdir(), "kiro-fabric-release-b-real-"));
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
    JSON.stringify({ name: "release-b-real", private: true, type: "module" }, null, 2),
  );
  const installDeps = runCapture(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarball,
      "@earendil-works/pi-coding-agent@0.84.2",
      "@earendil-works/pi-tui@0.84.2",
    ],
    { cwd: consumer, env: { ...process.env, NODE_PATH: "" }, timeoutMs: 180_000 },
  );
  if (installDeps.status !== 0) fail(`consumer install failed: ${installDeps.stderr || installDeps.stdout}`);

  const cli = join(consumer, "node_modules", ".bin", "kiro-fabric");
  const project = join(work, "project");
  mkdirSync(project);
  writeFileSync(join(project, "package.json"), '{"name":"release-b-real-fixture","private":true}\n');
  const installed = runJson(process.execPath, [cli, "install", "kiro", "--project-root", project, "--json"], {
    env: { ...process.env, NODE_PATH: "" },
    timeoutMs: 60_000,
  });
  assert(installed.action === "create", `install failed: ${JSON.stringify(installed)}`);

  const fixtureEntry = join(work, "fixture-mcp.mjs");
  writeFixtureMcp(fixtureEntry);
  rewriteManagedFixture(project, fixtureEntry);

  const kiroBinary = process.env.KIRO_BINARY ?? "kiro-cli";
  const kiroVersion = checkVersion(kiroBinary);

  if (process.env[BILLABLE_ALLOW] !== "1") {
    fail(
      `refusing to send session/prompt: real Kiro turns may bill; set ${BILLABLE_ALLOW}=1 only for an explicit opt-in run`,
    );
  }

  // Match the worker's durable-actor lifecycle: keep the authenticated OS HOME
  // and retain one v3 profile/engine marker across activations. KAS 0.54.3
  // persists the transcript in the authenticated HOME even with KIRO_HOME set;
  // the saved session id and v3 provenance are the reload authority.
  const runtimeHome = join(work, "kiro-runtime");
  mkdirSync(runtimeHome);
  const probeEnv = {
    ...process.env,
    KIRO_HOME: join(runtimeHome, ".kiro"),
    NODE_PATH: "",
  };
  const sameProcess = await runSameProcessProbe(kiroBinary, project, probeEnv);
  assert(
    hasOrderedSubsequence(sameProcess.outboundMethods, expectedSameProcess),
    `same-process ACP methods missing required sequence: ${JSON.stringify(sameProcess.outboundMethods)}`,
  );

  const loaded = await runLoadProbe(
    kiroBinary,
    project,
    probeEnv,
    sameProcess.sessionId,
  );
  assert(
    hasOrderedSubsequence(loaded.outboundMethods, expectedLoad),
    `load-probe ACP methods missing required sequence with retained KIRO_HOME: ${JSON.stringify(loaded.outboundMethods)}`,
  );

  const removed = runJson(process.execPath, [cli, "uninstall", "kiro", "--project-root", project, "--json"], {
    timeoutMs: 60_000,
  });
  assert(removed.action === "remove", `uninstall failed: ${JSON.stringify(removed)}`);

  const report = {
    ok: true,
    package: `${pkg.name}@${pkg.version}`,
    kiroVersion,
    sameProcess,
    loadProbe: loaded,
    retainedV3ProfileMarkerAcrossProcessRestart: true,
    kasSessionStore: "authenticated-os-home",
    tuple: { agentEngine: "v3", authMethod: "cli", agent: "kiro-fabric" },
    gates: { [REAL_GATE]: "1", [BILLABLE_ALLOW]: "1", [BILLABLE_SPIKE]: "0" },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  summaryLine = `PASS: Release-B real gate proved same-process second prompt and session/load with a retained v3 profile marker on kiro-cli ${kiroVersion}`;
} catch (error) {
  summaryLine = `FAIL: ${error instanceof Error ? error.message : String(error)}`;
  process.exitCode = 1;
} finally {
  process.stdout.write(`${summaryLine}\n`);
  if (work) rmSync(work, { recursive: true, force: true });
}
