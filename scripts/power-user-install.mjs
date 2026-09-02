#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digestPowerPackage, validatePowerPackage } from "./validate-power-package.mjs";

export const USER_POWER_NAME = "kiro-fabric";
const OWNER_FILE = ".kiro-fabric-power-owner.json";
const OWNER_PRODUCT = "kiro-fabric-power-export";
const STALE_EXPORT_LOCK_MS = 5 * 60_000;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const lstat = (target) => { try { return fs.lstatSync(target); } catch (error) { if (error?.code === "ENOENT") return undefined; throw error; } };

/** Reject aliases at every existing path component, then return the resolved spelling. */
export const inspectExportPath = (target) => {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const stats = lstat(cursor);
    if (!stats) break;
    if (stats.isSymbolicLink()) throw new Error(`refusing path alias: ${cursor}`);
    if (cursor !== absolute && !stats.isDirectory()) throw new Error(`export ancestor is not a directory: ${cursor}`);
  }
  return absolute;
};

const ensurePrivateDirectory = (directory) => {
  const absolute = inspectExportPath(directory);
  const parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const stats = lstat(cursor);
    const created = !stats;
    if (created) fs.mkdirSync(cursor, { mode: 0o700 });
    const current = fs.lstatSync(cursor);
    if (!current.isDirectory() || current.isSymbolicLink()) throw new Error(`export path is not a regular directory: ${cursor}`);
    if (created) fs.chmodSync(cursor, 0o700);
  }
  return fs.realpathSync(absolute);
};

export const resolveKiroHome = (env = process.env, home = homedir()) => {
  const candidate = typeof env.KIRO_HOME === "string" && env.KIRO_HOME.trim()
    ? path.resolve(env.KIRO_HOME.trim())
    : path.join(home, ".kiro");
  return inspectExportPath(candidate);
};
export const resolveUserPowerRoot = (env = process.env, home = homedir()) =>
  path.join(resolveKiroHome(env, home), "powers", USER_POWER_NAME);

const sourceIdentity = (sourceRoot) => createHash("sha256")
  .update("kiro-fabric-power-source-v1\0")
  .update(fs.realpathSync(sourceRoot))
  .digest("hex");
const ownerAt = (destination) => {
  const file = path.join(destination, OWNER_FILE);
  const stats = lstat(file);
  if (!stats?.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size > 4_096) return undefined;
  if (process.platform !== "win32" && (
    (typeof process.getuid === "function" && stats.uid !== process.getuid()) ||
    (stats.mode & 0o077) !== 0
  )) return undefined;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; }
};
const processIsAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
};
const releaseLock = (lock, identity) => {
  try {
    const current = fs.lstatSync(lock);
    if (current.isDirectory() && !current.isSymbolicLink() &&
        current.dev === identity.dev && current.ino === identity.ino) {
      fs.rmSync(lock, { recursive: true });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
};

const copyPrivateTree = (source, destination) => {
  const sourceStats = fs.lstatSync(source);
  if (sourceStats.isSymbolicLink()) throw new Error(`staged package contains a path alias: ${source}`);
  if (sourceStats.isDirectory()) {
    fs.mkdirSync(destination, { mode: 0o700 });
    fs.chmodSync(destination, 0o700);
    for (const entry of fs.readdirSync(source).sort()) copyPrivateTree(path.join(source, entry), path.join(destination, entry));
  } else if (sourceStats.isFile()) {
    const input = fs.openSync(source, "r");
    const output = fs.openSync(destination, "wx", 0o600);
    try {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let bytes;
      while ((bytes = fs.readSync(input, buffer, 0, buffer.length, null)) > 0) fs.writeSync(output, buffer, 0, bytes);
      fs.fsyncSync(output);
    } finally { fs.closeSync(input); fs.closeSync(output); }
    fs.chmodSync(destination, 0o600);
  } else throw new Error(`staged package contains an unsupported entry: ${source}`);
};

const acquireLock = async (lock, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const current = lstat(lock);
    if (current?.isSymbolicLink() || (current && !current.isDirectory())) throw new Error(`export lock is not a regular directory: ${lock}`);
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      const stats = fs.lstatSync(lock);
      const identity = { dev: stats.dev, ino: stats.ino };
      try {
        fs.writeFileSync(path.join(lock, "owner.json"), `${JSON.stringify({ pid: process.pid, startedAt: Date.now() })}\n`, { mode: 0o600, flag: "wx" });
      } catch (error) {
        releaseLock(lock, identity);
        throw error;
      }
      return identity;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let occupied;
      try { occupied = fs.lstatSync(lock); }
      catch (statError) { if (statError?.code === "ENOENT") continue; throw statError; }
      if (!occupied.isDirectory() || occupied.isSymbolicLink()) throw new Error(`export lock is not a regular directory: ${lock}`);
      if (Date.now() - occupied.mtimeMs > STALE_EXPORT_LOCK_MS) {
        let ownerPid = 0;
        try {
          const owner = JSON.parse(fs.readFileSync(path.join(lock, "owner.json"), "utf8"));
          if (typeof owner.pid === "number") ownerPid = owner.pid;
        } catch { /* malformed dead locks remain subject to identity checks */ }
        if (!processIsAlive(ownerPid)) {
          const latest = fs.lstatSync(lock);
          if (latest.dev === occupied.dev && latest.ino === occupied.ino && latest.isDirectory() && !latest.isSymbolicLink()) {
            fs.rmSync(lock, { recursive: true });
            continue;
          }
        }
      }
      if (Date.now() >= deadline) throw new Error("timed out waiting for concurrent Power export");
      await sleep(25);
    }
  }
};

export const exportPowerPackage = async (stagingRoot, destination, options = {}) => {
  const stage = fs.realpathSync(inspectExportPath(stagingRoot));
  const stageStats = fs.lstatSync(stage);
  if (!stageStats.isDirectory() || stageStats.isSymbolicLink()) throw new Error("Power staging root must be a regular directory");
  const validate = options.validate ?? validatePowerPackage;
  validate(stage);
  const stagedDigest = digestPowerPackage(stage, { excludeOwner: true });
  const sourceRoot = fs.realpathSync(options.sourceRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const sourceId = sourceIdentity(sourceRoot);

  destination = inspectExportPath(destination);
  const parent = ensurePrivateDirectory(path.dirname(destination));
  const relative = path.relative(parent, destination);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative.includes(path.sep)) throw new Error("Power export destination escapes its canonical parent");
  const parentStats = fs.lstatSync(parent);
  if (process.platform !== "win32" && typeof process.getuid === "function" && parentStats.uid !== process.getuid()) {
    throw new Error("Power export parent must be owned by the current user");
  }
  const lock = path.join(parent, `.${USER_POWER_NAME}.lock`);
  const lockIdentity = await acquireLock(lock, options.lockTimeoutMs);
  const token = `${process.pid}-${randomBytes(8).toString("hex")}`;
  const temporary = path.join(parent, `.${USER_POWER_NAME}.tmp-${token}`);
  const backup = path.join(parent, `.${USER_POWER_NAME}.backup-${token}`);
  let movedExisting = false;
  try {
    const existingStats = lstat(destination);
    if (existingStats) {
      if (!existingStats.isDirectory() || existingStats.isSymbolicLink()) throw new Error(`refusing non-directory Power destination: ${destination}`);
      const owner = ownerAt(destination);
      if (!owner || owner.product !== OWNER_PRODUCT) throw new Error(`refusing unknown or unowned Power directory: ${destination}`);
      if (owner.sourceId !== sourceId) throw new Error("Power destination belongs to a different source checkout; refusing silent replacement");
      if (process.platform !== "win32" && (
        (typeof process.getuid === "function" && existingStats.uid !== process.getuid()) ||
        (existingStats.mode & 0o077) !== 0
      )) throw new Error(`refusing non-private Power destination: ${destination}`);
    }
    fs.mkdirSync(temporary, { mode: 0o700 });
    for (const entry of fs.readdirSync(stage).sort()) copyPrivateTree(path.join(stage, entry), path.join(temporary, entry));
    await options.afterCopy?.(temporary);
    validate(temporary);
    const copiedDigest = digestPowerPackage(temporary, { excludeOwner: true });
    if (JSON.stringify(copiedDigest) !== JSON.stringify(stagedDigest)) throw new Error("copied Power package digest does not match the staged package");
    fs.writeFileSync(path.join(temporary, OWNER_FILE), `${JSON.stringify({ schemaVersion: 1, product: OWNER_PRODUCT, sourceId, packageDigest: stagedDigest.digest }, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(path.join(temporary, OWNER_FILE), 0o600);
    await options.beforeActivate?.(temporary);
    if (existingStats) {
      fs.renameSync(destination, backup);
      movedExisting = true;
      await options.afterBackup?.(backup);
    }
    fs.renameSync(temporary, destination);
    if (movedExisting) fs.rmSync(backup, { recursive: true, force: true });
    return { destination, sourceId, ...stagedDigest };
  } catch (error) {
    if (movedExisting && fs.existsSync(backup)) {
      if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
      fs.renameSync(backup, destination);
    }
    throw error;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
    if (!movedExisting) fs.rmSync(backup, { recursive: true, force: true });
    releaseLock(lock, lockIdentity);
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stage = process.argv[2] ?? ".tmp/kiro-fabric-power";
  const destination = resolveUserPowerRoot();
  try {
    const result = await exportPowerPackage(stage, destination);
    process.stdout.write(`${JSON.stringify(result)}\nExported a local Power import source. This does not register or enable it; import and enable ${destination} through Kiro's supported Power flow.\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
