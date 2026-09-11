import childProcess from "node:child_process";

// This function is deliberately closure-free: its source is embedded in both
// the bundled manager and backend, then executed by their own verified Node.
// No adjacent script, shell, native addon, PATH lookup or caller NODE_OPTIONS.
// The child inherits a kernel-pinned cwd; it NEVER chdirs or resolves a supplied
// file path. All file names below are fixed or derived from a bounded index.
/** @param {typeof import('node:fs')} fs
 * @param {typeof import('node:crypto').createHash} createHash
 * @param {any} request */
export function pinnedRecoveryChild(fs, createHash, request) {
  const fail = (message) => { throw Object.assign(new Error(message), { code: "INSTALL_LOCK_RECOVERY_REQUIRED" }); };
  const id = (s) => ({ dev: String(s.dev), ino: String(s.ino) });
  const same = (a, b) => a?.dev === b?.dev && a?.ino === b?.ino;
  const identity = (v) => v && [v.dev, v.ino].every(s => typeof s === "string" && /^(0|[1-9][0-9]{0,24})$/u.test(s));
  const record = (v) => v && identity(v.file) && typeof v.hash === "string" && /^[a-f0-9]{64}$/u.test(v.hash);
  const safe = (s, directory, links = 1) => {
    if ((directory ? !s.isDirectory() : !s.isFile()) || s.isSymbolicLink() || typeof process.getuid !== "function"
      || s.uid !== BigInt(process.getuid()) || (s.mode & 0o7777n) !== (directory ? 0o700n : 0o600n)
      || (!directory && (s.nlink !== BigInt(links) || s.size > 4096n))) fail("unsafe pinned recovery file");
    return s;
  };
  const stat = (name, directory = false, links = 1) => safe(fs.lstatSync(name, { bigint: true }), directory, links);
  const directory = () => {
    if (!same(id(stat(".", true)), request.lock) || (request.birth !== undefined && String(stat(".", true).birthtimeNs) !== request.birth) || !same(id(stat("..", true)), request.root)) fail("pinned recovery directory replaced");
  };
  if (!request || (request.birth !== undefined && (typeof request.birth !== "string" || !/^[1-9][0-9]{0,24}$/u.test(request.birth)))
    || !["inspect", "create", "publish", "restore"].includes(request.operation) || !identity(request.root)
    || !identity(request.lock) || !record(request.owner) || !Array.isArray(request.claims)
    || request.claims.length > 16 || !request.claims.every(record)) fail("invalid pinned recovery request");
  if (request.operation !== "inspect" && request.claims.length >= 16) fail("recovery claim capacity reached");
  if ((request.releasing && (typeof request.hasOwner !== "boolean" || request.claims.length || !["inspect", "restore"].includes(request.operation)))
    || (request.operation === "restore" && !request.releasing)
    || (request.linkedRelease !== undefined && (request.linkedRelease !== true || request.releasing))) fail("invalid pinned release request");
  const claimName = index => `claim-${String(index).padStart(2, "0")}.json`;
  const target = claimName(request.claims.length);
  const ownerLinks = request.linkedRelease || (request.releasing && request.hasOwner) ? 2 : 1;
  const names = [...(!request.releasing || request.hasOwner ? ["owner.json"] : []), ...request.claims.map((_, i) => claimName(i)), ...(request.operation === "publish" ? [target] : [])].sort();
  const controls = [[request.releasing ? "../.install-lock-release.json" : "owner.json", request.owner, ownerLinks],
    ...(request.releasing && request.hasOwner ? [["owner.json", request.owner, ownerLinks]] : []),
    ...(request.linkedRelease ? [["../.install-lock-release.json", request.owner, ownerLinks]] : []), ...request.claims.map((c, i) => [claimName(i), c, 1])];
  const inspect = () => {
    directory();
    const dir = fs.opendirSync("."); const observed = [];
    try { let entry; while ((entry = dir.readSync())) { observed.push(entry.name); if (observed.length > 17) fail("pinned recovery entry bound"); } }
    finally { dir.closeSync(); }
    if (JSON.stringify(observed.sort()) !== JSON.stringify(names)) fail("pinned recovery entries changed");
    for (const [name, expected, links] of controls) {
      const before = stat(name, false, links);
      if (!same(id(before), expected.file)) fail("pinned recovery control replaced");
      const fd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      try {
        if (!same(id(safe(fs.fstatSync(fd, { bigint: true }), false, links)), expected.file)) fail("pinned recovery read identity changed");
        const bytes = Buffer.alloc(4097); let count = 0;
        while (count < bytes.length) { const n = fs.readSync(fd, bytes, count, bytes.length - count, null); if (!n) break; count += n; }
        const after = stat(name, false, links);
        if (count > 4096 || BigInt(count) !== before.size || !same(id(after), expected.file)
          || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.size !== after.size
          || createHash("sha256").update(bytes.subarray(0, count)).digest("hex") !== expected.hash) fail("pinned recovery control changed");
      } finally { fs.closeSync(fd); }
    }
    directory();
  };
  inspect();
  if (request.operation === "inspect") return { ok: true };
  if (request.operation === "restore") {
    if (request.hasOwner) fail("release owner already restored");
    fs.linkSync("../.install-lock-release.json", "owner.json");
    const fd = fs.openSync(".", fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return { ok: true, file: request.owner.file };
  }
  if (request.operation === "publish") {
    if (!identity(request.created) || typeof request.text !== "string" || Buffer.byteLength(request.text) > 4096
      || request.text !== `${JSON.stringify(JSON.parse(request.text))}\n`) fail("invalid pinned recovery publication");
    const before = stat(target);
    if (!same(id(before), request.created) || before.size !== 0n) fail("pinned recovery pending claim replaced");
  }
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
    | (request.operation === "create" ? fs.constants.O_CREAT | fs.constants.O_EXCL : 0), 0o600);
  try {
    if (request.operation === "create") fs.fchmodSync(fd, 0o600);
    const opened = safe(fs.fstatSync(fd, { bigint: true }), false);
    if (opened.size !== 0n || (request.operation === "publish" && !same(id(opened), request.created))) fail("pinned recovery write identity changed");
    directory();
    if (request.operation === "publish") fs.writeFileSync(fd, request.text);
    fs.fsyncSync(fd);
    if (!same(id(stat(target)), id(opened))) fail("pinned recovery claim replaced after write");
    const directoryFd = fs.openSync(".", fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    return { ok: true, file: id(opened) };
  } finally { fs.closeSync(fd); }
  // Unknown/partial claims are deliberately retained on error or process death.
}

const childSource = `"use strict";
const fs = require("node:fs");
try {
  const bytes = Buffer.alloc(32769); let count = 0;
  while (count < bytes.length) { const n = fs.readSync(0, bytes, count, bytes.length - count, null); if (!n) break; count += n; }
  if (count > 32768) throw new Error("pinned recovery request bound");
  const result = (${pinnedRecoveryChild.toString()})(fs, require("node:crypto").createHash, JSON.parse(bytes.subarray(0,count).toString("utf8")));
  process.stdout.write(JSON.stringify(result));
} catch(error) {
  process.stdout.write(JSON.stringify({ok:false,code:error.code === "EEXIST" ? "INSTALL_LOCK_BUSY" : "INSTALL_LOCK_RECOVERY_REQUIRED",message:String(error.message).slice(0,400)}));
}`;

/** Execute a bounded operation in a child whose cwd pins the exact directory.
 * 'create' leaves an owned EMPTY claim, preserving the existing partial-write
 * crash boundary. 'publish' revalidates that inode before writing. 'restore'
 * exclusively links a proven parent release marker back to owner.json; linked
 * release owners retain two-name proof while every claim remains single-linked.
 * Optional directory birth identity prevents adoption of a recycled inode. No deletion
 * or cleanup is attempted after unknown child outcomes.
 * @param {string} target
 * @param {any} expected
 * @param {{operation?: 'inspect'|'create'|'publish'|'restore', created?: {dev: string, ino: string}, text?: string}} [options]
 */
export function runPinnedRecovery(target, expected, { operation = "inspect", created, text } = {}) {
  const bind = entry => ({ file: entry.file, hash: entry.hash });
  const input = JSON.stringify({ operation, root: expected.root, lock: expected.lock, owner: bind(expected.owner), claims: expected.claims.map(bind), ...(expected.linkedRelease ? { linkedRelease: true } : {}), ...(expected.owner.value?.lockBirth === undefined ? {} : { birth: expected.owner.value.lockBirth }), ...(expected.releasing ? { releasing: true, hasOwner: expected.hasOwner } : {}), ...(created ? { created } : {}), ...(text === undefined ? {} : { text }) });
  if (Buffer.byteLength(input) > 32768) throw Object.assign(new Error("pinned recovery request bound"), { code: "INSTALL_LOCK_RECOVERY_REQUIRED" });
  let output;
  try {
    output = childProcess.execFileSync(process.execPath, ["--input-type=commonjs", "-e", childSource], {
      cwd: target, input, encoding: "utf8", timeout: 2_000, killSignal: "SIGKILL", maxBuffer: 4096,
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw Object.assign(new Error("pinned-directory recovery helper unavailable; preserve lock"), { code: "INSTALL_LOCK_UNSUPPORTED" });
  }
  let result;
  try { result = JSON.parse(output); } catch { /* malformed output is never success */ }
  if (result?.ok !== true || (operation !== "inspect" && (!result.file || ![result.file.dev, result.file.ino].every(s => typeof s === "string" && /^(0|[1-9][0-9]{0,24})$/u.test(s))))) {
    throw Object.assign(new Error(result?.code === "INSTALL_LOCK_BUSY" ? "installation lock recovery busy" : "pinned recovery operation failed; preserve lock"), { code: result?.code === "INSTALL_LOCK_BUSY" ? "INSTALL_LOCK_BUSY" : "INSTALL_LOCK_RECOVERY_REQUIRED" });
  }
  return result.file;
}
