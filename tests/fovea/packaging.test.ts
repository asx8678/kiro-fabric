import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fixture, fixtureTools } from '../bundle-fixture.js';
import { canonical, compatibilityFor, checkManifest, checkInstalledManifest, checkToolPins, createBundleManifest, FOVEA_REQUIRED_APP, manifestDigest, sha256, validateBundle, validateInstalledBundle } from '../../scripts/bundle-contract.mjs';
import { acquirePrivateToolsForTest, extractPinnedMember, verifyPrivateToolCache } from '../../scripts/build-private-tools.mjs';
import { createBundleArchive } from '../../scripts/bundle-archive.mjs';
import { generateInstallerBootstrap } from '../../scripts/generate-installer-bootstrap.mjs';
import { smokeCandidate } from '../../scripts/installer-smoke.mjs';
import { generateBundleSbom } from '../../scripts/generate-bundle-sbom.mjs';
import { captureBuildInputs, assertBuildInputs } from '../../scripts/build-inputs.mjs';
import { validateAgentPackage } from '../../scripts/validate-agent-package.mjs';
import { resolveManagedFoveaParser } from '../../src/kiro/managed-generation.js';

const roots: string[] = [];
const toolchain = JSON.parse(syncFs.readFileSync('build-toolchain.json', 'utf8'));
const component = JSON.parse(syncFs.readFileSync('src/fovea/component.json', 'utf8'));
const sha512 = (bytes: Buffer) => 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const bytesFor = (name: string) => Buffer.from('fixture ' + name);
const context = (root: string) => ({ bundleRoot: root, expectedNode: path.join(root, 'tools/node'), rg: path.join(root, 'tools/rg') });
function tools() {
  const parser = structuredClone(toolchain.targets['linux-x64']['ast-grep']);
  parser.sha256 = sha256('archive'); parser.size = 7; parser.integrity = sha512(Buffer.from('archive'));
  for (const m of parser.members) { m.size = bytesFor(m.path).length; m.sha256 = sha256(bytesFor(m.path)); }
  return { ...fixtureTools(), 'ast-grep': parser };
}
async function put(root: string, name: string, bytes: Buffer | string) {
  const file = path.join(root, name);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, bytes, { mode: name.startsWith('tools/') ? 0o700 : 0o600 });
}
async function modern() {
  const root = await fixture(); roots.push(root);
  const prior = (await validateBundle(root)).manifest;
  const pins = tools();
  for (const name of FOVEA_REQUIRED_APP) if (!syncFs.existsSync(path.join(root, name))) await put(root, name, bytesFor(name));
  for (const m of pins['ast-grep'].members) await put(root, m.path, bytesFor(m.path));
  await put(root, 'app/closure-manifest.json', JSON.stringify({ packageInputs: [], vendoredComponents: [component] }));
  const manifest = await createBundleManifest(root, { ...prior, tools: pins, compatibility: compatibilityFor('linux-x64', 2) });
  await put(root, 'bundle-manifest.json', canonical(manifest) + '\n');
  return { root, manifest };
}
function resign(m: any) { const { digest: _, ...payload } = m; m.digest = manifestDigest(payload); return m; }
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

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
    const archive = await createBundleArchive(root, path.join(output, 'bundle.tgz'));
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
    const parent = await fs.mkdtemp(path.join(tmpdir(), 'fovea-stage-')); roots.push(parent); await fs.chmod(parent, 0o700);
    const root = path.join(parent, 'agent'); await fs.mkdir(root, { mode: 0o700 });
    await put(root, 'agent-product.json', await fs.readFile('agent-product.json'));
    await put(root, 'package.json', JSON.stringify({ name: 'kiro-fabric', version: '0.65.0', type: 'module', private: true, engines: { node: '>=24' }, scripts: { 'install:agent': 'node scripts/install-agent-user.mjs .' } }));
    for (const name of ['agent-profile.mjs', 'install-agent-user.mjs', 'validate-agent-package.mjs']) await put(root, 'scripts/' + name, await fs.readFile('scripts/' + name));
    await put(root, 'scripts/filesystem-boundary.mjs', await fs.readFile('src/installation/filesystem-boundary.mjs'));
    const product = JSON.parse(await fs.readFile('agent-product.json', 'utf8'));
    for (const name of product.bundledAgentResources) await put(root, name, 'fixture guidance');
    const names = [...new Set(FOVEA_REQUIRED_APP.filter((name: string) => name.startsWith('app/') && name !== 'app/closure-manifest.json').map((name: string) => name.slice(4)))].sort();
    const digest = createHash('sha256'); const files = [];
    for (const name of names) { const bytes = bytesFor(name); await put(root, 'runtime/' + name, bytes); digest.update(name).update('\0').update(bytes); files.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) }); }
    const closure = { schemaVersion: 1, product: 'kiro-fabric-agent', entrypoint: 'kiro/mcp-entry.js', compilerWorker: 'runtime/compiler-worker-entry.js', sandboxWorker: 'runtime/sandbox-worker-entry.js', foveaEngine: 'fovea/engine-entry.js', foveaHook: 'kiro/fovea-hook.js', executor: 'quickjs', files, contentDigest: digest.digest('hex'), packageInputs: [], vendoredComponents: [component] };
    await put(root, 'runtime/closure-manifest.json', JSON.stringify(closure));
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
