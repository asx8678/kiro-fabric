#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const cwd = fs.realpathSync(process.cwd());
if (cwd !== root) {
  throw new Error(`kiro-fabric-dev must start from repository root ${root}; observed ${cwd}`);
}

const identity = fs.statSync(root, { bigint: true });
const entry = path.join(root, "dist", "kiro", "mcp-entry.js");
const entryStats = fs.lstatSync(entry);
if (!entryStats.isFile() || entryStats.isSymbolicLink()) {
  throw new Error(`kiro-fabric-dev requires a fresh regular build artifact at ${entry}`);
}

// Selecting the repository-local development agent is the explicit trusted
// opt-in for shell execution. Derive confinement from the canonical checkout
// at launch so the checked-in profile never embeds machine-specific identity.
delete process.env.KIRO_FABRIC_INTEGRATION;
delete process.env.KIRO_FABRIC_ENABLE_SUBAGENTS;
delete process.env.KIRO_FABRIC_ALLOW_TOOLS;
Object.assign(process.env, {
  KIRO_FABRIC_HOST: "kiro-v3",
  KIRO_FABRIC_PROFILE_KIND: "managed-main",
  KIRO_FABRIC_PROJECT_ROOT: root,
  KIRO_FABRIC_PROJECT_ROOT_DEV: String(identity.dev),
  KIRO_FABRIC_PROJECT_ROOT_INO: String(identity.ino),
  KIRO_FABRIC_ENFORCE_PROJECT_ROOT: "1",
  KIRO_FABRIC_ALLOW_SHELL: "1",
});

const { runKiroMcpProcess } = await import(pathToFileURL(entry).href);
process.exitCode = await runKiroMcpProcess();
