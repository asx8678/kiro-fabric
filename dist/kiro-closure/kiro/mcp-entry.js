#!/usr/bin/env node
import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);

import "../chunks/chunk-GX475RD4.js";

// src/kiro/mcp-entry.ts
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
var SHUTDOWN_GRACE_MS = 5e3;
var startKiroMcpServer = async () => {
  const { createKiroMcpServer } = await import("../chunks/mcp-server-OMAJTXK2.js");
  const { resolveKiroMcpLaunchEnvironment } = await import("../chunks/mcp-environment-ODI5PAPL.js");
  const { parseKiroChildToolsEnv } = await import("../chunks/run-scope-2AOED3QV.js");
  const launch = resolveKiroMcpLaunchEnvironment();
  return createKiroMcpServer(launch.mode === "power" ? {
    integration: "power",
    pluginRoot: launch.pluginRoot,
    pluginData: launch.pluginData
  } : {
    integration: launch.mode,
    cwd: launch.cwd,
    ...launch.mode === "internal-child" ? { tools: parseKiroChildToolsEnv(launch.toolsEnv) } : {},
    ...launch.mode === "strict" && /^1$/i.test(process.env.KIRO_FABRIC_ENABLE_SUBAGENTS ?? "") ? { enableSubagents: true } : {}
  });
};
var errorMessage = (error) => error instanceof Error ? error.message : String(error);
var closeWithin = async (server) => {
  let timer;
  try {
    await Promise.race([
      server.close(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`MCP shutdown exceeded ${SHUTDOWN_GRACE_MS}ms`)),
          SHUTDOWN_GRACE_MS
        );
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
var runKiroMcpProcess = async () => {
  let server;
  try {
    server = await startKiroMcpServer();
  } catch (error) {
    const reason = `kiro-fabric MCP server failed to start: ${errorMessage(error)}`;
    process.stderr.write(`${reason}
`);
    return serveStartupError(reason);
  }
  return new Promise((resolve) => {
    let closing = false;
    const cleanup = () => {
      process.removeListener("SIGHUP", onSighup);
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      process.stdin.removeListener("end", onEnd);
      process.stdin.pause();
    };
    const shutdown = (exitCode) => {
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
        (error) => {
          process.stderr.write(`kiro-fabric: shutdown failed: ${errorMessage(error)}
`);
          cleanup();
          process.exit(1);
        }
      );
    };
    const onSighup = () => shutdown(129);
    const onSigint = () => shutdown(130);
    const onSigterm = () => shutdown(143);
    const onEnd = () => shutdown(0);
    process.on("SIGHUP", onSighup);
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    process.stdin.on("end", onEnd);
    if (process.stdin.readableEnded || process.stdin.destroyed) queueMicrotask(onEnd);
  });
};
var invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
var selfPath = fileURLToPath(import.meta.url);
if (invokedPath === selfPath || invokedPath === realpathSync(selfPath)) {
  process.exit(await runKiroMcpProcess());
}
function serveStartupError(message) {
  return new Promise((resolve) => {
    let buffer = "";
    let settled = false;
    const finish = () => {
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
    const respond = (incoming) => {
      let request = null;
      try {
        const parsed = JSON.parse(incoming);
        if (parsed && typeof parsed === "object") request = parsed;
      } catch {
      }
      if (request?.id === void 0 || settled) return;
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32603, message }
        })}
`,
        finish
      );
    };
    const onData = (chunk) => {
      buffer += chunk.toString();
      let index;
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
    const timer = setTimeout(finish, 15e3);
    if (process.stdin.readableEnded || process.stdin.destroyed) queueMicrotask(finish);
  });
}
export {
  runKiroMcpProcess,
  startKiroMcpServer
};
