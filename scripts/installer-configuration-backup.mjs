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

const MAX_ENTRIES = 20000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_DEPTH = 32;
const RETAINED_BACKUPS = 20;
const MANIFEST = "backup-manifest.json";
const STAMP = /^\d{8}T\d{6}Z-[a-f0-9]{16}$/;
// Managed by the installation transaction (which keeps its own before/after
// bytes). Restore must never rewrite these: a retired installation leaves the
// profile absent, and a restored stale profile fails ownership verification.
const MANAGED_CONTROLS = ["agents/kiro-fabric.json"];

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

/**
 * Copy the existing Kiro configuration (everything except the managed
 * `kiro-fabric` tree) into a private, uniquely named, immutable backup.
 * Symlinks are recreated verbatim without being followed. Any unsafe or
 * oversized condition fails closed BEFORE the caller performs any mutation.
 * @param {string} kiroHome resolved, absolute, user-owned Kiro home
 * @param {{command?: string}} [options]
 * @returns {{path: string, files: number, directories: number, symlinks: number, skipped: number, manifestSha256: string}|null}
 */
export function createConfigurationBackup(kiroHome, options = {}) {
  if (!path.isAbsolute(kiroHome)) throw new Error("configuration backup requires an absolute Kiro home");
  const { root, managed } = backupPaths(kiroHome);
  const files = [], directories = [], symlinks = [], skipped = [];
  if (!s.lstat(kiroHome)) return null; // nothing to preserve before a first install
  s.assertSafeDirectory(kiroHome, { private: true });
  const visit = (source, relative, depth) => {
    if (depth > MAX_DEPTH) throw new Error(`configuration backup depth exceeded at ${relative || "."}`);
    for (const entry of fs.readdirSync(source, { withFileTypes: true }).sort(entrySort)) {
      if (files.length + directories.length + symlinks.length + skipped.length >= MAX_ENTRIES) throw new Error("configuration backup entry capacity exceeded");
      const sourcePath = path.join(source, entry.name), relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (sourcePath === managed && depth === 0) continue; // managed tree has its own transaction evidence
        s.assertSafeDirectory(sourcePath, { private: false });
        directories.push({ path: relativePath, mode: fs.lstatSync(sourcePath).mode & 0o777 });
        visit(sourcePath, relativePath, depth + 1);
      } else if (entry.isSymbolicLink()) {
        // Recorded verbatim and never followed: the backup must not read
        // through user symlinks, and restore recreates the exact link target.
        symlinks.push({ path: relativePath, target: fs.readlinkSync(sourcePath) });
      } else if (entry.isFile()) {
        const stats = s.assertSafeFile(sourcePath, `configuration file ${relativePath}`);
        if (stats.size > MAX_FILE_BYTES) throw new Error(`configuration file exceeds backup bound: ${relativePath}`);
        if (stats.nlink !== 1) {
          // Hardlinked files cannot be immutability-audited; skip rather than
          // brick every mutation over one stale link.
          skipped.push({ path: relativePath, reason: "hardlinked" });
          continue;
        }
        const bytes = fs.readFileSync(sourcePath);
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
      const bytes = fs.readFileSync(path.join(kiroHome, file.path));
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
      excludes: ["kiro-fabric", ...MANAGED_CONTROLS],
      files, directories, symlinks, skipped,
    };
    s.atomicWrite(path.join(destination, MANIFEST), Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
    const manifestSha256 = s.hash(fs.readFileSync(path.join(destination, MANIFEST)));
    syncBackupTree(destination);
    fsyncDirectory(root);
    // Retention is housekeeping, not part of the backup's atomic unit: a
    // retention failure must never destroy the fresh backup.
    try { retainBoundedBackups(root); } catch { /* keep all backups on retention failure */ }
    return { path: destination, files: files.length, directories: directories.length, symlinks: symlinks.length, skipped: skipped.length, manifestSha256 };
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

function retainBoundedBackups(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && STAMP.test(entry.name)).map(entry => entry.name).sort();
  for (const name of entries.slice(0, Math.max(0, entries.length - RETAINED_BACKUPS))) {
    fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
  if (entries.length > RETAINED_BACKUPS) fsyncDirectory(root);
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
  const manifestFile = path.join(backupPath, MANIFEST);
  const raw = fs.readFileSync(manifestFile);
  const manifest = JSON.parse(raw.toString());
  if (manifest.schemaVersion !== 1) throw new Error("configuration backup identity mismatch");
  s.assertSafeDirectory(backupPath, { private: true });
  s.assertSafeDirectory(kiroHome, { private: true });
  if (!s.lstat(path.join(kiroHome, "kiro-fabric"))) throw new Error("restore requires an installed (or previously backed up) kiro-fabric tree at the destination");
  // Manifest-controlled strings are containment-checked: a tampered or
  // hand-written manifest can never write outside the destination home.
  for (const relativePath of manifest.directories.map(directory => directory.path)) assertContainedRelative(relativePath, kiroHome);
  for (const relativePath of [...manifest.files.map(file => file.path), ...manifest.symlinks.map(link => link.path)]) assertContainedRelative(relativePath, kiroHome);
  const expected = new Map(manifest.files.map(file => [file.path, file]));
  const visit = (directory, relative) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort(entrySort)) {
      if (entry.name === MANIFEST && !relative) continue;
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      const source = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(source, relativePath);
      else if (entry.isSymbolicLink()) {
        if (!manifest.symlinks.some(link => link.path === relativePath && link.target === fs.readlinkSync(source))) throw new Error(`unrecorded symlink in backup: ${relativePath}`);
      } else {
        s.assertSafeFile(source, `backup file ${relativePath}`);
        const bytes = fs.readFileSync(source);
        const record = expected.get(relativePath);
        if (!record || bytes.length !== record.size || s.hash(bytes) !== record.sha256) throw new Error(`modified backup file: ${relativePath}`);
      }
    }
  };
  visit(backupPath, "");
  // Managed controls are restored by the installer itself; rewriting a stale
  // profile over a retired/absent installation fails ownership verification.
  const managedSkipped = manifest.files.filter(file => MANAGED_CONTROLS.includes(file.path));
  const restoredFiles = manifest.files.filter(file => !MANAGED_CONTROLS.includes(file.path));
  const written = [];
  try {
    for (const directory of manifest.directories) {
      const destinationDirectory = path.join(kiroHome, directory.path);
      const existing = s.lstat(destinationDirectory);
      // Directories are reusable containers: an existing parent (e.g. agents/
      // surviving while its files were lost) is fine, a foreign non-directory
      // is not. Only newly created directories unwind on failure.
      if (existing) {
        if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error(`restore target exists and is not a directory: ${directory.path}`);
        continue;
      }
      fs.mkdirSync(destinationDirectory, { mode: directory.mode & 0o777 || 0o700 });
      written.push(destinationDirectory);
    }
    for (const relativePath of [...restoredFiles.map(file => file.path), ...manifest.symlinks.map(link => link.path)]) {
      if (s.lstat(path.join(kiroHome, relativePath))) throw new Error(`restore target already exists: ${relativePath}`);
    }
    for (const file of restoredFiles) {
      const source = fs.readFileSync(path.join(backupPath, file.path));
      const destination = path.join(kiroHome, file.path);
      // Restore the exact recorded original mode so Kiro can rewrite its own
      // settings/tokens after recovery (0600 stays 0600, not read-only 0400).
      fs.writeFileSync(destination, source, { flag: "wx", mode: file.mode & 0o777 });
      written.push(destination);
    }
    for (const link of manifest.symlinks) {
      fs.symlinkSync(link.target, path.join(kiroHome, link.path));
      written.push(path.join(kiroHome, link.path));
    }
  } catch (error) {
    // Restore is all-or-nothing: unwind what this attempt created.
    for (const target of written.reverse()) {
      const stats = s.lstat(target);
      if (!stats) continue;
      if (stats.isDirectory()) { try { fs.rmdirSync(target); } catch { /* non-empty parents unwind last */ } }
      else fs.unlinkSync(target);
    }
    throw error;
  }
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
