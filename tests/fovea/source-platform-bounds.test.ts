import { describe, expect, it, vi } from 'vitest';
import type { Stats } from 'node:fs';
import { SourceAccess } from '../../src/fovea/source-access.js';
import {
  openSourceDirectory, readSourceBounded, sourcePlatform, SourcePlatformUnavailableError,
  type SourceHandle, type SourcePlatform,
} from '../../src/fovea/source-platform.js';
import { createDarwinSourcePlatform, type DarwinSourceBinding } from '../../src/fovea/source-platform-darwin.js';

function file(bytes = Buffer.from('abc'), chunk = 64 * 1024): SourceHandle {
  let offset = 0;
  const stats = { dev: 1, ino: 2, mode: 0o100600, uid: 1, gid: 1, nlink: 1, size: bytes.length, mtimeMs: 1, ctimeMs: 1,
    isFile: () => true, isDirectory: () => false } as Stats;
  return {
    stat: vi.fn(async () => stats),
    read: vi.fn(async (buffer: Buffer, start: number, length: number) => {
      const bytesRead = Math.min(chunk, length, bytes.length - offset);
      bytes.copy(buffer, start, offset, offset + bytesRead); offset += bytesRead;
      return { bytesRead };
    }),
    close: vi.fn(async () => {}),
  };
}
function binding(): DarwinSourceBinding {
  return { abiVersion: 1, platform: 'darwin', openRootDirectory: vi.fn(async () => file()),
    openAt: vi.fn(async () => file()), async *readDirectory() { yield 'a.ts'; } };
}
function oneFile(handle: SourceHandle): { platform: SourcePlatform; root: SourceHandle } {
  const root = file();
  return { root, platform: { openRootDirectory: async () => root, openChild: async () => handle, async *entries() { yield 'a.ts'; } } };
}

// No Darwin syscalls in this file: only the independently testable policy and
// capability contract. Native Darwin execution remains environment-blocked.
describe('Darwin descriptor contract and explicit prerequisite', () => {
  it.each(['darwin', 'win32', 'freebsd'] as const)('fails closed on %s with a machine-readable prerequisite', platform => {
    try { sourcePlatform(platform); throw new Error('unexpected success'); }
    catch (error) {
      expect(error).toBeInstanceOf(SourcePlatformUnavailableError);
      expect(error).toMatchObject({ code: 'FOVEA_SOURCE_PLATFORM_UNAVAILABLE', platform });
      if (platform === 'darwin') expect((error as Error).message).toContain('missing trusted native openat/fdopendir binding (DarwinSourceBinding ABI 1)');
    }
  });
  it.each([undefined, {}, { ...binding(), abiVersion: 2 }, { ...binding(), platform: 'linux' }, { ...binding(), openAt: undefined }])('rejects an absent/mismatched native binding: %j', candidate => {
    expect(() => createDarwinSourcePlatform(candidate as DarwinSourceBinding)).toThrow(SourcePlatformUnavailableError);
  });
  it.each(['', '.', '..', 'a/b', '/absolute', 'a\0b'])('rejects %j before an openAt call', async name => {
    const native = binding(), platform = createDarwinSourcePlatform(native);
    expect(() => platform.openChild(file(), name, 'entry')).toThrow('Invalid source path component');
    expect(native.openAt).not.toHaveBeenCalled();
  });
  it('passes only held capabilities, one component, exact open kind and bounded directory batches', async () => {
    const native = binding(), parent = file();
    const closeStream = vi.fn();
    native.readDirectory = vi.fn(async function* (directory, batchSize) {
      expect(directory).toBe(parent); expect(batchSize).toBe(128);
      try { yield 'a.ts'; yield 'b.ts'; } finally { closeStream(); }
    });
    const platform = createDarwinSourcePlatform(native);
    await platform.openRootDirectory(); expect(native.openRootDirectory).toHaveBeenCalledWith();
    await platform.openChild(parent, 'child', 'directory');
    await platform.openChild(parent, 'file.ts', 'entry');
    expect(native.openAt).toHaveBeenNthCalledWith(1, parent, 'child', 'directory');
    expect(native.openAt).toHaveBeenNthCalledWith(2, parent, 'file.ts', 'entry');
    for await (const name of platform.entries(parent)) { expect(name).toBe('a.ts'); break; }
    expect(closeStream).toHaveBeenCalledOnce(); expect(parent.close).not.toHaveBeenCalled();
  });
  it('closes enumeration on an invalid native name without following it', async () => {
    const native = binding(), closed = vi.fn();
    native.readDirectory = async function* () { try { yield '../outside'; } finally { closed(); } };
    const iterator = createDarwinSourcePlatform(native).entries(file())[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow('Invalid source path component'); expect(closed).toHaveBeenCalledOnce();
  });
  it('preserves errno rather than treating access-denied as absence', async () => {
    const native = binding(), error = Object.assign(new Error('denied'), { code: 'EACCES' });
    native.openAt = async () => { throw error; };
    await expect(createDarwinSourcePlatform(native).openChild(file(), 'x', 'entry')).rejects.toBe(error);
  });
});

describe('bounded neutral source reads', () => {
  it('handles short reads and hashes/copies byte data without UTF-8 decoding', async () => {
    const bytes = Buffer.from([255, 254, 1, 0, 128]);
    const handle = file(bytes, 2);
    expect(await readSourceBounded(handle, bytes.length)).toEqual(bytes);
    expect(handle.read).toHaveBeenCalledTimes(4);
  });
  it('fills one working allocation across repeated one-byte reads', async () => {
    const handle = file(Buffer.alloc(1_000, 255), 1);
    expect(await readSourceBounded(handle, 1_000)).toEqual(Buffer.alloc(1_000, 255));
    const calls = vi.mocked(handle.read).mock.calls;
    expect(calls).toHaveLength(1_001);
    expect(new Set(calls.map(call => call[0])).size).toBe(1);
    expect(calls.slice(0, 3).map(call => [call[1], call[2]])).toEqual([[0, 1_001], [1, 1_000], [2, 999]]);
  });
  it('uses <=64KiB read requests, consumes only cap+1 bytes on growth, and supports zero', async () => {
    const handle = file(Buffer.alloc(200_000));
    expect(await readSourceBounded(handle, 70_000)).toBeUndefined();
    expect(vi.mocked(handle.read).mock.calls.map(call => call[2])).toEqual([65_536, 4_465]);
    expect(await readSourceBounded(file(Buffer.alloc(0)), 0)).toEqual(Buffer.alloc(0));
    expect(await readSourceBounded(file(Buffer.alloc(1)), 0)).toBeUndefined();
  });
  it.each([NaN, Infinity, -1, 0.5, 128 * 1024 * 1024 + 1])('rejects invalid cap %s before reading', async cap => {
    const handle = file();
    await expect(readSourceBounded(handle, cap)).rejects.toThrow('limit'); expect(handle.read).not.toHaveBeenCalled();
  });
  it.each([-1, NaN, 1.5, 65_537])('rejects an impossible native read count %s', async bytesRead => {
    const handle = file(); handle.read = async () => ({ bytesRead });
    await expect(readSourceBounded(handle, 70_000)).rejects.toThrow('Invalid source read result');
  });
  it('observes abort after an in-flight read before retaining or publishing bytes', async () => {
    const handle = file(), controller = new AbortController();
    handle.read = vi.fn(async () => { controller.abort(new Error('stop-read')); return { bytesRead: 1 }; });
    await expect(readSourceBounded(handle, 3, controller.signal)).rejects.toThrow('stop-read');
    expect(handle.read).toHaveBeenCalledOnce();
  });
});

describe('shared source policy limits, races, cleanup and permissions', () => {
  it.each([
    { maxFiles: NaN }, { maxFiles: 8001 }, { maxFiles: -1 }, { maxFiles: 1.5 },
    { maxFileBytes: Infinity }, { maxFileBytes: 8 * 1024 * 1024 + 1 },
    { maxBytes: NaN }, { maxBytes: 128 * 1024 * 1024 + 1 },
  ])('rejects invalid budgets before filesystem access: %j', async options => {
    const { platform } = oneFile(file()); platform.openRootDirectory = vi.fn(platform.openRootDirectory);
    await expect(new SourceAccess(platform).captureSourceSnapshot('/', '/unused', undefined, options)).rejects.toThrow('limit');
    expect(platform.openRootDirectory).not.toHaveBeenCalled();
  });
  it('does not turn native EACCES into permission, and reports a source gap', async () => {
    const { platform, root } = oneFile(file());
    platform.openChild = async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
    const access = new SourceAccess(platform);
    const shot = await access.captureSourceSnapshot('/', '/unused');
    expect(shot.hashes.size).toBe(0); expect(shot.coverage.counts).toMatchObject({ unavailableOrSymlink: 1 });
    expect(root.close).toHaveBeenCalledOnce();
    await expect(access.readScopeSafeFile('/', '/a.ts', 3)).rejects.toMatchObject({ code: 'EACCES' });
  });
  it.each([
    ['nlink', 2], ['size', 4], ['mtimeMs', 2], ['ctimeMs', 2], ['mode', 0o100644], ['uid', 2], ['gid', 2], ['dev', 2], ['ino', 3], ['isFile', () => false],
  ])('does not publish a file whose %s changes during the read', async (field, value) => {
    const handle = file(), before = await handle.stat();
    handle.stat = vi.fn().mockResolvedValueOnce(before).mockResolvedValue({ ...before, [field as string]: value });
    const { platform, root } = oneFile(handle);
    const shot = await new SourceAccess(platform).captureSourceSnapshot('/', '/unused');
    expect(shot.hashes.size).toBe(0); expect(shot.coverage.counts).toMatchObject({ raced: 1 });
    expect(handle.close).toHaveBeenCalledOnce(); expect(root.close).toHaveBeenCalledOnce();
  });
  it('rejects short EOF even if a faulty binding returns identical before/after metadata', async () => {
    const handle = file(); handle.read = async () => ({ bytesRead: 0 });
    const shot = await new SourceAccess(oneFile(handle).platform).captureSourceSnapshot('/', '/unused');
    expect(shot.coverage.counts).toMatchObject({ raced: 1 });
  });
  it('rejects nonregular objects and hardlinks without a read', async () => {
    for (const patch of [{ isFile: () => false }, { nlink: 2 }]) {
      const handle = file(), before = await handle.stat(); handle.stat = async () => ({ ...before, ...patch });
      const shot = await new SourceAccess(oneFile(handle).platform).captureSourceSnapshot('/', '/unused');
      expect(shot.hashes.size).toBe(0); expect(handle.read).not.toHaveBeenCalled(); expect(handle.close).toHaveBeenCalledOnce();
    }
  });
  it('closes file and root handles when cancelled inside a read', async () => {
    const handle = file(), controller = new AbortController();
    handle.read = async () => { controller.abort(new Error('cancel-read')); return { bytesRead: 1 }; };
    const { platform, root } = oneFile(handle);
    await expect(new SourceAccess(platform).captureSourceSnapshot('/', '/unused', controller.signal)).rejects.toThrow('cancel-read');
    expect(handle.close).toHaveBeenCalledOnce(); expect(root.close).toHaveBeenCalledOnce();
  });
  it('closes the root when cancellation arrives during root open', async () => {
    const { platform, root } = oneFile(file()), controller = new AbortController();
    platform.openRootDirectory = async () => { controller.abort(new Error('cancel-open')); return root; };
    await expect(openSourceDirectory(platform, '/', controller.signal)).rejects.toThrow('cancel-open');
    expect(root.close).toHaveBeenCalledOnce();
  });
  it('bounds coverage examples and closes enumeration on cancellation', async () => {
    const { platform, root } = oneFile(file()); let closed = 0;
    platform.entries = async function* () { try { for (let i = 0; i < 100; i++) yield `.env.${i}`; } finally { closed++; } };
    const shot = await new SourceAccess(platform).captureSourceSnapshot('/', '/unused');
    expect(shot.coverage.counts).toMatchObject({ excluded: 100 });
    expect((shot.coverage.examples as Record<string, string[]>).excluded).toHaveLength(20);
    expect(closed).toBe(1);
    const controller = new AbortController();
    platform.entries = async function* () { try { controller.abort(new Error('cancel-enumeration')); yield 'x'; } finally { closed++; } };
    await expect(new SourceAccess(platform).captureSourceSnapshot('/', '/unused', controller.signal)).rejects.toThrow('cancel-enumeration');
    expect(closed).toBe(2); expect(root.close).toHaveBeenCalledTimes(2);
  });
  it('caps each directory at 50,000 and total enumeration at 100,000 plus one detection entry', async () => {
    const root = file(), child = file(); let closed = 0, yielded = 0;
    const info = await child.stat(); child.stat = async () => ({ ...info, isDirectory: () => true });
    const platform: SourcePlatform = {
      openRootDirectory: async () => root,
      openChild: async (_directory, name) => {
        if (name === '.git') throw Object.assign(new Error('absent'), { code: 'ENOENT' });
        return child;
      },
      async *entries(directory) {
        try {
          if (directory === root) { for (const name of ['a', 'b', 'c']) { yielded++; yield name; } }
          else for (let i = 0; i < 60_000; i++) { yielded++; yield `.env.${i}`; }
        } finally { closed++; }
      },
    };
    const shot = await new SourceAccess(platform).captureSourceSnapshot('/', '/unused');
    expect(shot.hashes.size).toBe(0); expect(shot.coverage).toMatchObject({ entriesVisited: 100_001, capped: true });
    expect(yielded).toBe(100_001); expect(closed).toBe(3);
    expect((shot.coverage.counts as Record<string, number>).entryCap).toBe(3);
  });
  it('stops before enumerating below depth 64 and closes every held directory', async () => {
    const handles: SourceHandle[] = [], depth = new Map<SourceHandle, number>(); let enumerated = 0;
    const directory = async (level: number) => {
      const handle = file(), info = await handle.stat(); handle.stat = async () => ({ ...info, isDirectory: () => true });
      handles.push(handle); depth.set(handle, level); return handle;
    };
    const platform: SourcePlatform = {
      openRootDirectory: () => directory(0),
      async openChild(parent, name) {
        if (name === '.git') throw Object.assign(new Error('absent'), { code: 'ENOENT' });
        return directory(depth.get(parent)! + 1);
      },
      async *entries() { enumerated++; yield 'nested'; },
    };
    const shot = await new SourceAccess(platform).captureSourceSnapshot('/', '/unused');
    expect(shot.coverage).toMatchObject({ capped: true, counts: { depthCap: 1 } });
    expect(enumerated).toBe(65); expect(handles).toHaveLength(66);
    for (const handle of handles) expect(handle.close).toHaveBeenCalledOnce();
  });
  it('rejects raced or growing metadata and closes handles', async () => {
    for (const grows of [false, true]) {
      const handle = file(grows ? Buffer.from('abcd') : Buffer.from('abc'));
      const info = await handle.stat();
      handle.stat = vi.fn().mockResolvedValueOnce({ ...info, size: 3 }).mockResolvedValue({ ...info, ctimeMs: 2 });
      const { platform, root } = oneFile(handle);
      await expect(new SourceAccess(platform).readScopeSafeFile('/', '/a.ts', 3)).rejects.toThrow('changed or exceeded');
      expect(handle.close).toHaveBeenCalledOnce(); expect(root.close).toHaveBeenCalledOnce();
    }
  });
});
