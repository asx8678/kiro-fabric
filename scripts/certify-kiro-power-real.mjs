#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./atomic-file.mjs";
import { assertRealClientEvidence } from "./real-client-evidence.mjs";
import { validatePowerPackage } from "./validate-power-package.mjs";

const valueAfter = (flag) => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; };
const archive = path.resolve(valueAfter("--archive") ?? ".tmp/kiro-fabric-power.tar.gz");
const output = path.resolve(valueAfter("--output") ?? ".tmp/kiro-power-real-qualification.json");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
if (head.status !== 0) throw new Error("Cannot bind real-client evidence to the current commit");
const commit = head.stdout.trim();
const expectedCommit = valueAfter("--commit") ?? process.env.GITHUB_SHA;
if (expectedCommit && expectedCommit !== commit) throw new Error("Real-client qualification commit does not match HEAD");
const driver = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "run-kiro-power-real-driver.mjs");
const driverDigest = hash(fs.readFileSync(driver));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-power-real-"));
const archiveSnapshot = path.join(temporary, "package.tar.gz");
const extracted = path.join(temporary, "package");
const workspace = path.join(temporary, "workspace");
const evidence = path.join(temporary, "driver-evidence.json");
try {
  const archiveBytes = fs.readFileSync(archive);
  fs.writeFileSync(archiveSnapshot, archiveBytes, { mode: 0o600, flag: "wx" });
  const archiveDigest = hash(archiveBytes);
  fs.mkdirSync(extracted, { mode: 0o700 });
  fs.mkdirSync(workspace, { mode: 0o700 });
  const unpack = spawnSync("tar", ["-xzf", archiveSnapshot, "-C", extracted], { encoding: "utf8" });
  if (unpack.error) throw unpack.error;
  if (unpack.status !== 0) throw new Error(`Power archive extraction failed: ${unpack.stderr}`);
  const packageDigest = validatePowerPackage(extracted).digest;
  const result = spawnSync(process.execPath, [driver, "--package", extracted, "--package-digest", packageDigest, "--archive-digest", archiveDigest, "--commit", commit, "--workspace", workspace, "--output", evidence], { stdio: "inherit", timeout: 45 * 60_000, env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Repository real-client driver exited with status ${result.status ?? "unknown"}`);
  const report = JSON.parse(fs.readFileSync(evidence, "utf8"));
  if (report.driver?.digest !== driverDigest) throw new Error("Repository real-client driver identity mismatch");
  const observed = assertRealClientEvidence(report, packageDigest, { archiveDigest, commit });
  const qualification = { ...observed, kind: "kiro-fabric.real-client-qualification", schemaVersion: 3, ok: true };
  writeFileAtomic(output, Buffer.from(`${JSON.stringify(qualification, null, 2)}\n`));
  console.log(output);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
