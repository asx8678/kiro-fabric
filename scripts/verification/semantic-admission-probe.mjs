// Maintained recorder-only admission controls. No candidate execution.
// Usage: node scripts/verification/semantic-admission-probe.mjs <owned-output-dir> [control-name ...]
// The three explicit semantic environment inputs are supplied independently by
// the trusted operator. Missing positive anchors never count as a passing suite.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

if (!process.argv[2]) throw new Error("Pass an existing private task-owned output directory; all fixtures remain");
const output = fs.realpathSync(path.resolve(process.argv[2]));
const stat = fs.lstatSync(output);
if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new Error("Control output must be a private owned directory");
const root = fs.mkdtempSync(path.join(output, "semantic-admission-controls-"));
fs.chmodSync(root, 0o700);
let forbiddenAttempts = 0;
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  childProcess[name] = () => { forbiddenAttempts++; throw new Error("Admission control forbids subprocess execution: " + name); };
}
process.dlopen = () => { forbiddenAttempts++; throw new Error("Admission control forbids native loading"); };
syncBuiltinESMExports();
const { runSemanticAdmissionChecks } = await import("./semantic-baseline-admission.mjs");
const only = process.argv.slice(3);
const result = await runSemanticAdmissionChecks({ fixturesRoot: root, ...(only.length ? { only } : {}) });
assert.equal(forbiddenAttempts, 0, "No subprocess/native execution may be attempted");
const report = path.join(root, "results.json");
fs.writeFileSync(report, JSON.stringify({ ...result, forbiddenAttempts }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
process.stdout.write(JSON.stringify({ ok: result.ok, qualification: false, counts: result.counts, selectedControls: result.selectedControls, forbiddenAttempts, report, retainedRoot: root }) + "\n");
if (!result.ok) process.exitCode = 1;
