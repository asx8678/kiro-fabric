#!/usr/bin/env node
// Setup script for Fabric Lite + Kiro CLI.
// Mirrors official pi-fabric script conventions: plain .mjs run via `node scripts/<name>.mjs`.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const args = process.argv.slice(2);

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(3);
}

function has(cmd) {
  const res =
    process.platform === "win32"
      ? spawnSync("where", [cmd], { stdio: "ignore" })
      : spawnSync("/bin/sh", ["-c", 'command -v "$1" >/dev/null 2>&1', "sh", cmd]);
  return res.status === 0;
}

function run(label, cmd, cmdArgs) {
  console.log(`==> ${label}`);
  const res = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

if (!has("pnpm")) fail("pnpm is required. Install it with: corepack enable");
if (!has("kiro-cli")) fail("kiro-cli was not found in PATH.");

run("Installing Fabric Lite dependencies", "pnpm", ["install", "--frozen-lockfile"]);
run("Building Fabric Lite", "pnpm", ["build"]);
run("Installing Kiro agents and project configuration", process.execPath, [
  path.join(root, "dist/cli/main.js"),
  "install-kiro",
  "--format",
  "json",
  ...args,
]);

// A dry run intentionally does not create agents, so doctor would report them missing.
if (args.includes("--dry-run")) {
  console.log("==> Dry run complete; no files were changed");
  process.exit(0);
}

run("Verifying installation", process.execPath, [
  path.join(root, "dist/cli/main.js"),
  "doctor",
  "--format",
  "json",
]);

console.log("");
console.log("Fabric Lite is ready. Launch it with:");
console.log("  kiro-cli --agent fabric-lite");
