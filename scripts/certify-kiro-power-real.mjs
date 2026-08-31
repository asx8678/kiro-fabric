#!/usr/bin/env node
// Aggregate real Kiro Power UI evidence from clean Linux/macOS/Windows hosts.
// This script never synthesizes a pass: every required check must be supplied
// by a real-client driver or a reviewed machine evidence recorder.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertArtifactOutsideCheckout } from "./certification/artifact-path.mjs";
import {
  captureGitBinding,
  gitBindingsMatch,
  validateGitBinding,
} from "./certification/git-binding.mjs";
import {
  POWER_REAL_CHECKS,
  POWER_REAL_QUALIFICATION_KIND,
  POWER_REAL_QUALIFICATION_SCHEMA_VERSION,
} from "./certification/readiness-reports.mjs";

const checkout = path.resolve(".");
const evidencePaths = [];
let output;
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--evidence") {
    const value = process.argv[++index];
    if (!value) throw new Error("--evidence requires a path");
    evidencePaths.push(path.resolve(value));
  } else if (argument === "--output") {
    const value = process.argv[++index];
    if (!value || output) throw new Error("--output requires one path");
    output = path.resolve(value);
  } else {
    throw new Error(`unknown argument: ${argument}`);
  }
}
if (!output || evidencePaths.length !== 3) {
  throw new Error("Usage: certify-kiro-power-real --evidence <linux.json> --evidence <macos.json> --evidence <windows.json> --output <report.json>");
}
assertArtifactOutsideCheckout(checkout, output, "--output");
const identity = captureGitBinding(checkout);
const pkg = JSON.parse(readFileSync(path.join(checkout, "package.json"), "utf8"));
const expectedPackage = `${pkg.name}@${pkg.version}`;
const expectedChecks = [...POWER_REAL_CHECKS];
const platforms = evidencePaths.map((file) => {
  const evidence = JSON.parse(readFileSync(file, "utf8"));
  if (!validateGitBinding(evidence.identity) || !gitBindingsMatch(evidence.identity, identity)) {
    throw new Error(`real Power evidence is not bound to this checkout: ${file}`);
  }
  if (evidence.package !== expectedPackage || !["linux", "darwin", "win32"].includes(evidence.os)
    || typeof evidence.arch !== "string" || typeof evidence.nodeVersion !== "string"
    || typeof evidence.kiroVersion !== "string" || !Array.isArray(evidence.checks)) {
    throw new Error(`real Power evidence metadata is invalid: ${file}`);
  }
  const ids = evidence.checks.map((check) => check?.id);
  if (ids.length !== expectedChecks.length || new Set(ids).size !== expectedChecks.length
    || expectedChecks.some((id) => !ids.includes(id))) {
    throw new Error(`real Power evidence check set is incomplete: ${file}`);
  }
  if (evidence.checks.some((check) => check?.status !== "pass"
    || typeof check.evidence !== "string" || check.evidence.length === 0)) {
    throw new Error(`real Power evidence contains a non-pass check: ${file}`);
  }
  return {
    os: evidence.os,
    arch: evidence.arch,
    nodeVersion: evidence.nodeVersion,
    kiroVersion: evidence.kiroVersion,
    checks: evidence.checks,
  };
});
if (new Set(platforms.map((platform) => platform.os)).size !== 3) {
  throw new Error("real Power evidence must cover Linux, macOS, and Windows exactly once");
}
const report = {
  kind: POWER_REAL_QUALIFICATION_KIND,
  schemaVersion: POWER_REAL_QUALIFICATION_SCHEMA_VERSION,
  identity,
  package: expectedPackage,
  ok: true,
  platforms: platforms.sort((left, right) => left.os.localeCompare(right.os)),
  finishedAt: new Date().toISOString(),
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${output}\n`);
