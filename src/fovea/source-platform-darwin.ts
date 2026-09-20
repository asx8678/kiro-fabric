import {
  assertSourceComponent, SourcePlatformUnavailableError,
  type SourceHandle, type SourceOpenKind, type SourcePlatform,
} from './source-platform.js';

/** In-process native contract, implemented by source-platform-native.c/.ts;
 * no production native artifact or loader is shipped yet. Names are single
 * components, handles are native-owned opaque capabilities, and errors retain
 * POSIX errno codes. No path fallback.
 *
 * openRootDirectory: open("/", O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC).
 * openAt(directory, name, 'directory'): openat with those same flags.
 * openAt(directory, name, 'entry'): O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC.
 * Handle operations: fstat, bounded read(2), close; never reopen by pathname.
 * readDirectory: independent descriptor-relative directory stream, fdopendir /
 * readdir in <=128-entry batches; skip dot entries, close on return/throw/EOF.
 * See docs/fovea/platform-source.md for ownership, cancellation and trust gates.
 */
export interface DarwinSourceBinding {
  readonly abiVersion: 1;
  readonly platform: 'darwin';
  openRootDirectory(): Promise<SourceHandle>;
  openAt(directory: SourceHandle, name: string, kind: SourceOpenKind): Promise<SourceHandle>;
  readDirectory(directory: SourceHandle, batchSize: 128): AsyncIterable<string>;
}

/** Trusted host wiring only. This is not exposed as a snapshot/rules option.
 * Linux compilation/probes do not certify native Darwin execution. */
export function createDarwinSourcePlatform(binding: DarwinSourceBinding): SourcePlatform {
  if (!binding || binding.abiVersion !== 1 || binding.platform !== 'darwin' ||
      typeof binding.openRootDirectory !== 'function' || typeof binding.openAt !== 'function' || typeof binding.readDirectory !== 'function') {
    throw new SourcePlatformUnavailableError('darwin', 'invalid trusted DarwinSourceBinding ABI 1');
  }
  return {
    openRootDirectory: () => binding.openRootDirectory(),
    openChild(directory, name, kind) {
      assertSourceComponent(name);
      return binding.openAt(directory, name, kind);
    },
    async *entries(directory) {
      for await (const name of binding.readDirectory(directory, 128)) {
        assertSourceComponent(name);
        yield name;
      }
    },
  };
}
