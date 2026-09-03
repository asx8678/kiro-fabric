#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveKiroAgentLaunchContext } from "./power/agent-launch-context.js";

const PROCESS_SHUTDOWN_TIMEOUT_MS = 8_000;
const PARENT_LIVENESS_INTERVAL_MS = 1_000;

let processServerTask: Promise<{ close(): Promise<void> }> | undefined;
const boundedError = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error))
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .slice(0, 800) || "unknown failure";

/** Starting the process-owned server is idempotent. Kiro may invoke health
 * tooling repeatedly during one chat (including after compaction), but a
 * module instance can create only one stdio transport/server pair. */
export const startKiroMcpServer = (): Promise<{ close(): Promise<void> }> =>
  processServerTask ??= (async () => {
    const launch = resolveKiroAgentLaunchContext();
    const { createKiroMcpServer } = await import("./mcp-server.js");
    return createKiroMcpServer({ runtimeRoot: launch.runtimeRoot, dataRoot: launch.dataRoot });
  })();

const processIsAlive = (pid: number): boolean => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export const runKiroMcpProcess = async (): Promise<number> => {
  let server: { close(): Promise<void> };
  try { server = await startKiroMcpServer(); }
  catch (error) {
    process.stderr.write(`kiro-fabric Agent MCP failed to start: ${boundedError(error)}\n`);
    return 1;
  }
  return new Promise<number>((resolve) => {
    let closing = false;
    const initialParentPid = process.ppid;
    let parentTimer: NodeJS.Timeout | undefined;
    const cleanup = (): void => {
      process.removeListener("SIGHUP", onSighup);
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      process.stdin.removeListener("end", onEnd);
      process.stdin.removeListener("close", onStdinClose);
      process.stdin.removeListener("error", onStdinError);
      if (parentTimer) clearInterval(parentTimer);
    };
    const finish = (code: number): void => { cleanup(); resolve(code); };
    const close = (code: number): void => {
      if (closing) return;
      closing = true;
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`shutdown exceeded ${PROCESS_SHUTDOWN_TIMEOUT_MS}ms`)),
          PROCESS_SHUTDOWN_TIMEOUT_MS,
        );
      });
      void Promise.race([server.close(), timeout]).then(
        () => finish(code),
        (error) => {
          process.stderr.write(`kiro-fabric Agent MCP shutdown failed: ${boundedError(error)}\n`);
          finish(1);
        },
      ).finally(() => { if (timer) clearTimeout(timer); });
    };
    const onSighup = (): void => close(129);
    const onSigint = (): void => close(130);
    const onSigterm = (): void => close(143);
    const onEnd = (): void => close(0);
    const onStdinClose = (): void => close(process.stdin.readableEnded ? 0 : 1);
    const onStdinError = (error: Error): void => {
      process.stderr.write(`kiro-fabric Agent MCP stdin failed: ${boundedError(error)}\n`);
      close(1);
    };
    const checkParent = (): void => {
      if (process.ppid !== initialParentPid || !processIsAlive(initialParentPid)) close(1);
    };
    process.once("SIGHUP", onSighup);
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    process.stdin.once("end", onEnd);
    process.stdin.once("close", onStdinClose);
    process.stdin.once("error", onStdinError);
    parentTimer = setInterval(checkParent, PARENT_LIVENESS_INTERVAL_MS);
    parentTimer.unref();
    if (process.stdin.readableEnded) queueMicrotask(onEnd);
    else if (process.stdin.destroyed) queueMicrotask(onStdinClose);
    queueMicrotask(checkParent);
  });
};

const invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
const self = realpathSync(fileURLToPath(import.meta.url));
if (invoked === self) process.exit(await runKiroMcpProcess());
