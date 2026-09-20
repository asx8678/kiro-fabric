import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { compileSourceBinding } from '../../scripts/build-fovea-native.mjs';
import { FoveaProvenanceJournal, validateProvenanceJournal } from '../../src/fovea/provenance-journal.js';
import { createNativeSourcePlatform, nativeProvenanceOperations, type NativeSourceToken, type PosixProvenanceBinding } from '../../src/fovea/source-platform-native.js';
import { openSourceDirectory } from '../../src/fovea/source-platform.js';

const worktree = 'a'.repeat(64), origin = 'b'.repeat(64), nextOrigin = 'c'.repeat(64), nonce = 'd'.repeat(32);
const name = `${worktree}.json`, change = { path: 'a.ts', beforeSha256: null, afterSha256: 'e'.repeat(64) };
const dirs: string[] = [];
let native: PosixProvenanceBinding, compiled = '', artifact = '';
function fixture(binding = native) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fovea-native-journal-')));
  fs.chmodSync(root, 0o700); dirs.push(root);
  const platform = createNativeSourcePlatform(binding), journal = new FoveaProvenanceJournal(root, platform);
  return { root, platform, journal, target: path.join(journal.directory, name) };
}
async function tokenAt(directory: string, nativeBinding = native): Promise<NativeSourceToken> {
  const native = nativeBinding;
  let token = await native.openRoot();
  try {
    for (const part of directory.split('/').filter(Boolean)) {
      const next = await native.openAt(token, part, 'directory');
      await native.close(token); token = next;
    }
    return token;
  } catch (error) { await native.close(token); throw error; }
}

describe.skipIf(!['darwin', 'linux'].includes(process.platform))('native descriptor-relative provenance ABI 1', () => {
  beforeAll(() => {
    fs.mkdirSync('.tmp', { recursive: true }); artifact = fs.mkdtempSync(path.resolve('.tmp/provenance-native-'));
    compiled = path.join(artifact, 'source-platform.node'); compileSourceBinding(process.cwd(), compiled);
    native = createRequire(import.meta.url)(compiled) as PosixProvenanceBinding;
  });
  afterEach(() => { vi.restoreAllMocks(); for (const root of dirs.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
  afterAll(() => { if (artifact) fs.rmSync(artifact, { recursive: true, force: true }); });

  it('gates the additive ABI without widening source-only platform capabilities', () => {
    expect(native.provenanceAbiVersion).toBe(1); expect(native.abiVersion).toBe(1);
    expect(native.platform).toBe(process.platform);
    const old = { ...native, provenanceAbiVersion: undefined };
    const platform = createNativeSourcePlatform(old);
    expect(() => nativeProvenanceOperations(platform)).toThrow('provenance ABI 1');
    expect(Object.keys(platform).sort()).toEqual(['entries', 'openChild', 'openRootDirectory']);
    if (process.platform === 'darwin') expect(() => new FoveaProvenanceJournal('/not-used')).toThrow('trusted native binding required');
  });

  it('persists exact copied transitions across instances and a separate Node session', async () => {
    const f = fixture(), transitions = [{ ...change }];
    const pending = f.journal.append(worktree, origin, transitions); transitions[0]!.path = 'tampered.ts'; await pending;
    const other = new FoveaProvenanceJournal(f.root, createNativeSourcePlatform(native));
    expect((await other.read(worktree)).records).toMatchObject([{ ...change, origin, sequence: 1 }]);
    const run = spawnSync(process.execPath, ['-e', `
      const n=require(process.argv[1]);
      (async()=>{let d=await n.openRoot();try {
        for(const p of process.argv[2].split('/').filter(Boolean)){const next=await n.openAt(d,p,'directory');await n.close(d);d=next;}
        const name=process.argv[3], before=await n.journalRead(d,name), doc=JSON.parse(before);
        doc.records.push({path:'a.ts',beforeSha256:'e'.repeat(64),afterSha256:null,origin:'c'.repeat(64),sequence:++doc.sequence});
        await n.journalReplace(d,name,before,Buffer.from(JSON.stringify(doc)),'f'.repeat(32));
      }finally{await n.close(d);}})().catch(e=>{console.error(e);process.exitCode=1;});`, compiled, f.journal.directory, name],
    { encoding: 'utf8', timeout: 15000 });
    expect(run.error).toBeUndefined(); expect(run.status, run.stderr).toBe(0);
    const doc = await f.journal.read(worktree);
    expect(doc.sequence).toBe(2); expect(doc.records[1]).toMatchObject({ origin: nextOrigin, beforeSha256: change.afterSha256, afterSha256: null });
    expect(fs.readdirSync(f.journal.directory)).toEqual([name]);
    expect(fs.statSync(f.target).mode & 0o777).toBe(0o600);
    expect(await f.journal.read('f'.repeat(64))).toMatchObject({ sequence: 0, records: [] });
  });

  it('copies native buffers before scheduling and refuses stale compare-and-publish', async () => {
    const f = fixture(), token = await tokenAt(f.journal.directory);
    try {
      const bytes = Buffer.from('before');
      const pending = native.journalReplace(token, name, null, bytes, nonce); bytes.fill(120); await pending;
      expect(await native.journalRead(token, name)).toEqual(Buffer.from('before'));
      await expect(native.journalReplace(token, name, null, Buffer.from('lost update'), nonce)).rejects.toMatchObject({ code: 'EAGAIN' });
      await expect(native.journalReplace(token, name, Buffer.from('wrong'), Buffer.from('lost update'), nonce)).rejects.toMatchObject({ code: 'EAGAIN' });
      expect(fs.readFileSync(f.target, 'utf8')).toBe('before'); expect(fs.readdirSync(f.journal.directory)).toEqual([name]);
    } finally { await native.close(token); }
  });

  it('allows only one concurrent absent-CAS winner across independent capabilities', async () => {
    const f = fixture(), a = await tokenAt(f.journal.directory), b = await tokenAt(f.journal.directory);
    try {
      const results = await Promise.allSettled([
        native.journalReplace(a, name, null, Buffer.from('a'), nonce),
        native.journalReplace(b, name, null, Buffer.from('b'), 'e'.repeat(32)),
      ]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
      expect(['EAGAIN', 'EEXIST']).toContain(rejected.reason.code);
      expect(['a', 'b']).toContain(fs.readFileSync(f.target, 'utf8'));
      expect(fs.readdirSync(f.journal.directory)).toEqual([name]);
    } finally { await native.close(a); await native.close(b); }
  });

  it.each(['symlink', 'hardlink', 'directory', 'fifo', 'permissions', 'oversize'] as const)('rejects unsafe journal %s without changing it or its target', async kind => {
    const f = fixture(), outside = path.join(f.root, 'outside'); fs.writeFileSync(outside, 'untouched', { mode: 0o600 });
    if (kind === 'symlink') fs.symlinkSync(outside, f.target);
    if (kind === 'hardlink') fs.linkSync(outside, f.target);
    if (kind === 'directory') fs.mkdirSync(f.target, { mode: 0o700 });
    if (kind === 'fifo') { const r = spawnSync('/usr/bin/mkfifo', [f.target], { timeout: 15000 }); expect(r.error).toBeUndefined(); expect(r.status).toBe(0); }
    if (kind === 'permissions') { fs.writeFileSync(f.target, '{}'); fs.chmodSync(f.target, 0o644); }
    if (kind === 'oversize') fs.writeFileSync(f.target, 'x'.repeat(48001), { mode: 0o600 });
    const token = await tokenAt(f.journal.directory);
    try {
      await expect(native.journalRead(token, name)).rejects.toThrow();
      await expect(native.journalReplace(token, name, null, Buffer.from('{}'), nonce)).rejects.toThrow();
      await expect(f.journal.read(worktree)).rejects.toThrow();
      await expect(f.journal.append(worktree, origin, [change])).rejects.toThrow();
      expect(fs.readFileSync(outside, 'utf8')).toBe('untouched');
      expect(fs.existsSync(f.target + '.lock')).toBe(false);
    } finally { await native.close(token); }
  });

  it.each(['lock', 'temp'] as const)('does not reclaim a pre-existing %s symlink or file on exclusive-create failure', async kind => {
    const f = fixture(), token = await tokenAt(f.journal.directory), outside = path.join(f.root, 'outside');
    fs.writeFileSync(outside, 'untouched', { mode: 0o600 });
    const collision = f.target + (kind === 'lock' ? '.lock' : `.${nonce}.tmp`);
    try {
      for (const symlink of [false, true]) {
        if (symlink) fs.symlinkSync(outside, collision); else fs.writeFileSync(collision, 'preserve', { mode: 0o600 });
        const identity = fs.lstatSync(collision);
        await expect(native.journalReplace(token, name, null, Buffer.from('{}'), nonce)).rejects.toMatchObject({ code: 'EEXIST' });
        expect(fs.lstatSync(collision).ino).toBe(identity.ino); expect(fs.existsSync(f.target)).toBe(false);
        expect(fs.readFileSync(outside, 'utf8')).toBe('untouched'); fs.unlinkSync(collision);
      }
    } finally { await native.close(token); }
  });

  it('remains descriptor-relative when the pathname becomes a symlink, and reports the journal gap', async () => {
    let f: ReturnType<typeof fixture>;
    const instrumented = { ...native, async journalReplace(...args: Parameters<PosixProvenanceBinding['journalReplace']>) {
      fs.renameSync(f.journal.directory, f.journal.directory + '-held');
      fs.symlinkSync(path.join(f.root, 'outside'), f.journal.directory);
      return native.journalReplace(...args);
    } };
    f = fixture(instrumented); fs.mkdirSync(path.join(f.root, 'outside'), { mode: 0o700 });
    await expect(f.journal.append(worktree, origin, [change])).rejects.toThrow();
    expect(fs.readdirSync(path.join(f.root, 'outside'))).toEqual([]);
    expect(fs.readdirSync(f.journal.directory + '-held')).toEqual([name]);
    await expect(f.journal.read(worktree)).rejects.toThrow();
  });

  it('rejects directory replacement between calls and symlinked ancestors', async () => {
    const f = fixture();
    fs.renameSync(f.journal.directory, f.journal.directory + '-held'); fs.mkdirSync(f.journal.directory, { mode: 0o700 });
    await expect(f.journal.append(worktree, origin, [change])).rejects.toThrow('Unsafe provenance directory');
    expect(fs.readdirSync(f.journal.directory)).toEqual([]);
    const moved = f.root + '-held';
    fs.renameSync(f.root, moved); dirs.push(moved); fs.symlinkSync(moved, f.root);
    await expect(f.journal.read(worktree)).rejects.toThrow('canonical');
  });

  it('refuses public directory capabilities and non-journal names or unbounded native payloads', async () => {
    const f = fixture(), token = await tokenAt(f.journal.directory);
    try {
      for (const bad of ['../escape', '/escape', name + '\0tail', 'x.json', 'A'.repeat(64) + '.json', name + '/a']) {
        await expect(native.journalRead(token, bad)).rejects.toMatchObject({ code: 'EINVAL' });
        await expect(native.journalReplace(token, bad, null, Buffer.from('{}'), nonce)).rejects.toMatchObject({ code: 'EINVAL' });
      }
      await expect(native.journalReplace(token, name, Buffer.alloc(48001), Buffer.from('{}'), nonce)).rejects.toMatchObject({ code: 'EINVAL' });
      for (const bytes of [Buffer.alloc(0), Buffer.alloc(48001)]) await expect(native.journalReplace(token, name, null, bytes, nonce)).rejects.toMatchObject({ code: 'EINVAL' });
      await expect(native.journalReplace(token, name, null, Buffer.from('{}'), '../escape')).rejects.toMatchObject({ code: 'EINVAL' });
      fs.chmodSync(f.journal.directory, 0o755);
      await expect(native.journalRead(token, name)).rejects.toMatchObject({ code: 'EPERM' });
      await expect(native.journalReplace(token, name, null, Buffer.from('{}'), nonce)).rejects.toMatchObject({ code: 'EPERM' });
      expect(fs.readdirSync(f.journal.directory)).toEqual([]);
    } finally { await native.close(token); }
  });

  it('rejects forged, busy and closed capabilities and closes adapters after publication failure', async () => {
    await expect(native.journalRead({} as NativeSourceToken, name)).rejects.toMatchObject({ code: 'EBADF' });
    const f = fixture(), token = await tokenAt(f.journal.directory);
    const pending = native.journalRead(token, name);
    await expect(native.close(token)).rejects.toMatchObject({ code: 'EBUSY' }); await pending; await native.close(token);
    await expect(native.journalReplace(token, name, null, Buffer.from('{}'), nonce)).rejects.toMatchObject({ code: 'EBADF' });
    const close = vi.fn(native.close), broken = fixture({ ...native, close, journalReplace: async () => { throw new Error('publication failed'); } });
    await expect(broken.journal.append(worktree, origin, [change])).rejects.toThrow('publication failed');
    // Every opened directory, including the final one, was closed.
    expect(close).toHaveBeenCalledTimes(broken.journal.directory.split('/').filter(Boolean).length + 1);
    expect(fs.readdirSync(broken.journal.directory)).toEqual([]);
  });

  it('does not expose native operations for foreign SourceHandles', async () => {
    const f = fixture(), other = createNativeSourcePlatform(native);
    const directory = await openSourceDirectory(other, f.journal.directory);
    try { expect(() => nativeProvenanceOperations(f.platform).read(directory, name)).toThrow('Foreign or closed'); }
    finally { await directory.close(); }
  });

  it('revokes publication after an in-flight read without creating lock/temp state', async () => {
    const controller = new AbortController(), replace = vi.fn(native.journalReplace);
    const f = fixture({ ...native, journalReplace: replace, async journalRead(...args) {
      const bytes = await native.journalRead(...args); controller.abort(new Error('lease revoked')); return bytes;
    } });
    await expect(f.journal.append(worktree, origin, [change], controller.signal)).rejects.toThrow('lease revoked');
    expect(replace).not.toHaveBeenCalled(); expect(fs.readdirSync(f.journal.directory)).toEqual([]);
  });

  // Compile isolated test-only syscall fault variants. No fault selectors,
  // compiler loading or environment hooks are added to the shipped addon.
  it.each(['temp-sync', 'directory-sync', 'replaced-lock', 'replaced-temp'] as const)('fails closed on native %s fault and preserves uncertain/replaced evidence', async fault => {
    const sourceFile = 'src/fovea/source-platform-native.c';
    let source = fs.readFileSync(sourceFile, 'utf8');
    const marker = fault === 'temp-sync' ? 'error = journal_sync(temp);' : fault === 'directory-sync' ? 'error = journal_sync(t->fd);'
      : 'temp = -1;\n  if ((error = journal_private(t->fd))';
    const injected = fault === 'temp-sync' || fault === 'directory-sync' ? 'error = EIO;'
      : fault === 'replaced-lock' ? 'temp = -1;\n  (void)unlinkat(t->fd, lock_name, 0);\n  int replacement = journal_exclusive(t->fd, lock_name);\n  if (replacement >= 0) (void)close(replacement);\n  if ((error = journal_private(t->fd))'
        : 'temp = -1;\n  (void)unlinkat(t->fd, temp_name, 0);\n  (void)symlinkat("outside", t->fd, temp_name);\n  if ((error = journal_private(t->fd))';
    expect(source.split(marker)).toHaveLength(2); source = source.replace(marker, injected);
    const build = fs.mkdtempSync(path.join(artifact, 'fault-'));
    fs.mkdirSync(path.join(build, 'src/fovea'), { recursive: true }); fs.writeFileSync(path.join(build, sourceFile), source);
    const binary = path.join(build, 'fault.node'); compileSourceBinding(build, binary);
    const faulty = createRequire(import.meta.url)(binary) as PosixProvenanceBinding;
    const f = fixture(faulty), token = await tokenAt(f.journal.directory, faulty);
    fs.writeFileSync(path.join(f.journal.directory, 'outside'), 'untouched', { mode: 0o600 });
    try {
      await expect(faulty.journalReplace(token, name, null, Buffer.from('published'), nonce)).rejects.toMatchObject({ code: fault.includes('sync') ? 'EIO' : 'ESTALE' });
      expect(fs.existsSync(f.target)).toBe(fault === 'directory-sync');
      if (fault === 'directory-sync') expect(fs.readFileSync(f.target, 'utf8')).toBe('published');
      expect(fs.existsSync(f.target + '.lock')).toBe(fault === 'replaced-lock');
      if (fault === 'replaced-temp') expect(fs.lstatSync(f.target + `.${nonce}.tmp`).isSymbolicLink()).toBe(true);
      else expect(fs.existsSync(f.target + `.${nonce}.tmp`)).toBe(false);
      expect(fs.readFileSync(path.join(f.journal.directory, 'outside'), 'utf8')).toBe('untouched');
    } finally { await faulty.close(token); }
  });
  it('enforces byte, sequence and schema bounds before publication', async () => {
    const f = fixture(); await f.journal.append(worktree, origin, [change]);
    const doc = await f.journal.read(worktree);
    for (const bad of [{ ...doc, version: 2 }, { ...doc, secret: 'private' }, { ...doc, records: [{ ...doc.records[0], path: '../escape' }] }, { ...doc, sequence: Number.MAX_SAFE_INTEGER + 1 }]) {
      fs.writeFileSync(f.target, JSON.stringify(bad));
      await expect(f.journal.read(worktree)).rejects.toThrow(); await expect(f.journal.append(worktree, origin, [change])).rejects.toThrow();
    }
    fs.writeFileSync(f.target, JSON.stringify({ ...doc, sequence: Number.MAX_SAFE_INTEGER, records: [{ ...doc.records[0], sequence: Number.MAX_SAFE_INTEGER }] }));
    await expect(f.journal.append(worktree, origin, [change])).rejects.toThrow('sequence exhausted');
    expect(() => validateProvenanceJournal({ ...doc, sequence: 0, records: [{ ...doc.records[0], sequence: 0 }] }, worktree)).toThrow();
    await expect(f.journal.append(worktree, 'private owner', [change])).rejects.toThrow('admission');
    expect(fs.readdirSync(f.journal.directory)).toEqual([name]);
  });
});
