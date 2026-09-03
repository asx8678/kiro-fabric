import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ARTIFACT_ID = /^ka_[a-f0-9]{48}$/u;
const MAX_ARTIFACT_RESIDUE_AGE_MS = 86_400_000;
interface StoredArtifact { content: string; createdAt: number; lastReadAt: number; file?: string }
interface KiroArtifactReadResult { id: string; text: string; offset: number; nextOffset: number; totalChars: number; done: boolean }
export interface KiroArtifactStore {
  write(content: string): string;
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
  readonly #now: () => number;
  readonly #root?: string;
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
    if (options.root) {
      fs.mkdirSync(options.root, { recursive: true, mode: 0o700 });
      const stat = fs.lstatSync(options.root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new KiroArtifactStoreError("artifact root must be a regular directory");
      if (process.platform !== "win32" && typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new KiroArtifactStoreError("artifact root must be owned by the current user");
      }
      fs.chmodSync(options.root, 0o700);
      const canonicalRoot = fs.realpathSync(options.root);
      for (const entry of fs.readdirSync(canonicalRoot, { withFileTypes: true })) {
        const target = path.join(canonicalRoot, entry.name);
        const targetStats = fs.lstatSync(target);
        if (!entry.isFile() || targetStats.isSymbolicLink() || !ARTIFACT_ID.test(entry.name)) {
          throw new KiroArtifactStoreError(`artifact root contains an unsupported entry: ${entry.name}`);
        }
        // Another Fabric process may own a fresh valid artifact in this shared
        // private root. Reclaim only residue older than the product-wide
        // maximum lifetime; this process never imports it into its own quota.
        if (this.#now() - targetStats.mtimeMs > MAX_ARTIFACT_RESIDUE_AGE_MS) {
          fs.rmSync(target);
        }
      }
      this.#root = canonicalRoot;
    }
  }
  #open(): void { if (this.#closed) throw new KiroArtifactStoreError("artifact store is closed"); }
  write(content: string): string {
    this.#open();
    if (typeof content !== "string" || content.length > this.#maxArtifactChars) throw new KiroArtifactStoreError("artifact exceeds configured bounds");
    this.sweep(this.#ttlMs, this.#maxArtifacts - 1);
    while (this.#entries.size && this.#totalChars + content.length > this.#maxTotalChars) this.#remove(this.#oldest());
    if (this.#totalChars + content.length > this.#maxTotalChars) throw new KiroArtifactStoreError("artifact quota exceeded");
    let id: string;
    do id = `ka_${randomBytes(24).toString("hex")}`;
    while (this.#entries.has(id) || (this.#root !== undefined && fs.existsSync(path.join(this.#root, id))));
    const file = this.#root ? path.join(this.#root, id) : undefined;
    if (file) {
      const descriptor = fs.openSync(file, "wx", 0o600);
      try { fs.writeFileSync(descriptor, content); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      fs.chmodSync(file, 0o600);
    }
    const now = this.#now();
    this.#entries.set(id, { content, createdAt: now, lastReadAt: now, ...(file ? { file } : {}) });
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
    const text = entry.content.slice(offset, offset + Math.min(limit, 16_000));
    if (text) entry.lastReadAt = this.#now();
    const nextOffset = offset + text.length;
    return { id, text, offset, nextOffset, totalChars: entry.content.length, done: nextOffset >= entry.content.length };
  }
  sweep(maxAgeMs = this.#ttlMs, maxEntries = this.#maxArtifacts): void {
    this.#open();
    const now = this.#now();
    for (const [id, entry] of this.#entries) if (now - entry.lastReadAt > maxAgeMs) this.#remove(id);
    while (this.#entries.size > maxEntries) this.#remove(this.#oldest());
  }
  #oldest(): string {
    const entries = [...this.#entries].sort((a, b) => a[1].lastReadAt - b[1].lastReadAt || a[0].localeCompare(b[0]));
    if (!entries[0]) throw new KiroArtifactStoreError("artifact store is empty");
    return entries[0][0];
  }
  #remove(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    this.#entries.delete(id);
    this.#totalChars -= entry.content.length;
    if (entry.file) fs.rmSync(entry.file, { force: true });
  }
  close(): void {
    if (this.#closed) return;
    for (const id of [...this.#entries.keys()]) this.#remove(id);
    this.#closed = true;
  }
}

export const createKiroArtifactStore = (options: KiroArtifactStoreOptions = {}): KiroArtifactStore => new ArtifactStore(options);
