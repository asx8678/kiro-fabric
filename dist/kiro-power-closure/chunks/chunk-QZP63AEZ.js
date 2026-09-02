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
  sha256Bytes,
  resolveKiroProjectRoot,
  attestExecutable,
  assertExecutableAttestation,
  copyAttestedExecutable,
  readPackageVersion,
  inspectCanonicalPath,
  canonicalPathContains,
  sameCanonicalFilesystemIdentity,
  verifyCanonicalKiroProjectRootIdentity
};
