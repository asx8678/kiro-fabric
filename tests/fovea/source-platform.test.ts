import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { chmod, link, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceAccess, captureSourceSnapshot, readScopeSafeFile, relativeStorageExclusion } from '../../src/fovea/source-access.js';
import { sourcePlatform, type SourcePlatform } from '../../src/fovea/source-platform.js';
import { createDarwinSourcePlatform } from '../../src/fovea/source-platform-darwin.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const sha = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'fovea-source-platform-'))); dirs.push(base);
  const root = join(base, 'source'), destination = join(base, 'snapshot'), outside = join(base, 'outside');
  for (const path of [root, destination, outside]) await mkdir(path, { mode: 0o700 });
  return { base, root, destination, outside };
}

// This is explicitly a CONTRACT bridge using Linux syscalls, not a Darwin
// implementation, permission emulation, or native macOS acceptance evidence.
function platform(kind: string): SourcePlatform {
  const linux = sourcePlatform('linux');
  return kind === 'linux' ? linux : createDarwinSourcePlatform({
    abiVersion: 1, platform: 'darwin',
    openRootDirectory: () => linux.openRootDirectory(),
    openAt: (directory, name, mode) => linux.openChild(directory, name, mode),
    readDirectory(directory, batchSize) {
      expect(batchSize).toBe(128);
      return linux.entries(directory);
    },
  });
}

describe.skipIf(process.platform !== 'linux').each(['linux', 'darwin-contract-on-linux'])('%s scope-safe source policy', kind => {
  it('binds exact bytes, relative names and ordered snapshot SHA; preserves private staging and source modes', async () => {
    const { root, destination } = await fixture();
    await mkdir(join(root, 'nested'));
    const data = Buffer.from([0xff, 0xfe, 0x61, 0x0a]);
    await writeFile(join(root, 'nested', 'bytes.ts'), data, { mode: 0o640 });
    await writeFile(join(root, 'a.ts'), 'export const a = 1;');
    await chmod(join(root, 'nested', 'bytes.ts'), 0o640);
    const access = new SourceAccess(platform(kind));
    const shot = await access.captureSourceSnapshot(root, destination);
    expect([...shot.hashes]).toEqual([['a.ts', sha('export const a = 1;')], ['nested/bytes.ts', sha(data)]]);
    expect(shot.id).toBe(sha([...shot.hashes].map(pair => JSON.stringify(pair) + '\n').join('')));
    expect(await readFile(join(destination, 'nested', 'bytes.ts'))).toEqual(data);
    expect((await stat(join(destination, 'nested'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(destination, 'nested', 'bytes.ts'))).mode & 0o777).toBe(0o400);
    expect((await stat(join(root, 'nested', 'bytes.ts'))).mode & 0o777).toBe(0o640);
    await writeFile(join(root, 'nested', 'bytes.ts'), Buffer.from([0, 0, 0, 0]));
    expect(await readFile(join(destination, 'nested', 'bytes.ts'))).toEqual(data);
    await expect(access.captureSourceSnapshot(root, destination)).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('excludes credentials, dependencies, storage, untrusted rules, hardlinks, symlinks and nested repositories', async () => {
    const { root, destination, outside } = await fixture();
    await writeFile(join(root, 'safe.ts'), 'safe');
    await writeFile(join(outside, 'secret.ts'), 'never copy');
    for (const name of ['node_modules', '.ssh', '.fovea', 'private', 'nested', 'linked-marker']) {
      await mkdir(join(root, name)); await writeFile(join(root, name, 'secret.ts'), 'never copy');
    }
    await writeFile(join(root, 'nested', '.git'), 'gitdir: external');
    await symlink(join(outside, 'absent'), join(root, 'linked-marker', '.git'));
    for (const name of ['.env', '.env.local', '.npmrc', '.netrc', 'pnpm-lock.yaml']) await writeFile(join(root, name), 'secret');
    await symlink(outside, join(root, 'escape-dir'));
    await symlink(join(outside, 'secret.ts'), join(root, 'escape.ts'));
    await link(join(outside, 'secret.ts'), join(root, 'hardlink.ts'));
    await writeFile(join(root, 'note.txt'), 'not source');
    const shot = await new SourceAccess(platform(kind)).captureSourceSnapshot(root, destination, undefined, { exclude: ['private'] });
    expect([...shot.hashes.keys()]).toEqual(['safe.ts']);
    expect(shot.coverage.counts).toMatchObject({ excluded: 8, untrustedProjectRules: 1, closedBoundaries: 2, unavailableOrSymlink: 2, hardlinks: 1, unsupported: 1 });
    expect(relativeStorageExclusion(root, join(root, 'private'))).toEqual(['private']);
    expect(relativeStorageExclusion(root, outside)).toEqual([]);
    expect(() => relativeStorageExclusion(root, root)).toThrow('authorized source root');
  });

  it.skipIf(process.getuid?.() === 0)('honors actual kernel access denial without chmod or privilege fallback', async () => {
    const { root, destination } = await fixture();
    const denied = join(root, 'denied.ts'), directory = join(root, 'closed');
    await writeFile(denied, 'private'); await mkdir(directory); await writeFile(join(directory, 'secret.ts'), 'private');
    await chmod(denied, 0); await chmod(directory, 0);
    try {
      const access = new SourceAccess(platform(kind));
      const shot = await access.captureSourceSnapshot(root, destination);
      expect(shot.hashes.size).toBe(0); expect(shot.coverage.counts).toMatchObject({ unavailableOrSymlink: 2 });
      expect((await stat(denied)).mode & 0o777).toBe(0);
      await expect(access.readScopeSafeFile(root, denied, 32)).rejects.toMatchObject({ code: 'EACCES' });
    } finally { await chmod(denied, 0o600); await chmod(directory, 0o700); }
  });

  it('only admits project rules at the independently approved exact hash, before custom file routes', async () => {
    const { root, destination, base } = await fixture();
    await mkdir(join(root, '.fovea'));
    const rules = JSON.stringify({ fileRoutes: [{ re: '\\.custom$' }] });
    await writeFile(join(root, '.fovea', 'rules.json'), rules);
    await writeFile(join(root, '.fovea', 'secret.ts'), 'not approved');
    await writeFile(join(root, 'a.custom'), 'custom route');
    const access = new SourceAccess(platform(kind));
    const shot = await access.captureSourceSnapshot(root, destination, undefined, { trustedRulesSha256: sha(rules) });
    expect([...shot.hashes.keys()]).toEqual(['.fovea/rules.json', 'a.custom']);
    expect(shot.coverage).toMatchObject({ projectRules: 'host-approved-hash', trustedRulesSha256: sha(rules), counts: { untrustedProjectRules: 1 } });
    await writeFile(join(root, '.fovea', 'rules.json'), rules + ' ');
    await expect(access.captureSourceSnapshot(root, join(base, 'mismatch'), undefined, { trustedRulesSha256: sha(rules) })).rejects.toThrow('SHA-256 mismatch');
    await rm(join(root, '.fovea'), { recursive: true });
    await expect(access.captureSourceSnapshot(root, join(base, 'missing'), undefined, { trustedRulesSha256: sha(rules) })).rejects.toThrow('missing or unavailable');
  });

  it('honors file/aggregate budgets and the distinct code/protocol byte ceilings', async () => {
    const { root, destination, base } = await fixture();
    const access = new SourceAccess(platform(kind));
    await writeFile(join(root, 'a.ts'), '1234'); await writeFile(join(root, 'b.ts'), '5678');
    await writeFile(join(root, 'large.ts'), Buffer.alloc(1024 * 1024 + 1));
    await writeFile(join(root, 'schema.proto'), Buffer.alloc(1024 * 1024 + 1));
    await writeFile(join(root, 'huge.proto'), Buffer.alloc(8 * 1024 * 1024 + 1));
    const shot = await access.captureSourceSnapshot(root, destination);
    expect([...shot.hashes.keys()]).toEqual(['a.ts', 'b.ts', 'schema.proto']);
    expect(shot.coverage.counts).toMatchObject({ oversized: 2 });
    const capped = await access.captureSourceSnapshot(root, join(base, 'bytes'), undefined, { maxBytes: 6, maxFileBytes: 8 });
    expect([...capped.hashes.keys()]).toEqual(['a.ts']);
    expect(capped.coverage).toMatchObject({ capped: true, sourceBytes: 4, counts: { byteCap: 1, oversized: 3 } });
    const one = await access.captureSourceSnapshot(root, join(base, 'one'), undefined, { maxFiles: 1 });
    expect([...one.hashes.keys()]).toEqual(['a.ts']); expect(one.coverage.capped).toBe(true);
    const zero = await access.captureSourceSnapshot(root, join(base, 'zero'), undefined, { maxBytes: 0 });
    expect(zero.hashes.size).toBe(0); expect(zero.coverage.capped).toBe(true);
  });

  it('rejects canonical-root aliases and aborts before source access', async () => {
    const { root, destination, base } = await fixture();
    const access = new SourceAccess(platform(kind));
    await symlink(root, join(base, 'alias'));
    for (const path of [join(base, 'alias'), root + '/.', root + '/..', 'relative']) {
      await expect(access.captureSourceSnapshot(path, destination)).rejects.toThrow('canonical');
    }
    await expect(access.captureSourceSnapshot(root, destination, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled');
  });

  it('fails closed when a root ancestor becomes a symlink after canonical validation', async () => {
    const { root, destination, outside, base } = await fixture();
    await writeFile(join(outside, 'secret.ts'), 'outside');
    const backend = platform(kind);
    let swapped = false;
    const access = new SourceAccess({ ...backend, async openChild(directory, name, mode) {
      if (name === 'source' && mode === 'directory') {
        await rename(root, join(base, 'held')); await symlink(outside, root); swapped = true;
      }
      return backend.openChild(directory, name, mode);
    } });
    await expect(access.captureSourceSnapshot(root, destination)).rejects.toThrow();
    expect(swapped).toBe(true);
    await expect(readFile(join(destination, 'secret.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['root', 'nested'])('keeps the held %s directory when its pathname is replaced by an outside symlink', async where => {
    const { root, destination, outside, base } = await fixture();
    await mkdir(join(root, 'nested')); await writeFile(join(root, 'nested', 'safe.ts'), 'inside');
    await writeFile(join(outside, 'secret.ts'), 'outside');
    const backend = platform(kind);
    let swapped = false;
    const access = new SourceAccess({ ...backend, async openChild(directory, name, mode) {
      const handle = await backend.openChild(directory, name, mode);
      if (!swapped && ((where === 'root' && name === 'source' && mode === 'directory') || (where === 'nested' && name === 'nested'))) {
        const target = where === 'root' ? root : join(root, 'nested');
        await rename(target, join(base, 'held')); await symlink(outside, target); swapped = true;
      }
      return handle;
    } });
    const shot = await access.captureSourceSnapshot(root, destination);
    expect(swapped).toBe(true); expect([...shot.hashes.keys()]).toEqual(['nested/safe.ts']);
    expect(await readFile(join(destination, 'nested', 'safe.ts'), 'utf8')).toBe('inside');
  });

  it('does not follow a leaf swapped to a symlink after enumeration', async () => {
    const { root, destination, outside } = await fixture();
    await writeFile(join(root, 'victim.ts'), 'inside'); await writeFile(join(outside, 'secret.ts'), 'outside');
    const backend = platform(kind);
    const access = new SourceAccess({ ...backend, async openChild(directory, name, mode) {
      if (name === 'victim.ts') { await rm(join(root, name)); await symlink(join(outside, 'secret.ts'), join(root, name)); }
      return backend.openChild(directory, name, mode);
    } });
    const shot = await access.captureSourceSnapshot(root, destination);
    expect(shot.hashes.size).toBe(0); expect(shot.coverage.counts).toMatchObject({ unavailableOrSymlink: 1 });
  });

  it('bounds in-scope metadata and rejects directory/leaf links, hardlinks and outside paths', async () => {
    const { root, outside } = await fixture();
    await mkdir(join(root, '.git')); await writeFile(join(root, '.git', 'shallow'), 'abcd');
    const access = new SourceAccess(platform(kind));
    expect(await access.readScopeSafeFile(root, join(root, '.git', 'shallow'), 4)).toBe('abcd');
    expect(await access.readScopeSafeFile(root, join(root, '.git', 'absent'), 4)).toBeUndefined();
    await expect(access.readScopeSafeFile(root, join(root, '.git', 'shallow'), 3)).rejects.toThrow('Unsafe');
    await expect(access.readScopeSafeFile(root, outside, 4)).rejects.toThrow('outside authorized scope');
    await expect(access.readScopeSafeFile(root, root, 4)).rejects.toThrow('outside authorized scope');
    await symlink(join(root, '.git'), join(root, 'alias'));
    await expect(access.readScopeSafeFile(root, join(root, 'alias', 'shallow'), 4)).rejects.toThrow();
    await symlink(join(root, '.git', 'shallow'), join(root, 'leaf'));
    await expect(access.readScopeSafeFile(root, join(root, 'leaf'), 4)).rejects.toThrow();
    await link(join(root, '.git', 'shallow'), join(root, 'hard'));
    await expect(access.readScopeSafeFile(root, join(root, 'hard'), 4)).rejects.toThrow('Unsafe');
  });

  it('keeps metadata traversal descriptor-relative across an ancestor replacement', async () => {
    const { root, outside, base } = await fixture();
    await mkdir(join(root, '.git')); await writeFile(join(root, '.git', 'shallow'), 'inside');
    await writeFile(join(outside, 'shallow'), 'outside');
    const backend = platform(kind);
    const access = new SourceAccess({ ...backend, async openChild(directory, name, mode) {
      const handle = await backend.openChild(directory, name, mode);
      if (name === '.git') { await rename(join(root, '.git'), join(base, 'held')); await symlink(outside, join(root, '.git')); }
      return handle;
    } });
    expect(await access.readScopeSafeFile(root, join(root, '.git', 'shallow'), 32)).toBe('inside');
  });
});

it.skipIf(process.platform !== 'linux')('wires the unchanged production snapshot and metadata entry points to Linux', async () => {
  const { root, destination } = await fixture();
  await writeFile(join(root, 'a.ts'), 'source');
  expect((await captureSourceSnapshot(root, destination)).hashes.get('a.ts')).toBe(sha('source'));
  expect(await readScopeSafeFile(root, join(root, 'a.ts'), 6)).toBe('source');
});
