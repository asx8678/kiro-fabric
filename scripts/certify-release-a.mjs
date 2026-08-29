#!/usr/bin/env node
// Deterministic packed-artifact Release-A gate. Not part of `pnpm check`
// / `prepack` — packing from prepack would recurse.

import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertArtifactOutsideCheckout } from "./certification/artifact-path.mjs";
import { captureGitBinding } from "./certification/git-binding.mjs";
import {
  RELEASE_A_CERTIFICATION_KIND,
  RELEASE_A_CERTIFICATION_SCHEMA_VERSION,
} from "./certification/readiness-reports.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const argv = process.argv.slice(2);
if (argv.length !== 0 && (argv.length !== 2 || argv[0] !== "--json" || !argv[1] || argv[1].startsWith("--"))) {
  throw new Error("Usage: node scripts/certify-release-a.mjs [--json <path>]");
}
const jsonPath = argv.length === 2 ? resolve(argv[1]) : undefined;
assertArtifactOutsideCheckout(root, jsonPath, "--json");
const identity = captureGitBinding(root);
const work = mkdtempSync(join(tmpdir(), "kiro-fabric-release-a-"));
const completedChecks = [];
let certificationReport;
const fail = (message) => {
  throw new Error(message);
};

try {
  const packDir = join(work, "pack");
  mkdirSync(packDir);
  execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", packDir], {
    cwd: root,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const tarball = join(packDir, `${pkg.name}-${pkg.version}.tgz`);
  if (!existsSync(tarball)) fail(`expected tarball ${tarball}`);

  const listing = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  const entries = listing.split("\n").filter(Boolean);
  const required = [
    "package/package.json",
    "package/README.md",
    "package/LICENSE",
    "package/docs/kiro/installer.md",
    "package/docs/kiro/release-a.md",
    "package/dist/kiro/cli-entry.js",
    "package/dist/kiro/mcp-entry.js",
    "package/dist/kernel/index.js",
  ];
  for (const file of required) {
    if (!entries.includes(file)) fail(`tarball missing ${file}`);
  }
  for (const banned of ["package/src/", "package/tests/", "package/scripts/", "package/node_modules/"]) {
    if (entries.some((entry) => entry.startsWith(banned))) fail(`tarball contains ${banned}`);
  }
  completedChecks.push("pack");

  const consumer = join(work, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "release-a-consumer", private: true, type: "module" }, null, 2),
  );
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarball,
    ],
    { cwd: consumer, stdio: "inherit", env: { ...process.env, NODE_PATH: "" } },
  );

  const binDir = join(consumer, "node_modules", ".bin");
  const cli = join(binDir, "kiro-fabric");
  const mcp = join(binDir, "kiro-fabric-mcp");
  if (!existsSync(cli) || !existsSync(mcp)) fail("packed bins were not installed");

  const project = join(work, "project");
  mkdirSync(project);
  writeFileSync(join(project, "sentinel.txt"), "keep");
  mkdirSync(join(project, ".kiro", "agents"), { recursive: true });
  writeFileSync(join(project, ".kiro", "agents", "other.json"), JSON.stringify({ name: "other" }));

  const fake = join(root, "tests", "fixtures", "kiro", "fake-kiro.mjs");
  const wrapper = join(work, "fake-kiro");
  writeFileSync(
    wrapper,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fake)} "$@"\n`,
    { mode: 0o755 },
  );
  chmodSync(wrapper, 0o755);

  const installOut = execFileSync(
    process.execPath,
    [cli, "install", "kiro", "--project-root", project, "--kiro-binary", wrapper, "--json"],
    { encoding: "utf8", env: { ...process.env, NODE_PATH: "" } },
  );
  const installed = JSON.parse(installOut);
  if (installed.action !== "create" || installed.dryRun !== false) {
    fail(`unexpected install result: ${installOut}`);
  }
  if (String(installed.profilePath).includes(join(root, "dist"))) {
    fail("installed profile still points at the checkout dist/");
  }
  completedChecks.push("install");

  const doctor = spawnSync(
    process.execPath,
    [cli, "doctor", "kiro", "--kiro-binary", wrapper, "--json"],
    { encoding: "utf8", env: { ...process.env, NODE_PATH: "" } },
  );
  if (doctor.status !== 0) fail(`packed doctor failed: ${doctor.stderr || doctor.stdout}`);
  const report = JSON.parse(doctor.stdout);
  if (!report.ok || report.nonBillable !== true || report.modelTurnsRequested !== 0) {
    fail(`packed doctor report is not a clean non-billable pass`);
  }
  completedChecks.push("doctor");

  const mcpProbe = spawnSync(process.execPath, [mcp], {
    encoding: "utf8",
    input:
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "release-a", version: "0" } } })}\n` +
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n` +
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`,
    timeout: 20_000,
  });
  const frames = (mcpProbe.stdout || "")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const listed = frames.find((frame) => frame.id === 2)?.result?.tools;
  if (!Array.isArray(listed) || listed.length !== 1 || listed[0]?.name !== "fabric_exec") {
    fail(`packed MCP did not advertise exactly fabric_exec: ${mcpProbe.stdout}`);
  }
  completedChecks.push("mcp");

  const uninstallOut = execFileSync(
    process.execPath,
    [cli, "uninstall", "kiro", "--project-root", project, "--json"],
    { encoding: "utf8" },
  );
  const removed = JSON.parse(uninstallOut);
  if (removed.action !== "remove") fail(`unexpected uninstall result: ${uninstallOut}`);
  if (existsSync(join(project, ".kiro", "agents", "kiro-fabric.json"))) {
    fail("managed profile still present after uninstall");
  }
  if (!existsSync(join(project, ".kiro", "agents", "other.json"))) {
    fail("unrelated sibling profile was removed");
  }
  if (readFileSync(join(project, "sentinel.txt"), "utf8") !== "keep") {
    fail("project sentinel was modified");
  }
  const second = JSON.parse(
    execFileSync(process.execPath, [cli, "uninstall", "kiro", "--project-root", project, "--json"], {
      encoding: "utf8",
    }),
  );
  if (second.action !== "noop") fail("second uninstall was not a no-op");
  completedChecks.push("uninstall");

  certificationReport = {
    kind: RELEASE_A_CERTIFICATION_KIND,
    schemaVersion: RELEASE_A_CERTIFICATION_SCHEMA_VERSION,
    identity,
    ok: true,
    package: `${pkg.name}@${pkg.version}`,
    tarball,
    checks: completedChecks,
    finishedAt: new Date().toISOString(),
  };
} catch (error) {
  certificationReport = {
    kind: RELEASE_A_CERTIFICATION_KIND,
    schemaVersion: RELEASE_A_CERTIFICATION_SCHEMA_VERSION,
    identity,
    ok: false,
    package: `${pkg.name}@${pkg.version}`,
    checks: completedChecks,
    error: {
      code: "release-a-certification-failed",
      message: error instanceof Error ? error.message : String(error),
    },
    finishedAt: new Date().toISOString(),
  };
  process.stderr.write(`Release-A certification failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}

const json = `${JSON.stringify(certificationReport, null, 2)}\n`;
if (jsonPath) writeFileSync(jsonPath, json, { mode: 0o600 });
process.stdout.write(json);
