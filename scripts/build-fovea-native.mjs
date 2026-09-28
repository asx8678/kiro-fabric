import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
/** Build-time only. Never imported by the runtime or installed manager. No
 * downloads, runtime compiler discovery or guest/environment-selected helper.
 * @internal Qualification-only export: native C build tests compile isolated
 * test binaries through this exact function instead of duplicating compiler
 * discovery. Not a runtime/package API. */
export function compileSourceBinding(root, output) {
  if (!['darwin', 'linux'].includes(process.platform)) throw Error('Unsupported native source build host');
  const headers = [path.resolve(path.dirname(fs.realpathSync(process.execPath)), '../include/node'),
    '/opt/homebrew/opt/node@24/include/node', '/usr/local/opt/node@24/include/node',
    '/usr/include/node', '/usr/local/include/node'].find(dir => fs.existsSync(path.join(dir, 'node_api.h')));
  if (!headers) throw Error('Local Node development headers required for native source build (no downloads)');
  const version = fs.readFileSync(path.join(headers, 'node_version.h'), 'utf8');
  const major = Number(version.match(/^#define NODE_MAJOR_VERSION\s+(\d+)/m)?.[1]);
  if (major !== Number(process.versions.node.split('.')[0])) throw Error('Native source build Node header major mismatch');
  const uv = [headers, '/opt/homebrew/opt/libuv/include', '/usr/local/opt/libuv/include', '/usr/include', '/usr/local/include']
    .find(dir => fs.existsSync(path.join(dir, 'uv.h')));
  if (!uv) throw Error('Local libuv development headers required for native source build (no downloads)');
  const flags = process.platform === 'darwin' ? ['-bundle', '-undefined', 'dynamic_lookup', '-mmacosx-version-min=13.5', '-arch', process.arch === 'arm64' ? 'arm64' : 'x86_64'] : ['-shared'];
  const result = spawnSync('/usr/bin/cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-fPIC', '-D_FILE_OFFSET_BITS=64', ...flags,
    `-I${headers}`, `-I${uv}`, path.join(root, 'src/fovea/source-platform-native.c'), '-o', output],
  { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TMPDIR: path.dirname(path.resolve(output)) } });
  if (result.error || result.status !== 0) throw Error(`Native source compiler failed: ${result.error?.message ?? result.stderr}`);
}

export function buildFoveaNative(root, directory) {
  if (process.platform !== 'darwin') return;
  if (!['arm64', 'x64'].includes(process.arch)) throw Error('Unsupported Darwin source architecture');
  const binary = path.join(directory, 'source-platform.node');
  compileSourceBinding(root, binary);
  fs.chmodSync(binary, 0o600);
  const descriptor = { schemaVersion: 1, abiVersion: 1, platform: 'darwin', arch: process.arch, minimumMacOS: '13.5',
    sourceSha256: hash(fs.readFileSync(path.join(root, 'src/fovea/source-platform-native.c'))), sha256: hash(fs.readFileSync(binary)) };
  fs.writeFileSync(path.join(directory, 'source-platform.json'), JSON.stringify(descriptor) + '\n', { mode: 0o600, flag: 'wx' });
}
