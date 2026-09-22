#!/usr/bin/env node
// Durable pre-mutation backup of the user's existing Kiro configuration.
//
// The managed transaction already protects Fabric's own control files; this
// module additionally preserves the surrounding Kiro home (settings,
// authentication, sessions, projects, foreign agent profiles) so an install,
// update, rollback or uninstall can always be traced back to the prior
// configuration. Fabric's managed `kiro-fabric` tree is excluded: it has its
// own transaction journals and immutable generations and would otherwise
// dominate backup size. Backups never follow symlinks and never overwrite.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { installerSafety as s } from "./install-agent-user.mjs";
import { captureDirectoryAncestry } from "../src/installation/filesystem-boundary.mjs";
import { pinnedDirectoryIdentity, pinnedEntryIdentity, runPinnedDirectoryOperation } from "./pinned-directory-child.mjs";

const MAX_ENTRIES = 20000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_DEPTH = 32;
const RETAINED_BACKUPS = 20;
// Housekeeping is deliberately bounded across the entire pass, not per tree.
// Oversized/ambiguous evidence stays on disk for explicit operator review.
const MAX_RETENTION_CANDIDATES = 256;
const MAX_RETENTION_BYTES = 256 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MANIFEST = "backup-manifest.json";
const STAMP = /^\d{8}T\d{6}Z-[a-f0-9]{16}$/;
// Managed by the installation transaction (which keeps its own before/after
// bytes). Restore must never rewrite these: a retired installation leaves the
// profile absent, and a restored stale profile fails ownership verification.
const MANAGED_CONTROLS = ["agents/kiro-fabric.json"];
// Reserved source/build directories, not a general Kiro-home ignore list.
// Only safe, real directories at the exact explicit checkout-home root qualify.
const SOURCE_ARTIFACT_DIRECTORIES = new Set([".git", ".tmp", "dist", "node_modules"]);
const PINNED_DIRECTORY_FLAGS = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
const samePinnedIdentity = (left, right) => left && right && ["dev", "ino", "mode", "uid", "gid"].every(key => left[key] === right[key]);

const backupPaths = (kiroHome) => ({
  root: path.join(kiroHome, "kiro-fabric", "backups"),
  managed: path.join(kiroHome, "kiro-fabric"),
});

const assertContainedRelative = (relativePath, kiroHome) => {
  if (typeof relativePath !== "string" || relativePath === "" || path.isAbsolute(relativePath)) throw new Error(`unsafe backup path: ${JSON.stringify(relativePath).slice(0, 200)}`);
  const target = path.resolve(kiroHome, relativePath);
  if (target !== kiroHome && !target.startsWith(kiroHome + path.sep)) throw new Error(`backup path escapes Kiro home: ${relativePath}`);
  return target;
};

const entrySort = (left, right) => left.name.localeCompare(right.name);

const assertCanonicalBackupPath = (target, label) => {
  if (typeof target !== "string" || !path.isAbsolute(target)) throw new Error(`configuration backup requires an absolute ${label}`);
  if (path.resolve(target) !== target || /[\u0000-\u001f\u007f]/u.test(target)) throw new Error(`configuration backup requires a canonical ${label}`);
  s.assertNoUnsafeSymlinkComponents(target);
  if (s.lstat(target) && fs.realpathSync(target) !== target) throw new Error(`configuration backup requires a canonical ${label}`);
};

const validateSourceRoot = (sourceRoot, kiroHome) => {
  if (sourceRoot === undefined) return null;
  assertCanonicalBackupPath(sourceRoot, "source root");
  s.assertSafeDirectory(sourceRoot, { private: sourceRoot === kiroHome });
  if (sourceRoot !== kiroHome) s.assertNoPathOverlap(kiroHome, sourceRoot, "source checkout");
  return sourceRoot;
};

// The hardlink exception is classification only, never a weaker control-file
// predicate. Unsafe links still reach the original strict guard and fail.
const isSafeOrdinaryHardlink = (stats, relativePath) => !MANAGED_CONTROLS.includes(relativePath)
  && stats.isFile() && !stats.isSymbolicLink() && stats.nlink > 1
  && (typeof process.getuid !== "function" || stats.uid === process.getuid())
  && (process.platform === "win32" || (stats.mode & 0o022) === 0);

// Both inventory and copy use bounded descriptor reads. Recheck the path and
// inode so a file becoming a hardlink/symlink after inventory is not copied.
const readConfigurationFile = (sourcePath, relativePath, maxBytes = MAX_FILE_BYTES, budget) => {
  s.assertNoUnsafeSymlinkComponents(sourcePath);
  const stats = s.assertSafeFile(sourcePath, `configuration file ${relativePath}`);
  if (stats.size > maxBytes) throw new Error(`configuration file exceeds backup bound: ${relativePath}`);
  if (budget && (budget.bytes -= stats.size + 1) < 0) throw new Error("backup retention byte bound exceeded");
  const descriptor = fs.openSync(sourcePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  const unchanged = actual => ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeMs", "ctimeMs"].every(key => actual[key] === stats[key]);
  const changed = () => { throw new Error(`configuration changed during backup: ${relativePath}`); };
  try {
    if (!unchanged(fs.fstatSync(descriptor))) changed();
    const bytes = Buffer.alloc(stats.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (count === 0) changed();
      offset += count;
    }
    if (fs.readSync(descriptor, Buffer.alloc(1), 0, 1, null) !== 0 || !unchanged(fs.fstatSync(descriptor))) changed();
    s.assertNoUnsafeSymlinkComponents(sourcePath);
    if (!unchanged(s.assertSafeFile(sourcePath, `configuration file ${relativePath}`))) changed();
    return { stats, bytes };
  } finally { fs.closeSync(descriptor); }
};

/**
 * Copy the existing Kiro configuration (except the managed `kiro-fabric`
 * tree) into a private, uniquely named backup. Managed controls are captured
 * as evidence but excluded from restore. Symlinks are never followed.
 *
 * Only the trusted source frontend may supply sourceRoot: the actual checkout,
 * not its staged bundle, cwd, an environment hint or a release package. Both
 * roots must be absolute/canonical, non-symlink, safe user-owned directories;
 * non-equal roots must be disjoint. ONLY exact sourceRoot === kiroHome omits
 * safe top-level .git/, .tmp/, dist/ and node_modules/ source/build directories.
 * Same-named files, symlinks, nested paths and all other configuration remain
 * subject to normal backup rules and caps. No source markers are inferred.
 * The manifest/result record sourceRoot (null when absent) and the effective
 * excludes (managed policy plus source directories actually omitted).
 * Any unsafe/oversized condition fails before the caller's intended mutation.
 * @param {string} kiroHome resolved, absolute, user-owned Kiro home
 * @param {{command?: string, sourceRoot?: string|undefined}} [options]
 * @returns {{path: string, files: number, directories: number, symlinks: number, skipped: number, manifestSha256: string, sourceRoot: string|null, excludes: string[]}|null}
 */
export function createConfigurationBackup(kiroHome, options = {}) {
  assertCanonicalBackupPath(kiroHome, "Kiro home");
  const sourceRoot = validateSourceRoot(options.sourceRoot, kiroHome);
  const { root, managed } = backupPaths(kiroHome);
  const files = [], directories = [], symlinks = [], skipped = [];
  const excludes = ["kiro-fabric", ...MANAGED_CONTROLS];
  if (!s.lstat(kiroHome)) return null; // nothing to preserve before a first install
  s.assertSafeDirectory(kiroHome, { private: true });
  const visit = (source, relative, depth) => {
    if (depth > MAX_DEPTH) throw new Error(`configuration backup depth exceeded at ${relative || "."}`);
    for (const entry of fs.readdirSync(source, { withFileTypes: true }).sort(entrySort)) {
      if (files.length + directories.length + symlinks.length + skipped.length >= MAX_ENTRIES) throw new Error("configuration backup entry capacity exceeded");
      const sourcePath = path.join(source, entry.name), relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      // Never classify a managed control as skippable, even if its type changed.
      if (MANAGED_CONTROLS.includes(relativePath)) s.assertSafeFile(sourcePath, `configuration file ${relativePath}`);
      if (entry.isDirectory()) {
        if (sourcePath === managed && depth === 0) continue; // managed tree has its own transaction evidence
        s.assertSafeDirectory(sourcePath, { private: false });
        if (sourceRoot === kiroHome && depth === 0 && SOURCE_ARTIFACT_DIRECTORIES.has(entry.name)) {
          excludes.push(relativePath);
          continue;
        }
        directories.push({ path: relativePath, mode: fs.lstatSync(sourcePath).mode & 0o777 });
        visit(sourcePath, relativePath, depth + 1);
      } else if (entry.isSymbolicLink()) {
        // Recorded verbatim and never followed: the backup must not read
        // through user symlinks, and restore recreates the exact link target.
        symlinks.push({ path: relativePath, target: fs.readlinkSync(sourcePath) });
      } else if (entry.isFile()) {
        if (isSafeOrdinaryHardlink(fs.lstatSync(sourcePath), relativePath)) {
          // Record without reading: another name can modify this inode, so it
          // cannot be an immutable snapshot. All original links stay untouched.
          skipped.push({ path: relativePath, reason: "hardlinked" });
          continue;
        }
        const { stats, bytes } = readConfigurationFile(sourcePath, relativePath);
        files.push({ path: relativePath, size: bytes.length, sha256: s.hash(bytes), mode: stats.mode & 0o777 });
      } else {
        // FIFOs, sockets and devices are not configuration content; record and
        // continue so one stale daemon socket cannot block installation.
        skipped.push({ path: relativePath, reason: "non-regular" });
      }
    }
  };
  // Inventory everything first: a failed inventory must not leave a partial
  // backup that could be mistaken for a complete prior configuration.
  visit(kiroHome, "", 0);
  const stamp = `${new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "Z")}-${randomBytes(8).toString("hex")}`;
  const destination = path.join(root, stamp);
  if (s.lstat(destination)) throw new Error("configuration backup destination collision");
  if (!s.lstat(root)) s.ensureDirectory(root, { private: true, parentPrivate: true }, []);
  else s.assertSafeDirectory(root, { private: true });
  if (destination === managed || !destination.startsWith(managed + path.sep)) {
    // The backup must live inside the managed tree so it is never mistaken
    // for, or overwritten by, the user's preserved configuration.
    throw new Error("configuration backup destination must be inside the managed tree");
  }
  fs.mkdirSync(destination, { mode: 0o700 });
  const targetOf = (relativePath) => path.join(destination, relativePath);
  try {
    for (const directory of directories) fs.mkdirSync(targetOf(directory.path), { mode: 0o700 });
    for (const link of symlinks) fs.symlinkSync(link.target, targetOf(link.path));
    for (const file of files) {
      fs.writeFileSync(targetOf(file.path), Buffer.alloc(0), { flag: "wx", mode: 0o600 });
      const prepared = fs.readFileSync(targetOf(file.path));
      if (prepared.length !== 0) throw new Error(`configuration backup collision: ${file.path}`);
    }
    for (const file of files) {
      const { bytes } = readConfigurationFile(path.join(kiroHome, file.path), file.path);
      if (bytes.length !== file.size || s.hash(bytes) !== file.sha256) throw new Error(`configuration changed during backup: ${file.path}`);
      fs.writeFileSync(targetOf(file.path), bytes, { flag: "r+", mode: 0o600 });
      fs.chmodSync(targetOf(file.path), (file.mode & 0o555) | 0o400);
      const descriptor = fs.openSync(targetOf(file.path), "r");
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    }
    const manifest = {
      schemaVersion: 1,
      command: typeof options.command === "string" ? options.command : null,
      time: new Date().toISOString(),
      kiroHome,
      sourceRoot,
      excludes,
      files, directories, symlinks, skipped,
    };
    s.atomicWrite(path.join(destination, MANIFEST), Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
    const manifestSha256 = s.hash(fs.readFileSync(path.join(destination, MANIFEST)));
    syncBackupTree(destination);
    fsyncDirectory(root);
    // Retention is housekeeping, not part of the backup's atomic unit: a
    // retention failure must never destroy the fresh backup.
    try { retainBoundedBackups(root, destination, kiroHome); } catch { /* keep all backups on retention failure */ }
    return { path: destination, files: files.length, directories: directories.length, symlinks: symlinks.length, skipped: skipped.length, manifestSha256, sourceRoot, excludes };
  } catch (error) {
    // Never leave a partial backup that could be trusted as complete.
    try { fs.rmSync(destination, { recursive: true, force: true }); } catch { /* preserve original failure */ }
    throw error;
  }
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function syncBackupTree(root) {
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) if (entry.isDirectory()) visit(path.join(directory, entry.name));
    fsyncDirectory(directory);
  };
  visit(root);
}

// Unlike readdirSync, this never materializes an unbounded foreign directory.
function boundedEntries(directory, budget) {
  const handle = fs.opendirSync(directory), entries = [];
  try {
    for (let entry; (entry = handle.readSync());) {
      if (--budget.entries < 0) throw new Error("backup retention entry bound exceeded");
      entries.push(entry);
    }
  } finally { handle.closeSync(); }
  return entries;
}

const sameEvidence = (left, right) => ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeMs", "ctimeMs"]
  .every(key => left[key] === right[key]);

// A timestamp is not ownership. Require a complete manifest and exact tree
// closure, safe ownership, original snapshot modes and content. Retention
// supplies kiroHome to additionally require same-home identity.
// Skipped hardlinks/special files must remain absent; recorded symlinks are
// compared as links and are never followed. Any doubt preserves the whole tree.
function inspectConfigurationBackup(directory, kiroHome, budget) {
  s.assertNoUnsafeSymlinkComponents(directory);
  s.assertSafeDirectory(directory, { private: true });
  const snapshot = new Map([[directory, fs.lstatSync(directory)]]);
  const manifestPath = path.join(directory, MANIFEST);
  const { bytes, stats } = readConfigurationFile(manifestPath, MANIFEST, MAX_MANIFEST_BYTES, budget);
  if ((stats.mode & 0o7777) !== 0o600) throw new Error("modified backup manifest mode");
  snapshot.set(manifestPath, stats);
  const manifest = JSON.parse(bytes.toString());
  if (!manifest || manifest.schemaVersion !== 1 || typeof manifest.kiroHome !== "string" || !path.isAbsolute(manifest.kiroHome) ||
      (kiroHome !== undefined && manifest.kiroHome !== kiroHome) ||
      typeof manifest.time !== "string" || !Number.isFinite(Date.parse(manifest.time)) ||
      !(manifest.command === null || typeof manifest.command === "string") ||
      !(manifest.sourceRoot === undefined || manifest.sourceRoot === null ||
        (typeof manifest.sourceRoot === "string" && path.isAbsolute(manifest.sourceRoot))) ||
      !Array.isArray(manifest.excludes) || !manifest.excludes.includes("kiro-fabric") ||
      !MANAGED_CONTROLS.every(control => manifest.excludes.includes(control))) throw new Error("foreign backup manifest");
  const expected = new Map(), skipped = new Set();
  let count = 0;
  for (const kind of ["directories", "files", "symlinks", "skipped"]) {
    const records = manifest[kind];
    if (!Array.isArray(records) || (count += records.length) > MAX_ENTRIES) throw new Error("invalid backup inventory");
    for (const record of records) {
      const relative = record?.path;
      if (typeof relative !== "string" || relative.split("/").some(part => !part || part === "." || part === "..") ||
          relative.includes("\\") || relative.includes("\0") || relative.split("/").length > MAX_DEPTH + 1 || relative === MANIFEST ||
          relative === "kiro-fabric" || relative.startsWith("kiro-fabric/") || expected.has(relative) || skipped.has(relative)) throw new Error("invalid backup path");
      assertContainedRelative(relative, directory);
      if (kind === "skipped") {
        if (!["hardlinked", "non-regular"].includes(record.reason)) throw new Error("invalid skipped entry");
        skipped.add(relative);
      } else {
        if (kind === "files" && (!Number.isSafeInteger(record.size) || record.size < 0 || record.size > MAX_FILE_BYTES ||
            !/^[a-f0-9]{64}$/.test(record.sha256))) throw new Error("invalid backup file");
        if (MANAGED_CONTROLS.includes(relative) && kind !== "files") throw new Error("invalid managed backup entry");
        if (kind === "symlinks" && (typeof record.target !== "string" || !record.target || record.target.includes("\0"))) throw new Error("invalid backup symlink");
        if (kind !== "symlinks" && (!Number.isInteger(record.mode) || record.mode < 0 || record.mode > 0o777 || (record.mode & 0o022))) throw new Error("invalid backup mode");
        expected.set(relative, { kind, record });
      }
    }
  }
  // Every non-root parent must be a recorded directory, including parents of
  // skipped evidence. Otherwise a manifest can invent paths through a link.
  for (const relative of [...expected.keys(), ...skipped]) {
    const parent = path.posix.dirname(relative);
    if (parent !== "." && expected.get(parent)?.kind !== "directories") throw new Error("missing backup parent directory");
  }
  const visit = (target, relative, depth) => {
    if (depth > MAX_DEPTH) throw new Error("backup retention depth exceeded");
    s.assertNoUnsafeSymlinkComponents(target);
    s.assertSafeDirectory(target, { private: true });
    const before = fs.lstatSync(target);
    if ((before.mode & 0o7777) !== 0o700) throw new Error("modified backup directory mode");
    snapshot.set(target, before);
    for (const entry of boundedEntries(target, budget)) {
      if (!relative && entry.name === MANIFEST) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const item = expected.get(name), child = path.join(target, entry.name);
      if (!item) throw new Error("unrecorded backup entry");
      const actual = fs.lstatSync(child), { kind, record } = item;
      if (typeof process.getuid === "function" && actual.uid !== process.getuid()) throw new Error("foreign backup entry");
      if (kind === "directories" && actual.isDirectory()) visit(child, name, depth + 1);
      else if (kind === "symlinks" && actual.isSymbolicLink() && actual.nlink === 1 && fs.readlinkSync(child) === record.target) snapshot.set(child, actual);
      else if (kind === "files" && actual.isFile() && actual.size === record.size && (actual.mode & 0o7777) === ((record.mode & 0o555) | 0o400)) {
        const content = readConfigurationFile(child, name, MAX_FILE_BYTES, budget);
        if (!sameEvidence(actual, content.stats) || s.hash(content.bytes) !== record.sha256) throw new Error("modified backup content");
        snapshot.set(child, content.stats);
      } else throw new Error("modified backup entry");
      expected.delete(name);
    }
    if (!sameEvidence(before, fs.lstatSync(target))) throw new Error("backup changed during retention");
  };
  visit(directory, "", 0);
  if (expected.size) throw new Error("missing backup entries");
  for (const [target, before] of snapshot) {
    s.assertNoUnsafeSymlinkComponents(path.dirname(target));
    if (!sameEvidence(before, fs.lstatSync(target))) throw new Error("backup changed during retention");
  }
  return { snapshot, manifest };
}

function inspectRetainedBackup(directory, kiroHome, budget) {
  return inspectConfigurationBackup(directory, kiroHome, budget).snapshot;
}

function retainBoundedBackups(root, fresh, kiroHome) {
  const entries = boundedEntries(root, { entries: MAX_RETENTION_CANDIDATES })
    .filter(entry => entry.isDirectory() && STAMP.test(entry.name) && path.join(root, entry.name) !== fresh)
    .map(entry => entry.name).sort();
  if (entries.length < RETAINED_BACKUPS) return;
  const budget = { entries: MAX_ENTRIES, bytes: MAX_RETENTION_BYTES }, verified = [];
  for (const name of entries) {
    const directory = path.join(root, name);
    try { inspectRetainedBackup(directory, kiroHome, budget); verified.push(directory); } catch { /* preserve unknown evidence */ }
    if (budget.entries < 0 || budget.bytes < 0) return;
  }
  for (const directory of verified.slice(0, Math.max(0, verified.length - RETAINED_BACKUPS + 1))) {
    // Revalidate immediately before deletion. Delete only enumerated entries,
    // never recursively sweep up new/foreign material added after validation.
    const snapshot = inspectRetainedBackup(directory, kiroHome, budget);
    const manifestPath = path.join(directory, MANIFEST);
    const deletionOrder = [...snapshot].sort(([left], [right]) => right.split(path.sep).length - left.split(path.sep).length ||
      Number(left === manifestPath) - Number(right === manifestPath));
    // Keep the manifest until all recorded children have been removed, leaving
    // useful recovery evidence if a non-recursive removal encounters new data.
    for (const [target, before] of deletionOrder) {
      s.assertNoUnsafeSymlinkComponents(path.dirname(target));
      const now = fs.lstatSync(target);
      if (before.isDirectory()) {
        if (!["dev", "ino", "uid", "gid", "mode"].every(key => before[key] === now[key])) throw new Error("backup directory changed during deletion");
        fs.rmdirSync(target);
      } else {
        if (!sameEvidence(before, now)) throw new Error("backup entry changed during deletion");
        fs.unlinkSync(target);
      }
    }
    fsyncDirectory(root);
  }
}

/** List retained configuration backups, newest last. */
export function listConfigurationBackups(kiroHome) {
  const { root } = backupPaths(kiroHome);
  if (!s.lstat(root)) return [];
  s.assertSafeDirectory(root, { private: true });
  const backups = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort(entrySort)) {
    if (!entry.isDirectory() || !STAMP.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    const raw = s.lstat(path.join(directory, MANIFEST)) ? fs.readFileSync(path.join(directory, MANIFEST)).toString() : null;
    if (!raw) continue;
    let manifest;
    try { manifest = JSON.parse(raw); } catch { continue; } // one corrupt manifest never breaks listing
    backups.push({ name: entry.name, time: manifest.time, command: manifest.command, files: manifest.files?.length ?? 0, complete: manifest.schemaVersion === 1 });
  }
  return backups;
}

/**
 * Restore every recorded entry of a verified backup into a Kiro home that
 * must not already contain the target. Verifies manifest hashes before any
 * write; refuses foreign, modified or partially present backups.
 * @param {string} backupPath exact backup directory recorded by the installer
 * @param {string} kiroHome destination Kiro home
 */
export function restoreConfigurationBackup(backupPath, kiroHome) {
  assertCanonicalBackupPath(backupPath, "backup path");
  assertCanonicalBackupPath(kiroHome, "Kiro home");
  s.assertSafeDirectory(kiroHome, { private: true });
  if (!s.lstat(path.join(kiroHome, "kiro-fabric"))) throw new Error("restore requires an installed (or previously backed up) kiro-fabric tree at the destination");
  // Restore may target a different home. Retention additionally requires the
  // original home identity; both paths require the same exact bounded tree.
  // Do not apply retention's smaller housekeeping byte cap to valid backups.
  const { manifest } = inspectConfigurationBackup(backupPath, undefined, {
    entries: MAX_ENTRIES + 1, bytes: MAX_ENTRIES * (MAX_FILE_BYTES + 1) + MAX_MANIFEST_BYTES + 1,
  });
  // Managed controls are restored by the installer itself; rewriting a stale
  // profile over a retired/absent installation fails ownership verification.
  const managedSkipped = manifest.files.filter(file => MANAGED_CONTROLS.includes(file.path));
  const restoredFiles = manifest.files.filter(file => !MANAGED_CONTROLS.includes(file.path));
  const directories = [...manifest.directories].sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  const directoryPaths = new Set(directories.map(directory => directory.path));
  const directoryModes = new Map(directories.map(directory => [directory.path, directory.mode]));
  const rootGuard = captureDirectoryAncestry(kiroHome);
  const rootIdentity = pinnedDirectoryIdentity(fs.lstatSync(kiroHome, { bigint: true }));
  const parents = new Map([[kiroHome, rootIdentity]]);

  // Keep the no-effects preflight, but do not trust it as the mutation guard.
  // Existing directories are user data: their exact recorded mode must already
  // match. Restore never silently chmods a preexisting container.
  for (const entry of [...directories, ...restoredFiles, ...manifest.symlinks]) {
    const target = assertContainedRelative(entry.path, kiroHome);
    s.assertNoUnsafeSymlinkComponents(path.dirname(target));
    const existing = s.lstat(target);
    if (directoryPaths.has(entry.path)) {
      if (existing) {
        s.assertSafeDirectory(target);
        if ((existing.mode & 0o777) !== entry.mode) throw new Error(`restore directory mode mismatch: ${entry.path}`);
        parents.set(target, pinnedDirectoryIdentity(fs.lstatSync(target, { bigint: true })));
      }
    } else if (existing) throw new Error(`restore target already exists: ${entry.path}`);
  }

  /** Run one fixed operation through a descriptor whose identity is rechecked
   * before, during and after the effect. Pathname checks are diagnostics only. */
  function inParent(directory, action) {
    const expected = parents.get(directory);
    if (!expected) throw new Error(`unknown restore parent: ${path.relative(kiroHome, directory)}`);
    const guard = captureDirectoryAncestry(directory);
    const check = () => {
      rootGuard.check(); guard.check();
      if (!samePinnedIdentity(expected, pinnedDirectoryIdentity(fs.lstatSync(directory, { bigint: true })))) {
        throw new Error("Restore parent changed; preserve evidence");
      }
    };
    check();
    const descriptor = fs.openSync(directory, PINNED_DIRECTORY_FLAGS);
    try {
      if (!samePinnedIdentity(expected, pinnedDirectoryIdentity(fs.fstatSync(descriptor, { bigint: true })))) {
        throw new Error("Restore parent descriptor changed; preserve evidence");
      }
      return action({ fd: descriptor, cwd: directory, parent: expected, check });
    } finally { fs.closeSync(descriptor); }
  }

  /** @type {{parent:string,name:string,kind:'directory'|'file'|'symlink',identity:ReturnType<typeof pinnedEntryIdentity>}[]} */
  const written = [];
  try {
    for (const directory of directories) {
      const destination = path.join(kiroHome, directory.path);
      if (parents.has(destination)) continue;
      const parent = path.dirname(destination), name = path.basename(destination);
      const identity = inParent(parent, context => runPinnedDirectoryOperation({ ...context, operation: "mkdir0700", name }));
      if (!identity) throw new Error(`restore directory identity missing: ${directory.path}`);
      const record = { parent, name, kind: /** @type {const} */ ("directory"), identity };
      written.push(record);
      // Keep newly owned parents private and writable until every descendant is
      // published. Exact recorded modes (including read-only 0500 trees) are
      // applied deepest-first only after all child creation has finished.
      parents.set(destination, pinnedDirectoryIdentity(identity));
    }
    // Repeat collision checks after parent creation. Each exclusive operation
    // remains authoritative if a name appears after this diagnostic pass.
    for (const relativePath of [...restoredFiles.map(file => file.path), ...manifest.symlinks.map(link => link.path)]) {
      if (s.lstat(path.join(kiroHome, relativePath))) throw new Error(`restore target already exists: ${relativePath}`);
    }
    for (const file of restoredFiles) {
      const { bytes: source } = readConfigurationFile(path.join(backupPath, file.path), file.path);
      if (source.length !== file.size || s.hash(source) !== file.sha256) throw new Error(`modified backup file: ${file.path}`);
      const destination = path.join(kiroHome, file.path), parent = path.dirname(destination), name = path.basename(destination);
      const identity = inParent(parent, context => runPinnedDirectoryOperation({
        ...context, operation: "writeExclusive", name, mode: file.mode, maxBytes: MAX_FILE_BYTES, data: source,
      }));
      if (!identity) throw new Error(`restore file identity missing: ${file.path}`);
      written.push({ parent, name, kind: "file", identity });
    }
    for (const link of manifest.symlinks) {
      const destination = path.join(kiroHome, link.path), parent = path.dirname(destination), name = path.basename(destination);
      const identity = inParent(parent, context => runPinnedDirectoryOperation({
        ...context, operation: "symlinkExclusive", name, linkTarget: link.target,
      }));
      if (!identity) throw new Error(`restore symlink identity missing: ${link.path}`);
      written.push({ parent, name, kind: "symlink", identity });
    }
    for (const record of written.filter(record => record.kind === "directory").reverse()) {
      const destination = path.join(record.parent, record.name);
      const relative = path.relative(kiroHome, destination).split(path.sep).join("/");
      const mode = directoryModes.get(relative);
      if (mode === undefined || mode === 0o700) continue;
      const identity = inParent(record.parent, context => runPinnedDirectoryOperation({
        ...context, operation: "chmodDirectory", name: record.name, expected: record.identity, mode,
      }));
      if (!identity) throw new Error(`restore directory chmod identity missing: ${relative}`);
      record.identity = identity; parents.set(destination, pinnedDirectoryIdentity(identity));
    }
  } catch (error) {
    // POSIX/Node has no compare-and-unlink primitive. Deleting a pathname after
    // checking its inode could remove a concurrent successor, so failed restores
    // deliberately preserve every published entry as recovery evidence. The
    // first operation can take effect before its helper returns an identity.
    const detail = error instanceof Error ? error.message : String(error);
    const progress = written.length === 0 ? "during the first publication" :
      `after publishing ${written.length} entr${written.length === 1 ? "y" : "ies"}`;
    throw new AggregateError([error],
      `Restore failed (${detail}) ${progress}; partial entries may have been preserved and must be inspected before retrying.`,
      { cause: error });
  }
  rootGuard.check();
  return { restored: restoredFiles.length, directories: manifest.directories.length, symlinks: manifest.symlinks.length, managedSkipped: managedSkipped.map(file => file.path) };
}

// Bundling into install-manager.mjs gives every module the manager's URL.
// Only the standalone backup script may dispatch these positional CLI commands.
if (path.basename(fileURLToPath(import.meta.url)) === "installer-configuration-backup.mjs" && process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const [command, first, second] = process.argv.slice(2);
  if (command === "list" && first) {
    for (const backup of listConfigurationBackups(path.resolve(first))) process.stdout.write(`${JSON.stringify(backup)}\n`);
  } else if (command === "restore" && first && second) {
    const result = restoreConfigurationBackup(path.resolve(first), path.resolve(second));
    process.stdout.write(`Restored ${result.restored} files, ${result.directories} directories, ${result.symlinks} symlinks\n`);
  } else {
    process.stderr.write(`Usage:\n  node installer-configuration-backup.mjs list <kiro-home>\n  node installer-configuration-backup.mjs restore <backup-path> <kiro-home>\n`);
    process.exitCode = 2;
  }
}
