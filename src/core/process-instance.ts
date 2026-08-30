import fs from "node:fs";

/** Durable lock-owner identity. Linux can distinguish PID reuse across both
 * process restarts and host reboots; other platforms conservatively retain the
 * lock whenever its PID still appears live. */
export interface ProcessInstanceIdentity {
  pid: number;
  bootId?: string;
  processStart?: string;
}

const readLinuxBootId = (): string | undefined => {
  if (process.platform !== "linux") return undefined;
  try {
    const value = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim().toLowerCase();
    return /^[a-f0-9-]{16,64}$/u.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

const readLinuxProcessStart = (pid: number): string | undefined => {
  if (process.platform !== "linux" || !Number.isSafeInteger(pid) || pid <= 0) return undefined;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(") ");
    if (close < 0) return undefined;
    // The suffix starts at proc field 3; process start time is field 22.
    const startTicks = stat.slice(close + 2).trim().split(/\s+/u)[19];
    return startTicks && /^\d+$/u.test(startTicks) ? startTicks : undefined;
  } catch {
    return undefined;
  }
};

export const processInstanceIdentity = (pid = process.pid): ProcessInstanceIdentity => {
  const bootId = readLinuxBootId();
  const processStart = readLinuxProcessStart(pid);
  return {
    pid,
    ...(bootId && processStart ? { bootId, processStart } : {}),
  };
};

const pidIsAlive = (pid: number): boolean => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM proves that a process exists but is not signalable. Unknown errors
    // are ambiguous and therefore retain the lock.
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
};

export const processInstanceIsAlive = (owner: ProcessInstanceIdentity): boolean => {
  if (!pidIsAlive(owner.pid)) return false;
  if (
    process.platform === "linux" &&
    typeof owner.bootId === "string" &&
    typeof owner.processStart === "string"
  ) {
    const bootId = readLinuxBootId();
    const processStart = readLinuxProcessStart(owner.pid);
    if (bootId !== undefined && processStart !== undefined) {
      return bootId === owner.bootId && processStart === owner.processStart;
    }
  }
  // Missing instance metadata or an unsupported/inaccessible platform is not
  // evidence of death. Fall back to PID liveness rather than stealing a lock.
  return true;
};
