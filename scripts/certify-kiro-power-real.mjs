#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertRealClientEvidence, REAL_CLIENT_SESSION_COMMAND } from "./real-client-evidence.mjs";
import { digestPowerPackage, validatePowerPackage } from "./validate-power-package.mjs";

const valueAfter = (flag) => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; };
const archive = path.resolve(valueAfter("--archive") ?? ".tmp/kiro-fabric-power.tar.gz");
const output = path.resolve(valueAfter("--output") ?? ".tmp/kiro-power-real-qualification.json");
const hashFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const archiveDigest = hashFile(archive);
const commitResult = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
if (commitResult.status !== 0) throw new Error("Cannot bind real-client evidence to the current commit");
const commit = commitResult.stdout.trim();
const configuredDriver = process.env.KIRO_POWER_REAL_DRIVER;
const expectedDriverDigest = process.env.KIRO_POWER_REAL_DRIVER_SHA256;
if (!configuredDriver || !path.isAbsolute(configuredDriver) || !/^[a-f0-9]{64}$/u.test(expectedDriverDigest ?? "")) {
  throw new Error("Real-client qualification requires an absolute reviewed KIRO_POWER_REAL_DRIVER and KIRO_POWER_REAL_DRIVER_SHA256");
}
const inspectDriver = () => {
  const stats = fs.lstatSync(configuredDriver);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || (process.platform !== "win32" && ((stats.mode & 0o111) === 0 || (stats.mode & 0o022) !== 0))) {
    throw new Error("Real-client driver must be a non-writable executable single-link regular file");
  }
  const resolved = fs.realpathSync(configuredDriver);
  const digest = hashFile(resolved);
  if (digest !== expectedDriverDigest) throw new Error("Real-client driver digest does not match the reviewed identity");
  return { resolved, digest, dev: stats.dev, ino: stats.ino };
};
const firstDriver = inspectDriver();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-power-real-"));
const extracted = path.join(temporary, "package");
const evidence = path.join(temporary, "driver-evidence.json");
fs.mkdirSync(extracted, { mode: 0o700 });
try {
  const unpack = spawnSync("tar", ["-xzf", archive, "-C", extracted], { encoding: "utf8" });
  if (unpack.error) throw unpack.error;
  if (unpack.status !== 0) throw new Error(`Power archive extraction failed: ${unpack.stderr}`);
  validatePowerPackage(extracted);
  const packageDigest = digestPowerPackage(extracted, { excludeOwner: true }).digest;
  const currentDriver = inspectDriver();
  if (currentDriver.resolved !== firstDriver.resolved || currentDriver.dev !== firstDriver.dev || currentDriver.ino !== firstDriver.ino) throw new Error("Real-client driver changed before execution");
  const result = spawnSync(currentDriver.resolved, [
    "--package", extracted, "--package-digest", packageDigest, "--archive-digest", archiveDigest,
    "--commit", commit, "--session-command-json", JSON.stringify(REAL_CLIENT_SESSION_COMMAND), "--output", evidence,
  ], { stdio: "inherit", env: process.env, timeout: 45 * 60_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Real-client driver exited with status ${result.status ?? "unknown"}`);
  const afterDriver = inspectDriver();
  if (afterDriver.dev !== firstDriver.dev || afterDriver.ino !== firstDriver.ino) throw new Error("Real-client driver changed during execution");
  const evidenceStats = fs.lstatSync(evidence);
  if (!evidenceStats.isFile() || evidenceStats.isSymbolicLink() || evidenceStats.nlink !== 1 || evidenceStats.size > 1024 * 1024) throw new Error("Real-client evidence must be bounded and unaliased");
  const report = JSON.parse(fs.readFileSync(evidence, "utf8"));
  report.driver = { ...report.driver, digest: currentDriver.digest };
  const observed = assertRealClientEvidence(report, packageDigest, { archiveDigest });
  const qualification = { ...observed, kind: "kiro-fabric.real-client-qualification", schemaVersion: 2, ok: true };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(qualification, null, 2)}\n`, { mode: 0o600 });
  console.log(output);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
