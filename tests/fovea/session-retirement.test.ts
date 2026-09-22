import { removeFixtureSync } from '../fixture-cleanup.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FoveaHost } from '../../src/fovea/host.js';
import { FoveaEngineProcess } from '../../src/fovea/engine-process.js';
import { FoveaEngine } from '../../src/fovea/engine.js';
import { FoveaScheduler } from '../../src/fovea/scheduler.js';
import { DEFAULT_FOVEA_CONFIG } from '../../src/fovea/config.js';
import { decodeRequest } from '../../src/fovea/protocol.js';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fovea-retirement-'))); fs.chmodSync(base, 0o700);
  cleanup.push(() => removeFixtureSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'root'); fs.mkdirSync(root, { mode: 0o700 });
  const s = fs.statSync(root, { bigint: true });
  const authority = { canonicalPath: root, deviceId: String(s.dev), fileId: String(s.ino), conversationId: 'a', conversationEpoch: 1, authorizationEpoch: 1 };
  const host = new FoveaHost({ dataRoot: base, configFile: path.join(base, 'config.json') }); cleanup.push(() => host.close());
  return { base, root, authority, host, ctx: { cwd: root } };
}

describe('private conversation retirement', () => {
  it('revokes all live leases synchronously, preserves other owners and shared configuration', async () => {
    const f = fixture(), otherRoot = fixture();
    const a = f.host.bind(f.authority), roaming = f.host.bind({ ...otherRoot.authority, conversationId: 'a' });
    const b = f.host.bind({ ...f.authority, conversationId: 'b' }), nextEpoch = f.host.bind({ ...f.authority, conversationEpoch: 2 });
    const session = structuredClone(DEFAULT_FOVEA_CONFIG); session.tools.defaultBudget = 1024;
    const global = structuredClone(DEFAULT_FOVEA_CONFIG); global.tools.defaultBudget = 2048;
    const project = structuredClone(DEFAULT_FOVEA_CONFIG); project.tools.defaultBudget = 4096;
    await a.invoke('configure', { config: session, scope: 'session', expectedRevision: 'absent' }, f.ctx);
    await b.invoke('configure', { config: global, scope: 'global', expectedRevision: 'absent' }, f.ctx);
    await b.invoke('configure', { config: project, scope: 'project', expectedRevision: 'absent' }, f.ctx);
    const retirement = f.host.retireConversation('a', 1);
    expect(() => f.host.bind(f.authority)).toThrow(/retirement pending/);
    await expect(a.invoke('settings', {}, f.ctx)).rejects.toThrow(/revoked/);
    await expect(roaming.invoke('status', {}, { cwd: otherRoot.root })).rejects.toThrow(/revoked/);
    await retirement;
    const fresh = f.host.bind({ ...f.authority, conversationEpoch: 3 });
    expect(await fresh.invoke('settings', {}, f.ctx)).toMatchObject({ scope: 'project', config: project });
    expect(await b.invoke('settings', {}, f.ctx)).toMatchObject({ scope: 'project', config: project });
    expect(await nextEpoch.invoke('settings', {}, f.ctx)).toMatchObject({ scope: 'project' });
    const freshRoot = f.host.bind({ ...otherRoot.authority, conversationEpoch: 3 });
    expect(await freshRoot.invoke('settings', {}, { cwd: otherRoot.root })).toMatchObject({ scope: 'global', config: global });
    expect(await fresh.invoke('status', {}, f.ctx)).toMatchObject({ engineStarts: 0 });
    await expect(fresh.invoke('retireConversation', {}, f.ctx)).rejects.toThrow(/Private/);
  });
  it('reclaims closed-binding controls beyond the lifetime capacity without starting analysis', async () => {
    const f = fixture();
    for (let i = 0; i < 160; i++) {
      const id = `owner_${i}`, a = f.host.bind({ ...f.authority, conversationId: id });
      await a.invoke('configure', { config: DEFAULT_FOVEA_CONFIG, scope: 'session', expectedRevision: 'absent' }, f.ctx);
      await a.close();
      await f.host.retireConversation(id, 1);
    }
    const a = f.host.bind(f.authority);
    expect(await a.invoke('settings', {}, f.ctx)).toMatchObject({ scope: 'defaults' });
    expect(await a.invoke('status', {}, f.ctx)).toMatchObject({ engineStarts: 0 });
  });
  it('cannot dispatch a lease that was queued before retirement', async () => {
    const f = fixture(), a = f.host.bind(f.authority);
    const queued = a.invoke('configure', { config: DEFAULT_FOVEA_CONFIG, scope: 'session', expectedRevision: 'absent' }, f.ctx);
    const rejected = expect(queued).rejects.toThrow(/revoked/);
    const retired = f.host.retireConversation('a', 1);
    await rejected; await retired;
    expect(await f.host.bind({ ...f.authority, conversationEpoch: 2 }).invoke('settings', {}, f.ctx)).toMatchObject({ scope: 'defaults' });
  });
  it('retirement is parser-free and independent of filesystem roots in engine and supervisor', async () => {
    const f = fixture(), parser = { path: '/not-admitted', sha256: '0'.repeat(64), version: '0.45.3' };
    const engine = new FoveaEngine({ parser, storageRoot: f.base }); cleanup.push(() => engine.close());
    const process = new FoveaEngineProcess({ parser, storageRoot: f.base }); cleanup.push(() => process.close());
    await engine.retireConversation('a', 1); await process.retireConversation('a', 1);
    expect(process.starts).toBe(0); expect(process.active).toBe(false);
    await expect(engine.retireConversation('../bad', 1)).rejects.toThrow(/Invalid/);
    expect(() => f.host.retireConversation('a', -1)).toThrow(/Invalid/);
    const frame = { version: 1, id: 'r1', type: 'retireConversation', conversationId: 'a', conversationEpoch: 1 };
    expect(decodeRequest(JSON.stringify(frame))).toEqual(frame);
    for (const extra of [{ root: f.root }, { conversationEpoch: -1 }, { conversationId: '../bad' }, { version: 2 }]) expect(() => decodeRequest(JSON.stringify({ ...frame, ...extra }))).toThrow();
  });
  it('latches failed retirement instead of regranting uncleared conversation state', async () => {
    const f = fixture();
    const host = new FoveaHost({ dataRoot: f.base, configFile: path.join(f.base, 'failed.json'), parser: { path: '/not-admitted', sha256: '0'.repeat(64), version: '0.45.3' } });
    cleanup.push(() => host.close());
    const a = host.bind(f.authority);
    const failure = vi.spyOn(FoveaEngineProcess.prototype, 'retireConversation').mockRejectedValue(new Error('cleanup uncertain'));
    const retired = host.retireConversation('a', 1);
    await expect(retired).rejects.toThrow('cleanup uncertain');
    await expect(a.invoke('status', {}, f.ctx)).rejects.toThrow(/revoked/);
    expect(() => host.bind(f.authority)).toThrow(/retirement pending/);
    expect(host.retireConversation('a', 1)).toBe(retired);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(await host.bind({ ...f.authority, conversationId: 'other' }).invoke('settings', {}, f.ctx)).toMatchObject({ scope: 'defaults' });
  });
  it('reserves bounded retirement admission behind a full analysis queue', async () => {
    const scheduler = new FoveaScheduler(), signal = new AbortController().signal;
    let release!: () => void;
    const first = scheduler.run(signal, () => new Promise<void>(r => { release = r; }));
    const pending = Array.from({ length: 16 }, () => scheduler.run(signal, async () => {}));
    await expect(scheduler.run(signal, async () => {})).rejects.toThrow(/full/);
    const retire = vi.fn(async () => {});
    const barrier = scheduler.run(signal, retire, true);
    expect(retire).not.toHaveBeenCalled();
    release(); await Promise.all([first, ...pending, barrier]);
    expect(retire).toHaveBeenCalledTimes(1); scheduler.close();
  });
});
