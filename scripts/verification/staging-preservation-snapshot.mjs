// I07-only, resource-bounded preservation oracle; never production admission.
// Full regular-file bytes and the explicitly listed stat fields are covered.
// atime (including read-induced changes), birthtime, ACLs and xattrs are not.
// Descriptor/name checks detect observed drift; this is NOT an atomic filesystem
// snapshot or a hostile-filesystem sandbox. Node's opendir/path APIs are not
// openat/fdopendir: directory descriptors are held and checked around pathname
// operations, not used to claim race-free pathname resolution.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const DEFAULT_MAX_ENTRIES = 512;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const READ_ONLY_FLAGS = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
const DIRECTORY_FLAGS = READ_ONLY_FLAGS | fs.constants.O_DIRECTORY;
const STAT_FIELDS = /** @type {const} */ (["mode", "uid", "gid", "nlink", "size", "dev", "ino", "mtimeNs", "ctimeNs"]);
const COMPARED_FIELDS = /** @type {const} */ (["type", ...STAT_FIELDS, "linkTarget", "sha256"]);
const ADDITION_PARENT_FIELDS = new Set(["nlink", "size", "mtimeNs", "ctimeNs"]);

/**
 * @typedef {object} StagingSnapshotEntry
 * @property {string} path Relative path ("." for the scope root itself).
 * @property {"directory"|"file"|"symlink"|"other"} type
 * @property {number} mode
 * @property {number} uid
 * @property {number} gid
 * @property {number} nlink
 * @property {string} size
 * @property {string} dev
 * @property {string} ino
 * @property {string} mtimeNs
 * @property {string} ctimeNs
 * @property {string|null} linkTarget Exact readlink text, never followed.
 * @property {string|null} sha256 Full-byte digest; null for shallow inventory.
 */
/**
 * @typedef {object} StagingSnapshot
 * @property {string} root
 * @property {string} boundaryRoot Canonical directory pinning boundary.
 * @property {boolean} exists
 * @property {StagingSnapshotEntry[]} entries
 * @property {{root:string, entries:StagingSnapshotEntry[]}|null} parent Shallow owned-parent inventory, when requested.
 * @property {number} bytes Total regular-file bytes hashed.
 */

/** @param {import('node:fs').BigIntStats} stat @returns {StagingSnapshotEntry['type']} */
function typeOf(stat) {
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  if (stat.isSymbolicLink()) return "symlink";
  return "other";
}

/** @param {import('node:fs').BigIntStats} stat @param {string} relative @returns {StagingSnapshotEntry} */
function entryOf(stat, relative) {
  return {
    path: relative, type: typeOf(stat), mode: Number(stat.mode), uid: Number(stat.uid), gid: Number(stat.gid),
    nlink: Number(stat.nlink), size: String(stat.size), dev: String(stat.dev), ino: String(stat.ino),
    mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs), linkTarget: null, sha256: null,
  };
}

/** @param {import('node:fs').BigIntStats} expected @param {import('node:fs').BigIntStats} actual @param {string} name */
function stable(expected, actual, name) {
  for (const field of STAT_FIELDS) {
    if (expected[field] !== actual[field]) throw new Error("snapshotStagingScope: entry changed during snapshot at " + name + " (" + field + ")");
  }
}

/** @param {string} value */
function canonicalAbsolute(value) {
  if (!path.isAbsolute(value) || path.resolve(value) !== value) throw new Error("snapshotStagingScope: canonical absolute path required");
}

/**
 * Capture only the declared tree. Pin directories from boundaryRoot through
 * its parent/descendants; default boundary is dirname(root). Canonical checks
 * above that boundary resolve names only, never enumerate repo/home ancestors.
 * inventoryParent requires root to be an immediate child of boundaryRoot and
 * adds bounded metadata/name inventory there, without hashing siblings or
 * descending into them. Symlinks, including a dangling root, are leaf records.
 * All enumeration (tree + optional parent inventory) shares one entry budget;
 * byte limits precede allocation/read. maxDepth bounds simultaneously held fds.
 *
 * @param {string} root
 * @param {{maxEntries?:number, maxBytes?:number, maxDepth?:number, boundaryRoot?:string, inventoryParent?:boolean}} [bounds]
 * @returns {StagingSnapshot}
 */
export function snapshotStagingScope(root, bounds = {}) {
  const maxEntries = bounds.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytes = bounds.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxDepth = bounds.maxDepth ?? 64;
  for (const [name, value] of [["entry", maxEntries], ["byte", maxBytes], ["depth", maxDepth]]) {
    if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error("snapshotStagingScope: invalid " + name + " budget");
  }
  canonicalAbsolute(root);
  const boundaryRoot = bounds.boundaryRoot ?? path.dirname(root);
  canonicalAbsolute(boundaryRoot);
  const relativeRoot = path.relative(boundaryRoot, root);
  if (relativeRoot === "" || relativeRoot === ".." || relativeRoot.startsWith(".." + path.sep) || path.isAbsolute(relativeRoot)) {
    throw new Error("snapshotStagingScope: root must be inside directory boundary");
  }
  if (bounds.inventoryParent && path.dirname(root) !== boundaryRoot) throw new Error("snapshotStagingScope: inventory requires immediate owned parent");
  /** @type {{absolute:string, fd:number, stat:import('node:fs').BigIntStats}[]} */
  const pins = [];
  /** @type {StagingSnapshotEntry[]} */
  const entries = [];
  let bytes = 0, entryCount = 0;
  const chargeEntry = () => {
    if (++entryCount > maxEntries) throw new Error("snapshotStagingScope: entry budget exceeded");
  };
  const checkPins = () => {
    for (const pin of pins) {
      stable(pin.stat, fs.fstatSync(pin.fd, { bigint: true }), pin.absolute);
      stable(pin.stat, fs.lstatSync(pin.absolute, { bigint: true }), pin.absolute);
      if (fs.realpathSync(pin.absolute) !== pin.absolute) throw new Error("snapshotStagingScope: noncanonical directory ancestry");
    }
  };
  /** @param {string} absolute @param {import('node:fs').BigIntStats} stat */
  const pinDirectory = (absolute, stat) => {
    checkPins();
    if (pins.length >= maxDepth) throw new Error("snapshotStagingScope: depth budget exceeded");
    if (!stat.isDirectory() || fs.realpathSync(absolute) !== absolute) throw new Error("snapshotStagingScope: noncanonical directory ancestry");
    const fd = fs.openSync(absolute, DIRECTORY_FLAGS);
    try {
      stable(stat, fs.fstatSync(fd, { bigint: true }), absolute);
      stable(stat, fs.lstatSync(absolute, { bigint: true }), absolute);
      checkPins();
      pins.push({ absolute, fd, stat });
    } catch (error) { fs.closeSync(fd); throw error; }
  };
  const unpin = () => { const pin = pins.pop(); if (pin) fs.closeSync(pin.fd); };
  /** @param {string} absolute @param {(name:string)=>void} visit */
  const enumerate = (absolute, visit) => {
    checkPins();
    const directory = fs.opendirSync(absolute, { bufferSize: 1 });
    try {
      checkPins();
      let dirent;
      while ((dirent = directory.readSync()) !== null) {
        checkPins();
        visit(dirent.name);
      }
      checkPins();
    } finally { directory.closeSync(); }
  };
  /** @param {string} absolute @param {import('node:fs').BigIntStats} stat */
  const readBounded = (absolute, stat) => {
    if (!stat.isFile() || stat.nlink !== 1n) throw new Error("snapshotStagingScope: regular file must have a single link: " + absolute);
    if (stat.size < 0n || stat.size > BigInt(maxBytes - bytes)) throw new Error("snapshotStagingScope: byte budget exceeded at " + absolute);
    checkPins();
    const fd = fs.openSync(absolute, READ_ONLY_FLAGS);
    try {
      checkPins();
      const fresh = fs.fstatSync(fd, { bigint: true });
      stable(stat, fresh, absolute);
      stable(stat, fs.lstatSync(absolute, { bigint: true }), absolute);
      if (!fresh.isFile() || fresh.nlink !== 1n) throw new Error("snapshotStagingScope: unreadable single-link entry");
      // Identity includes size; both stats are validated before allocation.
      const size = Number(fresh.size), buffer = Buffer.allocUnsafe(size);
      let offset = 0;
      while (offset < size) {
        const read = fs.readSync(fd, buffer, offset, size - offset, offset);
        if (read === 0) throw new Error("snapshotStagingScope: entry truncated during snapshot at " + absolute);
        offset += read;
      }
      if (fs.readSync(fd, Buffer.alloc(1), 0, 1, size) !== 0) throw new Error("snapshotStagingScope: entry grew during snapshot at " + absolute);
      stable(stat, fs.fstatSync(fd, { bigint: true }), absolute);
      stable(stat, fs.lstatSync(absolute, { bigint: true }), absolute);
      checkPins();
      bytes += size;
      return createHash("sha256").update(buffer).digest("hex");
    } finally { fs.closeSync(fd); }
  };
  /** @param {string} absolute @param {string} relative @param {boolean} shallow */
  const capture = (absolute, relative, shallow) => {
    chargeEntry();
    checkPins();
    const stat = fs.lstatSync(absolute, { bigint: true }), entry = entryOf(stat, relative);
    if (entry.type === "symlink") entry.linkTarget = fs.readlinkSync(absolute);
    if (entry.type === "file" && !shallow) entry.sha256 = readBounded(absolute, stat);
    stable(stat, fs.lstatSync(absolute, { bigint: true }), absolute);
    checkPins();
    return { stat, entry };
  };
  /** @param {string} absolute @param {string} relative */
  const add = (absolute, relative) => {
    const { stat, entry } = capture(absolute, relative, false);
    entries.push(entry);
    if (entry.type !== "directory") return;
    pinDirectory(absolute, stat);
    try {
      enumerate(absolute, name => add(path.join(absolute, name), relative === "." ? name : relative + "/" + name));
    } finally { unpin(); }
  };
  try {
    let directory = boundaryRoot;
    pinDirectory(directory, fs.lstatSync(directory, { bigint: true }));
    for (const component of path.relative(boundaryRoot, path.dirname(root)).split(path.sep).filter(Boolean)) {
      directory = path.join(directory, component);
      pinDirectory(directory, fs.lstatSync(directory, { bigint: true }));
    }
    /** @type {StagingSnapshot['parent']} */
    let parent = null;
    if (bounds.inventoryParent) {
      const parentEntries = [capture(boundaryRoot, ".", true).entry];
      enumerate(boundaryRoot, name => { parentEntries.push(capture(path.join(boundaryRoot, name), name, true).entry); });
      parentEntries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      parent = { root: boundaryRoot, entries: parentEntries };
    }
    let exists = true;
    try { fs.lstatSync(root, { bigint: true }); }
    catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") throw error;
      exists = false;
    }
    if (exists) add(root, ".");
    checkPins();
    // Inventory must still agree after the child tree has been read.
    for (const entry of parent?.entries ?? []) {
      const current = entryOf(fs.lstatSync(path.join(boundaryRoot, entry.path), { bigint: true }), entry.path);
      for (const field of STAT_FIELDS) if (entry[field] !== current[field]) throw new Error("snapshotStagingScope: parent inventory changed during snapshot");
    }
    entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return { root, boundaryRoot, exists, entries, parent, bytes };
  } finally { while (pins.length) unpin(); }
}

/** @param {StagingSnapshot} before @param {StagingSnapshot} after @param {string} label */
function sameScope(before, after, label) {
  if (before.root !== after.root || before.boundaryRoot !== after.boundaryRoot) throw new Error(label + ": snapshot roots differ");
  if (before.exists !== after.exists) throw new Error(label + ": scope existence changed (" + before.root + ")");
  if (before.parent?.root !== after.parent?.root) throw new Error(label + ": parent inventory scopes differ");
}

/** @param {string} relative */
function validRelative(relative) {
  return typeof relative === "string" && relative !== "" && !relative.includes("\\") && relative.split("/").every(part => part !== "" && part !== "." && part !== "..");
}

/**
 * @typedef {{allowedAddedPrefixes?:string[], allowedChanged?:{path:string, fields:string[]}[]}} PreservationOptions
 * @param {StagingSnapshotEntry[]} before @param {StagingSnapshotEntry[]} after @param {string} label
 * @param {PreservationOptions} options
 */
function compareEntries(before, after, label, options) {
  const prefixes = options.allowedAddedPrefixes ?? [];
  for (const prefix of prefixes) if (!validRelative(prefix)) throw new Error(label + ": invalid addition prefix");
  /** @type {Map<string, Set<string>>} */
  const intended = new Map();
  for (const change of options.allowedChanged ?? []) {
    if (!change || !(change.path === "." || validRelative(change.path)) || !Array.isArray(change.fields) || change.fields.some(field => !COMPARED_FIELDS.some(known => known === field))) throw new Error(label + ": invalid allowed change");
    intended.set(change.path, new Set(change.fields));
  }
  const left = new Map(before.map(entry => [entry.path, entry]));
  const right = new Map(after.map(entry => [entry.path, entry]));
  const changedParents = new Set();
  for (const relative of left.keys()) if (!right.has(relative)) throw new Error(label + ": path disappeared: " + relative);
  for (const relative of right.keys()) {
    if (left.has(relative)) continue;
    if (!prefixes.some(prefix => relative === prefix || relative.startsWith(prefix + "/"))) throw new Error(label + ": unexpected path appeared: " + relative);
    // Only the direct parent of an ACTUAL new entry has its directory entries
    // changed. Adding below an existing subtree does not change every ancestor.
    const slash = relative.lastIndexOf("/");
    changedParents.add(slash === -1 ? "." : relative.slice(0, slash));
  }
  for (const [relative, entry] of left) {
    const other = right.get(relative);
    if (!other) throw new Error(label + ": path disappeared: " + relative);
    for (const field of COMPARED_FIELDS) {
      if (entry[field] === other[field] || intended.get(relative)?.has(field)) continue;
      if (entry.type === "directory" && other.type === "directory" && changedParents.has(relative) && ADDITION_PARENT_FIELDS.has(field)) continue;
      throw new Error(label + ": " + relative + " " + field + " changed: " + String(entry[field]) + " -> " + String(other[field]));
    }
  }
}

/**
 * Strict byte/stat-field preservation (not ACL/xattr or atomic snapshot proof).
 * @param {StagingSnapshot} before @param {StagingSnapshot} after @param {string} label
 */
export function assertStagingScopeUnchanged(before, after, label) {
  assertStagingCallPreserved(before, after, label);
}

/**
 * Only actual permitted additions justify direct-parent nlink/size/mtime/ctime
 * changes; zero additions grant no exemption, including at the root. Explicit
 * deliberate drift permissions name exact paths AND fields. Parent inventory
 * has no allowance: its child-root metadata is checked by the full tree instead.
 * @param {StagingSnapshot} before @param {StagingSnapshot} after @param {string} label
 * @param {PreservationOptions} [options]
 */
export function assertStagingCallPreserved(before, after, label, options = {}) {
  sameScope(before, after, label);
  compareEntries(before.entries, after.entries, label, options);
  if (before.parent && after.parent) {
    const child = path.basename(before.root);
    compareEntries(before.parent.entries.filter(entry => entry.path !== child), after.parent.entries.filter(entry => entry.path !== child), label + " (owned parent)", {});
  }
}
