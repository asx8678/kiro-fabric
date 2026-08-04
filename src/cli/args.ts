export type OutputFormat = "json" | "text";
export type PermissionMode = "headless" | "interactive";
export type WriteAccessMode = "read" | "workspace";

export interface Args {
  command?: string;
  file?: string;
  format: OutputFormat;
  cwd: string;
  compact: boolean;
  force: boolean;
  dryRun: boolean;
  help: boolean;
  topic?: string;
  smoke: boolean;
  permissions: PermissionMode;
  writeAccess: WriteAccessMode;
}

function requiredValue(argv: string[], option: string): string {
  const value = argv.shift();
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function parseArgs(argv: string[], onFormat?: (format: OutputFormat) => void): Args {
  const remaining = [...argv];
  const out: Args = {
    format: "text",
    cwd: process.cwd(),
    compact: false,
    force: false,
    dryRun: false,
    help: false,
    smoke: false,
    permissions: "headless",
    writeAccess: "workspace",
  };
  const command = remaining.shift();
  if (command !== undefined) out.command = command;

  while (remaining.length) {
    const option = remaining.shift()!;
    if (option === "--file") {
      out.file = requiredValue(remaining, option);
    } else if (option === "--format") {
      const format = requiredValue(remaining, option);
      if (format !== "json" && format !== "text") {
        throw new Error(`Invalid --format value: ${format}; expected json or text`);
      }
      out.format = format;
      onFormat?.(format);
    } else if (option === "--cwd") {
      out.cwd = requiredValue(remaining, option);
    } else if (option === "--help" || option === "-h") {
      out.help = true;
    } else if (option === "--compact") {
      out.compact = true;
    } else if (option === "--force") {
      out.force = true;
    } else if (option === "--dry-run") {
      out.dryRun = true;
    } else if (option === "--smoke") {
      out.smoke = true;
    } else if (option === "--permissions") {
      const permissions = requiredValue(remaining, option);
      if (permissions !== "headless" && permissions !== "interactive") {
        throw new Error(
          `Invalid --permissions value: ${permissions}; expected headless or interactive`,
        );
      }
      out.permissions = permissions;
    } else if (option === "--allow-write") {
      const value = requiredValue(remaining, option);
      if (value !== "read" && value !== "workspace") {
        throw new Error(`Invalid --allow-write value: ${value}; expected read or workspace`);
      }
      out.writeAccess = value;
    } else if (!option.startsWith("-")) {
      out.topic = out.topic ? `${out.topic} ${option}` : option;
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }
  if (out.permissions !== "headless" && out.command !== "run" && out.command !== "exec") {
    throw new Error("--permissions is only supported for run and exec");
  }
  if (
    argv.includes("--allow-write") &&
    out.command !== "install-kiro" &&
    out.command !== "update-policy"
  ) {
    throw new Error("--allow-write is only supported for install-kiro and update-policy");
  }
  if (out.command === "update-policy" && !argv.includes("--allow-write")) {
    throw new Error(
      "update-policy requires --allow-write read or workspace to choose the destination mode",
    );
  }
  return out;
}
