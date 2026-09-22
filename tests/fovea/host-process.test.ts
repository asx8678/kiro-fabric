import { removeFixtureSync } from "../fixture-cleanup.mjs";
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FoveaEngineProcess } from '../../src/fovea/engine-process.js';
import { FoveaHost } from '../../src/fovea/host.js';
import { FoveaProvider } from '../../src/providers/repo-provider.js';
import type { FoveaQuery } from '../../src/fovea/protocol.js';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
function temporary() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fovea-process-'))); fs.chmodSync(base, 0o700);
  cleanups.push(() => removeFixtureSync(base, { recursive: true, force: true })); return base;
}
const parser = { path: path.resolve('.tmp/fovea-parser/ast-grep'), sha256: '7a5ab30160186184c0bf8bffc87da4af25123c183964cd98c11b0b354137db0a', version: '0.45.3' };
const query = (root: string, operation = 'status', args = {}): FoveaQuery => ({ root, operation, args, rootId: 'root', conversationId: 'conversation', conversationEpoch: 1, authorizationEpoch: 1 });
function fake(mode: string) {
  const base = temporary(), entrypoint = path.join(base, 'fault.mjs'), pidFile = path.join(base, 'pid'), ready = path.join(base, 'ready');
  const modeFile = path.join(base, 'mode'); fs.writeFileSync(modeFile, mode);
  // A bounded, inert fault peer: no real parser, no source access, no shell.
  fs.writeFileSync(entrypoint, `import fs from 'node:fs';
import { spawn } from 'node:child_process';
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
const reply = (id, value = {}) => process.send(JSON.stringify({version:1,id,ok:true,value}));
process.on('message', raw => {
 const m = JSON.parse(raw);
 if (m.type === 'initialize') { reply(m.id); return; }
 const mode = fs.readFileSync(${JSON.stringify(modeFile)}, 'utf8');
 if (m.type === 'retireConversation') { reply(m.id, {retired: mode !== 'false-retirement'}); return; }
 if (m.type !== 'query') return;
 if (mode === 'malformed') process.send('{');
 else if (mode === 'oversized') process.send('x'.repeat(1000001));
 else if (mode === 'foreign') reply('foreign_id');
 else if (mode === 'version') process.send(JSON.stringify({version:2,id:m.id,ok:true,value:{}}));
 else if (mode === 'exit') process.exit(7);
 else if (mode === 'hang') {
   const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'});
   fs.writeFileSync(${JSON.stringify(ready)}, JSON.stringify({pid: process.pid, descendant: child.pid}));
 } else reply(m.id, {pid:process.pid});
});
`);
  const engine = new FoveaEngineProcess({ parser, storageRoot: base, entrypoint }); cleanups.push(() => engine.close());
  return { base, engine, pidFile, ready, modeFile };
}
function gone(pid: number): boolean {
  try { process.kill(pid, 0); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error; }
}
function notRunning(pid: number): boolean {
  if (gone(pid)) return true;
  // Linux can retain a killed descendant as a zombie until its reaper runs.
  if (process.platform === 'linux') {
    try { return /\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error; }
  }
  return false;
}

describe('supervisor with a tiny fault child', () => {
  it('requires explicit private retirement confirmation and cleans an unconfirmed peer', async () => {
    for (const mode of ['healthy', 'false-retirement']) {
      const f = fake(mode);
      await f.engine.query(query(f.base), new AbortController().signal, 10_000);
      if (mode === 'healthy') {
        await f.engine.retireConversation('conversation', 1);
        expect(f.engine.active).toBe(true); expect(f.engine.starts).toBe(1);
      } else {
        await expect(f.engine.retireConversation('conversation', 1)).rejects.toThrow(/not confirmed/);
        expect(f.engine.active).toBe(false);
      }
    }
  });
  it('joins an in-progress worker stop before reporting idle retirement complete', async () => {
    const f = fake('healthy');
    await f.engine.query(query(f.base), new AbortController().signal, 10_000);
    let stopped = false;
    const stopping = f.engine.restart().then(() => { stopped = true; });
    try {
      await f.engine.retireConversation('conversation', 1);
      expect(stopped).toBe(true);
      expect(f.engine.active).toBe(false);
      expect(f.engine.starts).toBe(1);
    } finally { await stopping; }
  });
  it.each(['engine cleanup uncertain', 'Fovea process-group cleanup uncertain'])('retirement preserves the idle %s latch', async reason => {
    const f = fake('healthy'); f.engine.unavailable = reason;
    await expect(f.engine.retireConversation('conversation', 1)).rejects.toThrow(reason);
    expect(f.engine.starts).toBe(0);
    expect(f.engine.unavailable).toBe(reason);
  });
  it('reaps an idle owned leader before declaring shutdown settled', async () => {
    for (let i = 0; i < 5; i++) {
      const f = fake('healthy');
      const value = await f.engine.query(query(f.base), new AbortController().signal, 10_000);
      const pid = Number(value.pid);
      expect(gone(pid)).toBe(false);
      await f.engine.close();
      // No eventual poll: our own child must already be reaped when close settles.
      expect(gone(pid)).toBe(true);
      expect(f.engine.active).toBe(false);
    }
  }, 20_000);
  it.each(['malformed', 'oversized', 'foreign', 'version', 'exit'])('fails closed and cleans the child for %s response', async mode => {
    const f = fake(mode);
    await expect(f.engine.query(query(f.base), new AbortController().signal, 10_000)).rejects.toThrow(/malformed|unsolicited|exited/);
    expect(f.engine.starts).toBe(1); expect(f.engine.active).toBe(false);
    const pid = Number(fs.readFileSync(f.pidFile, 'utf8'));
    await expect.poll(() => gone(pid), { timeout: 5000 }).toBe(true);
  }, 20_000);
  it('settles cancellation only after killing the child and its process-group descendant', async () => {
    const f = fake('hang'), controller = new AbortController();
    const work = f.engine.query(query(f.base), controller.signal, 10_000);
    const rejected = expect(work).rejects.toThrow(/cancelled/);
    await expect.poll(() => fs.existsSync(f.ready), { timeout: 5000 }).toBe(true);
    const pids = JSON.parse(fs.readFileSync(f.ready, 'utf8')) as { pid: number; descendant: number };
    expect(gone(pids.pid)).toBe(false); expect(gone(pids.descendant)).toBe(false);
    controller.abort(new Error('test cancellation')); await rejected;
    expect(f.engine.active).toBe(false); expect(notRunning(pids.pid)).toBe(true); expect(notRunning(pids.descendant)).toBe(true);
    await f.engine.close(); await expect(f.engine.query(query(f.base), new AbortController().signal, 1000)).rejects.toThrow(/closed/);
  }, 20_000);
  it('supports repeated healthy reloads without consuming the crash budget', async () => {
    const f = fake('healthy');
    for (let i = 0; i < 6; i++) {
      const value = await f.engine.query(query(f.base), new AbortController().signal, 10_000);
      await f.engine.restart();
      expect(gone(Number(value.pid))).toBe(true);
      expect(f.engine.unavailable).toBeUndefined();
    }
    expect(f.engine.starts).toBe(6);
  }, 30_000);
  it('explicit reload recovers an exhausted crash budget after confirmed cleanup', async () => {
    const f = fake('malformed');
    for (let i = 0; i < 3; i++) await expect(f.engine.query(query(f.base), new AbortController().signal, 10_000)).rejects.toThrow(/malformed/);
    await expect(f.engine.query(query(f.base), new AbortController().signal, 10_000)).rejects.toThrow(/crash budget/);
    fs.writeFileSync(f.modeFile, 'healthy');
    await f.engine.restart();
    expect(f.engine.unavailable).toBeUndefined();
    expect(await f.engine.query(query(f.base), new AbortController().signal, 10_000)).toHaveProperty('pid');
    expect(f.engine.starts).toBe(4);
  }, 30_000);
  it.each(['engine cleanup uncertain', 'Fovea process-group cleanup uncertain'])('reload does not clear %s', async reason => {
    const f = fake('healthy');
    const value = await f.engine.query(query(f.base), new AbortController().signal, 10_000);
    f.engine.unavailable = reason;
    await expect(f.engine.restart()).rejects.toThrow(reason);
    expect(gone(Number(value.pid))).toBe(true);
    expect(f.engine.unavailable).toBe(reason);
    await expect(f.engine.query(query(f.base), new AbortController().signal, 10_000)).rejects.toThrow(reason);
    expect(f.engine.starts).toBe(1);
  });
  it('reload cannot reopen a closed host', async () => {
    const f = fake('healthy'); await f.engine.close();
    await expect(f.engine.restart()).rejects.toThrow(/closed/);
    expect(f.engine.starts).toBe(0);
  });
  it('does not spawn for pre-aborted work and bounds repeated crashes', async () => {
    const f = fake('malformed');
    await expect(f.engine.query(query(f.base), AbortSignal.abort(new Error('before start')), 1000)).rejects.toThrow('before start');
    expect(f.engine.starts).toBe(0); expect(fs.existsSync(f.pidFile)).toBe(false);
    for (let i = 0; i < 3; i++) await expect(f.engine.query(query(f.base), new AbortController().signal, 10_000)).rejects.toThrow(/malformed/);
    await expect(f.engine.query(query(f.base), new AbortController().signal, 10_000)).rejects.toThrow(/crash budget/);
    expect(f.engine.starts).toBe(3); expect(f.engine.active).toBe(false);
  }, 30_000);
});

const builtEntry = path.resolve('dist/fovea/engine-entry.js');
describe.skipIf(!fs.existsSync(builtEntry) || !fs.existsSync(parser.path) || process.platform !== 'linux')('actual built engine through persistent host', () => {
  it('adopted rule trust is conversation/epoch-local, survives authorized rebinding and never leaks through a warm graph', async () => {
    const base = temporary(), root = path.join(base, 'workspace'); fs.mkdirSync(root, { mode: 0o700 });
    fs.mkdirSync(path.join(root, '.fovea'), { mode: 0o700 }); fs.mkdirSync(path.join(root, 'custom'), { mode: 0o700 });
    const rules = JSON.stringify({ fileRoutes: [{ id: 'approved-pages', re: '^custom/(.*)\\.page$', verbs: 'exports', pathPrefix: '/approved' }] });
    fs.writeFileSync(path.join(root, '.fovea/rules.json'), rules, { mode: 0o600 });
    fs.writeFileSync(path.join(root, 'custom/hello.page'), 'export function GET() {}', { mode: 0o600 });
    const stat = fs.statSync(root, { bigint: true });
    const host = new FoveaHost({ dataRoot: base, configFile: path.join(base, 'config.json'), parser, entrypoint: builtEntry }); cleanups.push(() => host.close());
    const authority = { canonicalPath: root, deviceId: String(stat.dev), fileId: String(stat.ino), conversationId: 'a', conversationEpoch: 1, authorizationEpoch: 1 };
    const a = host.bind(authority), b = host.bind({ ...authority, conversationId: 'b' }), next = host.bind({ ...authority, conversationEpoch: 2 });
    const context = { cwd: root };
    const { createHash } = await import('node:crypto');
    await a.invoke('adoptRules', { expectedSha256: createHash('sha256').update(rules).digest('hex') }, context);
    expect(JSON.stringify(await a.invoke('anchors', {}, context))).toContain('/approved/hello');
    expect(JSON.stringify(await b.invoke('anchors', {}, context))).not.toContain('/approved/hello');
    expect(JSON.stringify(await next.invoke('anchors', {}, context))).not.toContain('/approved/hello');
    await a.close();
    const rebound = host.bind({ ...authority, authorizationEpoch: 2 });
    expect(JSON.stringify(await rebound.invoke('anchors', {}, context))).toContain('/approved/hello');
    expect(await rebound.invoke('status', {}, context)).toMatchObject({ engineStarts: 1 });
  }, 60_000);
  it('pages snapshots without widening; dwell changes focus; borrower close preserves owner process', async () => {
    const base = temporary(), root = path.join(base, 'workspace'); fs.mkdirSync(root, { mode: 0o700 });
    fs.writeFileSync(path.join(root, 'math.ts'), 'export function calculateTotal(n: number) { return n + 1; }\n');
    fs.writeFileSync(path.join(root, 'consumer.ts'), 'import { calculateTotal } from "./math.js";\nexport function checkout() { return calculateTotal(2); }\n');
    const stat = fs.statSync(root, { bigint: true });
    const host = new FoveaHost({ dataRoot: base, configFile: path.join(base, 'config.json'), parser, entrypoint: builtEntry }); cleanups.push(() => host.close());
    const authority = { canonicalPath: root, deviceId: String(stat.dev), fileId: String(stat.ino), conversationId: 'a', conversationEpoch: 1, authorizationEpoch: 1 };
    const client = host.bind(authority), other = host.bind({ ...authority, conversationId: 'b', authorizationEpoch: 2 });
    const provider = new FoveaProvider(client), context = { cwd: root };
    expect(await client.invoke('status', {}, context)).toMatchObject({ engineStarts: 0, engineActive: false });
    const focused = await client.invoke('focus', { query: 'calculateTotal', fresh: true, maxTokens: 2000 }, context);
    expect(focused).toMatchObject({ status: 'ok', focusId: expect.any(String), reads: expect.arrayContaining([expect.objectContaining({ path: 'math.ts', expectedSha256: expect.stringMatching(/^[a-f0-9]{64}$/) })]) });
    const first = await client.invoke('result', { resultId: focused.resultId, maxChars: 256 }, context);
    expect(first.nextCursor).toBeTypeOf('string');
    const pageArgs = { resultId: focused.resultId, cursor: first.nextCursor, maxChars: 256 };
    const page = await client.invoke('result', pageArgs, context);
    expect(await client.invoke('result', pageArgs, context)).toEqual(page);
    await expect(other.invoke('result', pageArgs, context)).rejects.toThrow(/foreign/);
    const widened = await client.invoke('dwell', { focusId: focused.focusId, maxTokens: 2000 }, context);
    expect(widened.focusRevision).toBeGreaterThan(focused.focusRevision as number);
    expect(await client.invoke('result', pageArgs, context)).toEqual(page);
    expect(await other.invoke('status', {}, context)).toMatchObject({ engineStarts: 1, engineActive: true });
    await provider.close();
    await expect(client.invoke('result', pageArgs, context)).rejects.toThrow(/revoked/);
    expect(await other.invoke('status', {}, context)).toMatchObject({ engineStarts: 1, engineActive: true });
    const another = await other.invoke('focus', { query: 'checkout' }, context);
    await other.invoke('reset', {}, context);
    await expect(other.invoke('result', { resultId: another.resultId }, context)).rejects.toThrow(/revoked/);
    await host.close(); await expect(other.invoke('status', {}, context)).rejects.toThrow(/shutdown/);
  }, 60_000);
});
