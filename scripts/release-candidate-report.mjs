#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validatePowerRealQualification,
} from "./certification/readiness-reports.mjs";
import {
  captureGitBinding,
  gitBindingsMatch,
} from "./certification/git-binding.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
const output = valueAfter("--output");
if (!output) throw new Error("Usage: release-candidate-report --output <file> [--require-clean] [--require-github] [--qualification <file>] [--sbom <file>]");

const run = (command, commandArgs, options = {}) => spawnSync(command, commandArgs, {
  cwd: root,
  encoding: "utf8",
  timeout: 60_000,
  ...options,
});
const check = (id, passed, evidence) => ({ id, passed, evidence });
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const plugin = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"));
const expectedPackage = `${pkg.name}@${pkg.version}`;
const identity = captureGitBinding(root);
const checks = [];

checks.push(check(
  "versions",
  plugin.version === pkg.version && pkg.packageManager === "pnpm@11.20.0" && pkg.engines?.node === ">=24",
  `package=${pkg.version}; plugin=${plugin.version}; manager=${pkg.packageManager}; node=${pkg.engines?.node}`,
));
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
checks.push(check("changelog", new RegExp(`^## ${pkg.version.replaceAll(".", "\\.")}\\b`, "mu").test(changelog), `CHANGELOG entry for ${pkg.version}`));

const generated = run("git", ["diff", "--exit-code", "--", "dist/kiro-closure", "dist/kiro-power-closure", "plugin.json", "mcp.json", "package.json"]);
checks.push(check("generated-artifacts", generated.status === 0, generated.status === 0 ? "no generated drift" : (generated.stdout || generated.stderr).slice(-2000)));

const pack = run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", [
  "pack", "--dry-run", "--json", "--config.ignore-scripts=true",
], { env: { ...process.env, npm_config_cache: path.join(os.tmpdir(), "kiro-fabric-rc-npm-cache") } });
let packedFiles = [];
try {
  const parsed = JSON.parse(pack.stdout || "null");
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  packedFiles = entry?.files?.map((file) => file.path) ?? [];
} catch {
  // The failed check below carries the bounded command output.
}
const requiredPackageFiles = [
  "plugin.json",
  "mcp.json",
  "package.json",
  "skills/fabric-exec/SKILL.md",
  "skills/fabric-orchestration/SKILL.md",
  "dist/kiro-power-closure/kiro/mcp-entry.js",
];
const packageBoundaryOk = pack.status === 0 && requiredPackageFiles.every((file) => packedFiles.includes(file)) &&
  packedFiles.every((file) => !file.startsWith(".kiro/agents/") && !file.startsWith(".kiro/steering/") && !file.startsWith(".kiro/skills/"));
checks.push(check("package-contents", packageBoundaryOk, packageBoundaryOk ? `${packedFiles.length} files; repository development assets excluded` : (pack.stderr || pack.stdout).slice(-2000)));

const sbomPath = valueAfter("--sbom");
let sbomOk = false;
let sbomEvidence = "--sbom was not supplied";
if (sbomPath) {
  try {
    const sbom = JSON.parse(fs.readFileSync(path.resolve(sbomPath), "utf8"));
    sbomOk = sbom.spdxVersion === "SPDX-2.3" && sbom.SPDXID === "SPDXRef-DOCUMENT" && Array.isArray(sbom.packages) && sbom.packages.length > 0;
    sbomEvidence = sbomOk ? `${sbom.packages.length} SPDX packages` : "invalid SPDX 2.3 document";
  } catch (error) {
    sbomEvidence = error instanceof Error ? error.message : String(error);
  }
}
checks.push(check("sbom", sbomOk, sbomEvidence));

const qualificationPath = valueAfter("--qualification");
let qualificationOk = false;
let qualificationEvidence = "real-Kiro qualification was not supplied";
if (qualificationPath) {
  try {
    const qualification = JSON.parse(fs.readFileSync(path.resolve(qualificationPath), "utf8"));
    const validated = validatePowerRealQualification(qualification, expectedPackage);
    qualificationOk = validated.valid && validated.passed && gitBindingsMatch(qualification.identity, identity);
    qualificationEvidence = qualificationOk
      ? `real Kiro Linux/macOS/Windows evidence bound to ${identity.head}`
      : validated.valid ? "qualification Git binding differs from this checkout" : validated.error;
  } catch (error) {
    qualificationEvidence = error instanceof Error ? error.message : String(error);
  }
}
checks.push(check("real-kiro", qualificationOk, qualificationEvidence));

const requiredContexts = [
  "check (ubuntu-latest, Node 24)",
  "check (macos-latest, Node 24)",
  "check (windows-latest, Node 24)",
  "reproducible Power closure",
  "lifecycle stress (ubuntu-latest)",
  "lifecycle stress (macos-latest)",
  "kiro-power-real/all",
];
let github = { status: "not-requested", contexts: [] };
if (args.includes("--require-github")) {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) {
    github = { status: "failed", contexts: [], error: "GH_TOKEN and GITHUB_REPOSITORY are required" };
  } else {
    const headers = { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" };
    const request = async (suffix) => {
      const response = await fetch(`https://api.github.com/repos/${repository}/commits/${identity.head}/${suffix}`, { headers });
      if (!response.ok) throw new Error(`GitHub ${suffix}: ${response.status} ${await response.text()}`);
      return response.json();
    };
    try {
      const [runs, statuses] = await Promise.all([request("check-runs?per_page=100"), request("status")]);
      const observed = new Map();
      for (const item of runs.check_runs ?? []) observed.set(item.name, item.conclusion === "success" ? "success" : item.conclusion ?? item.status);
      for (const item of statuses.statuses ?? []) if (!observed.has(item.context)) observed.set(item.context, item.state);
      github = { status: requiredContexts.every((name) => observed.get(name) === "success") ? "passed" : "failed", contexts: requiredContexts.map((name) => ({ name, state: observed.get(name) ?? "missing" })) };
    } catch (error) {
      github = { status: "failed", contexts: [], error: error instanceof Error ? error.message : String(error) };
    }
  }
}
checks.push(check("required-ci-contexts", github.status === "passed", JSON.stringify(github)));

const expectedTag = `v${pkg.version}`;
const tag = run("git", ["describe", "--exact-match", "--tags", "HEAD"]);
let signedTag = { expectedTag, status: "required-at-release" };
if (tag.status === 0) {
  const observedTag = tag.stdout.trim();
  const verified = run("git", ["verify-tag", observedTag]);
  signedTag = { expectedTag, observedTag, status: observedTag === expectedTag && verified.status === 0 ? "verified" : "failed" };
}
checks.push(check("signed-tag-prerequisite", signedTag.status !== "failed", JSON.stringify(signedTag)));

const requireClean = args.includes("--require-clean");
const locallyRequired = new Set(["versions", "changelog", "generated-artifacts", "package-contents", "sbom", "signed-tag-prerequisite"]);
if (qualificationPath) locallyRequired.add("real-kiro");
if (args.includes("--require-github")) locallyRequired.add("required-ci-contexts");
const report = {
  kind: "kiro-fabric.release-candidate",
  schemaVersion: 1,
  identity,
  package: expectedPackage,
  ok: checks.filter((item) => locallyRequired.has(item.id)).every((item) => item.passed) && (!requireClean || !identity.dirty),
  requireClean,
  signedTag,
  checks,
  packageFiles: packedFiles,
  checksum: createHash("sha256").update(JSON.stringify({ identity, checks, packedFiles })).digest("hex"),
  generatedAt: new Date().toISOString(),
};
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${path.resolve(output)}\n`);
if (!report.ok) process.exitCode = 1;
