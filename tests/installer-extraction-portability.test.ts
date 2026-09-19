import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import childProcess, { type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { afterEach, expect, test, vi } from 'vitest';
import { extractPrivateEntries } from '../scripts/private-extraction.mjs';
import { pinnedDirectoryIdentity, pinnedEntryIdentity, runPinnedDirectoryOperation, writePinnedDirectoryStream } from '../scripts/pinned-directory-child.mjs';
import { runPinnedDirectoryOperation as runStatePinnedDirectoryOperation } from '../src/installation/pinned-directory-child.mjs';
import { captureDirectoryAncestry } from '../src/installation/filesystem-boundary.mjs';
import { createBundleArchive, encodeBundleTar, extractBundleArchiveBytes, extractLegacyAgentArchiveBytes } from '../scripts/bundle-archive.mjs';
import { fixture } from './bundle-fixture.js';

// Native runnable on BOTH supported POSIX hosts, with no OS/capability skip.
// Linux also forces missing traversal, exercising actual inherited-fd children.
// Passing here on Linux is not a claim of native macOS qualification.
const roots: string[] = [], held: number[] = [];
const nativeSpawn = childProcess.spawnSync;
const temp = () => { const p = fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()), 'extraction-portability-')); fs.chmodSync(p, 0o700); roots.push(p); return p; };
const mkdir = (p: string) => { fs.mkdirSync(p, { mode: 0o700 }); return p; };
const entry = (name = 'a/b/file', data = Buffer.from('private payload'), mode = 0o600) => ({ path: name, mode, data });
const stat = (p: string) => fs.lstatSync(p, { bigint: true });
const snapshot = (p: string) => pinnedEntryIdentity(stat(p));
const hold = (cwd: string) => {
  const guard = captureDirectoryAncestry(cwd), fd = fs.openSync(cwd, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  held.push(fd); return { cwd, fd, parent: pinnedDirectoryIdentity(fs.fstatSync(fd, { bigint: true })), check: guard.check };
};
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  for (const fd of held.splice(0)) { try { fs.closeSync(fd); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EBADF') throw error; } }
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
test('installer and runtime share the pinned-directory implementation', () => {
  expect(runPinnedDirectoryOperation).toBe(runStatePinnedDirectoryOperation);
});

function forceChild(code = 'ENOTDIR') {
  const original = fs.statSync;
  return vi.spyOn(fs, 'statSync').mockImplementation(((...args: Parameters<typeof fs.statSync>) => {
    if (String(args[0]).startsWith('/proc/self/fd/') && String(args[0]).endsWith('/.')) throw Object.assign(Error('fixture: directory traversal unavailable'), { code });
    return original(...args);
  }) as typeof fs.statSync);
}
type Call = { executable: string; args: string[]; options: SpawnSyncOptionsWithStringEncoding & { input: Buffer; cwd: string; stdio: ['pipe', 'pipe', 'pipe', number] } };
function intercept(action: (call: Call) => void | ((result: SpawnSyncReturns<string>) => void)) {
  return vi.spyOn(childProcess, 'spawnSync').mockImplementation(((executable, args, options) => {
    const call = { executable, args: [...(args ?? [])], options: { ...options } } as Call;
    const observe = action(call), result = nativeSpawn(call.executable, call.args, call.options);
    observe?.(result); return result;
  }) as typeof childProcess.spawnSync);
}
function request(call: Call) { return JSON.parse(call.options.input.subarray(4, 4 + call.options.input.readUInt32BE()).toString()) as Record<string, any>; }
function changeRequest(call: Call, change: (value: Record<string, any>) => void) {
  const value = request(call), data = call.options.input.subarray(4 + call.options.input.readUInt32BE()); change(value);
  const header = Buffer.from(JSON.stringify(value)), size = Buffer.alloc(4); size.writeUInt32BE(header.length);
  call.options.input = Buffer.concat([size, header, data]);
}
function inject(call: Call, before: string, after = '') { call.args[2] = before + '\n' + call.args[2] + '\n' + after; }
function trackParentFds() {
  const original = fs.openSync, fds: number[] = [];
  vi.spyOn(fs, 'openSync').mockImplementation(((...args: Parameters<typeof fs.openSync>) => { const fd = original(...args); fds.push(fd); return fd; }) as typeof fs.openSync);
  return () => { expect(fds.length).toBeGreaterThan(0); for (const fd of fds) expect(() => fs.fstatSync(fd)).toThrow(/EBADF/); };
}
function legacyBytes(entries: ReturnType<typeof entry>[]) {
  const raw = encodeBundleTar(entries); let offset = 0;
  for (const e of entries) {
    raw.write('0000000\0', offset + 329); raw.write('0000000\0', offset + 337);
    raw[offset + 156] = e.mode === 0o700 ? 53 : 48; raw.fill(32, offset + 148, offset + 156);
    const sum = raw.subarray(offset, offset + 512).reduce((a, b) => a + b, 0);
    raw.write(sum.toString(8).padStart(6, '0') + '\0 ', offset + 148);
    offset += 512 + Math.ceil(e.data.length / 512) * 512;
  }
  return gzipSync(raw);
}

test.each(['native', 'child'])('%s POSIX extraction preserves binary files, executable modes, nested parents and cwd', strategy => {
  const root = temp(), cwd = process.cwd(), data = Buffer.alloc(2 * 1024 * 1024 + 17, 0xa5);
  if (strategy === 'child') forceChild();
  vi.stubEnv('NODE_OPTIONS', '--require=/must-not-execute-from-environment'); vi.stubEnv('NODE_PATH', root);
  const chdir = vi.spyOn(process, 'chdir'), closeCheck = trackParentFds();
  let children = 0;
  intercept(call => {
    children++; const r = request(call), current = fs.statSync(call.options.cwd, { bigint: true });
    expect(call.executable).toBe(process.execPath); expect(call.args.slice(0, 2)).toEqual(['--input-type=commonjs', '-e']);
    expect(Buffer.byteLength(call.args[2]!)).toBeLessThanOrEqual(32768);
    expect(call.args.join('')).not.toContain(root); expect(call.options.env).toEqual({ PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' });
    expect(call.options.timeout).toBe(30_000); expect(call.options.killSignal).toBe('SIGKILL'); expect(call.options.maxBuffer).toBe(4096);
    expect(r.parent).toMatchObject(pinnedDirectoryIdentity(fs.fstatSync(call.options.stdio[3], { bigint: true })));
    expect(r.parent).toMatchObject(pinnedDirectoryIdentity(current));
    if (r.name === 'file') expect(call.options.input.length).toBeGreaterThan(data.length);
  });
  const out = path.join(root, 'out'), guard = extractPrivateEntries([entry('a/b/file', data), entry('a/bin', Buffer.from('exec'), 0o700), entry('empty', Buffer.alloc(0))], out);
  expect(guard.root).toBe(out); guard.check(); expect(fs.readFileSync(path.join(out, 'a/b/file'))).toEqual(data);
  for (const name of ['', 'a', 'a/b', 'a/bin']) expect(Number(stat(path.join(out, name)).mode & 0o7777n)).toBe(0o700);
  expect(stat(path.join(out, 'a/bin')).isFile()).toBe(true); expect(Number(stat(path.join(out, 'a/b/file')).mode & 0o7777n)).toBe(0o600);
  expect(stat(path.join(out, 'empty')).size).toBe(0n); expect(process.cwd()).toBe(cwd); expect(chdir).not.toHaveBeenCalled(); closeCheck();
  if (strategy === 'child' || process.platform === 'darwin') expect(children).toBe(6);
});

test.each(['ENOENT', 'ENOTDIR', 'ENOTSUP', 'EACCES'])('alias traversal %s falls back to a real child, not a pathname', code => {
  forceChild(code); const root = temp(), spawn = intercept(() => {});
  extractPrivateEntries([entry('file')], path.join(root, 'out')); expect(spawn).toHaveBeenCalledTimes(2);
});

test('legacy directories remain directories, and source/release archives use the same real child path', async () => {
  const root = temp(), source = await fixture(); roots.push(source);
  const archive = path.join(root, 'bundle.tar.gz'); await createBundleArchive(source, archive);
  const release = fs.readFileSync(archive), legacy = legacyBytes([entry('dir', Buffer.alloc(0), 0o700), entry('dir/sub', Buffer.alloc(0), 0o700), entry('dir/sub/file')]);
  forceChild(); const spawn = intercept(() => {}), cwd = process.cwd();
  const bundle = await extractBundleArchiveBytes(release, path.join(root, 'release'));
  expect(bundle.digest).toMatch(/^[a-f0-9]{64}$/);
  extractLegacyAgentArchiveBytes(legacy, path.join(root, 'source'));
  expect(stat(path.join(root, 'source/dir/sub')).isDirectory()).toBe(true); expect(fs.readFileSync(path.join(root, 'source/dir/sub/file'), 'utf8')).toBe('private payload');
  expect(spawn.mock.calls.length).toBeGreaterThan(10); expect(process.cwd()).toBe(cwd);
});

test.each(['directory', 'file', 'symlink'])('preexisting %s destination has zero writes, chmods or child launches', kind => {
  const root = temp(), out = path.join(root, 'out'), victim = mkdir(path.join(root, 'victim'));
  fs.writeFileSync(path.join(victim, 'keep'), 'keep', { mode: 0o600 });
  if (kind === 'directory') mkdir(out); else if (kind === 'file') fs.writeFileSync(out, 'original', { mode: 0o600 }); else fs.symlinkSync(victim, out);
  const before = snapshot(out), mkdirSpy = vi.spyOn(fs, 'mkdirSync'), write = vi.spyOn(fs, 'writeSync'), chmod = vi.spyOn(fs, 'fchmodSync'), spawn = vi.spyOn(childProcess, 'spawnSync');
  expect(() => extractPrivateEntries([entry()], out)).toThrow(/EEXIST/);
  expect(snapshot(out)).toEqual(before); expect(fs.readFileSync(path.join(victim, 'keep'), 'utf8')).toBe('keep');
  for (const spy of [mkdirSpy, write, chmod, spawn]) expect(spy).not.toHaveBeenCalled();
});

test.each(['../escape', 'a/file/child', 'A/alias'])('complete preflight rejects later unsafe/colliding path %s before root creation', bad => {
  const root = temp(), mkdirSpy = vi.spyOn(fs, 'mkdirSync'), spawn = vi.spyOn(childProcess, 'spawnSync');
  expect(() => extractPrivateEntries([entry('a/file'), entry(bad)], path.join(root, 'out'))).toThrow(/path|prefix|collision/i);
  expect(fs.readdirSync(root)).toEqual([]); expect(mkdirSpy).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
});

test('child refuses a substituted cwd before any mkdir/open/write', () => {
  forceChild(); const root = temp(), victim = mkdir(path.join(root, 'victim')), closeCheck = trackParentFds();
  intercept(call => { call.options.cwd = victim; inject(call, `for (const key of ['mkdirSync','openSync','writeSync','fchmodSync']) require('node:fs')[key] = () => { throw Error('UNEXPECTED_EFFECT'); };`); });
  expect(() => extractPrivateEntries([entry()], path.join(root, 'out'))).toThrow(/identity changed/);
  expect(fs.readdirSync(victim)).toEqual([]); expect(fs.existsSync(path.join(root, 'out'))).toBe(false); closeCheck();
});

test.each(['dev', 'ino', 'mode', 'uid', 'gid'])('child compares inherited fd3/cwd %s before effects', field => {
  forceChild(); const root = temp();
  intercept(call => changeRequest(call, r => { r.parent[field] = typeof r.parent[field] === 'string' ? String(BigInt(r.parent[field]) + 1n) : r.parent[field] + 1; }));
  expect(() => extractPrivateEntries([entry()], path.join(root, 'out'))).toThrow(/identity changed/); expect(fs.readdirSync(root)).toEqual([]);
});

test.each(['before-cwd', 'after-cwd'])('root ancestor replacement %s cannot redirect child writes', phase => {
  forceChild(); const root = temp(), parent = mkdir(path.join(root, 'parent')), victim = mkdir(path.join(root, 'victim'));
  const replace = `require('node:fs').renameSync(${JSON.stringify(parent)},${JSON.stringify(parent + '-old')}); require('node:fs').symlinkSync(${JSON.stringify(victim)},${JSON.stringify(parent)});`;
  intercept(call => {
    if (phase === 'after-cwd') inject(call, replace);
    else { fs.renameSync(parent, parent + '-old'); fs.symlinkSync(victim, parent); }
  });
  expect(() => extractPrivateEntries([entry()], path.join(parent, 'out'))).toThrow(/ancestry|changed/);
  expect(fs.readdirSync(victim)).toEqual([]);
  expect(fs.readdirSync(parent + '-old')).toEqual(phase === 'after-cwd' ? ['out'] : []);
  if (phase === 'after-cwd') expect(fs.readdirSync(path.join(parent + '-old', 'out'))).toEqual([]);
});

test.each(['before-cwd', 'after-cwd'])('nested ancestor replacement %s stays pinned to the current parent inode', phase => {
  forceChild(); const root = temp(), out = path.join(root, 'out'), victim = mkdir(path.join(root, 'victim')); mkdir(path.join(victim, 'b'));
  let replaced = false;
  intercept(call => {
    if (request(call).name !== 'file') return;
    replaced = true; const ancestor = path.join(out, 'a');
    if (phase === 'after-cwd') inject(call, `require('node:fs').renameSync(${JSON.stringify(ancestor)},${JSON.stringify(ancestor + '-old')}); require('node:fs').symlinkSync(${JSON.stringify(victim)},${JSON.stringify(ancestor)});`);
    else { fs.renameSync(ancestor, ancestor + '-old'); fs.symlinkSync(victim, ancestor); }
  });
  expect(() => extractPrivateEntries([entry()], out)).toThrow(/ancestry|changed/); expect(replaced).toBe(true);
  expect(fs.readdirSync(path.join(victim, 'b'))).toEqual([]);
  expect(fs.readdirSync(path.join(out, 'a-old/b'))).toEqual(phase === 'after-cwd' ? ['file'] : []);
  if (phase === 'after-cwd') expect(fs.readFileSync(path.join(out, 'a-old/b/file'), 'utf8')).toBe('private payload');
});

test('returned directory inode is rechecked before the parent can use a replacement as a write capability', () => {
  forceChild(); const root = temp(), out = path.join(root, 'out'), original = fs.openSync; let replaced = false;
  vi.spyOn(fs, 'openSync').mockImplementation(((...args: Parameters<typeof fs.openSync>) => {
    if (String(args[0]) === path.join(out, 'a') && !replaced) { replaced = true; fs.renameSync(path.join(out, 'a'), path.join(out, 'a-old')); mkdir(path.join(out, 'a')); }
    return original(...args);
  }) as typeof fs.openSync);
  expect(() => extractPrivateEntries([entry()], out)).toThrow(/directory changed/); expect(replaced).toBe(true);
  expect(fs.readdirSync(path.join(out, 'a'))).toEqual([]); expect(fs.readdirSync(path.join(out, 'a-old'))).toEqual([]);
});

test.each(['symlink', 'hardlink', 'file'])('preexisting nested %s leaf is never followed or overwritten', kind => {
  forceChild(); const root = temp(), out = path.join(root, 'out'), victim = path.join(root, 'victim'); fs.writeFileSync(victim, 'untouched', { mode: 0o600 });
  intercept(call => {
    if (request(call).name !== 'file') return;
    const leaf = path.join(call.options.cwd, 'file');
    if (kind === 'symlink') fs.symlinkSync(victim, leaf); else if (kind === 'hardlink') fs.linkSync(victim, leaf); else fs.writeFileSync(leaf, 'prior', { mode: 0o600 });
  });
  expect(() => extractPrivateEntries([entry()], out)).toThrow(/EEXIST/); expect(fs.readFileSync(victim, 'utf8')).toBe('untouched');
  if (kind === 'file') expect(fs.readFileSync(path.join(out, 'a/b/file'), 'utf8')).toBe('prior');
});

test.each(['open', 'write'])('leaf replacement at child %s writes only the original fd, preserves evidence and closes resources', phase => {
  forceChild(); const root = temp(), out = path.join(root, 'out'), victim = path.join(root, 'victim'); fs.writeFileSync(victim, 'untouched', { mode: 0o600 });
  const closeCheck = trackParentFds(); let checked = false;
  intercept(call => {
    if (request(call).name !== 'file') return;
    inject(call, `(() => {
      const fs = require('node:fs'), open = fs.openSync, write = fs.writeSync, close = fs.closeSync; globalThis.opened = []; globalThis.closed = [];
      fs.closeSync = fd => { close(fd); globalThis.closed.push(fd); };
      const swap = () => { fs.renameSync('./file','./evidence'); fs.symlinkSync(${JSON.stringify(victim)},'./file'); };
      fs.openSync = (...args) => { const fd = open(...args); if (args[0] === './file') { globalThis.opened.push(fd); ${phase === 'open' ? 'swap();' : ''} } return fd; };
      ${phase === 'write' ? 'let once = false; fs.writeSync = (...args) => { if (!once) { once = true; swap(); } return write(...args); };' : ''}
    })();`, `process.stderr.write(String([3,...globalThis.opened].every(fd => globalThis.closed.includes(fd))));`);
    return result => { expect(result.stderr).toBe('true'); checked = true; };
  });
  expect(() => extractPrivateEntries([entry()], out)).toThrow(/identity changed/); expect(checked).toBe(true); closeCheck();
  expect(fs.readFileSync(victim, 'utf8')).toBe('untouched'); expect(fs.readFileSync(path.join(out, 'a/b/evidence'), 'utf8')).toBe(phase === 'open' ? '' : 'private payload');
});

test.each(['bad-name', 'bad-operation', 'oversize-header', 'oversize-data', 'truncated-data'])('real child fails closed on %s protocol input', fault => {
  forceChild(); const root = temp();
  intercept(call => {
    if (fault === 'bad-name') changeRequest(call, r => { r.name = '../escape'; });
    if (fault === 'bad-operation') changeRequest(call, r => { r.operation = 'arbitrary callback'; });
    if (fault === 'oversize-header') call.options.input = Buffer.from([0, 0, 16, 1]);
    if (fault === 'oversize-data') call.options.input = Buffer.concat([call.options.input, Buffer.from('unrequested')]);
    if (fault === 'truncated-data') changeRequest(call, r => { r.operation = 'writeExclusive'; r.size = 1; });
  });
  expect(() => extractPrivateEntries([entry()], path.join(root, 'out'))).toThrow(/request|bound|truncated/);
  if (fault !== 'truncated-data') expect(fs.readdirSync(root)).toEqual([]);
  else expect(stat(path.join(root, 'out')).size).toBe(0n); // owned partial evidence, never rolled back
});

test('real timeout kills the child and closes parent fds without deleting partial output', () => {
  forceChild(); const root = temp(), out = path.join(root, 'out'), closeCheck = trackParentFds(), cwd = process.cwd();
  const rm = vi.spyOn(fs, 'rmSync'), unlink = vi.spyOn(fs, 'unlinkSync');
  intercept(call => {
    if (request(call).name !== 'file') return;
    call.options.timeout = 1000;
    inject(call, `(() => { const fs = require('node:fs'), original = fs.writeSync; fs.writeSync = (...args) => { original(...args); for (;;) {} }; })();`);
    return result => { expect(result.signal).toBe('SIGKILL'); expect((result.error as NodeJS.ErrnoException)?.code).toBe('ETIMEDOUT'); };
  });
  expect(() => extractPrivateEntries([entry()], out)).toThrow(/child unavailable/); closeCheck();
  expect(fs.readFileSync(path.join(out, 'a/b/file'), 'utf8')).toBe('private payload'); expect(process.cwd()).toBe(cwd);
  expect(rm).not.toHaveBeenCalled(); expect(unlink).not.toHaveBeenCalled();
});

test('malformed child response is not success and preserves the newly created directory', () => {
  forceChild(); const root = temp(), closeCheck = trackParentFds();
  intercept(call => inject(call, '', `process.stdout.write('not-json');`));
  expect(() => extractPrivateEntries([entry()], path.join(root, 'out'))).toThrow(/invalid reply/); closeCheck();
  expect(fs.readdirSync(path.join(root, 'out'))).toEqual([]);
});

test('a mismatched descriptor traversal identity fails closed rather than choosing the fallback', () => {
  const root = temp(), victim = mkdir(path.join(root, 'victim')), original = fs.statSync;
  // Exercise the Linux capability branch even on native Darwin; other tests run
  // the actual host strategy without changing its platform or skipping it.
  vi.stubGlobal('process', Object.create(process, { platform: { value: 'linux' } }));
  vi.spyOn(fs, 'statSync').mockImplementation(((...args: Parameters<typeof fs.statSync>) => {
    if (String(args[0]).startsWith('/proc/self/fd/')) return original(victim, { bigint: true });
    return original(...args);
  }) as typeof fs.statSync);
  const spawn = vi.spyOn(childProcess, 'spawnSync'), writes = vi.spyOn(fs, 'mkdirSync');
  expect(() => extractPrivateEntries([entry()], path.join(root, 'out'))).toThrow(/descriptor traversal/);
  expect(spawn).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled(); expect(fs.readdirSync(victim)).toEqual([]);
});

test('child rejects a directory swapped after mkdir capture and before no-follow open', () => {
  forceChild(); const root = temp(), out = path.join(root, 'out'), closeCheck = trackParentFds();
  intercept(call => {
    if (request(call).name !== 'a') return;
    inject(call, `(() => { const fs = require('node:fs'), original = fs.openSync;
      fs.openSync = (...args) => { if (args[0] === './a') { fs.renameSync('./a','./a-old'); fs.mkdirSync('./a',{mode:448}); } return original(...args); };
    })();`);
  });
  expect(() => extractPrivateEntries([entry()], out)).toThrow(/identity changed/); closeCheck();
  expect(fs.readdirSync(path.join(out, 'a'))).toEqual([]); expect(fs.readdirSync(path.join(out, 'a-old'))).toEqual([]);
});

test.each(['before-cwd', 'after-cwd'])('streaming child rejects ancestor replacement %s without redirected writes', async phase => {
  const root = temp(), directory = mkdir(path.join(root, 'parent')), victim = mkdir(path.join(root, 'victim')), parent = hold(directory), original = childProcess.spawn;
  vi.spyOn(childProcess, 'spawn').mockImplementation(((executable, args, options) => {
    const argv = [...(args ?? [])];
    if (phase === 'after-cwd') argv[2] = `require('node:fs').renameSync(${JSON.stringify(directory)},${JSON.stringify(directory + '-old')}); require('node:fs').symlinkSync(${JSON.stringify(victim)},${JSON.stringify(directory)});\n` + argv[2];
    else { fs.renameSync(directory, directory + '-old'); fs.symlinkSync(victim, directory); }
    return original(executable, argv, options ?? {});
  }) as typeof childProcess.spawn);
  async function* source() { yield Buffer.from('stream'); }
  await expect(writePinnedDirectoryStream({ ...parent, name: 'archive', maxBytes: 6 }, source())).rejects.toThrow();
  expect(fs.readdirSync(victim)).toEqual([]); expect(fs.readdirSync(directory + '-old')).toEqual(phase === 'after-cwd' ? ['archive'] : []);
  if (phase === 'after-cwd') expect(fs.readFileSync(path.join(directory + '-old', 'archive'), 'utf8')).toBe('stream');
  expect(fs.fstatSync(parent.fd).isDirectory()).toBe(true);
});

test('streaming spawn failure closes all child pipes without touching the destination', async () => {
  const root = temp(), parent = hold(root), original = childProcess.spawn;
  const spawn = vi.spyOn(childProcess, 'spawn').mockImplementation(((executable, args, options) => original(executable, args ?? [], { ...options, cwd: path.join(root, 'absent') })) as typeof childProcess.spawn);
  async function* source() { yield Buffer.from('data'); }
  await expect(writePinnedDirectoryStream({ ...parent, name: 'archive', maxBytes: 4 }, source())).rejects.toThrow();
  const child = spawn.mock.results[0]!.value;
  expect(child.stdin.destroyed).toBe(true); expect(child.stdout.destroyed).toBe(true); expect(child.stderr.destroyed).toBe(true);
  expect(fs.readdirSync(root)).toEqual([]); expect(fs.fstatSync(parent.fd).isDirectory()).toBe(true);
});

test('fixed child operations support guarded metadata publication and nonrecursive removal', () => {
  forceChild(); const root = temp(), parent = hold(root), cwd = process.cwd();
  const run = (options: Omit<Parameters<typeof runPinnedDirectoryOperation>[0], keyof typeof parent>) => runPinnedDirectoryOperation({ ...parent, ...options });
  run({ operation: 'mkdir0700', name: 'dir' }); expect(stat(path.join(root, 'dir')).mode & 0o7777n).toBe(0o700n);
  const pending = run({ operation: 'writeExclusive', name: 'pending', data: Buffer.from('one'), maxBytes: 3 })!;
  expect(() => run({ operation: 'writeExclusive', name: 'pending', data: Buffer.from('bad') })).toThrow(/EEXIST/);
  const published = run({ operation: 'rename', name: 'pending', target: 'record', expected: pending })!;
  const next = run({ operation: 'writeExclusive', name: 'next', data: Buffer.from('two') })!;
  expect(() => run({ operation: 'rename', name: 'next', target: 'record', expected: next })).toThrow(/EEXIST/);
  run({ operation: 'rename', name: 'next', target: 'record', expected: next, targetExpected: published });
  expect(fs.readFileSync(path.join(root, 'record'), 'utf8')).toBe('two');
  expect(() => run({ operation: 'unlink', name: 'record', expected: published })).toThrow(/changed/);
  run({ operation: 'unlink', name: 'record', expected: snapshot(path.join(root, 'record')) });
  run({ operation: 'rmdir', name: 'dir', expected: snapshot(path.join(root, 'dir')) });
  expect(fs.readdirSync(root)).toEqual([]); expect(process.cwd()).toBe(cwd); expect(fs.fstatSync(parent.fd).isDirectory()).toBe(true);
});

test.each([
  { name: 'installer', run: runPinnedDirectoryOperation },
  { name: 'state', run: runStatePinnedDirectoryOperation },
])('$name unlink succeeds when a successor reuses the name', ({ run }) => {
  forceChild(); const root = temp(), parent = hold(root), leaf = path.join(root, 'lock');
  fs.writeFileSync(leaf, 'original', { mode: 0o600 });
  const expected = snapshot(leaf);
  // Keep the old inode allocated so a successor cannot immediately reuse it.
  const originalFd = fs.openSync(leaf, fs.constants.O_RDONLY); held.push(originalFd);
  intercept(() => result => {
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, result: null });
    fs.writeFileSync(leaf, 'successor', { flag: 'wx', mode: 0o600 });
  });
  expect(run({ ...parent, operation: 'unlink', name: 'lock', expected })).toBeNull();
  expect(fs.readFileSync(leaf, 'utf8')).toBe('successor');
  expect(fs.fstatSync(originalFd).nlink).toBe(0);
  expect(snapshot(leaf).ino).not.toBe(expected.ino);
});

test.each([
  { name: 'installer', run: runPinnedDirectoryOperation },
  { name: 'state', run: runStatePinnedDirectoryOperation },
])('$name unlink rejects an acknowledgement while the original inode remains', ({ run }) => {
  forceChild(); const root = temp(), parent = hold(root), leaf = path.join(root, 'lock');
  fs.writeFileSync(leaf, 'original', { mode: 0o600 });
  const expected = snapshot(leaf);
  intercept(call => inject(call, "require('node:fs').unlinkSync = () => {};"));
  expect(() => run({ ...parent, operation: 'unlink', name: 'lock', expected })).toThrow('Pinned directory removed name changed');
  expect(fs.readFileSync(leaf, 'utf8')).toBe('original');
});

test.each(['unlink', 'rmdir', 'rename'] as const)('%s refuses a replaced leaf before any removal/publication', operation => {
  forceChild(); const root = temp(), parent = hold(root), leaf = path.join(root, 'leaf');
  if (operation === 'rmdir') mkdir(leaf); else fs.writeFileSync(leaf, 'old', { mode: 0o600 });
  const expected = snapshot(leaf); fs.renameSync(leaf, leaf + '-old');
  if (operation === 'rmdir') mkdir(leaf); else fs.writeFileSync(leaf, 'new', { mode: 0o600 });
  expect(() => runPinnedDirectoryOperation({ ...parent, operation, name: 'leaf', target: 'published', expected })).toThrow(/changed/);
  expect(fs.existsSync(leaf)).toBe(true); expect(fs.existsSync(leaf + '-old')).toBe(true); expect(fs.existsSync(path.join(root, 'published'))).toBe(false);
});

test('fixed API rejects arbitrary operations, multi-component names, oversized metadata and nonempty rmdir', () => {
  const root = temp(), parent = hold(root), spawn = vi.spyOn(childProcess, 'spawnSync');
  for (const operation of ['callback', 'chmod']) expect(() => runPinnedDirectoryOperation({ ...parent, operation, name: 'file' } as any)).toThrow(/request/);
  for (const name of ['../x', 'a/b', 'a\\b', '.', '..', 'bad\0name']) expect(() => runPinnedDirectoryOperation({ ...parent, operation: 'mkdir0700', name })).toThrow(/request/);
  expect(() => runPinnedDirectoryOperation({ ...parent, operation: 'writeExclusive', name: 'file', data: Buffer.alloc(3), maxBytes: 2 })).toThrow(/request/);
  expect(spawn).not.toHaveBeenCalled(); expect(fs.readdirSync(root)).toEqual([]);
  mkdir(path.join(root, 'dir')); fs.writeFileSync(path.join(root, 'dir/keep'), 'keep', { mode: 0o600 }); forceChild();
  expect(() => runPinnedDirectoryOperation({ ...parent, operation: 'rmdir', name: 'dir', expected: snapshot(path.join(root, 'dir')) })).toThrow(/ENOTEMPTY|not empty/);
  expect(fs.readFileSync(path.join(root, 'dir/keep'), 'utf8')).toBe('keep');
});

test('streaming writer uses a real fd3 child, exact byte bounds and no parent cwd mutation', async () => {
  const root = temp(), parent = hold(root), cwd = process.cwd(), data = Buffer.alloc(2 * 1024 * 1024 + 11, 0x96), chdir = vi.spyOn(process, 'chdir');
  const spawn = vi.spyOn(childProcess, 'spawn');
  async function* source() { for (let n = 0; n < data.length; n += 17003) yield data.subarray(n, n + 17003); }
  const result = await writePinnedDirectoryStream({ ...parent, name: 'archive', maxBytes: data.length }, source());
  expect(result).toEqual(snapshot(path.join(root, 'archive'))); expect(fs.readFileSync(path.join(root, 'archive'))).toEqual(data);
  expect(spawn).toHaveBeenCalledTimes(1); expect(spawn.mock.calls[0]![2]?.stdio).toEqual(['pipe', 'pipe', 'pipe', parent.fd]);
  expect(process.cwd()).toBe(cwd); expect(chdir).not.toHaveBeenCalled(); expect(fs.fstatSync(parent.fd).isDirectory()).toBe(true);
  await expect(writePinnedDirectoryStream({ ...parent, name: 'archive', maxBytes: data.length }, source())).rejects.toThrow();
  expect(fs.readFileSync(path.join(root, 'archive'))).toEqual(data);
});

test.each(['source-failure', 'bound'])('streaming %s aborts the child and preserves owned partial evidence', async fault => {
  const root = temp(), parent = hold(root), spawn = vi.spyOn(childProcess, 'spawn');
  async function* source() {
    yield Buffer.from('first');
    const deadline = Date.now() + 5000;
    for (;;) {
      try { if (stat(path.join(root, 'archive')).size === 5n) break; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (Date.now() >= deadline) throw Error('fixture child did not consume first chunk');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (fault === 'source-failure') throw Error('fixture source failed');
    yield Buffer.from('oversize');
  }
  await expect(writePinnedDirectoryStream({ ...parent, name: 'archive', maxBytes: fault === 'bound' ? 5 : 100 }, source())).rejects.toThrow(/source failed|bound/);
  const child = spawn.mock.results[0]!.value;
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  expect(child.stdin.destroyed).toBe(true); expect(fs.fstatSync(parent.fd).isDirectory()).toBe(true);
  expect(fs.readFileSync(path.join(root, 'archive'), 'utf8')).toBe('first');
});
