import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);


// src/agents/transports/process-utils.ts
import { execFile, spawn as spawn2 } from "node:child_process";
import fs from "node:fs";
import path2 from "node:path";

// src/worker/process-tree.ts
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
var TEST_PLATFORM_ENV = "KIRO_FABRIC_TEST_PLATFORM";
var TEST_PS_FAILURE_ENV = "KIRO_FABRIC_TEST_PS_FAILURE";
var runtimePlatform = () => process.env[TEST_PLATFORM_ENV] ?? process.platform;
var WINDOWS_PROCESS_COMMAND = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress";
var sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});
var pidExists = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
var parsePsEntries = (stdout) => stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => line.split(/\s+/u)).map((fields) => ({
  pid: Number(fields[0]),
  ppid: Number(fields[1]),
  pgid: Number(fields[2]),
  state: fields[3] ?? "?",
  // lstart is five whitespace-separated fields. It is a stable-enough
  // process-instance fingerprint on macOS, where procfs is unavailable.
  ...fields.length >= 9 ? { identity: `ps:${fields.slice(4, 9).join(" ")}` } : {},
  ...fields.length > 9 ? { command: fields.slice(9).join(" ").slice(0, 160) } : {}
})).filter(
  (entry) => Number.isSafeInteger(entry.pid) && entry.pid > 0 && Number.isSafeInteger(entry.ppid) && entry.ppid >= 0 && Number.isSafeInteger(entry.pgid) && entry.pgid > 0 && entry.state.length > 0
);
var psExecutable = () => existsSync("/bin/ps") ? "/bin/ps" : "ps";
var readPsProcessTable = () => {
  if (process.env[TEST_PS_FAILURE_ENV] === "1") return null;
  try {
    const stdout = execFileSync(
      psExecutable(),
      ["-axo", "pid=,ppid=,pgid=,state=,lstart=,command="],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2e3
      }
    );
    return parsePsEntries(stdout);
  } catch {
    return null;
  }
};
var readLinuxProcessTable = () => {
  if (runtimePlatform() !== "linux") return null;
  try {
    const entries = [];
    for (const name of readdirSync("/proc")) {
      if (!/^\d+$/u.test(name)) continue;
      try {
        const stat = readFileSync(`/proc/${name}/stat`, "utf8");
        const close = stat.lastIndexOf(") ");
        if (close < 0) continue;
        const fields = stat.slice(close + 2).trim().split(/\s+/u);
        const pid = Number(name);
        const state = fields[0] ?? "?";
        const ppid = Number(fields[1]);
        const pgid = Number(fields[2]);
        const startTicks = fields[19];
        if (Number.isSafeInteger(pid) && Number.isSafeInteger(ppid) && Number.isSafeInteger(pgid)) {
          entries.push({
            pid,
            ppid,
            pgid,
            state,
            ...startTicks ? { identity: `linux:${startTicks}` } : {}
          });
        }
      } catch {
      }
    }
    return entries;
  } catch {
    return null;
  }
};
var readPosixProcessTable = (ambientHelpers = true) => {
  const platform = runtimePlatform();
  if (platform === "linux") return readLinuxProcessTable() ?? (ambientHelpers ? readPsProcessTable() : null);
  if (platform === "darwin") return readPsProcessTable();
  return ambientHelpers ? readPsProcessTable() : null;
};
var processStateIsRunning = (state) => {
  const code = state.trim().charAt(0).toUpperCase();
  return code !== "Z" && code !== "X" && code !== "";
};
var processTreeFromEntries = (entries, pid) => {
  const root = entries.find((entry) => entry.pid === pid);
  if (!root) return null;
  const children = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const list = children.get(entry.ppid) ?? [];
    list.push(entry.pid);
    children.set(entry.ppid, list);
  }
  const queue = [pid];
  const tree = /* @__PURE__ */ new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || tree.has(current)) continue;
    tree.add(current);
    for (const child of children.get(current) ?? []) queue.push(child);
  }
  for (const entry of entries) {
    if (entry.pgid === root.pgid) tree.add(entry.pid);
  }
  return { pgid: root.pgid, members: [...tree].sort((left, right) => left - right) };
};
var readPosixProcessTree = (pid) => {
  const entries = readPosixProcessTable(true);
  return entries ? processTreeFromEntries(entries, pid) : null;
};
var parseWindowsProcessTree = (stdout) => {
  const parsed = JSON.parse(stdout);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.filter(
    (row) => typeof row === "object" && row !== null
  ).map((row) => ({
    processId: Number(row.ProcessId),
    parentProcessId: Number(row.ParentProcessId)
  })).filter(
    (row) => Number.isSafeInteger(row.processId) && row.processId > 0 && Number.isSafeInteger(row.parentProcessId) && row.parentProcessId >= 0
  );
};
var readWindowsDescendants = (pid) => {
  for (const shell of ["powershell.exe", "pwsh.exe", "pwsh"]) {
    try {
      const stdout = execFileSync(shell, ["-NoProfile", "-Command", WINDOWS_PROCESS_COMMAND], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        timeout: 2e3
      }).trim();
      if (!stdout) return [pid];
      const rows = parseWindowsProcessTree(stdout);
      const children = /* @__PURE__ */ new Map();
      for (const row of rows) {
        const list = children.get(row.parentProcessId) ?? [];
        list.push(row.processId);
        children.set(row.parentProcessId, list);
      }
      const queue = [pid];
      const seen = /* @__PURE__ */ new Set();
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || seen.has(current)) continue;
        seen.add(current);
        for (const child of children.get(current) ?? []) queue.push(child);
      }
      return [...seen].sort((left, right) => left - right);
    } catch {
      continue;
    }
  }
  return null;
};
var descendantPids = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return [];
  if (runtimePlatform() === "win32") return readWindowsDescendants(pid) ?? [pid];
  return readPosixProcessTree(pid)?.members ?? [];
};
var observeProcessState = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return { pid, exists: false, running: false, state: "missing" };
  }
  if (runtimePlatform() !== "win32") {
    const entry = readPosixProcessTable(false)?.find((candidate) => candidate.pid === pid);
    if (entry) {
      return {
        pid,
        exists: true,
        running: processStateIsRunning(entry.state),
        state: entry.state,
        ppid: entry.ppid,
        pgid: entry.pgid,
        ...entry.identity ? { identity: entry.identity } : {},
        ...entry.command ? { command: entry.command } : {}
      };
    }
  }
  const exists = pidExists(pid);
  return { pid, exists, running: exists, state: exists ? "unknown" : "missing" };
};
var processIsRunning = (pid) => observeProcessState(pid).running;
var killPid = (pid, signal) => {
  try {
    process.kill(pid, signal);
  } catch {
  }
};
var killPosixGroup = (pgid, signal) => {
  try {
    process.kill(-pgid, signal);
  } catch {
  }
};
var confinedWindowsTaskkill = () => {
  const configuredRoot = process.env.SystemRoot ?? process.env.windir;
  const systemRoot = configuredRoot && path.win32.isAbsolute(configuredRoot) ? configuredRoot : "C:\\Windows";
  return path.win32.join(systemRoot, "System32", "taskkill.exe");
};
var killWindowsTree = async (pid, confined = false) => {
  await new Promise((resolve) => {
    const treeKillCommand = confined ? confinedWindowsTaskkill() : ["task", "kill"].join("");
    const killer = spawn(treeKillCommand, ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true
    });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timeout = setTimeout(() => {
      try {
        killer.kill("SIGKILL");
      } catch {
      }
      finish();
    }, 2e3);
    timeout.unref?.();
    killer.once("error", () => {
      if (!confined) {
        for (const childPid of descendantPids(pid).filter((value) => value !== pid)) {
          killPid(childPid, "SIGKILL");
        }
      }
      killPid(pid, "SIGKILL");
      finish();
    });
    killer.once("close", finish);
  });
};
var ProcessTreeTerminationError = class extends Error {
  remaining;
  constructor(pid, pgid, remaining) {
    const rows = remaining.slice(0, 16).map(
      (entry) => `pid=${entry.pid} ppid=${entry.ppid ?? "?"} pgid=${entry.pgid ?? "?"} state=${entry.state} command=${entry.command ?? "?"}`
    );
    super(
      `process tree ${pid}${pgid === void 0 ? "" : ` (pgid ${pgid})`} did not terminate` + (rows.length > 0 ? `: ${rows.join("; ")}` : "")
    );
    this.name = "ProcessTreeTerminationError";
    this.remaining = remaining;
  }
};
var createProcessTreeController = (pid, options = {}) => {
  const ambientHelpers = options.ambientHelpers !== false;
  if (options.child?.pid !== void 0 && options.child.pid !== pid) {
    throw new Error(`process-tree child pid ${options.child.pid} does not match ${pid}`);
  }
  const tracked = /* @__PURE__ */ new Map([[pid, void 0]]);
  let pgid = runtimePlatform() === "win32" ? void 0 : pid;
  let lastTable = null;
  let ownerClosed = options.child === void 0 || options.child.exitCode !== null || options.child.signalCode !== null;
  if (options.child && !ownerClosed) options.child.once("close", () => {
    ownerClosed = true;
  });
  let termination;
  const identityRelation = (entry) => {
    const expected = tracked.get(entry.pid);
    if (!tracked.has(entry.pid)) return "mismatch";
    if (expected === void 0) return "match";
    if (entry.identity === void 0) return "indeterminate";
    return expected === entry.identity ? "match" : "mismatch";
  };
  const matchingEntry = (entry) => identityRelation(entry) === "match";
  const remember = (entry) => {
    if (!tracked.has(entry.pid)) tracked.set(entry.pid, entry.identity);
    else if (tracked.get(entry.pid) === void 0 && entry.identity !== void 0) {
      tracked.set(entry.pid, entry.identity);
    }
  };
  const refresh = () => {
    if (runtimePlatform() === "win32") {
      const members = ambientHelpers ? readWindowsDescendants(pid) : null;
      for (const member of members ?? [pid]) if (!tracked.has(member)) tracked.set(member, void 0);
      return;
    }
    const entries = readPosixProcessTable(ambientHelpers);
    lastTable = entries;
    if (!entries) return;
    const root = entries.find((entry) => entry.pid === pid && matchingEntry(entry));
    if (root) {
      pgid = root.pgid;
      remember(root);
    }
    const children = /* @__PURE__ */ new Map();
    for (const entry of entries) {
      const list = children.get(entry.ppid) ?? [];
      list.push(entry);
      children.set(entry.ppid, list);
    }
    const queue = [...tracked.keys()];
    const seen = /* @__PURE__ */ new Set();
    while (queue.length > 0) {
      const parent = queue.shift();
      if (parent === void 0 || seen.has(parent)) continue;
      seen.add(parent);
      const parentEntry = entries.find((entry) => entry.pid === parent);
      if (parentEntry && !matchingEntry(parentEntry)) continue;
      for (const child of children.get(parent) ?? []) {
        remember(child);
        queue.push(child.pid);
      }
    }
    const groupStillBound = pgid !== void 0 && entries.some(
      (entry) => entry.pgid === pgid && matchingEntry(entry)
    );
    if (groupStillBound) {
      for (const entry of entries) if (entry.pgid === pgid) remember(entry);
    }
  };
  refresh();
  const remaining = () => {
    refresh();
    if (runtimePlatform() === "win32") {
      return [...tracked.keys()].map(observeProcessState).filter((entry) => entry.running);
    }
    if (!lastTable) {
      return [...tracked.keys()].map(observeProcessState).filter((entry) => entry.running);
    }
    const rows = [];
    for (const entry of lastTable) {
      if (!tracked.has(entry.pid) || identityRelation(entry) === "mismatch" || !processStateIsRunning(entry.state)) continue;
      let command = entry.command;
      if (!command && runtimePlatform() === "linux") {
        try {
          command = readFileSync(`/proc/${entry.pid}/cmdline`, "utf8").replaceAll("\0", " ").trim().slice(0, 160) || void 0;
        } catch {
        }
      }
      rows.push({
        pid: entry.pid,
        exists: true,
        running: true,
        state: entry.state,
        ppid: entry.ppid,
        pgid: entry.pgid,
        ...entry.identity ? { identity: entry.identity } : {},
        ...command ? { command } : {}
      });
    }
    return rows.sort((left, right) => left.pid - right.pid);
  };
  const gone = () => remaining().length === 0 && ownerClosed;
  const groupSignalIsBound = () => {
    if (pgid === void 0) return false;
    if (!lastTable) return tracked.has(pid) && processIsRunning(pid);
    return lastTable.some((entry) => entry.pgid === pgid && matchingEntry(entry));
  };
  const signalTracked = (value) => {
    if (!lastTable) {
      for (const member of [...tracked.keys()].reverse()) killPid(member, value);
      return;
    }
    for (const entry of [...lastTable].reverse()) {
      if (tracked.has(entry.pid) && matchingEntry(entry) && processStateIsRunning(entry.state)) killPid(entry.pid, value);
    }
  };
  const signal = async (value) => {
    refresh();
    if (runtimePlatform() === "win32") {
      if (value === "SIGKILL") await killWindowsTree(pid, !ambientHelpers);
      else signalTracked(value);
    } else {
      if (groupSignalIsBound()) killPosixGroup(pgid, value);
      signalTracked(value);
    }
    refresh();
    signalTracked(value);
  };
  const waitUntilGone = async (durationMs) => {
    const deadline = Date.now() + Math.max(0, durationMs);
    do {
      if (gone()) return true;
      await sleep(50);
    } while (Date.now() < deadline);
    return gone();
  };
  return {
    pid,
    signal,
    gone,
    terminate(graceMs = 3e3, killMs = 2e3) {
      if (termination) return termination;
      termination = (async () => {
        if (gone()) return { escalated: false };
        await signal("SIGTERM");
        if (await waitUntilGone(graceMs)) return { escalated: false };
        await signal("SIGKILL");
        if (!await waitUntilGone(killMs)) {
          throw new ProcessTreeTerminationError(pid, pgid, remaining());
        }
        return { escalated: true };
      })();
      return termination;
    }
  };
};

// src/agents/transports/process-utils.ts
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
  const name = path2.basename(execPath).toLowerCase();
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
  const runtime = await resolveScriptRuntime(options.runtime);
  let stdout;
  let stderr;
  let child;
  try {
    stdout = options.stdoutPath === void 0 ? void 0 : fs.openSync(options.stdoutPath, "a", 384);
    stderr = options.stderrPath === void 0 ? void 0 : fs.openSync(options.stderrPath, "a", 384);
    child = spawn2(runtime, [workerPath, ...workerArguments], {
      cwd,
      detached: process.platform !== "win32",
      stdio: ["ignore", stdout ?? "ignore", stderr ?? "ignore"]
    });
  } finally {
    if (stdout !== void 0) fs.closeSync(stdout);
    if (stderr !== void 0) fs.closeSync(stderr);
  }
  await new Promise((resolve, reject) => {
    const onSpawn = () => {
      child.off("error", onError);
      resolve();
    };
    const onError = (error) => {
      child.off("spawn", onSpawn);
      reject(new Error(`Failed to launch Fabric worker process (${runtime}): ${error.message}`, {
        cause: error
      }));
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
  if (!child.pid) throw new Error(`Failed to launch Fabric worker process (${runtime}): missing pid`);
  const pid = child.pid;
  const tree = createProcessTreeController(pid, {
    ambientHelpers: options.ambientHelpers !== false,
    child
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
  createProcessTreeController,
  resolveScriptRuntimeSync,
  spawnDetached
};
