import { removeFixture } from "../fixture-cleanup.mjs";
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fixture, fixtureTools } from '../bundle-fixture.js';
import { canonical, compatibilityFor, checkManifest, checkInstalledManifest, checkToolPins, createBundleManifest, FOVEA_REQUIRED_APP, manifestDigest, sha256, validateBundle, validateInstalledBundle } from '../../scripts/bundle-contract.mjs';
import { acquirePrivateToolsForTest, extractPinnedMember, verifyPrivateToolCache } from '../../scripts/build-private-tools.mjs';
import { writeBundleArchive } from '../../scripts/bundle-archive.mjs';
import { generateInstallerBootstrap } from '../../scripts/generate-installer-bootstrap.mjs';
import { smokeCandidate } from '../../scripts/installer-smoke.mjs';
import { generateBundleSbom } from '../../scripts/generate-bundle-sbom.mjs';
import { captureBuildInputs, assertBuildInputs } from '../../scripts/build-inputs.mjs';
import { validateAgentPackage } from '../../scripts/validate-agent-package.mjs';
import { resolveManagedFoveaParser } from '../../src/kiro/managed-generation.js';
import { installCompleteGeneration, inspectCompleteInstallation, recoverCompleteInstallation, completeGenerationLauncher } from '../../scripts/managed-installation.mjs';

const roots: string[] = [];
const toolchain = JSON.parse(syncFs.readFileSync('build-toolchain.json', 'utf8'));
const component = JSON.parse(syncFs.readFileSync('src/fovea/component.json', 'utf8'));
const sha512 = (bytes: Buffer) => 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const bytesFor = (name: string) => Buffer.from('fixture ' + name);
const context = (root: string) => ({ bundleRoot: root, expectedNode: path.join(root, 'tools/node'), rg: path.join(root, 'tools/rg') });
function tools(target = 'linux-x64') {
  const parser = structuredClone(toolchain.targets[target]['ast-grep']);
  parser.sha256 = sha256('archive'); parser.size = 7; parser.integrity = sha512(Buffer.from('archive'));
  for (const m of parser.members) { m.size = bytesFor(m.path).length; m.sha256 = sha256(bytesFor(m.path)); }
  return { ...fixtureTools(target), 'ast-grep': parser };
}
async function put(root: string, name: string, bytes: Buffer | string) {
  const file = path.join(root, name);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, bytes, { mode: name.startsWith('tools/') ? 0o700 : 0o600 });
}
async function modern(target = 'linux-x64') {
  const root = await fixture(target); roots.push(root);
  const prior = (await validateBundle(root)).manifest;
  const pins = tools(target);
  for (const name of FOVEA_REQUIRED_APP) if (!syncFs.existsSync(path.join(root, name))) await put(root, name, bytesFor(name));
  for (const m of pins['ast-grep'].members) await put(root, m.path, bytesFor(m.path));
  const native = target.startsWith('darwin-') ? nativeArtifact(target.slice(7)) : undefined;
  if (native) {
    await put(root, 'app/fovea/source-platform.node', native.bytes);
    await put(root, 'app/fovea/source-platform.json', JSON.stringify(native.metadata));
  }
  await put(root, 'app/closure-manifest.json', JSON.stringify({ packageInputs: [], vendoredComponents: [component], ...(native ? { buildInputs: native.buildInputs } : {}) }));
  const manifest = await createBundleManifest(root, { ...prior, tools: pins, compatibility: compatibilityFor(target, 2) });
  await put(root, 'bundle-manifest.json', canonical(manifest) + '\n');
  return { root, manifest };
}
function resign(m: any) { const { digest: _, ...payload } = m; m.digest = manifestDigest(payload); return m; }
afterEach(async () => { vi.unstubAllGlobals(); for (const root of roots.splice(0)) await removeFixture(root, { recursive: true, force: true }); });
function nativeArtifact(arch: string) {
  const bytes = Buffer.alloc(32); bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4); bytes.writeUInt32LE(8, 12);
  const sourceSha256 = sha256('fixture native source');
  return { bytes, metadata: { schemaVersion: 1, abiVersion: 1, platform: 'darwin', arch, minimumMacOS: '13.5', sourceSha256, sha256: sha256(bytes) },
    buildInputs: { files: [{ path: 'src/fovea/source-platform-native.c', sha256: sourceSha256 }] } };
}
async function writeClosure(root: string, closure: any) {
  const digest = createHash('sha256');
  for (const entry of closure.files) {
    const bytes = await fs.readFile(path.join(root, 'runtime', entry.path));
    entry.bytes = bytes.length; entry.sha256 = sha256(bytes); digest.update(entry.path).update('\0').update(bytes);
  }
  closure.contentDigest = digest.digest('hex');
  await put(root, 'runtime/closure-manifest.json', JSON.stringify(closure));
}
async function agentFixture(native = process.platform === 'darwin', arch = process.arch) {
  const parent = await fs.mkdtemp(path.join(tmpdir(), 'fovea-stage-')); roots.push(parent); await fs.chmod(parent, 0o700);
  const root = path.join(parent, 'agent'); await fs.mkdir(root, { mode: 0o700 });
  await put(root, 'agent-product.json', await fs.readFile('agent-product.json'));
  await put(root, 'package.json', JSON.stringify({ name: 'kiro-fabric', version: '0.65.0', type: 'module', private: true, engines: { node: '>=24' }, scripts: { 'install:agent': 'node scripts/install-agent-user.mjs .' } }));
  for (const name of ['agent-profile.mjs', 'install-agent-user.mjs', 'validate-agent-package.mjs']) await put(root, 'scripts/' + name, await fs.readFile('scripts/' + name));
  await put(root, 'scripts/filesystem-boundary.mjs', await fs.readFile('src/installation/filesystem-boundary.mjs'));
  const product = JSON.parse(await fs.readFile('agent-product.json', 'utf8'));
  for (const name of product.bundledAgentResources) await put(root, name, 'fixture guidance');
  const names = [...new Set(FOVEA_REQUIRED_APP.filter((name: string) => name.startsWith('app/') && name !== 'app/closure-manifest.json').map((name: string) => name.slice(4)))].sort();
  const files = [];
  for (const name of names) { await put(root, 'runtime/' + name, bytesFor(name)); files.push({ path: name, bytes: 0, sha256: '' }); }
  const artifact = nativeArtifact(arch);
  if (native) for (const [name, bytes] of [['fovea/source-platform.node', artifact.bytes], ['fovea/source-platform.json', JSON.stringify(artifact.metadata)]] as const) {
    await put(root, 'runtime/' + name, bytes); files.push({ path: name, bytes: 0, sha256: '' });
  }
  const closure = { schemaVersion: 1, product: 'kiro-fabric-agent', entrypoint: 'kiro/mcp-entry.js', compilerWorker: 'runtime/compiler-worker-entry.js', sandboxWorker: 'runtime/sandbox-worker-entry.js', foveaEngine: 'fovea/engine-entry.js', foveaHook: 'kiro/fovea-hook.js', executor: 'quickjs', files, contentDigest: '', packageInputs: [], vendoredComponents: [component], buildInputs: artifact.buildInputs };
  await writeClosure(root, closure);
  return { root, parent, closure };
}
// Rehash attacker edits, so rejection must come from semantic admission rather
// than the generic inventory checksum. No native fixture bytes are executed.
async function rehashBundle(root: string, manifest: any) {
  for (const entry of [...manifest.inventory]) {
    const file = path.join(root, entry.path);
    if (!syncFs.existsSync(file)) { manifest.inventory.splice(manifest.inventory.indexOf(entry), 1); continue; }
    const bytes = await fs.readFile(file); entry.size = bytes.length; entry.sha256 = sha256(bytes);
  }
  await put(root, 'bundle-manifest.json', canonical(resign(manifest)) + '\n');
}
const nativeChanges = ['missing-binary', 'missing-metadata', 'missing-both', 'binary-hash', 'metadata-arch', 'metadata-source', 'missing-source', 'duplicate-source', 'source-hash', 'mach-arch', 'mach-type', 'mach-magic', 'metadata-schema', 'metadata-extra'] as const;
async function changeNative(root: string, prefix: string, kind: typeof nativeChanges[number], closure: any) {
  const binary = prefix + '/fovea/source-platform.node', metadata = prefix + '/fovea/source-platform.json';
  if (kind.startsWith('missing-') && kind !== 'missing-source') {
    for (const file of kind === 'missing-both' ? [binary, metadata] : [kind === 'missing-binary' ? binary : metadata]) await removeFixture(path.join(root, file));
    return;
  }
  const m = JSON.parse(await fs.readFile(path.join(root, metadata), 'utf8'));
  if (kind === 'binary-hash') await fs.appendFile(path.join(root, binary), 'tamper');
  if (kind === 'metadata-arch') m.arch = m.arch === 'arm64' ? 'x64' : 'arm64';
  if (kind === 'metadata-source') m.sourceSha256 = sha256('other');
  if (kind === 'metadata-schema') m.schemaVersion = 2;
  if (kind === 'metadata-extra') m.extra = true;
  if (kind === 'missing-source') closure.buildInputs.files = [];
  if (kind === 'duplicate-source') closure.buildInputs.files.push({ ...closure.buildInputs.files[0] });
  if (kind === 'source-hash') closure.buildInputs.files[0].sha256 = sha256('other');
  if (kind.startsWith('mach-')) {
    const bytes = await fs.readFile(path.join(root, binary));
    bytes.writeUInt32LE(kind === 'mach-arch' ? (m.arch === 'arm64' ? 0x01000007 : 0x0100000c) : 2, kind === 'mach-arch' ? 4 : kind === 'mach-type' ? 12 : 0);
    await put(root, binary, bytes); m.sha256 = sha256(bytes);
  }
  await put(root, metadata, JSON.stringify(m));
}

describe('Darwin native package admission (no dlopen)', () => {
  it.each(['darwin-arm64', 'darwin-x64'])('validates exact %s bytes independently of the running host', async target => {
    const { root, manifest } = await modern(target);
    expect((await validateBundle(root)).digest).toBe(manifest.digest);
    expect((await validateInstalledBundle(root)).digest).toBe(manifest.digest);
  });
  it.each(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'])('keeps historical two-tool %s bundles valid without native source assets', async target => {
    const root = await fixture(target); roots.push(root);
    expect((await validateBundle(root)).manifest.schema).toBe(1);
    expect((await validateInstalledBundle(root)).manifest.schema).toBe(1);
  });
  it.each(['linux-arm64', 'linux-x64'])('does not require Darwin artifacts for schema-2 %s', async target => {
    const { root } = await modern(target);
    expect((await validateBundle(root)).manifest.schema).toBe(2);
  });
  it.each(nativeChanges)('rejects rehashed complete-bundle %s before installation or native load', async kind => {
    const { root, manifest } = await modern('darwin-arm64');
    const closure = JSON.parse(await fs.readFile(path.join(root, 'app/closure-manifest.json'), 'utf8'));
    await changeNative(root, 'app', kind, closure);
    await put(root, 'app/closure-manifest.json', JSON.stringify(closure));
    await rehashBundle(root, manifest);
    if (kind.startsWith('missing-') && kind !== 'missing-source') {
      expect(() => checkManifest(manifest)).toThrow(/Missing required entry/);
      if (kind !== 'missing-both') expect(() => checkInstalledManifest(manifest)).toThrow(/Missing required entry/);
    }
    await expect(createBundleManifest(root, manifest)).rejects.toThrow();
    await expect(validateBundle(root)).rejects.toThrow();
    if (kind === 'missing-both') {
      // Historical shape verification is not new admission or owner authority.
      expect((await validateInstalledBundle(root)).digest).toBe(manifest.digest);
    } else await expect(validateInstalledBundle(root)).rejects.toThrow();
  });
  it.each(['arm64', 'x64'] as const)('admits the current standalone Darwin %s closure with exact artifacts', async arch => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'darwin' }, arch: { value: arch } }));
    const { root } = await agentFixture(true, arch);
    expect(validateAgentPackage(root).ok).toBe(true);
  });
  it('preserves current standalone Linux packages without Darwin artifacts', async () => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'linux' } }));
    const { root } = await agentFixture(false);
    expect(validateAgentPackage(root).ok).toBe(true);
  });
  it.each(nativeChanges)('rejects rehashed standalone Darwin %s', async kind => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'darwin' }, arch: { value: 'arm64' } }));
    const { root, closure } = await agentFixture(true, 'arm64');
    await changeNative(root, 'runtime', kind, closure);
    closure.files = closure.files.filter(e => syncFs.existsSync(path.join(root, 'runtime', e.path)));
    await writeClosure(root, closure);
    expect(() => validateAgentPackage(root)).toThrow(/Native source/);
  });
});

describe('owner-bound pre-native Darwin schema-2 retention', () => {
  it.each([null, 'profile-published', 'owner-committed'])('preserves exact old bytes through upgrade/recovery at %s', async phase => {
    const { root, manifest } = await modern('darwin-arm64');
    const home = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'fovea-old-darwin-')));
    roots.push(home); await fs.chmod(home, 0o700);
    const kiroHome = path.join(home, '.kiro');
    const options = { kiroHome, userHome: home, env: {}, provenance: 'source', validateCandidate: async () => {} };
    const installed = await installCompleteGeneration(root, options);
    const oldRoot = path.join(installed.paths.runtime, installed.digest), old = structuredClone(manifest);
    for (const name of ['source-platform.node', 'source-platform.json']) await fs.unlink(path.join(oldRoot, 'app/fovea', name));
    // A declared file can never disappear under the historical reader.
    await expect(validateInstalledBundle(oldRoot)).rejects.toThrow();
    await rehashBundle(oldRoot, old);
    const retained = path.join(installed.paths.runtime, old.digest);
    await fs.rename(oldRoot, retained);
    // Model original owner-bound historical controls, not production reanchoring.
    const profile = (await fs.readFile(installed.paths.profile, 'utf8')).replaceAll(installed.digest, old.digest);
    const launcher = completeGenerationLauncher(old.digest);
    const owner = { ...installed.owner, currentRuntime: old.digest,
      runtimeGenerations: [{ name: old.digest, manifestSha256: sha256(canonical(old) + '\n') }],
      profileSha256: sha256(profile), launcherSha256: sha256(launcher) };
    await fs.writeFile(installed.paths.profile, profile);
    await fs.writeFile(installed.paths.launcher, launcher);
    await fs.writeFile(installed.paths.manifest, JSON.stringify(owner, null, 2) + '\n');
    const before = await fs.readFile(path.join(retained, 'bundle-manifest.json'));
    expect((await inspectCompleteInstallation(kiroHome)).status).toBe('active');
    expect((await inspectCompleteInstallation(kiroHome, { verifyGenerations: false })).status).toBe('active');
    await expect(installCompleteGeneration(retained, options)).rejects.toThrow('Missing required entry: app/fovea/source-platform.node');
    if (phase) {
      await expect(installCompleteGeneration(root, { ...options, onPhase(name: string) { if (name === phase) throw Error('fixture interrupted'); } })).rejects.toThrow('fixture interrupted');
      await recoverCompleteInstallation(kiroHome);
      expect((await inspectCompleteInstallation(kiroHome)).owner.currentRuntime).toBe(phase === 'owner-committed' ? manifest.digest : old.digest);
    }
    await installCompleteGeneration(root, options);
    expect((await inspectCompleteInstallation(kiroHome)).generations).toHaveLength(2);
    expect(await fs.readFile(path.join(retained, 'bundle-manifest.json'))).toEqual(before);
    const controls = await fs.readFile(installed.paths.manifest);
    await fs.appendFile(path.join(retained, 'bundle-manifest.json'), ' ');
    await expect(inspectCompleteInstallation(kiroHome)).rejects.toThrow('modified generation manifest');
    expect(await fs.readFile(installed.paths.manifest)).toEqual(controls);
  });
});

describe('F22 native generation packaging', () => {
  it('pins all four exact npm platform artifacts without PATH selection', () => {
    const upstream = JSON.parse(syncFs.readFileSync('src/fovea/upstream.json', 'utf8'));
    for (const [target, pins] of Object.entries(toolchain.targets) as [string, any][]) {
      checkToolPins(pins, undefined, target, 2);
      const parser = pins['ast-grep'];
      const packageName = '@ast-grep/cli-' + target + (target.startsWith('linux') ? '-gnu' : '') + '@0.45.3';
      expect(parser.integrity).toBe(upstream.parser.acquisitionEvidence.integrity[packageName]);
      expect(parser.version).toBe('0.45.3');
      expect(parser.members.map((m: any) => m.path)).toEqual(['tools/ast-grep', 'notices/ast-grep-package.json', 'notices/ast-grep-README.md']);
    }
    expect(sha256(syncFs.readFileSync('src/fovea/ast-grep-LICENSE.txt'))).toBe(component.parser.licenseSha256);
  });
  it('binds the measured x64 GLIBC_2.34 floor only to new generations', async () => {
    expect(compatibilityFor('linux-x64', 1).minGlibc).toBe('2.28');
    expect(compatibilityFor('linux-x64', 2).minGlibc).toBe('2.34');
    expect(compatibilityFor('linux-arm64', 2).minGlibc).toBe('2.28');
    const { manifest } = await modern();
    manifest.compatibility.minGlibc = '2.28';
    expect(() => checkManifest(resign(manifest))).toThrow(/Compatibility/);
  });
  it('generates a bootstrap enforcing the signed schema-2 glibc floor without executing an installer', async () => {
    const { root, manifest } = await modern();
    const sourceCommit = 'a'.repeat(40);
    const release = await createBundleManifest(root, { ...manifest, provenance: { kind: 'release', sourceCommit } });
    await put(root, 'bundle-manifest.json', canonical(release) + '\n');
    const output = await fs.mkdtemp(path.join(tmpdir(), 'fovea-bootstrap-')); roots.push(output);
    const archive = await writeBundleArchive(root, path.join(output, 'bundle.tgz'));
    const archiveBytes = await fs.readFile(archive.path); const sbomBytes = Buffer.from('{}');
    const metadata = { schema: 1, product: 'kiro-fabric', target: 'linux-x64', version: release.version, sourceCommit, bundleDigest: release.digest, compatibility: release.compatibility, archive: { url: `https://github.com/asx8678/kiro-fabric/releases/download/v${release.version}/kiro-fabric-${release.version}-linux-x64.tar.gz`, size: archive.size, sha256: archive.sha256 }, sbom: { size: sbomBytes.length, sha256: sha256(sbomBytes) } };
    const script = generateInstallerBootstrap([{ metadata, archiveBytes, sbomBytes }]);
    expect(script).toContain("glibc_min='2.34'");
    expect(script).toContain('version_floor "$libc" "${glibc_min%%.*}" "${glibc_min#*.}"');
    await fs.writeFile(path.join(output, 'bootstrap.sh'), script);
    const syntax = spawnSync('/bin/bash', ['-n', path.join(output, 'bootstrap.sh')], { encoding: 'utf8', timeout: 15000 });
    expect(syntax.error).toBeUndefined(); expect(syntax.status, syntax.stderr).toBe(0);
    const floor = script.slice(script.indexOf('version_floor() {'), script.indexOf('if [ "$os" = Linux ]; then'));
    const probe = spawnSync('/bin/bash', ['-c', floor + '\nglibc_min=2.34\nversion_floor 2.28 "${glibc_min%%.*}" "${glibc_min#*.}" && exit 9\nversion_floor 2.34 "${glibc_min%%.*}" "${glibc_min#*.}"'], { encoding: 'utf8', timeout: 15000 });
    expect(probe.error).toBeUndefined(); expect(probe.status, probe.stderr).toBe(0);
  });
  it('requires both exact entrypoints, metadata, license and model resource', () => {
    const product = JSON.parse(syncFs.readFileSync('agent-product.json', 'utf8'));
    expect(product.runtimeAssets.foveaEngine).toBe('src/fovea/engine-entry.ts');
    expect(product.runtimeAssets.foveaHook).toBe('src/kiro/fovea-hook.ts');
    expect(product.bundledAgentResources).toContain('skills/fabric-exec/references/fovea.md');
    expect(product.allowedPackageDependencies.some((p: string) => /pi-fovea|pi-fabric|ast-grep/.test(p))).toBe(false);
  });
  it('admits schema 2 and resolves a generation-bound parser descriptor', async () => {
    const { root, manifest } = await modern();
    expect(manifest.schema).toBe(2);
    expect((await validateBundle(root)).digest).toBe(manifest.digest);
    expect(await resolveManagedFoveaParser(context(root))).toEqual({ path: path.join(root, 'tools/ast-grep'), sha256: sha256(bytesFor('tools/ast-grep')), version: '0.45.3', generationRoot: root });
    await expect(resolveManagedFoveaParser({ ...context(root), rg: '/usr/bin/rg' })).rejects.toThrow(/containment/);
    await fs.appendFile(path.join(root, 'tools/ast-grep'), 'tamper');
    await expect(resolveManagedFoveaParser(context(root))).rejects.toThrow();
  });
  it('keeps two-tool historical generations valid for rollback and does not invent a parser', async () => {
    const root = await fixture(); roots.push(root);
    const old = await validateBundle(root);
    expect(old.manifest.schema).toBe(1);
    expect((await validateInstalledBundle(root)).digest).toBe(old.digest);
    expect(() => checkInstalledManifest(old.manifest)).not.toThrow();
    expect(await resolveManagedFoveaParser(context(root))).toBeUndefined();
  });
  it('does not let historical validation bypass any new required asset', async () => {
    const { manifest } = await modern();
    for (const name of FOVEA_REQUIRED_APP) {
      const changed = structuredClone(manifest);
      changed.inventory = changed.inventory.filter((e: any) => e.path !== name);
      resign(changed);
      expect(() => checkManifest(changed), name).toThrow();
      expect(() => checkInstalledManifest(changed), name).toThrow();
    }
  });
  it('rejects downgrade smuggling, unknown schema, extra fields and 0.45.2 pins', async () => {
    const { manifest } = await modern();
    const changes = [
      (m: any) => { m.schema = 1; }, (m: any) => { m.schema = 3; },
      (m: any) => { m.tools['ast-grep'].version = '0.45.2'; },
      (m: any) => { m.tools['ast-grep'].extra = true; },
      (m: any) => { m.tools['ast-grep'].members[0].member = 'package/sg'; },
      (m: any) => { m.tools['ast-grep'].url = toolchain.targets['darwin-arm64']['ast-grep'].url; },
      (m: any) => { delete m.tools['ast-grep']; },
    ];
    for (const change of changes) { const m = structuredClone(manifest); change(m); expect(() => checkManifest(resign(m))).toThrow(); }
  });
  it('acquires only fixed members and verifies the complete private-tool cache', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'fovea-tools-')); roots.push(root); await fs.chmod(root, 0o700);
    const pins = tools(); const requested: string[] = [];
    await acquirePrivateToolsForTest('linux-x64', root, { pins, qualification: {}, download: async () => Buffer.from('archive'), extract: (_archive: string, member: string, max?: number) => {
      requested.push(member); const m = Object.values(pins).flatMap((p: any) => p.members).find((m: any) => m.member === member)!;
      expect(max).toBe(m.size); return bytesFor(m.path);
    } });
    expect(requested).toContain('package/ast-grep'); expect(requested).not.toContain('package/sg');
    await verifyPrivateToolCache(root, pins, 'linux-x64');
    await fs.writeFile(path.join(root, 'tools/ast-grep'), 'bad');
    await expect(verifyPrivateToolCache(root, pins, 'linux-x64')).rejects.toThrow();
  });
  it.each(['archive', 'integrity', 'member'])('rejects changed parser %s before publishing any tools', async (kind) => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'fovea-bad-tools-')); roots.push(root); await fs.chmod(root, 0o700);
    const pins = tools();
    if (kind === 'integrity') pins['ast-grep'].integrity = sha512(Buffer.from('other'));
    await expect(acquirePrivateToolsForTest('linux-x64', root, { pins, qualification: {}, download: async (url: string) => Buffer.from(kind === 'archive' && url.includes('ast-grep') ? 'corrupt' : 'archive'), extract: (_archive: string, member: string) => {
      const m = Object.values(pins).flatMap((p: any) => p.members).find((m: any) => m.member === member)!;
      return kind === 'member' && member === 'package/ast-grep' ? Buffer.from('corrupt') : bytesFor(m.path);
    } })).rejects.toThrow(/mismatch/);
    expect(await fs.readdir(root)).toEqual([]);
  });
  it.each(['ast-grep 0.45.2', 'ast-grep 0.45.3\\nextra'])('rejects parser version output %s before backend smoke/activation', async (version) => {
    const { root, manifest } = await modern();
    for (const [tool, output] of [['node', 'v24.20.0'], ['rg', 'ripgrep 14.1.1'], ['ast-grep', version]] as const) {
      const bytes = Buffer.from(`#!/bin/sh\nprintf '${output}\\n'\n`);
      await put(root, 'tools/' + tool, bytes);
      const member = manifest.tools[tool].members.find((m: any) => m.path === 'tools/' + tool);
      member.size = bytes.length; member.sha256 = sha256(bytes);
    }
    const next = await createBundleManifest(root, manifest);
    await put(root, 'bundle-manifest.json', canonical(next) + '\n');
    await expect(smokeCandidate(root)).rejects.toThrow('Candidate private ast-grep version/compatibility check failed');
  });
  it('attributes vendored Fovea and pinned native parser in the complete SBOM', async () => {
    const { root } = await modern(); const sbom = await generateBundleSbom(root);
    expect(sbom.packages).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'fovea-vendored-core', versionInfo: '0.29.2', licenseDeclared: 'MIT', downloadLocation: expect.stringContaining(component.commit) }),
      expect.objectContaining({ name: 'ast-grep', versionInfo: '0.45.3', checksums: [{ algorithm: 'SHA256', checksumValue: sha256(bytesFor('tools/ast-grep')) }] }),
    ]));
  });
  it('stages explicit Fovea assets and emits agent SBOM attribution without npm Pi dependencies', async () => {
    const { root, parent, closure } = await agentFixture();
    expect(validateAgentPackage(root).ok).toBe(true);
    const output = path.join(parent, 'agent.spdx.json');
    const result = spawnSync(process.execPath, ['scripts/generate-agent-sbom.mjs', '--package', root, '--output', output], { encoding: 'utf8', timeout: 15000 });
    expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(0);
    const sbom = JSON.parse(await fs.readFile(output, 'utf8'));
    expect(sbom.packages).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'fovea-vendored-core', licenseDeclared: 'MIT' })]));
    closure.vendoredComponents = [];
    await put(root, 'runtime/closure-manifest.json', JSON.stringify(closure));
    expect(() => validateAgentPackage(root)).toThrow('Fovea attribution missing');
  });
  it('captures Fovea sources, metadata, resources and SBOM implementation for reuse invalidation', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'fovea-inputs-')); roots.push(root);
    for (const name of ['scripts', 'src', 'skills', 'resources']) await fs.cp(name, path.join(root, name), { recursive: true });
    for (const name of ['package.json', 'pnpm-lock.yaml', 'agent-product.json', 'build-toolchain.json', 'tsconfig.json', 'tsconfig.build.json']) await fs.copyFile(name, path.join(root, name));
    const capture = captureBuildInputs(root);
    for (const name of ['src/fovea/component.json', 'src/fovea/upstream.json', 'src/fovea/core/astgrep.ts', 'build-toolchain.json', 'scripts/generate-vendored-sbom.mjs']) {
      expect(capture.files.some((f: any) => f.path === name)).toBe(true);
      const original = await fs.readFile(path.join(root, name)); await fs.appendFile(path.join(root, name), '\nchanged');
      expect(() => assertBuildInputs(root, capture)).toThrow(/changed/);
      await fs.writeFile(path.join(root, name), original);
    }
  });
});

// Developer evidence only; CI without acquired archives skips rather than claims
// execution or substitutes PATH. These artifacts are not committed or installed.
it.skipIf(!syncFs.existsSync('.tmp/fovea-parser/linux-x64.tgz'))('reverifies acquired full archives and fixed members; executes only the native target', () => {
  for (const [target, pins] of Object.entries(toolchain.targets) as [string, any][]) {
    const archive = path.resolve('.tmp/fovea-parser', target + '.tgz'); const bytes = syncFs.readFileSync(archive); const pin = pins['ast-grep'];
    expect(bytes.length).toBe(pin.size); expect(sha256(bytes)).toBe(pin.sha256); expect(sha512(bytes)).toBe(pin.integrity);
    for (const m of pin.members) { const bytes = extractPinnedMember(archive, m.member, m.size); expect(bytes.length).toBe(m.size); expect(sha256(bytes)).toBe(m.sha256); }
  }
  const native = toolchain.targets[process.platform + '-' + process.arch]['ast-grep'];
  const executable = path.resolve('.tmp/fovea-parser/ast-grep');
  expect(sha256(syncFs.readFileSync(executable))).toBe(native.members[0].sha256);
  const result = spawnSync(executable, ['--version'], { encoding: 'utf8', env: { PATH: '/unavailable' }, timeout: 15000 });
  expect(result.error).toBeUndefined(); expect(result.status).toBe(0); expect(result.stdout).toBe('ast-grep 0.45.3\n');
});
