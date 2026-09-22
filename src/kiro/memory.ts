import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { throwIfAborted } from "../async-settlement.js";
import { FABRIC_COMMIT_ACKNOWLEDGEMENT } from "../protocol.js";
import { privateStorageDirectoryGuard, sameStorageFile } from "./storage-identity.js";

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

/** Publication succeeded, but interruption or owned-lock cleanup prevented a reliable acknowledgement. */
export class KiroMemoryCommitAcknowledgementError extends Error {
  readonly committed = true;
  readonly [FABRIC_COMMIT_ACKNOWLEDGEMENT]: { readonly version: 1; readonly operation: "set" | "delete" };
  constructor(readonly operation: "set" | "delete", readonly key: string, options: ErrorOptions) {
    super(`Kiro memory ${operation} for ${JSON.stringify(key)} committed; acknowledgement failed; read memory before retrying`, options);
    this.name = "KiroMemoryCommitAcknowledgementError";
    this[FABRIC_COMMIT_ACKNOWLEDGEMENT] = Object.freeze({ version: 1 as const, operation });
  }
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

// Only ESRCH proves death; all other failures leave ownership uncertain.
const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (errorCode(error) === "ESRCH") return false;
    if (errorCode(error) === "EPERM") return true;
    throw new KiroMemoryScopeError("Kiro memory mutation lock owner liveness is unknown");
  }
};

interface MutationLockIdentity {
  directory: { dev: number; ino: number };
  owner?: { dev: number; ino: number; token?: string };
}
interface PendingMutationLock {
  identity?: MutationLockIdentity;
  ownerDescriptor?: number | undefined;
}
interface MutationLockState { pending: PendingMutationLock | undefined }

const recoverPendingMutationLock = (lockPath: string, pending: PendingMutationLock): void => {
  const identity = pending.identity;
  if (identity && !identity.owner && pending.ownerDescriptor !== undefined) {
    const owner = fs.fstatSync(pending.ownerDescriptor);
    identity.owner = { dev: owner.dev, ino: owner.ino };
  }
  if (!identity) throw new KiroMemoryScopeError("Kiro memory lock cleanup remains unresolved: ownership identity is unavailable");
  releaseNamespaceMutationLock(lockPath, identity);
  if (pending.ownerDescriptor !== undefined) {
    const descriptor = pending.ownerDescriptor;
    pending.ownerDescriptor = undefined;
    fs.closeSync(descriptor);
  }
};

const releaseNamespaceMutationLock = (lockPath: string, identity: MutationLockIdentity, requireOwner = false): void => {
  let current: fs.Stats;
  try { current = fs.lstatSync(lockPath); }
  catch (error) { if (errorCode(error) === "ENOENT") return; throw error; }
  if (!current.isDirectory() || current.isSymbolicLink() ||
      current.dev !== identity.directory.dev || current.ino !== identity.directory.ino) {
    throw new KiroMemoryScopeError("Refusing to clean up a replacement Kiro memory mutation lock");
  }
  const ownerPath = path.join(lockPath, MUTATION_LOCK_OWNER);
  try {
    const owner = fs.lstatSync(ownerPath);
    let ownerToken: unknown;
    try { ownerToken = (JSON.parse(fs.readFileSync(ownerPath, "utf8")) as { token?: unknown }).token; }
    catch { /* rejected by the identity check below */ }
    if (!identity.owner || !owner.isFile() || owner.isSymbolicLink() ||
        owner.dev !== identity.owner.dev || owner.ino !== identity.owner.ino ||
        (identity.owner.token !== undefined && ownerToken !== identity.owner.token)) {
      throw new KiroMemoryScopeError("Refusing to remove a foreign Kiro memory mutation lock owner");
    }
    fs.unlinkSync(ownerPath);
  } catch (error) {
    if (errorCode(error) !== "ENOENT" || requireOwner) throw error;
  }
  fs.rmdirSync(lockPath);
};

/** Serialize every cooperative reclaimer of the same owner before revalidation.
 * Never reclaim a claim (even for a dead PID): interrupted recovery is ambiguous
 * evidence requiring operator intervention. Otherwise a delayed reclaimer could
 * unlink a successor between the identity check and the pathname deletion.
 * Hash the token so legacy owner strings cannot become filesystem paths. */
const reclaimNamespaceMutationLock = (lockPath: string, identity: MutationLockIdentity): boolean => {
  const tokenHash = crypto.createHash("sha256").update(identity.owner!.token!).digest("hex");
  const claim = path.join(path.dirname(lockPath), `.kiro-fabric-recovery-${tokenHash}.claim`);
  let descriptor: number;
  try {
    descriptor = fs.openSync(claim,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
  let claimed: fs.Stats | undefined;
  let failed = false;
  let recoveryError: unknown;
  try {
    claimed = fs.fstatSync(descriptor);
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, identity }), "utf8");
    fs.fsyncSync(descriptor);
    // This claim cannot be superseded by another cooperative reclaimer. A
    // stale observer that acquires it later must still pass exact revalidation.
    releaseNamespaceMutationLock(lockPath, identity, true);
    return true;
  } catch (error) {
    failed = true;
    recoveryError = error;
    throw error;
  } finally {
    const errors: unknown[] = [];
    try { fs.closeSync(descriptor); } catch (error) { errors.push(error); }
    try {
      if (!claimed) throw new KiroMemoryScopeError("Kiro memory recovery claim identity unavailable; preserve evidence for operator recovery");
      const current = fs.lstatSync(claim);
      if (!current.isFile() || current.isSymbolicLink() || current.dev !== claimed.dev || current.ino !== claimed.ino) {
        throw new KiroMemoryScopeError("Refusing to remove a replacement Kiro memory recovery claim");
      }
      fs.unlinkSync(claim);
    } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(
      failed ? [recoveryError, ...errors] : errors,
      "Kiro memory recovery claim cleanup failed; preserve evidence for operator recovery",
      { cause: failed ? recoveryError : errors[0] },
    );
  }
};

const withNamespaceMutationLock = async <T>(
  namespaceRoot: string,
  state: MutationLockState,
  operation: () => T | Promise<T>,
  assertScope: () => void,
  signal?: AbortSignal,
  beforeCommit?: () => void,
): Promise<T> => {
  const lockPath = path.join(namespaceRoot, MUTATION_LOCK);
  const deadline = performance.now() + MUTATION_LOCK_TIMEOUT_MS;
  let identity: MutationLockIdentity | undefined;
  let operationError: unknown;
  while (!identity) {
    assertScope();
    if (state.pending) {
      const pending = state.pending;
      recoverPendingMutationLock(lockPath, pending);
      state.pending = undefined;
    }
    throwIfAborted(signal);
    beforeCommit?.();
    assertScope();
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
      let stat: fs.Stats;
      try { stat = fs.lstatSync(lockPath); }
      catch (error) {
        // A later pathname open/stat cannot prove which inode mkdir created.
        // Keep this unresolved rather than adopting (and deleting) a replacement.
        state.pending = {};
        throw new AggregateError([error], "Kiro memory lock initialization failed; cleanup remains unresolved", { cause: error });
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new KiroMemoryScopeError("Kiro memory mutation lock is not a real directory");
      }
      identity = { directory: { dev: stat.dev, ino: stat.ino } };
      let ownerDescriptor: number | undefined;
      try {
        const ownerPath = path.join(lockPath, MUTATION_LOCK_OWNER);
        const token = crypto.randomBytes(32).toString("hex");
        assertScope();
        try {
          ownerDescriptor = fs.openSync(
            ownerPath,
            fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
            0o600,
          );
          const owner = fs.fstatSync(ownerDescriptor);
          identity.owner = { dev: owner.dev, ino: owner.ino };
          fs.writeFileSync(ownerDescriptor, JSON.stringify({ pid: process.pid, acquiredAt: Date.now(), token }), "utf8");
          identity.owner.token = token;
        } finally {
          if (ownerDescriptor !== undefined && identity.owner) {
            const descriptor = ownerDescriptor;
            ownerDescriptor = undefined;
            fs.closeSync(descriptor);
          }
        }
      } catch (error) {
        const cleanupIdentity = identity;
        identity = undefined;
        try {
          assertScope();
          releaseNamespaceMutationLock(lockPath, cleanupIdentity);
          if (ownerDescriptor !== undefined) {
            const descriptor = ownerDescriptor;
            ownerDescriptor = undefined;
            fs.closeSync(descriptor);
          }
        } catch (cleanup) {
          state.pending = { identity: cleanupIdentity, ...(ownerDescriptor === undefined ? {} : { ownerDescriptor }) };
          throw new AggregateError(
            [error, cleanup], "Kiro memory lock initialization and cleanup failed", { cause: error },
          );
        }
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
        const ownerPath = path.join(lockPath, MUTATION_LOCK_OWNER);
        let ownerStat: fs.Stats;
        let owner: { pid: number; token: string; acquiredAt: number };
        try {
          ownerStat = fs.lstatSync(ownerPath);
          if (!ownerStat.isFile() || ownerStat.isSymbolicLink()) throw new Error("invalid owner file");
          owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
          if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 ||
              typeof owner.token !== "string" || !owner.token ||
              !Number.isSafeInteger(owner.acquiredAt) || owner.acquiredAt <= 0) {
            throw new Error("invalid owner metadata");
          }
        } catch {
          throw new KiroMemoryScopeError("Kiro memory mutation lock owner is unreadable or malformed; ownership is uncertain");
        }
        if (processIsAlive(owner.pid)) {
          if (performance.now() >= deadline) {
            throw new KiroMemoryScopeError("Timed out waiting for a live Kiro memory mutation lock");
          }
          await delay(10);
          continue;
        }
        assertScope();
        if (reclaimNamespaceMutationLock(lockPath, {
          directory: { dev: stat.dev, ino: stat.ino },
          owner: { dev: ownerStat.dev, ino: ownerStat.ino, token: owner.token },
        })) continue;
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
    assertScope();
    const result = await operation();
    throwIfAborted(signal);
    beforeCommit?.();
    assertScope();
    return result;
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      assertScope();
      releaseNamespaceMutationLock(lockPath, identity);
      state.pending = undefined;
    } catch (cleanup) {
      state.pending = { identity };
      if (operationError !== undefined) throw new AggregateError(
        [operationError, cleanup], "Kiro memory mutation and lock cleanup failed", { cause: operationError },
      );
      throw cleanup;
    }
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

// Probe at most one byte past the budget, even if a file grows after fstat.
const readBounded = (descriptor: number, budget: number, overflow: () => Error): Buffer => {
  const buffer = Buffer.alloc(budget + 1);
  let bytes = 0;
  while (bytes < buffer.length) {
    const count = fs.readSync(descriptor, buffer, bytes, buffer.length - bytes, null);
    if (count === 0) break;
    bytes += count;
  }
  if (bytes > budget) throw overflow();
  return buffer.subarray(0, bytes);
};

const readOwnershipMarker = (filePath: string): { value: unknown; identity: fs.Stats } => {
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
    const value: unknown = JSON.parse(readBounded(descriptor, 8 * 1024, () =>
      new KiroMemoryScopeError(`Kiro memory ownership marker is invalid: ${filePath}`),
    ).toString("utf8"));
    if (!sameStorageFile(fs.fstatSync(descriptor), stat)) throw new KiroMemoryScopeError(`Kiro memory ownership marker changed: ${filePath}`);
    return { value, identity: stat };
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
): fs.Stats => {
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
  if (JSON.stringify(found.value) !== JSON.stringify(marker)) {
    throw new KiroMemoryScopeError(`Kiro memory directory ownership mismatch: ${target}`);
  }
  return found.identity;
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

const memoryNamespaceRoot = (root: string, namespace: string): string => {
  // A namespace also becomes a directory name. Bound it the same way entry keys
  // are bounded so an over-long namespace fails before the filesystem does.
  if (utf8Bytes(`${encodeName(namespace)}-${hashNamespace(namespace)}`) > MAX_FILE_NAME_BYTES) {
    throw new KiroMemoryScopeError(
      "Kiro memory namespace is too long after filesystem-safe encoding",
    );
  }
  return path.join(root, MEMORY_DIR, `${encodeName(namespace)}-${hashNamespace(namespace)}`);
};

/** Reject a key whose filesystem-safe encoding cannot become a bounded entry
 * filename. Exported so argument preparation attributes the failure to the
 * request instead of surfacing it as a late filesystem limit. */
export const assertKiroMemoryKeyFits = (key: string): void => {
  if (utf8Bytes(`${encodeName(key)}.json`) > MAX_FILE_NAME_BYTES) {
    throw new KiroMemoryScopeError(
      `Kiro memory key is too long after filesystem-safe encoding`,
    );
  }
};

const entryPath = (namespaceRoot: string, key: string): string => {
  assertKiroMemoryKeyFits(key);
  return path.join(namespaceRoot, `${encodeName(key)}.json`);
};

const readEntry = <T extends JsonValue>(
  filePath: string,
  expectedNamespace: string,
  maxValueChars: number,
  remainingBytes = DEFAULT_MAX_NAMESPACE_BYTES,
): KiroMemoryEntry<T> => {
  let descriptor: number | undefined;
  let raw: string;
  let bytes: number;
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
    const budget = Math.min(DEFAULT_MAX_ENTRY_BYTES, remainingBytes);
    const overflow = (): Error => remainingBytes < DEFAULT_MAX_ENTRY_BYTES
      ? namespaceBytesError(expectedNamespace)
      : new KiroMemoryScopeError(`Kiro memory entry must be a bounded regular file: ${filePath}`);
    if (stat.size > budget) throw overflow();
    const content = readBounded(descriptor, budget, overflow);
    bytes = content.length;
    raw = content.toString("utf8");
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
    bytes,
  };
};

const isUnsupportedDirectorySync = (error: unknown, phase: "open" | "sync"): boolean => {
  const code = errorCode(error);
  if (code === "EINVAL" || code === "ENOTSUP" || code === "EOPNOTSUPP") return true;
  return phase === "open" && process.platform === "win32" &&
    (code === "EISDIR" || code === "EPERM" || code === "EACCES");
};

const syncDirectoryBestEffort = (directory: string): void => {
  let descriptor: number | undefined;
  try {
    try { descriptor = fs.openSync(directory, "r"); }
    catch (error) { if (isUnsupportedDirectorySync(error, "open")) return; throw error; }
    try { fs.fsyncSync(descriptor); }
    catch (error) { if (!isUnsupportedDirectorySync(error, "sync")) throw error; }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
};

const writeJsonAtomic = (filePath: string, content: string, assertScope: () => void, beforeCommit?: () => void, afterCommit?: () => void): void => {
  const directory = path.dirname(filePath);
  const temporary = path.join(
    directory,
    // Independent of the encoded key: a valid final basename can already be
    // 240 bytes. Keep the same-directory exclusive create and atomic rename.
    `.kiro-fabric-memory-${crypto.randomBytes(16).toString("hex")}.tmp`,
  );
  let descriptor: number | undefined;
  let createdStats: fs.Stats | undefined;
  const close = (): void => {
    if (descriptor === undefined) return;
    const fd = descriptor;
    // A throwing close may already have released the descriptor. Never retry it.
    descriptor = undefined;
    fs.closeSync(fd);
  };
  try {
    assertScope();
    descriptor = fs.openSync(temporary, "wx", 0o600);
    createdStats = fs.fstatSync(descriptor);
    fs.writeFileSync(descriptor, content, "utf8");
    fs.fsyncSync(descriptor);
    close();
    beforeCommit?.();
    assertScope();
    fs.renameSync(temporary, filePath);
    afterCommit?.();
    assertScope();
    syncDirectoryBestEffort(directory);
  } catch (error) {
    const errors: unknown[] = [error];
    // Recover identity only while the descriptor is still definitely ours.
    if (createdStats === undefined && descriptor !== undefined) {
      try { createdStats = fs.fstatSync(descriptor); } catch (cleanup) { errors.push(cleanup); }
    }
    try { close(); } catch (cleanup) { errors.push(cleanup); }
    try {
      assertScope();
      const current = lstatOrNull(temporary);
      if (createdStats && current?.isFile() && !current.isSymbolicLink() &&
          current.dev === createdStats.dev && current.ino === createdStats.ino) {
        fs.rmSync(temporary, { force: true });
      }
    } catch (cleanup) { errors.push(cleanup); }
    if (errors.length > 1) throw new AggregateError(errors, "Kiro memory write and temporary cleanup failed", { cause: error });
    throw error;
  }
};

const namespaceBytesError = (namespace: string): Error => new Error(
  `Kiro memory namespace ${JSON.stringify(namespace)} exceeds ${DEFAULT_MAX_NAMESPACE_BYTES} bytes`,
);

const listEntryFiles = (namespaceRoot: string, namespace: string, maxEntries: number, assertScope: () => void): string[] => {
  assertScope();
  // A bound namespace already exists; disappearance is revocation, not an
  // empty store. Do not hide a change between the guard and directory open.
  const directory = fs.opendirSync(namespaceRoot);
  const files: string[] = [];
  try {
    let entry: fs.Dirent | null;
    while ((entry = directory.readSync()) !== null) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      if (files.length === maxEntries) {
        throw new Error(`Kiro memory namespace ${JSON.stringify(namespace)} exceeds ${maxEntries} entries`);
      }
      files.push(path.join(namespaceRoot, entry.name));
    }
  } finally {
    directory.closeSync();
  }
  assertScope();
  return files.sort((left, right) => left.localeCompare(right));
};

function* iterateNamespaceEntries<T extends JsonValue>(
  files: string[],
  namespace: string,
  maxValueChars: number,
  assertScope: () => void,
  initialBytes = 0,
  skipPath?: string,
): Generator<KiroMemoryEntry<T>> {
  let totalBytes = initialBytes;
  for (const file of files) {
    if (file === skipPath) continue;
    assertScope();
    const entry = readEntry<T>(file, namespace, maxValueChars, DEFAULT_MAX_NAMESPACE_BYTES - totalBytes);
    assertScope();
    totalBytes += entry.bytes;
    yield entry;
  }
}

const assertEntryFits = <T extends JsonValue>(
  next: KiroMemoryEntry<T>,
  targetPath: string,
  maxEntries: number,
  maxValueChars: number,
  files: string[],
  assertScope: () => void,
): void => {
  const entryCount = files.length + (files.includes(targetPath) ? 0 : 1);
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
  // The replacement was already validated by set. Budget its new size, so
  // shrinking an entry can still recover an over-byte-quota namespace.
  for (const _entry of iterateNamespaceEntries<T>(files, next.namespace, maxValueChars, assertScope, next.bytes, targetPath)) {
    // Validate without retaining the remaining values.
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
  const failure = (message: string): Error => new KiroMemoryScopeError(message);
  const rootGuard = privateStorageDirectoryGuard(memoryRoot, failure);
  const scopedRoot = path.join(memoryRoot, MEMORY_DIR);
  const scopedMarker = ensureOwnedDirectory(memoryRoot, scopedRoot, {
    format: MEMORY_FORMAT,
    owner: MEMORY_OWNER,
    kind: "memory-root",
    root: memoryRoot,
  });
  const scopedGuard = privateStorageDirectoryGuard(scopedRoot, failure);
  const namespaceRoot = memoryNamespaceRoot(memoryRoot, memoryNamespace);
  const namespaceMarker = ensureOwnedDirectory(memoryRoot, namespaceRoot, {
    format: MEMORY_FORMAT,
    owner: MEMORY_OWNER,
    kind: "memory-namespace",
    root: memoryRoot,
    namespace: memoryNamespace,
  });
  const namespaceGuard = privateStorageDirectoryGuard(namespaceRoot, failure);
  const markers = [{ directory: scopedRoot, identity: scopedMarker }, { directory: namespaceRoot, identity: namespaceMarker }];
  const assertScope = (): void => {
    rootGuard(); scopedGuard(); namespaceGuard();
    for (const marker of markers) {
      if (!sameStorageFile(fs.lstatSync(path.join(marker.directory, OWNERSHIP_MARKER)), marker.identity)) {
        throw new KiroMemoryScopeError(`Kiro memory ownership marker changed; preserve replacement: ${marker.directory}`);
      }
    }
  };
  assertScope();

  const resolveEntryPath = (key: string): string => {
    assertScope();
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

  const lockState: MutationLockState = { pending: undefined };

  return {
    async get(key: string): Promise<KiroMemoryEntry<T> | null> {
      const filePath = resolveEntryPath(key);
      const stat = lstatOrNull(filePath);
      if (!stat) { assertScope(); return null; }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new KiroMemoryScopeError(`Kiro memory entry must be a real file: ${filePath}`);
      }
      const entry = readEntry<T>(filePath, memoryNamespace, maxValueChars);
      assertScope();
      if (entry.namespace !== memoryNamespace) {
        throw new Error(`Kiro memory namespace mismatch for key ${JSON.stringify(entry.key)}`);
      }
      return entry;
    },

    async set(key: string, value: T, signal?: AbortSignal, beforeCommit?: () => void): Promise<KiroMemoryEntry<T>> {
      const normalizedKey = normalizeKiroMemoryToken(key, "key");
      let published = false;
      try {
        return await withNamespaceMutationLock(namespaceRoot, lockState, () => {
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
          const files = listEntryFiles(namespaceRoot, memoryNamespace, maxEntries, assertScope);
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
          assertEntryFits(entry, filePath, maxEntries, maxValueChars, files, assertScope);
          throwIfAborted(signal);
          beforeCommit?.();
          writeJsonAtomic(filePath, content, assertScope, beforeCommit, () => { published = true; });
          beforeCommit?.();
          assertScope();
          return entry;
        }, assertScope, signal, beforeCommit);
      } catch (error) {
        if (published) throw new KiroMemoryCommitAcknowledgementError("set", normalizedKey, { cause: error });
        throw error;
      }
    },

    async delete(key: string, signal?: AbortSignal, beforeCommit?: () => void): Promise<{ key: string; deleted: boolean }> {
      const normalizedKey = normalizeKiroMemoryToken(key, "key");
      let published = false;
      try {
        return await withNamespaceMutationLock(namespaceRoot, lockState, () => {
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
          assertScope();
          fs.unlinkSync(filePath);
          published = true;
          assertScope();
          syncDirectoryBestEffort(namespaceRoot);
          beforeCommit?.();
          assertScope();
          return { key: normalizedKey, deleted: true };
        }, assertScope, signal, beforeCommit);
      } catch (error) {
        if (published) throw new KiroMemoryCommitAcknowledgementError("delete", normalizedKey, { cause: error });
        throw error;
      }
    },

    async list(): Promise<KiroMemoryEntry<T>[]> {
      return [...iterateNamespaceEntries<T>(
        listEntryFiles(namespaceRoot, memoryNamespace, maxEntries, assertScope), memoryNamespace, maxValueChars, assertScope,
      )].sort((left, right) => left.key.localeCompare(right.key));
    },

    async search(query: string, limit = 8): Promise<KiroMemoryEntry<T>[]> {
      assertScope();
      const needle = query.trim().toLowerCase();
      if (!needle) return [];
      const capped = Math.max(1, Math.min(Math.floor(limit), maxEntries));
      const scored: Array<{ entry: KiroMemoryEntry<T>; score: number }> = [];
      for (const entry of iterateNamespaceEntries<T>(
        listEntryFiles(namespaceRoot, memoryNamespace, maxEntries, assertScope), memoryNamespace, maxValueChars, assertScope,
      )) {
        const haystack = `${entry.key}\n${JSON.stringify(entry.value)}`.toLowerCase();
        const position = haystack.indexOf(needle);
        if (position === -1) continue;
        // Earlier match position wins; key matches rank before value matches.
        const score = (entry.key.toLowerCase().includes(needle) ? 0 : 100_000) + position;
        scored.push({ entry, score });
        // Stable sorting preserves filename order for exact ranking ties.
        scored.sort((left, right) =>
          left.score - right.score || right.entry.updatedAt.localeCompare(left.entry.updatedAt),
        );
        scored.length = Math.min(scored.length, Number.isNaN(capped) ? 0 : capped);
      }
      return scored.map(({ entry }) => entry);
    },

    async index(): Promise<Array<Pick<KiroMemoryEntry<T>, "key" | "bytes" | "updatedAt">>> {
      const metadata: Array<Pick<KiroMemoryEntry<T>, "key" | "bytes" | "updatedAt">> = [];
      for (const { key, bytes, updatedAt } of iterateNamespaceEntries<T>(
        listEntryFiles(namespaceRoot, memoryNamespace, maxEntries, assertScope), memoryNamespace, maxValueChars, assertScope,
      )) {
        metadata.push({ key, bytes, updatedAt });
      }
      return metadata.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },
  };
};
