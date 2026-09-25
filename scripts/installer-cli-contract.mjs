// Built-in-only CLI contract shared by registration, validation, consent and help.
import path from "node:path";
/** @typedef {{command?: string, kiroHome?: string, archive?: string, version?: string, backup?: string, sourceRoot?: string, guidanceMode?: 'standard' | 'review' | 'minimal', yes?: boolean, nonInteractive?: boolean, json?: boolean, noColor?: boolean, verbose?: boolean, purgeData?: boolean, migratePiFabric?: boolean, noShellIntegration?: boolean, dryRun?: boolean, help?: boolean}} ManagerArguments */
export class InstallerError extends Error {
  constructor(message, exitCode = 5, outcome = "conflict") { super(message); this.exitCode = exitCode; this.outcome = outcome; }
}
export const display = value => String(value).replace(/[\u0000-\u001f\u007f]/gu, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).slice(0, 2000);
export const shellQuote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";

/** @type {Readonly<Record<string, {flag: string, value?: string, description: string}>>} */
const MANAGER_OPTIONS = Object.freeze({
  kiroHome: { flag: "--kiro-home", value: "PATH", description: "Absolute Kiro home (installed launcher remains bound to its own home)" },
  archive: { flag: "--from-archive", value: "PATH", description: "Offline signed archive with verified release sidecars; never bypasses trust" },
  version: { flag: "--version", value: "X.Y.Z", description: "Exact stable signed release version" },
  backup: { flag: "--backup", value: "PATH", description: "Configuration backup directory; restore missing files only, refuse existing targets, skip managed controls" },
  sourceRoot: { flag: "--source-root", value: "PATH", description: "Explicit absolute checkout to inspect as data only; never built or executed" },
  guidanceMode: { flag: "--guidance-mode", value: "MODE", description: "standard, review or minimal; no native tool expansion" },
  yes: { flag: "--yes", description: "Explicit mutation consent (mandatory for restore and recover)" },
  nonInteractive: { flag: "--non-interactive", description: "Never prompt; mutations require --yes" },
  verbose: { flag: "--verbose", description: "Stream build/subprocess output live and print per-stage detail; stdout stays result-only" },
  json: { flag: "--json", description: "One JSON result on stdout; no progress or prompts" },
  noColor: { flag: "--no-color", description: "Plain text output (the default)" },
  purgeData: { flag: "--purge-data", description: "Request purge; currently refused because process inactivity is unqualified" },
  migratePiFabric: { flag: "--migrate-pi-fabric", description: "Back up and replace a hash-verified legacy Pi Fabric profile; included by source installs; preserve skills and runtimes" },
  noShellIntegration: { flag: "--no-shell-integration", description: "Skip optional shell setup/removal" },
  dryRun: { flag: "--dry-run", description: "Read-only scope preview; no downloads, builds, client probes, backups or changes" },
  help: { flag: "--help", description: "Show generated command help without accessing the installation" },
});
const common = ["kiroHome", "json", "noColor", "nonInteractive", "verbose", "help"];
const mutation = [...common, "yes", "dryRun"];
/** @type {Readonly<Record<string, {description: string, options: readonly string[], confirmation: string, backup: boolean, kiro: string, preparation?: boolean, shell?: boolean}>>} */
export const MANAGER_COMMANDS = Object.freeze(Object.fromEntries(Object.entries({
  install: { description: "Install a verified signed release (source builds use the explicit checkout frontend)", options: [...mutation, "archive", "version", "migratePiFabric", "noShellIntegration"], confirmation: "interactive-or-yes", backup: true, kiro: "required", preparation: true, shell: true },
  update: { description: "Update from signed releases; source installations must use an explicitly selected checkout", options: [...mutation, "archive", "version", "noShellIntegration"], confirmation: "interactive-or-yes", backup: true, kiro: "required", preparation: true, shell: true },
  doctor: { description: "Inspect installation and optional explicit source/build identities; never repair", options: [...common, "sourceRoot"], confirmation: "none", backup: false, kiro: "diagnostic" },
  rollback: { description: "Activate a verified retained generation; preserve durable data", options: mutation, confirmation: "interactive-or-yes", backup: true, kiro: "required" },
  uninstall: { description: "Retire the managed profile; retain runtime generations and durable data", options: [...mutation, "purgeData", "noShellIntegration"], confirmation: "interactive-or-yes", backup: true, kiro: "none", shell: true },
  start: { description: "Launch only a verified active installation; forward the Kiro client exit code", options: ["kiroHome", "noColor", "guidanceMode", "help"], confirmation: "none", backup: false, kiro: "launch" },
  restore: { description: "Restore configuration without overwriting managed controls; requires --backup PATH --yes", options: [...mutation, "backup"], confirmation: "yes", backup: false, kiro: "none" },
  recover: { description: "Offline recovery of verified transaction evidence only; no new install, build or release lookup", options: mutation, confirmation: "yes", backup: false, kiro: "none" },
}).map(([name, spec]) => [name, Object.freeze({ ...spec, options: Object.freeze([...spec.options]) })])));

export function validateCommandOptions(result) {
  if (!result.command) {
    if (result.help) return;
    // Derive operation-only switches from the same registry as help/validation.
    for (const [name, value] of Object.entries(result)) {
      if (name === "command" || value === false || value === undefined) continue;
      const commands = Object.entries(MANAGER_COMMANDS).filter(([, spec]) => spec.options.includes(name)).map(([command]) => command);
      if (commands.length === 1) throw new InstallerError(`${MANAGER_OPTIONS[name].flag} requires an explicit ${commands[0]} command`, 2, "usage");
    }
    return;
  }
  const spec = MANAGER_COMMANDS[result.command];
  for (const [name, value] of Object.entries(result)) {
    if (name !== "command" && value !== false && value !== undefined && !spec.options.includes(name)) throw new InstallerError(`${result.command} does not accept ${MANAGER_OPTIONS[name]?.flag ?? name}`, 2, "usage");
  }
  if (result.help) return;
  if (result.command === "restore" && (!result.backup || !result.yes)) throw new InstallerError("restore requires --backup <backup-directory> --yes; no prompt or restore was attempted", 2, "usage");
  if (spec.confirmation === "yes" && !result.yes && !result.dryRun) throw new InstallerError(`${result.command} requires --yes; no prompt or mutation was attempted`, 2, "usage");
}
export function parseManagerArguments(argv) {
  /** @type {ManagerArguments} */
  const result = { command: undefined, ...Object.fromEntries(Object.entries(MANAGER_OPTIONS).map(([key, option]) => [key, option.value ? undefined : false])) };
  const seen = new Set(), names = Object.fromEntries(Object.entries(MANAGER_OPTIONS).map(([key, option]) => [option.flag, key]));
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--source") throw new InstallerError("Installed management never builds source. Run bash /path/to/checkout/install.sh --source explicitly.", 2, "usage");
    if (!arg.startsWith("--")) {
      if (result.command || !Object.hasOwn(MANAGER_COMMANDS, arg)) throw new InstallerError(`Expected exactly one command: ${Object.keys(MANAGER_COMMANDS).join(", ")}`, 2, "usage");
      result.command = arg; continue;
    }
    const name = names[arg];
    if (!name || seen.has(name)) throw new InstallerError(`Unknown or duplicate option: ${display(arg)}`, 2, "usage");
    seen.add(name);
    if (MANAGER_OPTIONS[name].value) {
      const value = argv[++index];
      if (!value || value.startsWith("--") || /[\u0000-\u001f\u007f]/u.test(value)) throw new InstallerError(`${arg} requires a safe value`, 2, "usage");
      result[name] = value;
    } else result[name] = true;
  }
  if (result.archive && result.version) throw new InstallerError("--from-archive and --version are mutually exclusive", 2, "usage");
  if (result.version && !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(result.version)) throw new InstallerError("--version requires an exact stable release version", 2, "usage");
  if (result.guidanceMode !== undefined && !["standard", "review", "minimal"].includes(result.guidanceMode)) throw new InstallerError("--guidance-mode requires standard, review or minimal", 2, "usage");
  if (result.sourceRoot && !path.isAbsolute(result.sourceRoot)) throw new InstallerError("--source-root requires an absolute path", 2, "usage");
  validateCommandOptions(result);
  return result;
}
/** @param {string | undefined} command */
export function managerHelp(command) {
  if (command && !Object.hasOwn(MANAGER_COMMANDS, command)) throw new InstallerError("Unknown help command", 2, "usage");
  /** @type {typeof MANAGER_COMMANDS} */
  const selected = command ? { [command]: MANAGER_COMMANDS[command] } : MANAGER_COMMANDS;
  const optionNames = new Set(Object.values(selected).flatMap(spec => spec.options));
  return { schemaVersion: 1, outcome: "help", exitCode: 0, usage: `kiro-fabric ${command ?? "<command>"} [options]`, commands: selected, options: Object.fromEntries([...optionNames].map(name => [name, MANAGER_OPTIONS[name]])), exits: { 0: "success (including read-only preview)", 2: "usage/consent", 3: "cancelled", 4: "prerequisite/source-build failure", 5: "conflict/diagnostic failure", 6: "busy", 7: "recovery or committed cleanup required", 8: "signed release discovery unavailable" }, qualification: "No native/authenticated qualification; source is not a signed release" };
}
export function formatManagerHelp(help) {
  return [help.usage, ...Object.entries(help.commands).map(([name, spec]) => `  ${name}: ${spec.description}`), "Options:", ...Object.values(help.options).map(option => `  ${option.flag}${option.value ? ` ${option.value}` : ""}: ${option.description}`), "Exit codes: " + Object.entries(help.exits).map(([code, meaning]) => `${code} ${meaning}`).join("; "), help.qualification].join("\n") + "\n";
}
