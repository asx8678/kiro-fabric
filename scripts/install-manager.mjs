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

const commands = ["install", "update", "doctor", "rollback", "uninstall", "start", "restore"];
const display = value => String(value).replace(/[\u0000-\u001f\u007f]/gu, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).slice(0, 2000);
export const shellQuote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
export class InstallerError extends Error {
  constructor(message, exitCode = 5, outcome = "conflict") { super(message); this.exitCode = exitCode; this.outcome = outcome; }
}
export function parseManagerArguments(argv) {
  const result = { command: undefined, kiroHome: undefined, archive: undefined, version: undefined, backup: undefined, guidanceMode: undefined, yes: false, nonInteractive: false, json: false, noColor: false, purgeData: false, migratePiFabric: false, noShellIntegration: false };
  const seen = new Set();
  const names = { "--kiro-home": "kiroHome", "--from-archive": "archive", "--version": "version", "--backup": "backup", "--guidance-mode": "guidanceMode", "--yes": "yes", "--non-interactive": "nonInteractive", "--json": "json", "--no-color": "noColor", "--purge-data": "purgeData", "--migrate-pi-fabric": "migratePiFabric", "--no-shell-integration": "noShellIntegration" };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--source") throw new InstallerError("Installed management never builds source. Run bash /path/to/checkout/install.sh --source explicitly.", 2, "usage");
    if (!arg.startsWith("--")) {
      if (result.command || !commands.includes(arg)) throw new InstallerError("Expected exactly one command: install, update, doctor, rollback, uninstall or start", 2, "usage");
      result.command = arg; continue;
    }
    const name = names[arg];
    if (!name || seen.has(name)) throw new InstallerError(`Unknown or duplicate option: ${display(arg)}`, 2, "usage");
    seen.add(name);
    if (["kiroHome", "archive", "version", "backup", "guidanceMode"].includes(name)) {
      const value = argv[++index];
      if (!value || value.startsWith("--") || /[\u0000-\u001f\u007f]/u.test(value)) throw new InstallerError(`${arg} requires a safe value`, 2, "usage");
      result[name] = value;
    } else result[name] = true;
  }
  if (result.archive && result.version) throw new InstallerError("--from-archive and --version are mutually exclusive", 2, "usage");
  if (result.version && !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(result.version)) throw new InstallerError("--version requires an exact stable release version", 2, "usage");
  const allowed = { doctor: ["kiroHome", "json", "noColor", "nonInteractive"], start: ["kiroHome", "noColor", "guidanceMode"], rollback: ["kiroHome", "yes", "json", "noColor", "nonInteractive"], uninstall: ["kiroHome", "yes", "json", "noColor", "nonInteractive", "purgeData", "noShellIntegration"], restore: ["kiroHome", "backup", "yes", "json", "noColor", "nonInteractive"] };
  if (result.command && allowed[result.command] && [...seen].some(name => !allowed[result.command].includes(name))) throw new InstallerError(`${result.command} does not accept those operation options`, 2, "usage");
  if (result.backup && result.command !== "restore") throw new InstallerError("--backup applies only to restore", 2, "usage");
  if (result.purgeData && result.command !== "uninstall") throw new InstallerError("--purge-data applies only to uninstall", 2, "usage");
  if (result.migratePiFabric && result.command !== "install") throw new InstallerError("--migrate-pi-fabric applies only to install", 2, "usage");
  if (result.guidanceMode !== undefined && (result.command !== "start" || !["standard", "review", "minimal"].includes(result.guidanceMode))) throw new InstallerError("--guidance-mode requires start and standard, review or minimal", 2, "usage");
  return result;
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
export async function doctorInstallation(home, env = process.env) {
  const checks = [];
  let installationStatus = "unknown";
  const check = async (id, action) => { try { const detail = await action(); checks.push({ id, status: "PASS", detail }); } catch (error) { if (id === "installation" && managerErrorResult(error).exitCode === 7) installationStatus = "recovery-required"; checks.push({ id, status: "FAIL", detail: display(error.message) }); } };
  await check("home", () => resolveKiroHome({}, path.dirname(home), { kiroHome: home }));
  await check("installation", async () => {
    const result = await inspectCompleteInstallation(home, { verifyGenerations: true });
    installationStatus = result.status;
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
  const owner = await currentOwner(home).catch(() => undefined);
  if (owner?.schemaVersion === 3 && checks.some(check => check.id === "installation" && check.status === "PASS")) {
    for (const tool of ["node", "rg"]) await check(`private-${tool}`, () => {
      const executable = path.join(home, "kiro-fabric", "runtime", owner.currentRuntime, "tools", tool);
      const result = spawnSync(executable, tool === "node" ? ["--version"] : ["--no-config", "--version"], { env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, encoding: "utf8", timeout: 5000, maxBuffer: 4096 });
      if (result.error || result.status !== 0) throw new Error(`Private ${tool} version check failed`);
      return display(result.stdout.trim());
    });
  }
  for (const id of ["authenticated-session", "client-tool-filtering", "resource-loading", "elicitation", "compaction-resume", "downstream-mcp"]) checks.push({ id, status: "NOT TESTED", detail: "Offline doctor does not authenticate or contact configured MCP servers" });
  return { outcome: installationStatus === "recovery-required" ? "recovery-required" : checks.some(check => check.status === "FAIL") ? "diagnostic-failure" : owner?.status === "retired" ? "retired" : "healthy", checks, warnings: owner?.legacy ? ["Legacy runtimes/resources retained; legacy startup is not fenced"] : [] };
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
  let options;
  try { options = parseManagerArguments(argv); }
  catch (error) { return presentError(error, argv.includes("--json")); }
  const context = internal.context ?? managerContext();
  let home, homePreparation;
  try {
    assertUnprivilegedInstaller();
    const platform = detectInstallerPlatform();
    const selected = selectedHome(options, context); home = selected.path;
    await validateOwnManager(context);
    if (!options.command) {
      if (!process.stdin.isTTY || !process.stdout.isTTY || options.json || options.nonInteractive) throw new InstallerError("Noninteractive use requires an explicit command", 2, "usage");
      const owner = await currentOwner(home);
      process.stderr.write(`Kiro Fabric\nSystem        ${platform.target}\nKiro home     ${display(home)} (${selected.source})\nInstallation  ${owner?.status ?? (owner ? "legacy" : "Not installed")}\n`);
      const choice = await ask(owner?.status !== "retired" && owner ? "[U]pdate, [C]heck, [R]ollback, [X]Uninstall, [E]xit [U]: " : "Install Fabric? [Y/n]: ");
      if (["e", "n", "no"].includes(choice)) throw new InstallerError("Cancelled; no installation changes", 3, "cancelled");
      options.command = owner && owner.status !== "retired" ? ({ "": "update", u: "update", c: "doctor", r: "rollback", x: "uninstall" })[choice] : ["", "y", "yes"].includes(choice) ? "install" : undefined;
      if (!options.command) throw new InstallerError("Invalid menu choice", 2, "usage");
    }
    if (options.command === "doctor") {
      const result = { schemaVersion: 1, command: "doctor", kiroHome: selected, platform, ...(await doctorInstallation(home)) };
      present(result, options); return result.outcome === "recovery-required" ? 7 : result.checks.some(check => check.status === "FAIL") ? 5 : 0;
    }
    if (options.command === "start") {
      // Inspection can return a non-active state without throwing. Admit only
      // verified active ownership, before any client execution; never repair here.
      const installation = await inspectCompleteInstallation(home, { verifyGenerations: true });
      if (installation.status === "recovery-required") throw new InstallerError("Interrupted installation requires recovery; journal/candidate evidence is preserved", 7, "recovery-required");
      if (installation.status === "legacy") throw new InstallerError("Legacy installation requires explicit verified migration before starting", 4, "prerequisite");
      if (installation.status === "retired") throw new InstallerError("Fabric is retired; run install before this command", 4, "prerequisite");
      if (installation.status !== "active" || !installation.owner) throw new InstallerError("Fabric is not installed; run install before starting", 4, "prerequisite");
      const kiro = checkKiro();
      const profile = prepareLaunchProfile(home, installation, options.guidanceMode ?? "standard");
      return await new Promise((resolve, reject) => { const child = spawn(kiro.executable, ["--v3", "--agent", profile.name], { cwd: process.cwd(), env: { ...process.env, KIRO_HOME: home, KIRO_FABRIC_LAUNCH_WORKSPACE: fs.realpathSync(process.cwd()), KIRO_FABRIC_RUN_DECLARATION: profile.declaration }, stdio: "inherit" }); child.once("error", reject); child.once("exit", code => resolve(code ?? 1)); });
    }
    const owner = await currentOwner(home);
    if (owner?.status === "retired" && ["update", "rollback"].includes(options.command)) throw new InstallerError("Fabric is retired; run install before this command", 4, "prerequisite");
    const mutating = ["install", "update", "rollback", "uninstall"].includes(options.command);
    if (mutating && (!process.stdin.isTTY || options.nonInteractive || options.json) && !options.yes) throw new InstallerError("Noninteractive mutation requires --yes and an explicit command", 2, "usage");
    const kiro = ["install", "update", "rollback"].includes(options.command) ? checkKiro() : undefined;
    const preparation = ["install", "update"].includes(options.command) ? planInstallationPreparation(home, options) : undefined;
    const shellPlan = ["install", "update", "uninstall"].includes(options.command) ? planShellIntegration(home, { remove: options.command === "uninstall", disabled: options.noShellIntegration }) : undefined;
    if (!options.yes) {
      process.stderr.write(`Kiro Fabric\nSystem        ${platform.target}\nKiro CLI      ${kiro ? `Found (${kiro.version})` : "Not required for removal"}\nKiro home     ${display(home)} (${selected.source})\nOperation     ${options.command}\nExisting agents, settings, projects and durable data will be preserved.\n`);
      if (shellPlan?.status === "planned") process.stderr.write(`Shell workspace handoff will be ${shellPlan.remove ? "removed from" : "configured in"} ${display(shellPlan.file)}; existing content is backed up and preserved. Open a new terminal after installation.\n`);
      if (preparation?.permissions.length) process.stderr.write("Kiro home and agents directories will be restricted to the current user (0700).\n");
      if (preparation?.legacy) process.stderr.write("The verified old Pi Fabric profile will be backed up and replaced.\n");
      if (!["", "y", "yes"].includes(await ask("Continue? [Y/n]: "))) throw new InstallerError("Cancelled; no installation changes", 3, "cancelled");
    }
    if (options.purgeData && !options.nonInteractive && process.stdin.isTTY) {
      if (!options.yes || !options.nonInteractive) { if ((await ask("Permanently delete Fabric data? Type DELETE: ")) !== "delete") throw new InstallerError("Data purge cancelled", 3, "cancelled"); }
    }
    if (options.purgeData && (!process.stdin.isTTY || options.json) && !options.nonInteractive) throw new InstallerError("Noninteractive purge requires --purge-data --yes --non-interactive", 2, "usage");
    const shownPhases = new Set();
    const phase = name => {
      const label = ({ "candidate-journal-synced": "Preparing installation", "before-candidate-validation": "Validating backend", "candidate-validated": "Backend smoke passed", "generation-published": "Configuring agent", "journal-synced": "Activating installation", "owner-committed": "Installation committed", "before-configuration-backup": "Backing up existing configuration" })[name] ?? (/^(Checking|Verifying)/u.test(name) ? name : undefined);
      if (label && !options.json && !shownPhases.has(label)) { shownPhases.add(label); process.stderr.write(`${label}\n`); }
    };
    let configurationBackup;
    if (options.command === "uninstall" && options.purgeData) {
      // Refused before any work: taking a configuration backup for an operation
      // that always aborts would silently rotate the retention window.
      const inspection = inspectInstallationProcesses({ retainedNodePaths: owner?.runtimeGenerations?.map(generation => path.join(home, "kiro-fabric", "runtime", generation.name, "tools", "node")) ?? [] });
      throw new InstallerError(inspection.reason, 7, "recovery-required");
    }
    if (preparation) homePreparation = { permissions: applyInstallationPermissions(preparation), legacyProfileBackup: null };
    if (mutating) {
      // Fail closed before any mutation when the prior configuration cannot be
      // captured completely. The backup is durable and private; restore is the
      // explicit `restore --backup <path>` manager command.
      phase("before-configuration-backup");
      configurationBackup = createConfigurationBackup(home, { command: options.command });
    }
    let result;
    if (options.command === "rollback") result = await rollbackCompleteGeneration(home, { onPhase: phase, validateCandidate: smokeCandidate });
    else if (options.command === "uninstall") {
      result = await retireCompleteInstallation(home, { onPhase: phase });
    } else if (options.command === "restore") {
      if (!options.backup) throw new InstallerError("restore requires --backup <backup-directory>", 2, "usage");
      const restored = restoreConfigurationBackup(path.resolve(options.backup), home);
      result = { outcome: "restored", restored: restored.restored, directories: restored.directories, symlinks: restored.symlinks, managedSkipped: restored.managedSkipped, dataPreserved: true, restartRequired: false };
    } else {
      if (options.command === "update" && !owner) throw new InstallerError("Fabric is not installed; use install", 4, "prerequisite");
      let temporary, bundleRoot, releaseMetadata;
      try {
        if (internal.sourceBundle) bundleRoot = internal.sourceBundle;
        else {
          phase("Checking signed release metadata");
          temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-release-"))); fs.chmodSync(temporary, 0o700);
          let archive;
          if (options.archive) {
            const original = path.resolve(options.archive);
            const capture = await verifyReleaseSidecarsCaptured(original, { target: platform.target });
            releaseMetadata = capture.metadata;
            const bytes = capture.archiveBytes;
            archive = path.join(temporary, "bundle.tar.gz"); fs.writeFileSync(archive, bytes, { mode: 0o600, flag: "wx" });
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
        if (preparation?.legacy) homePreparation.legacyProfileBackup = preservePiFabricProfile(home, preparation.legacy, configurationBackup);
        result = await installCompleteGeneration(bundle.root, { kiroHome: home, provenance: internal.sourceBundle ? "source" : "release", ...(releaseMetadata ? { releaseMetadata } : {}), onPhase: phase, validateCandidate: smokeCandidate });
      } finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
    }
    const output = { schemaVersion: 1, ...result, command: options.command, kiroHome: selected, platform, restartRequired: result.restartRequired === true, configurationBackup: configurationBackup ? { path: configurationBackup.path, files: configurationBackup.files, directories: configurationBackup.directories, symlinks: configurationBackup.symlinks, skipped: configurationBackup.skipped, manifestSha256: configurationBackup.manifestSha256 } : null, warnings: [...(result.warnings ?? []), ...(configurationBackup ? [`Prior Kiro configuration backed up to ${configurationBackup.path} (${configurationBackup.files} files); restore with: ${shellQuote(path.join(home, "kiro-fabric", "bin", "kiro-fabric"))} restore --backup ${shellQuote(configurationBackup.path)}`] : []), "Authenticated Kiro session and resource loading not tested"], commands: { start: `${shellQuote(path.join(home, "kiro-fabric", "bin", "kiro-fabric"))} start`, update: `${shellQuote(path.join(home, "kiro-fabric", "bin", "kiro-fabric"))} update`, doctor: `${shellQuote(path.join(home, "kiro-fabric", "bin", "kiro-fabric"))} doctor` } };
    if (shellPlan) {
      try { output.shellIntegration = applyShellIntegration(home, shellPlan); }
      catch (error) { throw Object.assign(new Error(`Backend ${options.command} completed, but shell setup failed: ${error.message}. Startup content and backups are preserved; rerun the operation after resolving the conflict.`), { committed: result.committed === true, recoveryRequired: true }); }
      if (output.shellIntegration.status === "skipped") output.warnings.push(output.shellIntegration.reason);
    }
    if (["install", "update", "rollback"].includes(options.command)) output.warnings.push(`Launch from your project directory with: ${output.commands.start}. The updated Fabric profile binds Kiro's per-session launch directory when no MCP roots are supplied; kiro-cli --v3 --agent kiro-fabric works without shell setup. Open a new terminal only to load the optional default-agent shell shortcut.`);
    if (homePreparation) output.homePreparation = homePreparation;
    try { logOutcome(home, output); } catch { output.warnings.push("Operation completed; installer log could not be safely updated"); }
    present(output, options); return output.outcome === "committed-cleanup-required" ? 7 : 0;
  } catch (error) {
    if (homePreparation?.legacyProfileBackup) error.legacyProfileBackup = homePreparation.legacyProfileBackup;
    return presentError(error, options.json, home);
  }
}
function present(result, options) {
  if (options.json) { process.stdout.write(`${JSON.stringify(result)}\n`); return; }
  process.stdout.write(`Kiro Fabric: ${display(result.outcome ?? "completed")}\nKiro home: ${display(result.kiroHome.path)}\n`);
  for (const check of result.checks ?? []) process.stdout.write(`${check.status} ${display(check.id)}: ${display(typeof check.detail === "string" ? check.detail : JSON.stringify(check.detail))}\n`);
  if (result.version) process.stdout.write(`Version: ${display(result.version)}\nGeneration: ${display(result.generation ?? result.digest)}\n`);
  if (result.dataRoot) process.stdout.write(`Data: ${display(result.dataRoot)}\n`);
  if (result.configurationBackup) process.stdout.write(`Prior configuration backup: ${display(result.configurationBackup.path)}\n`);
  if (result.homePreparation?.legacyProfileBackup) process.stdout.write(`Prior Pi Fabric profile: ${display(result.homePreparation.legacyProfileBackup)}\n`);
  for (const directory of result.homePreparation?.permissions ?? []) process.stdout.write(`Directory permissions: ${display(directory.path)} (${directory.previousMode} -> ${directory.mode})\n`);
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
  else if (detail.code === "PREREQUISITE" || detail.code === "INSTALL_LOCK_UNSUPPORTED") code = 4;
  else if (["offline", "rate-limited", "no-release", "trust-root blocked"].includes(detail.code) || /^Production release trust root unavailable:/i.test(message)) code = 8;
  else if (detail.code === "INSTALL_LOCK_RECOVERY_REQUIRED" || /^recovery-required:/i.test(message)) code = 7;
  return { schemaVersion: 1, committed: detail.committed === true, dataPreserved: detail.dataPreserved !== false, outcome: detail.committed === true ? "committed-cleanup-required" : detail.outcome ?? (code === 7 ? "recovery-required" : code === 8 ? "discovery-unavailable" : "failed"), kiroHome: home, error: display(message), exitCode: code, ...(detail.legacyProfileBackup ? { legacyProfileBackup: detail.legacyProfileBackup } : {}) };
}
function presentError(error, json, home) {
  const result = managerErrorResult(error, home ?? null);
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`); else process.stderr.write(`Kiro Fabric: ${result.error}\n`);
  if (!json && result.legacyProfileBackup) process.stderr.write(`Prior Pi Fabric profile preserved at: ${display(result.legacyProfileBackup)}\n`);
  return result.exitCode;
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = await runManager(process.argv.slice(2));
