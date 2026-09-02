#!/usr/bin/env node
import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
globalThis.__filename = __fileURLToPath(import.meta.url);
globalThis.__dirname = __dirnameOf(globalThis.__filename);
const require = __createRequire(import.meta.url);

import {
  canonicalPathContains,
  inspectCanonicalPath
} from "../chunks/chunk-4KRLFCN5.js";
import "../chunks/chunk-LSWTYIW3.js";

// src/kiro/mcp-entry.ts
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// src/kiro/power/launch-context.ts
import path from "node:path";
var canonicalDirectory = (value, name) => {
  if (!value) throw new Error(`Power launch is missing ${name}`);
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  try {
    return inspectCanonicalPath(value, {
      kind: "directory",
      rejectFinalSymlink: true
    }).canonicalPath;
  } catch (error) {
    throw new Error(`${name} must be an existing directory: ${error.message}`);
  }
};
var resolveKiroPowerLaunchContext = (env = process.env) => {
  const pluginRoot = canonicalDirectory(env.PLUGIN_ROOT, "PLUGIN_ROOT");
  const pluginData = canonicalDirectory(env.PLUGIN_DATA, "PLUGIN_DATA");
  if (pluginRoot === pluginData) throw new Error("PLUGIN_ROOT and PLUGIN_DATA must be different directories");
  if (canonicalPathContains(pluginRoot, pluginData) || canonicalPathContains(pluginData, pluginRoot)) {
    throw new Error("PLUGIN_ROOT and PLUGIN_DATA must not contain one another");
  }
  return { pluginRoot, pluginData };
};

// src/kiro/mcp-entry.ts
var PROCESS_SHUTDOWN_TIMEOUT_MS = 8e3;
var startKiroMcpServer = async () => {
  const launch = resolveKiroPowerLaunchContext();
  const { createKiroMcpServer } = await import("../chunks/mcp-server-6KNQQIEW.js");
  return createKiroMcpServer({ pluginRoot: launch.pluginRoot, pluginData: launch.pluginData });
};
var runKiroMcpProcess = async () => {
  let server;
  try {
    server = await startKiroMcpServer();
  } catch (error) {
    process.stderr.write(`kiro-fabric Power MCP failed to start: ${error instanceof Error ? error.message : String(error)}
`);
    return 1;
  }
  return new Promise((resolve) => {
    let closing = false;
    const cleanup = () => {
      process.removeListener("SIGHUP", onSighup);
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      process.stdin.removeListener("end", onEnd);
    };
    const finish = (code) => {
      cleanup();
      resolve(code);
    };
    const close = (code) => {
      if (closing) return;
      closing = true;
      let timer;
      const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`shutdown exceeded ${PROCESS_SHUTDOWN_TIMEOUT_MS}ms`)),
          PROCESS_SHUTDOWN_TIMEOUT_MS
        );
      });
      void Promise.race([server.close(), timeout]).then(
        () => finish(code),
        (error) => {
          process.stderr.write(`kiro-fabric Power MCP shutdown failed: ${error instanceof Error ? error.message : String(error)}
`);
          finish(1);
        }
      ).finally(() => {
        if (timer) clearTimeout(timer);
      });
    };
    const onSighup = () => close(129);
    const onSigint = () => close(130);
    const onSigterm = () => close(143);
    const onEnd = () => close(0);
    process.once("SIGHUP", onSighup);
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    process.stdin.once("end", onEnd);
    if (process.stdin.readableEnded || process.stdin.destroyed) queueMicrotask(onEnd);
  });
};
var invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
var self = realpathSync(fileURLToPath(import.meta.url));
if (invoked === self) process.exit(await runKiroMcpProcess());
export {
  runKiroMcpProcess,
  startKiroMcpServer
};
