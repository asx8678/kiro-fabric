#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAgentProfile } from "./agent-profile.mjs";
import { captureDirectoryAncestry, readDirectoryBoundedSync, directoryIsEmpty } from "./filesystem-boundary.mjs";
import {
  snapshotTree,
  validateAgentPackage,
  validateInstalledAgentProfile,
} from "./validate-agent-package.mjs";

const OWNER = "kiro-fabric-agent-user-install";
const MANIFEST = "install-owner.json";
const MANIFEST_SCHEMA = 2;
const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_INSTALL_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_RUNTIME_GENERATIONS = 256;
const MAX_TREE_INVENTORY_ENTRIES = 501;
const MAX_RUNTIME_DIRECTORY_ENTRIES = 2_048;

const lstat = (target) => {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isContained = (root, target) => {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
const paths = (kiroHome) => ({
  base: path.join(kiroHome, "kiro-fabric"),
  profile: path.join(kiroHome, "agents", "kiro-fabric.json"),
  manifest: path.join(kiroHome, "kiro-fabric", MANIFEST),
  data: path.join(kiroHome, "kiro-fabric", "data"),
  skills: path.join(kiroHome, "kiro-fabric", "skills"),
  runtime: path.join(kiroHome, "kiro-fabric", "runtime"),
});

const assertCurrentUser = (stats, label) => {
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error(`${label} is not owned by the current user`);
  }
};

const assertSafeDirectory = (target, options = {}) => {
  const absolute = path.resolve(target);
  const stats = fs.lstatSync(absolute);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`unsafe directory: ${absolute}`);
  assertCurrentUser(stats, `directory ${absolute}`);
  if (process.platform !== "win32") {
    const forbidden = options.private ? 0o077 : 0o022;
    if ((stats.mode & forbidden) !== 0) throw new Error(`unsafe directory permissions: ${absolute}`);
  }
  captureDirectoryAncestry(absolute, { label: "unsafe directory ancestry", allowMacAliases: true });
  return absolute;
};

const assertSafeFile = (target, label = "control file") => {
  const absolute = path.resolve(target);
  const stats = fs.lstatSync(absolute);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) throw new Error(`unsafe ${label}: ${absolute}`);
  assertCurrentUser(stats, `${label} ${absolute}`);
  if (process.platform !== "win32" && (stats.mode & 0o022) !== 0) throw new Error(`unsafe ${label} permissions: ${absolute}`);
  return stats;
};

const assertTrustedExecutable = (target) => {
  const absolute = path.resolve(target);
  const stats = fs.lstatSync(absolute);
  const currentUid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const reasons = [];
  if (!stats.isFile()) reasons.push("not a regular file");
  if (stats.isSymbolicLink()) reasons.push("symbolic link");
  if (stats.nlink !== 1) reasons.push("link count must be 1");
  if (currentUid !== undefined && stats.uid !== currentUid && stats.uid !== 0) reasons.push("owner must be current user or root");
  if (process.platform !== "win32") {
    if ((stats.mode & 0o020) !== 0) reasons.push("group-writable");
    if ((stats.mode & 0o002) !== 0) reasons.push("world-writable");
    if ((stats.mode & 0o111) === 0) reasons.push("no execute bits");
  }
  if (reasons.length > 0) {
    // Bound and quote the path so unusual executable names cannot forge log lines.
    const displayPath = JSON.stringify(absolute.length > 512 ? `${absolute.slice(0, 512)}…` : absolute);
    throw new Error(`unsafe Node executable: ${displayPath}; ${reasons.join(", ")} (uid=${stats.uid}, currentUid=${currentUid ?? "unavailable"}, mode=${(stats.mode & 0o7777).toString(8)}, nlink=${stats.nlink})`);
  }
  captureDirectoryAncestry(path.dirname(absolute), { label: "unsafe Node executable directory ancestry", allowMacAliases: true });
  return absolute;
};

const nearestExistingDirectory = (target) => {
  let current = path.resolve(target);
  const missing = [];
  while (!lstat(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`no existing parent for ${target}`);
    missing.unshift(current);
    current = parent;
  }
  assertSafeDirectory(current);
  return { existing: current, missing };
};

const assertNoUnsafeSymlinkComponents = (target) => {
  const absolute = path.resolve(target);
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stats = lstat(current);
    if (!stats) break;
    if (!stats.isSymbolicLink()) continue;
    const allowedMacAlias = process.platform === "darwin" && ["/etc", "/tmp", "/var"].includes(current);
    if (!allowedMacAlias) throw new Error(`symlinked KIRO_HOME component is not allowed: ${current}`);
  }
};

const assertNoSymlinkComponents = (target, label) => {
  const absolute = path.resolve(target);
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stats = fs.lstatSync(current);
    if (stats.isSymbolicLink()) throw new Error(`${label} contains a symlink component: ${current}`);
  }
};

const assertNotDangerouslyBroad = (target, userHome) => {
  const root = path.parse(target).root;
  const parts = path.relative(root, target).split(path.sep).filter(Boolean);
  const forbidden = new Set([
    root,
    path.resolve(userHome),
    path.join(root, "tmp"),
    path.join(root, "var"),
    path.join(root, "usr"),
    path.join(root, "etc"),
    path.join(root, "opt"),
    path.join(root, "private"),
    path.join(root, "Users"),
    path.join(root, "home"),
  ]);
  if (parts.length < 2 || forbidden.has(target)) throw new Error(`KIRO_HOME is dangerously broad: ${target}`);
};

const assertNoPathOverlap = (left, right, label) => {
  if (isContained(left, right) || isContained(right, left)) {
    throw new Error(`KIRO_HOME must not overlap ${label}: ${right}`);
  }
};

export const resolveKiroHome = (env = process.env, userHome = homedir(), options = {}) => {
  if (typeof userHome !== "string" || !path.isAbsolute(userHome)) throw new Error("HOME must be an absolute path");
  const explicit = Object.prototype.hasOwnProperty.call(env, "KIRO_HOME");
  const raw = options.kiroHome !== undefined ? options.kiroHome : explicit ? env.KIRO_HOME : path.join(userHome, ".kiro");
  if (typeof raw !== "string" || raw.trim() === "") throw new Error("KIRO_HOME must not be empty");
  if (!path.isAbsolute(raw)) throw new Error("KIRO_HOME must be an absolute path");
  if (/[\u0000-\u001f\u007f]/u.test(raw)) throw new Error("KIRO_HOME must not contain control characters");
  const target = path.normalize(raw);
  assertNotDangerouslyBroad(target, path.resolve(userHome));
  assertNoUnsafeSymlinkComponents(target);
  const finalStats = lstat(target);
  if (finalStats?.isSymbolicLink()) throw new Error(`symlinked KIRO_HOME is not allowed: ${target}`);
  const { existing, missing } = nearestExistingDirectory(target);
  assertCurrentUser(fs.lstatSync(existing), `nearest KIRO_HOME ancestor ${existing}`);
  if (lstat(target)) assertSafeDirectory(target);
  const canonical = path.join(fs.realpathSync(existing), ...missing.map((entry) => path.basename(entry)));
  const homeAncestor = nearestExistingDirectory(userHome);
  const canonicalUserHome = path.join(fs.realpathSync(homeAncestor.existing), ...homeAncestor.missing.map(entry => path.basename(entry)));
  assertNotDangerouslyBroad(canonical, canonicalUserHome);
  for (const [label, candidate] of Object.entries({
    workspace: options.workspaceRoot,
    "release package": options.packageRoot,
  })) {
    if (candidate === undefined) continue;
    const absolute = fs.realpathSync(path.resolve(candidate));
    assertNoPathOverlap(canonical, absolute, label);
  }
  // Only explicit source builds may share the exact home. Nested checkouts and
  // release/workspace overlaps retain the original fail-closed policy.
  if (options.sourceRoot !== undefined) {
    const source = fs.realpathSync(path.resolve(options.sourceRoot));
    if (source !== canonical) assertNoPathOverlap(canonical, source, "source checkout");
  }
  return canonical;
};

const ensureDirectory = (target, options, created) => {
  const absolute = path.resolve(target);
  if (lstat(absolute)) return assertSafeDirectory(absolute, options);
  const parent = path.dirname(absolute);
  if (!lstat(parent)) ensureDirectory(parent, { private: true }, created);
  else assertSafeDirectory(parent, { private: options.parentPrivate ?? options.private });
  fs.mkdirSync(absolute, { mode: 0o700 });
  created.push(absolute);
  return assertSafeDirectory(absolute, { private: true });
};

const removeIfEmpty = (target) => {
  const stats = lstat(target);
  if (!stats) return;
  assertSafeDirectory(target);
  if (directoryIsEmpty(target)) fs.rmdirSync(target);
};

const copyTree = (source, target) => {
  const stats = fs.lstatSync(source);
  if (stats.isSymbolicLink()) throw new Error(`symlink source: ${source}`);
  assertCurrentUser(stats, `source ${source}`);
  if (stats.isDirectory()) {
    fs.mkdirSync(target, { mode: 0o700 });
    for (const entry of readDirectoryBoundedSync(source, MAX_TREE_INVENTORY_ENTRIES).sort()) copyTree(path.join(source, entry), path.join(target, entry));
    return;
  }
  if (!stats.isFile() || stats.nlink !== 1) throw new Error(`unsupported source: ${source}`);
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(target, 0o600);
};

const atomicWrite = (target, bytes, onRenamed) => {
  const parent = assertSafeDirectory(path.dirname(target));
  const temporary = path.join(parent, `.${path.basename(target)}.${process.pid}.${randomBytes(8).toString("hex")}`);
  try {
    fs.writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
    const descriptor = fs.openSync(temporary, "r");
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, target);
    onRenamed?.();
    const directory = fs.openSync(parent, "r");
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } finally {
    if (lstat(temporary)) fs.unlinkSync(temporary);
  }
};

const assertSameTree = (target, expected, label) => {
  const actual = snapshotTree(target);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const expectedFiles = new Map((expected?.files ?? []).map((entry) => [entry.path, entry]));
    const firstFileDifference = actual.files.find((entry) => JSON.stringify(entry) !== JSON.stringify(expectedFiles.get(entry.path))) ??
      (expected?.files ?? []).find((entry) => !actual.files.some((candidate) => candidate.path === entry.path));
    const detail = JSON.stringify(actual.directories) !== JSON.stringify(expected?.directories)
      ? `directory inventory ${JSON.stringify(actual.directories)} != ${JSON.stringify(expected?.directories)}`
      : `file inventory ${JSON.stringify(firstFileDifference)}`;
    throw new Error(`modified or unowned ${label}: ${target} (expected ${expected?.digest ?? "invalid"}, received ${actual.digest}; ${detail})`);
  }
  return actual;
};

const assertDigest = (value, label) => {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) throw new Error(`invalid ${label} in install manifest`);
};

const validateRuntimeRecord = (record) => {
  if (!record || typeof record !== "object" || !HASH_PATTERN.test(record.name ?? "") ||
      !record.tree || typeof record.tree !== "object") {
    throw new Error("invalid runtime generation in install manifest");
  }
  assertDigest(record.tree.digest, "runtime tree digest");
  if (!Array.isArray(record.tree.directories) || !Array.isArray(record.tree.files) ||
      record.tree.directories.length + record.tree.files.length > MAX_TREE_INVENTORY_ENTRIES) {
    throw new Error("invalid or oversized runtime inventory in install manifest");
  }
  return record;
};

const readManifest = (installPaths) => {
  if (!lstat(installPaths.manifest)) return undefined;
  const manifestStats = assertSafeFile(installPaths.manifest, "install manifest");
  if (manifestStats.size > MAX_INSTALL_MANIFEST_BYTES) throw new Error("install manifest exceeds its byte bound");
  const bytes = fs.readFileSync(installPaths.manifest);
  let manifest;
  try { manifest = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("invalid Kiro Fabric install manifest"); }
  if (manifest.owner !== OWNER) throw new Error("unowned Kiro Fabric installation");
  if (manifest.schemaVersion === 1) {
    assertDigest(manifest.packageDigest, "legacy package digest");
    assertDigest(manifest.profileSha256, "legacy profile digest");
    assertDigest(manifest.skillSha256, "legacy skill digest");
    const expectedRuntime = path.join(installPaths.runtime, manifest.packageDigest);
    if (typeof manifest.runtime !== "string" || !path.isAbsolute(manifest.runtime) ||
        path.normalize(manifest.runtime) !== expectedRuntime) {
      throw new Error("unsafe legacy runtime path");
    }
    assertSafeFile(installPaths.profile, "owned profile");
    if (hash(fs.readFileSync(installPaths.profile)) !== manifest.profileSha256) throw new Error(`modified owned profile: ${installPaths.profile}`);
    const skillRoot = path.join(installPaths.skills, "fabric-exec");
    assertSafeFile(path.join(skillRoot, "SKILL.md"), "owned skill");
    if (hash(fs.readFileSync(path.join(skillRoot, "SKILL.md"))) !== manifest.skillSha256) {
      throw new Error(`modified owned skill: ${skillRoot}`);
    }
    // Schema 1 authenticated only the profile and primary SKILL.md. Snapshot
    // the remaining trees so a same-operation change is detected, but never
    // promote those unauthenticated bytes into the schema-2 ownership list.
    const skillTree = snapshotTree(skillRoot);
    const runtimeTree = snapshotTree(expectedRuntime);
    return {
      manifest,
      legacy: {
        skillRoot,
        skillTree,
        runtimeRoot: expectedRuntime,
        runtimeTree,
      },
      bytes,
    };
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA || typeof manifest.packageDigest !== "string" ||
      !HASH_PATTERN.test(manifest.packageDigest) || !HASH_PATTERN.test(manifest.profileSha256 ?? "") ||
      !manifest.skill || !Array.isArray(manifest.runtimeGenerations) ||
      manifest.runtimeGenerations.length > MAX_RUNTIME_GENERATIONS || !HASH_PATTERN.test(manifest.currentRuntime ?? "")) {
    throw new Error("invalid Kiro Fabric install manifest");
  }
  assertDigest(manifest.skill.digest, "skill tree digest");
  if (!Array.isArray(manifest.skill.directories) || !Array.isArray(manifest.skill.files) ||
      manifest.skill.directories.length + manifest.skill.files.length > MAX_TREE_INVENTORY_ENTRIES) {
    throw new Error("invalid or oversized skill inventory in install manifest");
  }
  const names = new Set();
  for (const record of manifest.runtimeGenerations) {
    validateRuntimeRecord(record);
    if (names.has(record.name)) throw new Error("duplicate runtime generation in install manifest");
    names.add(record.name);
  }
  if (!names.has(manifest.currentRuntime)) throw new Error("current runtime is absent from install manifest");
  return { manifest, bytes, legacy: undefined };
};

const assertInstallationUnmodified = (installPaths, previousRecord) => {
  const previous = previousRecord.manifest;
  assertSafeFile(installPaths.profile, "owned profile");
  if (hash(fs.readFileSync(installPaths.profile)) !== previous.profileSha256) {
    throw new Error(`modified owned profile: ${installPaths.profile}`);
  }
  if (previousRecord.legacy) {
    assertSafeFile(path.join(previousRecord.legacy.skillRoot, "SKILL.md"), "owned skill");
    if (hash(fs.readFileSync(path.join(previousRecord.legacy.skillRoot, "SKILL.md"))) !== previous.skillSha256) {
      throw new Error(`modified owned skill: ${previousRecord.legacy.skillRoot}`);
    }
    assertSameTree(previousRecord.legacy.skillRoot, previousRecord.legacy.skillTree, "legacy skill tree");
    assertSameTree(previousRecord.legacy.runtimeRoot, previousRecord.legacy.runtimeTree, "legacy runtime tree");
    return;
  }
  assertSameTree(path.join(installPaths.skills, "fabric-exec"), previous.skill, "owned skill tree");
  for (const generation of previous.runtimeGenerations) {
    assertSameTree(path.join(installPaths.runtime, generation.name), generation.tree, `owned runtime generation ${generation.name}`);
  }
};

const assertNoUnownedRuntimeGenerations = (installPaths, previousRecord) => {
  if (!lstat(installPaths.runtime)) return;
  const owned = new Set(previousRecord?.legacy
    ? [previousRecord.manifest.packageDigest]
    : (previousRecord?.manifest.runtimeGenerations ?? []).map((record) => record.name));
  const directory = fs.opendirSync(installPaths.runtime);
  let entries = 0;
  try {
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      entries += 1;
      if (entries > MAX_RUNTIME_DIRECTORY_ENTRIES) throw new Error("runtime directory exceeds its entry bound");
      if (HASH_PATTERN.test(entry.name) && !owned.has(entry.name)) {
        throw new Error(`refusing unowned runtime generation: ${path.join(installPaths.runtime, entry.name)}`);
      }
    }
  } finally {
    directory.closeSync();
  }
};

const assertUnownedTargetsAbsent = (installPaths, generationName) => {
  if (lstat(installPaths.profile)) throw new Error(`refusing to overwrite unowned profile: ${installPaths.profile}`);
  const skill = path.join(installPaths.skills, "fabric-exec");
  if (lstat(skill)) throw new Error(`refusing to overwrite unowned skill: ${skill}`);
  const generation = path.join(installPaths.runtime, generationName);
  if (lstat(generation)) throw new Error(`refusing to adopt unowned runtime generation: ${generation}`);
};

const inspectTarget = (kiroHome, installPaths, generationName) => {
  if (lstat(kiroHome)) assertSafeDirectory(kiroHome);
  if (lstat(installPaths.base)) assertSafeDirectory(installPaths.base, { private: true });
  if (lstat(path.dirname(installPaths.profile))) assertSafeDirectory(path.dirname(installPaths.profile));
  if (lstat(installPaths.runtime)) assertSafeDirectory(installPaths.runtime, { private: true });
  if (lstat(installPaths.skills)) assertSafeDirectory(installPaths.skills, { private: true });
  if (lstat(installPaths.data)) assertSafeDirectory(installPaths.data, { private: true });
  if (lstat(path.join(installPaths.data, "fabric"))) {
    assertSafeDirectory(path.join(installPaths.data, "fabric"), { private: true });
  }
  const previous = readManifest(installPaths);
  if (previous) {
    assertInstallationUnmodified(installPaths, previous);
    assertNoUnownedRuntimeGenerations(installPaths, previous);
    // Read-only health validates existing ownership, not admission of an update.
    if (generationName === undefined) return previous;
    if (!previous.legacy && !previous.manifest.runtimeGenerations.some((record) => record.name === generationName) &&
        previous.manifest.runtimeGenerations.length >= MAX_RUNTIME_GENERATIONS) {
      throw new Error("runtime generation count exceeds its update bound; no generation was removed");
    }
    const generation = path.join(installPaths.runtime, generationName);
    const generationIsLegacy = previous.legacy && generation === previous.legacy.runtimeRoot;
    if (lstat(generation) && !generationIsLegacy &&
        !previous.manifest.runtimeGenerations?.some((record) => record.name === generationName)) {
      throw new Error(`refusing to adopt unowned runtime generation: ${generation}`);
    }
  }
  else {
    assertNoUnownedRuntimeGenerations(installPaths, undefined);
    if (generationName !== undefined) assertUnownedTargetsAbsent(installPaths, generationName);
  }
  return previous;
};

const acquireLock = (base) => {
  const target = path.join(base, ".install.lock");
  try {
    fs.mkdirSync(target, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("another Kiro Fabric install is in progress");
    throw error;
  }
  const stats = fs.lstatSync(target);
  const nonce = randomBytes(32).toString("hex");
  try {
    assertSafeDirectory(target, { private: true });
    fs.writeFileSync(path.join(target, "owner.json"), `${JSON.stringify({ pid: process.pid, nonce })}\n`, { mode: 0o600, flag: "wx" });
    return { target, dev: stats.dev, ino: stats.ino, nonce };
  } catch (error) {
    try { fs.rmdirSync(target); } catch {}
    throw error;
  }
};

const releaseLock = (lock) => {
  const stats = fs.lstatSync(lock.target);
  if (!stats.isDirectory() || stats.isSymbolicLink() || stats.dev !== lock.dev || stats.ino !== lock.ino) {
    throw new Error("install lock ownership changed during operation");
  }
  assertCurrentUser(stats, "install lock");
  const entries = readDirectoryBoundedSync(lock.target, 2);
  if (JSON.stringify(entries) !== JSON.stringify(["owner.json"])) throw new Error("install lock contains unowned content");
  const owner = path.join(lock.target, "owner.json");
  assertSafeFile(owner, "install lock owner");
  const parsed = JSON.parse(fs.readFileSync(owner, "utf8"));
  if (parsed.pid !== process.pid || parsed.nonce !== lock.nonce) throw new Error("install lock identity changed during operation");
  fs.unlinkSync(owner);
  fs.rmdirSync(lock.target);
};

const prepareMigration = (input, destination, options) => {
  if (input === undefined) return undefined;
  if (typeof input !== "string" || !path.isAbsolute(input)) throw new Error("--migrate-power-data requires an absolute path");
  const requested = path.normalize(input);
  const legacyFabric = path.basename(requested) === "fabric" ? requested : path.join(requested, "fabric");
  assertNoSymlinkComponents(legacyFabric, "legacy Fabric data root");
  const canonicalLegacyFabric = fs.realpathSync(legacyFabric);
  assertSafeDirectory(canonicalLegacyFabric, { private: true });
  if (options.workspaceRoot) assertNoPathOverlap(canonicalLegacyFabric, fs.realpathSync(path.resolve(options.workspaceRoot)), "the current workspace");
  assertNoPathOverlap(canonicalLegacyFabric, destination, "the Agent data root");
  const entries = ["config", "projects"]
    .filter((name) => lstat(path.join(canonicalLegacyFabric, name)))
    .map((name) => ({ name, tree: snapshotTree(path.join(canonicalLegacyFabric, name)) }));
  if (entries.length === 0) throw new Error("legacy Fabric data contains no config or projects directory");
  for (const entry of entries) assertSafeDirectory(path.join(canonicalLegacyFabric, entry.name), { private: true });
  if (lstat(destination)) {
    assertSafeDirectory(destination, { private: true });
    if (!directoryIsEmpty(destination)) throw new Error("agent data is not empty; migration refused");
  }
  return { source: canonicalLegacyFabric, entries };
};

const restoreRequiredMove = (backup, target, label) => {
  const backupStats = lstat(backup);
  const targetStats = lstat(target);
  if (backupStats && targetStats) throw new Error(`rollback collision while restoring ${label}`);
  if (backupStats) fs.renameSync(backup, target);
  else if (!targetStats) throw new Error(`rollback backup is missing for ${label}`);
};

const rollbackInstall = (state) => {
  // Restore payload first and publish its authenticating manifest last. If a
  // payload restore fails, the caller invalidates the active manifest and
  // leaves this transaction intact as recovery material.
  for (const migrated of state.migrated) {
    if (lstat(migrated)) fs.rmSync(migrated, { recursive: true });
  }
  if (state.profileInstalled && lstat(state.paths.profile)) fs.unlinkSync(state.paths.profile);
  if (state.profileBackedUp) restoreRequiredMove(state.backupProfile, state.paths.profile, "profile");
  const skillTarget = path.join(state.paths.skills, "fabric-exec");
  if (state.skillInstalled && lstat(skillTarget)) fs.rmSync(skillTarget, { recursive: true });
  if (state.skillBackedUp) restoreRequiredMove(state.backupSkill, skillTarget, "skill");
  if (state.generationInstalled && lstat(state.generation)) fs.rmSync(state.generation, { recursive: true });
  if (state.legacyPublished && lstat(state.legacyPreservedRoot)) {
    fs.renameSync(state.legacyPreservedRoot, state.legacyPreparedRoot);
    state.legacyPublished = false;
  }
  if (state.legacySkillMoved) {
    restoreRequiredMove(path.join(state.legacyPreparedRoot, "skill"), state.legacySkillRoot, "legacy skill tree");
  }
  if (state.legacyRuntimeMoved) {
    restoreRequiredMove(path.join(state.legacyPreparedRoot, "runtime"), state.legacyRuntimeRoot, "legacy runtime tree");
  }
  if (state.previousRecord) {
    assertInstallationUnmodified(state.paths, state.previousRecord);
  } else if (lstat(state.paths.profile) || lstat(skillTarget) || lstat(state.generation)) {
    throw new Error("rollback left Agent payload behind after a new installation");
  }
  if (state.manifestWritten) {
    if (state.previousManifestBytes) atomicWrite(state.paths.manifest, state.previousManifestBytes);
    else if (lstat(state.paths.manifest)) fs.unlinkSync(state.paths.manifest);
  }
};

export const installUserAgent = (stagingRoot = MODULE_ROOT, env = process.env, userHome = homedir(), options = {}) => {
  if (!["linux", "darwin"].includes(process.platform)) throw new Error("Agent installation requires Linux or macOS");
  if (!/^v?(?:2[4-9]|[3-9]\d|\d{3,})\./u.test(process.version)) throw new Error("Node.js >=24 is required");

  const staged = validateAgentPackage(stagingRoot);
  // Invocation cwd is not an authorized coding workspace. Only an explicit
  // workspace role participates in the installer overlap check.
  const workspaceRoot = options.workspaceRoot;
  const kiroHome = resolveKiroHome(env, userHome, { workspaceRoot, packageRoot: staged.root });
  const installPaths = paths(kiroHome);
  const generationName = staged.digest;
  const generation = path.join(installPaths.runtime, generationName);
  const nodePath = assertTrustedExecutable(fs.realpathSync(process.execPath));
  const migration = prepareMigration(options.migratePowerData, path.join(installPaths.data, "fabric"), { workspaceRoot });
  inspectTarget(kiroHome, installPaths, generationName);

  const created = [];
  ensureDirectory(kiroHome, { private: false }, created);
  ensureDirectory(installPaths.base, { private: true }, created);
  const lock = acquireLock(installPaths.base);
  let transaction;
  let completed = false;
  let committed = false;
  let rollbackCompleted = false;
  const state = {
    paths: installPaths,
    generation,
    generationInstalled: false,
    profileInstalled: false,
    profileBackedUp: false,
    skillInstalled: false,
    skillBackedUp: false,
    manifestWritten: false,
    previousManifestBytes: undefined,
    previousRecord: undefined,
    backupProfile: undefined,
    backupSkill: undefined,
    previousManifestBackup: undefined,
    legacyPreparedRoot: undefined,
    legacyPreservedRoot: undefined,
    legacySkillRoot: undefined,
    legacyRuntimeRoot: undefined,
    legacySkillMoved: false,
    legacyRuntimeMoved: false,
    legacyPublished: false,
    migrated: [],
  };
  try {
    const previousRecord = inspectTarget(kiroHome, installPaths, generationName);
    const previous = previousRecord?.manifest;
    state.previousManifestBytes = previousRecord?.bytes;
    state.previousRecord = previousRecord;
    ensureDirectory(path.dirname(installPaths.profile), { private: false }, created);
    ensureDirectory(installPaths.runtime, { private: true }, created);
    ensureDirectory(installPaths.skills, { private: true }, created);
    ensureDirectory(installPaths.data, { private: true }, created);
    ensureDirectory(path.join(installPaths.data, "fabric"), { private: true }, created);

    transaction = path.join(installPaths.base, `.installing-${process.pid}-${randomBytes(16).toString("hex")}`);
    fs.mkdirSync(transaction, { mode: 0o700 });
    if (state.previousManifestBytes) {
      state.previousManifestBackup = path.join(transaction, "previous-manifest.json");
      fs.writeFileSync(state.previousManifestBackup, state.previousManifestBytes, { mode: 0o600, flag: "wx" });
    }
    const preparedRuntime = path.join(transaction, "runtime");
    const preparedSkill = path.join(transaction, "skill");
    copyTree(path.join(staged.root, "runtime"), preparedRuntime);
    copyTree(path.join(staged.root, "skills", "fabric-exec"), preparedSkill);
    assertSameTree(preparedRuntime, staged.runtime, "prepared runtime");
    assertSameTree(preparedSkill, staged.skill, "prepared skill");

    const skillTarget = path.join(installPaths.skills, "fabric-exec");
    const skillPath = path.join(skillTarget, "SKILL.md");
    const profileOptions = {
      nodePath,
      runtimeRoot: generation,
      dataRoot: installPaths.data,
      skillPath,
    };
    const profile = generateAgentProfile(profileOptions);
    const profileBytes = Buffer.from(`${JSON.stringify(profile, null, 2)}\n`);
    const preparedProfile = path.join(transaction, "kiro-fabric.json");
    fs.writeFileSync(preparedProfile, profileBytes, { mode: 0o600, flag: "wx" });

    const migrationRoot = path.join(transaction, "migration");
    if (migration) {
      fs.mkdirSync(migrationRoot, { mode: 0o700 });
      for (const entry of migration.entries) {
        const prepared = path.join(migrationRoot, entry.name);
        copyTree(path.join(migration.source, entry.name), prepared);
        assertSameTree(prepared, entry.tree, `prepared migration ${entry.name}`);
      }
    }
    const stagedAgain = validateAgentPackage(staged.root);
    if (stagedAgain.digest !== staged.digest || JSON.stringify(stagedAgain.inventory) !== JSON.stringify(staged.inventory)) {
      throw new Error("Agent package changed during installation");
    }

    const runtimeGenerations = previousRecord?.legacy ? [] : previous ? [...previous.runtimeGenerations] : [];
    const existingRuntimeIndex = runtimeGenerations.findIndex((record) => record.name === generationName);
    const runtimeRecord = { name: generationName, tree: staged.runtime };
    if (existingRuntimeIndex >= 0) runtimeGenerations[existingRuntimeIndex] = runtimeRecord;
    else runtimeGenerations.push(runtimeRecord);
    runtimeGenerations.sort((left, right) => left.name.localeCompare(right.name));
    const manifest = {
      schemaVersion: MANIFEST_SCHEMA,
      owner: OWNER,
      packageDigest: staged.digest,
      profileSha256: hash(profileBytes),
      skill: staged.skill,
      currentRuntime: generationName,
      runtimeGenerations,
    };

    if (previousRecord?.legacy) {
      state.legacyPreparedRoot = path.join(transaction, "preserved-legacy-schema1");
      state.legacyPreservedRoot = path.join(
        installPaths.base,
        `.legacy-schema1-${previous.packageDigest}-${randomBytes(16).toString("hex")}`,
      );
      if (lstat(state.legacyPreservedRoot)) throw new Error(`legacy preservation target already exists: ${state.legacyPreservedRoot}`);
      fs.mkdirSync(state.legacyPreparedRoot, { mode: 0o700 });
      state.legacySkillRoot = previousRecord.legacy.skillRoot;
      state.legacyRuntimeRoot = previousRecord.legacy.runtimeRoot;
      assertSameTree(state.legacySkillRoot, previousRecord.legacy.skillTree, "legacy skill tree before preservation");
      assertSameTree(state.legacyRuntimeRoot, previousRecord.legacy.runtimeTree, "legacy runtime tree before preservation");
      fs.renameSync(state.legacySkillRoot, path.join(state.legacyPreparedRoot, "skill"));
      state.legacySkillMoved = true;
      fs.renameSync(state.legacyRuntimeRoot, path.join(state.legacyPreparedRoot, "runtime"));
      state.legacyRuntimeMoved = true;
    }

    if (lstat(generation)) {
      if (!previous?.runtimeGenerations.some((record) => record.name === generationName)) {
        throw new Error(`refusing to adopt unowned runtime generation: ${generation}`);
      }
      assertSameTree(generation, staged.runtime, "existing runtime generation");
      fs.rmSync(preparedRuntime, { recursive: true });
    } else {
      fs.renameSync(preparedRuntime, generation);
      state.generationInstalled = true;
    }
    options.onCommitStep?.("runtime");

    state.backupSkill = path.join(transaction, "previous-skill");
    if (lstat(skillTarget)) {
      fs.renameSync(skillTarget, state.backupSkill);
      state.skillBackedUp = true;
    }
    fs.renameSync(preparedSkill, skillTarget);
    state.skillInstalled = true;
    options.onCommitStep?.("skill");

    state.backupProfile = path.join(transaction, "previous-profile");
    if (lstat(installPaths.profile)) {
      fs.renameSync(installPaths.profile, state.backupProfile);
      state.profileBackedUp = true;
    }
    fs.renameSync(preparedProfile, installPaths.profile);
    state.profileInstalled = true;
    options.onCommitStep?.("profile");

    if (migration) {
      const dataTarget = path.join(installPaths.data, "fabric");
      if (!directoryIsEmpty(dataTarget)) throw new Error("agent data changed during migration");
      for (const entry of migration.entries) {
        const target = path.join(dataTarget, entry.name);
        fs.renameSync(path.join(migrationRoot, entry.name), target);
        state.migrated.push(target);
      }
      options.onCommitStep?.("migration");
    }

    if (previousRecord?.legacy) {
      fs.renameSync(state.legacyPreparedRoot, state.legacyPreservedRoot);
      state.legacyPublished = true;
      options.onCommitStep?.("legacy-preserved");
    }

    atomicWrite(installPaths.manifest, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), () => { state.manifestWritten = true; });
    options.onCommitStep?.("manifest");
    assertSameTree(generation, staged.runtime, "installed runtime generation");
    assertSameTree(skillTarget, staged.skill, "installed skill");
    validateInstalledAgentProfile(installPaths.profile, { ...profileOptions, installRoot: installPaths.base });
    const installedManifest = readManifest(installPaths);
    if (!installedManifest || JSON.stringify(installedManifest.manifest) !== JSON.stringify(manifest)) {
      throw new Error("installed manifest verification failed");
    }

    // The new manifest now describes and authenticates the complete active
    // installation. Old backups are private inert cleanup from this point, so
    // cleanup failure must never roll the active install back after deleting a
    // backup needed for restoration.
    committed = true;
    completed = true;
    state.generationInstalled = false;
    state.skillInstalled = false;
    state.profileInstalled = false;
    state.manifestWritten = false;
    options.onCleanupStep?.("committed");
    if (state.skillBackedUp) fs.rmSync(state.backupSkill, { recursive: true });
    if (state.profileBackedUp) fs.unlinkSync(state.backupProfile);
    fs.rmSync(transaction, { recursive: true });
    transaction = undefined;

    // Active sessions may still open files from ANY earlier generation. This
    // legacy installer has no reliable session-liveness proof, so updates must
    // retain every owned runtime and its manifest record until explicit uninstall.
    // inspectTarget enforces MAX_RUNTIME_GENERATIONS before any mutation; never
    // make room at that bound by deleting a possibly live generation.

    const leftoverPower = [
      path.join(kiroHome, "powers", "kiro-fabric"),
      path.join(kiroHome, "powers", "installed", "kiro-fabric"),
    ].filter((candidate) => lstat(candidate));
    if (leftoverPower.length) {
      console.error(`warning: leftover Kiro Fabric Power at ${leftoverPower.join(" and ")} may duplicate @fabric; disable or uninstall that Power`);
    }
    completed = true;
    return {
      root: installPaths.base,
      profile: installPaths.profile,
      runtime: generation,
      data: installPaths.data,
      packageDigest: staged.digest,
      preservedLegacy: previousRecord?.legacy ? {
        root: state.legacyPreservedRoot,
        runtime: path.join(state.legacyPreservedRoot, "runtime"),
        skill: path.join(state.legacyPreservedRoot, "skill"),
      } : undefined,
    };
  } catch (error) {
    if (!committed) {
      try {
        rollbackInstall(state);
        rollbackCompleted = true;
      } catch (rollbackError) {
        const failures = [error, rollbackError];
        try {
          if (lstat(installPaths.manifest)) fs.unlinkSync(installPaths.manifest);
        } catch (manifestError) {
          failures.push(manifestError);
        }
        throw new AggregateError(failures, "Agent installation and rollback both failed; recovery material was preserved");
      }
      throw error;
    }
    throw new AggregateError([error], `Agent installation committed, but post-commit cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (!committed && rollbackCompleted && transaction && lstat(transaction)) fs.rmSync(transaction, { recursive: true, force: true });
    releaseLock(lock);
    if (!completed) {
      for (const directory of created.reverse()) {
        if (lstat(directory)) removeIfEmpty(directory);
      }
    }
  }
};

export const uninstallUserAgent = (env = process.env, userHome = homedir(), options = {}) => {
  // Invocation cwd is not an authorized coding workspace. Only an explicit
  // workspace role participates in the installer overlap check.
  const workspaceRoot = options.workspaceRoot;
  const kiroHome = resolveKiroHome(env, userHome, { workspaceRoot });
  const installPaths = paths(kiroHome);
  if (!lstat(installPaths.base)) throw new Error("Kiro Fabric Agent is not installed");
  assertSafeDirectory(installPaths.base, { private: true });
  const previousRecord = readManifest(installPaths);
  if (!previousRecord) throw new Error("Kiro Fabric Agent is not installed");
  assertInstallationUnmodified(installPaths, previousRecord);
  assertNoUnownedRuntimeGenerations(installPaths, previousRecord);
  const lock = acquireLock(installPaths.base);
  const transaction = path.join(installPaths.base, `.uninstalling-${process.pid}-${randomBytes(16).toString("hex")}`);
  const moved = [];
  let committed = false;
  let rollbackCompleted = false;
  let legacyPreparedRoot;
  let legacyPreservedRoot;
  let legacyPublished = false;
  let legacySkillMoved = false;
  let legacyRuntimeMoved = false;
  try {
    const fresh = readManifest(installPaths);
    if (!fresh || JSON.stringify(fresh.manifest) !== JSON.stringify(previousRecord.manifest)) {
      throw new Error("install manifest changed before uninstall");
    }
    if (fresh.legacy && (!previousRecord.legacy ||
        JSON.stringify(fresh.legacy.skillTree) !== JSON.stringify(previousRecord.legacy.skillTree) ||
        JSON.stringify(fresh.legacy.runtimeTree) !== JSON.stringify(previousRecord.legacy.runtimeTree))) {
      throw new Error("legacy installation changed before uninstall");
    }
    assertInstallationUnmodified(installPaths, fresh);
    assertNoUnownedRuntimeGenerations(installPaths, fresh);
    fs.mkdirSync(transaction, { mode: 0o700 });
    fs.writeFileSync(path.join(transaction, "recovery-manifest.json"), fresh.bytes, { mode: 0o600, flag: "wx" });
    const move = (source, name) => {
      const target = path.join(transaction, name);
      fs.renameSync(source, target);
      moved.push({ source, target });
    };
    move(installPaths.profile, "profile");
    if (fresh.legacy) {
      legacyPreparedRoot = path.join(transaction, "preserved-legacy-schema1");
      legacyPreservedRoot = path.join(
        installPaths.base,
        `.legacy-schema1-${fresh.manifest.packageDigest}-${randomBytes(16).toString("hex")}`,
      );
      if (lstat(legacyPreservedRoot)) throw new Error(`legacy preservation target already exists: ${legacyPreservedRoot}`);
      fs.mkdirSync(legacyPreparedRoot, { mode: 0o700 });
      fs.renameSync(fresh.legacy.skillRoot, path.join(legacyPreparedRoot, "skill"));
      legacySkillMoved = true;
      fs.renameSync(fresh.legacy.runtimeRoot, path.join(legacyPreparedRoot, "runtime"));
      legacyRuntimeMoved = true;
      fs.renameSync(legacyPreparedRoot, legacyPreservedRoot);
      legacyPublished = true;
    } else {
      move(path.join(installPaths.skills, "fabric-exec"), "skill");
      for (const record of fresh.manifest.runtimeGenerations) {
        move(path.join(installPaths.runtime, record.name), `runtime-${record.name}`);
      }
    }
    if (options.purgeData && lstat(installPaths.data)) {
      assertSafeDirectory(installPaths.data, { private: true });
      move(installPaths.data, "data");
    }
    move(installPaths.manifest, "manifest");
    options.onCommitStep?.("quarantined");
    // Everything that makes the Agent discoverable or executable has now been
    // moved into a private quarantine. Cleanup is irreversible from this point;
    // a cleanup error must leave the remaining quarantine inert, never attempt
    // to restore a partially deleted installation.
    committed = true;
    fs.rmSync(transaction, { recursive: true });
    // Keep removal of owned sub-containers under the install lock. A new
    // installer must never have its freshly created runtime/skills directory
    // removed by an uninstaller that has already yielded the lock.
    for (const directory of [installPaths.skills, installPaths.runtime]) {
      if (lstat(directory)) removeIfEmpty(directory);
    }
  } catch (error) {
    if (!committed) {
      try {
        if (legacyPublished && lstat(legacyPreservedRoot)) {
          fs.renameSync(legacyPreservedRoot, legacyPreparedRoot);
          legacyPublished = false;
        }
        if (legacyRuntimeMoved && previousRecord.legacy) {
          restoreRequiredMove(
            path.join(legacyPreparedRoot, "runtime"),
            previousRecord.legacy.runtimeRoot,
            "legacy runtime tree",
          );
        }
        if (legacySkillMoved && previousRecord.legacy) {
          restoreRequiredMove(
            path.join(legacyPreparedRoot, "skill"),
            previousRecord.legacy.skillRoot,
            "legacy skill tree",
          );
        }
        const manifestMove = moved.find((entry) => entry.source === installPaths.manifest);
        for (const entry of moved.filter((candidate) => candidate !== manifestMove).reverse()) {
          restoreRequiredMove(entry.target, entry.source, path.basename(entry.source));
        }
        assertInstallationUnmodified(installPaths, previousRecord);
        if (manifestMove) {
          restoreRequiredMove(manifestMove.target, manifestMove.source, "install manifest");
        }
        assertSafeFile(installPaths.manifest, "install manifest");
        if (!fs.readFileSync(installPaths.manifest).equals(previousRecord.bytes)) {
          throw new Error("restored install manifest differs from its recovery copy");
        }
        rollbackCompleted = true;
      } catch (rollbackError) {
        const failures = [error, rollbackError];
        try {
          if (lstat(installPaths.manifest)) fs.unlinkSync(installPaths.manifest);
        } catch (manifestError) {
          failures.push(manifestError);
        }
        throw new AggregateError(failures, "Agent uninstall and rollback both failed; recovery material was preserved");
      }
      if (rollbackCompleted && lstat(transaction)) fs.rmSync(transaction, { recursive: true, force: true });
    }
    throw error;
  } finally {
    releaseLock(lock);
  }
  if (options.purgeData) removeIfEmpty(installPaths.base);
  return {
    profile: installPaths.profile,
    dataPreserved: !options.purgeData,
    data: installPaths.data,
    preservedLegacy: previousRecord.legacy ? {
      root: legacyPreservedRoot,
      runtime: path.join(legacyPreservedRoot, "runtime"),
      skill: path.join(legacyPreservedRoot, "skill"),
    } : undefined,
  };
};

// Versioned complete-generation activation reuses these existing ownership/path
// predicates rather than creating a weaker destination policy.
export const installerSafety = Object.freeze({
  paths, lstat, hash, assertSafeDirectory, assertSafeFile, assertTrustedExecutable, assertNoUnsafeSymlinkComponents,
  assertNoPathOverlap, ensureDirectory, atomicWrite, assertSameTree,
  readLegacyInstallation: (kiroHome) => inspectTarget(kiroHome, paths(kiroHome)),
});

// Offline diagnostics deliberately never acquire an install lock or initialize data.
const doctorUserAgent = () => {
  const checks = [];
  const record = (id, status, message) => checks.push({ id, status, message });
  const check = (id, action, success, failure) => {
    try { const result = action(); record(id, "PASS", success); return result; }
    catch { record(id, "FAIL", failure); return undefined; }
  };
  // Ignore empty/relative PATH entries: never resolve a tool from the workspace.
  const executable = (name) => {
    for (const directory of (process.env.PATH ?? "").split(path.delimiter).slice(0, 128)) {
      if (!path.isAbsolute(directory)) continue;
      const candidate = path.join(directory, name);
      if (!lstat(candidate)) continue;
      const resolved = assertTrustedExecutable(fs.realpathSync(candidate));
      fs.accessSync(resolved, fs.constants.X_OK);
      return resolved;
    }
    throw new Error("executable unavailable");
  };
  const nodePath = check("node", () => {
    if (!/^v?(?:2[4-9]|[3-9]\d|\d{3,})\./u.test(process.version)) throw new Error("Node too old");
    return assertTrustedExecutable(fs.realpathSync(process.execPath));
  }, `Node ${process.version} (>=24); executable trust verified.`, "Use Node >=24 with a trusted executable; no permissions were changed.");
  check("rg", () => {
    const command = executable("rg");
    const result = spawnSync(command, ["--no-config", "--version"], {
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
      cwd: path.parse(command).root, encoding: "utf8", timeout: 5000, maxBuffer: 4096,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0 || !/^ripgrep \d+\.\d+/u.test(result.stdout)) throw new Error("rg version unavailable");
    record("rg-version", "PASS", result.stdout.match(/^ripgrep \d+\.\d+(?:\.\d+)?/u)[0].slice(0, 200));
  }, "Trusted absolute rg reports a ripgrep version with config disabled and a clean environment.",
  "Install trusted ripgrep on an absolute PATH entry; version probe failed or executable is missing/unsafe.");
  check("kiro-cli", () => executable("kiro-cli"),
    "Trusted Kiro CLI available (not launched; v3/session support unverified).",
    "Install a trusted kiro-cli on an absolute PATH entry to launch the Agent.");
  const kiroHome = check("kiro-home", () => resolveKiroHome(process.env, homedir()),
    "KIRO_HOME passes installer safety checks.", "KIRO_HOME is unsafe or invalid; choose a safe absolute private location. No repair attempted.");
  if (kiroHome) {
    check("installation", () => {
      const targets = paths(kiroHome);
      const previous = inspectTarget(kiroHome, targets);
      if (!previous || !nodePath) throw new Error("installation or Node unavailable");
      const runtimeRoot = previous.legacy?.runtimeRoot ?? path.join(targets.runtime, previous.manifest.currentRuntime);
      validateInstalledAgentProfile(targets.profile, {
        nodePath, runtimeRoot, dataRoot: targets.data,
        skillPath: path.join(targets.skills, "fabric-exec", "SKILL.md"), installRoot: targets.base,
      });
    }, "Owned profile, skill and runtime inventories and installed profile bindings are valid.",
    "Installation missing, unsafe, modified, or incompatible with this Node. Review/reinstall explicitly; doctor changes nothing.");
    const config = path.join(paths(kiroHome).data, "fabric", "config", "mcp.json");
    check("mcp-file-safety", () => {
      // Inspect metadata only; never parse config, credentials, or provider definitions.
      let current = kiroHome;
      for (const part of path.relative(kiroHome, config).split(path.sep)) {
        current = path.join(current, part);
        if (!lstat(current)) {
          record("mcp-file-presence", "WARNING", "Default MCP config absent; no file was created. Explicit/session config is not inspected.");
          return;
        }
        if (current === config) {
          const stat = assertSafeFile(current, "MCP config");
          if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new Error("MCP config must be private");
        }
        else assertSafeDirectory(current, { private: true });
      }
      record("mcp-file-presence", "PASS", "Default MCP config present; contents were not read. Explicit/session config is not inspected.");
    }, "No unsafe default MCP config path detected (metadata only).", "Default MCP config path is unsafe; review ownership, links and permissions manually.");
  } else record("installation", "WARNING", "Installation/config checks skipped because KIRO_HOME is unsafe.");
  record("live-session", "WARNING", "Offline checks cannot prove dynamic workspace binding, client roots/elicitation, or configured MCP connectivity. In a running Kiro Fabric session execute: return await fabric.info()");
  return { mode: "doctor", ok: !checks.some((entry) => entry.status === "FAIL"), checks };
};
const parseArguments = (argv) => {
  const options = { doctor: false, uninstall: false, purgeData: false, migratePowerData: undefined, packageRoot: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--doctor") options.doctor = true;
    else if (argument === "--uninstall") options.uninstall = true;
    else if (argument === "--purge-data") options.purgeData = true;
    else if (argument === "--migrate-power-data") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--migrate-power-data requires an absolute path");
      options.migratePowerData = value;
      index += 1;
    } else if (argument.startsWith("--")) throw new Error(`unknown option: ${argument}`);
    else if (options.packageRoot === undefined) options.packageRoot = argument;
    else throw new Error("only one Agent package path may be supplied");
  }
  if (options.doctor && (options.uninstall || options.purgeData || options.migratePowerData !== undefined || options.packageRoot !== undefined)) {
    throw new Error("--doctor cannot be combined with install/uninstall arguments");
  }
  if (options.uninstall && options.packageRoot !== undefined) throw new Error("uninstall does not accept an Agent package path");
  if (options.uninstall && options.migratePowerData !== undefined) throw new Error("uninstall cannot migrate Power data");
  if (!options.uninstall && options.purgeData) throw new Error("--purge-data requires --uninstall");
  return options;
};

const invokedAsMain = path.basename(fileURLToPath(import.meta.url)) === "install-agent-user.mjs" && process.argv[1] !== undefined &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invokedAsMain) {
  try {
    const arguments_ = parseArguments(process.argv.slice(2));
    const result = arguments_.doctor ? doctorUserAgent() : arguments_.uninstall
      ? uninstallUserAgent(process.env, homedir(), { purgeData: arguments_.purgeData })
      : installUserAgent(arguments_.packageRoot ?? MODULE_ROOT, process.env, homedir(), { migratePowerData: arguments_.migratePowerData });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (arguments_.doctor) process.exitCode = result.ok ? 0 : 1;
    else if (!arguments_.uninstall) {
      process.stdout.write(`Validate: kiro-cli agent validate --path "${result.profile}"\nList: kiro-cli agent list\nLaunch: kiro-cli --v3 --agent kiro-fabric\nDefault (optional): kiro-cli agent set-default kiro-fabric\n`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
