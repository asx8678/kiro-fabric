import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { canonical, hashRegular, readRegular, LIMITS } from "./bundle-contract.mjs";
import { captureDirectoryAncestry, readDirectoryBoundedSync } from "../src/installation/filesystem-boundary.mjs";
import { pinnedDirectoryIdentity, pinnedEntryIdentity, runPinnedDirectoryOperation } from "./pinned-directory-child.mjs";

export const CACHE_RECORDS = ".installer-cache-records";
const LEASES = ".installer-artifact-leases";
const GATE = ".installer-cache-gate";
const BOUND = 8192;
export const exists = file => { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
export function artifactKind(name) {
  if (/^\.kiro-fabric-agent-generation-[a-f0-9]{64}$/u.test(name)) return "agent";
  if (/^kiro-fabric-bundle-(?:linux|darwin)-(?:arm64|x64)-[a-f0-9]{64}$/u.test(name)) return "bundle";
  if (/^private-tools-[a-f0-9]{64}$/u.test(name)) return "tools";
  return null;
}
export function privateDirectory(directory) {
  const guard = captureDirectoryAncestry(directory);
  const s = fs.lstatSync(directory);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o7777) !== 0o700 || s.uid !== process.getuid?.()) throw new Error(`Unsafe private cache directory: ${directory}`);
  return guard;
}
export function cacheDirectory(root, create = false) {
  const guard = captureDirectoryAncestry(root);
  const directory = path.join(guard.root, ".tmp");
  if (!exists(directory)) {
    if (!create) return null;
    try { cacheMutation(guard.root, { operation: "mkdir", name: ".tmp" }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  guard.check(); privateDirectory(directory).check();
  return directory;
}
function ensureDirectory(parent, name) {
  const directory = path.join(parent, name);
  if (!exists(directory)) {
    try { cacheMutation(parent, { operation: "mkdir", name }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  privateDirectory(directory).check(); return directory;
}
const same = (a, b) => canonical(a) === canonical(b);
export const cacheFileIdentity = file => pinnedEntryIdentity(fs.lstatSync(file, { bigint: true }));
export function unlinkCapturedFile(file, expected) {
  cacheMutation(path.dirname(file), { operation: "unlink", name: path.basename(file), expected });
}
// All effects are fixed single-component operations. The shared primitive uses
// proven Linux descriptor traversal or a child whose cwd is verified against
// inherited fd3 BEFORE any effect. Never substitute generic pathname writes.
function cacheMutation(directory, request, data = Buffer.alloc(0)) {
  const guard = captureDirectoryAncestry(directory), parent = pinnedDirectoryIdentity(fs.lstatSync(directory, { bigint: true }));
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const check = () => { guard.check(); if (!same(pinnedDirectoryIdentity(fs.fstatSync(fd, { bigint: true })), parent)) throw new Error("Cache directory changed"); };
    const base = { fd, cwd: directory, parent, check, maxBytes: LIMITS.manifest };
    check();
    if (request.operation === "replace") {
      const written = runPinnedDirectoryOperation({ ...base, operation: "writeExclusive", name: request.pending, data, mode: 0o600 });
      return runPinnedDirectoryOperation({ ...base, operation: "rename", name: request.pending, target: request.name, expected: written, ...(request.expected === null ? {} : { targetExpected: request.expected }) });
    }
    if (request.operation === "rmdir") {
      // Removing our captured children intentionally changes directory clocks.
      // Retain the original inode/owner/mode binding, then pass a fresh EXACT
      // identity to the fixed primitive. Unknown additions still prevent rmdir.
      const now = cacheFileIdentity(path.join(directory, request.name));
      for (const key of ["dev", "ino", "mode", "uid", "gid"]) if (now[key] !== request.expected[key]) throw new Error("Cache directory changed before removal; preserve evidence");
      request = { ...request, expected: now };
    }
    return runPinnedDirectoryOperation({ ...base, ...request, operation: request.operation === "mkdir" ? "mkdir0700" : request.operation === "write" ? "writeExclusive" : request.operation, data });
  } finally { fs.closeSync(fd); }
}
export async function readCacheJson(file) {
  const guard = captureDirectoryAncestry(path.dirname(file));
  const bytes = await readRegular(file, LIMITS.manifest, { mode: 0o600 });
  guard.check(); return JSON.parse(bytes.toString("utf8"));
}
export async function publishCacheJson(file, value) {
  const parent = path.dirname(file), guard = privateDirectory(parent);
  if (exists(file)) await readCacheJson(file); // refuse symlinks, aliases, malformed or unsafe prior metadata
  guard.check();
  cacheMutation(parent, { operation: "replace", name: path.basename(file), pending: `.cache-next-${randomBytes(16).toString("hex")}`, expected: exists(file) ? cacheFileIdentity(file) : null }, Buffer.from(canonical(value) + "\n"));
}
function checkRecord(record, name) {
  if (!record || record.schema !== 1 || record.generation !== name || artifactKind(name) !== record.kind ||
      !/^[a-f0-9]{64}$/u.test(record.digest ?? "") || !name.endsWith(record.digest) ||
      !record.identity || typeof record.identity !== "object" || Array.isArray(record.identity) ||
      Object.keys(record).sort().join(",") !== "digest,generation,identity,kind,schema") throw new Error("Invalid installer artifact record; preserve and inspect it");
  return record;
}
export async function readArtifactRecord(parent, name) {
  if (!artifactKind(name)) throw new Error("Unknown installer generation path");
  const records = path.join(parent, CACHE_RECORDS); privateDirectory(records);
  return checkRecord(await readCacheJson(path.join(records, `${name}.json`)), name);
}
export async function artifactRecords(parent, kind) {
  const directory = path.join(parent, CACHE_RECORDS);
  if (!exists(directory)) return [];
  const guard = privateDirectory(directory), result = [];
  for (const file of readDirectoryBoundedSync(directory, BOUND).sort()) {
    const name = file.endsWith(".json") ? file.slice(0, -5) : "";
    if (!artifactKind(name) || kind && artifactKind(name) !== kind) continue;
    result.push(await readArtifactRecord(parent, name));
  }
  guard.check(); return result;
}
export async function recordInstallerArtifact(parent, record) {
  checkRecord(record, record.generation);
  const directory = ensureDirectory(parent, CACHE_RECORDS), file = path.join(directory, `${record.generation}.json`);
  if (exists(file)) {
    const previous = await readArtifactRecord(parent, record.generation);
    // A verified rebuild with a different host toolchain can produce identical
    // bytes. Refresh this lookup hint, not the immutable generation. Callers must
    // independently validate the selected generation before registering it.
    if (!same(previous, record)) await publishCacheJson(file, record);
    return;
  }
  // Exclusive first registration: interrupted/partial receipts remain evidence.
  try { cacheMutation(directory, { operation: "write", name: path.basename(file) }, Buffer.from(canonical(record) + "\n")); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  if (!same(await readArtifactRecord(parent, record.generation), record)) throw new Error("Concurrent installer artifact record conflict");
}

/** Cooperative checkout-only exclusion. No PID scan, expiration, or stale-lock
 * recovery: any uncertain gate/lease must be inspected and remains evidence. */
export async function withInstallerCacheGate(root, callback) {
  const parent = cacheDirectory(root, true), gate = path.join(parent, GATE);
  const token = randomBytes(16).toString("hex"), owner = { schema: 1, token, pid: process.pid };
  const deadline = Date.now() + 2000;
  for (;;) {
    try { cacheMutation(parent, { operation: "mkdir", name: GATE }); break; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw Object.assign(new Error("Installer cache gate busy or stale; preserve and inspect it"), { code: "INSTALLER_CACHE_BUSY" });
      await delay(20);
    }
  }
  const guard = privateDirectory(gate), gateIdentity = cacheFileIdentity(gate);
  cacheMutation(gate, { operation: "write", name: "owner.json" }, Buffer.from(canonical(owner) + "\n"));
  const ownerIdentity = cacheFileIdentity(path.join(gate, "owner.json"));
  try { return await callback(parent); }
  finally {
    guard.check();
    if (!same(cacheFileIdentity(path.join(gate, "owner.json")), ownerIdentity) || !same(await readCacheJson(path.join(gate, "owner.json")), owner) || readDirectoryBoundedSync(gate, 2).join() !== "owner.json") throw new Error("Installer cache gate changed; preserve evidence");
    unlinkCapturedFile(path.join(gate, "owner.json"), ownerIdentity);
    guard.check(); cacheMutation(parent, { operation: "rmdir", name: GATE, expected: gateIdentity });
  }
}
/** Hold across the WHOLE build/activation or artifact consumption, not just lookup.
 * Each call owns a unique on-disk lease; nested and concurrent consumers are safe.
 * A crashed consumer leaves its lease. GC refuses ALL leases, even dead/stale ones.
 * @template T @param {string} root @param {() => Promise<T>} callback @returns {Promise<T>} */
export async function withInstallerArtifactLease(root, callback) {
  let lease, owner, guard, leaseIdentity;
  await withInstallerCacheGate(root, async parent => {
    const directory = ensureDirectory(parent, LEASES); guard = privateDirectory(directory);
    const token = randomBytes(16).toString("hex");
    owner = { schema: 1, root: path.dirname(parent), pid: process.pid, token };
    lease = path.join(directory, `${token}.json`);
    cacheMutation(directory, { operation: "write", name: `${token}.json` }, Buffer.from(canonical(owner) + "\n"));
    leaseIdentity = cacheFileIdentity(lease);
  });
  try { return await callback(); }
  finally {
    await withInstallerCacheGate(root, async () => {
      guard.check();
      if (!same(cacheFileIdentity(lease), leaseIdentity) || !same(await readCacheJson(lease), owner)) throw new Error("Installer artifact lease changed; preserve evidence");
      unlinkCapturedFile(lease, leaseIdentity);
    });
  }
}
export function assertNoArtifactLeases(parent) {
  const directory = path.join(parent, LEASES);
  if (!exists(directory)) return;
  privateDirectory(directory);
  if (readDirectoryBoundedSync(directory, BOUND).length) throw Object.assign(new Error("Installer artifacts in use or leases uncertain/stale; preserve all leases and generations"), { code: "INSTALLER_CACHE_BUSY" });
}

// Bounded, descriptor-checked hashing plus an exact metadata/directory boundary.
// This is a capture for ONE validation, never a persistent integrity authority.
function treeMetadata(root) {
  privateDirectory(root);
  const entries = [], pending = [""]; let bytes = 0;
  while (pending.length) {
    const relative = pending.pop(), directory = path.join(root, relative), guard = privateDirectory(directory);
    entries.push({ path: relative, type: "directory", identity: cacheFileIdentity(directory) });
    for (const name of readDirectoryBoundedSync(directory, BOUND - entries.length - pending.length).sort()) {
      const rel = relative ? `${relative}/${name}` : name, file = path.join(root, rel), s = fs.lstatSync(file);
      if (s.isDirectory() && !s.isSymbolicLink()) pending.push(rel);
      else {
        if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.uid !== process.getuid?.() || ![0o600, 0o700].includes(s.mode & 0o7777)) throw new Error(`Unsafe cache entry: ${rel}`);
        bytes += s.size;
        if (s.size > LIMITS.file || bytes > LIMITS.bytes) throw new Error("Cache byte bound");
        entries.push({ path: rel, type: "file", identity: cacheFileIdentity(file), size: s.size, mode: s.mode & 0o7777 });
      }
      if (entries.length + pending.length > BOUND) throw new Error("Cache entry bound");
    }
    guard.check();
  }
  return entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
/** @param {string} root @param {{path:string,size:number,mode:number}[]} [expectedFiles] */
export async function captureArtifactTree(root, expectedFiles) {
  const guard = privateDirectory(root), entries = treeMetadata(root), files = [];
  if (expectedFiles) {
    const actual = entries.filter(entry => entry.type === "file").map(entry => ({ path: entry.path, size: entry.size, mode: entry.mode }));
    const expected = expectedFiles.map(entry => ({ path: entry.path, size: entry.size, mode: entry.mode })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    if (!same(actual, expected)) throw new Error("Pinned cache inventory/size/mode drifted; preserve and inspect it");
  }
  for (const entry of entries) if (entry.type === "file") {
    files.push({ path: entry.path, mode: entry.mode, ...await hashRegular(path.join(root, entry.path), entry.size, { mode: entry.mode }) });
  }
  const capture = { root, entries, files, bytes: files.reduce((n, file) => n + file.size, 0) };
  guard.check(); assertArtifactTreeUnchanged(capture); return capture;
}
export function assertArtifactTreeUnchanged(capture) {
  if (!same(treeMetadata(capture.root), capture.entries)) throw new Error("Cache tree changed during validation; preserve and inspect it");
}
/** Only after an independent validator and a second byte capture agree, with the
 * GC gate held and no consumers. All paths are descriptor anchored; no rm -r. */
export function removeCapturedArtifact(capture) {
  assertArtifactTreeUnchanged(capture);
  const files = capture.entries.filter(entry => entry.type === "file");
  for (const entry of files) {
    const file = path.join(capture.root, entry.path);
    unlinkCapturedFile(file, entry.identity);
  }
  const directories = capture.entries.filter(entry => entry.type === "directory").sort((a, b) => b.path.length - a.path.length);
  for (const entry of directories) {
    const directory = path.join(capture.root, entry.path);
    cacheMutation(path.dirname(directory), { operation: "rmdir", name: path.basename(directory), expected: entry.identity }); // unknown additions prevent removal
  }
}
