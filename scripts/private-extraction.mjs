import fs from 'node:fs';
import path from 'node:path';
import { captureDirectoryAncestry } from '../src/installation/filesystem-boundary.mjs';
import { LIMITS, safePath } from './bundle-contract.mjs';
import { pinnedDirectoryIdentity as identity, runPinnedDirectoryOperation } from './pinned-directory-child.mjs';

const directoryFlags = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
/** @typedef {import('./pinned-directory-child.mjs').DirectoryIdentity} Identity */
/** @param {Identity} a @param {Identity} b */
const same = (a, b) => !!a && !!b && a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid && a.gid === b.gid;

/** Parse/verify the whole archive before calling. Also preflight this API's full
 * entry list before any destination operation. Never reuse, chmod or clean up
 * existing names; on conflict retain evidence, including partial owned files.
 * All effects use a proven kernel alias or a cwd/fd3-verified child, never a
 * pathname fallback or parent chdir. Native macOS CI must qualify its own run.
 * @param {{path:string,mode:number,data:Buffer}[]} entries @param {string} output
 * @param {boolean} [legacy] */
export function extractPrivateEntries(entries, output, legacy = false) {
  if (!Array.isArray(entries) || entries.length > LIMITS.entries + 1) throw Error('Extraction entry bound');
  const declared = new Map(), aliases = new Map(); let total = 0;
  for (const e of entries) {
    safePath(e.path);
    if (![0o600, 0o700].includes(e.mode) || !Buffer.isBuffer(e.data) || e.data.length > LIMITS.file
      || legacy && e.mode === 0o700 && e.data.length !== 0 || declared.has(e.path)) throw Error('Unsafe extraction entry');
    total += e.data.length; if (total > LIMITS.bytes + LIMITS.manifest) throw Error('Extraction byte bound');
    declared.set(e.path, legacy && e.mode === 0o700);
    let rel = '';
    for (const part of e.path.split('/')) {
      rel = rel ? rel + '/' + part : part;
      const key = rel.toLowerCase();
      if (aliases.has(key) && aliases.get(key) !== rel) throw Error('Extraction path collision');
      aliases.set(key, rel);
    }
  }
  for (const e of entries) {
    const parts = e.path.split('/'); parts.pop(); let rel = '';
    for (const part of parts) { rel = rel ? rel + '/' + part : part; if (declared.get(rel) === false) throw Error('Extraction file prefix collision'); }
  }
  const absolute = path.resolve(output), parent = captureDirectoryAncestry(path.dirname(absolute));
  const root = path.join(parent.root, path.basename(absolute)), rootName = path.basename(root);
  if (!rootName || rootName === '.' || rootName === '..') throw Error('Unsafe extraction root name');
  // Existing destinations fail without spawning a child or attempting any writes.
  try { fs.lstatSync(root); throw Object.assign(Error('EEXIST: extraction destination exists'), { code: 'EEXIST' }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const parentStat = identity(fs.lstatSync(parent.root, { bigint: true }));
  const parentFd = fs.openSync(parent.root, directoryFlags);
  /** @type {number | undefined} */
  let rootFd;
  /** @param {number} fd @param {string} cwd @param {Identity} expected @param {string} name @param {boolean} directory @param {number} mode @param {Buffer} data @param {()=>void} check */
  const create = (fd, cwd, expected, name, directory, mode, data, check) => {
    const result = runPinnedDirectoryOperation({ fd, cwd, parent: expected, operation: directory ? 'mkdir0700' : 'writeExclusive', name, mode, data, maxBytes: LIMITS.file, check });
    if (!result) throw Error('Invalid extraction result');
    return result;
  };
  /** Read-only path resolution is never a write capability: compare the returned
   * child inode and every named ancestor before using this fd as the next parent.
   * @param {string} target @param {Identity} expected @param {()=>void} check */
  const openDirectory = (target, expected, check) => {
    check(); const fd = fs.openSync(target, directoryFlags);
    try {
      const stat = fs.fstatSync(fd, { bigint: true });
      if (!stat.isDirectory() || !same(expected, identity(stat))) throw Error('Extraction directory changed');
      check(); return fd;
    } catch (error) { fs.closeSync(fd); throw error; }
  };
  try {
    if (!same(parentStat, identity(fs.fstatSync(parentFd, { bigint: true })))) throw Error('Extraction ancestry changed');
    const rootStat = create(parentFd, parent.root, parentStat, rootName, true, 0o700, Buffer.alloc(0), parent.check);
    const rootGuard = captureDirectoryAncestry(root);
    rootFd = openDirectory(root, rootStat, rootGuard.check);
    const created = new Map([['', rootStat]]), written = new Map();
    /** @param {string} rel */
    const checkChain = rel => {
      rootGuard.check();
      if (!same(rootStat, identity(fs.lstatSync(root, { bigint: true })))) throw Error('Extraction root changed');
      let prefix = '';
      for (const part of rel ? rel.split('/') : []) {
        prefix = prefix ? prefix + '/' + part : part;
        const stat = fs.lstatSync(path.join(root, prefix), { bigint: true });
        if (!stat.isDirectory() || !same(created.get(prefix), identity(stat))) throw Error('Extraction directory ancestry changed');
      }
    };
    for (const e of entries) {
      const parts = e.path.split('/'), leaf = /** @type {string} */ (parts.pop());
      let currentFd = rootFd, rel = '';
      const check = () => {
        checkChain(rel);
        if (!same(created.get(rel), identity(fs.fstatSync(currentFd, { bigint: true })))) throw Error('Extraction parent changed');
      };
      try {
        for (const part of parts) {
          const nextRel = rel ? rel + '/' + part : part;
          if (!created.has(nextRel)) created.set(nextRel, create(currentFd, path.join(root, rel), created.get(rel), part, true, 0o700, Buffer.alloc(0), check));
          const nextFd = openDirectory(path.join(root, nextRel), created.get(nextRel), () => checkChain(nextRel));
          if (currentFd !== rootFd) fs.closeSync(currentFd);
          currentFd = nextFd; rel = nextRel;
        }
        const directory = legacy && e.mode === 0o700;
        const result = create(currentFd, path.join(root, rel), created.get(rel), leaf, directory, e.mode, e.data, check);
        (directory ? created : written).set(e.path, result);
        check();
      } finally { if (currentFd !== rootFd) fs.closeSync(currentFd); }
    }
    for (const rel of created.keys()) checkChain(rel);
    for (const [rel, expected] of written) {
      const stat = fs.lstatSync(path.join(root, rel), { bigint: true });
      if (!stat.isFile() || stat.nlink !== 1n || !same(expected, identity(stat)) || String(stat.size) !== expected.size || String(stat.mtimeNs) !== expected.mtimeNs || String(stat.ctimeNs) !== expected.ctimeNs) throw Error('Extracted file changed');
    }
    parent.check(); rootGuard.check(); return rootGuard;
  } finally { try { if (rootFd !== undefined) fs.closeSync(rootFd); } finally { fs.closeSync(parentFd); } }
}
