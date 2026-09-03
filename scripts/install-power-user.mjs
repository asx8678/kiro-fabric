#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digestPowerPackage, validatePowerPackage } from "./validate-power-package.mjs";

export const USER_POWER_NAME = "kiro-fabric";
const OWNER_FILE = ".kiro-fabric-power-owner.json";
const OWNER_PRODUCT = "kiro-fabric-power-user-install";
const LOCK_NAME = ".kiro-fabric-install.lock";
const STEERING_FILE = "kiro-fabric-power-always.md";
const STEERING_MARKER = "kiro-fabric-power-user-install";
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const lstat = (target) => {
  try { return fs.lstatSync(target); }
  catch (error) { if (error?.code === "ENOENT") return undefined; throw error; }
};
const identity = (stats) => ({ dev: stats.dev, ino: stats.ino });
const sameIdentity = (stats, expected) => stats.dev === expected.dev && stats.ino === expected.ino;
const ownedDirectory = (stats) => stats.isDirectory() && !stats.isSymbolicLink() &&
  (typeof process.getuid !== "function" || stats.uid === process.getuid()) &&
  (process.platform === "win32" || (stats.mode & 0o022) === 0);
const privateOwnedDirectory = (stats) => ownedDirectory(stats) &&
  (process.platform === "win32" || (stats.mode & 0o077) === 0);

const ensurePrivateDirectory = (directory) => {
  const existing = lstat(directory);
  if (!existing) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stats = fs.lstatSync(directory);
  if (!ownedDirectory(stats)) throw new Error(`Kiro Power install directory must be current-user-owned, non-writable, and not a symlink: ${directory}`);
  if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
  const secured = fs.lstatSync(directory);
  return { path: fs.realpathSync(directory), identity: identity(secured) };
};

export const resolveKiroHome = (env = process.env, home = homedir()) => {
  const raw = typeof env.KIRO_HOME === "string" ? env.KIRO_HOME.trim() : "";
  const candidate = path.resolve(raw || path.join(home, ".kiro"));
  const existing = lstat(candidate);
  if (existing && !ownedDirectory(existing)) throw new Error(`KIRO_HOME must be a current-user-owned, non-writable directory and not a symlink: ${candidate}`);
  return candidate;
};

export const resolveUserPowerRoot = (env = process.env, home = homedir()) =>
  path.join(resolveKiroHome(env, home), "powers", USER_POWER_NAME);

const readOwner = (destination) => {
  const ownerPath = path.join(destination, OWNER_FILE);
  const stats = lstat(ownerPath);
  if (!stats?.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size > 4_096) return undefined;
  try { return JSON.parse(fs.readFileSync(ownerPath, "utf8")); } catch { return undefined; }
};

const copyPrivateTree = (source, destination) => {
  const stats = fs.lstatSync(source);
  if (stats.isSymbolicLink()) throw new Error(`Power package contains a symlink: ${source}`);
  if (stats.isDirectory()) {
    fs.mkdirSync(destination, { mode: 0o700 });
    for (const entry of fs.readdirSync(source).sort()) copyPrivateTree(path.join(source, entry), path.join(destination, entry));
    fs.chmodSync(destination, 0o700);
    return;
  }
  if (!stats.isFile() || stats.nlink !== 1) throw new Error(`Power package contains an unsupported entry: ${source}`);
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  if (process.platform !== "win32") fs.chmodSync(destination, 0o600);
};

const normalizeOwnedPowerTree = (directory) => {
  const owner = readOwner(directory);
  const rootStats = fs.lstatSync(directory);
  if (!ownedDirectory(rootStats) || owner?.schemaVersion !== 1 || owner.product !== OWNER_PRODUCT) {
    throw new Error(`Refusing to replace an unowned Kiro Power installation: ${directory}`);
  }
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      const stats = fs.lstatSync(target);
      if (stats.isSymbolicLink() || (typeof process.getuid === "function" && stats.uid !== process.getuid()) ||
          (process.platform !== "win32" && (stats.mode & 0o022) !== 0)) {
        throw new Error(`Refusing unsafe Kiro-managed Power entry: ${target}`);
      }
      if (entry.isDirectory()) { visit(target); if (process.platform !== "win32") fs.chmodSync(target, 0o700); }
      else if (entry.isFile() && stats.nlink === 1) { if (process.platform !== "win32") fs.chmodSync(target, 0o600); }
      else throw new Error(`Refusing unsupported Kiro-managed Power entry: ${target}`);
    }
  };
  visit(directory);
  if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
  return owner;
};

const fsyncDirectory = (directory) => {
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(directory, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
};

const acquireLock = (parent) => {
  const lock = path.join(parent, LOCK_NAME);
  fs.mkdirSync(lock, { mode: 0o700 });
  const token = randomBytes(24).toString("hex");
  const owner = path.join(lock, "owner.json");
  fs.writeFileSync(owner, `${JSON.stringify({ pid: process.pid, token })}\n`, { mode: 0o600, flag: "wx" });
  return { path: lock, token, lock: identity(fs.lstatSync(lock)), owner: identity(fs.lstatSync(owner)) };
};

const releaseLock = (held) => {
  try {
    const ownerPath = path.join(held.path, "owner.json");
    const lockStats = fs.lstatSync(held.path); const ownerStats = fs.lstatSync(ownerPath);
    const marker = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
    if (!sameIdentity(lockStats, held.lock) || !sameIdentity(ownerStats, held.owner) || marker.pid !== process.pid || marker.token !== held.token) return;
    fs.unlinkSync(ownerPath); fs.rmdirSync(held.path);
  } catch (error) { if (error?.code !== "ENOENT") throw error; }
};

export const installPowerPackage = (stagingRoot, requestedDestination = resolveUserPowerRoot()) => {
  if (process.platform !== "linux" && process.platform !== "darwin") throw new Error(`User-global Power installation requires Linux or macOS (received ${process.platform})`);
  const staged = validatePowerPackage(stagingRoot);
  const source = fs.realpathSync(stagingRoot);
  const requested = path.resolve(requestedDestination);
  if (path.basename(requested) !== USER_POWER_NAME) throw new Error(`Power destination must end in ${USER_POWER_NAME}: ${requested}`);
  const parentInfo = ensurePrivateDirectory(path.dirname(requested));
  const destination = path.join(parentInfo.path, USER_POWER_NAME);
  const held = acquireLock(parentInfo.path);
  const token = `${process.pid}-${randomBytes(16).toString("hex")}`;
  const temporary = path.join(parentInfo.path, `.${USER_POWER_NAME}-installing-${token}`);
  const backup = path.join(parentInfo.path, `.${USER_POWER_NAME}-backup-${token}`);
  let temporaryIdentity;
  let backupActive = false;
  try {
    const parentNow = fs.lstatSync(parentInfo.path);
    if (!sameIdentity(parentNow, parentInfo.identity) || !privateOwnedDirectory(parentNow)) throw new Error("Kiro Power install parent changed during installation");
    const existing = lstat(destination);
    if (existing) {
      const owner = normalizeOwnedPowerTree(destination);
      const installed = validatePowerPackage(destination);
      if (owner.packageDigest !== installed.digest) throw new Error(`Installed Kiro Power ownership digest mismatch: ${destination}`);
    }
    fs.mkdirSync(temporary, { mode: 0o700 });
    temporaryIdentity = identity(fs.lstatSync(temporary));
    for (const entry of fs.readdirSync(source).sort()) copyPrivateTree(path.join(source, entry), path.join(temporary, entry));
    fs.writeFileSync(path.join(temporary, OWNER_FILE), `${JSON.stringify({ schemaVersion: 1, product: OWNER_PRODUCT, packageDigest: staged.digest }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    const copied = validatePowerPackage(temporary);
    const copiedDigest = digestPowerPackage(temporary, { excludeOwner: true });
    if (copied.digest !== staged.digest || copiedDigest.digest !== staged.digest || copied.files !== staged.files || copied.bytes !== staged.bytes) {
      throw new Error("Installed Kiro Power does not match the staged package");
    }
    if (existing) { fs.renameSync(destination, backup); backupActive = true; }
    try { fs.renameSync(temporary, destination); temporaryIdentity = undefined; }
    catch (error) {
      if (backupActive && !lstat(destination)) { fs.renameSync(backup, destination); backupActive = false; }
      throw error;
    }
    fsyncDirectory(parentInfo.path);
    if (backupActive) { validatePowerPackage(backup); fs.rmSync(backup, { recursive: true }); backupActive = false; }
    return { ...copied, root: destination, source: staged.root };
  } finally {
    try {
      const current = fs.lstatSync(temporary);
      if (temporaryIdentity && sameIdentity(current, temporaryIdentity)) fs.rmSync(temporary, { recursive: true });
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
    releaseLock(held);
  }
};

const readControlJson = (file, fallback) => {
  const stats = lstat(file);
  if (!stats) return fallback;
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size > 1024 * 1024 ||
      (typeof process.getuid === "function" && stats.uid !== process.getuid()) ||
      (process.platform !== "win32" && (stats.mode & 0o022) !== 0)) {
    throw new Error(`Refusing unsafe Kiro Power control file: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

const writePrivateFile = (file, content) => {
  const parent = ensurePrivateDirectory(path.dirname(file)).path;
  const destination = path.join(parent, path.basename(file));
  const temporary = path.join(parent, `.${path.basename(file)}-${process.pid}-${randomBytes(12).toString("hex")}`);
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
    const descriptor = fs.openSync(temporary, "r");
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, destination);
    fsyncDirectory(parent);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
};

const writeControlJson = (file, value) => writePrivateFile(file, `${JSON.stringify(value, null, 2)}\n`);

const installAlwaysSteering = (kiroHome) => {
  const source = path.join(REPOSITORY_ROOT, "steering", "kiro-fabric-always.md");
  const sourceStats = fs.lstatSync(source);
  if (!sourceStats.isFile() || sourceStats.isSymbolicLink() || sourceStats.nlink !== 1 || sourceStats.size > 64 * 1024) {
    throw new Error(`Kiro Fabric steering source is unsafe: ${source}`);
  }
  const body = `${fs.readFileSync(source, "utf8").trimEnd()}\n`;
  if (!body.startsWith("---\ninclusion: always\n---\n")) throw new Error("Kiro Fabric steering must be always included");
  const digest = createHash("sha256").update(body).digest("hex");
  const marker = `<!-- ${STEERING_MARKER}:v1:${digest} -->\n`;
  const destination = path.join(kiroHome, "steering", STEERING_FILE);
  const existing = lstat(destination);
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1 || existing.size > 64 * 1024 ||
        (typeof process.getuid === "function" && existing.uid !== process.getuid()) ||
        (process.platform !== "win32" && (existing.mode & 0o022) !== 0)) {
      throw new Error(`Refusing unsafe Kiro Fabric steering file: ${destination}`);
    }
    const current = fs.readFileSync(destination, "utf8");
    const match = current.match(/\n<!-- kiro-fabric-power-user-install:v1:([a-f0-9]{64}) -->\n$/u);
    const currentBody = match ? current.slice(0, match.index + 1) : "";
    const currentDigest = createHash("sha256").update(currentBody).digest("hex");
    if (!match || match[1] !== currentDigest) throw new Error(`Refusing to replace unowned or modified Kiro Fabric steering: ${destination}`);
  }
  writePrivateFile(destination, `${body}${marker}`);
  return destination;
};

const registerInstalledPower = (kiroHome, sourceRoot) => {
  const powersRoot = ensurePrivateDirectory(path.join(kiroHome, "powers")).path;
  const registryFile = path.join(powersRoot, "registries", "user-added.json");
  const installedFile = path.join(powersRoot, "installed.json");
  const registry = readControlJson(registryFile, { powers: [] });
  const installed = readControlJson(installedFile, { version: "1.0.0", installedPowers: [], dismissedAutoInstalls: [] });
  if (!registry || !Array.isArray(registry.powers)) throw new Error("Kiro user-added Power registry is malformed");
  if (!installed || !Array.isArray(installed.installedPowers) || !Array.isArray(installed.dismissedAutoInstalls)) {
    throw new Error("Kiro installed Power registry is malformed");
  }
  registry.powers = registry.powers.filter((entry) => entry?.name !== USER_POWER_NAME);
  registry.powers.push({
    name: USER_POWER_NAME,
    description: `Custom power from ${sourceRoot}`,
    source: { type: "local", path: sourceRoot },
  });
  installed.installedPowers = installed.installedPowers.filter((entry) => entry?.name !== USER_POWER_NAME);
  installed.installedPowers.push({ name: USER_POWER_NAME, registryId: "user-added" });
  writeControlJson(registryFile, registry);
  writeControlJson(installedFile, installed);
};

export const installUserPower = (stagingRoot = ".tmp/kiro-fabric-power", env = process.env, home = homedir()) => {
  const kiroHome = resolveKiroHome(env, home);
  const source = installPowerPackage(stagingRoot, path.join(kiroHome, "powers", USER_POWER_NAME));
  const active = installPowerPackage(stagingRoot, path.join(kiroHome, "powers", "installed", USER_POWER_NAME));
  registerInstalledPower(kiroHome, source.root);
  const steeringFile = installAlwaysSteering(kiroHome);
  return { ...source, activeRoot: active.root, steeringFile };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = installUserPower(process.argv[2]);
    process.stdout.write(`${JSON.stringify(result)}\nInstalled and registered Kiro Fabric at ${result.activeRoot}\nInstalled always-on steering at ${result.steeringFile}\n`);
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
