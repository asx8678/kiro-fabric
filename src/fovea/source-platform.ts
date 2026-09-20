import { constants, type Stats } from 'node:fs';
import { open, opendir, realpath, type FileHandle } from 'node:fs/promises';
import { posix } from 'node:path';

/** Handles are capabilities, not paths. Implementations must not reopen their
 * pathname, including when enumerating a renamed directory. */
export type SourceStat = Pick<Stats, 'dev' | 'ino' | 'mode' | 'uid' | 'gid' | 'nlink' | 'size' | 'mtimeMs' | 'ctimeMs' | 'isFile' | 'isDirectory'>;
export interface SourceHandle {
  stat(): Promise<SourceStat>;
  read(buffer: Buffer, offset: number, length: number, position: null): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}
export type SourceOpenKind = 'directory' | 'entry';
export interface SourcePlatform {
  openRootDirectory(): Promise<SourceHandle>;
  openChild(directory: SourceHandle, name: string, kind: SourceOpenKind): Promise<SourceHandle>;
  /** Streaming, at most 128 entries prefetched; iterator return closes its own
   * enumeration resource, never the caller's held directory. */
  entries(directory: SourceHandle): AsyncIterable<string>;
}

export class SourcePlatformUnavailableError extends Error {
  readonly code = 'FOVEA_SOURCE_PLATFORM_UNAVAILABLE';
  constructor(readonly platform: string, readonly prerequisite: string) {
    super(`Scope-safe source access unavailable on ${platform}: ${prerequisite}`);
    this.name = 'SourcePlatformUnavailableError';
  }
}

export function assertSourceComponent(name: string): void {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) throw new Error('Invalid source path component');
}

/** No platform names, helper paths or bindings are accepted from source/rules,
 * guest arguments, PATH or environment. This unbound factory stays Linux-only;
 * the managed engine separately admits a generation-verified Darwin binding. */
export function sourcePlatform(platform: NodeJS.Platform = process.platform): SourcePlatform {
  if (platform !== 'linux') throw new SourcePlatformUnavailableError(platform, platform === 'darwin'
    ? 'missing trusted native openat/fdopendir binding (DarwinSourceBinding ABI 1); /dev/fd is not a substitute'
    : 'missing descriptor-relative source adapter');
  const owned = new WeakSet<SourceHandle>();
  const retain = (handle: FileHandle): SourceHandle => { owned.add(handle); return handle; };
  const fd = (handle: SourceHandle): number => {
    if (!owned.has(handle) || (handle as FileHandle).fd < 0) throw new Error('Invalid source directory handle');
    return (handle as FileHandle).fd;
  };
  return {
    async openRootDirectory() {
      return retain(await open('/', constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW));
    },
    async openChild(directory, name, kind) {
      assertSourceComponent(name);
      return retain(await open(`/proc/self/fd/${fd(directory)}/${name}`, constants.O_RDONLY | constants.O_NOFOLLOW |
        (kind === 'directory' ? constants.O_DIRECTORY : constants.O_NONBLOCK)));
    },
    async *entries(directory) {
      const stream = await opendir(`/proc/self/fd/${fd(directory)}`, { bufferSize: 128 });
      // Node's Dir iterator closes even on early return/throw.
      for await (const entry of stream) yield entry.name;
    },
  };
}

/** Canonicality is input validation, NOT a race defense. Only held-descriptor
 * opens below enforce the no-follow boundary for root and all ancestors. */
export async function openSourceDirectory(platform: SourcePlatform, path: string, signal?: AbortSignal): Promise<SourceHandle> {
  signal?.throwIfAborted();
  if (!posix.isAbsolute(path) || posix.normalize(path) !== path || await realpath(path) !== path) throw new Error('Source root must be canonical');
  let handle = await platform.openRootDirectory();
  try {
    for (const part of path.split('/').filter(Boolean)) {
      signal?.throwIfAborted();
      assertSourceComponent(part);
      const next = await platform.openChild(handle, part, 'directory');
      try { await handle.close(); } catch (error) { await next.close(); throw error; }
      handle = next;
    }
    signal?.throwIfAborted();
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

/** The extra byte detects growth beyond the cap. Short reads are not EOF;
 * allocations and read requests stay <=64 KiB, including metadata reads. */
export async function readSourceBounded(handle: SourceHandle, cap: number, signal?: AbortSignal): Promise<Buffer | undefined> {
  sourceLimit(cap, 128 * 1024 * 1024, 'read bytes');
  const parts: Buffer[] = [];
  let size = 0;
  for (;;) {
    signal?.throwIfAborted();
    const part = Buffer.alloc(Math.min(64 * 1024, cap + 1 - size));
    let filled = 0;
    while (filled < part.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(part, filled, part.length - filled, null);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > part.length - filled) throw new Error('Invalid source read result');
      signal?.throwIfAborted();
      if (!bytesRead) return Buffer.concat([...parts, part.subarray(0, filled)], size);
      size += bytesRead; filled += bytesRead;
      if (size > cap) return undefined;
    }
    // Fill each allocation across short reads. Retaining one 64KiB backing
    // buffer per one-byte read would defeat the resident-memory bound.
    parts.push(part);
  }
}

/** Options may tighten production budgets, never remove them via NaN/Infinity,
 * fractions or excessive values. Zero is a valid deny-all budget. */
export function sourceLimit(value: number | undefined, ceiling: number, name: string): number {
  const limit = value ?? ceiling;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > ceiling) throw new Error(`Invalid source ${name} limit (0..${ceiling})`);
  return limit;
}
