#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./atomic-file.mjs";
import { assertTrackedGitWorktreeClean } from "./package-identity.mjs";
import { assertRealClientEvidence } from "./real-client-evidence.mjs";
import { resolveRealClientAuthFlags } from "./run-kiro-agent-real-driver.mjs";
import { validateAgentPackage } from "./validate-agent-package.mjs";

const valueAfter = (flag) => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; };
const hasFlag = (flag) => process.argv.includes(flag);
const archive = path.resolve(valueAfter("--archive") ?? ".tmp/kiro-fabric-agent.tar.gz");
const output = path.resolve(valueAfter("--output") ?? ".tmp/kiro-agent-real-qualification.json");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
if (head.status !== 0) throw new Error("Cannot bind real-client evidence to the current commit");
const commit = head.stdout.trim();
const expectedCommit = valueAfter("--commit") ?? process.env.GITHUB_SHA;
if (expectedCommit && expectedCommit !== commit) throw new Error("Real-client qualification commit does not match HEAD");
assertTrackedGitWorktreeClean();
const driver = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "run-kiro-agent-real-driver.mjs");
const driverDigest = hash(fs.readFileSync(driver));
const { authMode, subscriptionLogin, subscriptionLicense, identityProvider, region } = resolveRealClientAuthFlags({
  authMode: valueAfter("--auth-mode"),
  subscriptionLogin: hasFlag("--subscription-login"),
  subscriptionLicense: valueAfter("--subscription-license"),
  identityProvider: valueAfter("--identity-provider"),
  region: valueAfter("--region"),
});
const requestedWorkRoot = valueAfter("--work-root");
let temporary;
if (requestedWorkRoot) {
  if (!path.isAbsolute(requestedWorkRoot)) throw new Error("--work-root must be absolute");
  const parent = fs.realpathSync(path.dirname(requestedWorkRoot));
  const relative = path.relative(parent, requestedWorkRoot);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("--work-root must be a direct child of an existing directory");
  fs.mkdirSync(requestedWorkRoot, { mode: 0o700 });
  fs.chmodSync(requestedWorkRoot, 0o700);
  temporary = fs.realpathSync(requestedWorkRoot);
} else {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-agent-real-"));
}
const archiveSnapshot = path.join(temporary, "package.tar.gz");
const extracted = path.join(temporary, "package");
const workspace = path.join(temporary, "workspace");
const isolatedHome = path.join(temporary, "home");
const kiroHome = path.join(isolatedHome, ".kiro");
const installCwd = path.join(temporary, "installer-cwd");
const evidence = path.join(temporary, "driver-evidence.json");
try {
  const archiveBytes = fs.readFileSync(archive);
  fs.writeFileSync(archiveSnapshot, archiveBytes, { mode: 0o600, flag: "wx" });
  const archiveDigest = hash(archiveBytes);
  fs.mkdirSync(extracted, { mode: 0o700 });
  fs.mkdirSync(workspace, { mode: 0o700 });
  fs.mkdirSync(isolatedHome, { mode: 0o700 });
  fs.mkdirSync(kiroHome, { mode: 0o700 });
  fs.mkdirSync(installCwd, { mode: 0o700 });
  const unpack = spawnSync("tar", ["-xzf", archiveSnapshot, "-C", extracted], { encoding: "utf8" });
  if (unpack.error) throw unpack.error;
  if (unpack.status !== 0) throw new Error(`Agent archive extraction failed: ${unpack.stderr}`);
  const packageEvidence = validateAgentPackage(extracted);
  const packageDigest = packageEvidence.digest;
  const result = spawnSync(process.execPath, [
    driver,
    "--package", extracted,
    "--package-digest", packageDigest,
    "--archive-digest", archiveDigest,
    "--commit", commit,
    "--workspace", workspace,
    "--kiro-home", kiroHome,
    "--home", isolatedHome,
    "--install-cwd", installCwd,
    "--output", evidence,
    "--auth-mode", authMode,
    ...(subscriptionLogin ? ["--subscription-login"] : []),
    ...(authMode === "subscription" ? ["--subscription-license", subscriptionLicense] : []),
    ...(identityProvider === undefined ? [] : ["--identity-provider", identityProvider, "--region", region]),
  ], { stdio: "inherit", timeout: 90 * 60_000, env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Repository real-client driver exited with status ${result.status ?? "unknown"}`);
  const report = JSON.parse(fs.readFileSync(evidence, "utf8"));
  if (report.driver?.digest !== driverDigest) throw new Error("Repository real-client driver identity mismatch");
  const observed = assertRealClientEvidence(report, packageDigest, {
    archiveDigest,
    commit,
    runtimeDigest: packageEvidence.runtime.digest,
    skillDigest: packageEvidence.skill.digest,
  });
  const qualification = { ...observed, kind: "kiro-fabric.real-client-qualification", schemaVersion: 12, ok: true };
  writeFileAtomic(output, Buffer.from(`${JSON.stringify(qualification, null, 2)}\n`));
  console.log(output);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
