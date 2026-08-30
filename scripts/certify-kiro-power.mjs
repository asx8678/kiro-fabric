#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const pluginRoot = path.resolve(process.argv[2] ?? ".tmp/kiro-fabric-power");
const entry = path.join(pluginRoot, "runtime", "kiro", "mcp-entry.js");
const temporary = mkdtempSync(path.join(tmpdir(), "kiro-fabric-power-cert-"));
const pluginData = path.join(temporary, "data");
mkdirSync(pluginData, { mode: 0o700 });
const before = new Map();
const snapshot = (directory, prefix = "") => {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    const target = path.join(directory, item.name);
    if (item.isDirectory()) snapshot(target, relative);
    else if (item.isFile()) {
      const stats = statSync(target);
      before.set(relative, `${stats.size}:${stats.mtimeMs}`);
    } else throw new Error(`generated Power contains unsupported entry: ${relative}`);
  }
};
snapshot(pluginRoot);

const child = spawn(process.execPath, [entry], {
  cwd: pluginRoot,
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    KIRO_FABRIC_INTEGRATION: "power",
    PLUGIN_ROOT: pluginRoot,
    PLUGIN_DATA: pluginData,
  },
  stdio: ["pipe", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });
const send = (frame) => child.stdin.write(`${JSON.stringify(frame)}\n`);
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "power-certifier", version: "1" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "fabric_info", arguments: {} } });

const deadline = Date.now() + 15_000;
while (Date.now() < deadline) {
  const frames = stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  if (frames.some((frame) => frame.id === 3)) break;
  await new Promise((resolve) => setTimeout(resolve, 25));
}
child.stdin.end();
const exitCode = await Promise.race([
  new Promise((resolve) => child.once("exit", (code) => resolve(code))),
  new Promise((_, reject) => setTimeout(() => reject(new Error("Power MCP shutdown timed out")), 10_000)),
]);
try {
  if (exitCode !== 0) throw new Error(`Power MCP exited ${exitCode}: ${stderr.slice(0, 2_000)}`);
  const frames = stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const initialized = frames.find((frame) => frame.id === 1);
  const listed = frames.find((frame) => frame.id === 2);
  const info = frames.find((frame) => frame.id === 3);
  if (!initialized?.result?.serverInfo) throw new Error("Power MCP initialize failed");
  const names = listed?.result?.tools?.map((tool) => tool.name);
  if (JSON.stringify(names) !== JSON.stringify(["fabric_info", "fabric_workspace", "fabric_exec"])) {
    throw new Error(`Power MCP tool surface mismatch: ${JSON.stringify(names)}`);
  }
  const infoText = info?.result?.content?.[0]?.text;
  const parsedInfo = JSON.parse(infoText ?? "null");
  if (parsedInfo?.integration !== "power" || parsedInfo?.workspace?.status !== "unbound") {
    throw new Error(`unexpected fabric_info: ${infoText}`);
  }
  const after = new Map();
  const collect = (directory, prefix = "") => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      const target = path.join(directory, item.name);
      if (item.isDirectory()) collect(target, relative);
      else if (item.isFile()) {
        const stats = statSync(target);
        after.set(relative, `${stats.size}:${stats.mtimeMs}`);
      }
    }
  };
  collect(pluginRoot);
  if (JSON.stringify([...before]) !== JSON.stringify([...after])) throw new Error("Power MCP modified immutable plugin files");
  if (!statSync(path.join(pluginData, "fabric")).isDirectory()) throw new Error("Power MCP did not initialize PLUGIN_DATA");
  process.stdout.write(JSON.stringify({ ok: true, tools: names, workspace: "unbound" }) + "\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
