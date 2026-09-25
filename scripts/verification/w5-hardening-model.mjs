// W5 hardening model: an in-memory filesystem + Linux-emulated process used to
// run the REAL src/installation/installer-lock.mjs source with injected
// node:fs / global `process`. It is not a toy reimplementation of the lock: the
// module under test is the production source with only its imports rebound.
//
// Effects are confined to an in-memory tree plus retained fixture files holding
// the generated shims. Nothing here touches the real filesystem namespace.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const errno = (code, message = code) => Object.assign(new Error(message), { code });

const O = {
  O_RDONLY: 1,
  O_WRONLY: 2,
  O_RDWR: 4,
  O_CREAT: 64,
  O_EXCL: 128,
  O_TRUNC: 512,
  O_NOFOLLOW: 256,
  O_NONBLOCK: 2048,
  O_DIRECTORY: 65536,
};

const procStat = (pid) => `${pid} (node) S ${Array(18).fill("0").join(" ")} 1234\n`;

/** @param {{uid?:number, dev?:number, pid?:number, bootId?:string, namespace?:string}} [options] */
export function createMemoryFs(options = {}) {
  const uid = options.uid ?? 501;
  const dev = options.dev ?? 1;
  const pid = options.pid ?? 4242;
  const bootId = options.bootId ?? "12345678-1234-1234-1234-123456789abc";
  const namespace = options.namespace ?? "pid:[4026531836]";
  let inoSeq = 100n;
  let timeSeq = 1n;
  let fdSeq = 3;
  const nodes = new Map();
  const fds = new Map();
  const now = () => ++timeSeq;
  const makeNode = (kind, mode) => ({
    kind,
    mode: BigInt(mode),
    uid: BigInt(uid),
    ino: inoSeq++,
    dev: BigInt(dev),
    birthNs: now(),
    mtimeNs: now(),
    ctimeNs: now(),
    nlink: 1n,
    data: kind === "file" ? Buffer.alloc(0) : null,
    target: kind === "symlink" ? "" : null,
  });
  const isDir = (p) => nodes.get(p)?.kind === "dir";
  const children = (p) => {
    const prefix = p === "/" ? "/" : `${p}/`;
    const names = [];
    for (const key of nodes.keys()) {
      if (key !== p && key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        if (!rest.includes("/")) names.push(rest);
      }
    }
    return names.sort();
  };
  const mkdir = (p, mode = 0o755) => {
    if (nodes.has(p)) throw errno("EEXIST");
    if (!isDir(path.dirname(p))) throw errno("ENOENT");
    nodes.set(p, makeNode("dir", mode));
  };
  const writeFile = (p, content, mode = 0o600) => {
    if (!isDir(path.dirname(p))) throw errno("ENOENT");
    const node = makeNode("file", mode);
    node.data = Buffer.from(content);
    nodes.set(p, node);
    return node;
  };
  const symlink = (p, target) => {
    if (nodes.has(p)) throw errno("EEXIST");
    if (!isDir(path.dirname(p))) throw errno("ENOENT");
    const node = makeNode("symlink", 0o777);
    node.target = target;
    nodes.set(p, node);
  };

  const resolve = (input, followFinal = true) => {
    if (typeof input !== "string" || !input.startsWith("/")) throw errno("EINVAL", "model requires absolute paths");
    let parts = input.split("/").filter((seg) => seg !== "" && seg !== ".");
    let resolved = "/";
    let i = 0;
    let hops = 0;
    while (i < parts.length) {
      const seg = parts[i];
      if (seg === "..") {
        if (resolved !== "/") resolved = path.dirname(resolved);
        i++;
        continue;
      }
      if (/^\/proc\/[0-9]+\/fd$/.test(resolved)) {
        const fdNum = Number(seg);
        if (Number.isInteger(fdNum) && fds.has(fdNum)) {
          resolved = fds.get(fdNum).path;
          i++;
          continue;
        }
      }
      const candidate = resolved === "/" ? `/${seg}` : `${resolved}/${seg}`;
      const node = nodes.get(candidate);
      if (!node) {
        if (i === parts.length - 1) return { path: candidate, node: undefined, missing: true, parent: resolved };
        throw errno("ENOENT");
      }
      const isFinal = i === parts.length - 1;
      if (node.kind === "symlink" && (!isFinal || followFinal)) {
        if (++hops > 40) throw errno("ELOOP");
        const target = node.target.startsWith("/") ? node.target : (resolved === "/" ? `/${node.target}` : `${resolved}/${node.target}`);
        parts = target.split("/").filter((s) => s !== "" && s !== ".").concat(parts.slice(i + 1));
        resolved = "/";
        i = 0;
        continue;
      }
      resolved = candidate;
      i++;
    }
    return { path: resolved, node: nodes.get(resolved), missing: !nodes.has(resolved), parent: path.dirname(resolved) };
  };

  const statOf = (node, opts = {}) => {
    const big = opts.bigint === true;
    const mode = node.mode;
    if (big) {
      return {
        dev: node.dev, ino: node.ino, mode, nlink: node.nlink, uid: node.uid,
        size: node.kind === "file" ? BigInt(node.data.length) : 0n,
        mtimeNs: node.mtimeNs, ctimeNs: node.ctimeNs, birthtimeNs: node.birthNs,
        isDirectory: () => node.kind === "dir", isFile: () => node.kind === "file", isSymbolicLink: () => node.kind === "symlink",
      };
    }
    return {
      dev: Number(node.dev), ino: Number(node.ino), mode: Number(mode), nlink: Number(node.nlink), uid: Number(node.uid),
      size: node.kind === "file" ? node.data.length : 0,
      mtimeMs: Number(node.mtimeNs) / 1e6, ctimeMs: Number(node.ctimeNs) / 1e6, birthtimeMs: Number(node.birthNs) / 1e6,
      isDirectory: () => node.kind === "dir", isFile: () => node.kind === "file", isSymbolicLink: () => node.kind === "symlink",
    };
  };

  const memory = {
    constants: O,
    realpathSync(p) { const r = resolve(p, true); if (r.missing) throw errno("ENOENT"); return r.path; },
    lstatSync(p, opts) { const r = resolve(p, false); if (r.missing) throw errno("ENOENT"); return statOf(r.node, opts); },
    statSync(p, opts) { const r = resolve(p, true); if (r.missing) throw errno("ENOENT"); return statOf(r.node, opts); },
    readlinkSync(p) { const r = resolve(p, false); if (r.missing) throw errno("ENOENT"); if (r.node.kind !== "symlink") throw errno("EINVAL"); return r.node.target; },
    existsSync(p) { try { return !resolve(p, true).missing; } catch { return false; } },
    mkdirSync(p, opts = {}) { const mode = Number(opts.mode ?? 0o777); const r = resolve(p, true); mkdir(r.path, mode); },
    rmdirSync(p) {
      const r = resolve(p, true);
      if (r.missing) throw errno("ENOENT");
      if (r.node.kind !== "dir") throw errno("ENOTDIR");
      if (children(r.path).length) throw errno("ENOTEMPTY");
      nodes.delete(r.path);
    },
    unlinkSync(p) {
      const r = resolve(p, false);
      if (r.missing) throw errno("ENOENT");
      if (r.node.kind === "dir") throw errno("EISDIR");
      nodes.delete(r.path);
      if (r.node.nlink > 0n) r.node.nlink -= 1n;
    },
    openSync(p, flags = O.O_RDONLY, mode) {
      const follow = !(flags & O.O_NOFOLLOW);
      const r = resolve(p, follow);
      let node = r.node;
      if (node && node.kind === "symlink") throw errno("ELOOP");
      if (!node) {
        if (!(flags & O.O_CREAT)) throw errno("ENOENT");
        if (!isDir(r.parent)) throw errno("ENOENT");
        node = makeNode("file", Number(mode ?? 0o600));
        nodes.set(r.path, node);
      } else if ((flags & O.O_CREAT) && (flags & O.O_EXCL)) {
        throw errno("EEXIST");
      }
      if ((flags & O.O_DIRECTORY) && node.kind !== "dir") throw errno("ENOTDIR");
      if ((flags & O.O_TRUNC) && node.kind === "file") { node.data = Buffer.alloc(0); node.mtimeNs = now(); node.ctimeNs = now(); }
      const fd = fdSeq++;
      fds.set(fd, { node, path: r.path, pos: 0 });
      return fd;
    },
    closeSync(fd) { if (!fds.has(fd)) throw errno("EBADF"); fds.delete(fd); },
    fstatSync(fd, opts) { const f = fds.get(fd); if (!f) throw errno("EBADF"); return statOf(f.node, opts); },
    fchmodSync(fd, mode) { const f = fds.get(fd); if (!f) throw errno("EBADF"); f.node.mode = BigInt(mode); f.node.ctimeNs = now(); },
    fsyncSync(fd) { if (!fds.has(fd)) throw errno("EBADF"); },
    readSync(fd, buffer, offset, length, position) {
      const f = fds.get(fd);
      if (!f) throw errno("EBADF");
      if (f.node.kind !== "file") throw errno("EISDIR");
      const pos = position === null || position === undefined ? f.pos : position;
      if (pos >= f.node.data.length || length <= 0) return 0;
      const end = Math.min(pos + length, f.node.data.length);
      f.node.data.copy(buffer, offset, pos, end);
      if (position === null || position === undefined) f.pos = end;
      return end - pos;
    },
    writeFileSync(target, data) {
      if (typeof target === "number") {
        const f = fds.get(target);
        if (!f) throw errno("EBADF");
        f.node.data = Buffer.from(data);
        f.node.mtimeNs = now();
        f.node.ctimeNs = now();
        return;
      }
      const r = resolve(target, true);
      if (!isDir(r.parent)) throw errno("ENOENT");
      const node = r.node ?? makeNode("file", 0o600);
      node.data = Buffer.from(data);
      node.mtimeNs = now();
      node.ctimeNs = now();
      nodes.set(r.path, node);
    },
    readFileSync(p) { const r = resolve(p, true); if (r.missing) throw errno("ENOENT"); if (r.node.kind !== "file") throw errno("EISDIR"); return Buffer.from(r.node.data); },
    readdirSync(p) { const r = resolve(p, true); if (r.missing) throw errno("ENOENT"); if (r.node.kind !== "dir") throw errno("ENOTDIR"); return children(r.path); },
    opendirSync(p) {
      const r = resolve(p, true);
      if (r.missing) throw errno("ENOENT");
      if (r.node.kind !== "dir") throw errno("ENOTDIR");
      const names = children(r.path);
      let index = 0;
      return { readSync() { return index < names.length ? { name: names[index++] } : null; }, closeSync() {} };
    },
    linkSync(existing, next) {
      const src = resolve(existing, true);
      if (src.missing) throw errno("ENOENT");
      if (src.node.kind !== "file") throw errno("EPERM");
      const dst = resolve(next, false);
      if (nodes.has(dst.path)) throw errno("EEXIST");
      if (!isDir(dst.parent)) throw errno("ENOENT");
      nodes.set(dst.path, src.node);
      src.node.nlink += 1n;
    },
    renameSync(from, to) {
      const src = resolve(from, false);
      if (src.missing) throw errno("ENOENT");
      const dst = resolve(to, false);
      if (!isDir(dst.parent)) throw errno("ENOENT");
      if (nodes.has(dst.path)) throw errno("EEXIST");
      const prefix = `${src.path}/`;
      for (const key of [...nodes.keys()]) {
        if (key === src.path || key.startsWith(prefix)) {
          const node = nodes.get(key);
          nodes.delete(key);
          nodes.set(dst.path + key.slice(src.path.length), node);
        }
      }
    },
    /** Test-only helpers (not part of the production fs surface). */
    __children: children,
    __nodes: nodes,
    __fds: fds,
  };

  nodes.set("/", makeNode("dir", 0o755));
  mkdir("/proc", 0o555);
  mkdir("/proc/sys", 0o555);
  mkdir("/proc/sys/kernel", 0o555);
  mkdir("/proc/sys/kernel/random", 0o555);
  writeFile("/proc/sys/kernel/random/boot_id", `${bootId}\n`, 0o444);
  symlink("/proc/self", `/proc/${pid}`);
  mkdir(`/proc/${pid}`, 0o555);
  mkdir(`/proc/${pid}/fd`, 0o555);
  mkdir(`/proc/${pid}/ns`, 0o555);
  symlink(`/proc/${pid}/ns/pid`, namespace);
  writeFile(`/proc/${pid}/stat`, procStat(pid), 0o444);

  return memory;
}

/** @param {{pid?:number, uid?:number}} [options] */
export function createModelProcess(options = {}) {
  const pid = options.pid ?? 4242;
  const uid = options.uid ?? 501;
  const live = new Set([pid]);
  return {
    platform: "linux",
    pid,
    getuid: () => uid,
    kill: (target, signal) => {
      if (signal === 0) {
        if (live.has(target)) return true;
        throw errno("ESRCH");
      }
      throw errno("EPERM");
    },
    hrtime: { bigint: () => BigInt(Date.now()) * 1000000n },
    env: {},
  };
}

const HERE = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(HERE), "..", "..");

/**
 * Rewrite the real lock source so node:fs and `process` are the injected model,
 * then import it. The retained fixture directory holds only generated shims.
 * @param {string} fixturesRoot @param {{label?:string}} [options]
 */
export async function createModelLockFixture(fixturesRoot, options = {}) {
  const label = options.label ?? "model";
  const dir = fs.mkdtempSync(path.join(fixturesRoot, `${label}-`));
  fs.chmodSync(dir, 0o700);
  const modelUrl = pathToFileURL(HERE).href;
  const fsFile = path.join(dir, "model-fs.mjs");
  const procFile = path.join(dir, "model-process.mjs");
  const lockFile = path.join(dir, "lock-under-test.mjs");
  fs.writeFileSync(fsFile, `import { createMemoryFs } from ${JSON.stringify(modelUrl)};\nexport const memory = createMemoryFs();\nexport default memory;\n`, { mode: 0o600 });
  fs.writeFileSync(procFile, `import { createModelProcess } from ${JSON.stringify(modelUrl)};\nexport const modelProcess = createModelProcess();\nexport default modelProcess;\n`, { mode: 0o600 });
  const source = fs.readFileSync(path.join(REPO, "src", "installation", "installer-lock.mjs"), "utf8");
  const pinned = pathToFileURL(path.join(REPO, "src", "installation", "pinned-recovery.mjs")).href;
  const rewritten = source
    .replace('from "node:fs"', `from ${JSON.stringify(pathToFileURL(fsFile).href)}`)
    .replace('from "./pinned-recovery.mjs"', `from ${JSON.stringify(pinned)}`);
  if (!rewritten.includes("model-fs.mjs")) throw new Error("model rebinding failed: node:fs import not found");
  const withProcess = `import { modelProcess as __kfModelProcess } from ${JSON.stringify(pathToFileURL(procFile).href)};\nconst process = __kfModelProcess;\n${rewritten}`;
  fs.writeFileSync(lockFile, withProcess, { mode: 0o600 });
  const memory = (await import(pathToFileURL(fsFile).href)).default;
  const lock = await import(pathToFileURL(lockFile).href);
  return { dir, memory, lock, fsFile, procFile, lockFile };
}
