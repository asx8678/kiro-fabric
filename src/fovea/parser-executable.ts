import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, writeFile, chmod } from 'node:fs/promises';
import { isAbsolute, relative, sep, join } from 'node:path';
import { execFile } from 'node:child_process';
import { readSourceBounded, sourceLimit } from './source-platform.js';

export interface ParserDescriptor {
  path: string;
  sha256: string;
  version: string;
  generationRoot?: string | undefined;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** Host supplies identity; neither PATH nor environment may select an executable. */
export async function readVerifiedExecutable(path: string, maxBytes = 128 * 1024 * 1024): Promise<Buffer> {
  sourceLimit(maxBytes, 128 * 1024 * 1024, 'executable bytes');
  if (!isAbsolute(path)) throw new Error('Executable path must be absolute');
  const canonical = await realpath(path);
  if (canonical !== path) throw new Error('Executable path must be canonical and cannot contain symlinks');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || !(before.mode & 0o111) || (before.mode & 0o022) || before.size > maxBytes) {
      throw new Error('Unsafe executable permissions, type, or size');
    }
    if (before.uid !== 0 && before.uid !== process.getuid?.()) throw new Error('Untrusted executable owner');
    const bytes = await readSourceBounded(handle, maxBytes);
    const after = await handle.stat();
    if (!bytes || bytes.length !== before.size || before.size !== after.size || before.mode !== after.mode || before.uid !== after.uid || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error('Executable changed during verification');
    }
    return bytes;
  } finally { await handle.close(); }
}

export async function resolveParserDescriptor(descriptor: ParserDescriptor, storageRoot: string, signal?: AbortSignal): Promise<ParserDescriptor> {
  if (!/^[a-f0-9]{64}$/i.test(descriptor.sha256) || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(descriptor.version)) {
    throw new Error('Invalid managed parser descriptor');
  }
  if (descriptor.generationRoot) {
    const root = await realpath(descriptor.generationRoot);
    const rel = relative(root, descriptor.path);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Parser is outside its generation');
  }
  signal?.throwIfAborted();
  const bytes = await readVerifiedExecutable(descriptor.path);
  if (sha256(bytes) !== descriptor.sha256.toLowerCase()) throw new Error('Managed parser SHA-256 mismatch');
  // Execute only the exact verified bytes, not a subsequently replaced source path.
  const path = join(storageRoot, 'managed-parser');
  await writeFile(path, bytes, { flag: 'wx', mode: 0o500 });
  await chmod(path, 0o500);
  const version = await new Promise<string>((resolve, reject) => {
    execFile(path, ['--version'], { signal, killSignal: 'SIGKILL', timeout: 5000, maxBuffer: 4096,
      env: { LANG: 'C', LC_ALL: 'C', HOME: storageRoot, TMPDIR: storageRoot },
    }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  });
  signal?.throwIfAborted();
  if (version !== `ast-grep ${descriptor.version}`) throw new Error(`Managed parser version mismatch: ${version}`);
  return { ...descriptor, path };
}
