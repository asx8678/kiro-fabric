import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildCompleteBundle, sourceProvenance } from "./build-complete-bundle.mjs";
import { runManager, parseManagerArguments, checkKiro } from "./install-manager.mjs";
import { resolveKiroHome } from "./install-agent-user.mjs";
import { detectInstallerPlatform, assertUnprivilegedInstaller, compareVersions } from "./installer-platform.mjs";

const args = process.argv.slice(2), json = args.includes("--json");
try {
  if (args.filter(arg => arg === "--source").length !== 1) throw new Error("Source installation requires exactly one explicit --source");
  const argv = ["install", ...args.filter(arg => arg !== "--source")];
  const options = parseManagerArguments(argv);
  if (options.archive || options.version) throw new Error("--source cannot be combined with --from-archive or --version");
  assertUnprivilegedInstaller(); detectInstallerPlatform();
  if (compareVersions(process.version.slice(1), "24.0.0") < 0) throw new Error("Source mode requires Node >=24");
  const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  resolveKiroHome(process.env, process.env.HOME, { ...(options.kiroHome ? { kiroHome: options.kiroHome } : {}), packageRoot: root });
  if ((!process.stdin.isTTY || options.json || options.nonInteractive) && !options.yes) throw new Error("Noninteractive source installation requires --yes");
  checkKiro();
  const pnpm = spawnSync("pnpm", ["--version"], { cwd: root, encoding: "utf8", timeout: 10000, maxBuffer: 4096 });
  if (pnpm.status !== 0 || pnpm.stdout.trim() !== "11.20.0") throw new Error("Source mode requires the pinned developer pnpm 11.20.0");
  const before = sourceProvenance(root);
  for (const command of [["install", "--frozen-lockfile"], ["run", "build"]]) {
    if (!json) process.stderr.write(`Source build: pnpm ${command.join(" ")}\n`);
    const result = spawnSync("pnpm", command, { cwd: root, encoding: "utf8", timeout: 600000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    if (result.error || result.status !== 0) throw new Error(`Source build failed: ${(result.stderr + result.stdout).slice(-6000).replace(/[\u0000-\u001f\u007f]/gu, " ")}`);
  }
  const after = sourceProvenance(root);
  if (before.sourceDigest !== after.sourceDigest || before.gitHead !== after.gitHead) throw new Error("Source inputs changed during build; no installation attempted");
  const bundle = await buildCompleteBundle({ root });
  process.exitCode = await runManager(argv, { context: { kind: "bootstrap" }, sourceBundle: bundle.root });
} catch (error) {
  const message = String(error.message).replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 6500);
  if (json) process.stdout.write(`${JSON.stringify({ schemaVersion: 1, command: "install", outcome: "source-build-failed", error: message, exitCode: 4 })}\n`);
  else process.stderr.write(`Kiro Fabric: ${message}\n`);
  process.exitCode = 4;
}
