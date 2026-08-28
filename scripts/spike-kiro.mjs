#!/usr/bin/env node
// Kiro CLI capability spike harness for kiro-fabric (Phase 1, PR2).
//
// Non-billable probes (default): handshake, profile, mcp. These never send a
// session/prompt and never invoke a model turn.
//
// Billable probes require KIRO_PHASE0_BILLABLE=1 and an explicit probe name;
// `all` deliberately excludes them. `billable-all` runs every billable probe
// sequentially and is itself gated.
//
// Hard rules baked in from the gate review:
// - Unknown probe names exit non-zero (no silent no-ops).
// - Malformed/non-JSON stdout from Kiro fails the probe (never discarded).
// - The Kiro version is pinned; override with KIRO_EXPECT_VERSION.
// - Waits are predicate-based with deadlines, not fixed sleeps.
// - Every spawned child gets a hard timeout and bounded shutdown assertion.
// - Kiro runs in its own process group so MCP fixtures die with it.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const command = process.argv[2] ?? "";
const timeout = Number(process.env.KIRO_TIMEOUT_MS ?? 15_000);
const binary = process.env.KIRO_BINARY ?? "kiro-cli";
// Optional extra argv prepended to every Kiro invocation (e.g. a wrapper
// script path when KIRO_BINARY=node in tests).
const binaryArgs = (process.env.KIRO_BINARY_ARGS ?? "").split(" ").filter(Boolean);
const expectVersion = process.env.KIRO_EXPECT_VERSION ?? "2.20.1";
const billableEnabled = process.env.KIRO_PHASE0_BILLABLE === "1";
// `auto` is the universally safe v3 route. Accounts with a
// larger inventory can still pin a probe model through KIRO_PROBE_MODEL.
const MODEL = process.env.KIRO_PROBE_MODEL ?? "auto";
const V3_ACP_ARGS = ["--agent-engine", "v3", "--auth-method", "cli"];
const FIXTURE_SERVER = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "tests",
  "fixtures",
  "kiro",
  "probe-mcp-server.mjs",
);

const BILLABLE_PROBES = new Set([
  "mcp-cancel",
  "mcp-elicit",
  "long-request",
  "one-tool",
  "acp-cancel",
  "child-deny",
]);
const SAFE_PROBES = new Set(["handshake", "profile", "mcp"]);
const AGGREGATES = new Set(["all", "billable-all", "plan"]);

function fail(message) {
  throw new Error(message);
}

async function checkVersion() {
  const result = await run(binary, [...binaryArgs, "--version"]);
  const version = (result.stdout + result.stderr).match(/kiro-cli\s+(\S+)/)?.[1];
  if (!version) fail(`could not determine kiro-cli version: ${result.stdout} ${result.stderr}`);
  if (version !== expectVersion) {
    fail(`pinned Kiro version mismatch: expected ${expectVersion}, got ${version} (set KIRO_EXPECT_VERSION to test another version)`);
  }
  return version;
}

function run(cmd, args, input, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: null, signal: "SIGKILL", stdout, stderr, timedOut: true });
    }, timeout);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut: false });
    });
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
  });
}

// ACP child wrapper: JSON-lines reader that records malformed lines as fatal
// evidence, predicate waiting, and a hard process deadline. Kiro is spawned in
// its own process group (detached) so group-kill also reaps MCP fixtures.
function acpChild(args, cwd, hardDeadlineMs = timeout) {
  const startedAt = Date.now();
  const child = spawn(binary, [...binaryArgs, ...args], { cwd, stdio: ["pipe", "pipe", "pipe"], detached: true });
  const messages = [];
  const malformed = [];
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        messages.push({ atMs: Date.now() - startedAt, msg: JSON.parse(line) });
      } catch {
        malformed.push(line.slice(0, 500));
      }
    }
  });

  const closed = new Promise((resolve) => child.once("close", resolve));
  child.on("error", (error) => {
    malformed.push(`spawn error: ${error.message}`);
  });
  const killer = setTimeout(() => killGroup("SIGKILL"), hardDeadlineMs);

  function killGroup(signal) {
    try {
      // Negative PID targets the whole group (Kiro + fixture MCP servers).
      process.kill(-child.pid, signal);
    } catch {
      try { child.kill(signal); } catch { /* already gone */ }
    }
  }

  function checkFatal(what) {
    if (malformed.length > 0) fail(`malformed stdout from Kiro: ${JSON.stringify(malformed)}`);
    if (child.exitCode !== null || child.signalCode !== null) {
      fail(
        `Kiro exited while waiting for ${what}; saw: ${JSON.stringify(messages.map((entry) => entry.msg))}; stderr: ${stderr.slice(-1000)}`,
      );
    }
  }

  async function waitFor(predicate, what, deadlineMs = timeout) {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
      checkFatal(what);
      const hit = messages.find((m) => predicate(m.msg));
      if (hit) return hit.msg;
      await new Promise((r) => setTimeout(r, 25));
    }
    fail(`timed out waiting for ${what}; saw: ${JSON.stringify(messages.map((m) => m.msg.method ?? `id:${m.msg.id}`))}; stderr: ${stderr.slice(-1000)}`);
  }

  // Response matching hardened per gate review: an inbound agent request can
  // reuse an outbound request ID, so responses must have no `method`.
  function isResponse(m, id) {
    return m.id === id && m.method === undefined && ("result" in m || "error" in m);
  }

  async function waitForResponse(id, what, deadlineMs = timeout) {
    const msg = await waitFor((m) => isResponse(m, id), what, deadlineMs);
    if (msg.error) fail(`${what} returned JSON-RPC error: ${JSON.stringify(msg.error)}`);
    return msg;
  }

  function send(obj) {
    try {
      child.stdin.write(JSON.stringify(obj) + "\n");
    } catch (error) {
      fail(`failed writing to Kiro stdin: ${error.message}`);
    }
  }

  async function shutdown() {
    clearTimeout(killer);
    // Any trailing unterminated stdout fragment is malformed protocol data.
    if (buffer.trim()) malformed.push(`unterminated: ${buffer.slice(0, 500)}`);
    if (child.exitCode === null && child.signalCode === null) {
      killGroup("SIGTERM");
      const settled = await Promise.race([
        closed.then(() => true),
        new Promise((r) => setTimeout(() => r(false), 5_000)),
      ]);
      if (!settled) {
        killGroup("SIGKILL");
        const reaped = await Promise.race([
          closed.then(() => true),
          new Promise((r) => setTimeout(() => r(false), 2_000)),
        ]);
        if (!reaped) fail("Kiro did not exit within 2s of SIGKILL");
        fail("Kiro did not exit within 5s of SIGTERM (escalated to SIGKILL)");
      }
    }
    if (malformed.length > 0) fail(`malformed stdout from Kiro: ${JSON.stringify(malformed)}`);
  }

  return { child, send, waitFor, waitForResponse, shutdown, get stderr() { return stderr; }, get messages() { return messages; } };
}

function acpInitParams(extraClientCapabilities = {}) {
  return {
    protocolVersion: 1,
    clientCapabilities: extraClientCapabilities,
    clientInfo: { name: "kiro-fabric-spike", version: "0.0.0" },
  };
}

async function probeHandshake() {
  const acp = acpChild(["acp", ...V3_ACP_ARGS], process.cwd());
  try {
    acp.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: acpInitParams() });
    const init = await acp.waitForResponse(1, "initialize response");
    if (!init?.result?.agentCapabilities) fail("ACP initialize returned no agentCapabilities");
    acp.send({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: process.cwd(), mcpServers: [] } });
    const session = await acp.waitForResponse(2, "session/new response");
    const result = session?.result;
    if (!result?.sessionId) fail("session/new returned no sessionId");
    const controls = {};
    if (process.env.KIRO_PROBE_SESSION_CONTROLS === "1") {
      acp.send({
        jsonrpc: "2.0",
        id: 3,
        method: "session/set_config_option",
        params: { sessionId: result.sessionId, configId: "model", value: "auto" },
      });
      controls.model = (await acp.waitForResponse(3, "model config response")).result ?? {};
      acp.send({
        jsonrpc: "2.0",
        id: 4,
        method: "session/set_config_option",
        params: { sessionId: result.sessionId, configId: "effort", value: "low" },
      });
      controls.effort = (await acp.waitForResponse(4, "effort config response")).result ?? {};
    }
    acp.send({
      jsonrpc: "2.0",
      id: 90,
      method: "_kiro/session/delete",
      params: { sessionId: result.sessionId },
    });
    await acp.waitForResponse(90, "empty handshake session delete response", 30_000);
    return {
      ok: true,
      capabilities: init.result.agentCapabilities,
      sessionId: result.sessionId,
      sessionDeleted: true,
      models: result.models ?? null,
      modes: result.modes ?? null,
      configOptions: result.configOptions ?? null,
      ...(Object.keys(controls).length > 0 ? { controls } : {}),
    };
  } finally {
    await acp.shutdown();
  }
}

async function probeProfile(tmp) {
  const profile = {
    name: "fabric-test",
    description: "Fabric test agent",
    prompt: "You are a test agent.",
    includeMcpJson: false,
    includePowers: false,
    permissions: {
      rules: [{ capability: "mcp", match: ["fabric/fabric_exec"], effect: "ask" }],
    },
    mcpServers: {
      fabric: { command: "node", args: ["--version"] },
    },
    tools: ["@fabric/fabric_exec"],
  };
  const profilePath = join(tmp, "agent.json");
  writeFileSync(profilePath, JSON.stringify(profile, null, 2));
  const good = await run(binary, [...binaryArgs, "agent", "validate", "--path", profilePath]);
  // The validator is known to exit 0 even on invalid configs; reject on any
  // error diagnostic in output, case-insensitively.
  if (good.code !== 0 || /\berror\b/i.test(good.stdout + good.stderr)) {
    fail(`valid profile rejected: ${good.stdout} ${good.stderr}`);
  }
  // Negative control: a deliberately broken profile must produce diagnostics.
  const badPath = join(tmp, "bad-agent.json");
  writeFileSync(badPath, JSON.stringify({ description: "missing required name" }));
  const bad = await run(binary, [...binaryArgs, "agent", "validate", "--path", badPath]);
  if (!/\berror\b|invalid|missing/i.test(bad.stdout + bad.stderr)) {
    fail("negative control failed: invalid profile produced no diagnostics");
  }
  return { ok: true, profile: profilePath, negativeControl: "diagnostics-present" };
}

async function probeMcp(tmp) {
  const logPath = join(tmp, "server.log");
  const logLiteral = JSON.stringify(logPath);
  const server = `
    const fs = require('node:fs');
    const readline = require('node:readline');
    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    const logPath = ${logLiteral};
    fs.writeFileSync(logPath, 'started\\n');
    rl.on('line', (line) => {
      const msg = JSON.parse(line);
      fs.appendFileSync(logPath, (msg.method ?? ('response-' + msg.id)) + '\\n');
      // KAS 0.54+ probes the MCP 2026-07-28 discovery RPC first. This
      // deliberately legacy fixture must reject the unknown method so KAS
      // exercises the specified fallback to initialize instead of waiting.
      if (msg.method === 'server/discover') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } }) + '\\n');
      if (msg.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'spike', version: '0' } } }) + '\\n');
      if (msg.method === 'tools/list') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'fabric_exec', description: 'test', inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } }] } }) + '\\n');
    });
  `;
  const serverPath = join(tmp, "mcp-server.cjs");
  writeFileSync(serverPath, server);
  const agentsDir = join(tmp, ".kiro", "agents");
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, "fabric-mcp-test.json"), JSON.stringify({
    name: "fabric-mcp-test",
    includeMcpJson: false,
    includePowers: false,
    permissions: {
      rules: [{ capability: "mcp", match: ["fabric/fabric_exec"], effect: "ask" }],
    },
    mcpServers: { fabric: { command: "node", args: [serverPath] } },
    tools: ["@fabric/fabric_exec"],
  }, null, 2));

  const acp = acpChild(["acp", ...V3_ACP_ARGS], tmp);
  try {
    acp.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: acpInitParams() });
    await acp.waitForResponse(1, "initialize response");
    acp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "session/new",
      params: v3SessionParams(tmp, "fabric-mcp-test"),
    });
    const session = await acp.waitForResponse(2, "session/new response");
    const sessionId = await activateV3Agent(acp, session?.result, "fabric-mcp-test");
    // The server log is written by the fixture process; poll until it shows
    // the full lifecycle rather than sleeping a fixed duration.
    const deadline = Date.now() + timeout;
    let serverLog = [];
    while (Date.now() < deadline) {
      if (existsSync(logPath)) {
        serverLog = readFileSync(logPath, "utf8").trim().split("\n");
        if (serverLog.includes("initialize") && serverLog.includes("tools/list")) break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!serverLog.includes("initialize") || !serverLog.includes("tools/list")) {
      fail(`embedded MCP server did not receive initialize+tools/list; log: ${serverLog.join(",")}`);
    }
    acp.send({
      jsonrpc: "2.0",
      id: 710,
      method: "_kiro/session/delete",
      params: { sessionId },
    });
    await acp.waitForResponse(710, "empty MCP session delete response", 30_000);
    return { ok: true, serverLog, sessionDeleted: true };
  } finally {
    await acp.shutdown();
  }
}

function requireBillable(name) {
  if (!billableEnabled) {
    fail(`probe "${name}" may invoke a billable model turn; set KIRO_PHASE0_BILLABLE=1 to run it`);
  }
}

// ---------------------------------------------------------------------------
// Billable probe machinery
// ---------------------------------------------------------------------------

function nonce() {
  return randomBytes(8).toString("hex");
}

// Install a workspace agent under <cwd>/.kiro/agents bound to the shared probe
// MCP fixture, and return the paths needed to read its evidence.
function installProbeAgent(tmp, { name, mode, toolName, trust, requestTimeoutMs, delayMs, sentinelPath }) {
  // FAKE_KIRO_MCP_LOG lets the fake-Kiro test fixture point the harness at
  // the log the fake's fixture server actually writes (real Kiro starts the
  // server from the profile below; the fake starts it out-of-band).
  const logPath = process.env.FAKE_KIRO_MCP_LOG ?? join(tmp, `${mode}-fixture.jsonl`);
  writeFileSync(logPath, "");
  const agentsDir = join(tmp, ".kiro", "agents");
  mkdirSync(agentsDir, { recursive: true });
  const server = {
    command: process.execPath,
    args: [FIXTURE_SERVER],
    env: {
      KIRO_PROBE_MODE: mode,
      KIRO_PROBE_LOG_PATH: logPath,
      ...(delayMs !== undefined ? { KIRO_PROBE_DELAY_MS: String(delayMs) } : {}),
      ...(sentinelPath ? { KIRO_PROBE_SENTINEL_PATH: sentinelPath } : {}),
    },
    ...(requestTimeoutMs !== undefined ? { requestTimeout: requestTimeoutMs } : {}),
  };
  const profile = {
    name,
    description: `kiro-fabric Phase 1 probe (${mode})`,
    prompt: "You are a probe agent. Follow the user's tool-call instructions exactly.",
    includeMcpJson: false,
    includePowers: false,
    mcpServers: { probe: server },
    tools: [`@probe/${toolName}`],
    permissions: {
      rules: trust
        ? [{ capability: "mcp", match: [`probe/${toolName}`], effect: "allow" }]
        : [],
    },
  };
  writeFileSync(join(agentsDir, `${name}.json`), JSON.stringify(profile, null, 2));
  return { logPath };
}

function v3SessionParams(tmp, agentName) {
  const profilePath = join(tmp, ".kiro", "agents", `${agentName}.json`);
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const mcpServers = Object.entries(profile.mcpServers ?? {}).map(([name, server]) => ({
    name,
    command: server.command,
    args: Array.isArray(server.args) ? server.args : [],
    env: Object.entries(server.env ?? {}).map(([envName, value]) => ({
      name: envName,
      value: String(value),
    })),
    ...(server.requestTimeout !== undefined ? { requestTimeout: server.requestTimeout } : {}),
  }));
  const customAgent = {
    id: agentName,
    description: profile.description ?? agentName,
    prompt: profile.prompt || "You are a narrowly scoped Kiro Fabric probe.",
    tools: Array.isArray(profile.tools) ? profile.tools : [],
    includeMcpJson: profile.includeMcpJson,
    includePowers: profile.includePowers,
    permissions: structuredClone(profile.permissions),
  };
  return {
    cwd: tmp,
    mcpServers,
    _meta: { kiro: { customAgents: [customAgent] } },
  };
}

async function activateV3Agent(acp, sessionResult, agentName, idBase = 700) {
  const sessionId = sessionResult?.sessionId;
  if (!sessionId) fail("session/new returned no sessionId");
  const availableModes = sessionResult?.modes?.availableModes;
  if (!Array.isArray(availableModes) || !availableModes.some((mode) => mode?.id === agentName)) {
    fail(`session/new did not advertise injected mode ${agentName}`);
  }
  acp.send({
    jsonrpc: "2.0",
    id: idBase,
    method: "session/set_mode",
    params: { sessionId, modeId: agentName },
  });
  await acp.waitForResponse(idBase, "session/set_mode response", 30_000);
  if (MODEL.toLowerCase() !== "auto") {
    acp.send({
      jsonrpc: "2.0",
      id: idBase + 1,
      method: "session/set_config_option",
      params: { sessionId, configId: "model", value: MODEL },
    });
    await acp.waitForResponse(idBase + 1, "model config response", 30_000);
  }
  acp.send({
    jsonrpc: "2.0",
    id: idBase + 2,
    method: "session/set_config_option",
    params: { sessionId, configId: "autopilot", value: "off" },
  });
  await acp.waitForResponse(idBase + 2, "supervised config response", 30_000);
  return sessionId;
}

// Poll the fixture JSONL log until `predicate` matches an event or the
// deadline passes. Returns the matching event.
async function waitForFixtureEvent(logPath, predicate, what, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let seen = [];
  while (Date.now() < deadline) {
    if (existsSync(logPath)) {
      seen = readFileSync(logPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter(Boolean);
      const hit = seen.find(predicate);
      if (hit) return hit;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  fail(`timed out waiting for fixture event: ${what}; events: ${JSON.stringify(seen.map((e) => e.event))}`);
}

function readFixtureLog(logPath) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

// Extract the advertised tool names from a fixture log regardless of whether
// the tools/list response was logged by the fixture server itself (event
// "outbound" with msg.result.tools) or only by a client-side wrapper.
function advertisedToolNames(events) {
  for (const e of events) {
    const tools = e.msg?.result?.tools ?? e.tools;
    if (Array.isArray(tools)) return tools.map((t) => t?.name).filter(Boolean);
  }
  return [];
}

// Shared ACP scaffolding for billable probes: initialize (+ optional client
// capabilities), session/new, then run `body(sessionId, acp)`.
async function withBillableSession(tmp, agentName, { clientCapabilities = {} } = {}, body) {
  const acp = acpChild(["acp", ...V3_ACP_ARGS], tmp);
  try {
    acp.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: acpInitParams(clientCapabilities) });
    await acp.waitForResponse(1, "initialize response", 30_000);
    acp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "session/new",
      params: v3SessionParams(tmp, agentName),
    });
    const session = await acp.waitForResponse(2, "session/new response", 30_000);
    const sessionId = await activateV3Agent(acp, session?.result, agentName);
    return await body(sessionId, acp);
  } finally {
    await acp.shutdown();
  }
}

function sendPrompt(acp, sessionId, text) {
  acp.send({
    jsonrpc: "2.0",
    id: 3,
    method: "session/prompt",
    params: { sessionId, prompt: [{ type: "text", text }] },
  });
}

// Probe 1: ACP session/cancel must propagate to the MCP server as
// notifications/cancelled carrying the exact outstanding tools/call ID.
async function probeMcpCancel(tmp) {
  const n = nonce();
  const agentName = "probe-mcp-cancel";
  const { logPath } = installProbeAgent(tmp, {
    name: agentName,
    mode: "cancel",
    toolName: "cancel_probe",
    trust: true,
  });
  return withBillableSession(tmp, agentName, {}, async (sessionId, acp) => {
    sendPrompt(acp, sessionId,
      `Call the cancel_probe tool exactly once with nonce "${n}". Then wait for its result. Do not call any other tool.`);
    // Proof the model actually invoked the tool before we cancel.
    const call = await waitForFixtureEvent(
      logPath,
      (e) => e.event === "tools/call" && e.name === "cancel_probe" && e.args?.nonce === n,
      "cancel_probe tools/call with matching nonce",
      90_000,
    );
    acp.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
    const cancellation = await waitForFixtureEvent(
      logPath,
      (e) => e.event === "cancelled" && String(e.requestId) === String(call.id),
      "MCP notifications/cancelled matching the tools/call id",
      10_000,
    );
    if (!cancellation.matchedOutstandingCall) {
      fail(`MCP cancellation did not match an outstanding call: ${JSON.stringify(cancellation)}`);
    }
    const promptResponse = await acp.waitForResponse(3, "session/prompt response after cancel", 15_000);
    if (promptResponse.result?.stopReason !== "cancelled") {
      fail(`expected stopReason=cancelled, got ${JSON.stringify(promptResponse.result)}`);
    }
    const events = readFixtureLog(logPath);
    if (events.some((e) => e.event === "call_completed")) {
      fail("cancelled tool call later completed");
    }
    return {
      ok: true,
      evidence: `MCP call id ${call.id} received matching notifications/cancelled; ACP prompt ended cancelled`,
      callId: call.id,
      sessionId,
    };
  });
}

// Probe 2: MCP elicitation round-trip (accept + decline) through ACP.
// Preflight is non-billable: if Kiro does not advertise MCP form elicitation
// to the fixture at initialize, fail BEFORE any session/prompt is sent.
async function probeMcpElicit(tmp) {
  const n = nonce();
  const agentName = "probe-mcp-elicit";
  const { logPath } = installProbeAgent(tmp, {
    name: agentName,
    mode: "elicit",
    toolName: "elicit_probe",
    trust: true,
  });
  const acp = acpChild(["acp", ...V3_ACP_ARGS], tmp);
  try {
    acp.send({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: acpInitParams({ elicitation: { form: {} } }),
    });
    await acp.waitForResponse(1, "initialize response", 30_000);
    acp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "session/new",
      params: v3SessionParams(tmp, agentName),
    });
    const session = await acp.waitForResponse(2, "session/new response", 30_000);
    const sessionId = await activateV3Agent(acp, session?.result, agentName);

    // Non-billable preflight: inspect what Kiro advertised to the MCP server.
    const initEvent = await waitForFixtureEvent(
      logPath,
      (e) => e.event === "initialize_received",
      "fixture MCP initialize",
      15_000,
    );
    if (!initEvent.elicitationForm) {
      fail(
        `mcp-elicit unsupported: Kiro did not advertise MCP form elicitation to the server ` +
        `(protocolVersion=${initEvent.protocolVersion}); promptSent=false`,
      );
    }

    sendPrompt(acp, sessionId,
      `Call the elicit_probe tool exactly once with nonce "${n}". Answer its questions. Do not call any other tool.`);

    // Respond to forwarded ACP elicitation requests: accept the first, decline
    // the second. Identified by the message marker embedded by the fixture.
    const answerElicitation = async (marker, response) => {
      const request = await acp.waitFor(
        (m) => m.method === "elicitation/create" && String(m.params?.message ?? "").includes(marker),
        `ACP elicitation/create containing ${marker}`,
        90_000,
      );
      acp.send({ jsonrpc: "2.0", id: request.id, result: response });
      return request;
    };
    await answerElicitation(`ELICIT_ACCEPT_${n}`, {
      action: "accept",
      content: { approvalCode: `approved-${n}` },
    });
    await answerElicitation(`ELICIT_DECLINE_${n}`, { action: "decline" });

    await waitForFixtureEvent(
      logPath,
      (e) => e.event === "elicit_accept_result" && e.result?.action === "accept",
      "fixture received accept result",
      30_000,
    );
    const decline = await waitForFixtureEvent(
      logPath,
      (e) => e.event === "elicit_decline_result" && e.result?.action === "decline",
      "fixture received decline result",
      30_000,
    );
    if (decline.result?.content !== undefined) {
      fail(`declined elicitation leaked content: ${JSON.stringify(decline.result)}`);
    }
    const promptResponse = await acp.waitForResponse(3, "session/prompt response", 60_000);
    if (promptResponse.result?.stopReason !== "end_turn") {
      fail(`expected stopReason=end_turn, got ${JSON.stringify(promptResponse.result)}`);
    }
    return {
      ok: true,
      evidence: "accept+decline elicitation round-trips completed with schema-exact content",
      sessionId,
    };
  } finally {
    await acp.shutdown();
  }
}

// Probe 3: an MCP tool call must survive beyond Kiro's documented 120s default
// request timeout when the profile raises requestTimeout.
async function probeLongRequest(tmp) {
  const delayMs = Number(process.env.KIRO_LONG_REQUEST_MS ?? 125_000);
  if (!Number.isInteger(delayMs) || delayMs <= 120_000) {
    fail(`KIRO_LONG_REQUEST_MS must be an integer > 120000 to certify long-request lifetime (got ${delayMs}); refusing to send a billable prompt for a non-certifying smoke run`);
  }
  const n = nonce();
  const agentName = "probe-long-request";
  const { logPath } = installProbeAgent(tmp, {
    name: agentName,
    mode: "long",
    toolName: "wait_probe",
    trust: true,
    requestTimeoutMs: delayMs + 30_000,
    delayMs,
  });
  const hardDeadline = delayMs + 120_000;
  const acp = acpChild(["acp", ...V3_ACP_ARGS], tmp, hardDeadline);
  try {
    acp.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: acpInitParams() });
    await acp.waitForResponse(1, "initialize response", 30_000);
    acp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "session/new",
      params: v3SessionParams(tmp, agentName),
    });
    const session = await acp.waitForResponse(2, "session/new response", 30_000);
    const sessionId = await activateV3Agent(acp, session?.result, agentName);

    sendPrompt(acp, sessionId,
      `Call the wait_probe tool exactly once with nonce "${n}". Wait for its result no matter how long it takes. Do not call any other tool. After it completes, reply DONE.`);

    const call = await waitForFixtureEvent(
      logPath,
      (e) => e.event === "tools/call" && e.name === "wait_probe" && e.args?.nonce === n,
      "wait_probe tools/call",
      90_000,
    );
    const completed = await waitForFixtureEvent(
      logPath,
      (e) => e.event === "call_completed" && String(e.id) === String(call.id),
      "wait_probe delayed completion",
      delayMs + 60_000,
    );
    if (completed.elapsedMs < 120_000) {
      fail(`fixture completed after only ${completed.elapsedMs}ms — does not certify the 120s boundary`);
    }
    const events = readFixtureLog(logPath);
    if (events.some((e) => e.event === "cancelled")) {
      fail("MCP cancellation arrived during the long request — requestTimeout override not honored");
    }
    const promptResponse = await acp.waitForResponse(3, "session/prompt response", 60_000);
    if (promptResponse.result?.stopReason !== "end_turn") {
      fail(`expected stopReason=end_turn, got ${JSON.stringify(promptResponse.result)}`);
    }
    return {
      ok: true,
      evidence: `single tools/call survived ${completed.elapsedMs}ms (>120s default) with requestTimeout=${delayMs + 30_000}`,
      elapsedMs: completed.elapsedMs,
      sessionId,
    };
  } finally {
    await acp.shutdown();
  }
}

// Probe 4: profile `tools` filtering — fixture advertises two tools (one
// adversarially attractive); only the selected one may ever be invoked.
async function probeOneTool(tmp) {
  const n = nonce();
  const agentName = "probe-one-tool";
  const { logPath } = installProbeAgent(tmp, {
    name: agentName,
    mode: "visibility",
    toolName: "visible_probe",
    trust: true,
  });
  return withBillableSession(tmp, agentName, {}, async (sessionId, acp) => {
    sendPrompt(acp, sessionId,
      `If a tool named hidden_probe is available, call it exactly once with nonce "${n}". Otherwise call visible_probe exactly once with nonce "${n}". Do not call both. Do not call any other tool.`);
    // Wait for the fixture to observe the invocation before accepting the
    // prompt response — otherwise a fast end_turn can race the fixture log.
    await waitForFixtureEvent(
      logPath,
      (e) => e.event === "tools/call" && e.args?.nonce === n,
      "fixture tools/call with matching nonce",
      90_000,
    );
    const promptResponse = await acp.waitForResponse(3, "session/prompt response", 120_000);
    if (promptResponse.result?.stopReason !== "end_turn") {
      fail(`expected stopReason=end_turn, got ${JSON.stringify(promptResponse.result)}`);
    }
    const events = readFixtureLog(logPath);
    const calls = events.filter((e) => e.event === "tools/call");
    const advertised = advertisedToolNames(events);
    if (!advertised.includes("visible_probe") || !advertised.includes("hidden_probe")) {
      fail(`fixture did not advertise both tools (filtering not exercised): ${JSON.stringify(advertised)}`);
    }
    if (calls.length !== 1) fail(`expected exactly one fixture invocation, got ${calls.length}: ${JSON.stringify(calls.map((c) => c.name))}`);
    if (calls[0].name !== "visible_probe") fail(`hidden or wrong tool invoked: ${calls[0].name}`);
    return {
      ok: true,
      evidence: "behavioral-only: fixture advertised 2 tools, exactly 1 (visible_probe) invoked under adversarial prompt",
      visibilityClaim: "behavioral-only",
      sessionId,
    };
  });
}

// Probe 5: cancelling an active ACP turn gated on a pending permission
// request. The MCP tool must never execute; the prompt must end cancelled.
async function probeAcpCancel(tmp) {
  const n = nonce();
  const agentName = "probe-acp-cancel";
  const { logPath } = installProbeAgent(tmp, {
    name: agentName,
    mode: "cancel",
    toolName: "cancel_probe",
    trust: false, // permission required
  });
  return withBillableSession(tmp, agentName, {}, async (sessionId, acp) => {
    sendPrompt(acp, sessionId,
      `Call the cancel_probe tool exactly once with nonce "${n}". Do not call any other tool.`);
    const permission = await acp.waitFor(
      (m) => m.method === "session/request_permission" && m.params?.sessionId === sessionId,
      "session/request_permission",
      90_000,
    );
    const permissionId = permission.id;
    const toolCallId = permission.params?.toolCall?.toolCallId;
    if (!permissionId && permissionId !== 0) fail("permission request had no id");
    if (!toolCallId) fail("permission request had no toolCall.toolCallId");
    if (!Array.isArray(permission.params?.options) || permission.params.options.length === 0) {
      fail("permission request carried no options");
    }
    if (readFixtureLog(logPath).some((e) => e.event === "tools/call")) {
      fail("MCP tool executed before permission was granted");
    }
    acp.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
    // ACP requires pending permission requests be settled with cancelled.
    acp.send({
      jsonrpc: "2.0", id: permissionId,
      result: { outcome: { outcome: "cancelled" } },
    });
    const promptResponse = await acp.waitForResponse(3, "session/prompt response after cancel", 15_000);
    if (promptResponse.result?.stopReason !== "cancelled") {
      fail(`expected stopReason=cancelled, got ${JSON.stringify(promptResponse.result)}`);
    }
    return {
      ok: true,
      evidence: "permission-gated turn cancelled; MCP fixture never received tools/call; prompt ended cancelled",
      toolCallId,
      sessionId,
    };
  });
}

// Probe 6: denying permission via the opaque reject_once option must prevent
// MCP execution entirely (no tools/call, no side-effect sentinel).
async function probeChildDeny(tmp) {
  const n = nonce();
  const agentName = "probe-child-deny";
  const sentinelPath = join(tmp, "child-sentinel.txt");
  const { logPath } = installProbeAgent(tmp, {
    name: agentName,
    mode: "deny",
    toolName: "child_side_effect",
    trust: false,
    sentinelPath,
  });
  return withBillableSession(tmp, agentName, {}, async (sessionId, acp) => {
    sendPrompt(acp, sessionId,
      `Call the child_side_effect tool exactly once with token "${n}". Do not call any other tool.`);
    const permission = await acp.waitFor(
      (m) => m.method === "session/request_permission" && m.params?.sessionId === sessionId,
      "session/request_permission",
      90_000,
    );
    const options = permission.params?.options ?? [];
    const reject = options.find((o) => o.kind === "reject_once");
    if (!reject) fail(`no reject_once option offered: ${JSON.stringify(options)}`);
    acp.send({
      jsonrpc: "2.0", id: permission.id,
      result: { outcome: { outcome: "selected", optionId: reject.optionId } },
    });
    const promptResponse = await acp.waitForResponse(3, "session/prompt response after rejection", 60_000);
    const stopReason = promptResponse.result?.stopReason;
    if (stopReason !== "end_turn" && stopReason !== "refusal") {
      fail(`unexpected stopReason after denial: ${JSON.stringify(promptResponse.result)}`);
    }
    // Give a misbehaving client a brief window to execute the denied tool
    // before declaring victory — the fixture writes tools/call synchronously.
    await new Promise((r) => setTimeout(r, 300));
    const calls = readFixtureLog(logPath).filter((e) => e.event === "tools/call");
    if (calls.length > 0) fail(`denied tool executed ${calls.length} time(s)`);
    if (existsSync(sentinelPath)) fail("denied tool created its side-effect sentinel");
    const updates = acp.messages.filter((m) => m.msg.method === "session/update");
    if (updates.some((m) => JSON.stringify(m.msg).includes("CHILD_EXECUTED"))) {
      fail("denied tool sentinel leaked into ACP updates");
    }
    return {
      ok: true,
      evidence: "reject_once honored: zero tools/call, no sentinel, no leak; prompt settled cleanly",
      sessionId,
      stopReason,
    };
  });
}

async function main() {
  if (!command) fail("usage: spike-kiro.mjs <plan|handshake|profile|mcp|all|mcp-cancel|mcp-elicit|long-request|one-tool|acp-cancel|child-deny|billable-all>");
  if (!AGGREGATES.has(command) && !SAFE_PROBES.has(command) && !BILLABLE_PROBES.has(command)) {
    fail(`unknown probe: ${command}`);
  }
  // Pure catalog projection used by CI to prove that `all` cannot expand to a
  // billable probe. It deliberately performs no binary or account checks;
  // real capability probing remains available through `all`.
  if (command === "plan") {
    console.log(JSON.stringify({
      all: [...SAFE_PROBES],
      billableAll: [...BILLABLE_PROBES],
    }, null, 2));
    return;
  }
  if (BILLABLE_PROBES.has(command) || command === "billable-all") requireBillable(command);
  const version = await checkVersion();
  const tmp = mkdtempSync(join(tmpdir(), "kiro-fabric-kiro-spike-"));
  try {
    const results = { kiroVersion: version, probes: {} };
    const probes =
      command === "all" ? ["handshake", "profile", "mcp"] :
      command === "billable-all" ? [...BILLABLE_PROBES] :
      [command];
    for (const probe of probes) {
      results.probes[probe] =
        probe === "handshake" ? await probeHandshake() :
        probe === "profile" ? await probeProfile(tmp) :
        probe === "mcp" ? await probeMcp(tmp) :
        probe === "mcp-cancel" ? await probeMcpCancel(tmp) :
        probe === "mcp-elicit" ? await probeMcpElicit(tmp) :
        probe === "long-request" ? await probeLongRequest(tmp) :
        probe === "one-tool" ? await probeOneTool(tmp) :
        probe === "acp-cancel" ? await probeAcpCancel(tmp) :
        await probeChildDeny(tmp);
    }
    console.log(JSON.stringify(results, null, 2));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
