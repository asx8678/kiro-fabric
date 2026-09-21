import { removeFixtureSync } from "./fixture-cleanup.mjs";
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
  for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true });
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
  it('inspects and exclusively restores the exact release-marker inode without changing cwd', () => {
    const f = fixture(), marker = path.join(f.root, '.install-lock-release.json'), cwd = process.cwd();
    fs.linkSync(f.owner, marker); fs.unlinkSync(f.owner);
    const expected = { ...f.expected, releasing: true, hasOwner: false, owner: { ...f.expected.owner, value: { lockBirth: String(fs.statSync(f.lock, { bigint: true }).birthtimeNs) } } };
    const before = fs.statSync(marker, { bigint: true }); runPinnedRecovery(f.lock, expected);
    expect(fs.readdirSync(f.lock)).toEqual([]); expect(fs.statSync(marker, { bigint: true }).ctimeNs).toBe(before.ctimeNs);
    runPinnedRecovery(f.lock, expected, { operation: 'restore' });
    expect(id(f.owner)).toEqual(id(marker)); expect(fs.statSync(marker).nlink).toBe(2);
    runPinnedRecovery(f.lock, { ...expected, hasOwner: true });
    expect(() => runPinnedRecovery(f.lock, expected, { operation: 'restore' })).toThrow();
    expect(process.cwd()).toBe(cwd);
  });
  it('keeps native claim creation/publication exclusive while the owner has a proven release link', () => {
    const f = fixture(), marker = path.join(f.root, '.install-lock-release.json'); fs.linkSync(f.owner, marker);
    const expected = { ...f.expected, linkedRelease: true };
    runPinnedRecovery(f.lock, expected);
    const created = runPinnedRecovery(f.lock, expected, { operation: 'create' });
    runPinnedRecovery(f.lock, expected, { operation: 'publish', created, text: '{"claim":true}\n' });
    const claim = { file: id(f.claim), hash: createHash('sha256').update(fs.readFileSync(f.claim)).digest('hex') };
    runPinnedRecovery(f.lock, { ...expected, claims: [claim] });
    expect(fs.statSync(f.claim).nlink).toBe(1); expect(fs.statSync(marker).nlink).toBe(2);
    fs.linkSync(f.claim, path.join(f.root, 'foreign-claim-link'));
    expect(() => runPinnedRecovery(f.lock, { ...expected, claims: [claim] })).toThrow();
    expect(fs.readFileSync(f.claim, 'utf8')).toBe('{"claim":true}\n');
  });
  it.each(['marker-inode', 'birth', 'owner', 'extra', 'root', 'hardlink'])('preserves %s mutation during native release restoration', kind => {
    const f = fixture(), marker = path.join(f.root, '.install-lock-release.json');
    fs.linkSync(f.owner, marker); fs.unlinkSync(f.owner);
    const expected = { ...f.expected, releasing: true, hasOwner: false, owner: { ...f.expected.owner, value: { lockBirth: String(fs.statSync(f.lock, { bigint: true }).birthtimeNs) } } };
    if (kind === 'marker-inode') { const bytes = fs.readFileSync(marker); fs.renameSync(marker, path.join(f.root, 'saved')); fs.writeFileSync(marker, bytes, { mode: 0o600 }); }
    else if (kind === 'birth') expected.owner.value.lockBirth = '1';
    else if (kind === 'root') expected.root = { ...expected.root, ino: '0' };
    else if (kind === 'hardlink') fs.linkSync(marker, path.join(f.root, 'foreign-link'));
    else fs.writeFileSync(kind === 'owner' ? f.owner : path.join(f.lock, 'evidence'), 'foreign', { mode: 0o600 });
    const bytes = fs.readFileSync(marker), names = fs.readdirSync(f.lock);
    expect(() => runPinnedRecovery(f.lock, expected, { operation: 'restore' })).toThrow();
    expect(fs.readFileSync(marker)).toEqual(bytes); expect(fs.readdirSync(f.lock)).toEqual(names);
    if (kind === 'owner') expect(fs.readFileSync(f.owner, 'utf8')).toBe('foreign');
  });
  it('pins release restoration to the original child cwd despite a replacement pathname', async () => {
    const f = fixture(), marker = path.join(f.root, '.install-lock-release.json'); fs.linkSync(f.owner, marker); fs.unlinkSync(f.owner);
    const request = { ...f.expected, releasing: true, hasOwner: false, operation: 'restore', birth: String(fs.statSync(f.lock, { bigint: true }).birthtimeNs) };
    const module = new URL('../src/installation/pinned-recovery.mjs', import.meta.url).href;
    const code = `import fs from 'node:fs'; import {createHash} from 'node:crypto'; import {pinnedRecoveryChild} from ${JSON.stringify(module)};
      process.once('message', () => { try { process.send(pinnedRecoveryChild(fs, createHash, JSON.parse(process.argv[1]))); } catch(e) { process.send({error:String(e)}); } finally { process.disconnect(); } }); process.send({ready:true});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, JSON.stringify(request)], { cwd: f.lock, env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }); children.push(child);
    expect(await message(child)).toEqual({ ready: true });
    const saved = path.join(f.root, 'saved-lock'); fs.renameSync(f.lock, saved); fs.mkdirSync(f.lock, { mode: 0o700 });
    fs.writeFileSync(f.owner, 'foreign', { mode: 0o600 });
    const result = message(child); child.send('go'); expect(await result).toMatchObject({ ok: true });
    expect(id(path.join(saved, 'owner.json'))).toEqual(id(marker)); expect(fs.readFileSync(f.owner, 'utf8')).toBe('foreign');
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
