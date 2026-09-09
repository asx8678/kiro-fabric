import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPinnedRecovery } from '../src/installation/pinned-recovery.mjs';

const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill('SIGKILL'); await exited;
  }
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const id = (file: string) => { const s = fs.statSync(file, { bigint: true }); return { dev: String(s.dev), ino: String(s.ino) }; };
const fixture = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pinned-recovery-'))); roots.push(root);
  const lock = path.join(root, 'lock ü space'); fs.mkdirSync(lock, { mode: 0o700 });
  const owner = path.join(lock, 'owner.json'); fs.writeFileSync(owner, '{"fixture":true}\n', { mode: 0o600 });
  const expected = { root: id(root), lock: id(lock), owner: { file: id(owner), hash: createHash('sha256').update(fs.readFileSync(owner)).digest('hex') }, claims: [] };
  return { root, lock, owner, expected, claim: path.join(lock, 'claim-00.json') };
};
const message = (child: ChildProcess) => new Promise<any>((resolve, reject) => {
  const timeout = setTimeout(() => { cleanup(); reject(new Error('pinned helper message timeout')); }, 5000);
  const received = (value: unknown) => { cleanup(); resolve(value); };
  const failed = (error: unknown) => { cleanup(); reject(error); };
  const exited = () => failed(new Error('pinned helper exited before message'));
  const cleanup = () => { clearTimeout(timeout); child.off('message', received); child.off('error', failed); child.off('exit', exited); };
  child.once('message', received); child.once('error', failed); child.once('exit', exited);
});

describe('kernel-pinned child recovery', () => {
  it('inspects without mutation, ignores inherited Node options, and never changes parent cwd', () => {
    const f = fixture(), cwd = process.cwd();
    const before = fs.statSync(f.owner, { bigint: true });
    vi.stubEnv('NODE_OPTIONS', '--require /must-not-be-loaded-by-recovery');
    runPinnedRecovery(f.lock, f.expected);
    const after = fs.statSync(f.owner, { bigint: true });
    expect([after.ino, after.mtimeNs, after.ctimeNs]).toEqual([before.ino, before.mtimeNs, before.ctimeNs]);
    expect(fs.readdirSync(f.lock)).toEqual(['owner.json']); expect(process.cwd()).toBe(cwd);
  });
  it('creates an exclusive empty claim and publishes only to that exact inode', () => {
    const f = fixture(), cwd = process.cwd();
    const created = runPinnedRecovery(f.lock, f.expected, { operation: 'create' });
    expect(fs.readFileSync(f.claim, 'utf8')).toBe(''); expect(id(f.claim)).toEqual(created);
    expect(() => runPinnedRecovery(f.lock, f.expected, { operation: 'create' })).toThrow();
    runPinnedRecovery(f.lock, f.expected, { operation: 'publish', created, text: '{"claim":true}\n' });
    expect(fs.readFileSync(f.claim, 'utf8')).toBe('{"claim":true}\n'); expect(id(f.claim)).toEqual(created);
    expect(process.cwd()).toBe(cwd);
  });
  it.each(['directory', 'claim', 'owner'])('refuses a replaced %s without writing replacement bytes', (kind) => {
    const f = fixture();
    const created = runPinnedRecovery(f.lock, f.expected, { operation: 'create' });
    if (kind === 'directory') {
      fs.renameSync(f.lock, path.join(f.root, 'saved'));
      fs.mkdirSync(f.lock, { mode: 0o700 }); fs.writeFileSync(f.owner, 'foreign', { mode: 0o600 });
    } else {
      const target = kind === 'claim' ? f.claim : f.owner;
      fs.renameSync(target, path.join(f.root, 'saved'));
      fs.writeFileSync(target, kind === 'claim' ? '' : 'foreign', { mode: 0o600 });
    }
    const before = fs.readdirSync(f.lock).map(n => [n, fs.readFileSync(path.join(f.lock, n)).toString('base64')]);
    expect(() => runPinnedRecovery(f.lock, f.expected, { operation: 'publish', created, text: '{"must":"not-write"}\n' })).toThrow();
    expect(fs.readdirSync(f.lock).map(n => [n, fs.readFileSync(path.join(f.lock, n)).toString('base64')])).toEqual(before);
  });
  it.each(['{"bad":true}', '{"large":"' + 'x'.repeat(4100) + '"}\n'])('preserves empty claim when publication violates canonical/bounded input', text => {
    const f = fixture(); const created = runPinnedRecovery(f.lock, f.expected, { operation: 'create' });
    expect(() => runPinnedRecovery(f.lock, f.expected, { operation: 'publish', created, text })).toThrow();
    expect(fs.readFileSync(f.claim, 'utf8')).toBe('');
  });
  it('retains the original cwd inode when its pathname is replaced after child startup', async () => {
    const f = fixture();
    const module = new URL('../src/installation/pinned-recovery.mjs', import.meta.url).href;
    const code = `import fs from 'node:fs'; import {createHash} from 'node:crypto'; import {pinnedRecoveryChild} from ${JSON.stringify(module)};
      process.once('message', () => { try { process.send(pinnedRecoveryChild(fs, createHash, JSON.parse(process.argv[1]))); } catch(e) { process.send({error:String(e)}); } finally { process.disconnect(); } }); process.send({ready:true});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, JSON.stringify({ ...f.expected, operation: 'create' })], { cwd: f.lock, env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }); children.push(child);
    expect(await message(child)).toEqual({ ready: true });
    const saved = path.join(f.root, 'original-inode'); fs.renameSync(f.lock, saved);
    fs.mkdirSync(f.lock, { mode: 0o700 }); fs.writeFileSync(f.owner, 'replacement-must-not-change', { mode: 0o600 });
    const result = message(child); child.send('go'); expect(await result).toMatchObject({ ok: true });
    expect(fs.readFileSync(path.join(saved, 'claim-00.json'), 'utf8')).toBe('');
    expect(fs.readdirSync(f.lock)).toEqual(['owner.json']); expect(fs.readFileSync(f.owner, 'utf8')).toBe('replacement-must-not-change');
  });
});
