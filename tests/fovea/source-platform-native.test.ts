import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { chmod, link, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { SourceAccess } from '../../src/fovea/source-access.js';
import { openSourceDirectory, sourcePlatform, type SourcePlatform } from '../../src/fovea/source-platform.js';
import {
  createNativeDarwinSourceBinding, createNativeSourcePlatform,
  type NativeSourceToken, type PosixSourceBinding,
} from '../../src/fovea/source-platform-native.js';

const dirs: string[] = [];
let artifact = '', compiled = '', native: PosixSourceBinding;
const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const fdCount = () => readdirSync('/proc/self/fd').length;
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'fovea-posix-native-'))); dirs.push(base);
  const root = join(base, 'source'), outside = join(base, 'outside'), destination = join(base, 'snapshot');
  for (const path of [root, outside, destination]) await mkdir(path, { mode: 0o700 });
  return { base, root, outside, destination };
}
async function nativeDirectory(path: string): Promise<NativeSourceToken> {
  let directory = await native.openRoot();
  try {
    for (const part of path.split('/').filter(Boolean)) {
      const next = await native.openAt(directory, part, 'directory');
      await native.close(directory); directory = next;
    }
    return directory;
  } catch (error) { await native.close(directory); throw error; }
}

// Credential-free fixture compilation, NOT production build/packaging. The
// compiler is a test tool; no runtime factory consults PATH or accepts a path.
// Missing compiler/headers fail this prerequisite explicitly, never fake a pass.
describe.skipIf(!['linux', 'darwin'].includes(process.platform))('compiled POSIX source binding', () => {
  beforeAll(async () => {
    const headers = [resolve(dirname(realpathSync(process.execPath)), '../include/node'), '/usr/include/node', '/usr/local/include/node']
      .find(path => existsSync(join(path, 'node_api.h')));
    expect(headers, 'Local Node headers required; no downloads in this test').toBeDefined();
    await mkdir('.tmp', { recursive: true });
    artifact = await mkdtemp(resolve('.tmp/source-platform-native-'));
    await chmod(artifact, 0o700); compiled = join(artifact, 'source-platform.node');
    const flags = process.platform === 'darwin' ? ['-bundle', '-undefined', 'dynamic_lookup'] : ['-shared'];
    const result = spawnSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-fPIC', '-D_FILE_OFFSET_BITS=64', ...flags,
      `-I${headers!}`, resolve('src/fovea/source-platform-native.c'), '-o', compiled], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
    expect(result.error, `Native compiler spawn failed: ${String(result.error)}`).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    native = createRequire(import.meta.url)(compiled) as PosixSourceBinding;
  });
  afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
  afterAll(async () => { if (artifact) await rm(artifact, { recursive: true, force: true }); });

  it('exports the compiled platform and opaque handles, without a production loader override', async () => {
    expect(native.abiVersion).toBe(1); expect(native.platform).toBe(process.platform);
    const root = await native.openRoot();
    expect(Object.keys(root)).toEqual([]);
    expect((root as unknown as { fd?: number }).fd).toBeUndefined();
    await native.close(root);
    if (process.platform === 'linux') expect(() => createNativeDarwinSourceBinding(native)).toThrow('not compiled for Darwin');
    expect(() => sourcePlatform('darwin')).toThrow('missing trusted native');
    const mismatched = { ...native, platform: 'other' } as unknown as PosixSourceBinding;
    expect(() => createNativeSourcePlatform(mismatched)).toThrow('invalid or foreign');
  });

  it('captures exact bytes, relative identities and permissions with matching metadata reads', async () => {
    const { root, destination, base } = await fixture();
    await mkdir(join(root, 'nested'));
    const binary = Buffer.from([255, 254, 0, 10]);
    await writeFile(join(root, 'nested', 'bytes.ts'), binary, { mode: 0o640 });
    await chmod(join(root, 'nested', 'bytes.ts'), 0o640);
    await writeFile(join(root, 'a.ts'), 'export const a = 1;');
    await mkdir(join(root, '.git')); await writeFile(join(root, '.git', 'shallow'), 'abc\n');
    const platform = createNativeSourcePlatform(native), access = new SourceAccess(platform);
    const shot = await access.captureSourceSnapshot(root, destination);
    expect([...shot.hashes.keys()]).toEqual(['a.ts', 'nested/bytes.ts']);
    expect(shot.hashes.get('nested/bytes.ts')).toBe(hash(binary));
    expect(shot.id).toBe(hash([...shot.hashes].map(pair => JSON.stringify(pair) + '\n').join('')));
    expect(await readFile(join(destination, 'nested', 'bytes.ts'))).toEqual(binary);
    expect((await stat(join(destination, 'nested', 'bytes.ts'))).mode & 0o777).toBe(0o400);
    expect((await stat(join(destination, 'nested'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, 'nested', 'bytes.ts'))).mode & 0o777).toBe(0o640);
    expect(await access.readScopeSafeFile(root, join(root, '.git', 'shallow'), 4)).toBe('abc\n');
    if (process.platform === 'linux') {
      const reference = await new SourceAccess(sourcePlatform()).captureSourceSnapshot(root, join(base, 'reference'));
      expect(shot.hashes).toEqual(reference.hashes); expect(shot.id).toBe(reference.id); expect(shot.coverage).toEqual(reference.coverage);
    }
  });

  it('preserves rules, exclusions, file/byte budgets and coverage with the actual binding', async () => {
    const { root, destination, outside, base } = await fixture();
    await mkdir(join(root, '.fovea'));
    const rules = JSON.stringify({ fileRoutes: [{ re: '\\.custom$' }] });
    await writeFile(join(root, '.fovea', 'rules.json'), rules); await writeFile(join(root, '.fovea', 'private.ts'), 'secret');
    await writeFile(join(root, 'a.custom'), 'custom'); await writeFile(join(root, 'b.ts'), 'source');
    for (const name of ['node_modules', 'nested']) { await mkdir(join(root, name)); await writeFile(join(root, name, 'secret.ts'), 'secret'); }
    await writeFile(join(root, 'nested', '.git'), 'gitdir: elsewhere');
    await writeFile(join(root, '.env'), 'secret'); await writeFile(join(outside, 'secret.ts'), 'secret');
    await symlink(outside, join(root, 'escape')); await symlink(join(outside, 'secret.ts'), join(root, 'link.ts'));
    await link(join(outside, 'secret.ts'), join(root, 'hard.ts'));
    await writeFile(join(root, 'oversized.ts'), Buffer.alloc(1024 * 1024 + 1));
    const access = new SourceAccess(createNativeSourcePlatform(native));
    const shot = await access.captureSourceSnapshot(root, destination, undefined, { trustedRulesSha256: hash(rules) });
    expect([...shot.hashes.keys()]).toEqual(['.fovea/rules.json', 'a.custom', 'b.ts']);
    expect(shot.coverage.counts).toMatchObject({ closedBoundaries: 1, excluded: 2, hardlinks: 1, unavailableOrSymlink: 2, oversized: 1, untrustedProjectRules: 1 });
    const capped = await access.captureSourceSnapshot(root, join(base, 'capped'), undefined, { maxFiles: 1 });
    expect(capped.hashes.size).toBe(1); expect(capped.coverage.capped).toBe(true);
    const bytes = await access.captureSourceSnapshot(root, join(base, 'bytes'), undefined, { maxBytes: 1 });
    expect(bytes.hashes.size).toBe(0); expect(bytes.coverage.capped).toBe(true);
    await writeFile(join(root, '.fovea', 'rules.json'), rules + ' ');
    await expect(access.captureSourceSnapshot(root, join(base, 'stale'), undefined, { trustedRulesSha256: hash(rules) })).rejects.toThrow('SHA-256 mismatch');
  });

  it.each(['before-root', 'held-root', 'held-nested'])('uses openat rather than reconstructed paths during %s replacement', async when => {
    const { root, destination, outside, base } = await fixture();
    await mkdir(join(root, 'nested')); await writeFile(join(root, 'nested', 'safe.ts'), 'inside');
    await writeFile(join(outside, 'secret.ts'), 'outside');
    const backend = createNativeSourcePlatform(native); let swapped = false;
    const swap = async (path: string) => { await rename(path, join(base, 'held')); await symlink(outside, path); swapped = true; };
    const platform: SourcePlatform = { ...backend, async openChild(parent, name, kind) {
      if (!swapped && when === 'before-root' && name === 'source' && kind === 'directory') await swap(root);
      const handle = await backend.openChild(parent, name, kind);
      if (!swapped && when === 'held-root' && name === 'source' && kind === 'directory') await swap(root);
      if (!swapped && when === 'held-nested' && name === 'nested') await swap(join(root, 'nested'));
      return handle;
    } };
    const pending = new SourceAccess(platform).captureSourceSnapshot(root, destination);
    if (when === 'before-root') await expect(pending).rejects.toThrow();
    else expect([...(await pending).hashes.keys()]).toEqual(['nested/safe.ts']);
    expect(swapped).toBe(true);
    await expect(readFile(join(destination, 'secret.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not follow swapped metadata ancestry or leaf symlinks', async () => {
    const { root, outside, base, destination } = await fixture();
    await mkdir(join(root, '.git')); await writeFile(join(root, '.git', 'shallow'), 'inside');
    await writeFile(join(outside, 'shallow'), 'outside'); await writeFile(join(root, 'victim.ts'), 'inside');
    const backend = createNativeSourcePlatform(native);
    const platform: SourcePlatform = { ...backend, async openChild(parent, name, kind) {
      if (name === 'victim.ts') { await rm(join(root, name)); await symlink(join(outside, 'shallow'), join(root, name)); }
      const handle = await backend.openChild(parent, name, kind);
      if (name === '.git') { await rename(join(root, '.git'), join(base, 'held')); await symlink(outside, join(root, '.git')); }
      return handle;
    } };
    const access = new SourceAccess(platform);
    expect(await access.readScopeSafeFile(root, join(root, '.git', 'shallow'), 32)).toBe('inside');
    const shot = await access.captureSourceSnapshot(root, destination);
    expect(shot.hashes.size).toBe(0); expect(shot.coverage.counts).toMatchObject({ unavailableOrSymlink: 1 });
  });

  it.skipIf(process.getuid?.() === 0)('obeys kernel permission denial without chmod or fallback', async () => {
    const { root, destination } = await fixture(); const denied = join(root, 'denied.ts');
    await writeFile(denied, 'secret'); await chmod(denied, 0);
    try {
      const access = new SourceAccess(createNativeSourcePlatform(native));
      const shot = await access.captureSourceSnapshot(root, destination);
      expect(shot.hashes.size).toBe(0); expect(shot.coverage.counts).toMatchObject({ unavailableOrSymlink: 1 });
      await expect(access.readScopeSafeFile(root, denied, 64)).rejects.toMatchObject({ code: 'EACCES' });
      expect((await stat(denied)).mode & 0o777).toBe(0);
    } finally { await chmod(denied, 0o600); }
  });

  it('opens FIFOs nonblocking but never reads a nonregular object', async () => {
    const { root, destination } = await fixture();
    const result = spawnSync('mkfifo', [join(root, 'pipe.ts')], { encoding: 'utf8', timeout: 10_000 });
    expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(0);
    const shot = await new SourceAccess(createNativeSourcePlatform(native)).captureSourceSnapshot(root, destination);
    expect(shot.coverage.counts).toMatchObject({ notRegular: 1 }); expect(shot.hashes.size).toBe(0);
    const parent = await nativeDirectory(root), pipe = await native.openAt(parent, 'pipe.ts', 'entry');
    try { await expect(native.read(pipe, 1)).rejects.toMatchObject({ code: 'EPERM' }); }
    finally { await native.close(pipe); await native.close(parent); }
  });

  it.each(['', '.', '..', '/', 'a/b', 'x\0y', '\ud800', '\udc00', 'x'.repeat(256)])('rejects invalid native component %j before openat', async name => {
    const root = await native.openRoot();
    try { await expect(native.openAt(root, name, 'entry')).rejects.toMatchObject({ code: 'EINVAL' }); }
    finally { await native.close(root); }
  });

  it('preserves valid Unicode spelling and rejects invalid UTF-8 directory names', async () => {
    const { root, destination } = await fixture();
    const name = 'source-😀-e\u0301.ts'; await writeFile(join(root, name), 'source');
    const access = new SourceAccess(createNativeSourcePlatform(native));
    expect([...(await access.captureSourceSnapshot(root, destination)).hashes.keys()]).toEqual([name]);
    const parent = await nativeDirectory(root);
    const handle = await native.openAt(parent, name, 'entry'); await native.close(handle);
    if (process.platform === 'linux') {
      await writeFile(Buffer.concat([Buffer.from(root + '/'), Buffer.from([255]), Buffer.from('.ts')]), 'unrepresentable');
      const stream = await native.openDirectory(parent);
      try { await expect(native.readDirectory(stream)).rejects.toMatchObject({ code: 'EILSEQ' }); }
      finally { await native.closeDirectory(stream); }
    }
    await native.close(parent);
  });

  it('bounds native reads and validates JS buffer ranges without borrowing JS pointers', async () => {
    const { root } = await fixture(); await writeFile(join(root, 'a.ts'), Buffer.alloc(70_000, 255));
    const directory = await nativeDirectory(root), file = await native.openAt(directory, 'a.ts', 'entry');
    try {
      for (const length of [-1, 65_537, NaN, Infinity, 1.5]) await expect(native.read(file, length)).rejects.toMatchObject({ code: 'EINVAL' });
      expect(await native.read(file, 65_536)).toEqual(Buffer.alloc(65_536, 255));
      expect((await native.read(file, 65_536)).length).toBe(4_464); expect((await native.read(file, 1)).length).toBe(0);
    } finally { await native.close(file); await native.close(directory); }
    const platform = createNativeSourcePlatform(native), dir = await openSourceDirectory(platform, root);
    const handle = await platform.openChild(dir, 'a.ts', 'entry');
    try {
      await expect(handle.read(Buffer.alloc(4), 3, 2, null)).rejects.toThrow('bounds');
      const buffer = Buffer.alloc(5); expect(await handle.read(buffer, 1, 3, null)).toEqual({ bytesRead: 3 });
      expect(buffer).toEqual(Buffer.from([0, 255, 255, 255, 0]));
    } finally { await handle.close(); await dir.close(); }
  });

  it('rejects forged, wrong-kind and closed capabilities; busy close cannot recycle an in-flight descriptor', async () => {
    await expect(native.stat({} as NativeSourceToken)).rejects.toMatchObject({ code: 'EBADF' });
    const root = await native.openRoot();
    const pending = native.stat(root), denied = native.close(root);
    await expect(denied).rejects.toMatchObject({ code: 'EBUSY' }); expect((await pending).mode).toBeTypeOf('number');
    const stream = await native.openDirectory(root);
    await expect(native.stat(stream)).rejects.toMatchObject({ code: 'EBADF' });
    await expect(native.close(stream)).rejects.toMatchObject({ code: 'EBADF' });
    await expect(native.readDirectory(root)).rejects.toMatchObject({ code: 'EBADF' });
    await native.close(root);
    expect(Array.isArray(await native.readDirectory(stream))).toBe(true); // Own description, parent may close.
    await native.closeDirectory(stream);
    const replacement = await native.openRoot();
    await expect(native.stat(root)).rejects.toMatchObject({ code: 'EBADF' });
    await expect(native.close(root)).rejects.toMatchObject({ code: 'EBADF' });
    await expect(native.readDirectory(stream)).rejects.toMatchObject({ code: 'EBADF' });
    await native.close(replacement);
  });

  it('permits wrapper close retry after EBUSY and makes completed close idempotent', async () => {
    const platform = createNativeSourcePlatform(native), root = await platform.openRootDirectory();
    const pending = root.stat();
    await expect(root.close()).rejects.toMatchObject({ code: 'EBUSY' });
    await pending; await root.close(); await root.close();
    await expect(root.stat()).rejects.toMatchObject({ code: 'EBADF' });
  });

  it('rejects malformed native open kinds rather than truncating them', async () => {
    const root = await native.openRoot();
    try {
      for (const kind of ['entry\0extra', 'directory-extra', '', 'entry'.repeat(100)]) {
        await expect(native.openAt(root, 'tmp', kind as 'entry')).rejects.toMatchObject({ code: 'EINVAL' });
      }
    } finally { await native.close(root); }
  });

  it('gives each directory iterator an independent offset and <=128-name batches', async () => {
    const { root } = await fixture();
    for (let i = 0; i < 300; i++) await writeFile(join(root, `entry-${i}.ts`), '');
    const parent = await nativeDirectory(root), a = await native.openDirectory(parent), b = await native.openDirectory(parent);
    try {
      const first = await native.readDirectory(a); expect(first).toHaveLength(128);
      expect(await native.readDirectory(b)).toEqual(first);
      const second = await native.readDirectory(a), last = await native.readDirectory(a);
      expect(second).toHaveLength(128); expect(last).toHaveLength(44); expect(await native.readDirectory(a)).toEqual([]);
      expect(new Set([...first, ...second, ...last]).size).toBe(300);
    } finally { await native.closeDirectory(a); await native.closeDirectory(b); await native.close(parent); }
  });

  it('closes all capture descriptors when abort arrives after the native read', async () => {
    const { root, destination } = await fixture(); await writeFile(join(root, 'a.ts'), 'abc');
    const controller = new AbortController(), before = process.platform === 'linux' ? fdCount() : 0;
    const instrumented: PosixSourceBinding = { ...native, async read(handle, length) {
      const bytes = await native.read(handle, length); controller.abort(new Error('cancel-native')); return bytes;
    } };
    await expect(new SourceAccess(createNativeSourcePlatform(instrumented)).captureSourceSnapshot(root, destination, controller.signal)).rejects.toThrow('cancel-native');
    await expect(readFile(join(destination, 'a.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
    if (process.platform === 'linux') expect(fdCount()).toBe(before);
  });

  it.skipIf(process.platform !== 'linux')('does not leak descriptors across early iterator returns or rejected opens', async () => {
    const { root } = await fixture(); await writeFile(join(root, 'a.ts'), 'abc'); await symlink('/etc/passwd', join(root, 'link.ts'));
    const platform = createNativeSourcePlatform(native), parent = await openSourceDirectory(platform, root), before = fdCount();
    try {
      for (let i = 0; i < 40; i++) {
        for await (const name of platform.entries(parent)) { expect(name).toBeTypeOf('string'); break; }
        await expect(platform.openChild(parent, 'link.ts', 'entry')).rejects.toMatchObject({ code: 'ELOOP' });
      }
      expect(fdCount()).toBe(before);
    } finally { await parent.close(); }
  });

  it.skipIf(process.platform !== 'linux')('finalizes still-held capabilities when a Node worker is terminated', async () => {
    const warm = new Worker('const {parentPort}=require("node:worker_threads"); parentPort.postMessage("ready"); setInterval(()=>{},1000);', { eval: true });
    await once(warm, 'message'); await warm.terminate();
    const before = fdCount();
    const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads'); const n=require(workerData);
      (async()=>{globalThis.held=await Promise.all(Array.from({length:32},()=>n.openRoot())); parentPort.postMessage('ready'); setInterval(()=>{},1000);})().catch(e=>{throw e;});`,
    { eval: true, workerData: compiled });
    try { expect(await once(worker, 'message')).toEqual(['ready']); }
    finally { await worker.terminate(); }
    expect(fdCount()).toBe(before);
  });
});
