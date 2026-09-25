// Inert helpers for qualification-safety cases. Retained fixtures only.
//
// The shim is a task-owned local executable that stands in for a real client:
// it only writes inside the probe's private scope, never reads credentials and
// never contacts a network. Nothing here deletes fixtures or spawns kiro-cli.
import fs from "node:fs";
import path from "node:path";

const PROBE = "scripts/fovea-capability-probe.mjs";

/** @param {string} parent @param {string} label */
export function privateDir(parent, label) {
  const directory = fs.mkdtempSync(path.join(parent, label + "-"));
  fs.chmodSync(directory, 0o700);
  return directory;
}

/** @param {string} parent @param {string} label @param {string} contents */
export function writeOwnerExecutable(parent, label, contents) {
  const file = path.join(parent, label);
  fs.writeFileSync(file, contents, { mode: 0o700 });
  return file;
}

/**
 * A Node shim standing in for kiro-cli. It records its cwd and environment and
 * creates repository metadata inside the probe's scope before answering.
 * @param {string} nodePath @param {"success"|"failure"} mode
 */
export function kiroCliShim(nodePath, mode) {
  return `#!${nodePath}
import fs from "node:fs";
import path from "node:path";
const home = process.env.KIRO_HOME;
const git = path.join(home, "child-repo", ".git");
fs.mkdirSync(path.join(git, "refs", "heads"), { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(git, "config"), "[core]\\n\\trepositoryformatversion = 0\\n", { mode: 0o600 });
fs.writeFileSync(path.join(git, "HEAD"), "ref: refs/heads/main\\n", { mode: 0o600 });
fs.writeFileSync(path.join(home, "shim-env.json"), JSON.stringify(process.env), { mode: 0o600 });
fs.writeFileSync(path.join(home, "shim-cwd.txt"), process.cwd(), { mode: 0o600 });
const args = process.argv.slice(2).join(" ");
if (${JSON.stringify(mode)} === "failure") { process.stderr.write("inert shim failure\\n"); process.exit(3); }
if (args.includes("--version")) process.stdout.write("kiro-cli 2.22.0\\n");
else if (args.includes("--help")) process.stdout.write("--v3 --agent --output-format --require-mcp-startup --resume --resume-id --list-sessions --format\\n");
else process.stdout.write("kiro-cli 2.22.0\\n");
`;
}

/** @param {any} context @param {string[]} args @param {Record<string,string>} env */
export function runProbe(context, args, env) {
  const result = context.spawn(process.execPath, [path.join(context.root, PROBE), ...args], { cwd: context.root, env, timeoutMs: 30000 });
  if (result.spawnError) throw new Error("probe spawn failed: " + result.spawnError);
  return result;
}

/** @param {any} result */
export function probeReport(result) {
  return JSON.parse(result.stdout);
}
