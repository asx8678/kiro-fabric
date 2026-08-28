#!/usr/bin/env node
// Opt-in real Kiro Release-A certification. Never billable: refuses
// KIRO_PHASE0_BILLABLE=1 and never sends session/prompt.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.KIRO_FABRIC_RELEASE_A_REAL !== "1") {
  throw new Error("refusing to run: set KIRO_FABRIC_RELEASE_A_REAL=1");
}
if (process.env.KIRO_PHASE0_BILLABLE === "1") {
  throw new Error("refusing to run: KIRO_PHASE0_BILLABLE=1 is set");
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "kiro-fabric-release-a-real-"));

try {
  const packDir = join(work, "pack");
  mkdirSync(packDir);
  execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", packDir], {
    cwd: root,
    stdio: "inherit",
  });
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const tarball = join(packDir, `${pkg.name}-${pkg.version}.tgz`);
  const consumer = join(work, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "release-a-real", private: true, type: "module" }, null, 2),
  );
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarball,
      "@earendil-works/pi-coding-agent@0.84.2",
      "@earendil-works/pi-tui@0.84.2",
    ],
    { cwd: consumer, stdio: "inherit" },
  );
  const cli = join(consumer, "node_modules", ".bin", "kiro-fabric");
  const project = join(work, "project");
  mkdirSync(project);
  const install = JSON.parse(
    execFileSync(process.execPath, [cli, "install", "kiro", "--project-root", project, "--json"], {
      encoding: "utf8",
    }),
  );
  if (install.action !== "create") throw new Error(`install failed: ${JSON.stringify(install)}`);
  const doctor = JSON.parse(
    execFileSync(process.execPath, [cli, "doctor", "kiro", "--json"], { encoding: "utf8" }),
  );
  if (!doctor.ok || doctor.modelTurnsRequested !== 0 || doctor.nonBillable !== true) {
    throw new Error(`real doctor is not a clean non-billable pass: ${JSON.stringify(doctor)}`);
  }
  const removed = JSON.parse(
    execFileSync(process.execPath, [cli, "uninstall", "kiro", "--project-root", project, "--json"], {
      encoding: "utf8",
    }),
  );
  if (removed.action !== "remove") throw new Error(`uninstall failed: ${JSON.stringify(removed)}`);
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        nonBillable: true,
        modelTurnsRequested: 0,
        package: `${pkg.name}@${pkg.version}`,
        doctor,
        install,
        uninstall: removed,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
