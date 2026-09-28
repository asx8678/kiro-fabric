import { removeFixture } from "../fixture-cleanup.mjs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildFoveaNative } from '../../scripts/build-fovea-native.mjs';
import { loadManagedSourcePlatform, validateNativeSourceArtifact } from '../../src/fovea/native-source-loader.js';
import { SourceAccess } from '../../src/fovea/source-access.js';

const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('native artifact identity before dlopen', () => {
  function artifact(arch: 'arm64' | 'x64' = 'arm64') {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'darwin' }, arch: { value: arch } }));
    const bytes = Buffer.alloc(32); bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4); bytes.writeUInt32LE(8, 12);
    const source = sha('source');
    const metadata = { schemaVersion: 1, abiVersion: 1, platform: 'darwin', arch, minimumMacOS: '13.5', sourceSha256: source, sha256: sha(bytes) };
    return { bytes, source, metadata };
  }
  it.each(['arm64', 'x64'] as const)('admits only exact target, source and bytes (%s)', arch => {
    const a = artifact(arch); expect(() => validateNativeSourceArtifact(a.metadata, a.bytes, a.source)).not.toThrow();
  });
  it.each([
    { schemaVersion: 2 }, { abiVersion: 2 }, { platform: 'linux' }, { arch: 'x64' }, { minimumMacOS: '99' },
    { sourceSha256: '0'.repeat(64) }, { sha256: '0'.repeat(64) }, { extra: true },
  ])('rejects metadata drift %j', change => {
    const a = artifact(); expect(() => validateNativeSourceArtifact({ ...a.metadata, ...change }, a.bytes, a.source)).toThrow('identity mismatch');
  });
  it('rejects changed bytes, foreign Mach-O architecture and executable type', () => {
    const a = artifact(); a.bytes[20] = 1;
    expect(() => validateNativeSourceArtifact(a.metadata, a.bytes, a.source)).toThrow('identity mismatch');
    a.bytes.writeUInt32LE(0x01000007, 4); a.metadata.sha256 = sha(a.bytes);
    expect(() => validateNativeSourceArtifact(a.metadata, a.bytes, a.source)).toThrow('Mach-O');
    a.bytes.writeUInt32LE(0x0100000c, 4); a.bytes.writeUInt32LE(2, 12); a.metadata.sha256 = sha(a.bytes);
    expect(() => validateNativeSourceArtifact(a.metadata, a.bytes, a.source)).toThrow('Mach-O');
  });
  it('does not admit Darwin bytes on Linux', () => {
    const a = artifact(); vi.stubGlobal('process', Object.create(process, { platform: { value: 'linux' } }));
    expect(() => validateNativeSourceArtifact(a.metadata, a.bytes, a.source)).toThrow('identity mismatch');
  });
});

describe.skipIf(process.platform !== 'darwin')('managed Darwin loader and actual compiled code', () => {
  let compiled = '', binary: Buffer, metadata: Buffer;
  const scratch: string[] = [];
  beforeAll(async () => {
    compiled = await fs.mkdtemp(resolve('.tmp/native-loader-build-'));
    buildFoveaNative(process.cwd(), compiled);
    binary = await fs.readFile(join(compiled, 'source-platform.node'));
    metadata = await fs.readFile(join(compiled, 'source-platform.json'));
  });
  afterEach(async () => { for (const root of scratch.splice(0)) await removeFixture(root, { recursive: true, force: true }); });
  afterAll(async () => { if (compiled) await removeFixture(compiled, { recursive: true, force: true }); });
  async function fixture() {
    const root = await fs.realpath(await fs.mkdtemp(resolve('.tmp/native-loader-test-'))); scratch.push(root);
    const storage = join(root, 'engine');
    for (const dir of ['app/fovea', 'tools', 'engine', 'workspace']) await fs.mkdir(join(root, dir), { recursive: true, mode: 0o700 });
    const closure = Buffer.from(JSON.stringify({ buildInputs: { files: [{ path: 'src/fovea/source-platform-native.c', sha256: JSON.parse(metadata.toString()).sourceSha256 }] } }));
    const files: [string, Buffer][] = [['app/fovea/source-platform.node', binary], ['app/fovea/source-platform.json', metadata], ['app/closure-manifest.json', closure], ['tools/ast-grep', Buffer.from('parser')]];
    for (const [file, content] of files) await fs.writeFile(join(root, file), content, { mode: 0o600 });
    return { root, storage, parser: { generationRoot: root, path: join(root, 'tools/ast-grep'), sha256: sha('parser'), version: '0.45.3' } };
  }
  it('loads verified copied bytes and captures exact source, ignoring environment selectors', async () => {
    const f = await fixture(); vi.stubEnv('FOVEA_NATIVE_PATH', '/attacker/source.node'); vi.stubEnv('NODE_PATH', '/attacker');
    await fs.writeFile(join(f.root, 'workspace', 'a.ts'), 'export const a = 1;');
    const platform = await loadManagedSourcePlatform(f.parser, f.storage);
    const shot = await new SourceAccess(platform).captureSourceSnapshot(join(f.root, 'workspace'), join(f.root, 'snapshot'));
    expect(shot.hashes.get('a.ts')).toBe(sha('export const a = 1;'));
    expect(await fs.readFile(join(f.storage, 'source-platform.node'))).toEqual(binary);
    expect((await fs.stat(join(f.storage, 'source-platform.node'))).mode & 0o777).toBe(0o500);
  });
  it('requires an installation root and a parser beside its app', async () => {
    const f = await fixture();
    await expect(loadManagedSourcePlatform({ ...f.parser, generationRoot: undefined }, f.storage)).rejects.toThrow('installation-local');
    await expect(loadManagedSourcePlatform({ ...f.parser, path: '/other/parser' }, f.storage)).rejects.toThrow('containment');
    await expect(loadManagedSourcePlatform({ ...f.parser, generationRoot: join(f.root, 'app') }, f.storage)).rejects.toThrow('containment');
    expect(await fs.readdir(f.storage)).toEqual([]);
  });
  it.each(['changed', 'metadata', 'source', 'symlink', 'hardlink', 'writable', 'unsafe-storage', 'occupied-storage'] as const)('rejects %s before native execution', async kind => {
    const f = await fixture(), file = join(f.root, 'app/fovea/source-platform.node');
    if (kind === 'changed') await fs.appendFile(file, 'x');
    if (kind === 'metadata') await fs.writeFile(join(f.root, 'app/fovea/source-platform.json'), JSON.stringify({ ...JSON.parse(metadata.toString()), sha256: '0'.repeat(64) }));
    if (kind === 'source') await fs.writeFile(join(f.root, 'app/closure-manifest.json'), JSON.stringify({ buildInputs: { files: [] } }));
    if (kind === 'symlink') { await fs.rename(file, file + '.saved'); await fs.symlink(file + '.saved', file); }
    if (kind === 'hardlink') await fs.link(file, file + '.link');
    if (kind === 'writable') await fs.chmod(file, 0o666);
    if (kind === 'unsafe-storage') await fs.chmod(f.storage, 0o755);
    if (kind === 'occupied-storage') await fs.writeFile(join(f.storage, 'source-platform.node'), 'never overwrite');
    await expect(loadManagedSourcePlatform(f.parser, f.storage)).rejects.toThrow();
  });
});
