import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { completeFixture } from './complete-release-fixture.js';
import { COMPLETE_GATES, promoteCompleteRelease, promoteCompleteReleaseForTest, validateCompleteQualification, validateCompleteGateEvidence } from '../scripts/complete-release-promotion.mjs';
import { assertCandidateSource, assertCleanReleaseCheckout } from '../scripts/prepare-complete-release.mjs';
import { completeQualificationRequest, prepareCompleteSigningInputs } from '../scripts/complete-release-signing-inputs.mjs';
import { packCompleteInputs, unpackCompleteInputs } from '../scripts/complete-release-inputs.mjs';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
async function fixture() { const f = await completeFixture(); roots.push(f.root); return f; }
const target = 'darwin-arm64';
const name = `kiro-fabric-1.0.0-${target}.tar.gz`;
describe('complete release promotion', () => {
  it('promotes exactly four signed captures without recompression or raw witness publication', async () => {
    const f = await fixture();
    const encrypted = path.join(f.root, 'inputs.enc'), decrypted = path.join(f.root, 'private');
    const transportSecret = 'fixture-only-private-transport-passphrase';
    expect((await packCompleteInputs(f.input, encrypted, '1.0.0', transportSecret)).encrypted).toBe(true);
    expect((await unpackCompleteInputs(encrypted, decrypted, transportSecret)).releaseReady).toBe(false);
    expect(fs.statSync(decrypted).mode & 0o777).toBe(0o700);
    expect(fs.readFileSync(path.join(decrypted, name))).toEqual(fs.readFileSync(path.join(f.input, name)));
    const result = await promoteCompleteReleaseForTest(decrypted, f.output, f.expected, f.publicKey);
    expect(result.targets).toEqual(['darwin-arm64','darwin-x64','linux-arm64','linux-x64']);
    expect(result.releaseReady).toBe(true);
    expect(fs.readFileSync(path.join(f.output, name))).toEqual(fs.readFileSync(path.join(f.input, name)));
    expect(fs.readFileSync(path.join(f.output, 'kiro-fabric-1.0.0-install.sh'), 'utf8')).toContain('pinned_version=\'1.0.0\'');
    expect(fs.existsSync(path.join(f.output, 'witnesses'))).toBe(false);
    expect(fs.readdirSync(f.output)).toHaveLength(26);
    await expect(promoteCompleteReleaseForTest(f.input, f.output, f.expected, f.publicKey)).rejects.toThrow(/EEXIST/);
  });
  it('production refuses absent root before inputs or output, with no environment key bypass', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'production-root-gate-')); roots.push(root);
    await expect(promoteCompleteRelease('/absent', path.join(root, 'out'), { commit: 'a'.repeat(40), version: '1.0.0' })).rejects.toThrow('Production release trust root unavailable');
    expect(fs.readdirSync(root)).toEqual([]);
  });
  it.each(['unsigned', 'qualification-signature', 'missing-target', 'wrong-commit', 'archive-drift', 'witness-drift', 'pending', 'duplicate-gate'])("rejects %s before publication", async kind => {
    const f = await fixture();
    if (kind === 'unsigned') fs.rmSync(path.join(f.input, name + '.release.sig'));
    if (kind === 'qualification-signature') fs.writeFileSync(path.join(f.input, name + '.qualification.sig'), 'A'.repeat(86) + '==\n');
    if (kind === 'missing-target') fs.rmSync(path.join(f.input, 'kiro-fabric-1.0.0-linux-x64.tar.gz.release.json'));
    if (kind === 'wrong-commit') f.expected.commit = 'b'.repeat(40);
    if (kind === 'archive-drift') fs.appendFileSync(path.join(f.input, name), 'tampered');
    if (kind === 'witness-drift') { const p = path.join(f.input, 'witnesses'); fs.appendFileSync(path.join(p, fs.readdirSync(p)[0]!), 'tampered'); }
    if (kind === 'pending') { f.reports[target].gates[0].status = 'pending'; f.resign(target); }
    if (kind === 'duplicate-gate') { f.reports[target].gates[1] = f.reports[target].gates[0]; f.resign(target); }
    await expect(promoteCompleteReleaseForTest(f.input, f.output, f.expected, f.publicKey)).rejects.toThrow();
    expect(fs.existsSync(f.output)).toBe(false);
  });
  it('does not accept signed legacy/smoke evidence, false checks, translated hosts or extra fields', async () => {
    const f = await fixture(); const original = JSON.parse(fs.readFileSync(path.join(f.input, target, 'client.json'), 'utf8'));
    for (const patch of [{ kind: 'kiro-fabric.real-client-qualification' }, { checks: { ...original.checks, authoritativeToolInventory: false } }, { host: { ...original.host, translated: '1' } }, { extra: true }]) expect(() => validateCompleteGateEvidence({ ...original, ...patch }, 'client', f.metadata[target])).toThrow();
    expect(COMPLETE_GATES).toEqual(['native','installed','client','minimum-system']);
    const q = f.reports[target], bytes = fs.readFileSync(path.join(f.input, name + '.release.json'));
    for (const patch of [{ gates: q.gates.slice(1) }, { metadataSha256: '0'.repeat(64) }, { archiveSha256: '0'.repeat(64) }, { extra: true }]) expect(() => validateCompleteQualification({ ...q, ...patch }, f.metadata[target], bytes)).toThrow();
  });
});
describe('offline qualification signing inputs', () => {
  it('binds all evidence before requesting signatures and never creates a key/signature', async () => {
    const f = await fixture();
    for (const target of ['darwin-arm64','darwin-x64','linux-arm64','linux-x64']) {
      const archive = path.join(f.input, `kiro-fabric-1.0.0-${target}.tar.gz`);
      fs.unlinkSync(archive + '.qualification.json'); fs.unlinkSync(archive + '.qualification.sig');
    }
    const report = await prepareCompleteSigningInputs(f.input, f.expected);
    expect(report.signingPerformed).toBe(false); expect(report.releaseReady).toBe(false);
    expect(fs.readFileSync(path.join(f.input, name + '.qualification.signing-input'), 'utf8')).toMatch(/^kiro-fabric.complete-qualification.v1\u0000/);
    expect(fs.existsSync(path.join(f.input, name + '.qualification.sig'))).toBe(false);
    await expect(prepareCompleteSigningInputs(f.input, f.expected)).rejects.toThrow('already exists');
  });
  it('cannot substitute partial smoke or absent native gate for qualification', async () => {
    const f = await fixture(); const bytes = fs.readFileSync(path.join(f.input, name + '.release.json'));
    expect(() => completeQualificationRequest(bytes, new Map())).toThrow();
    const evidence = new Map(COMPLETE_GATES.map(gate => [gate, fs.readFileSync(path.join(f.input, target, gate + '.json'))]));
    evidence.set('native', Buffer.from(JSON.stringify({ kind: 'kiro-fabric.native-bundle-smoke', ok: true, releaseReady: false })));
    expect(() => completeQualificationRequest(bytes, evidence)).toThrow();
  });
});
describe('complete candidate source binding', () => {
  it('refuses dirty, legacy, stale or already-release source bundles', () => {
    const p = { kind: 'local-source', dirty: false, gitHead: 'a'.repeat(40), sourceDigest: 'b'.repeat(64) };
    const bundle = { manifest: { schema: 2, provenance: p } };
    expect(() => assertCandidateSource(bundle, p.gitHead, p.sourceDigest)).not.toThrow();
    for (const patch of [{ dirty: true }, { kind: 'release' }, { gitHead: 'c'.repeat(40) }, { sourceDigest: 'd'.repeat(64) }]) expect(() => assertCandidateSource({ manifest: { schema: 2, provenance: { ...p, ...patch } } }, p.gitHead, p.sourceDigest)).toThrow();
    expect(() => assertCandidateSource({ manifest: { schema: 1, provenance: p } }, p.gitHead, p.sourceDigest)).toThrow();
  });
  it('requires exact clean git identity including untracked paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-clean-')); roots.push(root);
    const git = (...args: string[]) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 15000 }); expect(r.error).toBeUndefined(); expect(r.status, r.stderr).toBe(0); return r.stdout.trim(); };
    git('init', '-q'); fs.writeFileSync(path.join(root, 'a'), 'a'); git('add', 'a');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'); const commit = git('rev-parse', 'HEAD');
    expect(() => assertCleanReleaseCheckout(root, commit)).not.toThrow();
    expect(() => assertCleanReleaseCheckout(root, 'a'.repeat(40))).toThrow();
    fs.writeFileSync(path.join(root, 'untracked'), 'x'); expect(() => assertCleanReleaseCheckout(root, commit)).toThrow('untracked'); fs.unlinkSync(path.join(root, 'untracked'));
    fs.appendFileSync(path.join(root, 'a'), 'modified'); expect(() => assertCleanReleaseCheckout(root, commit)).toThrow();
  });
});
