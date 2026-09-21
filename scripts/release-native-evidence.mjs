import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateBundle, readRegular, sha256, LIMITS, TARGETS } from './bundle-contract.mjs';
import { parseBundleArchive } from './bundle-archive.mjs';
import { captureBuildInputs, verifyClosureIntegrity, validateBuildInputProvenance } from './build-inputs.mjs';

// Local, read-only smoke evidence, NOT an authentication or promotion authority.
// Only run against an explicitly selected trusted local artifact. Validation
// proves consistency, not publisher identity; no install/manager is invoked.
export function assertNativeHost(target, host) {
  const machines = { arm64: ['arm64', 'aarch64'], x64: ['x86_64'] };
  if (!TARGETS.includes(target) || target !== `${host.platform}-${host.arch}` ||
      !machines[host.arch]?.includes(host.machine) ||
      (host.platform === 'darwin' && host.translated !== '0')) {
    throw Error('Native target mismatch or translation observation unavailable');
  }
}

export function checkProbeResult(name, result) {
  if (result.error || result.signal || result.status !== 0) {
    throw Error(`Native probe ${name} failed: ${result.error?.code ?? result.signal ?? result.status}`);
  }
  return { name, exitCode: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

export function assertExactArchive(bytes, digest) {
  const parsed = parseBundleArchive(bytes);
  if (parsed.digest !== digest) throw Error('Archive does not match selected bundle');
  return { size: bytes.length, sha256: sha256(bytes), bundleDigest: parsed.digest };
}

export async function collectNativeBundleEvidence(root, archive, checkout) {
  root = path.resolve(root);
  archive = path.resolve(archive);
  const host = { platform: process.platform, arch: process.arch, machine: os.machine(), kernel: os.release(), translated: null };
  if (host.platform === 'darwin') {
    const translated = spawnSync('/usr/sbin/sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8', env: {}, timeout: 10000 });
    // Intel kernels may not expose this optional sysctl; x86_64 hardware plus
    // hw.optional.arm64=0 independently rules out Rosetta in that case.
    if (!translated.error && translated.status === 0) host.translated = translated.stdout.trim();
    else {
      const arm = spawnSync('/usr/sbin/sysctl', ['-in', 'hw.optional.arm64'], { encoding: 'utf8', env: {}, timeout: 10000 });
      if (!arm.error && arm.status === 0 && arm.stdout.trim() === '0') host.translated = '0';
    }
  }
  const bundle = await validateBundle(root);
  assertNativeHost(bundle.manifest.target, host);
  if (bundle.manifest.schema !== 2) throw Error('Schema-2 complete bundle required');
  const archiveIdentity = assertExactArchive(await readRegular(archive, LIMITS.archive), bundle.digest);
  const closure = verifyClosureIntegrity(path.join(root, 'app'));
  validateBuildInputProvenance(closure.buildInputs);
  if (bundle.manifest.provenance.kind === 'local-source' && bundle.manifest.provenance.sourceDigest !== closure.buildInputs.digest) {
    throw Error('Bundle source provenance does not match captured closure');
  }
  const checkoutBefore = checkout ? captureBuildInputs(path.resolve(checkout)).digest : null;
  const run = (name, executable, args) => checkProbeResult(name, spawnSync(executable, args, {
    cwd: root, env: { PATH: '/unavailable' }, encoding: 'utf8', timeout: 15000, maxBuffer: 65536,
  }));
  const probes = [];
  for (const tool of ['node', 'rg', 'ast-grep']) {
    const result = run(`${tool}-version`, path.join(root, 'tools', tool), ['--version']);
    const expected = bundle.manifest.tools[tool].version;
    const actual = tool === 'node' ? result.stdout.replace(/^v/, '') : result.stdout.split(/\s+/)[1];
    if (actual !== expected) throw Error(`Native ${tool} version mismatch`);
    probes.push(result);
  }
  probes.push(run('node-target', path.join(root, 'tools/node'), ['-e', 'process.stdout.write(process.platform+"-"+process.arch)']));
  if (probes.at(-1).stdout !== bundle.manifest.target) throw Error('Private Node target mismatch');
  if (host.platform === 'darwin') {
    probes.push(run('native-addon-load', path.join(root, 'tools/node'), ['-e', 'const a=require(process.argv[1]); process.stdout.write(JSON.stringify(Object.keys(a).sort()))', path.join(root, 'app/fovea/source-platform.node')]));
  }
  const after = await validateBundle(root);
  if (after.digest !== bundle.digest) throw Error('Bundle changed during probes');
  const archiveAfter = await readRegular(archive, LIMITS.archive);
  if (sha256(archiveAfter) !== archiveIdentity.sha256) throw Error('Archive changed during probes');
  const checkoutAfter = checkout ? captureBuildInputs(path.resolve(checkout)).digest : null;
  const provenance = bundle.manifest.provenance;
  return {
    kind: 'kiro-fabric.native-bundle-smoke', schemaVersion: 1, observedAt: new Date().toISOString(),
    ok: true, releaseReady: false, qualification: 'PARTIAL: native smoke only; not installation, client, minimum-system or production qualification',
    host, target: bundle.manifest.target, version: bundle.version, root, archive: { path: archive, ...archiveIdentity },
    bundleDigest: bundle.digest, provenance, closure: { contentDigest: closure.contentDigest, buildInputDigest: closure.buildInputs.digest }, inventory: bundle.inventory,
    checkout: { before: checkoutBefore, after: checkoutAfter, stable: checkoutBefore === checkoutAfter,
      matchesArtifactSource: provenance.kind === 'local-source' && checkoutBefore !== null && checkoutBefore === checkoutAfter && checkoutAfter === provenance.sourceDigest },
    probes, environment: { PATH: '/unavailable', inheritedVariables: false },
    pending: ['production trust/signature', 'minimum-system execution', 'installed independence/recovery', 'authenticated exact-bundle client qualification', 'four-target native qualification'],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, archive, checkout, extra] = process.argv.slice(2);
  if (!root || !archive || extra) throw Error('Usage: node scripts/release-native-evidence.mjs TRUSTED_BUNDLE_ROOT EXACT_ARCHIVE [CHECKOUT]');
  console.log(JSON.stringify(await collectNativeBundleEvidence(root, archive, checkout), null, 2));
}
