import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);


// src/worker/process-tree.ts
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
var IS_JOB_OBJECT_AVAILABLE = process.platform === "win32";
var TEST_PLATFORM_ENV = "KIRO_FABRIC_TEST_PLATFORM";
var TEST_PS_FAILURE_ENV = "KIRO_FABRIC_TEST_PS_FAILURE";
var runtimePlatform = () => process.env[TEST_PLATFORM_ENV] ?? process.platform;
var WINDOWS_PROCESS_COMMAND = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress";
var sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});
var processIsAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
var parsePsEntries = (stdout) => stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => line.split(/\s+/u)).map(([pidText, ppidText, pgidText]) => ({
  pid: Number(pidText),
  ppid: Number(ppidText),
  pgid: Number(pgidText)
})).filter(
  (entry) => Number.isSafeInteger(entry.pid) && entry.pid > 0 && Number.isSafeInteger(entry.ppid) && entry.ppid >= 0 && Number.isSafeInteger(entry.pgid) && entry.pgid > 0
);
var readPosixProcessTable = () => {
  if (process.env[TEST_PS_FAILURE_ENV] === "1") return null;
  try {
    const stdout = execFileSync("ps", ["-axo", "pid=,ppid=,pgid="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
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
        const ppid = Number(fields[1]);
        const pgid = Number(fields[2]);
        if (Number.isSafeInteger(pid) && Number.isSafeInteger(ppid) && Number.isSafeInteger(pgid)) {
          entries.push({ pid, ppid, pgid });
        }
      } catch {
      }
    }
    return entries;
  } catch {
    return null;
  }
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
  const entries = readPosixProcessTable();
  return entries ? processTreeFromEntries(entries, pid) : null;
};
var readKernelProcessTree = (pid) => {
  const entries = readLinuxProcessTable();
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
var killPid = (pid, signal) => {
  try {
    process.kill(pid, signal);
  } catch {
  }
};
var posixGroupIsAlive = (pgid) => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
var killPosixGroup = (pgid, signal) => {
  try {
    process.kill(-pgid, signal);
  } catch {
  }
};
var killWindowsTree = async (pid) => {
  await new Promise((resolve) => {
    const treeKillCommand = ["task", "kill"].join("");
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
      for (const childPid of descendantPids(pid).filter((value) => value !== pid)) {
        killPid(childPid, "SIGKILL");
      }
      killPid(pid, "SIGKILL");
      finish();
    });
    killer.once("close", finish);
  });
};
var killDescendantTree = async (pid, signal = "SIGTERM", graceMs = 0) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  if (runtimePlatform() === "win32") {
    await killWindowsTree(pid);
    return;
  }
  const group = readPosixProcessTree(pid);
  if (!group) {
    killPosixGroup(pid, signal);
    killPid(pid, signal);
    if (graceMs > 0 && signal !== "SIGKILL") {
      await sleep(graceMs);
      if (posixGroupIsAlive(pid)) killPosixGroup(pid, "SIGKILL");
      if (processIsAlive(pid)) killPid(pid, "SIGKILL");
    }
    return;
  }
  killPosixGroup(group.pgid, signal);
  for (const member of [...group.members].reverse()) killPid(member, signal);
  if (graceMs > 0 && signal !== "SIGKILL") {
    await sleep(graceMs);
    for (const member of group.members) {
      if (processIsAlive(member)) killPid(member, "SIGKILL");
    }
  }
};
var createProcessTreeController = (pid, options = {}) => {
  const ambientHelpers = options.ambientHelpers !== false;
  const tracked = /* @__PURE__ */ new Set([pid]);
  let termination;
  const refresh = () => {
    const members = ambientHelpers ? descendantPids(pid) : readKernelProcessTree(pid)?.members ?? [];
    for (const member of members) tracked.add(member);
  };
  const gone = () => [...tracked].every((member) => !processIsAlive(member)) && (runtimePlatform() === "win32" || !posixGroupIsAlive(pid));
  const signal = async (value) => {
    refresh();
    if (!ambientHelpers) {
      if (runtimePlatform() === "win32") killPid(pid, value);
      else {
        const tree = readKernelProcessTree(pid);
        killPosixGroup(tree?.pgid ?? pid, value);
        for (const member of [...tree?.members ?? [pid]].reverse()) killPid(member, value);
      }
    } else {
      await killDescendantTree(pid, value);
    }
    refresh();
    for (const member of [...tracked].reverse()) killPid(member, value);
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
        await signal("SIGTERM");
        if (await waitUntilGone(graceMs)) return { escalated: false };
        await signal("SIGKILL");
        await waitUntilGone(killMs);
        return { escalated: true };
      })();
      return termination;
    }
  };
};

export {
  createProcessTreeController
};
