#!/usr/bin/env node
// Executable entry for the Kiro MCP stdio server. Only starts when this
// file is the process entry point, so import-based build assertions stay inert.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KIRO_MCP_DRAIN_TIMEOUT_MS } from "./deadlines.js";

// Leave a bounded margin for runtime/provider and transport closure after the
// server's own stale-execution drain budget expires.
const SHUTDOWN_GRACE_MS = KIRO_MCP_DRAIN_TIMEOUT_MS + 2_000;

export const startKiroMcpServer = async (): Promise<{ close(): Promise<void> }> => {
  const { createKiroMcpServer } = await import("./mcp-server.js");
  const { resolveKiroMcpLaunchEnvironment } = await import("./mcp-environment.js");
  const { parseKiroChildToolsEnv } = await import("./run-scope.js");
  const launch = resolveKiroMcpLaunchEnvironment();
  return createKiroMcpServer(launch.mode === "power"
    ? {
        integration: "power",
        pluginRoot: launch.pluginRoot,
        pluginData: launch.pluginData,
      }
    : {
        integration: launch.mode,
        cwd: launch.cwd,
        ...(launch.mode === "internal-child"
          ? { tools: parseKiroChildToolsEnv(launch.toolsEnv) }
          : {}),
        ...(launch.mode === "strict" &&
        /^1$/i.test(process.env.KIRO_FABRIC_ENABLE_SUBAGENTS ?? "")
          ? { enableSubagents: true }
          : {}),
      });
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const closeWithin = async (server: { close(): Promise<void> }): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      server.close(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`MCP shutdown exceeded ${SHUTDOWN_GRACE_MS}ms`)),
          SHUTDOWN_GRACE_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** Process lifecycle wrapper used by both executable entry points. */
export const runKiroMcpProcess = async (): Promise<number> => {
  let server: { close(): Promise<void> };
  try {
    server = await startKiroMcpServer();
  } catch (error) {
    const reason = `kiro-fabric MCP server failed to start: ${errorMessage(error)}`;
    process.stderr.write(`${reason}\n`);
    return serveStartupError(reason);
  }

  return new Promise<number>((resolve) => {
    let closing = false;
    const cleanup = (): void => {
      process.removeListener("SIGHUP", onSighup);
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      process.stdin.removeListener("end", onEnd);
      process.stdin.pause();
    };
    const shutdown = (exitCode: number): void => {
      if (closing) {
        cleanup();
        process.exit(exitCode);
      }
      closing = true;
      void closeWithin(server).then(
        () => {
          cleanup();
          resolve(exitCode);
        },
        (error: unknown) => {
          process.stderr.write(`kiro-fabric: shutdown failed: ${errorMessage(error)}\n`);
          cleanup();
          process.exit(1);
        },
      );
    };
    const onSighup = (): void => shutdown(129);
    const onSigint = (): void => shutdown(130);
    const onSigterm = (): void => shutdown(143);
    const onEnd = (): void => shutdown(0);
    process.on("SIGHUP", onSighup);
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    process.stdin.on("end", onEnd);
    if (process.stdin.readableEnded || process.stdin.destroyed) queueMicrotask(onEnd);
  });
};

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
const selfPath = fileURLToPath(import.meta.url);
if (invokedPath === selfPath || invokedPath === realpathSync(selfPath)) {
  process.exit(await runKiroMcpProcess());
}

/**
 * Serve the newline-delimited JSON-RPC handshake with the startup failure
 * reason, flush one diagnostic response, and then exit non-zero.
 */
function serveStartupError(message: string): Promise<number> {
  return new Promise((resolve) => {
    let buffer = "";
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", finish);
      process.removeListener("SIGHUP", finish);
      process.removeListener("SIGINT", finish);
      process.removeListener("SIGTERM", finish);
      process.stdin.pause();
      resolve(1);
    };
    const respond = (incoming: string): void => {
      let request: { id?: unknown } | null = null;
      try {
        const parsed = JSON.parse(incoming) as Record<string, unknown>;
        if (parsed && typeof parsed === "object") request = parsed as { id?: unknown };
      } catch {
        // Ignore non-JSON probes while waiting for a real request.
      }
      if (request?.id === undefined || settled) return;
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0" as const,
          id: request.id,
          error: { code: -32603 as const, message },
        })}\n`,
        finish,
      );
    };
    const onData = (chunk: Buffer | string): void => {
      buffer += chunk.toString();
      let index: number;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) respond(line);
      }
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.on("end", finish);
    process.on("SIGHUP", finish);
    process.on("SIGINT", finish);
    process.on("SIGTERM", finish);
    const timer = setTimeout(finish, 15_000);
    if (process.stdin.readableEnded || process.stdin.destroyed) queueMicrotask(finish);
  });
}
