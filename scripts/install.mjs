#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { generateAgentProfile } from "./agent-profile.mjs";
import { verifyBuildClosure, verifyClosureIntegrity } from "./build-inputs.mjs";
import { captureDirectoryAncestry, readDirectoryBoundedSync } from "../src/installation/filesystem-boundary.mjs";
import { inspectOwnedTree, lstat, removeOwnedTree } from "./owned-tree.mjs";

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
  directory = path.resolve(directory);
  const parent = path.dirname(directory);
  if (!lstat(parent)) privateDirectory(parent);
  const guard = captureDirectoryAncestry(parent, { allowMacAliases: true });
  directory = path.join(guard.root, path.basename(directory));
  guard.check();
  if (!lstat(directory)) fs.mkdirSync(directory, { mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) {
    throw new InstallError(`Refusing to use ${directory}: not a directory owned by the current user`);
  }
  return captureDirectoryAncestry(directory).root;
};

const executableDirectory = (directory) => {
  const canonical = fs.realpathSync(directory);
  for (let current = canonical;; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    const sticky = stat.uid === 0 && (stat.mode & 0o1000);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.uid !== 0 && stat.uid !== process.getuid?.()) || ((stat.mode & 0o002) && (current === canonical || !sticky))) throw new InstallError(`Untrusted executable directory: ${current}`);
    if (current === path.dirname(current)) break;
  }
  return canonical;
};

const executableDirectories = (nodePath) => {
  const directories = [path.dirname(nodePath)];
  for (const directory of [...(process.env.PATH ?? "").split(path.delimiter), "/usr/bin", "/bin"]) {
    if (!path.isAbsolute(directory) || /[\u0000-\u001f\u007f]/u.test(directory)) continue;
    try {
      directories.push(executableDirectory(directory));
    } catch { continue; }
  }
  return [...new Set(directories)];
};

const trustedExecutable = (candidate) => {
  const file = fs.realpathSync(candidate);
  executableDirectory(path.dirname(file));
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || (stat.mode & 0o022) || (stat.uid !== 0 && stat.uid !== process.getuid?.())) throw new InstallError(`Untrusted executable: ${candidate}`);
  fs.accessSync(file, fs.constants.X_OK);
  return file;
};

const findOnPath = (name, directories) => {
  for (const directory of directories) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, name);
    try {
      return trustedExecutable(candidate);
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

const launcherScript = (kiroHome) => `#!/bin/sh
set -eu
if [ "\${1:-}" = start ]; then shift; fi
KIRO_HOME='${kiroHome.replaceAll("'", "'\\''")}'
KIRO_FABRIC_LAUNCH_WORKSPACE=$(pwd -P)
export KIRO_HOME KIRO_FABRIC_LAUNCH_WORKSPACE
if [ "\${1:-}" = chat ]; then
  shift
  exec kiro-cli chat --v3 --agent kiro-fabric "$@"
fi
exec kiro-cli --v3 --agent kiro-fabric "$@"
`;

const isOurProfile = (file, root) => {
  try {
    const profile = JSON.parse(fs.readFileSync(file, "utf8"));
    const entry = profile?.mcpServers?.fabric?.args?.[0];
    return profile?.name === "kiro-fabric" && entry === path.join(root, "app", "kiro", "mcp-entry.js");
  } catch { return false; }
};

const verifyResources = (root, manifest) => {
  const expected = new Map(manifest.buildInputs.files.filter(entry => entry.path.startsWith("skills/fabric-exec/") || entry.path === "resources/steering/fabric.md")
    .map(entry => [entry.path.startsWith("skills/") ? entry.path : entry.path.slice("resources/".length), entry.sha256]));
  const resources = path.join(root, "resources");
  const files = JSON.parse(inspectOwnedTree(resources)).filter(entry => !entry.directory).map(entry => entry.name.split(path.sep).join("/"));
  if (files.length !== expected.size || !expected.has("skills/fabric-exec/SKILL.md") || !expected.has("steering/fabric.md")) throw new InstallError("Installed resource inventory does not match build inputs");
  for (const file of files) {
    if (createHash("sha256").update(fs.readFileSync(path.join(resources, file))).digest("hex") !== expected.get(file)) throw new InstallError(`Installed resource does not match build inputs: ${file}`);
  }
};

const inspectInstallation = (root) => {
  const snapshots = new Map();
  if (!lstat(root)) return snapshots;
  const guard = captureDirectoryAncestry(root);
  if (fs.lstatSync(root).uid !== process.getuid?.() || readDirectoryBoundedSync(root, 20_000).some(name => name.toLowerCase() === ".git")) throw new InstallError(`Refusing unowned installation or repository: ${root}`);
  for (const name of [...LAYOUT, "bin"]) {
    const target = path.join(root, name);
    if (!lstat(target)) continue;
    if (!lstat(target).isDirectory()) throw new InstallError(`Refusing unexpected installation entry: ${target}`);
    snapshots.set(target, inspectOwnedTree(target));
  }
  if (snapshots.size) {
    const app = path.join(root, "app");
    if (!snapshots.has(app) || JSON.parse(fs.readFileSync(path.join(app, "package.json"), "utf8")).name !== "kiro-fabric-agent-runtime") throw new InstallError(`Refusing unowned installation contents: ${root}`);
    const manifest = verifyClosureIntegrity(app);
    if (snapshots.has(path.join(root, "resources"))) verifyResources(root, manifest);
    for (const [name, allowed] of Object.entries({ tools: ["ast-grep", "rg"], bin: ["kiro-fabric"] })) {
      if (snapshots.has(path.join(root, name)) && fs.readdirSync(path.join(root, name)).some(entry => !allowed.includes(entry) || !lstat(path.join(root, name, entry)).isFile())) throw new InstallError(`Refusing unexpected installation contents: ${path.join(root, name)}`);
    }
  }
  guard.check();
  return snapshots;
};

const inspectProfile = (file) => {
  if (!lstat(file)) return null;
  if (!lstat(file).isFile()) throw new InstallError(`Refusing unexpected agent profile: ${file}`);
  return inspectOwnedTree(file);
};

const checkSnapshots = (snapshots) => {
  for (const [file, snapshot] of snapshots) {
    if ((lstat(file) ? inspectOwnedTree(file) : null) !== snapshot) throw new InstallError(`Installation changed; preserve ${file}`);
  }
};

const cleanup = (target) => {
  if (!lstat(target)) return;
  try { removeOwnedTree(target); }
  catch (error) { process.stderr.write(`Retained ${target}: ${error.message}\n`); }
};

const publish = (entries, retired, guards) => {
  const moves = [];
  const move = (from, to) => {
    for (const guard of guards) guard.check();
    if (lstat(to)) throw new InstallError(`Publication destination already exists: ${to}`);
    const identity = lstat(from);
    fs.renameSync(from, to);
    moves.push({ from, to, identity });
  };
  try {
    for (const [source, destination, name] of entries) {
      if (lstat(destination)) move(destination, path.join(retired, name));
      if (source) move(source, destination);
    }
  } catch (error) {
    try {
      for (const { from, to, identity } of moves.reverse()) {
        for (const guard of guards) guard.check();
        if (lstat(from)) throw new InstallError(`Rollback destination already exists: ${from}`);
        const current = lstat(to);
        if (!current || current.dev !== identity.dev || current.ino !== identity.ino) throw new InstallError(`Rollback source changed: ${to}`);
        fs.renameSync(to, from);
      }
    } catch (rollbackError) {
      throw new InstallError(`Publication failed (${error.message}); rollback failed (${rollbackError.message}). Recovery files preserved in ${retired}`, { cause: rollbackError });
    }
    throw error;
  }
};

const withInstallationLock = (kiroHome, action) => {
  const guard = captureDirectoryAncestry(kiroHome), lock = path.join(kiroHome, ".kiro-fabric-install.lock");
  guard.check();
  let descriptor;
  try { descriptor = fs.openSync(lock, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if (error.code === "EEXIST") throw new InstallError(`Installation lock exists: ${lock}; another install/uninstall may be running`);
    throw error;
  }
  const identity = fs.fstatSync(descriptor, { bigint: true });
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, root: path.join(kiroHome, "kiro-fabric") })}\n`);
    return action();
  } finally {
    fs.closeSync(descriptor);
    guard.check();
    const current = lstat(lock);
    if (!current?.isFile() || current.dev !== identity.dev || current.ino !== identity.ino || current.uid !== identity.uid || current.nlink !== 1n) throw new InstallError(`Installation lock changed; preserved ${lock}`);
    fs.unlinkSync(lock);
  }
};

const install = (options, kiroHome) => {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 24) throw new InstallError(`Node >=24 is required (found ${process.version})`);
  if (!path.isAbsolute(options.node ?? process.execPath)) throw new InstallError("--node must be an absolute path");
  const nodePath = trustedExecutable(options.node ?? process.execPath);
  const nodeVersion = execFileSync(nodePath, ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
  if (!/^v\d+\.\d+\.\d+$/u.test(nodeVersion) || Number(nodeVersion.slice(1).split(".")[0]) < 24) throw new InstallError(`Node >=24 is required (found ${nodeVersion})`);
  const directories = executableDirectories(nodePath);
  const rg = findOnPath("rg", directories);
  if (!rg) throw new InstallError("ripgrep (rg) is required; install it (for example: brew install ripgrep) and rerun");
  if (!findOnPath("kiro-cli", directories)) process.stderr.write("Warning: kiro-cli was not found on PATH; install the Kiro CLI before starting Fabric.\n");
  const closure = path.join(repository, "dist", "kiro-agent-closure");
  if (!fs.existsSync(path.join(closure, "kiro", "mcp-entry.js"))) throw new InstallError("Build output is missing; run pnpm run build first");
  inspectOwnedTree(closure);
  const manifest = verifyBuildClosure(repository, closure);
  inspectOwnedTree(path.join(repository, "skills", "fabric-exec"));
  inspectOwnedTree(path.join(repository, "resources", "steering", "fabric.md"));
  const parser = astGrepSource();

  const snapshots = inspectInstallation(path.join(kiroHome, "kiro-fabric"));
  const root = privateDirectory(path.join(kiroHome, "kiro-fabric"));
  const agents = privateDirectory(path.join(kiroHome, "agents"));
  const profileFile = path.join(agents, "kiro-fabric.json");
  snapshots.set(profileFile, inspectProfile(profileFile));
  for (const name of [...LAYOUT, "bin"]) if (!snapshots.has(path.join(root, name))) snapshots.set(path.join(root, name), null);
  const guards = [captureDirectoryAncestry(root), captureDirectoryAncestry(agents)];
  const data = privateDirectory(path.join(root, "data"));
  const staging = path.join(root, `.staging-${randomBytes(8).toString("hex")}`);
  const retired = path.join(root, `.previous-${randomBytes(8).toString("hex")}`);
  const bin = path.join(root, "bin");
  let publishing = false, published = false;
  let version;
  fs.mkdirSync(staging, { mode: 0o700 });
  try {
    copyTree(closure, path.join(staging, "app"));
    fs.mkdirSync(path.join(staging, "tools"), { mode: 0o700 });
    for (const [source, name] of [[parser, "ast-grep"], [rg, "rg"]]) {
      fs.copyFileSync(source, path.join(staging, "tools", name), fs.constants.COPYFILE_EXCL);
      fs.chmodSync(path.join(staging, "tools", name), 0o700);
    }
    fs.mkdirSync(path.join(staging, "resources", "steering"), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(staging, "resources", "skills"), { mode: 0o700 });
    copyTree(path.join(repository, "skills", "fabric-exec"), path.join(staging, "resources", "skills", "fabric-exec"));
    copyTree(path.join(repository, "resources", "steering", "fabric.md"), path.join(staging, "resources", "steering", "fabric.md"));

    fs.mkdirSync(path.join(staging, "bin"), { mode: 0o700 });
    fs.writeFileSync(path.join(staging, "bin", "kiro-fabric"), launcherScript(kiroHome), { mode: 0o700, flag: "wx" });
    const profile = generateAgentProfile({
      nodePath,
      runtimeRoot: path.join(root, "app"),
      dataRoot: data,
      skillPath: path.join(root, "resources", "skills", "fabric-exec", "SKILL.md"),
      steeringPath: path.join(root, "resources", "steering", "fabric.md"),
      astGrepPath: path.join(root, "tools", "ast-grep"),
      searchPath: [path.join(root, "tools"), ...directories].join(path.delimiter),
      guidanceMode: options.guidance,
    });
    const content = `${JSON.stringify(profile, null, 2)}\n`;
    fs.writeFileSync(path.join(staging, "profile.json"), content, { mode: 0o600, flag: "wx" });
    const stagedManifest = verifyBuildClosure(repository, path.join(staging, "app"));
    if (stagedManifest.contentDigest !== manifest.contentDigest || stagedManifest.buildInputs.digest !== manifest.buildInputs.digest) throw new InstallError("Build changed during staging");
    verifyResources(staging, manifest);
    const stagedRuntime = path.join(staging, "app");
    const entries = ["kiro/mcp-entry.js", "runtime/compiler-worker-entry.js", "runtime/sandbox-worker-entry.js", "fovea/engine-entry.js"];
    execFileSync(nodePath, ["--input-type=module", "-e", 'import { pathToFileURL } from "node:url"; const files = process.argv.splice(1); for (const file of files) await import(pathToFileURL(file).href);', ...entries.map(file => path.join(stagedRuntime, file))], { timeout: 30_000, stdio: "pipe" });
    const rgVersion = execFileSync(path.join(staging, "tools", "rg"), ["--no-config", "--version"], { encoding: "utf8", env: { LANG: "C.UTF-8", LC_ALL: "C" }, timeout: 5000 });
    if (!/^ripgrep \d+\.\d+/u.test(rgVersion)) throw new InstallError("Staged ripgrep validation failed");
    const parserVersion = execFileSync(path.join(staging, "tools", "ast-grep"), ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
    if (parserVersion !== `ast-grep ${AST_GREP_VERSION}`) throw new InstallError("Staged ast-grep validation failed");
    execFileSync("/bin/sh", ["-n", path.join(staging, "bin", "kiro-fabric")], { timeout: 5000 });
    version = JSON.parse(fs.readFileSync(path.join(stagedRuntime, "package.json"), "utf8")).version;
    inspectOwnedTree(staging);
    checkSnapshots(snapshots);
    for (const guard of guards) guard.check();
    if (lstat(profileFile) && fs.readFileSync(profileFile, "utf8") !== content) {
      const backups = privateDirectory(path.join(root, "backups"));
      const backup = path.join(backups, `kiro-fabric.json.${new Date().toISOString().replaceAll(":", "-")}.${randomBytes(4).toString("hex")}`);
      fs.copyFileSync(profileFile, backup, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(backup, 0o600);
      process.stdout.write(`Previous agent profile backed up to ${backup}\n`);
    }
    fs.mkdirSync(retired, { mode: 0o700 });
    publishing = true;
    publish([...LAYOUT, "bin"].map(name => [path.join(staging, name), path.join(root, name), name])
      .concat([[path.join(staging, "profile.json"), profileFile, "profile.json"]]), retired, [...guards, captureDirectoryAncestry(staging), captureDirectoryAncestry(retired)]);
    published = true;
  } finally {
    if (!publishing || published) cleanup(staging);
    if (published) cleanup(retired);
  }
  process.stdout.write(`Kiro Fabric ${version} installed in ${root}
Agent profile: ${profileFile}
Node: ${nodePath} (${nodeVersion})   ripgrep: ${rg}   ast-grep: ${AST_GREP_VERSION}
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
  if (!lstat(root)) { process.stdout.write(`Nothing installed in ${root}\n`); return; }
  const snapshots = inspectInstallation(root);
  const guards = [captureDirectoryAncestry(root)];
  const profileFile = path.join(kiroHome, "agents", "kiro-fabric.json");
  const entries = [...snapshots.keys()].map(target => [null, target, path.basename(target)]);
  if (lstat(path.dirname(profileFile))) {
    guards.push(captureDirectoryAncestry(path.dirname(profileFile)));
    snapshots.set(profileFile, inspectProfile(profileFile));
  }
  if (lstat(profileFile)) {
    if (isOurProfile(profileFile, root)) entries.push([null, profileFile, "profile.json"]);
    else process.stdout.write(`Left ${profileFile} in place: it does not point at this installation\n`);
  }
  checkSnapshots(snapshots);
  for (const guard of guards) guard.check();
  const retired = path.join(root, `.previous-${randomBytes(8).toString("hex")}`);
  fs.mkdirSync(retired, { mode: 0o700 });
  publish(entries, retired, [...guards, captureDirectoryAncestry(retired)]);
  cleanup(retired);
  process.stdout.write(`Kiro Fabric removed. Data kept in ${path.join(root, "data")}\n`);
};

const main = () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { process.stdout.write(usage); return 0; }
  if (process.getuid?.() === 0) throw new InstallError("Do not run the installer as root");
  const selected = options.kiroHome ?? process.env.KIRO_HOME ?? path.join(os.homedir(), ".kiro");
  if (!path.isAbsolute(selected)) throw new InstallError("--kiro-home must be an absolute path");
  const kiroHome = privateDirectory(selected);
  withInstallationLock(kiroHome, () => {
    if (options.uninstall) uninstall(kiroHome);
    else install(options, kiroHome);
  });
  return 0;
};

try { process.exitCode = main(); }
catch (error) {
  process.stderr.write(`Kiro Fabric: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
