import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { initializeOwnedFile, type OwnedFile } from "./owned-file.js";
import { runPinnedDirectoryOperation, pinnedDirectoryIdentity, pinnedEntryIdentity } from "../installation/pinned-directory-child.mjs";
import { FABRIC_COMMIT_ACKNOWLEDGEMENT } from "../protocol.js";
import { throwIfAbortedOrExpired } from "../async-settlement.js";
import type {
  FabricActionDescriptor,
  FabricInvocationContext,
  FabricProvider,
} from "../protocol.js";

interface StateEntry { revision: number; value: unknown; updatedAt: number }
interface StateDocument { schemaVersion: 1; revision: number; entries: Record<string, StateEntry> }
const emptyEntries = (): Record<string, StateEntry> => Object.create(null) as Record<string, StateEntry>;
const emptyDocument = (): StateDocument => ({ schemaVersion: 1, revision: 0, entries: emptyEntries() });
const KEY_MAX = 512;
// Match the persisted UTF-16 limit; schema maxLength may count Unicode differently.
const validStateKey = (key: unknown): key is string =>
  typeof key === "string" && key.length >= 1 && key.length <= KEY_MAX;
const LOCK_NAME = ".state-mutation.lock";
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;
const STATE_LOCK_KIND = "kiro-fabric-state-lock";
const MAX_LOCK_BYTES = 4096;
interface StateLockOwner { pid: number; token?: string; text: string }
const sameFile = (left: { dev: number; ino: number }, right: { dev: number; ino: number }): boolean =>
  left.dev === right.dev && left.ino === right.ino;
const sameBigFile = (left: { dev: bigint; ino: bigint }, right: { dev: number; ino: number }): boolean =>
  left.dev === BigInt(right.dev) && left.ino === BigInt(right.ino);

const descriptors: readonly FabricActionDescriptor[] = [
  { name: "get", description: "Read one workspace-bound state value", inputSchema: { type: "object", properties: { key: { type: "string", minLength: 1, maxLength: KEY_MAX, description: "1 to 512 UTF-16 code units" } }, required: ["key"], additionalProperties: false }, risk: "read", effect: { kind: "read" } },
  { name: "set", description: "Atomically set one workspace-bound state value", inputSchema: { type: "object", properties: { key: { type: "string", minLength: 1, maxLength: KEY_MAX, description: "1 to 512 UTF-16 code units" }, value: {}, expectedRevision: { type: "integer", minimum: 0 } }, required: ["key", "value"], additionalProperties: false }, risk: "write", effect: { kind: "write" } },
  { name: "list", description: "List bounded workspace state metadata", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 1000 } }, additionalProperties: false }, risk: "read", effect: { kind: "read" } },
  { name: "delete", description: "Atomically delete one workspace-bound state value", inputSchema: { type: "object", properties: { key: { type: "string", minLength: 1, maxLength: KEY_MAX, description: "1 to 512 UTF-16 code units" }, expectedRevision: { type: "integer", minimum: 0 } }, required: ["key"], additionalProperties: false }, risk: "write", effect: { kind: "write" } },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const errorCode = (error: unknown): string | undefined =>
  isRecord(error) && typeof error.code === "string" ? error.code : undefined;
const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const processIsAlive = (pid: number): boolean => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (errorCode(error) === "ESRCH") return false;
    if (errorCode(error) === "EPERM") return true;
    throw new Error("state lock owner liveness is uncertain", { cause: error });
  }
};

const privateRoot = (root: string): string => {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("state root must be a private regular directory");
  }
  if (process.platform !== "win32" && typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error("state root must be owned by the current user");
  }
  fs.chmodSync(root, 0o700);
  return fs.realpathSync(root);
};

/** The mutation is visible, but a post-commit deadline or lock cleanup failed.
 * Transport-level interruption can still lose this acknowledgement entirely. */
export class StateCommitAcknowledgementError extends Error {
  readonly committed = true;
  readonly [FABRIC_COMMIT_ACKNOWLEDGEMENT]: { readonly version: 1; readonly operation: "set" | "delete" };
  constructor(readonly revision: number, options: ErrorOptions, operation: "set" | "delete" = "set") {
    super(`State mutation committed at revision ${revision}; acknowledgement failed; read state before retrying`, options);
    this.name = "StateCommitAcknowledgementError";
    this[FABRIC_COMMIT_ACKNOWLEDGEMENT] = Object.freeze({ version: 1 as const, operation });
  }
}

export class StateProvider implements FabricProvider {
  readonly name = "state";
  readonly description = "Workspace-bound atomic state";
  readonly #root: string;
  readonly #rootIdentity: { dev: number; ino: number };
  readonly #file: string;
  readonly #lock: string;
  readonly #maxEntries: number;
  readonly #maxValueChars: number;
  readonly #maxTotalChars: number;
  readonly #maxValueBytes: number;
  readonly #maxTotalBytes: number;
  #pendingLockCleanup: { dev: number; ino: number } | undefined;
  #uncertainLock = false;

  constructor(root: string, options: {
    maxEntries?: number;
    maxValueChars?: number;
    maxTotalChars?: number;
    /** Optional stricter UTF-8 caps for private adapters; public state defaults are unchanged. */
    maxValueBytes?: number;
    maxTotalBytes?: number;
  } = {}) {
    this.#root = privateRoot(root);
    this.#rootIdentity = fs.lstatSync(this.#root);
    this.#assertRoot();
    this.#file = path.join(this.#root, "state.json");
    this.#lock = path.join(this.#root, LOCK_NAME);
    this.#maxEntries = options.maxEntries ?? 1_000;
    this.#maxValueChars = options.maxValueChars ?? 100_000;
    this.#maxTotalChars = options.maxTotalChars ?? 8_000_000;
    this.#maxValueBytes = options.maxValueBytes ?? Infinity;
    this.#maxTotalBytes = options.maxTotalBytes ?? Infinity;
  }

  discoveryRevision(): string { return "1"; }
  async list(): Promise<FabricActionDescriptor[]> { return structuredClone([...descriptors]); }

  async describe(actionName: string): Promise<FabricActionDescriptor | undefined> {
    return structuredClone(descriptors.find((entry) => entry.name === actionName));
  }

  effectResources(_actionName: string, args: Record<string, unknown>): readonly string[] {
    return typeof args.key === "string" ? [`state:${args.key}`] : ["state:index"];
  }

  async invoke(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Promise<unknown> {
    throwIfAbortedOrExpired(context.signal, context.deadline);
    if ((actionName === "get" || actionName === "set" || actionName === "delete") && !validStateKey(args.key)) {
      throw new Error("state key exceeds configured bounds");
    }
    if (actionName === "get") {
      const entry = this.#read().entries[args.key as string];
      return entry ? { key: args.key, ...entry } : { key: args.key, found: false };
    }
    if (actionName === "list") {
      const document = this.#read();
      const limit = typeof args.limit === "number" ? args.limit : 100;
      return {
        revision: document.revision,
        entries: Object.entries(document.entries)
          .sort(([left], [right]) => left.localeCompare(right))
          .slice(0, limit)
          .map(([key, entry]) => ({ key, revision: entry.revision, updatedAt: entry.updatedAt })),
      };
    }
    if (actionName !== "set" && actionName !== "delete") {
      throw new Error(`Unknown state action: ${actionName}`);
    }
    let committedRevision: number | undefined;
    try {
      return await this.#withMutationLock(context, (assertOwnership) => {
        const document = this.#read();
        const key = args.key as string;
        const current = document.entries[key];
        if (args.expectedRevision !== undefined && args.expectedRevision !== (current?.revision ?? 0)) {
          throw new Error("state revision conflict");
        }
        if (actionName === "delete") {
          if (!current) return { key, deleted: false, revision: document.revision };
          delete document.entries[key];
          document.revision += 1;
          this.#write(document, () => { assertOwnership(); throwIfAbortedOrExpired(context.signal, context.deadline); });
          committedRevision = document.revision;
          throwIfAbortedOrExpired(context.signal, context.deadline);
          return { key, deleted: true, revision: document.revision };
        }

        const serialized = JSON.stringify(args.value);
        if (serialized === undefined || serialized.length > this.#maxValueChars || Buffer.byteLength(serialized, "utf8") > this.#maxValueBytes) {
          throw new Error("state value exceeds configured bounds");
        }
        if (!current && Object.keys(document.entries).length >= this.#maxEntries) {
          throw new Error("state entry limit reached");
        }
        document.revision += 1;
        document.entries[key] = {
          revision: document.revision,
          value: JSON.parse(serialized) as unknown,
          updatedAt: Date.now(),
        };
        throwIfAbortedOrExpired(context.signal, context.deadline);
        this.#write(document, () => { assertOwnership(); throwIfAbortedOrExpired(context.signal, context.deadline); });
        committedRevision = document.revision;
        throwIfAbortedOrExpired(context.signal, context.deadline);
        return { key, revision: document.revision };
      });
    } catch (error) {
      if (committedRevision !== undefined) throw new StateCommitAcknowledgementError(committedRevision, { cause: error }, actionName);
      throw error;
    }
  }

  #assertRoot(): void {
    try {
      const stat = fs.lstatSync(this.#root);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !sameFile(stat, this.#rootIdentity) ||
          fs.realpathSync(this.#root) !== this.#root ||
          (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 ||
            (typeof process.getuid === "function" && stat.uid !== process.getuid())))) {
        throw new Error("state root identity or private permissions changed");
      }
    } catch (cause) {
      throw new Error("state root is missing, replaced or no longer private; reopen only after verifying storage", { cause });
    }
  }

  #assertLock(identity: { dev: number; ino: number }, target = this.#lock): void {
    const current = fs.lstatSync(target);
    if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || !sameFile(current, identity)) {
      throw new Error("uncertain state lock ownership: replacement lock preserved");
    }
  }

  #read(): StateDocument {
    this.#assertRoot();
    let descriptor: number | undefined;
    try {
      const lexicalStats = fs.lstatSync(this.#file);
      if (!lexicalStats.isFile() || lexicalStats.isSymbolicLink() || lexicalStats.nlink !== 1) {
        throw new Error("state file is not a private regular file");
      }
      descriptor = fs.openSync(
        this.#file,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
      );
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.nlink !== 1 ||
          stat.dev !== lexicalStats.dev || stat.ino !== lexicalStats.ino) {
        throw new Error("state file changed while it was being opened");
      }
      if (process.platform !== "win32") {
        if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
          throw new Error("state file must be owned by the current user");
        }
        if ((stat.mode & 0o077) !== 0) throw new Error("state file permissions must be private");
      }
      if (stat.size > Math.min(this.#maxTotalChars * 4, this.#maxTotalBytes)) throw new Error("state document exceeds configured bounds");
      this.#assertRoot();
      const text = fs.readFileSync(descriptor, "utf8");
      this.#assertRoot();
      if (text.length > this.#maxTotalChars || Buffer.byteLength(text, "utf8") > this.#maxTotalBytes) throw new Error("state document exceeds configured bounds");
      const parsed = JSON.parse(text) as unknown;
      if (!isRecord(parsed) || !hasExactKeys(parsed, ["schemaVersion", "revision", "entries"]) ||
          parsed.schemaVersion !== 1 || !Number.isSafeInteger(parsed.revision) ||
          (parsed.revision as number) < 0 || !isRecord(parsed.entries)) {
        throw new Error("state file is malformed");
      }
      const entries = parsed.entries as Record<string, unknown>;
      if (Object.keys(entries).length > this.#maxEntries) throw new Error("state entry limit reached");
      const normalizedEntries = emptyEntries();
      for (const [key, entry] of Object.entries(entries)) {
        if (!validStateKey(key) || !isRecord(entry) ||
            !hasExactKeys(entry, ["revision", "value", "updatedAt"]) ||
            !Number.isSafeInteger(entry.revision) || (entry.revision as number) < 1 ||
            (entry.revision as number) > (parsed.revision as number) ||
            !Number.isSafeInteger(entry.updatedAt) || (entry.updatedAt as number) < 0) {
          throw new Error("state file is malformed");
        }
        const value = JSON.stringify(entry.value);
        if (value === undefined || value.length > this.#maxValueChars || Buffer.byteLength(value, "utf8") > this.#maxValueBytes) {
          throw new Error("state value exceeds configured bounds");
        }
        normalizedEntries[key] = entry as unknown as StateEntry;
      }
      return {
        schemaVersion: 1,
        revision: parsed.revision as number,
        entries: normalizedEntries,
      };
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        this.#assertRoot();
        return emptyDocument();
      }
      throw error;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  #write(document: StateDocument, beforeCommit: () => void): void {
    this.#assertRoot();
    const text = `${JSON.stringify(document, null, 2)}\n`;
    if (text.length > this.#maxTotalChars || Buffer.byteLength(text, "utf8") > this.#maxTotalBytes) throw new Error("state document exceeds configured bounds");
    const temporary = path.join(
      this.#root,
      `.state-${process.pid}-${randomBytes(8).toString("hex")}.tmp`,
    );
    const owned: OwnedFile = { created: false };
    try {
      initializeOwnedFile(temporary, owned, (descriptor) => {
        this.#assertRoot();
        fs.writeFileSync(descriptor, text);
        fs.fchmodSync(descriptor, 0o600);
        fs.fsyncSync(descriptor);
      });
      beforeCommit();
      const current = fs.lstatSync(temporary);
      if (!owned.identity || !current.isFile() || current.isSymbolicLink() ||
          current.dev !== owned.identity.dev || current.ino !== owned.identity.ino) {
        throw new Error("uncertain state temporary publication: replacement preserved");
      }
      fs.renameSync(temporary, this.#file);
    } catch (error) {
      if (owned.created) {
        try {
          if (!owned.identity) throw new Error("uncertain state temporary ownership; operator recovery required");
          try {
            this.#assertRoot();
            const current = fs.lstatSync(temporary);
            if (!current.isFile() || current.isSymbolicLink() || current.dev !== owned.identity.dev || current.ino !== owned.identity.ino) {
              throw new Error("uncertain state temporary cleanup: replacement preserved");
            }
            fs.rmSync(temporary);
          } catch (cleanup) { if (errorCode(cleanup) !== "ENOENT") throw cleanup; }
        } catch (cleanup) { throw new AggregateError([error, cleanup], "state write and temporary cleanup failed", { cause: error }); }
      }
      throw error;
    }
  }

  #openRoot(): number {
    this.#assertRoot();
    const fd = fs.openSync(this.#root, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) |
      (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isDirectory() || !sameFile(stat, this.#rootIdentity)) {
        throw new Error("state root descriptor identity mismatch");
      }
      return fd;
    } catch (error) {
      fs.closeSync(fd);
      throw error;
    }
  }

  /** Delete one root child ONLY through a descriptor anchored to the original
   * root inode. Between `lstat` and `unlink` another process may rename the
   * root away and a replacement root may host a live lock at the same pathname;
   * deleting by absolute path would then remove a live writer's lock. Linux
   * uses the kernel-pinned /proc/self/fd alias (survives renames); other POSIX
   * platforms use the verified bounded child, which fails closed if the named
   * directory no longer matches the held descriptor. Windows keeps the plain
   * pathname and its legacy semantics. */
  #removeNamedEntry(identity: { dev: number; ino: number }, target: string, rootFd: number): void {
    const name = path.basename(target);
    let before: fs.BigIntStats;
    try { before = fs.lstatSync(target, { bigint: true }); }
    catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      this.#assertRoot();
      return;
    }
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || !sameBigFile(before, identity)) {
      throw new Error("uncertain state lock cleanup: replacement lock preserved");
    }
    this.#assertRoot();
    if (process.platform === "linux") {
      const alias = `/proc/self/fd/${rootFd}`;
      const pinned = fs.statSync(`${alias}/.`, { bigint: true });
      if (!pinned.isDirectory() || !sameBigFile(pinned, this.#rootIdentity)) {
        throw new Error("unsafe state directory descriptor traversal");
      }
      fs.rmSync(`${alias}/${name}`);
      return;
    }
    if (process.platform === "win32") { fs.rmSync(target); return; }
    runPinnedDirectoryOperation({
      fd: rootFd,
      cwd: this.#root,
      parent: pinnedDirectoryIdentity(fs.fstatSync(rootFd, { bigint: true })),
      check: () => this.#assertRoot(),
      operation: "unlink",
      name,
      expected: pinnedEntryIdentity(before),
    });
  }

  #releaseLock(identity: { dev: number; ino: number }, target: string, rootFd: number): void {
    this.#assertRoot();
    this.#removeNamedEntry(identity, target, rootFd);
  }

  #readLockOwner(inspected: fs.Stats): StateLockOwner | undefined {
    this.#assertRoot();
    let fd: number;
    try {
      fd = fs.openSync(this.#lock, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    } catch (error) {
      // The observed generation disappeared or was replaced between lstat and
      // open: ordinary concurrent recovery, not corruption. Re-lstat and retry.
      if (errorCode(error) === "ENOENT" || errorCode(error) === "ELOOP") return undefined;
      throw error;
    }
    try {
      const stat = fs.fstatSync(fd);
      // Replacement or unlink-in-flight between lstat and open is ordinary
      // recovery contention, not corruption: re-observe instead of failing.
      if (!sameFile(stat, inspected) || stat.nlink === 0) return undefined;
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_LOCK_BYTES ||
          (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 ||
            (typeof process.getuid === "function" && stat.uid !== process.getuid())))) {
        throw new Error("uncertain state lock owner; unsafe lock preserved");
      }
      const bytes = Buffer.alloc(MAX_LOCK_BYTES + 1);
      const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
      if (count > MAX_LOCK_BYTES) throw new Error("uncertain state lock owner; lock exceeds byte bound");
      const text = bytes.subarray(0, count).toString("utf8");
      let owner: unknown;
      try { owner = JSON.parse(text) as unknown; }
      catch (cause) { throw new Error("uncertain state lock owner; operator recovery required", { cause }); }
      this.#assertRoot();
      let finalStat: fs.Stats;
      try { finalStat = fs.lstatSync(this.#lock); }
      catch (error) {
        if (errorCode(error) === "ENOENT") return undefined;
        throw error;
      }
      if (!sameFile(finalStat, inspected)) return undefined;
      if (!isRecord(owner)) throw new Error("uncertain state lock owner; operator recovery required");
      const versioned = owner.schemaVersion === 2 && owner.kind === STATE_LOCK_KIND;
      const pid = versioned && isRecord(owner.process) ? owner.process.pid : owner.pid;
      if (!Number.isSafeInteger(pid) || (pid as number) <= 0) throw new Error("uncertain state lock owner; operator recovery required");
      if (versioned) {
        if (!hasExactKeys(owner, ["schemaVersion", "kind", "process", "token", "acquiredAt"]) ||
            !isRecord(owner.process) || !hasExactKeys(owner.process, ["pid"]) ||
            typeof owner.token !== "string" || !/^[a-f0-9]{32}$/.test(owner.token) ||
            !Number.isSafeInteger(owner.acquiredAt) || (owner.acquiredAt as number) < 0) {
          throw new Error("uncertain state lock owner; malformed recovery identity");
        }
        return { pid: pid as number, token: owner.token, text };
      }
      return { pid: pid as number, text };
    } finally { fs.closeSync(fd); }
  }

  /** Every reclaimer of one versioned owner must win the SAME exclusive claim
   * before inspecting/removing that owner's lock. The live claim cannot itself
   * be reclaimed. Thus a stale observer cannot move a newer owner's live lock,
   * even briefly. Interrupted claims and legacy locks require operator recovery.
   * The mutation pathname remains unchanged; old clients cannot parse versioned
   * owner PIDs and therefore fail closed instead of applying legacy recovery. */
  #reclaimStaleLock(inspected: fs.Stats, owner: StateLockOwner, rootFd: number): boolean {
    if (!owner.token) throw new Error("legacy state lock requires operator recovery; preserve it and stop old writers first");
    const claim = path.join(this.#root, `.state-recovery-${owner.token}.claim`);
    const owned: OwnedFile = { created: false };
    try {
      try {
        initializeOwnedFile(claim, owned, (fd) => {
          fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, ownerToken: owner.token })}\n`);
          fs.fsyncSync(fd);
        });
      } catch (error) {
        if (!owned.created && errorCode(error) === "EEXIST") return false;
        throw error;
      }
      this.#assertRoot();
      let current: fs.Stats;
      try { current = fs.lstatSync(this.#lock); }
      catch (error) { if (errorCode(error) === "ENOENT") return true; throw error; }
      if (!sameFile(current, inspected)) return false;
      const rechecked = this.#readLockOwner(current);
      if (rechecked === undefined || rechecked.text !== owner.text || processIsAlive(rechecked.pid)) return false;
      this.#assertLock(owned.identity!, claim);
      this.#releaseLock(inspected, this.#lock, rootFd);
      return true;
    } finally {
      if (owned.created) {
        try {
          if (!owned.identity) throw new Error("state recovery claim ownership identity unavailable");
          this.#releaseLock(owned.identity, claim, rootFd);
        } catch (cause) {
          this.#uncertainLock = true;
          throw new Error("uncertain state recovery claim cleanup; operator recovery required", { cause });
        }
      }
    }
  }

  async #withMutationLock<T>(context: FabricInvocationContext, operation: (assertOwnership: () => void) => T): Promise<T> {
    if (this.#uncertainLock) throw new Error("uncertain state lock ownership; operator recovery required");
    const rootFd = this.#openRoot();
    // The inner lock holder releases through the /proc/self/fd alias; closing
    // the anchor before it settles (return without await) corrupts cleanup for
    // every writer that ever suspends on a contention delay.
    try { return await this.#withMutationLockLocked(context, operation, rootFd); }
    finally { fs.closeSync(rootFd); }
  }

  async #withMutationLockLocked<T>(context: FabricInvocationContext, operation: (assertOwnership: () => void) => T, rootFd: number): Promise<T> {
    const lockDeadline = performance.now() + LOCK_TIMEOUT_MS;
    let identity: { dev: number; ino: number } | undefined;
    let operationError: unknown;
    let failed = false;
    try {
      while (!identity) {
        throwIfAbortedOrExpired(context.signal, context.deadline);
        this.#assertRoot();
        // Only a completed operation can leave this deferred responsibility.
        // Retry before acquisition, including callers already waiting here.
        if (this.#pendingLockCleanup) {
          this.#releaseLock(this.#pendingLockCleanup, this.#lock, rootFd);
          this.#pendingLockCleanup = undefined;
        }
        try {
          const owned: OwnedFile = { created: false };
          try {
            initializeOwnedFile(this.#lock, owned, (descriptor) => {
              this.#assertRoot();
              fs.writeFileSync(descriptor, `${JSON.stringify({ schemaVersion: 2, kind: STATE_LOCK_KIND, process: { pid: process.pid }, token: randomBytes(16).toString("hex"), acquiredAt: Date.now() })}\n`);
              fs.fsyncSync(descriptor);
            });
          } catch (error) {
            if (!owned.created) throw error;
            if (!owned.identity) this.#uncertainLock = true;
            throw new AggregateError([error], owned.identity
              ? "state lock initialization failure; ownership cleanup required"
              : "state lock initialization failure; uncertain ownership identity unavailable; operator recovery required", { cause: error });
          } finally { identity = owned.identity; }
        } catch (error) {
          if (identity || errorCode(error) !== "EEXIST") throw error;
          let stat: fs.Stats;
          try { stat = fs.lstatSync(this.#lock); }
          catch (statError) { if (errorCode(statError) === "ENOENT") continue; throw statError; }
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("state mutation lock is foreign");
          if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
            const owner = this.#readLockOwner(stat);
            if (owner === undefined) continue;
            if (!processIsAlive(owner.pid) && this.#reclaimStaleLock(stat, owner, rootFd)) continue;
          }
          if (performance.now() >= lockDeadline) throw new Error("timed out waiting for state mutation lock");
          await delay(10);
        }
      }
      throwIfAbortedOrExpired(context.signal, context.deadline);
      const acquiredIdentity = identity;
      const assertOwnership = (): void => { this.#assertRoot(); this.#assertLock(acquiredIdentity); };
      assertOwnership();
      const result = operation(assertOwnership);
      throwIfAbortedOrExpired(context.signal, context.deadline);
      return result;
    } catch (error) {
      failed = true; operationError = error; throw error;
    } finally {
      if (identity) {
        try { this.#releaseLock(identity, this.#lock, rootFd); }
        catch (cleanup) {
          this.#pendingLockCleanup = identity;
          if (failed) throw new AggregateError([operationError, cleanup], "state mutation and lock cleanup failed; lock replacement or removal is uncertain", { cause: operationError });
          throw cleanup;
        }
      }
    }
  }
}
