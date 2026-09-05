import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
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
const LOCK_NAME = ".state-mutation.lock";
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;

const descriptors: readonly FabricActionDescriptor[] = [
  { name: "get", description: "Read one workspace-bound state value", inputSchema: { type: "object", properties: { key: { type: "string", minLength: 1, maxLength: KEY_MAX } }, required: ["key"], additionalProperties: false }, risk: "read", effect: { kind: "read" } },
  { name: "set", description: "Atomically set one workspace-bound state value", inputSchema: { type: "object", properties: { key: { type: "string", minLength: 1, maxLength: KEY_MAX }, value: {}, expectedRevision: { type: "integer", minimum: 0 } }, required: ["key", "value"], additionalProperties: false }, risk: "write", effect: { kind: "write" } },
  { name: "list", description: "List bounded workspace state metadata", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 1000 } }, additionalProperties: false }, risk: "read", effect: { kind: "read" } },
  { name: "delete", description: "Atomically delete one workspace-bound state value", inputSchema: { type: "object", properties: { key: { type: "string", minLength: 1, maxLength: KEY_MAX }, expectedRevision: { type: "integer", minimum: 0 } }, required: ["key"], additionalProperties: false }, risk: "write", effect: { kind: "write" } },
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
  catch (error) { return errorCode(error) === "EPERM"; }
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
  constructor(readonly revision: number, options: ErrorOptions) {
    super(`State mutation committed at revision ${revision}; acknowledgement failed; read state before retrying`, options);
    this.name = "StateCommitAcknowledgementError";
  }
}

export class StateProvider implements FabricProvider {
  readonly name = "state";
  readonly description = "Workspace-bound atomic state";
  readonly #root: string;
  readonly #file: string;
  readonly #lock: string;
  readonly #maxEntries: number;
  readonly #maxValueChars: number;
  readonly #maxTotalChars: number;
  #pendingLockCleanup: { dev: number; ino: number } | undefined;

  constructor(root: string, options: {
    maxEntries?: number;
    maxValueChars?: number;
    maxTotalChars?: number;
  } = {}) {
    this.#root = privateRoot(root);
    this.#file = path.join(this.#root, "state.json");
    this.#lock = path.join(this.#root, LOCK_NAME);
    this.#maxEntries = options.maxEntries ?? 1_000;
    this.#maxValueChars = options.maxValueChars ?? 100_000;
    this.#maxTotalChars = options.maxTotalChars ?? 8_000_000;
  }

  async list(): Promise<FabricActionDescriptor[]> { return [...descriptors]; }

  async describe(actionName: string): Promise<FabricActionDescriptor | undefined> {
    return descriptors.find((entry) => entry.name === actionName);
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
      return await this.#withMutationLock(context, () => {
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
          this.#write(document, () => throwIfAbortedOrExpired(context.signal, context.deadline));
          committedRevision = document.revision;
          throwIfAbortedOrExpired(context.signal, context.deadline);
          return { key, deleted: true, revision: document.revision };
        }

        const serialized = JSON.stringify(args.value);
        if (serialized === undefined || serialized.length > this.#maxValueChars) {
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
        this.#write(document, () => throwIfAbortedOrExpired(context.signal, context.deadline));
        committedRevision = document.revision;
        throwIfAbortedOrExpired(context.signal, context.deadline);
        return { key, revision: document.revision };
      });
    } catch (error) {
      if (committedRevision !== undefined) throw new StateCommitAcknowledgementError(committedRevision, { cause: error });
      throw error;
    }
  }

  #read(): StateDocument {
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
      if (stat.size > this.#maxTotalChars * 4) throw new Error("state document exceeds configured bounds");
      const text = fs.readFileSync(descriptor, "utf8");
      if (text.length > this.#maxTotalChars) throw new Error("state document exceeds configured bounds");
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
        if (key.length < 1 || key.length > KEY_MAX || !isRecord(entry) ||
            !hasExactKeys(entry, ["revision", "value", "updatedAt"]) ||
            !Number.isSafeInteger(entry.revision) || (entry.revision as number) < 1 ||
            (entry.revision as number) > (parsed.revision as number) ||
            !Number.isSafeInteger(entry.updatedAt) || (entry.updatedAt as number) < 0) {
          throw new Error("state file is malformed");
        }
        const value = JSON.stringify(entry.value);
        if (value === undefined || value.length > this.#maxValueChars) {
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
      if (errorCode(error) === "ENOENT") return emptyDocument();
      throw error;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  #write(document: StateDocument, beforeCommit: () => void): void {
    const text = `${JSON.stringify(document, null, 2)}\n`;
    if (text.length > this.#maxTotalChars) throw new Error("state document exceeds configured bounds");
    const temporary = path.join(
      this.#root,
      `.state-${process.pid}-${randomBytes(8).toString("hex")}.tmp`,
    );
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    // The exclusive open establishes ownership before any later I/O can fail.
    try {
      try {
        fs.writeFileSync(descriptor, text);
        fs.fchmodSync(descriptor, 0o600);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      beforeCommit();
      // Commit point. Permissions are already established on the inode.
      fs.renameSync(temporary, this.#file);
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }); }
      catch (cleanup) { throw new AggregateError([error, cleanup], "state write and temporary cleanup failed"); }
      throw error;
    }
  }

  #releaseLock(identity: { dev: number; ino: number }): void {
    try {
      const current = fs.lstatSync(this.#lock);
      if (current.isFile() && !current.isSymbolicLink() &&
          current.dev === identity.dev && current.ino === identity.ino) {
        fs.rmSync(this.#lock);
      }
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }

  async #withMutationLock<T>(context: FabricInvocationContext, operation: () => T): Promise<T> {
    const lockDeadline = performance.now() + LOCK_TIMEOUT_MS;
    let identity: { dev: number; ino: number } | undefined;
    try {
      while (!identity) {
        throwIfAbortedOrExpired(context.signal, context.deadline);
        // Only a completed operation can leave this deferred responsibility.
        // Retry before acquisition, including callers already waiting here.
        if (this.#pendingLockCleanup) {
          this.#releaseLock(this.#pendingLockCleanup);
          this.#pendingLockCleanup = undefined;
        }
        try {
          const descriptor = fs.openSync(this.#lock, "wx", 0o600);
          try {
            // Cleanup owns this inode before metadata writes or syncing can fail.
            const stat = fs.fstatSync(descriptor);
            identity = { dev: stat.dev, ino: stat.ino };
            fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, acquiredAt: Date.now() })}\n`);
            fs.fsyncSync(descriptor);
          } finally {
            fs.closeSync(descriptor);
          }
        } catch (error) {
          if (identity || errorCode(error) !== "EEXIST") throw error;
          let stat: fs.Stats;
          try { stat = fs.lstatSync(this.#lock); }
          catch (statError) { if (errorCode(statError) === "ENOENT") continue; throw statError; }
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("state mutation lock is foreign");
          if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
            let ownerPid = 0;
            try {
              const owner = JSON.parse(fs.readFileSync(this.#lock, "utf8")) as { pid?: unknown };
              if (typeof owner.pid === "number") ownerPid = owner.pid;
            } catch { /* malformed stale locks are reclaimable after identity checks */ }
            if (!processIsAlive(ownerPid)) {
              const current = fs.lstatSync(this.#lock);
              if (current.dev === stat.dev && current.ino === stat.ino && current.isFile()) {
                fs.rmSync(this.#lock);
                continue;
              }
            }
          }
          if (performance.now() >= lockDeadline) throw new Error("timed out waiting for state mutation lock");
          await delay(10);
        }
      }
      throwIfAbortedOrExpired(context.signal, context.deadline);
      const result = operation();
      throwIfAbortedOrExpired(context.signal, context.deadline);
      return result;
    } finally {
      if (identity) {
        try { this.#releaseLock(identity); }
        catch (error) { this.#pendingLockCleanup = identity; throw error; }
      }
    }
  }
}
