import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { throwIfAborted } from "../async-settlement.js";

const DEFAULT_MAX_NAMESPACE_ENTRIES = 128;
const DEFAULT_MAX_NAMESPACE_BYTES = 256 * 1024;
const DEFAULT_MAX_ENTRY_BYTES = 16 * 1024;
const MEMORY_DIR = "memory";
const MEMORY_OWNER = "kiro-fabric" as const;
const MEMORY_FORMAT = 1 as const;
const OWNERSHIP_MARKER = ".kiro-fabric-owner";
const MAX_FILE_NAME_BYTES = 240;
const MUTATION_LOCK = ".kiro-fabric-mutation-lock";
const MUTATION_LOCK_OWNER = "owner.json";
const MUTATION_LOCK_TIMEOUT_MS = 5_000;
const STALE_MUTATION_LOCK_MS = 30_000;
const OWNERSHIP_INITIALIZATION_WAIT_MS = 250;

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

class KiroMemoryScopeError extends Error {
  readonly code = "kiro_memory_scope";

  constructor(message: string) {
    super(message);
    this.name = "KiroMemoryScopeError";
  }
}

interface KiroMemoryEntry<T extends JsonValue = JsonValue> {
  namespace: string;
  key: string;
  value: T;
  bytes: number;
  updatedAt: string;
}

export interface KiroMemoryBinding<T extends JsonValue = JsonValue> {
  get(key: string): Promise<KiroMemoryEntry<T> | null>;
  set(key: string, value: T, signal?: AbortSignal, beforeCommit?: () => void): Promise<KiroMemoryEntry<T>>;
  delete(key: string, signal?: AbortSignal, beforeCommit?: () => void): Promise<{ key: string; deleted: boolean }>;
  list(): Promise<KiroMemoryEntry<T>[]>;
  /**
   * Bounded, ranked retrieval: substring match over key plus serialized
   * value, newest first, capped at `limit` (default 8). Never returns the
   * whole namespace.
   */
  search(query: string, limit?: number): Promise<KiroMemoryEntry<T>[]>;
  /** Metadata-only listing: key, size, and freshness without full values. */
  index(): Promise<Array<Pick<KiroMemoryEntry<T>, "key" | "bytes" | "updatedAt">>>;
}

interface PersistedMemoryEntry<T extends JsonValue = JsonValue> {
  format: typeof MEMORY_FORMAT;
  owner: typeof MEMORY_OWNER;
  kind: "memory-entry";
  namespace: string;
  key: string;
  value: T;
  updatedAt: string;
}

const utf8Bytes = (value: string): number => Buffer.byteLength(value, "utf8");

export const normalizeKiroMemoryToken = (value: string, label: string): string => {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} must not be empty`);
  if (trimmed === "." || trimmed === "..") {
    throw new KiroMemoryScopeError(`${label} must stay within its Kiro memory scope`);
  }
  return trimmed;
};

const encodeName = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const hashNamespace = (namespace: string): string =>
  crypto.createHash("sha256").update(namespace).digest("hex").slice(0, 16);

const isWithinOrEqual = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  if (relative === "" || relative === ".") return true;
  if (path.isAbsolute(relative)) return false;
  return relative.split(path.sep).filter(Boolean)[0] !== "..";
};

const lstatOrNull = (target: string): fs.Stats | null => {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

const errorCode = (error: unknown): string | undefined =>
  error instanceof Error && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const processIsAlive = (pid: number): boolean => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
};

const withNamespaceMutationLock = async <T>(
  namespaceRoot: string,
  operation: () => T | Promise<T>,
  signal?: AbortSignal,
  beforeCommit?: () => void,
): Promise<T> => {
  const lockPath = path.join(namespaceRoot, MUTATION_LOCK);
  const deadline = performance.now() + MUTATION_LOCK_TIMEOUT_MS;
  let identity: { dev: number; ino: number } | undefined;
  while (!identity) {
    throwIfAborted(signal);
    beforeCommit?.();
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
      const stat = fs.lstatSync(lockPath);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new KiroMemoryScopeError("Kiro memory mutation lock is not a real directory");
      }
      identity = { dev: stat.dev, ino: stat.ino };
      try {
        fs.writeFileSync(
          path.join(lockPath, MUTATION_LOCK_OWNER),
          JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }),
          { encoding: "utf8", mode: 0o600, flag: "wx" },
        );
      } catch (error) {
        identity = undefined;
        try { fs.rmdirSync(lockPath); } catch {}
        throw error;
      }
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(lockPath);
      } catch (statError) {
        if (errorCode(statError) === "ENOENT") continue;
        throw statError;
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new KiroMemoryScopeError("Kiro memory mutation lock is foreign");
      }
      if (Date.now() - stat.mtimeMs > STALE_MUTATION_LOCK_MS) {
        let ownerPid: number | undefined;
        try {
          const owner = JSON.parse(fs.readFileSync(path.join(lockPath, MUTATION_LOCK_OWNER), "utf8")) as { pid?: unknown };
          if (typeof owner.pid === "number") ownerPid = owner.pid;
        } catch {}
        if (ownerPid !== undefined && processIsAlive(ownerPid)) {
          if (performance.now() >= deadline) {
            throw new KiroMemoryScopeError("Timed out waiting for a live Kiro memory mutation lock");
          }
          await delay(10);
          continue;
        }
        try {
          const current = fs.lstatSync(lockPath);
          if (
            !current.isDirectory() ||
            current.isSymbolicLink() ||
            current.dev !== stat.dev ||
            current.ino !== stat.ino
          ) continue;
          fs.rmSync(path.join(lockPath, MUTATION_LOCK_OWNER), { force: true });
          fs.rmdirSync(lockPath);
        } catch {
          if (performance.now() >= deadline) {
            throw new KiroMemoryScopeError("Stale Kiro memory mutation lock is not reclaimable");
          }
          await delay(10);
        }
        continue;
      }
      if (performance.now() >= deadline) {
        throw new KiroMemoryScopeError("Timed out waiting for Kiro memory mutation lock");
      }
      await delay(10);
    }
  }
  try {
    // Cancellation while queued must be observed after ownership is acquired
    // and immediately before the mutation is allowed to commit.
    throwIfAborted(signal);
    beforeCommit?.();
    const result = await operation();
    throwIfAborted(signal);
    beforeCommit?.();
    return result;
  } finally {
    try {
      const current = fs.lstatSync(lockPath);
      if (
        current.isDirectory() &&
        !current.isSymbolicLink() &&
        current.dev === identity.dev &&
        current.ino === identity.ino
      ) {
        fs.rmSync(path.join(lockPath, MUTATION_LOCK_OWNER), { force: true });
        fs.rmdirSync(lockPath);
      }
    } catch {}
  }
};

const ensureDirectory = (target: string): void => {
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new KiroMemoryScopeError(`Kiro memory directory must be a real directory: ${target}`);
  }
  if (process.platform !== "win32" && typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new KiroMemoryScopeError(`Kiro memory directory is owned by another user: ${target}`);
  }
  fs.chmodSync(target, 0o700);
};

const assertPrivateDirectory = (target: string, stat: fs.Stats): void => {
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new KiroMemoryScopeError(`Kiro memory directory must be a real directory: ${target}`);
  }
  if (process.platform !== "win32") {
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw new KiroMemoryScopeError(`Kiro memory directory is owned by another user: ${target}`);
    }
    if ((stat.mode & 0o077) !== 0) {
      throw new KiroMemoryScopeError(`Kiro memory directory must be private: ${target}`);
    }
  }
};

const readOwnershipMarker = (filePath: string): unknown => {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8 * 1024) {
      throw new KiroMemoryScopeError(`Kiro memory ownership marker is invalid: ${filePath}`);
    }
    if (process.platform !== "win32") {
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new KiroMemoryScopeError(`Kiro memory ownership marker is owned by another user: ${filePath}`);
      }
      if ((stat.mode & 0o077) !== 0) {
        throw new KiroMemoryScopeError(`Kiro memory ownership marker is not private: ${filePath}`);
      }
    }
    return JSON.parse(fs.readFileSync(descriptor, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof KiroMemoryScopeError) throw error;
    throw new KiroMemoryScopeError(
      `Kiro memory directory is foreign or its ownership marker is unreadable: ${filePath}`,
    );
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
};

const ensureOwnedDirectory = (
  memoryRoot: string,
  target: string,
  marker: Record<string, unknown>,
): void => {
  assertNoSymlinkComponents(memoryRoot, target);
  const existing = lstatOrNull(target);
  let created = false;
  if (!existing) {
    try {
      fs.mkdirSync(target, { mode: 0o700 });
      created = true;
    } catch (error) {
      // Another session may have won the same mkdir between lstat and mkdir.
      // It must still publish the identical ownership marker before we adopt
      // the directory; foreign directories are never marked by the loser.
      if (errorCode(error) !== "EEXIST") throw error;
    }
  }
  const stat = fs.lstatSync(target);
  assertPrivateDirectory(target, stat);
  const markerPath = path.join(target, OWNERSHIP_MARKER);
  if (created) {
    const temporaryMarker = path.join(
      target,
      `.kiro-fabric-owner-${process.pid}-${crypto.randomBytes(8).toString("hex")}.tmp`,
    );
    try {
      const descriptor = fs.openSync(
        temporaryMarker,
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          (fs.constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      try {
        fs.writeFileSync(descriptor, `${JSON.stringify(marker)}\n`, "utf8");
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      // A same-filesystem hard link publishes the fully written marker in one
      // step and fails instead of replacing a colliding foreign marker.
      fs.linkSync(temporaryMarker, markerPath);
      fs.unlinkSync(temporaryMarker);
    } catch (error) {
      try {
        fs.unlinkSync(temporaryMarker);
      } catch {}
      try {
        fs.rmdirSync(target);
      } catch {}
      throw error;
    }
  } else if (!lstatOrNull(markerPath)) {
    // The only benign marker-less state is the tiny window after another
    // session created this empty directory and before its atomic marker link.
    // Wait briefly without ever writing into or claiming the directory.
    let entries: string[] = [];
    try { entries = fs.readdirSync(target); } catch {}
    if (entries.every((name) => name.startsWith(".kiro-fabric-owner-"))) {
      const waiter = new Int32Array(new SharedArrayBuffer(4));
      const deadline = Date.now() + OWNERSHIP_INITIALIZATION_WAIT_MS;
      while (!lstatOrNull(markerPath) && Date.now() < deadline) {
        Atomics.wait(waiter, 0, 0, Math.min(10, deadline - Date.now()));
      }
    }
  }
  const found = readOwnershipMarker(markerPath);
  if (JSON.stringify(found) !== JSON.stringify(marker)) {
    throw new KiroMemoryScopeError(`Kiro memory directory ownership mismatch: ${target}`);
  }
};

const assertNoSymlinkComponents = (root: string, target: string): void => {
  if (!isWithinOrEqual(root, target)) {
    throw new KiroMemoryScopeError(`Kiro memory path escapes its root: ${target}`);
  }
  let cursor = root;
  const relative = path.relative(root, target);
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const stat = lstatOrNull(cursor);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      throw new KiroMemoryScopeError(`Kiro memory path crosses a symlink: ${cursor}`);
    }
  }
};

const canonicalDirectory = (root: string): string => {
  const candidate = path.resolve(normalizeKiroMemoryToken(root, "root"));
  ensureDirectory(candidate);
  const canonical = fs.realpathSync(candidate);
  const stat = fs.statSync(canonical);
  if (!stat.isDirectory()) {
    throw new KiroMemoryScopeError(`Kiro memory root is not a directory: ${canonical}`);
  }
  return canonical;
};

const memoryNamespaceRoot = (root: string, namespace: string): string =>
  path.join(root, MEMORY_DIR, `${encodeName(namespace)}-${hashNamespace(namespace)}`);

const entryPath = (namespaceRoot: string, key: string): string =>
  (() => {
    const name = `${encodeName(key)}.json`;
    if (utf8Bytes(name) > MAX_FILE_NAME_BYTES) {
      throw new KiroMemoryScopeError(
        `Kiro memory key is too long after filesystem-safe encoding`,
      );
    }
    return path.join(namespaceRoot, name);
  })();

const readEntry = <T extends JsonValue>(
  filePath: string,
  expectedNamespace: string,
  maxValueChars: number,
): KiroMemoryEntry<T> => {
  let descriptor: number | undefined;
  let raw: string;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > DEFAULT_MAX_ENTRY_BYTES) {
      throw new KiroMemoryScopeError(`Kiro memory entry must be a bounded regular file: ${filePath}`);
    }
    if (process.platform !== "win32") {
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new KiroMemoryScopeError(`Kiro memory entry is owned by another user: ${filePath}`);
      }
      if ((stat.mode & 0o077) !== 0) {
        throw new KiroMemoryScopeError(`Kiro memory entry must be private: ${filePath}`);
      }
    }
    raw = fs.readFileSync(descriptor, "utf8");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  let parsed: PersistedMemoryEntry<T>;
  try {
    parsed = JSON.parse(raw) as PersistedMemoryEntry<T>;
  } catch {
    throw new KiroMemoryScopeError(`Kiro memory entry is foreign or malformed: ${filePath}`);
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    parsed.format !== MEMORY_FORMAT ||
    parsed.owner !== MEMORY_OWNER ||
    parsed.kind !== "memory-entry" ||
    typeof parsed.namespace !== "string" ||
    typeof parsed.key !== "string" ||
    typeof parsed.updatedAt !== "string" ||
    !("value" in parsed)
  ) {
    throw new Error(`Kiro memory entry is malformed: ${filePath}`);
  }
  let encodedValue: string | undefined;
  try { encodedValue = JSON.stringify(parsed.value); } catch {}
  if (
    parsed.namespace !== expectedNamespace ||
    normalizeKiroMemoryToken(parsed.key, "key") !== parsed.key ||
    entryPath(path.dirname(filePath), parsed.key) !== filePath ||
    encodedValue === undefined || encodedValue.length > maxValueChars
  ) {
    throw new KiroMemoryScopeError(`Kiro memory entry violates its configured scope: ${filePath}`);
  }
  return {
    namespace: parsed.namespace,
    key: parsed.key,
    value: parsed.value,
    updatedAt: parsed.updatedAt,
    bytes: utf8Bytes(raw),
  };
};

const writeJsonAtomic = (filePath: string, content: string, beforeCommit?: () => void): void => {
  const directory = path.dirname(filePath);
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, content, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    beforeCommit?.();
    fs.renameSync(temporary, filePath);
    try {
      const directoryDescriptor = fs.openSync(directory, "r");
      try {
        fs.fsyncSync(directoryDescriptor);
      } finally {
        fs.closeSync(directoryDescriptor);
      }
    } catch {}
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.rmSync(temporary, { force: true });
    } catch {}
    throw error;
  }
};

const listEntryFiles = (namespaceRoot: string): string[] => {
  try {
    return fs.readdirSync(namespaceRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(namespaceRoot, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};

const collectNamespaceEntries = <T extends JsonValue>(
  namespaceRoot: string,
  namespace: string,
  maxValueChars: number,
): KiroMemoryEntry<T>[] => listEntryFiles(namespaceRoot)
  .map((filePath) => readEntry<T>(filePath, namespace, maxValueChars));

const assertEntryFits = <T extends JsonValue>(
  namespaceRoot: string,
  next: KiroMemoryEntry<T>,
  targetPath: string,
  maxEntries: number,
  maxValueChars: number,
): void => {
  const entries = collectNamespaceEntries<T>(namespaceRoot, next.namespace, maxValueChars);
  let totalBytes = next.bytes;
  let entryCount = 1;
  for (const entry of entries) {
    const currentPath = entryPath(namespaceRoot, entry.key);
    if (currentPath === targetPath) continue;
    totalBytes += entry.bytes;
    entryCount += 1;
  }
  if (next.bytes > DEFAULT_MAX_ENTRY_BYTES) {
    throw new Error(
      `Kiro memory entry exceeds ${DEFAULT_MAX_ENTRY_BYTES} bytes for namespace ${JSON.stringify(next.namespace)}`,
    );
  }
  if (entryCount > maxEntries) {
    throw new Error(
      `Kiro memory namespace ${JSON.stringify(next.namespace)} exceeds ${maxEntries} entries`,
    );
  }
  if (totalBytes > DEFAULT_MAX_NAMESPACE_BYTES) {
    throw new Error(
      `Kiro memory namespace ${JSON.stringify(next.namespace)} exceeds ${DEFAULT_MAX_NAMESPACE_BYTES} bytes`,
    );
  }
};

export interface KiroMemoryLimits {
  maxEntries?: number;
  maxValueChars?: number;
}

export const openKiroMemory = <T extends JsonValue = JsonValue>(
  namespace: string,
  root: string,
  limits: KiroMemoryLimits = {},
): KiroMemoryBinding<T> => {
  const maxEntries = Number.isSafeInteger(limits.maxEntries) && limits.maxEntries! > 0
    ? Math.min(DEFAULT_MAX_NAMESPACE_ENTRIES, limits.maxEntries!)
    : DEFAULT_MAX_NAMESPACE_ENTRIES;
  const maxValueChars = Number.isSafeInteger(limits.maxValueChars) && limits.maxValueChars! > 0
    ? Math.min(DEFAULT_MAX_ENTRY_BYTES, limits.maxValueChars!)
    : DEFAULT_MAX_ENTRY_BYTES;
  const memoryNamespace = normalizeKiroMemoryToken(namespace, "namespace");
  const memoryRoot = canonicalDirectory(root);
  const scopedRoot = path.join(memoryRoot, MEMORY_DIR);
  ensureOwnedDirectory(memoryRoot, scopedRoot, {
    format: MEMORY_FORMAT,
    owner: MEMORY_OWNER,
    kind: "memory-root",
    root: memoryRoot,
  });
  const namespaceRoot = memoryNamespaceRoot(memoryRoot, memoryNamespace);
  ensureOwnedDirectory(memoryRoot, namespaceRoot, {
    format: MEMORY_FORMAT,
    owner: MEMORY_OWNER,
    kind: "memory-namespace",
    root: memoryRoot,
    namespace: memoryNamespace,
  });

  const resolveEntryPath = (key: string): string => {
    const normalizedKey = normalizeKiroMemoryToken(key, "key");
    const filePath = entryPath(namespaceRoot, normalizedKey);
    assertNoSymlinkComponents(memoryRoot, filePath);
    if (!isWithinOrEqual(namespaceRoot, filePath)) {
      throw new KiroMemoryScopeError(
        `Kiro memory key resolves outside namespace ${JSON.stringify(memoryNamespace)}`,
      );
    }
    return filePath;
  };

  return {
    async get(key: string): Promise<KiroMemoryEntry<T> | null> {
      const filePath = resolveEntryPath(key);
      const stat = lstatOrNull(filePath);
      if (!stat) return null;
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new KiroMemoryScopeError(`Kiro memory entry must be a real file: ${filePath}`);
      }
      const entry = readEntry<T>(filePath, memoryNamespace, maxValueChars);
      if (entry.namespace !== memoryNamespace) {
        throw new Error(`Kiro memory namespace mismatch for key ${JSON.stringify(entry.key)}`);
      }
      return entry;
    },

    async set(key: string, value: T, signal?: AbortSignal, beforeCommit?: () => void): Promise<KiroMemoryEntry<T>> {
      return withNamespaceMutationLock(namespaceRoot, () => {
        const normalizedKey = normalizeKiroMemoryToken(key, "key");
        const filePath = resolveEntryPath(normalizedKey);
        let encodedValue: string | undefined;
        try {
          encodedValue = JSON.stringify(value);
        } catch {
          encodedValue = undefined;
        }
        if (encodedValue === undefined) {
          throw new TypeError("Kiro memory values must be JSON-serializable");
        }
        if (encodedValue.length > maxValueChars) {
          throw new Error(`Kiro memory value exceeds ${maxValueChars} configured characters`);
        }
        const normalizedValue = JSON.parse(encodedValue) as T;
        const existing = lstatOrNull(filePath);
        if (existing) {
          if (!existing.isFile() || existing.isSymbolicLink()) {
            throw new KiroMemoryScopeError(`Kiro memory entry must be a real file: ${filePath}`);
          }
          const previous = readEntry<T>(filePath, memoryNamespace, maxValueChars);
          if (previous.namespace !== memoryNamespace || previous.key !== normalizedKey) {
            throw new KiroMemoryScopeError(
              `Refusing foreign Kiro memory entry collision for ${JSON.stringify(normalizedKey)}`,
            );
          }
        }
        const entry: KiroMemoryEntry<T> = {
          namespace: memoryNamespace,
          key: normalizedKey,
          value: normalizedValue,
          updatedAt: new Date().toISOString(),
          bytes: 0,
        };
        const content = JSON.stringify({
          format: MEMORY_FORMAT,
          owner: MEMORY_OWNER,
          kind: "memory-entry",
          namespace: entry.namespace,
          key: entry.key,
          value: entry.value,
          updatedAt: entry.updatedAt,
        });
        entry.bytes = utf8Bytes(content);
        assertEntryFits(namespaceRoot, entry, filePath, maxEntries, maxValueChars);
        throwIfAborted(signal);
        beforeCommit?.();
        writeJsonAtomic(filePath, content, beforeCommit);
        beforeCommit?.();
        return entry;
      }, signal, beforeCommit);
    },

    async delete(key: string, signal?: AbortSignal, beforeCommit?: () => void): Promise<{ key: string; deleted: boolean }> {
      return withNamespaceMutationLock(namespaceRoot, () => {
        const normalizedKey = normalizeKiroMemoryToken(key, "key");
        const filePath = resolveEntryPath(normalizedKey);
        const before = lstatOrNull(filePath);
        if (!before) return { key: normalizedKey, deleted: false };
        if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
          throw new KiroMemoryScopeError(`Kiro memory entry must be an unaliased real file: ${filePath}`);
        }
        const entry = readEntry<T>(filePath, memoryNamespace, maxValueChars);
        if (entry.key !== normalizedKey) throw new KiroMemoryScopeError("Kiro memory entry identity mismatch");
        throwIfAborted(signal);
        const current = fs.lstatSync(filePath);
        if (current.dev !== before.dev || current.ino !== before.ino || current.nlink !== 1) {
          throw new KiroMemoryScopeError("Kiro memory entry changed before deletion");
        }
        beforeCommit?.();
        fs.unlinkSync(filePath);
        try {
          const descriptor = fs.openSync(namespaceRoot, "r");
          try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
        } catch {}
        beforeCommit?.();
        return { key: normalizedKey, deleted: true };
      }, signal, beforeCommit);
    },

    async list(): Promise<KiroMemoryEntry<T>[]> {
      const entries = collectNamespaceEntries<T>(namespaceRoot, memoryNamespace, maxValueChars)
        .sort((left, right) => left.key.localeCompare(right.key));
      if (entries.length > maxEntries) {
        throw new Error(
          `Kiro memory namespace ${JSON.stringify(memoryNamespace)} exceeds ${maxEntries} entries`,
        );
      }
      const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
      if (totalBytes > DEFAULT_MAX_NAMESPACE_BYTES) {
        throw new Error(
          `Kiro memory namespace ${JSON.stringify(memoryNamespace)} exceeds ${DEFAULT_MAX_NAMESPACE_BYTES} bytes`,
        );
      }
      return entries;
    },

    async search(query: string, limit = 8): Promise<KiroMemoryEntry<T>[]> {
      const needle = query.trim().toLowerCase();
      if (!needle) return [];
      const capped = Math.max(1, Math.min(Math.floor(limit), maxEntries));
      const scored: Array<{ entry: KiroMemoryEntry<T>; score: number }> = [];
      for (const entry of collectNamespaceEntries<T>(namespaceRoot, memoryNamespace, maxValueChars)) {
        const haystack = `${entry.key}\n${JSON.stringify(entry.value)}`.toLowerCase();
        const position = haystack.indexOf(needle);
        if (position === -1) continue;
        // Earlier match position wins; key matches rank before value matches.
        const score = (entry.key.toLowerCase().includes(needle) ? 0 : 100_000) + position;
        scored.push({ entry, score });
      }
      return scored
        .sort((left, right) =>
          left.score - right.score || right.entry.updatedAt.localeCompare(left.entry.updatedAt),
        )
        .slice(0, capped)
        .map(({ entry }) => entry);
    },

    async index(): Promise<Array<Pick<KiroMemoryEntry<T>, "key" | "bytes" | "updatedAt">>> {
      const files = listEntryFiles(namespaceRoot);
      if (files.length > maxEntries) {
        throw new Error(
          `Kiro memory namespace ${JSON.stringify(memoryNamespace)} exceeds ${maxEntries} entries`,
        );
      }
      // Validate each persisted entry, but do not retain its value while loading
      // the remaining files: this API only returns metadata.
      return files.map((file) => {
        const { key, bytes, updatedAt } = readEntry<T>(file, memoryNamespace, maxValueChars);
        return { key, bytes, updatedAt };
      }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },
  };
};
