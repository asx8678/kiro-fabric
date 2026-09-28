import fs from 'node:fs';
import childProcess from 'node:child_process';

/** @typedef {{dev:string,ino:string,mode:number,uid:number,gid:number}} DirectoryIdentity */
/** @typedef {DirectoryIdentity & {nlink:string,size:string,mtimeNs:string,ctimeNs:string}} EntryIdentity */
/** @typedef {{fd:number,cwd:string,parent:DirectoryIdentity,check:()=>void}} ParentOptions */
/** @typedef {ParentOptions & {operation:'mkdir0700'|'writeExclusive'|'symlinkExclusive'|'chmodDirectory'|'rename'|'unlink'|'unlinkSymlink'|'rmdir',name:string,target?:string,linkTarget?:string,expected?:EntryIdentity,targetExpected?:EntryIdentity,mode?:number,data?:Buffer,maxBytes?:number}} OperationOptions */
/** @param {import('node:fs').BigIntStats} stat @returns {DirectoryIdentity} */
export const pinnedDirectoryIdentity = stat => ({ dev: String(stat.dev), ino: String(stat.ino), mode: Number(stat.mode), uid: Number(stat.uid), gid: Number(stat.gid) });
/** @param {import('node:fs').BigIntStats} stat @returns {EntryIdentity} */
export const pinnedEntryIdentity = stat => ({ ...pinnedDirectoryIdentity(stat), nlink: String(stat.nlink), size: String(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) });
const same = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid && a.gid === b.gid;
const sameEntry = (a, b) => same(a, b) && a.nlink === b.nlink && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

/** Fixed, closure-free validation; never deserialize arbitrary callbacks. */
function validateRequest(r) {
  const component = name => typeof name === 'string' && !!name && name !== '.' && name !== '..' && Buffer.byteLength(name) <= 255 && !/[\/\\\x00-\x1f\x7f]/.test(name);
  const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,29})$/.test(value);
  const identity = v => v && decimal(v.dev) && decimal(v.ino) && [v.mode, v.uid, v.gid].every(n => Number.isSafeInteger(n) && n >= 0);
  const entry = v => identity(v) && [v.nlink, v.size, v.mtimeNs, v.ctimeNs].every(decimal);
  const operations = ['mkdir0700', 'writeExclusive', 'symlinkExclusive', 'chmodDirectory', 'rename', 'unlink', 'unlinkSymlink', 'rmdir'];
  const safeMode = Number.isInteger(r?.mode) && r.mode >= 0 && r.mode <= 0o777 && (r.mode & 0o022) === 0;
  if (!r || !operations.includes(r.operation) || !component(r.name) || !identity(r.parent)
    || !Number.isSafeInteger(r.maxBytes) || r.maxBytes < 0 || r.maxBytes > 192 * 1024 * 1024
    || r.size !== null && (!Number.isSafeInteger(r.size) || r.size < 0 || r.size > r.maxBytes)
    || !safeMode || r.operation !== 'writeExclusive' && r.size !== 0
    || ['rename', 'unlink', 'unlinkSymlink', 'rmdir', 'chmodDirectory'].includes(r.operation) && !entry(r.expected)
    || r.operation === 'rename' && (!component(r.target) || r.name === r.target || r.targetExpected != null && !entry(r.targetExpected))
    || r.operation !== 'rename' && r.targetExpected != null
    || r.operation === 'symlinkExclusive' && (typeof r.linkTarget !== 'string' || !r.linkTarget || r.linkTarget.includes('\0') || Buffer.byteLength(r.linkTarget) > 4096)
    || r.operation !== 'symlinkExclusive' && r.linkTarget != null) throw Error('Invalid pinned directory request');
}

/** Fixed allowlisted effects shared by the proven Linux alias and the child.
 * No source pathname, callback, shell, native addon or third-party module is run.
 * @param {typeof import('node:fs')} fs @param {any} r @param {number} fd
 * @param {string} directory @param {()=>void} check @param {()=>Buffer} read */
function pinnedOperation(fs, r, fd, directory, check, read) {
  const id = s => ({ dev: String(s.dev), ino: String(s.ino), mode: Number(s.mode), uid: Number(s.uid), gid: Number(s.gid), nlink: String(s.nlink), size: String(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) });
  const equal = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid && a.gid === b.gid;
  const exact = (a, b) => equal(a, b) && a.nlink === b.nlink && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
  const fail = () => { throw Error('Pinned directory identity changed; preserve evidence'); };
  const parent = () => {
    check();
    const held = fs.fstatSync(fd, { bigint: true }), cwd = fs.statSync(directory, { bigint: true });
    if (!held.isDirectory() || !cwd.isDirectory() || !equal(r.parent, id(held)) || !equal(id(held), id(cwd))) fail();
  };
  parent(); // cwd/fd3 identity BEFORE any mkdir/open/write/chmod/unlink/rename.
  const target = directory + '/' + r.name;
  const captured = (name, expected, kind = 'file') => {
    const stat = fs.lstatSync(name, { bigint: true });
    if ((kind === 'directory' ? !stat.isDirectory() : kind === 'symlink' ? !stat.isSymbolicLink() : !stat.isFile() || stat.nlink !== 1n)
      || stat.uid !== BigInt(process.getuid()) || kind !== 'symlink' && (stat.mode & 0o022n) !== 0n
      || !(kind === 'directory' ? equal(expected, id(stat)) : exact(expected, id(stat)))) fail();
    return stat;
  };
  if (r.operation !== 'writeExclusive' && read().length) throw Error('Pinned directory input bound');
  if (r.operation === 'unlink' || r.operation === 'unlinkSymlink' || r.operation === 'rmdir') {
    const kind = r.operation === 'rmdir' ? 'directory' : r.operation === 'unlinkSymlink' ? 'symlink' : 'file';
    parent(); captured(target, r.expected, kind);
    if (r.operation === 'rmdir') fs.rmdirSync(target); else fs.unlinkSync(target);
    parent(); return null;
  }
  if (r.operation === 'chmodDirectory') {
    parent(); const before = captured(target, r.expected, 'directory');
    let directoryFd;
    try {
      directoryFd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      if (!exact(id(before), id(fs.fstatSync(directoryFd, { bigint: true })))) fail();
      parent(); captured(target, r.expected, 'directory'); fs.fchmodSync(directoryFd, r.mode);
      const after = fs.fstatSync(directoryFd, { bigint: true }), named = fs.lstatSync(target, { bigint: true });
      if (!after.isDirectory() || (after.mode & 0o7777n) !== BigInt(r.mode) || !equal(id(after), id(named))) fail();
      parent(); return id(after);
    } finally { if (directoryFd !== undefined) fs.closeSync(directoryFd); }
  }
  if (r.operation === 'symlinkExclusive') {
    parent(); fs.symlinkSync(r.linkTarget, target);
    const linked = fs.lstatSync(target, { bigint: true });
    if (!linked.isSymbolicLink() || linked.uid !== BigInt(process.getuid()) || linked.nlink !== 1n || fs.readlinkSync(target) !== r.linkTarget) fail();
    parent(); const named = fs.lstatSync(target, { bigint: true });
    if (!exact(id(linked), id(named)) || fs.readlinkSync(target) !== r.linkTarget) fail();
    return id(named);
  }
  if (r.operation === 'rename') {
    const destination = directory + '/' + r.target;
    parent(); const before = captured(target, r.expected);
    if (r.targetExpected != null) {
      captured(destination, r.targetExpected); parent(); captured(target, r.expected); captured(destination, r.targetExpected);
      fs.renameSync(target, destination);
    } else {
      // rename() cannot express NOREPLACE in Node. Regular-file link+unlink
      // publishes exclusively; interruption leaves evidence, never clobbers.
      parent(); captured(target, r.expected); fs.linkSync(target, destination);
      const source = fs.lstatSync(target, { bigint: true }), named = fs.lstatSync(destination, { bigint: true });
      if (!equal(id(before), id(source)) || source.nlink !== 2n || !exact(id(source), id(named))) fail();
      parent();
      if (!exact(id(source), id(fs.lstatSync(target, { bigint: true }))) || !exact(id(named), id(fs.lstatSync(destination, { bigint: true })))) fail();
      fs.unlinkSync(target);
    }
    parent(); const after = fs.lstatSync(destination, { bigint: true });
    if (!after.isFile() || after.nlink !== 1n || !equal(id(before), id(after)) || after.size !== before.size || after.mtimeNs !== before.mtimeNs) fail();
    return id(after);
  }
  const isDirectory = r.operation === 'mkdir0700';
  let file;
  try {
    if (isDirectory) {
      parent(); fs.mkdirSync(target, { mode: 0o700 });
      const named = fs.lstatSync(target, { bigint: true });
      if (!named.isDirectory() || named.uid !== BigInt(process.getuid()) || (named.mode & 0o077n) !== 0n) fail();
      parent(); file = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      if (!equal(id(named), id(fs.fstatSync(file, { bigint: true })))) fail();
    } else {
      parent(); file = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, r.mode);
    }
    const opened = fs.fstatSync(file, { bigint: true });
    if (opened.uid !== BigInt(process.getuid()) || (isDirectory ? !opened.isDirectory() : !opened.isFile() || opened.nlink !== 1n || opened.size !== 0n)) fail();
    const current = () => {
      parent();
      const held = fs.fstatSync(file, { bigint: true }), named = fs.lstatSync(target, { bigint: true });
      if (held.dev !== opened.dev || held.ino !== opened.ino || !equal(id(held), id(named)) || held.uid !== opened.uid || held.gid !== opened.gid
        || (isDirectory ? !named.isDirectory() : !named.isFile() || held.nlink !== 1n)) fail();
    };
    current(); let count = 0;
    if (!isDirectory) {
      for (;;) {
        const bytes = read(); if (!bytes.length) break;
        count += bytes.length;
        if (count > r.maxBytes || r.size !== null && count > r.size) throw Error('Pinned directory input bound');
        let offset = 0;
        while (offset < bytes.length) {
          current(); const n = fs.writeSync(file, bytes, offset, bytes.length - offset);
          if (!n) throw Error('Pinned directory short write'); offset += n;
        }
      }
      if (r.size !== null && count !== r.size) throw Error('Pinned directory input truncated');
    }
    const mode = isDirectory ? 0o700 : r.mode;
    current(); fs.fchmodSync(file, mode); current();
    const after = fs.fstatSync(file, { bigint: true });
    if ((after.mode & 0o7777n) !== BigInt(mode) || !isDirectory && after.size !== BigInt(count)) fail();
    return id(after);
  } finally { if (file !== undefined) fs.closeSync(file); }
}

/** @param {ParentOptions} options */
function verifier({ fd, cwd, parent, check }) {
  return () => {
    check();
    const held = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(cwd, { bigint: true });
    if (!held.isDirectory() || !named.isDirectory() || !same(parent, pinnedDirectoryIdentity(held)) || !same(parent, pinnedDirectoryIdentity(named))) throw Error('Pinned directory parent changed');
  };
}
/** @param {OperationOptions} options @param {number|null} size */
function prepare(options, size) {
  if (typeof process.getuid !== 'function' || !Number.isInteger(options.fd) || options.fd < 0 || typeof options.check !== 'function') throw Error('Invalid pinned directory parent');
  const request = { operation: options.operation, name: options.name, target: options.target, linkTarget: options.linkTarget, parent: options.parent, expected: options.expected, targetExpected: options.targetExpected,
    mode: options.mode ?? 0o600, maxBytes: options.maxBytes ?? 2 * 1024 * 1024, size };
  validateRequest(request);
  const header = Buffer.from(JSON.stringify(request)), length = Buffer.alloc(4);
  if (header.length > 32768) throw Error('Pinned directory header bound');
  length.writeUInt32BE(header.length);
  const verify = verifier(options); verify();
  return { request, header: Buffer.concat([length, header]), verify };
}
/** Only Linux's kernel alias is eligible, and stat(alias) alone proves nothing.
 * Darwin always uses the child; unavailability never authorizes pathname writes.
 * @param {number} fd @param {DirectoryIdentity} expected */
function anchor(fd, expected) {
  if (process.platform !== 'linux') return undefined;
  const directory = '/proc/self/fd/' + fd; let stat;
  try { stat = fs.statSync(directory + '/.', { bigint: true }); }
  catch (error) { if (['ENOENT', 'ENOTDIR', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EACCES'].includes(error.code)) return undefined; throw error; }
  if (!stat.isDirectory() || !same(expected, pinnedDirectoryIdentity(stat))) throw Error('Unsafe directory descriptor traversal');
  return directory;
}
const childSource = `"use strict";
const fs = require('node:fs');
try {
  function exact(size) {
    const bytes = Buffer.alloc(size); let offset = 0;
    while (offset < size) { const n = fs.readSync(0, bytes, offset, size-offset, null); if (!n) throw Error('Pinned directory header truncated'); offset += n; }
    return bytes;
  }
  const length = exact(4).readUInt32BE();
  if (!length || length > 32768) throw Error('Pinned directory header bound');
  const request = JSON.parse(exact(length).toString('utf8'));
  (${validateRequest.toString()})(request);
  const chunk = Buffer.alloc(65536); let count = 0;
  const read = () => {
    const n = fs.readSync(0, chunk, 0, chunk.length, null); count += n;
    if (count > request.maxBytes || request.size !== null && count > request.size) throw Error('Pinned directory input bound');
    return chunk.subarray(0, n);
  };
  const result = (${pinnedOperation.toString()})(fs, request, 3, '.', () => {}, read);
  if (read().length || request.size !== null && count !== request.size) throw Error('Pinned directory input truncated/unconsumed');
  const reply = JSON.stringify({ok:true, result});
  if (Buffer.byteLength(reply) > 4096) throw Error('Pinned directory response bound');
  process.stdout.write(reply);
} catch (error) {
  process.stdout.write(JSON.stringify({ok:false,code:['EEXIST','ENOENT','ENOTEMPTY'].includes(error.code)?error.code:'PINNED_DIRECTORY_CONFLICT',message:String(error.message).slice(0,400)}));
} finally { fs.closeSync(3); }
`;
if (Buffer.byteLength(childSource) > 32768) throw Error('Pinned directory trusted source bound');
/** @param {ParentOptions} options @returns {import('node:child_process').SpawnOptions & {stdio:['pipe','pipe','pipe',number]}} */
const spawnOptions = ({ fd, cwd }) => ({ cwd, timeout: 30_000, killSignal: /** @type {const} */ ('SIGKILL'), env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, stdio: ['pipe', 'pipe', 'pipe', fd] });
/** @param {string} output */
function response(output) {
  let reply; try { reply = JSON.parse(output); } catch { /* never success */ }
  if (reply?.ok !== true || !Object.hasOwn(reply, 'result')) throw Object.assign(Error('Pinned directory child failed; preserve evidence: ' + String(reply?.message ?? 'invalid reply')), { code: ['EEXIST', 'ENOENT', 'ENOTEMPTY'].includes(reply?.code) ? reply.code : 'PINNED_DIRECTORY_CONFLICT' });
  return reply.result;
}
/** @param {OperationOptions} options @param {any} result */
function postcondition(options, result) {
  const { operation, cwd, name, target } = options;
  if (operation === 'unlink' || operation === 'unlinkSymlink' || operation === 'rmdir' || operation === 'rename') {
    try {
      const current = fs.lstatSync(cwd + '/' + name, { bigint: true });
      // Unlink releases the name: another owner may create a successor before
      // the child reply arrives. Preserve it, but still reject an unchanged
      // original inode rather than accepting a false removal acknowledgement.
      if (!['unlink', 'unlinkSymlink'].includes(operation) || String(current.dev) === options.expected?.dev && String(current.ino) === options.expected?.ino) {
        throw Error('Pinned directory removed name changed');
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (operation === 'unlink' || operation === 'unlinkSymlink' || operation === 'rmdir') { if (result !== null) throw Error('Invalid pinned directory result'); return null; }
  const stat = fs.lstatSync(cwd + '/' + (operation === 'rename' ? target : name), { bigint: true });
  const wrongType = ['mkdir0700', 'chmodDirectory'].includes(operation) ? !stat.isDirectory()
    : operation === 'symlinkExclusive' ? !stat.isSymbolicLink() || fs.readlinkSync(cwd + '/' + name) !== options.linkTarget
      : !stat.isFile() || stat.nlink !== 1n;
  if (!sameEntry(result, pinnedEntryIdentity(stat)) || wrongType) throw Error('Pinned directory result changed');
  return result;
}

/** Fixed operations under a caller-held parent fd; caller supplies full ancestry
 * check(), retains fd ownership and rechecks returned identities before reuse.
 * Names are single components. chmodDirectory is identity-guarded and accepts
 * only non-group/other-writable modes; all creations are exclusive.
 * rename without targetExpected is no-clobber, regular-file link+unlink; with an
 * expected destination it deliberately replaces that captured name. unlink,
 * rmdir and replacement retain identity prechecks but are NOT kernel CAS: callers
 * still need exclusive coordination of those names. Conflicts/partial outcomes
 * retain evidence; no recursive or automatic rollback is performed.
 * @param {OperationOptions} options @returns {EntryIdentity|null} */
export function runPinnedDirectoryOperation(options) {
  const data = options.data ?? Buffer.alloc(0);
  if (!Buffer.isBuffer(data)) throw Error('Pinned directory input type');
  const { request, header, verify } = prepare(options, data.length), base = anchor(options.fd, options.parent);
  let result;
  if (base !== undefined) {
    let offset = 0;
    result = pinnedOperation(fs, request, options.fd, base, verify, () => { const bytes = data.subarray(offset, offset + 65536); offset += bytes.length; return bytes; });
  } else {
    const child = childProcess.spawnSync(process.execPath, ['--input-type=commonjs', '-e', childSource], { ...spawnOptions(options), input: Buffer.concat([header, data]), encoding: 'utf8', maxBuffer: 4096 });
    verify();
    if (child.error || child.status !== 0 || child.signal) throw Error('Pinned directory child unavailable; preserve evidence');
    result = response(child.stdout);
  }
  verify(); return postcondition(options, result);
}

