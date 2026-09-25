#!/usr/bin/env node
// Local-development offline verification entrypoint.
//
// This is NOT release qualification, and it is NOT a substitute for the
// removed release-grade suites. scripts/qualification-unavailable.mjs remains
// the fail-closed blocker for those command names.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPORT_SCHEMA_VERSION,
  captureCodeIdentity,
  inspectSuite,
  createFixtureRoot,
  createReportDir,
  runSuite,
  writeJsonArtifact,
} from "./verification/runner.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUITE_SELECTORS = ["baseline", "installer", "runtime", "quality", "lifecycle", "locking", "boundaries", "contracts", "activation", "semantic-baseline", "qualification-safety", "all"];
const ALL_SUITES = ["baseline", "installer", "runtime", "quality", "lifecycle", "locking", "boundaries", "contracts"];
const SUITE_MODULES = {
  baseline: "verification/baseline-cases.mjs",
  installer: "verification/installer-cases.mjs",
  runtime: "verification/non-browser-cases.mjs",
  quality: "verification/quality-cases.mjs",
  lifecycle: "verification/lifecycle-cases.mjs",
  locking: "verification/w5-locking-cases.mjs",
  boundaries: "verification/w6-safety-cases.mjs",
  contracts: "verification/w7-contract-cases.mjs",
  activation: "verification/activation-cases.mjs",
  "semantic-baseline": "verification/semantic-baseline-cases.mjs",
  "qualification-safety": "verification/qualification-safety-cases.mjs",
};
const SELF_TESTS = ["pass", "fail", "empty"];
const USAGE = [
  "usage: node scripts/verify-offline.mjs [baseline|installer|runtime|quality|lifecycle|locking|boundaries|contracts|activation|semantic-baseline|qualification-safety|all] [--json]",
  "",
  "  default selector: all (the established portable lanes)",
  "  activation, semantic-baseline and qualification-safety are explicit selectors.",
  "  activation requires a current native closure and verified offline tool cache.",
  "    Explicit task selection uses KIRO_FABRIC_ACTIVATION_BASE + KIRO_FABRIC_ACTIVATION_TASK_ROOT.",
  "    An invalid shared pointer is preserved and cannot silently fall back.",
  "  semantic-baseline requires KIRO_FABRIC_SEMANTIC_BUNDLE plus independent operator anchors:",
  "    KIRO_FABRIC_SEMANTIC_EXPECTED_MANIFEST_SHA256 and KIRO_FABRIC_SEMANTIC_EXPECTED_GENERATION_DIGEST.",
  "  --json       print one machine-readable report on stdout",
  "  --help, -h   print this text without executing anything",
  "",
  "Local-development verification only. Not release qualification.",
].join("\n");

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const selectors = [];
  let json = false;
  let help = false;
  let selfTest = null;
  for (const arg of argv) {
    if (arg === "--json") {
      if (json) problems.push("duplicate flag: --json");
      json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") { help = true; continue; }
    if (arg.startsWith("--self-test=")) {
      const name = arg.slice("--self-test=".length);
      if (selfTest !== null) problems.push("duplicate flag: --self-test");
      else if (!SELF_TESTS.includes(name)) problems.push("unknown self-test: " + name);
      else selfTest = name;
      continue;
    }
    if (arg.startsWith("-")) { problems.push("unknown flag: " + arg); continue; }
    if (!SUITE_SELECTORS.includes(arg)) { problems.push("unknown suite: " + arg); continue; }
    if (selectors.includes(arg)) { problems.push("duplicate suite selector: " + arg); continue; }
    selectors.push(arg);
  }
  if (selectors.includes("all") && selectors.length > 1) problems.push("all cannot be combined with other selectors");
  if (selfTest !== null && selectors.length > 0) problems.push("--self-test cannot be combined with suite selectors");
  return { problems, selectors, json, help, selfTest };
}

/** @param {string|null} name @returns {any[]} */
function selfTestCases(name) {
  if (name === "pass") return [{ id: "SELFTEST-PASS", title: "internal passing control", deadlineMs: 30000, run: async () => ({ control: "pass" }) }];
  if (name === "fail") return [{ id: "SELFTEST-FAIL", title: "internal failing control", deadlineMs: 30000, run: async () => { throw new Error("intentional control failure"); } }];
  return [];
}

/** @param {string} name @returns {Promise<{name:string, cases:any[], requiredIds:string[], problem:string|null}>} */
export async function loadSuite(name) {
  try {
    if (name.startsWith("self-test-") && SELF_TESTS.includes(name.slice(10))) {
      const cases = selfTestCases(name.slice(10));
      return { name, cases, requiredIds: cases.map(entry => entry.id), problem: null };
    }
    if (!Object.hasOwn(SUITE_MODULES, name)) throw new Error("unknown suite: " + name);
    const relative = SUITE_MODULES[name];
    const file = path.join(ROOT, "scripts", relative);
    if (!fs.existsSync(file)) throw new Error("suite " + name + " registered zero cases: scripts/" + relative + " is missing");
    const module = await import(new URL(relative, import.meta.url).href);
    const cases = typeof module.createCases === "function" ? module.createCases() : [];
    if (!Array.isArray(cases) || cases.length === 0) throw new Error("suite " + name + " registered zero cases; a suite without cases must not report success");
    if (!Array.isArray(module.requiredIds) || module.requiredIds.length === 0) throw new Error("suite " + name + " has no required case IDs");
    return { name, cases, requiredIds: module.requiredIds, problem: null };
  } catch (error) {
    return { name, cases: [], requiredIds: [], problem: error instanceof Error ? error.message : String(error) };
  }
}

/** @param {Record<string,string>} identity */
function identityDrift(identity) {
  try { return JSON.stringify(captureCodeIdentity(ROOT)) === JSON.stringify(identity) ? null : "source identity changed during verification"; }
  catch (error) { return "source identity recheck failed: " + String(error); }
}

/** @param {{problems:string[], json:boolean}} parsed */
function reportSelectionFailure(parsed) {
  const payload = { schemaVersion: REPORT_SCHEMA_VERSION, qualification: false, localDevelopmentOnly: true, mode: "selection", ok: false, problems: parsed.problems };
  if (parsed.json) process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  else process.stderr.write("verify-offline: " + parsed.problems.join("; ") + "\n" + USAGE + "\n");
  return 2;
}

/** @param {string} suite @param {any} counts @param {boolean} ok */
function summaryLine(suite, counts, ok) {
  return (ok ? "PASS" : "FAIL") + " " + suite + " cases=" + counts.cases + " passed=" + counts.passed + " failed=" + counts.failed + " partial=" + (counts.partial ?? 0) + " unavailable=" + counts.unavailable + " (local development only, NOT qualification)";
}

/** @param {any} report @param {{json:boolean}} parsed @param {string} label */
function emitSuiteReport(report, parsed, label) {
  writeJsonArtifact(report.fixtures.reportDir, "report-" + label + ".json", report);
  if (parsed.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else process.stderr.write(summaryLine(report.suite, report.counts, report.ok) + "\n");
  return report.ok ? 0 : 1;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.problems.length > 0) return reportSelectionFailure(parsed);
  if (parsed.help) { process.stdout.write(USAGE + "\n"); return 0; }
  const label = parsed.selfTest !== null ? "self-test-" + parsed.selfTest : parsed.selectors.length > 0 ? parsed.selectors.join("+") : "all";
  const reportDir = createReportDir(ROOT, label);
  const fixturesRoot = createFixtureRoot(ROOT, label);
  const identityDigest = captureCodeIdentity(ROOT);
  /** @param {string} text */
  const stderr = (text) => { process.stderr.write(text); };

  if (parsed.selfTest !== null) {
    const cases = selfTestCases(parsed.selfTest);
    const report = await runSuite({
      suite: "self-test-" + parsed.selfTest,
      cases,
      requiredIds: cases.map((entry) => entry.id),
      root: ROOT,
      fixturesRoot,
      retainedRoot: fixturesRoot,
      identityDigest,
      reportDir,
      stderr,
    });
    const drift = identityDrift(identityDigest);
    if (drift) { report.problems.push(drift); report.ok = false; }
    return emitSuiteReport(report, parsed, label);
  }

  const selected = parsed.selectors.length === 0 || parsed.selectors.includes("all") ? ALL_SUITES : parsed.selectors;
  /** @type {any[]} */
  const loaded = [];
  /** @type {string[]} */
  const problems = [];
  for (const name of selected) {
    const suite = await inspectSuite(name, ROOT, fixturesRoot);
    if (suite.problem !== null) problems.push(suite.problem);
    loaded.push(suite);
    if (suite.interrupted) { problems.push("verification interrupted during suite discovery"); break; }
  }
  /** @type {any[]} */
  const reports = [];
  if (problems.length === 0) {
    for (const suite of loaded) {
      fs.mkdirSync(path.join(fixturesRoot, suite.name), { mode: 0o700 });
      reports.push(await runSuite({
        suite: suite.name,
        cases: suite.cases,
        requiredIds: suite.requiredIds,
        root: ROOT,
        fixturesRoot: path.join(fixturesRoot, suite.name),
        retainedRoot: path.join(fixturesRoot, suite.name),
        identityDigest,
        reportDir,
        stderr,
      }));
      if (reports.at(-1).interrupted) { problems.push("verification interrupted; remaining suites not executed"); break; }
    }
  }
  const drift = identityDrift(identityDigest);
  if (drift) {
    problems.push(drift);
    for (const report of reports) { report.problems.push(drift); report.ok = false; }
  }
  for (const report of reports) writeJsonArtifact(reportDir, "report-" + report.suite + ".json", report);
  const ok = problems.length === 0 && reports.length === selected.length && reports.every((report) => report.ok === true);
  const aggregate = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    qualification: false,
    localDevelopmentOnly: true,
    mode: "suites",
    selected,
    discovery: loaded.map(({ name, fixturesRoot, retainedEnvironmentRoot, process: child, problem }) => ({ suite: name, fixturesRoot, retainedEnvironmentRoot, process: child, problem })),
    suites: reports.map((report) => ({ suite: report.suite, ok: report.ok, counts: report.counts, problems: report.problems, caseIds: report.executedCaseIds })),
    problems,
    reportDir,
    fixturesRoot,
    identityDigest,
    ok,
  };
  writeJsonArtifact(reportDir, "aggregate.json", aggregate);
  if (parsed.json) process.stdout.write(JSON.stringify(aggregate, null, 2) + "\n");
  else {
    for (const suite of aggregate.suites) stderr(summaryLine(suite.suite, suite.counts, suite.ok) + "\n");
    for (const problem of problems) stderr("PROBLEM " + problem + "\n");
    stderr(summaryLine("all", {
      cases: aggregate.suites.reduce((total, suite) => total + suite.counts.cases, 0),
      passed: aggregate.suites.reduce((total, suite) => total + suite.counts.passed, 0),
      failed: aggregate.suites.reduce((total, suite) => total + suite.counts.failed, 0),
      partial: aggregate.suites.reduce((total, suite) => total + suite.counts.partial, 0),
      unavailable: aggregate.suites.reduce((total, suite) => total + suite.counts.unavailable, 0),
    }, ok) + "\n");
    stderr("Reports retained at " + reportDir + "\n");
  }
  return ok ? 0 : 1;
}

// Importing the loader from the case worker must never run the CLI recursively.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch (error) {
    const failure = { schemaVersion: REPORT_SCHEMA_VERSION, qualification: false, localDevelopmentOnly: true,
      mode: "infrastructure", ok: false, problems: [error instanceof Error ? error.message : String(error)] };
    if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(failure) + "\n");
    else process.stderr.write("verify-offline: " + failure.problems.join("; ") + "\n");
    process.exitCode = 1;
  }
}
