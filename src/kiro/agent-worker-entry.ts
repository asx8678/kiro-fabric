#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { KiroAgentRunRecord as AgentRunRecord } from "./agent-types.js";
import { runKiroWorker, type KiroWorkerRecordHelpers } from "./acp-worker.js";
import { parseKiroAgentWorkerOptions, type KiroAgentWorkerOptions } from "./agent-worker-options.js";

const MAX_RUN_ERROR_CHARS = 20_000;
const MAX_RUN_TEXT_CHARS = 100_000;

type CrashContext = { statusFile: string; record: AgentRunRecord };

const writeRunRecord = (filePath: string, record: AgentRunRecord): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = filePath + "." + process.pid + ".tmp";
  fs.writeFileSync(temporaryPath, JSON.stringify({ ...record, format: 2 }, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
};

const updateRunRecord = (filePath: string, record: AgentRunRecord): void => {
  record.updatedAt = Date.now();
  writeRunRecord(filePath, record);
};

const createRunningRecord = (
  options: KiroAgentWorkerOptions,
  task: string,
  thinking: AgentRunRecord["thinking"],
  startedAt: number,
): AgentRunRecord => ({
  id: options.id,
  name: options.name,
  task,
  status: "running",
  runner: "kiro",
  transport: options.transport,
  cwd: options.cwd,
  ...(options.model ? { model: options.model } : {}),
  ...(thinking ? { thinking } : {}),
  ...(options.actorId ? { actorId: options.actorId } : {}),
  ...(options.actorName ? { actorName: options.actorName } : {}),
  ...(options.capabilityRequirements ? { capabilityRequirements: [...options.capabilityRequirements] } : {}),
  ...(options.capabilityDigest ? { capabilityDigest: options.capabilityDigest } : {}),
  startedAt,
  updatedAt: startedAt,
  turns: 0,
  toolCalls: 0,
  text: "",
  usage: {
    availability: "unavailable",
    reason: "runner-does-not-report",
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
  },
  logFile: options.logFile,
  ...(options.branch ? { branch: options.branch } : {}),
  ...(options.worktree ? { worktree: options.worktree } : {}),
});

export const writeKiroWorkerCrashStatus = (context: CrashContext | undefined, error: unknown): void => {
  if (!context || context.record.status !== "running") return;
  const reason = error instanceof Error ? error.message : String(error);
  const crashed: AgentRunRecord = {
    ...context.record,
    status: "failed",
    error: ("Worker crashed before reporting a result: " + reason).slice(0, MAX_RUN_ERROR_CHARS),
    finishedAt: Date.now(),
    updatedAt: Date.now(),
  };
  delete crashed.currentTool;
  try { writeRunRecord(context.statusFile, crashed); } catch { /* Best effort. */ }
};

export const installKiroWorkerCrashHandlers = (
  getContext: () => CrashContext | undefined,
): (() => void) => {
  const fail = (error: unknown, prefix = ""): void => {
    writeKiroWorkerCrashStatus(getContext(), error);
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(prefix + detail + "\n");
    process.exit(1);
  };
  const uncaught = (error: Error): void => fail(error);
  const rejected = (error: unknown): void => fail(error, "Unhandled rejection: ");
  process.on("uncaughtException", uncaught);
  process.on("unhandledRejection", rejected);
  return () => {
    process.off("uncaughtException", uncaught);
    process.off("unhandledRejection", rejected);
  };
};

export const runKiroAgentWorkerEntry = async (
  argv: readonly string[] = process.argv,
  onCrashContext?: (context: CrashContext) => void,
): Promise<number> => {
  let crashContext: CrashContext | undefined;
  try {
    const options = parseKiroAgentWorkerOptions(argv);
    const helpers: KiroWorkerRecordHelpers = {
      createRunningRecord: (workerOptions, task, thinking, startedAt) => {
        const record = createRunningRecord(workerOptions, task, thinking, startedAt);
        crashContext = { statusFile: workerOptions.statusFile, record };
        onCrashContext?.(crashContext);
        return record;
      },
      writeRunRecord,
      updateRunRecord,
      latestRunText: (text) => Array.from(text).slice(-MAX_RUN_TEXT_CHARS).join(""),
    };
    const record = await runKiroWorker(options, helpers);
    crashContext = { statusFile: options.statusFile, record };
    onCrashContext?.(crashContext);
    return record.status === "completed" ? 0 : 1;
  } catch (error) {
    writeKiroWorkerCrashStatus(crashContext, error);
    process.stderr.write((error instanceof Error ? error.stack ?? error.message : String(error)) + "\n");
    return 1;
  }
};

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const selfPath = path.resolve(fileURLToPath(import.meta.url));
if (invokedPath === selfPath) {
  let crashContext: CrashContext | undefined;
  const removeHandlers = installKiroWorkerCrashHandlers(() => crashContext);
  try {
    process.exitCode = await runKiroAgentWorkerEntry(process.argv, (context) => { crashContext = context; });
  } finally {
    removeHandlers();
  }
}
