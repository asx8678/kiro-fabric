// Setup console for the Kiro integration:
//
//   kiro-fabric-setup status | install | update | uninstall | doctor | launch
//
// Bare invocation on a TTY shows a numbered menu; non-interactive bare
// invocation prints usage. install/update delegate to installKiroProfile,
// uninstall to uninstallKiroProfile, doctor to runKiroDoctor — no ownership,
// backup, or symlink logic lives here. launch execs kiro-cli by argv.
//
// Exit codes: 0 success/noop/dry-run · 1 failure · 2 usage · 130 interactive cancel.

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";

import { runKiroDoctor } from "./doctor.js";
import { resolveKiroInstallRoots, type KiroInstallRoots } from "./home.js";
import {
  installKiroProfile,
  resolveKiroProjectRoot,
  type KiroInstallOptions,
} from "./install.js";
import { KIRO_CLI_VERSION, kiroProfilePath } from "./profile.js";
import {
  planKiroProfileUninstall,
  uninstallKiroProfile,
  type KiroUninstallOptions,
} from "./uninstall.js";

const execFileAsync = promisify(execFile);

const MIN_NODE_MAJOR = 24;
const KIRO_CLI_VERSION_TIMEOUT_MS = 10_000;
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
    "  update                    Update an existing managed installation",
    "  uninstall                 Remove a managed profile or restore the backup",
    "  doctor                    Read-only non-billable health checks",
    "  launch                    Launch kiro-cli with the kiro-fabric agent",
    "",
    "Bare invocation on a TTY shows an interactive menu; otherwise this usage is",
    "printed. Advanced grants (allow-shell/subagents/allow-tools) default to off.",
    "",
    "Options:",
    "  --user                    Target the user Kiro home (~/.kiro) instead of <project>/.kiro",
    "  --project-root <dir>      Project root (default: cwd; never walks up)",
    "  --kiro-home <dir>         Kiro home for --user (default: $KIRO_HOME or ~/.kiro)",
    "  --kiro-binary <path>      Kiro CLI binary (default: kiro-cli)",
    "  --dry-run                 Validate and report without changing files",
    "  --yes                     Suppress confirmation prompts (never implies --force)",
    "  --force                   Install only: back up and replace unknown/modified profile content",
    "  --allow-tools             Trusted opt-in: auto-approve only fabric/fabric_exec",
    "  --json                    Machine-readable output (one JSON object on stdout)",
    "  -h, --help                Show this help",
    "",
    "Exit codes: 0 success · 1 failure · 2 usage · 130 interactive cancel.",
  ].join("\n") + "\n";

type SetupCommand =
  | "status"
  | "install"
  | "update"
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
  allowTools: boolean;
  user: boolean;
  projectRoot?: string;
  kiroHome?: string;
  kiroBinary?: string;
}

class UsageError extends Error {}

const baseArgs = (command: SetupCommand): SetupArgs => ({
  command,
  json: false,
  dryRun: false,
  yes: false,
  force: false,
  allowTools: false,
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
    command !== "uninstall" &&
    command !== "doctor" &&
    command !== "launch"
  ) {
    throw new UsageError("unknown command: " + command);
  }
  const mutating =
    command === "install" || command === "update" || command === "uninstall";
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
        parsed.json = true;
        break;
      case "--dry-run":
        if (!mutating) throw new UsageError("--dry-run is install/update/uninstall-only");
        parsed.dryRun = true;
        break;
      case "--yes":
        if (!mutating) throw new UsageError("--yes is install/update/uninstall-only");
        parsed.yes = true;
        break;
      case "--force":
        if (command !== "install") throw new UsageError("--force is install-only");
        parsed.force = true;
        break;
      case "--allow-tools":
        if (command !== "install" && command !== "update") {
          throw new UsageError("--allow-tools is install/update-only");
        }
        parsed.allowTools = true;
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
  return parsed;
};

interface NodeStatus {
  version: string;
  ok: boolean;
}

const detectNodeStatus = (nodeVersion: string): NodeStatus => {
  const major = Number.parseInt(nodeVersion.split(".")[0] ?? "", 10);
  return {
    version: nodeVersion,
    ok: Number.isInteger(major) && major >= MIN_NODE_MAJOR,
  };
};

type KiroCliState =
  | "ok"
  | "not-found"
  | "exec-failure"
  | "timeout"
  | "unparsable"
  | "multiple-versions"
  | "unsupported";

interface KiroCliStatus {
  state: KiroCliState;
  version: string | null;
}

const VERSION_TOKEN = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/g;

const versionParts = (version: string): [number, number, number] => {
  const [base = ""] = version.split(/[-+]/);
  const part = (raw: string | undefined): number => {
    const parsed = Number.parseInt(raw ?? "", 10);
    return Number.isInteger(parsed) ? parsed : 0;
  };
  const [rawMajor, rawMinor, rawPatch] = base.split(".");
  return [part(rawMajor), part(rawMinor), part(rawPatch)];
};

const compareKiroVersion = (version: string): number => {
  const [major, minor, patch] = versionParts(version);
  const [pinMajor, pinMinor, pinPatch] = versionParts(KIRO_CLI_VERSION);
  if (major !== pinMajor) return major - pinMajor;
  if (minor !== pinMinor) return minor - pinMinor;
  return patch - pinPatch;
};

const classifyKiroVersionOutput = (output: string): KiroCliStatus => {
  const tokens = [...new Set(output.match(VERSION_TOKEN) ?? [])];
  if (tokens.length === 0) return { state: "unparsable", version: null };
  if (tokens.length > 1) return { state: "multiple-versions", version: null };
  const version = tokens[0]!;
  return compareKiroVersion(version) >= 0
    ? { state: "ok", version }
    : { state: "unsupported", version };
};

const detectKiroCli = async (binary = "kiro-cli"): Promise<KiroCliStatus> => {
  try {
    const { stdout } = await execFileAsync(binary, ["--version"], {
      timeout: KIRO_CLI_VERSION_TIMEOUT_MS,
    });
    return classifyKiroVersionOutput(stdout);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { killed?: boolean };
    if (failure.code === "ENOENT") return { state: "not-found", version: null };
    if (failure.killed === true) return { state: "timeout", version: null };
    return { state: "exec-failure", version: null };
  }
};

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
}

const UNAVAILABLE_SCOPE: KiroScopeStatus = {
  installed: false,
  packageVersion: null,
  path: null,
  healthy: false,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const profileDigest = (profilePath: string): string | null => {
  try {
    return createHash("sha256").update(readFileSync(profilePath)).digest("hex");
  } catch {
    return null;
  }
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
    return { installed: false, packageVersion: null, path: manifestPath, healthy: false };
  }
  let manifest: { packageVersion?: unknown; profile?: unknown };
  try {
    const raw: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest = isRecord(raw) ? raw : {};
  } catch {
    return { installed: true, packageVersion: null, path: manifestPath, healthy: false };
  }
  const profile = isRecord(manifest.profile) ? manifest.profile : undefined;
  const installedSha256 =
    typeof profile?.installedSha256 === "string" ? profile.installedSha256 : null;
  const packageVersion =
    typeof manifest.packageVersion === "string" ? manifest.packageVersion : null;
  let healthy = false;
  if (installedSha256 !== null) {
    healthy =
      profileDigest(kiroProfilePath(roots.installRoot, roots.layout)) === installedSha256;
  }
  return { installed: true, packageVersion, path: manifestPath, healthy };
};

interface SetupStatus {
  node: NodeStatus;
  kiro: KiroCliStatus;
  scopes: { user: KiroScopeStatus; project: KiroScopeStatus };
}

const collectStatus = async (parsed: SetupArgs): Promise<SetupStatus> => ({
  node: detectNodeStatus(process.versions.node),
  kiro: await detectKiroCli(parsed.kiroBinary),
  scopes: {
    user: scopeStatusFor("user", parsed.projectRoot, parsed.kiroHome),
    project: scopeStatusFor("project", parsed.projectRoot, parsed.kiroHome),
  },
});

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
    case "multiple-versions":
      return "multiple version tokens in version output";
    case "unsupported":
      return kiro.version + " (unsupported; requires " + KIRO_CLI_VERSION + ")";
  }
};

const describeScope = (label: string, scope: KiroScopeStatus): string => {
  if (scope.path === null) return label + ": unavailable";
  const where = " (" + scope.path + ")";
  if (!scope.installed) return label + ": not installed" + where;
  const version = scope.packageVersion ?? "unknown version";
  const health = scope.healthy ? "healthy" : "modified";
  return label + ": installed (kiro-fabric " + version + ", " + health + ")" + where;
};

const renderStatus = (status: SetupStatus): string => {
  const node = status.node.ok
    ? status.node.version + " (ok)"
    : status.node.version + " (unsupported; requires >= " + MIN_NODE_MAJOR + ")";
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

const buildInstallOptions = (parsed: SetupArgs): KiroInstallOptions => ({
  ...(parsed.projectRoot !== undefined ? { projectRoot: parsed.projectRoot } : {}),
  ...(parsed.user ? { scope: "user" as const } : {}),
  ...(parsed.kiroHome !== undefined ? { kiroHome: parsed.kiroHome } : {}),
  ...(parsed.kiroBinary !== undefined ? { kiroBinary: parsed.kiroBinary } : {}),
  ...(parsed.force ? { force: true } : {}),
  ...(parsed.allowTools ? { allowTools: true } : {}),
  // Test/distribution override agreed with tests/kiro-setup.test.ts: pin the
  // MCP entry when default resolution cannot run (see install.ts). Note the
  // deployed runtime closure takes precedence for default installs.
  ...(process.env.KIRO_FABRIC_MCP_ENTRY
    ? { mcpEntryPath: process.env.KIRO_FABRIC_MCP_ENTRY }
    : {}),
});

const runInstall = async (parsed: SetupArgs, io: SetupIo): Promise<number> => {
  const command = parsed.command === "update" ? "update" : "install";
  const roots = resolveRoots(parsed);
  if (command === "update" && !existsSync(managedManifestPath(roots))) {
    process.stderr.write(
      "kiro-fabric: no managed installation to update; run install first\n",
    );
    return 1;
  }
  if (needsConfirmation(parsed)) {
    if (!isInteractive()) {
      process.stderr.write(
        "kiro-fabric: refusing to " + command +
          " without a terminal; pass --yes to confirm\n",
      );
      return 1;
    }
    const proceed = await io.confirm(
      "Proceed with " +
        command +
        " (" +
        roots.layout +
        " scope: " +
        roots.installRoot +
        ")" +
        (parsed.allowTools
          ? "\n  This auto-approves fabric/fabric_exec without prompting, confined to " +
            roots.projectRoot
          : "") +
        "?",
    );
    if (!proceed) {
      process.stderr.write("kiro-fabric: cancelled\n");
      return 1;
    }
  }
  const result = await installKiroProfile({
    ...buildInstallOptions(parsed),
    dryRun: parsed.dryRun,
  });
  if (parsed.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    const verb = parsed.dryRun ? "planned" : command === "update" ? "updated" : "installed";
    process.stdout.write(
      verb +
        " (" +
        result.action +
        "): " +
        result.profilePath +
        "\n" +
        "sha256: " +
        result.profileSha256 +
        "\n" +
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
      process.stderr.write(
        "kiro-fabric: refusing to uninstall without a terminal; pass --yes to confirm\n",
      );
      return 1;
    }
    const roots = resolveRoots(parsed);
    const proceed = await io.confirm(
      "Proceed with uninstall (" +
        roots.layout +
        " scope: " +
        roots.installRoot +
        ")?",
    );
    if (!proceed) {
      process.stderr.write("kiro-fabric: cancelled\n");
      return 1;
    }
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

const kiroCliMissingGuidance = (binary: string): string =>
  "kiro-fabric: " +
    binary +
    " not found on PATH\n" +
    "install the Kiro CLI, then verify it with: " +
    binary +
    " --version\n";

const runLaunch = async (parsed: SetupArgs): Promise<number> => {
  const projectRoot = resolveKiroProjectRoot(parsed.projectRoot);
  const binary = parsed.kiroBinary ?? "kiro-cli";
  if ((await detectKiroCli(binary)).state === "not-found") {
    process.stderr.write(kiroCliMissingGuidance(binary));
    return 1;
  }
  const child = spawn(binary, LAUNCH_ARGS, { stdio: "inherit", cwd: projectRoot });
  const outcome = await new Promise<{ code: number } | { missing: boolean }>(
    (resolvePromise) => {
      child.once("error", (error: NodeJS.ErrnoException) => {
        resolvePromise({ missing: error.code === "ENOENT" });
      });
      child.once("close", (code, signal) => {
        resolvePromise({
          code: signal !== null ? SIGNAL_EXIT_CODES[signal] ?? 128 : code ?? 1,
        });
      });
    },
  );
  if ("missing" in outcome) {
    process.stderr.write(
      outcome.missing
        ? kiroCliMissingGuidance(binary)
        : "kiro-fabric: failed to launch " + binary + "\n",
    );
    return 1;
  }
  return outcome.code;
};

const MENU_TEXT =
  ["", "Actions:", "  1) install", "  2) update", "  3) uninstall", "  4) doctor", "  5) launch", "  q) quit", ""].join(
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
      const rawChoice = await rl.question("select [1-5, q]: ").catch(() => null);
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
          await runMenuAction(() => runUninstall({ ...parsed, command: "uninstall" }, menuIo));
          break;
        case "4":
          await runMenuAction(() => runDoctor({ ...parsed, command: "doctor" }));
          break;
        case "5":
          // kiro-cli needs the terminal; drop back to cooked mode while it runs.
          rl.close();
          await runMenuAction(() => runLaunch({ ...parsed, command: "launch" }));
          rl = createInterface({ input: process.stdin, output: process.stdout });
          rl.on("SIGINT", cancel);
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

export const runKiroSetup = async (argv: string[]): Promise<number> => {
  let parsed: SetupArgs;
  try {
    parsed = parseSetupArgs(argv);
  } catch (error) {
    process.stderr.write(
      "kiro-fabric: " + errorMessage(error) + "\n\n" + USAGE,
    );
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
        return await runInstall(parsed, io);
      case "uninstall":
        return await runUninstall(parsed, io);
      case "doctor":
        return await runDoctor(parsed);
      case "launch":
        return await runLaunch(parsed);
    }
  } catch (error) {
    process.stderr.write("kiro-fabric: " + errorMessage(error) + "\n");
    return 1;
  }
  return 2;
};
