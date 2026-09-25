#!/usr/bin/env node
// Prepare UNSIGNED final-byte candidates on a native host. No signing key,
// installation, credential or qualification authority is supplied here.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonical, validateBundle, createBundleManifest, readRegular, LIMITS, sha256 } from './bundle-contract.mjs';
import { writeBundleArchive, extractBundleArchiveBytes } from './bundle-archive.mjs';
import { verifyBuildClosure, captureBuildInputs } from './build-inputs.mjs';
import { generateBundleSbom } from './generate-bundle-sbom.mjs';
import { validateReleaseMetadata, releaseSigningBytes } from './release-trust.mjs';
import { collectNativeBundleEvidence } from './release-native-evidence.mjs';
import { captureDirectoryAncestry } from '../src/installation/filesystem-boundary.mjs';

/** @param {string} checkout @param {string} commit */
export function assertCleanReleaseCheckout(checkout, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Exact release commit required');
  const git = args => execFileSync('git', args, { cwd: checkout, env: { PATH: process.env.PATH, LANG: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, encoding: 'utf8', timeout: 15000, maxBuffer: 1048576 });
  if (git(['rev-parse', 'HEAD']).trim() !== commit || git(['status', '--porcelain', '--untracked-files=all']).length) throw Error('Release candidate requires exact clean checkout, including untracked files');
}
/** @param {any} bundle @param {string} commit @param {string} sourceDigest */
export function assertCandidateSource(bundle, commit, sourceDigest) {
  const p = bundle.manifest.provenance;
  if (bundle.manifest.schema !== 2 || p.kind !== 'local-source' || p.dirty !== false || p.gitHead !== commit || p.sourceDigest !== sourceDigest) throw Error('Candidate must be a clean exact-commit schema-2 source bundle');
}
/** @param {string} root @param {string} checkout @param {string} output @param {string} commit */
export async function prepareCompleteRelease(root, checkout, output, commit) {
  checkout = fs.realpathSync(checkout); output = path.resolve(output);
  assertCleanReleaseCheckout(checkout, commit);
  const guard = captureDirectoryAncestry(path.dirname(output), { label: 'Unsafe release output parent' });
  const sourceDigest = captureBuildInputs(checkout).digest;
  const before = await validateBundle(root); assertCandidateSource(before, commit, sourceDigest);
  verifyBuildClosure(checkout, path.join(before.root, 'app'));
  const expectedVersion = JSON.parse(fs.readFileSync(path.join(checkout, 'package.json'), 'utf8')).version;
  if (before.version !== expectedVersion) throw Error('Candidate version differs from clean checkout');
  guard.check(); fs.mkdirSync(output, { mode: 0o700 });
  // Retain intermediate/failure evidence. Never overwrite any existing bundle.
  const captured = path.join(output, 'source-snapshot.tar.gz');
  await writeBundleArchive(before.root, captured);
  const bytes = await readRegular(captured, LIMITS.archive);
  const candidate = path.join(output, 'bundle');
  const extracted = await extractBundleArchiveBytes(bytes, candidate);
  if (extracted.digest !== before.digest) throw Error('Candidate source snapshot changed');
  const manifest = await createBundleManifest(candidate, { ...before.manifest, provenance: { kind: 'release', sourceCommit: commit } });
  fs.writeFileSync(path.join(candidate, 'bundle-manifest.json'), canonical(manifest) + '\n', { mode: 0o600 });
  const final = await validateBundle(candidate);
  const name = `kiro-fabric-${before.version}-${manifest.target}.tar.gz`, archive = path.join(output, name);
  await writeBundleArchive(candidate, archive);
  const archiveBytes = await readRegular(archive, LIMITS.archive);
  const sbomBytes = Buffer.from(JSON.stringify(await generateBundleSbom(candidate), null, 2) + '\n');
  const metadata = validateReleaseMetadata({ schema: 1, product: 'kiro-fabric', version: before.version, target: manifest.target, sourceCommit: commit,
    compatibility: manifest.compatibility, bundleDigest: final.digest,
    archive: { url: `https://github.com/asx8678/kiro-fabric/releases/download/v${before.version}/${name}`, size: archiveBytes.length, sha256: sha256(archiveBytes) },
    sbom: { size: sbomBytes.length, sha256: sha256(sbomBytes) } });
  assertCleanReleaseCheckout(checkout, commit); guard.check();
  if (captureBuildInputs(checkout).digest !== sourceDigest || (await validateBundle(before.root)).digest !== before.digest) throw Error('Candidate source changed during preparation');
  fs.writeFileSync(archive + '.spdx.json', sbomBytes, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(archive + '.release.json', canonical(metadata) + '\n', { flag: 'wx', mode: 0o600 });
  // Exact domain bytes for an OFFLINE approved signer; not a signature.
  fs.writeFileSync(archive + '.signing-input', releaseSigningBytes(metadata), { flag: 'wx', mode: 0o600 });
  const smoke = await collectNativeBundleEvidence(candidate, archive, checkout);
  fs.writeFileSync(path.join(output, 'native-smoke.json'), JSON.stringify(smoke, null, 2), { flag: 'wx', mode: 0o600 });
  const report = { kind: 'kiro-fabric.complete-candidate', schema: 1, releaseReady: false, sourceCommit: commit, sourceDigest,
    target: manifest.target, version: before.version, bundleRoot: candidate, archive, metadataSha256: sha256(canonical(metadata) + '\n'),
    archiveSha256: metadata.archive.sha256, bundleDigest: metadata.bundleDigest,
    pending: ['reviewed production public root and signer custody', 'four-target native/installed/client/minimum-system qualification', 'signed qualification and final-byte release metadata'] };
  fs.writeFileSync(path.join(output, 'candidate.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [bundle, checkout, output, commit, extra] = process.argv.slice(2);
  if (!bundle || !checkout || !output || !commit || extra) throw Error('Usage: prepare-complete-release.mjs TRUSTED_BUNDLE CHECKOUT NEW_OUTPUT COMMIT');
  console.log(JSON.stringify(await prepareCompleteRelease(bundle, checkout, output, commit), null, 2));
}
