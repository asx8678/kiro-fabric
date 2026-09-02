#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertRealClientEvidence,
  REAL_CLIENT_SESSION_COMMAND,
  REAL_CLIENT_TOOLS,
} from "./real-client-evidence.mjs";
import { digestPowerPackage, validatePowerPackage } from "./validate-power-package.mjs";

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const packageRoot = path.resolve(valueAfter("--package") ?? ".tmp/kiro-fabric-power");
const output = path.resolve(valueAfter("--output") ?? ".tmp/kiro-power-real-qualification.json");
validatePowerPackage(packageRoot);
const digest = digestPowerPackage(packageRoot, { excludeOwner: true }).digest;

const configuredDriver = process.env.KIRO_POWER_REAL_DRIVER;
if (!configuredDriver || !path.isAbsolute(configuredDriver)) {
  throw new Error("Real-client qualification was not run: KIRO_POWER_REAL_DRIVER must name an absolute reviewed driver executable");
}
const driverStats = fs.lstatSync(configuredDriver);
if (!driverStats.isFile() || driverStats.isSymbolicLink() || driverStats.nlink !== 1) {
  throw new Error("KIRO_POWER_REAL_DRIVER must be a single-link regular non-symlink file");
}
if (process.platform !== "win32") {
  if ((driverStats.mode & 0o111) === 0) throw new Error("KIRO_POWER_REAL_DRIVER is not executable");
  if ((driverStats.mode & 0o022) !== 0) throw new Error("KIRO_POWER_REAL_DRIVER must not be group/world writable");
  if (typeof process.getuid === "function" && driverStats.uid !== process.getuid() && driverStats.uid !== 0) {
    throw new Error("KIRO_POWER_REAL_DRIVER must be owned by the current user or root");
  }
}
const driver = fs.realpathSync(configuredDriver);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-power-real-"));
const evidence = path.join(temporary, "driver-evidence.json");
try {
  const result = spawnSync(driver, [
    "--package", packageRoot,
    "--package-digest", digest,
    "--session-command-json", JSON.stringify(REAL_CLIENT_SESSION_COMMAND),
    "--output", evidence,
  ], {
    stdio: "inherit",
    env: process.env,
    timeout: 45 * 60_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Real-client driver exited with status ${result.status ?? "unknown"}`);
  const evidenceStats = fs.lstatSync(evidence);
  if (!evidenceStats.isFile() || evidenceStats.isSymbolicLink() || evidenceStats.nlink !== 1 || evidenceStats.size > 1024 * 1024) {
    throw new Error("Real-client driver evidence must be a bounded single-link regular file");
  }
  const report = assertRealClientEvidence(
    JSON.parse(fs.readFileSync(evidence, "utf8")),
    digest,
  );
  const qualification = {
    kind: "kiro-fabric.real-client-qualification",
    schemaVersion: 1,
    ok: true,
    packageDigest: digest,
    sessionCommand: REAL_CLIENT_SESSION_COMMAND,
    powerActivated: true,
    tools: REAL_CLIENT_TOOLS,
    customAgentSelected: false,
    driverEvidence: report,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(qualification, null, 2)}\n`, { mode: 0o600 });
  console.log(output);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
