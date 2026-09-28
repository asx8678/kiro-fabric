import { removeFixtureSync } from "../fixture-cleanup.mjs";
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { compileSourceBinding } from '../../scripts/build-fovea-native.mjs';
import { createNativeSourcePlatform, type PosixSourceBinding } from '../../src/fovea/source-platform-native.js';
import type { SourcePlatform } from '../../src/fovea/source-platform.js';
import * as nativeLoader from '../../src/fovea/native-source-loader.js';
import { FoveaHost } from '../../src/fovea/host.js';
import { FoveaProvenanceJournal, PROVENANCE_MAX_RECORDS } from '../../src/fovea/provenance-journal.js';
import { FoveaEngine, type EngineRequest } from '../../src/fovea/engine.js';
import { FoveaEngineProcess } from '../../src/fovea/engine-process.js';
import { decodeRequest, encodeFrame } from '../../src/fovea/protocol.js';
import { pinnedParser } from "./installed-parser.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f(); vi.restoreAllMocks(); });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
// Explicit fixture selector only; never a production executable override.
const parserPath = process.env.FOVEA_PROVENANCE_TEST_PARSER ? path.resolve(process.env.FOVEA_PROVENANCE_TEST_PARSER) : pinnedParser().path;
const parser = { path: parserPath, sha256: fs.existsSync(parserPath) ? createHash('sha256').update(fs.readFileSync(parserPath)).digest('hex') : '0'.repeat(64), version: '0.45.3' };
let nativePlatform: SourcePlatform | undefined, nativeBuild = '';
beforeAll(() => {
  if (process.platform !== 'darwin') return;
  fs.mkdirSync('.tmp', { recursive: true });
  nativeBuild = fs.mkdtempSync(path.resolve('.tmp/provenance-binding-'));
  const binary = path.join(nativeBuild, 'source-platform.node');
  compileSourceBinding(process.cwd(), binary);
  nativePlatform = createNativeSourcePlatform(createRequire(import.meta.url)(binary) as PosixSourceBinding);
});
beforeEach(() => {
  // These test real native I/O and real src host/engine, not bundle admission.
  // The authenticated loader is covered independently by packaging tests.
  if (nativePlatform) vi.spyOn(nativeLoader, 'loadManagedSourcePlatform').mockResolvedValue(nativePlatform);
});
afterAll(() => { if (nativeBuild) removeFixtureSync(nativeBuild, { recursive: true, force: true }); });
function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fovea-provenance-'))); fs.chmodSync(base, 0o700);
  cleanup.unshift(() => removeFixtureSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'root'); fs.mkdirSync(root, { mode: 0o700 });
  const stat = fs.statSync(root, { bigint: true });
  const authority = { canonicalPath: root, deviceId: String(stat.dev), fileId: String(stat.ino), conversationId: 'private_conversation', conversationEpoch: 1, authorizationEpoch: 1 };
  const worktree = sha(`${root}\0${stat.dev}\0${stat.ino}`);
  const make = () => { const host = new FoveaHost({ dataRoot: base, configFile: path.join(base, 'config.json'), parser }); cleanup.push(() => host.close()); return host.bind(authority); };
  return { base, root, worktree, make, context: { cwd: root } };
}
function sourceTransport() {
  const engines = new Map<FoveaEngineProcess, FoveaEngine>();
  vi.spyOn(FoveaEngineProcess.prototype, 'close').mockImplementation(async function (this: FoveaEngineProcess) {
    await engines.get(this)?.close();
  });
  return vi.spyOn(FoveaEngineProcess.prototype, 'query').mockImplementation(function (this: FoveaEngineProcess, request, signal) {
    // Exercise real transport size/schema and real src engine without requiring
    // a build; this is not evidence for process/native-client lifecycle gates.
    decodeRequest(encodeFrame({ version: 1, type: 'query', id: 'probe', remainingMs: 120000, request }));
    let engine = engines.get(this);
    if (!engine) { engine = new FoveaEngine(this.options); engines.set(this, engine); }
    return engine.query(request, signal);
  });
}
function committed(client: ReturnType<ReturnType<typeof fixture>['make']>, before: string | null, after: string | null, file = 'math.ts') {
  client.observer.observe({ sequence: 1, operationId: 'opaque-operation', ref: 'local.edit', phase: 'committed', paths: [file], transitions: [{ path: file, beforeSha256: before, afterSha256: after }] });
}
const text = 'export function calculateTotal() { return 1; }\n';
const syncArgs = { scope: 'repository', pushFocus: false };

describe.skipIf(!['linux', 'darwin'].includes(process.platform))('native workspace provenance journal', () => {
  it('copies exact transitions, preserves commits after outer failure, shares only bounded private facts', async () => {
    const f = fixture(), a = f.make(), b = f.make();
    const event = { sequence: 1, operationId: 'do-not-share', ref: 'local.edit', phase: 'committed' as const, paths: ['math.ts'], transitions: [{ path: 'math.ts', beforeSha256: sha('before'), afterSha256: sha('after') }] };
    a.observer.observe(event); event.transitions[0]!.beforeSha256 = sha('tampered');
    a.observer.observe({ sequence: 2, operationId: 'do-not-share', ref: 'outer', phase: 'failed' });
    // A later file cannot fabricate either endpoint.
    fs.writeFileSync(path.join(f.root, 'math.ts'), 'read-later');
    await a.invoke('status', {}, f.context);
    const journal = new FoveaProvenanceJournal(path.join(f.base, 'fovea'), nativePlatform);
    expect((await journal.read(f.worktree)).records).toMatchObject([{ path: 'math.ts', beforeSha256: sha('before'), afterSha256: sha('after') }]);
    committed(b, sha('after'), sha('second')); await b.invoke('status', {}, f.context);
    const doc = await journal.read(f.worktree); expect(new Set(doc.records.map(r => r.origin)).size).toBe(2);
    const serialized = JSON.stringify(doc);
    for (const secret of ['private_conversation', 'do-not-share', 'local.edit', 'read-later', 'focus', 'permission', f.root]) expect(serialized).not.toContain(secret);
    expect(fs.statSync(path.join(journal.directory, `${f.worktree}.json`)).mode & 0o777).toBe(0o600);
    expect((await journal.read(sha('another physical worktree'))).records).toEqual([]);
  });
  it('bounds overflow and rejects malformed/version/privacy/link/lock inputs without changing commit results', async () => {
    const f = fixture(), a = f.make();
    const journal = new FoveaProvenanceJournal(path.join(f.base, 'fovea'), nativePlatform);
    for (let i = 0; i < PROVENANCE_MAX_RECORDS + 3; i++) await journal.append(f.worktree, sha('owner'), [{ path: 'math.ts', beforeSha256: sha(String(i)), afterSha256: sha(String(i + 1)) }]);
    const doc = await journal.read(f.worktree); expect(doc.records).toHaveLength(PROVENANCE_MAX_RECORDS); expect(doc.records[0]!.sequence).toBe(4);
    const target = path.join(journal.directory, `${f.worktree}.json`);
    for (const bad of [{ ...doc, version: 2 }, { ...doc, prompt: 'private' }, { ...doc, records: [{ ...doc.records[0], path: '../escape' }] }]) {
      fs.writeFileSync(target, JSON.stringify(bad)); await expect(journal.read(f.worktree)).rejects.toThrow();
    }
    expect(() => committed(a, sha('known-before'), sha('known-after'))).not.toThrow();
    expect(await a.invoke('status', {}, f.context)).toMatchObject({ observations: { gap: true } });
    fs.unlinkSync(target); fs.symlinkSync(path.join(f.root, 'secret'), target); await expect(journal.read(f.worktree)).rejects.toThrow(); fs.unlinkSync(target);
    fs.writeFileSync(target + '.lock', '', { mode: 0o600 });
    await expect(journal.append(f.worktree, sha('owner'), [])).rejects.toThrow();
    expect(fs.existsSync(target + '.lock')).toBe(true);
  });
  it.skipIf(process.platform !== 'darwin')('reports a gap after native loader rejection without pathname fallback or source-result failure', async () => {
    vi.mocked(nativeLoader.loadManagedSourcePlatform).mockRejectedValue(new Error('untrusted generation'));
    const query = vi.spyOn(FoveaEngineProcess.prototype, 'query').mockResolvedValue({ red: false });
    const f = fixture(), a = f.make();
    expect(() => committed(a, sha('before'), sha('after'))).not.toThrow();
    expect(await a.invoke('status', {}, f.context)).toMatchObject({ observations: { gap: true } });
    expect(await a.invoke('sync', {}, f.context)).toMatchObject({ observationGap: true });
    expect(query.mock.calls.at(-1)![0].args.nativeProvenance).toMatchObject({ gap: true });
    expect(query.mock.calls.at(-1)![0].args.nativeProvenance).not.toHaveProperty('journal');
    expect(fs.existsSync(path.join(f.base, 'fovea', 'provenance'))).toBe(false);
  });
  it.skipIf(process.platform !== 'darwin')('revokes an admission queued behind native loader initialization', async () => {
    let release!: (platform: SourcePlatform) => void;
    vi.mocked(nativeLoader.loadManagedSourcePlatform).mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const f = fixture(), a = f.make(); committed(a, sha('a'), sha('b'));
    await Promise.resolve(); await a.close(); release(nativePlatform!);
    const journal = new FoveaProvenanceJournal(path.join(f.base, 'fovea'), nativePlatform);
    expect(await journal.read(f.worktree)).toMatchObject({ sequence: 0, records: [] });
  });
  it('revokes queued admissions and rejects private guest acknowledgment/provenance fields', async () => {
    const f = fixture(), a = f.make(); committed(a, sha('a'), sha('b')); await a.close();
    const b = f.make(); await b.invoke('status', {}, f.context);
    const journal = new FoveaProvenanceJournal(path.join(f.base, 'fovea'), nativePlatform); expect((await journal.read(f.worktree)).records).toEqual([]);
    committed(a, sha('b'), sha('c')); await b.invoke('status', {}, f.context); expect((await journal.read(f.worktree)).sequence).toBe(0);
    for (const key of ['commitPreparationId', 'nativeProvenance', 'trustedRulesSha256']) await expect(b.invoke('sync', { [key]: 'forged' }, f.context)).rejects.toThrow('Private');
    await expect(a.invoke('status', {}, f.context)).rejects.toThrow('revoked');
  });
});

describe.skipIf(!['linux', 'darwin'].includes(process.platform) || !fs.existsSync(parser.path))('source host/engine provenance integration', () => {
  it('two hosts share matching own/foreign transitions, not navigation, and sync never commits its baseline', async () => {
    const transport = sourceTransport(), f = fixture(), a = f.make(), b = f.make(); fs.writeFileSync(path.join(f.root, 'math.ts'), text);
    const focused = await a.invoke('focus', { query: 'calculateTotal' }, f.context);
    await expect(b.invoke('dwell', { focusId: focused.focusId }, f.context)).rejects.toThrow(/expired|Unknown/);
    b.observer.observe({ sequence: 1, operationId: 'read', ref: 'local.read', phase: 'access', paths: ['math.ts'] });
    expect(await a.invoke('sync', syncArgs, f.context)).toMatchObject({ red: false, details: { baseline: 'established' } });
    expect(await b.invoke('sync', syncArgs, f.context)).toMatchObject({ red: false, details: { baseline: 'established' } });
    fs.unlinkSync(path.join(f.root, 'math.ts')); committed(a, sha(text), null);
    const own = await a.invoke('sync', syncArgs, f.context), foreign = await b.invoke('sync', syncArgs, f.context);
    expect(own).toMatchObject({ red: true, delivered: false, delivery: 'steer', details: { provenance: { kind: 'current-session' } } });
    expect(foreign).toMatchObject({ red: true, delivery: 'next-prompt', details: { provenance: { kind: 'other-session' } } });
    expect(transport.mock.calls.some(([r]) => 'commitPreparationId' in r.args)).toBe(false);
    const replay = await a.invoke('sync', syncArgs, f.context); expect(replay.red).toBe(true);
    expect(transport.mock.calls.some(([r]) => 'commitPreparationId' in r.args)).toBe(false);
  }, 30000);
  it.each(['disabled', 'hidden'] as const)('never scans automatically or misrepresents presentation with sync mode %s', async mode => {
    const transport = sourceTransport(), f = fixture(), a = f.make();
    const settings = await a.invoke('settings', {}, f.context);
    const config = structuredClone(settings.config) as { sync: { mode: string } };
    config.sync.mode = mode;
    await a.invoke('configure', { scope: 'session', expectedRevision: settings.revision, config }, f.context);
    a.observer.observe({ sequence: 1, operationId: 'read', ref: 'local.read', phase: 'access', paths: ['math.ts'] });
    expect(await a.collectCallContext(['math.ts'], f.context, 4000)).toBeUndefined(); expect(transport).not.toHaveBeenCalled();
  });
  it('classifies interleaved exact SHA256 chains as mixed and uninstrumented external edits as unattributed', async () => {
    sourceTransport(); const f = fixture(), a = f.make(), b = f.make(); fs.writeFileSync(path.join(f.root, 'math.ts'), text);
    await a.invoke('sync', syncArgs, f.context); await b.invoke('sync', syncArgs, f.context);
    const middle = text.replace('1', '2'); fs.writeFileSync(path.join(f.root, 'math.ts'), middle); committed(a, sha(text), sha(middle));
    await a.invoke('status', {}, f.context); fs.unlinkSync(path.join(f.root, 'math.ts')); committed(b, sha(middle), null); await b.invoke('status', {}, f.context);
    const mixed = await a.invoke('sync', syncArgs, f.context); expect(mixed).toMatchObject({ red: true, details: { provenance: { kind: 'mixed' } } });
    const g = fixture(), c = g.make(); fs.writeFileSync(path.join(g.root, 'math.ts'), text);
    c.observer.observe({ sequence: 1, operationId: 'read', ref: 'local.read', phase: 'access', paths: ['math.ts'] });
    await c.invoke('sync', syncArgs, g.context);
    fs.unlinkSync(path.join(g.root, 'math.ts'));
    expect(await c.invoke('sync', syncArgs, g.context)).toMatchObject({ red: true, details: { provenance: { kind: 'unattributed' } } });
  }, 30000);
  it('overflow and malformed journals report gaps and never claim foreign-only ownership', async () => {
    sourceTransport(); const f = fixture(), a = f.make(); fs.writeFileSync(path.join(f.root, 'math.ts'), text);
    a.observer.observe({ sequence: 1, operationId: 'read', ref: 'local.read', phase: 'access', paths: ['math.ts'] });
    await a.invoke('sync', syncArgs, f.context);
    const journal = new FoveaProvenanceJournal(path.join(f.base, 'fovea'), nativePlatform);
    for (let i = 0; i < PROVENANCE_MAX_RECORDS + 1; i++) await journal.append(f.worktree, sha('foreign'), [{ path: 'other.ts', beforeSha256: sha(String(i)), afterSha256: sha(String(i + 1)) }]);
    fs.unlinkSync(path.join(f.root, 'math.ts')); await journal.append(f.worktree, sha('foreign'), [{ path: 'math.ts', beforeSha256: sha(text), afterSha256: null }]);
    const overflow = await a.invoke('sync', syncArgs, f.context);
    expect(overflow).toMatchObject({ observationGap: true, details: { provenance: { kind: 'unattributed' } } });
    fs.writeFileSync(path.join(journal.directory, `${f.worktree}.json`), '{');
    expect(await a.invoke('sync', syncArgs, f.context)).toMatchObject({ observationGap: true, details: { provenance: { kind: 'unattributed' } } });
  }, 30000);
  it('retires at 32 metadata roots and two hot roots, expires focus and re-enters with a fresh baseline', async () => {
    const f = fixture(); const storage = path.join(f.base, 'engine'); fs.mkdirSync(storage, { mode: 0o700 });
    const e = new FoveaEngine({ parser, storageRoot: storage }); cleanup.push(() => e.close());
    const request = (root: string, operation: string, args = {}): EngineRequest => ({ root, operation, args, conversationId: 'c', conversationEpoch: 1, rootId: 'r', authorizationEpoch: 1 });
    fs.writeFileSync(path.join(f.root, 'math.ts'), text);
    const focus = await e.query(request(f.root, 'focus', { query: 'calculateTotal' })); await e.query(request(f.root, 'sync'));
    for (let i = 0; i < 33; i++) { const root = path.join(f.base, `r${i}`); fs.mkdirSync(root); await e.query(request(root, 'sketch')); }
    expect(await e.query(request(f.root, 'status'))).toMatchObject({ roots: 32, hotRoots: 2, conversationLoaded: false });
    await expect(e.query(request(f.root, 'dwell', { focusId: focus.focusId }))).rejects.toThrow(/expired/);
    fs.unlinkSync(path.join(f.root, 'math.ts'));
    expect(await e.query(request(f.root, 'sync'))).toMatchObject({ red: false, observationGap: true, details: { baseline: 'established' } });
    expect(await e.query(request(f.root, 'status'))).toMatchObject({ roots: 32, hotRoots: 2 });
  }, 60000);
});
