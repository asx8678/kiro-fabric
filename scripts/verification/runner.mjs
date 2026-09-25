// Local-development verification infrastructure, never release qualification.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { validateCaseRegistry, incompleteCaseResult } from "./case-contract.mjs";
import { runCaseProcess, inheritedCaseGroup, caseGroupEnvironment } from "./case-process.mjs";

export const REPORT_SCHEMA_VERSION = 1;
// Whole-case harness budget, including cold start. Production deadlines inside
// cases remain independent and exact; never widen them to get a passing check.
const DEFAULT_SPAWN_BUDGET_MS = 120000;
const MAX_BUFFER = 4 * 1024 * 1024;

/** @param {string} file */
function hashFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error("invalid or oversized identity input: " + file);
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** @param {string} root @param {readonly string[]} files */
function codeIdentity(root, files) {
  /** @type {Record<string,string>} */
  const identity = {};
  for (const file of [...new Set(files)].sort()) identity[file] = hashFile(path.join(root, file));
  return identity;
}

/** Conservative source inventory, not an installed-runtime/dependency certificate.
 * Missing required roots, symlinks or exhausted bounds are errors, not omission.
 * @param {string} root
 */
export function captureCodeIdentity(root) {
  const files = ["package.json", "pnpm-lock.yaml", "install.sh"];
  const pending = ["src", "scripts"];
  let entries = 0;
  while (pending.length) {
    const relative = pending.pop();
    const directory = path.join(root, relative);
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("invalid identity directory: " + relative);
    for (const name of fs.readdirSync(directory).sort()) {
      if (++entries > 5000) throw new Error("source identity inventory bound exceeded");
      const child = path.join(relative, name);
      const childStat = fs.lstatSync(path.join(root, child));
      if (childStat.isSymbolicLink()) throw new Error("symlink in source identity: " + child);
      if (childStat.isDirectory()) pending.push(child);
      else if (childStat.isFile()) files.push(child);
      else throw new Error("special entry in source identity: " + child);
    }
  }
  return codeIdentity(root, files);
}

/** @param {number} timeoutMs */
function checkDeadline(timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900000) throw new Error("invalid harness deadline");
}

/** Bounded subprocesses within an already isolated case worker.
 * @param {{cwd?:string, env?:Record<string,string|undefined>, timeoutMs?:number}} [defaults]
 */
export function createSpawn(defaults = {}) {
  /** @param {string} command @param {readonly string[]} args
   * @param {{cwd?:string, env?:Record<string,string|undefined>, timeoutMs?:number}} [options]
   */
  return function spawn(command, args, options = {}) {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_SPAWN_BUDGET_MS;
    checkDeadline(timeoutMs);
    const result = spawnSync(command, [...args], {
      cwd: options.cwd ?? defaults.cwd, env: caseGroupEnvironment(options.env ?? defaults.env ?? process.env),
      encoding: "utf8", timeout: timeoutMs, maxBuffer: MAX_BUFFER,
      killSignal: "SIGKILL", stdio: inheritedCaseGroup() === null ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe", 3],
    });
    const error = /** @type {NodeJS.ErrnoException|undefined} */ (result.error);
    return {
      command, args: [...args], ok: !error && result.status === 0 && !result.signal,
      code: result.status, signal: result.signal ?? null,
      spawnError: error ? String(error.message) : null,
      timedOut: Boolean(error && error.code === "ETIMEDOUT"),
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      stderr: typeof result.stderr === "string" ? result.stderr : "", timeoutMs,
    };
  };
}

/** Validate existing ancestry without chmod/repairing unknown paths.
 * @param {string} directory @param {boolean} [privateOnly]
 */
function checkDirectory(directory, privateOnly = false) {
  const stat = fs.lstatSync(directory);
  if (!path.isAbsolute(directory) || fs.realpathSync(directory) !== directory || !stat.isDirectory() || stat.isSymbolicLink() ||
      stat.uid !== process.getuid?.() || (stat.mode & (privateOnly ? 0o077 : 0o022))) throw new Error("unsafe verification directory: " + directory);
}

/** @param {string} directory */
function ensureDirectory(directory) {
  try { fs.mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  checkDirectory(directory);
}

/** Always allocate fresh roots and retain them, including on failure.
 * @param {string} root @param {string} category @param {string} label
 */
function createRoot(root, category, label) {
  if (!/^[a-zA-Z0-9+-]{1,128}$/u.test(label)) throw new Error("invalid verification root label");
  checkDirectory(root);
  const temporary = path.join(root, ".tmp");
  ensureDirectory(temporary);
  const parent = path.join(temporary, category);
  ensureDirectory(parent);
  const created = fs.mkdtempSync(path.join(parent, label + "-"));
  checkDirectory(created, true);
  return created;
}

/** @param {string} root @param {string} name */
export function createFixtureRoot(root, name) { return createRoot(root, "verification-fixtures", name); }
/** @param {string} root @param {string} suite */
export function createReportDir(root, suite) { return createRoot(root, "verification-reports", suite); }

/** Report writes cannot follow/replace an existing file or escape the owned root.
 * @param {string} root @param {string} relative @param {unknown} value
 */
export function writeJsonArtifact(root, relative, value) {
  checkDirectory(root, true);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.+-]*\.json$/u.test(relative)) throw new Error("invalid report filename");
  const target = path.join(root, relative);
  fs.writeFileSync(target, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  return target;
}

/** Private external home: installer home validation forbids checkout overlap.
 * Every descendant is retained; no inherited auth/browser/Git/Node options.
 */
/** @param {string} suite */
function caseEnvironment(suite) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "fabric-verification-env-"));
  checkDirectory(root, true);
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  for (const [key, name] of Object.entries({ HOME: "home", KIRO_HOME: "kiro", TMPDIR: "tmp", XDG_CONFIG_HOME: "config", XDG_CACHE_HOME: "cache", XDG_DATA_HOME: "data", COREPACK_HOME: "corepack", NPM_CONFIG_CACHE: "npm" })) {
    const directory = path.join(root, name);
    fs.mkdirSync(directory, { mode: 0o700 });
    env[key] = directory;
  }
  // Forward only this lane's explicit candidate and independent operator anchors.
  // The semantic helper must bind all three before executing any candidate bytes.
  if (suite === "semantic-baseline") {
    for (const key of ["KIRO_FABRIC_SEMANTIC_BUNDLE", "KIRO_FABRIC_SEMANTIC_EXPECTED_MANIFEST_SHA256",
      "KIRO_FABRIC_SEMANTIC_EXPECTED_GENERATION_DIGEST"]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
  }
  // A task base never derives authority from the shared active pointer. Both
  // explicit activation values must survive the sterile worker boundary.
  if (suite === "activation") {
    for (const key of ["KIRO_FABRIC_ACTIVATION_BASE", "KIRO_FABRIC_ACTIVATION_TASK_ROOT"]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
  }
  return { root, env };
}

/** Even registry imports/factories run behind a process deadline. Only plain
 * descriptors cross back; callable case implementations remain in the worker.
 * @param {string} suite @param {string} root @param {string} fixturesRoot
 */
export async function inspectSuite(suite, root, fixturesRoot) {
  if (!/^[a-z][a-z0-9-]{0,64}$/u.test(suite)) throw new Error("invalid suite name");
  checkDirectory(fixturesRoot, true);
  const directory = fs.mkdtempSync(path.join(fixturesRoot, "registry-" + suite + "-"));
  const environment = caseEnvironment(suite);
  const retained = { fixturesRoot: directory, retainedEnvironmentRoot: environment.root };
  try {
    const child = await runCaseProcess({ suite, caseId: "registry", mode: "inspect", root, fixturesRoot: directory, deadlineMs: DEFAULT_SPAWN_BUDGET_MS }, environment.env);
    const processResult = { code: child.code, signal: child.signal, timedOut: child.timedOut, cleanupConfirmed: child.cleanupConfirmed, cleanupScope: child.cleanupScope };
    if (!child.ok) return { name: suite, cases: [], requiredIds: [], problem: child.spawnError ?? (child.stderr.trim() || "suite inspection failed"), interrupted: child.interrupted, ...retained, process: processResult };
    const response = JSON.parse(child.stdout);
    if (response?.schemaVersion !== 1 || response.caseId !== "registry" || !response.facts) throw new Error("invalid suite inspection result");
    const { cases, requiredIds } = response.facts;
    const contract = validateCaseRegistry(suite, cases, requiredIds);
    return { name: suite, cases, requiredIds, problem: contract.problems.length ? contract.problems.join("; ") : null, interrupted: false, ...retained, process: processResult };
  } catch (error) {
    return { name: suite, cases: [], requiredIds: [], problem: String(error), interrupted: false, ...retained };
  }
}

/** Run serially in supervised child processes. Case closures are never evaluated
 * in this process; the worker reloads only the independently registered module.
 * @param {{suite:string, cases:readonly any[], requiredIds:readonly string[], root:string,
 *   fixturesRoot?:string|null, retainedRoot?:string|null,
 *   identityDigest?:Record<string,string>, reportDir:string, stderr?:(text:string)=>void}} options
 */
export async function runSuite(options) {
  const stderr = options.stderr ?? (text => { process.stderr.write(text); });
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const { problems, requiredIds, missingRequired } = validateCaseRegistry(options.suite, options.cases, options.requiredIds);
  /** @type {any[]} */
  const results = [];
  if (problems.length === 0) {
    for (const entry of options.cases) {
      const caseStarted = performance.now();
      const deadlineMs = entry.deadlineMs ?? DEFAULT_SPAWN_BUDGET_MS;
      /** @type {any} */
      const record = { id: entry.id, title: entry.title, required: true, status: "pending", attempted: false, completed: false,
        elapsedMs: 0, deadlineMs, effects: entry.effects ?? "unspecified", facts: {} };
      try {
        if (typeof entry.unavailable === "string") {
          record.status = "unavailable";
          record.error = entry.unavailable;
        } else {
          const parent = options.fixturesRoot ?? createFixtureRoot(options.root, options.suite);
          checkDirectory(parent, true);
          const caseRoot = fs.mkdtempSync(path.join(parent, entry.id + "-"));
          const environment = caseEnvironment(options.suite);
          record.fixturesRoot = caseRoot;
          record.retainedEnvironmentRoot = environment.root;
          record.attempted = true;
          const child = await runCaseProcess({ suite: options.suite, caseId: entry.id, root: options.root, fixturesRoot: caseRoot, deadlineMs }, environment.env);
          record.process = { code: child.code, signal: child.signal, error: child.spawnError, timedOut: child.timedOut,
            interrupted: child.interrupted, cleanupConfirmed: child.cleanupConfirmed, cleanupScope: child.cleanupScope, settlementBudgetMs: child.settlementBudgetMs };
          if (child.stderr) stderr(child.stderr);
          if (!child.ok) {
            if (child.interrupted) problems.push("verification interrupted; remaining cases not executed");
            throw new Error(child.spawnError ?? ("case worker failed: exit=" + child.code + " signal=" + child.signal));
          }
          const response = JSON.parse(child.stdout);
          if (!response || response.schemaVersion !== 1 || response.caseId !== entry.id || !Object.hasOwn(response, "facts")) throw new Error("invalid or omitted case worker result");
          record.completed = true;
          record.facts = response.facts;
          const incomplete = incompleteCaseResult(response.facts);
          if (incomplete) { record.status = "partial"; record.error = incomplete; }
          else record.status = "passed";
        }
      } catch (error) {
        record.status = "failed";
        record.error = error instanceof Error ? error.name + ": " + error.message : String(error);
      }
      record.elapsedMs = Math.ceil(performance.now() - caseStarted);
      results.push(record);
      stderr(record.status.toUpperCase() + " " + record.id + " " + record.title + " (" + record.elapsedMs + "ms)" + (record.status === "passed" ? "" : " -- " + record.error) + "\n");
      if (problems.length) break;
    }
  }
  const count = status => results.filter(r => r.status === status).length;
  const executed = results.filter(r => r.attempted);
  const ok = problems.length === 0 && requiredIds.length > 0 && results.length === requiredIds.length && results.every(r => r.status === "passed");
  return {
    schemaVersion: REPORT_SCHEMA_VERSION, qualification: false, localDevelopmentOnly: true,
    suite: options.suite, startedAt, endedAt: new Date().toISOString(), elapsedMs: Math.ceil(performance.now() - started),
    architecture: { platform: process.platform, arch: process.arch, node: process.version },
    identityDigest: options.identityDigest ?? {},
    identityScope: "bounded checkout src/scripts inventory and package/lock/install inputs; not installed-runtime qualification",
    fixtures: { root: options.root, fixturesRoot: options.fixturesRoot ?? null, retainedArtifactsRoot: options.retainedRoot ?? options.fixturesRoot ?? null, reportDir: options.reportDir },
    counts: { registered: Array.isArray(options.cases) ? options.cases.length : 0, cases: results.length, required: requiredIds.length,
      passed: count("passed"), failed: count("failed"), partial: count("partial"), unavailable: count("unavailable"), executed: executed.length,
      completed: results.filter(r => r.completed).length },
    requiredCaseIds: requiredIds.join(","), executedCaseIds: executed.map(r => r.id).join(","),
    problems, missingRequiredCaseIds: missingRequired, results, ok,
    interrupted: results.some(record => record.process?.interrupted === true),
  };
}
