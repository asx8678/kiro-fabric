import { execFileSync, spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Node does not expose Windows Job Objects. Windows tree cleanup below uses
// the operating system's taskkill utility by an absolute, System32-confined
// path instead of claiming native Job Object ownership.
export const IS_JOB_OBJECT_AVAILABLE = false;

const TEST_PLATFORM_ENV = "KIRO_FABRIC_TEST_PLATFORM";
const TEST_PS_FAILURE_ENV = "KIRO_FABRIC_TEST_PS_FAILURE";
const runtimePlatform = (): NodeJS.Platform =>
  ((process.env[TEST_PLATFORM_ENV] as NodeJS.Platform | undefined) ?? process.platform);

const WINDOWS_PROCESS_COMMAND =
  "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    // Keep termination waits referenced. In standalone workers this promise
    // may be the final active operation; an unref'ed timer lets Node exit
    // before the caller persists its terminal run record.
    setTimeout(resolve, ms);
  });

const processIsAlive = (pid: number): boolean => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

interface PosixProcessEntry {
  pid: number;
  ppid: number;
  pgid: number;
}

const parsePsEntries = (stdout: string): PosixProcessEntry[] =>
  stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/u))
    .map(([pidText, ppidText, pgidText]) => ({
      pid: Number(pidText),
      ppid: Number(ppidText),
      pgid: Number(pgidText),
    }))
    .filter(
      (entry): entry is PosixProcessEntry =>
        Number.isSafeInteger(entry.pid)
        && entry.pid > 0
        && Number.isSafeInteger(entry.ppid)
        && entry.ppid >= 0
        && Number.isSafeInteger(entry.pgid)
        && entry.pgid > 0,
    );

const readPosixProcessTable = (): PosixProcessEntry[] | null => {
  if (process.env[TEST_PS_FAILURE_ENV] === "1") return null;
  try {
    const stdout = execFileSync("ps", ["-axo", "pid=,ppid=,pgid="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parsePsEntries(stdout);
  } catch {
    return null;
  }
};

const readLinuxProcessTable = (): PosixProcessEntry[] | null => {
  if (runtimePlatform() !== "linux") return null;
  try {
    const entries: PosixProcessEntry[] = [];
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
        // Process exited between /proc enumeration and stat read.
      }
    }
    return entries;
  } catch {
    return null;
  }
};

const processTreeFromEntries = (
  entries: PosixProcessEntry[],
  pid: number,
): { pgid: number; members: number[] } | null => {
  const root = entries.find((entry) => entry.pid === pid);
  if (!root) return null;
  const children = new Map<number, number[]>();
  for (const entry of entries) {
    const list = children.get(entry.ppid) ?? [];
    list.push(entry.pid);
    children.set(entry.ppid, list);
  }
  const queue = [pid];
  const tree = new Set<number>();
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

const readPosixProcessTree = (pid: number): { pgid: number; members: number[] } | null => {
  const entries = readPosixProcessTable();
  return entries ? processTreeFromEntries(entries, pid) : null;
};

const readKernelProcessTree = (pid: number): { pgid: number; members: number[] } | null => {
  const entries = readLinuxProcessTable();
  return entries ? processTreeFromEntries(entries, pid) : null;
};

const parseWindowsProcessTree = (
  stdout: string,
): Array<{ processId: number; parentProcessId: number }> => {
  const parsed: unknown = JSON.parse(stdout);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .filter((row): row is { ProcessId?: unknown; ParentProcessId?: unknown } =>
      typeof row === "object" && row !== null,
    )
    .map((row) => ({
      processId: Number(row.ProcessId),
      parentProcessId: Number(row.ParentProcessId),
    }))
    .filter(
      (row): row is { processId: number; parentProcessId: number } =>
        Number.isSafeInteger(row.processId)
        && row.processId > 0
        && Number.isSafeInteger(row.parentProcessId)
        && row.parentProcessId >= 0,
    );
};

const readWindowsDescendants = (pid: number): number[] | null => {
  for (const shell of ["powershell.exe", "pwsh.exe", "pwsh"]) {
    try {
      const stdout = execFileSync(shell, ["-NoProfile", "-Command", WINDOWS_PROCESS_COMMAND], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        timeout: 2_000,
      }).trim();
      if (!stdout) return [pid];
      const rows = parseWindowsProcessTree(stdout);
      const children = new Map<number, number[]>();
      for (const row of rows) {
        const list = children.get(row.parentProcessId) ?? [];
        list.push(row.processId);
        children.set(row.parentProcessId, list);
      }
      const queue = [pid];
      const seen = new Set<number>();
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

export const descendantPids = (pid: number): number[] => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return [];
  if (runtimePlatform() === "win32") return readWindowsDescendants(pid) ?? [pid];
  return readPosixProcessTree(pid)?.members ?? [];
};

const killPid = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(pid, signal);
  } catch {
    // Process already exited or cannot be signalled by this user.
  }
};

const posixGroupIsAlive = (pgid: number): boolean => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const killPosixGroup = (pgid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-pgid, signal);
  } catch {
    // Group already exited or the platform does not expose group signalling.
  }
};

const confinedWindowsTaskkill = (): string => {
  const configuredRoot = process.env.SystemRoot ?? process.env.windir;
  const systemRoot = configuredRoot && path.win32.isAbsolute(configuredRoot)
    ? configuredRoot
    : "C:\\Windows";
  return path.win32.join(systemRoot, "System32", "taskkill.exe");
};

const killWindowsTree = async (pid: number, confined = false): Promise<void> => {
  await new Promise<void>((resolve) => {
    const treeKillCommand = confined ? confinedWindowsTaskkill() : ["task", "kill"].join("");
    const killer = spawn(treeKillCommand, ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timeout = setTimeout(() => {
      try {
        killer.kill("SIGKILL");
      } catch {
        // Best effort only.
      }
      finish();
    }, 2_000);
    timeout.unref?.();
    killer.once("error", () => {
      // Confined callers must never fall back to PowerShell discovered via
      // PATH. The absolute taskkill /T invocation is the Windows descendant
      // primitive; retain a direct-root fallback if the OS utility is absent.
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

export const killDescendantTree = async (
  pid: number,
  signal: NodeJS.Signals = "SIGTERM",
  graceMs = 0,
): Promise<void> => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  if (runtimePlatform() === "win32") {
    await killWindowsTree(pid);
    return;
  }
  const group = readPosixProcessTree(pid);
  if (!group) {
    // ACP/probe children are spawned detached, so their pid is also their pgid.
    // Preserve whole-group termination even when `ps` is absent or fails.
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
  // Descendants that created their own process group/session are not reached by
  // the negative-pgid signal. Kill deepest/newest members first, then root.
  for (const member of [...group.members].reverse()) killPid(member, signal);
  if (graceMs > 0 && signal !== "SIGKILL") {
    await sleep(graceMs);
    for (const member of group.members) {
      if (processIsAlive(member)) killPid(member, "SIGKILL");
    }
  }
};

export interface ProcessTreeController {
  readonly pid: number;
  signal(signal: NodeJS.Signals): Promise<void>;
  gone(): boolean;
  terminate(graceMs?: number, killMs?: number): Promise<{ escalated: boolean }>;
}

export interface ProcessTreeControllerOptions {
  /** Disable PATH-discovered helpers. Uses kernel signals on POSIX and the
   *  absolute System32 taskkill tree primitive on Windows. */
  ambientHelpers?: boolean;
}

/** One lifecycle abstraction used by Kiro ACP and probe children. */
export const createProcessTreeController = (
  pid: number,
  options: ProcessTreeControllerOptions = {},
): ProcessTreeController => {
  const ambientHelpers = options.ambientHelpers !== false;
  const tracked = new Set<number>([pid]);
  let termination: Promise<{ escalated: boolean }> | undefined;
  const refresh = (): void => {
    const members = ambientHelpers
      ? descendantPids(pid)
      : readKernelProcessTree(pid)?.members ?? [];
    for (const member of members) tracked.add(member);
  };
  const gone = (): boolean =>
    [...tracked].every((member) => !processIsAlive(member)) &&
    (runtimePlatform() === "win32" || !posixGroupIsAlive(pid));
  const signal = async (value: NodeJS.Signals): Promise<void> => {
    refresh();
    if (!ambientHelpers) {
      if (runtimePlatform() === "win32") await killWindowsTree(pid, true);
      else {
        const tree = readKernelProcessTree(pid);
        killPosixGroup(tree?.pgid ?? pid, value);
        for (const member of [...(tree?.members ?? [pid])].reverse()) killPid(member, value);
      }
    } else {
      await killDescendantTree(pid, value);
    }
    // The parent can race by spawning just before it receives the signal.
    refresh();
    for (const member of [...tracked].reverse()) killPid(member, value);
  };
  const waitUntilGone = async (durationMs: number): Promise<boolean> => {
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
    terminate(graceMs = 3_000, killMs = 2_000) {
      if (termination) return termination;
      termination = (async () => {
        await signal("SIGTERM");
        if (await waitUntilGone(graceMs)) return { escalated: false };
        await signal("SIGKILL");
        await waitUntilGone(killMs);
        return { escalated: true };
      })();
      return termination;
    },
  };
};

export const quoteCommandArg = (arg: string): string => {
  if (runtimePlatform() !== "win32") return `'${arg.replaceAll("'", `'"'"'`)}'`;
  let result = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === "\\") {
      backslashes++;
      continue;
    }
    if (ch === '"') {
      result += `${"\\".repeat(backslashes * 2 + 1)}\"`;
      backslashes = 0;
      continue;
    }
    result += `${"\\".repeat(backslashes)}${ch}`;
    backslashes = 0;
  }
  return `${result}${"\\".repeat(backslashes * 2)}"`;
};
