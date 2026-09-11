import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { writeFileAtomic } from "./atomic-file.mjs";

export const QUALIFICATION_PHASES = Object.freeze([
  "preflight", "archive-validation", "driver-start", "authentication", "archive-installation",
  "client-contract", "coding-and-form", "interactive", "manual-compaction", "automatic-compaction",
  "resume", "headless", "evidence-validation", "publication",
]);
const outcomes = ["not-started", "not-created", "pending", "complete", "removed", "failed", "unverified", "wrapper-owned"];
const reasonFor = error => error?.code === "ETIMEDOUT" || error?.name === "TimeoutError" || /timed out|timeout/iu.test(String(error?.message ?? "")) ? "timeout" : error?.code === "QUALIFICATION_INTERRUPTED" ? "interrupted" : "error";

/** This schema intentionally cannot accept error messages, paths, argv, auth
 * values, transcripts, hashes of secrets, or arbitrary child report objects.
 * Write progress BEFORE effects/cleanup so SIGKILL still leaves honest evidence.
 * @param {string | undefined} output @param {"driver" | "wrapper"} component */
export function qualificationFailureRecorder(output, component) {
  if (!["driver", "wrapper"].includes(component)) throw new Error("Invalid qualification component");
  const report = { kind: "kiro-fabric.qualification-diagnostic", schemaVersion: 1, ok: false, qualifying: false,
    scope: "nonqualifying-sanitized-diagnostic-only", component, phase: "preflight", phases: ["preflight"],
    reason: "in-progress", cleanup: { processes: "not-started", authHome: component === "driver" ? "wrapper-owned" : "not-created" } };
  const flush = () => {
    const bytes = JSON.stringify(report, null, 2) + "\n";
    if (Buffer.byteLength(bytes) > 4096) throw new Error("Qualification diagnostic exceeded bound");
    if (output) writeFileAtomic(output, bytes, { mode: 0o600 });
    return JSON.parse(bytes);
  };
  return {
    snapshot: () => JSON.parse(JSON.stringify(report)), flush,
    phase(phase) {
      if (!QUALIFICATION_PHASES.includes(phase)) throw new Error("Invalid qualification phase");
      report.phase = phase;
      if (!report.phases.includes(phase)) report.phases.push(phase);
      flush();
    },
    failure(error) { report.reason = reasonFor(error); flush(); },
    completed() { report.reason = "completed"; flush(); },
    cleanup(kind, outcome) {
      if (!["processes", "authHome"].includes(kind) || !outcomes.includes(outcome)) throw new Error("Invalid qualification cleanup outcome");
      report.cleanup[kind] = outcome; flush();
    },
  };
}

/** Diagnostics never suppress cleanup, even if publication itself fails.
 * Test seams are in-process only, never CLI/environment bypasses.
 * @param {{output?:string,component:"driver"|"wrapper",cleanupKind:"processes"|"authHome",cleanup:()=>any}} options
 * @param {(record:ReturnType<typeof qualificationFailureRecorder>)=>any} action */
export async function withQualificationFailureReport(options, action) {
  const record = qualificationFailureRecorder(options.output, options.component);
  let result, failure;
  try { record.flush(); result = await action(record); }
  catch (error) { failure = error; try { record.failure(error); } catch { /* cleanup must still run */ } }
  try {
    try { record.cleanup(options.cleanupKind, "pending"); } catch { /* cleanup must still run */ }
    const outcome = await options.cleanup();
    record.cleanup(options.cleanupKind, outcome === "not-created" ? "not-created" : options.cleanupKind === "authHome" ? "removed" : "complete");
  } catch (error) {
    failure ??= error;
    try { record.cleanup(options.cleanupKind, "failed"); record.failure(failure); } catch { /* no raw diagnostics */ }
  }
  if (failure) throw failure;
  record.completed();
  return result;
}

/** Own a separate POSIX process group; never capture or echo auth output.
 * TERM gives the driver its exact-PID cleanup opportunity; KILL bounds timeout
 * even if a hung driver ignores TERM. Group cleanup precedes raw-home removal.
 * @param {string} executable @param {string[]} argv
 * @param {{env?:NodeJS.ProcessEnv,timeoutMs:number,signal?:AbortSignal,interactive?:boolean,graceMs?:number,onFailure?:(error:any)=>void}} options */
export function runBoundedQualificationProcess(executable, argv, options) {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) throw new Error("Invalid qualification timeout");
  const grace = options.graceMs ?? 12_000;
  if (!Number.isSafeInteger(grace) || grace < 1 || grace > 30_000) throw new Error("Invalid qualification cleanup grace");
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argv, { env: options.env, detached: process.platform !== "win32", stdio: options.interactive ? "inherit" : "ignore" });
    let failure, killer;
    const kill = signal => {
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal); else child.kill(signal); }
      catch (error) { if (error.code !== "ESRCH") failure ??= error; }
    };
    const stop = error => {
      if (failure) return;
      failure = error;
      try { options.onFailure?.(error); } catch { /* diagnostic IO must not suppress process cleanup */ }
      kill("SIGTERM");
      killer = setTimeout(() => kill("SIGKILL"), grace);
    };
    const interrupt = () => stop(Object.assign(new Error("Qualification interrupted"), { code: "QUALIFICATION_INTERRUPTED" }));
    const timer = setTimeout(() => stop(Object.assign(new Error("Qualification timed out"), { code: "ETIMEDOUT" })), options.timeoutMs);
    const finish = () => { clearTimeout(timer); clearTimeout(killer); options.signal?.removeEventListener("abort", interrupt); };
    child.once("error", error => { finish(); reject(error); });
    child.once("close", (code, signal) => {
      // Terminate only our owned group, including descendants of an exited driver.
      kill("SIGKILL"); finish();
      if (failure || code !== 0 || signal) reject(Object.assign(failure ?? new Error("Repository qualification driver failed"), { cleanupComplete: false }));
      else resolve(undefined);
    });
    options.signal?.addEventListener("abort", interrupt, { once: true });
    if (options.signal?.aborted) interrupt();
  });
}

/** Raw transcript-bound v13 success evidence remains internal/ephemeral.
 * A privacy-safe independently verifiable successor is required before upload;
 * stripping transcripts and claiming qualification would weaken promotion. */
export function assertSafeQualificationPublication(report) {
  const queue = [report]; let visited = 0;
  while (queue.length) {
    if (++visited > 100_000) throw new Error("Qualification publication exceeds structural bound");
    const value = queue.pop();
    if (!value || typeof value !== "object") continue;
    for (const [key, child] of Object.entries(value)) {
      if (["raw", "transcript", "transcripts", "stdout", "stderr"].includes(key)) throw new Error("Raw transcript qualification publication BLOCKED; a privacy-safe evidence contract is required");
      if (child && typeof child === "object") queue.push(child);
    }
  }
}

/** CI's always-run fallback also handles wrapper SIGKILL/runner cancellation.
 * Reproject through the allowlist, never upload arbitrary preexisting JSON.
 * @param {string} output @param {"removed"|"failed"} authHome */
export function finalizeQualificationDiagnostic(output, authHome) {
  if (!["removed", "failed"].includes(authHome)) throw new Error("Invalid auth cleanup outcome");
  let previous;
  try {
    const fd = fs.openSync(output, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096) throw new Error("Unsafe diagnostic input");
      const bytes = Buffer.alloc(4097), count = fs.readSync(fd, bytes, 0, bytes.length, 0);
      if (count > 4096) throw new Error("Diagnostic input grew beyond bound");
      previous = JSON.parse(bytes.subarray(0, count).toString("utf8"));
    } finally { fs.closeSync(fd); }
  } catch { /* Unknown input is replaced with a nonqualifying allowlisted record. */ }
  const record = qualificationFailureRecorder(output, previous?.component === "driver" ? "driver" : "wrapper");
  if (Array.isArray(previous?.phases)) for (const phase of previous.phases) if (QUALIFICATION_PHASES.includes(phase)) record.phase(phase);
  if (QUALIFICATION_PHASES.includes(previous?.phase)) record.phase(previous.phase);
  if (outcomes.includes(previous?.cleanup?.processes)) record.cleanup("processes", previous.cleanup.processes);
  record.cleanup("authHome", authHome);
  if (previous?.reason === "completed" && authHome === "removed") record.completed();
  else record.failure(previous?.reason === "timeout" ? { code: "ETIMEDOUT" } : previous?.reason === "error" || authHome === "failed" ? {} : { code: "QUALIFICATION_INTERRUPTED" });
  return record.snapshot();
}

/** Require a dedicated report outside every raw authentication/work directory. */
export function assertExternalDiagnosticPath(output, rawRoots) {
  if (!path.isAbsolute(output)) throw new Error("Diagnostic output must be absolute");
  for (const root of rawRoots.filter(Boolean)) {
    const relative = path.relative(path.resolve(root), output);
    if (!relative || !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) throw new Error("Diagnostic output must be outside raw qualification state");
  }
  // Refuse symbolic-link parent redirection; never traverse user auth trees.
  let current = path.dirname(output);
  for (;;) {
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe diagnostic directory");
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}
