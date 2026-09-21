import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildCompleteBundle, findReusableSourceBundle, sourceProvenance } from "./build-complete-bundle.mjs";
import { withInstallerArtifactLease } from "./installer-artifacts.mjs";
import { stageSourceBundle } from "./source-bundle-stage.mjs";
import { runManager, parseManagerArguments, checkKiro, InstallerError, presentManagerError, presentManagerResult, INSTALLER_BANNER } from "./install-manager.mjs";
import { configurePullHook } from "./source-pull-hook.mjs";
import { resolveKiroHome } from "./install-agent-user.mjs";
import { detectInstallerPlatform, assertUnprivilegedInstaller, compareVersions } from "./installer-platform.mjs";
import { planInstallationPreparation } from "./installer-home-preparation.mjs";
import { planShellIntegration } from "./installer-shell-integration.mjs";

export async function runSourceInstaller(args) {
  const json = args.includes("--json");
  let kiroHome, stage = "usage";
  /** @type {Record<string, any> | undefined} */
  let activationOutput;
  try {
    if (args.filter(arg => arg === "--source").length !== 1) throw new InstallerError("Source installation requires exactly one explicit --source", 2, "usage");
    const enableHook = args.includes("--enable-pull-hook");
    if (args.filter(arg => arg === "--enable-pull-hook").length > 1) throw new InstallerError("Duplicate --enable-pull-hook", 2, "usage");
    const argv = ["install", ...args.filter(arg => arg !== "--source" && arg !== "--enable-pull-hook")];
    const options = parseManagerArguments(argv);
    if (options.archive || options.version) throw new InstallerError("--source cannot be combined with --from-archive or --version", 2, "usage");
    if (options.help) return await runManager(argv);
    if (!options.dryRun && (!process.stdin.isTTY || options.json || options.nonInteractive) && !options.yes) throw new InstallerError("Noninteractive source installation requires --yes", 2, "usage");
    stage = "prerequisite";
    assertUnprivilegedInstaller(); detectInstallerPlatform();
    if (compareVersions(process.version.slice(1), "24.0.0") < 0) throw new InstallerError("Source mode requires Node >=24", 4, "prerequisite");
    const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
    kiroHome = resolveKiroHome(process.env, process.env.HOME, { ...(options.kiroHome ? { kiroHome: options.kiroHome } : {}), sourceRoot: root });
    if (options.dryRun) return await runManager(argv, { context: { kind: "bootstrap" }, sourceRoot: root, source: true });
    stage = "preparation";
    if (enableHook) configurePullHook(root, kiroHome, false);
    checkKiro();
    planInstallationPreparation(kiroHome, options);
    planShellIntegration(kiroHome, { disabled: options.noShellIntegration });
    if (!json) process.stderr.write(`${INSTALLER_BANNER}Preparing source bundle; the installed and verified target versions will be shown before activation.\n`);
    const outcome = await withInstallerArtifactLease(root, async () => {
      const before = sourceProvenance(root);
      stage = "cache-verification";
      if (options.verbose && !json) process.stderr.write("==> Verifying reusable source bundle\n");
      let bundle = await findReusableSourceBundle({ root });
      if (!bundle) {
        // The pin lives in package.json's packageManager field so the checkout,
        // the CI workflow and this prerequisite can never drift apart.
        const pinnedPnpm = /^pnpm@(\S+)$/u.exec(String(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).packageManager ?? ""))?.[1] ?? "11.20.0";
        const pnpm = spawnSync("pnpm", ["--version"], { cwd: root, encoding: "utf8", timeout: 10000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] });
        if (pnpm.error || pnpm.status !== 0 || pnpm.stdout.trim() !== pinnedPnpm) throw new InstallerError(`Source mode requires the pinned developer pnpm ${pinnedPnpm}`, 4, "prerequisite");
        stage = "build";
        if (options.verbose && !json) process.stderr.write("==> Building source bundle\n");
        for (const command of [["install", "--frozen-lockfile"], ["run", "build"]]) {
          if (!json) process.stderr.write(`Source build: pnpm ${command.join(" ")}${options.verbose ? " (streaming live output)" : ""}\n`);
          if (options.verbose) {
            const streamed = spawnSync("pnpm", command, { cwd: root, timeout: 600000, stdio: ["ignore", "inherit", "inherit"] });
            if (streamed.error || streamed.status !== 0) throw new InstallerError(`Source build failed: ${String(streamed.error?.message ?? `exit ${streamed.status ?? "unknown"}`)}; full output streamed above (--verbose)`, 4, "source-build-failed");
          } else {
            const result = spawnSync("pnpm", command, { cwd: root, encoding: "utf8", timeout: 600000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
            if (result.error || result.status !== 0) throw new InstallerError(`Source build failed: ${String(result.error?.message ?? "")}${(result.stdout + result.stderr).slice(-6000).replace(/[\u0000-\u001f\u007f]/gu, " ")}`, 4, "source-build-failed");
          }
        }
        stage = "packaging";
        if (options.verbose && !json) process.stderr.write("==> Packaging complete bundle\n");
        bundle = await buildCompleteBundle({ root, archive: false });
      } else if (!json) process.stderr.write("Reusing verified source bundle; dependency install, compilation and archiving skipped.\n");
      const after = sourceProvenance(root);
      if (before.sourceDigest !== after.sourceDigest || before.gitHead !== after.gitHead) throw new InstallerError("Source inputs changed during build/reuse; no installation attempted (checkout build outputs may remain)", 5, "conflict");
      stage = "activation";
      if (options.verbose && !json) process.stderr.write("==> Activating installation\n");
      // Keep the lease through final consumption. An in-home checkout's bundle
      // is copied to private external staging; only sourceRoot reaches backup.
      const temporary = root === kiroHome ? fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-source-activation-"))) : undefined;
      try {
        let sourceBundle = bundle.root;
        if (temporary) {
          fs.chmodSync(temporary, 0o700);
          sourceBundle = path.join(temporary, "bundle");
          await stageSourceBundle(bundle.root, sourceBundle);
        }
        return await runManager(argv, { context: { kind: "bootstrap" }, sourceBundle, sourceRoot: root, bannerShown: true, present: result => { activationOutput = result; },
          ...(enableHook ? { afterOperation: () => { try { configurePullHook(root, kiroHome, true); } catch (error) { throw new Error(`Installation completed but pull-hook setup failed: ${error.message}`); } } } : {}),
        });
      } finally {
        if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
      }
    });
    // Emit once, only after activation AND lease cleanup have finished.
    if (activationOutput) presentManagerResult(activationOutput, options);
    return outcome;
  } catch (error) {
    // Keep structured usage, prerequisite, lock, trust and activation failures.
    // Only failures from the actual build stage are classified as build failures.
    const classified = stage === "build" && !(error instanceof InstallerError) && !error.code && !error.recoveryRequired && !error.committed ? new InstallerError(error.message, 4, "source-build-failed") : error;
    classified.command = "install";
    if (activationOutput) Object.assign(classified, { committed: activationOutput.committed === true, recoveryRequired: true, operationCompleted: !activationOutput.error || activationOutput.operationCompleted === true, operationResult: activationOutput, configurationBackup: activationOutput.configurationBackup, installationChange: activationOutput.installationChange, homePreparation: activationOutput.homePreparation });
    return presentManagerError(classified, json, kiroHome);
  }
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = await runSourceInstaller(process.argv.slice(2));
