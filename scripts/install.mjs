#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { generateAgentProfile } from "./agent-profile.mjs";

const AST_GREP_VERSION = "0.45.3";
const LAYOUT = ["app", "tools", "resources"];
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const usage = `Usage: bash ./install.sh [options]

  --kiro-home PATH     Kiro home (default: $KIRO_HOME or ~/.kiro)
  --guidance MODE      standard (default), review or minimal
  --uninstall          Remove the app, launcher and agent profile; keep data
  -h, --help           Show this help
`;

class InstallError extends Error {}

const parseArguments = (argv) => {
  const options = { guidance: "standard", uninstall: false, help: false, node: undefined, kiroHome: undefined };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new InstallError(`${argument} requires a value`);
      return next;
    };
    if (argument === "--kiro-home") options.kiroHome = value();
    else if (argument === "--guidance") options.guidance = value();
    else if (argument === "--node") options.node = value();
    else if (argument === "--uninstall") options.uninstall = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new InstallError(`Unknown option: ${argument}\n\n${usage}`);
  }
  if (!["standard", "review", "minimal"].includes(options.guidance)) throw new InstallError("--guidance must be standard, review or minimal");
  return options;
};

const privateDirectory = (directory) => {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) {
    throw new InstallError(`Refusing to use ${directory}: not a directory owned by the current user`);
  }
  fs.chmodSync(directory, 0o700);
  return fs.realpathSync(directory);
};

const findOnPath = (name) => {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* keep searching */ }
  }
  return undefined;
};

const astGrepSource = () => {
  const target = `${process.platform}-${process.arch}${process.platform === "linux" ? "-gnu" : ""}`;
  const name = `@ast-grep/cli-${target}`;
  let manifest;
  try { manifest = createRequire(path.join(repository, "package.json")).resolve(`${name}/package.json`); }
  catch { throw new InstallError(`${name} is not installed; run pnpm install on a supported platform (macOS or glibc Linux, x64 or arm64)`); }
  const binary = path.join(path.dirname(manifest), "ast-grep");
  const version = execFileSync(binary, ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
  if (version !== `ast-grep ${AST_GREP_VERSION}`) throw new InstallError(`Expected ast-grep ${AST_GREP_VERSION}, found ${version}`);
  return binary;
};

const copyTree = (source, target) => {
  const stat = fs.lstatSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { mode: 0o700 });
    for (const name of fs.readdirSync(source).sort()) copyTree(path.join(source, name), path.join(target, name));
  } else if (stat.isFile()) {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, 0o600);
  } else throw new InstallError(`Unsupported file in build output: ${source}`);
};

const writeAtomic = (file, content, mode) => {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(8).toString("hex")}.tmp`);
  fs.writeFileSync(temporary, content, { mode, flag: "wx" });
  fs.renameSync(temporary, file);
};

const removeOwnedTree = (target) => {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new InstallError(`Refusing to remove unexpected entry: ${target}`);
  if (fs.existsSync(path.join(target, ".git"))) throw new InstallError(`Refusing to remove a Git repository: ${target}`);
  fs.rmSync(target, { recursive: true });
};

const launcherScript = (kiroHome) => `#!/bin/sh
# Start Kiro with the Fabric agent, bound to the current directory.
set -eu
if [ "\${1:-}" = start ]; then shift; fi
KIRO_HOME='${kiroHome.replaceAll("'", "'\\''")}'
KIRO_FABRIC_LAUNCH_WORKSPACE=$(pwd -P)
export KIRO_HOME KIRO_FABRIC_LAUNCH_WORKSPACE
exec kiro-cli --v3 --agent kiro-fabric "$@"
`;

const isOurProfile = (file, root) => {
  try {
    const profile = JSON.parse(fs.readFileSync(file, "utf8"));
    const entry = profile?.mcpServers?.fabric?.args?.[0];
    return profile?.name === "kiro-fabric" && typeof entry === "string" && entry.startsWith(root + path.sep);
  } catch { return false; }
};

const install = (options, kiroHome) => {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 24) throw new InstallError(`Node >=24 is required (found ${process.version})`);
  const nodePath = options.node ?? process.execPath;
  if (!path.isAbsolute(nodePath)) throw new InstallError("--node must be an absolute path");
  const rg = findOnPath("rg");
  if (!rg) throw new InstallError("ripgrep (rg) is required; install it (for example: brew install ripgrep) and rerun");
  if (!findOnPath("kiro-cli")) process.stderr.write("Warning: kiro-cli was not found on PATH; install the Kiro CLI before starting Fabric.\n");
  const closure = path.join(repository, "dist", "kiro-agent-closure");
  if (!fs.existsSync(path.join(closure, "kiro", "mcp-entry.js"))) throw new InstallError("Build output is missing; run pnpm run build first");
  const parser = astGrepSource();

  const root = privateDirectory(path.join(kiroHome, "kiro-fabric"));
  const data = privateDirectory(path.join(root, "data"));
  const staging = path.join(root, `.staging-${randomBytes(8).toString("hex")}`);
  const retired = path.join(root, `.previous-${randomBytes(8).toString("hex")}`);
  fs.mkdirSync(staging, { mode: 0o700 });
  try {
    copyTree(closure, path.join(staging, "app"));
    fs.mkdirSync(path.join(staging, "tools"), { mode: 0o700 });
    fs.copyFileSync(parser, path.join(staging, "tools", "ast-grep"));
    fs.chmodSync(path.join(staging, "tools", "ast-grep"), 0o700);
    fs.mkdirSync(path.join(staging, "resources", "steering"), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(staging, "resources", "skills"), { mode: 0o700 });
    copyTree(path.join(repository, "skills", "fabric-exec"), path.join(staging, "resources", "skills", "fabric-exec"));
    copyTree(path.join(repository, "resources", "steering", "fabric.md"), path.join(staging, "resources", "steering", "fabric.md"));

    fs.mkdirSync(retired, { mode: 0o700 });
    for (const name of LAYOUT) {
      if (fs.existsSync(path.join(root, name))) fs.renameSync(path.join(root, name), path.join(retired, name));
      fs.renameSync(path.join(staging, name), path.join(root, name));
    }
  } finally {
    removeOwnedTree(staging);
  }
  removeOwnedTree(retired);

  const bin = privateDirectory(path.join(root, "bin"));
  writeAtomic(path.join(bin, "kiro-fabric"), launcherScript(kiroHome), 0o700);

  const agents = privateDirectory(path.join(kiroHome, "agents"));
  const profileFile = path.join(agents, "kiro-fabric.json");
  const profile = generateAgentProfile({
    nodePath,
    runtimeRoot: path.join(root, "app"),
    dataRoot: data,
    skillPath: path.join(root, "resources", "skills", "fabric-exec", "SKILL.md"),
    steeringPath: path.join(root, "resources", "steering", "fabric.md"),
    astGrepPath: path.join(root, "tools", "ast-grep"),
    searchPath: [...new Set([path.dirname(rg), "/usr/bin", "/bin"])].join(path.delimiter),
    guidanceMode: options.guidance,
  });
  const content = `${JSON.stringify(profile, null, 2)}\n`;
  if (fs.existsSync(profileFile) && fs.readFileSync(profileFile, "utf8") !== content) {
    const backups = privateDirectory(path.join(root, "backups"));
    const backup = path.join(backups, `kiro-fabric.json.${new Date().toISOString().replaceAll(":", "-")}`);
    fs.copyFileSync(profileFile, backup, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(backup, 0o600);
    process.stdout.write(`Previous agent profile backed up to ${backup}\n`);
  }
  writeAtomic(profileFile, content, 0o600);

  const version = JSON.parse(fs.readFileSync(path.join(root, "app", "package.json"), "utf8")).version;
  process.stdout.write(`Kiro Fabric ${version} installed in ${root}
Agent profile: ${profileFile}
Node: ${nodePath} (${process.version})   ripgrep: ${rg}   ast-grep: ${AST_GREP_VERSION}
Data (preserved): ${data}

Start from your project directory with:
  ${path.join(bin, "kiro-fabric")}
Restart any running Kiro Fabric sessions to pick up this version.
`);
  const legacy = ["runtime", "manager", "install-owner.json", ".transactions"].filter(name => fs.existsSync(path.join(root, name)));
  if (legacy.length) {
    process.stdout.write(`\nFiles from the previous installer are no longer used: ${legacy.map(name => path.join(root, name)).join(", ")}
Remove them once no older Kiro Fabric session is running.
`);
  }
};

const uninstall = (kiroHome) => {
  const root = path.join(kiroHome, "kiro-fabric");
  if (!fs.existsSync(root)) { process.stdout.write(`Nothing installed in ${root}\n`); return; }
  const profileFile = path.join(kiroHome, "agents", "kiro-fabric.json");
  if (fs.existsSync(profileFile)) {
    if (isOurProfile(profileFile, fs.realpathSync(root))) fs.unlinkSync(profileFile);
    else process.stdout.write(`Left ${profileFile} in place: it does not point at this installation\n`);
  }
  for (const name of [...LAYOUT, "bin"]) removeOwnedTree(path.join(root, name));
  process.stdout.write(`Kiro Fabric removed. Data kept in ${path.join(root, "data")}\n`);
};

const main = () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { process.stdout.write(usage); return 0; }
  if (process.getuid?.() === 0) throw new InstallError("Do not run the installer as root");
  const selected = options.kiroHome ?? process.env.KIRO_HOME ?? path.join(os.homedir(), ".kiro");
  if (!path.isAbsolute(selected)) throw new InstallError("--kiro-home must be an absolute path");
  const kiroHome = privateDirectory(selected);
  if (options.uninstall) uninstall(kiroHome);
  else install(options, kiroHome);
  return 0;
};

try { process.exitCode = main(); }
catch (error) {
  process.stderr.write(`Kiro Fabric: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
