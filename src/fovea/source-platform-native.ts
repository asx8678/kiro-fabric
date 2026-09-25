import { constants } from 'node:fs';
import {
  assertSourceComponent, SourcePlatformUnavailableError,
  type SourceHandle, type SourcePlatform, type SourceStat,
} from './source-platform.js';declare const nativeToken: unique symbol;
/** Opaque, native-tagged object; not an integer fd, pathname, or serialized ID. */
/** @internal Qualification-only: opaque native handle brand shared with the
 * compiled-binding tests. Not serialized or exposed through any public API. */
export interface NativeSourceToken { readonly [nativeToken]: true }
type NativeStat = Omit<SourceStat, 'isFile' | 'isDirectory'>;
/** Low-level exports of source-platform-native.c. Binary loading/authentication
 * is deliberately outside this adapter; no paths, dynamic imports or env knobs. */
export interface PosixSourceBinding {
  readonly abiVersion: 1;
  readonly platform: 'linux' | 'darwin';
  openRoot(): Promise<NativeSourceToken>;
  openAt(parent: NativeSourceToken, name: string, kind: 'directory' | 'entry'): Promise<NativeSourceToken>;
  stat(handle: NativeSourceToken): Promise<NativeStat>;
  read(handle: NativeSourceToken, length: number): Promise<Buffer>;
  close(handle: NativeSourceToken): Promise<void>;
  openDirectory(parent: NativeSourceToken): Promise<NativeSourceToken>;
  readDirectory(stream: NativeSourceToken): Promise<string[]>;
  closeDirectory(stream: NativeSourceToken): Promise<void>;
}

/** Additive, separately gated ABI. Old source-only binaries remain usable for
 * reads, but never qualify as provenance writers. Only private journal names,
 * bounded bytes and opaque directory capabilities cross this boundary. */
/** @internal Qualification-only: additive native provenance ABI surface used
 * by the compiled-binding tests. Never authenticated or exported at runtime. */
export interface PosixProvenanceBinding extends PosixSourceBinding {
  readonly provenanceAbiVersion: 1;
  journalRead(directory: NativeSourceToken, name: string): Promise<Buffer | null>;
  journalReplace(directory: NativeSourceToken, name: string, expected: Buffer | null, replacement: Buffer, nonce: string): Promise<void>;
}
export interface NativeProvenanceOperations {
  read(directory: SourceHandle, name: string): Promise<Buffer | null>;
  replace(directory: SourceHandle, name: string, expected: Buffer | null, replacement: Buffer, nonce: string): Promise<void>;
}
const provenance = new WeakMap<SourcePlatform, NativeProvenanceOperations>();
export function nativeProvenanceOperations(platform: SourcePlatform): NativeProvenanceOperations {
  const operations = provenance.get(platform);
  if (!operations) throw new SourcePlatformUnavailableError(process.platform, 'missing trusted native provenance ABI 1');
  return operations;
}
/** Shared actual POSIX implementation: Linux probes compile the same C source
 * without pretending that its platform is Darwin. A host must authenticate the
 * native binary before passing these exports; ABI checks are not authentication. */
export function createNativeSourcePlatform(binding: PosixSourceBinding): SourcePlatform {
  const methods = ['openRoot', 'openAt', 'stat', 'read', 'close', 'openDirectory', 'readDirectory', 'closeDirectory'] as const;
  if (!binding || binding.abiVersion !== 1 || !['linux', 'darwin'].includes(binding.platform) || binding.platform !== process.platform ||
      methods.some(name => typeof binding[name] !== 'function')) {
    throw new SourcePlatformUnavailableError(process.platform, 'invalid or foreign trusted POSIX source binding ABI 1');
  }
  const handles = new WeakMap<SourceHandle, NativeSourceToken>();
  const token = (handle: SourceHandle): NativeSourceToken => {
    const value = handles.get(handle);
    if (!value) throw Object.assign(new Error('Foreign or closed source handle'), { code: 'EBADF' });
    return value;
  };
  const retain = (value: NativeSourceToken): SourceHandle => {
    let closing: Promise<void> | undefined;
    const handle: SourceHandle = {
      async stat() {
        const info = await binding.stat(token(handle));
        return { ...info, isFile: () => (info.mode & constants.S_IFMT) === constants.S_IFREG,
          isDirectory: () => (info.mode & constants.S_IFMT) === constants.S_IFDIR };
      },
      async read(buffer, offset, length, position) {
        if (!Buffer.isBuffer(buffer) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) ||
            length < 0 || length > 65_536 || offset > buffer.length - length || position !== null) throw new Error('Invalid native source read bounds');
        // Native work never borrows a JS buffer pointer across an async boundary.
        const bytes = await binding.read(token(handle), length);
        if (!Buffer.isBuffer(bytes) || bytes.length > length) throw new Error('Invalid native source read result');
        bytes.copy(buffer, offset);
        return { bytesRead: bytes.length };
      },
      close() {
        if (!closing) {
          const capability = token(handle);
          // Mark closed only when native close has settled, and permit a retry
          // after EBUSY. Native operations reject simultaneous use rather than
          // queue unbounded work or close a descriptor under an in-flight read.
          closing = binding.close(capability).then(() => { handles.delete(handle); }, (error: unknown) => {
            if ((error as NodeJS.ErrnoException).code === 'EBUSY') closing = undefined;
            else handles.delete(handle);
            throw error;
          });
        }
        return closing;
      },
    };
    handles.set(handle, value);
    return handle;
  };
  const platform: SourcePlatform = {
    async openRootDirectory() { return retain(await binding.openRoot()); },
    async openChild(directory, name, kind) {
      assertSourceComponent(name);
      return retain(await binding.openAt(token(directory), name, kind));
    },
    async *entries(directory) {
      const stream = await binding.openDirectory(token(directory));
      try {
        for (;;) {
          const batch = await binding.readDirectory(stream);
          if (!Array.isArray(batch) || batch.length > 128) throw new Error('Invalid native directory batch');
          if (!batch.length) return;
          for (const name of batch) { assertSourceComponent(name); yield name; }
        }
      } finally { await binding.closeDirectory(stream); }
    },
  };
  const journal = binding as Partial<PosixProvenanceBinding>;
  if (journal.provenanceAbiVersion === 1 && typeof journal.journalRead === 'function' && typeof journal.journalReplace === 'function') {
    provenance.set(platform, {
      read: (directory, name) => journal.journalRead!(token(directory), name),
      replace: (directory, name, expected, replacement, nonce) => journal.journalReplace!(token(directory), name, expected, replacement, nonce),
    });
  }
  return platform;
}