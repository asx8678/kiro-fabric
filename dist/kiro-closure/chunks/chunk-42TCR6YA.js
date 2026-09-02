import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);


// src/kiro/managed.ts
import { createHash, randomBytes } from "node:crypto";

// src/core/process-instance.ts
import fs from "node:fs";
var readLinuxBootId = () => {
  if (process.platform !== "linux") return void 0;
  try {
    const value = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim().toLowerCase();
    return /^[a-f0-9-]{16,64}$/u.test(value) ? value : void 0;
  } catch {
    return void 0;
  }
};
var readLinuxProcessStart = (pid) => {
  if (process.platform !== "linux" || !Number.isSafeInteger(pid) || pid <= 0) return void 0;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(") ");
    if (close < 0) return void 0;
    const startTicks = stat.slice(close + 2).trim().split(/\s+/u)[19];
    return startTicks && /^\d+$/u.test(startTicks) ? startTicks : void 0;
  } catch {
    return void 0;
  }
};
var processInstanceIdentity = (pid = process.pid) => {
  const bootId = readLinuxBootId();
  const processStart = readLinuxProcessStart(pid);
  return {
    pid,
    ...bootId && processStart ? { bootId, processStart } : {}
  };
};
var pidIsAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
};
var processInstanceIsAlive = (owner) => {
  if (!pidIsAlive(owner.pid)) return false;
  if (process.platform === "linux" && typeof owner.bootId === "string" && typeof owner.processStart === "string") {
    const bootId = readLinuxBootId();
    const processStart = readLinuxProcessStart(owner.pid);
    if (bootId !== void 0 && processStart !== void 0) {
      return bootId === owner.bootId && processStart === owner.processStart;
    }
  }
  return true;
};

// src/kiro/managed.ts
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// src/kiro/operation-lock-test-seam.ts
var activeProbe;
var currentOperationLockProcessProbeForTest = () => activeProbe;

// src/kiro/managed.ts
var KIRO_INSTALL_MANIFEST_FORMAT = 3;
var KIRO_PREVIOUS_INSTALL_MANIFEST_FORMAT = 2;
var KIRO_LEGACY_INSTALL_MANIFEST_FORMAT = 1;
var MANAGED_OWNER = "kiro-fabric";
var LAYOUT = {
  project: {
    profile: ".kiro/agents/kiro-fabric.json",
    manifest: ".kiro/.kiro-fabric/install.json",
    manifestDir: ".kiro/.kiro-fabric",
    backupDir: ".kiro/.kiro-fabric/backups",
    lock: ".kiro/.kiro-fabric/operation.lock",
    transaction: ".kiro/.kiro-fabric/transaction.json",
    manager: ".kiro/.kiro-fabric/bin/kiro-fabric",
    agentsDir: ".kiro/agents",
    skillsDir: ".kiro/skills",
    runtimeDir: ".fabric/runtime",
    legacyRuntimeDir: ".kiro/.kiro-fabric/runtime"
  },
  user: {
    profile: "agents/kiro-fabric.json",
    manifest: ".kiro-fabric/install.json",
    manifestDir: ".kiro-fabric",
    backupDir: ".kiro-fabric/backups",
    lock: ".kiro-fabric/operation.lock",
    transaction: ".kiro-fabric/transaction.json",
    manager: ".kiro-fabric/bin/kiro-fabric",
    agentsDir: "agents",
    skillsDir: "skills",
    runtimeDir: ".fabric/runtime",
    legacyRuntimeDir: ".kiro-fabric/runtime"
  }
};
var SHA256_HEX = /^[0-9a-f]{64}$/;
var KiroInstallError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "KiroInstallError";
    this.code = code;
  }
};
var sha256Bytes = (bytes) => createHash("sha256").update(typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes).digest("hex");
var isSha256Hex = (value) => typeof value === "string" && SHA256_HEX.test(value);
var serializeJson = (value) => `${JSON.stringify(value, null, 2)}
`;
var backupRelativePath = (digest, layout = "project") => `${LAYOUT[layout].backupDir}/${digest}.json`;
var managedPaths = (root, layout = "project") => {
  const spec = LAYOUT[layout];
  return {
    root,
    layout,
    profile: join(root, ...spec.profile.split("/")),
    profileRelative: spec.profile,
    manifest: join(root, ...spec.manifest.split("/")),
    manifestDir: join(root, ...spec.manifestDir.split("/")),
    backupDir: join(root, ...spec.backupDir.split("/")),
    backupDirRelative: spec.backupDir,
    lock: join(root, ...spec.lock.split("/")),
    transaction: join(root, ...spec.transaction.split("/")),
    manager: join(root, ...spec.manager.split("/")),
    agentsDir: join(root, ...spec.agentsDir.split("/")),
    skillsDir: join(root, ...spec.skillsDir.split("/")),
    runtimeDir: join(root, ...spec.runtimeDir.split("/")),
    legacyRuntimeDir: join(root, ...spec.legacyRuntimeDir.split("/"))
  };
};
var lstatOrNull = (path2) => {
  try {
    return lstatSync(path2);
  } catch {
    return null;
  }
};
var resolveKiroProjectRoot = (explicit) => {
  const candidate = explicit ? isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit) : process.cwd();
  let canonical;
  try {
    canonical = realpathSync(candidate);
  } catch {
    throw new KiroInstallError("root", `project root does not exist: ${candidate}`);
  }
  if (!statSync(canonical).isDirectory()) {
    throw new KiroInstallError("root", `project root is not a directory: ${canonical}`);
  }
  return canonical;
};
var assertNoSymlinkComponents = (root, target) => {
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new KiroInstallError("fs", `managed path escapes project root: ${target}`);
  }
  let cursor = root;
  const parts = rel.split(sep).filter((part) => part && part !== ".");
  for (let i = 0; i < parts.length; i++) {
    cursor = join(cursor, parts[i]);
    const stat = lstatOrNull(cursor);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      throw new KiroInstallError("symlink", `refusing symlink component: ${cursor}`);
    }
    const isLeaf = i === parts.length - 1;
    if (!isLeaf && !stat.isDirectory()) {
      throw new KiroInstallError("symlink", `expected directory component: ${cursor}`);
    }
  }
};
var assertManagedTree = (root, layout = "project") => {
  const paths = managedPaths(root, layout);
  for (const target of [
    paths.profile,
    paths.manifest,
    paths.backupDir,
    paths.skillsDir,
    paths.runtimeDir,
    paths.legacyRuntimeDir,
    paths.lock,
    paths.transaction,
    paths.manager
  ]) {
    assertNoSymlinkComponents(root, target);
  }
};
var ensureManagedDirectory = (path2) => {
  mkdirSync(path2, { recursive: true, mode: 448 });
  const stat = lstatSync(path2);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new KiroInstallError("symlink", `expected real directory: ${path2}`);
  }
};
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var parseBackupRecord = (value, root, layout = "project") => {
  if (!isRecord(value) || !isSha256Hex(value.sha256) || typeof value.path !== "string") {
    throw new KiroInstallError("manifest", "install manifest backup record is malformed");
  }
  const expected = backupRelativePath(value.sha256, layout);
  if (value.path !== expected) {
    throw new KiroInstallError(
      "manifest",
      `install manifest backup path must be ${expected}`
    );
  }
  const resolved = join(root, ...expected.split("/"));
  if (relative(root, resolved).startsWith("..")) {
    throw new KiroInstallError("backup", `backup path escapes project root: ${value.path}`);
  }
  return { path: value.path, sha256: value.sha256 };
};
var parseOwnedFiles = (value, root, layout, allowedPrefix, allowBackups) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new KiroInstallError("manifest", "install manifest owned files are malformed");
  }
  const files = value.map((entry) => {
    if (!isRecord(entry) || typeof entry.path !== "string" || !isSha256Hex(entry.installedSha256)) {
      throw new KiroInstallError("manifest", "install manifest owned file is malformed");
    }
    if (entry.path.includes("\\") || entry.path.includes("\0") || isAbsolute(entry.path) || entry.path.split("/").some((part) => part === "" || part === "." || part === "..") || !entry.path.startsWith(allowedPrefix) || entry.executableMode !== void 0 && entry.executableMode !== 365 && entry.executableMode !== 493) {
      throw new KiroInstallError("manifest", "install manifest owned file path is unsafe");
    }
    const backup = entry.backup === void 0 ? void 0 : allowBackups ? parseBackupRecord(entry.backup, root, layout) : (() => {
      throw new KiroInstallError("manifest", "runtime closure file cannot carry a backup");
    })();
    return {
      path: entry.path,
      installedSha256: entry.installedSha256,
      ...entry.executableMode === 365 || entry.executableMode === 493 ? { executableMode: entry.executableMode } : {},
      ...backup ? { backup } : {}
    };
  });
  const paths = files.map((file) => file.path);
  if (new Set(paths).size !== paths.length || paths.some((path2, index) => index > 0 && paths[index - 1] >= path2)) {
    throw new KiroInstallError("manifest", "install manifest owned files must be sorted and unique");
  }
  return files;
};
var readManifest = (root, layout = "project") => {
  const paths = managedPaths(root, layout);
  const path2 = paths.manifest;
  const stat = lstatOrNull(path2);
  if (!stat) return null;
  if (stat.isSymbolicLink()) {
    throw new KiroInstallError("symlink", `refusing manifest symlink: ${path2}`);
  }
  if (!stat.isFile()) {
    throw new KiroInstallError("manifest", `install manifest is not a regular file: ${path2}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path2, "utf8"));
  } catch {
    throw new KiroInstallError("manifest", `install manifest is malformed: ${path2}`);
  }
  if (!isRecord(parsed)) {
    throw new KiroInstallError("manifest", `install manifest is malformed: ${path2}`);
  }
  if (parsed.format !== KIRO_LEGACY_INSTALL_MANIFEST_FORMAT && parsed.format !== KIRO_PREVIOUS_INSTALL_MANIFEST_FORMAT && parsed.format !== KIRO_INSTALL_MANIFEST_FORMAT || parsed.owner !== MANAGED_OWNER) {
    throw new KiroInstallError("manifest", `install manifest is foreign: ${path2}`);
  }
  if (layout === "project") {
    if (parsed.projectRoot !== root) {
      throw new KiroInstallError(
        "manifest",
        `install manifest belongs to a different root (${String(parsed.projectRoot)}); refusing to relocate`
      );
    }
  } else if (typeof parsed.projectRoot !== "string" || !isAbsolute(parsed.projectRoot)) {
    throw new KiroInstallError("manifest", `install manifest projectRoot is malformed: ${path2}`);
  }
  if (!isRecord(parsed.profile) || !isRecord(parsed.runtime)) {
    throw new KiroInstallError("manifest", `install manifest is malformed: ${path2}`);
  }
  if (parsed.profile.path !== paths.profileRelative) {
    throw new KiroInstallError("manifest", `install manifest profile path is not managed: ${path2}`);
  }
  if (!isSha256Hex(parsed.profile.installedSha256)) {
    throw new KiroInstallError("manifest", `install manifest hash is malformed: ${path2}`);
  }
  if (typeof parsed.runtime.nodePath !== "string" || typeof parsed.runtime.mcpEntryPath !== "string") {
    throw new KiroInstallError("manifest", `install manifest runtime paths are malformed: ${path2}`);
  }
  if (parsed.runtime.kiroBinaryPath !== void 0 && (typeof parsed.runtime.kiroBinaryPath !== "string" || !isAbsolute(parsed.runtime.kiroBinaryPath)) || parsed.runtime.kiroSourcePath !== void 0 && (typeof parsed.runtime.kiroSourcePath !== "string" || !isAbsolute(parsed.runtime.kiroSourcePath)) || parsed.runtime.kiroCliVersion !== void 0 && typeof parsed.runtime.kiroCliVersion !== "string" || parsed.runtime.kiroSha256 !== void 0 && !isSha256Hex(parsed.runtime.kiroSha256) || parsed.runtime.agentEngine !== void 0 && typeof parsed.runtime.agentEngine !== "string" || parsed.runtime.managerEntryPath !== void 0 && (typeof parsed.runtime.managerEntryPath !== "string" || !isAbsolute(parsed.runtime.managerEntryPath)) || parsed.runtime.nodeSha256 !== void 0 && !isSha256Hex(parsed.runtime.nodeSha256)) {
    throw new KiroInstallError("manifest", `install manifest Kiro tuple is malformed: ${path2}`);
  }
  if (typeof parsed.packageVersion !== "string") {
    throw new KiroInstallError("manifest", `install manifest packageVersion is malformed: ${path2}`);
  }
  const backup = parsed.profile.backup === void 0 ? void 0 : parseBackupRecord(parsed.profile.backup, root, layout);
  let skills;
  let closure;
  let grants;
  if (parsed.grants !== void 0) {
    if (!isRecord(parsed.grants) || typeof parsed.grants.allowShell !== "boolean" || typeof parsed.grants.enableSubagents !== "boolean" || typeof parsed.grants.allowTools !== "boolean" || parsed.grants.enableSubagents && !parsed.grants.allowShell) {
      throw new KiroInstallError("manifest", "install manifest grant state is malformed");
    }
    grants = {
      allowShell: parsed.grants.allowShell,
      enableSubagents: parsed.grants.enableSubagents,
      allowTools: parsed.grants.allowTools
    };
  }
  if (parsed.format === KIRO_PREVIOUS_INSTALL_MANIFEST_FORMAT || parsed.format === KIRO_INSTALL_MANIFEST_FORMAT) {
    if (!isRecord(parsed.skills) || !isSha256Hex(parsed.skills.bundleSha256)) {
      throw new KiroInstallError("manifest", "install manifest skill attestation is malformed");
    }
    const skillsPrefix = relative(root, paths.skillsDir).split(sep).join("/") + "/fabric-";
    skills = {
      bundleSha256: parsed.skills.bundleSha256,
      files: parseOwnedFiles(parsed.skills.files, root, layout, skillsPrefix, true)
    };
    if (!isRecord(parsed.runtime.closure) || !isSha256Hex(parsed.runtime.closure.digest) || typeof parsed.runtime.closure.root !== "string") {
      throw new KiroInstallError("manifest", "install manifest runtime closure attestation is malformed");
    }
    const closureDigest = parsed.runtime.closure.digest;
    const runtimeRoot = parsed.runtime.closure.root;
    const managedRuntimeRoots = [paths.runtimeDir, paths.legacyRuntimeDir].map((runtimeDir) => relative(root, join(runtimeDir, closureDigest)).split(sep).join("/"));
    if (!managedRuntimeRoots.includes(runtimeRoot)) {
      throw new KiroInstallError("manifest", "install manifest runtime closure root is not managed");
    }
    closure = {
      digest: closureDigest,
      root: runtimeRoot,
      files: parseOwnedFiles(
        parsed.runtime.closure.files,
        root,
        layout,
        runtimeRoot + "/",
        false
      )
    };
    const expectedEntry = join(root, ...runtimeRoot.split("/"), "kiro", "mcp-entry.js");
    if (parsed.runtime.mcpEntryPath !== expectedEntry || !closure.files.some((file) => file.path === runtimeRoot + "/kiro/mcp-entry.js")) {
      throw new KiroInstallError("manifest", "install manifest MCP entry is not bound to its closure");
    }
    if (parsed.format === KIRO_INSTALL_MANIFEST_FORMAT) {
      const nodeName = process.platform === "win32" ? "node.exe" : "node";
      const expectedNode = join(root, ...runtimeRoot.split("/"), "bin", nodeName);
      const kiroName = process.platform === "win32" ? "kiro-cli.exe" : "kiro-cli";
      const expectedKiro = join(root, ...runtimeRoot.split("/"), "bin", kiroName);
      const expectedManager = join(root, ...runtimeRoot.split("/"), "kiro", "management-entry.js");
      const nodeSha256 = parsed.runtime.nodeSha256;
      const kiroSha256 = parsed.runtime.kiroSha256;
      if (parsed.runtime.nodePath !== expectedNode || parsed.runtime.kiroBinaryPath !== expectedKiro || typeof parsed.runtime.kiroSourcePath !== "string" || parsed.runtime.managerEntryPath !== expectedManager || !isSha256Hex(nodeSha256) || !closure.files.some((file) => file.path === runtimeRoot + "/bin/" + nodeName && file.installedSha256 === nodeSha256 && file.executableMode === 365) || !isSha256Hex(kiroSha256) || !closure.files.some((file) => file.path === runtimeRoot + "/bin/" + kiroName && file.installedSha256 === kiroSha256 && file.executableMode === 365) || !closure.files.some((file) => file.path === runtimeRoot + "/kiro/management-entry.js")) {
        throw new KiroInstallError("manifest", "install manifest lifecycle runtime is not bound to its release");
      }
    }
  }
  let generations;
  if (closure) {
    const rawGenerations = parsed.runtime.generations;
    if (rawGenerations === void 0) {
      generations = parsed.format === KIRO_PREVIOUS_INSTALL_MANIFEST_FORMAT ? [closure] : void 0;
    } else if (!Array.isArray(rawGenerations) || rawGenerations.length === 0) {
      throw new KiroInstallError("manifest", "install manifest runtime generations are malformed");
    } else {
      const parsedGenerations = rawGenerations.map((generation) => {
        if (!isRecord(generation) || !isSha256Hex(generation.digest) || typeof generation.root !== "string") {
          throw new KiroInstallError("manifest", "install manifest runtime generation is malformed");
        }
        const generationDigest = generation.digest;
        const generationRoot = generation.root;
        const managedGenerationRoots = [paths.runtimeDir, paths.legacyRuntimeDir].map((runtimeDir) => relative(root, join(runtimeDir, generationDigest)).split(sep).join("/"));
        if (!managedGenerationRoots.includes(generationRoot)) {
          throw new KiroInstallError("manifest", "install manifest runtime generation root is not managed");
        }
        return {
          digest: generationDigest,
          root: generationRoot,
          files: parseOwnedFiles(generation.files, root, layout, generationRoot + "/", false)
        };
      });
      generations = parsedGenerations;
      const roots = parsedGenerations.map((generation) => generation.root);
      if (new Set(roots).size !== roots.length || !parsedGenerations.some((generation) => generation.digest === closure.digest && generation.root === closure.root)) {
        throw new KiroInstallError("manifest", "install manifest runtime generation ownership is inconsistent");
      }
    }
  }
  return {
    format: parsed.format,
    owner: MANAGED_OWNER,
    packageVersion: parsed.packageVersion,
    projectRoot: layout === "user" ? parsed.projectRoot : root,
    profile: {
      path: paths.profileRelative,
      installedSha256: parsed.profile.installedSha256,
      ...backup ? { backup } : {}
    },
    runtime: {
      nodePath: parsed.runtime.nodePath,
      mcpEntryPath: parsed.runtime.mcpEntryPath,
      ...typeof parsed.runtime.kiroBinaryPath === "string" ? { kiroBinaryPath: parsed.runtime.kiroBinaryPath } : {},
      ...typeof parsed.runtime.kiroSourcePath === "string" ? { kiroSourcePath: parsed.runtime.kiroSourcePath } : {},
      ...typeof parsed.runtime.kiroCliVersion === "string" ? { kiroCliVersion: parsed.runtime.kiroCliVersion } : {},
      ...typeof parsed.runtime.kiroSha256 === "string" ? { kiroSha256: parsed.runtime.kiroSha256 } : {},
      ...typeof parsed.runtime.agentEngine === "string" ? { agentEngine: parsed.runtime.agentEngine } : {},
      ...typeof parsed.runtime.managerEntryPath === "string" ? { managerEntryPath: parsed.runtime.managerEntryPath } : {},
      ...typeof parsed.runtime.nodeSha256 === "string" ? { nodeSha256: parsed.runtime.nodeSha256 } : {},
      ...closure ? { closure } : {},
      ...generations ? { generations } : {}
    },
    ...skills ? { skills } : {},
    ...grants ? { grants } : {},
    ...layout === "user" ? { scope: "user" } : {}
  };
};
var assertBackupBytes = (root, record) => {
  const path2 = join(root, ...record.path.split("/"));
  assertNoSymlinkComponents(root, path2);
  const stat = lstatOrNull(path2);
  if (!stat) {
    throw new KiroInstallError("backup", `recorded backup is missing: ${path2}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new KiroInstallError("backup", `recorded backup is not a regular file: ${path2}`);
  }
  const bytes = readFileSync(path2);
  if (sha256Bytes(bytes) !== record.sha256) {
    throw new KiroInstallError("backup", `recorded backup hash mismatch: ${path2}`);
  }
  return bytes;
};
var writeAtomic = (target, bytes, mode) => {
  const staged = `${target}.kiro-fabric-tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  let descriptor;
  try {
    descriptor = openSync(staged, "wx", mode);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = void 0;
    renameSync(staged, target);
  } catch (error) {
    if (descriptor !== void 0) closeSync(descriptor);
    try {
      unlinkSync(staged);
    } catch {
    }
    throw error;
  }
};
var writeExclusive = (target, bytes, mode) => {
  const descriptor = openSync(target, "wx", mode);
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};
var managedFileTransition = (expectedSha256, next) => {
  const bytes = next === null ? null : typeof next === "string" ? Buffer.from(next, "utf8") : next;
  return {
    expectedSha256,
    nextSha256: bytes === null ? null : sha256Bytes(bytes),
    nextBase64: bytes === null ? null : bytes.toString("base64")
  };
};
var openContainedNoFollow = (root, target, flags) => {
  assertNoSymlinkComponents(root, target);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new KiroInstallError("fs", `managed path escapes project root: ${target}`);
  }
  const parts = rel.split(sep).filter((part) => part && part !== ".");
  const descriptors = [];
  try {
    if (process.platform === "linux" && existsSync("/proc/self/fd")) {
      let parent = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0));
      descriptors.push(parent);
      for (const part of parts.slice(0, -1)) {
        parent = openSync(
          `/proc/self/fd/${parent}/${part}`,
          constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0)
        );
        descriptors.push(parent);
      }
      const leafPath = parts.length === 0 ? `/proc/self/fd/${parent}` : `/proc/self/fd/${parent}/${parts.at(-1)}`;
      const descriptor2 = openSync(leafPath, flags | (constants.O_NOFOLLOW ?? 0));
      return {
        descriptor: descriptor2,
        close: () => {
          closeSync(descriptor2);
          for (const opened2 of descriptors.reverse()) closeSync(opened2);
        }
      };
    }
    const descriptor = openSync(target, flags | (constants.O_NOFOLLOW ?? 0));
    const pathStat = lstatSync(target);
    const opened = fstatSync(descriptor);
    assertNoSymlinkComponents(root, target);
    if (pathStat.dev !== opened.dev || pathStat.ino !== opened.ino) {
      closeSync(descriptor);
      throw new KiroInstallError("concurrency", `managed target changed while opening: ${target}`);
    }
    return { descriptor, close: () => closeSync(descriptor) };
  } catch (error) {
    for (const descriptor of descriptors.reverse()) {
      try {
        closeSync(descriptor);
      } catch {
      }
    }
    if (error.code === "ELOOP") {
      throw new KiroInstallError("symlink", `refusing managed symlink: ${target}`);
    }
    throw error;
  }
};
var withContainedParent = (root, target, operation) => {
  assertNoSymlinkComponents(root, target);
  const rel = relative(root, target);
  const parts = rel.split(sep).filter((part) => part && part !== ".");
  if (rel.startsWith("..") || isAbsolute(rel) || parts.length === 0) {
    throw new KiroInstallError("fs", `managed leaf path is unsafe: ${target}`);
  }
  if (process.platform !== "linux" || !existsSync("/proc/self/fd")) {
    const result = operation(dirname(target), parts.at(-1));
    assertNoSymlinkComponents(root, target);
    return result;
  }
  const descriptors = [];
  try {
    let parent = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0));
    descriptors.push(parent);
    for (const part of parts.slice(0, -1)) {
      parent = openSync(
        `/proc/self/fd/${parent}/${part}`,
        constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0)
      );
      descriptors.push(parent);
    }
    return operation(`/proc/self/fd/${parent}`, parts.at(-1));
  } finally {
    for (const descriptor of descriptors.reverse()) closeSync(descriptor);
  }
};
var writeManagedAtomic = (root, target, bytes, mode) => withContainedParent(root, target, (parent, leaf) => {
  const stagedLeaf = `.${leaf}.kiro-fabric-tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  const staged = join(parent, stagedLeaf);
  const destination = join(parent, leaf);
  let descriptor;
  try {
    descriptor = openSync(staged, "wx", mode);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = void 0;
    renameSync(staged, destination);
  } catch (error) {
    if (descriptor !== void 0) closeSync(descriptor);
    try {
      unlinkSync(staged);
    } catch {
    }
    throw error;
  }
});
var unlinkManagedNoFollow = (root, target) => withContainedParent(root, target, (parent, leaf) => unlinkSync(join(parent, leaf)));
var readManagedFileNoFollow = (root, target) => {
  assertNoSymlinkComponents(root, target);
  const stat = lstatOrNull(target);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new KiroInstallError("symlink", `managed target is not a regular no-follow file: ${target}`);
  }
  const opened = openContainedNoFollow(root, target, constants.O_RDONLY);
  try {
    if (!fstatSync(opened.descriptor).isFile()) {
      throw new KiroInstallError("fs", `managed target changed while opening: ${target}`);
    }
    return readFileSync(opened.descriptor);
  } finally {
    opened.close();
  }
};
var attestExecutable = (path2) => {
  const canonical = realpathSync(path2);
  const root = dirname(canonical);
  const opened = openContainedNoFollow(root, canonical, constants.O_RDONLY);
  try {
    const stat = fstatSync(opened.descriptor);
    if (!stat.isFile()) throw new KiroInstallError("fs", `executable is not a regular file: ${canonical}`);
    if (process.platform !== "win32" && (stat.mode & 73) === 0) {
      throw new KiroInstallError("fs", `executable is not executable: ${canonical}`);
    }
    return {
      path: canonical,
      sha256: sha256Bytes(readFileSync(opened.descriptor)),
      dev: String(stat.dev),
      ino: String(stat.ino),
      size: stat.size
    };
  } finally {
    opened.close();
  }
};
var assertExecutableAttestation = (expected) => {
  const observed = attestExecutable(expected.path);
  if (observed.sha256 !== expected.sha256 || observed.dev !== expected.dev || observed.ino !== expected.ino || observed.size !== expected.size) {
    throw new KiroInstallError("concurrency", `executable changed after attestation: ${expected.path}`);
  }
};
var copyAttestedExecutable = (source, target, mode = 493) => {
  assertExecutableAttestation(source);
  const opened = openContainedNoFollow(dirname(source.path), source.path, constants.O_RDONLY);
  let output;
  try {
    const before = fstatSync(opened.descriptor);
    output = openSync(target, "wx", mode);
    const bytes = readFileSync(opened.descriptor);
    writeFileSync(output, bytes);
    fsyncSync(output);
    const after = fstatSync(opened.descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || sha256Bytes(bytes) !== source.sha256) {
      throw new KiroInstallError("concurrency", `executable changed while copying: ${source.path}`);
    }
  } finally {
    if (output !== void 0) closeSync(output);
    opened.close();
  }
  chmodSync(target, mode);
  return attestExecutable(target);
};
var inspectManagedTransition = (root, target, transition) => {
  if (transition.expectedSha256 !== null && !isSha256Hex(transition.expectedSha256) || transition.nextSha256 !== null && !isSha256Hex(transition.nextSha256) || transition.nextBase64 === null !== (transition.nextSha256 === null)) {
    throw new KiroInstallError("manifest", "managed transaction file state is malformed");
  }
  const nextBytes = transition.nextBase64 === null ? null : Buffer.from(transition.nextBase64, "base64");
  if (nextBytes !== null && sha256Bytes(nextBytes) !== transition.nextSha256) {
    throw new KiroInstallError("manifest", "managed transaction payload hash mismatch");
  }
  const current = readManagedFileNoFollow(root, target);
  const currentHash = current === null ? null : sha256Bytes(current);
  if (currentHash !== transition.nextSha256 && currentHash !== transition.expectedSha256) {
    throw new KiroInstallError(
      "concurrency",
      `managed file changed during transaction: ${target}`
    );
  }
  return { currentHash, nextBytes };
};
var applyManagedTransition = (root, target, transition) => {
  const { currentHash, nextBytes } = inspectManagedTransition(root, target, transition);
  if (currentHash === transition.nextSha256) return;
  assertNoSymlinkComponents(root, target);
  if (nextBytes !== null) ensureManagedDirectory(dirname(target));
  if (nextBytes === null) {
    if (currentHash !== null) unlinkManagedNoFollow(root, target);
  } else {
    writeManagedAtomic(root, target, nextBytes, 384);
  }
  fsyncDirectory(resolve(target, ".."));
};
var transactionRelativePath = (root, layout, value) => {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0")) {
    throw new KiroInstallError("manifest", "managed transaction path is malformed");
  }
  const parts = value.split("/");
  if (isAbsolute(value) || parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new KiroInstallError("manifest", "managed transaction path is unsafe");
  }
  const paths = managedPaths(root, layout);
  const allowedLeaves = /* @__PURE__ */ new Set([
    relative(root, paths.profile).split(sep).join("/"),
    relative(root, paths.manifest).split(sep).join("/"),
    relative(root, join(paths.runtimeDir, ".closure-current")).split(sep).join("/"),
    relative(root, join(paths.legacyRuntimeDir, ".closure-current")).split(sep).join("/")
  ]);
  const skillsPrefix = relative(root, paths.skillsDir).split(sep).join("/") + "/fabric-";
  if (!allowedLeaves.has(value) && !value.startsWith(skillsPrefix)) {
    throw new KiroInstallError("manifest", "managed transaction path is outside owned leaves");
  }
  return value;
};
var parseManagedTransaction = (value, root, layout) => {
  if (!isRecord(value)) throw new KiroInstallError("manifest", "transaction journal is malformed");
  if (value.format !== 1 && value.format !== 2 || value.owner !== MANAGED_OWNER || value.operation !== "install" && value.operation !== "uninstall" || value.layout !== layout || value.root !== root || typeof value.createdAt !== "number") {
    throw new KiroInstallError("manifest", "transaction journal is foreign or malformed");
  }
  if (value.format === 1) {
    if (!isRecord(value.profile) || !isRecord(value.manifest)) {
      throw new KiroInstallError("manifest", "legacy transaction journal is malformed");
    }
  } else {
    if (!Array.isArray(value.files) || value.files.length < 2) {
      throw new KiroInstallError("manifest", "managed transaction file list is malformed");
    }
    const seen = /* @__PURE__ */ new Set();
    for (const file of value.files) {
      if (!isRecord(file) || !isRecord(file.transition)) {
        throw new KiroInstallError("manifest", "managed transaction file entry is malformed");
      }
      const rel = transactionRelativePath(root, layout, file.path);
      if (seen.has(rel)) throw new KiroInstallError("manifest", "managed transaction path is duplicated");
      seen.add(rel);
    }
    const manifestRel = relative(root, managedPaths(root, layout).manifest).split(sep).join("/");
    const last = value.files[value.files.length - 1];
    if (!isRecord(last) || last.path !== manifestRel) {
      throw new KiroInstallError("manifest", "managed transaction manifest must be last");
    }
  }
  return value;
};
var writeManagedTransactionJournal = (root, layout, transaction) => {
  const paths = managedPaths(root, layout);
  assertManagedTree(root, layout);
  writeManagedAtomic(root, paths.transaction, serializeJson(transaction), 384);
  fsyncDirectory(paths.manifestDir);
};
var readManagedTransaction = (root, layout) => {
  const paths = managedPaths(root, layout);
  const bytes = readManagedFileNoFollow(root, paths.transaction);
  if (bytes === null) return null;
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new KiroInstallError("manifest", `transaction journal is malformed: ${paths.transaction}`);
  }
  return parseManagedTransaction(value, root, layout);
};
var probeManagedTransactionRecovery = (root, layout = "project") => {
  const paths = managedPaths(root, layout);
  const transaction = readManagedTransaction(root, layout);
  if (!transaction) return false;
  if (transaction.format === 1) {
    inspectManagedTransition(root, paths.profile, transaction.profile);
    inspectManagedTransition(root, paths.manifest, transaction.manifest);
  } else {
    for (const file of transaction.files) {
      const rel = transactionRelativePath(root, layout, file.path);
      inspectManagedTransition(root, join(root, ...rel.split("/")), file.transition);
    }
  }
  return true;
};
var recoverManagedTransaction = (root, layout = "project") => {
  const paths = managedPaths(root, layout);
  const transaction = readManagedTransaction(root, layout);
  if (!transaction) return false;
  if (transaction.format === 1) {
    applyManagedTransition(root, paths.profile, transaction.profile);
    applyManagedTransition(root, paths.manifest, transaction.manifest);
  } else {
    for (const file of transaction.files) {
      const rel = transactionRelativePath(root, layout, file.path);
      applyManagedTransition(root, join(root, ...rel.split("/")), file.transition);
    }
  }
  assertNoSymlinkComponents(root, paths.transaction);
  unlinkManagedNoFollow(root, paths.transaction);
  fsyncDirectory(paths.manifestDir);
  return true;
};
var commitManagedFileTransaction = (root, layout, operation, files) => {
  const normalized = files.map((file) => ({
    path: relative(root, file.path).split(sep).join("/"),
    transition: file.transition
  }));
  const transaction = {
    format: 2,
    owner: MANAGED_OWNER,
    operation,
    layout,
    root,
    createdAt: Date.now(),
    files: normalized
  };
  parseManagedTransaction(transaction, root, layout);
  writeManagedTransactionJournal(root, layout, transaction);
  recoverManagedTransaction(root, layout);
};
var fsyncDirectory = (dir) => {
  let descriptor;
  try {
    descriptor = openSync(dir, "r");
    fsyncSync(descriptor);
  } catch {
  } finally {
    if (descriptor !== void 0) closeSync(descriptor);
  }
};
var readPackageVersion = () => {
  const candidates = [
    resolve(import.meta.dirname, "..", "package.json"),
    resolve(import.meta.dirname, "..", "..", "package.json")
  ];
  for (const [index, candidate] of candidates.entries()) {
    if (!existsSync(candidate)) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(candidate, "utf8"));
    } catch {
      throw new KiroInstallError("ownership", `immediate package metadata is malformed: ${candidate}`);
    }
    if (pkg.name === "kiro-fabric-runtime-closure") {
      const releaseRoot = dirname(candidate);
      const marker = readFileSync(join(releaseRoot, ".closure-digest"), "utf8").trim();
      if (!isSha256Hex(pkg.digest) || marker !== pkg.digest || typeof pkg.version !== "string") {
        throw new KiroInstallError("ownership", "release package metadata is not bound to its closure digest");
      }
      return pkg.version;
    }
    if (index === 1 && pkg.name === "kiro-fabric" && typeof pkg.version === "string") {
      return pkg.version;
    }
    throw new KiroInstallError("ownership", `unexpected immediate package metadata: ${candidate}`);
  }
  throw new KiroInstallError("fs", `cannot resolve immediate Fabric package metadata from ${import.meta.dirname}`);
};
var defaultMcpEntryPath = () => {
  const layout = join(import.meta.dirname, "mcp-entry.js");
  if (existsSync(layout)) return layout;
  return resolve(import.meta.dirname, "..", "kiro", "mcp-entry.js");
};
var observeOperationLockProcess = (pid) => {
  const injected = currentOperationLockProcessProbeForTest();
  if (injected) return injected(pid);
  try {
    process.kill(pid, 0);
    return { liveness: "alive", identity: processInstanceIdentity(pid) };
  } catch (error) {
    const code = error.code;
    if (code === "ESRCH") return { liveness: "missing" };
    return { liveness: "indeterminate" };
  }
};
var processIdentityMismatch = (owner, current) => current !== void 0 && (typeof owner.bootId === "string" && typeof current.bootId === "string" && owner.bootId !== current.bootId || typeof owner.processStart === "string" && typeof current.processStart === "string" && owner.processStart !== current.processStart);
var acquireOperationLock = (root, layout = "project") => {
  const paths = managedPaths(root, layout);
  assertManagedTree(root, layout);
  ensureManagedDirectory(paths.manifestDir);
  assertNoSymlinkComponents(root, paths.lock);
  const existing = lstatOrNull(paths.lock);
  if (existing) {
    const existingBytes = readManagedFileNoFollow(root, paths.lock);
    let stale = false;
    if (existingBytes) {
      try {
        const owner = JSON.parse(existingBytes.toString("utf8"));
        if (Number.isSafeInteger(owner.pid) && owner.pid > 0 && owner.hostname === hostname() && typeof owner.token === "string") {
          const observed = observeOperationLockProcess(owner.pid);
          stale = observed.liveness === "missing" || observed.liveness === "alive" && processIdentityMismatch({
            bootId: typeof owner.bootId === "string" ? owner.bootId : void 0,
            processStart: typeof owner.processStart === "string" ? owner.processStart : void 0
          }, observed.identity);
        }
      } catch {
      }
    }
    if (!stale) {
      throw new KiroInstallError(
        "concurrency",
        `another install/uninstall is in progress: ${paths.lock}`
      );
    }
    const revalidated = readManagedFileNoFollow(root, paths.lock);
    if (!revalidated || sha256Bytes(revalidated) !== sha256Bytes(existingBytes)) {
      throw new KiroInstallError("concurrency", `operation lock changed during recovery: ${paths.lock}`);
    }
    unlinkManagedNoFollow(root, paths.lock);
    fsyncDirectory(paths.manifestDir);
  }
  const token = randomBytes(16).toString("hex");
  const instance = processInstanceIdentity();
  const body = serializeJson({
    token,
    pid: process.pid,
    hostname: hostname(),
    ...instance.bootId ? { bootId: instance.bootId } : {},
    ...instance.processStart ? { processStart: instance.processStart } : {}
  });
  try {
    writeExclusive(paths.lock, body, 384);
  } catch (error) {
    const code = error.code;
    if (code === "EEXIST") {
      throw new KiroInstallError(
        "concurrency",
        `another install/uninstall is in progress: ${paths.lock}`
      );
    }
    throw error;
  }
  let released = false;
  return {
    path: paths.lock,
    release: () => {
      if (released) return;
      released = true;
      try {
        const current = readManagedFileNoFollow(root, paths.lock);
        if (current && sha256Bytes(current) === sha256Bytes(body)) {
          unlinkManagedNoFollow(root, paths.lock);
          fsyncDirectory(paths.manifestDir);
        }
      } catch {
      }
    }
  };
};
var rmdirIfEmpty = (path2) => {
  try {
    const stat = lstatSync(path2);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    rmdirSync(path2);
  } catch {
  }
};

// src/kiro/canonical-path.ts
import {
  lstatSync as lstatSync2,
  realpathSync as realpathSync2,
  statSync as statSync2
} from "node:fs";
import path from "node:path";
var inspectCanonicalPath = (value, options = {}) => {
  if (!path.isAbsolute(value)) throw new Error("path must be absolute");
  const lexicalPath = path.resolve(value);
  const lexicalStats = lstatSync2(lexicalPath);
  const canonicalPath = realpathSync2(lexicalPath);
  const targetStats = statSync2(canonicalPath, { bigint: true });
  const finalEntryIsSymlink = lexicalStats.isSymbolicLink();
  if (options.rejectFinalSymlink && finalEntryIsSymlink) {
    throw new Error("selected entry must not be a symlink");
  }
  if (options.kind === "directory" && !targetStats.isDirectory()) {
    throw new Error("selected entry must be a directory");
  }
  if (options.kind === "file" && !targetStats.isFile()) {
    throw new Error("selected entry must be a regular file");
  }
  return {
    lexicalPath,
    canonicalPath,
    finalEntryIsSymlink,
    lexicalStats,
    targetStats,
    identity: {
      dev: targetStats.dev,
      ino: targetStats.ino,
      ctimeNs: typeof targetStats.ctimeNs === "bigint" ? targetStats.ctimeNs : void 0
    }
  };
};
var canonicalPathContains = (canonicalAncestor, canonicalTarget) => {
  const relative2 = path.relative(canonicalAncestor, canonicalTarget);
  return relative2 === "" || relative2 !== ".." && !relative2.startsWith(`..${path.sep}`) && !path.isAbsolute(relative2);
};
var sameCanonicalFilesystemIdentity = (left, right, options = {}) => left.dev === right.dev && left.ino === right.ino && (options.includeCtime !== true || left.ctimeNs !== void 0 && right.ctimeNs !== void 0 && left.ctimeNs === right.ctimeNs);

// src/kiro/project-root-identity.ts
var resolveCanonicalKiroProjectRootIdentity = (projectRoot) => {
  let inspected;
  try {
    inspected = inspectCanonicalPath(projectRoot, {
      kind: "directory",
      rejectFinalSymlink: true
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `trusted Kiro project root ${projectRoot} is unreadable (${detail}); reinstall the profile`
    );
  }
  return {
    root: inspected.canonicalPath,
    dev: String(inspected.identity.dev),
    ino: String(inspected.identity.ino)
  };
};
var verifyCanonicalKiroProjectRootIdentity = (projectRoot, expected) => {
  const current = resolveCanonicalKiroProjectRootIdentity(projectRoot);
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new Error(
      "trusted Kiro project root filesystem identity changed; reinstall the profile from the same canonical project path"
    );
  }
  return current;
};

export {
  processInstanceIdentity,
  processInstanceIsAlive,
  KIRO_INSTALL_MANIFEST_FORMAT,
  KiroInstallError,
  sha256Bytes,
  serializeJson,
  backupRelativePath,
  managedPaths,
  lstatOrNull,
  resolveKiroProjectRoot,
  assertNoSymlinkComponents,
  assertManagedTree,
  ensureManagedDirectory,
  readManifest,
  assertBackupBytes,
  writeAtomic,
  writeExclusive,
  managedFileTransition,
  withContainedParent,
  readManagedFileNoFollow,
  attestExecutable,
  assertExecutableAttestation,
  copyAttestedExecutable,
  probeManagedTransactionRecovery,
  recoverManagedTransaction,
  commitManagedFileTransaction,
  fsyncDirectory,
  readPackageVersion,
  defaultMcpEntryPath,
  acquireOperationLock,
  rmdirIfEmpty,
  inspectCanonicalPath,
  canonicalPathContains,
  sameCanonicalFilesystemIdentity,
  resolveCanonicalKiroProjectRootIdentity,
  verifyCanonicalKiroProjectRootIdentity
};
