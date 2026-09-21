import { removeFixture } from "./fixture-cleanup.mjs";
import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fixture } from './bundle-fixture.js';
import { canonical, createBundleManifest, validateBundle, validateInstalledBundle, checkManifest, manifestDigest, sha256 } from '../scripts/bundle-contract.mjs';
import { installCompleteGeneration, inspectCompleteInstallation, recoverCompleteInstallation, rollbackCompleteGeneration, completeGenerationLauncher } from '../scripts/managed-installation.mjs';
import { doctorInstallation } from '../scripts/install-manager.mjs';

const worker = 'app/runtime/sandbox-worker-entry.js';
// Construct historical manifest bytes without using the new strict builder.
async function historical(root: string) {
 const current = (await validateBundle(root)).manifest;
 await fs.unlink(path.join(root, worker));
 const { digest: _digest, ...payload } = current;
 payload.inventory = payload.inventory.filter((entry: {path: string}) => entry.path !== worker);
 const manifest = { ...payload, digest: manifestDigest(payload) };
 await fs.writeFile(path.join(root, 'bundle-manifest.json'), canonical(manifest) + '\n');
 return manifest;
}

test('historical verification preserves exact inventory while new bundle admission stays strict', async () => {
 const root = await fixture();
 try {
  const manifest = await historical(root);
  expect((await validateInstalledBundle(root)).digest).toBe(manifest.digest);
  expect(() => checkManifest(manifest)).toThrow('Missing required entry: ' + worker);
  await expect(validateBundle(root)).rejects.toThrow('Missing required entry: ' + worker);
  await expect(createBundleManifest(root, manifest)).rejects.toThrow('Missing required entry: ' + worker);
  await fs.appendFile(path.join(root, 'app/main.js'), 'tampered');
  await expect(validateInstalledBundle(root)).rejects.toThrow('Bundle inventory mismatch');
 } finally { await removeFixture(root, { recursive: true, force: true }); }
});

test('historical verification cannot forgive a missing declared worker', async () => {
 const root = await fixture();
 try {
  await fs.unlink(path.join(root, worker));
  await expect(validateInstalledBundle(root)).rejects.toThrow('Bundle inventory mismatch');
 } finally { await removeFixture(root, { recursive: true, force: true }); }
});

async function setup() {
 const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'historical-install-')));
 const bundle = await fixture(), kiroHome = path.join(root, '.kiro');
 const opts = {kiroHome, userHome: root, env: {}, provenance: 'source', validateCandidate: async (candidate: string) => { await validateBundle(candidate); }};
 const installed = await installCompleteGeneration(bundle, opts);
 const oldRoot = path.join(installed.paths.runtime, installed.digest);
 const old = await historical(oldRoot);
 const retained = path.join(installed.paths.runtime, old.digest);
 await fs.rename(oldRoot, retained);
 // Model an already-owned historical installation, including its original
 // generation-bound controls. Production never rewrites retained manifests.
 const profile = (await fs.readFile(installed.paths.profile, 'utf8')).replaceAll(installed.digest, old.digest);
 const launcher = completeGenerationLauncher(old.digest);
 const owner = {...installed.owner, currentRuntime: old.digest, runtimeGenerations: [{name: old.digest, manifestSha256: sha256(canonical(old) + '\n')}], profileSha256: sha256(profile), launcherSha256: sha256(launcher)};
 await fs.writeFile(installed.paths.profile, profile);
 await fs.writeFile(installed.paths.launcher, launcher);
 await fs.writeFile(installed.paths.manifest, JSON.stringify(owner, null, 2) + '\n');
 const data = path.join(installed.paths.data, 'fabric/sentinel');
 await fs.writeFile(data, 'preserve user data', {mode: 0o600});
 return {root, bundle, kiroHome, opts, installed, old, retained, data,
  async cleanup() { await removeFixture(root, {recursive: true, force: true}); await removeFixture(bundle, {recursive: true, force: true}); }};
}

test.each([null, 'profile-published', 'owner-committed'])('upgrades owned pre-worker bundles with exact retention and recovery at %s', async phase => {
 const f = await setup();
 try {
  const before = await fs.readFile(path.join(f.retained, 'bundle-manifest.json'));
  expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('active');
  expect((await inspectCompleteInstallation(f.kiroHome, {verifyGenerations: false})).status).toBe('active');
  expect((await doctorInstallation(f.kiroHome, {PATH: ''})).checks.find(check => check.id === 'installation')?.status).toBe('PASS');
  // Merely being owned does not make an obsolete bundle eligible for activation.
  await expect(installCompleteGeneration(f.retained, f.opts)).rejects.toThrow('Missing required entry: ' + worker);
  if (phase) {
   await expect(installCompleteGeneration(f.bundle, {...f.opts, onPhase: (name: string) => { if (name === phase) throw Error('interrupted'); }})).rejects.toThrow('interrupted');
   await recoverCompleteInstallation(f.kiroHome);
   expect((await inspectCompleteInstallation(f.kiroHome)).owner.currentRuntime).toBe(phase === 'owner-committed' ? f.installed.digest : f.old.digest);
  }
  await installCompleteGeneration(f.bundle, f.opts);
  const state = await inspectCompleteInstallation(f.kiroHome);
  expect(state.owner.currentRuntime).toBe(f.installed.digest);
  expect(state.owner.previousRuntime).toBe(f.old.digest);
  expect(state.generations).toHaveLength(2);
  await expect(validateBundle(path.join(f.installed.paths.runtime, state.owner.currentRuntime))).resolves.toMatchObject({digest: f.installed.digest});
  expect(await fs.readFile(path.join(f.retained, 'bundle-manifest.json'))).toEqual(before);
  expect(await fs.readFile(f.data, 'utf8')).toBe('preserve user data');
  const controls = await fs.readFile(f.installed.paths.manifest);
  await expect(rollbackCompleteGeneration(f.kiroHome, {validateCandidate: f.opts.validateCandidate})).rejects.toThrow('Missing required entry: ' + worker);
  expect(await fs.readFile(f.installed.paths.manifest)).toEqual(controls);
 } finally { await f.cleanup(); }
});

test.each(['file', 'manifest'])('legacy %s tampering still blocks upgrade without changing controls', async kind => {
 const f = await setup();
 try {
  const controls = await fs.readFile(f.installed.paths.manifest);
  const target = path.join(f.retained, kind === 'file' ? 'app/main.js' : 'bundle-manifest.json');
  await fs.appendFile(target, 'tampered');
  await expect(installCompleteGeneration(f.bundle, f.opts)).rejects.toThrow(kind === 'file' ? 'Bundle inventory mismatch' : 'modified generation manifest');
  expect(await fs.readFile(f.installed.paths.manifest)).toEqual(controls);
  expect(await fs.readFile(f.data, 'utf8')).toBe('preserve user data');
 } finally { await f.cleanup(); }
});
