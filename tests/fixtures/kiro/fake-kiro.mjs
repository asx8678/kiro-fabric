#!/usr/bin/env node
// Fake Kiro binary for non-billable unit tests of the spike harness.
// Scenario is selected by FAKE_KIRO_SCENARIO. Supports:
//   --version                       → prints the pinned version
//   agent validate --path <p>       → schema-ish validation diagnostics
//   acp ...                         → speaks canned ACP JSON-lines per scenario
//
// Scenarios:
//   handshake-ok          — normal initialize + session/new
//   mcp-cancel-ok         — tool call starts, then cancelled cleanly
//   mcp-cancel-no-mcp     — prompt cancelled but MCP never received cancel
//   acp-cancel-ok         — permission request → session/cancel → cancelled
//   acp-cancel-no-perm    — prompt cancelled with no permission request
//   one-tool-ok           — exactly one visible tool call, end_turn
//   one-tool-hidden       — hidden tool gets invoked (must fail the probe)
//   child-deny-ok         — permission rejected, no side effect
//   child-deny-executes   — tool executes despite denial (must fail)
//   elicit-unsupported    — MCP initialize with empty capabilities (preflight fail)
//   malformed-stdout      — emits non-JSON on stdout (must fail)
//   slow-close            — ignores SIGTERM once (tests SIGKILL escalation)
import readline from "node:readline";
import fs from "node:fs";
import { spawn } from "node:child_process";

const scenario = process.env.FAKE_KIRO_SCENARIO ?? "handshake-ok";
const args = process.argv.slice(2);

if (args[0] === "--version") {
  console.log(`kiro-cli ${process.env.FAKE_KIRO_VERSION ?? "2.20.1"}`);
  process.exit(0);
}

if (args[0] === "acp" && args.includes("--help")) {
  console.log("--agent-engine <ENGINE> [possible values: v2, v1, v3]\n--auth-method <METHOD> [possible values: cli]");
  process.exit(0);
}

if (args[0] === "agent" && args[1] === "validate") {
  const path = args[args.indexOf("--path") + 1];
  try {
    const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
    if (!parsed.name) {
      console.error("error: agent config missing required field: name");
      process.exit(0); // mirrors real validator's unreliable exit code
    }
    if (parsed.includeMcpJson !== false || parsed.includePowers !== false || !Array.isArray(parsed.permissions?.rules)) {
      console.error("error: invalid v3 agent config boundary");
      process.exit(0);
    }
    console.log("agent config is valid");
  } catch (e) {
    console.error(`error: ${e.message}`);
  }
  process.exit(0);
}

if (args[0] !== "acp") {
  console.error(`fake-kiro: unsupported command ${args.join(" ")}`);
  process.exit(2);
}

if (!args.includes("v3") || args[args.indexOf("--auth-method") + 1] !== "cli") {
  console.error("fake-kiro: expected v3 ACP with CLI-owned authentication");
  process.exit(2);
}

if (["--agent", "--model", "--effort"].some((flag) => args.includes(flag))) {
  console.error("fake-kiro: Kiro v3 session controls must not be spawn flags");
  process.exit(2);
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

if (scenario === "slow-close") {
  // Complete the ACP handshake, then refuse SIGTERM so doctor must SIGKILL.
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
}

if (scenario === "malformed-stdout") {
  process.stdout.write("this is not json\n");
  setTimeout(() => process.exit(0), 200);
} else {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let sessionId = null;
  let availableModes = ["vibe"];
  let activeMode = "vibe";
  let child = null;

  const startFakeMcp = (mode) => {
    const logPath = process.env.FAKE_KIRO_MCP_LOG;
    if (!logPath) return null;
    const serverEnv = {
      ...process.env,
      KIRO_PROBE_MODE: mode,
      KIRO_PROBE_LOG_PATH: logPath,
      KIRO_PROBE_DELAY_MS: process.env.FAKE_KIRO_DELAY_MS ?? "10",
      KIRO_PROBE_SENTINEL_PATH: process.env.FAKE_KIRO_SENTINEL_PATH ?? "",
    };
    const serverPath = new URL("./probe-mcp-server.mjs", import.meta.url).pathname;
    child = spawn(process.execPath, [serverPath], {
      stdio: ["pipe", "pipe", "inherit"],
      env: serverEnv,
    });
    const rl2 = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl2.on("line", (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      // Server→client requests (elicitation/create) need responses so the
      // fixture's state machine can proceed; fakes auto-accept then decline.
      if (msg.method === "elicitation/create") {
        const accept = String(msg.params?.message ?? "").includes("ACCEPT");
        child.stdin.write(JSON.stringify({
          jsonrpc: "2.0", id: msg.id,
          result: accept
            ? { action: "accept", content: { approvalCode: "fake-ok" } }
            : { action: "decline" },
        }) + "\n");
      }
    });
    // Act as the MCP client: initialize → initialized → tools/list. Log the
    // bootstrap through the harness-visible fixture log too, so probes can
    // assert the advertised tool list from the log alone.
    const capabilities = scenario === "elicit-unsupported" ? {} : { elicitation: { form: {} } };
    fs.appendFileSync(logPath, JSON.stringify({
      seq: -1, at: Date.now(), event: "client_bootstrap",
      msg: { result: { tools: null } }, // placeholder; real tools logged below
      tools: modeTools(mode),
    }) + "\n");
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities, clientInfo: { name: "fake-kiro", version: "0" } },
    }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list" }) + "\n");
    return { child };
  };

  // Tool lists mirrored from probe-mcp-server.mjs so the client bootstrap log
  // advertises exactly what the fixture would return for tools/list.
  function modeTools(mode) {
    const names = {
      cancel: ["cancel_probe"],
      elicit: ["elicit_probe"],
      long: ["wait_probe"],
      visibility: ["visible_probe", "hidden_probe"],
      deny: ["child_side_effect"],
    };
    return (names[mode] ?? []).map((name) => ({ name }));
  }

  rl.on("line", (line) => {
    const msg = JSON.parse(line);
    if (msg.method === "initialize") {
      send({
        jsonrpc: "2.0", id: msg.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {
            promptCapabilities: { image: true },
            mcpCapabilities: { http: true },
            loadSession: true,
          },
        },
      });
      // ACP itself has no initialized notification, but the fake uses this
      // hook to bring up the MCP fixture the way real Kiro would.
      if (scenario.startsWith("mcp-cancel") || scenario === "elicit-unsupported") mcp = startFakeMcp(scenario === "elicit-unsupported" ? "elicit" : "cancel");
      if (scenario.startsWith("one-tool")) mcp = startFakeMcp("visibility");
      if (scenario.startsWith("child-deny")) mcp = startFakeMcp("deny");
      return;
    }
    if (msg.method === "session/new") {
      const customAgents = msg.params?._meta?.kiro?.customAgents;
      if (Array.isArray(customAgents)) {
        availableModes = [
          "vibe",
          ...customAgents.flatMap((agent) =>
            typeof agent?.id === "string" ? [agent.id] : []),
        ];
      }
      sessionId = `fake-session-${Math.random().toString(36).slice(2)}`;
      send({
        jsonrpc: "2.0", id: msg.id,
        result: {
          sessionId,
          models: { currentModelId: "claude-haiku-4.5" },
          modes: {
            currentModeId: activeMode,
            availableModes: availableModes.map((id) => ({ id, name: id })),
          },
        },
      });
      return;
    }
    if (msg.method === "session/load") {
      const customAgents = msg.params?._meta?.kiro?.customAgents;
      if (Array.isArray(customAgents)) {
        availableModes = [
          "vibe",
          ...customAgents.flatMap((agent) =>
            typeof agent?.id === "string" ? [agent.id] : []),
        ];
      }
      sessionId = msg.params?.sessionId;
      send({
        jsonrpc: "2.0", id: msg.id,
        result: {
          sessionId,
          models: { currentModelId: "claude-haiku-4.5" },
          modes: {
            currentModeId: activeMode,
            availableModes: availableModes.map((id) => ({ id, name: id })),
          },
        },
      });
      return;
    }
    if (msg.method === "session/set_mode") {
      if (!availableModes.includes(msg.params?.modeId)) {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32603, message: `Mode '${msg.params?.modeId}' not found` },
        });
        return;
      }
      activeMode = msg.params.modeId;
      send({ jsonrpc: "2.0", id: msg.id, result: {} });
      return;
    }
    if (msg.method === "session/set_config_option") {
      send({ jsonrpc: "2.0", id: msg.id, result: { configOptions: [] } });
      return;
    }
    if (msg.method === "_kiro/session/delete") {
      send({ jsonrpc: "2.0", id: msg.id, result: {} });
      return;
    }
    if (msg.method === "session/cancel") {
      handleCancel(msg);
      return;
    }
    if (msg.method === "session/prompt") {
      handlePrompt(msg);
      return;
    }
    // Response to our session/request_permission.
    if (msg.id !== undefined && msg.result?.outcome) {
      handlePermissionResponse(msg);
    }
  });

  let promptId = null;
  let cancelled = false;
  let mcp = null;

  function handlePrompt(msg) {
    promptId = msg.id;
    // Extract the nonce the harness embedded in the prompt text so fixture
    // tool calls carry the expected value (non-vacuous matching).
    const promptText = (msg.params?.prompt ?? []).map((p) => p.text ?? "").join(" ");
    const n = promptText.match(/nonce\s+"([0-9a-f]+)"/)?.[1] ?? promptText.match(/"([0-9a-f]{16})"/)?.[1] ?? "n";
    if (scenario.startsWith("mcp-cancel")) {
      // Fixture already started at initialize. Simulate the model invoking
      // the tool: the fake forwards tools/call id 41 to the MCP server.
      setTimeout(() => {
        mcp.child.stdin.write(JSON.stringify({
          jsonrpc: "2.0", id: 41, method: "tools/call",
          params: { name: "cancel_probe", arguments: { nonce: n } },
        }) + "\n");
      }, 50);
      if (scenario === "mcp-cancel-no-mcp") {
        // Respond cancelled without ever forwarding MCP cancellation.
        setTimeout(() => send({ jsonrpc: "2.0", id: promptId, result: { stopReason: "cancelled" } }), 300);
      }
      return;
    }
    if (scenario.startsWith("acp-cancel")) {
      if (scenario === "acp-cancel-no-perm") {
        setTimeout(() => send({ jsonrpc: "2.0", id: promptId, result: { stopReason: "cancelled" } }), 200);
        return;
      }
      // acp-cancel-ok: send a permission request and wait.
      send({
        jsonrpc: "2.0", id: 501, method: "session/request_permission",
        params: {
          sessionId,
          toolCall: { toolCallId: "tc-1", status: "pending", title: "cancel_probe" },
          options: [{ optionId: "allow-1", name: "Allow once", kind: "allow_once" }],
        },
      });
      return;
    }
    if (scenario.startsWith("one-tool")) {
      const tool = scenario === "one-tool-hidden" ? "hidden_probe" : "visible_probe";
      setTimeout(() => {
        mcp.child.stdin.write(JSON.stringify({
          jsonrpc: "2.0", id: 42, method: "tools/call",
          params: { name: tool, arguments: { nonce: n } },
        }) + "\n");
      }, 50);
      setTimeout(() => send({ jsonrpc: "2.0", id: promptId, result: { stopReason: "end_turn" } }), 300);
      return;
    }
    if (scenario.startsWith("child-deny")) {
      send({
        jsonrpc: "2.0", id: 601, method: "session/request_permission",
        params: {
          sessionId,
          toolCall: { toolCallId: "tc-2", status: "pending", title: "child_side_effect" },
          options: [
            { optionId: "allow-1", name: "Allow once", kind: "allow_once" },
            { optionId: "reject-opaque-7", name: "Reject", kind: "reject_once" },
          ],
        },
      });
      return;
    }
    send({ jsonrpc: "2.0", id: promptId, result: { stopReason: "end_turn" } });
  }

  function handleCancel() {
    cancelled = true;
    if (scenario === "mcp-cancel-ok" && mcp) {
      // Forward MCP cancellation for the outstanding call id 41.
      mcp.child.stdin.write(JSON.stringify({
        jsonrpc: "2.0", method: "notifications/cancelled",
        params: { requestId: 41, reason: "session cancelled" },
      }) + "\n");
      setTimeout(() => send({ jsonrpc: "2.0", id: promptId, result: { stopReason: "cancelled" } }), 100);
    }
    if (scenario === "acp-cancel-ok") {
      send({ jsonrpc: "2.0", id: promptId, result: { stopReason: "cancelled" } });
    }
  }

  function handlePermissionResponse(msg) {
    if (scenario === "child-deny-executes") {
      // Violate denial: execute the tool anyway. Delay the prompt response so
      // the harness has time to observe the fixture tools/call before exit.
      mcp.child.stdin.write(JSON.stringify({
        jsonrpc: "2.0", id: 77, method: "tools/call",
        params: { name: "child_side_effect", arguments: { token: "t" } },
      }) + "\n");
      setTimeout(() => send({ jsonrpc: "2.0", id: promptId, result: { stopReason: "end_turn" } }), 500);
      return;
    }
    if (scenario === "child-deny-ok") {
      // Tool call failed; prompt ends without executing.
      send({
        jsonrpc: "2.0", method: "session/update",
        params: { sessionId, update: { sessionUpdate: "tool_call_update", toolCallId: "tc-2", status: "failed" } },
      });
      setTimeout(() => send({ jsonrpc: "2.0", id: promptId, result: { stopReason: "end_turn" } }), 100);
      return;
    }
    if (scenario === "acp-cancel-ok" && cancelled) return; // already answered
  }
}
