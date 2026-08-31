// Opaque, process-local overflow artifacts for the Kiro MCP adapter.
//
// Artifact payloads deliberately never receive filesystem names. This avoids
// path-based TOCTOU problems, prevents a project from redirecting writes with
// symlinks, and makes crash cleanup automatic: process termination releases
// the only references to every payload.

import { randomBytes } from "node:crypto";

const DEFAULT_TTL_MS = 60 * 60 * 1_000;
const MAX_ARTIFACTS = 32;
const MAX_ARTIFACT_CHARS = 2_000_000;
const MAX_TOTAL_CHARS = 8_000_000;
const DEFAULT_READ_CHARS = 12_000;
const MAX_READ_CHARS = 16_000;
const ARTIFACT_ID = /^ka_[a-f0-9]{48}$/;

interface StoredArtifact {
  content: string;
  createdAt: number;
  lastReadAt: number;
}

export class KiroArtifactStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KiroArtifactStoreError";
  }
}

interface KiroArtifactReadResult {
  id: string;
  text: string;
  offset: number;
  nextOffset: number;
  totalChars: number;
  done: boolean;
}

export interface KiroArtifactStore {
  write(content: string): string;
  read(id: string, offset?: number, limit?: number): KiroArtifactReadResult;
  sweep(maxAgeMs?: number, maxEntries?: number): void;
  close(): void;
}

export interface KiroArtifactStoreOptions {
  /** Test-only deterministic clock. */
  now?: () => number;
}

class EphemeralKiroArtifactStore implements KiroArtifactStore {
  readonly #entries = new Map<string, StoredArtifact>();
  readonly #now: () => number;
  #totalChars = 0;
  #closed = false;

  constructor(options: KiroArtifactStoreOptions = {}) {
    this.#now = options.now ?? Date.now;
  }

  #assertOpen(): void {
    if (this.#closed) throw new KiroArtifactStoreError("artifact store is closed");
  }

  write(content: string): string {
    this.#assertOpen();
    if (content.length > MAX_ARTIFACT_CHARS) {
      throw new KiroArtifactStoreError(
        `artifact exceeds the ${MAX_ARTIFACT_CHARS}-character session limit`,
      );
    }
    this.sweep(DEFAULT_TTL_MS, MAX_ARTIFACTS - 1);
    while (this.#entries.size > 0 && this.#totalChars + content.length > MAX_TOTAL_CHARS) {
      this.#remove(this.#oldestId());
    }
    if (this.#totalChars + content.length > MAX_TOTAL_CHARS) {
      throw new KiroArtifactStoreError("artifact session quota exceeded");
    }
    let id: string;
    do id = `ka_${randomBytes(24).toString("hex")}`;
    while (this.#entries.has(id));
    const now = this.#now();
    this.#entries.set(id, { content, createdAt: now, lastReadAt: now });
    this.#totalChars += content.length;
    return id;
  }

  read(id: string, offset = 0, limit = DEFAULT_READ_CHARS): KiroArtifactReadResult {
    this.#assertOpen();
    if (!ARTIFACT_ID.test(id)) throw new KiroArtifactStoreError("invalid artifact id");
    const entry = this.#entries.get(id);
    if (!entry) throw new KiroArtifactStoreError("artifact is unavailable or expired");
    const normalizedOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : -1;
    const normalizedLimit = Number.isSafeInteger(limit) && limit > 0
      ? Math.min(limit, MAX_READ_CHARS)
      : -1;
    if (normalizedOffset < 0 || normalizedLimit < 0) {
      throw new KiroArtifactStoreError("artifact offset and limit must be positive integers");
    }
    const text = entry.content.slice(normalizedOffset, normalizedOffset + normalizedLimit);
    // Out-of-range probes must not keep an artifact alive indefinitely.
    if (text.length > 0) entry.lastReadAt = this.#now();
    const nextOffset = normalizedOffset + text.length;
    return {
      id,
      text,
      offset: normalizedOffset,
      nextOffset,
      totalChars: entry.content.length,
      done: nextOffset >= entry.content.length,
    };
  }

  sweep(maxAgeMs = DEFAULT_TTL_MS, maxEntries = MAX_ARTIFACTS): void {
    this.#assertOpen();
    const age = Number.isFinite(maxAgeMs) ? Math.max(0, maxAgeMs) : DEFAULT_TTL_MS;
    const keep = Number.isFinite(maxEntries)
      ? Math.max(0, Math.floor(maxEntries))
      : MAX_ARTIFACTS;
    const now = this.#now();
    for (const [id, entry] of this.#entries) {
      if (now - entry.lastReadAt > age) this.#remove(id);
    }
    while (this.#entries.size > keep) this.#remove(this.#oldestId());
  }

  #oldestId(): string {
    let oldest: [string, StoredArtifact] | undefined;
    for (const current of this.#entries) {
      if (
        !oldest ||
        current[1].lastReadAt < oldest[1].lastReadAt ||
        (current[1].lastReadAt === oldest[1].lastReadAt && current[0] < oldest[0])
      ) oldest = current;
    }
    if (!oldest) throw new KiroArtifactStoreError("artifact store is empty");
    return oldest[0];
  }

  #remove(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    this.#totalChars -= entry.content.length;
    this.#entries.delete(id);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#entries.clear();
    this.#totalChars = 0;
  }
}

export const createKiroArtifactStore = (
  _cwd?: string,
  options: KiroArtifactStoreOptions = {},
): KiroArtifactStore => new EphemeralKiroArtifactStore(options);
