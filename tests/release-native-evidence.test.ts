import { test, expect } from 'vitest';
import { rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertNativeHost, checkProbeResult, assertExactArchive, collectNativeBundleEvidence } from '../scripts/release-native-evidence.mjs';
import { createBundleArchive } from '../scripts/bundle-archive.mjs';
import { validateBundle } from '../scripts/bundle-contract.mjs';
import { fixture } from './bundle-fixture.js';

for (const [target, machine] of [['darwin-arm64', 'arm64'], ['darwin-x64', 'x86_64'], ['linux-arm64', 'aarch64'], ['linux-x64', 'x86_64']] as const) {
  test(`requires real ${target} host identity`, () => {
    const [platform, arch] = target.split('-');
    const host = { platform, arch, machine, translated: '0' };
    expect(() => assertNativeHost(target, host)).not.toThrow();
    expect(() => assertNativeHost(target, { ...host, arch: 'other' })).toThrow(/Native target/);
    expect(() => assertNativeHost(target, { ...host, machine: 'other' })).toThrow(/Native target/);
    if (platform === 'darwin') {
      for (const translated of ['1', null, '', 'unknown']) expect(() => assertNativeHost(target, { ...host, translated })).toThrow(/translation/);
    }
  });
}

test.each([
  { status: 1, signal: null },
  { status: null, signal: 'SIGTERM' },
  { status: 0, error: { code: 'ETIMEDOUT' } },
  { status: null, error: { code: 'ENOENT' } },
])('failed and timed-out spawns never become evidence: %j', result => {
  expect(() => checkProbeResult('test', { stdout: '', stderr: '', ...result })).toThrow(/Native probe test failed/);
});

test('records successful bounded probe output without manufacturing a release pass', () => {
  expect(checkProbeResult('version', { status: 0, stdout: 'v24.20.0\n', stderr: '' })).toEqual({ name: 'version', exitCode: 0, stdout: 'v24.20.0', stderr: '' });
});

test('exact archive is parsed and bound to selected bundle, not merely a supplied digest', async () => {
  const root = await fixture();
  const archive = `${root}.tar.gz`;
  try {
    const bundle = await validateBundle(root);
    await createBundleArchive(root, archive);
    const bytes = await readFile(archive);
    expect(assertExactArchive(bytes, bundle.digest)).toMatchObject({ size: bytes.length, bundleDigest: bundle.digest });
    expect(() => assertExactArchive(bytes, '0'.repeat(64))).toThrow(/does not match/);
    expect(() => assertExactArchive(Buffer.from('not an archive'), bundle.digest)).toThrow();
    const corruptAt = Math.floor(bytes.length / 2);
    bytes[corruptAt] = bytes[corruptAt]! ^ 1;
    expect(() => assertExactArchive(bytes, bundle.digest)).toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(archive, { force: true });
  }
});

test('legacy fixture cannot execute even on matching host; no archive or installation needed', async () => {
  const root = await fixture(`${process.platform}-${process.arch}`);
  try {
    await expect(collectNativeBundleEvidence(root, path.join(root, 'absent.tar.gz'), undefined)).rejects.toThrow(/Schema-2 complete bundle required/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
