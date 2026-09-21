import { describe, expect, it } from 'vitest';
import { sha256 } from '../scripts/bundle-contract.mjs';
import { encryptCompleteInputBytes, decryptCompleteInputBytes, validateTransportRecords } from '../scripts/complete-release-inputs.mjs';
const secret = 'unit-fixture-transport-secret-not-production';
const bytes = Buffer.from('{"harmless":"private witness"}');
const record = { name: 'darwin-arm64/client.json', size: bytes.length, sha256: sha256(bytes), base64: bytes.toString('base64') };
describe('confidential complete release transport', () => {
  it('authenticates ciphertext, uses fresh salt/nonce and preserves plaintext exactly', () => { const encrypted = encryptCompleteInputBytes(bytes, secret); expect(decryptCompleteInputBytes(encrypted, secret)).toEqual(bytes); expect(encryptCompleteInputBytes(bytes, secret)).not.toEqual(encrypted); expect(encrypted.includes(bytes)).toBe(false); });
  it('refuses wrong/missing secret and any authenticated byte corruption', () => { const encrypted = encryptCompleteInputBytes(bytes, secret); expect(() => decryptCompleteInputBytes(encrypted, 'a-different-secret-of-sufficient-length')).toThrow(); expect(() => encryptCompleteInputBytes(bytes, '')).toThrow(); for (const index of [0, 34, encrypted.length - 1]) { const corrupted = Buffer.from(encrypted); corrupted[index] = corrupted[index]! ^ 1; expect(() => decryptCompleteInputBytes(corrupted, secret)).toThrow(); } });
  it('rejects traversal, hidden executables, duplicate files and content mismatch before extraction', () => {
    expect(validateTransportRecords({ schema: 1, files: [record] })).toEqual([{ name: record.name, bytes }]);
    for (const name of ['../outside', '/tmp/absolute', 'witnesses/../../key', 'darwin-arm64/../../key', 'bundle/manager.mjs', 'darwin-arm64/client.json/extra']) expect(() => validateTransportRecords({ schema: 1, files: [{ ...record, name }] })).toThrow();
    for (const patch of [{ sha256: '0'.repeat(64) }, { base64: record.base64 + '!' }, { size: 1 }, { extra: true }]) expect(() => validateTransportRecords({ schema: 1, files: [{ ...record, ...patch }] })).toThrow();
    expect(() => validateTransportRecords({ schema: 1, files: [record,record] })).toThrow();
  });
});
