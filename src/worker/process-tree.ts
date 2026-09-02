import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

const pidExists = (pid: number): boolean => {
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
  state: string;
  identity?: string;
  command?: string;
}

const parsePsEntries = (stdout: string): PosixProcessEntry[] =>
  stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/u))
    .map((fields): PosixProcessEntry => ({
      pid: Number(fields[0]),
      ppid: Number(fields[1]),
      pgid: Number(fields[2]),
      state: fields[3] ?? "?",
      // lstart is five whitespace-separated fields. It is a stable-enough
      // process-instance fingerprint on macOS, where procfs is unavailable.
      ...(fields.length >= 9 ? { identity: `ps:${fields.slice(4, 9).join(" ")}` } : {}),
      ...(fields.length > 9 ? { command: fields.slice(9).join(" ").slice(0, 160) } : {}),
    }))
    .filter(
      (entry) =>
        Number.isSafeInteger(entry.pid)
        && entry.pid > 0
        && Number.isSafeInteger(entry.ppid)
        && entry.ppid >= 0
        && Number.isSafeInteger(entry.pgid)
        && entry.pgid > 0
        && entry.state.length > 0,
    );

const psExecutable = (): string => existsSync("/bin/ps") ? "/bin/ps" : "ps";

const readPsProcessTable = (): PosixProcessEntry[] | null => {
  if (process.env[TEST_PS_FAILURE_ENV] === "1") return null;
  try {
    const stdout = execFileSync(
      psExecutable(),
      ["-axo", "pid=,ppid=,pgid=,state=,lstart=,command="],
      {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
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
            ...(startTicks ? { identity: `linux:${startTicks}` } : {}),
          });
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

const readPosixProcessTable = (ambientHelpers = true): PosixProcessEntry[] | null => {
  const platform = runtimePlatform();
  if (platform === "linux") return readLinuxProcessTable() ?? (ambientHelpers ? readPsProcessTable() : null);
  // macOS has no procfs. /bin/ps is an absolute, OS-owned observation helper;
  // it does not perform PATH discovery even in confined Kiro mode.
  if (platform === "darwin") return readPsProcessTable();
  return ambientHelpers ? readPsProcessTable() : null;
};

const processStateIsRunning = (state: string): boolean => {
  const code = state.trim().charAt(0).toUpperCase();
  return code !== "Z" && code !== "X" && code !== "";
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
  const entries = readPosixProcessTable(true);
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

export interface ProcessStateObservation {
  pid: number;
  exists: boolean;
  running: boolean;
  state: string;
  ppid?: number;
  pgid?: number;
  identity?: string;
  command?: string;
}

/** State-aware liveness observation. A zombie still has a PID but is not a
 * live workload and must not hold termination open. */
export const observeProcessState = (pid: number): ProcessStateObservation => {
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
        ...(entry.identity ? { identity: entry.identity } : {}),
        ...(entry.command ? { command: entry.command } : {}),
      };
    }
  }
  const exists = pidExists(pid);
  return { pid, exists, running: exists, state: exists ? "unknown" : "missing" };
};

const processIsRunning = (pid: number): boolean => observeProcessState(pid).running;

const killPid = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(pid, signal);
  } catch {
    // Process already exited or cannot be signalled by this user.
  }
};

const posixGroupIsAlive = (pgid: number): boolean => {
  const table = readPosixProcessTable(false);
  if (table) {
    return table.some((entry) => entry.pgid === pgid && processStateIsRunning(entry.state));
  }
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
      if (processIsRunning(pid)) killPid(pid, "SIGKILL");
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
      if (processIsRunning(member)) killPid(member, "SIGKILL");
    }
  }
};

export interface ProcessTreeController {
  readonly pid: number;
  signal(signal: NodeJS.Signals): Promise<void>;
  gone(): boolean;
  terminate(graceMs?: number, killMs?: number): Promise<{ escalated: boolean }>;
}

class ProcessTreeTerminationError extends Error {
  readonly remaining: readonly ProcessStateObservation[];

  constructor(pid: number, pgid: number | undefined, remaining: readonly ProcessStateObservation[]) {
    const rows = remaining.slice(0, 16).map((entry) =>
      `pid=${entry.pid} ppid=${entry.ppid ?? "?"} pgid=${entry.pgid ?? "?"} ` +
      `state=${entry.state} command=${entry.command ?? "?"}`,
    );
    super(
      `process tree ${pid}${pgid === undefined ? "" : ` (pgid ${pgid})`} did not terminate` +
      (rows.length > 0 ? `: ${rows.join("; ")}` : ""),
    );
    this.name = "ProcessTreeTerminationError";
    this.remaining = remaining;
  }
}

export interface ProcessTreeControllerOptions {
  /** Disable PATH-discovered helpers. Uses kernel signals on POSIX and the
   *  absolute System32 taskkill tree primitive on Windows. */
  ambientHelpers?: boolean;
  /** Direct child owned by the caller. terminate() does not complete until its
   * close lifecycle fires and Node has reaped it. */
  child?: ChildProcess;
}

/** One lifecycle abstraction used by Kiro ACP and probe children. */
export const createProcessTreeController = (
  pid: number,
  options: ProcessTreeControllerOptions = {},
): ProcessTreeController => {
  const ambientHelpers = options.ambientHelpers !== false;
  if (options.child?.pid !== undefined && options.child.pid !== pid) {
    throw new Error(`process-tree child pid ${options.child.pid} does not match ${pid}`);
  }
  const tracked = new Map<number, string | undefined>([[pid, undefined]]);
  let pgid: number | undefined = runtimePlatform() === "win32" ? undefined : pid;
  let lastTable: PosixProcessEntry[] | null = null;
  let ownerClosed = options.child === undefined ||
    options.child.exitCode !== null || options.child.signalCode !== null;
  if (options.child && !ownerClosed) options.child.once("close", () => { ownerClosed = true; });
  let termination: Promise<{ escalated: boolean }> | undefined;

  const identityRelation = (entry: PosixProcessEntry): "match" | "mismatch" | "indeterminate" => {
    const expected = tracked.get(entry.pid);
    if (!tracked.has(entry.pid)) return "mismatch";
    if (expected === undefined) return "match";
    if (entry.identity === undefined) return "indeterminate";
    return expected === entry.identity ? "match" : "mismatch";
  };
  const matchingEntry = (entry: PosixProcessEntry): boolean => identityRelation(entry) === "match";

  const remember = (entry: PosixProcessEntry): void => {
    if (!tracked.has(entry.pid)) tracked.set(entry.pid, entry.identity);
    else if (tracked.get(entry.pid) === undefined && entry.identity !== undefined) {
      tracked.set(entry.pid, entry.identity);
    }
  };

  const refresh = (): void => {
    if (runtimePlatform() === "win32") {
      const members = ambientHelpers ? readWindowsDescendants(pid) : null;
      for (const member of members ?? [pid]) if (!tracked.has(member)) tracked.set(member, undefined);
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
    // Descendants that establish a new session/group remain owned. Discover
    // them from every still-identifiable tracked parent before signalling.
    const children = new Map<number, PosixProcessEntry[]>();
    for (const entry of entries) {
      const list = children.get(entry.ppid) ?? [];
      list.push(entry);
      children.set(entry.ppid, list);
    }
    const queue = [...tracked.keys()];
    const seen = new Set<number>();
    while (queue.length > 0) {
      const parent = queue.shift();
      if (parent === undefined || seen.has(parent)) continue;
      seen.add(parent);
      const parentEntry = entries.find((entry) => entry.pid === parent);
      if (parentEntry && !matchingEntry(parentEntry)) continue;
      for (const child of children.get(parent) ?? []) {
        remember(child);
        queue.push(child.pid);
      }
    }
    // A PGID is safe to bind only while at least one previously tracked member
    // still has its original identity. This prevents adopting a reused group.
    const groupStillBound = pgid !== undefined && entries.some((entry) =>
      entry.pgid === pgid && matchingEntry(entry),
    );
    if (groupStillBound) {
      for (const entry of entries) if (entry.pgid === pgid) remember(entry);
    }
  };

  refresh();

  const remaining = (): ProcessStateObservation[] => {
    refresh();
    if (runtimePlatform() === "win32") {
      return [...tracked.keys()].map(observeProcessState).filter((entry) => entry.running);
    }
    if (!lastTable) {
      return [...tracked.keys()].map(observeProcessState).filter((entry) => entry.running);
    }
    const rows: ProcessStateObservation[] = [];
    for (const entry of lastTable) {
      if (
        !tracked.has(entry.pid) || identityRelation(entry) === "mismatch" ||
        !processStateIsRunning(entry.state)
      ) continue;
      let command = entry.command;
      if (!command && runtimePlatform() === "linux") {
        try {
          command = readFileSync(`/proc/${entry.pid}/cmdline`, "utf8")
            .replaceAll("\0", " ").trim().slice(0, 160) || undefined;
        } catch { /* process exited during diagnostics */ }
      }
      rows.push({
        pid: entry.pid,
        exists: true,
        running: true,
        state: entry.state,
        ppid: entry.ppid,
        pgid: entry.pgid,
        ...(entry.identity ? { identity: entry.identity } : {}),
        ...(command ? { command } : {}),
      });
    }
    return rows.sort((left, right) => left.pid - right.pid);
  };

  const gone = (): boolean => remaining().length === 0 && ownerClosed;

  const groupSignalIsBound = (): boolean => {
    if (pgid === undefined) return false;
    if (!lastTable) return tracked.has(pid) && processIsRunning(pid);
    return lastTable.some((entry) => entry.pgid === pgid && matchingEntry(entry));
  };

  const signalTracked = (value: NodeJS.Signals): void => {
    if (!lastTable) {
      for (const member of [...tracked.keys()].reverse()) killPid(member, value);
      return;
    }
    for (const entry of [...lastTable].reverse()) {
      if (
        tracked.has(entry.pid) && matchingEntry(entry) &&
        processStateIsRunning(entry.state)
      ) killPid(entry.pid, value);
    }
  };

  const signal = async (value: NodeJS.Signals): Promise<void> => {
    refresh();
    if (runtimePlatform() === "win32") {
      if (value === "SIGKILL") await killWindowsTree(pid, !ambientHelpers);
      else signalTracked(value);
    } else {
      if (groupSignalIsBound()) killPosixGroup(pgid!, value);
      signalTracked(value);
    }
    // The parent can race by spawning just before it receives the signal.
    refresh();
    signalTracked(value);
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
