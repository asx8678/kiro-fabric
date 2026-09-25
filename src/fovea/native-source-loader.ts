import { createHash } from 'node:crypto';
import { lstat, realpath, writeFile, chmod } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readRegular, validateBundle } from '../installation/bundle-contract.mjs';
import { captureDirectoryAncestry } from '../installation/filesystem-boundary.mjs';
import { createNativeSourcePlatform, type PosixSourceBinding } from './source-platform-native.js';
import type { ParserDescriptor } from './parser-executable.js';
import { SourcePlatformUnavailableError, type SourcePlatform } from './source-platform.js';

const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const BINARY = 'app/fovea/source-platform.node';
const METADATA = 'app/fovea/source-platform.json';

/** Validate target and exact bytes BEFORE native code execution. Metadata itself
 * is authenticated by the same complete-generation inventory as JS and parser. */
/** @internal Qualification-only: pre-dlopen artifact identity gate asserted
 * directly by native-source-loader tests. Not a runtime/package API. */
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

/** Only an admitted complete generation can supply native code. No env, PATH,
 * workspace-local addon, cwd inference, unverified dlopen or runtime compilation.
 * Capture verified bytes into the engine's newly created private directory so
 * replacing the generation pathname after capture cannot select different code. */
export async function loadManagedSourcePlatform(parser: ParserDescriptor, storage: string): Promise<SourcePlatform> {
  if (process.platform !== 'darwin' || !parser.generationRoot) {
    throw new SourcePlatformUnavailableError(process.platform, 'missing trusted generation-local native source binding');
  }
  const bundle = await validateBundle(parser.generationRoot);
  if (bundle.root !== parser.generationRoot || ![2, 3].includes(bundle.manifest.schema) ||
      bundle.manifest.target !== `darwin-${process.arch}` ||
      await realpath(process.execPath) !== join(bundle.root, 'tools/node') ||
      parser.path !== join(bundle.root, 'tools/ast-grep') ||
      bundle.inventory.find((entry: { path: string }) => entry.path === 'tools/ast-grep')?.sha256 !== parser.sha256) {
    throw new Error('Native source generation containment mismatch');
  }
  const guard = captureDirectoryAncestry(bundle.root, { label: 'Native source generation changed' });
  const captured: Buffer[] = [];
  for (const [name, limit] of [[METADATA, 4096], [BINARY, 2 * 1024 * 1024], ['app/closure-manifest.json', 2 * 1024 * 1024]] as const) {
    const entry = bundle.inventory.find((entry: { path: string }) => entry.path === name);
    if (!entry) throw new Error('Native source artifact missing from generation');
    const bytes = await readRegular(join(bundle.root, name), limit, { mode: 0o600 });
    if (bytes.length !== entry.size || hash(bytes) !== entry.sha256) throw new Error('Native source artifact checksum mismatch');
    captured.push(bytes);
  }
  const [metadata, binary, closure] = captured as [Buffer, Buffer, Buffer];
  const source = JSON.parse(closure.toString()).buildInputs?.files?.find((entry: { path: string }) => entry.path === 'src/fovea/source-platform-native.c');
  validateNativeSourceArtifact(JSON.parse(metadata.toString()), binary, source?.sha256 ?? '');
  guard.check();
  const destinationGuard = captureDirectoryAncestry(storage, { label: 'Native source storage changed' });
  const stat = await lstat(storage);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o7777) !== 0o700 || await realpath(storage) !== storage) throw new Error('Unsafe native source storage');
  const file = join(storage, 'source-platform.node');
  await writeFile(file, binary, { flag: 'wx', mode: 0o500 });
  await chmod(file, 0o500);
  destinationGuard.check();
  return createNativeSourcePlatform(createRequire(import.meta.url)(file) as PosixSourceBinding);
}
