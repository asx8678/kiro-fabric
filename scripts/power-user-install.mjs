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
const identity = (stats) => ({ dev: stats.dev, ino: stats.ino });
const sameIdentity = (stats, expected) => stats.dev === expected.dev && stats.ino === expected.ino;
const privateOwned = (stats) => stats.isDirectory() && !stats.isSymbolicLink() &&
  (typeof process.getuid !== "function" || stats.uid === process.getuid()) && (stats.mode & 0o077) === 0;

/** Reject aliases/reparse points at every existing path component. */
export const inspectExportPath = (target) => {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const stats = lstat(cursor);
    if (!stats) break;
    if (stats.isSymbolicLink()) throw new Error(`refusing path alias or reparse point: ${cursor}`);
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
  const canonical = fs.realpathSync(absolute);
  const stats = fs.lstatSync(canonical);
  if (!privateOwned(stats)) throw new Error(`export parent must be current-user-owned and not group/world writable: ${canonical}`);
  return { path: canonical, identity: identity(stats) };
};

export const resolveKiroHome = (env = process.env, home = homedir()) => {
  const candidate = typeof env.KIRO_HOME === "string" && env.KIRO_HOME.trim() ? path.resolve(env.KIRO_HOME.trim()) : path.join(home, ".kiro");
  return inspectExportPath(candidate);
};
export const resolveUserPowerRoot = (env = process.env, home = homedir()) => path.join(resolveKiroHome(env, home), "powers", USER_POWER_NAME);
const sourceIdentity = (sourceRoot) => createHash("sha256").update("kiro-fabric-power-source-v1\0").update(fs.realpathSync(sourceRoot)).digest("hex");

const ownerAt = (destination) => {
  const file = path.join(destination, OWNER_FILE);
  const stats = lstat(file);
  if (!stats?.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size > 4_096 ||
      (typeof process.getuid === "function" && stats.uid !== process.getuid()) || (stats.mode & 0o077) !== 0) return undefined;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; }
};
const processIsAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
};
const lockStillHeld = (lock, held) => {
  const lockStats = fs.lstatSync(lock);
  const ownerPath = path.join(lock, "owner.json");
  const ownerStats = fs.lstatSync(ownerPath);
  if (!privateOwned(lockStats) || !sameIdentity(lockStats, held.lock) || !ownerStats.isFile() || ownerStats.isSymbolicLink() ||
      ownerStats.nlink !== 1 || !sameIdentity(ownerStats, held.owner)) return false;
  const marker = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
  return marker.token === held.token && marker.pid === process.pid;
};
const releaseLock = (lock, held) => {
  try {
    const lockStats = fs.lstatSync(lock);
    const ownerPath = path.join(lock, "owner.json");
    const ownerStats = fs.lstatSync(ownerPath);
    if (!privateOwned(lockStats) || !sameIdentity(lockStats, held.lock) || !ownerStats.isFile() || ownerStats.isSymbolicLink() ||
        ownerStats.nlink !== 1 || !sameIdentity(ownerStats, held.owner)) return;
    const marker = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
    if (marker.token !== held.token || marker.pid !== process.pid) return;
    fs.unlinkSync(ownerPath);
    const current = fs.lstatSync(lock);
    if (sameIdentity(current, held.lock)) fs.rmdirSync(lock);
  } catch (error) { if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") throw error; }
};
const reclaimStaleLock = (lock, stats) => {
  const ownerPath = path.join(lock, "owner.json");
  const ownerStats = lstat(ownerPath);
  if (!privateOwned(stats) || !ownerStats?.isFile() || ownerStats.isSymbolicLink() || ownerStats.nlink !== 1 || (ownerStats.mode & 0o077) !== 0) return false;
  let marker;
  try { marker = JSON.parse(fs.readFileSync(ownerPath, "utf8")); } catch { return false; }
  if (processIsAlive(marker.pid)) return false;
  const currentLock = fs.lstatSync(lock); const currentOwner = fs.lstatSync(ownerPath);
  if (!sameIdentity(currentLock, identity(stats)) || !sameIdentity(currentOwner, identity(ownerStats))) return false;
  fs.unlinkSync(ownerPath);
  fs.rmdirSync(lock);
  return true;
};
const acquireLock = async (lock, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const current = lstat(lock);
    if (current?.isSymbolicLink() || (current && !current.isDirectory())) throw new Error(`export lock is not a regular directory: ${lock}`);
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      const lockStats = fs.lstatSync(lock);
      const token = randomBytes(24).toString("hex");
      const ownerPath = path.join(lock, "owner.json");
      fs.writeFileSync(ownerPath, `${JSON.stringify({ pid: process.pid, startedAt: Date.now(), token })}\n`, { mode: 0o600, flag: "wx" });
      const ownerStats = fs.lstatSync(ownerPath);
      return { lock: identity(lockStats), owner: identity(ownerStats), token };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const occupied = fs.lstatSync(lock);
      if (!privateOwned(occupied)) throw new Error(`export lock is not a private owned directory: ${lock}`);
      if (Date.now() - occupied.mtimeMs > STALE_EXPORT_LOCK_MS && reclaimStaleLock(lock, occupied)) continue;
      if (Date.now() >= deadline) throw new Error("timed out waiting for concurrent Power export");
      await sleep(25);
    }
  }
};

const fsyncDirectory = (directory) => {
  const descriptor = fs.openSync(directory, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
};
const copyPrivateTree = (source, destination) => {
  const sourceStats = fs.lstatSync(source);
  if (sourceStats.isSymbolicLink()) throw new Error(`staged package contains a path alias: ${source}`);
  if (sourceStats.isDirectory()) {
    fs.mkdirSync(destination, { mode: 0o700 });
    for (const entry of fs.readdirSync(source).sort()) copyPrivateTree(path.join(source, entry), path.join(destination, entry));
    fs.chmodSync(destination, 0o700);
    fsyncDirectory(destination);
  } else if (sourceStats.isFile()) {
    if (sourceStats.nlink !== 1) throw new Error(`staged package contains a hard-linked file: ${source}`);
    const input = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const output = fs.openSync(destination, "wx", 0o600);
    try {
      const buffer = Buffer.allocUnsafe(64 * 1024); let bytes;
      while ((bytes = fs.readSync(input, buffer, 0, buffer.length, null)) > 0) fs.writeSync(output, buffer, 0, bytes);
      fs.fsyncSync(output);
    } finally { fs.closeSync(input); fs.closeSync(output); }
  } else throw new Error(`staged package contains an unsupported entry: ${source}`);
};

export const exportPowerPackage = async (stagingRoot, requestedDestination, options = {}) => {
  if (process.platform !== "linux") throw new Error("Power export is supported only on Linux; use checkout-local staging on this platform");
  const stageLexical = path.resolve(stagingRoot);
  const stageParent = fs.realpathSync(inspectExportPath(path.dirname(stageLexical)));
  const stageLexicalStats = fs.lstatSync(stageLexical);
  if (stageLexicalStats.isSymbolicLink()) {
    const target = fs.readlinkSync(stageLexical);
    if (path.isAbsolute(target) || target.includes(path.sep) || !target.startsWith(".kiro-fabric-power-generation-")) {
      throw new Error("Power staging pointer must target one checkout-local immutable generation");
    }
  }
  const stage = fs.realpathSync(stageLexical);
  if (path.dirname(stage) !== stageParent) throw new Error("Power staging generation escapes its checkout-local parent");
  const stageStats = fs.lstatSync(stage);
  if (!stageStats.isDirectory() || stageStats.isSymbolicLink()) throw new Error("Power staging root must resolve to a regular directory");
  const validate = options.validate ?? validatePowerPackage;
  validate(stage);
  const stagedDigest = digestPowerPackage(stage, { excludeOwner: true });
  const sourceRoot = fs.realpathSync(options.sourceRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const sourceId = sourceIdentity(sourceRoot);
  const requested = inspectExportPath(requestedDestination);
  if (lstat(requested)) throw new Error(`refusing in-place replacement; move or import the existing destination explicitly: ${requested}`);
  const parentInfo = ensurePrivateDirectory(path.dirname(requested));
  const relative = path.relative(parentInfo.path, requested);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative.includes(path.sep)) throw new Error("Power export destination escapes its canonical parent");
  const lock = path.join(parentInfo.path, `.${USER_POWER_NAME}.lock`);
  const held = await acquireLock(lock, options.lockTimeoutMs);
  const prefix = `${path.basename(requested)}-${stagedDigest.digest.slice(0, 16)}-`;
  let temporary;
  try {
    const currentParent = fs.lstatSync(parentInfo.path);
    if (!sameIdentity(currentParent, parentInfo.identity) || !privateOwned(currentParent)) throw new Error("export parent changed after authorization");
    for (const entry of fs.readdirSync(parentInfo.path).filter((name) => name.startsWith(prefix)).sort()) {
      const candidate = path.join(parentInfo.path, entry);
      const stats = fs.lstatSync(candidate);
      const owner = ownerAt(candidate);
      if (!privateOwned(stats) || !owner || owner.product !== OWNER_PRODUCT) throw new Error(`refusing unknown generation collision: ${candidate}`);
      if (owner.sourceId !== sourceId) throw new Error("Power generation belongs to a different source checkout; refusing silent replacement");
      const observed = digestPowerPackage(candidate, { excludeOwner: true });
      if (owner.packageDigest !== stagedDigest.digest || observed.digest !== stagedDigest.digest) throw new Error(`owned Power generation digest mismatch: ${candidate}`);
      return { destination: candidate, sourceId, ...stagedDigest, reused: true };
    }
    const token = `${process.pid}-${randomBytes(16).toString("hex")}`;
    temporary = path.join(parentInfo.path, `.${prefix}${token}.tmp`);
    fs.mkdirSync(temporary, { mode: 0o700 });
    for (const entry of fs.readdirSync(stage).sort()) copyPrivateTree(path.join(stage, entry), path.join(temporary, entry));
    await options.afterCopy?.(temporary);
    validate(temporary);
    const copiedDigest = digestPowerPackage(temporary, { excludeOwner: true });
    if (JSON.stringify(copiedDigest) !== JSON.stringify(stagedDigest)) throw new Error("copied Power package digest does not match the staged package");
    const ownerPath = path.join(temporary, OWNER_FILE);
    fs.writeFileSync(ownerPath, `${JSON.stringify({ schemaVersion: 2, product: OWNER_PRODUCT, sourceId, packageDigest: stagedDigest.digest }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    const ownerDescriptor = fs.openSync(ownerPath, "r"); try { fs.fsyncSync(ownerDescriptor); } finally { fs.closeSync(ownerDescriptor); }
    fsyncDirectory(temporary);
    await options.beforeActivate?.(temporary);
    const parentNow = fs.lstatSync(parentInfo.path);
    if (!sameIdentity(parentNow, parentInfo.identity) || !privateOwned(parentNow)) throw new Error("export parent changed before activation");
    if (!lockStillHeld(lock, held)) throw new Error("export lock changed before activation");
    if (lstat(requested)) throw new Error("requested export destination appeared before activation; refusing unrelated replacement");
    const destination = path.join(parentInfo.path, `${prefix}${randomBytes(12).toString("hex")}`);
    if (lstat(destination)) throw new Error("versioned Power generation collided before activation");
    fs.renameSync(temporary, destination);
    temporary = undefined;
    fsyncDirectory(parentInfo.path);
    return { destination, sourceId, ...stagedDigest, reused: false };
  } finally {
    // A failed private generation is intentionally retained rather than using
    // recursive pathname deletion after a possible substitution race.
    releaseLock(lock, held);
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stage = process.argv[2] ?? ".tmp/kiro-fabric-power";
  try {
    const result = await exportPowerPackage(stage, resolveUserPowerRoot());
    process.stdout.write(`${JSON.stringify(result)}\nExported immutable local import source ${result.destination}. This does not register or enable it; import and enable that exact folder through Kiro's supported Power flow.\n`);
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
