#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveKiroAgentLaunchContext } from "./power/agent-launch-context.js";

const PROCESS_SHUTDOWN_TIMEOUT_MS = 8_000;

export const startKiroMcpServer = async (): Promise<{ close(): Promise<void> }> => {
  const launch = resolveKiroAgentLaunchContext();
  const { createKiroMcpServer } = await import("./mcp-server.js");
  return createKiroMcpServer({ runtimeRoot: launch.runtimeRoot, dataRoot: launch.dataRoot });
};

export const runKiroMcpProcess = async (): Promise<number> => {
  let server: { close(): Promise<void> };
  try { server = await startKiroMcpServer(); }
  catch (error) {
    process.stderr.write(`kiro-fabric Agent MCP failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  return new Promise<number>((resolve) => {
    let closing = false;
    const cleanup = (): void => {
      process.removeListener("SIGHUP", onSighup);
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      process.stdin.removeListener("end", onEnd);
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
          process.stderr.write(`kiro-fabric Agent MCP shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`);
          finish(1);
        },
      ).finally(() => { if (timer) clearTimeout(timer); });
    };
    const onSighup = (): void => close(129);
    const onSigint = (): void => close(130);
    const onSigterm = (): void => close(143);
    const onEnd = (): void => close(0);
    process.once("SIGHUP", onSighup);
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    process.stdin.once("end", onEnd);
    if (process.stdin.readableEnded || process.stdin.destroyed) queueMicrotask(onEnd);
  });
};

const invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
const self = realpathSync(fileURLToPath(import.meta.url));
if (invoked === self) process.exit(await runKiroMcpProcess());
