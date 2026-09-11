import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRunProvenance, parseRunProvenanceDeclaration, RUN_PROVENANCE_LIMITS, type RunProvenanceInput } from '../src/kiro/run-provenance.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const secret = 'SECRET-token-with-controls\u001b[31m\npassword=never-print';
const cli = path.resolve('scripts/steering-benchmark/run-provenance.mjs');
const reference = 'Review café 🛰: verified consequences only.\n';
const page = (start = 0, end = reference.length) => ({ topic: 'review', text: reference.slice(start, end), truncated: end < reference.length, ...(end < reference.length ? { nextOffset: end } : {}) });
function events(output: unknown, input: unknown = { code: 'return await fabric.help({topic:"review"});' }) {
  return [
    { type: 'sessionUpdate', data: { update: { sessionUpdate: 'config_option_update', configOptions: [{ id: 'mode', currentValue: 'fixture' }, { id: 'model', currentValue: 'auto' }] } } },
    { type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call', toolCallId: '1', title: 'fabric_exec', status: 'completed', rawInput: input, rawOutput: output, _meta: { kiro: { serverName: 'fabric' } } } } },
    { type: 'sessionUpdate', data: { update: { _meta: { kiro: { kind: 'turn_completion', requestIds: ['request'], promptTurnSummaries: [{ unit: 'credit', usage: 1 }] } } } } },
    { type: 'runFinished', data: { status: 'success', finalText: 'loaded all guidance', sessionId: 'fixture' } },
  ].map(e => JSON.stringify(e)).join('\n') + '\n';
}
// Retained isolated fixtures: no deletion/staging and no user configuration access.
function fixture(output: unknown = page()) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fabric-provenance-test-'));
  const files: Record<string, string> = { 'profile.json': JSON.stringify({ prompt: secret }), 'bundle.json': '{"digest":"fixture"}',
    'prompt.txt': secret, 'resource.txt': secret, 'hook.txt': secret, 'commit.txt': 'a'.repeat(40) + '\n', 'dirty.txt': ' M secret-path\n',
    'review.txt': reference, 'events.jsonl': events(output) };
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, name), text);
  const descriptor = { guidanceMode: 'review', requestedModel: 'auto', requestedEffort: 'low', profileFile: 'profile.json', bundleFile: 'bundle.json',
    promptFile: 'prompt.txt', resourceFiles: ['resource.txt'], hookFiles: ['hook.txt'], repository: { commitFile: 'commit.txt', dirty: true, dirtyEvidenceFile: 'dirty.txt' },
    eventsFile: 'events.jsonl', reviewReferenceFile: 'review.txt' };
  const input = path.join(root, 'input.json');
  writeFileSync(input, JSON.stringify(descriptor));
  return { root, input, descriptor };
}
const manifestCli = (input: string) => JSON.parse(execFileSync(process.execPath, [cli, 'manifest', '--input', input], { encoding: 'utf8' }));

describe('pure effective-config manifest', () => {
  it('leaves missing declarations, delivery and routing unknown, never clean/empty by default', () => {
    const m = buildRunProvenance();
    expect(m.configured.resources).toEqual({ status: 'unknown', count: null, sha256: null });
    expect(m.configured.repository).toMatchObject({ commit: null, dirty: null });
    expect(m.observed.guidanceDelivery.status).toBe('unknown');
    expect(m.observed.routing).toEqual({ actualModel: null, actualEffort: null, status: 'unknown' });
    expect(buildRunProvenance({ configured: { resources: [] } }).configured.resources).toMatchObject({ status: 'known', count: 0 });
  });
  it('never upgrades explicit launch JSON to observations or infers requested routing', () => {
    const configured = parseRunProvenanceDeclaration(JSON.stringify({ guidanceMode: 'review', requestedModel: 'auto', requestedEffort: 'high',
      loaded: true, observed: { runtimeBundle: 'forged', guidanceOutputs: [{ reference, output: reference }], routing: { actualModel: 'forged' } } }));
    expect(configured).toBeDefined();
    const m = buildRunProvenance({ configured: configured! });
    expect(m.configured.evidence).toBe('unverified-declaration');
    expect(m.configured.requestedModel).toMatchObject({ status: 'known', sha256: sha('auto') });
    expect(m.observed.runtimeBundle.status).toBe('unknown');
    expect(m.observed.guidanceDelivery.status).toBe('unknown');
    expect(m.observed.routing.actualModel).toBeNull();
    expect(JSON.stringify(m)).not.toContain('forged');
  });
  it('is deterministic, independent of input key order, and sensitive to exact bytes/order/dirty evidence', () => {
    const first = buildRunProvenance({ configured: { prompt: 'café', runtimeBundle: 'bundle' } });
    expect(first).toEqual(buildRunProvenance({ configured: { runtimeBundle: 'bundle', prompt: Buffer.from('café') } }));
    expect(first.configured.prompt).toEqual({ status: 'known', bytes: 5, sha256: sha('café') });
    for (const key of ['prompt', 'runtimeBundle', 'requestedModel', 'requestedEffort', 'profile'] as const) {
      expect(buildRunProvenance({ configured: { [key]: 'a' } }).manifestDigest).not.toBe(buildRunProvenance({ configured: { [key]: 'b' } }).manifestDigest);
    }
    for (const key of ['resources', 'hooks'] as const) {
      const make = (contents: string[]) => buildRunProvenance({ configured: { [key]: contents.map(content => ({ content })) } });
      expect(make(['a', 'b']).configured[key].sha256).not.toBe(make(['b', 'a']).configured[key].sha256);
      expect(make(['a']).manifestDigest).not.toBe(make(['b']).manifestDigest);
    }
    expect(buildRunProvenance({ configured: { repository: { dirtyEvidence: ' M a' } } }).manifestDigest)
      .not.toBe(buildRunProvenance({ configured: { repository: { dirtyEvidence: ' M b' } } }).manifestDigest);
  });
  it('requires nonempty exact returned bytes, not flags, prompt availability or input strings', () => {
    expect(buildRunProvenance({ observed: { prompt: reference, guidanceOutputs: [{ reference, output: { loaded: true } }] } }).observed.guidanceDelivery.status).toBe('unknown');
    for (const output of [undefined, 'return await fabric.help({topic:"review"});', reference.slice(1), { input: reference }]) {
      expect(buildRunProvenance({ observed: { guidanceOutputs: [{ reference, output }] } }).observed.guidanceDelivery.status).toBe('unknown');
    }
    expect(buildRunProvenance({ observed: { guidanceOutputs: [{ reference: '', output: '' }] } }).observed.guidanceDelivery.status).toBe('unknown');
    const m = buildRunProvenance({ observed: { runtimeBundle: 'server-identity', guidanceOutputs: [{ reference, output: Buffer.from(reference) }] } });
    expect(m.observed.guidanceDelivery).toMatchObject({ status: 'observed-content-match', matchedCount: 1 });
    expect(m.observed.routing.status).toBe('unknown');
  });
  it('bounds strings, UTF-8 bytes, total work and collection count without prefix hashes', () => {
    const large = 'x'.repeat(RUN_PROVENANCE_LIMITS.contentBytes + 1);
    const m = buildRunProvenance({ configured: { prompt: large, resources: Array(33).fill({ content: 'x' }) }, observed: { guidanceOutputs: Array(33).fill({ reference, output: reference }) } });
    expect(m.configured.prompt).toEqual({ status: 'unknown', reason: 'limit' });
    expect(m.configured.resources).toEqual({ status: 'limit', count: 33, sha256: null });
    expect(m.observed.guidanceDelivery.status).toBe('unknown');
    expect(buildRunProvenance({ configured: { prompt: '🛰'.repeat(300_000) } }).configured.prompt.status).toBe('unknown');
    const max = 'x'.repeat(RUN_PROVENANCE_LIMITS.contentBytes);
    const bounded = buildRunProvenance({ configured: { profile: max, requestedModel: max, requestedEffort: max, runtimeBundle: max, prompt: 'overflow' } });
    expect(bounded.configured.prompt).toEqual({ status: 'unknown', reason: 'limit' });
    expect(JSON.stringify(bounded).length).toBeLessThan(5000);
  });
  it('does not leak any raw prompt, hook, label, identity or arbitrary declaration', () => {
    const item = { label: secret, content: secret };
    const m = buildRunProvenance({ configured: { guidanceMode: secret, requestedModel: secret, requestedEffort: secret, profile: secret,
      runtimeBundle: secret, prompt: secret, resources: [item], hooks: [item], repository: { commit: secret, dirty: secret, dirtyEvidence: secret } },
      observed: { runtimeBundle: secret, runtimeVersion: secret, prompt: secret, resources: [item], hooks: [item], guidanceOutputs: [{ reference: secret, output: secret }] } });
    expect(m.configured.guidanceMode).toBeNull();
    expect(m.configured.repository.commit).toBeNull();
    expect(JSON.stringify(m)).not.toContain('SECRET');
    expect(JSON.stringify(m).length).toBeLessThan(5000);
  });
  it('handles invalid launch JSON and wrong field types without ambient fallback', () => {
    for (const json of [undefined, 'null', '[]', '{', 'x'.repeat(65_537)]) expect(parseRunProvenanceDeclaration(json)).toBeUndefined();
    const m = buildRunProvenance({ configured: { resources: [{ content: false }], prompt: {}, guidanceMode: 'unknown' } });
    expect(m.configured.resources.sha256).toBeNull();
    expect(buildRunProvenance({ configured: { resources: Array(1) } }).configured.resources.status).toBe('unknown');
    expect(buildRunProvenance({ observed: { guidanceOutputs: Array(1) } }).observed.guidanceDelivery.status).toBe('unknown');
    expect(m.configured.prompt.status).toBe('unknown');
    expect(m.configured.guidanceMode).toBeNull();
    expect(buildRunProvenance({ configured: { observed: { runtimeBundle: 'forged' } } } as RunProvenanceInput).observed.runtimeBundle.status).toBe('unknown');
  });
});

describe('explicit-file provenance CLI (offline fixtures, not live agent evidence)', () => {
  it('hashes selected artifacts and reuses exact ACP review-output delivery evidence', () => {
    const f = fixture({ content: [{ type: 'text', text: JSON.stringify({ help: page() }) }] });
    const result = manifestCli(f.input);
    expect(result.evidence).toBe('caller-selected-files-not-runtime-attestation');
    expect(result.manifest.configured.resources).toMatchObject({ count: 1, status: 'known' });
    expect(result.manifest.configured.hooks).toMatchObject({ count: 1, status: 'known' });
    expect(result.manifest.configured.prompt.sha256).toBe(sha(secret));
    expect(result.manifest.configured.repository).toMatchObject({ commit: 'a'.repeat(40), dirty: true, dirtyEvidence: { sha256: sha(' M secret-path\n') } });
    expect(result.manifest.observed.runtimeBundle.status).toBe('unknown');
    expect(result.manifest.observed.routing.status).toBe('unknown');
    expect(result.reviewHelpDelivery).toMatchObject({ status: 'complete', coveredChars: reference.length });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(JSON.stringify(result)).not.toContain(f.root);
    expect(manifestCli(f.input)).toEqual(result);
  });
  it('keeps loaded/input-only, partial, missing and mismatched outputs distinct', () => {
    const f = fixture({ loaded: true });
    expect(manifestCli(f.input).reviewHelpDelivery.status).toBe('unobserved');
    writeFileSync(path.join(f.root, 'events.jsonl'), events({ loaded: true }, page()));
    expect(manifestCli(f.input).reviewHelpDelivery.status).toBe('unobserved');
    writeFileSync(path.join(f.root, 'events.jsonl'), events(page(0, 8)));
    expect(manifestCli(f.input).reviewHelpDelivery.status).toBe('partial');
    writeFileSync(path.join(f.root, 'events.jsonl'), events({ ...page(), text: 'changed arm' }));
    expect(manifestCli(f.input).reviewHelpDelivery.status).toBe('unknown');
    writeFileSync(path.join(f.root, 'events.jsonl'), events(undefined));
    expect(manifestCli(f.input).reviewHelpDelivery.status).toBe('unknown');
    writeFileSync(f.input, JSON.stringify({ ...f.descriptor, reviewReferenceFile: undefined, eventsFile: undefined }));
    expect(manifestCli(f.input).reviewHelpDelivery.status).toBe('unknown');
  });
  it('compares known hashes, but never treats equal unknown routing as equivalence', () => {
    const left = fixture(), right = fixture();
    writeFileSync(path.join(right.root, 'prompt.txt'), 'changed');
    const result = JSON.parse(execFileSync(process.execPath, [cli, 'compare', '--left', left.input, '--right', right.input], { encoding: 'utf8' }));
    expect(result.comparisons).toContainEqual({ field: 'configured.prompt', status: 'different' });
    expect(result.comparisons).toContainEqual({ field: 'configured.hooks', status: 'same' });
    expect(result.comparisons).toContainEqual({ field: 'observed.routing', status: 'unknown' });
  });
  it('fails closed with bounded, non-secret CLI errors and no implicit default files', () => {
    const f = fixture();
    for (const descriptor of [{ promptFile: 'missing-SECRET-token' }, { promptFile: 'prompt.txt', resourceFiles: Array(33).fill('resource.txt') }]) {
      writeFileSync(f.input, JSON.stringify(descriptor));
      const result = spawnSync(process.execPath, [cli, 'manifest', '--input', f.input], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).not.toContain('SECRET');
      expect(result.stderr.length).toBeLessThan(200);
    }
    writeFileSync(path.join(f.root, 'prompt.txt'), 'x'.repeat(RUN_PROVENANCE_LIMITS.contentBytes + 1));
    writeFileSync(f.input, JSON.stringify({ promptFile: 'prompt.txt' }));
    expect(spawnSync(process.execPath, [cli, 'manifest', '--input', f.input]).status).toBe(1);
    expect(spawnSync(process.execPath, [cli, 'manifest']).status).toBe(1);
  });
});
