import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createFoveaDirectory, privateFoveaDirectory } from './config.js';
import { openSourceDirectory, type SourceHandle, type SourcePlatform } from './source-platform.js';
import { nativeProvenanceOperations, type NativeProvenanceOperations } from './source-platform-native.js';

export interface ProvenanceTransition { path: string; beforeSha256: string | null; afterSha256: string | null }
interface ProvenanceRecord extends ProvenanceTransition { sequence: number; origin: string }
export interface ProvenanceJournal { version: 1; worktree: string; sequence: number; records: ProvenanceRecord[] }
export const PROVENANCE_MAX_RECORDS = 128;
const MAX_BYTES = 48_000;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function validProvenanceTransition(v: unknown): v is ProvenanceTransition {
  return object(v) && typeof v.path === 'string' && v.path.length > 0 && v.path.length <= 512 &&
    !v.path.includes('\\') && !/[\x00-\x1f\x7f]/u.test(v.path) && !path.posix.isAbsolute(v.path) &&
    v.path.split('/').every(p => !!p && p !== '.' && p !== '..') &&
    (v.beforeSha256 === null || hash(v.beforeSha256)) && (v.afterSha256 === null || hash(v.afterSha256));
}
export function validateProvenanceJournal(v: unknown, worktree: string): ProvenanceJournal {
  if (!object(v) || Object.keys(v).sort().join(',') !== 'records,sequence,version,worktree' || v.version !== 1 || !hash(worktree) || v.worktree !== worktree ||
      !Number.isSafeInteger(v.sequence) || (v.sequence as number) < 0 || !Array.isArray(v.records) || v.records.length > PROVENANCE_MAX_RECORDS) throw new Error('Invalid provenance journal');
  let previous = (v.sequence as number) - v.records.length;
  if (previous < 0) throw new Error('Invalid provenance sequence');
  for (const r of v.records) {
    if (!validProvenanceTransition(r) || Object.keys(r).sort().join(',') !== 'afterSha256,beforeSha256,origin,path,sequence' ||
        !object(r) || !hash(r.origin) || r.sequence !== ++previous) throw new Error('Invalid provenance record');
  }
  if (previous !== v.sequence || Buffer.byteLength(JSON.stringify(v), 'utf8') > MAX_BYTES) throw new Error('Invalid provenance bounds');
  return v as unknown as ProvenanceJournal;
}

/** Host-authored, per-physical-worktree ledger. No source reads, conversation
 * identifiers, arguments, navigation or permission grants are persisted here.
 * Lock contention/unsafe or malformed storage fails closed; callers mark a gap.
 * Descriptor-relative publication uses the same private/no-follow/exclusive
 * lock discipline as config, without holding any source-file locks. */
export class FoveaProvenanceJournal {
  readonly directory: string;
  private readonly identity: fs.Stats;
  private readonly native: NativeProvenanceOperations | undefined;
  /** platform is host-authenticated, never taken from guest args or a path. */
  constructor(foveaRoot: string, private readonly platform?: SourcePlatform) {
    if (platform) this.native = nativeProvenanceOperations(platform);
    else if (process.platform !== 'linux') throw new Error('Unsupported provenance storage: trusted native binding required');
    this.directory = createFoveaDirectory(foveaRoot, 'provenance');
    this.identity = fs.lstatSync(this.directory);
  }
  private decode(bytes: Buffer | null, worktree: string): ProvenanceJournal {
    if (bytes === null) return { version: 1, worktree, sequence: 0, records: [] };
    if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES) throw new Error('Provenance byte limit');
    return validateProvenanceJournal(JSON.parse(bytes.toString('utf8')), worktree);
  }
  private extend(journal: ProvenanceJournal, origin: string, transitions: readonly ProvenanceTransition[]): void {
    for (const t of transitions) {
      if (t.beforeSha256 === t.afterSha256) continue;
      if (!Number.isSafeInteger(journal.sequence + 1)) throw new Error('Provenance sequence exhausted');
      journal.records.push({ path: t.path, beforeSha256: t.beforeSha256, afterSha256: t.afterSha256, origin, sequence: ++journal.sequence });
    }
    while (journal.records.length > PROVENANCE_MAX_RECORDS || Buffer.byteLength(JSON.stringify(journal), 'utf8') > MAX_BYTES) journal.records.shift();
  }
  private async nativeAccess<T>(worktree: string, fn: (directory: SourceHandle) => Promise<T>): Promise<T> {
    if (!hash(worktree)) throw new Error('Invalid provenance worktree');
    privateFoveaDirectory(this.directory);
    const directory = await openSourceDirectory(this.platform!, this.directory);
    const check = async (): Promise<void> => {
      const s = await directory.stat(), current = fs.lstatSync(this.directory);
      if (!s.isDirectory() || s.dev !== this.identity.dev || s.ino !== this.identity.ino ||
          s.dev !== current.dev || s.ino !== current.ino || (s.mode & 0o077) || s.uid !== process.getuid?.()) throw new Error('Unsafe provenance directory');
      privateFoveaDirectory(this.directory);
    };
    try { await check(); const result = await fn(directory); await check(); return result; }
    finally { await directory.close(); }
  }
  private access<T>(worktree: string, fn: (file: string, directory: number) => T): T {
    if (!hash(worktree) || process.platform !== 'linux') throw new Error('Unsupported provenance storage');
    privateFoveaDirectory(this.directory);
    const fd = fs.openSync(this.directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try {
      const s = fs.fstatSync(fd), current = fs.lstatSync(this.directory);
      if (s.dev !== this.identity.dev || s.ino !== this.identity.ino || s.dev !== current.dev || s.ino !== current.ino || (s.mode & 0o077) || s.uid !== process.getuid?.()) throw new Error('Unsafe provenance directory');
      return fn(`/proc/self/fd/${fd}/${worktree}.json`, fd);
    } finally { fs.closeSync(fd); }
  }
  private load(file: string, worktree: string): ProvenanceJournal {
    let fd: number;
    try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, worktree, sequence: 0, records: [] }; throw e; }
    try {
      const s = fs.fstatSync(fd);
      if (!s.isFile() || s.nlink !== 1 || (s.mode & 0o077) || s.uid !== process.getuid?.() || s.size > MAX_BYTES) throw new Error('Unsafe provenance file');
      const bytes = Buffer.alloc(MAX_BYTES + 1), n = fs.readSync(fd, bytes, 0, bytes.length, 0);
      if (n > MAX_BYTES) throw new Error('Provenance byte limit');
      return validateProvenanceJournal(JSON.parse(bytes.subarray(0, n).toString('utf8')), worktree);
    } finally { fs.closeSync(fd); }
  }
  async read(worktree: string): Promise<ProvenanceJournal> {
    if (this.native) return this.nativeAccess(worktree, async directory => this.decode(await this.native!.read(directory, `${worktree}.json`), worktree));
    return this.access(worktree, file => this.load(file, worktree));
  }
  async append(worktree: string, origin: string, transitions: readonly ProvenanceTransition[], signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (!hash(origin) || transitions.length > PROVENANCE_MAX_RECORDS || transitions.some(t => !validProvenanceTransition(t))) throw new Error('Invalid provenance admission');
    // Snapshot before the first await: caller mutation cannot change admission.
    transitions = transitions.map(t => ({ path: t.path, beforeSha256: t.beforeSha256, afterSha256: t.afterSha256 }));
    if (this.native) return this.nativeAccess(worktree, async directory => {
      const name = `${worktree}.json`, before = await this.native!.read(directory, name);
      const journal = this.decode(before, worktree);
      this.extend(journal, origin, transitions);
      // CAS is under a native exclusive lock. Contention/conflict is a gap,
      // never a lost update, stale-lock deletion or path-based retry.
      signal?.throwIfAborted(); // Revocation during native reads must not admit a queued publication.
      await this.native!.replace(directory, name, before, Buffer.from(JSON.stringify(journal)), randomBytes(16).toString('hex'));
    });
    this.access(worktree, (file, directory) => {
      const lockPath = file + '.lock';
      const lock = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
      const identity = fs.fstatSync(lock);
      const tmp = file + `.${randomBytes(16).toString('hex')}.tmp`;
      try {
        const journal = this.load(file, worktree);
        this.extend(journal, origin, transitions);
        const fd = fs.openSync(tmp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
        try { fs.writeFileSync(fd, JSON.stringify(journal)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, file); fs.fsyncSync(directory);
      } finally {
        try { fs.unlinkSync(tmp); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        fs.closeSync(lock);
        const current = fs.lstatSync(lockPath);
        if (identity.dev !== current.dev || identity.ino !== current.ino) throw new Error('Provenance lock replaced');
        fs.unlinkSync(lockPath);
      }
    });
  }
}
