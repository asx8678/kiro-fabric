import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);

import {
  createProcessTreeController
} from "./chunk-SXRQQ7MG.js";

// src/agents/transports/process-utils.ts
import { execFile, spawn } from "node:child_process";
import path from "node:path";
var executeFile = (command, args, options = {}) => new Promise((resolve, reject) => {
  execFile(
    command,
    args,
    {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      ...options.cwd ? { cwd: options.cwd } : {},
      ...options.timeoutMs ? { timeout: options.timeoutMs } : {}
    },
    (error, stdout, stderr) => {
      if (error) {
        Object.assign(error, { stdout, stderr });
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    }
  );
});
var commandAvailable = async (command) => {
  try {
    await executeFile("sh", ["-lc", `command -v ${shellQuote(command)}`], { timeoutMs: 2e3 });
    return true;
  } catch {
    return false;
  }
};
var shellQuote = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;
var GENERIC_RUNTIME = /^(node|bun)(\.exe)?$/;
var runtimeOverride = (env) => {
  const value = env.KIRO_FABRIC_NODE_BINARY;
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
};
var isGenericRuntime = (execPath, requireNode) => {
  const name = path.basename(execPath).toLowerCase();
  return GENERIC_RUNTIME.test(name) && (!requireNode || name.startsWith("node"));
};
var missingRuntimeError = (execPath) => new Error(
  `Fabric requires a Node.js or Bun runtime to launch a JavaScript worker, but process.execPath is ${execPath} (not node/bun) and KIRO_FABRIC_NODE_BINARY is unset. Install Node.js or Bun, or set KIRO_FABRIC_NODE_BINARY to the runtime binary.`
);
var resolveScriptRuntimeUncached = async (options = {}) => {
  const execPath = options.execPath ?? process.execPath;
  const env = options.env ?? process.env;
  const requireNode = options.requireNode === true;
  const override = runtimeOverride(env);
  if (override) return override;
  if (isGenericRuntime(execPath, requireNode)) return execPath;
  for (const candidate of requireNode ? ["node"] : ["node", "bun"]) {
    if (await commandAvailable(candidate)) return candidate;
  }
  throw missingRuntimeError(execPath);
};
var cachedDefaultRuntime;
var resolveScriptRuntime = async (options) => {
  if (options && (options.execPath !== void 0 || options.env !== void 0 || options.requireNode !== void 0)) {
    return resolveScriptRuntimeUncached(options);
  }
  if (cachedDefaultRuntime) return cachedDefaultRuntime;
  cachedDefaultRuntime = await resolveScriptRuntimeUncached();
  return cachedDefaultRuntime;
};
var resolveScriptRuntimeSync = (options = {}) => {
  const execPath = options.execPath ?? process.execPath;
  const env = options.env ?? process.env;
  const requireNode = options.requireNode === true;
  const override = runtimeOverride(env);
  if (override) return override;
  if (isGenericRuntime(execPath, requireNode)) return execPath;
  throw missingRuntimeError(execPath);
};
var spawnDetached = async (workerPath, workerArguments, cwd, options = {}) => {
  const runtime = await resolveScriptRuntime();
  const child = spawn(runtime, [workerPath, ...workerArguments], {
    cwd,
    detached: process.platform !== "win32",
    stdio: "ignore"
  });
  if (!child.pid) throw new Error("Failed to launch Fabric worker process");
  const pid = child.pid;
  const tree = createProcessTreeController(pid, {
    ambientHelpers: options.ambientHelpers !== false
  });
  child.unref();
  return {
    pid,
    async stop() {
      await tree.terminate();
    },
    async isAlive() {
      return !tree.gone();
    }
  };
};

export {
  resolveScriptRuntimeSync,
  spawnDetached
};
