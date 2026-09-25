import fs, { type Stats } from 'node:fs';
import { lstat, mkdtemp, opendir, realpath, rename, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

const MAX_ENTRIES = 50_000, MAX_DEPTH = 66;
const generatedFile = /^(?:managed-parser|git|source-platform\.node|pi-fovea-(?:(?:cochange-)?[a-f0-9]{16}\.json|(?:focus|dwell|impact|sketch)-[a-f0-9]{8}\.txt|provenance-[a-f0-9]{16}-[a-f0-9]{16}\.json|scan-[1-9][0-9]*-[a-f0-9-]{36}\.yml)(?:\.tmp-[1-9][0-9]*-[a-f0-9-]{36})?)$/u;
const absent = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';
const privateNode = (s: Stats): boolean => typeof process.getuid === 'function' && s.uid === process.getuid() && (s.mode & 0o077) === 0 && !s.isSymbolicLink();
const sameDirectory = (a: Stats, b: Stats): boolean => privateNode(b) && b.isDirectory() && a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs && a.mode === b.mode && a.uid === b.uid && a.gid === b.gid;
const sameFile = (a: Stats, b: Stats): boolean => privateNode(b) && b.isFile() && b.nlink === 1 && a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs && a.mode === b.mode && a.uid === b.uid && a.gid === b.gid && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
interface Node { path: string; stat: Stats; children?: Node[] }

/** Only this instance's exclusively created private scratch may be reclaimed.
 * Preflight is bounded and retain-first; disposal unlinks captured regular files
 * and removes EMPTY directories, never recursive rm. This is lifetime/path
 * revalidation, not a kernel dirfd sandbox against a hostile same-UID process. */
export class FoveaScratchOwner {
  readonly #anchor: Stats;
  readonly #trees = new Map<string, Stats | undefined>();
  readonly #files = new Map<string, Stats>();
  readonly #maxEntries: number;
  readonly #maxDepth: number;
  #failure: unknown;
  #closed = false;
  #closing: Promise<void> | undefined;
  directory: string | undefined;
  constructor(readonly storageRoot: string, limits: { maxEntries?: number; maxDepth?: number } = {}) {
    if (!isAbsolute(storageRoot) || fs.realpathSync(storageRoot) !== storageRoot) throw new Error('Navigator scratch parent must be canonical');
    this.#anchor = fs.lstatSync(storageRoot);
    if (!privateNode(this.#anchor) || !this.#anchor.isDirectory()) throw new Error('Navigator scratch parent must be private and owned');
    this.#maxEntries = Math.min(MAX_ENTRIES, Math.max(1, limits.maxEntries ?? MAX_ENTRIES));
    this.#maxDepth = Math.min(MAX_DEPTH, Math.max(1, limits.maxDepth ?? MAX_DEPTH));
  }
  #admit(): void {
    if (this.#closed || this.#failure) throw new Error('Navigator scratch owner closed or cleanup uncertain', { cause: this.#failure });
  }
  async #parent(): Promise<void> {
    if (!sameDirectory(this.#anchor, await lstat(this.storageRoot)) || await realpath(this.storageRoot) !== this.storageRoot) throw new Error('Navigator scratch parent identity changed; retain evidence');
  }
  #below(file: string): void {
    if (!this.directory) throw new Error('Navigator scratch has no owned directory');
    const p = relative(this.directory, file);
    if (p === '..' || p.startsWith(`..${sep}`) || isAbsolute(p)) throw new Error('Navigator scratch path is outside its owner');
  }
  async #root(): Promise<void> {
    await this.#parent();
    if (!this.directory) throw new Error('Navigator scratch unavailable');
    const expected = this.#trees.get(this.directory);
    if (!expected || !sameDirectory(expected, await lstat(this.directory)) || await realpath(this.directory) !== this.directory) throw new Error('Navigator scratch identity changed; retain evidence');
  }
  async createRoot(signal?: AbortSignal): Promise<string> {
    this.#admit(); signal?.throwIfAborted(); await this.#parent(); signal?.throwIfAborted();
    if (this.directory) throw new Error('Navigator scratch already allocated');
    const directory = await mkdtemp(join(this.storageRoot, 'engine-'));
    this.directory = directory; this.#trees.set(directory, undefined); // Keep the path even if inspection fails.
    this.#trees.set(directory, await lstat(directory));
    await this.#root(); signal?.throwIfAborted(); return directory;
  }
  async createStage(signal?: AbortSignal): Promise<string> {
    this.#admit(); await this.#root(); signal?.throwIfAborted();
    const directory = await mkdtemp(join(this.directory!, 'snapshot-'));
    this.#trees.set(directory, undefined);
    this.#trees.set(directory, await lstat(directory));
    await this.#root(); signal?.throwIfAborted(); return directory;
  }
  async moveStage(from: string, to: string): Promise<void> {
    this.#admit(); this.#below(from); this.#below(to); await this.#root();
    const expected = this.#trees.get(from);
    if (!expected || dirname(from) !== this.directory || dirname(to) !== this.directory || !/^root-[a-f0-9-]{36}$/u.test(basename(to)) || !sameDirectory(expected, await lstat(from))) throw new Error('Navigator snapshot move lacks ownership');
    try { await lstat(to); throw new Error('Navigator snapshot destination exists; retain replacement'); } catch (error) { if (!absent(error)) throw error; }
    await rename(from, to);
    this.#trees.delete(from); this.#trees.set(to, expected); // Record before any further fallible await.
    if (!sameDirectory(expected, await lstat(to))) throw new Error('Navigator moved snapshot changed; retain evidence');
  }
  async captureFile(file: string): Promise<void> {
    this.#admit(); this.#below(file); await this.#root();
    if (dirname(file) !== this.directory || !generatedFile.test(basename(file))) throw new Error('Navigator generated file is outside its owned layout');
    const stat = await lstat(file);
    if (!privateNode(stat) || !stat.isFile() || stat.nlink !== 1) throw new Error('Navigator generated file identity unsafe');
    this.#files.set(file, stat);
  }
  async removeFile(file: string): Promise<void> {
    const expected = this.#files.get(file);
    if (!expected) throw new Error('Navigator temporary file is not owned');
    await this.removeTemporary(file, expected);
  }
  /** Live-instance housekeeping only; never scans another generation. */
  async removeTemporary(file: string, expected: Stats, available: () => boolean = () => true): Promise<boolean> {
    try {
      if (!available()) return false;
      this.#below(file); await this.#root();
      if (dirname(file) !== this.directory || !generatedFile.test(basename(file))) throw new Error('Navigator temporary file is outside its owned layout');
      await this.#names(this.directory!);
      let current: Stats;
      try { current = await lstat(file); } catch (error) {
        if (!absent(error)) throw error;
        if (this.#files.has(file)) throw new Error('Navigator captured file disappeared; cleanup unconfirmed', { cause: error });
        return false; // Unregistered atomic staging may already have been renamed.
      }
      if (!available()) return false;
      const captured = this.#files.get(file);
      if (captured && !sameFile(captured, current)) throw new Error('Navigator captured file changed; retain replacement');
      if (!privateNode(current) || !current.isFile() || current.nlink !== 1) throw new Error('Navigator temporary identity unsafe; retain evidence');
      if (!sameFile(expected, current)) return false; // A cache producer replaced its candidate.
      await unlink(file); this.#files.delete(file); return true;
    } catch (error) { this.#failure ??= error; throw error; }
  }
  async #names(directory: string, visit?: () => void): Promise<string[]> {
    const names: string[] = [];
    const stream = await opendir(directory);
    for await (const entry of stream) {
      if (names.length >= this.#maxEntries) throw new Error('Navigator scratch inspection entry bound; retain tree');
      if (entry.name.toLowerCase() === '.git') throw new Error('Navigator scratch contains Git metadata; retain tree');
      visit?.(); names.push(entry.name);
    }
    if (names.includes('HEAD') && names.includes('objects')) throw new Error('Navigator scratch contains a bare repository; retain tree');
    return names.sort();
  }
  async removeTree(directory: string): Promise<void> {
    try { await this.#removeTree(directory); }
    catch (error) { this.#failure ??= error; throw error; }
  }
  async #removeTree(directory: string): Promise<void> {
    this.#below(directory); await this.#parent();
    let stat: Stats;
    try { stat = await lstat(directory); } catch (error) { if (!absent(error)) throw error; if (this.#trees.has(directory)) throw new Error('Navigator owned scratch disappeared; cleanup unconfirmed', { cause: error }); return; }
    await this.#root();
    if (directory !== this.directory) await this.#names(this.directory!);
    const expected = this.#trees.get(directory);
    if (!expected || !sameDirectory(expected, stat)) throw new Error('Navigator scratch tree identity unavailable/changed; retain tree');
    let inspected = 1;
    const seen = new Set<string>();
    const scan = async (file: string, depth: number): Promise<Node> => {
      if (depth > this.#maxDepth) throw new Error('Navigator scratch inspection bound; retain tree');
      const s = await lstat(file);
      if (!privateNode(s) || (!s.isDirectory() && (!s.isFile() || s.nlink !== 1))) throw new Error('Navigator scratch contains unsafe identity/type/link; retain tree');
      seen.add(file);
      const captured = this.#files.get(file);
      if (captured && !sameFile(captured, s)) throw new Error('Navigator captured file changed; retain tree');
      const held = this.#trees.get(file);
      if (this.#trees.has(file) && (!held || !sameDirectory(held, s))) throw new Error('Navigator owned subtree was replaced; retain tree');
      if (s.isDirectory() && file !== this.directory && dirname(file) === this.directory && !this.#trees.has(file)) throw new Error('Navigator unowned top-level directory; retain tree');
      const node: Node = { path: file, stat: s };
      if (s.isDirectory()) {
        node.children = [];
        for (const name of await this.#names(file, () => { if (++inspected > this.#maxEntries) throw new Error('Navigator scratch inspection entry bound; retain tree'); })) {
          const next = join(file, name);
          if (file === this.directory && !this.#trees.has(next) && !generatedFile.test(name)) throw new Error('Navigator scratch contains unknown top-level content; retain tree');
          node.children.push(await scan(next, depth + 1));
        }
      }
      return node;
    };
    const tree = await scan(directory, 0); // Complete retain-first preflight before ANY deletion.
    for (const claimed of [...this.#trees.keys(), ...this.#files.keys()]) {
      const p = relative(directory, claimed);
      if (p !== '..' && !p.startsWith(`..${sep}`) && !isAbsolute(p) && !seen.has(claimed)) throw new Error('Navigator owned scratch disappeared; retain remaining evidence');
    }
    const check = async (node: Node): Promise<void> => {
      const current = await lstat(node.path);
      if (node.children ? !sameDirectory(node.stat, current) : !sameFile(node.stat, current)) throw new Error('Navigator scratch changed during cleanup; retain remainder');
    };
    const remove = async (node: Node, parents: Node[]): Promise<void> => {
      await this.#root(); if (directory !== this.directory) await this.#names(this.directory!); for (const parent of parents) await check(parent); await check(node);
      if (node.children) {
        const names = await this.#names(node.path);
        if (names.join('\0') !== node.children.map(child => basename(child.path)).join('\0')) throw new Error('Navigator scratch membership changed; retain remainder');
        for (const child of node.children) await remove(child, [...parents, node]);
        await this.#root(); for (const parent of parents) await check(parent); await check(node);
        await rmdir(node.path); // Empty only. A new entry is preserved, never recursively traversed.
        this.#trees.delete(node.path);
      } else { await unlink(node.path); this.#files.delete(node.path); }
    };
    await remove(tree, []);
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#closing = Promise.resolve().then(async () => {
      const failures: unknown[] = this.#failure === undefined ? [] : [this.#failure];
      try { if (this.directory) await this.removeTree(this.directory); } catch (error) { if (!failures.includes(error)) failures.push(error); }
      if (this.#failure !== undefined && !failures.includes(this.#failure)) failures.unshift(this.#failure);
      if (failures.length) throw new AggregateError(failures, 'Navigator scratch cleanup uncertainty retained', { cause: failures[0] });
    });
    return this.#closing;
  }
}
