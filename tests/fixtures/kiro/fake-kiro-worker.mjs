#!/usr/bin/env node
// Deterministic ACP fixture for the Kiro worker. Scenario is selected by
// FAKE_KIRO_WORKER_SCENARIO. Writes argv + inbound frames to FAKE_KIRO_WORKER_LOG
// when that path is set. Never talks to a model.
import fs from "node:fs";
import { spawn } from "node:child_process";
import readline from "node:readline";

const scenario = process.env.FAKE_KIRO_WORKER_SCENARIO ?? "happy";
const logPath = process.env.FAKE_KIRO_WORKER_LOG;
const args = process.argv.slice(2);

const record = (entry) => {
  if (!logPath) return;
  fs.appendFileSync(logPath, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
};

record({ event: "argv", argv: args });
if (scenario === "environment") {
  record({ event: "environment", env: process.env });
}

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
      process.exit(0);
    }
    if (parsed.includeMcpJson !== false || parsed.includePowers !== false || !Array.isArray(parsed.permissions?.rules)) {
      console.error("error: invalid v3 agent config boundary");
      process.exit(0);
    }
    console.log("agent config is valid");
  } catch (error) {
    console.error(`error: ${error.message}`);
  }
  process.exit(0);
}

if (args[0] !== "acp") {
  console.error(`fake-kiro-worker: unsupported command ${args.join(" ")}`);
  process.exit(2);
}

if (!args.includes("v3") || args[args.indexOf("--auth-method") + 1] !== "cli") {
  record({ event: "invalid-v3-argv" });
  console.error("fake-kiro-worker: expected v3 ACP with CLI-owned authentication");
  process.exit(2);
}

if (["--agent", "--model", "--effort"].some((flag) => args.includes(flag))) {
  record({ event: "invalid-v3-spawn-control" });
  console.error("fake-kiro-worker: Kiro v3 session controls must not be spawn flags");
  process.exit(2);
}

if (args.includes("--trust-all-tools")) {
  record({ event: "trust-all-tools" });
}

const send = (obj) => {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
};

if (scenario === "malformed") {
  process.stdout.write("this is not json\n");
  setTimeout(() => process.exit(0), 50);
} else if (scenario === "oversized") {
  process.stdout.write(`${"x".repeat(4 * 1024 * 1024 + 8)}\n`, () => {
    process.exit(0);
  });
} else if (scenario === "slow-close") {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
} else {
  const resident =
    scenario === "resident" ||
    scenario === "resident-load" ||
    scenario === "resident-slow" ||
    scenario === "resident-refuse-second";
  const loadSession =
    scenario === "load" || scenario === "load-no-id" || scenario === "resident-load";
  const imageOk = scenario !== "no-image";
  let sessionId = process.env.FAKE_KIRO_SESSION_ID ?? "fake-acp-session";
  let activeMode;
  let supervised = false;
  let currentModel = "kiro-test-model";
  let availableModes = ["vibe"];
  let grandchild;
  const promptCounts = new Map();

  const promptText = (prompt) => {
    if (Array.isArray(prompt)) {
      const texts = prompt
        .filter((block) => block && typeof block === "object" && block.type === "text" && typeof block.text === "string")
        .map((block) => block.text);
      if (texts.length > 0) return texts.join("\n\n");
    }
    return typeof prompt === "string" ? prompt : JSON.stringify(prompt ?? "");
  };

  if (scenario === "grandchild") {
    grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: process.platform !== "win32",
      stdio: "ignore",
    });
    grandchild.unref();
    record({ event: "grandchild", pid: grandchild.pid });
    process.on("SIGTERM", () => {});
  }

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let promptId = null;
  const registerSessionAgent = (params) => {
    const agents = params?._meta?.kiro?.customAgents;
    const servers = params?.mcpServers;
    const agent = Array.isArray(agents) && agents.length === 1 ? agents[0] : undefined;
    const server = Array.isArray(servers) && servers.length === 1 ? servers[0] : undefined;
    if (
      agent?.id !== "kiro-fabric" ||
      typeof agent.prompt !== "string" ||
      !Array.isArray(agent.tools) ||
      agent.tools[0] !== "@fabric/fabric_exec" ||
      server?.name !== "fabric" ||
      typeof server.command !== "string" ||
      !Array.isArray(server.args) ||
      !Array.isArray(server.env)
    ) return false;
    availableModes = ["vibe", "kiro-fabric"];
    activeMode = undefined;
    supervised = false;
    return true;
  };
  rl.on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    record({ event: "inbound", frame: msg });
    if (msg.method === "initialize") {
      if (scenario === "vendor-notification") {
        send({
          jsonrpc: "2.0",
          method: "_kiro.dev/mcp/server_initialized",
          params: { serverName: "fabric" },
        });
      }
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {
            promptCapabilities: { image: imageOk },
            loadSession: true,
          },
        },
      });
      return;
    }
    if (msg.method === "session/new") {
      if (!registerSessionAgent(msg.params)) {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32602, message: "missing Kiro v3 custom agent or MCP injection" },
        });
        return;
      }
      if (loadSession) {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32000, message: "test expected session/load" },
        });
        return;
      }
      sessionId = `fake-acp-session-${msg.id}`;
      promptCounts.set(sessionId, 0);
      if (scenario === "handshake-spoof") {
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "other-session",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "spoofed-before-handshake" },
            },
          },
        });
      }
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          sessionId,
          models: { currentModelId: currentModel },
          modes: {
            currentModeId: "vibe",
            availableModes: availableModes.map((id) => ({ id, name: id })),
          },
        },
      });
      return;
    }
    if (msg.method === "session/load") {
      if (!registerSessionAgent(msg.params)) {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32602, message: "missing Kiro v3 custom agent or MCP injection" },
        });
        return;
      }
      if (scenario === "load-switch") {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            sessionId: "session-B",
            models: { currentModelId: "switched" },
            modes: {
              currentModeId: "vibe",
              availableModes: availableModes.map((id) => ({ id, name: id })),
            },
          },
        });
        return;
      }
      sessionId = msg.params?.sessionId ?? sessionId;
      promptCounts.set(sessionId, 0);
      if (!resident) {
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "REPLAYED" },
            },
          },
        });
      }
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result:
          scenario === "load-no-id"
            ? {
                models: { currentModelId: "kiro-loaded-model" },
                modes: {
                  currentModeId: "vibe",
                  availableModes: availableModes.map((id) => ({ id, name: id })),
                },
              }
            : {
                sessionId,
                models: { currentModelId: "kiro-loaded-model" },
                modes: {
                  currentModeId: "vibe",
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
      if (msg.params?.configId === "model") currentModel = msg.params.value;
      if (msg.params?.configId === "autopilot") supervised = msg.params.value === "off";
      send({ jsonrpc: "2.0", id: msg.id, result: { configOptions: [] } });
      return;
    }
    if (msg.method === "session/cancel") {
      record({ event: "cancel", params: msg.params });
      return;
    }
    if (msg.method === "session/prompt") {
      if (activeMode !== "kiro-fabric" || !supervised) {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32603, message: "v3 Fabric mode was not activated in supervised mode" },
        });
        return;
      }
      promptId = msg.id;
      if (scenario === "sensitive-evidence") {
        process.stderr.write("ACP-STDERR-MUST-NOT-BE-LOGGED\n");
        send({
          jsonrpc: "2.0",
          method: "_kiro.dev/sensitive_evidence",
          params: {
            prompt: "ACP-PROMPT-MUST-NOT-BE-LOGGED",
            thought: "ACP-THOUGHT-MUST-NOT-BE-LOGGED",
            toolArguments: { command: "echo ACP-TOOL-ARGS-MUST-NOT-BE-LOGGED" },
            authorization: "Bearer ACP-TOKEN-MUST-NOT-BE-LOGGED",
          },
        });
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "ACP-TOOL-ID-MUST-NOT-BE-LOGGED",
              title: "ACP-TOOL-TITLE-MUST-NOT-BE-LOGGED",
            },
          },
        });
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "ACP-TOOL-ID-MUST-NOT-BE-LOGGED",
              title: "ACP-TOOL-TITLE-MUST-NOT-BE-LOGGED",
              status: "completed",
            },
          },
        });
      }
      if (scenario === "unknown-request") {
        send({
          jsonrpc: "2.0",
          id: 9001,
          method: "fs/read_text_file",
          params: { path: "/etc/passwd" },
        });
        return;
      }
      if (scenario === "wrong-session") {
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "other-session",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "spoofed" },
            },
          },
        });
        send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
        return;
      }
      if (scenario === "permission-spoof") {
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "hidden",
              title: "hidden_probe",
            },
          },
        });
        send({
          jsonrpc: "2.0",
          id: 601,
          method: "session/request_permission",
          params: {
            sessionId,
            toolCall: {
              toolCallId: "hidden",
              title: "@fabric/fabric_exec",
              status: "pending",
            },
            options: [
              { optionId: "allow-once-1", name: "Allow once", kind: "allow_once" },
              { optionId: "reject-1", name: "Reject", kind: "reject_once" },
            ],
          },
        });
        return;
      }
      if (scenario === "late-text") {
        process.stdout.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } })}\n${JSON.stringify({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "LATE" },
              },
            },
          })}\n`,
        );
        return;
      }
      if (scenario === "late-malformed") {
        process.stdout.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } })}\nthis is not json\n`,
        );
        return;
      }
      if (scenario === "permission-hidden") {
        send({
          jsonrpc: "2.0",
          id: 501,
          method: "session/request_permission",
          params: {
            sessionId,
            toolCall: { toolCallId: "tc-hidden", title: "hidden_probe", status: "pending" },
            options: [
              { optionId: "allow-1", name: "Allow once", kind: "allow_once" },
              { optionId: "reject-1", name: "Reject", kind: "reject_once" },
            ],
          },
        });
        return;
      }
      if (scenario === "permission-fabric") {
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tc-fabric",
              title: "Running: @fabric/fabric_exec",
              _meta: {
                kiro: { toolName: "fabric_exec", mcpServerName: "fabric" },
              },
            },
          },
        });
        send({
          jsonrpc: "2.0",
          id: 502,
          method: "session/request_permission",
          params: {
            sessionId,
            toolCall: {
              toolCallId: "tc-fabric",
              title: "Running: @fabric/fabric_exec",
              status: "pending",
            },
            options: [{ optionId: "allow-once-1", name: "Allow once", kind: "allow_once" }],
            _meta: {
              mcpToolIdentity: { serverName: "fabric", toolName: "fabric_exec" },
            },
          },
        });
        return;
      }
      if (scenario === "hang") {
        return;
      }
      if (scenario === "usage-inject") {
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "usage_update",
              used: 12,
              size: 200000,
              cost: 9.99,
              usage: { input: 99, output: 99, cost: 9.99 },
            },
          },
        });
      }
      if (scenario === "chunked-stream") {
        for (let index = 0; index < 100; index++) {
          send({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: `chunk-${String(index).padStart(4, "0")};` },
              },
            },
          });
        }
      }
      if (scenario === "prompt-echo") {
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: promptText(msg.params?.prompt) },
            },
          },
        });
      }
      if (resident) {
        const count = (promptCounts.get(sessionId) ?? 0) + 1;
        promptCounts.set(sessionId, count);
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: `prompt ${count}: ${promptText(msg.params?.prompt)}` },
            },
          },
        });
      }
      if (
        scenario === "split-text" ||
        scenario === "happy" ||
        scenario === "load" ||
        scenario === "usage-inject" ||
        scenario === "vendor-notification"
      ) {
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "界" },
            },
          },
        });
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "面 🚀" },
            },
          },
        });
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tc-1",
              title: "@fabric/fabric_exec",
            },
          },
        });
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "tc-1",
              status: "completed",
            },
          },
        });
      }
      if (
        scenario === "refusal" ||
        (scenario === "resident-refuse-second" && (promptCounts.get(sessionId) ?? 0) === 2)
      ) {
        send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "refusal" } });
        return;
      }
      if (scenario === "bad-stop") {
        send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "explode" } });
        return;
      }
      if (scenario === "resident-slow" && (promptCounts.get(sessionId) ?? 0) > 1) {
        setTimeout(() => send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } }), 250);
        return;
      }
      send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
    }
    if (msg.result?.outcome) {
      record({ event: "permission-response", result: msg.result });
      if (scenario === "permission-fabric") {
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: { sessionUpdate: "tool_call_update", toolCallId: "tc-fabric", status: "completed" },
          },
        });
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "allowed" },
            },
          },
        });
        if (promptId !== null) send({ jsonrpc: "2.0", id: promptId, result: { stopReason: "end_turn" } });
      }
      if (scenario === "permission-hidden") {
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: { sessionUpdate: "tool_call_update", toolCallId: "tc-hidden", status: "failed" },
          },
        });
        if (promptId !== null) send({ jsonrpc: "2.0", id: promptId, result: { stopReason: "end_turn" } });
      }
    }
  });
}
