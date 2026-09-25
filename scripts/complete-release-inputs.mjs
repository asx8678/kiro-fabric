#!/usr/bin/env node
// Confidential transport only. This secret is NOT a production signing key.
// Decryption does not authenticate release authority; promotion still verifies
// production signatures and exact qualification/artifact bindings afterward.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TARGETS, readRegular, sha256, LIMITS } from './bundle-contract.mjs';
import { captureDirectoryAncestry } from '../src/installation/filesystem-boundary.mjs';
import { COMPLETE_GATES } from './complete-release-promotion.mjs';
const MAGIC = Buffer.from('kiro-fabric.complete-inputs.v1\0');
const MAX = 512 * 1024 * 1024;
const targetPattern = '(?:darwin-arm64|darwin-x64|linux-arm64|linux-x64)';
const artifact = new RegExp(`^kiro-fabric-(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)-${targetPattern}\\.tar\\.gz(?:\\.spdx\\.json|\\.release\\.(?:json|sig)|\\.qualification\\.(?:json|sig))?$`);
const gate = new RegExp(`^${targetPattern}/(?:${COMPLETE_GATES.join('|')})\\.json$`);
const allowed = name => typeof name === 'string' && (artifact.test(name) || gate.test(name) || /^witnesses\/[a-f0-9]{64}\.json$/.test(name));
function key(secret, salt) { if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32 || Buffer.byteLength(secret) > 4096) throw Error('Explicit private transport passphrase (32..4096 bytes) required'); return scryptSync(secret, salt, 32); }
/** @param {Buffer} bytes @param {string} secret */
export function encryptCompleteInputBytes(bytes, secret) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX) throw Error('Complete input transport bound');
  const salt = randomBytes(16), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(secret, salt), iv);
  cipher.setAAD(MAGIC); const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted]);
}
/** @param {Buffer} bytes @param {string} secret */
export function decryptCompleteInputBytes(bytes, secret) {
  const start = MAGIC.length;
  if (!Buffer.isBuffer(bytes) || bytes.length < start + 44 || bytes.length > MAX + start + 44 || !bytes.subarray(0, start).equals(MAGIC)) throw Error('Complete input transport header/bound');
  const cipher = createDecipheriv('aes-256-gcm', key(secret, bytes.subarray(start, start + 16)), bytes.subarray(start + 16, start + 28));
  cipher.setAAD(MAGIC); cipher.setAuthTag(bytes.subarray(start + 28, start + 44));
  return Buffer.concat([cipher.update(bytes.subarray(start + 44)), cipher.final()]);
}
/** @param {any} value */
export function validateTransportRecords(value) {
  if (!value || value.schema !== 1 || Object.keys(value).sort().join(',') !== 'files,schema' || !Array.isArray(value.files) || !value.files.length || value.files.length > 2048) throw Error('Complete input transport schema');
  const seen = new Set(); let total = 0;
  return value.files.map(record => {
    if (!record || Object.keys(record).sort().join(',') !== 'base64,name,sha256,size' || !allowed(record.name) || seen.has(record.name) || typeof record.base64 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256) || !Number.isSafeInteger(record.size) || record.size < 1 || record.size > LIMITS.archive) throw Error('Complete input transport record');
    total += record.size; if (total > MAX) throw Error('Complete input transport total bound');
    const bytes = Buffer.from(record.base64, 'base64');
    if (bytes.toString('base64') !== record.base64 || bytes.length !== record.size || sha256(bytes) !== record.sha256) throw Error('Complete input transport digest');
    seen.add(record.name); return { name: record.name, bytes };
  });
}
export async function packCompleteInputs(input, output, version, secret) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw Error('Stable version required');
  const names = new Set();
  for (const target of TARGETS) {
    const base = `kiro-fabric-${version}-${target}.tar.gz`;
    for (const suffix of ['', '.release.json', '.release.sig', '.spdx.json', '.qualification.json', '.qualification.sig']) names.add(base + suffix);
    for (const name of COMPLETE_GATES) {
      const rel = `${target}/${name}.json`; names.add(rel);
      const evidence = JSON.parse((await readRegular(path.join(input, rel), 16 * 1024 * 1024)).toString('utf8'));
      if (!Array.isArray(evidence.witnesses) || evidence.witnesses.length > 256) throw Error('Witness transport bound');
      for (const witness of evidence.witnesses) { if (!/^[a-f0-9]{64}$/.test(witness.sha256 ?? '')) throw Error('Witness hash required'); names.add(`witnesses/${witness.sha256}.json`); }
    }
  }
  const files = []; let total = 0;
  for (const name of [...names].sort()) {
    const bytes = await readRegular(path.join(input, name), name.endsWith('.tar.gz') ? LIMITS.archive : 16 * 1024 * 1024);
    total += bytes.length; if (total > MAX * 0.7) throw Error('Complete input transport total bound');
    files.push({ name, size: bytes.length, sha256: sha256(bytes), base64: bytes.toString('base64') });
  }
  const encrypted = encryptCompleteInputBytes(Buffer.from(JSON.stringify({ schema: 1, files })), secret);
  const guard = captureDirectoryAncestry(path.dirname(path.resolve(output)), { label: 'Unsafe encrypted output parent' });
  guard.check(); fs.writeFileSync(output, encrypted, { flag: 'wx', mode: 0o600 }); guard.check();
  return { encrypted: true, signingPerformed: false, bytes: encrypted.length, sha256: sha256(encrypted) };
}
export async function unpackCompleteInputs(input, output, secret) {
  const bytes = decryptCompleteInputBytes(await readRegular(input, MAX + MAGIC.length + 44), secret);
  const records = validateTransportRecords(JSON.parse(bytes.toString('utf8')));
  const parent = captureDirectoryAncestry(path.dirname(path.resolve(output)), { label: 'Unsafe private output parent' });
  parent.check(); fs.mkdirSync(output, { mode: 0o700 });
  const guard = captureDirectoryAncestry(output, { label: 'Private input directory changed' });
  for (const record of records) {
    const file = path.join(output, record.name); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, record.bytes, { flag: 'wx', mode: 0o600 });
  }
  guard.check(); parent.check();
  return { decrypted: true, files: records.length, releaseReady: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, input, output, version, extra] = process.argv.slice(2), secret = process.env.KIRO_RELEASE_INPUTS_PASSPHRASE;
  if (!input || !output || extra || (action === 'pack' ? !version : action !== 'unpack' || version)) throw Error('Usage: complete-release-inputs.mjs pack INPUT NEW_ENCRYPTED VERSION | unpack ENCRYPTED NEW_PRIVATE_OUTPUT');
  console.log(JSON.stringify(action === 'pack' ? await packCompleteInputs(input, output, version, secret) : await unpackCompleteInputs(input, output, secret)));
}
