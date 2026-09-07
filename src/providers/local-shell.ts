import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { throwIfAbortedOrExpired } from "../async-settlement.js";
import type { FabricDeadline } from "../runtime/deadline.js";

export interface LocalShellResult {
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

/** Only ordinary, fully reaped nonzero exits carry explicit diagnostic data. */
export class LocalShellExitError extends Error {
  readonly result: LocalShellResult;
  constructor(result: LocalShellResult) {
    super(`Local shell exited with code ${result.exitCode}`);
    this.name = "LocalShellExitError";
    this.result = result;
    Object.defineProperty(this, "result", { enumerable: false });
  }
}

// An allowlist, not a backend credential denylist. Never include ambient auth,
// shell startup hooks, loader options, or language-runtime injection variables.
function shellEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["HOME", "PATH", "TMPDIR", "LANG", "TERM", "TZ", "USER", "LOGNAME"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (/^LC_[A-Z_]+$/.test(key) && value !== undefined) env[key] = value;
  }
  return env;
}

function sendGroup(pid: number, signal: NodeJS.Signals): void {
  try { process.kill(-pid, signal); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw new Error("Local shell cleanup uncertain");
  }
}

async function groupAlive(pid: number): Promise<boolean> {
  try { process.kill(-pid, 0); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw new Error("Local shell cleanup uncertain");
  }
  if (process.platform !== "linux") return true;
  // kill(0) also reports zombies. They cannot execute or hold streams. Node
  // reaps its direct child; orphan reaping belongs to the host's init/subreaper.
  // Never mistake a successful signal for observed termination.
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    let stat: string;
    try { stat = await readFile(`/proc/${entry}/stat`, "utf8"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ESRCH") continue;
      throw new Error("Local shell cleanup uncertain");
    }
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (Number(fields[2]) === pid && fields[0] !== "Z" && fields[0] !== "X") return true;
  }
  return false;
}

/** Approved HOST execution, NOT filesystem/environment isolation or background
 * management. Caller owns exact command/canonical cwd approval and reservation.
 * Deliberate setsid/process-group escape is not contained. Cleanup has a separate
 * bounded grace even after cancellation/deadline, and must be awaited by close.
 */
export async function runLocalShell(options: {
  command: string; cwd: string; timeoutMs?: number; settle?: boolean;
  maxOutputChars?: number; signal?: AbortSignal; deadline?: FabricDeadline;
}): Promise<LocalShellResult> {
  if (process.platform !== "linux" && process.platform !== "darwin") throw new Error("Local shell requires Linux or macOS");
  const timeout = options.timeoutMs ?? 30_000;
  const budget = options.maxOutputChars ?? 24_000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 900_000) throw new Error("Local shell timeoutMs must be 1..900000");
  if (!Number.isSafeInteger(budget) || budget < 256) throw new Error("Local shell maxOutputChars must be an integer >=256");
  // Do not propagate caller abort reasons, spawn messages, commands or cwd.
  const check = (): void => {
    try { throwIfAbortedOrExpired(options.signal, options.deadline); }
    catch { throw new Error("Local shell cancelled or deadline expired"); }
  };
  check();
  const result: LocalShellResult = { ok: false, exitCode: null, signal: null, stdout: "", stderr: "", truncated: false, stdoutTruncated: false, stderrTruncated: false };
  // Each UTF-16 code unit needs at most six JSON characters (including lone
  // surrogates). Reserve 256 for the fixed envelope and split streams equally.
  const streamLimit = Math.floor((budget - 256) / 12);
  let child;
  try {
    child = spawn("/bin/sh", ["-c", options.command], {
      cwd: options.cwd, env: shellEnvironment(), detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch { throw new Error("Local shell spawn failed"); }
  let exited = false;
  let closed = false;
  let failure: string | undefined;
  child.on("error", () => { failure = "Local shell spawn failed"; });
  child.on("exit", (code, signal) => { exited = true; result.exitCode = code; result.signal = signal; });
  child.on("close", () => { closed = true; });
  for (const name of ["stdout", "stderr"] as const) {
    let head = "";
    let tail = "";
    let total = 0;
    const headLimit = Math.ceil(streamLimit / 2);
    const tailLimit = streamLimit - headLimit;
    child[name].setEncoding("utf8");
    child[name].on("error", () => { failure = "Local shell stream failed"; });
    child[name].on("data", (data: string) => {
      total += data.length;
      const take = Math.min(headLimit - head.length, data.length);
      head += data.slice(0, take);
      if (tailLimit > 0) tail = (tail + data.slice(take)).slice(-tailLimit);
      const truncated = total > streamLimit;
      // Marker fits inside the stream bound, including tiny configured budgets.
      const marker = "\n… truncated …\n";
      if (!truncated) result[name] = head + tail;
      else {
        const room = Math.max(0, streamLimit - marker.length);
        const prefix = Math.ceil(room / 2);
        const suffix = room - prefix;
        result[name] = streamLimit >= marker.length
          ? head.slice(0, prefix) + marker + (suffix ? tail.slice(-suffix) : "")
          : head + tail;
        result[`${name}Truncated`] = true; result.truncated = true;
      }
    });
  }
  const started = performance.now();
  try {
    while (!exited && !failure) {
      check();
      if (performance.now() - started >= timeout) throw new Error("Local shell timed out");
      await delay(Math.min(10, timeout));
    }
  } catch (error) { failure = (error as Error).message; }
  // Cleanup also runs on successful leader exit: inherited pipes/background
  // descendants must not keep a reservation alive indefinitely.
  try {
    if (child.pid !== undefined) {
      sendGroup(child.pid, "SIGTERM");
      const termEnd = performance.now() + 200;
      while (await groupAlive(child.pid) && performance.now() < termEnd) await delay(10);
      if (await groupAlive(child.pid)) sendGroup(child.pid, "SIGKILL");
      const killEnd = performance.now() + 500;
      while (await groupAlive(child.pid) && performance.now() < killEnd) await delay(10);
      if (await groupAlive(child.pid)) failure = "Local shell cleanup uncertain";
    }
    const closeEnd = performance.now() + 500;
    while (!closed && performance.now() < closeEnd) await delay(10);
    if (!closed) failure = "Local shell stream closure uncertain";
  } catch { failure = "Local shell cleanup uncertain"; }
  finally { child.stdout.destroy(); child.stderr.destroy(); }
  if (failure) throw new Error(failure);
  check();
  if (result.signal !== null || result.exitCode === null) throw new Error("Local shell terminated abnormally");
  result.ok = result.exitCode === 0;
  if (!result.ok && !options.settle) {
    // Evidence is bounded and non-enumerable by default; errors do not repeat
    // command/cwd/environment or potentially secret command output in messages.
    throw new LocalShellExitError(result);
  }
  return result;
}
