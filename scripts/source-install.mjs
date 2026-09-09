import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildCompleteBundle, sourceProvenance } from "./build-complete-bundle.mjs";
import { runManager, parseManagerArguments, checkKiro } from "./install-manager.mjs";
import { configurePullHook } from "./source-pull-hook.mjs";
import { resolveKiroHome } from "./install-agent-user.mjs";
import { detectInstallerPlatform, assertUnprivilegedInstaller, compareVersions } from "./installer-platform.mjs";
import { planInstallationPreparation } from "./installer-home-preparation.mjs";
import { planShellIntegration } from "./installer-shell-integration.mjs";

const args = process.argv.slice(2), json = args.includes("--json");
try {
  if (args.filter(arg => arg === "--source").length !== 1) throw new Error("Source installation requires exactly one explicit --source");
  const enableHook = args.includes("--enable-pull-hook");
  if (args.filter(arg => arg === "--enable-pull-hook").length > 1) throw new Error("Duplicate --enable-pull-hook");
  const argv = ["install", ...args.filter(arg => arg !== "--source" && arg !== "--enable-pull-hook")];
  const options = parseManagerArguments(argv);
  if (options.archive || options.version) throw new Error("--source cannot be combined with --from-archive or --version");
  assertUnprivilegedInstaller(); detectInstallerPlatform();
  if (compareVersions(process.version.slice(1), "24.0.0") < 0) throw new Error("Source mode requires Node >=24");
  const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const kiroHome = resolveKiroHome(process.env, process.env.HOME, { ...(options.kiroHome ? { kiroHome: options.kiroHome } : {}), sourceRoot: root });
  if (enableHook) configurePullHook(root, kiroHome, false);
  if ((!process.stdin.isTTY || options.json || options.nonInteractive) && !options.yes) throw new Error("Noninteractive source installation requires --yes");
  checkKiro();
  planInstallationPreparation(kiroHome, options);
  planShellIntegration(kiroHome, { disabled: options.noShellIntegration });
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
  // Preserve the managed installer's incoming-bundle overlap invariant. Source
  // acquisition may live in the home, but candidate input must remain outside it.
  const temporary = root === kiroHome ? fs.mkdtempSync(path.join(os.tmpdir(), "fabric-source-activation-")) : undefined;
  try {
    let sourceBundle = bundle.root;
    if (temporary) {
      fs.chmodSync(temporary, 0o700);
      sourceBundle = path.join(temporary, "bundle");
      fs.cpSync(bundle.root, sourceBundle, { recursive: true, errorOnExist: true, force: false });
    }
    process.exitCode = await runManager(argv, { context: { kind: "bootstrap" }, sourceBundle });
  } finally {
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  }
  if (process.exitCode === 0 && enableHook) {
    try { configurePullHook(root, kiroHome, true); }
    catch (error) {
      // Activation has already succeeded: do not mislabel this as a build failure.
      process.stderr.write(`Kiro Fabric: installation succeeded but pull-hook setup failed: ${String(error.message).replace(/[\u0000-\u001f\u007f]/gu, " ")}\n`);
      process.exitCode = 7;
    }
  }
} catch (error) {
  const message = String(error.message).replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 6500);
  if (json) process.stdout.write(`${JSON.stringify({ schemaVersion: 1, command: "install", outcome: "source-build-failed", error: message, exitCode: 4 })}\n`);
  else process.stderr.write(`Kiro Fabric: ${message}\n`);
  process.exitCode = 4;
}
