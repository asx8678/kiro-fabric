export type OutputFormat = "json" | "text";

export interface Args {
  command?: string;
  file?: string;
  format: OutputFormat;
  cwd: string;
  compact: boolean;
  force: boolean;
  dryRun: boolean;
  topic?: string;
  smoke: boolean;
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
    smoke: false,
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
    } else if (option === "--compact") {
      out.compact = true;
    } else if (option === "--force") {
      out.force = true;
    } else if (option === "--dry-run") {
      out.dryRun = true;
    } else if (option === "--smoke") {
      out.smoke = true;
    } else if (!option.startsWith("--")) {
      out.topic = out.topic ? `${out.topic} ${option}` : option;
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }
  return out;
}