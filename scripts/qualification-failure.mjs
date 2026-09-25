import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./atomic-file.mjs";

const QUALIFICATION_PHASES = Object.freeze([
  "preflight", "archive-validation", "driver-start", "authentication", "archive-installation",
  "client-contract", "coding-and-form", "interactive", "manual-compaction", "automatic-compaction",
  "resume", "headless", "evidence-validation", "publication",
]);
const outcomes = ["not-started", "not-created", "pending", "complete", "removed", "retained", "failed", "unverified", "wrapper-owned"];
const reasonFor = error => error?.code === "QUALIFICATION_STATE_RETAINED" ? "retained-state" : error?.code === "ETIMEDOUT" || error?.name === "TimeoutError" || /timed out|timeout/iu.test(String(error?.message ?? "")) ? "timeout" : error?.code === "QUALIFICATION_INTERRUPTED" ? "interrupted" : "error";

/** This schema intentionally cannot accept error messages, paths, argv, auth
 * values, transcripts, hashes of secrets, or arbitrary child report objects.
 * Write progress BEFORE effects/cleanup so SIGKILL still leaves honest evidence.
 * @param {string | undefined} output @param {"driver" | "wrapper"} component */
function qualificationFailureRecorder(output, component) {
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
    const normalized = options.cleanupKind === "processes" && outcome === undefined ? "complete" : outcome;
    const allowed = options.cleanupKind === "authHome" ? ["not-created", "removed", "retained", "unverified", "failed"] : ["complete", "unverified", "failed"];
    if (!allowed.includes(normalized)) throw new Error("Invalid qualification cleanup result");
    record.cleanup(options.cleanupKind, normalized);
    if (!["not-created", "removed", "complete"].includes(normalized)) {
      failure ??= Object.assign(new Error("Qualification cleanup incomplete"), { code: normalized === "retained" ? "QUALIFICATION_STATE_RETAINED" : "QUALIFICATION_CLEANUP_UNVERIFIED" });
      record.failure(failure);
    }
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
 * even if a hung driver ignores TERM. Group cleanup remains mandatory even
 * when the raw home must be retained and qualification is blocked.
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

const reasons = ["in-progress", "completed", "error", "timeout", "interrupted", "retained-state"];
const sameKeys = (value, names) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === [...names].sort().join();
const exists = file => { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };

// Bounded reads of DIAGNOSTICS ONLY. Never inspect authentication/tree contents.
function readDiagnostic(file, component) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || stat.size > 4096) throw new Error("Unsafe diagnostic");
    const buffer = Buffer.alloc(4097), size = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (size > 4096) throw new Error("Diagnostic bound");
    const report = JSON.parse(buffer.subarray(0, size).toString("utf8"));
    if (!sameKeys(report, ["kind", "schemaVersion", "ok", "qualifying", "scope", "component", "phase", "phases", "reason", "cleanup"]) ||
        report.kind !== "kiro-fabric.qualification-diagnostic" || report.schemaVersion !== 1 || report.ok !== false || report.qualifying !== false ||
        report.scope !== "nonqualifying-sanitized-diagnostic-only" || report.component !== component || !QUALIFICATION_PHASES.includes(report.phase) ||
        !Array.isArray(report.phases) || report.phases.length < 1 || report.phases.length > QUALIFICATION_PHASES.length || new Set(report.phases).size !== report.phases.length ||
        report.phases[0] !== "preflight" || report.phases.at(-1) !== report.phase || report.phases.some(phase => !QUALIFICATION_PHASES.includes(phase)) ||
        !reasons.includes(report.reason) || !sameKeys(report.cleanup, ["processes", "authHome"]) ||
        !["not-started", "pending", "complete", "failed", "unverified"].includes(report.cleanup.processes) || !outcomes.includes(report.cleanup.authHome)) throw new Error("Invalid diagnostic");
    return { report, valid: true };
  } catch {
    const report = qualificationFailureRecorder(undefined, component).snapshot();
    report.reason = "error"; report.cleanup.processes = "unverified"; report.cleanup.authHome = "unverified";
    return { report, valid: false };
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

// CLI owns the workflow entrypoints. Do not export unused inline-only helpers.
function diagnosticCommand(argv) {
  const [action, output, rawRoot, extra] = argv;
  if (!output || extra || !["initialize", "finalize"].includes(action) || (action === "initialize" ? rawRoot !== undefined : !rawRoot || !path.isAbsolute(rawRoot))) throw new Error("Invalid diagnostic command");
  assertExternalDiagnosticPath(output, rawRoot ? [rawRoot] : []);
  if (action === "initialize") { qualificationFailureRecorder(output, "wrapper").flush(); return 0; }
  const present = exists(rawRoot);
  let failed = present;
  for (const [file, component] of [[output, "wrapper"], [`${output}.driver.json`, "driver"]]) {
    if (component === "driver" && !exists(file)) continue;
    const safeOutput = `${file}.sanitized.json`;
    assertExternalDiagnosticPath(safeOutput, [rawRoot]);
    const { report, valid } = readDiagnostic(file, component);
    const rootStat = present ? fs.lstatSync(rawRoot) : null;
    const disposition = rootStat ? rootStat.isDirectory() && !rootStat.isSymbolicLink() ? "retained" : "unverified" : report.cleanup.authHome === "not-created" ? "not-created" : "unverified";
    report.cleanup.authHome = disposition;
    if (present && ["completed", "in-progress"].includes(report.reason)) report.reason = disposition === "retained" ? "retained-state" : "error";
    failed ||= !valid || disposition !== "not-created" || report.reason !== "completed" || !["not-started", "complete"].includes(report.cleanup.processes);
    // Upload ONLY this strict-schema copy, never the untrusted original.
    writeFileAtomic(safeOutput, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  }
  if (failed) console.error("Qualification remains blocked; private state is retained or disposition is unverified. Diagnostic copies contain no raw state; no tree cleanup was performed.");
  return failed ? 1 : 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = diagnosticCommand(process.argv.slice(2)); }
  catch { console.error("Qualification diagnostic finalization failed; raw output suppressed."); process.exitCode = 1; }
}
