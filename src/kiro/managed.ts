// Shared managed-path, manifest, lock, and hashing helpers for the
// project-scoped Kiro installer and uninstaller. Ownership is hash-based:
// never infer management from filename or profile `name` alone.

import { createHash, randomBytes } from "node:crypto";
import { processInstanceIdentity } from "../core/process-instance.js";
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
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const KIRO_INSTALL_MANIFEST_FORMAT = 3 as const;
const KIRO_PREVIOUS_INSTALL_MANIFEST_FORMAT = 2 as const;
const KIRO_LEGACY_INSTALL_MANIFEST_FORMAT = 1 as const;
const MANAGED_OWNER = "kiro-fabric" as const;

export type KiroManagedLayout = "project" | "user";

const LAYOUT = {
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
  },
} as const;

const SHA256_HEX = /^[0-9a-f]{64}$/;

export class KiroInstallError extends Error {
  readonly code:
    | "root"
    | "collision"
    | "symlink"
    | "manifest"
    | "kiro-version"
    | "kiro-validate"
    | "concurrency"
    | "fs"
    | "ownership"
    | "backup";
  constructor(code: KiroInstallError["code"], message: string) {
    super(message);
    this.name = "KiroInstallError";
    this.code = code;
  }
}

export interface KiroBackupRecord {
  path: string;
  sha256: string;
}

export interface KiroManagedOwnedFile {
  path: string;
  installedSha256: string;
  /** Required executable permission bits for installed runtime programs. */
  executableMode?: number;
  backup?: KiroBackupRecord;
}

export interface KiroRuntimeClosureManifest {
  digest: string;
  root: string;
  files: KiroManagedOwnedFile[];
}

export interface KiroManagedGrants {
  allowShell: boolean;
  enableSubagents: boolean;
  allowTools: boolean;
}

export interface KiroInstallManifest {
  format: 1 | 2 | 3;
  owner: string;
  packageVersion: string;
  projectRoot: string;
  profile: {
    path: string;
    installedSha256: string;
    backup?: KiroBackupRecord;
  };
  runtime: {
    nodePath: string;
    mcpEntryPath: string;
    /** Canonical executable selected and certified before installation. */
    kiroBinaryPath?: string;
    /** Optional only while reading a pre-v3 manifest for an installer update. */
    kiroCliVersion?: string;
    /** SHA-256 of the exact Kiro executable certified by installer preflight. */
    kiroSha256?: string;
    /** Optional only while reading a pre-v3 manifest for an installer update. */
    agentEngine?: string;
    closure?: KiroRuntimeClosureManifest;
    /** Every immutable generation owned by this installation, including closure. */
    generations?: KiroRuntimeClosureManifest[];
    /** Self-hosted lifecycle bundle, present in immutable format-3 releases. */
    managerEntryPath?: string;
    /** Digest of the attested Node executable copied into the release. */
    nodeSha256?: string;
  };
  skills?: {
    bundleSha256: string;
    files: KiroManagedOwnedFile[];
  };
  /** Explicit advanced-grant state. Optional only for manifests written before this field existed. */
  grants?: KiroManagedGrants;
  /** Present on user-home installs; omitted for project-scoped manifests. */
  scope?: "user";
}

export interface ManagedPaths {
  root: string;
  layout: KiroManagedLayout;
  profile: string;
  profileRelative: string;
  manifest: string;
  manifestDir: string;
  backupDir: string;
  backupDirRelative: string;
  lock: string;
  transaction: string;
  manager: string;
  agentsDir: string;
  skillsDir: string;
  runtimeDir: string;
}

export const sha256Bytes = (bytes: Buffer | string): string =>
  createHash("sha256")
    .update(typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes)
    .digest("hex");

const isSha256Hex = (value: unknown): value is string =>
  typeof value === "string" && SHA256_HEX.test(value);

export const serializeJson = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

export const backupRelativePath = (
  digest: string,
  layout: KiroManagedLayout = "project",
): string => `${LAYOUT[layout].backupDir}/${digest}.json`;

export const managedPaths = (
  root: string,
  layout: KiroManagedLayout = "project",
): ManagedPaths => {
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
    runtimeDir: join(root, ...spec.manifestDir.split("/"), "runtime"),
  };
};

export const lstatOrNull = (path: string) => {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
};

export const resolveKiroProjectRoot = (explicit?: string): string => {
  const candidate = explicit
    ? isAbsolute(explicit)
      ? explicit
      : resolve(process.cwd(), explicit)
    : process.cwd();
  let canonical: string;
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

/** Refuse symlink or non-directory components on every prefix of `target`. */
export const assertNoSymlinkComponents = (root: string, target: string): void => {
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new KiroInstallError("fs", `managed path escapes project root: ${target}`);
  }
  let cursor = root;
  const parts = rel.split(sep).filter((part) => part && part !== ".");
  for (let i = 0; i < parts.length; i++) {
    cursor = join(cursor, parts[i]!);
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

export const assertManagedTree = (
  root: string,
  layout: KiroManagedLayout = "project",
): void => {
  const paths = managedPaths(root, layout);
  for (const target of [
    paths.profile,
    paths.manifest,
    paths.backupDir,
    paths.skillsDir,
    paths.runtimeDir,
    paths.lock,
    paths.transaction,
    paths.manager,
  ]) {
    assertNoSymlinkComponents(root, target);
  }
};

export const ensureManagedDirectory = (path: string): void => {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new KiroInstallError("symlink", `expected real directory: ${path}`);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseBackupRecord = (
  value: unknown,
  root: string,
  layout: KiroManagedLayout = "project",
): KiroBackupRecord => {
  if (!isRecord(value) || !isSha256Hex(value.sha256) || typeof value.path !== "string") {
    throw new KiroInstallError("manifest", "install manifest backup record is malformed");
  }
  const expected = backupRelativePath(value.sha256, layout);
  if (value.path !== expected) {
    throw new KiroInstallError(
      "manifest",
      `install manifest backup path must be ${expected}`,
    );
  }
  const resolved = join(root, ...expected.split("/"));
  if (relative(root, resolved).startsWith("..")) {
    throw new KiroInstallError("backup", `backup path escapes project root: ${value.path}`);
  }
  return { path: value.path, sha256: value.sha256 };
};

const parseOwnedFiles = (
  value: unknown,
  root: string,
  layout: KiroManagedLayout,
  allowedPrefix: string,
  allowBackups: boolean,
): KiroManagedOwnedFile[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new KiroInstallError("manifest", "install manifest owned files are malformed");
  }
  const files = value.map((entry): KiroManagedOwnedFile => {
    if (!isRecord(entry) || typeof entry.path !== "string" || !isSha256Hex(entry.installedSha256)) {
      throw new KiroInstallError("manifest", "install manifest owned file is malformed");
    }
    if (
      entry.path.includes("\\") || entry.path.includes("\0") || isAbsolute(entry.path) ||
      entry.path.split("/").some((part) => part === "" || part === "." || part === "..") ||
      !entry.path.startsWith(allowedPrefix) ||
      (entry.executableMode !== undefined && entry.executableMode !== 0o555 && entry.executableMode !== 0o755)
    ) {
      throw new KiroInstallError("manifest", "install manifest owned file path is unsafe");
    }
    const backup = entry.backup === undefined
      ? undefined
      : allowBackups
        ? parseBackupRecord(entry.backup, root, layout)
        : (() => { throw new KiroInstallError("manifest", "runtime closure file cannot carry a backup"); })();
    return {
      path: entry.path,
      installedSha256: entry.installedSha256,
      ...(entry.executableMode === 0o555 || entry.executableMode === 0o755
        ? { executableMode: entry.executableMode }
        : {}),
      ...(backup ? { backup } : {}),
    };
  });
  const paths = files.map((file) => file.path);
  if (new Set(paths).size !== paths.length || paths.some((path, index) => index > 0 && paths[index - 1]! >= path)) {
    throw new KiroInstallError("manifest", "install manifest owned files must be sorted and unique");
  }
  return files;
};

export const readManifest = (
  root: string,
  layout: KiroManagedLayout = "project",
): KiroInstallManifest | null => {
  const paths = managedPaths(root, layout);
  const path = paths.manifest;
  const stat = lstatOrNull(path);
  if (!stat) return null;
  if (stat.isSymbolicLink()) {
    throw new KiroInstallError("symlink", `refusing manifest symlink: ${path}`);
  }
  if (!stat.isFile()) {
    throw new KiroInstallError("manifest", `install manifest is not a regular file: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new KiroInstallError("manifest", `install manifest is malformed: ${path}`);
  }
  if (!isRecord(parsed)) {
    throw new KiroInstallError("manifest", `install manifest is malformed: ${path}`);
  }
  if (
    (parsed.format !== KIRO_LEGACY_INSTALL_MANIFEST_FORMAT &&
      parsed.format !== KIRO_PREVIOUS_INSTALL_MANIFEST_FORMAT &&
      parsed.format !== KIRO_INSTALL_MANIFEST_FORMAT) ||
    parsed.owner !== MANAGED_OWNER
  ) {
    throw new KiroInstallError("manifest", `install manifest is foreign: ${path}`);
  }
  if (layout === "project") {
    if (parsed.projectRoot !== root) {
      throw new KiroInstallError(
        "manifest",
        `install manifest belongs to a different root (${String(parsed.projectRoot)}); refusing to relocate`,
      );
    }
  } else if (typeof parsed.projectRoot !== "string" || !isAbsolute(parsed.projectRoot)) {
    throw new KiroInstallError("manifest", `install manifest projectRoot is malformed: ${path}`);
  }
  if (!isRecord(parsed.profile) || !isRecord(parsed.runtime)) {
    throw new KiroInstallError("manifest", `install manifest is malformed: ${path}`);
  }
  if (parsed.profile.path !== paths.profileRelative) {
    throw new KiroInstallError("manifest", `install manifest profile path is not managed: ${path}`);
  }
  if (!isSha256Hex(parsed.profile.installedSha256)) {
    throw new KiroInstallError("manifest", `install manifest hash is malformed: ${path}`);
  }
  if (typeof parsed.runtime.nodePath !== "string" || typeof parsed.runtime.mcpEntryPath !== "string") {
    throw new KiroInstallError("manifest", `install manifest runtime paths are malformed: ${path}`);
  }
  if (
    (parsed.runtime.kiroBinaryPath !== undefined &&
      (typeof parsed.runtime.kiroBinaryPath !== "string" || !isAbsolute(parsed.runtime.kiroBinaryPath))) ||
    (parsed.runtime.kiroCliVersion !== undefined &&
      typeof parsed.runtime.kiroCliVersion !== "string") ||
    (parsed.runtime.kiroSha256 !== undefined && !isSha256Hex(parsed.runtime.kiroSha256)) ||
    (parsed.runtime.agentEngine !== undefined && typeof parsed.runtime.agentEngine !== "string") ||
    (parsed.runtime.managerEntryPath !== undefined &&
      (typeof parsed.runtime.managerEntryPath !== "string" || !isAbsolute(parsed.runtime.managerEntryPath))) ||
    (parsed.runtime.nodeSha256 !== undefined && !isSha256Hex(parsed.runtime.nodeSha256))
  ) {
    throw new KiroInstallError("manifest", `install manifest Kiro tuple is malformed: ${path}`);
  }
  if (typeof parsed.packageVersion !== "string") {
    throw new KiroInstallError("manifest", `install manifest packageVersion is malformed: ${path}`);
  }
  const backup =
    parsed.profile.backup === undefined
      ? undefined
      : parseBackupRecord(parsed.profile.backup, root, layout);
  let skills: KiroInstallManifest["skills"];
  let closure: KiroRuntimeClosureManifest | undefined;
  let grants: KiroManagedGrants | undefined;
  if (parsed.grants !== undefined) {
    if (
      !isRecord(parsed.grants) ||
      typeof parsed.grants.allowShell !== "boolean" ||
      typeof parsed.grants.enableSubagents !== "boolean" ||
      typeof parsed.grants.allowTools !== "boolean" ||
      (parsed.grants.enableSubagents && !parsed.grants.allowShell)
    ) {
      throw new KiroInstallError("manifest", "install manifest grant state is malformed");
    }
    grants = {
      allowShell: parsed.grants.allowShell,
      enableSubagents: parsed.grants.enableSubagents,
      allowTools: parsed.grants.allowTools,
    };
  }
  if (parsed.format === KIRO_PREVIOUS_INSTALL_MANIFEST_FORMAT || parsed.format === KIRO_INSTALL_MANIFEST_FORMAT) {
    if (!isRecord(parsed.skills) || !isSha256Hex(parsed.skills.bundleSha256)) {
      throw new KiroInstallError("manifest", "install manifest skill attestation is malformed");
    }
    const skillsPrefix = relative(root, paths.skillsDir).split(sep).join("/") + "/fabric-";
    skills = {
      bundleSha256: parsed.skills.bundleSha256,
      files: parseOwnedFiles(parsed.skills.files, root, layout, skillsPrefix, true),
    };
    if (!isRecord(parsed.runtime.closure) || !isSha256Hex(parsed.runtime.closure.digest) || typeof parsed.runtime.closure.root !== "string") {
      throw new KiroInstallError("manifest", "install manifest runtime closure attestation is malformed");
    }
    const runtimeRoot = relative(root, join(paths.manifestDir, "runtime", parsed.runtime.closure.digest))
      .split(sep).join("/");
    if (parsed.runtime.closure.root !== runtimeRoot) {
      throw new KiroInstallError("manifest", "install manifest runtime closure root is not managed");
    }
    closure = {
      digest: parsed.runtime.closure.digest,
      root: runtimeRoot,
      files: parseOwnedFiles(
        parsed.runtime.closure.files,
        root,
        layout,
        runtimeRoot + "/",
        false,
      ),
    };
    const expectedEntry = join(root, ...runtimeRoot.split("/"), "kiro", "mcp-entry.js");
    if (parsed.runtime.mcpEntryPath !== expectedEntry || !closure.files.some((file) => file.path === runtimeRoot + "/kiro/mcp-entry.js")) {
      throw new KiroInstallError("manifest", "install manifest MCP entry is not bound to its closure");
    }
    if (parsed.format === KIRO_INSTALL_MANIFEST_FORMAT) {
      const nodeName = process.platform === "win32" ? "node.exe" : "node";
      const expectedNode = join(root, ...runtimeRoot.split("/"), "bin", nodeName);
      const expectedManager = join(root, ...runtimeRoot.split("/"), "kiro", "management-entry.js");
      const nodeSha256 = parsed.runtime.nodeSha256;
      if (
        parsed.runtime.nodePath !== expectedNode ||
        parsed.runtime.managerEntryPath !== expectedManager ||
        !isSha256Hex(nodeSha256) ||
        !closure.files.some((file) => file.path === runtimeRoot + "/bin/" + nodeName && file.installedSha256 === nodeSha256 && (file.executableMode === 0o555 || file.executableMode === 0o755)) ||
        !closure.files.some((file) => file.path === runtimeRoot + "/kiro/management-entry.js") ||
        !isSha256Hex(parsed.runtime.kiroSha256)
      ) {
        throw new KiroInstallError("manifest", "install manifest lifecycle runtime is not bound to its release");
      }
    }
  }
  let generations: KiroRuntimeClosureManifest[] | undefined;
  if (closure) {
    const rawGenerations = parsed.runtime.generations;
    if (rawGenerations === undefined) {
      // Early format-3 manifests predate generation lineage. Treat their one
      // attested closure as the complete owned set so repair can migrate it.
      generations = [closure];
    } else if (!Array.isArray(rawGenerations) || rawGenerations.length === 0) {
      throw new KiroInstallError("manifest", "install manifest runtime generations are malformed");
    } else {
      generations = rawGenerations.map((generation) => {
        if (!isRecord(generation) || !isSha256Hex(generation.digest)) {
          throw new KiroInstallError("manifest", "install manifest runtime generation is malformed");
        }
        const generationRoot = relative(root, join(paths.manifestDir, "runtime", generation.digest))
          .split(sep).join("/");
        if (generation.root !== generationRoot) {
          throw new KiroInstallError("manifest", "install manifest runtime generation root is not managed");
        }
        return {
          digest: generation.digest,
          root: generationRoot,
          files: parseOwnedFiles(generation.files, root, layout, generationRoot + "/", false),
        };
      });
      const digests = generations.map((generation) => generation.digest);
      if (new Set(digests).size !== digests.length || !digests.includes(closure.digest)) {
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
      ...(backup ? { backup } : {}),
    },
    runtime: {
      nodePath: parsed.runtime.nodePath,
      mcpEntryPath: parsed.runtime.mcpEntryPath,
      ...(typeof parsed.runtime.kiroBinaryPath === "string"
        ? { kiroBinaryPath: parsed.runtime.kiroBinaryPath }
        : {}),
      ...(typeof parsed.runtime.kiroCliVersion === "string"
        ? { kiroCliVersion: parsed.runtime.kiroCliVersion }
        : {}),
      ...(typeof parsed.runtime.kiroSha256 === "string"
        ? { kiroSha256: parsed.runtime.kiroSha256 }
        : {}),
      ...(typeof parsed.runtime.agentEngine === "string"
        ? { agentEngine: parsed.runtime.agentEngine }
        : {}),
      ...(typeof parsed.runtime.managerEntryPath === "string"
        ? { managerEntryPath: parsed.runtime.managerEntryPath }
        : {}),
      ...(typeof parsed.runtime.nodeSha256 === "string"
        ? { nodeSha256: parsed.runtime.nodeSha256 }
        : {}),
      ...(closure ? { closure } : {}),
      ...(generations ? { generations } : {}),
    },
    ...(skills ? { skills } : {}),
    ...(grants ? { grants } : {}),
    ...(layout === "user" ? { scope: "user" as const } : {}),
  };
};

export const assertBackupBytes = (root: string, record: KiroBackupRecord): Buffer => {
  const path = join(root, ...record.path.split("/"));
  assertNoSymlinkComponents(root, path);
  const stat = lstatOrNull(path);
  if (!stat) {
    throw new KiroInstallError("backup", `recorded backup is missing: ${path}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new KiroInstallError("backup", `recorded backup is not a regular file: ${path}`);
  }
  const bytes = readFileSync(path);
  if (sha256Bytes(bytes) !== record.sha256) {
    throw new KiroInstallError("backup", `recorded backup hash mismatch: ${path}`);
  }
  return bytes;
};

export const writeAtomic = (target: string, bytes: Buffer | string, mode: number): void => {
  const staged = `${target}.kiro-fabric-tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(staged, "wx", mode);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(staged, target);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(staged);
    } catch {
      // staged cleanup is best-effort
    }
    throw error;
  }
};

export const writeExclusive = (target: string, bytes: Buffer | string, mode: number): void => {
  const descriptor = openSync(target, "wx", mode);
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

export interface KiroManagedFileTransition {
  expectedSha256: string | null;
  nextSha256: string | null;
  nextBase64: string | null;
}

interface KiroManagedTransactionFile {
  /** Canonical install-root-relative POSIX path. */
  path: string;
  transition: KiroManagedFileTransition;
}

export interface KiroManagedTransaction {
  format: 1 | 2;
  owner: typeof MANAGED_OWNER;
  operation: "install" | "uninstall";
  layout: KiroManagedLayout;
  root: string;
  createdAt: number;
  /** Legacy format-1 leaves. */
  profile?: KiroManagedFileTransition;
  manifest?: KiroManagedFileTransition;
  /** Format-2 ordered leaves; manifest must be last. */
  files?: KiroManagedTransactionFile[];
}

export const managedFileTransition = (
  expectedSha256: string | null,
  next: Buffer | string | null,
): KiroManagedFileTransition => {
  const bytes = next === null
    ? null
    : typeof next === "string"
      ? Buffer.from(next, "utf8")
      : next;
  return {
    expectedSha256,
    nextSha256: bytes === null ? null : sha256Bytes(bytes),
    nextBase64: bytes === null ? null : bytes.toString("base64"),
  };
};

interface OpenedNoFollow {
  descriptor: number;
  close(): void;
}

/**
 * Open a root-contained leaf with the strongest primitive Node exposes.
 * Linux gets descriptor-relative component traversal through /proc/self/fd:
 * every ancestor is held open with O_DIRECTORY|O_NOFOLLOW, so path renames or
 * symlink swaps cannot redirect the final open. Other platforms fail closed
 * around lstat/open/fstat and repeat component validation after the open.
 */
const openContainedNoFollow = (
  root: string,
  target: string,
  flags: number,
): OpenedNoFollow => {
  assertNoSymlinkComponents(root, target);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new KiroInstallError("fs", `managed path escapes project root: ${target}`);
  }
  const parts = rel.split(sep).filter((part) => part && part !== ".");
  const descriptors: number[] = [];
  try {
    if (process.platform === "linux" && existsSync("/proc/self/fd")) {
      let parent = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0));
      descriptors.push(parent);
      for (const part of parts.slice(0, -1)) {
        parent = openSync(
          `/proc/self/fd/${parent}/${part}`,
          constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0),
        );
        descriptors.push(parent);
      }
      const leafPath = parts.length === 0
        ? `/proc/self/fd/${parent}`
        : `/proc/self/fd/${parent}/${parts.at(-1)!}`;
      const descriptor = openSync(leafPath, flags | (constants.O_NOFOLLOW ?? 0));
      return {
        descriptor,
        close: () => {
          closeSync(descriptor);
          for (const opened of descriptors.reverse()) closeSync(opened);
        },
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
      try { closeSync(descriptor); } catch { /* already closed */ }
    }
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new KiroInstallError("symlink", `refusing managed symlink: ${target}`);
    }
    throw error;
  }
};

const withContainedParent = <T>(
  root: string,
  target: string,
  operation: (parentPath: string, leaf: string) => T,
): T => {
  assertNoSymlinkComponents(root, target);
  const rel = relative(root, target);
  const parts = rel.split(sep).filter((part) => part && part !== ".");
  if (rel.startsWith("..") || isAbsolute(rel) || parts.length === 0) {
    throw new KiroInstallError("fs", `managed leaf path is unsafe: ${target}`);
  }
  if (process.platform !== "linux" || !existsSync("/proc/self/fd")) {
    const result = operation(dirname(target), parts.at(-1)!);
    assertNoSymlinkComponents(root, target);
    return result;
  }
  const descriptors: number[] = [];
  try {
    let parent = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0));
    descriptors.push(parent);
    for (const part of parts.slice(0, -1)) {
      parent = openSync(
        `/proc/self/fd/${parent}/${part}`,
        constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0),
      );
      descriptors.push(parent);
    }
    return operation(`/proc/self/fd/${parent}`, parts.at(-1)!);
  } finally {
    for (const descriptor of descriptors.reverse()) closeSync(descriptor);
  }
};

const writeManagedAtomic = (
  root: string,
  target: string,
  bytes: Buffer | string,
  mode: number,
): void => withContainedParent(root, target, (parent, leaf) => {
  const stagedLeaf = `.${leaf}.kiro-fabric-tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  const staged = join(parent, stagedLeaf);
  const destination = join(parent, leaf);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(staged, "wx", mode);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(staged, destination);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(staged); } catch { /* best effort */ }
    throw error;
  }
});

const unlinkManagedNoFollow = (root: string, target: string): void =>
  withContainedParent(root, target, (parent, leaf) => unlinkSync(join(parent, leaf)));

/** Open a managed leaf without following any replaceable path component. */
export const readManagedFileNoFollow = (root: string, target: string): Buffer | null => {
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

export interface ExecutableAttestation {
  path: string;
  sha256: string;
  dev: string;
  ino: string;
  size: number;
}

/** Hash and identify one exact no-follow executable inode through its descriptor. */
export const attestExecutable = (path: string): ExecutableAttestation => {
  const canonical = realpathSync(path);
  const root = dirname(canonical);
  const opened = openContainedNoFollow(root, canonical, constants.O_RDONLY);
  try {
    const stat = fstatSync(opened.descriptor);
    if (!stat.isFile()) throw new KiroInstallError("fs", `executable is not a regular file: ${canonical}`);
    if (process.platform !== "win32" && (stat.mode & 0o111) === 0) {
      throw new KiroInstallError("fs", `executable is not executable: ${canonical}`);
    }
    return {
      path: canonical,
      sha256: sha256Bytes(readFileSync(opened.descriptor)),
      dev: String(stat.dev),
      ino: String(stat.ino),
      size: stat.size,
    };
  } finally {
    opened.close();
  }
};

export const assertExecutableAttestation = (expected: ExecutableAttestation): void => {
  const observed = attestExecutable(expected.path);
  if (
    observed.sha256 !== expected.sha256 || observed.dev !== expected.dev ||
    observed.ino !== expected.ino || observed.size !== expected.size
  ) {
    throw new KiroInstallError("concurrency", `executable changed after attestation: ${expected.path}`);
  }
};

/** Copy bytes from one opened inode and reject source mutation during the copy. */
export const copyAttestedExecutable = (
  source: ExecutableAttestation,
  target: string,
  mode = 0o755,
): ExecutableAttestation => {
  assertExecutableAttestation(source);
  const opened = openContainedNoFollow(dirname(source.path), source.path, constants.O_RDONLY);
  let output: number | undefined;
  try {
    const before = fstatSync(opened.descriptor);
    output = openSync(target, "wx", mode);
    const bytes = readFileSync(opened.descriptor);
    writeFileSync(output, bytes);
    fsyncSync(output);
    const after = fstatSync(opened.descriptor);
    if (
      before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      sha256Bytes(bytes) !== source.sha256
    ) {
      throw new KiroInstallError("concurrency", `executable changed while copying: ${source.path}`);
    }
  } finally {
    if (output !== undefined) closeSync(output);
    opened.close();
  }
  chmodSync(target, mode);
  return attestExecutable(target);
};

const applyManagedTransition = (
  root: string,
  target: string,
  transition: KiroManagedFileTransition,
): void => {
  if (
    transition.expectedSha256 !== null && !isSha256Hex(transition.expectedSha256) ||
    transition.nextSha256 !== null && !isSha256Hex(transition.nextSha256) ||
    (transition.nextBase64 === null) !== (transition.nextSha256 === null)
  ) {
    throw new KiroInstallError("manifest", "managed transaction file state is malformed");
  }
  const nextBytes = transition.nextBase64 === null
    ? null
    : Buffer.from(transition.nextBase64, "base64");
  if (nextBytes !== null && sha256Bytes(nextBytes) !== transition.nextSha256) {
    throw new KiroInstallError("manifest", "managed transaction payload hash mismatch");
  }
  const current = readManagedFileNoFollow(root, target);
  const currentHash = current === null ? null : sha256Bytes(current);
  if (currentHash === transition.nextSha256) return;
  if (currentHash !== transition.expectedSha256) {
    throw new KiroInstallError(
      "concurrency",
      `managed file changed during transaction: ${target}`,
    );
  }
  assertNoSymlinkComponents(root, target);
  if (nextBytes !== null) ensureManagedDirectory(dirname(target));
  if (nextBytes === null) {
    if (current !== null) unlinkManagedNoFollow(root, target);
  } else {
    writeManagedAtomic(root, target, nextBytes, 0o600);
  }
  fsyncDirectory(resolve(target, ".."));
};

const transactionRelativePath = (
  root: string,
  layout: KiroManagedLayout,
  value: unknown,
): string => {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0")) {
    throw new KiroInstallError("manifest", "managed transaction path is malformed");
  }
  const parts = value.split("/");
  if (isAbsolute(value) || parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new KiroInstallError("manifest", "managed transaction path is unsafe");
  }
  const paths = managedPaths(root, layout);
  const allowedLeaves = new Set([
    relative(root, paths.profile).split(sep).join("/"),
    relative(root, paths.manifest).split(sep).join("/"),
    relative(root, join(paths.runtimeDir, ".closure-current")).split(sep).join("/"),
  ]);
  const skillsPrefix = relative(root, paths.skillsDir).split(sep).join("/") + "/fabric-";
  if (!allowedLeaves.has(value) && !value.startsWith(skillsPrefix)) {
    throw new KiroInstallError("manifest", "managed transaction path is outside owned leaves");
  }
  return value;
};

const parseManagedTransaction = (
  value: unknown,
  root: string,
  layout: KiroManagedLayout,
): KiroManagedTransaction => {
  if (!isRecord(value)) throw new KiroInstallError("manifest", "transaction journal is malformed");
  if (
    (value.format !== 1 && value.format !== 2) ||
    value.owner !== MANAGED_OWNER ||
    (value.operation !== "install" && value.operation !== "uninstall") ||
    value.layout !== layout ||
    value.root !== root ||
    typeof value.createdAt !== "number"
  ) {
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
    const seen = new Set<string>();
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
  return value as unknown as KiroManagedTransaction;
};

export const writeManagedTransactionJournal = (
  root: string,
  layout: KiroManagedLayout,
  transaction: KiroManagedTransaction,
): void => {
  const paths = managedPaths(root, layout);
  assertManagedTree(root, layout);
  writeManagedAtomic(root, paths.transaction, serializeJson(transaction), 0o600);
  fsyncDirectory(paths.manifestDir);
};

export const recoverManagedTransaction = (
  root: string,
  layout: KiroManagedLayout = "project",
): boolean => {
  const paths = managedPaths(root, layout);
  const bytes = readManagedFileNoFollow(root, paths.transaction);
  if (bytes === null) return false;
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new KiroInstallError("manifest", `transaction journal is malformed: ${paths.transaction}`);
  }
  const transaction = parseManagedTransaction(value, root, layout);
  if (transaction.format === 1) {
    applyManagedTransition(root, paths.profile, transaction.profile!);
    applyManagedTransition(root, paths.manifest, transaction.manifest!);
  } else {
    for (const file of transaction.files!) {
      const rel = transactionRelativePath(root, layout, file.path);
      applyManagedTransition(root, join(root, ...rel.split("/")), file.transition);
    }
  }
  assertNoSymlinkComponents(root, paths.transaction);
  unlinkManagedNoFollow(root, paths.transaction);
  fsyncDirectory(paths.manifestDir);
  return true;
};

export const commitManagedFileTransaction = (
  root: string,
  layout: KiroManagedLayout,
  operation: KiroManagedTransaction["operation"],
  files: Array<{ path: string; transition: KiroManagedFileTransition }>,
): void => {
  const normalized = files.map((file) => ({
    path: relative(root, file.path).split(sep).join("/"),
    transition: file.transition,
  }));
  const transaction: KiroManagedTransaction = {
    format: 2,
    owner: MANAGED_OWNER,
    operation,
    layout,
    root,
    createdAt: Date.now(),
    files: normalized,
  };
  parseManagedTransaction(transaction, root, layout);
  writeManagedTransactionJournal(root, layout, transaction);
  recoverManagedTransaction(root, layout);
};

export const fsyncDirectory = (dir: string): void => {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(dir, "r");
    fsyncSync(descriptor);
  } catch {
    // Directory fsync is unavailable on some platforms/filesystems.
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
};

export const readPackageVersion = (): string => {
  // Bundled release modules execute from <release>/chunks or <release>/kiro;
  // source modules execute from src/kiro or dist/kiro. These are immediate,
  // fixed layouts—not an upward package.json search that a workspace can win.
  const candidates = [
    resolve(import.meta.dirname, "..", "package.json"),
    resolve(import.meta.dirname, "..", "..", "package.json"),
  ];
  for (const [index, candidate] of candidates.entries()) {
    if (!existsSync(candidate)) continue;
    let pkg: { name?: string; version?: string; digest?: string };
    try {
      pkg = JSON.parse(readFileSync(candidate, "utf8")) as typeof pkg;
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
    // A source build has no package.json under src/ or dist/, so only the
    // fixed second candidate may identify the repository package.
    if (index === 1 && pkg.name === "kiro-fabric" && typeof pkg.version === "string") {
      return pkg.version;
    }
    throw new KiroInstallError("ownership", `unexpected immediate package metadata: ${candidate}`);
  }
  throw new KiroInstallError("fs", `cannot resolve immediate Fabric package metadata from ${import.meta.dirname}`);
};

export const defaultMcpEntryPath = (): string => {
  const layout = join(import.meta.dirname, "mcp-entry.js");
  if (existsSync(layout)) return layout;
  return resolve(import.meta.dirname, "..", "kiro", "mcp-entry.js");
};

export interface OperationLock {
  path: string;
  release: () => void;
}

const processStartFingerprint = (pid: number): string | undefined => {
  if (!Number.isSafeInteger(pid) || pid <= 0 || process.platform !== "linux") return undefined;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(") ");
    const fields = close >= 0 ? stat.slice(close + 2).trim().split(/\s+/u) : [];
    // The suffix starts at proc field 3; process start time is field 22.
    const startTicks = fields[19];
    return startTicks ? `linux:${startTicks}` : undefined;
  } catch {
    // Managed lifecycle code never invokes ambient ps/PowerShell/PATH helpers.
    // Without a kernel-provided process-instance identity lock recovery stays
    // conservative and requires the PID to disappear.
    return undefined;
  }
};

export const acquireOperationLock = (
  root: string,
  layout: KiroManagedLayout = "project",
): OperationLock => {
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
        const owner = JSON.parse(existingBytes.toString("utf8")) as {
          pid?: unknown;
          hostname?: unknown;
          token?: unknown;
          processStart?: unknown;
          bootId?: unknown;
        };
        if (
          Number.isSafeInteger(owner.pid) &&
          (owner.pid as number) > 0 &&
          owner.hostname === hostname() &&
          typeof owner.token === "string"
        ) {
          try {
            process.kill(owner.pid as number, 0);
            const currentStart = processStartFingerprint(owner.pid as number);
            const currentInstance = processInstanceIdentity(owner.pid as number);
            if (
              (
                typeof owner.bootId === "string" &&
                currentInstance.bootId !== undefined &&
                currentInstance.bootId !== owner.bootId
              ) || (
                typeof owner.processStart === "string" &&
                currentStart !== undefined &&
                currentStart !== owner.processStart
              )
            ) {
              // PID exists but belongs to a newer process instance.
              stale = true;
            }
          } catch (error) {
            // EPERM means the process exists but belongs to another user. Only
            // ESRCH proves the recorded owner is gone; never reclaim a lock on
            // an ambiguous liveness failure.
            stale = (error as NodeJS.ErrnoException).code === "ESRCH";
          }
        }
      } catch {
        // A malformed/foreign lock is never removed automatically.
      }
    }
    if (!stale) {
      throw new KiroInstallError(
        "concurrency",
        `another install/uninstall is in progress: ${paths.lock}`,
      );
    }
    // Revalidate exact no-follow bytes immediately before stale-lock removal.
    const revalidated = readManagedFileNoFollow(root, paths.lock);
    if (!revalidated || sha256Bytes(revalidated) !== sha256Bytes(existingBytes!)) {
      throw new KiroInstallError("concurrency", `operation lock changed during recovery: ${paths.lock}`);
    }
    unlinkManagedNoFollow(root, paths.lock);
    fsyncDirectory(paths.manifestDir);
  }
  const token = randomBytes(16).toString("hex");
  const processStart = processStartFingerprint(process.pid);
  const instance = processInstanceIdentity();
  const body = serializeJson({
    token,
    pid: process.pid,
    hostname: hostname(),
    ...(instance.bootId ? { bootId: instance.bootId } : {}),
    ...(processStart ? { processStart } : {}),
  });
  try {
    writeExclusive(paths.lock, body, 0o600);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "EEXIST") {
      throw new KiroInstallError(
        "concurrency",
        `another install/uninstall is in progress: ${paths.lock}`,
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
        // lock already gone or replaced; do not unlink a foreign file
      }
    },
  };
};

export const rmdirIfEmpty = (path: string): void => {
  try {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    rmdirSync(path);
  } catch {
    // leave non-empty or busy directories in place
  }
};
