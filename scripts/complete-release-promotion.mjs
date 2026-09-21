#!/usr/bin/env node
// Complete-bundle promotion, separate from the permanently nonqualifying legacy
// Agent archive. Only a reviewed static production root authenticates inputs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPublicKey, verify } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonical, TARGETS, readRegular, sha256, validateBundle } from './bundle-contract.mjs';
import { parseBundleArchive, extractBundleArchiveBytes } from './bundle-archive.mjs';
import { PRODUCTION_TRUST_ROOT, verifyRelease, verifyReleaseForTest } from './release-trust.mjs';
import { generateInstallerBootstrap } from './generate-installer-bootstrap.mjs';
import { generateBundleSbom } from './generate-bundle-sbom.mjs';
import { verifyClosureIntegrity, validateBuildInputProvenance } from './build-inputs.mjs';
import { assertNativeHost } from './release-native-evidence.mjs';

export const COMPLETE_GATES = Object.freeze(['native', 'installed', 'client', 'minimum-system']);
const DOMAIN = 'kiro-fabric.complete-qualification.v1\0';
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fields = (value, keys) => { if (!value || typeof value !== 'object' || Array.isArray(value) || canonical(Object.keys(value).sort()) !== canonical([...keys].sort())) throw Error('Complete qualification fields'); };
/** Sign ONLY after independent review of every exact-byte evidence file.
 * @param {any} report */
export function completeQualificationSigningBytes(report) { return Buffer.from(DOMAIN + canonical(report)); }
/** A production publisher attests to evidence; unsigned user booleans are not
 * authority. Raw native/client reports remain separately captured and hash-bound.
 * @param {any} report @param {any} metadata @param {Buffer} metadataBytes */
export function validateCompleteQualification(report, metadata, metadataBytes) {
  fields(report, ['schema', 'kind', 'target', 'version', 'sourceCommit', 'bundleDigest', 'archiveSha256', 'metadataSha256', 'gates']);
  if (report.schema !== 1 || report.kind !== 'kiro-fabric.complete-qualification' ||
      ['target', 'version', 'sourceCommit', 'bundleDigest'].some(key => report[key] !== metadata[key]) ||
      report.archiveSha256 !== metadata.archive.sha256 || report.metadataSha256 !== sha256(metadataBytes)) throw Error('Complete qualification identity mismatch');
  if (!Array.isArray(report.gates) || report.gates.length !== COMPLETE_GATES.length) throw Error('All complete native gates required');
  const seen = new Set();
  for (const gate of report.gates) {
    fields(gate, ['gate', 'status', 'evidence']); fields(gate.evidence, ['size', 'sha256']);
    if (!COMPLETE_GATES.includes(gate.gate) || seen.has(gate.gate) || gate.status !== 'passed' || !hash(gate.evidence.sha256) ||
        !Number.isSafeInteger(gate.evidence.size) || gate.evidence.size < 1 || gate.evidence.size > 16 * 1024 * 1024) throw Error('Incomplete/duplicate native qualification gate');
    seen.add(gate.gate);
  }
  return report;
}
/** @param {Buffer} bytes @param {Buffer} signature @param {string|Buffer} publicKey */
function authenticateQualification(bytes, signature, publicKey) {
  const report = JSON.parse(bytes.toString('utf8'));
  if (!bytes.equals(Buffer.from(canonical(report) + '\n'))) throw Error('Noncanonical complete qualification');
  const text = signature.toString('ascii');
  if (signature.length !== 89 || !signature.equals(Buffer.from(text, 'ascii')) || !/^[A-Za-z0-9+/]{86}==\n$/.test(text)) throw Error('Complete qualification signature encoding');
  const raw = Buffer.from(text.trim(), 'base64');
  const key = createPublicKey(publicKey);
  if (raw.length !== 64 || raw.toString('base64') + '\n' !== text || key.asymmetricKeyType !== 'ed25519' ||
      !verify(null, completeQualificationSigningBytes(report), key, raw)) throw Error('Complete qualification signature mismatch');
  return report;
}
/** Exact evidence must describe this bundle, not a library/legacy package. The
 * signed qualification binds the bytes; this structural check rejects common
 * smoke-as-certification and self-authored inventory substitutions.
 * @param {any} value @param {string} gate @param {any} metadata */
export function validateCompleteGateEvidence(value, gate, metadata) {
  fields(value, ['schema', 'kind', 'target', 'sourceCommit', 'archiveSha256', 'bundleDigest', 'host', 'checks', 'witnesses']);
  if (value.schema !== 1 || value.kind !== `kiro-fabric.complete-${gate}-evidence` ||
      ['target', 'sourceCommit', 'bundleDigest'].some(key => value[key] !== metadata[key]) || value.archiveSha256 !== metadata.archive.sha256) throw Error('Exact-bundle gate evidence mismatch');
  assertNativeHost(metadata.target, value.host);
  const checks = {
    native: ['privateTools', 'nativeAddon', 'reproducibleArchive'],
    installed: ['exactArchiveInstalled', 'independence', 'upgradeRollback', 'crashRecovery', 'noOrphans'],
    client: ['authoritativeToolInventory', 'acceptedEdit', 'declinedEdit', 'acceptedShell', 'declinedShell', 'workspaceRevocation', 'compaction', 'resume', 'shutdown'],
    'minimum-system': ['minimumOS', 'minimumLibcOrMacOS', 'minimumKiro', 'privateTools'],
  }[gate];
  if (!checks) throw Error('Unknown complete gate');
  fields(value.checks, checks);
  if (checks.some(check => value.checks[check] !== true) || !Array.isArray(value.witnesses) || value.witnesses.length < 1 || value.witnesses.length > 256) throw Error('Incomplete exact-bundle checks');
  for (const witness of value.witnesses) {
    fields(witness, ['sha256', 'size']);
    if (!hash(witness.sha256) || !Number.isSafeInteger(witness.size) || witness.size < 1 || witness.size > 16 * 1024 * 1024) throw Error('Invalid raw witness binding');
  }
  return value;
}
/** Requires exactly four independently signed target captures. Source paths are
 * read once; publication uses these bytes only and never recompresses archives.
 * @param {string} input @param {{commit:string,version:string}} expected @param {string|Buffer} key */
async function captureCompleteRelease(input, expected, key, verifyMetadata) {
  if (!key) throw Error('Production release trust root unavailable: distribution BLOCKED');
  if (!/^[a-f0-9]{40}$/.test(expected.commit) || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(expected.version)) throw Error('Exact commit and stable version required');
  const captures = [], assets = new Map();
  for (const target of TARGETS) {
    const name = `kiro-fabric-${expected.version}-${target}.tar.gz`, file = path.join(input, name);
    const metadataBytes = await readRegular(file + '.release.json', 65536);
    const signatureBytes = await readRegular(file + '.release.sig', 89);
    // Production uses verifyRelease's static root. The internal test seam is
    // not reachable through CLI, environment or metadata.
    const metadata = verifyMetadata(metadataBytes, signatureBytes, { target, version: expected.version });
    if (metadata.sourceCommit !== expected.commit) throw Error('Complete release source commit mismatch');
    const qualificationBytes = await readRegular(file + '.qualification.json', 65536);
    const qualificationSignature = await readRegular(file + '.qualification.sig', 89);
    const q = validateCompleteQualification(authenticateQualification(qualificationBytes, qualificationSignature, key), metadata, metadataBytes);
    for (const gate of q.gates) {
      const evidenceName = `${target}/${gate.gate}.json`;
      const bytes = await readRegular(path.join(input, evidenceName), gate.evidence.size);
      if (bytes.length !== gate.evidence.size || sha256(bytes) !== gate.evidence.sha256) throw Error('Complete qualification evidence changed');
      const evidence = validateCompleteGateEvidence(JSON.parse(bytes.toString('utf8')), gate.gate, metadata);
      for (const witness of evidence.witnesses) {
        const witnessName = `witnesses/${witness.sha256}.json`;
        const raw = await readRegular(path.join(input, witnessName), witness.size);
        if (raw.length !== witness.size || sha256(raw) !== witness.sha256) throw Error('Raw qualification witness changed');
        // Qualification input is explicitly operator-reviewed and sanitized.
        // Witnesses stay private, never uploaded as public release assets.
      }
    }
    const archiveBytes = await readRegular(file, metadata.archive.size);
    const sbomBytes = await readRegular(file + '.spdx.json', metadata.sbom.size);
    verifyMetadata(metadataBytes, signatureBytes, { archiveBytes, sbomBytes });
    const parsed = parseBundleArchive(archiveBytes);
    if (parsed.manifest.schema !== 2 || parsed.manifest.target !== target || parsed.digest !== metadata.bundleDigest ||
        parsed.manifest.provenance.kind !== 'release' || parsed.manifest.provenance.sourceCommit !== expected.commit ||
        parsed.manifest.version !== expected.version || canonical(parsed.manifest.compatibility) !== canonical(metadata.compatibility)) throw Error('Complete release manifest mismatch');
    // Files are data only here. No bundled executable or manager is invoked.
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'complete-release-')); fs.chmodSync(temp, 0o700);
    try {
      const root = path.join(temp, 'bundle');
      await extractBundleArchiveBytes(archiveBytes, root); await validateBundle(root);
      validateBuildInputProvenance(verifyClosureIntegrity(path.join(root, 'app')).buildInputs);
      if (canonical(await generateBundleSbom(root)) !== canonical(JSON.parse(sbomBytes.toString('utf8')))) throw Error('Complete release SPDX inventory mismatch');
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    captures.push({ metadata, archiveBytes, sbomBytes });
    for (const [suffix, bytes] of [['', archiveBytes], ['.spdx.json', sbomBytes], ['.release.json', metadataBytes], ['.release.sig', signatureBytes], ['.qualification.json', qualificationBytes], ['.qualification.sig', qualificationSignature]]) assets.set(name + suffix, bytes);
  }
  const bootstrap = Buffer.from(generateInstallerBootstrap(captures));
  assets.set(`kiro-fabric-${expected.version}-install.sh`, bootstrap);
  const report = { schema: 1, kind: 'kiro-fabric.complete-release', releaseReady: true, sourceCommit: expected.commit, version: expected.version,
    authority: 'production-signed-maintainer-reviewed-native-evidence', targets: captures.map(c => c.metadata.target),
    assets: [...assets].map(([name, bytes]) => ({ name, size: bytes.length, sha256: sha256(bytes) })) };
  assets.set('complete-release.json', Buffer.from(canonical(report) + '\n'));
  return { assets, report };
}
async function promote(input, output, expected, key, verifyMetadata) {
  const { assets, report } = await captureCompleteRelease(input, expected, key, verifyMetadata);
  // New, caller-selected output only. Failed validation never creates output.
  fs.mkdirSync(output, { mode: 0o700 });
  for (const [name, bytes] of assets) fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx', mode: 0o600 });
  return report;
}
export async function promoteCompleteRelease(input, output, expected) { return promote(input, output, expected, PRODUCTION_TRUST_ROOT, verifyRelease); }
// Internal fixture seam, never selectable through environment, input or CLI.
export async function promoteCompleteReleaseForTest(input, output, expected, publicKey) { return promote(input, output, expected, publicKey, (m, s, e) => verifyReleaseForTest(m, s, publicKey, e)); }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output, commit, tag, extra] = process.argv.slice(2);
  if (!input || !output || !commit || !/^v\d+\.\d+\.\d+$/.test(tag ?? '') || extra) throw Error('Usage: complete-release-promotion.mjs INPUT NEW_OUTPUT COMMIT vVERSION');
  console.log(JSON.stringify(await promoteCompleteRelease(path.resolve(input), path.resolve(output), { commit, version: tag.slice(1) })));
}
