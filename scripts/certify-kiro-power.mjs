#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileAtomic } from "./atomic-file.mjs";
import { validatePowerPackage } from "./validate-power-package.mjs";

const requestedPluginRoot = path.resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : ".tmp/kiro-fabric-power");
const jsonIndex = process.argv.indexOf("--json");
const jsonOutput = jsonIndex >= 0 ? path.resolve(process.argv[jsonIndex + 1]) : undefined;
const packageEvidence = validatePowerPackage(requestedPluginRoot);
const pluginRoot = packageEvidence.root;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-cert-"));
const pluginData = path.join(temporary, "data");
const workspace = path.join(temporary, "workspace");
fs.mkdirSync(pluginData, { mode: 0o700 });
fs.mkdirSync(workspace, { mode: 0o700 });
const entry = path.join(pluginRoot, "runtime", "kiro", "mcp-entry.js");
const child = spawn(process.execPath, [entry], {
  cwd: pluginRoot,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PLUGIN_ROOT: pluginRoot, PLUGIN_DATA: pluginData },
  stdio: ["pipe", "pipe", "pipe"],
});
const MAX_CAPTURE_CHARS = 8 * 1024 * 1024;
let stdout = ""; let stderr = ""; let captureError;
const capture = (stream, chunk) => {
  if (captureError) return stream;
  if (stream.length + chunk.length > MAX_CAPTURE_CHARS) {
    captureError = new Error("Power MCP certification output exceeded its bound");
    child.kill("SIGKILL");
    return stream;
  }
  return stream + chunk;
};
child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { stdout = capture(stdout, chunk); });
child.stderr.on("data", (chunk) => { stderr = capture(stderr, chunk); });
const send = (frame) => child.stdin.write(`${JSON.stringify(frame)}\n`);
const frames = () => stdout.split("\n").slice(0, -1).filter(Boolean).map((line) => JSON.parse(line));
const handled = new Set();
const serviceRequests = () => {
  for (const frame of frames()) {
    if (frame.id === undefined || typeof frame.method !== "string") continue;
    const key = `${frame.method}:${frame.id}`;
    if (handled.has(key)) continue;
    handled.add(key);
    if (frame.method === "roots/list") send({ jsonrpc: "2.0", id: frame.id, result: { roots: [{ uri: pathToFileURL(workspace).href, name: "workspace" }] } });
    else if (frame.method === "elicitation/create") send({ jsonrpc: "2.0", id: frame.id, result: { action: "decline" } });
    else throw new Error(`Unexpected MCP client request: ${frame.method}`);
  }
};
const waitFor = async (id) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (captureError) throw captureError;
    serviceRequests();
    const frame = frames().find((candidate) => candidate.id === id && candidate.method === undefined);
    if (frame) return frame;
    if (child.exitCode !== null) throw new Error(`Power MCP exited early: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Power MCP request ${id} timed out: ${stderr}`);
};
const request = async (id, method, params) => { send({ jsonrpc: "2.0", id, method, params }); const frame = await waitFor(id); if (frame.error) throw new Error(JSON.stringify(frame.error)); return frame.result; };
const call = (id, name, args) => request(id, "tools/call", { name, arguments: args });
const text = (result) => result.content?.[0]?.text;
try {
  await request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: { roots: { listChanged: true } }, clientInfo: { name: "power-certifier", version: "1" } });
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  const listed = await request(2, "tools/list", {});
  const tools = listed.tools.map((tool) => tool.name);
  if (JSON.stringify(tools) !== JSON.stringify(["fabric_info", "fabric_workspace", "fabric_exec"])) throw new Error(`tool surface mismatch: ${JSON.stringify(tools)}`);
  for (const tool of listed.tools) {
    if (tool.inputSchema?.type !== "object") throw new Error(`tool input schema must declare an object root: ${tool.name}`);
  }
  const info = JSON.parse(text(await call(3, "fabric_info", {})));
  if (info.product !== "kiro-fabric-power" || info.executor !== "quickjs") throw new Error("fabric_info identity mismatch");
  if (info.workspace?.status !== "bound" || info.workspace?.context !== "verified" || info.workspace?.verification !== "verified") {
    throw new Error("fabric_info did not prove canonical workspace binding");
  }
  const providers = info.providers?.map((provider) => provider.name).sort();
  if (JSON.stringify(providers) !== JSON.stringify(["artifacts", "mcp", "memory", "state"]) ||
      info.providers.some((provider) => provider.available !== true)) {
    throw new Error("fabric_info provider set is incomplete");
  }
  const execution = await call(4, "fabric_exec", { code: "return { ok: true, value: payloads.value }", payloads: { value: "42" }, resultFormat: "json" });
  const value = JSON.parse(text(execution));
  if (execution.isError || value.ok !== true || value.value !== "42") throw new Error(`checked execution failed: ${text(execution)}`);
  const denied = await call(5, "fabric_exec", { code: "return await memory.set({ key: 'certification', value: true })", resultFormat: "json" });
  const deniedValue = JSON.parse(text(denied));
  if (!denied.isError || deniedValue.status !== "failed" || !String(deniedValue.error).includes("approval")) {
    throw new Error("approval absence did not fail closed at the approval boundary");
  }
  const dynamicCodeProbes = [
    "return eval(payloads.program)",
    "const run = eval; return run(payloads.program)",
    "return (globalThis as any)['ev' + 'al'](payloads.program)",
    "return Function(payloads.program)()",
    "return ((() => {}) as any).constructor(payloads.program)()",
    "return (Object.getPrototypeOf(() => {}) as any).constructor(payloads.program)()",
    "return (Object.getPrototypeOf(function* () {}) as any).constructor(payloads.program)().next().value",
    "return await (Object.getPrototypeOf(async function () {}) as any).constructor(payloads.program)()",
    "return await (Object.getPrototypeOf(async function* () {}) as any).constructor(payloads.program)().next()",
  ];
  let requestId = 10;
  for (const code of dynamicCodeProbes) {
    const probe = await call(requestId++, "fabric_exec", { code, payloads: { program: "return 42" }, resultFormat: "json" });
    const probeValue = JSON.parse(text(probe));
    if (!probe.isError || !String(probeValue.error).includes("Dynamic code generation is disabled") || probeValue.audits?.length) {
      throw new Error(`dynamic code probe was not rejected before provider/approval activity: ${code}`);
    }
  }
  for (const code of [
    "import value from '/etc/passwd'; return value as any",
    "return await import('file:///etc/passwd') as any",
    "type Secret = import('/etc/passwd'); return null",
    "const value = require('../package.json'); return value",
  ]) {
    const probe = await call(requestId++, "fabric_exec", { code, resultFormat: "json" });
    const probeValue = JSON.parse(text(probe));
    if (!probe.isError || !JSON.stringify(probeValue.typeErrors ?? []).includes("Guest modules and external references are not allowed")) {
      throw new Error(`guest import was not rejected without host resolution: ${code}: ${JSON.stringify(probeValue)}`);
    }
  }
  for (const code of ["return 1n as any", "return new Map() as any", "return Number.NaN as any", "const x: any = {}; x.self = x; return x"]) {
    const probe = await call(requestId++, "fabric_exec", { code, resultFormat: "json" });
    const probeValue = JSON.parse(text(probe));
    if (!probe.isError || !/non-JSON|unsupported exotic|non-finite|cycle/u.test(String(probeValue.error))) {
      throw new Error(`unsupported guest result was not rejected: ${code}`);
    }
  }
  child.stdin.end();
  const code = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("MCP shutdown timed out")), 10_000); child.once("exit", (value) => { clearTimeout(timer); resolve(value); }); });
  if (code !== 0) throw new Error(`Power MCP exited ${code}: ${stderr}`);
  const report = {
    kind: "kiro-fabric.power-certification",
    schemaVersion: 1,
    ok: true,
    packageDigest: packageEvidence.digest,
    tools,
    executor: "quickjs",
    customAgentSelected: false,
    checks: ["package-digest", "initialize", "three-tools", "workspace-binding", "four-providers", "checked-execution", "dynamic-code-disabled", "compiler-filesystem-isolation", "strict-json-results", "approval-boundary", "bounded-output", "bounded-shutdown"],
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (jsonOutput) writeFileAtomic(jsonOutput, serialized);
  process.stdout.write(serialized);
} finally {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 2_000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
  fs.rmSync(temporary, { recursive: true, force: true });
}
