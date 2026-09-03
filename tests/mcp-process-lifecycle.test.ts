import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const children = new Set<ChildProcess>();
const temporaryRoots: string[] = [];

const temporary = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-mcp-process-"));
  temporaryRoots.push(root);
  return root;
};

const stagedRuntime = (): string =>
  fs.realpathSync(path.resolve(".tmp/kiro-fabric-agent/runtime"));

const environment = (dataRoot: string, runtimeRoot = stagedRuntime()): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  KIRO_FABRIC_RUNTIME_ROOT: runtimeRoot,
  KIRO_FABRIC_DATA_ROOT: dataRoot,
});

const launch = (options: { eval?: string; root?: string; dataRoot?: string } = {}): ChildProcess => {
  const root = options.root ?? temporary();
  const data = options.dataRoot ?? path.join(root, "data");
  fs.mkdirSync(data, { recursive: true, mode: 0o700 });
  const entry = path.join(stagedRuntime(), "kiro", "mcp-entry.js");
  const args = options.eval === undefined
    ? [entry]
    : ["--input-type=module", "--eval", options.eval];
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: environment(data),
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
};

const exitOf = (child: ChildProcess, timeoutMs = 12_000): Promise<{ code: number | null; signal: NodeJS.Signals | null }> =>
  new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timer = setTimeout(() => reject(new Error(`child ${child.pid ?? "unknown"} did not exit`)), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });

const waitForLine = (child: ChildProcess, timeoutMs = 5_000): Promise<string> =>
  new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("child did not report its MCP pid")), timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline >= 0) {
        clearTimeout(timer);
        resolve(buffer.slice(0, newline));
      }
    });
  });

const waitForPidFile = async (file: string, timeoutMs = 8_000): Promise<number> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = Number(fs.readFileSync(file, "utf8").trim());
      if (Number.isSafeInteger(value) && value > 0) return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("downstream MCP server did not report its pid");
};

const connectTransport = async (
  input: NodeJS.WritableStream,
  output: NodeJS.ReadableStream,
  workspace?: string | (() => string),
  approveElicitation?: () => boolean | undefined,
): Promise<{
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params: unknown): void;
}> => {
  let buffer = "";
  let requestId = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  output.setEncoding("utf8");
  output.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const frame = JSON.parse(line) as { id?: number | string; method?: string; result?: unknown; error?: unknown };
        if (frame.id !== undefined && frame.method === "roots/list" && workspace) {
          const currentWorkspace = typeof workspace === "function" ? workspace() : workspace;
          input.write(`${JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { roots: [{ uri: pathToFileURL(currentWorkspace).href }] } })}\n`);
          continue;
        }
        if (frame.id !== undefined && frame.method === "elicitation/create" && approveElicitation) {
          const approved = approveElicitation();
          if (approved !== undefined) {
            input.write(`${JSON.stringify({
              jsonrpc: "2.0",
              id: frame.id,
              result: approved ? { action: "accept", content: { approved: true } } : { action: "decline" },
            })}\n`);
          }
          continue;
        }
        if (typeof frame.id !== "number" || !pending.has(frame.id)) continue;
        const waiter = pending.get(frame.id)!;
        pending.delete(frame.id);
        clearTimeout(waiter.timer);
        if (frame.error !== undefined) waiter.reject(new Error(JSON.stringify(frame.error)));
        else waiter.resolve(frame.result);
      } catch { /* ignore non-protocol output; the bounded request will time out */ }
    }
  });
  const request = (method: string, params: unknown): Promise<unknown> => {
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP ${method} timed out`)); }, 8_000);
      pending.set(id, { resolve, reject, timer });
      input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  };
  const notify = (method: string, params: unknown): void => {
    input.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  };
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {
      ...(workspace ? { roots: { listChanged: true } } : {}),
      ...(approveElicitation ? { elicitation: { form: {} } } : {}),
    },
    clientInfo: { name: "lifecycle-test", version: "1" },
  });
  notify("notifications/initialized", {});
  return { request, notify };
};

const initializeTransport = async (input: NodeJS.WritableStream, output: NodeJS.ReadableStream): Promise<void> => {
  await connectTransport(input, output);
};

const initialize = async (child: ChildProcess): Promise<void> => {
  if (!child.stdin || !child.stdout) throw new Error("MCP test transport is unavailable");
  await initializeTransport(child.stdin, child.stdout);
};

const isAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
};

const waitUntilDead = async (pid: number, timeoutMs = 12_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`orphaned MCP process ${pid} remained alive`);
};

interface ToolResponse {
  isError?: boolean;
  content?: Array<{ type?: string; text?: string }>;
}

interface FabricInfo {
  workspace: { status: string; rootId?: string; name?: string };
  tracing: { enabled: boolean; file?: string };
  lifecycle: {
    mcpInstanceId: string;
    pid: number;
    parentPid: number;
    startedAt: string;
    runtimeGeneration: number;
    runtimeActive: boolean;
  };
}

interface TraceRecord {
  seq: number;
  ev: string;
  data?: Record<string, unknown>;
}

const toolResponse = (value: unknown): ToolResponse => value as ToolResponse;
const toolJson = <T>(value: unknown): T => {
  const response = toolResponse(value);
  if (response.isError || response.content?.[0]?.type !== "text" || typeof response.content[0].text !== "string") {
    throw new Error(`unexpected MCP tool response: ${JSON.stringify(response)}`);
  }
  return JSON.parse(response.content[0].text) as T;
};

const traceRecords = (file: string): TraceRecord[] => fs.readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as TraceRecord);

const regularFileText = (root: string): string => fs.readdirSync(root, { withFileTypes: true })
  .map((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return regularFileText(target);
    return entry.isFile() ? fs.readFileSync(target, "utf8") : "";
  })
  .join("\n");

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exitOf(child, 2_000).catch(() => undefined);
  }
  children.clear();
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Agent MCP process lifecycle", () => {
  it("drains and exits successfully when its stdio client reaches EOF", async () => {
    const child = launch();
    child.stdin?.end();
    await expect(exitOf(child)).resolves.toEqual({ code: 0, signal: null });
  });

  for (const [signal, code] of [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]] as const) {
    it(`drains on ${signal}`, async () => {
      const child = launch();
      await initialize(child);
      expect(child.kill(signal)).toBe(true);
      await expect(exitOf(child)).resolves.toEqual({ code, signal: null });
    });
  }

  it("fails closed and drains when stdin closes abnormally", async () => {
    const entryUrl = pathToFileURL(path.join(stagedRuntime(), "kiro", "mcp-entry.js")).href;
    const child = launch({ eval: `
      const { runKiroMcpProcess } = await import(${JSON.stringify(entryUrl)});
      const running = runKiroMcpProcess();
      setTimeout(() => process.stdin.destroy(), 100);
      process.exit(await running);
    ` });
    await expect(exitOf(child)).resolves.toEqual({ code: 1, signal: null });
  });

  it("fails closed and drains when stdin emits an error", async () => {
    const entryUrl = pathToFileURL(path.join(stagedRuntime(), "kiro", "mcp-entry.js")).href;
    const child = launch({ eval: `
      const { runKiroMcpProcess } = await import(${JSON.stringify(entryUrl)});
      const running = runKiroMcpProcess();
      setTimeout(() => process.stdin.destroy(new Error("qualification stdin failure")), 100);
      process.exit(await running);
    ` });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
    await expect(exitOf(child)).resolves.toEqual({ code: 1, signal: null });
    expect(stderr).toContain("Agent MCP stdin failed: qualification stdin failure");
  });

  it("rebinds one MCP connection to one new workspace generation without mixing durable namespaces", async () => {
    const root = temporary();
    const data = path.join(root, "data");
    const workspaceA = path.join(root, "workspace-a");
    const workspaceB = path.join(root, "workspace-b");
    for (const directory of [data, workspaceA, workspaceB]) fs.mkdirSync(directory, { mode: 0o700 });
    const config = path.join(data, "fabric", "config");
    fs.mkdirSync(config, { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(data, "fabric"), 0o700);
    fs.chmodSync(config, 0o700);
    fs.writeFileSync(path.join(config, "config.json"), `${JSON.stringify({
      approvals: { read: "allow", write: "ask", execute: "deny", network: "deny" },
      tracing: { enabled: true },
    })}\n`, { mode: 0o600 });

    const child = launch({ root, dataRoot: data });
    if (!child.stdin || !child.stdout || child.pid === undefined) throw new Error("MCP test transport is unavailable");
    let advertisedWorkspace = workspaceA;
    let answerElicitations = true;
    const client = await connectTransport(
      child.stdin,
      child.stdout,
      () => advertisedWorkspace,
      () => answerElicitations ? true : undefined,
    );
    const call = (name: string, arguments_: Record<string, unknown>): Promise<unknown> => client.request("tools/call", {
      name,
      arguments: arguments_,
    });
    const first = toolJson<FabricInfo>(await call("fabric_info", {}));
    expect(first.workspace).toMatchObject({ status: "bound", name: "workspace-a" });
    expect(first.lifecycle).toMatchObject({
      pid: child.pid,
      runtimeGeneration: 1,
      runtimeActive: true,
    });
    expect(first.tracing.enabled).toBe(true);
    if (first.tracing.file === undefined) throw new Error("Fabric trace path was not reported");

    const key = "workspace-switch-sentinel";
    const sentinels = {
      aMemory: `a-memory-${Date.now()}-${process.pid}`,
      aState: `a-state-${Date.now()}-${process.pid}`,
      bMemory: `b-memory-${Date.now()}-${process.pid}`,
      bState: `b-state-${Date.now()}-${process.pid}`,
    };
    const writtenA = toolResponse(await call("fabric_exec", {
      code: `
        await memory.set({ key: payloads.key, value: { nonce: payloads.memory } });
        await state.set({ key: payloads.key, value: { nonce: payloads.state } });
        return { written: true };
      `,
      payloads: { key, memory: sentinels.aMemory, state: sentinels.aState },
      resultFormat: "json",
    }));
    expect(writtenA.isError, JSON.stringify(writtenA)).not.toBe(true);

    answerElicitations = false;
    const beforeLongExecution = traceRecords(first.tracing.file);
    const priorApprovalEvents = beforeLongExecution.filter((entry) => entry.ev === "approval.form.request").length;
    const longExecution = call("fabric_exec", {
      code: "return await state.set({ key: 'runtime-drain-probe', value: true })",
      timeoutMs: 60_000,
      resultFormat: "json",
    });
    const executionDeadline = Date.now() + 8_000;
    while (traceRecords(first.tracing.file).filter((entry) => entry.ev === "approval.form.request").length === priorApprovalEvents) {
      if (Date.now() >= executionDeadline) throw new Error("long-running execution did not enter the old runtime");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    advertisedWorkspace = workspaceB;
    client.notify("notifications/roots/list_changed", {});
    const interrupted = toolResponse(await longExecution);
    expect(interrupted.isError, JSON.stringify(interrupted)).toBe(true);

    const listedB = toolJson<{ status: string; roots: Array<{ rootId: string; name: string }> }>(
      await call("fabric_workspace", { action: "list" }),
    );
    expect(listedB).toMatchObject({ status: "unbound", roots: [{ name: "workspace-b" }] });
    await call("fabric_workspace", { action: "select", rootId: listedB.roots[0]!.rootId });

    const second = toolJson<FabricInfo>(await call("fabric_info", {}));
    expect(second.workspace).toMatchObject({ status: "bound", name: "workspace-b" });
    expect(second.workspace.rootId).not.toBe(first.workspace.rootId);
    expect(second.lifecycle).toEqual({
      ...first.lifecycle,
      runtimeGeneration: 2,
    });
    expect(isAlive(child.pid)).toBe(true);

    const recordsAfterSwitch = traceRecords(first.tracing.file);
    const runtimeRecords = recordsAfterSwitch.filter((entry) => entry.ev === "runtime.start" || entry.ev === "runtime.stop");
    expect(runtimeRecords.map((entry) => [entry.ev, entry.data?.runtimeGeneration])).toEqual([
      ["runtime.start", 1],
      ["runtime.stop", 1],
      ["runtime.start", 2],
    ]);

    answerElicitations = true;
    const writtenB = toolResponse(await call("fabric_exec", {
      code: `
        const isRecord = (value: JsonValue): value is JsonObject =>
          typeof value === "object" && value !== null && !Array.isArray(value);
        const oldMemory = await memory.get({ key: payloads.key });
        const oldState = await state.get({ key: payloads.key });
        if (!isRecord(oldMemory) || oldMemory.found !== false || !isRecord(oldState) || oldState.found !== false) {
          throw new Error("workspace durable namespace leaked across identity change");
        }
        await memory.set({ key: payloads.key, value: { nonce: payloads.memory } });
        await state.set({ key: payloads.key, value: { nonce: payloads.state } });
        return { isolated: true };
      `,
      payloads: { key, memory: sentinels.bMemory, state: sentinels.bState },
      resultFormat: "json",
    }));
    expect(writtenB.isError, JSON.stringify(writtenB)).not.toBe(true);

    const projectRoots = fs.readdirSync(path.join(data, "fabric", "projects"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => path.join(data, "fabric", "projects", entry.name));
    expect(projectRoots).toHaveLength(2);
    const byWorkspace = new Map(projectRoots.map((projectRoot) => {
      const identity = JSON.parse(fs.readFileSync(path.join(projectRoot, "workspace-identity.json"), "utf8")) as { canonicalPath: string };
      return [identity.canonicalPath, regularFileText(projectRoot)] as const;
    }));
    const aFiles = byWorkspace.get(fs.realpathSync(workspaceA));
    const bFiles = byWorkspace.get(fs.realpathSync(workspaceB));
    expect(aFiles).toContain(sentinels.aMemory);
    expect(aFiles).toContain(sentinels.aState);
    expect(aFiles).not.toContain(sentinels.bMemory);
    expect(aFiles).not.toContain(sentinels.bState);
    expect(bFiles).toContain(sentinels.bMemory);
    expect(bFiles).toContain(sentinels.bState);
    expect(bFiles).not.toContain(sentinels.aMemory);
    expect(bFiles).not.toContain(sentinels.aState);

    const finalInfo = toolJson<FabricInfo>(await call("fabric_info", {}));
    expect(finalInfo.lifecycle).toEqual(second.lifecycle);
    const finalRuntimeRecords = traceRecords(first.tracing.file)
      .filter((entry) => entry.ev === "runtime.start" || entry.ev === "runtime.stop");
    expect(finalRuntimeRecords.map((entry) => [entry.ev, entry.data?.runtimeGeneration])).toEqual([
      ["runtime.start", 1],
      ["runtime.stop", 1],
      ["runtime.start", 2],
    ]);

    child.stdin.end();
    await expect(exitOf(child)).resolves.toEqual({ code: 0, signal: null });
    expect(traceRecords(first.tracing.file)
      .filter((entry) => entry.ev === "runtime.stop")
      .map((entry) => entry.data?.runtimeGeneration)).toEqual([1, 2]);
  }, 30_000);

  it("shares one durable workspace safely across two concurrent Fabric MCP processes", async () => {
    const root = temporary();
    const data = path.join(root, "data");
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(data, { mode: 0o700 });
    fs.mkdirSync(workspace, { mode: 0o700 });
    const config = path.join(data, "fabric", "config");
    fs.mkdirSync(config, { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(data, "fabric"), 0o700);
    fs.chmodSync(config, 0o700);
    fs.writeFileSync(path.join(config, "config.json"), `${JSON.stringify({
      approvals: { read: "allow", write: "allow", execute: "deny", network: "deny" },
      mcp: { enabled: false },
    })}\n`, { mode: 0o600 });

    const first = launch({ root, dataRoot: data });
    const second = launch({ root, dataRoot: data });
    if (!first.stdin || !first.stdout || first.pid === undefined ||
        !second.stdin || !second.stdout || second.pid === undefined) {
      throw new Error("concurrent MCP test transports are unavailable");
    }
    const [firstClient, secondClient] = await Promise.all([
      connectTransport(first.stdin, first.stdout, workspace),
      connectTransport(second.stdin, second.stdout, workspace),
    ]);
    const call = (client: typeof firstClient, name: string, arguments_: Record<string, unknown>): Promise<unknown> =>
      client.request("tools/call", { name, arguments: arguments_ });
    const [firstInfo, secondInfo] = await Promise.all([
      call(firstClient, "fabric_info", {}).then((value) => toolJson<FabricInfo>(value)),
      call(secondClient, "fabric_info", {}).then((value) => toolJson<FabricInfo>(value)),
    ]);
    expect(firstInfo.lifecycle).toMatchObject({ pid: first.pid, runtimeGeneration: 1, runtimeActive: true });
    expect(secondInfo.lifecycle).toMatchObject({ pid: second.pid, runtimeGeneration: 1, runtimeActive: true });
    expect(firstInfo.lifecycle.pid).not.toBe(secondInfo.lifecycle.pid);
    expect(firstInfo.lifecycle.mcpInstanceId).not.toBe(secondInfo.lifecycle.mcpInstanceId);

    const token = `${Date.now()}-${process.pid}`;
    const shared = {
      memoryKeyA: `concurrent-memory-a-${token}`,
      memoryKeyB: `concurrent-memory-b-${token}`,
      memoryA: `memory-a-${token}`,
      memoryB: `memory-b-${token}`,
      stateKey: `concurrent-state-${token}`,
      initialState: `state-initial-${token}`,
      stateA: `state-a-${token}`,
      stateB: `state-b-${token}`,
    };
    const memoryWrites = await Promise.all([
      call(firstClient, "fabric_exec", {
        code: "return await memory.set({ key: payloads.key, value: { nonce: payloads.nonce } })",
        payloads: { key: shared.memoryKeyA, nonce: shared.memoryA },
        resultFormat: "json",
      }).then(toolResponse),
      call(secondClient, "fabric_exec", {
        code: "return await memory.set({ key: payloads.key, value: { nonce: payloads.nonce } })",
        payloads: { key: shared.memoryKeyB, nonce: shared.memoryB },
        resultFormat: "json",
      }).then(toolResponse),
    ]);
    for (const result of memoryWrites) expect(result.isError, JSON.stringify(result)).not.toBe(true);

    const initialState = toolResponse(await call(firstClient, "fabric_exec", {
      code: "return await state.set({ key: payloads.key, value: { nonce: payloads.nonce }, expectedRevision: 0 })",
      payloads: { key: shared.stateKey, nonce: shared.initialState },
      resultFormat: "json",
    }));
    expect(initialState.isError, JSON.stringify(initialState)).not.toBe(true);

    const casAttempts = await Promise.all([
      call(firstClient, "fabric_exec", {
        code: "return await state.set({ key: payloads.key, value: { nonce: payloads.nonce }, expectedRevision: 1 })",
        payloads: { key: shared.stateKey, nonce: shared.stateA },
        resultFormat: "json",
      }).then(toolResponse),
      call(secondClient, "fabric_exec", {
        code: "return await state.set({ key: payloads.key, value: { nonce: payloads.nonce }, expectedRevision: 1 })",
        payloads: { key: shared.stateKey, nonce: shared.stateB },
        resultFormat: "json",
      }).then(toolResponse),
    ]);
    expect(casAttempts.filter((result) => result.isError === true)).toHaveLength(1);
    expect(casAttempts.filter((result) => result.isError !== true)).toHaveLength(1);
    const losingResult = casAttempts.find((result) => result.isError === true)!;
    expect(JSON.stringify(losingResult)).toContain("state revision conflict");
    const winningState = casAttempts[0]!.isError === true ? shared.stateB : shared.stateA;
    const losingState = winningState === shared.stateA ? shared.stateB : shared.stateA;

    const verifyShared = `
      const record = (value: JsonValue): JsonObject | undefined =>
        typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
      const nested = (value: JsonValue, outer: string, inner: string): JsonValue | undefined => {
        const first = record(value)?.[outer];
        return first === undefined ? undefined : record(first)?.[inner];
      };
      const memoryA = await memory.get({ key: payloads.memoryKeyA });
      const memoryB = await memory.get({ key: payloads.memoryKeyB });
      const stateValue = await state.get({ key: payloads.stateKey });
      if (nested(memoryA, "value", "nonce") !== payloads.memoryA ||
          nested(memoryB, "value", "nonce") !== payloads.memoryB ||
          nested(stateValue, "value", "nonce") !== payloads.state ||
          record(stateValue)?.revision !== 2) {
        throw new Error("concurrent durable workspace contents are inconsistent");
      }
      return { verified: true };
    `;
    const verificationPayloads = {
      memoryKeyA: shared.memoryKeyA,
      memoryKeyB: shared.memoryKeyB,
      memoryA: shared.memoryA,
      memoryB: shared.memoryB,
      stateKey: shared.stateKey,
      state: winningState,
    };
    const visibility = await Promise.all([
      call(firstClient, "fabric_exec", { code: verifyShared, payloads: verificationPayloads, resultFormat: "json" }).then(toolResponse),
      call(secondClient, "fabric_exec", { code: verifyShared, payloads: verificationPayloads, resultFormat: "json" }).then(toolResponse),
    ]);
    for (const result of visibility) expect(result.isError, JSON.stringify(result)).not.toBe(true);

    const projectRoots = fs.readdirSync(path.join(data, "fabric", "projects"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => path.join(data, "fabric", "projects", entry.name));
    expect(projectRoots).toHaveLength(1);
    const durableFiles = regularFileText(projectRoots[0]!);
    expect(durableFiles).toContain(shared.memoryA);
    expect(durableFiles).toContain(shared.memoryB);
    expect(durableFiles).toContain(winningState);
    expect(durableFiles).not.toContain(losingState);

    first.stdin.end();
    second.stdin.end();
    await expect(Promise.all([exitOf(first), exitOf(second)])).resolves.toEqual([
      { code: 0, signal: null },
      { code: 0, signal: null },
    ]);
  }, 30_000);

  it("restores exact durable workspace data in a new MCP process after abrupt MCP death", async () => {
    if (process.platform === "win32") return;
    const root = temporary();
    const data = path.join(root, "data");
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(data, { mode: 0o700 });
    fs.mkdirSync(workspace, { mode: 0o700 });
    const config = path.join(data, "fabric", "config");
    fs.mkdirSync(config, { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(data, "fabric"), 0o700);
    fs.chmodSync(config, 0o700);
    fs.writeFileSync(path.join(config, "config.json"), `${JSON.stringify({
      approvals: { read: "allow", write: "allow", execute: "deny", network: "deny" },
      mcp: { enabled: false },
    })}\n`, { mode: 0o600 });

    const token = `${Date.now()}-${process.pid}`;
    const durable = {
      memoryKey: `crash-memory-${token}`,
      memory: `crash-memory-value-${token}`,
      stateKey: `crash-state-${token}`,
      state: `crash-state-value-${token}`,
      newMemoryKey: `restart-memory-${token}`,
      newMemory: `restart-memory-value-${token}`,
      newStateKey: `restart-state-${token}`,
      newState: `restart-state-value-${token}`,
    };
    const first = launch({ root, dataRoot: data });
    if (!first.stdin || !first.stdout || first.pid === undefined) throw new Error("first MCP test transport is unavailable");
    const firstClient = await connectTransport(first.stdin, first.stdout, workspace);
    const firstCall = (name: string, arguments_: Record<string, unknown>): Promise<unknown> =>
      firstClient.request("tools/call", { name, arguments: arguments_ });
    const firstInfo = toolJson<FabricInfo>(await firstCall("fabric_info", {}));
    const seeded = toolResponse(await firstCall("fabric_exec", {
      code: `
        await memory.set({ key: payloads.memoryKey, value: { nonce: payloads.memory } });
        await state.set({ key: payloads.stateKey, value: { nonce: payloads.state }, expectedRevision: 0 });
        return { seeded: true };
      `,
      payloads: durable,
      resultFormat: "json",
    }));
    expect(seeded.isError, JSON.stringify(seeded)).not.toBe(true);
    expect(first.kill("SIGKILL")).toBe(true);
    await expect(exitOf(first)).resolves.toEqual({ code: null, signal: "SIGKILL" });

    const restarted = launch({ root, dataRoot: data });
    if (!restarted.stdin || !restarted.stdout || restarted.pid === undefined) throw new Error("restarted MCP test transport is unavailable");
    const restartedClient = await connectTransport(restarted.stdin, restarted.stdout, workspace);
    const restartedCall = (name: string, arguments_: Record<string, unknown>): Promise<unknown> =>
      restartedClient.request("tools/call", { name, arguments: arguments_ });
    const restartedInfo = toolJson<FabricInfo>(await restartedCall("fabric_info", {}));
    expect(restartedInfo.lifecycle).toMatchObject({ pid: restarted.pid, runtimeGeneration: 1, runtimeActive: true });
    expect(restartedInfo.lifecycle.pid).not.toBe(firstInfo.lifecycle.pid);
    expect(restartedInfo.lifecycle.mcpInstanceId).not.toBe(firstInfo.lifecycle.mcpInstanceId);

    const restored = toolResponse(await restartedCall("fabric_exec", {
      code: `
        const record = (value: JsonValue): JsonObject | undefined =>
          typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
        const nested = (value: JsonValue, outer: string, inner: string): JsonValue | undefined => {
          const first = record(value)?.[outer];
          return first === undefined ? undefined : record(first)?.[inner];
        };
        const memoryValue = await memory.get({ key: payloads.memoryKey });
        const stateValue = await state.get({ key: payloads.stateKey });
        if (nested(memoryValue, "value", "nonce") !== payloads.memory ||
            nested(stateValue, "value", "nonce") !== payloads.state ||
            record(stateValue)?.revision !== 1) {
          throw new Error("durable workspace contents were not restored after abrupt death");
        }
        return { restored: true };
      `,
      payloads: durable,
      resultFormat: "json",
    }));
    expect(restored.isError, JSON.stringify(restored)).not.toBe(true);

    const extended = toolResponse(await restartedCall("fabric_exec", {
      code: `
        await memory.set({ key: payloads.memoryKey, value: { nonce: payloads.memory } });
        await state.set({ key: payloads.stateKey, value: { nonce: payloads.state } });
        return { extended: true };
      `,
      payloads: { memoryKey: durable.newMemoryKey, memory: durable.newMemory, stateKey: durable.newStateKey, state: durable.newState },
      resultFormat: "json",
    }));
    expect(extended.isError, JSON.stringify(extended)).not.toBe(true);

    const projectRoots = fs.readdirSync(path.join(data, "fabric", "projects"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => path.join(data, "fabric", "projects", entry.name));
    expect(projectRoots).toHaveLength(1);
    const durableFiles = regularFileText(projectRoots[0]!);
    for (const nonce of [durable.memory, durable.state, durable.newMemory, durable.newState]) {
      expect(durableFiles).toContain(nonce);
    }

    restarted.stdin.end();
    await expect(exitOf(restarted)).resolves.toEqual({ code: 0, signal: null });
  }, 30_000);

  it("does not leave the Fabric MCP or its real stdio descendant orphaned after abrupt parent death", async () => {
    if (process.platform === "win32") return;
    const root = temporary();
    const data = path.join(root, "data");
    fs.mkdirSync(data, { mode: 0o700 });
    const relocatedRuntime = path.join(root, "release-runtime");
    fs.cpSync(stagedRuntime(), relocatedRuntime, { recursive: true });
    const config = path.join(data, "fabric", "config");
    fs.mkdirSync(config, { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(data, "fabric"), 0o700);
    fs.chmodSync(config, 0o700);
    const downstreamPidFile = path.join(root, "downstream.pid");
    const downstreamServer = path.join(root, "downstream.mjs");
    fs.writeFileSync(downstreamServer, `
      import fs from "node:fs";
      import { Server } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/index.js"))};
      import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js"))};
      import { CallToolRequestSchema, ListToolsRequestSchema } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/types.js"))};
      fs.writeFileSync(process.argv[2], String(process.pid), { mode: 0o600, flag: "wx" });
      const server = new Server({ name: "descendant-fixture", version: "1" }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [{ name: "echo", inputSchema: { type: "object", properties: {}, additionalProperties: false } }],
      }));
      server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "descendant-ok" }] }));
      await server.connect(new StdioServerTransport());
    `, { mode: 0o600 });
    fs.writeFileSync(path.join(config, "config.json"), `${JSON.stringify({
      approvals: { read: "allow", write: "allow", execute: "allow", network: "allow" },
      mcp: { callTimeoutMs: 10_000 },
    })}\n`, { mode: 0o600 });
    fs.writeFileSync(path.join(config, "mcp.json"), `${JSON.stringify({
      imports: [],
      mcpServers: {
        descendant: {
          command: process.execPath,
          args: [downstreamServer, downstreamPidFile],
          cwd: root,
        },
      },
    })}\n`, { mode: 0o600 });
    const entry = path.join(relocatedRuntime, "kiro", "mcp-entry.js");
    const helper = path.join(root, "parent.mjs");
    fs.writeFileSync(helper, `
      import { spawn } from "node:child_process";
      const child = spawn(process.execPath, [${JSON.stringify(entry)}], {
        env: ${JSON.stringify(environment(data, relocatedRuntime))},
        // These descriptors are pipes owned by the grandparent test process.
        // Killing this helper therefore does not close the MCP transport.
        stdio: [3, 4, "ignore"],
      });
      process.stdout.write(String(child.pid) + "\\n");
      setInterval(() => {}, 1_000);
    `, { mode: 0o600 });
    const parent = spawn(process.execPath, [helper], { cwd: root, stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"] });
    children.add(parent);
    parent.once("exit", () => children.delete(parent));
    const mcpPid = Number(await waitForLine(parent));
    const mcpInput = parent.stdio[3] as NodeJS.WritableStream | null;
    const mcpOutput = parent.stdio[4] as NodeJS.ReadableStream | null;
    if (!mcpInput || !mcpOutput) throw new Error("independent grandparent-owned MCP transport is unavailable");
    mcpInput.on("error", () => undefined);
    let downstreamPid: number | undefined;
    try {
      expect(Number.isSafeInteger(mcpPid) && mcpPid > 0).toBe(true);
      const client = await connectTransport(mcpInput, mcpOutput, root);
      const execution = await client.request("tools/call", {
        name: "fabric_exec",
        arguments: {
          code: 'return await mcp.call({ server: "descendant", tool: "echo", args: {} })',
          resultFormat: "json",
        },
      }) as { isError?: boolean; content?: Array<{ text?: string }> };
      expect(execution.isError, JSON.stringify(execution)).not.toBe(true);
      expect(execution.content?.[0]?.text).toContain("descendant-ok");
      downstreamPid = await waitForPidFile(downstreamPidFile);
      expect(isAlive(mcpPid)).toBe(true);
      expect(isAlive(downstreamPid)).toBe(true);
      expect(parent.kill("SIGKILL")).toBe(true);
      await exitOf(parent);
      await expect(waitUntilDead(mcpPid)).resolves.toBeUndefined();
      await expect(waitUntilDead(downstreamPid)).resolves.toBeUndefined();
    } finally {
      mcpInput.end();
      if (isAlive(mcpPid)) process.kill(mcpPid, "SIGKILL");
      if (downstreamPid !== undefined && isAlive(downstreamPid)) process.kill(downstreamPid, "SIGKILL");
    }
  });
});
