// Baseline runner controls: prove the verification runner itself is not
// vacuous. These controls cannot satisfy installer or browser cases; they only
// exercise the runner contract.
import assert from "node:assert/strict";
import path from "node:path";

export const requiredIds = ["BASE-01", "BASE-02", "BASE-03", "BASE-04", "BASE-05", "BASE-06", "BASE-07", "BASE-08"];

const CLI = "scripts/verify-offline.mjs";
const REFERENCES = "scripts/verify-project-references.mjs";

/** @param {any} context @param {string[]} args */
function runCli(context, args) {
  return context.spawn(process.execPath, [path.join(context.root, CLI), ...args], { cwd: context.root });
}

/** @param {string} text */
function parseReport(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** @returns {any[]} */
export function createCases() {
  return [
    {
      id: "BASE-01",
      title: "a passing assertion yields process success",
      effects: "spawns the offline runner once; no browser, install or network effects",
      run: async (context) => {
        const result = runCli(context, ["--self-test=pass", "--json"]);
        assert.equal(result.spawnError, null, "control spawn must not fail: " + String(result.spawnError));
        assert.equal(result.code, 0, "expected a zero exit for a passing control; stderr: " + result.stderr);
        const report = parseReport(result.stdout);
        assert.ok(report, "the runner must print one machine-readable report on stdout");
        assert.equal(report.qualification, false);
        assert.equal(report.ok, true);
        assert.ok(report.counts.passed >= 1, "a passing control must be counted");
        return { exitCode: result.code, firstStatus: report.results[0].status };
      },
    },
    {
      id: "BASE-02",
      title: "an intentional assertion failure becomes nonzero",
      effects: "spawns the offline runner once with a deliberately failing control",
      run: async (context) => {
        const result = runCli(context, ["--self-test=fail", "--json"]);
        assert.equal(result.spawnError, null);
        assert.notEqual(result.code, 0, "an intentional assertion failure must be nonzero");
        const report = parseReport(result.stdout);
        assert.ok(report, "a failing control must still emit a report");
        assert.equal(report.ok, false);
        assert.equal(report.results[0].status, "failed");
        return { exitCode: result.code, firstStatus: report.results[0].status, error: report.results[0].error };
      },
    },
    {
      id: "BASE-03",
      title: "an unknown suite is rejected",
      effects: "spawns the offline runner once with an unknown selector",
      run: async (context) => {
        const result = runCli(context, ["no-such-suite", "--json"]);
        assert.equal(result.spawnError, null);
        assert.notEqual(result.code, 0, "an unknown suite must not exit zero");
        const report = parseReport(result.stdout);
        assert.ok(report, "a selection failure must be machine-readable under --json");
        assert.equal(report.ok, false);
        assert.ok(report.problems.join(" ").includes("unknown suite"), "the failure must name the unknown suite: " + report.problems.join(" "));
        return { exitCode: result.code, problems: report.problems };
      },
    },
    {
      id: "BASE-04",
      title: "an empty case registry is rejected",
      effects: "spawns the offline runner once with an empty registry control",
      run: async (context) => {
        const result = runCli(context, ["--self-test=empty", "--json"]);
        assert.equal(result.spawnError, null);
        assert.notEqual(result.code, 0, "zero cases must never exit zero");
        const report = parseReport(result.stdout);
        assert.ok(report);
        assert.equal(report.ok, false);
        assert.ok(report.problems.join(" ").includes("empty case registry"), "the empty registry must be named: " + report.problems.join(" "));
        return { exitCode: result.code, problems: report.problems };
      },
    },
    {
      id: "BASE-05",
      title: "child exit codes and signals are reported explicitly",
      effects: "spawns two inert Node child processes; no fixtures or network",
      run: async (context) => {
        const exited = context.spawn(process.execPath, ["-e", "process.exit(7)"], { cwd: context.root });
        assert.equal(exited.spawnError, null);
        assert.equal(exited.code, 7, "a child exit code must be preserved, not collapsed");
        assert.equal(exited.signal, null);
        assert.equal(exited.ok, false);
        const signalled = context.spawn(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"], { cwd: context.root });
        assert.equal(signalled.signal, "SIGTERM", "a child signal must be reported, never treated as success");
        assert.equal(signalled.ok, false);
        return { exitCode: exited.code, signal: signalled.signal };
      },
    },
    {
      id: "BASE-06",
      title: "a child that exceeds its budget is reported as timed out",
      effects: "spawns one inert Node child that is killed by the harness budget",
      run: async (context) => {
        const slow = context.spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { cwd: context.root, timeoutMs: 300 });
        assert.equal(slow.timedOut, true, "a child exceeding its budget must be reported as timed out");
        assert.equal(slow.ok, false);
        assert.equal(slow.timeoutMs, 300, "the harness must not widen the requested budget");
        return { timedOut: slow.timedOut, timeoutMs: slow.timeoutMs };
      },
    },
    {
      id: "BASE-07",
      title: "the report is a single non-qualifying JSON object",
      effects: "spawns the offline runner once",
      run: async (context) => {
        const result = runCli(context, ["--self-test=pass", "--json"]);
        const text = result.stdout.trim();
        const report = JSON.parse(text);
        assert.equal(report.schemaVersion, 1);
        assert.equal(report.qualification, false);
        assert.equal(report.localDevelopmentOnly, true);
        assert.ok(report.identityDigest && Object.keys(report.identityDigest).length > 0, "the report must carry code identity");
        assert.equal(text.includes("UNQUALIFIED"), false, "stdout must stay machine-readable");
        return { schemaVersion: report.schemaVersion, identityFiles: Object.keys(report.identityDigest).length };
      },
    },
    {
      id: "BASE-08",
      title: "the reference audit is not vacuous",
      effects: "spawns the reference audit against a synthetic broken fixture; no network",
      run: async (context) => {
        const result = context.spawn(process.execPath, [path.join(context.root, REFERENCES), "--self-test=missing-target"], { cwd: context.root });
        assert.equal(result.spawnError, null);
        assert.equal(result.code, 0, "the reference audit must detect the synthetic breakage; stderr: " + result.stderr);
        const payload = parseReport(result.stdout);
        assert.ok(payload, "the reference self-test must print machine-readable controls");
        assert.equal(payload.controls.detectedMissingTarget, true);
        assert.equal(payload.controls.detectedUnknownScript, true);
        assert.equal(payload.controls.cleanRootStayedClean, true);
        return payload.controls;
      },
    },
  ];
}
