import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { discoveryExclusionReason, filterSupported, isGeneratedSourceBytes } from './core/build.js';
import { sha256 } from './parser-executable.js';
import {
  assertSourceComponent, openSourceDirectory, readSourceBounded, sourceLimit, sourcePlatform,
  type SourceHandle, type SourcePlatform, type SourceStat,
} from './source-platform.js';

export interface SourceSnapshot { id: string; root: string; hashes: Map<string, string>; coverage: Record<string, unknown> }
export interface SnapshotOptions {
  maxFiles?: number; maxFileBytes?: number; maxBytes?: number; exclude?: string[]; trustedRulesSha256?: string | undefined;
  /** Private previous snapshot only. Live bytes are still hashed; matching trees skip a second copy. */
  previous?: { id: string; root: string; hashes: Map<string, string> };
}

function unchangedFile(before: SourceStat, after: SourceStat, length: number): boolean {
  return after.isFile() && before.nlink === 1 && after.nlink === 1 && before.dev === after.dev && before.ino === after.ino &&
    before.mode === after.mode && before.uid === after.uid && before.gid === after.gid &&
    before.size === length && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

/** Shared policy over descriptor capabilities. Constructed only by trusted host
 * code; source/rules/guest options cannot select a backend or native helper. */
export class SourceAccess {
  constructor(private readonly platform: SourcePlatform) {}

  /** Exact byte snapshots; destination must be a fresh, host-owned private
   * staging directory (the engine uses mkdtemp). No live-source path reopens.
   * Admitted bytes stream to the staging tree one file at a time, so retained
   * live memory is bounded by one bounded file read rather than the whole
   * admitted tree; unchanged files relative to a pinned previous snapshot
   * are reassembled from that private tree, never from live source paths. */
  async captureSourceSnapshot(root: string, destination: string, signal?: AbortSignal, options: SnapshotOptions = {}): Promise<SourceSnapshot> {
    const maxFiles = sourceLimit(options.maxFiles, 8_000, 'files');
    const maxFileBytes = sourceLimit(options.maxFileBytes, 8 * 1024 * 1024, 'file bytes');
    const maxBytes = sourceLimit(options.maxBytes, 128 * 1024 * 1024, 'total bytes');
    const trustedRulesSha256 = options.trustedRulesSha256;
    if (trustedRulesSha256 !== undefined && !/^[a-f0-9]{64}$/.test(trustedRulesSha256)) throw new Error('Invalid trusted project rule hash');
    let routePatterns: RegExp[] = [];
    const hashes = new Map<string, string>();
    // Files whose live bytes were streamed into the staging tree. Unchanged
    // paths (relative to a pinned previous snapshot) keep metadata only.
    const staged = new Set<string>();
    const capFor = (path: string): number =>
      Math.min(maxFileBytes, /\.(?:proto|graphql|gql)$/i.test(path) ? 8 * 1024 * 1024 : 1024 * 1024);
    // Pin the previous host-owned private snapshot before relying on it; an
    // unpinnable previous streams every admitted live file instead.
    const previousRequested = options.previous ?? null;
    const previousPinned = await this.pinPreviousSnapshot(previousRequested);
    const previousHashOf = (path: string): string | undefined =>
      previousPinned === null ? undefined : previousRequested!.hashes.get(path);
    const counts: Record<string, number> = {};
    const examples: Record<string, string[]> = {};
    let bytes = 0, entries = 0, capped = false;
    const report = (kind: string, path: string): void => {
      counts[kind] = (counts[kind] ?? 0) + 1;
      const list = examples[kind] ?? (examples[kind] = []);
      if (list.length < 20) list.push(path);
    };
    const excluded = (path: string): boolean => (options.exclude ?? []).some(value => path === value || path.startsWith(value + '/'));
    const walk = async (directory: SourceHandle, prefix: string, depth: number): Promise<void> => {
      signal?.throwIfAborted();
      if (depth > 64) { report('depthCap', prefix); capped = true; return; }
      const names: string[] = [];
      try {
        for await (const name of this.platform.entries(directory)) {
          signal?.throwIfAborted();
          if (++entries > 100_000 || names.length >= 50_000) { capped = true; report('entryCap', prefix); break; }
          assertSourceComponent(name);
          names.push(name);
        }
      } catch (error) { signal?.throwIfAborted(); report('unreadableDirectories', prefix); return; }
      // Code-unit order keeps the ordered snapshot digest deterministic across
      // locales and ICU versions (and sorts faster than localeCompare).
      names.sort((a, b) => a === '.fovea' ? -1 : b === '.fovea' ? 1 : a < b ? -1 : a > b ? 1 : 0);
      for (const name of names) {
        signal?.throwIfAborted();
        if (hashes.size >= maxFiles || bytes >= maxBytes) { capped = true; return; }
        const path = prefix ? `${prefix}/${name}` : name;
        assertSourceComponent(name);
        if ((name === '.fovea' && (!trustedRulesSha256 || prefix !== '')) || (prefix === '.fovea' && name !== 'rules.json')) { report('untrustedProjectRules', path); continue; }
        // Native host/test caches are not repository source. Exclude before
        // opening or charging budgets; this is adapter policy, not a core fork
        // or a claim that arbitrary .gitignore rules have been evaluated.
        if (['.tmp', '.fabric', '.kiro'].includes(name) || excluded(path) || discoveryExclusionReason(path) || /(^|\/)(?:\.env(?:\..*)?|\.ssh|\.aws|\.gnupg|\.npmrc|\.netrc)$/.test(path)) {
          report('excluded', path); continue;
        }
        let handle: SourceHandle;
        try { handle = await this.platform.openChild(directory, name, 'entry'); }
        catch { signal?.throwIfAborted(); report('unavailableOrSymlink', path); continue; }
        try {
          const before = await handle.stat();
          if (before.isDirectory()) {
            let boundary = false;
            try {
              const marker = await this.platform.openChild(handle, '.git', 'entry');
              await marker.close(); boundary = true;
            } catch (error) { boundary = (error as NodeJS.ErrnoException).code !== 'ENOENT'; }
            if (boundary) { report('closedBoundaries', path); continue; }
            if (entries >= 100_000) { report('entryCap', path); capped = true; continue; }
            await walk(handle, path, depth + 1); continue;
          }
          if (!before.isFile()) { report('notRegular', path); continue; }
          if (before.nlink !== 1) { report('hardlinks', path); continue; }
          // Default convention routers also cover template extensions without a grammar.
          if (!filterSupported([path], routePatterns).length && !/\.(?:svelte|mdx|astro|vue)$/i.test(path)) { report('unsupported', path); continue; }
          const cap = capFor(path);
          if (before.size > cap) { report('oversized', path); continue; }
          const data = await readSourceBounded(handle, cap, signal);
          if (!data) { report('oversized', path); continue; }
          const after = await handle.stat();
          if (!unchangedFile(before, after, data.length)) { report('raced', path); continue; }
          if (bytes + data.length > maxBytes) { capped = true; report('byteCap', path); continue; }
          if (path === '.fovea/rules.json') {
            if (sha256(data) !== trustedRulesSha256) throw new Error('Trusted project rules SHA-256 mismatch');
            // Only the independently approved file may influence discovery. No sibling config is copied.
            const parsed = JSON.parse(data.toString('utf8')) as { fileRoutes?: Array<{ re?: string }> };
            if (parsed.fileRoutes !== undefined && (!Array.isArray(parsed.fileRoutes) || parsed.fileRoutes.length > 256)) throw new Error('Project file-route limit');
            routePatterns = (parsed.fileRoutes ?? []).map(rule => {
              if (typeof rule.re !== 'string' || rule.re.length > 1024) throw new Error('Invalid project file-route regex');
              return new RegExp(rule.re);
            });
          }
          if (isGeneratedSourceBytes(path, data)) report('generated', path);
          const hash = sha256(data);
          if (previousHashOf(path) !== hash) {
            // Stream new or changed bytes into the staging tree at once, so
            // retained live memory stays bounded by a single file read.
            await this.stageFile(destination, path, data, signal);
            staged.add(path);
          }
          // Unchanged paths keep only their metadata; they are reassembled from
          // the pinned private snapshot when the final membership differs.
          hashes.set(path, hash);
          bytes += data.length;
        } finally { await handle.close(); }
      }
    };
    const rootHandle = await openSourceDirectory(this.platform, root, signal);
    try { await walk(rootHandle, '', 0); } finally { await rootHandle.close(); }
    signal?.throwIfAborted();
    if (trustedRulesSha256 && hashes.get('.fovea/rules.json') !== trustedRulesSha256) throw new Error('Trusted project rules missing or unavailable');
    const digest = createHash('sha256');
    for (const [path, hash] of hashes) digest.update(JSON.stringify([path, hash])).update('\n');
    const id = digest.digest('hex');
    const coverage = { sourceFiles: hashes.size, sourceBytes: bytes, entriesVisited: entries, capped, maxFiles, maxFileBytes, maxBytes, counts, examples, projectRules: trustedRulesSha256 ? 'host-approved-hash' : 'untrusted-skipped', trustedRulesSha256 };
    if (previousPinned !== null && previousRequested!.id === id && previousRequested!.hashes.size === hashes.size &&
        [...hashes].every(([path, hash]) => previousRequested!.hashes.get(path) === hash) &&
        await this.previousSnapshotStillPinned(previousPinned)) {
      // Warm reuse: identical membership and ordered digest over a still-pinned
      // private tree. No second copy is written.
      return { id, root: previousPinned.root, hashes, coverage: { ...coverage, reusedPreviousSnapshot: true } };
    }
    if (previousPinned !== null) {
      // The membership changed: reassemble the unchanged files from the pinned
      // private snapshot with bounded, no-follow reads and expected-hash
      // verification. Live source paths are never reopened after their bytes
      // were released; an unavailable or inconsistent previous fails closed.
      if (!await this.previousSnapshotStillPinned(previousPinned)) {
        throw new Error('Previous snapshot became unavailable during capture; retry without it');
      }
      for (const [path, hash] of hashes) {
        if (staged.has(path)) continue;
        signal?.throwIfAborted();
        const data = await this.readPreviousFile(previousPinned.root, path, capFor(path), hash, signal);
        await this.stageFile(destination, path, data, signal);
      }
    }
    return { id, root: destination, hashes, coverage };
  }

  /** Stream one admitted file into the fresh private staging tree. */
  private async stageFile(destination: string, filePath: string, data: Buffer, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const parent = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
    await mkdir(join(destination, parent), { recursive: true, mode: 0o700 });
    await writeFile(join(destination, filePath), data, { flag: 'wx', mode: 0o400 });
  }

  /** Pin the previous snapshot: its root must exist as a private directory. */
  private async pinPreviousSnapshot(previous: SnapshotOptions['previous'] | null): Promise<{ root: string; dev: number; ino: number } | null> {
    if (!previous) return null;
    try {
      const held = await lstat(previous.root);
      if (!held.isDirectory() || held.isSymbolicLink()) return null;
      return { root: previous.root, dev: held.dev, ino: held.ino };
    } catch {
      return null;
    }
  }

  /** Re-verify the pinned previous snapshot: same directory identity. */
  private async previousSnapshotStillPinned(pinned: { root: string; dev: number; ino: number }): Promise<boolean> {
    try {
      const held = await lstat(pinned.root);
      return held.isDirectory() && !held.isSymbolicLink() && held.dev === pinned.dev && held.ino === pinned.ino;
    } catch {
      return false;
    }
  }

  /** Bounded, no-follow read of one file from the pinned private previous
   * snapshot; the bytes must hash to the live-observed value or the copy
   * fails closed. Never reads from a live source pathname. */
  private async readPreviousFile(root: string, filePath: string, cap: number, expectedHash: string, signal?: AbortSignal): Promise<Buffer> {
    const segments = filePath.split('/');
    for (const segment of segments) assertSourceComponent(segment);
    let directory = await openSourceDirectory(this.platform, root, signal);
    try {
      for (const segment of segments.slice(0, -1)) {
        const next = await this.platform.openChild(directory, segment, 'directory');
        try { await directory.close(); } catch (error) { await next.close(); throw error; }
        directory = next;
      }
      const file = await this.platform.openChild(directory, segments.at(-1)!, 'entry');
      try {
        const observed = await file.stat();
        if (!observed.isFile() || observed.nlink !== 1 || observed.size > cap) throw new Error('Previous snapshot file is missing or unsafe');
        const data = await readSourceBounded(file, cap, signal);
        if (!data || sha256(data) !== expectedHash) throw new Error('Previous snapshot bytes do not match the observed hash');
        return data;
      } finally { await file.close(); }
    } finally { await directory.close(); }
  }

  /** Bounded Git shallow-ledger reader; same ancestor/no-follow boundary as capture. */
  async readScopeSafeFile(root: string, path: string, maxBytes: number): Promise<string | undefined> {
    sourceLimit(maxBytes, 128 * 1024 * 1024, 'metadata bytes');
    const rel = relative(root, path);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Git metadata is outside authorized scope');
    const segments = rel.split(sep);
    let directory = await openSourceDirectory(this.platform, root);
    try {
      for (const segment of segments.slice(0, -1)) {
        assertSourceComponent(segment);
        const next = await this.platform.openChild(directory, segment, 'directory');
        try { await directory.close(); } catch (error) { await next.close(); throw error; }
        directory = next;
      }
      const name = segments.at(-1)!;
      assertSourceComponent(name);
      const file = await this.platform.openChild(directory, name, 'entry');
      try {
        const before = await file.stat();
        if (!before.isFile() || before.nlink !== 1 || before.size > maxBytes) throw new Error('Unsafe Git metadata file');
        const bytes = await readSourceBounded(file, maxBytes);
        const after = await file.stat();
        if (!bytes || !unchangedFile(before, after, bytes.length)) throw new Error('Git metadata changed or exceeded its cap');
        return bytes.toString('utf8');
      } finally { await file.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    } finally { await directory.close(); }
  }
}

/** Production selection fails closed when descriptor-relative support is absent. */
export async function captureSourceSnapshot(root: string, destination: string, signal?: AbortSignal, options: SnapshotOptions = {}): Promise<SourceSnapshot> {
  return new SourceAccess(sourcePlatform()).captureSourceSnapshot(root, destination, signal, options);
}
export async function readScopeSafeFile(root: string, path: string, maxBytes: number): Promise<string | undefined> {
  return new SourceAccess(sourcePlatform()).readScopeSafeFile(root, path, maxBytes);
}

export function relativeStorageExclusion(root: string, storageRoot: string): string[] {
  const rel = relative(root, storageRoot);
  if (!rel) throw new Error('Storage root cannot be the authorized source root');
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) ? [rel.split(sep).join('/')] : [];
}
