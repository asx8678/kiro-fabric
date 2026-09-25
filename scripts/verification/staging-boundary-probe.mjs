// Disposable-process controls for the process-wide I07 loader. No actual copy,
// candidate, client, or native execution. All generated fixtures are retained.
// Usage: node scripts/verification/staging-boundary-probe.mjs <owned-output-dir>
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

if (!process.argv[2] || process.argv.length !== 3) throw new Error("Pass an existing private task-owned output directory");
const output = fs.realpathSync(path.resolve(process.argv[2]));
const stat = fs.lstatSync(output);
if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new Error("Control output must be a private owned directory");
const root = fs.mkdtempSync(path.join(output, "staging-boundary-controls-"));
fs.chmodSync(root, 0o700);
let forbiddenAttempts = 0;
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[name] = () => { forbiddenAttempts++; throw new Error("Boundary control forbids subprocess execution"); };
process.dlopen = () => { forbiddenAttempts++; throw new Error("Boundary control forbids native loading"); };
syncBuiltinESMExports();
const canonical = await import("../source-bundle-stage.mjs");
const { STAGING_COPY_BOUNDARY_KEY, STAGING_BOUNDARY_TAG, DEFAULT_MUTATION_BUDGET_MS,
  registerStagingCopyBoundaryLoader, armCopyBoundary, disarmCopyBoundary,
  importBoundaryStageSourceBundle, stageWithControlledDrift } = await import("./staging-copy-boundary.mjs");
const checks = [];
assert.equal(STAGING_COPY_BOUNDARY_KEY, "__KIRO_FABRIC_STAGING_COPY_BOUNDARY__");
assert.equal(STAGING_BOUNDARY_TAG, "kiro-fabric-staging-boundary");
assert.equal(DEFAULT_MUTATION_BUDGET_MS, 30000);
checks.push("fixed-private-contract");
registerStagingCopyBoundaryLoader(); registerStagingCopyBoundaryLoader();
const first = await importBoundaryStageSourceBundle(), second = await importBoundaryStageSourceBundle();
assert.notEqual(first.instance, second.instance);
assert.notEqual(first.stageSourceBundle, second.stageSourceBundle);
assert.notEqual(first.stageSourceBundle, canonical.stageSourceBundle);
assert.equal((await import("../source-bundle-stage.mjs")).stageSourceBundle, canonical.stageSourceBundle);
checks.push("tagged-invocations-and-canonical-isolation");
const a = armCopyBoundary({ member: "manager.mjs", instance: first.instance });
assert.equal(a.shouldPause("/owned/manager.mjs"), true);
assert.equal(a.shouldPause("/owned/other.mjs"), false);
let resumed = false;
const paused = a.pause("/owned/manager.mjs").then(() => { resumed = true; });
assert.equal(await a.reached, "/owned/manager.mjs");
assert.equal(resumed, false);
a.release(); await paused; assert.equal(resumed, true);
const b = armCopyBoundary({ member: "manager.mjs", instance: second.instance });
disarmCopyBoundary(a); assert.equal(globalThis[STAGING_COPY_BOUNDARY_KEY], b);
disarmCopyBoundary(b); assert.equal(Object.hasOwn(globalThis, STAGING_COPY_BOUNDARY_KEY), false);
checks.push("pause-release-and-owned-disarm");
let mutated = false;
const destination = path.join(root, "never-created");
const result = await stageWithControlledDrift({ source: path.join(root, "missing-source"), output: destination, member: "manager.mjs", mutate: () => { mutated = true; } });
assert.equal(result.status, "rejected"); assert.equal(result.boundaryReached, false);
assert.equal(mutated, false); assert.equal(fs.existsSync(destination), false);
assert.equal(Object.hasOwn(globalThis, STAGING_COPY_BOUNDARY_KEY), false);
checks.push("early-rejection-observed-without-mutation-or-residue");
assert.equal(forbiddenAttempts, 0);
const report = path.join(root, "results.json");
fs.writeFileSync(report, JSON.stringify({ status: "passed", qualification: false, checks, forbiddenAttempts }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
process.stdout.write(JSON.stringify({ status: "passed", qualification: false, checks: checks.length, forbiddenAttempts, report, retainedRoot: root }) + "\n");
