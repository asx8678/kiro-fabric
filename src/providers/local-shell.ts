import { spawn } from "node:child_process";
import { localProcessGroupAlive as groupAlive } from "./local-process-group.js";
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

async function sendGroup(pid: number, signal: NodeJS.Signals, end: number): Promise<void> {
  try { process.kill(-pid, signal); } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return;
    // Darwin can return EPERM for a group consisting only of reparented zombies.
    // Never suppress a permission failure unless bounded observation proves it inert.
    if (process.platform === "darwin" && code === "EPERM" && !(await groupAlive(pid, end))) return;
    throw new Error("Local shell cleanup uncertain");
  }
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
      let alive = true;
      const termEnd = performance.now() + 200;
      try {
        await sendGroup(child.pid, "SIGTERM", termEnd);
        while (performance.now() < termEnd) {
          alive = await groupAlive(child.pid, termEnd);
          if (!alive) break;
          await delay(Math.min(10, Math.max(0, termEnd - performance.now())));
        }
      } catch {
        // Failed observation is not termination, and must not bypass SIGKILL.
        alive = true;
      }
      if (alive) {
        const killEnd = performance.now() + 500;
        await sendGroup(child.pid, "SIGKILL", killEnd);
        while (performance.now() < killEnd) {
          alive = await groupAlive(child.pid, killEnd);
          if (!alive) break;
          await delay(Math.min(10, Math.max(0, killEnd - performance.now())));
        }
        if (alive) failure = "Local shell cleanup uncertain";
      }
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
