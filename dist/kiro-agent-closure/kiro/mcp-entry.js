#!/usr/bin/env node
import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
globalThis.__filename = __fileURLToPath(import.meta.url);
globalThis.__dirname = __dirnameOf(globalThis.__filename);
const require = __createRequire(import.meta.url);

import {
  canonicalPathContains,
  inspectCanonicalPath,
  resolveSearchExecutable
} from "../chunks/chunk-762YYRNE.js";
import "../chunks/chunk-AE4E2KSU.js";

// src/kiro/mcp-entry.ts
import { readFileSync, realpathSync } from "node:fs";
import { createHash as createHash4 } from "node:crypto";
import path6 from "node:path";

// src/installation/installer-lock.mjs
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

// src/installation/pinned-recovery.mjs
import childProcess from "node:child_process";
function pinnedRecoveryChild(fs5, createHash5, request) {
  const fail2 = (message) => {
    throw Object.assign(new Error(message), { code: "INSTALL_LOCK_RECOVERY_REQUIRED" });
  };
  const id = (s) => ({ dev: String(s.dev), ino: String(s.ino) });
  const same2 = (a, b) => a?.dev === b?.dev && a?.ino === b?.ino;
  const identity2 = (v) => v && [v.dev, v.ino].every((s) => typeof s === "string" && /^(0|[1-9][0-9]{0,24})$/u.test(s));
  const record2 = (v) => v && identity2(v.file) && typeof v.hash === "string" && /^[a-f0-9]{64}$/u.test(v.hash);
  const safe = (s, directory2, links = 1) => {
    if ((directory2 ? !s.isDirectory() : !s.isFile()) || s.isSymbolicLink() || typeof process.getuid !== "function" || s.uid !== BigInt(process.getuid()) || (s.mode & 0o7777n) !== (directory2 ? 0o700n : 0o600n) || !directory2 && (s.nlink !== BigInt(links) || s.size > 4096n)) fail2("unsafe pinned recovery file");
    return s;
  };
  const stat = (name, directory2 = false, links = 1) => safe(fs5.lstatSync(name, { bigint: true }), directory2, links);
  const directory = () => {
    if (!same2(id(stat(".", true)), request.lock) || request.birth !== void 0 && String(stat(".", true).birthtimeNs) !== request.birth || !same2(id(stat("..", true)), request.root)) fail2("pinned recovery directory replaced");
  };
  if (!request || request.birth !== void 0 && (typeof request.birth !== "string" || !/^[1-9][0-9]{0,24}$/u.test(request.birth)) || !["inspect", "create", "publish", "restore"].includes(request.operation) || !identity2(request.root) || !identity2(request.lock) || !record2(request.owner) || !Array.isArray(request.claims) || request.claims.length > 16 || !request.claims.every(record2)) fail2("invalid pinned recovery request");
  if (request.operation !== "inspect" && request.claims.length >= 16) fail2("recovery claim capacity reached");
  if (request.releasing && (typeof request.hasOwner !== "boolean" || request.claims.length || !["inspect", "restore"].includes(request.operation)) || request.operation === "restore" && !request.releasing || request.linkedRelease !== void 0 && (request.linkedRelease !== true || request.releasing)) fail2("invalid pinned release request");
  const claimName2 = (index) => `claim-${String(index).padStart(2, "0")}.json`;
  const target = claimName2(request.claims.length);
  const ownerLinks = request.linkedRelease || request.releasing && request.hasOwner ? 2 : 1;
  const names = [...!request.releasing || request.hasOwner ? ["owner.json"] : [], ...request.claims.map((_, i) => claimName2(i)), ...request.operation === "publish" ? [target] : []].sort();
  const controls = [
    [request.releasing ? "../.install-lock-release.json" : "owner.json", request.owner, ownerLinks],
    ...request.releasing && request.hasOwner ? [["owner.json", request.owner, ownerLinks]] : [],
    ...request.linkedRelease ? [["../.install-lock-release.json", request.owner, ownerLinks]] : [],
    ...request.claims.map((c, i) => [claimName2(i), c, 1])
  ];
  const inspect = () => {
    directory();
    const dir = fs5.opendirSync(".");
    const observed = [];
    try {
      let entry;
      while (entry = dir.readSync()) {
        observed.push(entry.name);
        if (observed.length > 17) fail2("pinned recovery entry bound");
      }
    } finally {
      dir.closeSync();
    }
    if (JSON.stringify(observed.sort()) !== JSON.stringify(names)) fail2("pinned recovery entries changed");
    for (const [name, expected, links] of controls) {
      const before = stat(name, false, links);
      if (!same2(id(before), expected.file)) fail2("pinned recovery control replaced");
      const fd2 = fs5.openSync(name, fs5.constants.O_RDONLY | fs5.constants.O_NOFOLLOW | fs5.constants.O_NONBLOCK);
      try {
        if (!same2(id(safe(fs5.fstatSync(fd2, { bigint: true }), false, links)), expected.file)) fail2("pinned recovery read identity changed");
        const bytes = Buffer.alloc(4097);
        let count = 0;
        while (count < bytes.length) {
          const n = fs5.readSync(fd2, bytes, count, bytes.length - count, null);
          if (!n) break;
          count += n;
        }
        const after = stat(name, false, links);
        if (count > 4096 || BigInt(count) !== before.size || !same2(id(after), expected.file) || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.size !== after.size || createHash5("sha256").update(bytes.subarray(0, count)).digest("hex") !== expected.hash) fail2("pinned recovery control changed");
      } finally {
        fs5.closeSync(fd2);
      }
    }
    directory();
  };
  inspect();
  if (request.operation === "inspect") return { ok: true };
  if (request.operation === "restore") {
    if (request.hasOwner) fail2("release owner already restored");
    fs5.linkSync("../.install-lock-release.json", "owner.json");
    const fd2 = fs5.openSync(".", fs5.constants.O_RDONLY | fs5.constants.O_DIRECTORY | fs5.constants.O_NOFOLLOW);
    try {
      fs5.fsyncSync(fd2);
    } finally {
      fs5.closeSync(fd2);
    }
    return { ok: true, file: request.owner.file };
  }
  if (request.operation === "publish") {
    if (!identity2(request.created) || typeof request.text !== "string" || Buffer.byteLength(request.text) > 4096 || request.text !== `${JSON.stringify(JSON.parse(request.text))}
`) fail2("invalid pinned recovery publication");
    const before = stat(target);
    if (!same2(id(before), request.created) || before.size !== 0n) fail2("pinned recovery pending claim replaced");
  }
  const fd = fs5.openSync(target, fs5.constants.O_WRONLY | fs5.constants.O_NOFOLLOW | fs5.constants.O_NONBLOCK | (request.operation === "create" ? fs5.constants.O_CREAT | fs5.constants.O_EXCL : 0), 384);
  try {
    if (request.operation === "create") fs5.fchmodSync(fd, 384);
    const opened = safe(fs5.fstatSync(fd, { bigint: true }), false);
    if (opened.size !== 0n || request.operation === "publish" && !same2(id(opened), request.created)) fail2("pinned recovery write identity changed");
    directory();
    if (request.operation === "publish") fs5.writeFileSync(fd, request.text);
    fs5.fsyncSync(fd);
    if (!same2(id(stat(target)), id(opened))) fail2("pinned recovery claim replaced after write");
    const directoryFd = fs5.openSync(".", fs5.constants.O_RDONLY | fs5.constants.O_DIRECTORY | fs5.constants.O_NOFOLLOW);
    try {
      fs5.fsyncSync(directoryFd);
    } finally {
      fs5.closeSync(directoryFd);
    }
    return { ok: true, file: id(opened) };
  } finally {
    fs5.closeSync(fd);
  }
}
var childSource = `"use strict";
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
function runPinnedRecovery(target, expected, { operation = "inspect", created, text } = {}) {
  const bind = (entry) => ({ file: entry.file, hash: entry.hash });
  const input = JSON.stringify({ operation, root: expected.root, lock: expected.lock, owner: bind(expected.owner), claims: expected.claims.map(bind), ...expected.linkedRelease ? { linkedRelease: true } : {}, ...expected.owner.value?.lockBirth === void 0 ? {} : { birth: expected.owner.value.lockBirth }, ...expected.releasing ? { releasing: true, hasOwner: expected.hasOwner } : {}, ...created ? { created } : {}, ...text === void 0 ? {} : { text } });
  if (Buffer.byteLength(input) > 32768) throw Object.assign(new Error("pinned recovery request bound"), { code: "INSTALL_LOCK_RECOVERY_REQUIRED" });
  let output;
  try {
    output = childProcess.execFileSync(process.execPath, ["--input-type=commonjs", "-e", childSource], {
      cwd: target,
      input,
      encoding: "utf8",
      timeout: 2e3,
      killSignal: "SIGKILL",
      maxBuffer: 4096,
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch {
    throw Object.assign(new Error("pinned-directory recovery helper unavailable; preserve lock"), { code: "INSTALL_LOCK_UNSUPPORTED" });
  }
  let result;
  try {
    result = JSON.parse(output);
  } catch {
  }
  if (result?.ok !== true || operation !== "inspect" && (!result.file || ![result.file.dev, result.file.ino].every((s) => typeof s === "string" && /^(0|[1-9][0-9]{0,24})$/u.test(s)))) {
    throw Object.assign(new Error(result?.code === "INSTALL_LOCK_BUSY" ? "installation lock recovery busy" : "pinned recovery operation failed; preserve lock"), { code: result?.code === "INSTALL_LOCK_BUSY" ? "INSTALL_LOCK_BUSY" : "INSTALL_LOCK_RECOVERY_REQUIRED" });
  }
  return result.file;
}

// src/installation/installer-lock.mjs
var LOCK = ".install-lock";
var RELEASE = ".install-lock-release.json";
var MAX_CONTROL = 4096;
var MAX_CLAIMS = 16;
var NONCE = /^[a-f0-9]{64}$/u;
var DECIMAL = /^(0|[1-9][0-9]{0,24})$/u;
var TRANSACTION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
var hash = (text) => createHash("sha256").update(text).digest("hex");
var nonce = () => randomBytes(32).toString("hex");
var identity = (stat) => ({ dev: String(stat.dev), ino: String(stat.ino) });
var equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
var same = (a, b) => a?.dev === b?.dev && a?.ino === b?.ino;
var errorCode = (error) => error?.code;
var fail = (message, code = "INSTALL_LOCK_RECOVERY_REQUIRED") => {
  throw Object.assign(new Error(message), { code });
};
var keys = (value, names) => value && typeof value === "object" && !Array.isArray(value) && equal(Object.keys(value).sort(), [...names].sort());
var validIdentity = (value) => keys(value, ["dev", "ino"]) && typeof value.dev === "string" && DECIMAL.test(value.dev) && typeof value.ino === "string" && DECIMAL.test(value.ino);
var validProcess = (value) => keys(value, ["platform", "pid", "boot", "start", "namespace"]) && ["linux", "darwin"].includes(value.platform) && Number.isSafeInteger(value.pid) && value.pid > 0 && value.pid <= 2147483647 && typeof value.boot === "string" && (value.platform === "linux" ? /^[a-f0-9-]{36}$/u.test(value.boot) : /^[0-9]{1,12}:[0-9]{1,6}$/u.test(value.boot)) && typeof value.start === "string" && (value.platform === "linux" ? DECIMAL.test(value.start) : /^[A-Z][a-z]{2} [A-Z][a-z]{2} [ 0-9][0-9] [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9]{4}$/u.test(value.start)) && typeof value.namespace === "string" && (value.platform === "linux" ? /^pid:\[[0-9]+\]$/u.test(value.namespace) : value.namespace === "host");
var boundedText = (target, limit) => {
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const buffer = Buffer.alloc(limit + 1);
    let count = 0;
    while (count <= limit) {
      const got = fs.readSync(fd, buffer, count, buffer.length - count, null);
      if (!got) break;
      count += got;
    }
    if (count > limit) fail("process observation exceeds bound");
    return buffer.subarray(0, count).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
};
var systemCommand = (file, args, allowAbsent = false) => {
  try {
    return execFileSync(file, args, {
      encoding: "utf8",
      timeout: 1e3,
      killSignal: "SIGKILL",
      maxBuffer: MAX_CONTROL,
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C", LANG: "C", TZ: "UTC" },
      stdio: ["ignore", "pipe", "pipe"]
    }).trimEnd();
  } catch (error) {
    if (allowAbsent && error.status === 1 && !error.stdout && !error.stderr) return "";
    fail("bounded system process inspection unavailable", "INSTALL_LOCK_UNSUPPORTED");
  }
};
var bootIdentity = () => {
  if (process.platform === "linux") {
    const boot = boundedText("/proc/sys/kernel/random/boot_id", 64).trim();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(boot)) fail("invalid kernel boot identity");
    return boot;
  }
  if (process.platform === "darwin") {
    const value = systemCommand("/usr/sbin/sysctl", ["-n", "kern.boottime"]);
    const match = /^\{ sec = ([0-9]{1,12}), usec = ([0-9]{1,6}) \}/u.exec(value);
    if (!match) fail("ambiguous kernel boot identity", "INSTALL_LOCK_UNSUPPORTED");
    return `${match[1]}:${match[2]}`;
  }
  fail("installation locks require Linux or macOS", "INSTALL_LOCK_UNSUPPORTED");
};
var processSample = (pid) => {
  if (process.platform === "linux") {
    let text2;
    try {
      text2 = boundedText(`/proc/${pid}/stat`, MAX_CONTROL);
    } catch (error) {
      if (errorCode(error) === "ENOENT" || errorCode(error) === "ESRCH") return null;
      throw error;
    }
    const end = text2.lastIndexOf(") ");
    if (!text2.startsWith(`${pid} (`) || end < 0) fail("ambiguous proc stat identity");
    const fields = text2.slice(end + 2).trim().split(/\s+/u);
    if (fields.length < 20 || !DECIMAL.test(fields[19])) fail("invalid proc start ticks");
    return { start: fields[19], zombie: ["Z", "X", "x"].includes(fields[0]) };
  }
  const text = systemCommand("/bin/ps", ["-p", String(pid), "-o", "pid=", "-o", "lstart=", "-o", "stat="], true);
  if (!text) return null;
  const match = /^\s*([0-9]+)\s+([A-Z][a-z]{2} [A-Z][a-z]{2} [ 0-9][0-9] [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9]{4})\s+([A-Za-z+< >NsETWX-]+)$/u.exec(text);
  if (!match || Number(match[1]) !== pid) fail("ambiguous ps process identity");
  return { start: match[2], zombie: match[3].startsWith("Z") };
};
var liveness = (pid) => {
  try {
    process.kill(pid, 0);
    return "present";
  } catch (error) {
    return errorCode(error) === "ESRCH" ? "absent" : "uncertain";
  }
};
var namespaceIdentity = () => process.platform === "linux" ? fs.readlinkSync("/proc/self/ns/pid") : "host";
var currentProcess = () => {
  const boot = bootIdentity();
  const first = processSample(process.pid);
  const namespace = namespaceIdentity();
  const second = processSample(process.pid);
  if (!first || !equal(first, second) || first.zombie || boot !== bootIdentity() || liveness(process.pid) !== "present") fail("own process incarnation unavailable", "INSTALL_LOCK_UNSUPPORTED");
  const value = { platform: process.platform, pid: process.pid, boot, start: first.start, namespace };
  if (!validProcess(value)) fail("invalid own process incarnation", "INSTALL_LOCK_UNSUPPORTED");
  return value;
};
var incarnationState = (owner) => {
  try {
    if (!validProcess(owner) || owner.platform !== process.platform) return "uncertain";
    const own = currentProcess();
    if (own.boot !== owner.boot) return process.platform === "linux" ? "dead" : "uncertain";
    if (own.namespace !== owner.namespace) return "uncertain";
    const first = processSample(owner.pid);
    const firstLive = liveness(owner.pid);
    const second = processSample(owner.pid);
    const secondLive = liveness(owner.pid);
    if (bootIdentity() !== own.boot || !equal(first, second) || firstLive !== secondLive || firstLive === "uncertain") return "uncertain";
    if (!first) return firstLive === "absent" ? "dead" : "uncertain";
    if (firstLive !== "present") return "uncertain";
    if (first.start !== owner.start || first.zombie) return "dead";
    return "live";
  } catch {
    return "uncertain";
  }
};
var privateStat = (target, directory, links = 1) => {
  const stat = fs.lstatSync(target, { bigint: true });
  if ((directory ? !stat.isDirectory() : !stat.isFile()) || stat.isSymbolicLink() || typeof process.getuid !== "function" || stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o7777n) !== (directory ? 0o700n : 0o600n) || !directory && (stat.nlink !== BigInt(links) || stat.size > BigInt(MAX_CONTROL))) fail("unsafe installation lock identity, type, size or mode");
  return stat;
};
var rootIdentity = (base) => {
  if (typeof base !== "string" || !path.isAbsolute(base) || base === path.parse(base).root || /[\x00-\x1f\x7f]/u.test(base) || path.resolve(base) !== base || fs.realpathSync(base) !== base) fail("installation lock base must be an existing canonical private directory");
  return identity(privateStat(base, true));
};
var assertRoot = (base, root) => {
  if (!same(rootIdentity(base), root)) fail("installation root replaced");
};
var entries = (target) => {
  const dir = fs.opendirSync(target);
  const result = [];
  try {
    let entry;
    while (entry = dir.readSync()) {
      result.push(entry.name);
      if (result.length > MAX_CLAIMS + 1) fail("installation lock entry bound exceeded");
    }
  } finally {
    dir.closeSync();
  }
  return result.sort();
};
var control = (target, links = 1) => {
  const before = privateStat(target, false, links);
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    if (!same(identity(before), identity(fs.fstatSync(fd, { bigint: true })))) fail("lock control replaced before read");
    const buffer = Buffer.alloc(MAX_CONTROL + 1);
    let count = 0;
    while (count <= MAX_CONTROL) {
      const got = fs.readSync(fd, buffer, count, buffer.length - count, null);
      if (!got) break;
      count += got;
    }
    if (count > MAX_CONTROL || BigInt(count) !== before.size) fail("invalid lock control size");
    const text = buffer.subarray(0, count).toString("utf8");
    const after = privateStat(target, false, links);
    if (!same(identity(before), identity(after)) || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) fail("lock control changed during read");
    const value = JSON.parse(text);
    if (text !== `${JSON.stringify(value)}
`) fail("noncanonical lock control");
    return { value, file: identity(after), hash: hash(text) };
  } finally {
    fs.closeSync(fd);
  }
};
var binding = (record2) => ({ file: record2.file, hash: record2.hash });
var claimName = (index) => `claim-${String(index).padStart(2, "0")}.json`;
var quarantineName = (owner) => `.install-lock-quarantine-${owner.nonce}`;
var plainOwner = ({ recovered: _recovered, ...owner }) => owner;
var validPlainOwner = (value, root) => keys(value, ["schema", "kind", "root", "lock", "nonce", "process", "transactionId", ...value?.file === void 0 ? [] : ["file"], ...value?.lockBirth === void 0 ? [] : ["lockBirth"]]) && (value.file === void 0 || validIdentity(value.file)) && (value.lockBirth === void 0 || typeof value.lockBirth === "string" && DECIMAL.test(value.lockBirth) && value.lockBirth !== "0") && value.schema === 1 && value.kind === "kiro-fabric-install-lock" && validIdentity(value.root) && same(value.root, root) && validIdentity(value.lock) && typeof value.nonce === "string" && NONCE.test(value.nonce) && validProcess(value.process) && (value.transactionId === null || typeof value.transactionId === "string" && TRANSACTION.test(value.transactionId));
var validBinding = (value) => keys(value, ["file", "hash"]) && validIdentity(value.file) && typeof value.hash === "string" && NONCE.test(value.hash);
var validOwner = (value, root, lock = value?.lock) => value && validPlainOwner(plainOwner(value), root) && same(value.lock, lock) && (value.recovered === void 0 || Array.isArray(value.recovered) && value.recovered.length > 0 && value.recovered.length <= MAX_CLAIMS && value.recovered.every((r) => keys(r, r?.release === void 0 ? ["quarantine", "owner"] : ["quarantine", "owner", "release"]) && validPlainOwner(r.owner, root) && r.quarantine === quarantineName(r.owner) && (r.release === void 0 || validBinding(r.release))));
var remember = (recovered, owner, release) => {
  for (const record2 of [...owner.recovered ?? [], { quarantine: quarantineName(owner), owner: plainOwner(owner), ...release ? { release } : {} }]) {
    const previous = recovered.find((r) => r.owner.nonce === record2.owner.nonce);
    if (previous && !equal(previous, record2)) fail("conflicting lock recovery provenance");
    if (!previous) recovered.push(record2);
  }
};
var snapshot = (base, root, name = LOCK) => {
  assertRoot(base, root);
  const target = path.join(base, name);
  const lockStat = privateStat(target, true), lock = identity(lockStat);
  const names = entries(target);
  if (!names.includes("owner.json")) fail("uninitialized installation lock; preserve for recovery");
  const ownerPath = path.join(target, "owner.json");
  const linkedRelease = fs.lstatSync(ownerPath, { bigint: true }).nlink === 2n;
  const owner = control(ownerPath, linkedRelease ? 2 : 1);
  const value = owner.value;
  if (linkedRelease && (!same(value.file, owner.file) || value.lockBirth === void 0 || !equal(control(path.join(base, RELEASE), 2), owner))) fail("unproven linked release owner");
  if (!validOwner(value, root, lock) || value.file !== void 0 && !same(value.file, owner.file) || value.lockBirth !== void 0 && value.lockBirth !== String(lockStat.birthtimeNs)) fail("invalid installation lock owner binding");
  const claims = [];
  let previous = binding(owner);
  for (let index = 0; index < names.length - 1; index++) {
    const name2 = claimName(index);
    if (!names.includes(name2) || index >= MAX_CLAIMS) fail("foreign or noncontiguous lock claims");
    const claim = control(path.join(target, name2));
    const c = claim.value;
    if (!keys(c, ["schema", "kind", "nonce", "process", "owner", "previous", "index", "quarantine"]) || c.schema !== 1 || c.kind !== "kiro-fabric-lock-recovery" || !NONCE.test(c.nonce) || !validProcess(c.process) || !equal(c.owner, binding(owner)) || !equal(c.previous, previous) || c.index !== index || c.quarantine !== quarantineName(value)) fail("invalid recovery claim binding");
    claims.push(claim);
    previous = binding(claim);
  }
  const finalLock = privateStat(target, true);
  if (!same(identity(finalLock), lock) || value.lockBirth !== void 0 && String(finalLock.birthtimeNs) !== value.lockBirth || !equal(entries(target), names)) fail("installation lock changed during inspection");
  assertRoot(base, root);
  return { root, lock, owner, claims, ...linkedRelease ? { linkedRelease: true } : {} };
};
var pendingRelease = (base, root) => {
  assertRoot(base, root);
  const markerPath = path.join(base, RELEASE);
  let stat;
  try {
    stat = fs.lstatSync(markerPath, { bigint: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
  if (![1n, 2n].includes(stat.nlink)) fail("invalid release marker links");
  const links = Number(stat.nlink), owner = control(markerPath, links);
  if (!validOwner(owner.value, root) || !same(owner.value.file, owner.file) || owner.value.lockBirth === void 0) fail("invalid release marker owner binding");
  const target = path.join(base, LOCK);
  let lock, birth;
  try {
    const s = privateStat(target, true);
    lock = identity(s);
    birth = String(s.birthtimeNs);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  let directory = same(lock, owner.value.lock) && birth === owner.value.lockBirth;
  let hasOwner = false, current, claims = [];
  if (lock) {
    try {
      const candidate = snapshot(base, root);
      if (candidate.owner.value.recovered?.some((r) => equal(r.release, binding(owner)) && equal(r.owner, plainOwner(owner.value)))) {
        current = candidate;
        directory = false;
      }
    } catch {
    }
  }
  if (directory) {
    const names = entries(target);
    hasOwner = names.includes("owner.json");
    if (!hasOwner && names.length || links !== (hasOwner ? 2 : 1)) fail("release directory or owner changed");
    if (hasOwner) {
      const state = snapshot(base, root);
      if (!equal(state.owner, owner)) fail("release directory or owner changed");
      claims = state.claims;
    }
    const finalLock = privateStat(target, true);
    if (!same(identity(finalLock), lock) || String(finalLock.birthtimeNs) !== owner.value.lockBirth) fail("release directory replaced");
  } else {
    if (lock && !current) fail("release marker belongs to another lock inode");
    if (links === 2) {
      const name = quarantineName(owner.value), archived = fs.lstatSync(path.join(base, name));
      const record2 = archived.isDirectory() ? snapshot(base, root, name).owner : control(path.join(base, name), 2);
      if (!equal(record2, owner)) fail("release archive replaced");
    }
  }
  assertRoot(base, root);
  if (!equal(control(markerPath, links), owner)) fail("release marker changed");
  return { root, lock: owner.value.lock, owner, claims, releasing: true, directory, hasOwner, current, links };
};
var assertSnapshot = (base, expected) => {
  if (!equal(snapshot(base, expected.root), expected)) fail("installation lock ownership changed");
};
var inOwnedDirectory = (target, expected, action) => {
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const pinned = fs.fstatSync(fd, { bigint: true });
    if (!same(identity(pinned), expected.lock) || expected.owner.value.lockBirth !== void 0 && String(pinned.birthtimeNs) !== expected.owner.value.lockBirth) fail("recovery directory replaced before claim");
    const anchored = `${process.platform === "linux" ? "/proc/self/fd" : "/dev/fd"}/${fd}`;
    try {
      const name = expected.releasing ? `../${RELEASE}` : "owner.json";
      if (!same(identity(fs.statSync(anchored, { bigint: true })), expected.lock) || !same(identity(privateStat(`${anchored}/${name}`, false, expected.linkedRelease || expected.releasing && expected.hasOwner ? 2 : 1)), expected.owner.file)) fail("recovery directory capability changed");
    } catch {
      fail("kernel directory-FD traversal unavailable; preserve lock", "INSTALL_LOCK_UNSUPPORTED");
    }
    return action(anchored);
  } finally {
    fs.closeSync(fd);
  }
};
var syncDirectory = (target) => {
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
};
var assertPending = (base, expected) => {
  if (!equal(pendingRelease(base, expected.root), expected)) fail("installation release ownership changed");
};
var pinnedReleaseOperation = (base, expected, operation) => {
  const target = path.join(base, LOCK);
  if (process.platform === "darwin") {
    if (operation === "restore") return runPinnedRecovery(target, expected, { operation });
    runPinnedRecovery(target, expected);
    if (expected.releasing) assertPending(base, expected);
    else assertSnapshot(base, expected);
    if (operation === "release") fs.linkSync(path.join(target, "owner.json"), path.join(base, RELEASE));
    else if (operation === "remove-owner") fs.unlinkSync(path.join(target, "owner.json"));
    else if (operation !== "inspect") fail("invalid pinned release operation");
    return;
  }
  return inOwnedDirectory(target, expected, (anchored) => {
    if (expected.releasing) assertPending(base, expected);
    else assertSnapshot(base, expected);
    const owner = path.join(anchored, "owner.json"), marker = `${anchored}/../${RELEASE}`;
    if (operation === "release") fs.linkSync(owner, marker);
    else if (operation === "restore") fs.linkSync(marker, owner);
    else if (operation === "remove-owner") fs.unlinkSync(owner);
    else if (operation === "inspect") return;
    else fail("invalid pinned release operation");
  });
};
var ownedRelease = (base, initialized, onPhase) => {
  let released = false, markerRemoved = false, begun = false;
  const target = path.join(base, LOCK), marker = path.join(base, RELEASE);
  const ownProcess = () => {
    assertRoot(base, initialized.root);
    if (!equal(currentProcess(), initialized.owner.value.process)) fail("release process incarnation or namespace changed");
  };
  const ownMarker = () => {
    ownProcess();
    const state = pendingRelease(base, initialized.root);
    if (!state || state.current || !equal(state.owner, initialized.owner) || !same(state.lock, initialized.lock)) fail("release marker ownership changed");
    return state;
  };
  return () => {
    if (released) return;
    ownProcess();
    if (markerRemoved) {
      syncDirectory(base);
      released = true;
      return;
    }
    onPhase("release-before-remove");
    ownProcess();
    if (!pendingRelease(base, initialized.root)) {
      if (begun) fail("release marker disappeared");
      assertSnapshot(base, initialized);
      pinnedReleaseOperation(base, initialized, "release");
    }
    begun = true;
    let state = ownMarker();
    syncDirectory(base);
    onPhase("release-marked");
    state = ownMarker();
    if (state.hasOwner) {
      pinnedReleaseOperation(base, state, "remove-owner");
      onPhase("release-owner-removed");
    }
    state = ownMarker();
    if (state.directory) {
      onPhase("release-before-rmdir");
      state = ownMarker();
      if (!state.directory || state.hasOwner) fail("release directory changed before removal");
      fs.rmdirSync(target);
    }
    onPhase("release-directory-removed");
    state = ownMarker();
    if (state.directory || state.links !== 1) fail("release cleanup identity changed");
    syncDirectory(base);
    onPhase("release-before-marker-remove");
    assertPending(base, state);
    ownProcess();
    fs.unlinkSync(marker);
    markerRemoved = true;
    syncDirectory(base);
    released = true;
  };
};
var writeControl = (target, value, onCreated, bindSelf = false) => {
  let text = `${JSON.stringify(value)}
`;
  if (Buffer.byteLength(text) > MAX_CONTROL) fail("lock control exceeds bound");
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 384);
  let owned2;
  try {
    owned2 = identity(fs.fstatSync(fd, { bigint: true }));
    if (bindSelf) {
      value.file = owned2;
      text = `${JSON.stringify(value)}
`;
      if (Buffer.byteLength(text) > MAX_CONTROL) fail("lock control exceeds bound");
    }
    fs.fchmodSync(fd, 384);
    onCreated();
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } catch (error) {
    try {
      if (same(identity(privateStat(target, false)), owned2)) fs.unlinkSync(target);
    } catch {
    }
    throw error;
  } finally {
    fs.closeSync(fd);
  }
};
var archiveRelease = (base, initialized) => {
  assertSnapshot(base, initialized);
  if (!equal(currentProcess(), initialized.owner.value.process)) fail("release recovery namespace changed");
  let pending = pendingRelease(base, initialized.root);
  if (!pending?.current || !equal(pending.current, initialized) || incarnationState(pending.owner.value.process) !== "dead") fail("release recovery ownership changed");
  const expectedOwner = pending.owner;
  const marker = path.join(base, RELEASE), quarantine = path.join(base, quarantineName(pending.owner.value));
  if (pending.links === 1) fs.linkSync(marker, quarantine);
  pending = pendingRelease(base, initialized.root);
  if (!pending?.current || !equal(pending.current, initialized) || !equal(pending.owner, expectedOwner) || pending.links !== 2) fail("release archive ownership changed");
  assertSnapshot(base, initialized);
  if (!equal(currentProcess(), initialized.owner.value.process)) fail("release recovery namespace changed");
  fs.unlinkSync(marker);
  syncDirectory(base);
};
function acquireInstallationLock(base, { recover = false, transactionId, onPhase = () => {
} } = {}) {
  if (typeof recover !== "boolean" || typeof onPhase !== "function" || transactionId !== void 0 && (typeof transactionId !== "string" || !TRANSACTION.test(transactionId))) fail("invalid installation lock options", "INSTALL_LOCK_USAGE");
  const root = rootIdentity(base);
  const incarnation = currentProcess();
  const target = path.join(base, LOCK);
  const recovered = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    assertRoot(base, root);
    let pending = pendingRelease(base, root);
    if (pending) {
      const status = incarnationState(pending.owner.value.process);
      if (status === "live") fail("installation lock busy", "INSTALL_LOCK_BUSY");
      if (status !== "dead") fail("installation release incarnation uncertain; preserve for recovery");
      if (!recover) fail("dead installation lock requires explicit recovery");
      if (pending.directory && !pending.hasOwner) {
        const restoring = pending;
        onPhase("release-recovery-before-restore");
        assertPending(base, restoring);
        if (!equal(currentProcess(), incarnation) || incarnationState(restoring.owner.value.process) !== "dead") fail("release restoration namespace changed");
        try {
          pinnedReleaseOperation(base, pending, "restore");
        } catch (error) {
          if (errorCode(error) === "INSTALL_LOCK_UNSUPPORTED") throw Object.assign(error, { recoveryRequired: true });
          throw error;
        }
        pending = pendingRelease(base, root);
        if (!pending?.directory || !pending.hasOwner || !equal(pending.owner, restoring.owner) || !same(pending.lock, restoring.lock) || !equal(currentProcess(), incarnation) || incarnationState(restoring.owner.value.process) !== "dead") fail("release restoration changed");
        syncDirectory(target);
        assertPending(base, pending);
        syncDirectory(base);
        onPhase("release-recovery-restored");
      }
      if (!pending.directory && !pending.current) remember(recovered, pending.owner.value, binding(pending.owner));
    }
    let created = false;
    try {
      fs.mkdirSync(target, { mode: 448 });
      created = true;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
    if (created) {
      const lockStat = fs.lstatSync(target, { bigint: true }), lock = identity(lockStat);
      let initialized;
      try {
        privateStat(target, true);
        if (lockStat.birthtimeNs <= 0n) fail("stable directory birth identity unavailable", "INSTALL_LOCK_UNSUPPORTED");
        onPhase("lock-created");
        assertRoot(base, root);
        if (!same(identity(privateStat(target, true)), lock) || entries(target).length) fail("new installation lock replaced");
        const value2 = { schema: 1, kind: "kiro-fabric-install-lock", root, lock, nonce: nonce(), process: incarnation, transactionId: transactionId ?? null, lockBirth: String(lockStat.birthtimeNs), ...recovered.length ? { recovered: [...recovered] } : {} };
        writeControl(path.join(target, "owner.json"), value2, () => onPhase("owner-created"), true);
        const candidate = snapshot(base, root);
        if (!same(candidate.lock, lock) || !equal(candidate.owner.value, value2) || candidate.claims.length) fail("new installation lock ownership changed");
        initialized = candidate;
        syncDirectory(target);
        syncDirectory(base);
        onPhase("owner-initialized");
        assertSnapshot(base, initialized);
        if (pendingRelease(base, root)) {
          onPhase("release-recovery-before-archive");
          archiveRelease(base, initialized);
          onPhase("release-recovery-archived");
        }
        const release = ownedRelease(base, initialized, onPhase);
        onPhase("acquired");
        assertSnapshot(base, initialized);
        return Object.assign(release, { recovered: recovered.map(({ quarantine: quarantine2, owner }) => ({ quarantine: quarantine2, owner })), owner: value2 });
      } catch (error) {
        try {
          assertRoot(base, root);
          if (!same(identity(privateStat(target, true)), lock)) throw error;
          if (initialized) ownedRelease(base, initialized, () => {
          })();
          else if (entries(target).length === 0) fs.rmdirSync(target);
        } catch {
        }
        throw error;
      }
    }
    let stale;
    try {
      stale = snapshot(base, root);
    } catch {
      fail("installation lock is uninitialized, changed or foreign; preserve for recovery");
    }
    const records = [stale.owner, ...stale.claims];
    const states = records.map((record2) => incarnationState(record2.value.process));
    if (states.includes("live")) fail("installation lock busy", "INSTALL_LOCK_BUSY");
    if (states.includes("uncertain")) fail("installation lock incarnation uncertain; preserve for recovery");
    if (!recover) fail("dead installation lock requires explicit recovery");
    if (stale.claims.length >= MAX_CLAIMS) fail("recovery claim capacity reached; preserve for recovery");
    const index = stale.claims.length;
    const value = {
      schema: 1,
      kind: "kiro-fabric-lock-recovery",
      nonce: nonce(),
      process: incarnation,
      owner: binding(stale.owner),
      previous: binding(records[records.length - 1]),
      index,
      quarantine: quarantineName(stale.owner.value)
    };
    assertSnapshot(base, stale);
    try {
      if (process.platform === "darwin") {
        onPhase("recovery-before-claim");
        const created2 = runPinnedRecovery(target, stale, { operation: "create" });
        onPhase("recovery-claim-created");
        runPinnedRecovery(target, stale, { operation: "publish", created: created2, text: `${JSON.stringify(value)}
` });
      } else {
        inOwnedDirectory(target, stale, (anchored) => {
          onPhase("recovery-before-claim");
          writeControl(path.join(anchored, claimName(index)), value, () => onPhase("recovery-claim-created"));
        });
      }
    } catch (error) {
      if (errorCode(error) === "EEXIST") fail("installation lock recovery busy", "INSTALL_LOCK_BUSY");
      if (errorCode(error) === "INSTALL_LOCK_UNSUPPORTED") throw Object.assign(error, { recoveryRequired: true });
      throw error;
    }
    const claimed = snapshot(base, root);
    if (!equal(claimed.owner, stale.owner) || !same(claimed.lock, stale.lock) || claimed.claims.length !== index + 1 || !equal(claimed.claims[index].value, value) || !equal(claimed.claims.slice(0, index), stale.claims)) fail("recovery claim ownership changed");
    syncDirectory(target);
    onPhase("recovery-claim-initialized");
    onPhase("recovery-before-quarantine");
    assertSnapshot(base, claimed);
    if (records.some((record2) => incarnationState(record2.value.process) !== "dead")) fail("stale incarnation evidence changed");
    const quarantine = path.join(base, value.quarantine);
    try {
      fs.lstatSync(quarantine);
      fail("recovery quarantine already exists; preserve both identities");
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    assertSnapshot(base, claimed);
    fs.renameSync(target, quarantine);
    syncDirectory(base);
    remember(recovered, stale.owner.value, stale.linkedRelease ? binding(stale.owner) : void 0);
    onPhase("recovery-quarantined");
  }
  fail("installation lock contention bound reached", "INSTALL_LOCK_BUSY");
}

// src/kiro/managed-generation.ts
import fs3 from "node:fs";
import path4 from "node:path";
import { createHash as createHash3 } from "node:crypto";

// src/installation/bundle-contract.mjs
import { createHash as createHash2 } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

// src/installation/filesystem-boundary.mjs
import fs2 from "node:fs";
import { opendir } from "node:fs/promises";
import path2 from "node:path";
function trustedMacApplications(directory, stat, platform = process.platform) {
  return platform === "darwin" && directory === "/Applications" && stat.uid === 0 && stat.gid === 80 && (stat.mode & 4095) === 509;
}
function trustedDirectoryStat(directory, stat, { platform = process.platform, uid = process.getuid?.() } = {}) {
  const sticky = stat.uid === 0 && (stat.mode & 512) !== 0;
  return stat.isDirectory() && !stat.isSymbolicLink() && (uid === void 0 || stat.uid === uid || stat.uid === 0) && (platform === "win32" || (stat.mode & 18) === 0 || sticky || trustedMacApplications(directory, stat, platform));
}
function captureDirectoryAncestry(target, options = {}) {
  const { label = "Unsafe directory ancestry", platform = process.platform, allowMacAliases = false } = options;
  const absolute = path2.resolve(target);
  const snapshot2 = (root2, aliases) => {
    let current = path2.parse(root2).root;
    const paths = [current];
    for (const part of root2.slice(current.length).split(path2.sep).filter(Boolean)) {
      current = path2.join(current, part);
      paths.push(current);
    }
    return paths.map((directory) => {
      let stat = fs2.lstatSync(directory);
      if (aliases && platform === "darwin" && ["/etc", "/tmp", "/var"].includes(directory) && stat.isSymbolicLink() && stat.uid === 0 && fs2.realpathSync(directory) === "/private" + directory) stat = fs2.statSync(directory);
      if (!trustedDirectoryStat(directory, stat, options)) throw Error(label + ": " + JSON.stringify(directory));
      return { directory, stat };
    });
  };
  snapshot2(absolute, allowMacAliases);
  const root = fs2.realpathSync(absolute), entries2 = snapshot2(root, false);
  const check = () => {
    for (const { directory, stat } of entries2) {
      const now = fs2.lstatSync(directory);
      if (!trustedDirectoryStat(directory, now, options) || now.dev !== stat.dev || now.ino !== stat.ino || now.mode !== stat.mode || now.uid !== stat.uid || now.gid !== stat.gid) throw Error(label + " changed: " + JSON.stringify(directory));
    }
    if (fs2.realpathSync(root) !== root) throw Error(label + " changed canonical root");
  };
  check();
  return { root, check };
}
async function readDirectoryBounded(directory, limit) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw Error("Directory entry bound");
  const handle = await opendir(directory, { bufferSize: 32 }), names = [];
  try {
    for (; ; ) {
      const entry = await handle.read();
      if (!entry) break;
      if (names.length >= limit) throw Error("Directory entry bound");
      names.push(entry.name);
    }
  } finally {
    await handle.close();
  }
  return names;
}

// src/installation/bundle-contract.mjs
import path3 from "node:path";
var PRODUCT = "kiro-fabric";
var TARGETS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
var LIMITS = Object.freeze({ entries: 4096, file: 160 * 1024 * 1024, bytes: 384 * 1024 * 1024, archive: 192 * 1024 * 1024, manifest: 2 * 1024 * 1024 });
var sha256 = (bytes) => createHash2("sha256").update(bytes).digest("hex");
var byteOrder = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && Object.getPrototypeOf(value) === Object.prototype) return "{" + Object.keys(value).sort(byteOrder).map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  throw Error("Noncanonical metadata");
}
function exactFields(value, keys2) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || canonical(Object.keys(value).sort()) !== canonical([...keys2].sort())) throw Error("Invalid schema fields: " + keys2.join(","));
}
var isHash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var isStable = (v) => typeof v === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v) && v.split(".").every((n) => Number.isSafeInteger(Number(n)));
function safePath(p) {
  if (typeof p !== "string" || Buffer.byteLength(p) > 240 || p !== p.normalize("NFC") || /[\\:\x00-\x1f\x7f]/.test(p) || p.split("/").some((s) => !s || s === "." || s === ".." || /[. ]$/.test(s))) throw Error("Unsafe bundle path");
  return p;
}
function roleFor(p) {
  safePath(p);
  if (p === "tools/node" || p === "tools/rg") return "executable";
  if (p === "manager/install-manager.mjs") return "manager";
  if (p.startsWith("app/")) return "app";
  if (p === "resources/steering/fabric.md" || p === "resources/skills/fabric-exec/SKILL.md" || p.startsWith("resources/skills/fabric-exec/references/")) return "resource";
  if (p.startsWith("notices/")) return "notice";
  throw Error("Unknown bundle entry: " + p);
}
var REQUIRED_APP = ["app/kiro/mcp-entry.js", "app/runtime/compiler-worker-entry.js", "app/package.json", "app/closure-manifest.json"];
function compatibilityFor(target) {
  if (!TARGETS.includes(target)) throw Error("Unsupported target");
  const linux = target.startsWith("linux-");
  return { minNode: "24.20.0", minKiro: "2.21.1", minGlibc: linux ? "2.28" : null, minKernel: linux ? "4.18" : null, minMacOS: linux ? null : "13.5", libc: linux ? "glibc" : "system" };
}
function checkCompatibility(value, target) {
  exactFields(value, ["minNode", "minKiro", "minGlibc", "minKernel", "minMacOS", "libc"]);
  if (canonical(value) !== canonical(compatibilityFor(target))) throw Error("Compatibility mismatch");
}
function checkProvenance(p) {
  if (p?.kind === "local-source") {
    exactFields(p, ["kind", "sourceDigest", "gitHead", "dirty"]);
    if (!isHash(p.sourceDigest) || p.gitHead !== null && (typeof p.gitHead !== "string" || !/^[a-f0-9]{40}$/.test(p.gitHead)) || typeof p.dirty !== "boolean") throw Error("Invalid source provenance");
  } else if (p?.kind === "release") {
    exactFields(p, ["kind", "sourceCommit"]);
    if (typeof p.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(p.sourceCommit)) throw Error("Invalid release provenance");
  } else throw Error("Invalid provenance kind");
}
function pinURL(url, hosts) {
  if (typeof url !== "string") throw Error("Invalid pin URL");
  const u = new URL(url);
  if (u.protocol !== "https:" || !hosts.includes(u.hostname) || u.port || u.username || u.password || u.hash || u.search) throw Error("Unapproved pin URL");
}
function checkToolPins(tools, inventory, target) {
  exactFields(tools, ["node", "rg"]);
  const destinations = /* @__PURE__ */ new Set();
  let total = 0;
  for (const tool of ["node", "rg"]) {
    const pin = tools[tool];
    exactFields(pin, ["version", "url", "size", "sha256", "checksumUrl", "members"]);
    const required = tool === "node" ? ["tools/node", "notices/node-LICENSE"] : ["tools/rg", "notices/rg-LICENSE-MIT", "notices/rg-COPYING", "notices/rg-UNLICENSE"];
    if (!Array.isArray(pin.members) || pin.members.length !== required.length) throw Error("Tool members");
    if (pin.version !== (tool === "node" ? "24.20.0" : "14.1.1") || !isHash(pin.sha256) || !Number.isSafeInteger(pin.size) || pin.size < 1 || pin.size > LIMITS.archive) throw Error("Invalid tool pin");
    const hosts = tool === "node" ? ["nodejs.org"] : ["github.com"];
    pinURL(pin.url, hosts);
    pinURL(pin.checksumUrl, hosts);
    const base = tool === "node" ? "https://nodejs.org/dist/v24.20.0/" : "https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/";
    if (typeof target === "string") {
      if (!TARGETS.includes(target)) throw Error("Unsupported tool target");
      const triples = { "darwin-arm64": "aarch64-apple-darwin", "darwin-x64": "x86_64-apple-darwin", "linux-arm64": "aarch64-unknown-linux-gnu", "linux-x64": "x86_64-unknown-linux-musl" };
      const name = tool === "node" ? "node-v24.20.0-" + target : "ripgrep-14.1.1-" + triples[
        /** @type {keyof typeof triples} */
        target
      ];
      if (pin.url !== base + name + ".tar.gz") throw Error("Tool target URL mismatch");
      for (const m of pin.members || []) {
        const suffix = m.path === "tools/node" ? "bin/node" : m.path === "tools/rg" ? "rg" : typeof m.path === "string" ? m.path.replace("notices/" + tool + "-", "") : "";
        if (m.member !== name + "/" + suffix) throw Error("Tool target member mismatch");
      }
    }
    if (!pin.url.startsWith(base) || !pin.url.endsWith(".tar.gz") || pin.checksumUrl !== (tool === "node" ? base + "SHASUMS256.txt" : pin.url + ".sha256")) throw Error("Tool pin upstream mismatch");
    const members = /* @__PURE__ */ new Set();
    for (const m of pin.members) {
      exactFields(m, ["member", "path", "size", "sha256"]);
      safePath(m.member);
      safePath(m.path);
      if (!/^[A-Za-z0-9._/-]+$/.test(m.member) || !required.includes(m.path) || destinations.has(m.path) || members.has(m.member) || !Number.isSafeInteger(m.size) || m.size < 1 || m.size > LIMITS.file || !isHash(m.sha256)) throw Error("Invalid tool member");
      total += m.size;
      if (total > LIMITS.bytes) throw Error("Tool closure byte bound");
      destinations.add(m.path);
      members.add(m.member);
      if (inventory) {
        const e = inventory.find((e2) => e2.path === m.path);
        if (!e || e.size !== m.size || e.sha256 !== m.sha256) throw Error("Tool inventory mismatch: " + m.path);
      }
    }
  }
}
function checkInventory(inventory) {
  if (!Array.isArray(inventory) || inventory.length > LIMITS.entries) throw Error("Inventory bound");
  const seen = /* @__PURE__ */ new Set();
  const aliases = /* @__PURE__ */ new Map();
  let bytes = 0;
  let previous = "";
  for (const e of inventory) {
    exactFields(e, ["mode", "path", "role", "sha256", "size", "type"]);
    const role = roleFor(e.path);
    const key = e.path.toLowerCase();
    if (seen.has(key) || previous && byteOrder(previous, e.path) >= 0) throw Error("Inventory collision/order");
    const segments = e.path.split("/");
    for (let i = 1; i <= segments.length; i++) {
      const part = segments.slice(0, i).join("/"), fold = part.toLowerCase();
      if (i < segments.length && seen.has(fold)) throw Error("Path collision");
      if (aliases.has(fold) && aliases.get(fold) !== part) throw Error("Case directory collision");
      aliases.set(fold, part);
    }
    seen.add(key);
    previous = e.path;
    if (e.role !== role || e.type !== "file" || e.mode !== (role === "executable" ? 448 : 384) || !Number.isSafeInteger(e.size) || e.size < 0 || e.size > LIMITS.file || !isHash(e.sha256)) throw Error("Invalid inventory entry");
    bytes += e.size;
  }
  if (bytes > LIMITS.bytes) throw Error("Bundle byte bound");
  for (const p of [...REQUIRED_APP, "tools/node", "tools/rg", "manager/install-manager.mjs", "resources/steering/fabric.md", "resources/skills/fabric-exec/SKILL.md", "notices/node-LICENSE", "notices/rg-LICENSE-MIT", "notices/rg-COPYING", "notices/rg-UNLICENSE"]) if (!inventory.some((e) => e.path === p && e.size > 0)) throw Error("Missing required entry: " + p);
  if (!inventory.some((e) => e.path.startsWith("resources/skills/fabric-exec/references/"))) throw Error("Missing resource closure");
  return bytes;
}
function manifestDigest(payload) {
  return sha256("kiro-fabric.bundle.v1\0" + canonical(payload));
}
function checkManifest(m) {
  exactFields(m, ["compatibility", "digest", "inventory", "product", "provenance", "schema", "target", "tools", "version"]);
  if (m.schema !== 1 || m.product !== PRODUCT || !TARGETS.includes(m.target) || !isStable(m.version)) throw Error("Manifest identity");
  checkCompatibility(m.compatibility, m.target);
  checkProvenance(m.provenance);
  const bytes = checkInventory(m.inventory);
  checkToolPins(m.tools, m.inventory, m.target);
  const { digest, ...payload } = m;
  if (!isHash(digest) || digest !== manifestDigest(payload)) throw Error("Manifest digest mismatch");
  return bytes;
}
function owned(s) {
  if (typeof process.getuid !== "function" || s.uid !== process.getuid()) throw Error("File ownership mismatch");
}
var sameFile = (a, b) => b.isFile() && b.nlink === 1 && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mode === b.mode && a.uid === b.uid && a.gid === b.gid && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
async function captureRegular(file, max, consume, { mode } = {}) {
  if (!Number.isSafeInteger(max) || max < 0 || mode !== void 0 && (!Number.isInteger(mode) || mode < 0 || mode > 4095)) throw Error("Invalid capture bound/mode");
  const before = await lstat(file);
  owned(before);
  if (!before.isFile() || before.nlink !== 1 || before.size > max) throw Error("Unsafe or oversized file: " + file);
  if (mode !== void 0 && (before.mode & 4095) !== mode) throw Error("File mode/type");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await handle.stat();
    owned(s);
    if (!sameFile(before, s) || s.size > max || mode !== void 0 && (s.mode & 4095) !== mode) throw Error("File changed");
    const { value, length } = await consume(handle, s.size);
    const after = await handle.stat(), named = await lstat(file);
    if (length !== s.size || !sameFile(s, after) || !sameFile(s, named)) throw Error("File changed");
    return value;
  } finally {
    await handle.close();
  }
}
async function readRegular(file, max, options = {}) {
  return captureRegular(file, max, async (handle, size) => {
    const buffer = Buffer.alloc(size + 1);
    let length = 0;
    while (length < buffer.length) {
      const r = await handle.read(buffer, length, buffer.length - length, null);
      if (!r.bytesRead) break;
      length += r.bytesRead;
    }
    return { value: buffer.subarray(0, length), length };
  }, options);
}
async function hashRegular(file, max, options = {}) {
  return captureRegular(file, max, async (handle, size) => {
    const buffer = Buffer.alloc(Math.min(size + 1, 64 * 1024)), hash2 = createHash2("sha256");
    let length = 0;
    while (length <= size) {
      const r = await handle.read(buffer, 0, Math.min(buffer.length, size + 1 - length), null);
      if (!r.bytesRead) break;
      length += r.bytesRead;
      hash2.update(buffer.subarray(0, r.bytesRead));
    }
    return { value: { size: length, sha256: hash2.digest("hex") }, length };
  }, options);
}
async function checkRoot(root) {
  const guard = captureDirectoryAncestry(root, { label: "Unsafe root component" });
  const s = await lstat(guard.root);
  owned(s);
  if ((s.mode & 4095) !== 448) throw Error("Unsafe bundle root mode");
  guard.check();
  return guard;
}
async function scan(root) {
  const inventory = [];
  const aliases = /* @__PURE__ */ new Set(), directories = [];
  let count = 0, total = 0;
  const pending = [""];
  while (pending.length) {
    const rel = (
      /** @type {string} */
      pending.pop()
    ), directory = path3.join(root, rel), guard = captureDirectoryAncestry(directory, { label: "Directory changed" });
    const names = await readDirectoryBounded(directory, LIMITS.entries * 2 - count);
    count += names.length;
    guard.check();
    for (const name of names.sort(byteOrder)) {
      const p = rel ? rel + "/" + name : name;
      safePath(p);
      const key = p.toLowerCase();
      if (aliases.has(key)) throw Error("Case collision");
      aliases.add(key);
      const s = await lstat(path3.join(root, p));
      owned(s);
      if (s.isDirectory()) {
        if ((s.mode & 4095) !== 448) throw Error("Directory mode");
        pending.push(p);
        directories.push(p);
      } else {
        const role = p === "bundle-manifest.json" ? "manifest" : roleFor(p), mode = role === "executable" ? 448 : 384;
        if (!s.isFile() || s.nlink !== 1 || (s.mode & 4095) !== mode) throw Error("File mode/type");
        if (p === "bundle-manifest.json") {
          await hashRegular(path3.join(root, p), LIMITS.manifest, { mode });
          continue;
        }
        const digest = await hashRegular(path3.join(root, p), Math.min(LIMITS.file, LIMITS.bytes - total), { mode });
        total += digest.size;
        if (total > LIMITS.bytes) throw Error("Bundle byte bound");
        inventory.push({ path: p, role, type: "file", mode, ...digest });
      }
      guard.check();
    }
    guard.check();
  }
  for (const p of directories) if (!inventory.some((e) => e.path.startsWith(p + "/"))) throw Error("Empty/unknown directory");
  return inventory.sort((a, b) => byteOrder(a.path, b.path));
}
async function createBundleManifest(root, { version, target, compatibility, provenance, tools }) {
  const guard = await checkRoot(root);
  root = guard.root;
  const payload = { schema: 1, product: PRODUCT, version, target, compatibility, provenance, tools, inventory: await scan(root) };
  guard.check();
  const manifest = { ...payload, digest: manifestDigest(payload) };
  checkManifest(manifest);
  return manifest;
}
async function validateBundle(root) {
  const guard = await checkRoot(root);
  root = guard.root;
  const raw = await readRegular(path3.join(root, "bundle-manifest.json"), LIMITS.manifest, { mode: 384 }), manifest = JSON.parse(raw.toString("utf8"));
  if (!raw.equals(Buffer.from(canonical(manifest) + "\n"))) throw Error("Noncanonical manifest bytes");
  const bytes = checkManifest(manifest), actual = await createBundleManifest(root, manifest);
  if (canonical(actual) !== canonical(manifest)) throw Error("Bundle inventory mismatch");
  guard.check();
  return { root, digest: manifest.digest, manifest, version: manifest.version, inventory: manifest.inventory, bytes };
}

// src/kiro/managed-generation.ts
var digestPattern = /^[a-f0-9]{64}$/u;
function inferManagedGeneration(runtimeRoot, env) {
  const parent = path4.dirname(runtimeRoot);
  const completeLayout = path4.basename(runtimeRoot) === "app" && (fs3.existsSync(path4.join(parent, "bundle-manifest.json")) || digestPattern.test(path4.basename(parent)) && path4.basename(path4.dirname(parent)) === "runtime" && path4.basename(path4.dirname(path4.dirname(parent))) === "kiro-fabric");
  if (!completeLayout && env.KIRO_FABRIC_BUNDLE_ROOT === void 0 && env.KIRO_FABRIC_RG === void 0) return void 0;
  const bundleRoot = env.KIRO_FABRIC_BUNDLE_ROOT ?? parent;
  if (!path4.isAbsolute(bundleRoot) || fs3.realpathSync(bundleRoot) !== bundleRoot || runtimeRoot !== path4.join(bundleRoot, "app")) throw new Error("managed generation runtime containment mismatch");
  const expectedNode = path4.join(bundleRoot, "tools", "node");
  const rg = path4.join(bundleRoot, "tools", "rg");
  if (env.KIRO_FABRIC_EXPECTED_NODE !== void 0 && env.KIRO_FABRIC_EXPECTED_NODE !== expectedNode || env.KIRO_FABRIC_RG !== void 0 && env.KIRO_FABRIC_RG !== rg) throw new Error("managed generation executable environment mismatch");
  return { bundleRoot, expectedNode, rg };
}
function managedInstallationBase(bundleRoot) {
  const runtimes = path4.dirname(bundleRoot);
  const base = path4.dirname(runtimes);
  return digestPattern.test(path4.basename(bundleRoot)) && path4.basename(runtimes) === "runtime" && path4.basename(base) === "kiro-fabric" ? base : void 0;
}
var hashBytes = (bytes) => createHash3("sha256").update(bytes).digest("hex");
var record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function readControl(file) {
  const stat = fs3.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024 || (stat.mode & 4095) !== 384 || process.getuid && stat.uid !== process.getuid() || fs3.realpathSync(file) !== file) throw new Error("unsafe managed installation control");
  return fs3.readFileSync(file);
}
function validateManagedAdmission(bundleRoot, dataRoot, manifestSha256) {
  const base = managedInstallationBase(bundleRoot);
  if (!base) return;
  if (dataRoot !== path4.join(base, "data")) throw new Error("installed managed data binding mismatch");
  const ownerBytes = readControl(path4.join(base, "install-owner.json"));
  const owner = JSON.parse(ownerBytes.toString("utf8"));
  const fields = ["owner", "schemaVersion", "status", "installationId", "kiroHome", "dataRoot", "currentRuntime", "previousRuntime", "runtimeGenerations", "profileSha256", "launcherSha256", "releaseStateSha256", "transactionId"];
  const nullableHash = (value) => value === null || typeof value === "string" && digestPattern.test(value);
  if (!record(owner) || fields.some((key) => !Object.hasOwn(owner, key)) || Object.keys(owner).some((key) => !fields.includes(key) && key !== "legacy") || owner.owner !== "kiro-fabric-agent-user-install" || owner.schemaVersion !== 3 || !["active", "retired"].includes(String(owner.status)) || typeof owner.installationId !== "string" || !owner.installationId || owner.installationId.length > 200 || /[\x00-\x1f\x7f]/u.test(owner.installationId) || owner.kiroHome !== path4.dirname(base) || owner.dataRoot !== dataRoot || typeof owner.currentRuntime !== "string" || !digestPattern.test(owner.currentRuntime) || !nullableHash(owner.previousRuntime) || !nullableHash(owner.profileSha256) || typeof owner.launcherSha256 !== "string" || !digestPattern.test(owner.launcherSha256) || !nullableHash(owner.releaseStateSha256) || typeof owner.transactionId !== "string" || !/^[a-f0-9]{32}$/u.test(owner.transactionId) || !Array.isArray(owner.runtimeGenerations) || !owner.runtimeGenerations.length || owner.runtimeGenerations.length > 256) throw new Error("invalid managed installation ownership");
  const names = /* @__PURE__ */ new Set();
  for (const generation of owner.runtimeGenerations) {
    if (!record(generation) || Object.keys(generation).sort().join(",") !== "manifestSha256,name" || typeof generation.name !== "string" || !digestPattern.test(generation.name) || names.has(generation.name) || typeof generation.manifestSha256 !== "string" || !digestPattern.test(generation.manifestSha256)) throw new Error("invalid retained generation ownership");
    names.add(generation.name);
  }
  if (!names.has(owner.currentRuntime) || owner.previousRuntime !== null && !names.has(String(owner.previousRuntime))) throw new Error("invalid current/previous generation ownership");
  if (owner.status !== "active") throw new Error("managed installation is retired; install before starting");
  if (!owner.runtimeGenerations.some((generation) => generation.name === path4.basename(bundleRoot) && generation.manifestSha256 === manifestSha256)) throw new Error("managed generation is not verified retained ownership");
  const journalPath = path4.join(base, ".transactions", "active.json");
  let journalBytes;
  try {
    journalBytes = readControl(journalPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (journalBytes) {
    const journal = JSON.parse(journalBytes.toString("utf8"));
    if (!record(journal) || journal.schemaVersion !== 1 || journal.transactionId !== owner.transactionId || !nullableHash(journal.beforeOwnerSha256) || typeof journal.afterOwnerSha256 !== "string" || !digestPattern.test(journal.afterOwnerSha256) || journal.afterOwnerSha256 !== hashBytes(ownerBytes)) throw new Error("managed installation requires transaction recovery before startup");
  }
  if (owner.releaseStateSha256 !== null && hashBytes(readControl(path4.join(base, "release-state.json"))) !== owner.releaseStateSha256) throw new Error("managed release state identity mismatch");
}
async function validateManagedGeneration(context, dataRoot) {
  if (context.expectedNode !== path4.join(context.bundleRoot, "tools", "node")) throw new Error("managed generation containment mismatch");
  const beforeNode = fs3.lstatSync(context.expectedNode, { bigint: true });
  const bundle = await validateBundle(context.bundleRoot);
  if (bundle.root !== context.bundleRoot || context.expectedNode !== path4.join(bundle.root, "tools", "node") || context.rg !== path4.join(bundle.root, "tools", "rg")) throw new Error("managed generation containment mismatch");
  const base = managedInstallationBase(bundle.root);
  if (base && (path4.basename(bundle.root) !== bundle.digest || dataRoot !== path4.join(base, "data"))) throw new Error("installed managed generation data binding mismatch");
  const relative = path4.relative(bundle.root, dataRoot);
  if (!relative || !relative.startsWith(`..${path4.sep}`) && relative !== ".." && !path4.isAbsolute(relative) || bundle.root.startsWith(dataRoot + path4.sep)) throw new Error("managed bundle and data roots overlap");
  const tools = bundle.manifest.tools;
  if (typeof tools.node?.version !== "string" || typeof tools.rg?.version !== "string" || !/^\d+\.\d+\.\d+$/u.test(tools.node.version) || !/^\d+\.\d+\.\d+$/u.test(tools.rg.version)) throw new Error("managed tool version identity missing");
  const node = bundle.inventory.find((entry) => entry.path === "tools/node");
  const rg = bundle.inventory.find((entry) => entry.path === "tools/rg");
  const stat = fs3.lstatSync(context.expectedNode, { bigint: true });
  const unchanged = ["dev", "ino", "size", "mode", "uid", "gid", "nlink", "mtimeNs", "ctimeNs"].every((key) => beforeNode[key] === stat[key]);
  if (!node || !rg || !unchanged || fs3.realpathSync(process.execPath) !== context.expectedNode || fs3.realpathSync(context.expectedNode) !== context.expectedNode || !stat.isFile() || stat.nlink !== 1n || (stat.mode & 0o7777n) !== 0o700n || process.getuid && stat.uid !== BigInt(process.getuid()) || stat.size !== BigInt(node.size) || process.version !== `v${tools.node.version}`) throw new Error("managed Node executable identity mismatch");
  const managedSearch = { generationRoot: bundle.root, path: context.rg, sha256: rg.sha256, mode: 448, version: `ripgrep ${tools.rg.version}` };
  resolveSearchExecutable(managedSearch);
  return managedSearch;
}

// src/kiro/mcp-entry.ts
import { fileURLToPath } from "node:url";

// src/kiro/power/agent-launch-context.ts
import fs4 from "node:fs";
import path5 from "node:path";
var canonicalDirectory = (value, name) => {
  if (!value) throw new Error(`Agent launch is missing ${name}`);
  if (!path5.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  try {
    const inspected = inspectCanonicalPath(value, {
      kind: "directory",
      rejectFinalSymlink: true
    });
    const stats = fs4.lstatSync(inspected.canonicalPath);
    if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
      throw new Error("directory is not owned by the current user");
    }
    if (process.platform !== "win32" && (stats.mode & 18) !== 0) {
      throw new Error("directory is group/other writable");
    }
    return inspected.canonicalPath;
  } catch (error) {
    throw new Error(`${name} must be an existing directory: ${error.message}`);
  }
};
var resolveKiroAgentLaunchContext = (env = process.env, launchDirectory = () => process.cwd()) => {
  const runtimeRoot = canonicalDirectory(env.KIRO_FABRIC_RUNTIME_ROOT, "KIRO_FABRIC_RUNTIME_ROOT");
  const dataRoot = canonicalDirectory(env.KIRO_FABRIC_DATA_ROOT, "KIRO_FABRIC_DATA_ROOT");
  if (runtimeRoot === dataRoot) throw new Error("runtime and data roots must be different directories");
  if (canonicalPathContains(runtimeRoot, dataRoot) || canonicalPathContains(dataRoot, runtimeRoot)) {
    throw new Error("runtime and data roots must not contain one another");
  }
  const managedGeneration = inferManagedGeneration(runtimeRoot, env);
  const source = env.KIRO_FABRIC_WORKSPACE_SOURCE;
  if (source !== void 0 && source !== "launch-cwd") {
    throw new Error("KIRO_FABRIC_WORKSPACE_SOURCE must be launch-cwd when set");
  }
  const handoff = env.KIRO_FABRIC_LAUNCH_WORKSPACE;
  const explicit = handoff !== void 0 && handoff !== "${KIRO_FABRIC_LAUNCH_WORKSPACE}";
  const launchWorkspaceRoot = explicit ? canonicalDirectory(handoff, "KIRO_FABRIC_LAUNCH_WORKSPACE") : source === "launch-cwd" ? canonicalDirectory(launchDirectory(), "MCP launch directory") : void 0;
  return { runtimeRoot, dataRoot, ...managedGeneration ? { managedGeneration } : {}, ...launchWorkspaceRoot ? { launchWorkspaceRoot } : {} };
};

// src/kiro/mcp-entry.ts
var PROCESS_SHUTDOWN_TIMEOUT_MS = 8e3;
var PARENT_LIVENESS_INTERVAL_MS = 1e3;
var processServerTask;
var boundedError = (error) => (error instanceof Error ? error.message : String(error)).replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 800) || "unknown failure";
var startKiroMcpServer = () => processServerTask ??= (async () => {
  const launch = resolveKiroAgentLaunchContext();
  const base = launch.managedGeneration ? managedInstallationBase(launch.managedGeneration.bundleRoot) : void 0;
  const release = base ? acquireInstallationLock(base, { recover: false }) : void 0;
  let server;
  try {
    try {
      const managedSearch = launch.managedGeneration ? await validateManagedGeneration(launch.managedGeneration, launch.dataRoot) : void 0;
      if (launch.managedGeneration && base) {
        const manifestHash = createHash4("sha256").update(readFileSync(path6.join(launch.managedGeneration.bundleRoot, "bundle-manifest.json"))).digest("hex");
        validateManagedAdmission(launch.managedGeneration.bundleRoot, launch.dataRoot, manifestHash);
      }
      const { createKiroMcpServer } = await import("../chunks/mcp-server-7G75YVDV.js");
      server = await createKiroMcpServer({ runtimeRoot: launch.runtimeRoot, dataRoot: launch.dataRoot, ...launch.launchWorkspaceRoot ? { launchWorkspaceRoot: launch.launchWorkspaceRoot } : {}, ...managedSearch ? { managedSearch } : {} });
    } finally {
      release?.();
    }
    return server;
  } catch (error) {
    await server?.close();
    throw error;
  }
})();
var processIsAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
var runKiroMcpProcess = async () => {
  let server;
  try {
    server = await startKiroMcpServer();
  } catch (error) {
    process.stderr.write(`kiro-fabric Agent MCP failed to start: ${boundedError(error)}
`);
    return 1;
  }
  return new Promise((resolve) => {
    let closing = false;
    const initialParentPid = process.ppid;
    let parentTimer;
    const cleanup = () => {
      process.removeListener("SIGHUP", onSighup);
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      process.stdin.removeListener("end", onEnd);
      process.stdin.removeListener("close", onStdinClose);
      process.stdin.removeListener("error", onStdinError);
      if (parentTimer) clearInterval(parentTimer);
    };
    const finish = (code) => {
      cleanup();
      resolve(code);
    };
    const close = (code) => {
      if (closing) return;
      closing = true;
      let timer;
      const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`shutdown exceeded ${PROCESS_SHUTDOWN_TIMEOUT_MS}ms`)),
          PROCESS_SHUTDOWN_TIMEOUT_MS
        );
      });
      void Promise.race([server.close(), timeout]).then(
        () => finish(code),
        (error) => {
          process.stderr.write(`kiro-fabric Agent MCP shutdown failed: ${boundedError(error)}
`);
          finish(1);
        }
      ).finally(() => {
        if (timer) clearTimeout(timer);
      });
    };
    const onSighup = () => close(129);
    const onSigint = () => close(130);
    const onSigterm = () => close(143);
    const onEnd = () => close(0);
    const onStdinClose = () => close(process.stdin.readableEnded ? 0 : 1);
    const onStdinError = (error) => {
      process.stderr.write(`kiro-fabric Agent MCP stdin failed: ${boundedError(error)}
`);
      close(1);
    };
    const checkParent = () => {
      if (process.ppid !== initialParentPid || !processIsAlive(initialParentPid)) close(1);
    };
    process.once("SIGHUP", onSighup);
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    process.stdin.once("end", onEnd);
    process.stdin.once("close", onStdinClose);
    process.stdin.once("error", onStdinError);
    parentTimer = setInterval(checkParent, PARENT_LIVENESS_INTERVAL_MS);
    parentTimer.unref();
    if (process.stdin.readableEnded) queueMicrotask(onEnd);
    else if (process.stdin.destroyed) queueMicrotask(onStdinClose);
    queueMicrotask(checkParent);
  });
};
var invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
var self = realpathSync(fileURLToPath(import.meta.url));
if (invoked === self) {
  if (process.argv[2] === "--first-prompt-hook") {
    const { runFirstPromptHook } = await import("../chunks/first-prompt-hook-ZJXFYYL6.js");
    process.exit(await runFirstPromptHook(process.argv.length === 4 ? process.argv[3] : void 0));
  }
  process.exit(await runKiroMcpProcess());
}
export {
  runKiroMcpProcess,
  startKiroMcpServer
};
