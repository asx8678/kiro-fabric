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
import "../chunks/chunk-AE4E2KSU.js";

// src/kiro/mcp-entry.ts
import { readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import path2 from "node:path";
import { fileURLToPath } from "node:url";

// src/kiro/power/agent-launch-context.ts
import fs from "node:fs";
import path from "node:path";
var canonicalDirectory = (value, name) => {
  if (!value) throw new Error(`Agent launch is missing ${name}`);
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  try {
    const inspected = inspectCanonicalPath(value, {
      kind: "directory",
      rejectFinalSymlink: true
    });
    const stats = fs.lstatSync(inspected.canonicalPath);
    if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
      throw new Error("directory is not owned by the current user");
    }
    if (process.platform !== "win32" && (stats.mode & 18) !== 0) {
      throw new Error("directory is group/other writable");
    }
    return inspected.canonicalPath;
  } catch (error) {
    throw new Error(`${name} must be an existing directory: ${error.message}`);
  }
};
var resolveKiroAgentLaunchContext = (env = process.env, launchDirectory = () => process.cwd()) => {
  const runtimeRoot = canonicalDirectory(env.KIRO_FABRIC_RUNTIME_ROOT, "KIRO_FABRIC_RUNTIME_ROOT");
  const dataRoot = canonicalDirectory(env.KIRO_FABRIC_DATA_ROOT, "KIRO_FABRIC_DATA_ROOT");
  if (runtimeRoot === dataRoot) throw new Error("runtime and data roots must be different directories");
  if (canonicalPathContains(runtimeRoot, dataRoot) || canonicalPathContains(dataRoot, runtimeRoot)) {
    throw new Error("runtime and data roots must not contain one another");
  }
  let astGrep;
  if (env.KIRO_FABRIC_AST_GREP !== void 0 && env.KIRO_FABRIC_AST_GREP !== "${KIRO_FABRIC_AST_GREP}") {
    astGrep = env.KIRO_FABRIC_AST_GREP;
    const installRoot = path.dirname(path.dirname(astGrep));
    if (!path.isAbsolute(astGrep) || fs.realpathSync(astGrep) !== astGrep || path.basename(astGrep) !== "ast-grep" || path.basename(path.dirname(astGrep)) !== "tools" || runtimeRoot !== path.join(installRoot, "app")) {
      throw new Error("KIRO_FABRIC_AST_GREP must be the canonical tools/ast-grep beside the installed app");
    }
  }
  const source = env.KIRO_FABRIC_WORKSPACE_SOURCE;
  if (source !== void 0 && source !== "launch-cwd") {
    throw new Error("KIRO_FABRIC_WORKSPACE_SOURCE must be launch-cwd when set");
  }
  const handoff = env.KIRO_FABRIC_LAUNCH_WORKSPACE;
  const explicit = handoff !== void 0 && handoff !== "${KIRO_FABRIC_LAUNCH_WORKSPACE}";
  const launchWorkspaceRoot = explicit ? canonicalDirectory(handoff, "KIRO_FABRIC_LAUNCH_WORKSPACE") : source === "launch-cwd" ? canonicalDirectory(launchDirectory(), "MCP launch directory") : void 0;
  const callContext = env.KIRO_FABRIC_FOVEA_CALL_CONTEXT;
  if (callContext !== void 0 && callContext !== "0" && callContext !== "1" && callContext !== "${KIRO_FABRIC_FOVEA_CALL_CONTEXT}") {
    throw new Error("KIRO_FABRIC_FOVEA_CALL_CONTEXT must be 0 or 1 when set");
  }
  return { runtimeRoot, dataRoot, ...astGrep ? { astGrep } : {}, ...launchWorkspaceRoot ? { launchWorkspaceRoot } : {}, ...callContext === "1" ? { foveaCallContext: true } : {} };
};

// src/kiro/mcp-entry.ts
var PROCESS_SHUTDOWN_TIMEOUT_MS = 8e3;
var AST_GREP_VERSION = "0.45.3";
var PARENT_LIVENESS_INTERVAL_MS = 1e3;
var processServerTask;
var boundedError = (error) => (error instanceof Error ? error.message : String(error)).replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 800) || "unknown failure";
var startKiroMcpServer = () => processServerTask ??= (async () => {
  const launch = resolveKiroAgentLaunchContext();
  let server;
  try {
    const managedParser = launch.astGrep ? {
      path: launch.astGrep,
      sha256: createHash("sha256").update(readFileSync(launch.astGrep)).digest("hex"),
      version: AST_GREP_VERSION,
      generationRoot: path2.dirname(path2.dirname(launch.astGrep))
    } : void 0;
    const { createKiroMcpServer } = await import("../chunks/mcp-server-DWDZBYQZ.js");
    server = await createKiroMcpServer({ runtimeRoot: launch.runtimeRoot, dataRoot: launch.dataRoot, ...launch.launchWorkspaceRoot ? { launchWorkspaceRoot: launch.launchWorkspaceRoot } : {}, ...managedParser ? { managedParser } : {}, ...launch.foveaCallContext === true && managedParser ? { foveaCallContext: true } : {} });
    return server;
  } catch (error) {
    processServerTask = void 0;
    await server?.close();
    throw error;
  }
})();
var processIsAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
var runKiroMcpProcess = async () => {
  let server;
  try {
    server = await startKiroMcpServer();
  } catch (error) {
    process.stderr.write(`kiro-fabric Agent MCP failed to start: ${boundedError(error)}
`);
    return 1;
  }
  return new Promise((resolve) => {
    let closing = false;
    const initialParentPid = process.ppid;
    let parentTimer;
    const cleanup = () => {
      process.removeListener("SIGHUP", onSighup);
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      process.stdin.removeListener("end", onEnd);
      process.stdin.removeListener("close", onStdinClose);
      process.stdin.removeListener("error", onStdinError);
      if (parentTimer) clearInterval(parentTimer);
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
          process.stderr.write(`kiro-fabric Agent MCP shutdown failed: ${boundedError(error)}
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
    const onStdinClose = () => close(process.stdin.readableEnded ? 0 : 1);
    const onStdinError = (error) => {
      process.stderr.write(`kiro-fabric Agent MCP stdin failed: ${boundedError(error)}
`);
      close(1);
    };
    const checkParent = () => {
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
var invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
var self = realpathSync(fileURLToPath(import.meta.url));
if (invoked === self) {
  if (process.argv[2] === "--first-prompt-hook") {
    const { runFirstPromptHook } = await import("../chunks/first-prompt-hook-WOQFVOC3.js");
    process.exit(await runFirstPromptHook(process.argv.length === 4 ? process.argv[3] : void 0));
  }
  process.exit(await runKiroMcpProcess());
}
export {
  runKiroMcpProcess,
  startKiroMcpServer
};
