// Activation-only preservation oracle. No staging-preservation API dependency.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const SNAPSHOT_LIMITS = Object.freeze({ maxDepth: 64, maxEntries: 100000, maxFileBytes: 1024 ** 3, maxBytes: 8 * 1024 ** 3, deadlineMs: 120000 });
// atime is deliberately excluded: observing bytes can update it. All other
// agreed fields are explicit. Missing roots, links, devices and races REFUSE.
const record = (s, relative) => ({ path: relative, type: s.isDirectory() ? 'directory' : 'file', mode: Number(s.mode & 0o7777n), uid: String(s.uid), gid: String(s.gid), nlink: String(s.nlink), dev: String(s.dev), ino: String(s.ino), size: String(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs), birthtimeNs: String(s.birthtimeNs) });
export function snapshotTree(root, limits = {}) {
  const bounds = { ...SNAPSHOT_LIMITS, ...limits };
  for (const value of Object.values(bounds)) assert.ok(Number.isSafeInteger(value) && value > 0, 'invalid snapshot bound');
  root = path.resolve(root);
  assert.equal(fs.realpathSync(root), root, 'snapshot root must be canonical, with no symlink ancestry');
  const deadline = performance.now() + bounds.deadlineMs;
  const out = [], handles = [], buffer = Buffer.alloc(128 * 1024);
  let total = 0;
  const checkTime = () => { if (performance.now() >= deadline) throw Error('snapshot deadline exhausted'); };
  const verify = ({ file, fd, expected }) => {
    checkTime();
    assert.deepEqual(record(fs.fstatSync(fd, { bigint: true }), expected.path), expected, 'snapshot handle changed: ' + file);
    const st = fs.lstatSync(file, { bigint: true });
    assert.ok(!st.isSymbolicLink(), 'snapshot path became symlink');
    assert.deepEqual(record(st, expected.path), expected, 'snapshot path identity changed: ' + file);
  };
  const walk = (file, relative, depth, openPath = file) => {
    checkTime();
    if (depth > bounds.maxDepth || out.length >= bounds.maxEntries) throw Error('snapshot depth/entry bound exhausted');
    for (const handle of handles) verify(handle);
    const st = fs.lstatSync(file, { bigint: true });
    assert.ok(!st.isSymbolicLink() && (st.isFile() || st.isDirectory()), 'unsupported snapshot entry: ' + file);
    if (depth === 0) assert.ok(st.isDirectory(), 'snapshot root must be a directory');
    const expected = record(st, relative);
    if (st.isFile() && st.size > BigInt(bounds.maxFileBytes)) throw Error('snapshot file byte bound exhausted');
    const fd = fs.openSync(openPath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW | (st.isDirectory() ? fs.constants.O_DIRECTORY : 0));
    const handle = { file, fd, expected };
    try {
      verify(handle);
      out.push({ ...expected });
      if (st.isDirectory()) {
        handles.push(handle);
        // opendir streams bounded entries, unlike readdir's unbounded allocation.
        // Linux supports fd-relative directory traversal. Darwin's /dev/fd
        // exposes synthetic vnodes and refuses O_DIRECTORY (ENOTDIR): use the
        // checked namespace there, retaining every ancestor handle and checking
        // inode + unforgeable ctime before/after each descent. No atomic snapshot
        // or hostile-same-user isolation is claimed by this same-run oracle.
        if (!['linux', 'darwin'].includes(process.platform)) throw Error('unsupported snapshot platform');
        const anchored = process.platform === 'linux' ? `/proc/self/fd/${fd}` : file;
        const dir = fs.opendirSync(anchored, { bufferSize: 32 });
        try {
          verify(handle);
          let entry;
          while ((entry = dir.readSync()) !== null) walk(path.join(file, entry.name), relative === '.' ? entry.name : relative + '/' + entry.name, depth + 1, path.join(anchored, entry.name));
        } finally { dir.closeSync(); handles.pop(); }
      } else {
        const hash = createHash('sha256');
        let read = 0, count;
        while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) !== 0) {
          checkTime(); read += count; total += count;
          if (read > bounds.maxFileBytes || total > bounds.maxBytes || BigInt(read) > st.size) throw Error('snapshot byte bound exhausted or growing file');
          hash.update(buffer.subarray(0, count));
        }
        assert.equal(BigInt(read), st.size, 'snapshot file shortened');
        out[out.length - 1].sha256 = hash.digest('hex');
      }
      verify(handle);
      for (const ancestor of handles) verify(ancestor);
    } finally { fs.closeSync(fd); }
  };
  walk(root, '.', 0);
  // Reject persistent changes to already-hashed entries while later siblings
  // were being observed. This is still a bounded observation, not an OS lock.
  for (const entry of out) {
    checkTime();
    const st = fs.lstatSync(entry.path === '.' ? root : path.join(root, entry.path), { bigint: true });
    assert.ok(!st.isSymbolicLink() && (st.isFile() || st.isDirectory()), 'snapshot type changed');
    const { sha256: ignored, ...expected } = entry;
    assert.deepEqual(record(st, entry.path), expected, 'snapshot changed during traversal');
  }
  return out.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/** Read a small control bound to a completed snapshot, never an unbounded
 * readFile allocation after an attacker replaces a previously-small control. */
export function readCapturedFile(root, tree, relative, maxBytes = 4 * 1024 * 1024) {
  const expected = tree.find(entry => entry.path === relative);
  if (!expected) return null;
  assert.ok(expected.type === 'file' && Number.isSafeInteger(maxBytes) && maxBytes > 0 && BigInt(expected.size) <= BigInt(maxBytes), 'captured control byte bound: ' + relative);
  const file = path.join(root, relative);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
  const { sha256, ...identity } = expected;
  const verify = () => {
    assert.deepEqual(record(fs.fstatSync(fd, { bigint: true }), relative), identity, 'captured control handle changed');
    const st = fs.lstatSync(file, { bigint: true }); assert.ok(st.isFile() && !st.isSymbolicLink());
    assert.deepEqual(record(st, relative), identity, 'captured control path changed');
  };
  try {
    verify();
    const value = Buffer.alloc(Number(expected.size)), extra = Buffer.alloc(1), deadline = performance.now() + 10000;
    let position = 0;
    while (position < value.length) {
      if (performance.now() >= deadline) throw Error('captured control read deadline');
      const count = fs.readSync(fd, value, position, Math.min(128 * 1024, value.length - position), null);
      if (!count) throw Error('captured control shortened'); position += count;
    }
    assert.equal(fs.readSync(fd, extra, 0, 1, null), 0, 'captured control grew');
    verify(); assert.equal(createHash('sha256').update(value).digest('hex'), sha256, 'captured control checksum changed');
    return value;
  } finally { fs.closeSync(fd); }
}

// Exact path policies only: no prefix/wildcard exemptions. Directory publication
// can change size/nlink/mtime/ctime, never root identity, owner, mode or birthtime.
const DIRECTORY_PUBLICATION_FIELDS = Object.freeze(['size', 'nlink', 'mtimeNs', 'ctimeNs']);
export function assertSnapshotDelta(before, after, { directories = [], replacements = [], additions = [], removals = [] } = {}) {
  const old = new Map(before.map(r => [r.path, r])), next = new Map(after.map(r => [r.path, r]));
  const dirs = new Set(directories), replace = new Set(replacements), added = new Set(additions);
  for (const [name, prior] of old) {
    const current = next.get(name);
    if (!current && removals.includes(name)) continue;
    assert.ok(current, 'unexpected removal: ' + name);
    if (replace.has(name)) {
      assert.equal(prior.type, 'file'); assert.equal(current.type, 'file');
      for (const key of ['mode', 'uid', 'gid', 'nlink']) assert.equal(current[key], prior[key], 'control metadata changed: ' + name + ':' + key);
    } else if (dirs.has(name)) {
      assert.equal(prior.type, 'directory'); assert.equal(current.type, 'directory');
      const fixed = r => Object.fromEntries(Object.entries(r).filter(([key]) => !DIRECTORY_PUBLICATION_FIELDS.includes(key)));
      assert.deepEqual(fixed(current), fixed(prior), 'directory identity changed: ' + name);
    } else assert.deepEqual(current, prior, 'unexpected preservation delta: ' + name);
  }
  assert.deepEqual([...old.keys()].filter(name => !next.has(name)).sort(), [...removals].sort(), 'unexpected/missing removal inventory');
  const actualAdded = [...next.keys()].filter(name => !old.has(name)).sort();
  assert.deepEqual(actualAdded, [...added].sort(), 'unexpected/missing publication inventory');
}
