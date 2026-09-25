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
import { STAGING_PREFIX, identifyStagingRoot, removeSourceActivationStaging } from "./source-staging-cleanup.mjs";

/** @type {Record<string, any>} */
const defaultDependencies = Object.freeze({
  env: process.env,
  userHome: process.env.HOME,
  isInteractive: () => Boolean(process.stdin.isTTY),
  nodeVersion: process.version,
  stderr: (/** @type {string} */ text) => { process.stderr.write(text); },
  spawnCommand: spawnSync,
  makeTemp: (/** @type {string} */ prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
  tempRoot: () => os.tmpdir(),
  identifyStaging: identifyStagingRoot,
  removeStaging: removeSourceActivationStaging,
  assertUnprivileged: assertUnprivilegedInstaller,
  detectPlatform: detectInstallerPlatform,
  kiroCheck: checkKiro,
  planPreparation: planInstallationPreparation,
  planShell: planShellIntegration,
  resolveHome: resolveKiroHome,
  lease: withInstallerArtifactLease,
  findBundle: findReusableSourceBundle,
  buildBundle: buildCompleteBundle,
  provenance: sourceProvenance,
  stageBundle: stageSourceBundle,
  configureHook: configurePullHook,
  parseArguments: parseManagerArguments,
  manager: runManager,
  presentResult: presentManagerResult,
  presentError: presentManagerError,
});

/**
 * Test-only dependency injection. The CLI below and install.sh never pass
 * overrides, and unknown keys are rejected so a fixture cannot silently stub an
 * unintended seam. Production admission and trust rules stay load-bearing.
 * @param {Record<string, any>} overrides
 */
function mergeDependencies(overrides) {
  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(defaultDependencies, key)) throw new Error("Unknown dependency override: " + key);
  }
  return { ...defaultDependencies, ...overrides };
}

/**
 * @param {string[]} args
 * @param {Record<string, any>} [overrides]
 */
export async function runSourceInstaller(args, overrides = {}) {
  const deps = mergeDependencies(overrides);
  const json = args.includes("--json");
  let kiroHome, stage = "usage";
  /** @type {Record<string, any> | undefined} */
  let activationOutput;
  try {
    if (args.filter(arg => arg === "--source").length !== 1) throw new InstallerError("Source installation requires exactly one explicit --source", 2, "usage");
    const enableHook = args.includes("--enable-pull-hook");
    if (args.filter(arg => arg === "--enable-pull-hook").length > 1) throw new InstallerError("Duplicate --enable-pull-hook", 2, "usage");
    const argv = ["install", ...args.filter(arg => arg !== "--source" && arg !== "--enable-pull-hook")];
    const options = deps.parseArguments(argv);
    // Source installation is also the upgrade path. Its confirmation covers
    // replacing an owned legacy profile after backup; unowned/modified profiles
    // still fail the manager's ownership and checksum checks.
    if (!options.migratePiFabric) { options.migratePiFabric = true; argv.push("--migrate-pi-fabric"); }
    if (options.archive || options.version) throw new InstallerError("--source cannot be combined with --from-archive or --version", 2, "usage");
    if (options.help) return await deps.manager(argv);
    if (!options.dryRun && (!deps.isInteractive() || options.json || options.nonInteractive) && !options.yes) throw new InstallerError("Noninteractive source installation requires --yes", 2, "usage");
    stage = "prerequisite";
    deps.assertUnprivileged(); deps.detectPlatform();
    if (compareVersions(deps.nodeVersion.slice(1), "24.0.0") < 0) throw new InstallerError("Source mode requires Node >=24", 4, "prerequisite");
    const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
    kiroHome = deps.resolveHome(deps.env, deps.userHome, { ...(options.kiroHome ? { kiroHome: options.kiroHome } : {}), sourceRoot: root });
    if (options.dryRun) return await deps.manager(argv, { context: { kind: "bootstrap" }, sourceRoot: root, source: true });
    stage = "preparation";
    if (enableHook) deps.configureHook(root, kiroHome, false);
    deps.kiroCheck();
    deps.planPreparation(kiroHome, options);
    deps.planShell(kiroHome, { disabled: options.noShellIntegration });
    if (!json) deps.stderr(`${INSTALLER_BANNER}Preparing source bundle; the installed and verified target versions will be shown before activation.\n`);
    const outcome = await deps.lease(root, async () => {
      const before = deps.provenance(root);
      stage = "cache-verification";
      if (options.verbose && !json) deps.stderr("==> Verifying reusable source bundle\n");
      let bundle = await deps.findBundle({ root });
      if (!bundle) {
        // The pin lives in package.json's packageManager field so the checkout,
        // the CI workflow and this prerequisite can never drift apart.
        const pinnedPnpm = /^pnpm@(\S+)$/u.exec(String(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).packageManager ?? ""))?.[1] ?? "11.20.0";
        const pnpm = deps.spawnCommand("pnpm", ["--version"], { cwd: root, encoding: "utf8", timeout: 10000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] });
        if (pnpm.error || pnpm.status !== 0 || pnpm.stdout.trim() !== pinnedPnpm) throw new InstallerError(`Source mode requires the pinned developer pnpm ${pinnedPnpm}`, 4, "prerequisite");
        stage = "build";
        if (options.verbose && !json) deps.stderr("==> Building source bundle\n");
        for (const command of [["install", "--frozen-lockfile"], ["run", "build"]]) {
          if (!json) deps.stderr(`Source build: pnpm ${command.join(" ")}${options.verbose ? " (streaming live output)" : ""}\n`);
          if (options.verbose) {
            const streamed = deps.spawnCommand("pnpm", command, { cwd: root, timeout: 600000, stdio: ["ignore", json ? 2 : "inherit", "inherit"] });
            if (streamed.error || streamed.status !== 0) throw new InstallerError(`Source build failed: ${String(streamed.error?.message ?? `exit ${streamed.status ?? "unknown"}`)}; full output streamed above (--verbose)`, 4, "source-build-failed");
          } else {
            const result = deps.spawnCommand("pnpm", command, { cwd: root, encoding: "utf8", timeout: 600000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
            if (result.error || result.status !== 0) throw new InstallerError(`Source build failed: ${String(result.error?.message ?? "")}${(result.stdout + result.stderr).slice(-6000).replace(/[\u0000-\u001f\u007f]/gu, " ")}`, 4, "source-build-failed");
          }
        }
        stage = "packaging";
        if (options.verbose && !json) deps.stderr("==> Packaging complete bundle\n");
        bundle = await deps.buildBundle({ root, archive: false });
      } else if (!json) deps.stderr("Reusing verified source bundle; dependency install, compilation and archiving skipped.\n");
      const after = deps.provenance(root);
      if (before.sourceDigest !== after.sourceDigest || before.gitHead !== after.gitHead) throw new InstallerError("Source inputs changed during build/reuse; no installation attempted (checkout build outputs may remain)", 5, "conflict");
      stage = "activation";
      if (options.verbose && !json) deps.stderr("==> Activating installation\n");
      // Keep the lease through final consumption. An in-home checkout's bundle
      // is copied to private external staging; only sourceRoot reaches backup.
      // The staging root is created 0700, identified by dev/ino, and removed
      // only through the guarded helper: unknown, symlinked or
      // repository-bearing contents are retained and reported instead of being
      // recursively deleted.
      const stagingRoot = root === kiroHome ? deps.makeTemp(STAGING_PREFIX) : undefined;
      const staging = stagingRoot === undefined
        ? undefined
        : { path: fs.realpathSync(stagingRoot), identity: deps.identifyStaging(stagingRoot) };
      try {
        let sourceBundle = bundle.root;
        if (staging) {
          fs.chmodSync(staging.path, 0o700);
          sourceBundle = path.join(staging.path, "bundle");
          await deps.stageBundle(bundle.root, sourceBundle);
        }
        return await deps.manager(argv, { context: { kind: "bootstrap" }, sourceBundle, sourceRoot: root, bannerShown: true, present: result => { activationOutput = result; },
          ...(enableHook ? { afterOperation: () => { try { deps.configureHook(root, kiroHome, true); } catch (error) { throw new Error(`Installation completed but pull-hook setup failed: ${error.message}`); } } } : {}),
        });
      } finally {
        if (staging) {
          const cleanup = deps.removeStaging({ path: staging.path, identity: staging.identity, tmpRoot: deps.tempRoot() }) ?? {};
          if (cleanup.removed !== true) deps.stderr(`Retained private source activation staging at ${staging.path} (${cleanup.reason ?? "reason unavailable"}); inspect before removing.\n`);
        }
      }
    });
    // Emit once, only after activation AND lease cleanup have finished.
    if (activationOutput) deps.presentResult(activationOutput, options);
    return outcome;
  } catch (error) {
    // Keep structured usage, prerequisite, lock, trust and activation failures.
    // Only failures from the actual build stage are classified as build failures.
    const classified = stage === "build" && !(error instanceof InstallerError) && !error.code && !error.recoveryRequired && !error.committed ? new InstallerError(error.message, 4, "source-build-failed") : error;
    classified.command = "install";
    if (activationOutput) Object.assign(classified, { committed: activationOutput.committed === true, recoveryRequired: true, operationCompleted: !activationOutput.error || activationOutput.operationCompleted === true, operationResult: activationOutput, configurationBackup: activationOutput.configurationBackup, installationChange: activationOutput.installationChange, homePreparation: activationOutput.homePreparation });
    return deps.presentError(classified, json, kiroHome);
  }
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = await runSourceInstaller(process.argv.slice(2));
