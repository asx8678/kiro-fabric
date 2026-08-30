#!/usr/bin/env node
// Executable entry for the Kiro MCP stdio server. Only starts when this
// file is the process entry point, so import-based build assertions stay inert.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const startKiroMcpServer = async (): Promise<{ close(): Promise<void> }> => {
  const { createKiroMcpServer } = await import("./mcp-server.js");
  const { resolveKiroMcpLaunchEnvironment } = await import("./mcp-environment.js");
  const { parseKiroChildToolsEnv } = await import("./run-scope.js");
  const launch = resolveKiroMcpLaunchEnvironment();
  const server = await createKiroMcpServer(launch.mode === "power"
    ? { integration: "power", pluginRoot: launch.pluginRoot, pluginData: launch.pluginData }
    : {
        integration: launch.mode,
        cwd: launch.cwd,
        ...(launch.mode === "internal-child" ? { tools: parseKiroChildToolsEnv(launch.toolsEnv) } : {}),
        ...(launch.mode === "strict" && /^1$/i.test(process.env.KIRO_FABRIC_ENABLE_SUBAGENTS ?? "") ? { enableSubagents: true } : {}),
      });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try { await server.close(); } finally { process.exit(0); }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("end", () => void shutdown());
  return server;
};

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
const selfPath = fileURLToPath(import.meta.url);
if (invokedPath === selfPath || invokedPath === realpathSync(selfPath)) {
  const launchError = await (async (): Promise<Error | null> => {
    try {
      await startKiroMcpServer();
      return null;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  })();

  if (launchError !== null) {
    // Fail closed, but over the protocol: a confined trusted profile must not
    // start, yet dying before the initialize handshake leaves Kiro with an
    // opaque inbound-close diagnostic.
    const reason = `kiro-fabric MCP server failed to start: ${launchError.message}`;
    console.error(reason);
    serveStartupError(reason);
  }
}

/**
 * Serve the newline-delimited JSON-RPC handshake with the startup failure
 * reason so the MCP host can surface it, then exit non-zero once the host
 * closes stdin or a hard grace period expires.
 */
function serveStartupError(message: string): void {
  const respond = (incoming: string) => {
    let request: { id?: unknown } | null = null;
    try {
      const parsed = JSON.parse(incoming) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") request = parsed as { id?: unknown };
    } catch {
      // ignore non-JSON probes
    }
    if (request?.id !== undefined) {
      responded = true;
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0" as const,
          id: request.id,
          error: { code: -32603 as const, message },
        })}\n`,
      );
    }
  };

  let buffer = "";
  process.stdin.setEncoding("utf8");
  let responded = false;
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let index: number;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) respond(line);
    }
  });
  process.stdin.on("end", () => process.exit(1));
  // Hosts that never issue a request must not strand this child; bound the
  // diagnostic window and then fail the launch loudly.
  setTimeout(() => process.exit(1), 15_000);
  process.on("SIGINT", () => process.exit(1));
  process.on("SIGTERM", () => process.exit(1));
  // After the first diagnostic response the launch is genuinely refused;
  // closing stdin once the pipe drained keeps the failed child from lingering
  // while still letting the host read the failure reason.
  process.stdout.on("drain", () => {
    if (responded) process.stdin.end();
  });
};
