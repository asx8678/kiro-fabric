import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FabricAgentConfig } from "../config.js";
import { readJsonlPage } from "../log-tail.js";
import type {
  KiroAgentHandleInfo as AgentHandleInfo,
  KiroAgentLog as FabricAgentLog,
  KiroAgentRunRecord as AgentRunRecord,
  KiroAgentRunRequest as AgentRunRequest,
  KiroAgentRunResult as AgentRunResult,
  KiroAgentSteerEntry as AgentSteerEntry,
  KiroAgentSteerResult as AgentSteerResult,
  KiroAgentTransportHandle as AgentTransportHandle,
  KiroSteeringMode as FabricSteeringMode,
} from "./agent-types.js";
import { MAX_AGENT_STEER_LINE_BYTES } from "../agents/steering-limits.js";
import { spawnDetached } from "../agents/transports/process-utils.js";
import { parseKiroChildTools } from "./run-scope.js";

const STATUS_POLL_MS = 100;
const TRANSPORT_EXIT_GRACE_MS = 1_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 24 * 3_600_000;
const MAX_NAME_LENGTH = 60;
export const MAX_KIRO_STEER_FILE_BYTES = 4 * 1024 * 1024;
const terminalStatuses = new Set(["completed", "failed", "stopped", "timed_out"]);

export interface KiroAgentManagerOptions {
  workerPath: string;
  runRoot?: string;
  projectRoot?: string;
  kiroBinary?: string;
}

interface ManagedKiroAgent {
  id: string;
  name: string;
  task: string;
  cwd: string;
  runDirectory: string;
  statusFile: string;
  transport: AgentTransportHandle;
  result: Promise<AgentRunResult> | undefined;
  resolve: ((result: AgentRunResult) => void) | undefined;
  release: () => void;
  settled: boolean;
  latestRecord?: AgentRunRecord;
  model?: string;
  thinking?: AgentRunRequest["thinking"];
  residency: "one-shot" | "resident";
  abortSignal: AbortSignal | undefined;
  abortHandler: (() => void) | undefined;
  stopRequested: boolean;
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const safeName = (value: string): string =>
  value.replace(/[\r\n\t]+/g, " ").trim().slice(0, MAX_NAME_LENGTH) || "Fabric agent";

const unavailableUsage = () => ({
  availability: "unavailable" as const,
  reason: "runner-does-not-report" as const,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
});

const isRecord = (value: unknown): value is AgentRunRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Partial<AgentRunRecord>;
  return typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.task === "string" &&
    typeof record.status === "string" &&
    ["queued", "running", "completed", "failed", "stopped", "timed_out"].includes(record.status) &&
    record.runner === "kiro" &&
    typeof record.cwd === "string" &&
    typeof record.startedAt === "number" &&
    typeof record.updatedAt === "number" &&
    typeof record.turns === "number" &&
    typeof record.toolCalls === "number" &&
    typeof record.text === "string" &&
    typeof record.usage === "object" && record.usage !== null;
};

const readRecord = (filePath: string): AgentRunRecord | undefined => {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

const writeRecord = (filePath: string, record: AgentRunRecord): void => {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ ...record, format: 2 }, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, filePath);
};

/**
 * Minimal manager for managed Kiro: one Kiro ACP worker per OS process, with no
 * generic runner, terminal multiplexer, worktree, actor, or recursive runtime.
 */
export class KiroAgentManager {
  readonly #workerPath: string;
  readonly #runRoot: string;
  readonly #managedTempRoot: boolean;
  readonly #projectRoot: string;
  readonly #kiroBinary: string;
  readonly #runs = new Map<string, ManagedKiroAgent>();
  readonly #waiters: Array<() => void> = [];
  #active = 0;
  #closing = false;

  constructor(
    readonly cwd: string,
    readonly config: FabricAgentConfig,
    options: KiroAgentManagerOptions,
  ) {
    this.#workerPath = options.workerPath;
    this.#managedTempRoot = options.runRoot === undefined && process.env.KIRO_FABRIC_RUN_ROOT === undefined;
    this.#runRoot = options.runRoot ?? process.env.KIRO_FABRIC_RUN_ROOT ??
      fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-runs-"));
    this.#projectRoot = options.projectRoot ?? cwd;
    this.#kiroBinary = options.kiroBinary ?? process.env.KIRO_FABRIC_KIRO_BINARY ?? "kiro-cli";
  }

  get kiroBinaryForDiscovery(): string {
    return this.#kiroBinary;
  }

  resolveCwd(requestedCwd?: string): string {
    if (requestedCwd === undefined) return this.cwd;
    if (typeof requestedCwd !== "string" || requestedCwd.trim().length === 0) {
      throw new Error(`Invalid Fabric agent cwd ${JSON.stringify(requestedCwd)}: path must not be empty`);
    }
    const candidate = path.isAbsolute(requestedCwd)
      ? requestedCwd
      : path.resolve(this.cwd, requestedCwd);
    try {
      const canonical = fs.realpathSync(candidate);
      fs.accessSync(canonical, fs.constants.R_OK | fs.constants.X_OK);
      if (!fs.statSync(canonical).isDirectory()) throw new Error("path is not a directory");
      return canonical;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid Fabric agent cwd ${JSON.stringify(requestedCwd)}: ${reason}`);
    }
  }

  async #acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.#closing) throw new Error("Kiro agent manager is closing");
    if (signal?.aborted) throw new Error("Agent launch aborted");
    while (this.#active >= Math.max(1, this.config.maxConcurrent)) {
      await new Promise<void>((resolve, reject) => {
        const wake = (): void => {
          signal?.removeEventListener("abort", abort);
          resolve();
        };
        const abort = (): void => {
          const index = this.#waiters.indexOf(wake);
          if (index >= 0) this.#waiters.splice(index, 1);
          reject(new Error("Agent launch aborted"));
        };
        this.#waiters.push(wake);
        signal?.addEventListener("abort", abort, { once: true });
      });
      if (this.#closing || signal?.aborted) {
        // The release that selected this waiter made capacity available. If the
        // selected launch can no longer use it, hand that capacity to the next
        // waiter instead of leaving the lane idle indefinitely.
        this.#waiters.shift()?.();
        throw new Error(this.#closing ? "Kiro agent manager is closing" : "Agent launch aborted");
      }
    }
    if (this.#closing) throw new Error("Kiro agent manager is closing");
    this.#active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
      this.#waiters.shift()?.();
    };
  }

  async spawn(request: AgentRunRequest, signal?: AbortSignal): Promise<AgentHandleInfo> {
    if (this.#closing) throw new Error("Kiro agent manager is closing");
    if (!this.config.enabled) throw new Error("Agents are disabled in Fabric configuration");
    if (!request.task.trim()) throw new Error("Agent task must not be empty");
    if (request.runner !== undefined && request.runner !== "kiro") {
      throw new Error(`Kiro agent manager supports only the Kiro runner, not ${request.runner}`);
    }
    if (request.recursive) throw new Error("Kiro runner does not support recursive Fabric");
    if (request.worktree) throw new Error("Kiro agent manager does not support worktrees");
    if (request.residency === "durable") throw new Error("Kiro agent manager supports session-local agents only");
    const selectedTransport = request.transport ?? this.config.transport;
    if (selectedTransport !== "auto" && selectedTransport !== "process") {
      throw new Error(`Kiro agent manager supports only process transport, not ${selectedTransport}`);
    }
    if (this.config.maxTokensPerChild > 0) {
      throw new Error("Kiro runner does not report token usage; set agents.maxTokensPerChild to 0");
    }
    if (this.config.budgetUsd > 0) {
      throw new Error("Kiro runner does not report usage and cannot enforce an active Fabric cost budget");
    }

    const agentCwd = this.resolveCwd(request.cwd);
    const tools = parseKiroChildTools(request.tools ?? this.config.defaultTools);
    const release = await this.#acquire(signal);
    let launchDirectory: string | undefined;
    try {
      if (this.#closing) throw new Error("Kiro agent manager is closing");
      const id = randomUUID().replaceAll("-", "");
      const name = safeName(request.name ?? request.task.split("\n", 1)[0] ?? "Fabric agent");
      const runDirectory = path.join(this.#runRoot, id);
      launchDirectory = runDirectory;
      fs.mkdirSync(runDirectory, { recursive: true });
      const taskFile = path.join(runDirectory, "task.txt");
      const statusFile = path.join(runDirectory, "status.json");
      const logFile = path.join(runDirectory, "events.jsonl");
      const stdoutFile = path.join(runDirectory, "worker.stdout.log");
      const stderrFile = path.join(runDirectory, "worker.stderr.log");
      const steerFile = path.join(runDirectory, "steer.jsonl");
      const schemaFile = request.schema ? path.join(runDirectory, "schema.json") : undefined;
      const contextFile = request.kiroContext ? path.join(runDirectory, "kiro-context.json") : undefined;
      fs.writeFileSync(taskFile, request.task, { encoding: "utf8", mode: 0o600 });
      if (schemaFile) fs.writeFileSync(schemaFile, JSON.stringify(request.schema, null, 2), { mode: 0o600 });
      if (contextFile) fs.writeFileSync(contextFile, JSON.stringify(request.kiroContext, null, 2), { mode: 0o600 });

      const timeoutMs = Math.max(
        MIN_TIMEOUT_MS,
        Math.min(MAX_TIMEOUT_MS, Math.floor(Math.max(this.config.timeoutMs, request.timeoutMs ?? 0))),
      );
      const thinking = request.suppressThinkingDefault
        ? request.thinking
        : request.thinking ?? this.config.thinking;
      const residency = request.kiroResidency ?? "resident";
      const workerArguments = [
        "--id", id,
        "--name", name,
        "--runner", "kiro",
        "--task-file", taskFile,
        "--status-file", statusFile,
        "--log-file", logFile,
        "--cwd", agentCwd,
        "--kiro-binary", this.#kiroBinary,
        "--timeout-ms", String(timeoutMs),
        "--tools", JSON.stringify(tools),
        "--transport", "process",
        ...(request.model ? ["--model", request.model] : []),
        ...(thinking ? ["--thinking", thinking] : []),
        ...(request.systemPrompt?.trim() ? ["--system-prompt", request.systemPrompt.trim()] : []),
        "--project-root", this.#projectRoot,
        "--run-root", path.join(runDirectory, "nested"),
        ...(residency === "one-shot" ? [] : ["--steer-file", steerFile]),
        ...(contextFile ? ["--kiro-context-file", contextFile] : []),
        "--kiro-residency", residency,
        ...(schemaFile ? ["--schema-file", schemaFile] : []),
      ];

      const processHandle = await spawnDetached(
        this.#workerPath,
        workerArguments,
        agentCwd,
        { ambientHelpers: false, stdoutPath: stdoutFile, stderrPath: stderrFile },
      );
      const transport: AgentTransportHandle = {
        kind: "process",
        sessionId: String(processHandle.pid),
        isAlive: processHandle.isAlive,
        stop: processHandle.stop,
      };
      let resolveResult!: (result: AgentRunResult) => void;
      const result = new Promise<AgentRunResult>((resolve) => { resolveResult = resolve; });
      if (signal?.aborted || this.#closing) {
        await transport.stop();
        throw new Error(this.#closing ? "Kiro agent manager is closing" : "Agent launch aborted");
      }
      const managed: ManagedKiroAgent = {
        id, name, task: request.task, cwd: agentCwd, runDirectory, statusFile,
        transport, result, resolve: resolveResult, release, settled: false,
        residency, abortSignal: signal, abortHandler: undefined, stopRequested: false,
        ...(request.model ? { model: request.model } : {}),
        ...(thinking ? { thinking } : {}),
      };
      if (signal) {
        managed.abortHandler = () => void this.stop(id);
        signal.addEventListener("abort", managed.abortHandler, { once: true });
      }
      this.#runs.set(id, managed);
      launchDirectory = undefined;
      void this.#monitor(managed, timeoutMs).catch((error: unknown) => {
        if (managed.settled || managed.stopRequested) return;
        const reason = error instanceof Error ? error.message : String(error);
        const failed = this.#failure(
          managed,
          "failed",
          `Agent monitor failed: ${reason}${this.#workerDiagnostic(managed)}`,
        );
        try { writeRecord(managed.statusFile, failed); } catch { /* run directory may be unavailable */ }
        this.#settle(managed, failed);
      });
      return this.#handle(managed, "running");
    } catch (error) {
      if (launchDirectory) fs.rmSync(launchDirectory, { recursive: true, force: true });
      release();
      throw error;
    }
  }

  async run(request: AgentRunRequest, signal?: AbortSignal): Promise<AgentRunResult> {
    const handle = await this.spawn(request, signal);
    return this.wait(handle.id);
  }

  async wait(id: string): Promise<AgentRunResult> {
    const managed = this.#require(id);
    if (!managed.settled) {
      if (!managed.result) throw new Error(`Agent ${id} has no pending result`);
      return managed.result;
    }
    const record = readRecord(managed.statusFile) ?? managed.latestRecord;
    if (!record || !terminalStatuses.has(record.status)) {
      throw new Error(`Agent ${id} settled without a result`);
    }
    return this.#metadata(record, managed) as AgentRunResult;
  }

  detachSignal(id: string): void {
    const managed = this.#require(id);
    if (managed.abortSignal && managed.abortHandler) {
      managed.abortSignal.removeEventListener("abort", managed.abortHandler);
    }
    managed.abortSignal = undefined;
    managed.abortHandler = undefined;
  }

  status(id: string): AgentRunRecord | AgentHandleInfo {
    const managed = this.#require(id);
    const record = readRecord(managed.statusFile) ?? managed.latestRecord;
    if (!record) return this.#handle(managed, "running");
    managed.latestRecord = record;
    return structuredClone(this.#metadata(record, managed));
  }

  list(): Array<AgentRunRecord | AgentHandleInfo> {
    return [...this.#runs.keys()].map((id) => this.status(id));
  }

  async stop(id: string): Promise<AgentRunResult> {
    const managed = this.#require(id);
    if (managed.settled) {
      if (await managed.transport.isAlive()) await managed.transport.stop();
      return this.wait(id);
    }
    const existing = readRecord(managed.statusFile);
    if (existing && terminalStatuses.has(existing.status)) {
      // A worker can publish its final record before its process and
      // descendants leave. Preserve that result, but do not release its lane
      // (or let close ignore it) until transport ownership is discharged.
      managed.stopRequested = true;
      try {
        if (await managed.transport.isAlive()) await managed.transport.stop();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const failed = this.#failure(
          managed,
          "failed",
          `Agent reached ${existing.status}, but transport cleanup failed: ${reason}${this.#workerDiagnostic(managed)}`,
        );
        try { writeRecord(managed.statusFile, failed); } catch { /* preserve waiter settlement */ }
        this.#settle(managed, failed);
        return failed;
      }
      const result = this.#metadata(existing, managed) as AgentRunResult;
      this.#settle(managed, result);
      return result;
    }
    // This synchronous ownership marker linearizes stop against the detached
    // monitor. Once set, only stop may classify the run's terminal outcome.
    managed.stopRequested = true;
    try {
      await managed.transport.stop();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const stopped = this.#failure(
        managed,
        "stopped",
        `Agent stopped; transport cleanup failed: ${reason}${this.#workerDiagnostic(managed)}`,
      );
      try { writeRecord(managed.statusFile, stopped); } catch { /* preserve waiter settlement */ }
      this.#settle(managed, stopped);
      return stopped;
    }
    const terminal = readRecord(managed.statusFile);
    const result = terminal?.status === "stopped"
      ? this.#metadata(terminal, managed) as AgentRunResult
      : this.#failure(managed, "stopped", `Agent stopped${this.#workerDiagnostic(managed)}`);
    if (terminal?.status !== "stopped") {
      try { writeRecord(managed.statusFile, result); } catch { /* preserve waiter settlement */ }
    }
    this.#settle(managed, result);
    return result;
  }

  async cleanup(id: string): Promise<{ cleaned: boolean }> {
    const managed = this.#require(id);
    if (!managed.settled) throw new Error("Cannot clean up a running agent");
    fs.rmSync(managed.runDirectory, { recursive: true, force: true });
    this.#runs.delete(id);
    return { cleaned: !fs.existsSync(managed.runDirectory) };
  }

  readLog(id: string, opts: { lines?: number; before?: number } = {}): FabricAgentLog {
    const managed = this.#require(id);
    const logFile = path.join(managed.runDirectory, "events.jsonl");
    const page = readJsonlPage(logFile, Math.max(1, Math.min(opts.lines ?? 200, 5000)), opts.before);
    const status = readRecord(managed.statusFile);
    return {
      id,
      runDirectory: managed.runDirectory,
      logFile,
      events: page.lines,
      hasMore: page.hasMore,
      ...(page.before !== undefined ? { before: page.before } : {}),
      ...(status ? { status: this.#metadata(status, managed) } : {}),
    };
  }

  steer(id: string, message: string, data?: unknown): AgentSteerResult {
    return this.#appendSteer(id, { type: "steer", message, data });
  }

  followUp(id: string, message: string, data?: unknown): AgentSteerResult {
    return this.#appendSteer(id, { type: "follow_up", message, data });
  }

  setSteeringMode(id: string, mode: FabricSteeringMode): AgentSteerResult {
    return this.#appendSteer(id, { type: "set_steering_mode", mode });
  }

  setFollowUpMode(id: string, mode: FabricSteeringMode): AgentSteerResult {
    return this.#appendSteer(id, { type: "set_follow_up_mode", mode });
  }

  #appendSteer(id: string, entry: Omit<AgentSteerEntry, "id" | "ts">): AgentSteerResult {
    const managed = this.#require(id);
    if (managed.residency === "one-shot") {
      throw new Error(`Fabric agent ${id} is one-shot; steering has no target`);
    }
    const record = readRecord(managed.statusFile);
    if (managed.settled || (record && terminalStatuses.has(record.status))) {
      throw new Error(`Fabric agent ${id} already finished (${record?.status ?? "settled"}); steering has no target`);
    }
    const messageId = randomUUID();
    const line = JSON.stringify({ ...entry, id: messageId, ts: Date.now() }) + "\n";
    const bytes = Buffer.byteLength(line, "utf8");
    if (bytes > MAX_AGENT_STEER_LINE_BYTES) {
      throw new Error(`Fabric agent steering command is too large (${bytes} bytes; maximum ${MAX_AGENT_STEER_LINE_BYTES})`);
    }
    const steerFile = path.join(managed.runDirectory, "steer.jsonl");
    let queuedBytes = 0;
    try { queuedBytes = fs.statSync(steerFile).size; } catch { /* first command */ }
    if (queuedBytes + bytes > MAX_KIRO_STEER_FILE_BYTES) {
      throw new Error(
        `Fabric agent steering queue is full (${queuedBytes} bytes; maximum ${MAX_KIRO_STEER_FILE_BYTES})`,
      );
    }
    fs.appendFileSync(steerFile, line, { encoding: "utf8", mode: 0o600 });
    return { queued: true, messageId };
  }

  async close(): Promise<void> {
    this.#closing = true;
    while (this.#waiters.length > 0) this.#waiters.shift()?.();
    // Include settled records defensively: terminal status and OS process exit
    // are separate events, and close must never leave a live owned transport.
    const runs = [...this.#runs.values()];
    await Promise.allSettled(runs.map((run) => this.stop(run.id)));
    if (this.#managedTempRoot || !this.config.retainRuns) {
      fs.rmSync(this.#runRoot, { recursive: true, force: true });
    }
  }

  #require(id: string): ManagedKiroAgent {
    const managed = this.#runs.get(id);
    if (!managed) throw new Error(`Unknown Fabric agent id: ${id}`);
    return managed;
  }

  #handle(managed: ManagedKiroAgent, status: AgentHandleInfo["status"]): AgentHandleInfo {
    return {
      id: managed.id,
      name: managed.name,
      status,
      runner: "kiro",
      transport: "process",
      cwd: managed.cwd,
      ...(managed.transport.sessionId ? { sessionId: managed.transport.sessionId } : {}),
      ...(managed.model ? { model: managed.model } : {}),
      ...(managed.thinking ? { thinking: managed.thinking } : {}),
    };
  }

  #metadata(record: AgentRunRecord, managed: ManagedKiroAgent): AgentRunRecord {
    return {
      ...record,
      runner: "kiro",
      transport: "process",
      cwd: managed.cwd,
      ...(managed.transport.sessionId ? { sessionId: managed.transport.sessionId } : {}),
      ...(managed.model && !record.model ? { model: managed.model } : {}),
      ...(managed.thinking && !record.thinking ? { thinking: managed.thinking } : {}),
    };
  }

  #workerDiagnostic(managed: ManagedKiroAgent): string {
    const stderrFile = path.join(managed.runDirectory, "worker.stderr.log");
    try {
      const bytes = fs.statSync(stderrFile).size;
      return bytes > 0 ? `; worker stderr captured (${bytes} bytes) at ${stderrFile}` : "";
    } catch {
      return "";
    }
  }

  #failure(
    managed: ManagedKiroAgent,
    status: "failed" | "stopped" | "timed_out",
    error: string,
  ): AgentRunResult {
    const now = Date.now();
    return {
      id: managed.id,
      name: managed.name,
      task: managed.task,
      status,
      runner: "kiro",
      transport: "process",
      cwd: managed.cwd,
      startedAt: now,
      updatedAt: now,
      finishedAt: now,
      turns: 0,
      toolCalls: 0,
      text: "",
      error,
      usage: unavailableUsage(),
      ...(managed.transport.sessionId ? { sessionId: managed.transport.sessionId } : {}),
      ...(managed.model ? { model: managed.model } : {}),
      ...(managed.thinking ? { thinking: managed.thinking } : {}),
    };
  }

  #settle(managed: ManagedKiroAgent, result: AgentRunResult): void {
    if (managed.settled) return;
    managed.settled = true;
    managed.latestRecord = result;
    if (managed.abortSignal && managed.abortHandler) {
      managed.abortSignal.removeEventListener("abort", managed.abortHandler);
    }
    managed.abortSignal = undefined;
    managed.abortHandler = undefined;
    managed.release();
    managed.resolve?.(result);
    managed.resolve = undefined;
    managed.result = undefined;
  }

  async #reapTerminalTransport(managed: ManagedKiroAgent): Promise<void> {
    if (await managed.transport.isAlive()) await managed.transport.stop();
    if (managed.stopRequested || managed.settled) return;
    if (await managed.transport.isAlive()) {
      throw new Error("transport remained alive after bounded cleanup");
    }
  }

  async #monitor(managed: ManagedKiroAgent, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs + TRANSPORT_EXIT_GRACE_MS;
    let deadSince: number | undefined;
    while (!managed.settled && !managed.stopRequested) {
      const record = readRecord(managed.statusFile);
      if (record) managed.latestRecord = record;
      if (record && terminalStatuses.has(record.status)) {
        await this.#reapTerminalTransport(managed);
        if (managed.stopRequested || managed.settled) return;
        this.#settle(managed, this.#metadata(record, managed) as AgentRunResult);
        return;
      }
      if (Date.now() >= deadline) {
        await managed.transport.stop();
        if (managed.stopRequested || managed.settled) return;
        const timedOut = this.#failure(managed, "timed_out", `Agent timed out after ${timeoutMs}ms`);
        writeRecord(managed.statusFile, timedOut);
        this.#settle(managed, timedOut);
        return;
      }
      const alive = await managed.transport.isAlive();
      if (managed.stopRequested || managed.settled) return;
      if (!alive) {
        deadSince ??= Date.now();
        if (Date.now() - deadSince >= TRANSPORT_EXIT_GRACE_MS) {
          const failed = this.#failure(
            managed,
            "failed",
            `Agent transport exited without a result${this.#workerDiagnostic(managed)}`,
          );
          writeRecord(managed.statusFile, failed);
          this.#settle(managed, failed);
          return;
        }
      } else {
        deadSince = undefined;
      }
      await delay(STATUS_POLL_MS);
    }
  }
}
