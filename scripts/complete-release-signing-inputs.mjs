#!/usr/bin/env node
// Data-only OFFLINE signing ceremony preparation. Never reads/creates a key or
// emits a signature. Maintainers must audit the native witnesses independently.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, TARGETS, readRegular, sha256 } from './bundle-contract.mjs';
import { parseBundleArchive } from './bundle-archive.mjs';
import { validateReleaseMetadata, checkReleaseSbom } from './release-trust.mjs';
import { COMPLETE_GATES, completeQualificationSigningBytes, validateCompleteGateEvidence, validateCompleteQualification } from './complete-release-promotion.mjs';
/** @param {Buffer} metadataBytes @param {Map<string,Buffer>} evidence */
export function completeQualificationRequest(metadataBytes, evidence) {
  const metadata = validateReleaseMetadata(JSON.parse(metadataBytes.toString('utf8')));
  if (!metadataBytes.equals(Buffer.from(canonical(metadata) + '\n'))) throw Error('Noncanonical release signing metadata');
  if (evidence.size !== COMPLETE_GATES.length) throw Error('All complete qualification evidence gates required');
  const gates = COMPLETE_GATES.map(gate => {
    const bytes = evidence.get(gate); if (!Buffer.isBuffer(bytes)) throw Error(`Missing ${gate} evidence`);
    validateCompleteGateEvidence(JSON.parse(bytes.toString('utf8')), gate, metadata);
    return { gate, status: 'passed', evidence: { size: bytes.length, sha256: sha256(bytes) } };
  });
  return validateCompleteQualification({ schema: 1, kind: 'kiro-fabric.complete-qualification', target: metadata.target, version: metadata.version,
    sourceCommit: metadata.sourceCommit, bundleDigest: metadata.bundleDigest, archiveSha256: metadata.archive.sha256, metadataSha256: sha256(metadataBytes), gates }, metadata, metadataBytes);
}
/** @param {string} directory @param {{commit:string,version:string}} expected */
export async function prepareCompleteSigningInputs(directory, expected) {
  const requests = [];
  for (const target of TARGETS) {
    const file = path.join(directory, `kiro-fabric-${expected.version}-${target}.tar.gz`);
    const metadataBytes = await readRegular(file + '.release.json', 65536);
    const metadata = validateReleaseMetadata(JSON.parse(metadataBytes.toString('utf8')));
    if (metadata.sourceCommit !== expected.commit || metadata.version !== expected.version || metadata.target !== target) throw Error('Signing input commit/version/target mismatch');
    const archive = await readRegular(file, metadata.archive.size);
    const sbom = await readRegular(file + '.spdx.json', metadata.sbom.size); checkReleaseSbom(metadata, sbom);
    if (archive.length !== metadata.archive.size || sha256(archive) !== metadata.archive.sha256) throw Error('Signing input archive mismatch');
    const parsed = parseBundleArchive(archive);
    if (parsed.manifest.schema !== 2 || parsed.digest !== metadata.bundleDigest || parsed.manifest.provenance.kind !== 'release' ||
        parsed.manifest.provenance.sourceCommit !== expected.commit || parsed.manifest.target !== target || parsed.manifest.version !== expected.version) throw Error('Signing requires exact complete release bundle');
    const evidence = new Map();
    for (const gate of COMPLETE_GATES) {
      const bytes = await readRegular(path.join(directory, target, gate + '.json'), 16 * 1024 * 1024);
      const value = validateCompleteGateEvidence(JSON.parse(bytes.toString('utf8')), gate, metadata);
      for (const witness of value.witnesses) {
        const raw = await readRegular(path.join(directory, 'witnesses', witness.sha256 + '.json'), witness.size);
        if (raw.length !== witness.size || sha256(raw) !== witness.sha256) throw Error('Signing witness changed');
      }
      evidence.set(gate, bytes);
    }
    const request = completeQualificationRequest(metadataBytes, evidence);
    requests.push({ file, request });
  }
  // Validate ALL targets before emitting any request; never silently replace a
  // prior signed/requested record. Partial write failures remain inspectable.
  for (const { file } of requests) for (const suffix of ['.qualification.json', '.qualification.signing-input', '.qualification.sig']) if (fs.existsSync(file + suffix)) throw Error('Signing request already exists');
  for (const { file, request } of requests) {
    fs.writeFileSync(file + '.qualification.json', canonical(request) + '\n', { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(file + '.qualification.signing-input', completeQualificationSigningBytes(request), { flag: 'wx', mode: 0o600 });
  }
  return { signingPerformed: false, releaseReady: false, targets: requests.map(r => r.request.target), required: 'Maintainer review of exact native evidence, then offline production Ed25519 signatures' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, commit, tag, extra] = process.argv.slice(2);
  if (!input || !/^[a-f0-9]{40}$/.test(commit ?? '') || !/^v\d+\.\d+\.\d+$/.test(tag ?? '') || extra) throw Error('Usage: complete-release-signing-inputs.mjs INPUT COMMIT vVERSION');
  console.log(JSON.stringify(await prepareCompleteSigningInputs(path.resolve(input), { commit, version: tag.slice(1) })));
}
