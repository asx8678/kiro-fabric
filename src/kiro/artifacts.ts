import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pinnedDirectoryIdentity, pinnedEntryIdentity, runPinnedDirectoryOperation } from "../installation/pinned-directory-child.mjs";
import { initializePinnedStateFile, pinnedStatePath } from "../providers/state-directory.js";
import type { OwnedFile } from "../providers/owned-file.js";
import { privateStorageDirectoryGuard, sameStorageFile } from "./storage-identity.js";
import type { FabricArtifactReadResult } from "../protocol.js";

const ARTIFACT_ID = /^ka_[a-f0-9]{48}$/u;
const MAX_ARTIFACT_RESIDUE_AGE_MS = 86_400_000;
interface StoredArtifact { content: string; lastReadAt: number; file?: string; identity?: fs.Stats }
export type KiroArtifactReadResult = FabricArtifactReadResult;
export interface KiroArtifactStore {
  write(content: string, protectedIds?: readonly string[]): string;
  read(id: string, offset?: number, limit?: number): KiroArtifactReadResult;
  sweep(maxAgeMs?: number, maxEntries?: number): void;
  close(): void;
}
export interface KiroArtifactStoreOptions {
  now?: () => number;
  root?: string;
  maxArtifacts?: number;
  maxArtifactChars?: number;
  maxTotalChars?: number;
  ttlMs?: number;
}

class KiroArtifactStoreError extends Error {
  constructor(message: string) { super(message); this.name = "KiroArtifactStoreError"; }
}

class ArtifactStore implements KiroArtifactStore {
  readonly #entries = new Map<string, StoredArtifact>();
  readonly #failedWrites = new Map<string, { identity?: fs.Stats; error: unknown }>();
  readonly #uncertainCloses = new Set<unknown>();
  readonly #now: () => number;
  readonly #root?: string;
  readonly #rootIdentity?: fs.Stats;
  readonly #checkRoot?: () => void;
  readonly #maxArtifacts: number;
  readonly #maxArtifactChars: number;
  readonly #maxTotalChars: number;
  readonly #ttlMs: number;
  #totalChars = 0;
  #closed = false;
  constructor(options: KiroArtifactStoreOptions) {
    this.#now = options.now ?? Date.now;
    this.#maxArtifacts = options.maxArtifacts ?? 32;
    this.#maxArtifactChars = options.maxArtifactChars ?? 2_000_000;
    this.#maxTotalChars = options.maxTotalChars ?? 8_000_000;
    this.#ttlMs = options.ttlMs ?? 3_600_000;
    for (const value of [this.#maxArtifacts, this.#maxArtifactChars, this.#maxTotalChars, this.#ttlMs]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new KiroArtifactStoreError("invalid artifact bounds");
    }
    if (options.root) {
      fs.mkdirSync(options.root, { recursive: true, mode: 0o700 });
      const stat = fs.lstatSync(options.root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new KiroArtifactStoreError("artifact root must be a regular directory");
      if (process.platform !== "win32" && typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new KiroArtifactStoreError("artifact root must be owned by the current user");
      }
      fs.chmodSync(options.root, 0o700);
      const canonicalRoot = fs.realpathSync(options.root);
      this.#root = canonicalRoot;
      this.#checkRoot = privateStorageDirectoryGuard(canonicalRoot, message => new KiroArtifactStoreError(message));
      this.#rootIdentity = fs.lstatSync(canonicalRoot);
      this.#checkRoot();
      for (const entry of fs.readdirSync(canonicalRoot, { withFileTypes: true })) {
        const target = path.join(canonicalRoot, entry.name);
        // Reject foreign entries even if they disappear after enumeration.
        if (!entry.isFile() || !ARTIFACT_ID.test(entry.name)) {
          throw new KiroArtifactStoreError(`artifact root contains an unsupported entry: ${entry.name}`);
        }
        let targetStats: fs.Stats;
        try { targetStats = fs.lstatSync(target); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        if (!targetStats.isFile() || targetStats.isSymbolicLink()) {
          throw new KiroArtifactStoreError(`artifact root contains an unsupported entry: ${entry.name}`);
        }
        // Another Fabric process may own a fresh valid artifact in this shared
        // private root. Reclaim only residue older than the product-wide
        // maximum lifetime; this process never imports it into its own quota.
        if (this.#now() - targetStats.mtimeMs > MAX_ARTIFACT_RESIDUE_AGE_MS) {
          try { this.#removeFile(target, targetStats); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
      }
      this.#checkRoot();
    }
  }
  #open(): void {
    if (this.#closed) throw new KiroArtifactStoreError("artifact store is closed");
    this.#checkRoot?.();
  }
  #assertFile(file: string, identity: fs.Stats, allowMissing = false): boolean {
    this.#checkRoot?.();
    let current: fs.Stats;
    try { current = fs.lstatSync(file); }
    catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") { this.#checkRoot?.(); return false; }
      throw error;
    }
    if (!sameStorageFile(current, identity)) throw new KiroArtifactStoreError(`artifact identity changed; preserve replacement: ${file}`);
    this.#checkRoot?.();
    return true;
  }
  #removeFile(file: string, identity: fs.Stats): void {
    const descriptor = this.#openRoot();
    try {
      const directory = this.#directoryOptions(descriptor);
      const name = path.basename(file);
      const pinned = pinnedStatePath(directory, name);
      if (!this.#assertFile(pinned ?? file, identity, true)) return;
      const current = fs.lstatSync(pinned ?? file, { bigint: true });
      if (!this.#assertFile(pinned ?? file, identity, true)) return;
      if (pinned !== undefined) fs.rmSync(pinned, { force: true });
      else {
        if (process.platform === "win32") throw new KiroArtifactStoreError("descriptor-anchored artifact cleanup is unavailable");
        runPinnedDirectoryOperation({ ...directory, operation: "unlink", name, expected: pinnedEntryIdentity(current) });
      }
      this.#checkRoot?.();
    } finally { this.#closeRoot(descriptor); }
  }
  #openRoot(): number {
    this.#checkRoot?.();
    if (!this.#root || !this.#rootIdentity) throw new KiroArtifactStoreError("artifact root identity unavailable");
    const descriptor = fs.openSync(this.#root, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) |
      (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isDirectory() || stat.dev !== this.#rootIdentity.dev || stat.ino !== this.#rootIdentity.ino) {
        throw new KiroArtifactStoreError("artifact directory descriptor identity changed");
      }
      this.#checkRoot?.();
      return descriptor;
    } catch (error) { this.#closeRoot(descriptor); throw error; }
  }
  #closeRoot(descriptor: number): void {
    try { fs.closeSync(descriptor); }
    catch (error) { this.#uncertainCloses.add(error); throw error; }
  }
  #directoryOptions(descriptor: number) {
    return { fd: descriptor, cwd: this.#root!, parent: pinnedDirectoryIdentity(fs.fstatSync(descriptor, { bigint: true })), check: () => this.#checkRoot?.() };
  }
  write(content: string, protectedIds: readonly string[] = []): string {
    this.#open();
    // A failed partial-file disposal or uncertain descriptor close still owns
    // resources. Do not acquire more files (including a canonical-output retry).
    if (this.#failedWrites.size || this.#uncertainCloses.size) throw new AggregateError(
      [...[...this.#failedWrites.values()].map(entry => entry.error), ...this.#uncertainCloses],
      "artifact storage cleanup is uncertain; retire the owner");
    if (typeof content !== "string" || content.length > this.#maxArtifactChars) throw new KiroArtifactStoreError("artifact exceeds configured bounds");
    // An impossible write must not evict otherwise usable evidence.
    if (content.length > this.#maxTotalChars) throw new KiroArtifactStoreError("artifact quota exceeded");
    this.sweep(this.#ttlMs, this.#maxArtifacts);
    // Protect only live entries already issued by this synchronous publication.
    // TTL still applies. An impossible protected write cannot evict other evidence.
    const protectedSet = new Set(protectedIds);
    const retained = [...this.#entries].filter(([id]) => protectedSet.has(id));
    if (retained.length >= this.#maxArtifacts || retained.reduce((size, [, entry]) => size + entry.content.length, content.length) > this.#maxTotalChars) {
      throw new KiroArtifactStoreError("artifact quota cannot fit protected publication handles");
    }
    while (this.#entries.size >= this.#maxArtifacts || this.#totalChars + content.length > this.#maxTotalChars) this.#remove(this.#oldest(protectedSet));
    if (this.#totalChars + content.length > this.#maxTotalChars) throw new KiroArtifactStoreError("artifact quota exceeded");
    let id: string;
    do id = `ka_${randomBytes(24).toString("hex")}`;
    while (this.#entries.has(id) || (this.#root !== undefined && fs.existsSync(path.join(this.#root, id))));
    const now = this.#now();
    const file = this.#root ? path.join(this.#root, id) : undefined;
    let identity: fs.Stats | undefined;
    if (file) {
      this.#checkRoot?.();
      // An exclusive-create failure never grants cleanup ownership.
      const rootFd = this.#openRoot();
      const owned: OwnedFile = { created: false };
      const close = (fd: number): void => {
        try { fs.closeSync(fd); }
        catch (error) { this.#uncertainCloses.add(error); throw error; } // Never retry a possibly reused descriptor.
      };
      try {
        initializePinnedStateFile(this.#directoryOptions(rootFd), id, owned, (descriptor) => {
          try {
            identity = fs.fstatSync(descriptor);
            fs.writeFileSync(descriptor, content);
            fs.fchmodSync(descriptor, 0o600);
            fs.fsyncSync(descriptor);
            identity = fs.fstatSync(descriptor);
          } catch (error) {
            // Capture partial-write metadata only through the definitely-owned fd.
            try { identity = fs.fstatSync(descriptor); }
            catch (failure) { throw new AggregateError([error, failure], "artifact write identity unavailable", { cause: error }); }
            throw error;
          }
        }, close);
        if (!identity) throw new KiroArtifactStoreError("artifact ownership identity unavailable; preserve evidence");
        this.#assertFile(file, identity);
      } catch (initialError) {
        const error = initialError instanceof AggregateError && initialError.errors.length === 1 ? initialError.errors[0] : initialError;
        if (!owned.created) throw error;
        const errors: unknown[] = [error];
        let residue = false;
        try {
          if (!identity) throw new KiroArtifactStoreError("artifact ownership identity unavailable; preserve evidence");
          this.#removeFile(file, identity);
        } catch (cleanup) { errors.push(cleanup); residue = true; }
        const failure = errors.length > 1 ? new AggregateError(errors, "artifact write and cleanup failed", { cause: error }) : error;
        if (residue) this.#failedWrites.set(file, { ...(identity ? { identity } : {}), error: failure });
        throw failure;
      } finally { this.#closeRoot(rootFd); }
    }
    this.#entries.set(id, { content, lastReadAt: now, ...(file && identity ? { file, identity } : {}) });
    this.#totalChars += content.length;
    return id;
  }
  read(id: string, offset = 0, limit = 12_000): KiroArtifactReadResult {
    this.#open();
    if (!ARTIFACT_ID.test(id)) throw new KiroArtifactStoreError("invalid artifact id");
    // Enforce TTL on reads as well as writes so an otherwise idle store cannot
    // retain and serve an expired full-result artifact indefinitely.
    this.sweep(this.#ttlMs, this.#maxArtifacts);
    const entry = this.#entries.get(id);
    if (!entry) throw new KiroArtifactStoreError("artifact is unavailable or expired");
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new KiroArtifactStoreError("artifact offset and limit must be positive integers");
    // Offsets count UTF-16 units. Never return half of a valid surrogate pair.
    if (offset > 0 && /[\uDC00-\uDFFF]/u.test(entry.content.charAt(offset)) && /[\uD800-\uDBFF]/u.test(entry.content.charAt(offset - 1))) throw new KiroArtifactStoreError("artifact offset splits a Unicode character");
    let end = Math.min(entry.content.length, offset + Math.min(limit, 16_000));
    if (end < entry.content.length && /[\uD800-\uDBFF]/u.test(entry.content.charAt(end - 1)) && /[\uDC00-\uDFFF]/u.test(entry.content.charAt(end))) end -= 1;
    if (end === offset && offset < entry.content.length) throw new KiroArtifactStoreError("artifact limit cannot fit one Unicode character");
    const text = entry.content.slice(offset, end);
    if (text) entry.lastReadAt = this.#now();
    const nextOffset = offset + text.length;
    return { id, text, offset, nextOffset, totalChars: entry.content.length, done: nextOffset >= entry.content.length };
  }
  sweep(maxAgeMs = this.#ttlMs, maxEntries = this.#maxArtifacts): void {
    this.#open();
    const now = this.#now();
    this.#checkRoot?.();
    for (const [id, entry] of this.#entries) if (now - entry.lastReadAt > maxAgeMs) this.#remove(id);
    while (this.#entries.size > maxEntries) this.#remove(this.#oldest());
  }
  #oldest(protectedIds: ReadonlySet<string> = new Set()): string {
    const entries = [...this.#entries].filter(([id]) => !protectedIds.has(id)).sort((a, b) => a[1].lastReadAt - b[1].lastReadAt || a[0].localeCompare(b[0]));
    if (!entries[0]) throw new KiroArtifactStoreError("artifact store is empty");
    return entries[0][0];
  }
  #remove(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    // Keep ownership and quota until deletion succeeds so sweep/close can retry.
    if (entry.file) {
      if (!entry.identity) throw new KiroArtifactStoreError("artifact ownership identity unavailable; preserve evidence");
      this.#removeFile(entry.file, entry.identity);
    }
    this.#entries.delete(id);
    this.#totalChars -= entry.content.length;
  }
  close(): void {
    if (this.#closed) return;
    const failures: unknown[] = [];
    for (const id of [...this.#entries.keys()]) {
      try { this.#remove(id); } catch (error) { failures.push(error); }
    }
    for (const [file, owned] of this.#failedWrites) {
      try {
        if (!owned.identity) throw new KiroArtifactStoreError("artifact ownership identity unavailable; preserve evidence");
        this.#removeFile(file, owned.identity);
        this.#failedWrites.delete(file);
      } catch (error) { failures.push(new AggregateError([owned.error, error], "artifact write residue cleanup failed", { cause: owned.error })); }
    }
    // An uncertain FD close cannot be retried safely even if its path is gone.
    failures.push(...this.#uncertainCloses);
    // Retain failed identities/quota for explicit low-level cleanup recovery;
    // the higher owner has already revoked access and latches its close failure.
    if (failures.length) throw new AggregateError(failures, "artifact store cleanup failed");
    this.#closed = true;
  }
}

export const createKiroArtifactStore = (options: KiroArtifactStoreOptions = {}): KiroArtifactStore => new ArtifactStore(options);

/** Checkpoints keep their existing tighter, in-memory-only retention bounds. */
export const createKiroCheckpointStore = (options: Omit<KiroArtifactStoreOptions, "root"> = {}): KiroArtifactStore =>
  createKiroArtifactStore({ ...(options.now ? { now: options.now } : {}),
    maxArtifacts: Math.min(options.maxArtifacts ?? 16, 16), maxArtifactChars: Math.min(options.maxArtifactChars ?? 100_000, 100_000),
    maxTotalChars: Math.min(options.maxTotalChars ?? 400_000, 400_000), ttlMs: Math.min(options.ttlMs ?? 900_000, 900_000) });
