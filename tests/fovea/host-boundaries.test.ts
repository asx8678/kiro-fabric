import { removeFixtureSync } from "../fixture-cleanup.mjs";
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FoveaHost } from '../../src/fovea/host.js';
import { FoveaProvider } from '../../src/providers/repo-provider.js';
import { FoveaRootLeases } from '../../src/fovea/root-leases.js';
import { FoveaResultStore, type ResultOwner } from '../../src/fovea/result-store.js';
import { FoveaScheduler } from '../../src/fovea/scheduler.js';
import { FoveaOutbox } from '../../src/fovea/delivery.js';
import { DEFAULT_FOVEA_CONFIG, FoveaConfiguration, validateFoveaConfig } from '../../src/fovea/config.js';
import { decodeRequest, decodeResponse, projectEngineJson, FOVEA_FRAME_CHARS, FOVEA_REQUEST_CHARS } from '../../src/fovea/protocol.js';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fovea-host-')));
  fs.chmodSync(base, 0o700);
  cleanup.push(() => removeFixtureSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'source'); fs.mkdirSync(root, { mode: 0o700 });
  const s = fs.statSync(root, { bigint: true });
  return { base, root, authority: { canonicalPath: root, deviceId: String(s.dev), fileId: String(s.ino), conversationId: 'conversation', conversationEpoch: 1, authorizationEpoch: 1 } };
}
const owner: ResultOwner = { conversationId: 'a', conversationEpoch: 1, rootId: 'root', authorizationEpoch: 1, engineGeneration: 1 };

describe('bounded private IPC', () => {
  it('rejects oversized, malformed, unknown-version and extra-field frames', () => {
    for (const raw of [null, {}, 'x'.repeat(FOVEA_REQUEST_CHARS + 1), '{', '[]', JSON.stringify({ version: 2, type: 'cancel', id: 'a' }), JSON.stringify({ version: 1, type: 'cancel', id: 'a', root: '/tmp' })]) expect(() => decodeRequest(raw)).toThrow();
    for (const raw of [null, {}, 'x'.repeat(FOVEA_FRAME_CHARS + 1), '{', JSON.stringify({ version: 2, id: 'a', ok: true, value: {} }), JSON.stringify({ version: 1, id: 'a', ok: true, value: {}, extra: true }), JSON.stringify({ version: 1, id: 'a', ok: false, error: 'e'.repeat(801) })]) expect(() => decodeResponse(raw)).toThrow();
    expect(decodeRequest('{"version":1,"type":"cancel","id":"a"}')).toEqual({ version: 1, type: 'cancel', id: 'a' });
    expect(decodeResponse('{"version":1,"id":"a","ok":true,"value":{}}')).toEqual({ version: 1, id: 'a', ok: true, value: {} });
  });
  it('bounds projection without executing accessors or accepting cycles/nonfinite claims', () => {
    let accessed = false; const accessor = { get value() { accessed = true; return 1; } };
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    let deep: Record<string, unknown> = {}; for (let i = 0; i < 30; i++) deep = { child: deep };
    for (const value of [accessor, cycle, deep, { n: Infinity }, new Date(), { values: Array(30_001).fill(0) }, { text: 'x'.repeat(1001) }]) expect(() => projectEngineJson(value, 1000)).toThrow();
    expect(accessed).toBe(false);
    expect(projectEngineJson({ present: 1, absent: undefined })).toEqual({ present: 1 });
  });
});

describe('retained result capabilities', () => {
  it('replays immutable pages, authenticates cursors and binds every owner dimension', () => {
    const store = new FoveaResultStore(); const value = { text: 'a'.repeat(700), details: { token: 'needle' } };
    const id = store.put(owner, value), other = store.put(owner, value); value.details.token = 'changed';
    const first = store.page(owner, id, undefined, 256), cursor = first.nextCursor as string;
    expect(store.page(owner, id, cursor, 256)).toEqual(store.page(owner, id, cursor, 256));
    expect(store.search(owner, id, 'needle')).toMatchObject({ matches: [expect.objectContaining({ text: expect.stringContaining('needle') })] });
    expect(store.search(owner, id, 'changed')).toMatchObject({ matches: [] });
    expect(() => store.page(owner, other, cursor)).toThrow(/cursor/);
    expect(() => store.page(owner, id, `0.${'0'.repeat(64)}`)).toThrow(/cursor/);
    for (const key of Object.keys(owner) as (keyof ResultOwner)[]) {
      const foreign = { ...owner, [key]: typeof owner[key] === 'number' ? 2 : 'foreign' } as ResultOwner;
      expect(() => store.page(foreign, id, cursor)).toThrow(/foreign/);
      expect(() => store.search(foreign, id, 'needle')).toThrow(/foreign/);
    }
    store.revoke(owner.rootId, owner.authorizationEpoch);
    expect(() => store.page(owner, id, cursor)).toThrow(/revoked/);
    expect(() => store.search(owner, id, 'needle')).toThrow(/revoked/);
  });
  it('expires and evicts old snapshots and does not split UTF-16 pairs', () => {
    let now = 0; const store = new FoveaResultStore(() => now, 10);
    const id = store.put(owner, { text: 'a'.repeat(246) + '😀tail' });
    const first = store.page(owner, id, undefined, 256);
    expect((first.text as string).endsWith('\ud83d')).toBe(false);
    const second = store.page(owner, id, first.nextCursor as string, 256);
    expect(JSON.parse(String(first.text) + String(second.text))).toEqual({ text: 'a'.repeat(246) + '😀tail' });
    now = 10; expect(() => store.page(owner, id)).toThrow(/expired/);
    const oldest = store.put(owner, {}); for (let i = 0; i < 32; i++) store.put(owner, {});
    expect(() => store.page(owner, oldest)).toThrow(/unavailable/);
  });
});

it('isolates session settings by conversation and epoch while retaining same-conversation rebinding', async () => {
  const f = fixture(), otherRoot = fixture();
  const host = new FoveaHost({ dataRoot: f.base, configFile: path.join(f.base, 'config.json') }); cleanup.push(() => host.close());
  const a = host.bind(f.authority), b = host.bind({ ...f.authority, conversationId: 'other' });
  const nextEpoch = host.bind({ ...f.authority, conversationEpoch: 2 });
  const roaming = host.bind({ ...otherRoot.authority, conversationId: f.authority.conversationId });
  const ctx = { cwd: f.root };
  const session = structuredClone(DEFAULT_FOVEA_CONFIG); session.tools.defaultBudget = 2048;
  await a.invoke('configure', { config: session, scope: 'session', expectedRevision: 'absent' }, ctx);
  expect(await b.invoke('settings', {}, ctx)).toMatchObject({ scope: 'defaults', config: DEFAULT_FOVEA_CONFIG });
  expect(await nextEpoch.invoke('settings', {}, ctx)).toMatchObject({ scope: 'defaults', config: DEFAULT_FOVEA_CONFIG });
  expect(await roaming.invoke('settings', {}, ctx)).toMatchObject({ scope: 'session', config: session });
  await a.close();
  const rebound = host.bind({ ...f.authority, authorizationEpoch: 2 });
  expect(await rebound.invoke('settings', {}, ctx)).toMatchObject({ scope: 'session', config: session });
  // Project/global profiles remain intentionally persistent/shared, but B cannot
  // clear A's private session overlay by publishing a global profile.
  const global = structuredClone(DEFAULT_FOVEA_CONFIG); global.tools.defaultBudget = 1024;
  await b.invoke('configure', { config: global, scope: 'global', expectedRevision: 'absent' }, ctx);
  expect(await nextEpoch.invoke('settings', {}, ctx)).toMatchObject({ scope: 'global', config: global });
  expect(await rebound.invoke('settings', {}, ctx)).toMatchObject({ scope: 'session', config: session });
  const project = structuredClone(DEFAULT_FOVEA_CONFIG); project.tools.defaultBudget = 4096;
  await b.invoke('configure', { config: project, scope: 'project', expectedRevision: 'absent' }, ctx);
  expect(await nextEpoch.invoke('settings', {}, ctx)).toMatchObject({ scope: 'project', config: project });
  expect(await rebound.invoke('settings', {}, ctx)).toMatchObject({ scope: 'session', config: session });
  expect(await roaming.invoke('settings', {}, ctx)).toMatchObject({ scope: 'session', config: session });
});

it('presents unsupported settings through every public control without starting analysis', async () => {
  const f = fixture();
  const host = new FoveaHost({ dataRoot: f.base, configFile: path.join(f.base, 'config.json') }); cleanup.push(() => host.close());
  const provider = new FoveaProvider(host.bind(f.authority)), ctx = { cwd: f.root };
  const initial = await provider.invoke('settings', {}, ctx) as { revision: string; settingSupport: unknown };
  const config = structuredClone(DEFAULT_FOVEA_CONFIG); config.sync.ackClean = true;
  const changed = await provider.invoke('configure', { config, scope: 'session', expectedRevision: initial.revision }, ctx) as { settingSupport: unknown };
  expect(await provider.invoke('settings', {}, ctx)).toEqual(changed);
  expect(changed.settingSupport).toEqual({ 'sync.ackClean': expect.objectContaining({ supported: false, requested: true, effective: false }) });
  expect(await provider.invoke('status', {}, ctx)).toMatchObject({ engineStarts: 0, requested: config, settingSupport: changed.settingSupport, capabilities: { automatic: false } });
  expect((await provider.describe('settings'))?.description).toContain('settingSupport');
  expect((await provider.describe('configure'))?.risk).toBe('write');
});

it('bounds retained conversation controls without revoking active conversations or leaking failed bindings', async () => {
  const f = fixture();
  const host = new FoveaHost({ dataRoot: f.base, configFile: path.join(f.base, 'config.json') }); cleanup.push(() => host.close());
  const active = host.bind(f.authority);
  for (let i = 0; i < 127; i++) await host.bind({ ...f.authority, conversationId: `retained_${i}` }).close();
  for (let i = 0; i < 40; i++) expect(() => host.bind({ ...f.authority, conversationId: 'overflow' })).toThrow(/conversation.*capacity/i);
  const rebound = host.bind(f.authority);
  expect(await active.invoke('status', {}, { cwd: f.root })).toMatchObject({ engineStarts: 0 });
  expect(await rebound.invoke('settings', {}, { cwd: f.root })).toMatchObject({ scope: 'defaults' });
});

it('bounds adopted worktree trust per conversation without evicting approvals or blocking other owners', async () => {
  const f = fixture();
  const host = new FoveaHost({ dataRoot: f.base, configFile: path.join(f.base, 'config.json') }); cleanup.push(() => host.close());
  const { createHash } = await import('node:crypto');
  const expectedSha256 = createHash('sha256').update('{"rules":[]}').digest('hex');
  const authorities = [];
  for (let i = 0; i < 33; i++) {
    const root = path.join(f.base, `repo-${i}`); fs.mkdirSync(root, { mode: 0o700 }); fs.mkdirSync(path.join(root, '.fovea'), { mode: 0o700 });
    fs.writeFileSync(path.join(root, '.fovea/rules.json'), '{"rules":[]}', { mode: 0o600 });
    const s = fs.statSync(root, { bigint: true });
    const authority = { ...f.authority, canonicalPath: root, deviceId: String(s.dev), fileId: String(s.ino) }; authorities.push(authority);
    const client = host.bind(authority), pending = client.invoke('adoptRules', { expectedSha256 }, { cwd: root });
    if (i < 32) expect(await pending).toMatchObject({ adopted: true });
    else await expect(pending).rejects.toThrow(/rule trust capacity/);
    await client.close();
  }
  const repeat = host.bind(authorities[0]!);
  expect(await repeat.invoke('adoptRules', { expectedSha256 }, { cwd: f.root })).toMatchObject({ adopted: true });
  const independent = host.bind({ ...authorities[32]!, conversationId: 'independent' });
  expect(await independent.invoke('adoptRules', { expectedSha256 }, { cwd: f.root })).toMatchObject({ adopted: true });
});

it('rejects a replaced root and revoked/copied/foreign leases', () => {
  const f = fixture(), leases = new FoveaRootLeases(), lease = leases.issue(f.authority);
  expect(() => leases.check(lease, 'foreign')).toThrow(/rootId/);
  expect(() => leases.check({ ...lease })).toThrow(/revoked/);
  fs.renameSync(f.root, f.root + '-old'); fs.mkdirSync(f.root);
  expect(() => leases.check(lease)).toThrow(/identity changed/);
  fs.rmdirSync(f.root); fs.symlinkSync(f.root + '-old', f.root);
  expect(() => leases.check(lease)).toThrow();
  leases.revoke(lease); expect(lease.signal.aborted).toBe(true);
  expect(() => leases.check(lease)).toThrow(/revoked/);
});

it('strict config rejects versions/overrides and writes with revision/private-file checks', () => {
  const f = fixture(), file = path.join(f.base, 'fovea.v1.json'), config = new FoveaConfiguration(file);
  const initial = config.read(); expect(initial).toMatchObject({ revision: 'absent', scope: 'defaults' });
  for (const invalid of [{ ...DEFAULT_FOVEA_CONFIG, schemaVersion: 2 }, { ...DEFAULT_FOVEA_CONFIG, executable: '/bin/sh' }, { ...DEFAULT_FOVEA_CONFIG, tools: { ...DEFAULT_FOVEA_CONFIG.tools, root: '/' } }, { ...DEFAULT_FOVEA_CONFIG, sync: { ...DEFAULT_FOVEA_CONFIG.sync, budget: 1.5 } }]) expect(() => validateFoveaConfig(invalid)).toThrow(/Invalid/);
  const next = structuredClone(DEFAULT_FOVEA_CONFIG); next.tools.defaultBudget = 1024;
  config.update(next, 'session', initial.revision); expect(fs.existsSync(file)).toBe(false);
  config.reload(); expect(config.read()).toEqual(initial);
  const written = config.update(next, 'global', initial.revision);
  expect(written).toMatchObject({ config: next, scope: 'global' }); expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  expect(() => config.update(DEFAULT_FOVEA_CONFIG, 'global', initial.revision)).toThrow(/changed/);
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(next);
  expect(fs.readdirSync(f.base).filter(p => p.endsWith('.tmp'))).toEqual([]);
  fs.chmodSync(file, 0o660); expect(() => config.read()).toThrow(/Unsafe/);
  fs.chmodSync(file, 0o600); fs.linkSync(file, file + '.link'); expect(() => config.read()).toThrow(/Unsafe/);
  fs.unlinkSync(file + '.link'); fs.renameSync(file, file + '.real'); fs.symlinkSync(file + '.real', file); expect(() => config.read()).toThrow();
});

it('cancels queued admission immediately, bounds backlog and closes without dispatching it', async () => {
  const scheduler = new FoveaScheduler(); let release!: () => void, ran = 0;
  expect(scheduler.busy).toBe(false);
  const active = scheduler.run(new AbortController().signal, () => new Promise<void>(r => { release = r; }));
  expect(scheduler.busy).toBe(true);
  const abort = new AbortController(); const cancelled = scheduler.run(abort.signal, async () => { ran++; });
  const rejection = expect(cancelled).rejects.toThrow('queued stop'); abort.abort(new Error('queued stop')); await rejection;
  const queued = Array.from({ length: 16 }, () => scheduler.run(new AbortController().signal, async () => { ran++; }).catch(e => e as Error));
  await expect(scheduler.run(new AbortController().signal, async () => {})).rejects.toThrow(/full/);
  scheduler.close(); expect((await Promise.all(queued)).every(e => e instanceof Error && /closed/.test(e.message))).toBe(true);
  release(); await active; expect(ran).toBe(0);
  await expect(scheduler.run(new AbortController().signal, async () => {})).rejects.toThrow(/unavailable/);
});

it('keeps delivery selection distinct from emission, uncertainty and acknowledgement', () => {
  const outbox = new FoveaOutbox(() => 1); const id = outbox.prepare('root', 1, 'notice', 'own');
  expect(outbox.prepare('root', 1, 'notice', 'own')).toBe(id);
  expect(outbox.select('foreign', 1, 1000)).toEqual([]); expect(outbox.select('root', 2, 1000)).toEqual([]);
  expect(outbox.select('root', 1, 165)).toEqual([]);
  const selected = outbox.select('root', 1, 166); selected[0]!.text = 'mutated';
  expect(outbox.select('root', 1, 166)[0]!.text).toBe('notice');
  expect(outbox.status()).toEqual({ pending: 1, emitted: 0, uncertain: 0, acknowledged: 0 });
  outbox.emitted([id]); outbox.uncertain([id]); expect(outbox.select('root', 1, 1000)).toEqual([]);
  expect(outbox.status()).toMatchObject({ uncertain: 1, acknowledged: 0 });
  outbox.replay(); expect(outbox.select('root', 1, 1000)).toHaveLength(1);
  outbox.revoke('root'); expect(outbox.status()).toEqual({ pending: 0, emitted: 0, uncertain: 0, acknowledged: 0 });
});

it.each([false, true])('status/settings stay lazy; borrowed provider close never owns host shutdown (parser=%s)', async hasParser => {
  const f = fixture(); const host = new FoveaHost({ dataRoot: f.base, configFile: path.join(f.base, 'config.json'), ...(hasParser ? { parser: { path: '/nonexistent-parser', sha256: '0'.repeat(64), version: 'test' }, entrypoint: '/nonexistent-engine.mjs' } : {}) });
  cleanup.push(() => host.close());
  const client = host.bind(f.authority), survivor = host.bind({ ...f.authority, authorizationEpoch: 2 }), provider = new FoveaProvider(client), context = { cwd: f.root };
  expect(await provider.invoke('status', {}, context)).toMatchObject({ engineStarts: 0, engineActive: false, available: hasParser });
  expect(await provider.invoke('settings', {}, context)).toMatchObject({ scope: 'defaults' });
  if (!hasParser) await expect(provider.invoke('focus', { query: 'x' }, context)).rejects.toThrow(/unavailable/);
  expect(await client.invoke('status', {}, context)).toMatchObject({ engineStarts: 0 });
  await provider.close(); await provider.close();
  await expect(provider.invoke('status', {}, context)).rejects.toThrow(/released/);
  await expect(client.invoke('status', {}, context)).rejects.toThrow(/revoked/);
  expect(await survivor.invoke('status', {}, context)).toMatchObject({ engineStarts: 0 });
  await host.close(); await expect(survivor.invoke('status', {}, context)).rejects.toThrow(/shutdown/);
  expect(() => host.bind(f.authority)).toThrow(/shutdown/);
});
