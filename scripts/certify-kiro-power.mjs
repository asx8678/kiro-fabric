#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const pluginRoot = path.resolve(process.argv[2] ?? ".tmp/kiro-fabric-power");
const entry = path.join(pluginRoot, "runtime", "kiro", "mcp-entry.js");
const temporary = mkdtempSync(path.join(tmpdir(), "kiro-fabric-power-cert-"));
const pluginData = path.join(temporary, "data");
const workspaceA = path.join(temporary, "workspace-a");
const workspaceB = path.join(temporary, "workspace-b");
const manualWorkspace = path.join(temporary, "workspace-manual");
for (const directory of [pluginData, workspaceA, workspaceB, manualWorkspace]) {
  mkdirSync(directory, { mode: 0o700 });
}

const before = new Map();
const snapshot = (directory, destination, prefix = "") => {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    const target = path.join(directory, item.name);
    if (item.isDirectory()) snapshot(target, destination, relative);
    else if (item.isFile()) {
      const stats = statSync(target);
      destination.set(relative, `${stats.size}:${stats.mtimeMs}`);
    } else throw new Error(`generated Power contains unsupported entry: ${relative}`);
  }
};
snapshot(pluginRoot, before);

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
let clientRoots = [workspaceA, workspaceB];
let elicitationRequests = 0;
const handledServerRequests = new Set();
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });
const send = (frame) => child.stdin.write(`${JSON.stringify(frame)}\n`);
const frames = () => stdout.split("\n").slice(0, -1).filter(Boolean).map((line) => JSON.parse(line));

const serviceServerRequests = () => {
  for (const frame of frames()) {
    if (frame?.id === undefined || typeof frame?.method !== "string") continue;
    const key = `${frame.method}:${JSON.stringify(frame.id)}`;
    if (handledServerRequests.has(key)) continue;
    handledServerRequests.add(key);
    if (frame.method === "roots/list") {
      send({
        jsonrpc: "2.0",
        id: frame.id,
        result: {
          roots: clientRoots.map((root) => ({
            uri: pathToFileURL(root).href,
            name: path.basename(root),
          })),
        },
      });
      continue;
    }
    if (frame.method === "elicitation/create") {
      elicitationRequests += 1;
      const properties = frame.params?.requestedSchema?.properties;
      if (!properties?.approved) throw new Error("Power elicitation did not request the approve-once field");
      send({
        jsonrpc: "2.0",
        id: frame.id,
        result: { action: "accept", content: { approved: true } },
      });
      continue;
    }
    throw new Error(`Power MCP issued an unexpected client request: ${frame.method}`);
  }
};

const waitFor = async (id, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    serviceServerRequests();
    const frame = frames().find((candidate) => candidate.id === id && candidate.method === undefined);
    if (frame) {
      if (frame.error) throw new Error(`Power MCP request ${id} failed: ${JSON.stringify(frame.error)}`);
      return frame;
    }
    if (child.exitCode !== null) {
      throw new Error(`Power MCP exited before response ${id}: ${stderr.slice(0, 2_000)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Power MCP response ${id} timed out`);
};

const request = async (id, method, params) => {
  send({ jsonrpc: "2.0", id, method, params });
  return waitFor(id);
};
const toolCall = async (id, name, args) => request(id, "tools/call", {
  name,
  arguments: args,
});
const toolText = (frame) => {
  const text = frame?.result?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error(`Power tool returned no text: ${JSON.stringify(frame)}`);
  if (frame.result.isError) throw new Error(`Power tool failed: ${text}`);
  return text;
};
const toolJson = (frame) => JSON.parse(toolText(frame));

try {
  const initialized = await request(101, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: { roots: { listChanged: true }, elicitation: {} },
    clientInfo: { name: "power-certifier", version: "1" },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  const listed = await request(102, "tools/list", {});
  if (!initialized?.result?.serverInfo) throw new Error("Power MCP initialize failed");
  const tools = listed?.result?.tools;
  const names = tools?.map((tool) => tool.name);
  if (JSON.stringify(names) !== JSON.stringify(["fabric_info", "fabric_workspace", "fabric_exec"])) {
    throw new Error(`Power MCP tool surface mismatch: ${JSON.stringify(names)}`);
  }
  const execDescription = tools.find((tool) => tool.name === "fabric_exec")?.description ?? "";
  if (/agents?\.run|agent orchestration|agent fan-out/iu.test(execDescription) || !/agents? are unavailable/iu.test(execDescription)) {
    throw new Error(`Power MCP agent boundary is misleading: ${execDescription}`);
  }

  const initial = toolJson(await toolCall(103, "fabric_workspace", { action: "list" }));
  if (initial.status !== "unbound" || initial.requiresSelection !== true || initial.roots?.length !== 2) {
    throw new Error(`multiple-root selection was not enforced: ${JSON.stringify(initial)}`);
  }
  const rootA = initial.roots.find((root) => root.name === path.basename(workspaceA));
  const rootB = initial.roots.find((root) => root.name === path.basename(workspaceB));
  if (!rootA || !rootB) throw new Error(`Power roots were not reported: ${JSON.stringify(initial.roots)}`);

  const selectedA = toolJson(await toolCall(104, "fabric_workspace", {
    action: "select",
    rootId: rootA.rootId,
  }));
  if (selectedA.status !== "bound" || selectedA.rootId !== rootA.rootId) {
    throw new Error(`first root did not bind: ${JSON.stringify(selectedA)}`);
  }
  const boundInfo = toolJson(await toolCall(105, "fabric_info", {}));
  if (
    boundInfo.integration !== "power" ||
    boundInfo.workspace?.status !== "bound" ||
    !boundInfo.capabilities?.includes("state") ||
    boundInfo.kiroAcp?.agents !== false
  ) {
    throw new Error(`unexpected bound fabric_info: ${JSON.stringify(boundInfo)}`);
  }

  clientRoots = [workspaceB];
  send({ jsonrpc: "2.0", method: "notifications/roots/list_changed", params: {} });
  const afterRootChange = toolJson(await toolCall(106, "fabric_workspace", { action: "status" }));
  if (afterRootChange.status !== "unbound") {
    throw new Error(`lost root did not fail closed before rebinding: ${JSON.stringify(afterRootChange)}`);
  }
  const selectedB = toolJson(await toolCall(107, "fabric_workspace", {
    action: "select",
    rootId: rootB.rootId,
  }));
  if (selectedB.status !== "bound" || selectedB.rootId !== rootB.rootId) {
    throw new Error(`second root did not rebind: ${JSON.stringify(selectedB)}`);
  }

  const manuallyBound = toolJson(await toolCall(108, "fabric_workspace", {
    action: "attach",
    path: manualWorkspace,
  }));
  if (manuallyBound.status !== "bound" || manuallyBound.source !== "manual" || elicitationRequests !== 1) {
    throw new Error(`manual binding did not use approve-once elicitation: ${JSON.stringify(manuallyBound)}`);
  }

  const simple = toolJson(await toolCall(109, "fabric_exec", {
    code: "return { ok: true, answer: 42 }",
    resultFormat: "json",
  }));
  if (simple.ok !== true || simple.answer !== 42) {
    throw new Error(`unexpected fabric_exec result: ${JSON.stringify(simple)}`);
  }

  const section = (label, character) => `${label}-start\n${character.repeat(9_000)}\n${label}-end`;
  const expectedSections = [
    section("first", "a"),
    section("middle", "b"),
    section("last", "c"),
  ];
  const overflow = await toolCall(110, "fabric_exec", {
    code: [
      "const section = (label: string, character: string) => `${label}-start\\n${character.repeat(9000)}\\n${label}-end`;",
      "return { first: section('first', 'a'), middle: section('middle', 'b'), last: section('last', 'c') };",
    ].join("\n"),
  });
  const overflowText = toolText(overflow);
  if (overflowText.length > 16_000) throw new Error("Power overflow projection exceeded the visible cap");
  const artifactId = /artifact (ka_[a-f0-9]{48})/u.exec(overflowText)?.[1];
  if (!artifactId || !overflowText.includes("artifacts.read")) {
    throw new Error(`Power overflow result has no retrievable artifact: ${overflowText.slice(-1_000)}`);
  }

  let recovered = "";
  let offset = 0;
  let done = false;
  let readId = 111;
  while (!done) {
    const chunk = toolJson(await toolCall(readId++, "fabric_exec", {
      code: `return await tools.call({ ref: "artifacts.read", args: { id: ${JSON.stringify(artifactId)}, offset: ${offset}, limit: 4000 } });`,
      resultFormat: "json",
    }));
    if (chunk.offset !== offset || typeof chunk.text !== "string") {
      throw new Error(`artifact chunk contract drifted: ${JSON.stringify(chunk)}`);
    }
    recovered += chunk.text;
    offset = chunk.nextOffset;
    done = chunk.done;
    if (readId > 140) throw new Error("artifact recovery did not terminate");
  }
  for (const expected of expectedSections) {
    if (!recovered.includes(expected)) throw new Error("artifact recovery lost structured multiline bytes");
  }
  if (recovered.includes("chars omitted")) {
    throw new Error("artifact recovery persisted the truncated preview instead of full output");
  }

  child.stdin.end();
  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Power MCP shutdown timed out")), 10_000);
    timeout.unref?.();
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  if (exitCode !== 0) throw new Error(`Power MCP exited ${exitCode}: ${stderr.slice(0, 2_000)}`);

  const after = new Map();
  snapshot(pluginRoot, after);
  if (JSON.stringify([...before]) !== JSON.stringify([...after])) {
    throw new Error("Power MCP modified immutable plugin files");
  }
  if (!statSync(path.join(pluginData, "fabric")).isDirectory()) {
    throw new Error("Power MCP did not initialize PLUGIN_DATA");
  }
  process.stdout.write(JSON.stringify({
    ok: true,
    tools: names,
    roots: "select-rebind",
    elicitation: "approve-once",
    execution: "checked",
    artifactRecovery: "lossless",
    acpAgents: false,
  }) + "\n");
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  rmSync(temporary, { recursive: true, force: true });
}
