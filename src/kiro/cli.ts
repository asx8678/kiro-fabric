// Management CLI for the Kiro integration:
//
//   kiro-fabric install kiro [--project-root DIR] [--user] [--kiro-home DIR] [--allow-shell] [--subagents] [--allow-tools] [--dry-run] [--force] [--json]
//   kiro-fabric uninstall kiro [--project-root DIR] [--user] [--kiro-home DIR] [--dry-run] [--json]
//   kiro-fabric doctor kiro [--json]
//
// Exit codes: 0 success · 1 diagnosis/install/uninstall failure · 2 usage error.

import type { KiroInstallOptions } from "./install.js";
import { KiroInstallError, readPackageVersion } from "./managed.js";

const USAGE = `kiro-fabric — Kiro integration management

Usage:
  kiro-fabric --version
  kiro-fabric install kiro [options]     Install the managed Kiro v3 profile
  kiro-fabric uninstall kiro [options]   Remove a managed profile or restore the backup
  kiro-fabric doctor kiro [options]      Read-only non-billable Strict health checks
  kiro-fabric doctor power [options]     Read-only non-billable Power package checks
  kiro-fabric mcp --integration <mode>   Start the protocol-clean MCP server

Install options:
  --project-root <dir>   Install identity/fallback root (default: cwd; never walks up)
  --user                 Install into the user Kiro home (~/.kiro), not <project>/.kiro
  --kiro-home <dir>      Kiro home for --user (default: $KIRO_HOME or ~/.kiro)
  --kiro-binary <path>   Kiro CLI binary (default: kiro-cli)
  --allow-shell          Trusted-local opt-in: allow k.bash without elicitation
  --subagents            Enable bounded ACP fan-out (requires --allow-shell)
  --allow-tools          Trusted-local opt-in: auto-approve @fabric/fabric_exec
  --dry-run              Validate and report without changing files
  --force                Back up and replace unknown/modified profile content
  --json                 Machine-readable output
  --debug                Include stack traces in human-readable failures
  --version              Print the package version
  -h, --help

Uninstall options:
  --project-root <dir>
  --user
  --kiro-home <dir>
  --dry-run
  --json

Doctor options:
  --project-root <dir>
  --user
  --kiro-home <dir>
  --kiro-binary <path>
  --json
`;

interface ParsedArgs {
  command: "install" | "uninstall" | "doctor" | "help";
  json: boolean;
  dryRun: boolean;
  force: boolean;
  user: boolean;
  allowShell: boolean;
  enableSubagents: boolean;
  allowTools: boolean;
  projectRoot?: string;
  kiroHome?: string;
  kiroBinary?: string;
}

class UsageError extends Error {}

const parseArgs = (argv: string[]): ParsedArgs => {
  if (
    argv.length === 0 ||
    argv[0] === "--help" ||
    argv[0] === "-h" ||
    argv[0] === "help"
  ) {
    return { command: "help", json: false, dryRun: false, force: false, user: false, allowShell: false, enableSubagents: false, allowTools: false };
  }
  const [command, scope, ...rest] = argv;
  if (
    (command !== "install" && command !== "uninstall" && command !== "doctor") ||
    scope !== "kiro"
  ) {
    throw new UsageError(`unknown command: ${argv.slice(0, 2).join(" ")}`);
  }
  const parsed: ParsedArgs = { command, json: false, dryRun: false, force: false, user: false, allowShell: false, enableSubagents: false, allowTools: false };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    const value = (): string => {
      const next = rest[++i];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError(`missing value for ${flag}`);
      }
      return next;
    };
    switch (flag) {
      case "--json":
        parsed.json = true;
        break;
      case "--dry-run":
        if (command !== "install" && command !== "uninstall") {
          throw new UsageError("--dry-run is install/uninstall-only");
        }
        parsed.dryRun = true;
        break;
      case "--force":
        if (command !== "install") throw new UsageError("--force is install-only");
        parsed.force = true;
        break;
      case "--allow-shell":
        if (command !== "install") throw new UsageError("--allow-shell is install-only");
        parsed.allowShell = true;
        break;
      case "--subagents":
        if (command !== "install") throw new UsageError("--subagents is install-only");
        parsed.enableSubagents = true;
        break;
      case "--allow-tools":
        if (command !== "install") throw new UsageError("--allow-tools is install-only");
        parsed.allowTools = true;
        break;
      case "--project-root":
        if (command !== "install" && command !== "uninstall" && command !== "doctor") {
          throw new UsageError("--project-root is only valid for Kiro lifecycle commands");
        }
        if (parsed.projectRoot !== undefined) throw new UsageError("duplicate --project-root");
        parsed.projectRoot = value();
        break;
      case "--user":
        if (command !== "install" && command !== "uninstall" && command !== "doctor") {
          throw new UsageError("--user is only valid for Kiro lifecycle commands");
        }
        parsed.user = true;
        break;
      case "--kiro-home":
        if (command !== "install" && command !== "uninstall" && command !== "doctor") {
          throw new UsageError("--kiro-home is only valid for Kiro lifecycle commands");
        }
        if (parsed.kiroHome !== undefined) throw new UsageError("duplicate --kiro-home");
        parsed.kiroHome = value();
        break;
      case "--kiro-binary":
        if (command === "uninstall") throw new UsageError("--kiro-binary is not valid for uninstall");
        if (parsed.kiroBinary !== undefined) throw new UsageError("duplicate --kiro-binary");
        parsed.kiroBinary = value();
        break;
      case "-h":
      case "--help":
        return { command: "help", json: false, dryRun: false, force: false, user: false, allowShell: false, enableSubagents: false, allowTools: false };
      default:
        throw new UsageError(`unknown option: ${flag}`);
    }
  }
  if (parsed.enableSubagents && !parsed.allowShell) {
    throw new UsageError("--subagents requires --allow-shell so children can run verification");
  }
  return parsed;
};

const runKiroCliUnsafe = async (argv: string[]): Promise<number> => {
  if (argv.length === 1 && argv[0] === "--version") {
    process.stdout.write(`${readPackageVersion()}\n`);
    return 0;
  }
  if (argv[0] === "mcp") {
    if (argv.includes("--help") || argv.includes("-h")) {
      process.stdout.write("Usage: kiro-fabric mcp --integration power|strict|internal-child\n");
      return 0;
    }
    if (argv.length !== 3 || argv[1] !== "--integration") {
      throw new UsageError("mcp requires --integration power|strict|internal-child");
    }
    const { parseKiroIntegrationMode } = await import("./integration-mode.js");
    let mode;
    try {
      mode = parseKiroIntegrationMode(argv[2], "--integration");
    } catch (error) {
      throw new UsageError(error instanceof Error ? error.message : String(error));
    }
    process.env.KIRO_FABRIC_INTEGRATION = mode;
    const { runKiroMcpProcess } = await import("./mcp-entry.js");
    return runKiroMcpProcess();
  }
  if (argv[0] === "doctor" && argv[1] === "power") {
    const rest = argv.slice(2);
    if (rest.includes("--help") || rest.includes("-h")) {
      process.stdout.write("Usage: kiro-fabric doctor power [--json] [--debug]\n");
      return 0;
    }
    if (rest.some((value) => value !== "--json")) {
      throw new UsageError("doctor power accepts only --json");
    }
    const { runKiroPowerDoctor } = await import("./power/diagnostics.js");
    const report = await runKiroPowerDoctor();
    if (rest.includes("--json")) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    else for (const check of report.checks) process.stdout.write(`${check.status === "pass" ? "ok" : check.status.toUpperCase()} ${check.id} — ${check.message}\n`);
    return report.ok ? 0 : 1;
  }
  const parsed = parseArgs(argv);

  if (parsed.command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }

  if (parsed.command === "doctor") {
    if (parsed.kiroHome && !parsed.user) {
      throw new UsageError("--kiro-home requires --user");
    }
    const { runKiroDoctor } = await import("./doctor.js");
    const report = await runKiroDoctor({
      checkInstalled: true,
      ...(parsed.projectRoot ? { projectRoot: parsed.projectRoot } : {}),
      ...(parsed.user ? { scope: "user" as const } : {}),
      ...(parsed.kiroHome ? { kiroHome: parsed.kiroHome } : {}),
      ...(parsed.kiroBinary ? { kiroBinary: parsed.kiroBinary } : {}),
    });
    if (parsed.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
      for (const check of report.checks) {
        const marker = check.status === "pass" ? "ok" : check.status.toUpperCase();
        process.stdout.write(`${marker.padEnd(7)} ${check.id} — ${check.message}\n`);
      }
      process.stdout.write(
        `\n${report.ok ? "PASS" : "FAIL"}: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped (non-billable; 0 model turns)\n`,
      );
    }
    return report.ok ? 0 : 1;
  }

  if (parsed.kiroHome && !parsed.user) {
    throw new UsageError("--kiro-home requires --user");
  }

  if (parsed.command === "uninstall") {
      const { uninstallKiroProfile } = await import("./uninstall.js");
      const result = uninstallKiroProfile({
        ...(parsed.projectRoot ? { projectRoot: parsed.projectRoot } : {}),
        ...(parsed.user ? { scope: "user" } : {}),
        ...(parsed.kiroHome ? { kiroHome: parsed.kiroHome } : {}),
        dryRun: parsed.dryRun,
      });
      if (parsed.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        const verb = parsed.dryRun ? "planned" : "uninstalled";
        process.stdout.write(`${verb} (${result.action}): ${result.profilePath}\n`);
        if (result.backupPath && result.action === "restore") {
          process.stdout.write(`restored backup: ${result.backupPath}\n`);
        }
      }
      return 0;
    }

    const options: KiroInstallOptions = {
      ...(parsed.projectRoot ? { projectRoot: parsed.projectRoot } : {}),
      ...(parsed.user ? { scope: "user" } : {}),
      ...(parsed.kiroHome ? { kiroHome: parsed.kiroHome } : {}),
      ...(parsed.kiroBinary ? { kiroBinary: parsed.kiroBinary } : {}),
      ...(parsed.force ? { force: true } : {}),
      ...(parsed.allowShell ? { allowShell: true } : {}),
      ...(parsed.enableSubagents ? { enableSubagents: true } : {}),
      ...(parsed.allowTools ? { allowTools: true } : {}),
    };
    const { installKiroProfile } = await import("./install.js");
    const result = await installKiroProfile({ ...options, dryRun: parsed.dryRun });
    if (parsed.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      const verb = parsed.dryRun ? "planned" : "installed";
      process.stdout.write(
        `${verb} (${result.action}): ${result.profilePath}\n` +
          `sha256: ${result.profileSha256}\n` +
          (result.backupPath ? `backup: ${result.backupPath}\n` : ""),
      );
    }
  return 0;
};

export const runKiroCli = async (argv: string[]): Promise<number> => {
  const debug = argv.includes("--debug");
  const cleaned = argv.filter((value) => value !== "--debug");
  const json = cleaned.includes("--json");
  try {
    return await runKiroCliUnsafe(cleaned);
  } catch (error) {
    const usage = error instanceof UsageError;
    const code = usage ? "usage" : error instanceof KiroInstallError ? error.code : "internal";
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message } }, null, 2)}\n`);
    } else {
      process.stderr.write(`kiro-fabric: ${message}\n`);
      if (debug && error instanceof Error && error.stack) {
        process.stderr.write(`${error.stack}\n`);
      }
      if (usage) process.stderr.write(`\n${USAGE}`);
    }
    return usage ? 2 : 1;
  }
};
