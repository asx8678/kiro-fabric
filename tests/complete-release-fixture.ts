import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { fixture, fixtureTools } from './bundle-fixture.js';
import { canonical, sha256, createBundleManifest, compatibilityFor, FOVEA_REQUIRED_APP, TARGETS } from '../scripts/bundle-contract.mjs';
import { writeBundleArchive } from '../scripts/bundle-archive.mjs';
import { generateBundleSbom } from '../scripts/generate-bundle-sbom.mjs';
import { releaseSigningBytes } from '../scripts/release-trust.mjs';
import { COMPLETE_GATES, completeQualificationSigningBytes } from '../scripts/complete-release-promotion.mjs';
const pins = JSON.parse(fs.readFileSync('build-toolchain.json', 'utf8'));
const COMMIT = 'a'.repeat(40);
export async function completeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'complete-release-test-')); fs.chmodSync(root, 0o700);
  const input = path.join(root, 'inputs'); fs.mkdirSync(input, { mode: 0o700 });
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const put = (name: string, bytes: Buffer | string) => { const file = path.join(input, name); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, bytes, { mode: 0o600 }); };
  const reports: Record<string, any> = {}, metadata: Record<string, any> = {};
  const resign = (target: string) => {
    const name = `kiro-fabric-1.0.0-${target}.tar.gz`;
    put(name + '.release.json', canonical(metadata[target]) + '\n');
    put(name + '.release.sig', sign(null, releaseSigningBytes(metadata[target]), keys.privateKey).toString('base64') + '\n');
    put(name + '.qualification.json', canonical(reports[target]) + '\n');
    put(name + '.qualification.sig', sign(null, completeQualificationSigningBytes(reports[target]), keys.privateKey).toString('base64') + '\n');
  };
  for (const target of TARGETS) {
    const bundle = await fixture(target);
    try {
      const putBundle = (name: string, bytes: Buffer | string) => { fs.mkdirSync(path.dirname(path.join(bundle, name)), { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(bundle, name), bytes, { mode: name.startsWith('tools/') ? 0o700 : 0o600 }); };
      const parser = structuredClone(pins.targets[target]['ast-grep']); parser.size = 7; parser.sha256 = sha256('archive'); parser.integrity = 'sha512-' + createHash('sha512').update('archive').digest('base64');
      for (const member of parser.members) { const bytes = Buffer.from('fixture ' + member.path); member.size = bytes.length; member.sha256 = sha256(bytes); putBundle(member.path, bytes); }
      for (const name of FOVEA_REQUIRED_APP) if (!fs.existsSync(path.join(bundle, name))) putBundle(name, 'fixture ' + name);
      const source = sha256('fixture native source');
      if (target.startsWith('darwin-')) {
        const bytes = Buffer.alloc(32); bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(target.endsWith('arm64') ? 0x0100000c : 0x01000007, 4); bytes.writeUInt32LE(8, 12);
        putBundle('app/fovea/source-platform.node', bytes);
        putBundle('app/fovea/source-platform.json', JSON.stringify({ schemaVersion: 1, abiVersion: 1, platform: 'darwin', arch: target.slice(7), minimumMacOS: '13.5', sourceSha256: source, sha256: sha256(bytes) }));
      }
      const paths: string[] = [];
      const walk = (dir: string) => { for (const n of fs.readdirSync(path.join(bundle, 'app', dir))) { const rel = path.posix.join(dir, n); if (fs.statSync(path.join(bundle, 'app', rel)).isDirectory()) walk(rel); else if (rel !== 'closure-manifest.json') paths.push(rel); } }; walk(''); paths.sort();
      const digest = createHash('sha256');
      const files = paths.map(name => { const bytes = fs.readFileSync(path.join(bundle, 'app', name)); digest.update(name).update('\0').update(bytes); return { path: name, bytes: bytes.length, sha256: sha256(bytes) }; });
      const inputs = [{ path: 'src/fovea/source-platform-native.c', sha256: source }];
      putBundle('app/closure-manifest.json', JSON.stringify({ schemaVersion: 1, files, contentDigest: digest.digest('hex'), packageInputs: [], buildInputs: { schemaVersion: 1, files: inputs, digest: sha256(JSON.stringify(inputs)) } }));
      const manifest = await createBundleManifest(bundle, { version: '1.0.0', target, compatibility: compatibilityFor(target, 2), provenance: { kind: 'release', sourceCommit: COMMIT }, tools: { ...fixtureTools(target), 'ast-grep': parser } });
      putBundle('bundle-manifest.json', canonical(manifest) + '\n');
      const name = `kiro-fabric-1.0.0-${target}.tar.gz`;
      await writeBundleArchive(bundle, path.join(input, name));
      const archive = fs.readFileSync(path.join(input, name));
      const sbom = Buffer.from(JSON.stringify(await generateBundleSbom(bundle), null, 2) + '\n'); put(name + '.spdx.json', sbom);
      const m = { schema: 1, product: 'kiro-fabric', target, version: '1.0.0', sourceCommit: COMMIT, bundleDigest: manifest.digest, compatibility: manifest.compatibility,
        archive: { url: `https://github.com/asx8678/kiro-fabric/releases/download/v1.0.0/${name}`, size: archive.length, sha256: sha256(archive) }, sbom: { size: sbom.length, sha256: sha256(sbom) } }; metadata[target] = m;
      const host = { platform: target.split('-')[0], arch: target.split('-')[1], machine: target.endsWith('arm64') ? 'arm64' : 'x86_64', translated: target.startsWith('darwin') ? '0' : null };
      const gateChecks: Record<string, string[]> = {
        native: ['privateTools','nativeAddon','reproducibleArchive'], installed: ['exactArchiveInstalled','independence','upgradeRollback','crashRecovery','noOrphans'],
        client: ['authoritativeToolInventory','acceptedEdit','declinedEdit','acceptedShell','declinedShell','workspaceRevocation','compaction','resume','shutdown'],
        'minimum-system': ['minimumOS','minimumLibcOrMacOS','minimumKiro','privateTools'],
      };
      const raw = Buffer.from(JSON.stringify({ kind: 'explicit-unit-fixture-not-live-qualification', target })); put(`witnesses/${sha256(raw)}.json`, raw);
      const gates = COMPLETE_GATES.map(gate => {
        const bytes = Buffer.from(JSON.stringify({ schema: 1, kind: `kiro-fabric.complete-${gate}-evidence`, target, sourceCommit: COMMIT, archiveSha256: m.archive.sha256, bundleDigest: m.bundleDigest, host,
          checks: Object.fromEntries(gateChecks[gate]!.map(check => [check, true])), witnesses: [{ size: raw.length, sha256: sha256(raw) }] }));
        put(`${target}/${gate}.json`, bytes); return { gate, status: 'passed', evidence: { size: bytes.length, sha256: sha256(bytes) } };
      });
      reports[target] = { schema: 1, kind: 'kiro-fabric.complete-qualification', target, version: '1.0.0', sourceCommit: COMMIT, bundleDigest: m.bundleDigest, archiveSha256: m.archive.sha256, metadataSha256: sha256(canonical(m) + '\n'), gates };
      resign(target);
    } finally { removeFixtureSync(bundle, { recursive: true, force: true }); }
  }
  return { root, input, publicKey, reports, metadata, put, resign, output: path.join(root, 'published'), expected: { commit: COMMIT, version: '1.0.0' } };
}
