// Bounded supervisor for one fixed offline case. No arbitrary module/command API.
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const WORKER = fileURLToPath(new URL("./case-worker.mjs", import.meta.url));
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const SETTLEMENT_BUDGET_MS = 2000;
const GROUP_MARKER = "KIRO_FABRIC_OFFLINE_GROUP";

// Nested verifier invocations inherit fd 3 from the outer case, rather than
// escaping into a new process group. The marker is bound to that actual fd;
// it never supplies a PID to signal and is not a production trust override.
function descriptorMarker() {
  const stat = fs.fstatSync(3);
  if (!stat.isFIFO() && !stat.isSocket()) throw new Error("invalid inherited case-group descriptor");
  return `${stat.dev}:${stat.ino}`;
}

export function inheritedCaseGroup() {
  const marker = process.env[GROUP_MARKER];
  if (marker === undefined) return null;
  if (marker !== descriptorMarker()) throw new Error("case-group descriptor identity mismatch");
  return marker;
}

/** @param {boolean} nested */
export function enterCaseProcessGroup(nested) {
  const inherited = inheritedCaseGroup();
  if (nested !== (inherited !== null)) throw new Error("case-group ownership mismatch");
  process.env[GROUP_MARKER] = inherited ?? descriptorMarker();
}

/** @param {Record<string,string|undefined>} env */
export function caseGroupEnvironment(env) {
  const result = { ...env };
  delete result[GROUP_MARKER];
  const marker = inheritedCaseGroup();
  if (marker !== null) result[GROUP_MARKER] = marker;
  return result;
}

/** The harness execution budget includes startup/imports. Disposal has its own
 * fixed bound; expiry never reports success or waits forever for a pipe/close.
 * Children must not detach. An outer case owns the group; nested verifiers own
 * their direct child and leave group-wide confirmation to that outer owner.
 * @param {{suite:string, caseId:string, root:string, fixturesRoot:string, deadlineMs:number, mode?:"inspect"}} request
 * @param {Record<string,string>} env
 */
export async function runCaseProcess(request, env) {
  if (process.platform !== "darwin" && process.platform !== "linux") throw new Error("offline case supervision requires POSIX process-group ownership");
  const nested = inheritedCaseGroup() !== null;
  return await new Promise(resolve => {
    let stdout = "", stderr = "", outputBytes = 0;
    let timedOut = false, interrupted = false, closed = false, finished = false;
    let code = null, signal = null;
    /** @type {string|null} */
    let failure = null;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let settlementTimer, pollTimer;
    const started = performance.now();
    const child = spawn(process.execPath, [WORKER, JSON.stringify({ ...request, nested })], {
      cwd: request.root, env: caseGroupEnvironment(env), detached: !nested,
      stdio: ["ignore", "pipe", "pipe", nested ? 3 : "pipe"],
    });
    const groupGone = () => {
      if (nested || !child.pid) return true;
      try { process.kill(-child.pid, 0); return false; }
      catch (error) {
        if (error.code === "ESRCH") return true;
        failure ??= "cannot confirm case-group settlement: " + error.message;
        return false;
      }
    };
    const stop = () => {
      if (!child.pid) return;
      try { if (nested) child.kill("SIGKILL"); else process.kill(-child.pid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") failure ??= "case process cleanup failed: " + error.message; }
    };
    const finish = cleanupConfirmed => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); clearTimeout(settlementTimer); clearTimeout(pollTimer);
      process.removeListener("SIGINT", onInterrupt); process.removeListener("SIGTERM", onInterrupt);
      if (!cleanupConfirmed) {
        failure = (failure ? failure + "; " : "") + "case cleanup uncertain after settlement budget";
        for (const stream of child.stdio) if (stream && "destroy" in stream) stream.destroy();
        child.unref();
      }
      resolve({ ok: failure === null && code === 0 && signal === null && cleanupConfirmed,
        code, signal, spawnError: failure, timedOut, interrupted, stdout, stderr,
        elapsedMs: performance.now() - started, timeoutMs: request.deadlineMs,
        settlementBudgetMs: SETTLEMENT_BUDGET_MS, cleanupConfirmed,
        cleanupScope: nested ? "direct-child; outer case owns process group" : "case-process-group" });
    };
    const poll = () => {
      if (finished) return;
      if (closed && groupGone()) { finish(true); return; }
      pollTimer = setTimeout(poll, 10);
    };
    const settle = () => {
      if (finished || settlementTimer) return;
      settlementTimer = setTimeout(() => finish(false), SETTLEMENT_BUDGET_MS);
      poll();
    };
    const onInterrupt = () => { interrupted = true; failure ??= "verification interrupted"; stop(); settle(); };
    process.once("SIGINT", onInterrupt); process.once("SIGTERM", onInterrupt);
    const timer = setTimeout(() => { timedOut = true; failure ??= "case deadline exceeded"; stop(); settle(); }, request.deadlineMs);
    const collect = (chunk, channel) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_OUTPUT_BYTES) { failure ??= "case output bound exceeded"; stop(); settle(); return; }
      if (channel === "stdout") stdout += chunk;
      else stderr += chunk;
    };
    child.stdout.setEncoding("utf8").on("data", chunk => collect(chunk, "stdout"));
    child.stderr.setEncoding("utf8").on("data", chunk => collect(chunk, "stderr"));
    child.once("error", error => { failure ??= "case spawn error: " + error.message; settle(); });
    child.once("exit", () => {
      if (performance.now() - started > request.deadlineMs) { timedOut = true; failure ??= "case deadline exceeded"; }
      clearTimeout(timer);
      stop(); settle();
    });
    child.once("close", (exitCode, exitSignal) => { closed = true; code = exitCode; signal = exitSignal; settle(); });
  });
}
