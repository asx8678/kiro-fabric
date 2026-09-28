import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { captureDirectoryAncestry } from '../installation/filesystem-boundary.mjs';
import { createNativeSourcePlatform, type PosixSourceBinding } from './source-platform-native.js';
import type { ParserDescriptor } from './parser-executable.js';
import { readSourceBounded, SourcePlatformUnavailableError, type SourcePlatform } from './source-platform.js';

const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const BINARY = 'app/fovea/source-platform.node';
const METADATA = 'app/fovea/source-platform.json';
const CLOSURE = 'app/closure-manifest.json';

/** @internal Pre-dlopen artifact identity gate asserted directly by tests. */
export function validateNativeSourceArtifact(metadata: unknown, bytes: Buffer, sourceSha256: string): void {
  const m = metadata as Record<string, unknown> | null;
  if (!m || typeof m !== 'object' || Array.isArray(m) ||
      Object.keys(m).sort().join(',') !== 'abiVersion,arch,minimumMacOS,platform,schemaVersion,sha256,sourceSha256' ||
      m.schemaVersion !== 1 || m.abiVersion !== 1 || m.platform !== 'darwin' || process.platform !== 'darwin' ||
      m.arch !== process.arch || m.minimumMacOS !== '13.5' ||
      !/^[a-f0-9]{64}$/.test(sourceSha256) || m.sourceSha256 !== sourceSha256 || m.sha256 !== hash(bytes)) {
    throw new Error('Native source artifact identity mismatch');
  }
  const cpu = process.arch === 'arm64' ? 0x0100000c : process.arch === 'x64' ? 0x01000007 : 0;
  if (!cpu || bytes.length < 32 || bytes.length > 2 * 1024 * 1024 || bytes.readUInt32LE(0) !== 0xfeedfacf ||
      bytes.readUInt32LE(4) !== cpu || bytes.readUInt32LE(12) !== 8) throw new Error('Native source Mach-O architecture/type mismatch');
}

const readOwnedRegular = async (file: string, limit: number): Promise<Buffer> => {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit || (stat.mode & 0o022) || stat.uid !== process.getuid?.()) {
      throw new Error('Native source artifact must be an owned, unaliased regular file');
    }
    const bytes = await readSourceBounded(handle, limit);
    const after = await handle.stat();
    if (!bytes || bytes.length !== stat.size || after.size !== stat.size || after.mode !== stat.mode || after.uid !== stat.uid || after.nlink !== stat.nlink || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error('Native source artifact changed during read');
    return bytes;
  } finally { await handle.close(); }
};

/** Only the installation that supplied the verified parser can supply native
 * code: `<root>/app/...` beside `<root>/tools/ast-grep`. No env, PATH,
 * workspace-local addon, unverified dlopen or runtime compilation. Verified
 * bytes are captured into the engine's private directory before loading so a
 * later pathname replacement cannot select different code. */
export async function loadManagedSourcePlatform(parser: ParserDescriptor, storage: string, captureFile?: (file: string, identity: Stats) => Promise<void>): Promise<SourcePlatform> {
  if (process.platform !== 'darwin' || !parser.generationRoot) {
    throw new SourcePlatformUnavailableError(process.platform, 'missing trusted installation-local native source binding');
  }
  const root = await realpath(parser.generationRoot);
  if (root !== parser.generationRoot || parser.path !== join(root, 'tools/ast-grep')) {
    throw new Error('Native source installation containment mismatch');
  }
  const guard = captureDirectoryAncestry(root, { label: 'Native source installation changed' });
  const metadata = await readOwnedRegular(join(root, METADATA), 4096);
  const binary = await readOwnedRegular(join(root, BINARY), 2 * 1024 * 1024);
  const closure = await readOwnedRegular(join(root, CLOSURE), 2 * 1024 * 1024);
  const source = JSON.parse(closure.toString()).buildInputs?.files?.find((entry: { path: string }) => entry.path === 'src/fovea/source-platform-native.c');
  validateNativeSourceArtifact(JSON.parse(metadata.toString()), binary, source?.sha256 ?? '');
  guard.check();
  const destinationGuard = captureDirectoryAncestry(storage, { label: 'Native source storage changed' });
  const stat = await lstat(storage);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o7777) !== 0o700 || await realpath(storage) !== storage) throw new Error('Unsafe native source storage');
  const file = join(storage, 'source-platform.node');
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o500);
  try {
    await handle.writeFile(binary);
    await handle.chmod(0o500);
    destinationGuard.check();
    await captureFile?.(file, await handle.stat());
  } finally { await handle.close(); }
  return createNativeSourcePlatform(createRequire(import.meta.url)(file) as PosixSourceBinding);
}
