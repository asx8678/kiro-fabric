import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { resolveKiroHome, installerSafety } from "./install-agent-user.mjs";
import { validateBundle, sha256 } from "./bundle-contract.mjs";
import { extractBundleArchive } from "./bundle-archive.mjs";
import { PRODUCTION_TRUST_ROOT, verifyReleaseSidecarsCaptured } from "./release-trust.mjs";
import { discoverRelease } from "./release-download.mjs";
import { installCompleteGeneration, inspectCompleteInstallation, rollbackCompleteGeneration, retireCompleteInstallation } from "./managed-installation.mjs";
import { inspectInstallationLock, inspectInstallationProcesses } from "./installer-lock.mjs";
import { detectInstallerPlatform, assertUnprivilegedInstaller, compareVersions } from "./installer-platform.mjs";
import { createConfigurationBackup, restoreConfigurationBackup } from "./installer-configuration-backup.mjs";
import { smokeCandidate } from "./installer-smoke.mjs";
import { planInstallationPreparation, applyInstallationPermissions, preservePiFabricProfile } from "./installer-home-preparation.mjs";
import { planShellIntegration, applyShellIntegration } from "./installer-shell-integration.mjs";
import { prepareLaunchProfile } from "./launch-profile.mjs";

import { InstallerError, display, shellQuote, MANAGER_COMMANDS, parseManagerArguments, validateCommandOptions, managerHelp, formatManagerHelp } from "./installer-cli-contract.mjs";
import { installedIdentity, installationGuidance, inspectSourceComparison, previewManagerOperation } from "./installer-diagnostics.mjs";
export { InstallerError, shellQuote, parseManagerArguments } from "./installer-cli-contract.mjs";

export const INSTALLER_BANNER = [
  "+--------------------------------------+",
  "|             KIRO FABRIC              |",
  "|      Native agent + orchestration    |",
  "+--------------------------------------+",
].join("\n") + "\n";

function installedVersionLabel(identity) {
  if (identity?.version) return `${identity.version} (${identity.status})`;
  if (identity?.status === "absent") return "Not installed (fresh installation)";
  if (identity?.status === "legacy") return "Legacy installation detected; version unknown";
  return `Version unknown (${identity?.status ?? "unknown"})`;
}

function versionChange(previous, bundle) {
  let action;
  if (previous.status === "absent") action = "Install new version";
  else if (previous.status === "retired") action = "Reinstall retired installation";
  else if (previous.generation === bundle.digest) action = "Already installed; no new generation needed";
  else if (!previous.version) action = "Replace existing installation (previous version unknown)";
  else {
    const comparison = compareVersions(bundle.version, previous.version);
    action = comparison > 0 ? "Upgrade to newer version" : comparison < 0 ? "Install older version (downgrade)" : "Replace same-version generation";
  }
  return { previous, target: { version: bundle.version, generation: bundle.digest, node: bundle.manifest.tools.node.version, ripgrep: bundle.manifest.tools.rg.version }, action };
}

function formatVersionChange(change) {
  return `Previously installed: ${display(installedVersionLabel(change.previous))}\nTarget version: ${display(change.target.version)} (verified bundle)\nChange: ${display(change.action)}\nPrivate tools: Node ${display(change.target.node)}, ripgrep ${display(change.target.ripgrep)}\n`;
}

export function managerContext(script = fileURLToPath(import.meta.url)) {
  const self = fs.realpathSync(script), generation = path.dirname(path.dirname(self)), base = path.dirname(path.dirname(generation));
  if (path.basename(path.dirname(self)) === "manager" && /^[a-f0-9]{64}$/u.test(path.basename(generation)) && path.basename(path.dirname(generation)) === "runtime" && path.basename(base) === "kiro-fabric") {
    return { kind: "installed", self, generation, base, kiroHome: path.dirname(base) };
  }
  return { kind: "bootstrap", self, generation: undefined, base: undefined, kiroHome: undefined };
}
export function selectedHome(options, context, env = process.env, home = os.homedir()) {
  if (context.kind === "installed") {
    if (options.kiroHome !== undefined && !path.isAbsolute(options.kiroHome)) throw new InstallerError("--kiro-home must be absolute", 2, "usage");
    if (options.kiroHome !== undefined && path.resolve(options.kiroHome) !== context.kiroHome) throw new InstallerError("Installed launcher cannot manage another Kiro home", 5);
    return { path: resolveKiroHome({}, path.dirname(context.kiroHome), { kiroHome: context.kiroHome }), source: "installed launcher" };
  }
  const selected = resolveKiroHome(env, home, options.kiroHome === undefined ? {} : { kiroHome: options.kiroHome });
  return { path: selected, source: options.kiroHome !== undefined ? "--kiro-home" : Object.hasOwn(env, "KIRO_HOME") ? "KIRO_HOME" : "current user home" };
}
export function trustedMacApplications(directory, stat, platform = process.platform) {
  // macOS administrators already control installed applications. Do not extend
  // this exception to descendants, other groups, or world-writable paths.
  return platform === "darwin" && directory === "/Applications" && stat.uid === 0 && stat.gid === 80 && (stat.mode & 0o7777) === 0o775;
}
function assertKiroExecutable(executable) {
  const uid = process.getuid?.(), stat = fs.lstatSync(executable);
  // Kiro's externally managed binaries may have hard-link aliases. Fabric only
  // executes them; ownership and write permissions protect the shared inode.
  const reasons = [];
  if (!stat.isFile()) reasons.push("not a regular file");
  if (stat.isSymbolicLink()) reasons.push("symbolic link");
  if (uid !== undefined && stat.uid !== uid && stat.uid !== 0) reasons.push("owner must be current user or root");
  if (stat.mode & 0o020) reasons.push("group-writable");
  if (stat.mode & 0o002) reasons.push("world-writable");
  if (!(stat.mode & 0o111)) reasons.push("no execute bits");
  if (reasons.length) throw new InstallerError(`Unsafe Kiro CLI executable: ${display(executable)}; ${reasons.join(", ")}`, 4, "prerequisite");
  let directory = path.dirname(executable);
  for (;;) {
    const parent = fs.lstatSync(directory);
    // Root-owned sticky temporary ancestry protects the private fixture child.
    const protectedSticky = parent.uid === 0 && (parent.mode & 0o1000) !== 0;
    if (!parent.isDirectory() || parent.isSymbolicLink() || (uid !== undefined && parent.uid !== uid && parent.uid !== 0) || ((parent.mode & 0o022) !== 0 && !protectedSticky && !trustedMacApplications(directory, parent))) throw new InstallerError(`Unsafe Kiro CLI directory ancestry: ${display(directory)}`, 4, "prerequisite");
    const next = path.dirname(directory); if (next === directory) break; directory = next;
  }
}
export function findKiro(env = process.env) {
  for (const directory of (env.PATH ?? "").split(path.delimiter).slice(0, 128)) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, "kiro-cli");
    try {
      const real = fs.realpathSync(candidate);
      assertKiroExecutable(real);
      return real;
    } catch (error) { if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error; }
  }
  throw new InstallerError("Kiro CLI is missing. Install the official Kiro client; Fabric does not install or authenticate it.", 4, "prerequisite");
}
export function checkKiro(env = process.env) {
  const executable = findKiro(env);
  const sibling = path.join(path.dirname(executable), "kiro-cli-chat");
  if (installerSafety.lstat(sibling)) {
    try { assertKiroExecutable(fs.realpathSync(sibling)); }
    catch (error) { throw new InstallerError(`Unsafe or unavailable Kiro CLI sibling executable: ${display(sibling)}; ${display(error.message)}`, 4, "prerequisite"); }
  }
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-client-preflight-")));
  fs.chmodSync(temporary, 0o700);
  try {
    // Official Kiro dispatches some subcommands to its sibling kiro-cli-chat.
    // Keep that explicit installation directory, not the caller's ambient PATH.
    const probeEnv = { HOME: temporary, KIRO_HOME: path.join(temporary, ".kiro"), PATH: [path.dirname(executable), "/usr/bin", "/bin"].join(path.delimiter), LANG: "C", LC_ALL: "C" };
    const run = args => {
      const result = spawnSync(executable, args, { env: probeEnv, cwd: temporary, encoding: "utf8", timeout: 5000, maxBuffer: 16384, stdio: ["ignore", "pipe", "pipe"] });
      if (result.error || result.status !== 0) throw new InstallerError("Kiro CLI help/version preflight failed; authentication was not attempted", 4, "prerequisite");
      return result.stdout + result.stderr;
    };
    const version = /kiro-cli\s+(\d+\.\d+\.\d+)/u.exec(run(["--version"]))?.[1];
    if (!version || compareVersions(version, "2.21.1") < 0 || !run(["agent", "validate", "--help"]).includes("--path")) throw new InstallerError("Unsupported Kiro client; expected >=2.21.1 and agent validate --path", 4, "prerequisite");
    return { executable, version, authentication: "NOT TESTED", resourceLoading: "NOT TESTED" };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
async function validateOwnManager(context) {
  if (context.kind !== "installed") return;
  const bundle = await validateBundle(context.generation);
  if (bundle.digest !== path.basename(context.generation) || fs.realpathSync(process.execPath) !== path.join(context.generation, "tools", "node") || process.version !== `v${bundle.manifest.tools.node.version}`) throw new InstallerError("Installed manager/private Node generation mismatch");
  if (sha256(fs.readFileSync(context.self)) !== bundle.inventory.find(entry => entry.path === "manager/install-manager.mjs")?.sha256) throw new InstallerError("Installed management code changed");
}
const currentOwner = async home => {
  const manifest = path.join(home, "kiro-fabric", "install-owner.json");
  if (!fs.existsSync(manifest)) return undefined;
  installerSafety.assertSafeFile(manifest, "ownership manifest");
  const stat = fs.statSync(manifest); if (stat.size > 2 * 1024 * 1024) throw new InstallerError("Ownership manifest exceeds bound");
  return JSON.parse(fs.readFileSync(manifest, "utf8"));
};
export async function doctorInstallation(home, env = process.env, { sourceRoot = undefined } = {}) {
  const checks = [];
  let installationStatus = "unknown", sourceComparison;
  /** @type {Awaited<ReturnType<typeof inspectCompleteInstallation>> | undefined} */
  let installation;
  const check = async (id, action) => { try { const detail = await action(); checks.push({ id, status: "PASS", detail }); } catch (error) { if (id === "installation" && managerErrorResult(error).exitCode === 7) installationStatus = "recovery-required"; checks.push({ id, status: "FAIL", detail: display(error.message) }); } };
  await check("home", () => resolveKiroHome({}, path.dirname(home), { kiroHome: home }));
  await check("installation", async () => {
    const result = await inspectCompleteInstallation(home, { verifyGenerations: true });
    installation = result; installationStatus = result.status;
    if (result.status === "recovery-required") throw new Error("Interrupted installation requires recovery; journal/candidate evidence is preserved");
    if (result.status === "legacy") throw new Error("Legacy installation requires explicit verified migration");
    if (!result.owner) throw new Error("Fabric is not installed");
    return result.owner.status;
  });
  checks.push({ id: "transaction-journal", status: installationStatus === "recovery-required" ? "FAIL" : installationStatus === "unknown" ? "NOT TESTED" : "PASS", detail: installationStatus === "recovery-required" ? "Pending transaction evidence; no replay attempted" : installationStatus === "unknown" ? "Installation evidence could not be verified" : "No pending transaction journal" });
  /** @type {import("./installer-lock.mjs").InstallationLockInspection} */
  const lock = fs.existsSync(path.join(home, "kiro-fabric")) ? inspectInstallationLock(path.join(home, "kiro-fabric")) : { status: "absent", available: true };
  checks.push({ id: "transaction-lock", status: lock.status === "absent" ? "PASS" : lock.status === "busy" ? "WARNING" : "FAIL", detail: lock.reason ?? (lock.status === "stale" ? "Dead installation lock; a subsequent explicit mutation may recover it after verification. Doctor never replays transactions." : lock.status) });
  if (["stale", "recovery-required", "unsupported"].includes(lock.status)) installationStatus = "recovery-required";
  checks.push({ id: "signed-distribution", status: PRODUCTION_TRUST_ROOT ? "NOT TESTED" : "WARNING", detail: PRODUCTION_TRUST_ROOT ? "Configured trust root is not exact-artifact signature or native-client qualification evidence" : "Production trust root is absent; signed install/update distribution is BLOCKED. Local source builds are not signed releases." });
  await check("kiro-cli", () => checkKiro(env));
  const owner = installation?.owner;
  if (sourceRoot !== undefined) await check("source-comparison", () => {
    sourceComparison = inspectSourceComparison(home, sourceRoot, installation);
    if (sourceComparison.source.status !== "observed" || sourceComparison.build.status !== "verified-current" || Object.values(sourceComparison.comparisons).includes("different")) throw new Error(`Source/build comparison needs attention: ${JSON.stringify(sourceComparison.comparisons)}; ${sourceComparison.source.error ?? sourceComparison.build.error ?? "installed identity differs"}`);
    return sourceComparison.comparisons;
  });
  if (owner?.schemaVersion === 3 && checks.some(check => check.id === "installation" && check.status === "PASS")) {
    for (const tool of ["node", "rg"]) await check(`private-${tool}`, () => {
      const executable = path.join(home, "kiro-fabric", "runtime", owner.currentRuntime, "tools", tool);
      const result = spawnSync(executable, tool === "node" ? ["--version"] : ["--no-config", "--version"], { env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, encoding: "utf8", timeout: 5000, maxBuffer: 4096 });
      if (result.error || result.status !== 0) throw new Error(`Private ${tool} version check failed`);
      return display(result.stdout.trim());
    });
  }
  for (const id of ["authenticated-session", "client-tool-filtering", "resource-loading", "elicitation", "compaction-resume", "downstream-mcp"]) checks.push({ id, status: "NOT TESTED", detail: "Offline doctor does not authenticate or contact configured MCP servers" });
  return { outcome: installationStatus === "recovery-required" ? "recovery-required" : checks.some(check => check.status === "FAIL") ? "diagnostic-failure" : owner?.status === "retired" ? "retired" : "healthy", checks, ...(sourceComparison ? { sourceComparison } : {}), ...installationGuidance(home, installation), warnings: owner?.legacy ? ["Legacy runtimes/resources retained; legacy startup is not fenced"] : [] };
}
function logOutcome(home, result) {
  const base = path.join(home, "kiro-fabric");
  if (!fs.existsSync(base)) return;
  installerSafety.assertSafeDirectory(base, { private: true });
  const directory = path.join(base, "logs");
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
  installerSafety.assertSafeDirectory(directory, { private: true });
  const file = path.join(directory, "installer.log");
  if (fs.existsSync(file)) {
    installerSafety.assertSafeFile(file, "installer log");
    if (fs.statSync(file).size > 64 * 1024) throw new Error("Installer log exceeds bound; preserve for inspection");
  }
  const line = JSON.stringify({ time: new Date().toISOString(), command: result.command, outcome: result.outcome, generation: result.generation ?? null }) + "\n";
  const previous = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  installerSafety.atomicWrite(file, Buffer.from((previous + line).slice(-32768)));
}
const ask = async (question) => {
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try { return (await terminal.question(question)).trim().toLowerCase(); } finally { terminal.close(); }
};
export async function runManager(argv, internal = {}) {
  const emit = internal.present ?? presentManagerResult;
  let options;
  try { options = parseManagerArguments(argv); }
  catch (error) { const result = managerErrorResult(error); emit(result, { json: argv.includes("--json") }); return result.exitCode; }
  if (options.help) { emit(managerHelp(options.command), options); return 0; }
  const context = internal.context ?? managerContext();
  let home, homePreparation, configurationBackup, operationResult, installationChange;
  let bannerShown = internal.bannerShown === true;
  const banner = () => { if (!options.json && !bannerShown) { process.stderr.write(INSTALLER_BANNER); bannerShown = true; } };
  try {
    assertUnprivilegedInstaller();
    const platform = detectInstallerPlatform();
    const selected = selectedHome(options, context); home = selected.path;
    await validateOwnManager(context);
    if (!options.command) {
      if (!process.stdin.isTTY || !process.stdout.isTTY || options.json || options.nonInteractive || options.dryRun) throw new InstallerError("Noninteractive use requires an explicit command", 2, "usage");
      const owner = await currentOwner(home);
      banner();
      process.stderr.write(`Kiro Fabric\nSystem        ${platform.target}\nKiro home     ${display(home)} (${selected.source})\nInstallation  ${owner?.status ?? (owner ? "legacy" : "Not installed")}\n`);
      const choice = await ask(owner?.status !== "retired" && owner ? "[U]pdate, [C]heck, [R]ollback, [X]Uninstall, [E]xit [U]: " : "Install Fabric? [Y/n]: ");
      if (["e", "n", "no"].includes(choice)) throw new InstallerError("Cancelled before installation preparation", 3, "cancelled");
      options.command = owner && owner.status !== "retired" ? ({ "": "update", u: "update", c: "doctor", r: "rollback", x: "uninstall" })[choice] : ["", "y", "yes"].includes(choice) ? "install" : undefined;
      if (!options.command) throw new InstallerError("Invalid menu choice", 2, "usage");
      validateCommandOptions(options);
    }
    const spec = MANAGER_COMMANDS[options.command];
    if (options.command === "doctor") {
      const result = { schemaVersion: 1, command: "doctor", kiroHome: selected, platform, ...(await doctorInstallation(home, process.env, { sourceRoot: options.sourceRoot })) };
      const code = result.outcome === "recovery-required" ? 7 : result.checks.some(check => check.status === "FAIL") ? 5 : 0;
      emit({ ...result, exitCode: code }, options); return code;
    }
    if (options.command === "start") {
      const installation = await inspectCompleteInstallation(home, { verifyGenerations: true });
      if (installation.status === "recovery-required") throw new InstallerError(`Interrupted installation requires recovery; journal/candidate evidence is preserved. Run ${shellQuote(path.join(home, "kiro-fabric/bin/kiro-fabric"))} recover --yes (offline).`, 7, "recovery-required");
      if (installation.status === "legacy") throw new InstallerError("Legacy installation requires explicit verified migration before starting", 4, "prerequisite");
      if (installation.status === "retired") throw new InstallerError(`Fabric is retired; run install before this command. ${installationGuidance(home, installation).guidance}`, 4, "prerequisite");
      if (installation.status !== "active" || !installation.owner) throw new InstallerError("Fabric is not installed; run install before starting using a verified signed release or an explicitly selected source checkout", 4, "prerequisite");
      const kiro = checkKiro(), profile = prepareLaunchProfile(home, installation, options.guidanceMode ?? "standard");
      return await new Promise((resolve, reject) => { const child = spawn(kiro.executable, ["--v3", "--agent", profile.name], { cwd: process.cwd(), env: { ...process.env, KIRO_HOME: home, KIRO_FABRIC_LAUNCH_WORKSPACE: fs.realpathSync(process.cwd()), KIRO_FABRIC_RUN_DECLARATION: profile.declaration }, stdio: "inherit" }); child.once("error", reject); child.once("exit", code => resolve(code ?? 1)); });
    }
    if (!options.dryRun && spec.confirmation !== "none" && (!process.stdin.isTTY || options.nonInteractive || options.json) && !options.yes) throw new InstallerError("Noninteractive mutation requires --yes and an explicit command", 2, "usage");
    // Recovery goes directly to the lifecycle's conservative offline verifier.
    // It does not require a readable owner, Kiro, a backup, a bundle or trust discovery.
    const preparation = spec.preparation ? planInstallationPreparation(home, options) : undefined;
    let installation;
    if (!["recover", "restore"].includes(options.command) || options.dryRun) installation = preparation?.legacy ? { status: "legacy", owner: null, generations: [] } : await inspectCompleteInstallation(home, { verifyGenerations: true });
    const owner = installation?.owner;
    if (owner?.status === "retired" && ["update", "rollback"].includes(options.command)) throw new InstallerError(`Fabric is retired; run install before this command. ${installationGuidance(home, installation).guidance}`, 4, "prerequisite");
    if (options.command === "update" && !owner) throw new InstallerError("Fabric is not installed; use install", 4, "prerequisite");
    if (options.command === "update" && installedIdentity(installation).provenance.kind === "local-source" && !internal.sourceBundle && !options.archive && !options.version && !options.dryRun) throw new InstallerError(`${installationGuidance(home, installation).guidance} To deliberately switch to a signed release, select --version or --from-archive; signature verification remains mandatory.`, 4, "prerequisite");
    const shellPlan = spec.shell ? planShellIntegration(home, { remove: options.command === "uninstall", disabled: options.noShellIntegration }) : undefined;
    if (options.dryRun) {
      const result = { schemaVersion: 1, kiroHome: selected, platform, ...previewManagerOperation(home, options, installation, { preparation, shellPlan, sourceRoot: internal.sourceRoot, source: internal.source === true || !!internal.sourceBundle }) };
      emit(result, options); return 0;
    }
    if (installation?.status === "recovery-required") throw new InstallerError("Interrupted installation requires offline recover --yes; journal/candidate evidence is preserved", 7, "recovery-required");
    const kiro = spec.kiro === "required" ? checkKiro() : undefined;
    if (!options.json) {
      banner();
      process.stderr.write(`Kiro Fabric\nSystem        ${platform.target}\nKiro CLI      ${kiro ? `Found (${kiro.version})` : "Not required for this operation"}\nKiro home     ${display(home)} (${selected.source})\nOperation     ${options.command}\nDurable data is retained. Preparation, backups and requested configuration changes may remain if a later step fails.\n`);
      if (installation) process.stderr.write(`Installed     ${display(installedVersionLabel(installedIdentity(installation)))}\n`);
      if (["install", "update"].includes(options.command)) {
        process.stderr.write("Will install  Fabric backend, private Node/ripgrep, manager, agent profile, skills and steering\n");
        process.stderr.write(`Target        ${options.version ? `${display(options.version)} (requested; verification pending)` : "Version determined after bundle verification"}\nKiro CLI is already installed; it will not be installed, upgraded or authenticated by this installer.\n`);
      }
      if (spec.backup) process.stderr.write(`Backup root   ${display(path.join(home, "kiro-fabric", "backups"))} (configuration only; created if the home exists)\n`);
      if (shellPlan?.status === "planned") process.stderr.write(`Shell workspace handoff will be ${shellPlan.remove ? "removed from" : "configured in"} ${display(shellPlan.file)}; prior content is backed up.\n`);
      if (preparation?.permissions.length) process.stderr.write("Kiro home and agents directories will be restricted to the current user (0700).\n");
      if (preparation?.legacy) process.stderr.write("The verified old Pi Fabric profile will be backed up and replaced.\n");
    }
    if (!options.yes && !["", "y", "yes"].includes(await ask("Continue? [Y/n]: "))) throw new InstallerError("Cancelled before installation preparation", 3, "cancelled");
    const shownPhases = new Set();
    const phase = name => {
      const label = ({ "candidate-journal-synced": "Preparing installation", "before-candidate-validation": "Validating backend", "candidate-validated": "Backend smoke passed", "generation-published": "Configuring agent", "journal-synced": "Activating installation", "owner-committed": "Installation committed", "before-configuration-backup": "Backing up existing configuration" })[name] ?? (/^(Checking|Verifying)/u.test(name) ? name : undefined);
      if (label && !options.json && !shownPhases.has(label)) { shownPhases.add(label); process.stderr.write(`${label}\n`); }
    };
    if (options.command === "uninstall" && options.purgeData) {
      const inspection = inspectInstallationProcesses({ retainedNodePaths: owner?.runtimeGenerations?.map(generation => path.join(home, "kiro-fabric", "runtime", generation.name, "tools", "node")) ?? [] });
      throw new InstallerError(`Data purge is unavailable; complete process inactivity is unqualified and all data is retained. ${inspection.reason}`, 4, "prerequisite");
    }
    if (preparation) {
      homePreparation = { permissions: [], legacyProfileBackup: null };
      homePreparation.permissions = applyInstallationPermissions(preparation);
    }
    if (spec.backup) {
      phase("before-configuration-backup");
      // Backup worker validates narrow source-home exclusions; never infer a checkout.
      configurationBackup = createConfigurationBackup(home, { command: options.command, sourceRoot: internal.sourceRoot });
      if (!options.json) {
        if (configurationBackup) process.stderr.write(`Kiro configuration backed up from: ${display(home)}\nPrior configuration backup: ${display(configurationBackup.path)}\nBackup exclusions: ${display(configurationBackup.excludes.join(", "))} (see backup-manifest.json for scope)\n`);
        else process.stderr.write("Configuration backup: not needed; Kiro home does not exist yet.\n");
      }
    }
    let result;
    if (options.command === "recover") {
      const { recoverCompleteInstallation } = await import("./managed-installation.mjs");
      result = await recoverCompleteInstallation(home, { onPhase: phase });
    } else if (options.command === "rollback") result = await rollbackCompleteGeneration(home, { onPhase: phase, validateCandidate: smokeCandidate });
    else if (options.command === "uninstall") result = await retireCompleteInstallation(home, { onPhase: phase });
    else if (options.command === "restore") {
      const restored = restoreConfigurationBackup(path.resolve(options.backup), home);
      result = { ...restored, outcome: "restored", dataPreserved: true, restartRequired: false, committed: false, operationCompleted: true };
    } else {
      let temporary, bundleRoot, releaseMetadata;
      try {
        if (internal.sourceBundle) bundleRoot = internal.sourceBundle;
        else {
          phase("Checking signed release metadata");
          temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-release-"))); fs.chmodSync(temporary, 0o700);
          let archive;
          if (options.archive) {
            const capture = await verifyReleaseSidecarsCaptured(path.resolve(options.archive), { target: platform.target });
            releaseMetadata = capture.metadata;
            archive = path.join(temporary, "bundle.tar.gz"); fs.writeFileSync(archive, capture.archiveBytes, { mode: 0o600, flag: "wx" });
          } else {
            const release = await discoverRelease({ target: platform.target, ...(options.version ? { version: options.version } : {}) });
            releaseMetadata = release.metadata;
            archive = path.join(temporary, "bundle.tar.gz"); fs.writeFileSync(archive, release.archiveBytes, { mode: 0o600, flag: "wx" });
          }
          phase("Verifying package"); bundleRoot = path.join(temporary, "bundle"); await extractBundleArchive(archive, bundleRoot);
        }
        const bundle = await validateBundle(bundleRoot);
        if (bundle.manifest.target !== platform.target) throw new InstallerError("Bundle target does not match this system", 4, "prerequisite");
        if (releaseMetadata && (bundle.digest !== releaseMetadata.bundleDigest || bundle.version !== releaseMetadata.version || bundle.manifest.provenance.kind !== "release" || bundle.manifest.provenance.sourceCommit !== releaseMetadata.sourceCommit)) throw new InstallerError("Signed release does not match complete bundle identity/provenance");
        installationChange = versionChange(installedIdentity(installation), bundle);
        if (!options.json) process.stderr.write(formatVersionChange(installationChange));
        if (preparation?.legacy) homePreparation.legacyProfileBackup = preservePiFabricProfile(home, preparation.legacy, configurationBackup);
        result = await installCompleteGeneration(bundle.root, { kiroHome: home, provenance: internal.sourceBundle ? "source" : "release", ...(releaseMetadata ? { releaseMetadata } : {}), onPhase: phase, validateCandidate: smokeCandidate });
        operationResult = result; // Preserve commit truth even if archive cleanup below fails.
      } finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
    }
    operationResult = result;
    const guidance = installationGuidance(home, result.owner ? await inspectCompleteInstallation(home, { verifyGenerations: false }).catch(() => installation) : installation, { sourceRoot: internal.sourceRoot, source: !!internal.sourceBundle });
    const output = { schemaVersion: 1, ...result, ...(installationChange ? { installationChange } : {}), command: options.command, kiroHome: selected, platform, restartRequired: result.restartRequired === true, recoveryRequired: result.recoveryRequired === true || result.outcome === "committed-cleanup-required", configurationBackup: configurationBackup ?? null, warnings: [...(result.warnings ?? []), ...(configurationBackup ? [`Prior Kiro configuration backed up to ${configurationBackup.path}; restore with: ${shellQuote(path.join(home, "kiro-fabric", "bin", "kiro-fabric"))} restore --backup ${shellQuote(configurationBackup.path)} --yes`] : []), "Authenticated Kiro session and resource loading not tested"], ...guidance, ...(homePreparation ? { homePreparation } : {}) };
    if (shellPlan) {
      try { output.shellIntegration = applyShellIntegration(home, shellPlan, { expectedOwner: result.owner ?? null }); }
      catch (error) { throw Object.assign(new Error(`Backend ${options.command} completed, but shell setup failed: ${error.message}. Startup content and backups are preserved; inspect before retrying.`), { committed: result.committed === true, operationCompleted: true, recoveryRequired: true }); }
      if (output.shellIntegration.status === "skipped") output.warnings.push(output.shellIntegration.reason);
    }
    if (["install", "update", "rollback"].includes(options.command)) output.warnings.push(`Launch from your project directory with: ${output.commands.start}. The profile binds Kiro's per-session launch directory; direct kiro-cli --v3 --agent kiro-fabric works without shell setup. Open a new terminal only for the optional shell shortcut.`);
    // Source frontend finalization (e.g. explicit pull-hook setup) happens before
    // the single result is emitted, so JSON cannot claim success before failure.
    if (internal.afterOperation) await internal.afterOperation(output);
    if (options.command !== "recover") { try { logOutcome(home, output); } catch { output.warnings.push("Operation completed; installer log could not be safely updated"); } }
    const code = output.recoveryRequired ? 7 : 0;
    emit({ ...output, exitCode: code }, options); return code;
  } catch (error) {
    if (error.appliedPermissions && homePreparation) homePreparation.permissions = error.appliedPermissions;
    if (homePreparation) error.homePreparation = homePreparation;
    if (homePreparation?.legacyProfileBackup) error.legacyProfileBackup ??= homePreparation.legacyProfileBackup;
    if (configurationBackup) error.configurationBackup = configurationBackup;
    if (installationChange) error.installationChange = installationChange;
    if (operationResult) { error.committed = error.committed === true || operationResult.committed === true; error.operationCompleted = true; error.recoveryRequired = true; error.operationResult = operationResult; }
    error.command ??= options.command;
    if (internal.present) { const result = managerErrorResult(error, home); emit(result, options); return result.exitCode; }
    return presentManagerError(error, options.json, home);
  }
}
export function presentManagerResult(result, options) {
  if (result.error) { presentErrorResult(result, options.json); return; }
  if (options.json) { process.stdout.write(`${JSON.stringify(result)}\n`); return; }
  if (result.outcome === "help") { process.stdout.write(formatManagerHelp(result)); return; }
  process.stdout.write(`Kiro Fabric: ${display(result.outcome ?? "completed")}\nKiro home: ${display(result.kiroHome.path)}\n`);
  if (typeof result.committed === "boolean") process.stdout.write(`Activation committed: ${result.committed ? "yes" : "no new activation"}\n`);
  if (result.recoveryRequired) process.stdout.write("Recovery required: yes; preserve transaction evidence and inspect before retrying.\n");
  if (result.recovery) process.stdout.write(`Recovery: ${display(JSON.stringify(result.recovery))}\n`);
  for (const check of result.checks ?? []) process.stdout.write(`${check.status} ${display(check.id)}: ${display(typeof check.detail === "string" ? check.detail : JSON.stringify(check.detail))}\n`);
  if (result.installation) process.stdout.write(`Installed: ${display(installedVersionLabel(result.installation))}\n`);
  if (result.installationChange) process.stdout.write(formatVersionChange(result.installationChange));
  if (result.version) process.stdout.write(`Version: ${display(result.version)}\nGeneration: ${display(result.generation ?? result.digest)}\n`);
  if (result.dataRoot) process.stdout.write(`Data: ${display(result.dataRoot)}\n`);
  if (result.configurationBackup) process.stdout.write(`Prior configuration backup: ${display(result.configurationBackup.path)}\n`);
  if (result.homePreparation?.legacyProfileBackup) process.stdout.write(`Prior Pi Fabric profile: ${display(result.homePreparation.legacyProfileBackup)}\n`);
  for (const directory of result.homePreparation?.permissions ?? []) process.stdout.write(`Directory permissions: ${display(directory.path)} (${directory.previousMode} -> ${directory.mode})\n`);
  if (result.readOnly) process.stdout.write(`Scope: ${display(result.scope)}\nPlan: ${display(JSON.stringify(result.plan))}\n`);
  if (result.sourceComparison) process.stdout.write(`Source comparison: ${display(JSON.stringify(result.sourceComparison))}\n`);
  if (result.guidance) process.stdout.write(`${display(result.guidance)}\n`);
  for (const [name, command] of Object.entries(result.commands ?? {})) process.stdout.write(`${name}: ${command}\n`);
  for (const warning of result.warnings ?? []) process.stdout.write(`WARNING: ${display(warning)}\n`);
  if (result.shellIntegration?.status === "configured") process.stdout.write(`Shell configured: ${display(result.shellIntegration.file)}\nShell backup: ${display(result.shellIntegration.backup)}\nOpen a new terminal, cd to your project, and run: kiro-cli --v3\n`);
  if (result.shellIntegration?.status === "removed") process.stdout.write("Shell integration removed; open a new terminal to unload the function.\n");
  if (result.restartRequired) process.stdout.write("Restart the Kiro session to adopt this generation. Existing sessions keep their files.\n");
}
export function managerErrorResult(error, home = null) {
  const message = error instanceof Error ? error.message : String(error);
  const detail = error && typeof error === "object" ? error : {};
  let code = 5;
  if (detail.committed === true || detail.recoveryRequired === true) code = 7;
  else if (error instanceof InstallerError) code = error.exitCode;
  else if (detail.code === "INSTALL_LOCK_BUSY") code = 6;
  else if (detail.code === "INSTALL_LOCK_USAGE") code = 2;
  else if (["PREREQUISITE", "INSTALL_LOCK_UNSUPPORTED", "INSTALL_PURGE_UNAVAILABLE"].includes(detail.code)) code = 4;
  else if (["offline", "rate-limited", "no-release", "trust-root blocked"].includes(detail.code) || /^Production release trust root unavailable:/i.test(message)) code = 8;
  else if (detail.code === "INSTALL_LOCK_RECOVERY_REQUIRED" || /^recovery-required:/i.test(message)) code = 7;
  return { schemaVersion: 1, committed: detail.committed === true, recoveryRequired: code === 7, dataPreserved: detail.dataPreserved !== false, outcome: detail.committed === true ? "committed-cleanup-required" : detail.outcome ?? (code === 7 ? "recovery-required" : code === 8 ? "discovery-unavailable" : "failed"), kiroHome: home, error: display(message), exitCode: code,
    ...(detail.command ? { command: detail.command } : {}), ...(detail.recovery ? { recovery: detail.recovery } : {}), ...(detail.operationCompleted ? { operationCompleted: true } : {}), ...(detail.operationResult ? { operationResult: detail.operationResult } : {}),
    ...(detail.installationChange ? { installationChange: detail.installationChange } : {}),
    ...(detail.configurationBackup ? { configurationBackup: detail.configurationBackup } : {}), ...(detail.homePreparation ? { homePreparation: detail.homePreparation } : {}), ...(detail.legacyProfileBackup ? { legacyProfileBackup: detail.legacyProfileBackup } : {}),
    limitations: ["Failure is not a no-change guarantee; reported preparation, backups and committed operations may remain. Preserve unknown evidence."] };
}
export function presentManagerError(error, json, home) {
  return presentErrorResult(managerErrorResult(error, home ?? null), json);
}
function presentErrorResult(result, json) {
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    process.stderr.write(`Kiro Fabric: ${result.error}\nActivation committed: ${result.committed ? "yes" : "not confirmed"}\nRecovery required: ${result.recoveryRequired ? "yes" : "not reported"}\n`);
    if (result.operationCompleted) process.stderr.write("The backend operation completed before this failure.\n");
    if (result.recovery) process.stderr.write(`Recovery evidence: ${display(JSON.stringify(result.recovery))}\n`);
    if (result.configurationBackup) process.stderr.write(`Prior configuration backup: ${display(result.configurationBackup.path)}\n`);
    if (result.legacyProfileBackup) process.stderr.write(`Prior Pi Fabric profile preserved at: ${display(result.legacyProfileBackup)}\n`);
    for (const directory of result.homePreparation?.permissions ?? []) process.stderr.write(`Applied directory permissions: ${display(directory.path)} (${directory.previousMode} -> ${directory.mode})\n`);
    process.stderr.write(`${result.limitations[0]}\n`);
  }
  return result.exitCode;
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = await runManager(process.argv.slice(2));
