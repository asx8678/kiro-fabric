// Setup console for the Kiro integration:
//
//   kiro-fabric-setup status | install | update | repair | uninstall | doctor | launch
//
// Bare invocation on a TTY shows a numbered menu; non-interactive bare
// invocation prints usage. install/update delegate to installKiroProfile,
// uninstall to uninstallKiroProfile, doctor to runKiroDoctor — no ownership,
// backup, or symlink logic lives here. launch execs kiro-cli by argv.
//
// Exit codes: 0 success/noop/dry-run · 1 failure · 2 usage · 130 interactive cancel.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import { runKiroDoctor } from "./doctor.js";
import {
  assertSupportedKiro,
  assertSupportedKiroUnchanged,
  inspectKiroCompatibility,
  inspectNodeCompatibility,
  KIRO_CLI_VERSION,
  MIN_NODE_MAJOR,
  sameExecutableIdentity,
  type KiroCompatibilityReport,
  type NodeCompatibilityReport,
} from "./compatibility.js";
import { resolveKiroInstallRoots, type KiroInstallRoots } from "./home.js";
import {
  installKiroProfile,
  readManagedKiroGrants,
  resolveKiroProjectRoot,
  type KiroInstallOptions,
} from "./install.js";
import {
  acquireOperationLock,
  KiroInstallError,
  lstatOrNull,
  managedPaths,
  readManagedFileNoFollow,
  readManifest,
  recoverManagedTransaction,
  sha256Bytes,
  type KiroManagedGrants,
} from "./managed.js";
import { kiroProfilePath } from "./profile.js";
import { runtimeClosureMarkerPath, verifyRuntimeClosureAttestation } from "./runtime-closure.js";
import { managedKiroSkillBundleSha256 } from "./skills.js";
import { createProcessTreeController } from "../worker/process-tree.js";
import {
  planKiroProfileUninstall,
  uninstallKiroProfile,
  type KiroUninstallOptions,
} from "./uninstall.js";

const LAUNCH_ARGS = ["--v3", "--agent", "kiro-fabric"] as const;

const USAGE =
  [
    "kiro-fabric-setup — install and maintain the managed Kiro v3 profile",
    "",
    "Usage:",
    "  kiro-fabric-setup <command> [options]",
    "",
    "Commands:",
    "  status                    Show node, kiro-cli, and per-scope install state",
    "  install                   Install the managed Kiro v3 profile (project scope by default)",
    "  update                    Update from the current npm/source artifact; preserve grants",
    "  repair                    Re-attest and restore from the current trusted artifact",
    "  uninstall                 Remove a managed profile or restore the backup",
    "  doctor                    Read-only non-billable health checks",
    "  launch                    Launch kiro-cli with the kiro-fabric agent",
    "",
    "Bare invocation on a TTY shows an interactive menu; otherwise this usage is",
    "printed. New installs default advanced grants off; update/repair preserve them.",
    "",
    "Options:",
    "  --user                    Target the user Kiro home (~/.kiro) instead of <project>/.kiro",
    "  --project-root <dir>      Project root (default: cwd; never walks up)",
    "  --kiro-home <dir>         Kiro home for --user (default: $KIRO_HOME or ~/.kiro)",
    "  --kiro-binary <path>      Kiro CLI binary (default: kiro-cli)",
    "  --dry-run                 Validate and report without changing files",
    "  --yes                     Suppress confirmation prompts (never implies --force)",
    "  --force                   Install/repair: back up and replace modified managed content",
    "  --allow-shell             Trusted opt-in: enable k.bash",
    "  --subagents               Enable bounded ACP fan-out (requires shell grant)",
    "  --allow-tools             Trusted opt-in: auto-approve fabric_exec meta-capability",
    "                            (it can invoke all configured Fabric providers/tools)",
    "  --revoke-shell            Revoke shell and dependent subagent grants",
    "  --revoke-subagents        Revoke only the subagent grant",
    "  --revoke-tools            Restore the exact Fabric MCP rule to ask",
    "  --reset-grants            Revoke every advanced grant",
    "  --json                    Machine-readable output (exactly one object on stdout)",
    "  -h, --help                Show this help",
    "",
    "Exit codes: 0 success · 1 failure · 2 usage · 130 interactive cancel.",
  ].join("\n") + "\n";

type SetupCommand =
  | "status"
  | "install"
  | "update"
  | "repair"
  | "uninstall"
  | "doctor"
  | "launch"
  | "menu"
  | "help";

interface SetupArgs {
  command: SetupCommand;
  json: boolean;
  dryRun: boolean;
  yes: boolean;
  force: boolean;
  allowShell: boolean;
  enableSubagents: boolean;
  allowTools: boolean;
  revokeShell: boolean;
  revokeSubagents: boolean;
  revokeTools: boolean;
  resetGrants: boolean;
  user: boolean;
  projectRoot?: string;
  kiroHome?: string;
  kiroBinary?: string;
}

class UsageError extends Error {}
class InteractiveCancelError extends Error {}

const baseArgs = (command: SetupCommand): SetupArgs => ({
  command,
  json: false,
  dryRun: false,
  yes: false,
  force: false,
  allowShell: false,
  enableSubagents: false,
  allowTools: false,
  revokeShell: false,
  revokeSubagents: false,
  revokeTools: false,
  resetGrants: false,
  user: false,
});

const parseSetupArgs = (argv: string[]): SetupArgs => {
  if (argv.length === 0) return baseArgs("menu");
  const [head, ...rest] = argv;
  if (head === "-h" || head === "--help" || head === "help") return baseArgs("help");
  const command = head;
  if (
    command !== "status" &&
    command !== "install" &&
    command !== "update" &&
    command !== "repair" &&
    command !== "uninstall" &&
    command !== "doctor" &&
    command !== "launch"
  ) {
    throw new UsageError("unknown command: " + command);
  }
  const mutating =
    command === "install" || command === "update" || command === "repair" || command === "uninstall";
  const parsed = baseArgs(command);
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    const value = (): string => {
      const next = rest[++i];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError("missing value for " + flag);
      }
      return next;
    };
    switch (flag) {
      case "--json":
        if (command === "launch") throw new UsageError("--json is not valid for launch");
        parsed.json = true;
        break;
      case "--dry-run":
        if (!mutating) throw new UsageError("--dry-run is only valid for lifecycle mutations");
        parsed.dryRun = true;
        break;
      case "--yes":
        if (!mutating) throw new UsageError("--yes is only valid for lifecycle mutations");
        parsed.yes = true;
        break;
      case "--force":
        if (command !== "install" && command !== "repair") throw new UsageError("--force is install/repair-only");
        parsed.force = true;
        break;
      case "--allow-shell":
        if (command !== "install" && command !== "update" && command !== "repair") {
          throw new UsageError("--allow-shell is install/update/repair-only");
        }
        parsed.allowShell = true;
        break;
      case "--subagents":
        if (command !== "install" && command !== "update" && command !== "repair") {
          throw new UsageError("--subagents is install/update/repair-only");
        }
        parsed.enableSubagents = true;
        break;
      case "--allow-tools":
        if (command !== "install" && command !== "update" && command !== "repair") {
          throw new UsageError("--allow-tools is install/update/repair-only");
        }
        parsed.allowTools = true;
        break;
      case "--revoke-shell":
      case "--revoke-subagents":
      case "--revoke-tools":
      case "--reset-grants":
        if (command !== "update" && command !== "repair") {
          throw new UsageError(flag + " is update/repair-only");
        }
        if (flag === "--revoke-shell") parsed.revokeShell = true;
        if (flag === "--revoke-subagents") parsed.revokeSubagents = true;
        if (flag === "--revoke-tools") parsed.revokeTools = true;
        if (flag === "--reset-grants") parsed.resetGrants = true;
        break;
      case "--project-root":
        if (parsed.projectRoot !== undefined) throw new UsageError("duplicate --project-root");
        parsed.projectRoot = value();
        break;
      case "--user":
        if (command === "launch") throw new UsageError("--user is not valid for launch");
        parsed.user = true;
        break;
      case "--kiro-home":
        if (command === "launch") throw new UsageError("--kiro-home is not valid for launch");
        if (parsed.kiroHome !== undefined) throw new UsageError("duplicate --kiro-home");
        parsed.kiroHome = value();
        break;
      case "--kiro-binary":
        if (command === "uninstall") {
          throw new UsageError("--kiro-binary is not valid for uninstall");
        }
        if (parsed.kiroBinary !== undefined) throw new UsageError("duplicate --kiro-binary");
        parsed.kiroBinary = value();
        break;
      case "-h":
      case "--help":
        return baseArgs("help");
      default:
        throw new UsageError("unknown option: " + flag);
    }
  }
  if (parsed.kiroHome !== undefined && !parsed.user && command !== "status") {
    throw new UsageError("--kiro-home requires --user");
  }
  if (parsed.allowShell && parsed.revokeShell) throw new UsageError("--allow-shell conflicts with --revoke-shell");
  if (parsed.enableSubagents && parsed.revokeSubagents) throw new UsageError("--subagents conflicts with --revoke-subagents");
  if (parsed.allowTools && parsed.revokeTools) throw new UsageError("--allow-tools conflicts with --revoke-tools");
  if (parsed.enableSubagents && parsed.revokeShell) {
    throw new UsageError("--subagents conflicts with --revoke-shell");
  }
  if (parsed.resetGrants && (
    parsed.allowShell || parsed.enableSubagents || parsed.allowTools ||
    parsed.revokeShell || parsed.revokeSubagents || parsed.revokeTools
  )) {
    throw new UsageError("--reset-grants conflicts with other grant-changing flags");
  }
  return parsed;
};

type NodeStatus = NodeCompatibilityReport;
type KiroCliStatus = KiroCompatibilityReport;

type KiroLayout = KiroInstallRoots["layout"];

const MANIFEST_RELATIVE_PATH: Record<KiroLayout, string> = {
  project: ".kiro/.kiro-fabric/install.json",
  user: ".kiro-fabric/install.json",
};

const managedManifestPath = (roots: KiroInstallRoots): string =>
  join(roots.installRoot, ...MANIFEST_RELATIVE_PATH[roots.layout].split("/"));

interface KiroScopeStatus {
  installed: boolean;
  packageVersion: string | null;
  path: string | null;
  healthy: boolean;
  issue: string | null;
  kiroBinaryPath: string | null;
  kiroCliVersion: string | null;
  kiroSha256: string | null;
}

const UNAVAILABLE_SCOPE: KiroScopeStatus = {
  installed: false,
  packageVersion: null,
  path: null,
  healthy: false,
  issue: "scope unavailable",
  kiroBinaryPath: null,
  kiroCliVersion: null,
  kiroSha256: null,
};

const scopeStatusFor = (
  scope: KiroLayout,
  projectRoot: string | undefined,
  kiroHome: string | undefined,
): KiroScopeStatus => {
  let roots: KiroInstallRoots;
  try {
    roots = resolveKiroInstallRoots({
      ...(scope === "user" ? { scope: "user" as const } : {}),
      ...(scope === "project" && projectRoot !== undefined ? { projectRoot } : {}),
      ...(scope === "user" && kiroHome !== undefined ? { kiroHome } : {}),
    });
  } catch {
    return UNAVAILABLE_SCOPE;
  }
  const manifestPath = managedManifestPath(roots);
  if (!existsSync(manifestPath)) {
    return {
      installed: false,
      packageVersion: null,
      path: manifestPath,
      healthy: false,
      issue: null,
      kiroBinaryPath: null,
      kiroCliVersion: null,
      kiroSha256: null,
    };
  }
  let packageVersion: string | null = null;
  let kiroBinaryPath: string | null = null;
  let kiroCliVersion: string | null = null;
  let kiroSha256: string | null = null;
  try {
    const manifest = readManifest(roots.installRoot, roots.layout);
    if (!manifest) throw new Error("managed install manifest is absent");
    packageVersion = manifest.packageVersion;
    kiroBinaryPath = manifest.runtime.kiroBinaryPath ?? null;
    kiroCliVersion = manifest.runtime.kiroCliVersion ?? null;
    kiroSha256 = manifest.runtime.kiroSha256 ?? null;
    if (manifest.format !== 3) {
      throw new Error(
        `legacy format-${manifest.format} installation is not launchable or doctorable; run kiro-fabric-setup update (or repair from a trusted current package) to create a fully attested format-3 release`,
      );
    }
    const profile = readManagedFileNoFollow(
      roots.installRoot,
      kiroProfilePath(roots.installRoot, roots.layout),
    );
    if (!profile || sha256Bytes(profile) !== manifest.profile.installedSha256) {
      throw new Error("managed profile hash mismatch");
    }
    const profileDocument = JSON.parse(profile.toString("utf8")) as {
      mcpServers?: { fabric?: { env?: Record<string, unknown> } };
    };
    const profileEnv = profileDocument.mcpServers?.fabric?.env ?? {};
    const profileGrants: KiroManagedGrants = {
      allowShell: profileEnv.KIRO_FABRIC_ALLOW_SHELL === "1",
      enableSubagents: profileEnv.KIRO_FABRIC_ENABLE_SUBAGENTS === "1",
      allowTools: profileEnv.KIRO_FABRIC_ALLOW_TOOLS === "1",
    };
    if (manifest.grants && JSON.stringify(manifest.grants) !== JSON.stringify(profileGrants)) {
      throw new Error("manifest grant state differs from the verified profile");
    }
    {
      const records = manifest.skills?.files;
      if (!records?.length) throw new Error("managed skill attestation is absent");
      const sources = records.map((record) => {
        const installedPath = join(roots.installRoot, ...record.path.split("/"));
        const bytes = readManagedFileNoFollow(roots.installRoot, installedPath);
        if (!bytes || sha256Bytes(bytes) !== record.installedSha256) {
          throw new Error("managed skill hash mismatch: " + record.path);
        }
        const marker = record.path.indexOf("skills/");
        return {
          sourceRelative: record.path.slice(marker + "skills/".length),
          installedRelative: record.path,
          installedPath,
          bytes,
          sha256: record.installedSha256,
        };
      });
      if (managedKiroSkillBundleSha256(sources) !== manifest.skills!.bundleSha256) {
        throw new Error("managed skill bundle digest mismatch");
      }
      if (!manifest.runtime.closure) throw new Error("runtime closure attestation is absent");
      const generations = manifest.runtime.generations;
      if (!generations?.length) throw new Error("format-3 runtime generation lineage is absent; run update or repair");
      for (const generation of generations) {
        verifyRuntimeClosureAttestation(roots.installRoot, generation);
      }
      const releasePackagePath = join(
        roots.installRoot,
        ...manifest.runtime.closure.root.split("/"),
        "package.json",
      );
      const releasePackageBytes = readManagedFileNoFollow(roots.installRoot, releasePackagePath);
      if (!releasePackageBytes) throw new Error("attested release package metadata is absent");
      const releasePackage = JSON.parse(releasePackageBytes.toString("utf8")) as {
        version?: unknown;
        digest?: unknown;
      };
      if (releasePackage.version !== manifest.packageVersion || releasePackage.digest !== manifest.runtime.closure.digest) {
        throw new Error("manifest package identity does not match the attested release");
      }
      const markerPath = runtimeClosureMarkerPath(roots.installRoot, roots.layout, manifest.runtime.closure);
      const markerStat = lstatOrNull(markerPath);
      if (!markerStat || markerStat.isSymbolicLink() || !markerStat.isFile()) {
        throw new Error("runtime activation marker is missing or invalid");
      }
      const markerBytes = readManagedFileNoFollow(roots.installRoot, markerPath);
      if (!markerBytes || markerBytes.toString("utf8").trim() !== manifest.runtime.closure.digest) {
        throw new Error("runtime activation marker digest mismatch");
      }
      if (!manifest.grants) {
        throw new Error("format-3 advanced-grant state is absent; run update or repair");
      }
    }
    return {
      installed: true,
      packageVersion,
      path: manifestPath,
      healthy: true,
      issue: null,
      kiroBinaryPath,
      kiroCliVersion,
      kiroSha256,
    };
  } catch (error) {
    return {
      installed: true,
      packageVersion,
      path: manifestPath,
      healthy: false,
      issue: error instanceof Error ? error.message : String(error),
      kiroBinaryPath,
      kiroCliVersion,
      kiroSha256,
    };
  }
};

interface SetupStatus {
  node: NodeStatus;
  kiro: KiroCliStatus;
  scopes: { user: KiroScopeStatus; project: KiroScopeStatus };
}

const collectStatus = async (parsed: SetupArgs): Promise<SetupStatus> => {
  const scopes = {
    user: scopeStatusFor("user", parsed.projectRoot, parsed.kiroHome),
    project: scopeStatusFor("project", parsed.projectRoot, parsed.kiroHome),
  };
  const binary = parsed.kiroBinary ?? scopes.project.kiroBinaryPath ??
    scopes.user.kiroBinaryPath ?? "kiro-cli";
  const [node, kiro] = await Promise.all([
    inspectNodeCompatibility(process.execPath),
    inspectKiroCompatibility(binary),
  ]);
  return { node, kiro, scopes };
};

const describeKiroCli = (kiro: KiroCliStatus): string => {
  switch (kiro.state) {
    case "ok":
      return kiro.version + " (ok)";
    case "not-found":
      return "not found";
    case "exec-failure":
      return "version check failed";
    case "timeout":
      return "version check timed out";
    case "unparsable":
      return "unparsable version output";
    case "ambiguous":
      return "ambiguous version output";
    case "wrong-product":
      return "wrong product identity";
    case "prerelease":
      return kiro.version + " (prerelease is not certified)";
    case "older":
      return kiro.version + " (unsupported; requires " + KIRO_CLI_VERSION + ")";
    case "newer":
      return kiro.version + " (newer but uncertified; requires " + KIRO_CLI_VERSION + ")";
    case "not-executable":
      return "not an executable regular file";
    case "unsupported-launcher":
      return "unsupported launcher (require native executable or complete attested closure)";
  }
};

const describeScope = (label: string, scope: KiroScopeStatus): string => {
  if (scope.path === null) return label + ": unavailable";
  const where = " (" + scope.path + ")";
  if (!scope.installed) return label + ": not installed" + where;
  const version = scope.packageVersion ?? "unknown version";
  const health = scope.healthy ? "healthy" : "unhealthy: " + (scope.issue ?? "verification failed");
  return label + ": installed (kiro-fabric " + version + ", " + health + ")" + where;
};

const renderStatus = (status: SetupStatus): string => {
  const node = status.node.ok
    ? status.node.version + " (ok; " + status.node.executablePath + ")"
    : (status.node.version ?? status.node.state) +
      " (unsupported; requires stable >= " + MIN_NODE_MAJOR + ")";
  return [
    "node: " + node,
    "kiro-cli: " + describeKiroCli(status.kiro),
    describeScope("scope user", status.scopes.user),
    describeScope("scope project", status.scopes.project),
  ].join("\n");
};

const runStatus = async (parsed: SetupArgs): Promise<number> => {
  const status = await collectStatus(parsed);
  process.stdout.write(
    parsed.json ? JSON.stringify(status, null, 2) + "\n" : renderStatus(status) + "\n",
  );
  return 0;
};

interface SetupIo {
  confirm: (prompt: string) => Promise<boolean>;
}

const isInteractive = (): boolean =>
  process.stdin.isTTY === true && process.stdout.isTTY === true;

const needsConfirmation = (parsed: SetupArgs): boolean =>
  !parsed.yes && !parsed.dryRun;

const freshReadlineConfirm: SetupIo["confirm"] = async (prompt) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const cancel = (): void => {
    process.exit(130);
  };
  rl.on("SIGINT", cancel);
  try {
    const answer = await rl.question(prompt + " [y/N] ").catch(() => "");
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    process.removeListener("SIGINT", cancel);
    rl.close();
  }
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const resolveRoots = (parsed: SetupArgs): KiroInstallRoots =>
  resolveKiroInstallRoots({
    ...(parsed.user ? { scope: "user" as const } : {}),
    ...(parsed.projectRoot !== undefined ? { projectRoot: parsed.projectRoot } : {}),
    ...(parsed.kiroHome !== undefined ? { kiroHome: parsed.kiroHome } : {}),
  });

const ZERO_GRANTS: KiroManagedGrants = {
  allowShell: false,
  enableSubagents: false,
  allowTools: false,
};

const resolveDesiredGrants = (parsed: SetupArgs): KiroManagedGrants => {
  const updating = parsed.command === "update" || parsed.command === "repair";
  const previous = updating
    ? readManagedKiroGrants({
        ...(parsed.projectRoot !== undefined ? { projectRoot: parsed.projectRoot } : {}),
        ...(parsed.user ? { scope: "user" as const } : {}),
        ...(parsed.kiroHome !== undefined ? { kiroHome: parsed.kiroHome } : {}),
      })
    : null;
  const grants = { ...(parsed.resetGrants ? ZERO_GRANTS : previous ?? ZERO_GRANTS) };
  if (parsed.allowShell) grants.allowShell = true;
  if (parsed.enableSubagents) grants.enableSubagents = true;
  if (parsed.allowTools) grants.allowTools = true;
  if (parsed.revokeShell) {
    grants.allowShell = false;
    grants.enableSubagents = false;
  }
  if (parsed.revokeSubagents) grants.enableSubagents = false;
  if (parsed.revokeTools) grants.allowTools = false;
  if (grants.enableSubagents && !grants.allowShell) {
    throw new UsageError("the resulting --subagents grant requires --allow-shell");
  }
  return grants;
};

const buildInstallOptions = (parsed: SetupArgs): KiroInstallOptions => {
  // Install itself re-attests every owned byte. Only read the manifest tuple
  // needed to preserve the selected Kiro source here; running the full status
  // verifier first duplicated closure hashing and made no-op updates needlessly
  // pay for two complete installed-tree scans.
  let installedKiroBinary: string | undefined;
  if (parsed.kiroBinary === undefined) {
    const roots = resolveRoots(parsed);
    installedKiroBinary = readManifest(roots.installRoot, roots.layout)?.runtime.kiroBinaryPath;
  }
  const pinnedKiroBinary = parsed.kiroBinary ?? installedKiroBinary;
  const grants = resolveDesiredGrants(parsed);
  return {
    ...(parsed.projectRoot !== undefined ? { projectRoot: parsed.projectRoot } : {}),
    ...(parsed.user ? { scope: "user" as const } : {}),
    ...(parsed.kiroHome !== undefined ? { kiroHome: parsed.kiroHome } : {}),
    ...(pinnedKiroBinary !== undefined ? { kiroBinary: pinnedKiroBinary } : {}),
    ...(parsed.force || parsed.command === "repair" ? { force: true } : {}),
    ...(grants.allowShell ? { allowShell: true } : {}),
    ...(grants.enableSubagents ? { enableSubagents: true } : {}),
    ...(grants.allowTools ? { allowTools: true } : {}),
    ...(parsed.command === "update" || parsed.command === "repair" ? { repairRuntime: true } : {}),
    ...(process.env.KIRO_FABRIC_MCP_ENTRY
      ? { mcpEntryPath: process.env.KIRO_FABRIC_MCP_ENTRY }
      : {}),
  };
};

const renderGrantDiff = (before: KiroManagedGrants | null, after: KiroManagedGrants): string =>
  (Object.keys(after) as Array<keyof KiroManagedGrants>)
    .map((key) => `${key}: ${before?.[key] === true ? "on" : "off"} -> ${after[key] ? "on" : "off"}`)
    .join(", ");

const runInstall = async (parsed: SetupArgs, io: SetupIo): Promise<number> => {
  const command = parsed.command === "update" ? "update" : parsed.command === "repair" ? "repair" : "install";
  const roots = resolveRoots(parsed);
  if (command === "update" || command === "repair") {
    const transaction = managedPaths(roots.installRoot, roots.layout).transaction;
    if (existsSync(transaction)) {
      const recoveryLock = acquireOperationLock(roots.installRoot, roots.layout);
      try {
        // Grant preservation must observe the converged profile+manifest pair,
        // never pre-recovery bytes from an interrupted activation.
        recoverManagedTransaction(roots.installRoot, roots.layout);
      } finally {
        recoveryLock.release();
      }
    }
  }
  if ((command === "update" || command === "repair") && !existsSync(managedManifestPath(roots))) {
    throw new KiroInstallError("manifest", "no managed installation to " + command + "; run install first");
  }
  const installOptions = buildInstallOptions(parsed);
  const beforeGrants = command === "install"
    ? null
    : readManagedKiroGrants({
        ...(parsed.projectRoot !== undefined ? { projectRoot: parsed.projectRoot } : {}),
        ...(parsed.user ? { scope: "user" as const } : {}),
        ...(parsed.kiroHome !== undefined ? { kiroHome: parsed.kiroHome } : {}),
      });
  const afterGrants: KiroManagedGrants = {
    allowShell: installOptions.allowShell === true,
    enableSubagents: installOptions.enableSubagents === true,
    allowTools: installOptions.allowTools === true,
  };
  if (needsConfirmation(parsed)) {
    if (!isInteractive()) {
      throw new Error("refusing to " + command + " without a terminal; pass --yes to confirm");
    }
    const proceed = await io.confirm(
      "Proceed with " + command + " (" + roots.layout + " scope: " + roots.installRoot + ")" +
        "\n  grants: " + renderGrantDiff(beforeGrants, afterGrants) +
        (afterGrants.allowTools
          ? "\n  WARNING: fabric/fabric_exec is an auto-approved meta-capability that may invoke" +
            " every configured Fabric provider/tool; workspace access is confined to " + roots.projectRoot
          : "") +
        "?",
    );
    if (!proceed) throw new InteractiveCancelError("cancelled");
  }
  const result = await installKiroProfile({
    ...installOptions,
    dryRun: parsed.dryRun,
  });
  if (parsed.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    const verb = parsed.dryRun ? "planned" : command === "update" ? "updated" : command === "repair" ? "repaired" : "installed";
    process.stdout.write(
      verb + " (" + result.action + "): " + result.profilePath + "\n" +
        "sha256: " + result.profileSha256 + "\n" +
        "grants: " + renderGrantDiff(result.grants.before, result.grants.after) + "\n" +
        (result.backupPath ? "backup: " + result.backupPath + "\n" : ""),
    );
  }
  return 0;
};

const isUninstallNoop = (options: KiroUninstallOptions): boolean => {
  try {
    const plan = planKiroProfileUninstall(options);
    return plan.action === "noop" && !plan.needsProfileMutation && !plan.needsManifestRemoval;
  } catch {
    return false;
  }
};

const buildUninstallOptions = (parsed: SetupArgs): KiroUninstallOptions => ({
  ...(parsed.projectRoot !== undefined ? { projectRoot: parsed.projectRoot } : {}),
  ...(parsed.user ? { scope: "user" as const } : {}),
  ...(parsed.kiroHome !== undefined ? { kiroHome: parsed.kiroHome } : {}),
});

const runUninstall = async (parsed: SetupArgs, io: SetupIo): Promise<number> => {
  const options = buildUninstallOptions(parsed);
  if (needsConfirmation(parsed) && !isUninstallNoop(options)) {
    if (!isInteractive()) {
      throw new Error("refusing to uninstall without a terminal; pass --yes to confirm");
    }
    const roots = resolveRoots(parsed);
    const proceed = await io.confirm(
      "Proceed with uninstall (" +
        roots.layout +
        " scope: " +
        roots.installRoot +
        ")?",
    );
    if (!proceed) throw new InteractiveCancelError("cancelled");
  }
  const result = uninstallKiroProfile({ ...options, dryRun: parsed.dryRun });
  if (parsed.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    const verb = parsed.dryRun ? "planned" : "uninstalled";
    process.stdout.write(verb + " (" + result.action + "): " + result.profilePath + "\n");
    if (result.backupPath && result.action === "restore") {
      process.stdout.write("restored backup: " + result.backupPath + "\n");
    }
  }
  return 0;
};

const runDoctor = async (parsed: SetupArgs): Promise<number> => {
  const report = await runKiroDoctor({
    checkInstalled: true,
    ...(parsed.projectRoot !== undefined ? { projectRoot: parsed.projectRoot } : {}),
    ...(parsed.user ? { scope: "user" as const } : {}),
    ...(parsed.kiroHome !== undefined ? { kiroHome: parsed.kiroHome } : {}),
    ...(parsed.kiroBinary !== undefined ? { kiroBinary: parsed.kiroBinary } : {}),
  });
  if (parsed.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    for (const check of report.checks) {
      const marker = check.status === "pass" ? "ok" : check.status.toUpperCase();
      process.stdout.write(marker.padEnd(7) + " " + check.id + " — " + check.message + "\n");
    }
    process.stdout.write(
      "\n" +
        (report.ok ? "PASS" : "FAIL") +
        ": " +
        report.summary.passed +
        " passed, " +
        report.summary.failed +
        " failed, " +
        report.summary.skipped +
        " skipped (non-billable; 0 model turns)\n",
    );
  }
  return report.ok ? 0 : 1;
};

const SIGNAL_EXIT_CODES: Record<string, number> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
  SIGQUIT: 131,
};

const runLaunch = async (parsed: SetupArgs): Promise<number> => {
  const projectRoot = resolveKiroProjectRoot(parsed.projectRoot);
  const scopes = {
    project: scopeStatusFor("project", parsed.projectRoot, parsed.kiroHome),
    user: scopeStatusFor("user", parsed.projectRoot, parsed.kiroHome),
  };
  // An installed project scope always wins, including when unhealthy. Never
  // silently fall back to a broader user profile after project ownership fails.
  const selected = scopes.project.installed ? scopes.project : scopes.user;
  const selectedLabel = scopes.project.installed ? "project" : "user";
  if (!selected.installed) {
    throw new Error("refusing to launch: no managed Kiro installation is selected");
  }
  if (!selected.healthy || !selected.kiroBinaryPath || !selected.kiroSha256) {
    throw new Error(
      `refusing to launch: selected ${selectedLabel} installation is unhealthy` +
        (selected.issue ? `: ${selected.issue}` : ""),
    );
  }
  if (parsed.kiroBinary && !sameExecutableIdentity(parsed.kiroBinary, selected.kiroBinaryPath)) {
    throw new Error("refusing to launch a Kiro executable that differs from the selected managed artifact");
  }
  const identity = await assertSupportedKiro(selected.kiroBinaryPath);
  try {
    if (identity.sourcePath !== selected.kiroBinaryPath || identity.sha256 !== selected.kiroSha256) {
      throw new Error("refusing to launch a Kiro executable that differs from the managed manifest");
    }
    assertSupportedKiroUnchanged(identity);
    const child = spawn(identity.executablePath, LAUNCH_ARGS, {
      stdio: "inherit",
      cwd: projectRoot,
      detached: process.platform !== "win32",
    });
    const processTree = child.pid
      ? createProcessTreeController(child.pid, { ambientHelpers: false })
      : undefined;
    let interruptedCode: number | undefined;
    let escalation: Promise<unknown> | undefined;
    const forward = (signal: NodeJS.Signals, code: number): void => {
      interruptedCode ??= code;
      if (!processTree || processTree.gone()) return;
      if (escalation) {
        // A repeated signal requests escalation, but do not signal a process
        // group that completed between the two setup lifecycle events.
        if (!processTree.gone()) void processTree.terminate(0, 2_000);
        return;
      }
      escalation = processTree.signal(signal).then(async () => {
        if (processTree.gone()) return;
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        if (!processTree.gone()) await processTree.terminate(0, 2_000);
      }).catch(() => {
        // The child close/error outcome remains authoritative; forwarding is
        // best-effort and must not create an unhandled setup rejection.
      });
    };
    const onSighup = (): void => forward("SIGHUP", 129);
    const onSigint = (): void => forward("SIGINT", 130);
    const onSigterm = (): void => forward("SIGTERM", 143);
    const onSigquit = (): void => forward("SIGQUIT", 131);
    process.on("SIGHUP", onSighup);
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    process.on("SIGQUIT", onSigquit);
    const outcome = await new Promise<{ code: number } | { missing: boolean }>(
      (resolvePromise) => {
        child.once("error", (error: NodeJS.ErrnoException) => {
          resolvePromise({ missing: error.code === "ENOENT" });
        });
        child.once("close", (code, signal) => {
          resolvePromise({
            code: interruptedCode ??
              (signal !== null ? SIGNAL_EXIT_CODES[signal] ?? 128 : code ?? 1),
          });
        });
      },
    ).finally(async () => {
      process.removeListener("SIGHUP", onSighup);
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      process.removeListener("SIGQUIT", onSigquit);
      if (interruptedCode !== undefined && processTree && !processTree.gone()) {
        await processTree.terminate(0, 2_000);
      }
      await escalation;
    });
    if ("missing" in outcome) {
      throw new Error(outcome.missing ? "managed Kiro execution artifact disappeared" : "failed to launch managed Kiro");
    }
    return outcome.code;
  } finally {
    identity.dispose();
  }
};

const MENU_TEXT =
  ["", "Actions:", "  1) install", "  2) update", "  3) repair", "  4) uninstall", "  5) doctor", "  6) launch", "  q) quit", ""].join(
    "\n",
  );

const runMenuAction = async (action: () => Promise<number>): Promise<void> => {
  try {
    await action();
  } catch (error) {
    process.stderr.write("kiro-fabric: " + errorMessage(error) + "\n");
  }
};

const runMenu = async (parsed: SetupArgs): Promise<number> => {
  const cancel = (): void => {
    process.stdout.write("\n");
    process.exit(130);
  };
  process.on("SIGINT", cancel);
  let rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", cancel);
  const menuIo: SetupIo = {
    confirm: async (prompt) => {
      const answer = await rl.question(prompt + " [y/N] ").catch(() => "");
      const normalized = answer.trim().toLowerCase();
      return normalized === "y" || normalized === "yes";
    },
  };
  try {
    for (;;) {
      const status = await collectStatus(parsed);
      process.stdout.write(renderStatus(status) + "\n" + MENU_TEXT);
      const rawChoice = await rl.question("select [1-6, q]: ").catch(() => null);
      if (rawChoice === null) return 0;
      const choice = rawChoice.trim().toLowerCase();
      switch (choice) {
        case "":
          continue;
        case "1":
          await runMenuAction(() => runInstall({ ...parsed, command: "install" }, menuIo));
          break;
        case "2":
          await runMenuAction(() => runInstall({ ...parsed, command: "update" }, menuIo));
          break;
        case "3":
          await runMenuAction(() => runInstall({ ...parsed, command: "repair" }, menuIo));
          break;
        case "4":
          await runMenuAction(() => runUninstall({ ...parsed, command: "uninstall" }, menuIo));
          break;
        case "5":
          await runMenuAction(() => runDoctor({ ...parsed, command: "doctor" }));
          break;
        case "6":
          // kiro-cli needs the terminal; drop back to cooked mode while it runs.
          // The launch supervisor owns signals until the complete child tree exits.
          rl.close();
          process.removeListener("SIGINT", cancel);
          let launchCode: number | undefined;
          try {
            launchCode = await runLaunch({ ...parsed, command: "launch" });
          } catch (error) {
            process.stderr.write(`kiro-fabric: ${errorMessage(error)}\n`);
          } finally {
            process.on("SIGINT", cancel);
            rl = createInterface({ input: process.stdin, output: process.stdout });
            rl.on("SIGINT", cancel);
          }
          if (launchCode !== undefined && launchCode >= 128) return launchCode;
          break;
        case "q":
        case "quit":
          return 0;
        default:
          process.stdout.write("unknown choice: " + choice + "\n");
          break;
      }
    }
  } finally {
    process.removeListener("SIGINT", cancel);
    rl.close();
  }
};

const writeSetupFailure = (
  json: boolean,
  error: unknown,
  fallbackCode = "setup",
): void => {
  const message = errorMessage(error);
  if (json) {
    const code = error instanceof KiroInstallError ? error.code
      : error instanceof UsageError ? "usage"
      : fallbackCode;
    process.stdout.write(JSON.stringify({ ok: false, error: { code, message } }, null, 2) + "\n");
  } else {
    process.stderr.write("kiro-fabric: " + message + "\n");
  }
};

export const runKiroSetup = async (argv: string[]): Promise<number> => {
  const jsonRequested = argv.includes("--json");
  let parsed: SetupArgs;
  try {
    parsed = parseSetupArgs(argv);
  } catch (error) {
    writeSetupFailure(jsonRequested, error, "usage");
    if (!jsonRequested) process.stderr.write("\n" + USAGE);
    return 2;
  }

  if (parsed.command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }

  if (parsed.command === "menu") {
    if (!isInteractive()) {
      process.stderr.write(
        "kiro-fabric: the interactive menu requires a TTY; pass a command instead\n\n" +
          USAGE,
      );
      return 2;
    }
    return runMenu(parsed);
  }

  const io: SetupIo = { confirm: freshReadlineConfirm };
  try {
    switch (parsed.command) {
      case "status":
        return await runStatus(parsed);
      case "install":
      case "update":
      case "repair":
        return await runInstall(parsed, io);
      case "uninstall":
        return await runUninstall(parsed, io);
      case "doctor":
        return await runDoctor(parsed);
      case "launch":
        return await runLaunch(parsed);
    }
  } catch (error) {
    writeSetupFailure(parsed.json, error);
    return error instanceof UsageError ? 2
      : error instanceof InteractiveCancelError ? 130
      : 1;
  }
  return 2;
};
